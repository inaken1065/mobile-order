// web/src/shared/api.ts の失敗の受け取りを固定する。fetch を差し替え、投げられたエラーの message を確かめる。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from '../src/shared/api';

async function withFetch<T>(respond: () => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => respond()) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('失敗応答のエラー message は "<METHOD> <path> -> <status> <error>"', async () => {
  await withFetch(
    () => json(409, { error: 'sold out: 杏仁豆腐' }),
    () =>
      assert.rejects(
        api.post('/orders', { lines: [] }),
        (e: unknown) => e instanceof Error && e.message === 'POST /orders -> 409 sold out: 杏仁豆腐',
      ),
  );
});

test('error が無い本文・読めない本文は末尾の空白なしで "<METHOD> <path> -> <status>"', async () => {
  await withFetch(
    () => json(500, { other: 1 }),
    () => assert.rejects(api.get('/menu'), (e: unknown) => e instanceof Error && e.message === 'GET /menu -> 500'),
  );
  await withFetch(
    () => new Response('not json', { status: 502 }),
    () => assert.rejects(api.patch('/x', {}), (e: unknown) => e instanceof Error && e.message === 'PATCH /x -> 502'),
  );
});

test('成功応答は本文を返す', async () => {
  const body = await withFetch(
    () => json(200, { id: 1, name: 'ラーメン' }),
    () => api.get<{ id: number; name: string }>('/menu/1'),
  );
  assert.deepEqual(body, { id: 1, name: 'ラーメン' });
});
