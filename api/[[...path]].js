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
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const headers = { ...req.headers };
  delete headers['host'];

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: body?.length ? body : undefined,
    });

    res.status(upstream.status);
    upstream.headers.forEach((v, k) => {
      if (!['transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
    });

    const data = await upstream.arrayBuffer();
    res.end(Buffer.from(data));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
