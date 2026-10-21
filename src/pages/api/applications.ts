import type { APIRoute } from 'astro';
import { createHmac } from 'node:crypto';
import { validateApplication } from '../../lib/validation';
import { env, registrationOpen } from '../../lib/server/config';
import { database } from '../../lib/server/database';
import { json, readJson } from '../../lib/server/http';
import { drainNotifications } from '../../lib/server/telegram';
export const prerender = false;
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!registrationOpen())
    return json({ message: 'Прийом заявок ще не відкрито. Стежте за оновленнями ПМУ.' }, 503);
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    return json({ message: 'Оновіть сторінку й повторіть спробу.' }, 403);
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return json(
      { message: 'Не вдалося прочитати заявку. Перевірте обсяг відповідей і спробуйте ще раз.' },
      400,
    );
  }
  const { data, errors } = validateApplication(body);
  if (!data) return json({ message: 'Перевірте позначені поля.', errors }, 422);
  try {
    // Store only a keyed hash for abuse control; never retain the IP in the application.
    const addressHash = createHmac('sha256', env('RATE_LIMIT_SECRET'))
      .update(clientAddress || 'unknown')
      .digest('hex');
    const allowed = await database<boolean>('rpc/consume_forum_rate_limit', { p_key: addressHash });
    if (!allowed)
      return json({ message: 'Забагато спроб. Зачекайте хвилину та повторіть надсилання.' }, 429);
    const id = await database<string>('rpc/create_forum_application', {
      p_key: data.submissionKey,
      p_kind: data.kind,
      p_email: data.email,
      p_answers: data.answers,
    });
    // The application and outbox entry are committed together before notifying Telegram.
    try {
      await drainNotifications();
    } catch {
      console.warn('Forum notification remains queued for retry.');
    }
    return json({ id }, 201);
  } catch {
    return json(
      {
        message:
          'Зараз не вдалося зберегти заявку. Спробуйте ще раз — повторна спроба не створить дубль.',
      },
      503,
    );
  }
};
