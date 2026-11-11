const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 270_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getEngineUrl(requestUrl) {
  const configuredUrl = process.env.YAWT_ORACLE_ENGINE_ORIGIN?.trim();
  if (!configuredUrl) {
    return {
      status: 503,
      error: 'The Yawt engine origin is not configured. Set YAWT_ORACLE_ENGINE_ORIGIN in the Vercel project.',
    };
  }

  let engine;
  try {
    engine = new URL(configuredUrl);
  } catch {
    return { status: 500, error: 'YAWT_ORACLE_ENGINE_ORIGIN must be an absolute HTTP or HTTPS origin.' };
  }

  if (
    !['http:', 'https:'].includes(engine.protocol) ||
    engine.username ||
    engine.password ||
    engine.pathname !== '/' ||
    engine.search ||
    engine.hash
  ) {
    return {
      status: 500,
      error: 'YAWT_ORACLE_ENGINE_ORIGIN must be an HTTP or HTTPS origin without a path, credentials, or query.',
    };
  }

  if (!requestUrl?.startsWith('/') || requestUrl.startsWith('//')) {
    return { error: 'Invalid engine request path.', status: 400 };
  }

  return { url: `${engine.origin}${requestUrl}` };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Yawt-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const target = getEngineUrl(req.url);
  if (target.error) {
    return res.status(target.status).json({ error: target.error });
  }

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (c) => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });

  let body = chunks.length ? Buffer.concat(chunks) : undefined;

  // Force stream:true on chat completions
  if (body && req.url.includes('/chat/completions')) {
    try {
      const parsed = JSON.parse(body.toString());
      parsed.stream = true;
      body = Buffer.from(JSON.stringify(parsed));
    } catch {
      return res.status(400).json({ error: 'Chat completion body must be valid JSON.' });
    }
  }

  const connectionHeaders = new Set(
    String(req.headers.connection || '')
      .split(',')
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean),
  );
  const hopByHopHeaders = new Set([
    'connection',
    'content-length',
    'expect',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    ...connectionHeaders,
  ]);
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([name]) => !hopByHopHeaders.has(name.toLowerCase())),
  );
  if (body) headers['content-length'] = String(body.length);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const upstream = await fetch(target.url, {
          method: req.method,
          headers,
          body: body?.length ? body : undefined,
          signal: controller.signal,
        });

        if ([502, 503, 504].includes(upstream.status) && attempt < MAX_RETRIES - 1) {
          if (upstream.body) {
            await upstream.body.cancel().catch((error) => {
              console.error('Could not cancel the failed Yawt engine response:', error);
            });
          }
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        upstream.headers.forEach((v, k) => {
          if (!['transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
        });
        res.status(upstream.status);

        if (upstream.body) {
          const reader = upstream.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
          } finally {
            reader.releaseLock();
          }
        }
        res.end();
        return;
      } catch (error) {
        if (res.headersSent) {
          console.error('Yawt engine stream failed after the response started:', error);
          res.destroy?.(error);
          return;
        }
        if (controller.signal.aborted) {
          return res.status(504).json({ error: 'The Yawt engine request timed out after 270 seconds.' });
        }
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        console.error(`Could not reach the Yawt engine at ${target.url}:`, error);
        return res.status(502).json({
          error: 'Could not reach the Yawt engine. Verify YAWT_ORACLE_ENGINE_ORIGIN and that the Oracle VM allows Vercel traffic on its engine port.',
        });
      }
    }
  } finally {
    clearTimeout(timer);
  }
};
