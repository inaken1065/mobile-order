# Entities: ApiError の共通化とエラーハンドラの集約

この変更で新しいデータは増えません。ここで定義するのは、サーバーと web が共有するエラーの形と、応答の形です。
設計の根拠は `requirements.md`(FR1〜FR3、NFR1〜NFR4)、現状の構成は `code-quality-assessment.md` と `architecture.md` です。

```yaml
entities:
  - name: ApiError
    description: サーバーと web が共有する、HTTP 失敗を表すエラー。サーバーでは 4xx を投げるときに使い、web では失敗した応答を投げるときに使う
    attributes:
      - name: status
        type: integer
        required: true
        constraints: HTTP の status。サーバーが投げるときは 400〜499 のみ。web が作るときは、応答の status をそのまま入れる
      - name: message
        type: text
        required: true
        constraints: 画面と応答に出る文言の元。サーバーでは応答の error にそのまま入る。web では「<METHOD> <path> -> <status> <detail>」の形(前後の空白は除く)
      - name: detail
        type: text
        required: true
        defaults: ""
        constraints: 応答本文の error の文字列。応答に無い、または読めないときは空。web だけが使う(客画面が、status の後ろの文言を取り出すため)
      - name: name
        type: text
        required: true
        allowed_values: ["Error"]
        constraints: 既定のまま変えない。厨房画面が文字列化したときの "Error: ..." という見え方を、現状と同じにするため
    relationships:
      - target: ErrorResponse
        cardinality: "1 ApiError は 0..1 の ErrorResponse になる(サーバー側のみ)"
        direction: ApiError -> ErrorResponse
  - name: ErrorResponse
    description: エラー時に API が返す本文。形は現状から変えない
    attributes:
      - name: error
        type: text
        required: true
        constraints: 空にならない。メッセージが空の 4xx では "bad request"、4xx 以外では "internal server error"
    relationships: []
  - name: DomainError
    description: 注文の状態遷移で起きる業務上のエラー。ApiError の派生にはしない
    attributes:
      - name: kind
        type: text
        required: true
        allowed_values: [OrderNotFoundError, InvalidTransitionError]
      - name: from
        type: text
        required: false
        constraints: InvalidTransitionError のときだけ。遷移前の注文の状態
      - name: to
        type: text
        required: false
        constraints: InvalidTransitionError のときだけ。遷移先の状態
    relationships:
      - target: ErrorResponse
        cardinality: "OrderNotFoundError は 404、InvalidTransitionError は 409 の ErrorResponse になる"
        direction: DomainError -> ErrorResponse
  - name: RawError
    description: 上記以外で、処理中に投げられるエラー(Fastify 自身が返す、壊れた JSON などのエラーや、想定外の例外)
    attributes:
      - name: statusCode
        type: integer
        required: false
        constraints: 持っている場合は、4xx かどうかの判定に使う
      - name: message
        type: text
        required: false
    relationships:
      - target: ErrorResponse
        cardinality: "1 RawError は 1 つの ErrorResponse になる"
        direction: RawError -> ErrorResponse
entity_constraints:
  - ApiError は contracts/ の1か所だけで定義し、サーバーと web の両方がそれを使う
  - DomainError は ApiError の派生にしない
  - ErrorResponse の本文は { error: 文字列 } だけで、他のフィールドは足さない
```

## 要約

- 共有するのは `ApiError` の1つだけで、置き場は `contracts/` です。
- `ApiError.detail` は、要件に書いた `status` と `message` に加えて、設計で足した属性です。客画面が今の `parseApiError` と同じ文言を、正規表現なしで取り出すために必要です(要件 FR1.4、FR1.5、質問 Q1 の回答 A)。
- 応答の本文 `ErrorResponse` は、`{ error: 文字列 }` のままです(NFR1)。

## Assumptions & Open Questions

None.
