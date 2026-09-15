import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const match = /^--(quick|keep|cpu|nodes|ops|rounds|seeds|kind)(?:=(.+))?$/.exec(arg); assert(match, `Unknown argument: ${arg}`); return [match[1], match[2] ?? true]; }));
assert(args.kind === undefined || ['map', 'array'].includes(args.kind));
const sequence = args.kind === 'array', type = sequence ? 'DynamicArray' : 'TreapMap', keyType = sequence ? 'int' : 'long long', valueType = sequence ? 'value_type' : 'mapped_type';
const workloads = ['set', 'subscript-set', sequence ? 'at-check' : 'count', 'at-read'];
const nodes = Number(args.nodes ?? (args.quick ? 128 : 32768)), ops = Number(args.ops ?? (args.quick ? 500 : 100000)), rounds = Number(args.rounds ?? (args.quick ? 1 : 5));
const seeds = String(args.seeds ?? (args.quick ? '1' : '1,1234567,314159')).split(',').map(Number);
assert([nodes, ops, rounds].every(n => Number.isInteger(n) && n > 0));
assert(seeds.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff));
if (args.cpu !== undefined) assert(/^\d+$/.test(String(args.cpu)));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), dir = await mkdtemp(join(tmpdir(), 'byot-wrapper-bench-'));
const execute = promisify(execFile);
let passed = false;
function replaceFunction(source, signature, replacement) {
  const start = source.indexOf(`${signature} {`);
  assert(start >= 0, `Missing function: ${signature}`);
  let end = start + signature.length + 2, depth = 1;
  while (depth) { assert(end < source.length); if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(0, start) + replacement + source.slice(end);
}
try {
  console.log(`${type} benchmark: ${dir}; ${cpus()[0]?.model}; CPU ${args.cpu ?? 'unrestricted'}; g++ -O2`);
  const bundle = join(dir, 'generator.cjs');
  await build({ entryPoints: [join(root, 'src/codegen/treapConfig.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
  const { generateTreapCode } = createRequire(import.meta.url)(bundle);
  let source = `#include <bits/stdc++.h>\nstruct Op { int key, value; };\nstruct Result { double ms; uint64_t hash; };\nvoid hash_value(uint64_t& h, long long value) { h = (h ^ uint64_t(value)) * 1099511628211ULL; }\n`;
  const profiles = [];
  const variants = ['base', 'single-write', sequence ? 'bounds-at' : 'single-count', 'combined'];
  for (const storage of ['array', 'heap']) for (const variant of variants) {
    let code = generateTreapCode({ wrapper_type: sequence ? 'dynamic_array' : 'map', key_type: sequence ? 'none' : 'long long', val_type: 'long long', array_storage: storage === 'array', array_storage_size: String(nodes + 1), use_namespace_std: false, namespace_treap: false, template: false, comments: false });
    const writeArgs = `write(ptr& n, ${keyType} at, long long value)`;
    const setArgs = `void set(${keyType} i, ${valueType} value)`;
    const writeSignature = code.includes(`bool ${writeArgs} {`) ? `bool ${writeArgs}` : `void ${writeArgs}`;
    code = replaceFunction(code, writeSignature, `void ${writeArgs} { ${sequence ? 'modifyi' : 'modify'}(n, at, [&](ptr it) { it->val = Value::make(value); }); }`);
    code = replaceFunction(code, setArgs, `${setArgs} { (void)read(i); wrapper_ops::write(data_.root, i, value); }`);
    if (!sequence) code = replaceFunction(code, 'int count(key_type key) const', 'int count(key_type key) const { return wrapper_ops::rank(data_.root, key, true) - wrapper_ops::rank(data_.root, key); }');
    else code = replaceFunction(code, 'reference at(int i)', 'reference at(int i) { (void)read(i); return {*this, i}; }');
    if (variant === 'single-write' || variant === 'combined') {
      code = replaceFunction(code, `void ${writeArgs}`, `bool ${writeArgs} { bool found = false; ${sequence ? 'modifyi' : 'modify'}(n, at, [&](ptr it) { found = true; it->val = Value::make(value); }); return found; }`);
      code = replaceFunction(code, setArgs, `${setArgs} { if (!wrapper_ops::write(data_.root, i, value)) throw std::out_of_range("${type}::at"); }`);
    }
    if (!sequence && (variant === 'single-count' || variant === 'combined')) code = replaceFunction(code, 'int count(key_type key) const', 'int count(key_type key) const { return contains(key); }');
    if (sequence && (variant === 'bounds-at' || variant === 'combined')) code = replaceFunction(code, 'reference at(int i)', 'reference at(int i) { if (i < 0 || i >= size()) throw std::out_of_range("DynamicArray::at"); return {*this, i}; }');
    const name = `profile_${profiles.length}`;
    source += `namespace ${name} {\n${code}\nResult run(int workload, unsigned seed, const std::vector<Op>& operations) {
        ${storage === 'array' ? 'node_cnt = 0;' : ''}
        mt.seed(seed);
        ${type} tree;
        for (int i = 0; i < ${nodes}; ++i) ${sequence ? 'tree.push_back(i % 31 - 15)' : 'tree.insert(i, i % 31 - 15)'};
        uint64_t hash = 1469598103934665603ULL;
        const auto start = std::chrono::steady_clock::now();
        for (const auto& op : operations) {
            if (workload == 0) tree.set(op.key, op.value);
            else if (workload == 1) tree[op.key] = op.value;
            else if (workload == 2) { ${sequence ? '(void)tree.at(op.key); hash_value(hash, op.key);' : 'hash_value(hash, tree.count(op.key));'} }
            else hash_value(hash, static_cast<const ${type}&>(tree).at(op.key));
        }
        double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        hash_value(hash, tree.all().sum);
        return {ms, hash};
    } }\n`;
    profiles.push(`{"${storage}", "${variant}", ${name}::run}`);
  }
  source += `
struct Profile { const char* storage; const char* variant; Result (*run)(int, unsigned, const std::vector<Op>&); };
int main() {
    std::vector<Profile> profiles = {${profiles.join(',')}};
    const char* names[] = {${workloads.map(name => JSON.stringify(name)).join(',')}};
    for (unsigned seed : {${seeds.map(n => `${n}U`).join(',')}}) for (int workload = 0; workload < 4; ++workload) {
        std::mt19937 rng(seed);
        std::vector<Op> operations;
        std::vector<long long> expected(${nodes});
        for (int i = 0; i < ${nodes}; ++i) expected[i] = i % 31 - 15;
        uint64_t correct = 1469598103934665603ULL;
        for (int i = 0; i < ${ops}; ++i) {
            int key = rng() % (${nodes} * ${sequence ? '1' : '(workload == 2 ? 2 : 1)'}), value = int(rng() % 101) - 50;
            operations.push_back({key, value});
            if (workload <= 1) expected[key] = value;
            else hash_value(correct, workload == 2 ? ${sequence ? 'key' : `key < ${nodes}`} : expected[key]);
        }
        hash_value(correct, std::accumulate(expected.begin(), expected.end(), 0LL));
        for (int round = -1; round < ${rounds}; ++round) for (size_t i = 0; i < profiles.size(); ++i) {
            const auto& profile = profiles[(i + seed + round + 1) % profiles.size()];
            auto result = profile.run(workload, seed, operations);
            if (result.hash != correct) { std::cerr << "wrapper benchmark oracle mismatch " << profile.variant << "\\n"; return 1; }
            if (round >= 0) std::cout << profile.storage << ',' << profile.variant << ',' << names[workload] << ',' << seed << ',' << round << ',' << std::setprecision(12) << result.ms * 1e6 / operations.size() << '\\n';
        }
    }
}
`;
  const cpp = join(dir, 'bench.cpp'), binary = join(dir, 'bench');
  await writeFile(cpp, source);
  await execute('g++', ['-std=c++17', '-O2', '-fmax-errors=3', cpp, '-o', binary], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const result = await execute(args.cpu === undefined ? binary : 'taskset', args.cpu === undefined ? [] : ['-c', String(args.cpu), binary], { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  const rows = result.stdout.trim().split('\n').map(line => { const [storage, variant, workload, seed, round, ns] = line.split(','); return { storage, variant, workload, seed: Number(seed), round: Number(round), ns: Number(ns) }; });
  for (const storage of ['array', 'heap']) {
    console.log(`\n${storage}: median ns/op (${nodes} nodes, ${ops} operations, ${seeds.length} seeds, ${rounds} measured rounds + warmup)`);
    console.log('variant'.padEnd(20) + workloads.map(s => s.padStart(17)).join(''));
    for (const variant of variants) console.log(variant.padEnd(20) + workloads.map(workload => { const values = rows.filter(row => row.storage === storage && row.variant === variant && row.workload === workload).map(row => row.ns).sort((a, b) => a - b); return values[Math.floor(values.length / 2)].toFixed(1).padStart(17); }).join(''));
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ container: type, cpu: cpus()[0]?.model, affinity: args.cpu ?? null, nodes, ops, rounds, seeds, rows }, null, 2));
  console.log(`All runs matched the vector oracle. Results: ${join(dir, 'results.json')}`);
  passed = true;
} finally {
  if (passed && !args.keep) await rm(dir, { recursive: true, force: true });
  else console.log(`Wrapper benchmark artifacts retained in ${dir}`);
}
