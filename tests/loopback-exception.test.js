import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { loopbackOrigin, validateTargetUrl, resolvePublicTarget, UnsafeNetworkTargetError } from '../src/security/url-safety.js';
import { startSafeBrowsingProxy } from '../src/security/safe-proxy.js';

const ALLOW = 'http://127.0.0.1:4173';

test('loopbackOrigin accepts http on 127.0.0.1 or localhost with a port and nothing else', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:4173/index.html'), ALLOW);
  assert.equal(loopbackOrigin('http://localhost:3000'), 'http://localhost:3000');
  for (const bad of ['https://127.0.0.1:4173', 'http://127.0.0.1', 'http://127.0.0.2:4173', 'http://10.0.0.5:4173', 'http://example.com:4173', 'http://user:pw@127.0.0.1:4173', 'http://[::1]:4173']) {
    assert.throws(() => loopbackOrigin(bad), UnsafeNetworkTargetError, bad);
  }
});

test('validateTargetUrl accepts exactly the allowed origin', () => {
  const ok = validateTargetUrl('http://127.0.0.1:4173/styles.css', { allowOrigin: ALLOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'http://127.0.0.1:4173/styles.css');
});

test('validateTargetUrl refuses a different port, a different loopback address, a private IPv4, and loopback with no allowance', () => {
  assert.equal(validateTargetUrl('http://127.0.0.1:4174/', { allowOrigin: ALLOW }).ok, false);
  assert.equal(validateTargetUrl('http://127.0.0.2:4173/', { allowOrigin: ALLOW }).ok, false);
  assert.equal(validateTargetUrl('http://192.168.1.5:4173/', { allowOrigin: ALLOW }).ok, false);
  assert.equal(validateTargetUrl('http://localhost:4173/', { allowOrigin: ALLOW }).ok, false, 'localhost is not the 127.0.0.1 origin');
  assert.equal(validateTargetUrl('http://127.0.0.1:4173/').ok, false);
});

test('resolvePublicTarget returns the loopback address and port for the allowed origin without a lookup', async () => {
  const target = await resolvePublicTarget('http://localhost:4173/', { allowOrigin: 'http://localhost:4173', lookup: async () => { throw new Error('must not resolve'); } });
  assert.deepEqual(target, { url: 'http://localhost:4173/', hostname: 'localhost', address: '127.0.0.1', family: 4, port: 4173 });
  await assert.rejects(resolvePublicTarget('http://localhost:4174/', { allowOrigin: 'http://localhost:4173' }), UnsafeNetworkTargetError);
});

function viaProxy(proxy, url) {
  return new Promise((resolve, reject) => {
    const req = request({ host: proxy.host, port: proxy.port, method: 'GET', path: url, headers: { host: new URL(url).host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the proxy forwards the allowed origin and refuses every other loopback or private hop, including a redirect target', async () => {
  const origin = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://192.168.1.5/' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hello from the clone');
  });
  await new Promise((r) => origin.listen(0, '127.0.0.1', r));
  const port = origin.address().port;
  const allowOrigin = `http://127.0.0.1:${port}`;
  const proxy = await startSafeBrowsingProxy({ allowOrigin });
  try {
    const ok = await viaProxy(proxy, `${allowOrigin}/`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body, 'hello from the clone');
    const redirect = await viaProxy(proxy, `${allowOrigin}/redirect`);
    assert.equal(redirect.status, 302);
    const hop = await viaProxy(proxy, redirect.location);
    assert.equal(hop.status, 403, 'the redirect target is a private address and must be refused');
    assert.equal((await viaProxy(proxy, `http://127.0.0.1:${port + 1}/`)).status, 403);
    assert.equal((await viaProxy(proxy, `http://127.0.0.2:${port}/`)).status, 403);
    assert.equal((await viaProxy(proxy, 'http://169.254.169.254/latest/meta-data/')).status, 403);
  } finally {
    await proxy.close();
    await new Promise((r) => origin.close(r));
  }
});

test('the proxy with no allowance still refuses loopback', async () => {
  const proxy = await startSafeBrowsingProxy();
  try {
    assert.equal((await viaProxy(proxy, 'http://127.0.0.1:4173/')).status, 403);
  } finally { await proxy.close(); }
});

function connectViaProxy(proxy, hostPort) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: proxy.host, port: proxy.port }, () => {
      socket.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => { data += chunk; if (data.includes('\r\n\r\n')) { socket.destroy(); resolve(data.split('\r\n')[0]); } });
    socket.on('error', reject);
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('timeout')); });
  });
}

test('a CONNECT tunnel to the allowed host:port is refused: the allowance is http only', async () => {
  const proxy = await startSafeBrowsingProxy({ allowOrigin: 'http://127.0.0.1:4173' });
  try {
    const status = await connectViaProxy(proxy, '127.0.0.1:4173');
    assert.match(status, /^HTTP\/1\.1 403 /);
  } finally { await proxy.close(); }
});
