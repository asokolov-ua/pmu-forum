// Run locally with .env: npm run telegram:setup. Credentials never appear in arguments or output.
const { SITE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
if (!SITE_URL?.startsWith('https://') || !TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET)
  throw new Error('Set HTTPS SITE_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.');
const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: new URL('/api/telegram/webhook', SITE_URL).href,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  }),
});
const result = await response.json();
if (!response.ok || !result.ok)
  throw new Error(`Webhook setup failed (${response.status}); check configuration.`);
console.log('Telegram webhook configured successfully.');
