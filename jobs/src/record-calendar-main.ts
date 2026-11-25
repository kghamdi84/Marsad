/**
 * Fixture recorder for the economic calendar (manual, GitHub Actions, workflow `record-fixtures` with script
 * `record-calendar-main.ts`). Records FRED's release dates (including future ones) for the next 10 weeks and the
 * list of releases, with the project's FRED key. Bodies only, never the key; public data.
 */
const key = process.env['FRED_API_KEY']?.trim();
if (!key) throw new Error('Missing environment variable FRED_API_KEY');
const base = 'https://api.stlouisfed.org/fred';
const today = new Date().toISOString().slice(0, 10);
const end = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10);
async function get(path: string): Promise<{ status: number; body: unknown }> {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}file_type=json&api_key=${encodeURIComponent(key as string)}`;
  const res = await fetch(url);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  return { status: res.status, body };
}
function emit(name: string, endpoint: string, status: number, body: unknown) {
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      source: 'fred',
      endpoint,
      status,
      body,
    }),
  );
  console.log(`FIXTURE_END ${name}`);
}
const datesPath = `/releases/dates?realtime_start=${today}&realtime_end=${end}&include_release_dates_with_no_data=true&sort_order=asc&limit=1000`;
const dates = await get(datesPath);
emit('fred-release-dates', `${base}${datesPath}`, dates.status, dates.body);
const listPath = '/releases?limit=1000&order_by=release_id';
const list = await get(listPath);
// The list is long; keep id, name and press-release flag only.
const releases =
  (list.body as { releases?: { id: number; name: string; press_release: boolean }[] }).releases ??
  [];
emit('fred-releases', `${base}${listPath}`, list.status, {
  releases: releases.map((r) => ({ id: r.id, name: r.name, press_release: r.press_release })),
});
