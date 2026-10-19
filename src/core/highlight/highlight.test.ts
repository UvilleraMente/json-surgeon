import { describe, expect, it } from 'vitest';
import { repairJson } from '../repair/repair';
import { escapeHtml, highlightCode, markRepairs } from './highlight';

const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('highlightCode', () => {
  it('distinguishes JSON keys, strings, numbers and literals', () => {
    const html = highlightCode('{"a": "b", "n": -1.5, "t": true, "z": null}', 'json');
    expect(html).toContain('<span class="tok-key">&quot;a&quot;</span>');
    expect(html).toContain('<span class="tok-string">&quot;b&quot;</span>');
    expect(html).toContain('<span class="tok-number">-1.5</span>');
    expect(html).toContain('<span class="tok-literal">true</span>');
    expect(html).toContain('<span class="tok-literal">null</span>');
  });

  it('highlights keywords, types and comments in code', () => {
    const html = highlightCode('// hi\nexport interface User {\n  tags: Tag[];\n}', 'typescript');
    expect(html).toContain('<span class="tok-comment">// hi</span>');
    expect(html).toContain('<span class="tok-keyword">interface</span>');
    expect(html).toContain('<span class="tok-type">Tag</span>');
  });

  it('escapes HTML and preserves the text exactly', () => {
    const src = 'List<string> x = "<script>&";';
    const html = highlightCode(src, 'csharp');
    expect(html).not.toContain('<script>');
    expect(stripTags(html)).toBe(src);
  });
});

describe('markRepairs', () => {
  it('wraps replaced ranges and inserts markers for insertions', () => {
    const input = '{a: 1 "b": 2,}';
    const { repairs } = repairJson(input);
    const html = markRepairs(input, repairs, 1);
    expect(html).toContain('<mark class="mark cat-quotes" data-i="0">a</mark>');
    expect(html).toContain('<mark class="mark cat-structure active insert" data-i="1"></mark>');
    expect(html).toContain('<mark class="mark cat-structure" data-i="2">,</mark>');
  });

  it('keeps exactly the original characters (plus a trailing newline)', () => {
    const input = "// <c>\n{'x': True, \"y\": [1 2]";
    const { repairs } = repairJson(input);
    expect(stripTags(markRepairs(input, repairs, null))).toBe(input + '\n');
  });

  it('escapes html', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
