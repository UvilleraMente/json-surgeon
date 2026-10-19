import type { Model, TypeRef } from '../model/model';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function tsType(ref: TypeRef): string {
  const base = baseType(ref);
  if (!ref.nullable || base === 'unknown') return base;
  return `${base} | null`;
}

function baseType(ref: TypeRef): string {
  switch (ref.kind) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'class':
      return ref.name;
    case 'unknown':
      return 'unknown';
    case 'mixed':
      if (!ref.variants) return 'unknown';
      return [...new Set(ref.variants.map((v) => (v === 'integer' ? 'number' : v)))].join(' | ');
    case 'array': {
      const inner = tsType(ref.items);
      return /[| ]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
    }
  }
}

/** Generates TypeScript interfaces. */
export function generateTypeScript(model: Model): string {
  const out: string[] = [];
  if (model.root.kind !== 'class') {
    out.push(`export type ${model.rootName} = ${tsType(model.root)};`, '');
  }
  for (const cls of model.classes) {
    out.push(`export interface ${cls.name} {`);
    for (const f of cls.fields) {
      const name = IDENTIFIER.test(f.key) ? f.key : JSON.stringify(f.key);
      out.push(`  ${name}${f.optional ? '?' : ''}: ${tsType(f.type)};`);
    }
    out.push('}', '');
  }
  return out.join('\n').trimEnd() + '\n';
}
