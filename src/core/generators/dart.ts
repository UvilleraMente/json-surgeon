import type { ClassDef, Model, TypeRef } from '../model/model';
import { camelCase } from '../model/naming';

const DART_RESERVED = new Set([
  'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export', 'extends', 'extension',
  'external', 'factory', 'false', 'final', 'finally', 'for', 'function', 'get', 'hide', 'if', 'implements',
  'import', 'in', 'interface', 'is', 'late', 'library', 'mixin', 'new', 'null', 'of', 'on', 'operator',
  'part', 'required', 'rethrow', 'return', 'set', 'show', 'static', 'super', 'switch', 'sync', 'this',
  'throw', 'true', 'try', 'typedef', 'var', 'void', 'while', 'with', 'yield', 'hashCode', 'runtimeType',
  'toString', 'toJson', 'fromJson', 'noSuchMethod',
]);

function isDynamic(ref: TypeRef): boolean {
  return ref.kind === 'unknown' || ref.kind === 'mixed';
}

function dartType(ref: TypeRef): string {
  const base = baseType(ref);
  return ref.nullable && base !== 'dynamic' ? `${base}?` : base;
}

function baseType(ref: TypeRef): string {
  switch (ref.kind) {
    case 'string':
      return 'String';
    case 'integer':
      return 'int';
    case 'number':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'class':
      return ref.name;
    case 'array':
      return `List<${dartType(ref.items)}>`;
    case 'unknown':
    case 'mixed':
      return 'dynamic';
  }
}

/** Dart single-quoted string literal. */
function dartString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n')}'`;
}

/** Expression that converts the dynamic JSON value `expr` into `ref`. */
function fromJsonExpr(ref: TypeRef, expr: string, depth: number): string {
  const q = ref.nullable ? '?' : '';
  switch (ref.kind) {
    case 'string':
      return `${expr} as String${q}`;
    case 'integer':
      return `${expr} as int${q}`;
    case 'boolean':
      return `${expr} as bool${q}`;
    case 'number':
      return ref.nullable ? `(${expr} as num?)?.toDouble()` : `(${expr} as num).toDouble()`;
    case 'class':
      return ref.nullable
        ? `${expr} == null ? null : ${ref.name}.fromJson(${expr} as Map<String, dynamic>)`
        : `${ref.name}.fromJson(${expr} as Map<String, dynamic>)`;
    case 'array': {
      const v = depth === 0 ? 'e' : `e${depth}`;
      const inner = fromJsonExpr(ref.items, v, depth + 1);
      return ref.nullable
        ? `(${expr} as List<dynamic>?)?.map((${v}) => ${inner}).toList()`
        : `(${expr} as List<dynamic>).map((${v}) => ${inner}).toList()`;
    }
    case 'unknown':
    case 'mixed':
      return expr;
  }
}

function needsConversion(ref: TypeRef): boolean {
  if (ref.kind === 'class') return true;
  return ref.kind === 'array' && needsConversion(ref.items);
}

/** Expression that converts the Dart value `expr` back into JSON-compatible data. */
function toJsonExpr(ref: TypeRef, expr: string, depth: number): string {
  const q = ref.nullable ? '?' : '';
  if (ref.kind === 'class') return `${expr}${q}.toJson()`;
  if (ref.kind === 'array' && needsConversion(ref.items)) {
    const v = depth === 0 ? 'e' : `e${depth}`;
    return `${expr}${q}.map((${v}) => ${toJsonExpr(ref.items, v, depth + 1)}).toList()`;
  }
  return expr;
}

function fieldNames(cls: ClassDef): string[] {
  const used = new Set<string>();
  return cls.fields.map((f) => {
    let name = camelCase(f.key) || 'value';
    if (/^\d/.test(name)) name = 'n' + name;
    if (DART_RESERVED.has(name)) name += 'Value';
    let unique = name;
    for (let i = 2; used.has(unique); i++) unique = `${name}${i}`;
    used.add(unique);
    return unique;
  });
}

/** Generates null-safe Dart classes with `fromJson` / `toJson`. */
export function generateDart(model: Model): string {
  const out: string[] = [];
  const root = model.root;
  if (root.kind === 'class') {
    out.push(`// Usage: final data = ${root.name}.fromJson(jsonDecode(source) as Map<String, dynamic>);`);
  } else {
    out.push(`// Usage: final data = ${fromJsonExpr({ ...root, nullable: false }, 'jsonDecode(source)', 0)};`);
  }
  out.push("// Requires: import 'dart:convert';", '');

  for (const cls of model.classes) {
    const names = fieldNames(cls);
    const fields = cls.fields.map((f, i) => ({
      key: f.key,
      name: names[i],
      type: { ...f.type, nullable: f.type.nullable || f.optional || isDynamic(f.type) },
    }));

    out.push(`class ${cls.name} {`);
    for (const f of fields) out.push(`  final ${dartType(f.type)} ${f.name};`);
    if (fields.length > 0) out.push('');

    if (fields.length === 0) {
      out.push(`  const ${cls.name}();`);
    } else {
      out.push(`  const ${cls.name}({`);
      for (const f of fields) out.push(`    ${f.type.nullable ? '' : 'required '}this.${f.name},`);
      out.push('  });');
    }
    out.push('');

    if (fields.length === 0) {
      out.push(`  factory ${cls.name}.fromJson(Map<String, dynamic> json) => const ${cls.name}();`);
    } else {
      out.push(`  factory ${cls.name}.fromJson(Map<String, dynamic> json) => ${cls.name}(`);
      for (const f of fields) {
        out.push(`        ${f.name}: ${fromJsonExpr(f.type, `json[${dartString(f.key)}]`, 0)},`);
      }
      out.push('      );');
    }
    out.push('');

    if (fields.length === 0) {
      out.push('  Map<String, dynamic> toJson() => <String, dynamic>{};');
    } else {
      out.push('  Map<String, dynamic> toJson() => <String, dynamic>{');
      for (const f of fields) out.push(`        ${dartString(f.key)}: ${toJsonExpr(f.type, f.name, 0)},`);
      out.push('      };');
    }
    out.push('}', '');
  }
  return out.join('\n').trimEnd() + '\n';
}
