import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples';
import { toJsValue } from './json/ast';
import { formatJson } from './json/format';
import { repairCategory, repairLabel } from './repair/kinds';
import { repairJson } from './repair/repair';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  compressToBase64Url,
  decodeShareHash,
  decompressFromBase64Url,
  encodeShareHash,
} from './share/codec';

const parse = (s: string) => repairJson(s).value!;

describe('formatJson', () => {
  const doc = parse('{"b": [1, {"d": 2, "c": 3}], "a": {}, "e": []}');

  it('indents with 2 spaces by default', () => {
    expect(formatJson(doc)).toBe(JSON.stringify(JSON.parse(formatJson(doc)), null, 2));
  });

  it('supports 4 spaces, tabs and minify', () => {
    expect(formatJson(doc, { indent: 4 })).toContain('\n    "b": [');
    expect(formatJson(doc, { indent: 'tab' })).toContain('\n\t"b": [');
    expect(formatJson(doc, { indent: 'minify' })).toBe('{"b":[1,{"d":2,"c":3}],"a":{},"e":[]}');
  });

  it('sorts keys recursively', () => {
    expect(formatJson(doc, { indent: 'minify', sortKeys: true })).toBe('{"a":{},"b":[1,{"c":3,"d":2}],"e":[]}');
  });

  it('escapes strings correctly', () => {
    const s = formatJson(parse('{"q": "a\\"b\\\\c\\n\\u0001"}'), { indent: 'minify' });
    expect(JSON.parse(s)).toEqual({ q: 'a"b\\c\n\u0001' });
  });

  it('converts to plain JS values', () => {
    expect(toJsValue(parse('{"a": [1, true, null, "x"]}'))).toEqual({ a: [1, true, null, 'x'] });
  });
});

describe('share codec', () => {
  it('round-trips text through deflate-raw + base64url', async () => {
    const text = '{"hello": "wörld ✓", "n": [1,2,3]}'.repeat(50);
    const encoded = await compressToBase64Url(text);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThan(text.length);
    expect(await decompressFromBase64Url(encoded)).toBe(text);
  });

  it('round-trips arbitrary bytes through base64url', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  it('encodes and decodes share hashes', async () => {
    const hash = await encodeShareHash('{a: 1,}');
    expect(hash.startsWith('#json=')).toBe(true);
    expect(await decodeShareHash(hash)).toBe('{a: 1,}');
  });

  it('ignores unrelated or corrupt hashes', async () => {
    expect(await decodeShareHash('#section-2')).toBeNull();
    expect(await decodeShareHash('#json=!!!not-valid')).toBeNull();
  });
});

describe('repair kind metadata', () => {
  it('has a category and label for each kind', () => {
    expect(repairCategory('trailing-comma')).toBe('structure');
    expect(repairCategory('code-fence')).toBe('wrapper');
    expect(repairLabel('smart-quotes')).toBe('Smart quotes');
  });
});

describe('bundled examples', () => {
  it.each(EXAMPLES.map((e) => [e.label, e] as const))('"%s" repairs to valid JSON', (_label, example) => {
    const result = repairJson(example.input);
    expect(result.ok).toBe(true);
    expect(() => JSON.parse(formatJson(result.value!))).not.toThrow();
    if (example.id === 'valid') expect(result.valid).toBe(true);
    else expect(result.repairs.length).toBeGreaterThan(0);
  });

  it('the truncated example is detected as truncated', () => {
    const result = repairJson(EXAMPLES.find((e) => e.id === 'truncated')!.input);
    expect(result.repairs.map((r) => r.kind)).toEqual(['unclosed-string', 'truncated']);
  });
});
