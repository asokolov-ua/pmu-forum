import { participantSteps, speakerSteps, forum } from '../data/forum';

export type ApplicationKind = 'participant' | 'speaker';
export type ApplicationStatus = 'new' | 'approved' | 'reserve' | 'rejected';
export type Application = {
  id: string;
  kind: ApplicationKind;
  email: string;
  answers: Record<string, unknown>;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
  reviewed_by?: string | null;
};
export type ValidApplication = {
  kind: ApplicationKind;
  submissionKey: string;
  email: string;
  answers: Record<string, unknown>;
};
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateApplication(body: unknown): {
  data?: ValidApplication;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { errors: { form: 'Неправильний формат заявки.' } };
  const input = body as Record<string, unknown>;
  if (input.kind !== 'participant' && input.kind !== 'speaker')
    return { errors: { form: 'Оберіть тип анкети.' } };
  if (input.website) errors.form = 'Не вдалося перевірити заявку.';
  if (typeof input.submissionKey !== 'string' || !uuidPattern.test(input.submissionKey))
    errors.form = 'Оновіть сторінку та спробуйте знову.';
  const answers: Record<string, unknown> = {};
  const steps = input.kind === 'participant' ? participantSteps : speakerSteps;
  for (const field of steps.flatMap((step) => step.fields)) {
    const value = input[field.name];
    if (field.type === 'checkbox') {
      const choices = Array.isArray(value) ? [...new Set(value)] : [];
      if (choices.length === 0 && field.required)
        errors[field.name] = 'Оберіть щонайменше один напрям.';
      if (
        !Array.isArray(value) ||
        choices.some((choice) => typeof choice !== 'string' || !field.options?.includes(choice))
      )
        errors[field.name] = 'Оберіть варіанти зі списку.';
      answers[field.name] = choices;
      continue;
    }
    if (value !== undefined && typeof value !== 'string') {
      errors[field.name] = 'Перевірте відповідь.';
      continue;
    }
    const text = typeof value === 'string' ? value.trim() : '';
    answers[field.name] = text;
    if (field.required && !text) {
      errors[field.name] = 'Заповніть це поле.';
      continue;
    }
    if (text.length > (field.max ?? 3000))
      errors[field.name] = 'Відповідь перевищує дозволену довжину.';
    if (text.includes('\u0000')) errors[field.name] = 'Відповідь містить неприпустимі символи.';
    if (field.type === 'radio' && text && !field.options?.includes(text))
      errors[field.name] = 'Оберіть один варіант зі списку.';
    if (field.type === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
      errors[field.name] = 'Вкажіть коректну електронну адресу.';
    if (field.type === 'tel' && text && !/^\+?[\d\s().-]{7,25}$/.test(text))
      errors[field.name] = 'Перевірте номер телефону.';
  }
  if (input.privacyConsent !== 'yes')
    errors.privacyConsent = 'Для розгляду заявки потрібна згода на обробку даних.';
  if (input.photoConsent !== 'Так' && input.photoConsent !== 'Ні')
    errors.photoConsent = 'Оберіть «Так» або «Ні».';
  answers.privacyConsent = true;
  answers.photoConsent = input.photoConsent;
  answers.consentVersion = forum.consentVersion;
  if (Object.keys(errors).length) return { errors };
  return {
    data: {
      kind: input.kind,
      submissionKey: String(input.submissionKey),
      email: String(answers.email).toLowerCase(),
      answers,
    },
    errors,
  };
}
