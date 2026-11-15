# Rules: ApiError の共通化とエラーハンドラの集約

エラーの形、エラーから応答への変換、web での判定、進め方のルールです。出典の `FR`/`NFR` は `requirements.md`、`Q` は `functional-design-questions.md` です。

```yaml
rules:
  - id: BR1.1
    statement: ApiError は status と message を持ち、name は既定の "Error" のままにする
    category: constraint
    applies_to: ApiError
    trigger: ApiError を作るとき
    logic: IF ApiError を作る THEN name を変えない。String(ApiError) の結果は "Error: <message>" になる
    violation: 厨房画面の表示が、現状の "Error: ..." から変わる
    source: FR1.1, FR1.5
  - id: BR1.2
    statement: web は、失敗した応答から ApiError を作る。status は応答の status、detail は応答本文の error、message は「<METHOD> <path> -> <status> <detail>」の前後の空白を除いたもの
    category: calculation
    applies_to: web の API 呼び出し
    trigger: 応答が失敗(成功でない)のとき
    logic: IF 応答が失敗 THEN 本文を読む(読めなければ detail は空) AND ApiError(status, message, detail) を投げる
    violation: 画面に出るエラー文言が現状から変わる
    source: FR1.3, FR1.5, NFR1
  - id: BR1.3
    statement: サーバーの客ルートは、HttpError の代わりに ApiError を投げる。status(400/404/409)とメッセージは現状と同じにする
    category: constraint
    applies_to: 客ルート
    trigger: 入力の検証、売り切れ、注文が無いとき
    logic: IF 現状 HttpError を投げる THEN 同じ status と同じメッセージで ApiError を投げる
    violation: 応答の status や本文が変わる
    source: FR1.2, NFR1
  - id: BR1.4
    statement: 注文の状態遷移のエラー(OrderNotFoundError、InvalidTransitionError)は ApiError の派生にしない
    category: constraint
    applies_to: DomainError
    trigger: 設計と実装の全体
    logic: IF 状態遷移が失敗 THEN 既存の DomainError を投げる。応答への変換は BR2.4 が行う
    violation: 状態遷移の層が HTTP を知ることになる
    source: FR1.6
  - id: BR2.1
    statement: 全体ハンドラは、受けたエラーの status を次の順で決める。ApiError なら ApiError.status、それ以外で statusCode が数値ならその値、どちらも無ければ 500
    category: calculation
    applies_to: 全体ハンドラ
    trigger: ルート処理中にエラーが投げられたとき
    logic: IF DomainError THEN BR2.4 を適用 ELSE IF ApiError THEN status = ApiError.status ELSE IF statusCode が数値 THEN status = statusCode ELSE status = 500
    violation: 4xx のはずの応答が 500 になる、または 500 のはずの応答が 4xx になる
    source: FR2.3, Q1
  - id: BR2.2
    statement: status が 400〜499 のとき、その status と { error: メッセージ } を返す。メッセージが空または未定義のときは "bad request" にする
    category: policy
    applies_to: 全体ハンドラ
    trigger: BR2.1 で決めた status が 400〜499
    logic: IF 400 <= status <= 499 THEN 応答 = status と { error: メッセージ(空なら "bad request") }
    violation: 4xx の応答の本文が変わる
    source: FR2.3, NFR1, Q2
  - id: BR2.3
    statement: status が 400〜499 でないとき、500 と { error: "internal server error" } を返し、エラーをリクエスト付きのログに出す(req.log.error)。詳細は応答に出さない
    category: policy
    applies_to: 全体ハンドラ
    trigger: BR2.1 で決めた status が 400〜499 でない
    logic: IF status が 400〜499 でない THEN ログに出す AND 500 と { error: "internal server error" } を返す
    violation: 内部の詳細が応答に出る、またはログが残らない
    source: FR2.3, NFR1
  - id: BR2.4
    statement: OrderNotFoundError は 404 と { error: "order not found" }、InvalidTransitionError は 409 と { error: "invalid transition: <from> -> <to>" } にする。厨房ルートの try/catch による変換はなくす
    category: policy
    applies_to: 全体ハンドラ、厨房ルート
    trigger: 注文の状態更新で DomainError が投げられたとき
    logic: IF OrderNotFoundError THEN 404 の応答 ELSE IF InvalidTransitionError THEN 409 の応答
    violation: 厨房の更新失敗時の応答が変わる
    source: FR2.4, NFR1
  - id: BR2.5
    statement: 全体ハンドラは app.ts でルートプラグインを登録する前に1つだけ設定し、客・厨房・店長の各プラグインのハンドラは削除する
    category: constraint
    applies_to: app.ts、3つのルートプラグイン
    trigger: アプリの組み立て
    logic: IF 全体ハンドラを設定 THEN 登録済みの子プラグインは、それを引き継ぐ
    violation: プラグインごとにハンドラが残る、または一部のルートが標準の応答に戻る
    source: FR2.1, FR2.2, NFR4
  - id: BR2.6
    statement: 存在しないルートの 404 そのものは、エラーハンドラを通らず Fastify の標準の形式のままにする
    category: constraint
    applies_to: 存在しないルート
    trigger: 存在しないルートへのリクエスト(本文や content-type に問題が無いもの)
    logic: IF ルートが無い THEN 標準の 404 を返す(e2e/e2e.test.ts:251 が固定している)。ただし、ルートの照合の前に起きる本文の解析エラーは BR2.7 に従う
    violation: e2e テストが落ちる
    source: NFR1
  - id: BR2.7
    statement: 存在しないルートに、壊れた JSON の本文や非対応の content-type を送ったときの 4xx は、全体ハンドラが BR2.2 に従って { error: メッセージ } の形で返す。これは意図した動作変更として受け入れる(R-01)
    category: policy
    applies_to: 全体ハンドラ
    trigger: ルートの照合の前に、本文の解析で 4xx(例: 400、415)が起きたとき
    logic: IF 本文の解析エラーが起きる THEN status はそのまま、本文は { error: メッセージ } にする。変更前は Fastify 標準の { statusCode, code, error, message } だった
    violation: 受け入れ済みの変更が、受け入れ済みの形と違う応答になる
    source: FR2.1, FR2.3, NFR1, R-01(Functional Design のレビュー指摘を、利用者が受け入れたもの)
  - id: BR3.1
    statement: 客画面は、ApiError.status で判定する。保存済み注文の復元で 404 なら保存 ID を捨て、注文の確定で 409 なら売り切れの案内を出す。案内には detail から先頭の "sold out: " を除いた文言を使う
    category: policy
    applies_to: 客画面
    trigger: 復元、メニュー取得、注文確定の失敗
    logic: IF ApiError THEN status と detail(空なら message)を使う ELSE status は無し、文言は Error の message(Error でなければ文字列化)
    violation: 客画面の分岐や案内文が変わる
    source: FR1.4, FR1.5
  - id: BR3.2
    statement: 厨房画面は失敗を String(e) で表示し、店長画面は Error なら e.message、それ以外は文字列化したもの(String(e))を表示する。ApiError でも、置き換え前と同じ文字列になる
    category: policy
    applies_to: 厨房画面、店長画面
    trigger: API 呼び出しの失敗
    logic: IF 失敗 THEN 厨房は String(e)、店長は「Error なら e.message、それ以外は String(e)」。店長画面の文言を文字列に埋め込む箇所では、Error でないものを埋め込むと String(e) と同じ結果になるため、1つの関数にまとめられる(MenuPanel.tsx:118 は setError が文字列を取るので String(e) を使っている)
    violation: 画面に出る文言が変わる
    source: FR1.5, NFR1
  - id: BR4.1
    statement: 変更に入る前に npm test を実行し、全テストが通ることと本数を記録する
    category: validation
    applies_to: 進め方
    trigger: Code Generation の最初
    logic: IF 変更前 THEN npm test を実行して記録する。落ちるテストがあれば変更に入らず報告する
    violation: 回帰かどうかの比較ができなくなる
    source: FR3.1, NFR2
  - id: BR4.2
    statement: 現状の動きを固定する web 側のテストを、変更より先に追加し、変更前のコードで通ることを確認する
    category: validation
    applies_to: web のテスト
    trigger: BR4.1 の後、エラー処理の変更の前
    logic: IF 変更前 THEN 客画面の 404/409 の判定、厨房・店長画面の文言の組み立て、api.ts が投げるエラーの message と status をテストする。画面から関数を切り出す場合も、動きを変えずに行う
    violation: 置き換えで動きが変わっても検出できない
    source: FR3.2, Q3
  - id: BR4.3
    statement: e2e/e2e.test.ts を含む既存テストは書き換えない
    category: constraint
    applies_to: 既存テスト
    trigger: 全体
    logic: IF 既存テストが落ちる THEN テストを直さず、実装を直す
    violation: 回帰を隠してしまう
    source: FR3.3, NFR1, NFR2
  - id: BR4.4
    statement: 契約テスト 0b が静的に検査する、書き込み SQL の位置を変えない。変更はエラー処理に限る
    category: constraint
    applies_to: routes/customer、routes/kitchen、routes/manager
    trigger: ルートファイルの編集
    logic: IF ルートを編集 THEN 書き込み SQL を移動・追加しない
    violation: 契約テスト 0b が落ちる
    source: FR3.4
  - id: BR4.5
    statement: web 側のテストは web/test/ に置き、node:test(node --import tsx --test)で動かす。package.json に test:web を追加し、npm test が contracts、units、web の順に実行する。テストは web/src の画面(描画する部分)を読み込まず、api.ts と切り出した関数だけを読み込む
    category: constraint
    applies_to: web のテスト、package.json、型検査
    trigger: web 側のテストを追加するとき
    logic: IF web のテストを書く THEN web/test/ に置く(web/tsconfig.json は src だけを検査し、types が vite/client なので、src に置くと node:test の型が合わない)。web/test/ は、ルートの tsconfig.json の検査対象に加える。api.ts や切り出した関数を読み込んだとき、ルートの tsconfig の型設定で型エラーが出るなら、web/test/ 専用の tsconfig.json を作り、npm run typecheck にその検査を加える。どちらの場合も npm run typecheck は 0 件で終わる
    violation: npm test に web のテストが含まれない、または npm run typecheck が落ちる
    source: FR3.2, NFR2, NFR3, Q3
  - id: BR4.6
    statement: 変更後に、BR2.7 の新しい動きを固定するテストを追加する。存在しないルートに壊れた JSON、および非対応の content-type を送ると、400 と 415 で { error: 文字列 } が返ることを確認する。置き場所は server/test/ 配下の新しいテストファイルで、既存のテストは書き換えない
    category: validation
    applies_to: server のテスト
    trigger: 全体ハンドラを入れた後
    logic: IF 全体ハンドラを入れた THEN 新しいテストファイルを追加する(server/test/*/*.test.ts に一致する場所)。status は変更前と同じで、本文の形だけが変わることを確認する
    violation: 受け入れた動作変更が、テストで固定されない
    source: FR3.2, NFR1, R-01
```

## 要約

| ルール | 内容 | 出典 |
|---|---|---|
| BR1.1〜BR1.4 | `ApiError` の形、web での作り方、サーバーでの置き換え、DomainError との関係 | FR1.1〜FR1.3、FR1.5、FR1.6 |
| BR2.1〜BR2.7 | 全体ハンドラの status の決め方、4xx と 4xx 以外の応答、DomainError の変換、登録の仕方、存在しないルートの 404、本文の解析エラーの形(受け入れ済みの変更) | FR2.1〜FR2.4、NFR1、NFR4 |
| BR3.1、BR3.2 | 客画面の判定、厨房・店長画面の文言 | FR1.4、FR1.5 |
| BR4.1〜BR4.6 | 変更前のテスト、先に固定するテスト、既存テストの扱い、契約テスト 0b、web テストの置き場所と実行方法、受け入れた動作変更を固定するテスト | FR3.1〜FR3.4、NFR2、NFR3 |

## Assumptions & Open Questions

None.
