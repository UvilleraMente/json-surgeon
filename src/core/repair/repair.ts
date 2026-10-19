import { NULL_NODE, type JsonMember, type JsonNode } from '../json/ast';
import type { Repair, RepairKind, RepairOptions, RepairResult } from './types';

/**
 * Tolerant JSON parser that repairs common mistakes and explains every fix.
 *
 * It is a hand-written recursive-descent parser working directly on the
 * original text (no regex rewriting), so every repair can be located
 * precisely in the user's input. It never throws on malformed input: it
 * always recovers *something* and records what it changed.
 */
export function repairJson(input: string, options: RepairOptions = {}): RepairResult {
  if (input.trim() === '') {
    return failure('Input is empty — paste some JSON (or something close to it).');
  }
  try {
    return new RepairParser(input, options).run();
  } catch (err) {
    if (err instanceof RangeError) {
      return failure('Input is nested too deeply to process.');
    }
    if (err instanceof NoJsonFoundError) {
      return failure(err.message);
    }
    throw err;
  }
}

class NoJsonFoundError extends Error {}

function failure(error: string): RepairResult {
  return { ok: false, valid: false, value: null, repairs: [], summary: error, error };
}

interface RawRepair {
  kind: RepairKind;
  offset: number;
  length: number;
  message: string;
  after: string;
}

type ContainerKind = 'object' | 'array' | 'tuple';

const MAX_BEFORE_LENGTH = 80;
const PROGRESS_STEP = 1 << 16;

const DOUBLE_QUOTE_CLOSERS = '"';
const SINGLE_QUOTE_CLOSERS = "'";
const SMART_DOUBLE_CLOSERS = '”“"';
const SMART_SINGLE_CLOSERS = '’‘\'';
const BACKTICK_CLOSERS = '`';

const LITERAL_WORDS: Readonly<Record<string, { node: JsonNode; kind?: RepairKind; message?: string }>> = {
  true: { node: { type: 'boolean', value: true } },
  false: { node: { type: 'boolean', value: false } },
  null: { node: NULL_NODE },
  True: { node: { type: 'boolean', value: true }, kind: 'python-literal', message: 'Converted Python True to JSON true' },
  False: { node: { type: 'boolean', value: false }, kind: 'python-literal', message: 'Converted Python False to JSON false' },
  None: { node: NULL_NODE, kind: 'python-literal', message: 'Converted Python None to JSON null' },
  undefined: { node: NULL_NODE, kind: 'js-literal', message: 'Replaced undefined with null (JSON has no undefined)' },
  NaN: { node: NULL_NODE, kind: 'js-literal', message: 'Replaced NaN with null (JSON numbers cannot be NaN)' },
  Infinity: { node: NULL_NODE, kind: 'js-literal', message: 'Replaced Infinity with null (JSON numbers must be finite)' },
  TRUE: { node: { type: 'boolean', value: true }, kind: 'literal-case', message: 'Lower-cased TRUE to true' },
  FALSE: { node: { type: 'boolean', value: false }, kind: 'literal-case', message: 'Lower-cased FALSE to false' },
  NULL: { node: NULL_NODE, kind: 'literal-case', message: 'Lower-cased NULL to null' },
  Null: { node: NULL_NODE, kind: 'literal-case', message: 'Lower-cased Null to null' },
  nil: { node: NULL_NODE, kind: 'js-literal', message: 'Replaced nil with null' },
};

const TRUNCATABLE_LITERALS = ['true', 'false', 'null'] as const;

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_$]/u.test(ch);
}

function isWordStart(ch: string): boolean {
  return /[\p{L}_$]/u.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === '`' || ch === '“' || ch === '”' || ch === '‘' || ch === '’';
}

function isValueStart(ch: string): boolean {
  return (
    ch === '{' ||
    ch === '[' ||
    ch === '(' ||
    isQuote(ch) ||
    isDigit(ch) ||
    ch === '-' ||
    ch === '+' ||
    ch === '.' ||
    isWordStart(ch)
  );
}

function isKeyStart(ch: string): boolean {
  return isQuote(ch) || isWordChar(ch) || ch === '-';
}

function quoteForDisplay(text: string, max = 40): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

