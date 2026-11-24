import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/nasdaq-halts-rss.json';
import { parseHaltsRss } from './halts.js';

describe('parseHaltsRss on the recorded feed', () => {
  const feed = parseHaltsRss(fixture.xml);
  it('parses every item without skipping', () => {
    expect(feed.items).toHaveLength(10);
    expect(feed.skipped).toEqual([]);
  });
  it('reads the generation time', () => {
    expect(feed.generatedAt?.toISOString()).toBe('2026-11-23T19:31:53.000Z');
  });
  it('converts Eastern halt times to UTC (EST, UTC-5)', () => {
    const evrl = feed.items.find((h) => h.symbol === 'EVRL');
    expect(evrl?.haltedAt.toISOString()).toBe('2026-11-23T19:31:05.783Z'); // 14:31:05.783 ET
    expect(evrl?.reasonCode).toBe('LUDP');
    expect(evrl?.reasonMeaning).toBe('Volatility trading pause');
  });
  it('flags the T1 news-pending halt as active and news related', () => {
    const t1 = feed.items.filter((h) => h.reasonCode === 'T1');
    expect(t1).toHaveLength(1);
    expect(t1[0]?.newsRelated).toBe(true);
    expect(t1[0]?.active).toBe(true);
    expect(t1[0]?.resumptionTradeAt).toBeNull();
  });
  it('keeps unknown reason codes with a null meaning instead of guessing', () => {
    const m = feed.items.find((h) => h.reasonCode === 'M');
    expect(m?.reasonMeaning).toBeNull();
    expect(m?.newsRelated).toBe(false);
  });
  it('halt times never sit in the future of the feed generation time', () => {
    for (const h of feed.items) {
      expect(h.haltedAt.getTime()).toBeLessThanOrEqual((feed.generatedAt as Date).getTime());
    }
  });
});

describe('parseHaltsRss robustness', () => {
  it('reports malformed items instead of dropping them silently', () => {
    const bad = `<rss><channel><pubDate>Mon, 23 Nov 2026 19:31:53 GMT</pubDate>
      <item><title>X</title><ndaq:IssueSymbol>X</ndaq:IssueSymbol></item></channel></rss>`;
    const feed = parseHaltsRss(bad);
    expect(feed.items).toEqual([]);
    expect(feed.skipped).toHaveLength(1);
  });
  it('decodes entities in names and handles an empty feed', () => {
    const item = `<item><ndaq:HaltDate>07/01/2026</ndaq:HaltDate><ndaq:HaltTime>09:30:00</ndaq:HaltTime>
      <ndaq:IssueSymbol>AT&amp;T</ndaq:IssueSymbol><ndaq:IssueName>AT&amp;T Inc</ndaq:IssueName>
      <ndaq:Market>NYSE</ndaq:Market><ndaq:ReasonCode>T1</ndaq:ReasonCode></item>`;
    const feed = parseHaltsRss(`<rss><channel>${item}</channel></rss>`);
    expect(feed.items[0]?.name).toBe('AT&T Inc');
    expect(feed.items[0]?.haltedAt.toISOString()).toBe('2026-07-01T13:30:00.000Z'); // EDT, UTC-4
    expect(parseHaltsRss('<rss><channel></channel></rss>').items).toEqual([]);
  });
});
