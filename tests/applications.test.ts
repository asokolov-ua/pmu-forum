import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { participantSteps, speakerSteps } from '../src/data/forum';
import { validateApplication, type Application } from '../src/lib/validation';
import { csvValue, details, exportCsv, keyboard, parseCallback } from '../src/lib/telegram-format';
import { POST as submitApplication } from '../src/pages/api/applications';
import { POST as telegramWebhook } from '../src/pages/api/telegram/webhook';
import { GET as retry } from '../src/pages/api/telegram/retry';
import { readJson } from '../src/lib/server/http';
import { database } from '../src/lib/server/database';

const id = 'adef0328-9315-4c11-a4b2-96dc7e549310';
function fixture(kind: 'participant' | 'speaker' = 'participant'): Record<string, unknown> {
  const result: Record<string, unknown> = {
    kind,
    submissionKey: id,
    website: '',
    privacyConsent: 'yes',
    photoConsent: 'Ні',
  };
  for (const field of (kind === 'speaker' ? speakerSteps : participantSteps).flatMap(
    (s) => s.fields,
  ))
    result[field.name] =
      field.type === 'checkbox'
        ? [field.options![0]]
        : field.type === 'radio'
          ? field.options![0]
          : field.type === 'email'
            ? 'TEST@example.org'
            : field.type === 'tel'
              ? '+380 99 123 45 67'
              : 'Тестова відповідь';
  return result;
}
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function configure() {
  Object.assign(process.env, {
    REGISTRATION_OPEN: 'true',
    SUPABASE_URL: 'https://database.invalid',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '-1001234',
    TELEGRAM_ADMIN_IDS: '123,456',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    RATE_LIMIT_SECRET: 'test-rate-secret',
  });
}
function context(body: unknown, origin = 'http://localhost:4322') {
  return {
    request: new Request('http://localhost:4322/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    }),
    clientAddress: '127.0.0.1',
  } as APIContext;
}
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('validates both forms, preserves a negative photo choice, normalizes email and strips extra data', () => {
  for (const kind of ['participant', 'speaker'] as const) {
    const result = validateApplication({ ...fixture(kind), admin: true });
    assert.deepEqual(result.errors, {});
    assert.equal(result.data?.email, 'test@example.org');
    assert.equal(result.data?.answers.photoConsent, 'Ні');
    assert.equal(result.data?.answers.admin, undefined);
  }
});
test('rejects applicants below 16 and malformed single-choice answers', () => {
  assert.ok(validateApplication({ ...fixture(), age: '14–17 років' }).errors.age);
  assert.ok(
    validateApplication({ ...fixture('speaker'), format: ['Лекція / виступ', 'Виставка'] }).errors
      .format,
  );
  assert.ok(validateApplication({ ...fixture('speaker'), format: 'Куток безпеки' }).errors.format);
});
test('checks required consent, thematic choices, email and field length on the server', () => {
  const errors = validateApplication({
    ...fixture(),
    privacyConsent: false,
    email: 'invalid',
    interests: [],
    motivation: 'x'.repeat(3001),
    photoConsent: '',
  }).errors;
  for (const key of ['privacyConsent', 'email', 'interests', 'motivation', 'photoConsent'])
    assert.ok(errors[key]);
  assert.ok(validateApplication({ ...fixture(), interests: ['unknown'] }).errors.interests);
  assert.ok(validateApplication({ ...fixture(), website: 'https://spam.invalid' }).errors.form);
});
test('closed registration returns 503 without sending data anywhere', async () => {
  process.env.REGISTRATION_OPEN = 'false';
  globalThis.fetch = async () => assert.fail('No external request expected');
  assert.equal((await submitApplication(context(fixture()))).status, 503);
});
test('submission requires same-origin and valid answers before database access', async () => {
  configure();
  globalThis.fetch = async () => assert.fail('No external request expected');
  assert.equal(
    (await submitApplication(context(fixture(), 'https://attacker.invalid'))).status,
    403,
  );
  assert.equal((await submitApplication(context({ ...fixture(), email: '' }))).status, 422);
});
test('only acknowledges saved applications and keeps the notification queued on Telegram failure', async () => {
  configure();
  const calls: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('consume_forum_rate_limit')) return reply(true);
    if (url.includes('create_forum_application')) {
      assert.equal(JSON.parse(String(options?.body)).p_key, id);
      return reply(id);
    }
    if (url.includes('claim_forum_notifications')) return reply([{ id, application_id: id }]);
    if (url.includes('forum_applications?'))
      return reply([
        {
          id,
          kind: 'participant',
          answers: validateApplication(fixture()).data!.answers,
          status: 'new',
        },
      ]);
    if (url.includes('api.telegram.org')) return reply({ ok: false, error_code: 503 }, 503);
    if (url.includes('forum_notifications?')) {
      assert.equal(options?.method, 'PATCH');
      assert.ok(JSON.parse(String(options?.body)).available_at);
      return reply([]);
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const response = await submitApplication(context(fixture()));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, id);
  assert.ok(
    calls.findIndex((c) => c.includes('create_forum_application')) <
      calls.findIndex((c) => c.includes('api.telegram.org')),
  );
  assert.ok(calls.some((c) => c.includes('forum_notifications?')));
});
test('rate limit and failed database writes never report success', async () => {
  configure();
  globalThis.fetch = async () => reply(false);
  assert.equal((await submitApplication(context(fixture()))).status, 429);
  globalThis.fetch = async (input) =>
    String(input).includes('consume_forum_rate_limit') ? reply(true) : reply({}, 500);
  assert.equal((await submitApplication(context(fixture()))).status, 503);
});
test('webhook rejects forged requests and does not allow unauthorized organizer actions', async () => {
  configure();
  let databaseTouched = false;
  globalThis.fetch = async (input) => {
    if (String(input).includes('database.invalid')) databaseTouched = true;
    return reply({ ok: true, result: true });
  };
  const request = (secret: string) =>
    ({
      request: new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: JSON.stringify({
          callback_query: {
            id: 'callback',
            from: { id: 999 },
            data: `approved:${id}`,
            message: { message_id: 1, chat: { id: -1001234 } },
          },
        }),
      }),
    }) as APIContext;
  assert.equal((await telegramWebhook(request('wrong'))).status, 401);
  assert.equal((await telegramWebhook(request('test-secret'))).status, 200);
  assert.equal(databaseTouched, false);
});
test('authorized decisions update storage and refresh the Telegram message', async () => {
  configure();
  const calls: string[] = [];
  const app = {
    id,
    kind: 'participant',
    answers: validateApplication(fixture()).data!.answers,
    status: 'approved',
    reviewed_by: '123',
  };
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('update_forum_status')) {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.p_actor, '123');
      assert.equal(body.p_status, 'approved');
      return reply(null);
    }
    if (url.includes('forum_applications?')) return reply([app]);
    if (url.includes('editMessageText'))
      assert.match(JSON.parse(String(options?.body)).text, /Схвалено/);
    return reply({ ok: true, result: true });
  };
  const response = await telegramWebhook({
    request: new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      },
      body: JSON.stringify({
        callback_query: {
          id: 'callback',
          from: { id: 123 },
          data: `approved:${id}`,
          message: { message_id: 1, chat: { id: -1001234 } },
        },
      }),
    }),
  } as APIContext);
  assert.equal(response.status, 200);
  assert.ok(calls.some((c) => c.includes('editMessageText')));
});
test('callback parsing rejects invalid IDs and every button fits the Telegram payload limit', () => {
  assert.equal(parseCallback('approved:invalid'), undefined);
  assert.equal(parseCallback(`delete:${id}`), undefined);
  assert.deepEqual(parseCallback(`reserve:${id}`), { action: 'reserve', id });
  for (const row of keyboard({ id, status: 'new' } as Application).inline_keyboard)
    for (const button of row) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
});
test('CSV export neutralizes formula injection and detailed Telegram messages respect the length limit', () => {
  assert.equal(csvValue('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  const answers = validateApplication(fixture()).data!.answers;
  for (const name of ['motivation', 'experience', 'questions', 'expectations'])
    answers[name] = 'я'.repeat(3000);
  const app = {
    id,
    kind: 'participant',
    answers,
    status: 'new',
    created_at: '2026-10-20',
  } as Application;
  for (const text of details(app)) assert.ok(text.length <= 4096);
  assert.ok(exportCsv([app], 'participant').includes('Згода на обробку даних'));
});
test('request body size is enforced even without Content-Length', async () => {
  await assert.rejects(() =>
    readJson(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'x'.repeat(100) }),
      }),
      10,
    ),
  );
});
test('modern Supabase secrets use apikey without pretending to be a user JWT', async () => {
  configure();
  globalThis.fetch = async (_input, options) => {
    const headers = options!.headers as Record<string, string>;
    assert.equal(headers.apikey, 'sb_secret_test');
    assert.equal(headers.Authorization, undefined);
    return reply([]);
  };
  await database('forum_applications');
});
test('retry endpoint requires its own secret', async () => {
  configure();
  process.env.CRON_SECRET = 'cron-secret';
  globalThis.fetch = async () => assert.fail('No request expected');
  assert.equal(
    (await retry({ request: new Request('http://localhost/api/telegram/retry') } as APIContext))
      .status,
    401,
  );
});

