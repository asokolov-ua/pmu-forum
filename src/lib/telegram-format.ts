import { participantSteps, speakerSteps } from '../data/forum';
import { uuidPattern, type Application, type ApplicationStatus } from './validation';
export const statusLabels: Record<ApplicationStatus, string> = {
  new: 'Нова',
  approved: 'Схвалено',
  reserve: 'У резерві',
  rejected: 'Відхилено',
};
const kindLabel = (app: Application) => (app.kind === 'speaker' ? 'спікера' : 'учасника');
export function summary(app: Application): string {
  const a = app.answers;
  const lines = [
    `Заявка ${kindLabel(app)} · ${app.id.slice(0, 8).toUpperCase()}`,
    '',
    `${a.fullName}`,
    `Email: ${a.email}`,
  ];
  if (a.phone) lines.push(`Телефон: ${a.phone}`);
  if (app.kind === 'speaker')
    lines.push(
      `Діяльність: ${a.occupation}`,
      `Тема: ${String(a.talkTopic).slice(0, 700)}`,
      `Формат: ${a.format}`,
      `Проєктор: ${a.projector}`,
    );
  else
    lines.push(
      `Вік: ${a.age}`,
      `Місто: ${a.city}`,
      `Статус: ${a.occupation}`,
      `Інтереси: ${(a.interests as string[]).join('; ')}`,
    );
  lines.push(`Зйомка: ${a.photoConsent}`, '', `Статус заявки: ${statusLabels[app.status]}`);
  if (app.reviewed_by) lines.push(`Рішення змінив організатор: ${app.reviewed_by}`);
  return lines.join('\n');
}
export function keyboard(app: Application) {
  return {
    inline_keyboard: [
      [{ text: 'Повна анкета', callback_data: `view:${app.id}` }],
      [
        {
          text: `${app.status === 'approved' ? '✓ ' : ''}Схвалити`,
          callback_data: `approved:${app.id}`,
        },
        {
          text: `${app.status === 'reserve' ? '✓ ' : ''}У резерв`,
          callback_data: `reserve:${app.id}`,
        },
      ],
      [
        {
          text: `${app.status === 'rejected' ? '✓ ' : ''}Відхилити`,
          callback_data: `rejected:${app.id}`,
        },
        { text: 'Повернути в нові', callback_data: `new:${app.id}` },
      ],
    ],
  };
}
export function parseCallback(
  data: unknown,
): { action: ApplicationStatus | 'view'; id: string } | undefined {
  if (typeof data !== 'string') return;
  const [action, id, extra] = data.split(':');
  if (
    extra ||
    !uuidPattern.test(id ?? '') ||
    !['view', 'new', 'approved', 'reserve', 'rejected'].includes(action)
  )
    return;
  return { action: action as ApplicationStatus | 'view', id };
}
export function details(app: Application): string[] {
  const fields = (app.kind === 'speaker' ? speakerSteps : participantSteps).flatMap(
    (step) => step.fields,
  );
  const blocks = [
    `Повна анкета ${kindLabel(app)} · ${app.id.slice(0, 8).toUpperCase()}`,
    ...fields.map(
      (field) =>
        `${field.label}\n${Array.isArray(app.answers[field.name]) ? (app.answers[field.name] as string[]).join('; ') : app.answers[field.name] || '—'}`,
    ),
    `Згода на обробку даних: так\nВерсія повідомлення: ${app.answers.consentVersion}\nЗйомка: ${app.answers.photoConsent}`,
    `Статус: ${statusLabels[app.status]}`,
  ];
  const messages: string[] = [];
  let current = '';
  for (const block of blocks) {
    if ((current + '\n\n' + block).length > 3800) {
      if (current) messages.push(current);
      current = block;
    } else current += `${current ? '\n\n' : ''}${block}`;
  }
  if (current) messages.push(current);
  return messages;
}
export function csvValue(value: unknown): string {
  let text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(apps: Application[], kind: 'participant' | 'speaker'): string {
  const fields = (kind === 'speaker' ? speakerSteps : participantSteps).flatMap(
    (step) => step.fields,
  );
  const headers = [
    'ID',
    'Дата подання',
    'Статус заявки',
    'Організатор',
    ...fields.map((f) => f.label),
    'Згода на обробку даних',
    'Зйомка',
    'Версія повідомлення',
  ];
  const rows = apps.map((app) => [
    app.id,
    app.created_at,
    statusLabels[app.status],
    app.reviewed_by,
    ...fields.map((f) => app.answers[f.name]),
    app.answers.privacyConsent ? 'Так' : 'Ні',
    app.answers.photoConsent,
    app.answers.consentVersion,
  ]);
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvValue).join(',')).join('\r\n');
}
