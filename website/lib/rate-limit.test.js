import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkRate, checkRateBlob, _resetRateLimit } from './rate-limit.js';

beforeEach(() => _resetRateLimit());

test('first three requests allowed, fourth blocked', () => {
  const key = 'ip-1';
  assert.equal(checkRate(key).allowed, true);
  assert.equal(checkRate(key).allowed, true);
  assert.equal(checkRate(key).allowed, true);
  assert.equal(checkRate(key).allowed, false);
});

test('remaining counts down', () => {
  const key = 'ip-2';
  assert.equal(checkRate(key).remaining, 2);
  assert.equal(checkRate(key).remaining, 1);
  assert.equal(checkRate(key).remaining, 0);
  assert.equal(checkRate(key).remaining, 0);
});

test('different keys have independent budgets', () => {
  checkRate('a');
  checkRate('a');
  checkRate('a');
  assert.equal(checkRate('a').allowed, false);
  assert.equal(checkRate('b').allowed, true);
});

test('window reset after expiry', async () => {
  const key = 'ip-3';
  const opts = { limit: 2, windowMs: 30 };
  assert.equal(checkRate(key, opts).allowed, true);
  assert.equal(checkRate(key, opts).allowed, true);
  assert.equal(checkRate(key, opts).allowed, false);
  await new Promise((r) => setTimeout(r, 40));
  const after = checkRate(key, opts);
  assert.equal(after.allowed, true);
  assert.equal(after.remaining, 1);
});

test('custom limit respected', () => {
  const key = 'ip-4';
  const opts = { limit: 5, windowMs: 60000 };
  for (let i = 0; i < 5; i++) assert.equal(checkRate(key, opts).allowed, true);
  assert.equal(checkRate(key, opts).allowed, false);
});

test('resetAt advances with the first-seen time', () => {
  const key = 'ip-5';
  const { resetAt: a } = checkRate(key, { limit: 3, windowMs: 60000 });
  const { resetAt: b } = checkRate(key, { limit: 3, windowMs: 60000 });
  assert.equal(a, b);
});

test('local two-stage quota counts each extraction once per limiter', async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal(checkRate('extract:local', { limit: 2 }).allowed, true);
      assert.equal((await checkRateBlob('extract:local', { limit: 2 })).allowed, true);
    }
    assert.equal(checkRate('extract:local', { limit: 2 }).allowed, false);
    assert.equal((await checkRateBlob('extract:local', { limit: 2 })).allowed, false);
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
