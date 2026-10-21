/**
 * Behavioural tests for the shared HTML/JS escaping helpers.
 *
 * Run with `npm test` (node --test, no dependencies). The Python suite shells
 * out to the same command so CI exercises these too.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml, jsArg } from '../src/html.js';

test('escapeHtml neutralises a script tag', () => {
  assert.equal(
    escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('escapeHtml neutralises an image onerror payload', () => {
  const out = escapeHtml('<img src=x onerror=alert(document.cookie)>');
  assert.ok(!out.includes('<'), 'a < survived');
  assert.ok(!out.includes('>'), 'a > survived');
});

test('escapeHtml escapes BOTH quote characters', () => {
  // A zone name is interpolated into value="${...}" in the settings modal, so
  // a bare double quote would close the attribute and inject a new one.
  assert.equal(escapeHtml('" onfocus=alert(1) x="'), '&quot; onfocus=alert(1) x=&quot;');
  assert.equal(escapeHtml("' onfocus=alert(1) x='"), '&#39; onfocus=alert(1) x=&#39;');
});

test('escapeHtml escapes ampersand first, so output is not double-escaped', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml renders null and undefined as empty, not as text', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml passes ordinary names through untouched', () => {
  assert.equal(escapeHtml('Front Lawn'), 'Front Lawn');
  assert.equal(escapeHtml(15), '15');
});

test('jsArg contains a payload that escapeHtml alone would NOT contain', () => {
  // The crux: an HTML attribute is entity-decoded BEFORE its contents are
  // compiled as JavaScript. escapeHtml turns ' into &#39;, which decodes
  // straight back to ' and still closes the JS string literal. Reproduce that
  // decode here and assert jsArg survives it while the naive form does not.
  const payload = "');alert(1)//";
  const decode = (s) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

  const naive = `fn('${escapeHtml(payload)}')`;
  assert.ok(
    decode(naive).includes("fn('');alert(1)//')"),
    'control: HTML-escaping alone is expected to break out here'
  );

  const safe = `fn(${jsArg(payload)})`;
  const decoded = decode(safe);
  assert.equal(decoded, `fn("');alert(1)//")`);
  // The payload must sit wholly inside ONE string literal. Checking that
  // structurally (parse the argument back out) rather than by pattern: the
  // substring ");alert" legitimately appears INSIDE the literal, so a regex
  // over the whole expression cannot tell containment from a break-out.
  const arg = decoded.slice('fn('.length, -1);
  assert.equal(JSON.parse(arg), payload);
});

test('jsArg survives quotes, backslashes and newlines', () => {
  for (const payload of [
    'plain_id',
    'a"b',
    "a'b",
    'a\\b',
    'a\nb',
    '</script>',
    '");alert(1);//',
  ]) {
    const decoded = jsArg(payload)
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    assert.equal(JSON.parse(decoded), payload, `round-trip failed for ${payload}`);
  }
});

test('jsArg encodes undefined as null rather than emitting bare undefined', () => {
  assert.equal(jsArg(undefined), 'null');
});
