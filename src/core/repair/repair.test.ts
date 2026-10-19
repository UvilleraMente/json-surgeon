import { describe, expect, it } from 'vitest';
import { formatJson } from '../json/format';
import { repairJson } from './repair';
import type { RepairKind, RepairOptions } from './types';

/** Repairs `input` and returns minified output plus the kinds of repairs applied. */
function fix(input: string, options?: RepairOptions) {
  const result = repairJson(input, options);
  if (!result.ok || !result.value) throw new Error(`repair failed: ${result.error}`);
  const json = formatJson(result.value, { indent: 'minify' });
  // Whatever we produce must always be strictly valid JSON.
  expect(() => JSON.parse(json)).not.toThrow();
  return { json, kinds: result.repairs.map((r) => r.kind), result };
}

function expectFix(input: string, expected: string, kinds?: RepairKind[]) {
  const { json, kinds: actual } = fix(input);
  expect(json).toBe(expected);
  if (kinds) expect(actual).toEqual(kinds);
}

describe('valid JSON', () => {
  it.each([
    ['{"a":1,"b":[true,false,null],"c":"x"}'],
    ['[]'],
    ['{}'],
    ['"just a string"'],
    ['42'],
    ['-0.5e10'],
    ['null'],
    ['{"nested":{"deep":[{"x":"\\n\\"q\\"","e":"é"}]}}'],
  ])('passes %s through unchanged', (input) => {
    const { json, result } = fix(input);
    expect(json).toBe(input);
    expect(result.valid).toBe(true);
    expect(result.repairs).toHaveLength(0);
    expect(result.summary).toBe('Valid JSON — no repairs needed');
  });

  it('accepts surrounding whitespace and pretty printing', () => {
    const { result } = fix('\n  {\n    "a": [1, 2]\n  }\n');
    expect(result.valid).toBe(true);
  });

  it('preserves big integers exactly', () => {
    expectFix('{"id": 12345678901234567890123}', '{"id":12345678901234567890123}', []);
  });
});

describe('commas', () => {
  it('removes a trailing comma in an object', () => {
    expectFix('{"a": 1, "b": 2,}', '{"a":1,"b":2}', ['trailing-comma']);
  });

  it('removes a trailing comma in an array', () => {
    expectFix('[1, 2, 3,]', '[1,2,3]', ['trailing-comma']);
  });

  it('removes trailing commas in nested structures', () => {
    expectFix('{"a": [1,], "b": {"c": 1,},}', '{"a":[1],"b":{"c":1}}', ['trailing-comma', 'trailing-comma', 'trailing-comma']);
  });

  it('inserts a missing comma between array items', () => {
    expectFix('[1 2 3]', '[1,2,3]', ['missing-comma', 'missing-comma']);
  });

  it('inserts a missing comma between members on separate lines', () => {
    expectFix('{\n  "a": 1\n  "b": 2\n}', '{"a":1,"b":2}', ['missing-comma']);
  });

  it('inserts a missing comma between strings', () => {
    expectFix('["a" "b"]', '["a","b"]', ['missing-comma']);
  });

  it('removes double and leading commas', () => {
    expectFix('[,1,,2]', '[1,2]', ['extra-comma', 'extra-comma']);
    expectFix('{,"a":1}', '{"a":1}', ['extra-comma']);
  });

  it('places the missing-comma repair right after the previous value', () => {
    const { result } = fix('{"a": 1 "b": 2}');
    expect(result.repairs[0]).toMatchObject({ offset: 7, length: 0, before: '', after: ',', line: 1, column: 8 });
  });
});

describe('comments', () => {
  it('removes // line comments', () => {
    expectFix('{\n  // the id\n  "id": 1 // trailing\n}', '{"id":1}', ['comment', 'comment']);
  });

  it('removes /* block */ comments', () => {
    expectFix('{/* a\nmulti-line */"a": /* inline */ 1}', '{"a":1}', ['comment', 'comment']);
  });

  it('removes # comments', () => {
    expectFix('# config\n{"a": 1} # done', '{"a":1}', ['comment', 'comment']);
  });

  it('removes an unterminated block comment at the end', () => {
    expectFix('{"a": 1} /* oops', '{"a":1}', ['comment']);
  });

  it('does not treat // inside strings as comments', () => {
    expectFix('{"url": "https://example.com/#x"}', '{"url":"https://example.com/#x"}', []);
  });
});

