import type { JsonNode } from '../json/ast';
import { buildModel, type Model } from '../model/model';
import { inferShape, type Shape } from '../model/shape';
import { generateCSharp } from './csharp';
import { generateDart } from './dart';
import { generateJsonSchema } from './json-schema';
import { generateTypeScript } from './typescript';

export type TargetLanguage = 'typescript' | 'csharp' | 'dart' | 'json-schema';

export interface GenerateOptions {
  /** Root type name, default `Root`. */
  readonly rootName?: string;
  /** C# namespace, default `JsonSurgeon.Models`. */
  readonly namespace?: string;
}

export const TARGETS: readonly { id: TargetLanguage; label: string; extension: string }[] = [
  { id: 'typescript', label: 'TypeScript', extension: 'ts' },
  { id: 'csharp', label: 'C#', extension: 'cs' },
  { id: 'dart', label: 'Dart', extension: 'dart' },
  { id: 'json-schema', label: 'JSON Schema', extension: 'schema.json' },
];

export function generateFromModel(model: Model, target: TargetLanguage, options: GenerateOptions = {}): string {
  switch (target) {
    case 'typescript':
      return generateTypeScript(model);
    case 'csharp':
      return generateCSharp(model, { namespace: options.namespace });
    case 'dart':
      return generateDart(model);
    case 'json-schema':
      return generateJsonSchema(model);
  }
}

export function generateFromShape(shape: Shape, target: TargetLanguage, options: GenerateOptions = {}): string {
  return generateFromModel(buildModel(shape, { rootName: options.rootName }), target, options);
}

/** Convenience: infer types from a JSON tree and generate code in one call. */
export function generateCode(value: JsonNode, target: TargetLanguage, options: GenerateOptions = {}): string {
  return generateFromShape(inferShape(value), target, options);
}
