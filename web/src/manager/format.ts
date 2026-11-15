export const yen = (n: number): string => `¥${n.toLocaleString('ja-JP')}`;

/** 今日の日付(JST)を YYYY-MM-DD で返す。ブラウザのタイムゾーンに依存しない。 */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD に日数を足す(暦日の計算のみ)。 */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