class RepairParser {
  private pos = 0;
  private end: number;
  private readonly raw: RawRepair[] = [];
  private readonly stack: ContainerKind[] = [];
  private pendingClosers: string[] = [];
  private nextProgress = PROGRESS_STEP;

  constructor(
    private readonly src: string,
    private readonly options: RepairOptions,
  ) {
    this.end = src.length;
  }

  run(): RepairResult {
    this.unwrapCodeFence();
    this.skipLeadingChatter();

    const value = this.handleRest(this.parseValue());

    if (this.pendingClosers.length > 0) {
      this.reportClosers();
    }

    this.options.onProgress?.(1);
    const repairs = this.finalizeRepairs();
    return {
      ok: true,
      valid: repairs.length === 0,
      value,
      repairs,
      summary:
        repairs.length === 0
          ? 'Valid JSON — no repairs needed'
          : `Repaired ${plural(repairs.length, 'issue')}`,
    };
  }

  // ---------------------------------------------------------------- reporting

  private report(kind: RepairKind, offset: number, length: number, message: string, after = ''): void {
    this.raw.push({ kind, offset, length, message, after });
  }

  private finalizeRepairs(): Repair[] {
    const lineStarts = computeLineStarts(this.src);
    const sorted = this.raw
      .map((r, i) => ({ r, i }))
      .sort((a, b) => a.r.offset - b.r.offset || a.i - b.i)
      .map(({ r }) => r);
    return sorted.map((r) => {
      const { line, column } = locate(lineStarts, r.offset);
      let before = this.src.slice(r.offset, r.offset + r.length);
      if (before.length > MAX_BEFORE_LENGTH) before = before.slice(0, MAX_BEFORE_LENGTH - 1) + '…';
      return { kind: r.kind, message: r.message, line, column, offset: r.offset, length: r.length, before, after: r.after };
    });
  }

  private progress(): void {
    if (this.options.onProgress && this.pos >= this.nextProgress) {
      this.nextProgress = this.pos + PROGRESS_STEP;
      this.options.onProgress(this.pos / this.src.length);
    }
  }

  // ------------------------------------------------------------ LLM wrappers

  /** Strips a Markdown code fence (```json ... ```) around the payload. */
  private unwrapCodeFence(): void {
    const firstIdx = this.src.search(/\S/);
    const firstCh = this.src[firstIdx];
    if (firstCh === '{' || firstCh === '[' || firstCh === '"') return;

    const open = /```[ \t]*([\w+.-]*)[^\n]*\r?\n?/.exec(this.src);
    if (!open) return;

    const bodyStart = open.index + open[0].length;
    if (open.index > firstIdx) {
      const lead = this.src.slice(firstIdx, open.index);
      this.report(
        'leading-text',
        firstIdx,
        lead.trimEnd().length,
        `Ignored text before the code block: “${quoteForDisplay(lead)}”`,
      );
    }
    const fenceText = open[0].trimEnd();
    const lang = open[1] ? ` (${open[1]})` : '';
    this.report('code-fence', open.index, fenceText.length, `Removed Markdown code fence${lang}`);

    const close = this.src.indexOf('```', bodyStart);
    if (close >= 0) {
      this.report('code-fence', close, 3, 'Removed closing code fence');
      const afterClose = close + 3;
      const restIdx = this.src.slice(afterClose).search(/\S/);
      if (restIdx >= 0) {
        const restStart = afterClose + restIdx;
        const rest = this.src.slice(restStart);
        const moreBlocks = rest.includes('```');
        this.report(
          'trailing-text',
          restStart,
          this.src.trimEnd().length - restStart,
          moreBlocks
            ? 'Ignored everything after the first code block (including another code block)'
            : `Ignored text after the code block: “${quoteForDisplay(rest)}”`,
        );
      }
      this.end = close;
    }
    this.pos = bodyStart;
  }

