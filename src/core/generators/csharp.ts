import type { ClassDef, Model, TypeRef } from '../model/model';
import { pascalCase } from '../model/naming';

export interface CSharpOptions {
  /** File-scoped namespace, default `JsonSurgeon.Models`. */
  readonly namespace?: string;
}

function csType(ref: TypeRef): string {
  const base = baseType(ref);
  return ref.nullable && !base.endsWith('?') ? `${base}?` : base;
}

function baseType(ref: TypeRef): string {
  switch (ref.kind) {
    case 'string':
      switch (ref.format) {
        case 'date-time':
          return 'DateTimeOffset';
        case 'date':
          return 'DateOnly';
        case 'uuid':
          return 'Guid';
        default:
          return 'string';
      }
    case 'integer':
      return ref.long ? 'long' : 'int';
    case 'number':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'class':
      return ref.name;
    case 'array':
      return `List<${csType(ref.items)}>`;
    case 'unknown':
    case 'mixed':
      return 'JsonElement';
  }
}

function usesJsonElement(ref: TypeRef): boolean {
  if (ref.kind === 'unknown' || ref.kind === 'mixed') return true;
  return ref.kind === 'array' && usesJsonElement(ref.items);
}

function usesSystemTypes(ref: TypeRef): boolean {
  if (ref.kind === 'string' && (ref.format === 'date-time' || ref.format === 'date' || ref.format === 'uuid')) return true;
  return ref.kind === 'array' && usesSystemTypes(ref.items);
}

function propertyNames(cls: ClassDef): string[] {
  const used = new Set<string>();
  return cls.fields.map((f) => {
    let name = pascalCase(f.key) || 'Value';
    if (/^\d/.test(name)) name = '_' + name;
    if (name === cls.name) name += 'Value';
    let unique = name;
    for (let i = 2; used.has(unique); i++) unique = `${name}${i}`;
    used.add(unique);
    return unique;
  });
}

/** Generates C# records for System.Text.Json with nullable reference types. */
export function generateCSharp(model: Model, options: CSharpOptions = {}): string {
  const ns = options.namespace?.trim() || 'JsonSurgeon.Models';
  const allRefs = [model.root, ...model.classes.flatMap((c) => c.fields.map((f) => f.type))];
  const usings = ['System.Text.Json.Serialization'];
  if (allRefs.some(usesJsonElement)) usings.unshift('System.Text.Json');
  if (allRefs.some(usesSystemTypes)) usings.unshift('System');

  const out: string[] = [];
  for (const u of usings) out.push(`using ${u};`);
  out.push('', `namespace ${ns};`, '');
  out.push(`// Usage: var data = JsonSerializer.Deserialize<${csType({ ...model.root, nullable: false })}>(json);`, '');

  for (const cls of model.classes) {
    const names = propertyNames(cls);
    out.push(`public sealed record ${cls.name}`, '{');
    cls.fields.forEach((f, i) => {
      const nullable = f.type.nullable || f.optional;
      const type = csType({ ...f.type, nullable });
      const required = nullable ? '' : 'required ';
      if (i > 0) out.push('');
      out.push(`    [JsonPropertyName(${JSON.stringify(f.key)})]`);
      out.push(`    public ${required}${type} ${names[i]} { get; init; }`);
    });
    out.push('}', '');
  }
  return out.join('\n').trimEnd() + '\n';
}
