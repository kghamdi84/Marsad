import { expect, test, type WebSocketRoute } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const first = {
  id: 'a1',
  published_at: '2026-11-27T13:00:00+00:00',
  publisher: 'Reuters',
  title: 'NVIDIA supplier lifts guidance on data-center demand',
  url: 'https://example.com/a1',
  tickers: ['NVDA'],
};
const second = {
  id: 'a2',
  published_at: '2026-11-27T15:20:00+00:00',
  publisher: 'Reuters',
  title: 'Broadcom wins a new custom chip order',
  url: 'https://example.com/a2',
  tickers: ['AVGO'],
};

type Frame = [string | null, string | null, string, string, Record<string, unknown>];

/**
 * A stand-in for Supabase Realtime (Phoenix protocol, serializer 2.0.0: [join_ref, ref, topic, event, payload]):
 * it accepts the channel join with an id per postgres_changes binding, then lets the test push an INSERT.
 */
function fakeRealtime(ws: WebSocketRoute) {
  let topic = '';
  let joinRef: string | null = null;
  const bindings: { id: number; table: string }[] = [];
  ws.onMessage((raw) => {
    const m = JSON.parse(String(raw)) as Frame;
    const [jr, ref, t, event, payload] = m;
    if (event === 'heartbeat') {
      ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]));
      return;
    }
    if (event === 'phx_join') {
      topic = t;
      joinRef = jr;
      const cfg = (payload['config'] as { postgres_changes?: Record<string, string>[] })
        .postgres_changes;
      const changes = (cfg ?? []).map((c, i) => {
        bindings.push({ id: i + 1, table: c['table'] ?? '' });
        return { id: i + 1, event: c['event'], schema: c['schema'], table: c['table'] };
      });
      ws.send(
        JSON.stringify([
          jr,
          ref,
          t,
          'phx_reply',
          { status: 'ok', response: { postgres_changes: changes } },
        ]),
      );
      ws.send(
        JSON.stringify([
          null,
          null,
          t,
          'system',
          {
            status: 'ok',
            extension: 'postgres_changes',
            message: 'Subscribed',
            channel: t.replace(/^realtime:/, ''),
          },
        ]),
      );
    } else if (ref) {
      ws.send(JSON.stringify([jr, ref, t, 'phx_reply', { status: 'ok', response: {} }]));
    }
  });
  return {
    insert(table: string, record: Record<string, unknown>) {
      const ids = bindings.filter((b) => b.table === table).map((b) => b.id);
      ws.send(
        JSON.stringify([
          joinRef,
          null,
          topic,
          'postgres_changes',
          {
            ids,
            data: {
              type: 'INSERT',
              schema: 'public',
              table,
              commit_timestamp: '2026-11-27T15:21:00Z',
              columns: Object.keys(record).map((name) => ({ name, type: 'text' })),
              record,
              errors: null,
            },
          },
        ]),
      );
    },
  };
}

test('live news: the card says Live once subscribed, and a stored story appears marked New', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  await page.clock.install({ time: new Date('2026-11-27T15:20:30Z') });
  let rows = [first];
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/news_articles**', (r) => r.fulfill(json(rows)));
  let rt: ReturnType<typeof fakeRealtime> | null = null;
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    rt = fakeRealtime(ws);
  });

  await page.goto('/');
  const news = page.getByRole('region', { name: 'Latest news' });
  await expect(news).toContainText('NVIDIA supplier lifts guidance');
  await expect(news.getByRole('status')).toContainText('Live');
  await expect(news.getByText('New', { exact: true })).toHaveCount(0);

  // The news job stores a story: the page hears the row, refetches and marks it.
  rows = [second, first];
  await expect.poll(() => rt !== null).toBe(true);
  (rt as unknown as ReturnType<typeof fakeRealtime>).insert('news_articles', second);
  await expect(news).toContainText('Broadcom wins a new custom chip order');
  await expect(news.getByText('New', { exact: true })).toHaveCount(1);

  // A minute later the tag is gone; the story stays.
  await page.clock.fastForward(65_000);
  await expect(news.getByText('New', { exact: true })).toHaveCount(0);
  await expect(news).toContainText('Broadcom wins a new custom chip order');
});
