const BASE = '/api';

export async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  // 仅在有请求体时发送 application/json，避免空 body POST 被服务端拒绝（FST_ERR_CTP_EMPTY_JSON_BODY）
  const headers: Record<string, string> = {};
  if (options?.body !== undefined && options?.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + url, {
    credentials: 'include',
    ...options,
    headers: { ...headers, ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.json();
}
