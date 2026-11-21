/**
 * 待ち受けアドレスを決める。
 * - 未指定: 従来どおり 0.0.0.0
 * - 空文字(空白だけを含む): 設定のミスとみなしてエラーにする(VM では 127.0.0.1 のつもりが 0.0.0.0 で公開されるのを防ぐ)
 */
export function resolveHost(value: string | undefined): string {
  if (value === undefined) return '0.0.0.0';
  if (value.trim() === '') throw new Error('HOST が空です。待ち受けアドレスを指定するか、HOST を未設定にしてください');
  return value;
}