describe('quotes and keys', () => {
  it('converts single-quoted strings', () => {
    expectFix("{'name': 'Ada'}", '{"name":"Ada"}', ['single-quotes', 'single-quotes']);
  });

  it('escapes double quotes inside single-quoted strings', () => {
    expectFix(`['say "hi"']`, '["say \\"hi\\""]');
  });

  it('keeps apostrophes inside single-quoted strings', () => {
    expectFix(`{'msg': 'It's fine'}`, `{"msg":"It's fine"}`);
  });

  it('quotes unquoted keys', () => {
    expectFix('{name: "Ada", age_years: 36, $id: 1}', '{"name":"Ada","age_years":36,"$id":1}', [
      'unquoted-key',
      'unquoted-key',
      'unquoted-key',
    ]);
  });

  it('quotes unquoted numeric and dashed keys', () => {
    expectFix('{1: "a", first-name: "b"}', '{"1":"a","first-name":"b"}', ['unquoted-key', 'unquoted-key']);
  });

  it('replaces smart quotes', () => {
    expectFix('{“name”: “Ada”, ‘role’: ‘admin’}', '{"name":"Ada","role":"admin"}', [
      'smart-quotes',
      'smart-quotes',
      'smart-quotes',
      'smart-quotes',
    ]);
  });

  it('converts backtick strings', () => {
    expectFix('{"a": `tpl`}', '{"a":"tpl"}', ['single-quotes']);
  });

  it('quotes unquoted string values', () => {
    expectFix('{status: active, note: hello world}', '{"status":"active","note":"hello world"}');
  });

  it('escapes unescaped double quotes inside a string', () => {
    expectFix('{"quote": "He said "hi" to me"}', '{"quote":"He said \\"hi\\" to me"}', ['unescaped-quote', 'unescaped-quote']);
  });
});

describe('literals and numbers', () => {
  it('converts Python literals', () => {
    expectFix('{"a": True, "b": False, "c": None}', '{"a":true,"b":false,"c":null}', [
      'python-literal',
      'python-literal',
      'python-literal',
    ]);
  });

  it('replaces undefined, NaN and Infinity with null', () => {
    expectFix('[undefined, NaN, Infinity, -Infinity]', '[null,null,null,null]', ['js-literal', 'js-literal', 'js-literal', 'js-literal']);
  });

  it('explains why NaN becomes null', () => {
    const { result } = fix('{"x": NaN}');
    expect(result.repairs[0].message).toContain('NaN');
    expect(result.repairs[0].message).toContain('null');
  });

  it('lower-cases upper-case literals', () => {
    expectFix('[TRUE, FALSE, NULL]', '[true,false,null]', ['literal-case', 'literal-case', 'literal-case']);
  });

  it('removes a leading plus sign', () => {
    expectFix('[+1, +2.5]', '[1,2.5]', ['number-format', 'number-format']);
  });

  it('removes leading zeros', () => {
    expectFix('{"zip": 007, "x": 00.5}', '{"zip":7,"x":0.5}', ['number-format', 'number-format']);
  });

  it('converts hex, octal and binary numbers', () => {
    expectFix('[0xFF, 0o17, 0b101, -0x10]', '[255,15,5,-16]');
  });

  it('fixes .5 and 5. forms', () => {
    expectFix('[.5, 5., -.25]', '[0.5,5,-0.25]', ['number-format', 'number-format', 'number-format']);
  });

  it('removes digit separators', () => {
    expectFix('[1_000_000]', '[1000000]', ['number-format']);
  });

  it('wraps impossible numbers in quotes', () => {
    expectFix('{"version": 1.2.3}', '{"version":"1.2.3"}', ['unquoted-string']);
  });

  it('converts Python tuples to arrays', () => {
    expectFix("{'point': (1, 2)}", '{"point":[1,2]}');
  });

  it('unwraps MongoDB-style calls', () => {
    expectFix('{"_id": ObjectId("507f1f77"), "n": NumberLong(5)}', '{"_id":"507f1f77","n":5}', [
      'unwrapped-call',
      'unwrapped-call',
    ]);
  });
});

