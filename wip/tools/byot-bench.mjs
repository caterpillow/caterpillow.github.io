import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const options = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--([\w-]+)(?:=(.+))?$/.exec(arg);
  if (!match) throw new Error(`Invalid argument: ${arg}`);
  options[match[1]] = match[2] ?? true;
}
for (const key of Object.keys(options)) assert(['help', 'quick', 'nodes', 'ops', 'full-ops', 'rounds', 'seeds', 'storage', 'payload', 'cpu', 'keep', 'variants'].includes(key), `Unknown option: --${key}`);
if (options.help) {
  console.log('npm run bench:byot -- [--quick] [--nodes=32768] [--ops=50000] [--full-ops=1000000] [--rounds=5] [--seeds=1,1234567,314159] [--storage=array|heap|both] [--payload=sum|rich|both] [--cpu=2] [--variants=eager-base,eager-cover-first] [--keep]');
  process.exit(0);
}
const quick = !!options.quick;
const nodes = Number(options.nodes ?? (quick ? 256 : 32768));
const operations = Number(options.ops ?? (quick ? 1000 : 50000));
const fullOperations = Number(options['full-ops'] ?? (quick ? 2000 : 1000000));
const rounds = Number(options.rounds ?? (quick ? 1 : 5));
const seeds = String(options.seeds ?? (quick ? '1' : '1,1234567,314159')).split(',').map(Number);
for (const n of [nodes, operations, fullOperations, rounds]) assert(Number.isInteger(n) && n > 0);
assert(seeds.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff));
const storages = options.storage === 'both' || (!options.storage && !quick) ? ['array', 'heap'] : [options.storage ?? 'array'];
const payloads = options.payload === 'both' || (!options.payload && !quick) ? ['sum', 'rich'] : [options.payload ?? 'sum'];
assert(storages.every(s => ['array', 'heap'].includes(s)) && payloads.every(s => ['sum', 'rich'].includes(s)));
if (options.cpu !== undefined) assert(/^\d+$/.test(String(options.cpu)));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'byot-bench-'));
const run = promisify(execFile);
let passed = false;

function rewrite(source, signature, transform) {
  const marker = `${signature} {`;
  const start = source.indexOf(marker);
  assert(start >= 0 && source.indexOf(marker, start + 1) < 0, `Missing/ambiguous function: ${signature}`);
  const opening = start + marker.length - 1;
  let depth = 1, end = opening + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  assert.equal(depth, 0);
  return source.slice(0, start) + transform(source.slice(start, end)) + source.slice(end);
}
const signatures = {
  apply: 'void apply(ptr n, Lazy lazy)', push: 'void push(ptr n)', pull: 'ptr pull(ptr n)',
  merge: 'ptr merge(ptr l, ptr r)', query: 'Value queryi(ptr n, int lo, int hi)',
  update: 'void updi(ptr n, int lo, int hi, Lazy lazy)', agg: 'Value agg(ptr n)',
};
const bodies = {
  apply: `void apply(ptr n, Lazy lazy) {
    if (!n || lazy.empty()) return;
    n->val.upd(lazy, 1);
    n->agg.upd(lazy, sz(n));
    if (lazy.rev) std::swap(n->l, n->r);
    n->lazy += lazy;
}`,
  push: `void push(ptr n) {
    if (!n || n->lazy.empty()) return;
    apply(n->l, n->lazy), apply(n->r, n->lazy);
    n->lazy = lid;
}`,
  pull: `ptr pull(ptr n) {
    if (!n) return nullptr;
    n->sz = sz(n->l) + 1 + sz(n->r);
    n->agg = agg(n->l) + n->val + agg(n->r);
    return n;
}`,
  merge: `ptr merge(ptr l, ptr r) {
    if (!l || !r) return l ? l : r;
    push(l), push(r);
    if (l->pri > r->pri) return l->r = merge(l->r, r), pull(l);
    else return r->l = merge(l, r->l), pull(r);
}`,
  update: `void updi(ptr n, int lo, int hi, Lazy lazy) {
    lo = std::max(lo, 0), hi = std::min(hi, sz(n));
    if (!n || lo >= hi || lazy.empty()) return;
    if (lazy.rev) throw std::invalid_argument("Use reversei");
    push(n);
    if (lo == 0 && n->sz == hi) { apply(n, lazy); return; }
    if (lo <= sz(n->l) && sz(n->l) < hi) n->val.upd(lazy, 1);
    updi(n->l, lo, hi, lazy);
    updi(n->r, lo - 1 - sz(n->l), hi - 1 - sz(n->l), lazy);
    pull(n);
}`,
  query: `Value queryi(ptr n, int lo, int hi) {
    lo = std::max(lo, 0), hi = std::min(hi, sz(n));
    if (!n || lo >= hi) return vid;
    push(n);
    if (lo <= 0 && sz(n) <= hi) return n->agg;
    return queryi(n->l, lo, hi) + (lo <= sz(n->l) && sz(n->l) < hi ? n->val : vid) + queryi(n->r, lo - 1 - sz(n->l), hi - 1 - sz(n->l));
}`,
  agg: 'Value agg(ptr n) { return n ? n->agg : vid; }',
};
const knownVariants = [
  'eager-base', 'deferred-guarded', 'deferred-no-push-skip', 'deferred-fast',
  'eager-no-push-skip', 'eager-no-apply-skip', 'eager-local-tag', 'eager-cover-first',
  'eager-selected-root', 'eager-fast', 'eager-fast-no-apply-skip', 'eager-cover-selected', 'eager-cover-selected-no-apply-skip',
];
const variants = options.variants ? String(options.variants).split(',') : knownVariants;
assert(variants.length && variants.every(variant => knownVariants.includes(variant)), 'Unknown benchmark variant');

