// 日時は ISO 8601 JST 文字列で保存する。日次集計の日付は先頭10文字で判定する。
export function nowJst(d: Date = new Date()): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 19) + '+09:00';
}

export function todayJst(d: Date = new Date()): string {
  return nowJst(d).slice(0, 10);
}
