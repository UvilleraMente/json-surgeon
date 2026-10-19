import { describe, expect, it } from 'vitest';
import { repairJson } from '../repair/repair';
import { generateCode, TARGETS, type GenerateOptions, type TargetLanguage } from './index';

const SAMPLE = `{
  "id": 7,
  "email": "ada@example.com",
  "createdAt": "2024-05-01T10:00:00Z",
  "score": 9.5,
  "active": true,
  "first-name": "Ada",
  "manager": null,
  "tags": ["a", "b"],
  "address": {"street": "Main", "zip": "123"},
  "orders": [
    {"orderId": "8f14e45f-ceea-467f-a0e3-5e8a8b5c9d21", "total": 10, "notes": "x"},
    {"orderId": "c9f0f895-fb98-4b91-9f5a-2b7c8e1d3a40", "total": 12.5, "notes": null, "gift": true}
  ],
  "matrix": [[1, 2], [3]],
  "mixed": [1, "two"]
}`;

function gen(target: TargetLanguage, json = SAMPLE, options: GenerateOptions = { rootName: 'User' }): string {
  const r = repairJson(json);
  if (!r.value) throw new Error(r.error);
  return generateCode(r.value, target, options);
}

describe('TypeScript generator', () => {
  const ts = gen('typescript');

  it('emits interfaces with optional and nullable fields', () => {
    expect(ts).toContain('export interface User {');
    expect(ts).toContain('  id: number;');
    expect(ts).toContain('  tags: string[];');
    expect(ts).toContain('  address: Address;');
    expect(ts).toContain('  orders: Order[];');
    expect(ts).toContain('  notes: string | null;');
    expect(ts).toContain('  gift?: boolean;');
    expect(ts).toContain('  matrix: number[][];');
    expect(ts).toContain('  mixed: (string | number)[];');
    expect(ts).toContain('  manager: unknown;');
  });

  it('quotes keys that are not identifiers', () => {
    expect(ts).toContain('  "first-name": string;');
  });

  it('emits a type alias for non-object roots', () => {
    expect(gen('typescript', '[{"a": 1}]', { rootName: 'Rows' })).toContain('export type Rows = Row[];');
    expect(gen('typescript', '"x"')).toContain('export type User = string;');
  });

  it('wraps nullable item types in parentheses', () => {
    expect(gen('typescript', '{"a": [1, null]}')).toContain('a: (number | null)[];');
  });
});

describe('C# generator', () => {
  const cs = gen('csharp');

  it('emits System.Text.Json records', () => {
    expect(cs).toContain('using System.Text.Json.Serialization;');
    expect(cs).toContain('namespace JsonSurgeon.Models;');
    expect(cs).toContain('public sealed record User');
    expect(cs).toContain('[JsonPropertyName("first-name")]');
    expect(cs).toContain('public required string FirstName { get; init; }');
  });

  it('maps types, formats and nullability', () => {
    expect(cs).toContain('public required int Id { get; init; }');
    expect(cs).toContain('public required double Score { get; init; }');
    expect(cs).toContain('public required DateTimeOffset CreatedAt { get; init; }');
    expect(cs).toContain('public required Guid OrderId { get; init; }');
    expect(cs).toContain('public required List<string> Tags { get; init; }');
    expect(cs).toContain('public required List<List<int>> Matrix { get; init; }');
    expect(cs).toContain('public string? Notes { get; init; }');
    expect(cs).toContain('public bool? Gift { get; init; }');
    expect(cs).toContain('public JsonElement? Manager { get; init; }');
    expect(cs).toContain('using System.Text.Json;');
    expect(cs).toContain('using System;');
  });

  it('uses long for integers beyond Int32 and a custom namespace', () => {
    const out = gen('csharp', '{"big": 3000000000}', { namespace: 'Acme.Api' });
    expect(out).toContain('public required long Big { get; init; }');
    expect(out).toContain('namespace Acme.Api;');
  });

  it('avoids member names equal to the enclosing type and duplicates', () => {
    const out = gen('csharp', '{"user": 1, "user_id": 1, "userId": 2}');
    expect(out).toContain('public required int UserValue { get; init; }');
    expect(out).toContain('public required int UserId { get; init; }');
    expect(out).toContain('public required int UserId2 { get; init; }');
  });

  it('shows how to deserialize a root array', () => {
    expect(gen('csharp', '[{"a": 1}]')).toContain('JsonSerializer.Deserialize<List<UserItem>>(json)');
  });
});

