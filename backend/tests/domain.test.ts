import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain } from '../src/domain';

test('normalizes valid custom hostnames', () => {
  assert.equal(normalizeDomain('Example.com'), 'example.com');
  assert.equal(normalizeDomain('www.Example.co.il'), 'www.example.co.il');
  assert.equal(normalizeDomain('example.co.il.'), 'example.co.il');
  assert.equal(normalizeDomain('xn--e1afmkfd.xn--p1ai'), 'xn--e1afmkfd.xn--p1ai');
});

test('rejects URLs, ports, paths, wildcards and malformed hostnames', () => {
  for (const value of [
    '', 'localhost', 'example', 'https://example.com', 'example.com/path',
    'example.com:443', '*.example.com', 'example..com', '-bad.example',
    'bad-.example', 'example.c', '127.0.0.1', 'user@example.com',
    'example.com?x=1', 'example .com',
  ]) {
    assert.equal(normalizeDomain(value), null, `expected invalid domain: ${value}`);
  }
});
