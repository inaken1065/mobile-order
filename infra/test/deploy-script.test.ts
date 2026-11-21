// deploy.sh(infra/terraform/files/mobile-order-deploy.sh)の動作を、一時ディレクトリとスタブで確認する。
// systemctl、curl、mountpoint、free は PATH の先頭に置くスタブに差し替える。実際のサービスと /opt、/mnt には触れない。
// パスは MO_TEST_ROOT(root 以外のときだけ有効)で一時ディレクトリへ向ける。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  openSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const SCRIPT = new URL('../terraform/files/mobile-order-deploy.sh', import.meta.url).pathname;
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const OLD = 'c'.repeat(40);

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/** 一時ルートと、スタブを作る。 */
function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), 'deploy-test-'));
  roots.push(root);
  for (const d of [
    'opt/mobile-order/releases',
    'var/lib/mobile-order/work',
    'mnt/data',
    'home/testuser/incoming',
    'stubs',
    'build',
  ]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  chmodSync(join(root, 'home/testuser'), 0o755);
  const stubs = join(root, 'stubs');
  // stat: fake-owner があれば、ホームの所有者が別の uid に見えるようにする。なければ本物の stat
  script(
    join(stubs, 'stat'),
    `if [ -e "${root}/fake-owner" ]; then echo "4242 755"; exit 0; fi; exec /usr/bin/stat "$@"`,
  );
  script(join(stubs, 'systemctl'), `echo "$*" >> "${root}/calls.log"`);
  script(
    join(stubs, 'mountpoint'),
    `[ -e "${root}/unmounted" ] && exit 1; exit 0`,
  );
  script(
    join(stubs, 'free'),
    `cat <<'EOF'
               total        used        free      shared  buff/cache   available
Mem:             970         400         100          10         470         500
Swap:           1023           0        1023
EOF`,
  );
  // current が指す版の server.mjs に BAD があれば 500、なければ 200 を返す
  script(
    join(stubs, 'curl'),
    `out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2;;
    -w|--max-time) shift 2;;
    http*) url="$1"; shift;;
    *) shift;;
  esac
done
cur="${root}/opt/mobile-order/current"
if [ -e "${root}/slow-curl" ]; then sleep 1.5; fi
code=200
if [ ! -e "$cur/server.mjs" ] || grep -q BAD "$cur/server.mjs"; then code=500; fi
body='<html></html>'
case "$url" in */api/menu) body='{"items":[]}';; esac
if [ -n "$out" ] && [ "$out" != "/dev/null" ]; then printf '%s' "$body" > "$out"; fi
printf '%s' "$code"`,
  );
  return { root, stubs };
}

type Env = ReturnType<typeof makeEnv>;

/** 成果物(server.mjs と web/)を作って incoming に置く。 */
function putArtifact(env: Env, id: string, opts: { bad?: boolean } = {}): void {
  const dir = join(env.root, 'build', id);
  mkdirSync(join(dir, 'web/assets'), { recursive: true });
  writeFileSync(join(dir, 'server.mjs'), opts.bad ? '// BAD\n' : `// ok ${id}\n`);
  writeFileSync(join(dir, 'schema.sql'), '-- schema\n');
  writeFileSync(join(dir, 'web/index.html'), '<html></html>');
  writeFileSync(join(dir, 'web/assets/app.js'), 'console.log(1)');
  const tar = join(env.root, 'home/testuser/incoming', `${id}.tar.gz`);
  const r = spawnSync('tar', ['-czf', tar, '-C', dir, 'server.mjs', 'schema.sql', 'web']);
  assert.equal(r.status, 0, String(r.stderr));
  writeSum(env, id);
}

function writeSum(env: Env, id: string, hash?: string): void {
  const tar = join(env.root, 'home/testuser/incoming', `${id}.tar.gz`);
  const h = hash ?? createHash('sha256').update(readFileSync(tar)).digest('hex');
  writeFileSync(join(env.root, 'home/testuser/incoming', `${id}.sha256`), `${h}  ${id}.tar.gz\n`);
}

