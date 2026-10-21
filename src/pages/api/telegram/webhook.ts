import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { env, isAdmin } from '../../../lib/server/config';
import { database, getApplication } from '../../../lib/server/database';
import { telegram, answerCallbackQuery, drainNotifications } from '../../../lib/server/telegram';
import { json, readJson } from '../../../lib/server/http';
import { summary, keyboard, details, parseCallback, exportCsv } from '../../../lib/telegram-format';
import type { Application } from '../../../lib/validation';
export const prerender = false;
type TelegramUpdate = {
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
  message?: { text?: string; chat: { id: number }; from?: { id: number } };
};
export const POST: APIRoute = async ({ request }) => {
  const expected = env('TELEGRAM_WEBHOOK_SECRET');
  const actual = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (
    !expected ||
    Buffer.byteLength(expected) !== Buffer.byteLength(actual) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  )
    return json({ ok: false }, 401);
  let update: TelegramUpdate;
  try {
    update = (await readJson(request)) as TelegramUpdate;
  } catch {
    return json({ ok: false }, 400);
  }
  const query = update?.callback_query;
  try {
    if (query) {
      const allowedOrganizer = isAdmin(query.from?.id);
      const chatId = String(query.message?.chat?.id ?? '');
      if (!allowedOrganizer || chatId !== env('TELEGRAM_CHAT_ID')) {
        await answerCallbackQuery({
          callback_query_id: query.id,
          text: !allowedOrganizer
            ? `Ваш Telegram ID: ${query.from?.id ?? 'невідомий'}. Доступ не налаштований. Додайте його у TELEGRAM_ADMIN_IDS для Production і зробіть Redeploy.`
            : `ID цього чату: ${chatId || 'невідомий'}. Він не збігається з TELEGRAM_CHAT_ID. Перевірте значення у Production та зробіть Redeploy.`,
          show_alert: true,
        });
        return json({ ok: true });
      }
      const action = parseCallback(query.data);
      if (!action) return json({ ok: true });
      if (action.action === 'view') {
        const app = await getApplication(action.id);
        await answerCallbackQuery({
          callback_query_id: query.id,
          text: app ? 'Надсилаємо анкету.' : 'Заявку не знайдено.',
        });
        if (app)
          for (const text of details(app))
            await telegram('sendMessage', { chat_id: env('TELEGRAM_CHAT_ID'), text });
      } else {
        await database('rpc/update_forum_status', {
          p_id: action.id,
          p_status: action.action,
          p_actor: String(query.from.id),
          p_action_id: query.id,
        });
        const app = await getApplication(action.id);
        await answerCallbackQuery({
          callback_query_id: query.id,
          text: 'Статус збережено.',
        });
        if (app) {
          try {
            await telegram('editMessageText', {
              chat_id: env('TELEGRAM_CHAT_ID'),
              message_id: query.message!.message_id,
              text: summary(app),
              reply_markup: keyboard(app),
            });
          } catch {
            /* A repeated callback may already have applied the same message text. */
          }
        }
      }
    } else if (update?.message) {
      const message = update.message;
      if (!isAdmin(message.from?.id) || String(message.chat?.id) !== env('TELEGRAM_CHAT_ID'))
        return json({ ok: true });
      const command = message.text?.split(/\s/)[0]?.split('@')[0];
      if (command === '/export_participants' || command === '/export_speakers') {
        const kind = command === '/export_speakers' ? 'speaker' : 'participant';
        const apps: Application[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await database<Application[]>(
            `forum_applications?kind=eq.${kind}&order=created_at.asc,id.asc&limit=500&offset=${offset}`,
          );
          apps.push(...page);
          if (page.length < 500) break;
        }
        const document = new FormData();
        document.set('chat_id', env('TELEGRAM_CHAT_ID'));
        document.set(
          'document',
          new Blob([exportCsv(apps, kind)], { type: 'text/csv;charset=utf-8' }),
          `${kind === 'speaker' ? 'speakers' : 'participants'}-2026.csv`,
        );
        document.set('caption', `Експорт заявок: ${apps.length}`);
        await telegram('sendDocument', document);
      } else if (command === '/retry') {
        await drainNotifications(5);
        await telegram('sendMessage', {
          chat_id: env('TELEGRAM_CHAT_ID'),
          text: 'Повторне надсилання черги виконано. Нові записи перевіряються також під час подання заявок.',
        });
      } else if (command === '/help' || command === '/start') {
        await telegram('sendMessage', {
          chat_id: env('TELEGRAM_CHAT_ID'),
          text: 'Форум національної ідентичності\n\nКеруйте заявками кнопками під повідомленнями.\n/export_participants — анкети учасників CSV\n/export_speakers — анкети спікерів CSV\n/retry — повторити сповіщення з черги\n\nСтатуси внутрішні. Повідомлення заявникам автоматично не надсилаються.',
        });
      }
    }
    return json({ ok: true });
  } catch {
    // Do not log applicant data, Telegram tokens or database responses.
    console.warn('Forum Telegram update failed; Telegram may retry the update.');
    return json({ ok: false }, 503);
  }
};
