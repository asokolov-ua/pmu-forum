import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(
    await readFile(new URL('../supabase/migrations/001_forum.sql', import.meta.url), 'utf8'),
  );
});
after(async () => {
  await db.close();
});
const answers = {
  fullName: 'Тест',
  email: 'test@example.org',
  age: '16–17 років',
  privacyConsent: true,
  photoConsent: 'Ні',
};
const key = '541c0f53-aeb2-4235-a17e-5200ca0bf403';
let id: string;
test('SQL commits one application and notification; retries and same-role email duplicates reuse the ID', async () => {
  const create = (submissionKey: string, email: string, kind = 'participant') =>
    db.query<{ id: string }>('select public.create_forum_application($1,$2,$3,$4) as id', [
      submissionKey,
      kind,
      email,
      JSON.stringify(answers),
    ]);
  id = (await create(key, 'test@example.org')).rows[0].id;
  assert.equal((await create(key, 'test@example.org')).rows[0].id, id);
  assert.equal(
    (await create('a81058a3-43b0-439a-8990-c689c5f8d409', 'TEST@example.org')).rows[0].id,
    id,
  );
  assert.equal((await db.query('select * from public.forum_applications')).rows.length, 1);
  assert.equal((await db.query('select * from public.forum_notifications')).rows.length, 1);
  assert.notEqual(
    (await create('8a6d809a-30d4-459f-b3a1-9c5ab664d13b', 'test@example.org', 'speaker')).rows[0]
      .id,
    id,
  );
});
test('invalid SQL submissions leave neither an application nor an orphan notification', async () => {
  await assert.rejects(() =>
    db.query('select public.create_forum_application($1,$2,$3,$4)', [
      '03f738b1-7429-4945-a18e-b577cdfdfbad',
      'participant',
      'bad@example.org',
      JSON.stringify({ ...answers, age: '14–17 років' }),
    ]),
  );
  assert.equal((await db.query('select * from public.forum_applications')).rows.length, 2);
  assert.equal((await db.query('select * from public.forum_notifications')).rows.length, 2);
});
test('a repeated decision is idempotent and changing it records the actor and both states', async () => {
  for (const status of ['approved', 'approved', 'reserve', 'rejected', 'new'])
    await db.query('select public.update_forum_status($1,$2,$3)', [id, status, '123']);
  const history = await db.query<{ previous_status: string; status: string; actor: string }>(
    'select * from public.forum_status_history where application_id=$1 order by id',
    [id],
  );
  assert.equal(history.rows.length, 4);
  assert.equal(history.rows[0].previous_status, 'new');
  assert.equal(history.rows[0].status, 'approved');
  assert.equal(history.rows[3].status, 'new');
  assert.equal(history.rows[3].actor, '123');
});
test('notification leases keep the same queue item out of simultaneous drains', async () => {
  const first = await db.query<{ id: string }>('select * from public.claim_forum_notifications(1)');
  const second = await db.query<{ id: string }>('select * from public.claim_forum_notifications(5)');
  const third = await db.query('select * from public.claim_forum_notifications(5)');
  assert.equal(first.rows.length, 1);
  assert.equal(second.rows.length, 1);
  assert.equal(third.rows.length, 0);
  assert.notEqual(first.rows[0].id, second.rows[0].id);
});
test('a retried Telegram callback cannot overwrite a more recent organizer decision', async () => {
  await db.query('select public.update_forum_status($1,$2,$3,$4)', [
    id,
    'approved',
    '123',
    'old-callback',
  ]);
  await db.query('select public.update_forum_status($1,$2,$3,$4)', [
    id,
    'reserve',
    '456',
    'new-callback',
  ]);
  await db.query('select public.update_forum_status($1,$2,$3,$4)', [
    id,
    'approved',
    '123',
    'old-callback',
  ]);
  const result = await db.query<{ status: string; reviewed_by: string }>(
    'select status,reviewed_by from public.forum_applications where id=$1',
    [id],
  );
  assert.equal(result.rows[0].status, 'reserve');
  assert.equal(result.rows[0].reviewed_by, '456');
});
test('rate limiting persists across requests and resets after the window', async () => {
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          'select public.consume_forum_rate_limit($1) as allowed',
          ['hashed-ip'],
        )
      ).rows[0].allowed,
      true,
    );
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        'select public.consume_forum_rate_limit($1) as allowed',
        ['hashed-ip'],
      )
    ).rows[0].allowed,
    false,
  );
  await db.exec("update public.forum_rate_limits set window_started=now()-interval '2 minutes'");
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        'select public.consume_forum_rate_limit($1) as allowed',
        ['hashed-ip'],
      )
    ).rows[0].allowed,
    true,
  );
});
test('public database roles cannot read applications or call privileged RPCs', async () => {
  await db.exec('set role anon');
  try {
    await assert.rejects(() => db.query('select * from public.forum_applications'));
    await assert.rejects(() => db.query('select public.claim_forum_notifications(1)'));
  } finally {
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  try {
    assert.equal((await db.query('select * from public.forum_applications')).rows.length, 2);
  } finally {
    await db.exec('reset role');
  }
});
