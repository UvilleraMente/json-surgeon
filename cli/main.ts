import { formatJson, generateCode, repairJson, type Indent, type TargetLanguage } from '../src/core';

export interface Io {
  readFile(path: string): string;
  readStdin(): string;
  writeFile(path: string, text: string): void;
  stdout(text: string): void;
  stderr(text: string): void;
}

const LANGS: Record<string, TargetLanguage> = {
  ts: 'typescript',
  typescript: 'typescript',
  cs: 'csharp',
  csharp: 'csharp',
  dart: 'dart',
  schema: 'json-schema',
  'json-schema': 'json-schema',
};

export const USAGE = `JSON Surgeon — repair broken JSON and explain every fix.

Usage:
  json-surgeon fix <file|-> [options]       Print repaired JSON (fixes are listed on stderr)
  json-surgeon explain <file|->             List every fix without printing the JSON
  json-surgeon types <file|-> --lang <ts|cs|dart|schema> [--root Name] [--namespace Ns]

Options:
  -o, --out <file>      Write output to a file instead of stdout
  --indent <2|4|tab|minify>   Output indentation (default 2)
  --sort-keys           Sort object keys
  --jsonl               Wrap multiple top-level values (JSON Lines) in an array
  --check               Exit with code 1 if the input needed repairs
  -q, --quiet           Do not list fixes on stderr
  -h, --help            Show this help

Exit codes: 0 = ok, 1 = repairs needed (with --check), 2 = error.`;

interface Args {
  command: string | undefined;
  file: string | undefined;
  out?: string;
  indent: Indent;
  sortKeys: boolean;
  jsonl: boolean;
  check: boolean;
  quiet: boolean;
  lang?: string;
  root?: string;
  namespace?: string;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: undefined, file: undefined, indent: 2, sortKeys: false, jsonl: false, check: false, quiet: false, help: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '-o':
      case '--out':
        args.out = value();
        break;
      case '--indent': {
        const v = value();
        if (v === 'tab' || v === 'minify') args.indent = v;
        else if (v === '2' || v === '4') args.indent = Number(v) as 2 | 4;
        else throw new Error(`Invalid --indent: ${v}`);
        break;
      }
      case '--sort-keys':
        args.sortKeys = true;
        break;
      case '--jsonl':
        args.jsonl = true;
        break;
      case '--check':
        args.check = true;
        break;
      case '-q':
      case '--quiet':
        args.quiet = true;
        break;
      case '--lang':
        args.lang = value();
        break;
      case '--root':
        args.root = value();
        break;
      case '--namespace':
        args.namespace = value();
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        if (a.startsWith('-') && a !== '-') throw new Error(`Unknown option: ${a}`);
        positional.push(a);
    }
  }
  [args.command, args.file] = positional;
  return args;
}

/** Runs the CLI and returns the process exit code. */
export function run(argv: readonly string[], io: Io): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.help || !args.command) {
    (args.help ? io.stdout : io.stderr)(USAGE + '\n');
    return args.help ? 0 : 2;
  }
  if (!['fix', 'explain', 'types'].includes(args.command)) {
    io.stderr(`Unknown command: ${args.command}\n\n${USAGE}\n`);
    return 2;
  }
  if (!args.file) {
    io.stderr(`Missing input file (use - for stdin)\n`);
    return 2;
  }

  let input: string;
  try {
    input = args.file === '-' ? io.readStdin() : io.readFile(args.file);
  } catch (err) {
    io.stderr(`Cannot read ${args.file}: ${(err as Error).message}\n`);
    return 2;
  }

  const result = repairJson(input, { multipleValues: args.jsonl ? 'array' : 'first' });
  if (!result.ok || !result.value) {
    io.stderr(`error: ${result.error}\n`);
    return 2;
  }

  const name = args.file === '-' ? '<stdin>' : args.file;
  if (args.command === 'explain' || !args.quiet) {
    const sink = args.command === 'explain' ? io.stdout : io.stderr;
    if (result.valid) sink(`${name}: ${result.summary}\n`);
    for (const r of result.repairs) sink(`${name}:${r.line}:${r.column}  ${r.kind.padEnd(20)} ${r.message}\n`);
    if (!result.valid) sink(`${name}: ${result.summary}\n`);
  }

  let output: string | null = null;
  if (args.command === 'fix') {
    output = formatJson(result.value, { indent: args.indent, sortKeys: args.sortKeys }) + '\n';
  } else if (args.command === 'types') {
    const lang = LANGS[args.lang ?? 'ts'];
    if (!lang) {
      io.stderr(`Unknown --lang ${args.lang}; use ts, cs, dart or schema\n`);
      return 2;
    }
    output = generateCode(result.value, lang, { rootName: args.root, namespace: args.namespace });
  }

  if (output !== null) {
    if (args.out) io.writeFile(args.out, output);
    else io.stdout(output);
  }
  return args.check && !result.valid ? 1 : 0;
}