describe('string contents', () => {
  it('escapes raw newlines and tabs inside strings', () => {
    expectFix('{"text": "line 1\nline 2\tend"}', '{"text":"line 1\\nline 2\\tend"}', ['control-character', 'control-character']);
  });

  it('keeps invalid escapes as literal backslashes', () => {
    expectFix('{"path": "C:\\Users\\dev"}', '{"path":"C:\\\\Users\\\\dev"}', ['invalid-escape', 'invalid-escape']);
  });

  it('converts \\x escapes and drops needless \\\' escapes', () => {
    expectFix('["\\x41", "it\\\'s"]', '["A","it\'s"]', ['invalid-escape', 'invalid-escape']);
  });

  it('decodes valid unicode escapes', () => {
    expectFix('{"e": "\\u00e9"}', '{"e":"é"}', []);
  });
});

describe('LLM output', () => {
  const fenced = 'Sure! Here is the JSON you asked for:\n\n```json\n{"name": "Ada", "skills": ["math",],}\n```\n\nLet me know if you need anything else.';

  it('extracts JSON from a markdown code fence with chatter', () => {
    const { json, kinds } = fix(fenced);
    expect(json).toBe('{"name":"Ada","skills":["math"]}');
    expect(kinds).toEqual(['leading-text', 'code-fence', 'trailing-comma', 'trailing-comma', 'code-fence', 'trailing-text']);
  });

  it('reports the language of the fence', () => {
    const { result } = fix('```json\n{"a":1}\n```');
    expect(result.repairs[0].message).toContain('json');
    expect(result.repairs.map((r) => r.kind)).toEqual(['code-fence', 'code-fence']);
  });

  it('handles a fence that was never closed', () => {
    expectFix('```json\n{"a": [1, 2', '{"a":[1,2]}', ['code-fence', 'truncated']);
  });

  it('skips chatter before the JSON without a fence', () => {
    expectFix('Here you go: {"ok": true}', '{"ok":true}', ['leading-text']);
  });

  it('ignores chatter after the JSON', () => {
    const { json, result } = fix('{"ok": true}\nHope this helps!');
    expect(json).toBe('{"ok":true}');
    expect(result.repairs[0]).toMatchObject({ kind: 'trailing-text', line: 2, column: 1 });
  });

  it('keeps only the first of multiple JSON blobs and says so', () => {
    const { json, result } = fix('{"a": 1}\n{"b": 2}\n{"c": 3}');
    expect(json).toBe('{"a":1}');
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].kind).toBe('multiple-values');
    expect(result.repairs[0].message).toContain('2 more JSON values');
  });

  it('wraps JSON Lines in an array when asked to', () => {
    const { json, kinds } = fix('{"a": 1}\n{"b": 2,}\n', { multipleValues: 'array' });
    expect(json).toBe('[{"a":1},{"b":2}]');
    expect(kinds).toEqual(['multiple-values', 'trailing-comma']);
  });

  it('handles JSONP-style wrappers', () => {
    expectFix('callback({"a": 1});', '{"a":1}', ['leading-text', 'trailing-text']);
  });

  it('removes "..." placeholders', () => {
    expectFix('[1, 2, ...]', '[1,2]', ['trailing-comma', 'ellipsis']);
  });
});

describe('truncated JSON', () => {
  it('closes unclosed objects and arrays at EOF', () => {
    const { json, result } = fix('{"users": [{"id": 1}, {"id": 2');
    expect(json).toBe('{"users":[{"id":1},{"id":2}]}');
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toMatchObject({ kind: 'truncated', after: '}]}' });
    expect(result.repairs[0].message).toContain('2 objects and 1 array');
  });

  it('closes an unterminated string', () => {
    expectFix('{"name": "Ad', '{"name":"Ad"}', ['unclosed-string', 'truncated']);
  });

  it('fills in a missing value after a dangling key', () => {
    expectFix('{"a": 1, "b"', '{"a":1,"b":null}', ['truncated', 'truncated']);
  });

  it('fills in a missing value after a dangling colon', () => {
    expectFix('{"a":', '{"a":null}', ['truncated', 'truncated']);
  });

  it('handles a trailing comma right before EOF', () => {
    expectFix('[1, 2,', '[1,2]', ['trailing-comma', 'truncated']);
  });

  it('completes a truncated literal', () => {
    expectFix('[true, fal', '[true,false]', ['truncated', 'truncated']);
  });

  it('drops an incomplete number tail', () => {
    expectFix('[1.5, 2.', '[1.5,2]', ['truncated', 'truncated']);
    expectFix('[1e', '[1]');
  });
});

