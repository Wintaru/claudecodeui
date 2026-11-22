import assert from 'node:assert/strict';
import test from 'node:test';

import { isLocalPageRequest } from '../local-page-request.js';

test('a page served from a loopback address is local', () => {
  assert.equal(isLocalPageRequest({ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' }), true);
  assert.equal(isLocalPageRequest({ host: 'localhost:3001', origin: 'http://localhost:3001' }), true);
  assert.equal(isLocalPageRequest({ host: '[::1]:3001', origin: 'http://[::1]:3001' }), true);
});

test('the browser marks the page itself as same-origin, and that is local', () => {
  assert.equal(isLocalPageRequest({
    host: 'localhost:3001',
    origin: 'http://localhost:3001',
    'sec-fetch-site': 'same-origin',
  }), true);
});

test('the same server reached as localhost and as 127.0.0.1 is local', () => {
  assert.equal(isLocalPageRequest({ host: '127.0.0.1:5183', origin: 'http://localhost:5183' }), true);
});

test('a program that is not a browser sends no Origin and is local', () => {
  assert.equal(isLocalPageRequest({ host: '127.0.0.1:3001' }), true);
});

test('a page of another local server is refused', () => {
  assert.equal(isLocalPageRequest({
    host: 'localhost:3001',
    origin: 'http://localhost:8080',
    'sec-fetch-site': 'same-site',
  }), false);
  assert.equal(isLocalPageRequest({ host: 'localhost:3001', origin: 'http://localhost:8080' }), false);
});

test('a foreign page that sends to the loopback address is refused', () => {
  assert.equal(isLocalPageRequest({ host: '127.0.0.1:3001', origin: 'https://example.com' }), false);
});

test('a foreign name that resolves to the loopback address is refused (DNS rebinding)', () => {
  assert.equal(isLocalPageRequest({ host: 'rebind.example.com:3001', origin: 'http://rebind.example.com:3001' }), false);
});

test('a sandboxed or file page with a null Origin is refused', () => {
  assert.equal(isLocalPageRequest({ host: '127.0.0.1:3001', origin: 'null' }), false);
});

test('a browser request that is not same-origin is refused even without Origin', () => {
  assert.equal(isLocalPageRequest({ host: '127.0.0.1:3001', 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(isLocalPageRequest({ host: '127.0.0.1:3001', 'sec-fetch-site': 'same-site' }), false);
});

test('a request with no Host header is refused', () => {
  assert.equal(isLocalPageRequest({}), false);
});
