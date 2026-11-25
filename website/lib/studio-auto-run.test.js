import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadGateFactory() {
  try {
    const module = await import('./studio-auto-run.js');
    return module.createStudioAutoRunGate;
  } catch {
    assert.fail('Studio auto-run gate is not implemented');
  }
}

test('a mounted Studio claims a shared-link auto-run only once', async () => {
  const createStudioAutoRunGate = await loadGateFactory();

  const claimAutoRun = createStudioAutoRunGate();

  assert.equal(claimAutoRun('example.com'), 'example.com');
  assert.equal(claimAutoRun('example.com'), null);
  assert.equal(claimAutoRun('another.example'), null);
});

test('the Studio auto-run gate ignores an empty URL without consuming its claim', async () => {
  const createStudioAutoRunGate = await loadGateFactory();
  const claimAutoRun = createStudioAutoRunGate();

  assert.equal(claimAutoRun(''), null);
  assert.equal(claimAutoRun('example.com'), 'example.com');
});