  /** Skips prose such as "Sure! Here is the JSON:" before the first value. */
  private skipLeadingChatter(): void {
    this.skipTrivia();
    if (this.pos >= this.end) {
      throw new NoJsonFoundError('No JSON value found in the input.');
    }
    if (this.canStartDocument()) return;

    const start = this.pos;
    let idx = -1;
    for (let i = start; i < this.end; i++) {
      const ch = this.src[i];
      if (ch === '{' || ch === '[') {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      throw new NoJsonFoundError('No JSON object or array found in the input.');
    }
    this.report(
      'leading-text',
      start,
      this.src.slice(start, idx).trimEnd().length,
      `Ignored text before the JSON: “${quoteForDisplay(this.src.slice(start, idx))}”`,
    );
    this.pos = idx;
  }

  private canStartDocument(): boolean {
    const ch = this.src[this.pos];
    if (ch === '{' || ch === '[' || isQuote(ch) || isDigit(ch) || ch === '-' || ch === '+' || ch === '.') {
      // A lone back-tick or apostrophe usually belongs to prose ("Here's..."), but
      // ch at document start being a quote is good enough evidence of a value.
      return true;
    }
    if (isWordStart(ch)) {
      const word = this.peekWord(this.pos);
      return word in LITERAL_WORDS && !/[\p{L}\p{N}_$ ]/u.test(this.src[this.pos + word.length] ?? '');
    }
    return false;
  }

  /** Handles whatever follows the first top-level value. */
  private handleRest(first: JsonNode): JsonNode {
    const mode = this.options.multipleValues ?? 'first';
    const extras: JsonNode[] = [];
    let extrasStart = -1;
    let extrasEnd = -1;

    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.end) break;
      let ch = this.src[this.pos];
      if (ch === ',') {
        const commaPos = this.pos;
        this.pos++;
        this.skipTrivia();
        ch = this.src[this.pos];
        if (this.pos >= this.end || (ch !== '{' && ch !== '[')) {
          this.pos = commaPos;
          ch = ',';
        }
      }
      if (ch === '{' || ch === '[') {
        if (extrasStart < 0) extrasStart = this.pos;
        if (mode === 'array') {
          extras.push(this.parseValue());
        } else {
          // Parse to find where it ends, but don't report its internal repairs.
          const repairsBefore = this.raw.length;
          const closersBefore = this.pendingClosers.length;
          extras.push(this.parseValue());
          this.raw.length = repairsBefore;
          this.pendingClosers.length = closersBefore;
        }
        extrasEnd = this.pos;
        continue;
      }
      const text = this.src.slice(this.pos, this.end);
      this.report(
        'trailing-text',
        this.pos,
        text.trimEnd().length,
        `Ignored text after the JSON: “${quoteForDisplay(text)}”`,
      );
      this.pos = this.end;
      break;
    }