function run(env: Env, args: string[], extraEnv: Record<string, string> = {}, stubsFirst = env.stubs) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${stubsFirst}:${process.env.PATH}`,
      MO_TEST_ROOT: env.root,
      SUDO_USER: 'testuser',
      MO_SMOKE_TIMEOUT: '2',
      MO_ROLLBACK_TIMEOUT: '3',
      MO_POLL_INTERVAL: '0.2',
      MO_FREE_INTERVAL: '1',
      ...extraEnv,
    },
  });
}

const current = (env: Env) => readlinkSync(join(env.root, 'opt/mobile-order/current'));
const release = (env: Env, id: string) => join(env.root, 'opt/mobile-order/releases', id);
const calls = (env: Env) => (existsSync(join(env.root, 'calls.log')) ? readFileSync(join(env.root, 'calls.log'), 'utf8') : '');
const skip = IS_ROOT ? 'root で実行されているためスキップ(MO_TEST_ROOT は root では使えない)' : false;

test('不正なリリース ID は拒否する', { skip }, () => {
  const env = makeEnv();
  for (const bad of ['xyz', '../../etc/passwd', 'A'.repeat(40), 'a'.repeat(39)]) {
    const r = run(env, [bad]);
    assert.equal(r.status, 1, `${bad}: ${r.stderr}`);
    assert.match(r.stderr, /不正/);
  }
  assert.equal(run(env, []).status, 1);
  assert.equal(calls(env), '', 'サービスには触れない');
});

test('SHA-256 が一致しなければ失敗し、展開も切り替えもしない', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  writeSum(env, A, '0'.repeat(64));
  const r = run(env, [A]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /SHA-256 が一致しません/);
  assert.equal(existsSync(release(env, A)), false);
  assert.equal(existsSync(join(env.root, 'opt/mobile-order/current')), false);
  assert.equal(calls(env), '');
});

test('tar にシンボリックリンクや .. を含む成果物は拒否する', { skip }, () => {
  const env = makeEnv();
  // (1) シンボリックリンク
  const dir = join(env.root, 'build/link');
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'web/index.html'), 'x');
  writeFileSync(join(dir, 'server.mjs'), 'x');
  writeFileSync(join(dir, 'schema.sql'), 'x');
  symlinkSync('/etc/passwd', join(dir, 'web/evil'));
  const tar = join(env.root, 'home/testuser/incoming', `${A}.tar.gz`);
  assert.equal(spawnSync('tar', ['-czf', tar, '-C', dir, 'server.mjs', 'schema.sql', 'web']).status, 0);
  writeSum(env, A);
  let r = run(env, [A]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /シンボリックリンクなど/);
  assert.equal(existsSync(release(env, A)), false);

  // (2) .. を含むパス
  const dir2 = join(env.root, 'build/dots');
  mkdirSync(join(dir2, 'web'), { recursive: true });
  writeFileSync(join(dir2, 'web/index.html'), 'x');
  writeFileSync(join(dir2, 'server.mjs'), 'x');
  writeFileSync(join(dir2, 'schema.sql'), 'x');
  const tar2 = join(env.root, 'home/testuser/incoming', `${B}.tar.gz`);
  const mk = spawnSync('tar', ['-czf', tar2, '-P', '--transform', 's,^web/index.html,web/../../evil,', '-C', dir2, 'server.mjs', 'schema.sql', 'web/index.html']);
  assert.equal(mk.status, 0, String(mk.stderr));
  writeSum(env, B);
  r = run(env, [B]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /\.\. が含まれています/);
  assert.equal(existsSync(release(env, B)), false);
  assert.equal(existsSync(join(env.root, 'opt/evil')), false);
});

/** 任意の中身の成果物を作り、incoming に置く。files は作業ディレクトリに作る。 */
function putCustomTar(
  env: Env,
  id: string,
  setup: (dir: string) => void,
  tarArgs: string[],
  members: string[],
  base = ['-czf'],
): void {
  const dir = join(env.root, 'build', `custom-${id}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'web'), { recursive: true });
  for (const f of ['server.mjs', 'schema.sql', 'web/index.html']) writeFileSync(join(dir, f), 'x');
  setup(dir);
  const tar = join(env.root, 'home/testuser/incoming', `${id}.tar.gz`);
  const r = spawnSync('tar', [...base, tar, ...tarArgs, '-C', dir, ...members]);
  assert.equal(r.status, 0, String(r.stderr));
  writeSum(env, id);
}

