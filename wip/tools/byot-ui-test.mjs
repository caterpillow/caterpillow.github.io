import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'byot-ui-test-'));
try {
  const bundle = join(dir, 'ui.cjs');
  await build({
    stdin: { contents: 'export * from "./src/uiModel"; export * from "./src/codegen/features";', resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
  });
  const { diffLines, highlightCpp, clampRatio, settingsTab, TABS, features } = createRequire(import.meta.url)(bundle);
  const rows = diffLines('a\nx\na\nb', 'a\na\nb');
  assert.deepEqual(rows.map(r => r.kind), ['equal', 'remove', 'equal', 'equal']);
  assert.equal(rows[1].text, 'x');
  assert.equal(rows[2].newLine, 2);
  assert.equal(rows[2].oldLine, 3);
  assert.deepEqual(diffLines('a', 'a\nb').map(r => r.kind), ['equal', 'add']);
  assert.deepEqual(diffLines('    a', '\ta').map(r => r.kind), ['equal']);
  assert.deepEqual(diffLines('', ''), []);

  let seed = 123;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let rep = 0; rep < 300; ++rep) {
    const before = Array.from({ length: random() % 50 }, () => ['a', 'b', '}', '', 'return n;'][random() % 5]);
    const after = Array.from({ length: random() % 50 }, () => ['a', 'b', '}', '', 'return n;'][random() % 5]);
    const result = diffLines(before.join('\n'), after.join('\n'));
    assert.equal(result.filter(r => r.kind !== 'remove').map(r => r.text).join('\n'), after.join('\n'));
    assert.equal(result.filter(r => r.kind !== 'add').map(r => r.oldText ?? r.text).join('\n'), before.join('\n'));
  }
  const huge = Array.from({ length: 3500 }, (_, i) => `line ${i}`).join('\n');
  const largeDiff = diffLines(huge, huge.split('\n').reverse().join('\n'));
  assert.equal(largeDiff.filter(r => r.kind !== 'remove').map(r => r.text).join('\n'), huge.split('\n').reverse().join('\n'));

  for (const source of [
    'int n = 1\'000; // return false\nreturn n;',
    '/* multiline\ncomment */ ptr root = nullptr;',
    'auto text = R"tag(// not a comment\n"quoted")tag";',
    '#include <vector>\nconst char* s = "<script>&\\\"";\n',
    '/* unfinished\ncomment',
    '',
  ]) {
    assert.equal(highlightCpp(source).map(line => line.map(t => t.text).join('')).join('\n'), source);
  }
  const highlighted = highlightCpp('int x = 42; // return\nreturn x;');
  assert(highlighted[0].some(t => t.kind === 'number' && t.text === '42'));
  assert(highlighted[0].some(t => t.kind === 'comment' && t.text.includes('return')));
  assert(highlighted[1].some(t => t.kind === 'keyword' && t.text === 'return'));
  const raw = highlightCpp('auto s = R"(// hello\nworld)";');
  assert(raw[0].some(t => t.kind === 'string' && t.text.includes('//')));
  assert(raw[1].some(t => t.kind === 'string' && t.text.includes('world')));

  for (const extent of [0, 100, 250, 500, 1400]) {
    assert(clampRatio(-100, extent) > 0);
    assert(clampRatio(100, extent) < 1);
    assert.equal(clampRatio(0.5, extent), 0.5);
    assert(Number.isFinite(clampRatio(NaN, extent)));
  }
  for (const feature of features) assert(TABS.some(tab => tab.id === settingsTab(feature)), `unreachable feature: ${feature.key}`);
  console.log('OK: UI diff, C++ highlighting, split bounds, and settings navigation tests passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
