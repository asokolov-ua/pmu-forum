export function env(name: string): string {
  return process.env[name] ?? import.meta.env?.[name] ?? '';
}
export function hasDatabase(): boolean {
  return Boolean(env('SUPABASE_URL') && env('SUPABASE_SECRET_KEY'));
}
export function hasTelegram(): boolean {
  return Boolean(
    env('TELEGRAM_BOT_TOKEN') &&
    env('TELEGRAM_CHAT_ID') &&
    env('TELEGRAM_WEBHOOK_SECRET') &&
    env('TELEGRAM_ADMIN_IDS'),
  );
}
export function registrationOpen(): boolean {
  return (
    env('REGISTRATION_OPEN') === 'true' &&
    hasDatabase() &&
    hasTelegram() &&
    Boolean(env('RATE_LIMIT_SECRET'))
  );
}
export function isAdmin(id: unknown): boolean {
  return env('TELEGRAM_ADMIN_IDS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(String(id));
}
