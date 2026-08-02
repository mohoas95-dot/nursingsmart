import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrintDocumentHtml } from '../lib/print/print-snapshot';

test('print snapshot document embeds content, copied styles and page setup', () => {
  const html = buildPrintDocumentHtml({
    bodyHtml:
      '<div id="print-schedule-sheet" class="w-full bg-white"><table><tr><td>برنامهٔ ماهانهٔ شیفت</td></tr></table></div>',
    headStylesHtml:
      '<style>@media print { body * { visibility: hidden !important; } }</style>',
    pageCss: '@page { size: A4 landscape; margin: 4mm; }',
    htmlClassName: '__variable_vazir __variable_titr __variable_tracing',
    bodyClassName: 'font-sans antialiased',
  });

  assert.ok(html.startsWith('<!doctype html><html lang="fa" dir="rtl"'), 'document keeps fa/rtl shell');
  assert.ok(
    html.includes('class="__variable_vazir __variable_titr __variable_tracing"'),
    'font variable classes are copied to <html>'
  );
  assert.ok(html.includes('<body class="font-sans antialiased">'), 'body classes are copied');
  assert.ok(html.includes('id="print-schedule-sheet"'), 'print container is embedded');
  assert.ok(html.includes('برنامهٔ ماهانهٔ شیفت'), 'content is embedded verbatim');
  assert.ok(
    html.includes('@media print { body * { visibility: hidden !important; } }'),
    'copied print stylesheet rules are embedded'
  );
  assert.ok(
    html.includes('<style>@page { size: A4 landscape; margin: 4mm; }</style>'),
    'page setup rule is injected'
  );
  assert.ok(html.endsWith('</body></html>'), 'document closes properly');
});

test('print snapshot omits empty page style block', () => {
  const html = buildPrintDocumentHtml({
    bodyHtml: '<div id="print-request-cards"></div>',
    headStylesHtml: '',
    pageCss: '   ',
  });
  assert.ok(!html.includes('<style></style>'), 'no empty style tag is injected');
});

test('print snapshot escapes special characters in copied class names', () => {
  const html = buildPrintDocumentHtml({
    bodyHtml: '<p>x</p>',
    headStylesHtml: '',
    htmlClassName: 'a"b<c',
  });
  assert.ok(html.includes('class="a&quot;b&lt;c"'));
});

test('print snapshot respects explicit dir/lang overrides', () => {
  const html = buildPrintDocumentHtml({
    bodyHtml: '<div></div>',
    headStylesHtml: '',
    dir: 'ltr',
    lang: 'en',
  });
  assert.ok(html.includes('<html lang="en" dir="ltr"'));
});
