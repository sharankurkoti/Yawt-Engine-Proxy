const ENGINE = 'http://137.23.53.186:9000';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = `${ENGINE}${req.url}`;

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', c => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });

  let body = chunks.length ? Buffer.concat(chunks) : undefined;

  // Force stream:true on chat completions so response trickles back
  // and keeps the Vercel connection alive token by token
  if (body && req.url.includes('/chat/completions')) {
    try {
      const parsed = JSON.parse(body.toString());
      parsed.stream = true;
      body = Buffer.from(JSON.stringify(parsed));
    } catch {}
  }

  const headers = { ...req.headers };
  delete headers['host'];
  if (body) headers['content-length'] = String(body.length);

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: body?.length ? body : undefined,
    });

    upstream.headers.forEach((v, k) => {
      if (!['transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
    });
    res.status(upstream.status);

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
