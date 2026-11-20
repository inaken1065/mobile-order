## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-16T14:02:02Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/security-requirements.md > NFR2.3 (and requirements.md FR4.2) | requirements.md の FR4.2 は「Fastify はローカルからの接続だけを受ける」と定めている。しかし既存コード `server/src/index.ts` は `app.listen({ port, host: '0.0.0.0' })` と固定で、環境変数で変えられない。アプリのコードは変更しない制約なので、FR4.2 の前半はアプリ側では満たせない。NFR2.3 はファイアウォールの 3000 番閉鎖だけに頼っており、この食い違いに触れていない。ファイアウォールの設定誤りが 1 つあるだけで、認証のない API が公開される | NFR2.3 に、Fastify が 0.0.0.0 で待ち受ける事実を明記する。多層防御として、VM 内のホストファイアウォール(nftables など)で 3000 番を localhost に限る、または VPC 側で 3000 番を拒否するルールを要件に加える。合否に「VM 外部から 3000 番に接続できない」確認を加える | Resolved (reviewer) |
| R-02 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/reliability-requirements.md > NFR3.6, NFR4.3 | NFR3.6 は「VM の作り直しでもデータを上書きしない」と書くが、合否の試験は「再デプロイ後に注文が残る」だけで、VM の作り直しは試験されない。データディスクが起動時にマウントされない場合の扱いも要件にない。`index.ts` は menu_items が 0 件ならシードするので、マウント失敗のまま起動するとブートディスク上に新しい空の DB が作られ、データを失ったことに気づけない | 「データディスクがマウントされていない場合は、アプリを起動せず失敗にする」要件(例: DB のディレクトリのマウントを起動条件にする)を追加する。NFR3.6 の合否に「VM を作り直し、ディスクを付け直したあとも注文が残る」試験を加える | Resolved (reviewer) |
| R-03 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/tech-stack-decisions.md > NFR7.4 / 受け入れたリスク | 1 つの JS ファイルにまとめる方針は、server/src の import が拡張子なしの相対 import(`./db/db` など)で、`../../../contracts/...` のサーバー外への参照もある点とは矛盾しない。バンドラなら解決できる。ただし `logger: true`(pino)と `node:sqlite` を含むバンドルが動くかは未検証で、NFR5.4 の合否がこれに依存する。リスクと代替案は記録されている | ウォーキングスケルトンで `node server.mjs` の起動と `GET /menu` 200 を最初に確認することを、検証の順序として明記する。`node:` の組み込みモジュールを外部扱いにする指定が必要なことも記す | Resolved (reviewer) |
| R-04 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/performance-requirements.md > NFR5.3 | 「デプロイ中の VM のメモリ使用が、スワップを使い切らない」は、測る方法としきい値が書かれておらず、合否を判定できない | `free -m` の最小値や swap 使用率の上限など、具体的な数値と測定コマンドを書く | Resolved (reviewer) |
| R-05 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/reliability-requirements.md > NFR3.3 | 自動ロールバックには時間の上限がなく、「戻した後に同じスモークテストが合格する」までの所要時間が測れない。FR5.4 にも時間はないが、FR5.3 の 60 秒と対になる基準がない | ロールバック完了までの上限時間(例: 120 秒)を決めるか、決めない理由を記録する | Resolved (reviewer) |
| R-06 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/tech-stack-decisions.md > NFR7.4 行、NFR5.7 行、「受け入れたリスクと確認が必要な点」 | NFR7.4 の「アプリのコードと `package.json` は変えない」と NFR5.7 の「アプリのコードを変えずに」は、同じ文書の NFR7.6(`index.ts` を変更する例外)と食い違っている。また上流の `requirements.md` の Constraints、FR4.1、FR5.1、Out of scope は「アプリのコードは変更しない」のままで、例外の記録がない。後続ステージの担当者が Constraints を根拠に HOST 対応を拒否するおそれがある。 | NFR7.4 と NFR5.7 の文言を「NFR7.6 の例外を除き」に直す。traceability.json か tech-stack-decisions.md に、要件の Constraints に対する人間承認済みの逸脱(NFR7.6)として一行で記録する。 | New |
| R-07 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/tech-stack-decisions.md > 受け入れたリスクと確認が必要な点(バンドルの動作) | 代替案「`node_modules` を最小限だけ VM に置く」は、NFR5.3 の合否(VM に `node_modules` が存在しない)と矛盾する。「動かない場合は、」が重複する誤記もある。 | 代替案を採る場合は NFR5.3 の合否を同時に改訂する旨を書く。重複した文言を直す。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/tech-stack-decisions.md > NFR5.8 と security-requirements.md > NFR2.12 | プロキシの転送先が `localhost:3000` のままである。`HOST=127.0.0.1` で待ち受けると、`localhost` が `::1` に解決されたとき接続できないおそれがある。 | 転送先を `127.0.0.1:3000` と明記する。スモークテストでも同じ宛先で確認する。 | New |
| R-09 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-requirements/reliability-requirements.md > NFR3.8 | `RequiresMountsFor=` は、マウント定義(fstab や mount ユニット)が存在するときだけ効く。定義が欠けた場合はブートディスクの上で起動してしまう。合否も、未マウント状態の作り方が定まっていない。 | `ConditionPathIsMountPoint` などマウント済みの確認を併用すると明記する。合否に「マウント定義がない状態でも起動しない」を加える。 | New |

> R-01 Reviewer note: NFR2.12 で HOST 環境変数(未指定は 0.0.0.0、VM は 127.0.0.1)を追加し、`ss -ltn` と外部から 3000 番に届かないことを合否に入れた。NFR2.3 との二重の防御も明記。プロキシ側の接続先の書き方に小さな残課題あり(新規指摘を参照)。

> R-02 Reviewer note: NFR3.8 でデータディスク未マウント時に起動しない条件を追加し、NFR3.6 に VM 作り直し後の注文保持の試験を追加した。マウント条件の検出方法に小さな残課題あり(新規指摘を参照)。

> R-03 Reviewer note: NFR5.4 とリスク欄で、ウォーキングスケルトンの最初の合格条件、`node:` 組み込みの外部扱い、`logger: true` の確認が入った。

> R-04 Reviewer note: NFR5.3 に、スワップ使用量 512 MB 以下と `available` 最小 100 MB 以上の数値が入った。

> R-05 Reviewer note: NFR3.3 に、ロールバック開始から合格まで 120 秒の上限が入った。

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| sensors(読み取りによる確認) | 手動実行なし | 指示どおり、手動で実行するツールはない。traceability.json の NFR2.12 と NFR3.8 の追加を、各要件文書の ID と照合して整合を確認した。 |

### Summary

人間が要求した R-01 から R-05 は、いずれも成果物の中で解消されている。Critical と Major はなく、残るのは例外(HOST 対応)と上流の Constraints との文言の食い違いなど、小さな整合の問題だけである。