describe('brackets and structure', () => {
  it('inserts a missing } before ]', () => {
    expectFix('[{"a": 1]', '[{"a":1}]', ['mismatched-bracket']);
  });

  it('inserts a missing ] before }', () => {
    expectFix('{"a": [1, 2}', '{"a":[1,2]}', ['mismatched-bracket']);
  });

  it('replaces a wrong closing bracket', () => {
    expectFix('{"a": 1]', '{"a":1}', ['mismatched-bracket']);
  });

  it('inserts a missing colon', () => {
    expectFix('{"a" 1}', '{"a":1}', ['missing-colon']);
  });

  it('fills a missing value with null', () => {
    expectFix('{"a": , "b": 2}', '{"a":null,"b":2}', ['missing-value']);
    expectFix('{"a"}', '{"a":null}', ['missing-value']);
  });

  it('removes stray characters', () => {
    expectFix('{"a": 1; "b": 2}', '{"a":1,"b":2}', ['unexpected-character', 'missing-comma']);
  });

  it('removes a BOM and non-breaking spaces', () => {
    expectFix('\uFEFF{"a":\u00A01}', '{"a":1}', ['whitespace', 'whitespace']);
  });
});

describe('positions and messages', () => {
  it('reports 1-based line and column in the original input', () => {
    const { result } = fix('{\n  "a": 1,\n  "b": 2,\n}');
    expect(result.repairs[0]).toMatchObject({ kind: 'trailing-comma', line: 3, column: 9, offset: 20, length: 1, before: ',', after: '' });
  });

  it('reports offsets relative to the original input even inside a fence', () => {
    const input = 'Answer:\n```json\n{"a": True}\n```';
    const { result } = fix(input);
    const literal = result.repairs.find((r) => r.kind === 'python-literal');
    expect(literal).toBeDefined();
    expect(input.slice(literal!.offset, literal!.offset + literal!.length)).toBe('True');
    expect(literal).toMatchObject({ line: 3, column: 7 });
  });

  it('returns repairs sorted by offset', () => {
    const { result } = fix("{a: 'x', b: True, // c\n}");
    const offsets = result.repairs.map((r) => r.offset);
    expect(offsets).toEqual([...offsets].sort((x, y) => x - y));
  });

  it('summarizes the number of repairs', () => {
    expect(fix('[1,2,]').result.summary).toBe('Repaired 1 issue');
    expect(fix('[1,2,,]').result.summary).toBe('Repaired 2 issues');
  });

  it('shortens long "before" excerpts', () => {
    const { result } = fix('// ' + 'x'.repeat(500) + '\n{}');
    expect(result.repairs[0].before.length).toBeLessThanOrEqual(80);
    expect(result.repairs[0].length).toBe(503);
  });
});

describe('failures and robustness', () => {
  it('reports empty input', () => {
    const result = repairJson('   \n ');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('reports input without any JSON', () => {
    const result = repairJson('Hello there, no data today.');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No JSON/);
  });

  it('survives a kitchen-sink of problems at once', () => {
    const input = `Here is your data:
\`\`\`json
{
  // user record
  id: 0x1F,
  'name': “Ada Lovelace”,
  active: True,
  score: NaN,
  tags: ['math', 'poetry',],
  bio: "Line one
line two",
  meta: {created: +007}
  extra: undefined,
`;
    const { result, json } = fix(input);
    expect(JSON.parse(json)).toEqual({
      id: 31,
      name: 'Ada Lovelace',
      active: true,
      score: null,
      tags: ['math', 'poetry'],
      bio: 'Line one\nline two',
      meta: { created: 7 },
      extra: null,
    });
    expect(result.repairs.length).toBeGreaterThan(10);
  });

  it('reports progress for large inputs', () => {
    const big = '[' + Array.from({ length: 30000 }, (_, i) => `{"i": ${i}}`).join(',') + ']';
    const seen: number[] = [];
    const result = repairJson(big, { onProgress: (f) => seen.push(f) });
    expect(result.valid).toBe(true);
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.at(-1)).toBe(1);
  });

  it('never produces invalid JSON for random garbage', () => {
    const alphabet = '{}[]:,"\' \n0123abcTrueNone/#*\\-+.`';
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 500; n++) {
      const len = 1 + Math.floor(rand() * 40);
      let s = '{';
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
      const result = repairJson(s);
      if (result.ok && result.value) {
        expect(() => JSON.parse(formatJson(result.value!))).not.toThrow();
        for (const r of result.repairs) {
          expect(r.offset).toBeGreaterThanOrEqual(0);
          expect(r.offset).toBeLessThanOrEqual(s.length);
        }
      }
    }
  });
});
