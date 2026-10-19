import type { ClassDef, Model, TypeRef } from '../model/model';

type Schema = { [key: string]: SchemaValue };
type SchemaValue = string | number | boolean | null | Schema | SchemaValue[];

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

function withNull(schema: Schema, nullable: boolean): Schema {
  if (!nullable) return schema;
  const type = schema['type'];
  if (typeof type === 'string') return { ...schema, type: [type, 'null'] };
  if (Array.isArray(type)) return { ...schema, type: [...type, 'null'] };
  return { anyOf: [schema, { type: 'null' }] };
}

function refSchema(ref: TypeRef, rootClass: string | null): Schema {
  switch (ref.kind) {
    case 'string':
      return withNull(ref.format ? { type: 'string', format: ref.format } : { type: 'string' }, ref.nullable);
    case 'integer':
      return withNull({ type: 'integer' }, ref.nullable);
    case 'number':
      return withNull({ type: 'number' }, ref.nullable);
    case 'boolean':
      return withNull({ type: 'boolean' }, ref.nullable);
    case 'class':
      return withNull({ $ref: ref.name === rootClass ? '#' : `#/$defs/${ref.name}` }, ref.nullable);
    case 'array':
      return withNull({ type: 'array', items: refSchema(ref.items, rootClass) }, ref.nullable);
    case 'unknown':
      return {};
    case 'mixed':
      if (!ref.variants) return {};
      return { type: [...ref.variants, ...(ref.nullable ? ['null'] : [])] };
  }
}

function objectSchema(cls: ClassDef, rootClass: string | null): Schema {
  const properties: Schema = {};
  const required: string[] = [];
  for (const f of cls.fields) {
    properties[f.key] = refSchema(f.type, rootClass);
    if (!f.optional) required.push(f.key);
  }
  const schema: Schema = { type: 'object', properties };
  if (required.length > 0) schema['required'] = required;
  return schema;
}

/** Generates a JSON Schema (draft 2020-12) describing the inferred model. */
export function generateJsonSchema(model: Model): string {
  const rootClass = model.root.kind === 'class' ? model.root.name : null;
  const defs: Schema = {};
  for (const cls of model.classes) {
    if (cls.name !== rootClass) defs[cls.name] = objectSchema(cls, rootClass);
  }

  const rootCls = model.classes.find((c) => c.name === rootClass);
  const body = rootCls ? withNull(objectSchema(rootCls, rootClass), model.root.nullable) : refSchema(model.root, rootClass);
  const schema: Schema = { $schema: DRAFT, title: model.rootName, ...body };
  if (Object.keys(defs).length > 0) schema['$defs'] = defs;
  return JSON.stringify(schema, null, 2) + '\n';
}