const DEFAULT_MEMBERS = ['server.mjs', 'schema.sql', 'web'];

/** 拒否されること(終了コード 1、メッセージ、配置も切り替えもしない)を確認する。 */
function assertRejected(env: Env, id: string, message: RegExp): void {
  const r = run(env, [id]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stderr, message);
  assert.equal(existsSync(release(env, id)), false);
  assert.equal(existsSync(join(env.root, 'opt/mobile-order/releases', `.tmp-${id}`)), false, '展開の途中のものを残さない');
  assert.equal(existsSync(join(env.root, 'opt/mobile-order/current')), false);
  assert.equal(calls(env), '', 'サービスには触れない');
}

test('tar にハードリンクを含む成果物は拒否する', { skip }, () => {
  const env = makeEnv();
  putCustomTar(env, A, (d) => linkSync(join(d, 'web/index.html'), join(d, 'web/hardlink.html')), [], DEFAULT_MEMBERS);
  assertRejected(env, A, /シンボリックリンクなど/);
});

test('tar にデバイスや FIFO を含む成果物は拒否する', { skip }, () => {
  const env = makeEnv();
  // 文字デバイス: /dev/null をそのまま web/dev-null として格納する
  const dev = join(env.root, 'home/testuser/incoming', `${A}.tar.gz`);
  const dir = join(env.root, 'build/dev');
  mkdirSync(join(dir, 'web'), { recursive: true });
  for (const f of ['server.mjs', 'schema.sql', 'web/index.html']) writeFileSync(join(dir, f), 'x');
  const r = spawnSync('bash', [
    '-c',
    `tar -czf "${dev}" -C "${dir}" server.mjs schema.sql web -C /dev --transform 's,^null$,web/dev-null,' null`,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
  writeSum(env, A);
  assertRejected(env, A, /シンボリックリンクなど/);

  // FIFO
  putCustomTar(env, B, (d) => assert.equal(spawnSync('mkfifo', [join(d, 'web/fifo')]).status, 0), [], DEFAULT_MEMBERS);
  assertRejected(env, B, /シンボリックリンクなど/);
});

test('tar に絶対パスを含む成果物は拒否する', { skip }, () => {
  const env = makeEnv();
  putCustomTar(env, A, () => {}, ['-P', '--transform', 's,^web/index.html,/tmp/abs-evil,'], ['server.mjs', 'schema.sql', 'web/index.html']);
  assertRejected(env, A, /絶対パス/);
});

test('tar に制御文字(改行を含む)やバックスラッシュを含む名前は拒否する', { skip }, () => {
  const env = makeEnv();
  putCustomTar(env, A, (d) => writeFileSync(join(d, 'web', 'a\u0001b'), 'x'), [], DEFAULT_MEMBERS);
  assertRejected(env, A, /制御文字/);
  // 改行。分割すると、後半が許可リストの名前に見える
  putCustomTar(env, B, (d) => writeFileSync(join(d, 'web', 'x\nserver.mjs'), 'x'), [], DEFAULT_MEMBERS);
  assertRejected(env, B, /制御文字/);
});

test('tar の最上位が許可リスト(server.mjs、schema.sql、web/)以外なら拒否する', { skip }, () => {
  const env = makeEnv();
  putCustomTar(env, A, (d) => writeFileSync(join(d, 'extra.txt'), 'x'), [], [...DEFAULT_MEMBERS, 'extra.txt']);
  assertRejected(env, A, /最上位/);
  // 名前が似ているもの(完全一致でなければならない)
  putCustomTar(env, B, (d) => writeFileSync(join(d, 'schema.sql.bak'), 'x'), [], [...DEFAULT_MEMBERS, 'schema.sql.bak']);
  assertRejected(env, B, /最上位/);
});

test('schema.sql が欠けた成果物は、展開後の検査で拒否し、途中のものを残さない', { skip }, () => {
  const env = makeEnv();
  putCustomTar(env, A, () => {}, [], ['server.mjs', 'web']);
  assertRejected(env, A, /schema\.sql.*いずれかがありません/);
});

test('incoming の成果物がシンボリックリンクなら、たどらずに拒否する', { skip }, () => {
  const env = makeEnv();
  const inc = join(env.root, 'home/testuser/incoming');
  writeFileSync(join(env.root, 'secret.txt'), 'secret');
  symlinkSync(join(env.root, 'secret.txt'), join(inc, `${A}.tar.gz`));
  writeFileSync(join(inc, `${A}.sha256`), `${'0'.repeat(64)}  x\n`);
  assertRejected(env, A, /通常のファイルではありません/);
  assert.equal(existsSync(join(env.root, 'var/lib/mobile-order/work', A)), false, '作業ディレクトリを残さない');
});

test('ホームが root 所有でない(所有者が違う)なら、最初に拒否する', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  writeFileSync(join(env.root, 'fake-owner'), '');
  assertRejected(env, A, /root 所有ではありません/);
});

test('ホームに group や other の書き込み権限があれば拒否する', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  chmodSync(join(env.root, 'home/testuser'), 0o775);
  assertRejected(env, A, /書き込み権限/);
  chmodSync(join(env.root, 'home/testuser'), 0o757);
  assertRejected(env, A, /書き込み権限/);
});

