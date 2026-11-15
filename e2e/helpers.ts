// B4 E2E のヘルパー。実プロセスの API サーバーを起動し、HTTP で3ユニットを通して検証する。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MenuItem, Order } from '../contracts/types';

const ROOT = new URL('..', import.meta.url).pathname;

export interface Api {
  base: string;
  dbPath: string;
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any; text: string }>;
  raw: (method: string, path: string, rawBody: string) => Promise<{ status: number; json: any; text: string }>;
  stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** 空の一時 DB(起動時にシードされる)で API サーバーを起動する。 */
export async function startApi(): Promise<Api> {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-order-e2e-'));
  const dbPath = join(dir, 'e2e.db');
  const port = await freePort();
  const proc: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr?.on('data', (d) => (stderr += d));
  const base = `http://127.0.0.1:${port}`;

  const request = async (method: string, path: string, rawBody?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: rawBody === undefined ? undefined : { 'content-type': 'application/json' },
      body: rawBody,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 本文が JSON でない */
    }
    return { status: res.status, json, text };
  };

  const deadline = Date.now() + 20000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`API が起動できなかった: ${stderr}`);
    try {
      if ((await request('GET', '/menu')).status === 200) break;
    } catch {
      /* まだ待受前 */
    }
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error(`API の起動がタイムアウトした: ${stderr}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    base,
    dbPath,
    call: (method, path, body) => request(method, path, body === undefined ? undefined : JSON.stringify(body)),
    raw: (method, path, rawBody) => request(method, path, rawBody),
    stop: async () => {
      if (proc.exitCode === null) {
        proc.kill();
        await new Promise((r) => proc.once('exit', r));
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function menuByName(api: Api, name: string): Promise<MenuItem> {
  const { json } = await api.call('GET', '/menu');
  const item = (json.items as MenuItem[]).find((i) => i.name === name);
  if (!item) throw new Error(`メニューに ${name} が無い`);
  return item;
}

export async function placeOrder(
  api: Api,
  lines: { menu_item_id: number; qty: number }[],
): Promise<Order> {
  const res = await api.call('POST', '/orders', { lines });
  if (res.status !== 201) throw new Error(`POST /orders -> ${res.status} ${res.text}`);
  return res.json as Order;
}

/** 厨房として PLACED → COOKING → READY まで進める。 */
export async function completeOrder(api: Api, id: number): Promise<Order> {
  for (const status of ['COOKING', 'READY']) {
    const res = await api.call('PATCH', `/kitchen/orders/${id}/status`, { status });
    if (res.status !== 200) throw new Error(`PATCH ${id} ${status} -> ${res.status} ${res.text}`);
    if (status === 'READY') return res.json as Order;
  }
  throw new Error('unreachable');
}
