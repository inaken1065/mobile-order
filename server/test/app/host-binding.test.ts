// HOST 環境変数による待ち受けアドレスの指定を、実際のサーバープロセスで確認する。
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/** 空きポートを 1 つ取得する。 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function startServer(env: Record<string, string>, dir: string): { child: ChildProcess; output: () => string } {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, DB_PATH: join(dir, 'app.db'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout?.on('data', (d) => (buf += d));
  child.stderr?.on('data', (d) => (buf += d));
  return { child, output: () => buf };
}

async function waitMenu(url: string, timeoutMs = 20000): Promise<number> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      return res.status;
    } catch {
      if (Date.now() > end) throw new Error(`応答なし: ${url}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

test('HOST=127.0.0.1 のとき 127.0.0.1 で待ち受ける', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'host-bind-'));
  const port = await freePort();
  const { child } = startServer({ HOST: '127.0.0.1', PORT: String(port) }, dir);
  try {
    assert.equal(await waitMenu(`http://127.0.0.1:${port}/menu`), 200);
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HOST 未指定のときは従来どおり 0.0.0.0 で待ち受ける(ループバックにも届く)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'host-bind-'));
  const port = await freePort();
  const env: Record<string, string> = { PORT: String(port) };
  const { child, output } = startServer(env, dir);
  try {
    assert.equal(await waitMenu(`http://127.0.0.1:${port}/menu`), 200);
    // ループバック以外のアドレスがあるマシンでは、そちらからも届くこと(127.0.0.1 限定ではない)
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (external) assert.equal(await waitMenu(`http://${external.address}:${port}/menu`), 200);
    assert.doesNotMatch(output(), /EADDRNOTAVAIL/);
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('このマシンにないアドレスを HOST に指定すると起動に失敗してエラーを出す', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'host-bind-'));
  const port = await freePort();
  // 203.0.113.0/24 は文書用の予約範囲で、ローカルのアドレスにならない
  const { child, output } = startServer({ HOST: '203.0.113.99', PORT: String(port) }, dir);
  try {
    const code = await new Promise<number | null>((resolve) => child.once('exit', (c) => resolve(c)));
    assert.notEqual(code, 0);
    assert.match(output(), /EADDRNOTAVAIL|listen/);
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});
