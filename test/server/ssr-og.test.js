/**
 * Volo Index — SSR OG meta injection tests (T2-D CTO review follow-up)
 *
 * Regression tests for the `injectOGMeta`/`escAttr` helpers in server/index.js.
 * Covers the String.replace `$`-pattern injection vector: holder_name is
 * user-controlled, so replacement values must be inert (`$'`, `` $` ``, `$&`)
 * and attribute-escaped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectOGMeta, escAttr, isUuid } from '../../src/server/index.js';
import { buildOGMeta } from '../../src/web/sharing.js';

const TEMPLATE = `<!doctype html><html><head>
<meta property="og:title" content="" />
<meta property="og:description" content="" />
<meta property="og:url" content="" />
<meta property="og:image" content="" />
<meta name="twitter:title" content="" />
<meta name="twitter:description" content="" />
<meta name="twitter:image" content="" />
</head><body></body></html>`;

const BASE = 'https://voloindex.org';

function render(holderName) {
  const certUrl = `${BASE}/credential/abc`;
  const ogMeta = buildOGMeta({ holderName, tier: 'Proficient', certUrl, baseUrl: BASE });
  return injectOGMeta(TEMPLATE, ogMeta, certUrl);
}

test('injects OG meta for a plain holder name', () => {
  const html = render('Jane Doe');
  assert.match(html, /property="og:title" content="Jane Doe earned a Proficient Certificate \| Volo Index"/);
  assert.match(html, /property="og:url" content="https:\/\/voloindex\.org\/credential\/abc"/);
});

test("replacement $' pattern is inert (no template splicing)", () => {
  const html = render("$'<script>alert(1)</script>");
  // No raw script tag may appear anywhere in the output
  assert.ok(!html.includes('<script>alert(1)</script>'));
  // The literal $' must survive as data, escaped
  assert.ok(html.includes("$'&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test('replacement $` and $& patterns are inert', () => {
  for (const payload of ['$`boom', '$&boom', '$$boom']) {
    const html = render(payload);
    // Output length stays sane — splicing the template would balloon it
    assert.ok(html.length < TEMPLATE.length + 2000, `payload ${payload} spliced template`);
    assert.ok(!/<script/i.test(html.replace(/<script id="og-noop"/g, '')));
  }
});

test('escAttr escapes quote, angle brackets, ampersand', () => {
  assert.equal(escAttr('a"b<c>d&e'), 'a&quot;b&lt;c&gt;d&amp;e');
  assert.equal(escAttr(null), '');
});

test('isUuid gates the /credential/:certId DB lookup (uuid-cast 500 guard)', () => {
  assert.ok(isUuid('00000000-0000-4000-8000-000000000000'));
  assert.ok(isUuid('A3BB189E-8BF9-3888-9912-ACE4E6543002')); // case-insensitive
  for (const bad of ['nonexistent', 'abc', '', "1' OR '1'='1", '00000000-0000-4000-8000-00000000000', null, undefined, 42]) {
    assert.equal(isUuid(bad), false, `expected non-uuid: ${String(bad)}`);
  }
});

test('holder name with quotes cannot break out of the attribute', () => {
  const html = render('"><img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /content="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;[^"]*"/);
});