function variantSource(generated, variant) {
  let source = generated;
  for (const [name, signature] of Object.entries(signatures)) source = rewrite(source, signature, () => bodies[name]);
  const deferred = variant.startsWith('deferred');
  const fast = variant.includes('fast');
  if (deferred) {
    source = rewrite(source, signatures.apply, () => `void apply(ptr n, Lazy lazy) {
    if (!n || lazy.empty()) return;
    n->lazy += lazy;
}`);
    source = rewrite(source, signatures.push, () => `void push(ptr n) {
    if (!n${variant === 'deferred-no-push-skip' ? '' : ' || n->lazy.empty()'}) return;
    Lazy lazy = n->lazy;
    n->val.upd(lazy, 1);
    n->agg.upd(lazy, sz(n));
    if (lazy.rev) std::swap(n->l, n->r);
    if (n->l) n->l->lazy += lazy;
    if (n->r) n->r->lazy += lazy;
    n->lazy = lid;
}`);
    source = rewrite(source, signatures.agg, () => `Value agg(ptr n) {
    if (!n) return vid;
    Value value = n->agg;
    if (!n->lazy.empty()) value.upd(n->lazy, sz(n));
    return value;
}`);
    if (!fast) {
      source = rewrite(source, signatures.pull, () => `ptr pull(ptr n) {
    if (!n) return nullptr;
    push(n->l), push(n->r);
    n->sz = sz(n->l) + 1 + sz(n->r);
    n->agg = (n->l ? n->l->agg : vid) + n->val + (n->r ? n->r->agg : vid);
    return n;
}`);
      source = rewrite(source, signatures.update, body => body.replace('apply(n, lazy); return;', 'apply(n, lazy); push(n); return;'));
    }
  }
  if (fast || variant.startsWith('eager-cover-')) {
    source = rewrite(source, signatures.update, body => body.replace('    push(n);\n    if (lo == 0 && n->sz == hi) { apply(n, lazy); return; }', '    if (lo == 0 && n->sz == hi) { apply(n, lazy); return; }\n    push(n);'));
    source = rewrite(source, signatures.query, body => body.replace('    push(n);\n    if (lo <= 0 && sz(n) <= hi) return n->agg;', `    if (lo <= 0 && sz(n) <= hi) return ${deferred ? 'agg(n)' : 'n->agg'};\n    push(n);`));
  }
  if (fast || variant === 'eager-selected-root' || variant.startsWith('eager-cover-selected')) {
    source = rewrite(source, signatures.merge, () => `ptr merge(ptr l, ptr r) {
    if (!l || !r) return l ? l : r;
    if (l->pri > r->pri) { push(l); return l->r = merge(l->r, r), pull(l); }
    else { push(r); return r->l = merge(l, r->l), pull(r); }
}`);
  }
  if (!deferred && (fast || variant === 'eager-local-tag')) {
    source = rewrite(source, signatures.push, () => `void push(ptr n) {
    if (!n || n->lazy.empty()) return;
    Lazy lazy = std::exchange(n->lazy, lid);
    apply(n->l, lazy), apply(n->r, lazy);
}`);
  }
  if (variant === 'eager-no-push-skip') source = rewrite(source, signatures.push, body => body.replace('!n || n->lazy.empty()', '!n'));
  if (variant.endsWith('no-apply-skip')) source = rewrite(source, signatures.apply, body => body.replace('!n || lazy.empty()', '!n'));
  for (const [signature, counter] of [[signatures.push, 'pushes'], [signatures.apply, 'applications'], ['void Value::upd(Lazy lazy, int sz)', 'values']]) {
    source = rewrite(source, signature, body => body.replace('{', `{ BENCH_COUNT(${counter});`));
  }
  source = source.replace('void operator+=(const Lazy oth) {', 'void operator+=(const Lazy oth) { BENCH_COUNT(tags);');
  return source;
}

