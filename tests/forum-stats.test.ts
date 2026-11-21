import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { summarizeApplications, statsMessage, type StatsRow } from '../src/lib/telegram-stats';
import { readForumStats } from '../src/lib/server/forum-stats';
import { POST } from '../src/pages/api/telegram/webhook';

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
const now = new Date('2026-11-21T12:00:00Z');
const row = (index: number, overrides: Partial<StatsRow> = {}): StatsRow => ({
  id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
  kind: 'participant',
  status: 'new',
  created_at: '2026-11-21T10:00:00Z',
  name: 'Private applicant name',
  ...overrides,
});
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
test('stats count roles and statuses, excluding only explicitly marked tests', () => {
  const data = [
    row(0),
    row(1, { status: 'approved' }),
    row(2, { status: 'reserve' }),
    row(3, { status: 'rejected' }),
    row(4, { kind: 'speaker', status: 'approved' }),
    row(5, { kind: 'speaker' }),
    row(6, { name: 'ТЕСТ — перевірка' }),
    row(7, { name: 'Test: synthetic' }),
    row(8, { name: 'Тестовський', status: 'approved' }),
  ];
  const stats = summarizeApplications(data, now);
  assert.deepEqual(stats.participants, { total: 5, new: 1, approved: 2, reserve: 1, rejected: 1 });
  assert.deepEqual(stats.speakers, { total: 2, new: 1, approved: 1, reserve: 0, rejected: 0 });
  assert.equal(stats.total, 7);
  assert.equal(stats.excludedTests, 2);
  assert.equal(stats.newTotal, 2);
  assert.equal(stats.reserveTotal, 1);
  assert.ok(!JSON.stringify(stats).includes('Private applicant'));
  const message = statsMessage(stats);
  assert.ok(!message.text.includes('Private applicant'));
  assert.ok(message.text.length <= 4096);
  for (const button of message.reply_markup.inline_keyboard.flat())
    assert.ok(Buffer.byteLength(button.callback_data) <= 64);
});
test('today uses the Kyiv calendar and future timestamps do not inflate recent activity', () => {
  const clock = new Date('2026-11-21T23:30:00Z');
  const stats = summarizeApplications(
    [
      row(0, { created_at: '2026-11-21T22:00:00Z' }),
      row(1, { created_at: '2026-11-21T21:59:59Z' }),
      row(2, { created_at: '2026-11-22T10:00:00Z' }),
      row(3, { created_at: '2026-11-10T10:00:00Z' }),
    ],
    clock,
  );
  assert.equal(stats.submittedToday, 1);
  assert.equal(stats.submittedLast7Days, 2);
  assert.equal(stats.total, 4);
});
test('empty statistics are honest zeroes with queue and refresh buttons', () => {
  const stats = summarizeApplications([], now);
  assert.equal(stats.total, 0);
  const message = statsMessage(stats);
  assert.match(message.text, /Учасники — 0/);
  assert.match(message.text, /Спікери — 0/);
  assert.ok(
    message.reply_markup.inline_keyboard
      .flat()
      .some((button) => button.callback_data === 'stats:refresh'),
  );
});
test('statistics read every database page using a stable ID cursor and no writes', async () => {
  configure();
  const first = Array.from({ length: 500 }, (_, index) => row(index));
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    assert.equal(options?.method, 'GET');
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('limit'), '500');
    assert.equal(url.searchParams.get('order'), 'id.asc');
    assert.ok(!url.searchParams.get('select')?.includes('email'));
    assert.ok(!url.searchParams.get('select')?.includes('phone'));
    calls++;
    if (calls === 1) return reply(first);
    assert.equal(url.searchParams.get('id'), 'gt.' + first.at(-1)!.id);
    return reply([row(500)]);
  };
  const stats = await readForumStats(now);
  assert.equal(stats.total, 501);
  assert.equal(calls, 2);
});
test('stats command sends one aggregate report without applicant names', async () => {
  configure();
  let sent = 0;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('database.invalid'))
      return reply([row(0), row(1, { kind: 'speaker', status: 'approved' })]);
    assert.ok(url.endsWith('/sendMessage'));
    const body = JSON.parse(String(options?.body));
    assert.equal(body.chat_id, '-1001234');
    assert.match(body.text, /Усього заявок: 2/);
    assert.ok(!body.text.includes('Private applicant'));
    sent++;
    return reply({ ok: true, result: { message_id: 1 } });
  };
  const response = await POST(
    context({
      message: { from: { id: 123 }, chat: { id: -1001234 }, text: '/stats@pmu_forum_requests_bot' },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(sent, 1);
});
test('stats commands and refreshes respect both organizer and group access', async () => {
  configure();
  globalThis.fetch = async (input) => {
    assert.ok(String(input).endsWith('/answerCallbackQuery'));
    return reply({ ok: true, result: true });
  };
  for (const message of [
    { from: { id: 999 }, chat: { id: -1001234 }, text: '/stats' },
    { from: { id: 123 }, chat: { id: -1009999 }, text: '/stats' },
  ])
    assert.equal((await POST(context({ message }))).status, 200);
  assert.equal(
    (
      await POST(
        context({
          callback_query: {
            id: 'denied',
            from: { id: 999 },
            data: 'stats:refresh',
            message: { message_id: 1, chat: { id: -1001234 } },
          },
        }),
      )
    ).status,
    200,
  );
});
test('stats refresh edits the existing message and tolerates unchanged content', async () => {
  configure();
  let edits = 0;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('database.invalid')) return reply([]);
    if (url.endsWith('/answerCallbackQuery')) return reply({ ok: true, result: true });
    assert.ok(url.endsWith('/editMessageText'));
    assert.equal(JSON.parse(String(options?.body)).message_id, 42);
    edits++;
    return reply(
      { ok: false, error_code: 400, description: 'Bad Request: message is not modified' },
      400,
    );
  };
  const response = await POST(
    context({
      callback_query: {
        id: 'refresh',
        from: { id: 123 },
        data: 'stats:refresh',
        message: { message_id: 42, chat: { id: -1001234 } },
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(edits, 1);
});
test('database failure does not send a misleading zero report', async () => {
  configure();
  globalThis.fetch = async (input) => {
    assert.ok(String(input).includes('database.invalid'));
    return reply({}, 503);
  };
  const response = await POST(
    context({ message: { from: { id: 123 }, chat: { id: -1001234 }, text: '/stats' } }),
  );
  assert.equal(response.status, 503);
});
