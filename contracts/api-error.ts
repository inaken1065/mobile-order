// 共通のエラー型。サーバー(ルートが投げる)と web(失敗した応答から作る)で同じ型を使う。
// name は既定の "Error" のまま(String(e) が "Error: <message>" になる現状の表示文言を保つため)。
export class ApiError extends Error {
  /** HTTP ステータス */
  status: number;
  /** 応答本文の error(読めなければ空) */
  detail: string;

  constructor(status: number, message: string, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