describe('Dart generator', () => {
  const dart = gen('dart');

  it('emits classes with final fields and a const constructor', () => {
    expect(dart).toContain('class User {');
    expect(dart).toContain('  final int id;');
    expect(dart).toContain('  final String firstName;');
    expect(dart).toContain('  final double score;');
    expect(dart).toContain('  final String? notes;');
    expect(dart).toContain('    required this.id,');
    expect(dart).toContain('    this.gift,');
  });

  it('generates fromJson with casts and nested conversions', () => {
    expect(dart).toContain("id: json['id'] as int,");
    expect(dart).toContain("score: (json['score'] as num).toDouble(),");
    expect(dart).toContain("address: Address.fromJson(json['address'] as Map<String, dynamic>),");
    expect(dart).toContain(
      "orders: (json['orders'] as List<dynamic>).map((e) => Order.fromJson(e as Map<String, dynamic>)).toList(),",
    );
    expect(dart).toContain("matrix: (json['matrix'] as List<dynamic>).map((e) => (e as List<dynamic>).map((e1) => e1 as int).toList()).toList(),");
    expect(dart).toContain("total: (json['total'] as num).toDouble(),");
    expect(dart).toContain("gift: json['gift'] as bool?,");
  });

  it('generates toJson with nested conversions', () => {
    expect(dart).toContain("'address': address.toJson(),");
    expect(dart).toContain("'orders': orders.map((e) => e.toJson()).toList(),");
    expect(dart).toContain("'first-name': firstName,");
  });

  it('handles nullable nested objects and reserved words', () => {
    const out = gen('dart', '[{"class": "a", "child": {"x": 1}}, {"class": "b", "child": null}]', { rootName: 'Rows' });
    expect(out).toContain('final String classValue;');
    expect(out).toContain("child: json['child'] == null ? null : Child.fromJson(json['child'] as Map<String, dynamic>),");
    expect(out).toContain("'child': child?.toJson(),");
  });

  it('escapes $ and quotes in keys', () => {
    expect(gen('dart', `{"$ref": 1, "it's": 2}`)).toContain(`json['\\$ref'] as int`);
    expect(gen('dart', `{"it's": 2}`)).toContain(`json['it\\'s'] as int`);
  });
});

describe('JSON Schema generator', () => {
  const schema = JSON.parse(gen('json-schema'));

  it('targets draft 2020-12 with $defs', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.title).toBe('User');
    expect(schema.type).toBe('object');
    expect(schema.properties.address).toEqual({ $ref: '#/$defs/Address' });
    expect(schema.$defs.Order.required).toEqual(['orderId', 'total', 'notes']);
  });

  it('describes nullability, formats and arrays', () => {
    expect(schema.properties.createdAt).toEqual({ type: 'string', format: 'date-time' });
    expect(schema.properties.email).toEqual({ type: 'string', format: 'email' });
    expect(schema.$defs.Order.properties.notes).toEqual({ type: ['string', 'null'] });
    expect(schema.properties.matrix).toEqual({ type: 'array', items: { type: 'array', items: { type: 'integer' } } });
    expect(schema.properties.mixed).toEqual({ type: 'array', items: { type: ['string', 'integer'] } });
    expect(schema.required).toContain('first-name');
  });

  it('uses anyOf for nullable references', () => {
    const s = JSON.parse(gen('json-schema', '[{"c": {"x": 1}}, {"c": null}]'));
    expect(s.type).toBe('array');
    expect(s.items).toEqual({ $ref: '#/$defs/UserItem' });
    expect(s.$defs.UserItem.properties.c).toEqual({ anyOf: [{ $ref: '#/$defs/C' }, { type: 'null' }] });
  });
});

describe('targets', () => {
  it('lists every generator', () => {
    expect(TARGETS.map((t) => t.id)).toEqual(['typescript', 'csharp', 'dart', 'json-schema']);
  });

  it.each(TARGETS.map((t) => t.id))('%s handles an empty object and scalar roots', (target) => {
    expect(() => gen(target, '{}')).not.toThrow();
    expect(() => gen(target, '42')).not.toThrow();
    expect(() => gen(target, '[]')).not.toThrow();
  });
});
