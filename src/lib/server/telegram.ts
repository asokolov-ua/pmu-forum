import { env, hasTelegram } from './config';
import { database, getApplication } from './database';
import { keyboard, summary } from '../telegram-format';
export async function telegram<T = unknown>(
  method: string,
  body: Record<string, unknown> | FormData,
): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(
    `https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`,
    {
      method: 'POST',
      headers: multipart ? undefined : { 'Content-Type': 'application/json' },
      body: multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    },
  );
  const result = (await response.json()) as {
    ok: boolean;
    result: T;
    error_code?: number;
    parameters?: { retry_after?: number };
  };
  if (!response.ok || !result.ok)
    throw new Error(`Telegram request failed (${result.error_code ?? response.status})`);
  return result.result;
}
export async function drainNotifications(limit = 2): Promise<void> {
  if (!hasTelegram()) return;
  const jobs = await database<{ id: string; application_id: string }[]>(
    'rpc/claim_forum_notifications',
    { p_limit: limit },
  );
  for (const job of jobs) {
    try {
      const application = await getApplication(job.application_id);
      if (!application) throw new Error('Application unavailable');
      const message = await telegram<{ message_id: number }>('sendMessage', {
        chat_id: env('TELEGRAM_CHAT_ID'),
        text: summary(application),
        reply_markup: keyboard(application),
      });
      await database(
        `forum_notifications?id=eq.${job.id}`,
        {
          delivered_at: new Date().toISOString(),
          locked_until: null,
          telegram_message_id: message.message_id,
        },
        'PATCH',
      );
    } catch {
      await database(
        `forum_notifications?id=eq.${job.id}`,
        { locked_until: null, available_at: new Date(Date.now() + 60000).toISOString() },
        'PATCH',
      );
    }
  }
}
