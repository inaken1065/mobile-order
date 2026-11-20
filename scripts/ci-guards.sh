#!/bin/bash
# CI の構成と秘密情報の検査(ci.yml の secrets ジョブが実行する。ゲート G7〜G10)。
# 使い方: scripts/ci-guards.sh <リポジトリのルート>
# 違反を標準エラーに出して、1 件でもあれば終了コード 1 で終わる。
set -uo pipefail

ROOT="${1:-}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  echo "使い方: ci-guards.sh <リポジトリのルート>" >&2
  exit 2
fi
cd "$ROOT" || exit 2

VIOLATIONS=0
fail() {
  echo "$1" >&2
  VIOLATIONS=$((VIOLATIONS + 1))
}

# コメント行(先頭が # の行)を除いて、パターンに一致する行を "ファイル:行番号:内容" で出す
grep_code() { # $1: 拡張正規表現、残り: ファイル
  local pattern="$1"
  shift
  local f
  for f in "$@"; do
    grep -nE "$pattern" "$f" | grep -Ev '^[0-9]+:[[:space:]]*#' | sed "s|^|$f:|" || true
  done
}

# G7: *.tfvars の追跡(terraform.tfvars.example は許可)
while IFS= read -r f; do
  [ -n "$f" ] && fail "G7: tfvars が追跡されています: $f"
done < <(git ls-files | grep -E '\.tfvars(\.json)?$' || true)

# G8: "type": "service_account" を含む追跡済みの *.json(サービスアカウントキーの混入)
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  if grep -qE '"type"[[:space:]]*:[[:space:]]*"service_account"' "$f"; then
    fail "G8: サービスアカウントキーに見えるファイルが追跡されています: $f"
  fi
done < <(git ls-files '*.json')

# ワークフローのファイル
WORKFLOWS=()
if [ -d .github/workflows ]; then
  while IFS= read -r f; do WORKFLOWS+=("$f"); done < <(find .github/workflows -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)
fi

if [ "${#WORKFLOWS[@]}" -gt 0 ]; then
  # G9: ワークフローの terraform apply(コメントを除く)
  while IFS= read -r line; do
    [ -n "$line" ] && fail "G9: ワークフローに terraform apply があります: $line"
  done < <(grep_code 'terraform[[:space:]]+apply' "${WORKFLOWS[@]}")

  # G9: ci.yml の google-github-actions/auth と id-token(PR の CI は Google Cloud に認証しない)
  if [ -f .github/workflows/ci.yml ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && fail "G9: ci.yml に認証または id-token があります: $line"
    done < <(grep_code 'google-github-actions/auth|id-token' .github/workflows/ci.yml)
  fi

  # G10: uses: がすべて 40 桁の SHA で固定されていること(ローカルのアクションと docker:// は使わない)
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    value="$(printf '%s' "$line" | sed -E 's/^[^:]*:[0-9]+:[[:space:]]*-?[[:space:]]*uses:[[:space:]]*//; s/[[:space:]]+#.*$//; s/^["'\'']//; s/["'\'']$//')"
    if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$'; then
      fail "G10: uses: が 40 桁の SHA で固定されていません: $line"
    fi
  done < <(grep_code '^[[:space:]]*-?[[:space:]]*uses:' "${WORKFLOWS[@]}")
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "ci-guards: ${VIOLATIONS} 件の違反" >&2
  exit 1
fi
echo "ci-guards: 違反なし"