const prelude = `#include <bits/stdc++.h>
struct Op { int kind, l, r, value; };
struct Counts { unsigned long long pushes = 0, applications = 0, values = 0, tags = 0; };
struct Result { double ms; uint64_t hash; Counts counts; size_t bytes; };
#ifdef BENCH_INSTRUMENT
#define BENCH_COUNT(field) (++counters.field)
#else
#define BENCH_COUNT(field) ((void)0)
#endif
void hash_value(uint64_t& hash, long long value) { hash = (hash ^ uint64_t(value)) * 1099511628211ULL; }
std::vector<long long> initial_values(int n, unsigned seed) {
    std::mt19937 rng(seed ^ 0xabcdefU);
    std::vector<long long> values(n);
    for (auto& value : values) value = int(rng() % 41) - 20;
    return values;
}
std::vector<Op> trace(int n, int count, unsigned seed, int workload) {
    std::mt19937 rng(seed);
    std::vector<Op> result;
    for (int i = 0; i < count; ++i) {
        int l = rng() % n, r = l + 1 + rng() % (n - l), roll = rng() % 100;
        int kind = 0, value = int(rng() % 17) - 8;
        if (workload == 0) r = l + 1;
        if (workload == 1) kind = roll < 30 ? 1 : roll < 50 ? 2 : 0;
        if (workload == 2) kind = roll < 70 ? 1 : roll < 90 ? 2 : 0;
        if (workload == 3) { kind = 4; l = rng() % (n + 1); }
        if (workload == 4) kind = roll < 50 ? 3 : roll < 70 ? 1 : 0;
        if (workload == 5) { l = 0; r = n; kind = roll < 90 ? 1 : roll < 95 ? 2 : 0; }
        result.push_back({kind, l, r, value});
    }
    return result;
}
uint64_t oracle(std::vector<long long> values, const std::vector<Op>& ops, bool rich) {
    uint64_t hash = 1469598103934665603ULL;
    auto query = [&](int l, int r) {
        hash_value(hash, std::accumulate(values.begin() + l, values.begin() + r, 0LL));
        if (rich) { hash_value(hash, *std::min_element(values.begin() + l, values.begin() + r)); hash_value(hash, *std::max_element(values.begin() + l, values.begin() + r)); }
    };
    for (const auto& op : ops) {
        if (op.kind == 0) query(op.l, op.r);
        else if (op.kind == 1 || op.kind == 2) for (int i = op.l; i < op.r; ++i) values[i] = (op.kind == 1 ? values[i] : 0) + op.value;
        else if (op.kind == 3) std::reverse(values.begin() + op.l, values.begin() + op.r);
    }
    query(0, values.size());
    for (int i = 0; i < std::min<int>(64, values.size()); ++i) { int at = i * values.size() / std::min<int>(64, values.size()); query(at, at + 1); }
    return hash;
}
`;

