import type { JsonNode } from '../json/ast';

/**
 * Structural description of the JSON values seen at one position of a document.
 * Shapes of all array elements are merged, so `[{a:1}, {a:2, b:"x"}]` yields a
 * single object shape where `b` is optional.
 */
export type Shape =
  | { readonly kind: 'null' }
  | { readonly kind: 'unknown'; readonly nullable: boolean }
  | { readonly kind: 'string'; readonly nullable: boolean; readonly format?: StringFormat }
  | { readonly kind: 'integer'; readonly nullable: boolean; readonly long: boolean }
  | { readonly kind: 'number'; readonly nullable: boolean }
  | { readonly kind: 'boolean'; readonly nullable: boolean }
  | { readonly kind: 'object'; readonly nullable: boolean; readonly fields: readonly FieldShape[] }
  | { readonly kind: 'array'; readonly nullable: boolean; readonly items: Shape }
  | {
      readonly kind: 'mixed';
      readonly nullable: boolean;
      /** The primitive kinds involved, or `null` if objects/arrays are mixed in. */
      readonly variants: readonly PrimitiveKind[] | null;
    };

export type PrimitiveKind = 'string' | 'integer' | 'number' | 'boolean';
export type StringFormat = 'date-time' | 'date' | 'uuid' | 'email' | 'uri';

export interface FieldShape {
  readonly key: string;
  readonly shape: Shape;
  /** `true` when the key is missing from at least one sampled object. */
  readonly optional: boolean;
}

const INT32_MAX = 2 ** 31 - 1;
const INT32_MIN = -(2 ** 31);

const FORMAT_PATTERNS: readonly [StringFormat, RegExp][] = [
  ['date-time', /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^https?:\/\/[^\s]+$/i],
];

export function detectFormat(value: string): StringFormat | undefined {
  for (const [format, pattern] of FORMAT_PATTERNS) {
    if (pattern.test(value)) return format;
  }
  return undefined;
}

/** Infers the shape of a JSON syntax tree. */
export function inferShape(node: JsonNode): Shape {
  switch (node.type) {
    case 'null':
      return { kind: 'null' };
    case 'boolean':
      return { kind: 'boolean', nullable: false };
    case 'string':
      return { kind: 'string', nullable: false, format: detectFormat(node.value) };
    case 'number': {
      if (/[.eE]/.test(node.raw)) return { kind: 'number', nullable: false };
      const n = Number(node.raw);
      return { kind: 'integer', nullable: false, long: n > INT32_MAX || n < INT32_MIN };
    }
    case 'array': {
      let items: Shape = { kind: 'unknown', nullable: false };
      for (const item of node.items) items = mergeShapes(items, inferShape(item));
      return { kind: 'array', nullable: false, items };
    }
    case 'object': {
      // Duplicate keys: the last one wins, like JSON.parse.
      const byKey = new Map<string, FieldShape>();
      for (const m of node.members) {
        byKey.set(m.key, { key: m.key, shape: inferShape(m.value), optional: false });
      }
      return { kind: 'object', nullable: false, fields: [...byKey.values()] };
    }
  }
}

function isNullable(s: Shape): boolean {
  return s.kind === 'null' ? true : s.nullable;
}

export function withNullable(s: Shape, nullable: boolean): Shape {
  if (s.kind === 'null') return s;
  return s.nullable === nullable ? s : { ...s, nullable };
}

function primitiveVariants(s: Shape): PrimitiveKind[] | null {
  switch (s.kind) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
      return [s.kind];
    case 'mixed':
      return s.variants ? [...s.variants] : null;
    default:
      return null;
  }
}

const VARIANT_ORDER: readonly PrimitiveKind[] = ['string', 'number', 'integer', 'boolean'];

/** Merges two shapes into the most specific shape that describes both. */
export function mergeShapes(a: Shape, b: Shape): Shape {
  if (a.kind === 'null') return b.kind === 'null' ? a : withNullable(b, true);
  if (b.kind === 'null') return withNullable(a, true);

  const nullable = isNullable(a) || isNullable(b);
  if (a.kind === 'unknown') return withNullable(b, nullable);
  if (b.kind === 'unknown') return withNullable(a, nullable);

  if (a.kind === 'string' && b.kind === 'string') {
    return { kind: 'string', nullable, format: a.format === b.format ? a.format : undefined };
  }
  if (a.kind === 'integer' && b.kind === 'integer') {
    return { kind: 'integer', nullable, long: a.long || b.long };
  }
  if ((a.kind === 'integer' || a.kind === 'number') && (b.kind === 'integer' || b.kind === 'number')) {
    return { kind: 'number', nullable };
  }
  if (a.kind === 'boolean' && b.kind === 'boolean') return { kind: 'boolean', nullable };
  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', nullable, items: mergeShapes(a.items, b.items) };
  }
  if (a.kind === 'object' && b.kind === 'object') {
    return { kind: 'object', nullable, fields: mergeFields(a.fields, b.fields) };
  }

  const va = primitiveVariants(a);
  const vb = primitiveVariants(b);
  if (va && vb) {
    const set = new Set([...va, ...vb]);
    if (set.has('number')) set.delete('integer');
    // Same-kind pairs were handled above, so at least two distinct kinds remain.
    return { kind: 'mixed', nullable, variants: VARIANT_ORDER.filter((k) => set.has(k)) };
  }
  return { kind: 'mixed', nullable, variants: null };
}

function mergeFields(a: readonly FieldShape[], b: readonly FieldShape[]): FieldShape[] {
  const bByKey = new Map(b.map((f) => [f.key, f]));
  const out: FieldShape[] = [];
  for (const fa of a) {
    const fb = bByKey.get(fa.key);
    if (fb) {
      out.push({ key: fa.key, shape: mergeShapes(fa.shape, fb.shape), optional: fa.optional || fb.optional });
      bByKey.delete(fa.key);
    } else {
      out.push({ ...fa, optional: true });
    }
  }
  for (const fb of bByKey.values()) out.push({ ...fb, optional: true });
  return out;
}
