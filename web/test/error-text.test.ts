// 画面のエラー判定・文言の組み立てを固定する。api.ts の本物の失敗を通して確かめる(エラーの作り方には依存しない)。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from '../src/shared/api';
import { kitchenErrorText, managerErrorText, parseCustomerError } from '../src/shared/error-text';

/** fetch を差し替えて api を呼び、投げられたものを返す。終了時に fetch を元へ戻す。 */
async function failWith(respond: () => Response | Promise<Response>, call: () => Promise<unknown>): Promise<unknown> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => respond()) as typeof fetch;
  try {
    await call();
  } catch (e) {
    return e;
  } finally {
    globalThis.fetch = original;
  }
  assert.fail('失敗するはずの呼び出しが成功した');
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('客: 404 は status 404 とサーバーの文言を返す', async () => {
  const e = await failWith(() => json(404, { error: 'order not found' }), () => api.get('/orders/9'));
  assert.deepEqual(parseCustomerError(e), { status: 404, message: 'order not found' });
});

test('客: 409 sold out は status 409 と "sold out: " 付きの文言を返す(除去は画面側)', async () => {
  const e = await failWith(
    () => json(409, { error: 'sold out: 杏仁豆腐' }),
    () => api.post('/orders', { lines: [] }),
  );
  const r = parseCustomerError(e);
  assert.equal(r.status, 409);
  assert.equal(r.message, 'sold out: 杏仁豆腐');
  assert.equal(r.message.replace(/^sold out: /, ''), '杏仁豆腐');
});

test('客: 400 は status 400 とサーバーの文言を返す', async () => {
  const e = await failWith(() => json(400, { error: 'body must have lines' }), () => api.post('/orders', {}));
  assert.deepEqual(parseCustomerError(e), { status: 400, message: 'body must have lines' });
});

test('客: 本文が読めない失敗は status を保ち、文言は全体のテキストになる', async () => {
  const e = await failWith(() => new Response('not json', { status: 500 }), () => api.get('/menu'));
  assert.deepEqual(parseCustomerError(e), { status: 500, message: 'GET /menu -> 500' });
});

test('客: 通信失敗(HTTP ではない)は status null で Error の message を返す', async () => {
  const e = await failWith(
    () => {
      throw new TypeError('fetch failed');
    },
    () => api.get('/menu'),
  );
  assert.deepEqual(parseCustomerError(e), { status: null, message: 'fetch failed' });
});

test('客: Error でない値は文字列にして status null を返す', () => {
  assert.deepEqual(parseCustomerError('boom'), { status: null, message: 'boom' });
});

test('厨房: 文言は String(e) で、"Error: " から始まる', async () => {
  const e = await failWith(() => json(409, { error: 'msg' }), () => api.post('/x', {}));
  assert.ok(kitchenErrorText(e).startsWith('Error: '));
  assert.equal(kitchenErrorText(e), 'Error: POST /x -> 409 msg');
});

test('店長: Error は message、Error でないものは String(e)', async () => {
  const e = await failWith(() => json(409, { error: 'msg' }), () => api.post('/x', {}));
  assert.equal(managerErrorText(e), 'POST /x -> 409 msg');
  assert.equal(managerErrorText('plain'), 'plain');
  assert.equal(managerErrorText(42), '42');
});
