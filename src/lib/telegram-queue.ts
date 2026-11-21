import { uuidPattern, type ApplicationKind, type ApplicationStatus } from './validation';
import { statusLabels } from './telegram-format';

export type ReviewFilter = 'pending' | 'new' | 'reserve';
export type ReviewRequest = {
  kind: ApplicationKind;
  filter: ReviewFilter;
  cursor?: string;
  direction?: 'after' | 'before';
};
export type ReviewRow = {
  id: string;
  kind: ApplicationKind;
  status: ApplicationStatus;
  created_at: string;
  fullName: string;
};
export type ReviewPage = {
  request: ReviewRequest;
  rows: ReviewRow[];
  hasPrevious: boolean;
  hasNext: boolean;
};
export const reviewPageSize = 5;
const kindCodes = { participant: 'p', speaker: 's' } as const;
const filterCodes = { pending: 'p', new: 'n', reserve: 'r' } as const;

export function reviewCallback(request: ReviewRequest): string {
  const root = 'q:' + kindCodes[request.kind] + ':' + filterCodes[request.filter];
  return request.cursor && request.direction
    ? root + ':' + (request.direction === 'after' ? 'a' : 'b') + ':' + request.cursor
    : root;
}
export function parseReviewCallback(value: unknown): ReviewRequest | undefined {
  if (typeof value !== 'string') return;
  const match = /^q:(p|s):(p|n|r)(?::(a|b):([^:]+))?$/.exec(value);
  if (!match || (match[4] && !uuidPattern.test(match[4]))) return;
  return {
    kind: match[1] === 'p' ? 'participant' : 'speaker',
    filter: match[2] === 'p' ? 'pending' : match[2] === 'n' ? 'new' : 'reserve',
    ...(match[4]
      ? { cursor: match[4], direction: match[3] === 'a' ? ('after' as const) : ('before' as const) }
      : {}),
  };
}
export function reviewMessage(page: ReviewPage) {
  const { kind, filter } = page.request;
  const names = { pending: 'Нові та резерв', new: 'Нові', reserve: 'У резерві' };
  const lines = [
    'Черга ' + (kind === 'participant' ? 'учасників' : 'спікерів') + ' · ' + names[filter],
    '',
  ];
  if (!page.rows.length) lines.push('У цій черзі заявок немає.');
  for (const [index, row] of page.rows.entries()) {
    const name = String(row.fullName || 'Без імені')
      .replace(/\s+/g, ' ')
      .slice(0, 150);
    const date = new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(row.created_at));
    lines.push(
      index + 1 + '. ' + name,
      statusLabels[row.status] + ' · ' + date + ' · ' + row.id.slice(0, 8).toUpperCase(),
      '',
    );
  }
  lines.push(
    'Найстаріші заявки — першими. Відкрийте анкету й оберіть рішення під нею.',
    'Список оновлюється при натисканні кнопок. Оновлення повертає до початку черги.',
  );
  const button = (text: string, request: ReviewRequest) => ({
    text,
    callback_data: reviewCallback(request),
  });
  const inline_keyboard: { text: string; callback_data: string }[][] = [
    [
      button((kind === 'participant' ? '✓ ' : '') + 'Учасники', { kind: 'participant', filter }),
      button((kind === 'speaker' ? '✓ ' : '') + 'Спікери', { kind: 'speaker', filter }),
    ],
    (['pending', 'new', 'reserve'] as const).map((value) =>
      button((filter === value ? '✓ ' : '') + names[value], { kind, filter: value }),
    ),
    ...page.rows.map((row, index) => [
      {
        text: index + 1 + '. Відкрити ' + row.id.slice(0, 8).toUpperCase(),
        callback_data: 'view:' + row.id,
      },
    ]),
  ];
  const navigation = [];
  if (page.hasPrevious && page.rows.length)
    navigation.push(
      button('← Попередні', { kind, filter, direction: 'before', cursor: page.rows[0].id }),
    );
  if (page.hasNext && page.rows.length)
    navigation.push(
      button('Наступні →', {
        kind,
        filter,
        direction: 'after',
        cursor: page.rows[page.rows.length - 1].id,
      }),
    );
  if (navigation.length) inline_keyboard.push(navigation);
  inline_keyboard.push([button('Оновити чергу', { kind, filter })]);
  return { text: lines.join('\n'), reply_markup: { inline_keyboard } };
}
