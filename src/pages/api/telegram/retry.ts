import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../lib/server/config';
import { drainNotifications } from '../../../lib/server/telegram';
import { json } from '../../../lib/server/http';
export const prerender = false;
export const GET: APIRoute = async ({ request }) => {
  const expected = `Bearer ${env('CRON_SECRET')}`;
  const actual = request.headers.get('authorization') ?? '';
  if (
    !env('CRON_SECRET') ||
    Buffer.byteLength(expected) !== Buffer.byteLength(actual) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  )
    return json({ ok: false }, 401);
  try {
    await drainNotifications(5);
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
};
