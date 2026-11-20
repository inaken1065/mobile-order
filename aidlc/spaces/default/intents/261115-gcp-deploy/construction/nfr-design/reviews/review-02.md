## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-16T14:53:09Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/traceability.json > upstream_ids and coverage | The list has no NFR6.1 to NFR6.6, yet observability-design.md and LC7 cite them, so the observability design is not traced at all. It also omits NFR3.7, NFR5.7 to NFR5.9, NFR7.3 to NFR7.6, NFR2.10, NFR2.11, NFR4.5, NFR6.7 and NFR1.7, all of which the upstream tech-stack-decisions.md and the other requirement documents define. The designs use some of them: NFR7.6 appears in security-design.md and NFR5.8 in logical-components.md. | Add every upstream NFR ID, at least NFR6.1 to NFR6.7, with a coverage row each that points to the design section. Where an ID is intentionally left to the infrastructure design stage, record that in the row instead of leaving it out. | Resolved (reviewer) |
| R-02 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > section 1 (systemd unit) | The only concrete unit definition differs from the other designs. It has none of the hardening in security-design.md (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `ReadWritePaths=/mnt/data`). It has no `NODE_OPTIONS=--max-old-space-size=192`, which performance-design.md relies on for the memory budget. It has no `node --version` >= 24 check, which NFR7.1 and security-design.md require. reliability-design.md section 2 also says "ProtectSystem=strict prevents writes outside /mnt/data", but with the unit as written that guarantee does not exist. The `/usr/bin/node` path is not tied to the tarball install location in LC9. Caddy has no ordering dependency on `mobile-order.service`, although the text states a boot order. | Make one unit definition authoritative and include all directives from the other design documents (hardening, `NODE_OPTIONS`, the version check, the node path). Say where LC9 installs node, or symlink it to `/usr/bin/node`. Add the Caddy unit ordering, or remove the claim that the boot order is guaranteed. | Resolved (reviewer) |
| R-03 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > section 3 (deploy.sh flow) | The edge cases of the release switching are not defined. The first deploy has no `prev`, so step 6 cannot roll back. Redeploying the same id makes `prev` equal `current`, so the rollback restores the same broken version. The failed release directory is deleted only after a later success. When the failure comes from the mount assertion, section 2 skips the rollback, which differs from the automatic rollback in NFR3.3. | Define the behavior for no `prev`, `prev` equal to `current`, and cleanup of failed releases. State explicitly that the mount-assertion failure is the one exception to the automatic rollback, and record that as a deliberate deviation from NFR3.3. | Resolved (reviewer) |
| R-04 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/performance-design.md > server shape (esbuild) | The design bundles Fastify and pino to ESM with `--format=esm` but does not mention the `createRequire` banner, the `__dirname` shims, or the handling of pino's transport and worker threads. These are common reasons for "dynamic require of X is not supported". The risk is acknowledged only as a skeleton check. | Name the esbuild settings to try (banner with `createRequire`, externals) so the skeleton check has a concrete fallback. | Resolved (reviewer) |
| R-05 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > Assumptions A1 and the Caddy configuration | The Caddy `root` and `try_files` (SPA fallback, `no-cache` for `index.html`) are not specified. Whether the symlink resolution works without a restart is left to the skeleton. The upstream `127.0.0.1:3000` matches `HOST=127.0.0.1`, so there is no contradiction, but the Caddyfile is not pinned down. | Add a short Caddyfile sketch (root `current/web`, `handle_path /api/*` to `127.0.0.1:3000`, the caching headers) to logical-components.md. | Resolved (reviewer) |
| R-06 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/observability-design.md > 指標(エラー)、reliability-design.md > 2 節・3 節の NFR3.3 の例外 | エラー指標(NFR6.4)と未マウントの検知が、`journalctl -p err` に頼っている。Fastify(pino)と Caddy のログは標準出力に出るため、journald の優先度は既定で info になり、`-p err` には出ない。「故意にエラーを出すと行が見える」という合格基準は、この設計では満たせない可能性が高い。`Assertion failed` も err 以上で記録される保証がなく、deploy.sh が原因をマウントの失敗と判定する根拠が弱い。 | エラーの見方を、実際に出る優先度に合わせて直す(例: アプリのエラー行は `journalctl -u mobile-order` を grep する、または `SyslogLevelPrefix` や `StandardError=` の扱いを決める)。deploy.sh のマウント判定は、`mountpoint -q /mnt/data` を直接実行する形に変える。どの方法でも、ウォーキングスケルトンで故意のエラーとマウント失敗を実際に出して確認する、と書く。 | New |
| R-07 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > 3 節の端の場合の動作(表) | 同じ ID の再デプロイで `releases/<id>` が既にあれば展開をやり直さない、と決めているが、前回の展開が途中で中断した場合の不完全なディレクトリを検出できない。また、「失敗した版のディレクトリをすぐ削除する」は、初回デプロイと同じ ID の再デプロイの場合に、`current` が向いているディレクトリを消して、リンクが切れる読み方ができる。 | 展開は一時ディレクトリに行い、完了後に `mv` で `releases/<id>` にする。失敗した版の削除は「`current` と `prev` のどちらでもないときだけ」と条件を明記する。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > 1 節の `ExecStartPre` と `Restart=always` | Node の版の確認が失敗すると、`StartLimitIntervalSec=0` のため、2 秒おきに失敗を再試行し続け、ジャーナルを埋める。 | Node の版の失敗は再試行しても直らないため、`RestartPreventExitStatus=` で止めるか、失敗時の動作を受け入れたリスクとして記録する。 | New |

> R-01 Reviewer note: traceability.json の upstream_ids と coverage は、上流の NFR1.1〜7.6 の 54 件すべてを含む(上流の文書と突き合わせて確認した)。回す項目は「インフラ設計に回す」と明記されている。

> R-02 Reviewer note: reliability-design.md 1 節に、`AssertPathIsMountPoint=`、ハードニング、`NODE_OPTIONS`、`ExecStartPre`、node のパス(`/usr/local/bin/node`)、Caddy の drop-in による起動順を備えた唯一のユニットがある。security-design.md と performance-design.md の指定とも矛盾しない。

> R-03 Reviewer note: 3 節に 3 つの端の場合の動作の表と、NFR3.3 の意図的な例外が書かれている。ただし下の新規指摘 2 を参照。

> R-04 Reviewer note: performance-design.md に ESM の確認の場所と、`--format=cjs` の代替案(`server.cjs`、`ExecStart` の変更、確認のやり直し)がある。

> R-05 Reviewer note: logical-components.md に、Caddyfile の具体例をインフラ設計で作ると記録されている。

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| manual: NFR ID coverage | 上流 54 件(NFR1.1〜NFR7.6)と traceability.json の ID が完全に一致し、不足と余りがない | R-01 は解消している |
| manual: systemd ユニットの整合 | security-design、performance-design、logical-components が依存する指定が、すべて 1 節のユニットにある | R-02 は解消している |
| manual: 端の場合と例外 | 3 つの端の場合と NFR3.3 の例外が決定されている | 細部の穴は新規指摘 2 のとおり |
| manual: cjs の代替案 | `server.cjs` への切り替えと確認のやり直しが書かれている | R-04 は解消している |

### Summary

前回の指摘 5 件はすべて解消している。残る主な懸念は、`journalctl -p err` が、標準出力に出るアプリのエラーと未マウントの検知を拾えない可能性で、これは Major 1 件のため、READY(Major は 2 件以下)とするが、人間の判断の前に直すのが望ましい。
