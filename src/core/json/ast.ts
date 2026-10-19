/**
 * A minimal JSON syntax tree.
 *
 * Numbers keep their (normalized) source text so that big integers such as
 * `12345678901234567890` survive formatting without losing precision, and so
 * type inference can tell `1` (integer) from `1.0` (floating point).
 */
export type JsonNode = JsonObject | JsonArray | JsonString | JsonNumber | JsonBoolean | JsonNull;

export interface JsonMember {
  readonly key: string;
  readonly value: JsonNode;
}

export interface JsonObject {
  readonly type: 'object';
  readonly members: JsonMember[];
}

export interface JsonArray {
  readonly type: 'array';
  readonly items: JsonNode[];
}

export interface JsonString {
  readonly type: 'string';
  readonly value: string;
}

export interface JsonNumber {
  readonly type: 'number';
  /** Canonical JSON number text, e.g. `-12.5e3`. */
  readonly raw: string;
}

export interface JsonBoolean {
  readonly type: 'boolean';
  readonly value: boolean;
}

export interface JsonNull {
  readonly type: 'null';
}

export const NULL_NODE: JsonNull = Object.freeze({ type: 'null' });

/** Converts a syntax tree into plain JavaScript values (numbers may lose precision). */
export function toJsValue(node: JsonNode): unknown {
  switch (node.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const m of node.members) out[m.key] = toJsValue(m.value);
      return out;
    }
    case 'array':
      return node.items.map(toJsValue);
    case 'string':
      return node.value;
    case 'number':
      return Number(node.raw);
    case 'boolean':
      return node.value;
    case 'null':
      return null;
  }
}
