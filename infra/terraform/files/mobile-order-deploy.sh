#!/bin/bash
# mobile-order のデプロイスクリプト(VM 上では /usr/local/sbin/mobile-order-deploy)。
# 起動スクリプトが root:root・0755 で配置する。CI からは送らない。
# sudoers が許すのは、このスクリプトのフルパスだけ。引数はリリース ID(40 桁の小文字の 16 進)1 つ。
# 設計: cicd-pipeline.md(deploy.sh の設計)、reliability-design.md 3 節。
#
# 終了コード:
#   0  成功
#   1  デプロイ前の失敗(入力の検査、照合、展開の検査)。current は変えていない
#   3  成功したが、メモリの計測が基準を超えた(ロールバックはしない。ジョブを失敗として知らせる)
#   10 切り替えに失敗し、直前の版へ自動ロールバックして復旧した
#   11 切り替えに失敗し、ロールバックにも失敗した(手動の復旧が必要)
#   12 切り替えに失敗したが、データディスクが未マウントのためロールバックしない(NFR3.3 の意図的な例外)
#   13 切り替えに失敗したが、戻す先がない(初回、または同じ ID の再デプロイ)ためロールバックしない
set -euo pipefail
umask 077

# ---- テスト用の上書き(root 以外のときだけ有効) ----
# sudo は環境変数を引き継がない設定だが、二重に防ぐため、root では MO_TEST_ROOT を拒否する。
ROOT=""
if [ -n "${MO_TEST_ROOT:-}" ]; then
  if [ "$(id -u)" = "0" ]; then
    echo "エラー: root では MO_TEST_ROOT を受け付けません" >&2
    exit 1
  fi
  case "$MO_TEST_ROOT" in
    /*) ROOT="$MO_TEST_ROOT" ;;
    *) echo "エラー: MO_TEST_ROOT は絶対パスで指定してください" >&2; exit 1 ;;
  esac
elif [ "$(id -u)" != "0" ]; then
  echo "エラー: root で実行してください(sudo 経由)" >&2
  exit 1
fi
if [ -z "$ROOT" ]; then
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH
fi

# ---- パスと定数(先頭にまとめる) ----
OPT="$ROOT/opt/mobile-order"
RELEASES="$OPT/releases"
CURRENT="$OPT/current"
STATE_DIR="$ROOT/var/lib/mobile-order"
WORKDIR="$STATE_DIR/work"
LOCKFILE="$STATE_DIR/deploy.lock"
DATA_MOUNT="$ROOT/mnt/data"
SERVICE="mobile-order"
BASE_URL="http://127.0.0.1"
SMOKE_TIMEOUT=60      # 切り替え後のスモークテストの上限(秒。NFR5.5)
ROLLBACK_TIMEOUT=120  # ロールバック開始からのスモークテストの上限(秒。NFR3.3)
POLL_INTERVAL=2
FREE_INTERVAL=5       # free -m の記録の間隔(秒。NFR5.3)
SWAP_MAX_MB=512
AVAIL_MIN_MB=100
if [ -n "$ROOT" ]; then
  # テストのときだけ、待ち時間を短くできる
  SMOKE_TIMEOUT="${MO_SMOKE_TIMEOUT:-$SMOKE_TIMEOUT}"
  ROLLBACK_TIMEOUT="${MO_ROLLBACK_TIMEOUT:-$ROLLBACK_TIMEOUT}"
  POLL_INTERVAL="${MO_POLL_INTERVAL:-$POLL_INTERVAL}"
  FREE_INTERVAL="${MO_FREE_INTERVAL:-$FREE_INTERVAL}"
fi

log() { echo "[deploy] $*"; }
die() { echo "[deploy] エラー: $*" >&2; cleanup_work; exit 1; }

FREE_PID=""
cleanup_work() {
  if [ -n "${ID:-}" ] && [ -d "$WORKDIR/${ID}" ]; then rm -rf "${WORKDIR:?}/${ID}"; fi
}
stop_free_logger() {
  if [ -n "$FREE_PID" ]; then
    kill "$FREE_PID" 2>/dev/null || true
    wait "$FREE_PID" 2>/dev/null || true
    FREE_PID=""
  fi
}
trap stop_free_logger EXIT

chown_root() {
  # テスト(root 以外)では所有者を変えない
  if [ -z "$ROOT" ]; then chown -R root:root "$@"; fi
}

# ---- 入力の検査 ----
if [ "$#" -ne 1 ]; then
  echo "使い方: mobile-order-deploy <リリース ID(40 桁の小文字の 16 進)>" >&2
  exit 1
fi
ID="$1"
if ! printf '%s' "$ID" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "[deploy] エラー: リリース ID が不正です" >&2
  exit 1
fi
if [ -z "${SUDO_USER:-}" ] || ! printf '%s' "$SUDO_USER" | grep -Eq '^[a-z_][a-z0-9_-]*$' || [ "$SUDO_USER" = "root" ]; then
  echo "[deploy] エラー: SUDO_USER が不正です(sudo 経由で、root 以外のユーザーから実行してください)" >&2
  exit 1
fi
if [ -n "$ROOT" ]; then
  USER_HOME="$ROOT/home/$SUDO_USER"
else
  USER_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
fi
case "$USER_HOME" in
  /*) ;;
  *) echo "[deploy] エラー: $SUDO_USER のホームを解決できません" >&2; exit 1 ;;
esac
INCOMING="$USER_HOME/incoming"

# ---- incoming の差し替えへの備え(最初に確認する) ----
# 起動スクリプトが、ホームを root 所有(group と other に書き込み権限なし)にしてある。
# ユーザーは incoming の中には書けても、ホームの中の incoming をリンクなどへ置き換えられない。
# テスト(root 以外)では、所有者の期待値をこのプロセスの uid にする。
EXPECT_UID=0
if [ -n "$ROOT" ]; then EXPECT_UID="$(id -u)"; fi
if [ -L "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then
  echo "[deploy] エラー: $USER_HOME がない、またはシンボリックリンクです" >&2; exit 1
fi
HOME_STAT="$(stat -c '%u %a' "$USER_HOME")"
HOME_UID="${HOME_STAT%% *}"
HOME_MODE="${HOME_STAT##* }"
if [ "$HOME_UID" != "$EXPECT_UID" ]; then
  echo "[deploy] エラー: $USER_HOME が root 所有ではありません(uid $HOME_UID)。起動スクリプトを再実行してください" >&2; exit 1
fi
if [ $((8#$HOME_MODE & 8#022)) -ne 0 ]; then
  echo "[deploy] エラー: $USER_HOME に group または other の書き込み権限があります(モード $HOME_MODE)。起動スクリプトを再実行してください" >&2; exit 1
fi
if [ -L "$INCOMING" ] || [ ! -d "$INCOMING" ]; then
  echo "[deploy] エラー: $INCOMING がない、またはシンボリックリンクです" >&2; exit 1
fi
SRC_TAR="$INCOMING/$ID.tar.gz"
SRC_SUM="$INCOMING/$ID.sha256"

# 作成の責任は起動スクリプトにある。無ければ失敗する。
for d in "$OPT" "$RELEASES" "$STATE_DIR" "$WORKDIR"; do
  [ -d "$d" ] || { echo "[deploy] エラー: $d がありません(起動スクリプトの実行を確認してください)" >&2; exit 1; }
done

exec 9>"$LOCKFILE"
flock -n 9 || { echo "[deploy] エラー: 別のデプロイが実行中です" >&2; exit 1; }

log "開始: リリース ID $ID"

# ---- メモリの記録(デプロイの開始から完了まで) ----
FREE_LOG="$WORKDIR/free-$ID.log"
: > "$FREE_LOG"
(
  while :; do
    free -m >> "$FREE_LOG" 2>/dev/null || true
    sleep "$FREE_INTERVAL"
  done
) &
FREE_PID=$!

# ---- 古い作業ファイルの削除 ----
find "$RELEASES" -mindepth 1 -maxdepth 1 -name '.tmp-*' -exec rm -rf {} + 2>/dev/null || true
find "$WORKDIR" -mindepth 1 -maxdepth 1 ! -name "free-$ID.log" -exec rm -rf {} + 2>/dev/null || true

# ---- 成果物を root 所有の作業ディレクトリへコピーし、コピーに対して照合する ----
# 検査と配置の間に、ユーザーが incoming のファイルをシンボリックリンクへ差し替えても読み込まれないよう、
# 「検査してからコピー」ではなく「リンクをたどらずにコピーしてから、root 所有のコピーを検査」する。
if [ -L "$INCOMING" ] || [ ! -d "$INCOMING" ]; then die "$INCOMING がない、またはシンボリックリンクです"; fi
WORK="$WORKDIR/$ID"
mkdir -m 0700 "$WORK"
# incoming 自体の差し替えは、ホームが root 所有であること(上で確認)で防ぐ。FIFO で cp が止まらないよう timeout を付ける。
timeout 60 cp -P --no-preserve=all -- "$SRC_TAR" "$WORK/artifact.tar.gz" 2>"$WORK/cp-err.txt" || die "$SRC_TAR をコピーできません: $(head -c 300 "$WORK/cp-err.txt")"
timeout 60 cp -P --no-preserve=all -- "$SRC_SUM" "$WORK/artifact.sha256" 2>"$WORK/cp-err.txt" || die "$SRC_SUM をコピーできません: $(head -c 300 "$WORK/cp-err.txt")"
for f in "$WORK/artifact.tar.gz" "$WORK/artifact.sha256"; do
  if [ -L "$f" ] || [ ! -f "$f" ]; then die "incoming の成果物が通常のファイルではありません(シンボリックリンクなど)"; fi
  chmod 0600 "$f"
done

EXPECTED="$(head -n 1 "$WORK/artifact.sha256" | awk '{print $1}')"
if ! printf '%s' "$EXPECTED" | grep -Eq '^[0-9a-f]{64}$'; then die ".sha256 の形式が不正です"; fi
ACTUAL="$(sha256sum "$WORK/artifact.tar.gz" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then die "SHA-256 が一致しません(期待 $EXPECTED、実際 $ACTUAL)"; fi
log "SHA-256 の照合に成功"

# ---- 展開(既にあれば展開しない) ----
NEW="$RELEASES/$ID"
if [ -d "$NEW" ]; then
  log "releases/$ID は既にあるため、展開しません"
else
  # (a) 種別: 通常ファイルとディレクトリ以外(シンボリックリンク、ハードリンク、デバイス、FIFO)は失敗
  if ! tar -tzvf "$WORK/artifact.tar.gz" > "$WORK/list-verbose.txt" 2>"$WORK/tar-err.txt"; then die "tar の一覧を取得できません"; fi
  if ! tar -tzf "$WORK/artifact.tar.gz" > "$WORK/list-names.txt" 2>>"$WORK/tar-err.txt"; then die "tar の一覧を取得できません"; fi
  if [ ! -s "$WORK/list-names.txt" ]; then die "tar が空です"; fi
  if [ "$(cut -c1 "$WORK/list-verbose.txt" | grep -Evc '^[-d]$')" -ne 0 ]; then
    die "tar に通常ファイルとディレクトリ以外(シンボリックリンクなど)が含まれています"
  fi
  # (b) 絶対パスと .. は失敗、(c) 最上位は server.mjs、schema.sql、web/ だけ
  #     (schema.sql: アプリが起動時に server.mjs と同じ場所から読む。バンドルに含められないため同梱する)
  if grep -Eq '^/' "$WORK/list-names.txt"; then die "tar に絶対パスが含まれています"; fi
  if grep -Eq '(^|/)\.\.(/|$)' "$WORK/list-names.txt"; then die "tar に .. が含まれています"; fi
  # tar -t は制御文字を \001 や \n の形に変えて表示するため、cntrl の検査だけでは見逃す。バックスラッシュも拒否する。
  if LC_ALL=C grep -q '[[:cntrl:]\\]' "$WORK/list-names.txt"; then die "tar に制御文字またはバックスラッシュを含む名前があります"; fi
  if grep -Evq '^(server\.mjs|schema\.sql|web(/.*)?)$' "$WORK/list-names.txt"; then
    die "tar の最上位が server.mjs、schema.sql、web/ 以外です"
  fi
  TMP="$RELEASES/.tmp-$ID"
  mkdir -m 0700 "$TMP"
  tar -xzf "$WORK/artifact.tar.gz" -C "$TMP" --no-same-owner --no-same-permissions --no-overwrite-dir \
    || { rm -rf "$TMP"; die "tar の展開に失敗しました"; }
  # 展開後の再検査
  if [ -n "$(find "$TMP" ! -type f ! -type d -print -quit)" ]; then rm -rf "$TMP"; die "展開結果に通常ファイルとディレクトリ以外があります"; fi
  if [ -n "$(find "$TMP" -type f -links +1 -print -quit)" ]; then rm -rf "$TMP"; die "展開結果にハードリンクがあります"; fi
  if [ ! -f "$TMP/server.mjs" ] || [ ! -f "$TMP/schema.sql" ] || [ ! -f "$TMP/web/index.html" ]; then rm -rf "$TMP"; die "server.mjs、schema.sql、web/index.html のいずれかがありません"; fi
  # 所有者と権限の正規化(setuid などを残さない)
  chown_root "$TMP"
  find "$TMP" -type d -exec chmod 0755 {} +
  find "$TMP" -type f -exec chmod 0644 {} +
  mv "$TMP" "$NEW"
  log "展開して releases/$ID に配置しました"
fi

# ---- 切り替えとスモークテスト ----
PREV=""
if [ -L "$CURRENT" ]; then PREV="$(readlink "$CURRENT")"; fi
SMOKE_LOG="$WORK/smoke.txt"

point_current() { # $1: リリースのディレクトリ
  ln -sfn "$1" "$CURRENT.new" && mv -Tf "$CURRENT.new" "$CURRENT"
}

# 60 秒などの上限内に、GET /(200)と GET /api/menu(200 と { items } の JSON)が通ること
smoke() { # $1: 上限(秒)
  local limit="$1" start="$SECONDS" code body
  : > "$SMOKE_LOG"
  while :; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/" 2>>"$SMOKE_LOG" || true)"
    echo "GET / -> ${code:-?}" >> "$SMOKE_LOG"
    if [ "$code" = "200" ]; then
      code="$(curl -s -o "$WORK/menu.json" -w '%{http_code}' --max-time 5 "$BASE_URL/api/menu" 2>>"$SMOKE_LOG" || true)"
      echo "GET /api/menu -> ${code:-?}" >> "$SMOKE_LOG"
      if [ "$code" = "200" ]; then
        body="$(cat "$WORK/menu.json" 2>/dev/null || true)"
        if printf '%s' "$body" | grep -Eq '^[[:space:]]*\{.*"items"[[:space:]]*:[[:space:]]*\['; then
          echo "スモークテスト合格(${SECONDS}s 時点)" >> "$SMOKE_LOG"
          return 0
        fi
        echo "GET /api/menu の本文に items がありません" >> "$SMOKE_LOG"
      fi
    fi
    if [ $((SECONDS - start)) -ge "$limit" ]; then return 1; fi
    sleep "$POLL_INTERVAL"
  done
}

switch_and_smoke() {
  point_current "$NEW" || return 1
  systemctl restart "$SERVICE" || return 1
  smoke "$SMOKE_TIMEOUT"
}

evaluate_memory() {
  stop_free_logger
  free -m >> "$FREE_LOG" 2>/dev/null || true
  local swap_max avail_min
  swap_max="$(awk '/^Swap:/ { if ($3 > m) m = $3 } END { print m + 0 }' "$FREE_LOG")"
  avail_min="$(awk '/^Mem:/ { if (min == "" || $7 < min) min = $7 } END { print min + 0 }' "$FREE_LOG")"
  log "メモリの計測: スワップの最大 ${swap_max} MB(基準 ${SWAP_MAX_MB} MB 以下)、available の最小 ${avail_min} MB(基準 ${AVAIL_MIN_MB} MB 以上)"
  if [ "$swap_max" -gt "$SWAP_MAX_MB" ] || [ "$avail_min" -lt "$AVAIL_MIN_MB" ]; then
    echo "[deploy] 警告: メモリの計測が基準を超えました。アプリは正常なためロールバックしません。スワップの大きさを見直してください" >&2
    return 1
  fi
  return 0
}

if switch_and_smoke; then
  log "スモークテスト合格"
  cat "$SMOKE_LOG"
  # 現在の版と直前の 1 世代だけ残す
  KEEP_PREV="$(basename "${PREV:-$ID}")"
  for d in "$RELEASES"/*; do
    [ -d "$d" ] || continue
    b="$(basename "$d")"
    if [ "$b" != "$ID" ] && [ "$b" != "$KEEP_PREV" ]; then rm -rf "$d"; fi
  done
  rm -f "$SRC_TAR" "$SRC_SUM"
  rc=0
  if ! evaluate_memory; then rc=3; fi
  cleanup_work
  rm -f "$FREE_LOG"
  if [ "$rc" -eq 0 ]; then log "成功: $ID"; else log "成功(メモリの計測は基準超過): $ID"; fi
  exit "$rc"
fi

# ---- 失敗 ----
echo "[deploy] 切り替え後のスモークテストが不合格でした" >&2
echo "[deploy] 失敗した版の server.mjs の SHA-256: $(sha256sum "$NEW/server.mjs" 2>/dev/null | awk '{print $1}')" >&2
echo "---- スモークテストの出力 ----" >&2
cat "$SMOKE_LOG" >&2 || true
evaluate_memory || true

# まず、データディスクが未マウントか(ログの優先度には頼らず、直接確認する)
if ! mountpoint -q "$DATA_MOUNT"; then
  echo "[deploy] データディスク $DATA_MOUNT が未マウントです。current を戻しても直らないため、ロールバックしません(NFR3.3 の意図的な例外)。手順書のマウントの確認に進んでください" >&2
  cleanup_work
  exit 12
fi

if [ -z "$PREV" ]; then
  echo "[deploy] 戻す先がない(初回のデプロイ)ため、ロールバックしません。手動の復旧手順で扱ってください" >&2
  cleanup_work
  exit 13
fi
if [ "$PREV" = "$NEW" ]; then
  echo "[deploy] 同じリリース ID の再デプロイのため、ロールバックしません" >&2
  cleanup_work
  exit 13
fi

log "直前の版($PREV)へロールバックします"
RB_START="$SECONDS"
rb_ok=1
point_current "$PREV" || rb_ok=0
if [ "$rb_ok" -eq 1 ]; then systemctl restart "$SERVICE" || rb_ok=0; fi
if [ "$rb_ok" -eq 1 ]; then
  # ロールバックの開始から ROLLBACK_TIMEOUT 秒以内に合格すること
  smoke "$ROLLBACK_TIMEOUT" || rb_ok=0
fi
RB_ELAPSED=$((SECONDS - RB_START))
if [ "$rb_ok" -eq 1 ] && [ "$RB_ELAPSED" -gt "$ROLLBACK_TIMEOUT" ]; then rb_ok=0; fi

if [ "$rb_ok" -ne 1 ]; then
  echo "[deploy] ロールバックにも失敗しました(${RB_ELAPSED}s)。手動の復旧手順で戻してください" >&2
  cat "$SMOKE_LOG" >&2 || true
  cleanup_work
  exit 11
fi

log "ロールバックに成功しました(${RB_ELAPSED}s)"
# 失敗した版は、current でも prev でもない場合だけ削除する
if [ "$NEW" != "$PREV" ] && [ "$(readlink "$CURRENT")" != "$NEW" ]; then rm -rf "$NEW"; fi
rm -f "$SRC_TAR" "$SRC_SUM"
cleanup_work
exit 10