test('ホームがシンボリックリンクなら拒否する', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  const home = join(env.root, 'home/testuser');
  const real = join(env.root, 'home/real');
  renameSync(home, real);
  symlinkSync(real, home);
  assertRejected(env, A, /シンボリックリンク/);
});

test('incoming ディレクトリ自体がシンボリックリンクなら、中の成果物が正しくても拒否する', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  const inc = join(env.root, 'home/testuser/incoming');
  const other = join(env.root, 'other-incoming');
  renameSync(inc, other);
  symlinkSync(other, inc);
  assertRejected(env, A, /incoming がない、またはシンボリックリンク|incoming.*シンボリックリンクです/);
  assert.equal(existsSync(join(env.root, 'var/lib/mobile-order/work', A)), false);
});

test('成功すると current を新しい版へ切り替え、古い版を消し、直前の 1 世代を残す', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  let r = run(env, [A]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(current(env), release(env, A));

  mkdirSync(release(env, OLD), { recursive: true }); // 2 世代前の古い版
  putArtifact(env, B);
  r = run(env, [B]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(current(env), release(env, B));
  assert.equal(existsSync(release(env, A)), true, '直前の版は残る');
  assert.equal(existsSync(release(env, OLD)), false, '古い版は消える');
  assert.match(r.stdout, /メモリの計測/);
  assert.equal(existsSync(join(env.root, 'home/testuser/incoming', `${B}.tar.gz`)), false, 'incoming の成果物は消える');
  assert.match(calls(env), /restart mobile-order/);
  assert.equal(readFileSync(join(release(env, B), 'server.mjs'), 'utf8'), `// ok ${B}\n`);
});

test('スモークテストが不合格なら直前の版へロールバックし、失敗した版を消す', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  assert.equal(run(env, [A]).status, 0);
  putArtifact(env, B, { bad: true });
  const r = run(env, [B]);
  assert.equal(r.status, 10, r.stderr + r.stdout);
  assert.equal(current(env), release(env, A), 'current は直前の版に戻る');
  assert.equal(existsSync(release(env, B)), false, '失敗した版は消える');
  assert.match(r.stderr, /server\.mjs の SHA-256/);
  assert.match(r.stdout, /ロールバックに成功/);
  assert.equal(calls(env).split('\n').filter((l) => l === 'restart mobile-order').length, 3, 'A、B、A への戻しで 3 回');
});

test('ロールバックのスモークテストが上限を超えてから合格しても、成功(終了コード 10)として扱う', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  assert.equal(run(env, [A]).status, 0);
  putArtifact(env, B, { bad: true });
  writeFileSync(join(env.root, 'slow-curl'), ''); // 各 curl が 1.5 秒かかる: 2 回で 3 秒 > 上限 1 秒
  const r = run(env, [B], { MO_ROLLBACK_TIMEOUT: '1' });
  assert.equal(r.status, 10, r.stderr + r.stdout);
  assert.equal(current(env), release(env, A));
  assert.match(r.stdout, /ロールバックに成功/);
  assert.match(r.stdout, /上限.*を超えましたが/);
});

