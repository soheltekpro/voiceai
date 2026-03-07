export type VoiceAIOptions = {
  apiKey: string;
  baseUrl?: string;
};

export type RequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export class VoiceAIHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'VoiceAIHttpError';
    this.status = status;
    this.body = body;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class VoiceAIClient {
  readonly apiKey: string;
  readonly baseUrl: string;

  constructor(opts: VoiceAIOptions) {
    if (!opts.apiKey?.trim()) throw new Error('VoiceAI: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const url = joinUrl(this.baseUrl, path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...(options?.headers ?? {}),
    };

    let fetchBody: BodyInit | undefined;
    if (body !== undefined && body !== null) {
      // Allow multipart/FormData calls by passing BodyInit directly.
      const isBodyInit =
        typeof body === 'string' ||
        body instanceof ArrayBuffer ||
        ArrayBuffer.isView(body) ||
        (typeof FormData !== 'undefined' && body instanceof FormData) ||
        (typeof Blob !== 'undefined' && body instanceof Blob);
      if (isBodyInit) {
        fetchBody = body as any;
      } else {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
        fetchBody = JSON.stringify(body);
      }
    }

    const res = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      signal: options?.signal,
    });

    if (!res.ok) {
      const parsed = await parseJsonSafe(res);
      const message =
        (parsed && typeof parsed === 'object' && 'message' in (parsed as any) && typeof (parsed as any).message === 'string')
          ? (parsed as any).message
          : res.statusText;
      throw new VoiceAIHttpError(res.status, message, parsed);
    }

    const parsed = await parseJsonSafe(res);
    return parsed as T;
  }
}

