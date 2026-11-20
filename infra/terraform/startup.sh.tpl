#!/bin/bash
# mobile-order VM の起動スクリプト(冪等。起動のたびに走る)。
# Terraform の templatefile で描画する。シェルの変数展開は波括弧を使わない(Terraform の展開と区別するため)。
set -euo pipefail

NODE_VERSION="${node_version}"
NODE_SHA256="${node_sha256}"
DEPLOYER_UNIQUE_ID="${deployer_unique_id}"
DISK_DEVICE=/dev/disk/by-id/google-mobile-order-data
DATA_MOUNT=/mnt/data
DISK_FAILED=0
INCOMING_FAILED=0

log() { echo "[startup] $*"; }

# ---- パッケージ ----
export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y caddy jq curl ca-certificates xz-utils
fi

# ---- ユーザー ----
if ! id mobile-order >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin mobile-order
fi

# ---- Node.js(固定した版の公式の配布物を、固定した SHA-256 で検証する) ----
NODE_DIR="/opt/node-v$NODE_VERSION"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  TMPDIR_NODE="$(mktemp -d)"
  curl -fsSL --retry 3 -o "$TMPDIR_NODE/node.tar.xz" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  ACTUAL="$(sha256sum "$TMPDIR_NODE/node.tar.xz" | awk '{print $1}')"
  if [ "$ACTUAL" != "$NODE_SHA256" ]; then
    echo "[startup] エラー: Node.js の SHA-256 が一致しません(期待 $NODE_SHA256、実際 $ACTUAL)" >&2
    rm -rf "$TMPDIR_NODE"
    exit 1
  fi
  rm -rf "$NODE_DIR.tmp"
  mkdir -p "$NODE_DIR.tmp"
  tar -xJf "$TMPDIR_NODE/node.tar.xz" -C "$NODE_DIR.tmp" --strip-components=1
  mv "$NODE_DIR.tmp" "$NODE_DIR"
  rm -rf "$TMPDIR_NODE"
fi
ln -sfn "$NODE_DIR/bin/node" /usr/local/bin/node
# 実行前の確認(NFR7.1)
/usr/local/bin/node -e "if (+process.versions.node.split('.')[0] < 24) process.exit(1); require('node:sqlite')"

# ---- データディスク: データがあるディスクを決して初期化しない ----
# 失敗したら mkfs へ進まず、DISK_FAILED を立てて残りの設定を続け、最後に失敗で終了する。
setup_data_disk() {
  local i=0
  while [ ! -e "$DISK_DEVICE" ] && [ "$i" -lt 60 ]; do sleep 1; i=$((i + 1)); done
  if [ ! -e "$DISK_DEVICE" ]; then
    echo "[startup] エラー: $DISK_DEVICE が 60 秒待っても現れません。何もしません" >&2
    return 1
  fi
  local dev fstype rc
  dev="$(readlink -f "$DISK_DEVICE")"
  set +e
  fstype="$(blkid -o value -s TYPE "$dev")"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ] && [ "$fstype" = "ext4" ]; then
    log "既に ext4 があります。mkfs しません"
  elif [ "$rc" -eq 2 ]; then
    # 読み取りに成功し、ファイルシステムも署名もない。署名とパーティションの有無も確かめる
    if [ -n "$(wipefs -n "$dev")" ] || [ "$(lsblk -nr -o TYPE "$dev" | grep -c part || true)" -ne 0 ]; then
      echo "[startup] エラー: $dev に署名またはパーティションがあります。mkfs しません" >&2
      return 1
    fi
    log "空のディスクのため ext4 を作ります"
    mkfs.ext4 -L mobile-order-data "$dev"
  else
    echo "[startup] エラー: blkid の結果が想定外です(終了コード $rc、型 '$fstype')。mkfs しません" >&2
    return 1
  fi
  mkdir -p "$DATA_MOUNT"
  if ! grep -q "^$DISK_DEVICE " /etc/fstab; then
    echo "$DISK_DEVICE $DATA_MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
  fi
  if ! mountpoint -q "$DATA_MOUNT"; then
    if ! mount "$DATA_MOUNT"; then
      echo "[startup] エラー: $DATA_MOUNT のマウントに失敗しました。mkfs はしません" >&2
      return 1
    fi
  fi
  if ! mountpoint -q "$DATA_MOUNT"; then return 1; fi
  chown mobile-order:mobile-order "$DATA_MOUNT"
}
if ! setup_data_disk; then DISK_FAILED=1; fi

# ---- スワップ(1 GB) ----
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
fi
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then swapon /swapfile; fi
if ! grep -q '^/swapfile ' /etc/fstab; then echo "/swapfile none swap sw 0 0" >> /etc/fstab; fi
cat > /etc/sysctl.d/99-mobile-order.conf <<'MO_EOF_SYSCTL'
${sysctl_conf}
MO_EOF_SYSCTL
sysctl -p /etc/sysctl.d/99-mobile-order.conf

