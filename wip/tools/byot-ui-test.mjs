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
    stdin: { contents: 'export * from "./src/uiModel"; export * from "./src/codegen/features"; export * from "./src/codegen/depsUtil";', resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
  });
  const { diffLines, highlightCpp, clampRatio, diffScrollTarget, settingsSection, SETTINGS_SECTIONS, features, partitionGroups, columnCount, createDefaultConfig, setFeature, setAvailableFeature, activateFeature, computeDisabled, isVisible, normalizeConfig } = createRequire(import.meta.url)(bundle);
  const rows = diffLines('a\nx\na\nb', 'a\na\nb');
  assert.deepEqual(rows.map(r => r.kind), ['equal', 'remove', 'equal', 'equal']);
  assert.equal(rows[1].text, 'x');
  assert.equal(rows[2].newLine, 2);
  assert.equal(rows[2].oldLine, 3);
  assert.deepEqual(diffLines('a', 'a\nb').map(r => r.kind), ['equal', 'add']);
  assert.deepEqual(diffLines('    a', '\ta').map(r => r.kind), ['equal']);
  assert.deepEqual(diffLines('', ''), []);
  assert.equal(diffScrollTarget(100, 300, 400, []), null);
  assert.equal(diffScrollTarget(100, 300, 400, [{ top: 120, bottom: 140 }, { top: 900, bottom: 920 }]), null);
  assert.equal(diffScrollTarget(100, 300, 400, [{ top: 500, bottom: 520 }]), 740);
  assert.equal(diffScrollTarget(100, 300, 400, [{ top: 20, bottom: 40 }]), 260);
  assert.equal(diffScrollTarget(100, 0, 400, [{ top: 500, bottom: 520 }]), null);

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
  const base = createDefaultConfig();
  const sizeOption = features.find(feature => feature.key === 'size_type');
  assert.equal(base.size_type, 'int');
  assert.equal(sizeOption.subOptionOf, 'persistent');
  assert.equal(settingsSection(sizeOption), 'treap');
  assert.equal(isVisible(base, 'size_type'), false);
  const persistent = setFeature(base, 'persistent', true);
  assert.equal(isVisible(persistent, 'size_type'), true);
  for (const type of ['long long', '__int128']) {
    const selected = setAvailableFeature(persistent, 'size_type', type);
    assert.equal(selected.size_type, type);
    assert.equal(normalizeConfig({ size_type: type }).persistent, true);
    const disabled = setFeature(selected, 'persistent', false);
    assert.equal(disabled.size_type, 'int');
    assert.equal(isVisible(disabled, 'size_type'), false);
  }
  assert.equal(computeDisabled(base).findi_option, true);
  assert.equal(setAvailableFeature(base, 'findi_option', true).findi_option, false);
  const active = activateFeature(base, 'findi_option');
  assert.equal(active.findi_option, true);
  assert.equal(active.size_option, true);
  assert.equal(!!computeDisabled(active).findi_option, false);
  const off = setAvailableFeature(active, 'findi_option', false);
  assert.equal(off.findi_option, false);
  assert.equal(!!computeDisabled(off).findi_option, false);
  const unavailable = setAvailableFeature(active, 'size_option', false);
  assert.equal(unavailable.findi_option, false);
  assert.equal(computeDisabled(unavailable).findi_option, true);
  const array = setFeature(base, 'wrapper_type', 'dynamic_array');
  assert.equal(setAvailableFeature(array, 'subscript', 'key').subscript, 'index');

  const cost = (columns, heights, gap) => Math.max(0, ...columns.map(column => column.reduce((sum, i) => sum + heights[i], 0) + Math.max(0, column.length - 1) * gap));
  assert.equal(cost(partitionGroups([30, 30, 20, 20, 20], 2, 0), [30, 30, 20, 20, 20], 0), 60);
  assert(columnCount(1400, 6) > 2);
  assert.equal(columnCount(300, 6), 1);
  assert.equal(columnCount(3000, 3), 3);
  assert.deepEqual(partitionGroups([], 4), []);
  for (let rep = 0; rep < 70; ++rep) {
    const heights = Array.from({ length: 1 + random() % 7 }, () => (random() % 60) / 2);
    const count = 1 + random() % Math.min(3, heights.length), gap = random() % 9;
    let optimum = Infinity;
    const trial = Array.from({ length: count }, () => []);
    const enumerate = i => {
      if (i === heights.length) { optimum = Math.min(optimum, cost(trial, heights, gap)); return; }
      for (const column of trial) { column.push(i); enumerate(i + 1); column.pop(); }
    };
    enumerate(0);
    const actual = partitionGroups(heights, count, gap);
    assert.deepEqual(actual.flat().sort((a, b) => a - b), heights.map((_, i) => i));
    assert.equal(cost(actual, heights, gap), optimum);
    assert.deepEqual(partitionGroups(heights, count, gap, actual), actual);
  }
  for (const feature of features) assert(SETTINGS_SECTIONS.some(section => section.id === settingsSection(feature)), `unreachable feature: ${feature.key}`);
  console.log('OK: UI diffs, highlighting, availability, split bounds, and exact subsection partitioning tests passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
