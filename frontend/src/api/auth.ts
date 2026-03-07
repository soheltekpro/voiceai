const AUTH_KEY = 'voiceai_token';
const AUTH_USER = 'voiceai_user';
const AUTH_WORKSPACE = 'voiceai_workspace';

export type AuthUser = { id: string; email: string; workspaceId: string; role: string };
export type AuthWorkspace = { id: string; name: string };

export function getToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem(AUTH_KEY) : null;
}

export function setAuth(token: string, user: AuthUser, workspace: AuthWorkspace): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTH_KEY, token);
  localStorage.setItem(AUTH_USER, JSON.stringify(user));
  localStorage.setItem(AUTH_WORKSPACE, JSON.stringify(workspace));
}

export function clearAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(AUTH_USER);
  localStorage.removeItem(AUTH_WORKSPACE);
}

export function getStoredUser(): AuthUser | null {
  const raw = typeof window !== 'undefined' ? localStorage.getItem(AUTH_USER) : null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function getStoredWorkspace(): AuthWorkspace | null {
  const raw = typeof window !== 'undefined' ? localStorage.getItem(AUTH_WORKSPACE) : null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthWorkspace;
  } catch {
    return null;
  }
}

function authUrl(path: string): string {
  const base = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) as string | undefined;
  if (!base) return path;
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser; workspace: AuthWorkspace }> {
  const res = await fetch(authUrl('/api/v1/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message || 'Login failed');
  }
  const data = (await res.json()) as { token: string; user: AuthUser; workspace: AuthWorkspace };
  return data;
}

export async function register(
  email: string,
  password: string,
  workspaceName: string
): Promise<{ token: string; user: AuthUser; workspace: AuthWorkspace }> {
  const res = await fetch(authUrl('/api/v1/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, workspaceName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message || 'Registration failed');
  }
  const data = (await res.json()) as { token: string; user: AuthUser; workspace: AuthWorkspace };
  return data;
}
