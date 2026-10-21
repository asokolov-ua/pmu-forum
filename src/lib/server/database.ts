import { env } from './config';
import type { Application } from '../validation';

export async function database<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const key = env('SUPABASE_SECRET_KEY');
  const response = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1/${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      apikey: key,
      ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status})`);
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
export async function getApplication(id: string): Promise<Application | undefined> {
  const rows = await database<Application[]>(
    `forum_applications?id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0];
}
