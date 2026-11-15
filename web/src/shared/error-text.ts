// 画面で使うエラーの判定と文言の組み立て。描画(React)には依存しない純粋な関数だけを置く。

/** 客画面: api.ts のエラー("POST /orders -> 409 sold out: ...")から status とメッセージを取り出す。 */
export function parseCustomerError(e: unknown): { status: number | null; message: string } {
  const text = e instanceof Error ? e.message : String(e);
  const m = text.match(/-> (\d{3}) ?(.*)$/);
  return m ? { status: Number(m[1]), message: m[2] || text } : { status: null, message: text };
}

/** 厨房画面: 失敗の文言。 */
export function kitchenErrorText(e: unknown): string {
  return String(e);
}

/** 店長画面: 失敗の文言。 */
export function managerErrorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
