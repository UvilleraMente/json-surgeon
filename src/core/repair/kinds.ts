import type { RepairCategory, RepairKind } from './types';

interface KindInfo {
  readonly category: RepairCategory;
  readonly label: string;
}

const KIND_INFO: Record<RepairKind, KindInfo> = {
  'code-fence': { category: 'wrapper', label: 'Code fence' },
  'leading-text': { category: 'wrapper', label: 'Leading text' },
  'trailing-text': { category: 'wrapper', label: 'Trailing text' },
  'multiple-values': { category: 'wrapper', label: 'Multiple values' },
  whitespace: { category: 'wrapper', label: 'Invisible character' },
  'trailing-comma': { category: 'structure', label: 'Trailing comma' },
  'missing-comma': { category: 'structure', label: 'Missing comma' },
  'extra-comma': { category: 'structure', label: 'Extra comma' },
  'missing-colon': { category: 'structure', label: 'Missing colon' },
  'missing-value': { category: 'structure', label: 'Missing value' },
  'mismatched-bracket': { category: 'structure', label: 'Mismatched bracket' },
  'unexpected-character': { category: 'structure', label: 'Unexpected character' },
  ellipsis: { category: 'structure', label: 'Placeholder' },
  comment: { category: 'comment', label: 'Comment' },
  'single-quotes': { category: 'quotes', label: 'Single quotes' },
  'smart-quotes': { category: 'quotes', label: 'Smart quotes' },
  'unquoted-key': { category: 'quotes', label: 'Unquoted key' },
  'unquoted-string': { category: 'quotes', label: 'Unquoted string' },
  'unescaped-quote': { category: 'quotes', label: 'Unescaped quote' },
  'python-literal': { category: 'literal', label: 'Python literal' },
  'python-tuple': { category: 'literal', label: 'Python tuple' },
  'js-literal': { category: 'literal', label: 'JavaScript literal' },
  'literal-case': { category: 'literal', label: 'Literal casing' },
  'number-format': { category: 'literal', label: 'Number format' },
  'unwrapped-call': { category: 'literal', label: 'Function call' },
  'control-character': { category: 'string', label: 'Control character' },
  'invalid-escape': { category: 'string', label: 'Invalid escape' },
  'unclosed-string': { category: 'truncation', label: 'Unclosed string' },
  truncated: { category: 'truncation', label: 'Truncated input' },
};

export function repairCategory(kind: RepairKind): RepairCategory {
  return KIND_INFO[kind].category;
}

export function repairLabel(kind: RepairKind): string {
  return KIND_INFO[kind].label;
}