function runner(storage, rich) {
  return `
Result run(const std::vector<long long>& initial, const std::vector<Op>& ops, unsigned seed) {
    ${storage === 'array' ? 'node_cnt = 0;' : ''}
    mt.seed(seed);
    std::vector<ptr> data;
    for (auto value : initial) data.push_back(ptr(new Node(Value::make(value))));
    ptr root = build(data);
    uint64_t hash = 1469598103934665603ULL;
    auto take = [&](Value value) { hash_value(hash, value.sum); ${rich ? 'hash_value(hash, value.mn); hash_value(hash, value.mx);' : ''} };
    counters = {};
    const auto start = std::chrono::steady_clock::now();
    for (const auto& op : ops) {
        if (op.kind == 0) take(queryi(root, op.l, op.r));
        else if (op.kind == 1 || op.kind == 2) { Lazy lazy = lid; lazy.val = op.value; lazy.inc = op.kind == 1; updi(root, op.l, op.r, lazy); }
        else if (op.kind == 3) reversei(root, op.l, op.r);
        else { auto parts = spliti(root, op.l); root = merge(parts.first, parts.second); }
    }
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    const Counts measured = counters;
    take(queryi(root, 0, initial.size()));
    for (int i = 0; i < std::min<int>(64, initial.size()); ++i) { int at = i * initial.size() / std::min<int>(64, initial.size()); take(queryi(root, at, at + 1)); }
    if (sz(root) != int(initial.size())) throw std::runtime_error("benchmark size mismatch");
    delete root;
    return {ms, hash, measured, sizeof(Node)};
}
`;
}

