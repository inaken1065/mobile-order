// ApiError 自体の性質(status / detail を持ち、name は既定の Error のまま)。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../../contracts/api-error';

test('ApiError は status・message・detail を持つ', () => {
  const e = new ApiError(409, 'm', 'd');
  assert.equal(e.status, 409);
  assert.equal(e.message, 'm');
  assert.equal(e.detail, 'd');
  assert.ok(e instanceof Error);
});

test('ApiError の name は Error のままで、String(e) は "Error: <message>"', () => {
  const e = new ApiError(500, 'm');
  assert.equal(e.name, 'Error');
  assert.equal(e.detail, '');
  assert.equal(String(e), 'Error: m');
});
