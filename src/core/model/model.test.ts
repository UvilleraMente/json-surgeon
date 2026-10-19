import { describe, expect, it } from 'vitest';
import type { JsonNode } from '../json/ast';
import { repairJson } from '../repair/repair';
import { buildModel } from './model';
import { camelCase, pascalCase, singularize, splitWords, typeName } from './naming';
import { inferShape, mergeShapes, type Shape } from './shape';

function parse(json: string): JsonNode {
  const r = repairJson(json);
  if (!r.value) throw new Error(r.error);
  return r.value;
}

const shapeOf = (json: string): Shape => inferShape(parse(json));

describe('naming', () => {
  it.each([
    ['user_id', ['user', 'id']],
    ['userId', ['user', 'Id']],
    ['UserID', ['User', 'ID']],
    ['HTTPServer', ['HTTP', 'Server']],
    ['first-name', ['first', 'name']],
    ['  spaced out ', ['spaced', 'out']],
  ])('splits %s into words', (key, words) => {
    expect(splitWords(key)).toEqual(words);
  });

  it('builds PascalCase and camelCase names', () => {
    expect(pascalCase('user_profile')).toBe('UserProfile');
    expect(pascalCase('firstName')).toBe('FirstName');
    expect(pascalCase('ID')).toBe('Id');
    expect(camelCase('user_profile')).toBe('userProfile');
    expect(camelCase('ID')).toBe('id');
    expect(camelCase('First Name')).toBe('firstName');
  });

  it.each([
    ['Users', 'User'],
    ['Companies', 'Company'],
    ['Boxes', 'Box'],
    ['Matches', 'Match'],
    ['Addresses', 'Address'],
    ['People', 'Person'],
    ['Children', 'Child'],
    ['Statuses', 'Status'],
    ['LineItems', 'LineItem'],
    ['Data', 'DataItem'],
    ['Status', 'StatusItem'],
    ['Keys', 'Key'],
    ['Root', 'RootItem'],
  ])('singularizes %s → %s', (plural, singular) => {
    expect(singularize(plural)).toBe(singular);
  });

  it('makes safe type names', () => {
    expect(typeName('2fa')).toBe('Item2fa');
    expect(typeName('---')).toBe('Item');
    expect(typeName('list')).toBe('ListModel');
    expect(typeName('shipping_address')).toBe('ShippingAddress');
  });
});

describe('shape inference', () => {
  it('distinguishes integers from floating point numbers', () => {
    expect(shapeOf('1')).toMatchObject({ kind: 'integer', long: false });
    expect(shapeOf('1.0')).toMatchObject({ kind: 'number' });
    expect(shapeOf('1e3')).toMatchObject({ kind: 'number' });
    expect(shapeOf('9007199254740993')).toMatchObject({ kind: 'integer', long: true });
  });

  it('widens integer + number to number', () => {
    expect(shapeOf('[1, 2.5]')).toMatchObject({ kind: 'array', items: { kind: 'number' } });
  });

  it('marks fields missing from some elements as optional', () => {
    const shape = shapeOf('[{"a": 1, "b": "x"}, {"a": 2}, {"a": 3, "c": true}]');
    expect(shape).toMatchObject({
      kind: 'array',
      items: {
        kind: 'object',
        fields: [
          { key: 'a', optional: false },
          { key: 'b', optional: true },
          { key: 'c', optional: true },
        ],
      },
    });
  });

  it('marks fields that are sometimes null as nullable', () => {
    const shape = shapeOf('[{"m": 1}, {"m": null}]');
    expect(shape).toMatchObject({ items: { fields: [{ key: 'm', optional: false, shape: { kind: 'integer', nullable: true } }] } });
  });

  it('merges nested arrays of objects', () => {
    const shape = shapeOf('[{"tags": [{"n": 1}]}, {"tags": [{"n": 2, "x": "y"}]}]');
    expect(shape).toMatchObject({
      items: { fields: [{ key: 'tags', shape: { items: { fields: [{ key: 'n', optional: false }, { key: 'x', optional: true }] } } }] },
    });
  });

  it('falls back to mixed for incompatible types', () => {
    expect(shapeOf('[1, "a", true]')).toMatchObject({ items: { kind: 'mixed', variants: ['string', 'integer', 'boolean'] } });
    expect(shapeOf('[1, {"a": 1}]')).toMatchObject({ items: { kind: 'mixed', variants: null } });
  });

  it('treats empty arrays as unknown items and lets other samples refine them', () => {
    expect(shapeOf('[]')).toMatchObject({ kind: 'array', items: { kind: 'unknown' } });
    expect(shapeOf('[[], ["a"]]')).toMatchObject({ items: { kind: 'array', items: { kind: 'string' } } });
  });

  it('detects string formats only when consistent', () => {
    expect(shapeOf('["2024-01-02T03:04:05Z"]')).toMatchObject({ items: { format: 'date-time' } });
    expect(shapeOf('["2024-01-02"]')).toMatchObject({ items: { format: 'date' } });
    expect(shapeOf('["8f14e45f-ceea-467f-a0e3-5e8a8b5c9d21"]')).toMatchObject({ items: { format: 'uuid' } });
    expect(shapeOf('["a@b.co"]')).toMatchObject({ items: { format: 'email' } });
    expect(shapeOf('["https://x.dev"]')).toMatchObject({ items: { format: 'uri' } });
    const mixed = shapeOf('["2024-01-02", "not a date"]');
    expect(mixed.kind === 'array' && mixed.items.kind === 'string' && mixed.items.format).toBeUndefined();
  });

  it('null merged with null stays null', () => {
    expect(mergeShapes({ kind: 'null' }, { kind: 'null' })).toEqual({ kind: 'null' });
  });
});

describe('model building', () => {
  it('names nested classes after their keys and singularizes array items', () => {
    const model = buildModel(shapeOf('{"user": {"name": "a"}, "orders": [{"id": 1}], "companies": [{"id": "x"}]}'));
    expect(model.classes.map((c) => c.name)).toEqual(['Root', 'User', 'Order', 'Company']);
  });

  it('uses the configured root name', () => {
    const model = buildModel(shapeOf('{"a": 1}'), { rootName: 'api response' });
    expect(model.root).toMatchObject({ kind: 'class', name: 'ApiResponse' });
  });

  it('names items of a root array after the root name', () => {
    const model = buildModel(shapeOf('[{"a": 1}]'), { rootName: 'Users' });
    expect(model.root).toMatchObject({ kind: 'array', items: { kind: 'class', name: 'User' } });
  });

  it('reuses one class for structurally identical objects', () => {
    const model = buildModel(shapeOf('{"billing": {"street": "a", "city": "b"}, "shipping": {"street": "c", "city": "d"}}'));
    expect(model.classes.map((c) => c.name)).toEqual(['Root', 'Billing']);
  });

  it('disambiguates different classes that want the same name', () => {
    const model = buildModel(shapeOf('{"a": {"item": {"x": 1}}, "b": {"item": {"y": "s"}}}'));
    expect(model.classes.map((c) => c.name)).toEqual(['Root', 'A', 'Item', 'B', 'BItem']);
  });
});
