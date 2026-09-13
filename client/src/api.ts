const BASE = '/api';

export async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.json();
}