    if (extras.length === 0) return first;
    if (mode === 'array') {
      this.report(
        'multiple-values',
        extrasStart,
        extrasEnd - extrasStart,
        `Found ${extras.length + 1} top-level JSON values; wrapped them all in an array`,
        '[…]',
      );
      return { type: 'array', items: [first, ...extras] };
    }
    this.report(
      'multiple-values',
      extrasStart,
      extrasEnd - extrasStart,
      `Found ${plural(extras.length, 'more JSON value')} after the first one; kept only the first ` +
        '(enable “Wrap multiple values in an array” to keep them all)',
    );
    return first;
  }

  private reportClosers(): void {
    const closers = this.pendingClosers.join('');
    const objects = closers.split('').filter((c) => c === '}').length;
    const arrays = closers.length - objects;
    const parts: string[] = [];
    if (objects) parts.push(plural(objects, 'object'));
    if (arrays) parts.push(plural(arrays, 'array'));
    this.report(
      'truncated',
      this.end,
      0,
      `Input ended unexpectedly; appended ${closers} to close ${parts.join(' and ')}`,
      closers,
    );
  }

  // ------------------------------------------------------------------ trivia

  private skipTrivia(): void {
    const src = this.src;
    while (this.pos < this.end) {
      const ch = src[this.pos];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
        this.pos++;
        continue;
      }
      if (ch === '﻿') {
        this.report('whitespace', this.pos, 1, 'Removed byte order mark (BOM)');
        this.pos++;
        continue;
      }
      if (ch === ' ' || ch === ' ' || ch === ' ' || ch === '​') {
        const name =
          ch === ' ' ? 'non-breaking space' : ch === '​' ? 'zero-width space' : 'Unicode line separator';
        this.report('whitespace', this.pos, 1, `Replaced ${name} with regular whitespace`);
        this.pos++;
        continue;
      }
      if (ch === '/' && src[this.pos + 1] === '/') {
        const start = this.pos;
        const nl = src.indexOf('\n', start);
        this.pos = nl < 0 || nl > this.end ? this.end : nl;
        this.report('comment', start, src.slice(start, this.pos).trimEnd().length, 'Removed // line comment');
        continue;
      }
      if (ch === '/' && src[this.pos + 1] === '*') {
        const start = this.pos;
        const close = src.indexOf('*/', start + 2);
        if (close < 0 || close + 2 > this.end) {
          this.pos = this.end;
          this.report('comment', start, this.end - start, 'Removed unterminated /* block comment */');
        } else {
          this.pos = close + 2;
          this.report('comment', start, this.pos - start, 'Removed /* block comment */');
        }
        continue;
      }
      if (ch === '#') {
        const start = this.pos;
        const nl = src.indexOf('\n', start);
        this.pos = nl < 0 || nl > this.end ? this.end : nl;
        this.report('comment', start, src.slice(start, this.pos).trimEnd().length, 'Removed # comment');
        continue;
      }
      if (ch === '…' || (ch === '.' && src.startsWith('...', this.pos))) {
        const len = ch === '…' ? 1 : 3;
        // Only treat it as a placeholder when it is not the start of a number like ".5".
        this.report('ellipsis', this.pos, len, `Removed “${src.slice(this.pos, this.pos + len)}” placeholder`);
        this.pos += len;
        continue;
      }
      break;
    }
  }

  // ------------------------------------------------------------------ values

  private parseValue(): JsonNode {
    for (;;) {
      this.skipTrivia();
      this.progress();
      if (this.pos >= this.end) {
        this.report('truncated', this.end, 0, 'Input ended where a value was expected; inserted null', 'null');
        return NULL_NODE;
      }
      const ch = this.src[this.pos];
      if (ch === '{') return this.parseObject();
      if (ch === '[') return this.parseArray('array');
      if (ch === '(') return this.parseArray('tuple');
      if (isQuote(ch)) return { type: 'string', value: this.parseString(false) };
      if (isDigit(ch) || ch === '-' || ch === '+' || ch === '.') return this.parseNumber();
      if (isWordStart(ch)) return this.parseWord();
      if (ch === '}' || ch === ']' || ch === ')' || ch === ',' || ch === ':') {
        this.report('missing-value', this.pos, 0, 'Missing value; inserted null', 'null');
        return NULL_NODE;
      }
      this.report('unexpected-character', this.pos, 1, `Removed unexpected character “${ch}”`);
      this.pos++;
    }
  }

  private parseObject(): JsonNode {
    this.pos++; // {
    this.stack.push('object');
    const members: JsonMember[] = [];
    let expectingMember = true;
    let lastComma = -1;
    let lastValueEnd = this.pos;

    const reportTrailingComma = (): void => {
      if (lastComma >= 0) {
        this.report('trailing-comma', lastComma, 1, 'Removed trailing comma before the end of the object');
      }
    };

    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.end) {
        reportTrailingComma();
        this.pendingClosers.push('}');
        break;
      }
      const ch = this.src[this.pos];
      if (ch === '}') {
        reportTrailingComma();
        this.pos++;
        break;
      }
      if (ch === ']' || ch === ')') {
        reportTrailingComma();
        if (this.hasAncestor('array', 'tuple')) {
          this.report('mismatched-bracket', this.pos, 0, `Inserted missing “}” before “${ch}”`, '}');
        } else {
          this.report('mismatched-bracket', this.pos, 1, `Replaced “${ch}” with “}” to close the object`, '}');
          this.pos++;
        }
        break;
      }
      if (ch === ',') {
        if (expectingMember) {
          this.report(
            'extra-comma',
            this.pos,
            1,
            members.length === 0 ? 'Removed leading comma in object' : 'Removed extra comma',
          );
        } else {
          lastComma = this.pos;
          expectingMember = true;
        }
        this.pos++;
        continue;
      }
      if (!expectingMember) {
        if (isKeyStart(ch)) {
          this.report('missing-comma', lastValueEnd, 0, 'Inserted missing comma between object members', ',');
        } else {
          this.report('unexpected-character', this.pos, 1, `Removed unexpected character “${ch}”`);
          this.pos++;
          continue;
        }
      }

      const key = this.parseKey();
      if (key === null) {
        this.report('unexpected-character', this.pos, 1, `Removed unexpected character “${ch}”`);
        this.pos++;
        continue;
      }
      const keyEnd = this.pos;
      lastComma = -1;
      expectingMember = false;

      this.skipTrivia();
      if (this.pos >= this.end) {
        this.report(
          'truncated',
          this.end,
          0,
          `Input ended after key “${quoteForDisplay(key)}”; set its value to null`,
          ': null',
        );
        members.push({ key, value: NULL_NODE });
        lastValueEnd = this.pos;
        continue;
      }
      const sep = this.src[this.pos];
      if (sep === ':') {
        this.pos++;
      } else if (sep === '=') {
        this.report('missing-colon', this.pos, 1, 'Replaced “=” with “:” between key and value', ':');
        this.pos++;
      } else if (sep === ',' || sep === '}') {
        this.report(
          'missing-value',
          keyEnd,
          0,
          `Key “${quoteForDisplay(key)}” has no value; inserted null`,
          ': null',
        );
        members.push({ key, value: NULL_NODE });
        lastValueEnd = keyEnd;
        continue;
      } else {
        this.report('missing-colon', keyEnd, 0, `Inserted missing colon after key “${quoteForDisplay(key)}”`, ':');
      }
      const value = this.parseValue();
      members.push({ key, value });
      lastValueEnd = this.pos;
    }

    this.stack.pop();
    return { type: 'object', members };
  }

  private parseArray(kind: 'array' | 'tuple'): JsonNode {
    const open = this.pos;
    const closer = kind === 'tuple' ? ')' : ']';
    this.pos++;
    this.stack.push(kind);
    const items: JsonNode[] = [];
    let expectingItem = true;
    let lastComma = -1;
    let lastValueEnd = this.pos;

    const reportTrailingComma = (): void => {
      if (lastComma >= 0) {
        this.report('trailing-comma', lastComma, 1, 'Removed trailing comma before the end of the array');
      }
    };

    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.end) {
        reportTrailingComma();
        this.pendingClosers.push(']');
        break;
      }
      const ch = this.src[this.pos];
      if (ch === closer) {
        reportTrailingComma();
        if (kind === 'tuple') {
          this.report('python-tuple', open, 1, 'Converted Python tuple ( … ) to a JSON array', '[');
          this.report('python-tuple', this.pos, 1, 'Closed converted tuple with “]”', ']');
        }
        this.pos++;
        break;
      }
      if (ch === '}' || ch === ']' || ch === ')') {
        reportTrailingComma();
        if (ch === '}' && this.hasAncestor('object')) {
          this.report('mismatched-bracket', this.pos, 0, 'Inserted missing “]” before “}”', ']');
        } else {
          this.report('mismatched-bracket', this.pos, 1, `Replaced “${ch}” with “]” to close the array`, ']');
          this.pos++;
        }
        break;
      }
      if (ch === ',') {
        if (expectingItem) {
          this.report(
            'extra-comma',
            this.pos,
            1,
            items.length === 0 ? 'Removed leading comma in array' : 'Removed extra comma (empty array slot)',
          );
        } else {
          lastComma = this.pos;
          expectingItem = true;
        }
        this.pos++;
        continue;
      }
      if (!expectingItem) {
        if (isValueStart(ch)) {
          this.report('missing-comma', lastValueEnd, 0, 'Inserted missing comma between array items', ',');
        } else {
          this.report('unexpected-character', this.pos, 1, `Removed unexpected character “${ch}”`);
          this.pos++;
          continue;
        }
      }
      if (!isValueStart(ch)) {
        this.report('unexpected-character', this.pos, 1, `Removed unexpected character “${ch}”`);
        this.pos++;
        continue;
      }
      items.push(this.parseValue());
      lastValueEnd = this.pos;
      lastComma = -1;
      expectingItem = false;
    }

    this.stack.pop();
    return { type: 'array', items };
  }

  private hasAncestor(...kinds: ContainerKind[]): boolean {
    for (let i = this.stack.length - 2; i >= 0; i--) {
      if (kinds.includes(this.stack[i])) return true;
    }
    return false;
  }

  private parseKey(): string | null {
    const ch = this.src[this.pos];
    if (isQuote(ch)) return this.parseString(true);
    if (isWordChar(ch) || ch === '-') {
      const start = this.pos;
      while (this.pos < this.end && (isWordChar(this.src[this.pos]) || this.src[this.pos] === '-')) {
        this.pos++;
      }
      const key = this.src.slice(start, this.pos);
      this.report('unquoted-key', start, key.length, `Added double quotes around key ${key}`, JSON.stringify(key));
      return key;
    }
    return null;
  }

  private parseString(isKey: boolean): string {
    const src = this.src;
    const start = this.pos;
    const open = src[start];
    let closers: string;
    switch (open) {
      case '"':
        closers = DOUBLE_QUOTE_CLOSERS;
        break;
      case "'":
        closers = SINGLE_QUOTE_CLOSERS;
        break;
      case '`':
        closers = BACKTICK_CLOSERS;
        break;
      case '“':
      case '”':
        closers = SMART_DOUBLE_CLOSERS;
        break;
      default:
        closers = SMART_SINGLE_CLOSERS;
    }
    this.pos++;

    let value = '';
    let segment = this.pos;
    let closed = false;

    while (this.pos < this.end) {
      const ch = src[this.pos];
      if (closers.includes(ch)) {
        if (!isKey && (open === '"' || open === "'") && this.looksLikeInnerQuote(this.pos, ch)) {
          if (open === '"') {
            this.report('unescaped-quote', this.pos, 1, 'Escaped an unescaped double quote inside a string', '\\"');
          }
          this.pos++;
          continue;
        }
        value += src.slice(segment, this.pos);
        this.pos++;
        closed = true;
        break;
      }
      if (ch === '\\') {
        value += src.slice(segment, this.pos);
        value += this.parseEscape(open);
        segment = this.pos;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        const what =
          ch === '\n' ? 'raw line break' : ch === '\r' ? 'raw carriage return' : ch === '\t' ? 'raw tab' : `control character U+${code.toString(16).padStart(4, '0').toUpperCase()}`;
        this.report('control-character', this.pos, 1, `Escaped ${what} inside string`, JSON.stringify(ch).slice(1, -1));
      }
      this.pos++;
    }

    if (!closed) {
      value += src.slice(segment, this.pos);
      this.report('unclosed-string', this.end, 0, 'Closed unterminated string (input ended inside a string)', '"');
    }

    if (open === "'") {
      this.report('single-quotes', start, this.pos - start, 'Replaced single quotes with double quotes', JSON.stringify(value));
    } else if (open === '`') {
      this.report('single-quotes', start, this.pos - start, 'Replaced backtick quotes with double quotes', JSON.stringify(value));
    } else if (open !== '"') {
      this.report('smart-quotes', start, this.pos - start, 'Replaced typographic quotes with straight double quotes', JSON.stringify(value));
    }
    return value;
  }

  /**
   * Decides whether a quote that would normally close a string is really an
   * unescaped quote inside it, e.g. `"He said "hi" to me"`. It is treated as
   * content when it is followed by more text on the same line that ends with a
   * matching quote right before a delimiter, with no comma in between.
   */
  private looksLikeInnerQuote(q: number, quote: string): boolean {
    const src = this.src;
    let i = q + 1;
    while (i < this.end && (src[i] === ' ' || src[i] === '\t')) i++;
    if (i >= this.end) return false;
    const next = src[i];
    if (',:}])\n\r/#'.includes(next) || isQuote(next)) return false;
    for (let j = q + 1; j < this.end; j++) {
      const c = src[j];
      if (c === '\n' || c === ',') return false;
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === quote) {
        let k = j + 1;
        while (k < this.end && (src[k] === ' ' || src[k] === '\t')) k++;
        if (k >= this.end || ',:}]\n\r'.includes(src[k])) return true;
      }
    }
    return false;
  }

  /** Parses an escape sequence at `this.pos` (a backslash) and returns the decoded text. */
  private parseEscape(open: string): string {
    const src = this.src;
    const at = this.pos;
    const next = src[at + 1];
    if (at + 1 >= this.end) {
      this.pos++;
      return '';
    }
    switch (next) {
      case '"':
      case '\\':
      case '/':
        this.pos += 2;
        return next;
      case 'b':
        this.pos += 2;
        return '\b';
      case 'f':
        this.pos += 2;
        return '\f';
      case 'n':
        this.pos += 2;
        return '\n';
      case 'r':
        this.pos += 2;
        return '\r';
      case 't':
        this.pos += 2;
        return '\t';
      case 'u': {
        const hex = src.slice(at + 2, at + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.pos += 6;
          return String.fromCharCode(parseInt(hex, 16));
        }
        this.report('invalid-escape', at, 2, 'Invalid \\u escape (needs 4 hex digits); kept the backslash literally', '\\\\u');
        this.pos += 1;
        return '\\';
      }
      case "'":
        if (open === '"') {
          this.report('invalid-escape', at, 2, "Removed unnecessary backslash before ' (not a valid JSON escape)", "'");
        }
        this.pos += 2;
        return "'";
      case 'x': {
        const hex = src.slice(at + 2, at + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          this.report('invalid-escape', at, 4, `Converted \\x${hex} escape to \\u00${hex.toUpperCase()}`, `\\u00${hex.toUpperCase()}`);
          this.pos += 4;
          return String.fromCharCode(parseInt(hex, 16));
        }
        break;
      }
      case '\n':
        this.report('invalid-escape', at, 2, 'Removed backslash line continuation');
        this.pos += 2;
        return '';
    }
    const shown = next === '\r' ? '\\r' : next;
    this.report('invalid-escape', at, 2, `Invalid escape \\${shown}; kept the backslash literally`, `\\\\${shown}`);
    this.pos += 1;
    return '\\';
  }

  private parseNumber(): JsonNode {
    const src = this.src;
    const start = this.pos;
    let i = start;
    if (src[i] === '+' || src[i] === '-') i++;

    for (const word of ['Infinity', 'NaN'] as const) {
      if (src.startsWith(word, i)) {
        this.pos = i + word.length;
        const text = src.slice(start, this.pos);
        this.report(
          'js-literal',
          start,
          text.length,
          word === 'NaN'
            ? 'Replaced NaN with null (JSON numbers cannot be NaN)'
            : `Replaced ${text} with null (JSON numbers must be finite)`,
          'null',
        );
        return NULL_NODE;
      }
    }

    while (i < this.end) {
      const c = src[i];
      if (/[0-9A-Za-z_.]/.test(c)) {
        i++;
      } else if ((c === '+' || c === '-') && i > start) {
        i++;
      } else {
        break;
      }
    }
    // Do not swallow a trailing "..." placeholder into the number.
    const dots = src.slice(start, i).indexOf('...');
    if (dots > 0) i = start + dots;

    const raw = src.slice(start, i);
    this.pos = i;
    const atEof = i >= this.end;
    const normalized = normalizeNumber(raw, atEof);
    if (normalized === null) {
      if (raw === '-' || raw === '+') {
        this.report('truncated', start, raw.length, `Input ended inside a number; replaced “${raw}” with null`, 'null');
        return NULL_NODE;
      }
      this.report('unquoted-string', start, raw.length, `Wrapped invalid number ${raw} in quotes`, JSON.stringify(raw));
      return { type: 'string', value: raw };
    }
    if (normalized.notes.length > 0) {
      const kind: RepairKind = normalized.truncated ? 'truncated' : 'number-format';
      this.report(kind, start, raw.length, `Normalized number ${raw} → ${normalized.value}: ${normalized.notes.join('; ')}`, normalized.value);
    }
    return { type: 'number', raw: normalized.value };
  }

  private peekWord(at: number): string {
    let i = at;
    while (i < this.end && isWordChar(this.src[i])) i++;
    return this.src.slice(at, i);
  }

  private parseWord(): JsonNode {
    const start = this.pos;
    const word = this.peekWord(start);
    const after = start + word.length;

    const literal = Object.prototype.hasOwnProperty.call(LITERAL_WORDS, word) ? LITERAL_WORDS[word] : undefined;
    if (literal) {
      this.pos = after;
      if (literal.kind && literal.message) {
        const node = literal.node;
        const replacement = node.type === 'boolean' ? String(node.value) : 'null';
        this.report(literal.kind, start, word.length, literal.message, replacement);
      }
      return literal.node;
    }

    if (after >= this.end) {
      const completion = TRUNCATABLE_LITERALS.find((l) => l.startsWith(word));
      if (completion) {
        this.pos = after;
        this.report('truncated', start, word.length, `Completed truncated literal ${word} → ${completion}`, completion);
        return LITERAL_WORDS[completion].node;
      }
    }

    // MongoDB shell / JS style wrappers: ObjectId("..."), ISODate("..."), NumberLong(5)
    if (this.src[after] === '(') {
      this.pos = after + 1;
      const inner = this.parseValue();
      this.skipTrivia();
      if (this.src[this.pos] === ')') this.pos++;
      this.report('unwrapped-call', start, this.pos - start, `Unwrapped ${word}(…) call, keeping its argument`);
      return inner;
    }

    // Unquoted text: read up to the next delimiter on this line.
    let i = after;
    while (i < this.end && !',}])\n\r'.includes(this.src[i]) && !this.src.startsWith('//', i)) {
      if (this.src[i] === ':' && this.stack[this.stack.length - 1] === 'object') break;
      i++;
    }
    const text = this.src.slice(start, i).trimEnd();
    this.pos = start + text.length;
    this.report('unquoted-string', start, text.length, `Added double quotes around unquoted text “${quoteForDisplay(text)}”`, JSON.stringify(text));
    return { type: 'string', value: text };
  }
}

