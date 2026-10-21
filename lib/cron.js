// Cron endpoints are public URLs, so they must be locked with CRON_SECRET.
// Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically when the variable is set.
export function cronAuthorized(request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
