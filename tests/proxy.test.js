const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const proxy = require('../api/[[...path]].js');

class MockResponse {
  constructor() {
    this.headers = {};
    this.headersSent = false;
    this.body = '';
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  write(chunk) {
    this.headersSent = true;
    this.body += chunk.toString();
    return true;
  }

  end(chunk) {
    if (chunk) this.body += chunk.toString();
    this.ended = true;
    return this;
  }

  json(value) {
    this.headersSent = true;
    this.body = JSON.stringify(value);
    this.ended = true;
    return this;
  }
}

function makeRequest(method, url, body, headers = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

test('returns a clear configuration error when YAWT_ORACLE_ENGINE_ORIGIN is missing', async () => {
  const previousUrl = process.env.YAWT_ORACLE_ENGINE_ORIGIN;
  const previousFetch = global.fetch;
  delete process.env.YAWT_ORACLE_ENGINE_ORIGIN;
  global.fetch = async () => {
    throw new Error('fetch should not be called');
  };

  try {
    const res = new MockResponse();
    await proxy(makeRequest('GET', '/health'), res);
    assert.equal(res.statusCode, 503);
    assert.match(JSON.parse(res.body).error, /Set YAWT_ORACLE_ENGINE_ORIGIN/);
  } finally {
    if (previousUrl === undefined) delete process.env.YAWT_ORACLE_ENGINE_ORIGIN;
    else process.env.YAWT_ORACLE_ENGINE_ORIGIN = previousUrl;
    global.fetch = previousFetch;
  }
});

test('forwards chat completions to the configured Oracle origin as a stream', async () => {
  const previousUrl = process.env.YAWT_ORACLE_ENGINE_ORIGIN;
  const previousFetch = global.fetch;
  process.env.YAWT_ORACLE_ENGINE_ORIGIN = 'http://oracle.example:9000';
  let forwardedUrl;
  let forwardedOptions;
  global.fetch = async (url, options) => {
    forwardedUrl = url;
    forwardedOptions = options;
    return new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  try {
    const res = new MockResponse();
    const body = JSON.stringify({ model: 'yawtllm-7b', stream: false });
    await proxy(
      makeRequest('POST', '/v1/chat/completions?trace=1', body, {
        'content-type': 'application/json',
        expect: '100-continue',
        'transfer-encoding': 'chunked',
        connection: 'keep-alive, x-hop',
        'x-hop': 'remove',
      }),
      res,
    );

    assert.equal(forwardedUrl, 'http://oracle.example:9000/v1/chat/completions?trace=1');
    assert.equal(forwardedOptions.method, 'POST');
    assert.equal(JSON.parse(forwardedOptions.body.toString()).stream, true);
    assert.equal(forwardedOptions.headers.expect, undefined);
    assert.equal(forwardedOptions.headers['transfer-encoding'], undefined);
    assert.equal(forwardedOptions.headers.connection, undefined);
    assert.equal(forwardedOptions.headers['x-hop'], undefined);
    assert.equal(forwardedOptions.headers['content-length'], String(Buffer.byteLength(forwardedOptions.body)));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'data: [DONE]\n\n');
    assert.equal(res.ended, true);
  } finally {
    if (previousUrl === undefined) delete process.env.YAWT_ORACLE_ENGINE_ORIGIN;
    else process.env.YAWT_ORACLE_ENGINE_ORIGIN = previousUrl;
    global.fetch = previousFetch;
  }
});
