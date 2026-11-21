#!/bin/bash
# シェルスクリプトの静的解析(ci.yml の app ジョブが実行する)。
# 対象: deploy.sh、ci-guards.sh、起動スクリプト(Terraform の templatefile と同じ置き換えをしたあと)。
# 使い方: scripts/shellcheck.sh   環境変数 SHELLCHECK でコマンドを差し替えられる(例: "docker run --rm")。版は 0.11.0 に固定。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="$ROOT/infra/terraform"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 起動スクリプトのテンプレート変数を、ダミーの値で埋める(構文と書き方の検査が目的)
# shellcheck disable=SC2016  # JavaScript のテンプレート文字列の ${} は、シェルで展開しない
node -e '
const fs = require("fs");
const [tf, out] = process.argv.slice(1);
const file = (n) => fs.readFileSync(`${tf}/files/${n}`, "utf8").trim();
const vars = {
  node_version: "24.0.0",
  node_sha256: "0".repeat(64),
  deployer_unique_id: "123456789012345678901",
  sysctl_conf: file("sysctl-mobile-order.conf"),
  journald_conf: file("journald-mobile-order.conf"),
  service_unit: file("mobile-order.service"),
  caddy_dropin: file("caddy-order.conf"),
  caddyfile: file("Caddyfile"),
  deploy_script: file("mobile-order-deploy.sh"),
};
const tpl = fs.readFileSync(`${tf}/startup.sh.tpl`, "utf8");
fs.writeFileSync(out, tpl.replace(/\$\{([^}]*)\}/g, (_, n) => {
  if (!(n in vars)) throw new Error(`未定義のテンプレート変数: ${n}`);
  return vars[n];
}));
' "$TF" "$WORK/startup.sh"

# 実行するコマンドは、環境変数で差し替えられる(既定は shellcheck)
read -r -a SC <<< "${SHELLCHECK:-shellcheck}"
# CI と同じ版(0.11.0)で検査する。docker 以外のときは、版を確かめる
EXPECT_VERSION="0.11.0"
if [ "${SC[0]}" != "docker" ]; then
  ACTUAL_VERSION="$("${SC[@]}" --version | sed -n 's/^version: //p')"
  if [ "$ACTUAL_VERSION" != "$EXPECT_VERSION" ]; then
    echo "shellcheck の版が違います(期待 $EXPECT_VERSION、実際 ${ACTUAL_VERSION:-不明})" >&2
    exit 1
  fi
fi
if [ "${SC[0]}" = "docker" ]; then
  # docker 経由のときは、作業ディレクトリをコンテナに渡す
  "${SC[@]}" -v "$ROOT:/repo:ro" -v "$WORK:/work:ro" koalaman/shellcheck:v0.11.0 \
    /repo/infra/terraform/files/mobile-order-deploy.sh /repo/scripts/ci-guards.sh /repo/scripts/shellcheck.sh /work/startup.sh
else
  "${SC[@]}" "$TF/files/mobile-order-deploy.sh" "$ROOT/scripts/ci-guards.sh" "$ROOT/scripts/shellcheck.sh" "$WORK/startup.sh"
fi
echo "shellcheck: OK"