test('expired callback acknowledgement still allows full application delivery', async () => {
  configure();
  let delivered = false;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('forum_applications?'))
      return reply([
        {
          id,
          kind: 'participant',
          answers: validateApplication(fixture()).data!.answers,
          status: 'new',
        },
      ]);
    if (url.includes('answerCallbackQuery'))
      return reply(
        {
          ok: false,
          error_code: 400,
          description:
            'Bad Request: query is too old and response timeout expired or query ID is invalid',
        },
        400,
      );
    if (url.includes('sendMessage')) {
      assert.match(JSON.parse(String(options?.body)).text, /Повна анкета учасника/);
      delivered = true;
      return reply({ ok: true, result: { message_id: 1 } });
    }
    assert.fail('Unexpected request');
  };
  const response = await telegramWebhook({
    request: new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      },
      body: JSON.stringify({
        callback_query: {
          id: 'expired-callback',
          from: { id: 123 },
          data: 'view:' + id,
          message: { message_id: 1, chat: { id: -1001234 } },
        },
      }),
    }),
  } as APIContext);
  assert.equal(response.status, 200);
  assert.equal(delivered, true);
});

test('expired unauthorized callbacks finish without accessing or sending applications', async () => {
  configure();
  globalThis.fetch = async (input) => {
    assert.ok(String(input).includes('answerCallbackQuery'));
    return reply(
      { ok: false, error_code: 400, description: 'Bad Request: query ID is invalid' },
      400,
    );
  };
  const response = await telegramWebhook({
    request: new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      },
      body: JSON.stringify({
        callback_query: {
          id: 'expired-unauthorized',
          from: { id: 999 },
          data: 'view:' + id,
          message: { message_id: 1, chat: { id: -1001234 } },
        },
      }),
    }),
  } as APIContext);
  assert.equal(response.status, 200);
});

test('expired callback handling does not hide a failed full application send', async () => {
  configure();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('forum_applications?'))
      return reply([
        {
          id,
          kind: 'participant',
          answers: validateApplication(fixture()).data!.answers,
          status: 'new',
        },
      ]);
    if (url.includes('answerCallbackQuery'))
      return reply(
        { ok: false, error_code: 400, description: 'Bad Request: query is too old' },
        400,
      );
    if (url.includes('sendMessage'))
      return reply({ ok: false, error_code: 403, description: 'Forbidden' }, 403);
    assert.fail('Unexpected request');
  };
  const response = await telegramWebhook({
    request: new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      },
      body: JSON.stringify({
        callback_query: {
          id: 'expired-send-failure',
          from: { id: 123 },
          data: 'view:' + id,
          message: { message_id: 1, chat: { id: -1001234 } },
        },
      }),
    }),
  } as APIContext);
  assert.equal(response.status, 503);
});
