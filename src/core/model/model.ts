import type { PrimitiveKind, Shape, StringFormat } from './shape';
import { singularize, typeName } from './naming';

/** A language-neutral type reference produced from a {@link Shape}. */
export type TypeRef = (
  | { readonly kind: 'string'; readonly format?: StringFormat }
  | { readonly kind: 'integer'; readonly long: boolean }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'class'; readonly name: string }
  | { readonly kind: 'array'; readonly items: TypeRef }
  /** No information (only nulls, or an empty array). */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'mixed'; readonly variants: readonly PrimitiveKind[] | null }
) & { readonly nullable: boolean };

export interface FieldDef {
  /** The original JSON key. */
  readonly key: string;
  readonly type: TypeRef;
  /** Missing from some sampled objects. */
  readonly optional: boolean;
}

export interface ClassDef {
  readonly name: string;
  readonly fields: readonly FieldDef[];
}

export interface Model {
  /** Name chosen for the root type (used for aliases when the root is not an object). */
  readonly rootName: string;
  readonly root: TypeRef;
  /** Classes in reading order: root first, then nested ones depth-first. */
  readonly classes: readonly ClassDef[];
}

export interface ModelOptions {
  /** Name of the root type, default `Root`. */
  readonly rootName?: string;
}

/**
 * Converts a merged shape into named classes. Structurally identical objects
 * share one class; different objects that want the same name are
 * disambiguated with their parent's name (`OrderItem`) or a number.
 */
export function buildModel(shape: Shape, options: ModelOptions = {}): Model {
  const rootName = typeName(options.rootName?.trim() || 'Root', 'Root');
  const classes: { name: string; fields: FieldDef[] }[] = [];
  const bySignature = new Map<string, string>();
  const usedNames = new Set<string>();

  const claimName = (wanted: string, parent: string | null): string => {
    if (!usedNames.has(wanted)) return wanted;
    if (parent && !usedNames.has(parent + wanted)) return parent + wanted;
    for (let i = 2; ; i++) {
      if (!usedNames.has(`${wanted}${i}`)) return `${wanted}${i}`;
    }
  };

  const toRef = (s: Shape, suggested: string, parent: string | null): TypeRef => {
    switch (s.kind) {
      case 'null':
        return { kind: 'unknown', nullable: true };
      case 'unknown':
        return { kind: 'unknown', nullable: s.nullable };
      case 'string':
        return s.format ? { kind: 'string', format: s.format, nullable: s.nullable } : { kind: 'string', nullable: s.nullable };
      case 'integer':
        return { kind: 'integer', long: s.long, nullable: s.nullable };
      case 'number':
        return { kind: 'number', nullable: s.nullable };
      case 'boolean':
        return { kind: 'boolean', nullable: s.nullable };
      case 'mixed':
        return { kind: 'mixed', variants: s.variants, nullable: s.nullable };
      case 'array':
        return { kind: 'array', items: toRef(s.items, singularize(suggested), parent), nullable: s.nullable };
      case 'object': {
        const signature = shapeSignature(s);
        const existing = bySignature.get(signature);
        if (existing) return { kind: 'class', name: existing, nullable: s.nullable };

        const name = claimName(suggested, parent);
        usedNames.add(name);
        bySignature.set(signature, name);
        const def = { name, fields: [] as FieldDef[] };
        classes.push(def);
        for (const f of s.fields) {
          def.fields.push({ key: f.key, type: toRef(f.shape, typeName(f.key, 'Field'), name), optional: f.optional });
        }
        return { kind: 'class', name, nullable: s.nullable };
      }
    }
  };

  const root = toRef(shape, rootName, null);
  return { rootName, root, classes };
}

/** A canonical string describing a shape; the top-level object's own nullability is ignored. */
function shapeSignature(s: Shape, top = true): string {
  switch (s.kind) {
    case 'object':
      return (
        '{' +
        s.fields.map((f) => `${JSON.stringify(f.key)}${f.optional ? '?' : ''}:${shapeSignature(f.shape, false)}`).join(',') +
        '}' +
        (!top && s.nullable ? '?' : '')
      );
    case 'array':
      return `[${shapeSignature(s.items, false)}]${s.nullable ? '?' : ''}`;
    case 'mixed':
      return `mixed(${s.variants?.join('|') ?? '*'})${s.nullable ? '?' : ''}`;
    case 'null':
      return 'null';
    case 'string':
      return `string${s.format ? ':' + s.format : ''}${s.nullable ? '?' : ''}`;
    default:
      return s.kind + (s.nullable ? '?' : '');
  }
}
