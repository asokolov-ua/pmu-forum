import { database } from './database';
import { summarizeApplications, type StatsRow, type ForumStats } from '../telegram-stats';

export async function readForumStats(now = new Date()): Promise<ForumStats> {
  const rows: StatsRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({
      select: 'id,kind,status,created_at,name:answers->>fullName',
      order: 'id.asc',
      limit: '500',
    });
    if (cursor) params.set('id', 'gt.' + cursor);
    const batch = await database<StatsRow[]>('forum_applications?' + params);
    rows.push(...batch);
    if (batch.length < 500) return summarizeApplications(rows, now);
    const next = batch[batch.length - 1].id;
    if (next === cursor) throw new Error('Statistics pagination did not advance');
    cursor = next;
  }
  throw new Error('Statistics pagination limit exceeded');
}
