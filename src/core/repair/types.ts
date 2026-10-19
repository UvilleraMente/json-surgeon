import type { JsonNode } from '../json/ast';

/** Every kind of fix the repair engine can apply. */
export type RepairKind =
  // LLM / wrapper noise
  | 'code-fence'
  | 'leading-text'
  | 'trailing-text'
  | 'multiple-values'
  | 'whitespace'
  // structure
  | 'trailing-comma'
  | 'missing-comma'
  | 'extra-comma'
  | 'missing-colon'
  | 'missing-value'
  | 'mismatched-bracket'
  | 'unexpected-character'
  | 'ellipsis'
  // comments
  | 'comment'
  // quoting
  | 'single-quotes'
  | 'smart-quotes'
  | 'unquoted-key'
  | 'unquoted-string'
  | 'unescaped-quote'
  // literals & numbers
  | 'python-literal'
  | 'python-tuple'
  | 'js-literal'
  | 'literal-case'
  | 'number-format'
  | 'unwrapped-call'
  // string contents
  | 'control-character'
  | 'invalid-escape'
  // truncation
  | 'unclosed-string'
  | 'truncated';

/** Coarse grouping used for icons, colors and filtering. */
export type RepairCategory =
  | 'wrapper'
  | 'structure'
  | 'comment'
  | 'quotes'
  | 'literal'
  | 'string'
  | 'truncation';

/** A single fix applied to the input, located in the ORIGINAL input text. */
export interface Repair {
  readonly kind: RepairKind;
  /** Human-readable English explanation of the fix. */
  readonly message: string;
  /** 1-based line of the fix in the original input. */
  readonly line: number;
  /** 1-based column (UTF-16 code units) of the fix in the original input. */
  readonly column: number;
  /** 0-based offset of the fix in the original input. */
  readonly offset: number;
  /** Number of characters of the original input affected (0 for pure insertions). */
  readonly length: number;
  /** Original text that was replaced or removed (shortened for display when long). */
  readonly before: string;
  /** Text that was inserted instead (empty for removals). */
  readonly after: string;
}

export interface RepairOptions {
  /**
   * What to do when the input contains several top-level JSON values
   * (JSON Lines, concatenated objects, an LLM answer with two blobs...).
   * - `'first'` (default): keep the first value, report the others.
   * - `'array'`: wrap all values in a single array.
   */
  readonly multipleValues?: 'first' | 'array';
  /** Called periodically with a 0..1 fraction while parsing large inputs. */
  readonly onProgress?: (fraction: number) => void;
}

export interface RepairResult {
  /** `true` when a JSON value could be produced. */
  readonly ok: boolean;
  /** `true` when the input was already valid JSON (no repairs were needed). */
  readonly valid: boolean;
  /** The repaired document, or `null` when nothing could be recovered. */
  readonly value: JsonNode | null;
  readonly repairs: readonly Repair[];
  /** One-line summary such as "Valid JSON — no repairs needed". */
  readonly summary: string;
  /** Present when `ok` is false. */
  readonly error?: string;
}
