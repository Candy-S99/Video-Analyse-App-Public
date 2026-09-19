import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('npm test führt den strengen Ereignisvertrag separat aus', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const testScript = packageJson.scripts.test;

  assert.match(testScript, /tests\/jobEventType\.contract\.ts/);
  assert.match(testScript, /tsc --noEmit/);
  assert.doesNotMatch(testScript, /tests\/\*\.ts/);
});
