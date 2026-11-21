import type { ApplicationKind, ApplicationStatus } from './validation';
import { reviewCallback } from './telegram-queue';

export type StatsRow = {
  id: string;
  kind: ApplicationKind;
  status: ApplicationStatus;
  created_at: string;
  name?: string | null;
};
export type StatusTotals = Record<ApplicationStatus, number> & { total: number };
export type ForumStats = {
  updatedAt: string;
  participants: StatusTotals;
  speakers: StatusTotals;
  total: number;
  newTotal: number;
  reserveTotal: number;
  submittedToday: number;
  submittedLast7Days: number;
  excludedTests: number;
};
const day = (value: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
const empty = (): StatusTotals => ({ total: 0, new: 0, approved: 0, reserve: 0, rejected: 0 });

export function summarizeApplications(rows: StatsRow[], now = new Date()): ForumStats {
  const stats: ForumStats = {
    updatedAt: now.toISOString(),
    participants: empty(),
    speakers: empty(),
    total: 0,
    newTotal: 0,
    reserveTotal: 0,
    submittedToday: 0,
    submittedLast7Days: 0,
    excludedTests: 0,
  };
  const today = day(now);
  for (const row of rows) {
    if (/^\s*(?:тест|test)(?:$|[\s—:–-])/iu.test(row.name || '')) {
      stats.excludedTests++;
      continue;
    }
    const totals = row.kind === 'participant' ? stats.participants : stats.speakers;
    totals.total++;
    totals[row.status]++;
    stats.total++;
    if (row.status === 'new') stats.newTotal++;
    if (row.status === 'reserve') stats.reserveTotal++;
    const created = new Date(row.created_at);
    const age = now.getTime() - created.getTime();
    if (!Number.isNaN(age) && age >= 0) {
      if (day(created) === today) stats.submittedToday++;
      if (age < 7 * 86400000) stats.submittedLast7Days++;
    }
  }
  return stats;
}
export function statsMessage(stats: ForumStats) {
  const timestamp = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(stats.updatedAt));
  const group = (name: string, totals: StatusTotals) => [
    name + ' — ' + totals.total,
    'Нові: ' + totals.new,
    'Схвалено: ' + totals.approved,
    'У резерві: ' + totals.reserve,
    'Відхилено: ' + totals.rejected,
  ];
  return {
    text: [
      'Статистика заявок форуму',
      'Оновлено: ' + timestamp + ' (Київ)',
      '',
      ...group('Учасники', stats.participants),
      '',
      ...group('Спікери', stats.speakers),
      '',
      'Усього заявок: ' + stats.total,
      'Чекають первинного розгляду: ' + stats.newTotal,
      'У резерві: ' + stats.reserveTotal,
      '',
      'Подано сьогодні: ' + stats.submittedToday,
      'За останні 7 діб: ' + stats.submittedLast7Days,
      ...(stats.excludedTests
        ? ['', 'Не враховано позначені тестові заявки: ' + stats.excludedTests]
        : []),
      '',
      'Схвалення в боті — рішення команди. Участь іще потрібно підтвердити з людиною.',
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Черга учасників',
            callback_data: reviewCallback({ kind: 'participant', filter: 'pending' }),
          },
          {
            text: 'Черга спікерів',
            callback_data: reviewCallback({ kind: 'speaker', filter: 'pending' }),
          },
        ],
        [{ text: 'Оновити статистику', callback_data: 'stats:refresh' }],
      ],
    },
  };
}
