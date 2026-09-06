import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePublicTarget,
  validateResolvedTargetUrl,
} from '../src/security/url-safety.js';
import { startSafeBrowsingProxy } from '../src/security/safe-proxy.js';
import { getBrowserOptions, openBrowser } from '../website/lib/browser.js';

const publicLookup = async () => [
  { address: '93.184.216.34', family: 4 },
];

test('resolved URL validation accepts an entirely public answer set', async () => {
  const result = await validateResolvedTargetUrl('https://example.test', {
    lookup: publicLookup,
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://example.test/');
});

test('resolved URL validation rejects a hostname resolving to loopback', async () => {
  const result = await validateResolvedTargetUrl('https://attacker.test', {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /public address/i);
});

test('resolved URL validation rejects mixed public and private DNS answers', async () => {
  const result = await validateResolvedTargetUrl('https://rebind.test', {
    lookup: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /public address/i);
});

test('URL validation rejects credentials and special-purpose IP literals', async () => {
  const credentials = await validateResolvedTargetUrl('https://user:pass@example.test/', {
    lookup: publicLookup,
  });
  const documentationV4 = await validateResolvedTargetUrl('https://192.0.2.1/');
  const documentationV6 = await validateResolvedTargetUrl('https://[2001:db8::1]/');
  const teredoV6 = await validateResolvedTargetUrl('https://[2001::1]/');
  const specialV4 = await Promise.all([
    '192.31.196.1',
    '192.52.193.1',
    '192.175.48.1',
  ].map((address) => validateResolvedTargetUrl(`https://${address}/`)));
  const specialV6 = await Promise.all([
    '[::ffff:8.8.8.8]',
    '[64:ff9b::808:808]',
    '[2002:0808:0808::1]',
    '[2620:4f:8000::1]',
  ].map((address) => validateResolvedTargetUrl(`https://${address}/`)));

  assert.equal(credentials.ok, false);
  assert.equal(documentationV4.ok, false);
  assert.equal(documentationV6.ok, false);
  assert.equal(teredoV6.ok, false);
  assert.ok(specialV4.every((result) => result.ok === false));
  assert.ok(specialV6.every((result) => result.ok === false));
});

test('resolved target pins one of the validated public addresses', async () => {
  const target = await resolvePublicTarget('https://example.test/path', {
    lookup: publicLookup,
  });

  assert.equal(target.address, '93.184.216.34');
  assert.equal(target.family, 4);
  assert.equal(target.url, 'https://example.test/path');
});

test('safe proxy blocks HTTP requests whose DNS answer is private', async () => {
  const proxy = await startSafeBrowsingProxy({
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  });

  try {
    const response = await new Promise((resolve, reject) => {
      const req = request({
        host: proxy.host,
        port: proxy.port,
        method: 'GET',
        path: 'http://attacker.test/',
      }, resolve);
      req.on('error', reject);
      req.end();
    });

    response.resume();
    assert.equal(response.statusCode, 403);
  } finally {
    await proxy.close();
  }
});

test('safe proxy blocks HTTPS CONNECT tunnels whose DNS answer is private', async () => {
  const proxy = await startSafeBrowsingProxy({
    lookup: async () => [{ address: '169.254.169.254', family: 4 }],
  });

  try {
    const firstLine = await new Promise((resolve, reject) => {
      const socket = connect(proxy.port, proxy.host);
      socket.setEncoding('utf8');
      socket.once('connect', () => {
        socket.write('CONNECT metadata.test:443 HTTP/1.1\r\nHost: metadata.test:443\r\n\r\n');
      });
      socket.once('data', (chunk) => {
        resolve(chunk.split('\r\n')[0]);
        socket.destroy();
      });
      socket.once('error', reject);
    });

    assert.equal(firstLine, 'HTTP/1.1 403 Forbidden');
  } finally {
    await proxy.close();
  }
});

test('hosted extraction routes resolve DNS before cache or extraction', () => {
  const routes = [
    'website/app/api/extract/route.js',
    'website/app/api/studio/route.js',
    'website/app/api/motion/route.js',
    'website/app/api/badge/[host]/route.js',
  ];

  for (const route of routes) {
    const source = readFileSync(new URL(`../${route}`, import.meta.url), 'utf8');
    assert.match(source, /await validateResolvedTargetUrl\(/, route);
    assert.ok(
      source.indexOf('await validateResolvedTargetUrl(') < source.indexOf('const key = cacheKey('),
      `${route} must resolve DNS before reading the cache`,
    );
  }
});

test('hosted browser selection ignores Browserless configuration', async () => {
  const previousToken = process.env.BROWSERLESS_TOKEN;
  process.env.BROWSERLESS_TOKEN = 'must-not-be-used';
  try {
    assert.deepEqual(await getBrowserOptions(), {});
  } finally {
    if (previousToken === undefined) delete process.env.BROWSERLESS_TOKEN;
    else process.env.BROWSERLESS_TOKEN = previousToken;
  }
});

test('shared browser helper rejects an explicit remote endpoint', async () => {
  await assert.rejects(
    openBrowser({}, { wsEndpoint: 'wss://remote-browser.invalid/' }),
    /private-network egress cannot be enforced/,
  );
});

test('crawler uses the safe proxy and rejects remote browser endpoints', () => {
  const source = readFileSync(new URL('../src/crawler.js', import.meta.url), 'utf8');

  assert.match(source, /startSafeBrowsingProxy\(/);
  assert.match(source, /if \(wsEndpoint\)[\s\S]*throw new Error/);
  assert.match(source, /proxy:\s*\{\s*server:\s*safeProxy\.url\s*\}/);
  assert.match(source, /--force-webrtc-ip-handling-policy=disable_non_proxied_udp/);
  assert.match(source, /NETWORK_OVERRIDE_FLAGS/);
  assert.match(source, /--proxy-auto-detect/);
  assert.match(source, /--proxy-pac-url/);
});
