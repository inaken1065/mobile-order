// シェルスクリプトの構文を bash -n で確認する(起動スクリプトは、Terraform の templatefile と同じ置き換えをしてから)。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const TF = new URL('../terraform/', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url).pathname;

function bashSyntax(path: string) {
  return spawnSync('bash', ['-n', path], { encoding: 'utf8' });
}

test('起動スクリプト(描画後)の bash -n が通り、テンプレートの変数がすべて埋まる', () => {
  const tpl = readFileSync(join(TF, 'startup.sh.tpl'), 'utf8');
  const file = (name: string) => readFileSync(join(TF, 'files', name), 'utf8').trim();
  // compute.tf の templatefile に渡す変数と同じ名前
  const vars: Record<string, string> = {
    node_version: '24.0.0',
    node_sha256: '0'.repeat(64),
    deployer_unique_id: '123456789012345678901',
    sysctl_conf: file('sysctl-mobile-order.conf'),
    journald_conf: file('journald-mobile-order.conf'),
    service_unit: file('mobile-order.service'),
    caddy_dropin: file('caddy-order.conf'),
    caddyfile: file('Caddyfile'),
    deploy_script: file('mobile-order-deploy.sh'),
  };
  // テンプレートに現れる ${...} は、渡す変数だけ(それ以外は Terraform がエラーにする)。%{ も使わない
  const names = [...tpl.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
  for (const n of names) assert.ok(n in vars, `未定義のテンプレート変数: ${n}`);
  assert.doesNotMatch(tpl, /%\{/);
  for (const k of Object.keys(vars)) assert.ok(names.includes(k), `使われていないテンプレート変数: ${k}`);

  const rendered = tpl.replace(/\$\{([^}]*)\}/g, (_, n: string) => vars[n]);
  assert.doesNotMatch(rendered.split('\n').slice(0, 12).join('\n'), /\$\{/);
  const dir = mkdtempSync(join(tmpdir(), 'startup-syntax-'));
  try {
    const out = join(dir, 'startup.sh');
    writeFileSync(out, rendered);
    const r = bashSyntax(out);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deploy.sh の bash -n が通る', () => {
  const r = bashSyntax(join(TF, 'files/mobile-order-deploy.sh'));
  assert.equal(r.status, 0, r.stderr);
});

test('ci-guards.sh の bash -n が通る', () => {
  const r = bashSyntax(join(REPO, 'scripts/ci-guards.sh'));
  assert.equal(r.status, 0, r.stderr);
});

test('起動スクリプトは、デプロイ用ユーザーのホームを root 所有にし、incoming だけをそのユーザーの所有にする', () => {
  const tpl = readFileSync(join(TF, 'startup.sh.tpl'), 'utf8');
  assert.match(tpl, /chown root:root "\$dh"/);
  assert.match(tpl, /chmod 0755 "\$dh"/);
  assert.match(tpl, /chown "\$duid:\$dgid" "\$dh\/incoming"/);
  assert.match(tpl, /chmod 0700 "\$dh\/incoming"/);
  assert.match(tpl, /INCOMING_FAILED/);
});