# ---- ディレクトリ(root:root 所有。deploy.sh は作らず、無ければ失敗する) ----
mkdir -p /opt/mobile-order/releases /var/lib/mobile-order/work
chown root:root /opt/mobile-order /opt/mobile-order/releases /var/lib/mobile-order /var/lib/mobile-order/work
chmod 0755 /opt/mobile-order /opt/mobile-order/releases /var/lib/mobile-order
chmod 0700 /var/lib/mobile-order/work

# ---- journald ----
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/mobile-order.conf <<'MO_EOF_JOURNALD'
${journald_conf}
MO_EOF_JOURNALD
systemctl restart systemd-journald

# ---- systemd のユニット ----
cat > /etc/systemd/system/mobile-order.service <<'MO_EOF_SERVICE'
${service_unit}
MO_EOF_SERVICE
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/order.conf <<'MO_EOF_DROPIN'
${caddy_dropin}
MO_EOF_DROPIN
systemctl daemon-reload

# ---- Caddy ----
cat > /etc/caddy/Caddyfile <<'MO_EOF_CADDYFILE'
${caddyfile}
MO_EOF_CADDYFILE
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# ---- デプロイスクリプト(root:root、0755) ----
cat > /usr/local/sbin/mobile-order-deploy.new <<'MO_EOF_DEPLOY'
${deploy_script}
MO_EOF_DEPLOY
chown root:root /usr/local/sbin/mobile-order-deploy.new
chmod 0755 /usr/local/sbin/mobile-order-deploy.new
mv -f /usr/local/sbin/mobile-order-deploy.new /usr/local/sbin/mobile-order-deploy

# ---- sudoers(デプロイ用の OS Login ユーザーに、このスクリプトだけを許す) ----
SUDOERS=/etc/sudoers.d/mobile-order-deploy
echo "sa_$DEPLOYER_UNIQUE_ID ALL=(root) NOPASSWD: /usr/local/sbin/mobile-order-deploy" > "$SUDOERS"
chown root:root "$SUDOERS"
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS"; then
  rm -f "$SUDOERS"
  echo "[startup] エラー: sudoers の検査に失敗したため削除しました" >&2
  exit 1
fi

# ---- 受け取り用のディレクトリ(ホームを root 所有にし、デプロイ用ユーザーが incoming を差し替えられないようにする) ----
# deploy.sh は、ホームが root 所有で、incoming がリンクでないことを確認して、成果物を読む。
# ユーザーは、自分の incoming の中には書けるが、ホームの中の incoming を別のものへ置き換えることはできない。
setup_incoming() {
  local entry dh duid dgid
  entry="$(getent passwd "sa_$DEPLOYER_UNIQUE_ID" || true)"
  if [ -z "$entry" ]; then
    echo "[startup] エラー: sa_$DEPLOYER_UNIQUE_ID を解決できません(OS Login の設定を確認してください)" >&2
    return 1
  fi
  duid="$(printf '%s' "$entry" | cut -d: -f3)"
  dgid="$(printf '%s' "$entry" | cut -d: -f4)"
  dh="$(printf '%s' "$entry" | cut -d: -f6)"
  case "$dh" in
    /home/sa_*) ;;
    *) echo "[startup] エラー: ホームの場所が想定外です: $dh" >&2; return 1 ;;
  esac
  if [ -L "$dh" ]; then echo "[startup] エラー: $dh がシンボリックリンクです" >&2; return 1; fi
  mkdir -p "$dh" || return 1
  chown root:root "$dh" || return 1
  chmod 0755 "$dh" || return 1
  if [ -L "$dh/incoming" ] || { [ -e "$dh/incoming" ] && [ ! -d "$dh/incoming" ]; }; then rm -f "$dh/incoming"; fi
  mkdir -p "$dh/incoming" || return 1
  chown "$duid:$dgid" "$dh/incoming" || return 1
  chmod 0700 "$dh/incoming" || return 1
}
if ! setup_incoming; then INCOMING_FAILED=1; fi

# ---- サービスの有効化と起動(admin off のため reload ではなく restart) ----
systemctl enable mobile-order.service caddy.service
systemctl restart caddy.service
if [ "$DISK_FAILED" -eq 0 ] && [ -f /opt/mobile-order/current/server.mjs ]; then
  systemctl start mobile-order.service
fi

if [ "$DISK_FAILED" -ne 0 ]; then
  echo "[startup] データディスクの設定に失敗しました。アプリは起動しません。手順書のマウントの確認に進んでください" >&2
  exit 1
fi
if [ "$INCOMING_FAILED" -ne 0 ]; then
  echo "[startup] 受け取り用のディレクトリの設定に失敗しました。deploy.sh は、ホームの所有者の確認で失敗します。手順書の起動スクリプトの再実行に進んでください" >&2
  exit 1
fi
log "完了"