interface NormalizedNumber {
  value: string;
  notes: string[];
  truncated: boolean;
}

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** Turns JavaScript-ish number syntax into a valid JSON number, or `null` if impossible. */
export function normalizeNumber(raw: string, atEof = false): NormalizedNumber | null {
  if (JSON_NUMBER.test(raw)) return { value: raw, notes: [], truncated: false };

  const notes: string[] = [];
  let truncated = false;
  let sign = '';
  let body = raw;
  if (body.startsWith('+')) {
    body = body.slice(1);
    notes.push("removed leading '+' sign");
  } else if (body.startsWith('-')) {
    sign = '-';
    body = body.slice(1);
  }
  if (body === '') return null;

  if (/\d_\d/.test(body) && /^[0-9_.eE+\-xXa-fA-FoObB]+$/.test(body)) {
    body = body.replace(/_/g, '');
    notes.push('removed digit separators');
  }

  const radix = /^0([xXoObB])([0-9a-fA-F]+)$/.exec(body);
  if (radix) {
    const prefix = radix[1].toLowerCase();
    const digits = radix[2];
    const valid = prefix === 'x' ? /^[0-9a-fA-F]+$/ : prefix === 'o' ? /^[0-7]+$/ : /^[01]+$/;
    if (!valid.test(digits)) return null;
    const name = prefix === 'x' ? 'hexadecimal' : prefix === 'o' ? 'octal' : 'binary';
    const decimal = BigInt(`0${prefix}${digits}`).toString();
    notes.push(`converted ${name} to decimal`);
    const value = sign === '-' && decimal !== '0' ? '-' + decimal : decimal;
    return { value, notes, truncated };
  }

  if (atEof && /[eE][+-]?$/.test(body)) {
    body = body.replace(/[eE][+-]?$/, '');
    notes.push('dropped incomplete exponent at end of input');
    truncated = true;
  }
  if (body.endsWith('.')) {
    body = body.slice(0, -1);
    notes.push(atEof ? 'dropped dangling decimal point at end of input' : 'removed trailing decimal point');
    truncated ||= atEof;
  }
  if (body.startsWith('.')) {
    body = '0' + body;
    notes.push('added leading zero');
  }
  if (/^0\d/.test(body)) {
    body = body.replace(/^0+(?=\d)/, '');
    notes.push('removed leading zeros');
  }
  const value = sign + body;
  if (!JSON_NUMBER.test(value)) return null;
  return { value, notes, truncated };
}

function computeLineStarts(src: string): number[] {
  const starts = [0];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function locate(lineStarts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}
