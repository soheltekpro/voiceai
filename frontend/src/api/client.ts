import { getToken } from './auth';

export type ApiError = { message: string };

/** When set (e.g. http://127.0.0.1:3000), requests go directly to backend instead of via Vite proxy. */
const API_BASE =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '';

function url(path: string): string {
  if (!API_BASE) return path;
  const base = (API_BASE as string).replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(url(path), { headers: authHeaders() });
  if (!res.ok) {
    const body = await parseJson<ApiError>(res).catch(() => ({ message: res.statusText }));
    throw new Error(body.message || res.statusText);
  }
  return parseJson<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await parseJson<ApiError>(res).catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return parseJson<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await parseJson<ApiError>(res).catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return parseJson<T>(res);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await parseJson<ApiError>(res).catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return parseJson<T>(res);
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(url(path), { method: 'DELETE', headers: authHeaders() });
  if (!res.ok && res.status !== 204) {
    const err = await parseJson<ApiError>(res).catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
}

/** POST with FormData (e.g. file upload). Uses same base URL and auth as other API calls. */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const err = await parseJson<ApiError>(res).catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return parseJson<T>(res);
}

