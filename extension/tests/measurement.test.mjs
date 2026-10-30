import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeBytes, median, sampleChrome } from '../measurement.mjs';
import { checkPageSafety } from '../page-safety.mjs';

test('measurement sums only Chrome variants and retains signed increases', () => {
  const snapshot = { apps: [
    { bundlePath: '/Applications/Google Chrome.app', footprintBytes: 500 },
    { bundlePath: '/tmp/Google Chrome for Testing.app', footprintBytes: 200 },
    { bundlePath: '/Applications/Cursor.app', footprintBytes: 900 },
  ] };
  assert.equal(chromeBytes(snapshot), 700);
  assert.equal(chromeBytes({ apps: [] }), null);
  assert.equal(median([600, 700, 500]), 600);
  assert.equal(median([1, 5]), 3);
  assert.throws(() => median([]));
  assert.throws(() => median([NaN]));
});

test('sampling uses actual snapshots and refuses absent Chrome data', async () => {
  const values = [100, 500, 200];
  let index = 0;
  assert.equal(await sampleChrome(async () => ({ apps: [{ bundlePath: '/Applications/Google Chrome.app', footprintBytes: values[index++] }] })), 200);
  await assert.rejects(sampleChrome(async () => ({ apps: [] })));
});

test('an unresponsive page inspection times out as protected', async () => {
  assert.equal(await checkPageSafety({ permissions: { contains: async () => true }, scripting: { executeScript: () => new Promise(() => {}) } }, { id: 1, url: 'https://example.com/' }), 'page-unverified');
});
