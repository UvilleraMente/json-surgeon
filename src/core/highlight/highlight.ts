import { repairCategory } from '../repair/kinds';
import type { Repair } from '../repair/types';

/**
 * Tiny, dependency-free syntax highlighters that return HTML strings.
 * All source text is HTML-escaped, so the result is safe to inject.
 */

export type HighlightLanguage = 'json' | 'typescript' | 'csharp' | 'dart';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

const KEYWORDS: Record<Exclude<HighlightLanguage, 'json'>, ReadonlySet<string>> = {
  typescript: new Set(['export', 'interface', 'type', 'string', 'number', 'boolean', 'unknown', 'null', 'readonly']),
  csharp: new Set([
    'using', 'namespace', 'public', 'sealed', 'record', 'required', 'get', 'init', 'string', 'int', 'long',
    'double', 'bool', 'var', 'class',
  ]),
  dart: new Set([
    'class', 'final', 'const', 'required', 'this', 'factory', 'as', 'dynamic', 'int', 'double', 'bool', 'null',
    'void', 'return',
  ]),
};

const TOKEN =
  /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

/** Highlights generated code or formatted JSON. */
export function highlightCode(text: string, language: HighlightLanguage): string {
  const keywords = language === 'json' ? null : KEYWORDS[language];
  let out = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    out += escapeHtml(text.slice(last, m.index));
    last = TOKEN.lastIndex;
    const [token, comment, str, num, word] = m;
    let cls: string | null = null;
    if (comment) {
      if (language === 'json') {
        out += escapeHtml(token);
        continue;
      }
      cls = 'tok-comment';
    } else if (str) {
      const isKey = language === 'json' && /^\s*:/.test(text.slice(last, last + 8));
      cls = isKey ? 'tok-key' : 'tok-string';
    } else if (num) {
      cls = 'tok-number';
    } else if (word) {
      if (language === 'json') cls = word === 'true' || word === 'false' || word === 'null' ? 'tok-literal' : null;
      else if (keywords?.has(word)) cls = 'tok-keyword';
      else if (/^[A-Z]/.test(word)) cls = 'tok-type';
    }
    out += cls ? `<span class="${cls}">${escapeHtml(token)}</span>` : escapeHtml(token);
  }
  return out + escapeHtml(text.slice(last));
}

/**
 * Renders `text` with a `<mark>` around (or, for insertions, at) each repair
 * location. Used as the backdrop behind the input textarea, so the output must
 * contain exactly the same characters as `text`.
 */
export function markRepairs(text: string, repairs: readonly Repair[], activeIndex: number | null): string {
  const order = repairs.map((r, i) => i).sort((a, b) => repairs[a].offset - repairs[b].offset || a - b);
  let out = '';
  let cursor = 0;
  for (const i of order) {
    const r = repairs[i];
    const cls = `mark cat-${repairCategory(r.kind)}${i === activeIndex ? ' active' : ''}`;
    const start = Math.min(Math.max(r.offset, cursor), text.length);
    const end = Math.min(r.offset + r.length, text.length);
    if (r.length === 0) {
      out += escapeHtml(text.slice(cursor, start));
      out += `<mark class="${cls} insert" data-i="${i}"></mark>`;
      cursor = start;
      continue;
    }
    if (end <= cursor) continue; // fully covered by a previous mark
    out += escapeHtml(text.slice(cursor, start));
    out += `<mark class="${cls}" data-i="${i}">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }
  // A trailing newline keeps the backdrop's height in sync with the textarea.
  return out + escapeHtml(text.slice(cursor)) + '\n';
}
