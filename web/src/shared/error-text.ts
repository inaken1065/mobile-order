// 画面で使うエラーの判定と文言の組み立て。描画(React)には依存しない純粋な関数だけを置く。

import { ApiError } from '../../../contracts/api-error';

/** 客画面: ApiError から status とメッセージ(detail、空なら message)を取り出す。 */
export function parseCustomerError(e: unknown): { status: number | null; message: string } {
  if (e instanceof ApiError) return { status: e.status, message: e.detail || e.message };
  return { status: null, message: e instanceof Error ? e.message : String(e) };
}

/** 厨房画面: 失敗の文言。 */
export function kitchenErrorText(e: unknown): string {
  return String(e);
}

/** 店長画面: 失敗の文言。 */
export function managerErrorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
