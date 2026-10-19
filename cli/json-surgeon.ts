import { readFileSync, writeFileSync } from 'node:fs';
import { run } from './main';

process.exitCode = run(process.argv.slice(2), {
  readFile: (path) => readFileSync(path, 'utf8'),
  readStdin: () => readFileSync(0, 'utf8'),
  writeFile: (path, text) => writeFileSync(path, text, 'utf8'),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
