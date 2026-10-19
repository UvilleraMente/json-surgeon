import type { JsonNode } from './ast';

export type Indent = 2 | 4 | 'tab' | 'minify';

export interface FormatOptions {
  /** Indentation style; `'minify'` produces a single line with no whitespace. */
  readonly indent?: Indent;
  /** Sort object keys alphabetically (recursively). */
  readonly sortKeys?: boolean;
}

/**
 * Serializes a syntax tree to JSON text.
 *
 * Duplicate keys are kept as-is (they are legal JSON syntax), and number
 * literals are written verbatim from their source text.
 */
export function formatJson(node: JsonNode, options: FormatOptions = {}): string {
  const indent = options.indent ?? 2;
  const unit = indent === 'minify' ? '' : indent === 'tab' ? '\t' : ' '.repeat(indent);
  const sortKeys = options.sortKeys ?? false;
  const minify = indent === 'minify';
  const out: string[] = [];

  const write = (n: JsonNode, depth: number): void => {
    switch (n.type) {
      case 'string':
        out.push(JSON.stringify(n.value));
        return;
      case 'number':
        out.push(n.raw);
        return;
      case 'boolean':
        out.push(n.value ? 'true' : 'false');
        return;
      case 'null':
        out.push('null');
        return;
      case 'array': {
        if (n.items.length === 0) {
          out.push('[]');
          return;
        }
        const inner = minify ? '' : '\n' + unit.repeat(depth + 1);
        out.push('[');
        n.items.forEach((item, i) => {
          if (i > 0) out.push(',');
          out.push(inner);
          write(item, depth + 1);
        });
        out.push(minify ? ']' : '\n' + unit.repeat(depth) + ']');
        return;
      }
      case 'object': {
        if (n.members.length === 0) {
          out.push('{}');
          return;
        }
        const members = sortKeys
          ? [...n.members].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          : n.members;
        const inner = minify ? '' : '\n' + unit.repeat(depth + 1);
        const colon = minify ? ':' : ': ';
        out.push('{');
        members.forEach((m, i) => {
          if (i > 0) out.push(',');
          out.push(inner, JSON.stringify(m.key), colon);
          write(m.value, depth + 1);
        });
        out.push(minify ? '}' : '\n' + unit.repeat(depth) + '}');
        return;
      }
    }
  };

  write(node, 0);
  return out.join('');
}
