import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP, TOPICS } from '../public/help.js';

// `telnyx-edge logs <name>` is fine: helpText() escapes it. Real tags are not.
test('help text is plain text: no HTML tags or entities', () => {
  const texts = [
    ...Object.values(TOPICS).flatMap((t) => [t.scope, ...(t.doc || [])]),
    ...Object.values(HELP).flatMap((h) => h.sections.flatMap(([head, items]) => [head, ...items.flat()])),
  ];
  for (const s of texts) assert.doesNotMatch(s, /<\/?(a|b|i|em|strong|code|kbd|span|div|p|br|img|svg|script|style|iframe)\b|&[a-z]+;|javascript:/i, s);
});

test('every topic has help, and every help page has a topic', () => {
  for (const topic of Object.keys(TOPICS)) assert.ok(HELP[topic], `no help for ${topic}`);
  for (const key of Object.keys(HELP)) assert.ok(TOPICS[key.split('/')[0]], `no topic for ${key}`);
  for (const t of Object.values(TOPICS)) if (t.doc) assert.match(t.doc[1], /^https:\/\/developers\.telnyx\.com\//);
});
