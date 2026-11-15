// 型付き fetch。Vite のプロキシ経由で API(/api → API サーバー)を呼ぶ。失敗した応答は ApiError として投げる。
import { ApiError } from '../../../contracts/api-error';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const detail = (payload as { error?: string }).error ?? '';
    throw new ApiError(res.status, `${method} ${path} -> ${res.status} ${detail}`.trim(), detail);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T,>(path: string, body: unknown) => request<T>('PATCH', path, body),
};
