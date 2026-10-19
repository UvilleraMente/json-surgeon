/** Splits an identifier-ish key into words: `user_id`, `userId`, `UserID`, `user-id` → ["user", "id"]. */
export function splitWords(key: string): string[] {
  return key
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** `first_name` → `FirstName`. Returns '' for keys without letters or digits. */
export function pascalCase(key: string): string {
  return splitWords(key).map(capitalize).join('');
}

/** `first_name` → `firstName`. */
export function camelCase(key: string): string {
  const words = splitWords(key);
  if (words.length === 0) return '';
  return words[0].toLowerCase() + words.slice(1).map(capitalize).join('');
}

const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  people: 'person',
  children: 'child',
  men: 'man',
  women: 'woman',
  mice: 'mouse',
  geese: 'goose',
  teeth: 'tooth',
  feet: 'foot',
  statuses: 'status',
  aliases: 'alias',
  buses: 'bus',
  viruses: 'virus',
  indices: 'index',
  matrices: 'matrix',
  vertices: 'vertex',
  analyses: 'analysis',
  criteria: 'criterion',
};

/**
 * Derives a singular class name for the items of an array property, using a few
 * simple English rules: `Users` → `User`, `Companies` → `Company`,
 * `Boxes` → `Box`, `People` → `Person`; anything else gets an `Item` suffix
 * (`Data` → `DataItem`).
 */
export function singularize(name: string): string {
  const words = splitWords(name);
  if (words.length === 0) return 'Item';
  const last = words[words.length - 1];
  const lower = last.toLowerCase();
  const head = words.slice(0, -1).map(capitalize).join('');

  const irregular = IRREGULAR_PLURALS[lower];
  let singular: string | null = null;
  if (irregular) singular = irregular;
  else if (/[^aeiou]ies$/.test(lower)) singular = lower.slice(0, -3) + 'y';
  else if (/(sses|xes|zes|ches|shes)$/.test(lower)) singular = lower.slice(0, -2);
  else if (/(ss|us|is)$/.test(lower)) singular = null;
  else if (lower.length > 2 && lower.endsWith('s')) singular = lower.slice(0, -1);

  return singular ? head + capitalize(singular) : head + capitalize(lower) + 'Item';
}

/** Type names that would clash with built-ins in at least one target language. */
const RESERVED_TYPE_NAMES = new Set([
  'Object', 'String', 'List', 'Map', 'Set', 'Int', 'Double', 'Bool', 'Boolean', 'Number',
  'Date', 'DateTime', 'Duration', 'Guid', 'Type', 'Record', 'Function', 'Iterable', 'Future',
  'Stream', 'Error', 'Exception', 'Math', 'Array', 'Symbol', 'Promise', 'JsonElement', 'Uri',
  'Null', 'Enum', 'Dynamic', 'Void', 'Task', 'Action', 'Func', 'Json',
]);

/** Turns any key into a safe PascalCase type name. */
export function typeName(key: string, fallback = 'Item'): string {
  let name = pascalCase(key);
  if (name === '') name = fallback;
  if (/^\p{N}/u.test(name)) name = fallback + name;
  if (RESERVED_TYPE_NAMES.has(name)) name += 'Model';
  return name;
}
