import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import {
  parseReviewCallback,
  reviewCallback,
  reviewMessage,
  type ReviewRow,
} from '../src/lib/telegram-queue';
import { readReviewPage } from '../src/lib/server/review-queue';
import { POST } from '../src/pages/api/telegram/webhook';
import { participantSteps } from '../src/data/forum';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function configure() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://database.invalid',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '-1001234',
    TELEGRAM_ADMIN_IDS: '123',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
  });
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const rows: ReviewRow[] = Array.from({ length: 8 }, (_, index) => ({
  id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
  kind: 'participant',
  status: 'new',
  created_at: '2026-11-01T10:00:00.000000+00:00',
  fullName: 'Тест ' + (index + 1),
}));
function context(update: unknown): APIContext {
  return {
    request: new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      },
      body: JSON.stringify(update),
    }),
  } as APIContext;
}
function callback(data: string) {
  return context({
    callback_query: {
      id: 'test-callback',
      from: { id: 123 },
      data,
      message: { message_id: 1, chat: { id: -1001234 } },
    },
  });
}
test('queue callbacks round-trip roles, filters and cursor directions within Telegram limits', () => {
  for (const kind of ['participant', 'speaker'] as const)
    for (const filter of ['pending', 'new', 'reserve'] as const)
      for (const direction of [undefined, 'after', 'before'] as const) {
        const request = { kind, filter, ...(direction ? { direction, cursor: rows[0].id } : {}) };
        const value = reviewCallback(request);
        assert.deepEqual(parseReviewCallback(value), request);
        assert.ok(Buffer.byteLength(value) <= 64);
      }
  for (const invalid of [
    'q:x:p',
    'q:p:x',
    'q:p:p:a:invalid',
    'q:p:p:a:' + rows[0].id + ':extra',
    'q:p:p:a',
    null,
  ])
    assert.equal(parseReviewCallback(invalid), undefined);
});
test('first page selects only the chosen role and statuses, oldest first, with a bounded payload', async () => {
  configure();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('kind'), 'eq.participant');
    assert.equal(url.searchParams.get('status'), 'in.(new,reserve)');
    assert.equal(url.searchParams.get('order'), 'created_at.asc,id.asc');
    assert.equal(url.searchParams.get('limit'), '6');
    assert.ok(!url.searchParams.has('offset'));
    return reply(rows.slice(0, 6));
  };
  const page = await readReviewPage({ kind: 'participant', filter: 'pending' });
  assert.equal(page.rows.length, 5);
  assert.equal(page.hasNext, true);
  assert.equal(page.hasPrevious, false);
  const message = reviewMessage(page);
  assert.ok(message.text.length <= 4096);
  for (const row of message.reply_markup.inline_keyboard)
    for (const button of row) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
});
test('cursor pagination keeps the next records even when earlier applications leave the queue', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (++calls === 1) {
      assert.equal(url.searchParams.get('id'), 'eq.' + rows[4].id);
      return reply([{ ...rows[4], status: 'approved' }]);
    }
    assert.equal(url.searchParams.get('status'), 'eq.new');
    assert.ok(url.searchParams.get('or')?.includes('id.gt.' + rows[4].id));
    assert.ok(url.searchParams.get('or')?.includes('created_at.gt.'));
    assert.ok(!url.searchParams.has('offset'));
    return reply(rows.slice(5));
  };
  const page = await readReviewPage({
    kind: 'participant',
    filter: 'new',
    cursor: rows[4].id,
    direction: 'after',
  });
  assert.deepEqual(
    page.rows.map((row) => row.id),
    rows.slice(5).map((row) => row.id),
  );
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, false);
});
test('backward navigation reverses the fetched page into chronological order', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (input) => {
    if (++calls === 1) return reply([rows[7]]);
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('order'), 'created_at.desc,id.desc');
    assert.ok(url.searchParams.get('or')?.includes('id.lt.' + rows[7].id));
    return reply(rows.slice(1, 7).reverse());
  };
  const page = await readReviewPage({
    kind: 'participant',
    filter: 'new',
    cursor: rows[7].id,
    direction: 'before',
  });
  assert.deepEqual(
    page.rows.map((row) => row.id),
    rows.slice(2, 7).map((row) => row.id),
  );
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, true);
});
test('deleted anchors return to the beginning and empty queues retain filter controls', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    const url = new URL(String(input));
    if (calls === 1) return reply([]);
    assert.equal(url.searchParams.get('kind'), 'eq.speaker');
    assert.equal(url.searchParams.get('status'), 'eq.reserve');
    assert.ok(!url.searchParams.has('or'));
    return reply([]);
  };
  const page = await readReviewPage({
    kind: 'speaker',
    filter: 'reserve',
    cursor: rows[0].id,
    direction: 'after',
  });
  assert.equal(calls, 2);
  assert.equal(page.request.cursor, undefined);
  assert.match(reviewMessage(page).text, /заявок немає/);
  assert.equal(reviewMessage(page).reply_markup.inline_keyboard.length, 3);
});
test('pending command sends one queue message without changing any application', async () => {
  configure();
  let sends = 0;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('database.invalid')) {
      assert.equal(options?.method, 'GET');
      return reply(rows.slice(0, 6));
    }
    assert.ok(url.endsWith('/sendMessage'));
    const payload = JSON.parse(String(options?.body));
    assert.match(payload.text, /Черга учасників/);
    assert.equal(payload.chat_id, '-1001234');
    sends++;
    return reply({ ok: true, result: { message_id: 1 } });
  };
  assert.equal(
    (
      await POST(
        context({
          message: {
            from: { id: 123 },
            chat: { id: -1001234 },
            text: '/pending@pmu_forum_requests_bot',
          },
        }),
      )
    ).status,
    200,
  );
  assert.equal(sends, 1);
});
test('queue commands and callbacks do not expose applications to other users or chats', async () => {
  configure();
  globalThis.fetch = async (input) => {
    assert.ok(String(input).endsWith('/answerCallbackQuery'));
    return reply({ ok: true, result: true });
  };
  for (const message of [
    { from: { id: 999 }, chat: { id: -1001234 }, text: '/pending' },
    { from: { id: 123 }, chat: { id: -1009999 }, text: '/pending' },
  ])
    assert.equal((await POST(context({ message }))).status, 200);
  assert.equal(
    (
      await POST(
        context({
          callback_query: {
            id: 'denied',
            from: { id: 999 },
            data: 'q:p:p',
            message: { message_id: 1, chat: { id: -1001234 } },
          },
        }),
      )
    ).status,
    200,
  );
});
test('unchanged queue refreshes finish successfully instead of retrying forever', async () => {
  configure();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('database.invalid')) return reply(rows.slice(0, 3));
    if (url.endsWith('/answerCallbackQuery')) return reply({ ok: true, result: true });
    assert.ok(url.endsWith('/editMessageText'));
    return reply(
      { ok: false, error_code: 400, description: 'Bad Request: message is not modified' },
      400,
    );
  };
  assert.equal((await POST(callback('q:p:n'))).status, 200);
});
test('genuine queue message failures stay retryable', async () => {
  configure();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('database.invalid')) return reply([]);
    if (url.endsWith('/answerCallbackQuery')) return reply({ ok: true, result: true });
    return reply({ ok: false, error_code: 403, description: 'Forbidden' }, 403);
  };
  assert.equal((await POST(callback('q:p:p'))).status, 503);
});
test('complete applications attach decisions only to the final chunk', async () => {
  configure();
  const answers: Record<string, unknown> = {
    privacyConsent: true,
    photoConsent: 'Ні',
    consentVersion: 'test',
  };
  for (const field of participantSteps.flatMap((step) => step.fields))
    answers[field.name] =
      field.type === 'checkbox'
        ? [field.options![0]]
        : field.type === 'textarea'
          ? 'я'.repeat(3000)
          : 'Тест';
  const app = { ...rows[0], answers, status: 'new' };
  const messages: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('database.invalid')) return reply([app]);
    if (url.endsWith('/sendMessage')) messages.push(JSON.parse(String(options?.body)));
    return reply({ ok: true, result: true });
  };
  assert.equal((await POST(callback('view:' + app.id))).status, 200);
  assert.ok(messages.length > 1);
  assert.ok(messages.slice(0, -1).every((message) => !message.reply_markup));
  const markup = messages.at(-1)!.reply_markup as {
    inline_keyboard: { callback_data: string }[][];
  };
  assert.ok(
    markup.inline_keyboard.flat().some((button) => button.callback_data === 'approved:' + app.id),
  );
  assert.ok(markup.inline_keyboard.flat().some((button) => button.callback_data === 'q:p:p'));
});
