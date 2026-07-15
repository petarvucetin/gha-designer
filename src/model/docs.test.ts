import { describe, expect, it } from 'vitest';
import { EVENTS } from './catalog';
import {
  EVENT_HELP, EVENTS_DOCS_URL, SYNTAX_DOCS_URL, SYNTAX_TOPICS,
  eventDocsUrl, eventHelp, topic, topicUrl,
} from './docs';

describe('docs data', () => {
  it('has help for every catalog event', () => {
    for (const e of EVENTS) {
      expect(EVENT_HELP[e.name], `missing help for ${e.name}`).toBeTruthy();
      expect(EVENT_HELP[e.name].length).toBeGreaterThan(20);
    }
  });

  it('builds event docs URLs from the events reference anchors', () => {
    expect(eventDocsUrl('push')).toBe(`${EVENTS_DOCS_URL}#push`);
    expect(eventDocsUrl('workflow_call')).toBe(`${EVENTS_DOCS_URL}#workflow_call`);
  });

  it('falls back for unknown events', () => {
    expect(eventHelp('not_an_event')).toMatch(/event/i);
  });

  it('topics all have title, help and anchor; urls are https docs.github.com', () => {
    expect(SYNTAX_TOPICS.length).toBeGreaterThanOrEqual(21);
    for (const t of SYNTAX_TOPICS) {
      expect(t.title).toBeTruthy();
      expect(t.help.length).toBeGreaterThan(20);
      // 'run' intentionally has no GitHub docs anchor (it documents the local runner, not workflow syntax).
      if (t.anchor) expect(t.anchor).toMatch(/^[a-z0-9_-]+$/);
    }
    expect(EVENTS_DOCS_URL).toMatch(/^https:\/\/docs\.github\.com\//);
    expect(SYNTAX_DOCS_URL).toMatch(/^https:\/\/docs\.github\.com\//);
  });

  it('topic lookup and url', () => {
    expect(topic('runs-on')?.anchor).toBe('jobsjob_idruns-on');
    expect(topicUrl('runs-on')).toBe(`${SYNTAX_DOCS_URL}#jobsjob_idruns-on`);
    expect(topic('nope')).toBeUndefined();
  });
});