try {
  console.log(`Benchmark workdir: ${dir}`);
  console.log(`CPU: ${cpus()[0]?.model}; affinity: ${options.cpu ?? 'unrestricted'}; compiler: g++ -std=c++17 -O2`);
  await build({ entryPoints: [join(root, 'src/codegen/treapConfig.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'generator.cjs'), logLevel: 'silent' });
  const { generateTreapCode } = createRequire(import.meta.url)(join(dir, 'generator.cjs'));
  let source = prelude;
  const profiles = [];
  for (const storage of storages) for (const payload of payloads) for (const variant of variants) {
    const name = `profile_${profiles.length}`;
    const code = generateTreapCode({ key_type: 'none', val_type: 'long long', range_sum: true, range_min: payload === 'rich', range_max: payload === 'rich', merge_option: true, build_option: true, spliti_option: true, range_query_index: true, range_update_index: true, range_add: true, range_set: true, range_reverse_index: true, array_storage: storage === 'array', array_storage_size: String(Math.max(nodes, 64) + 1), use_namespace_std: false, namespace_treap: false, template: false, comments: false });
    source += `\nnamespace ${name} {\nCounts counters;\n${variantSource(code, variant)}\n${runner(storage, payload === 'rich')}\n}\n`;
    profiles.push(`{"${storage}", "${payload}", "${variant}", ${payload === 'rich'}, ${name}::run}`);
  }
  source += `
struct Profile { const char* storage; const char* payload; const char* variant; bool rich; Result (*run)(const std::vector<long long>&, const std::vector<Op>&, unsigned); };
int main(int argc, char** argv) {
    const bool instrument = argc > 1;
    const std::vector<Profile> profiles = {${profiles.join(',\n')}};
    const char* workloads[] = {"point", "mixed", "update-heavy", "split-merge", "reverse-mix", "whole-tree"};
    for (const auto& profile : profiles) for (int w = 0; w < 6; ++w) {
        auto initial = initial_values(64, 42);
        auto ops = trace(64, 350, 42, w);
        if (profile.run(initial, ops, 42).hash != oracle(initial, ops, profile.rich)) { std::cerr << "oracle mismatch " << profile.storage << " " << profile.payload << " " << profile.variant << " " << workloads[w] << "\\n"; return 1; }
    }
    std::cerr << "All benchmark variants passed independent vector-oracle checks\\n";
    for (unsigned seed : {${seeds.map(seed => `${seed}U`).join(', ')}}) {
        auto initial = initial_values(${nodes}, seed);
        for (int w = 0; w < 6; ++w) {
            auto ops = trace(${nodes}, w == 5 ? ${fullOperations} : ${operations}, seed, w);
            std::map<bool, uint64_t> expected;
            for (int round = -1; round < (instrument ? 1 : ${rounds}); ++round) {
                if (instrument && round == -1) continue;
                const auto warm = round == -1 ? trace(${nodes}, 1000, seed, w) : std::vector<Op>{};
                for (size_t j = 0; j < profiles.size(); ++j) {
                    const auto& profile = profiles[(j + seed + round + 1) % profiles.size()];
                    Result result = profile.run(initial, round == -1 ? warm : ops, seed);
                    if (round == -1) continue;
                    if (expected.count(profile.rich) && expected[profile.rich] != result.hash) { std::cerr << "trace mismatch " << profile.variant << " " << workloads[w] << "\\n"; return 1; }
                    expected[profile.rich] = result.hash;
                    std::cout << profile.storage << ',' << profile.payload << ',' << profile.variant << ',' << workloads[w] << ',' << seed << ',' << round << ',' << std::setprecision(12) << result.ms << ',' << ops.size() << ',' << result.hash << ',' << result.bytes << ',' << result.counts.pushes << ',' << result.counts.applications << ',' << result.counts.values << ',' << result.counts.tags << '\\n';
                }
            }
        }
        if (instrument) break;
    }
}
`;
  const cpp = join(dir, 'bench.cpp'), binary = join(dir, 'bench'), counted = join(dir, 'bench-counts');
  await writeFile(cpp, source);
  await run('g++', ['-std=c++17', '-O2', '-fmax-errors=3', cpp, '-o', binary], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  await run('g++', ['-std=c++17', '-O2', '-DBENCH_INSTRUMENT', '-fmax-errors=3', cpp, '-o', counted], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const execute = async (file, args = []) => run(options.cpu === undefined ? file : 'taskset', options.cpu === undefined ? args : ['-c', String(options.cpu), file, ...args], { timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
  console.log(`Running ${profiles.length} variants, ${nodes} nodes, ${operations} operations (${fullOperations} whole-tree), ${seeds.length} seeds, ${rounds} measured rounds after warmup; serial execution.`);
  const timed = await execute(binary);
  console.log(timed.stderr.trim());
  const counts = await execute(counted, ['counts']);
  const parse = text => text.trim().split('\n').filter(Boolean).map(line => {
    const [storage, payload, variant, workload, seed, round, ms, operations, hash, bytes, pushes, applications, values, tags] = line.split(',');
    return { storage, payload, variant, workload, seed: Number(seed), round: Number(round), ms: Number(ms), operations: Number(operations), hash, bytes: Number(bytes), pushes: Number(pushes), applications: Number(applications), values: Number(values), tags: Number(tags) };
  });
  const timings = parse(timed.stdout), counters = parse(counts.stdout);
  const median = values => { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor(ordered.length / 2)]; };
  for (const storage of storages) for (const payload of payloads) {
    console.log(`\n${storage} / ${payload}: median nanoseconds per operation`);
    console.log('variant'.padEnd(28) + ['point', 'mixed', 'update-heavy', 'split-merge', 'reverse-mix', 'whole-tree'].map(x => x.padStart(14)).join(''));
    for (const variant of variants) {
      const values = ['point', 'mixed', 'update-heavy', 'split-merge', 'reverse-mix', 'whole-tree'].map(workload => median(timings.filter(row => row.storage === storage && row.payload === payload && row.variant === variant && row.workload === workload).map(row => row.ms * 1e6 / row.operations)));
      console.log(variant.padEnd(28) + values.map(value => value.toFixed(1).padStart(14)).join(''));
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ cpu: cpus()[0]?.model, affinity: options.cpu ?? null, compiler: 'g++ -std=c++17 -O2', nodes, operations, fullOperations, rounds, seeds, timings, counters }, null, 2));
  console.log(`\nRaw timings and untimed operation counters: ${join(dir, 'results.json')}`);
  passed = true;
} finally {
  if (passed && !options.keep) await rm(dir, { recursive: true, force: true });
  else console.log(`Benchmark sources/results retained in ${dir}`);
}
