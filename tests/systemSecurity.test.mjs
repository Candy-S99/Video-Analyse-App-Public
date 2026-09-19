import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedLocalHost, isAllowedLocalOrigin, isValidShutdownRequest } from '../src/backend/services/systemSecurity.ts';

test('Shutdown-Schutz akzeptiert ausschließlich den lokalen Origin', () => {
  assert.equal(isAllowedLocalOrigin({ origin: 'http://localhost:3000', host: 'localhost:3000' }), true);
  assert.equal(isAllowedLocalOrigin({ origin: 'http://127.0.0.1:3006', host: '127.0.0.1:3006' }), true);
  assert.equal(isAllowedLocalOrigin({ origin: 'https://attacker.example', host: 'localhost:3000' }), false);
  assert.equal(isAllowedLocalOrigin({ origin: undefined, host: 'localhost:3000' }), false);
});

test('Shutdown-Schutz verlangt zusätzlich den pro Start erzeugten Token', () => {
  const headers = { origin: 'http://localhost:3000', host: 'localhost:3000', token: 'session-token' };

  assert.equal(isValidShutdownRequest(headers, 'session-token'), true);
  assert.equal(isValidShutdownRequest({ ...headers, token: 'wrong-token' }, 'session-token'), false);
  assert.equal(isValidShutdownRequest({ ...headers, token: undefined }, 'session-token'), false);
});

test('Shutdown-Schutz akzeptiert auch die lokale IPv6-Schleife', () => {
  assert.equal(isAllowedLocalHost('[::1]:3000'), true);
  assert.equal(isValidShutdownRequest({ origin: 'http://[::1]:3000', host: '[::1]:3000', token: 'ipv6-token' }, 'ipv6-token'), true);
});
