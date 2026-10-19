import { describe, expect, it } from 'vitest';
import { run, type Io } from './main';

function fakeIo(files: Record<string, string>, stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const io: Io = {
    readFile: (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    readStdin: () => stdin,
    writeFile: (p, t) => (written[p] = t),
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
  };
  return { io, out: () => out.join(''), err: () => err.join(''), written };
}

describe('CLI', () => {
  it('fixes a file and lists repairs on stderr', () => {
    const f = fakeIo({ 'a.json': "{a: 1, 'b': True,}" });
    expect(run(['fix', 'a.json'], f.io)).toBe(0);
    expect(JSON.parse(f.out())).toEqual({ a: 1, b: true });
    expect(f.err()).toContain('a.json:1:2  unquoted-key');
    expect(f.err()).toContain('Repaired 4 issues');
  });

  it('supports --indent, --sort-keys, --quiet and --out', () => {
    const f = fakeIo({ 'a.json': '{"b": 1, "a": 2}' });
    expect(run(['fix', 'a.json', '--indent', 'minify', '--sort-keys', '-q', '-o', 'out.json'], f.io)).toBe(0);
    expect(f.written['out.json']).toBe('{"a":2,"b":1}\n');
    expect(f.err()).toBe('');
  });

  it('returns 1 with --check when repairs were needed', () => {
    expect(run(['fix', 'a.json', '--check', '-q'], fakeIo({ 'a.json': '[1,]' }).io)).toBe(1);
    expect(run(['fix', 'a.json', '--check', '-q'], fakeIo({ 'a.json': '[1]' }).io)).toBe(0);
  });

  it('reads stdin and wraps JSON Lines', () => {
    const f = fakeIo({}, '{"a":1}\n{"a":2}\n');
    expect(run(['fix', '-', '--jsonl', '--indent', 'minify', '-q'], f.io)).toBe(0);
    expect(f.out()).toBe('[{"a":1},{"a":2}]\n');
  });

  it('explains fixes on stdout', () => {
    const f = fakeIo({ 'x.txt': '```json\n[1 2]\n```' });
    expect(run(['explain', 'x.txt'], f.io)).toBe(0);
    expect(f.out()).toContain('code-fence');
    expect(f.out()).toContain('missing-comma');
  });

  it('generates types', () => {
    const f = fakeIo({ 'u.json': '{"id": 1, "tags": ["a"]}' });
    expect(run(['types', 'u.json', '--lang', 'cs', '--root', 'User', '-q'], f.io)).toBe(0);
    expect(f.out()).toContain('public sealed record User');
  });

  it('reports usage errors with exit code 2', () => {
    expect(run([], fakeIo({}).io)).toBe(2);
    expect(run(['nope', 'a'], fakeIo({}).io)).toBe(2);
    expect(run(['fix', 'missing.json'], fakeIo({}).io)).toBe(2);
    expect(run(['fix', 'a.json', '--indent', '3'], fakeIo({ 'a.json': '1' }).io)).toBe(2);
    expect(run(['types', 'a.json', '--lang', 'cobol'], fakeIo({ 'a.json': '1' }).io)).toBe(2);
    expect(run(['fix', 'a.json'], fakeIo({ 'a.json': 'no json here' }).io)).toBe(2);
  });

  it('prints help', () => {
    const f = fakeIo({});
    expect(run(['--help'], f.io)).toBe(0);
    expect(f.out()).toContain('Usage:');
  });
});
