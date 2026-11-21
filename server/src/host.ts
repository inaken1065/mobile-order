/** 待ち受けアドレスを決める。HOST が未指定または空文字のときは、従来どおり 0.0.0.0 にする。 */
export function resolveHost(value: string | undefined): string {
  return value || '0.0.0.0';
}
