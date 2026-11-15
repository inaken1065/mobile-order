// 全体エラーハンドラ(app.ts の errorHandler)の応答を確認する。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../../../contracts/api-error';
import { freshApp } from '../../../contracts/test/helpers';
import { errorHandler } from '../../src/app';
import { InvalidTransitionError, OrderNotFoundError } from '../../src/db/transition';

/** 全体ハンドラだけを付けた小さな app。/boom は渡されたエラーを投げる。 */
async function boomApp(err: unknown) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  app.get('/boom', async () => {
    throw err;
  });
  await app.ready();
  return app;
}

test('ApiError は status と message を { error } で返す(400/404/409)', async () => {
  for (const status of [400, 404, 409]) {
    const app = await boomApp(new ApiError(status, `msg ${status}`));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    assert.equal(res.statusCode, status);
    assert.deepEqual(res.json(), { error: `msg ${status}` });
    await app.close();
  }
});

test('メッセージが空の 4xx は bad request になる', async () => {
  const app = await boomApp(new ApiError(400, ''));
  const res = await app.inject({ method: 'GET', url: '/boom' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: 'bad request' });
  await app.close();
});

test('メッセージが未定義の 4xx は bad request になる', async () => {
  const err = Object.assign(new Error('x'), { statusCode: 422, message: undefined });
  const app = await boomApp(err);
  const res = await app.inject({ method: 'GET', url: '/boom' });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json(), { error: 'bad request' });
  await app.close();
});

test('4xx 以外のエラーは 500 internal server error で、メッセージを漏らさない', async () => {
  const app = await boomApp(new Error('secret detail'));
  const res = await app.inject({ method: 'GET', url: '/boom' });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal server error' });
  await app.close();
});

test('statusCode が 503 のエラーも 500 internal server error になる', async () => {
  const app = await boomApp(Object.assign(new Error('unavailable detail'), { statusCode: 503 }));
  const res = await app.inject({ method: 'GET', url: '/boom' });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal server error' });
  await app.close();
});

test('OrderNotFoundError は 404 order not found、InvalidTransitionError は 409', async () => {
  const a = await boomApp(new OrderNotFoundError(99));
  const r1 = await a.inject({ method: 'GET', url: '/boom' });
  assert.equal(r1.statusCode, 404);
  assert.deepEqual(r1.json(), { error: 'order not found' });
  await a.close();

  const b = await boomApp(new InvalidTransitionError('PLACED', 'READY'));
  const r2 = await b.inject({ method: 'GET', url: '/boom' });
  assert.equal(r2.statusCode, 409);
  assert.deepEqual(r2.json(), { error: 'invalid transition: PLACED -> READY' });
  await b.close();
});

test('存在しないルートの 404 は Fastify 標準の形式のまま', async () => {
  const { app } = freshApp();
  const res = await app.inject({ method: 'GET', url: '/no-such-route' });
  assert.equal(res.statusCode, 404);
  const body = res.json();
  for (const key of ['statusCode', 'error', 'message']) assert.ok(key in body, `${key} がある`);
  await app.close();
});

test('存在しないルートへの壊れた JSON は 400 で { error } の形', async () => {
  const { app } = freshApp();
  const res = await app.inject({
    method: 'POST',
    url: '/no-such-route',
    headers: { 'content-type': 'application/json' },
    payload: '{broken',
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(!('statusCode' in body) && !('code' in body));
  await app.close();
});

test('非対応の content-type は 415 で { error } の形(存在するルート。未登録ルートは先に 404 になる)', async () => {
  const { app } = freshApp();
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    headers: { 'content-type': 'application/x-unsupported' },
    payload: 'x',
  });
  assert.equal(res.statusCode, 415);
  const body = res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(!('statusCode' in body) && !('code' in body));
  await app.close();
});
