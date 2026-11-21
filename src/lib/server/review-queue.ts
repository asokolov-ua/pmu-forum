import { database } from './database';
import {
  reviewPageSize,
  type ReviewRequest,
  type ReviewRow,
  type ReviewPage,
} from '../telegram-queue';

export async function readReviewPage(request: ReviewRequest): Promise<ReviewPage> {
  let anchor: { id: string; created_at: string } | undefined;
  if (request.cursor) {
    const rows = await database<{ id: string; created_at: string }[]>(
      'forum_applications?' +
        new URLSearchParams({ select: 'id,created_at', id: 'eq.' + request.cursor, limit: '1' }),
    );
    anchor = rows[0];
    if (!anchor) return readReviewPage({ kind: request.kind, filter: request.filter });
  }
  const backward = Boolean(anchor && request.direction === 'before');
  const params = new URLSearchParams({
    select: 'id,kind,status,created_at,fullName:answers->>fullName',
    kind: 'eq.' + request.kind,
    status: request.filter === 'pending' ? 'in.(new,reserve)' : 'eq.' + request.filter,
    order: backward ? 'created_at.desc,id.desc' : 'created_at.asc,id.asc',
    limit: String(reviewPageSize + 1),
  });
  if (anchor) {
    const comparison = backward ? 'lt' : 'gt';
    params.set(
      'or',
      '(created_at.' +
        comparison +
        '.' +
        anchor.created_at +
        ',and(created_at.eq.' +
        anchor.created_at +
        ',id.' +
        comparison +
        '.' +
        anchor.id +
        '))',
    );
  }
  const result = await database<ReviewRow[]>('forum_applications?' + params);
  if (!result.length && anchor)
    return readReviewPage({ kind: request.kind, filter: request.filter });
  const rows = result.slice(0, reviewPageSize);
  if (backward) rows.reverse();
  return {
    request,
    rows,
    hasPrevious: backward ? result.length > reviewPageSize : Boolean(anchor),
    hasNext: backward ? true : result.length > reviewPageSize,
  };
}