test('ロールバックのスモークテストも不合格なら、終了コード 11 で手動の復旧を促す', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  assert.equal(run(env, [A]).status, 0);
  writeFileSync(join(release(env, A), 'server.mjs'), '// BAD\n'); // 戻し先も壊れている
  putArtifact(env, B, { bad: true });
  const r = run(env, [B]);
  assert.equal(r.status, 11, r.stderr + r.stdout);
  assert.match(r.stderr, /ロールバックにも失敗/);
});

test('デプロイが終わったら、free の記録用の子プロセスが残っていても、ロックは解放されている', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  // 子プロセスの sleep が長く残る設定。出力はファイルへ向け、残った子プロセスにパイプを握らせない
  const out = openSync(join(env.root, 'out.log'), 'w');
  const r = spawnSync('bash', [SCRIPT, A], {
    stdio: ['ignore', out, out],
    env: {
      PATH: `${env.stubs}:${process.env.PATH}`,
      MO_TEST_ROOT: env.root,
      SUDO_USER: 'testuser',
      MO_SMOKE_TIMEOUT: '2',
      MO_POLL_INTERVAL: '0.2',
      MO_FREE_INTERVAL: '30',
    },
  });
  closeSync(out);
  assert.equal(r.status, 0, readFileSync(join(env.root, 'out.log'), 'utf8'));
  const lock = join(env.root, 'var/lib/mobile-order/deploy.lock');
  const l = spawnSync('flock', ['-n', lock, 'true']);
  assert.equal(l.status, 0, 'デプロイの終了直後に、次のデプロイがロックを取れる');
});

test('データディスクが未マウントのときは、ロールバックせずに失敗する', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  assert.equal(run(env, [A]).status, 0);
  writeFileSync(join(env.root, 'unmounted'), '');
  putArtifact(env, B, { bad: true });
  const r = run(env, [B]);
  assert.equal(r.status, 12, r.stderr);
  assert.match(r.stderr, /未マウント/);
  assert.equal(current(env), release(env, B), 'ロールバックしない(意図的な例外)');
  assert.equal(calls(env).split('\n').filter((l) => l === 'restart mobile-order').length, 2);
});

test('初回のデプロイが失敗してもロールバックしない(戻す先がない)', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A, { bad: true });
  const r = run(env, [A]);
  assert.equal(r.status, 13, r.stderr);
  assert.match(r.stderr, /初回/);
  assert.equal(current(env), release(env, A));
  assert.equal(existsSync(release(env, A)), true, 'current が指す版は消さない');
});

test('同じ ID の再デプロイは、展開し直さずにリンクを張り直す。不合格でもロールバックしない', { skip }, () => {
  const env = makeEnv();
  putArtifact(env, A);
  assert.equal(run(env, [A]).status, 0);
  const marker = join(release(env, A), 'marker.txt');
  writeFileSync(marker, 'keep');

  putArtifact(env, A);
  let r = run(env, [A]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /展開しません/);
  assert.equal(readFileSync(marker, 'utf8'), 'keep', '展開し直していない');

  // 既にある版が壊れている(スモークテストが不合格)場合
  writeFileSync(join(release(env, A), 'server.mjs'), '// BAD\n');
  putArtifact(env, A);
  r = run(env, [A]);
  assert.equal(r.status, 13, r.stderr);
  assert.equal(current(env), release(env, A));
  assert.equal(existsSync(release(env, A)), true, 'current でも prev でもある版は消さない');
});

test('root のときは MO_TEST_ROOT を拒否する', { skip }, () => {
  const env = makeEnv();
  // id -u が 0 を返すスタブで、root での実行を再現する
  script(join(env.stubs, 'id'), 'echo 0');
  putArtifact(env, A);
  const r = run(env, [A]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /root では MO_TEST_ROOT を受け付けません/);
  assert.equal(existsSync(release(env, A)), false);
  assert.equal(calls(env), '');
});
