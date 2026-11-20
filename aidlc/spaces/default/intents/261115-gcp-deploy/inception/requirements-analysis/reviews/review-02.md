## Review

**Verdict:** READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-11-16T12:30:36Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > FR3.1, FR3.5 vs FR5.2, FR5.3 | 許可元を自分の IP だけ（SSH も同じ）にすると、GitHub Actions のランナーは VM に SSH もできず、デプロイ後のスモークテスト（画面 200、`/api` 応答）も VM の外部 IP に届かない。FR3 と FR5.2/FR5.3 が両立せず、FR5.2 には「ビルド → 配置」の経路（SSH か IAP か gcloud か）も書かれていない。 | デプロイ経路を要件として決める（例: IAP トンネルや OS Login 経由の配置と、VM 内部からのスモークテスト）。FR3 の例外が必要なら、その範囲（送信元とポート）を明記する。FR5.3 はどこからどう実行するかも書く。 | Resolved (reviewer) |
| R-02 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > NFR1, A5 | 「月 5 ドル以内、無料枠に収める」の根拠が不足している。e2-micro の外部 IPv4 アドレスは無料枠の対象外で課金されるのが通常。ネットワーク送信、Cloud Logging、GCS の state バケットも無料枠に収まる前提が書かれていない。無料枠だけで 0 円に収まると読める。 | 外部 IP、送信通信、ログ、state バケットを含む月額の内訳の見込みを要件に入れる。NFR1 を、各項目を合算した上限（5 ドル）で判定できる形にする。 | Resolved (reviewer) |
| R-03 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > NFR5, NFR6 | 「スワップなどを設計で検討する」「詳細は後の段階で決める」は合否を判定できない。NFR6 の「エラーの確認ができる」も確認方法が不明。 | NFR5 は測れる基準にする（例: 通常操作中に OOM kill が 0 回、空きメモリの下限）。NFR6 は確認方法を具体化する（例: `journalctl` でアプリのログを見られる）。 | Resolved (reviewer) |
| R-04 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > FR3.3, FR2.1 | VM を作り直す、または止めて起動し直すと、エフェメラルな外部 IP は変わる。アクセス先 URL が変わることと、IP の扱い（固定するか否か、課金への影響）が要件にない。許可 IP が変わった場合の復旧は FR3.3 にあるが、自分が締め出されたときの復旧は FR3.5 の SSH も同じ IP 制限のため手段がない。 | VM 側の外部 IP の扱い（固定するか）を決める。許可 IP 変更で締め出されたときの復旧手段（IAP やシリアルコンソールなど）を要件にする。 | Resolved (reviewer) |
| R-05 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > FR2.3, FR5.4, FR6.3, FR6.4 | 判定基準が曖昧な箇所がある。FR2.3 は再起動までの許容時間がない。FR5.4 は「ロールバックの手順がある」だけで、実行して成功を確認する基準がない。FR6.3 は「必要ならブランチ」で決まっていない。FR6.4 は「最小の権限」の具体がない。 | 各項目に合否基準を付ける（例: 異常終了後 N 秒以内に再起動、ロールバック後にスモークテストが通る、WIF は `main` ブランチ限定とするか決める、付与ロールを列挙する）。 | Resolved (reviewer) |
| R-06 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > FR1.3, FR5.1, Out of scope | FR1.3 の CI で `terraform validate` を通すには、GCS バックエンドの初期化（または `-backend=false`）が必要で、その扱いが書かれていない。FR5.1 のアプリの型チェックとテストは、「コード生成とビルド＆テストは含まない」というスコープ（`[scope]`）や、既存の CI がない（`.github/` なし）現状との整合の説明がない。 | FR1.3 のバックエンドの扱いを一言で決める。FR5.1 のアプリ側のチェックは、スコープに含めるのか、既存スクリプトを呼ぶだけなのかを明記する。 | Resolved (reviewer) |
| R-07 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > FR2.4, NFR4 | データディスクの `prevent_destroy` は、「ゼロから再構築できる」「同じ手順を 2 回実行しても変わらない」（NFR4）や、全体の `destroy`（学習後の片付け）と衝突する。片付けの手順（課金を止める方法）の要件もない。 | データディスクを意図して消すときの手順（保護の解除と承認）と、学習後に課金を止める片付けの手順を、要件または手順書の項目として加える。 | Resolved (reviewer) |
| R-08 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > FR2.3, FR5.3 | 「`/api` のヘルスチェック相当のエンドポイント」と「`GET /api` 配下の読み取り用エンドポイント 1 つ」が、既存のどのパスか特定されていない。アプリのコードは変更しないため、存在しないパスを指す可能性がある。 | 既存の API から、200 を返すパスを 1 つ選んで名指しする。または、そのパスをインフラ設計の入力として確定する。 | New |
| R-09 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/inception/requirements-analysis/requirements.md > FR5.2, FR4.1 | 画面のビルドとアプリの配置をどこで行うか（ランナーでビルドして IAP 経由で転送するのか、VM 上でビルドするのか）が書かれていない。1 GB の VM でビルドするとメモリが足りなくなるおそれがある（NFR5）。 | ビルドはランナー側で行い、成果物だけを VM に配置する、と範囲を決める。または、設計に回すことを明記する。 | New |

> R-01 Reviewer note: FR3.5 と FR3.6 で 80 番は自分の IP のみ、SSH は IAP の範囲のみに分けた。FR5.2 は WIF と IAP トンネルでデプロイし、FR5.3 のスモークテストは VM 上の localhost で実行する。ランナーが届かない問題は解消した。

> R-02 Reviewer note: 内訳表と外部 IP の比較表を追加した。外部 IPv4 の単価は公式ページで確認できなかったと明記し、未確認の数値として A5 の再確認と承認の取り直しに結びつけている。正直な扱いで、約 3.65 ドルは上限 5 ドルに収まる。

> R-03 Reviewer note: NFR5 は 10 分間の操作で OOM kill が 0 回という合否基準になった。NFR6 は `journalctl -p err` で直近 24 時間分が取り出せることを基準にした。スワップの要否は基準に従って NFR 設計で決める。

> R-04 Reviewer note: エフェメラル IP を推奨し、静的 IP との費用の比較を示した。FR6.5 と FR3.3 で、IP が変わっても IAP 経由で入って許可 IP を更新できる。

> R-05 Reviewer note: FR2.3 は 120 秒と 30 秒、FR5.4 は戻したあとのスモークテスト合格、FR6.3 は repository と ref の両方、FR6.4 は具体的なロール名になった。

> R-06 Reviewer note: FR1.3 は `init -backend=false` を使う。FR5.1 は既存のスクリプトだけを実行し、新規テストの追加と 80% カバレッジを Out of scope に明記した。

> R-07 Reviewer note: FR2.4、FR2.4a、FR2.4b で、通常の再構築、完全削除、課金停止の片付けを別々の手順にした。NFR4 の前提との関係も書いてある。

### Summary

前回の Critical 1 件、Major 3 件、Minor 3 件はすべて解消した。コストの根拠も、未確認の部分を隠さず再確認の条件を付けている。残りは設計で確定できる Minor 2 件だけで、エンジニアリングは質問なしで着手できる。
