import { toast } from './components/Toasts';

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Suppress the error toast (caller handles the failure itself). */
  silent?: boolean;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** Typed fetch wrapper. Non-2xx -> toast (unless silent) + throw ApiError
 * with .status; the backend reports errors as {error} (or {detail}). */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const init: RequestInit = { method: opts.method || 'GET' };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (!opts.silent) toast('Network error: ' + (e instanceof Error ? e.message : String(e)), 'error');
    throw e;
  }
  const raw = await res.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  if (!res.ok) {
    const d = data as { error?: string; detail?: string } | null;
    const msg = (d && (d.error || d.detail)) || res.status + ' ' + res.statusText;
    if (!opts.silent) toast(msg, 'error');
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}
