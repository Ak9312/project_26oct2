// Joins src/ files into one plain script (no import/export) so the same code
// is bundled into api/_engine.js and runs in the unit tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function inlineSources(files) {
  return files
    .map((f) => {
      const code = readFileSync(join(root, 'src', f), 'utf8');
      if (/^\s*import\s/m.test(code)) throw new Error(f + ' must not use import');
      return '// ---- ' + f + '\n' + code.replace(/^export\s+/gm, '');
    })
    .join('\n');
}

// For tests: evaluate the inlined sources and return the named functions.
export function loadSources(files, names) {
  const body = inlineSources(files) + '\nreturn {' + names.join(',') + '};';
  return new Function(body)();
}
