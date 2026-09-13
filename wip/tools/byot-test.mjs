#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const args = parseArgs(process.argv.slice(2));
const jobs = Number(args.jobs ?? Math.max(1, Math.min(availableParallelism?.() ?? 4, 8)));
if (!Number.isInteger(jobs) || jobs < 1) throw new Error("--jobs must be a positive integer");
const seedArgs = String(args.seeds ?? "1,1234567,314159").split(",").map(seed => seed.trim());
const seeds = seedArgs.map(Number);
if (seedArgs.some(seed => !/^\d+$/.test(seed)) || seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
  throw new Error("--seeds must be comma-separated unsigned 32-bit integers");
}
const keep = Boolean(args.keep);
const mode = args.mode ?? "all";
const outDir = await mkdtemp(join(args.outDir ? resolve(String(args.outDir)) : tmpdir(), "byot-test-"));

const esbuild = await import("esbuild");
const generatorBundle = join(outDir, "byot-generator.cjs");
await esbuild.build({
  stdin: {
    contents: 'export * from "./src/codegen/treapConfig"; export * from "./src/codegen/features"; export * from "./src/codegen/depsUtil";',
    resolveDir: projectRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: generatorBundle,
  logLevel: "silent",
});
const { generateTreapCode, features, edges, mutualExclusions, topsort, normalizeConfig, deriveConfig, enableWithDependencies, createDefaultConfig } = require(generatorBundle);
const matches = testCase => !args.filter || testCase.name.includes(args.filter);
const selectedCompile = mode === "stress" ? [] : buildCompileCases().filter(matches);
const selectedStress = mode === "compile" ? [] : buildStressCases().filter(matches);

const startedAt = Date.now();
let passed = false;
try {
  console.log(`BYOT local tests: ${selectedCompile.length} compile cases, ${selectedStress.length} stress cases, ${jobs} jobs, seeds ${seeds.join(",")}`);
  console.log(`workdir: ${outDir}`);
  assertGeneratorInvariants(generateTreapCode);
  if (!selectedCompile.length && !selectedStress.length) throw new Error("no tests matched");

  const compileTasks = selectedCompile.map((testCase) => async () => {
    const source = testCase.source ?? compileHarness(generateTreapCode(derive(testCase.config)));
    return compileCase(testCase.name, source);
  });

  const stressTasks = selectedStress.map((testCase) => async () => {
    const code = generateTreapCode(derive(testCase.config));
    const source = stressHarness(code, testCase.body);
    const bin = await compileCase(testCase.name, source);
    for (const seed of seeds) await runBinary(testCase.name, bin, testCase.timeoutMs ?? 6000, seed, testCase.config.persistent);
    return bin;
  });

  await runPool([...compileTasks, ...stressTasks], jobs);
  passed = true;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`OK: BYOT tests passed in ${elapsed}s`);
} finally {
  if (passed && !keep) await rm(outDir, { recursive: true, force: true });
  else console.log(`Generated sources and binaries retained in ${outDir}`);
}

function parseArgs(argv) {
  const result = {};
  const valueOptions = { "--jobs": "jobs", "--out-dir": "outDir", "--filter": "filter", "--seeds": "seeds" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.split("=", 1)[0];
    if (Object.hasOwn(valueOptions, name)) {
      const value = arg.includes("=") ? arg.slice(name.length + 1) : argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
      result[valueOptions[name]] = value;
    } else if (arg === "--keep") result.keep = true;
    else if (arg === "--compile-only") result.mode = "compile";
    else if (arg === "--stress-only") result.mode = "stress";
    else if (arg === "--sanitize") result.sanitize = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: npm run test:byot -- [--compile-only|--stress-only] [--jobs N] [--filter NAME] [--seeds N,N] [--sanitize] [--keep] [--out-dir DIR]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return result;
}

function derive(cfg) {
  return normalizeConfig({ use_namespace_std: false, ...cfg });
}

function baseCppConfig(overrides = {}) {
  return derive({
    use_namespace_std: false,
    use_ll_typedef: false,
    namespace_treap: false,
    template: false,
    comments: false,
    tab_char: "4spaces",
    range_type: "inc exc",
    key_type: "none",
    val_type: "none",
    ...overrides,
  });
}

function assertGeneratorInvariants(generate) {
  assert.equal(topsort(edges).length, new Set(edges.flat()).size);
  for (const [a, b] of mutualExclusions) assert.throws(() => generate({ [a]: true, [b]: true }), /Incompatible treap features/);
  const code = generate({
    signature: false,
    comments: false,
    template: false,
    use_namespace_std: false,
    use_ll_typedef: false,
    namespace_treap: false,
    tab_char: "4spaces",
    range_type: "inc exc",
    key_type: "int",
    val_type: "none",
    array_storage: true,
  });
  if (!code.includes("ptr mn(ptr n)")) {
    throw new Error("array storage must force augmented ptr dependencies, including mn()");
  }
  assert(code.includes("const int NODE_CAP = 1 << 17;"));
  assert(code.includes("alignas(Node) unsigned char nodes[NODE_CAP][sizeof(Node)];"));
  assert(code.includes("throw std::bad_alloc()"));
  for (const cfg of [{ persistent: true, par_option: true }, { persistent: true, order_option: true }, { persistent: true, beats_chmin: true }, { beats_chmin: true, range_set: true }]) {
    assert.throws(() => generate(cfg), /Incompatible treap features/);
  }
  const cfg = { ...createDefaultConfig(), key_type: "long long", val_type: "long long" };
  enableWithDependencies(cfg, "range_query_key");
  assert.equal(cfg.key_type, "long long");
  assert.equal(cfg.val_type, "long long");
  assert.equal(deriveConfig(cfg).range_query_key, true);
  enableWithDependencies(cfg, "order_option");
  enableWithDependencies(cfg, "persistent");
  assert.equal(deriveConfig(cfg).order_option, false);
  assert.equal(deriveConfig(cfg).persistent, true);
  cfg.size_option = false;
  assert.equal(deriveConfig(cfg).persistent, false);
}

function buildCompileCases() {
  const cases = [
    {
      name: "raw-safe-merge",
      config: baseCppConfig({ key_type: "int", merge_option: true, safe_merge_option: true }),
    },
    {
      name: "key-core",
      config: baseCppConfig({
        key_type: "int",
        merge_option: true,
        split_option: true,
        three_split_option: true,
        find_option: true,
        ins_option: true,
        del_option: true,
        del_all_option: true,
        min_option: true,
        max_option: true,
        lower_bound_option: true,
        upper_bound_option: true,
      }),
    },
    {
      name: "implicit-core",
      config: baseCppConfig({
        merge_option: true,
        size_option: true,
        spliti_option: true,
        three_spliti_option: true,
        findi_option: true,
        insi_option: true,
        deli_option: true,
        modi_option: true,
        rot_option: true,
      }),
    },
    {
      name: "index-lazy-inc-exc",
      config: indexLazyConfig("inc exc"),
    },
    {
      name: "index-lazy-inc-inc",
      config: indexLazyConfig("inc inc"),
    },
    {
      name: "key-range-lazy",
      config: keyRangeLazyConfig("inc exc"),
    },
    {
      name: "key-range-lazy-inc-inc",
      config: keyRangeLazyConfig("inc inc"),
    },
    {
      name: "augmented-plus-iterators",
      config: baseCppConfig({
        augmented_ptr: true,
        key_type: "int",
        merge_option: true,
        plus_merge_option: true,
        safe_merge_plus: true,
        min_option: true,
        succ: true,
        pred: true,
        par_option: true,
        size_option: true,
      }),
    },
    {
      name: "partitions-and-tour",
      config: baseCppConfig({
        key_type: "int",
        enable_value: true,
        val_type: "long long",
        range_agg: true,
        range_sum: true,
        merge_option: true,
        split_option: true,
        min_option: true,
        unite_option: true,
        heapify_option: true,
        build_option: true,
        tour_option: true,
        partition_key: true,
        partition_index: true,
        cumulative_partition_key: true,
        cumulative_partition_index: true,
        size_option: true,
      }),
    },
    {
      name: "namespace-template-typedef",
      config: baseCppConfig({
        signature: true,
        template: true,
        use_namespace_std: true,
        use_ll_typedef: true,
        key_type: "long long",
        merge_option: true,
        split_option: true,
      }),
    },
    {
      name: "treap-beats-index",
      config: treapBeatsConfig(),
    },
    {
      name: "array-storage-index-lazy",
      config: arrayStorageIndexConfig(),
    },
    {
      name: "size-biased-key-core",
      config: baseCppConfig({
        key_type: "int",
        merge_option: true,
        size_option: true,
        size_biased_merge: true,
        split_option: true,
        ins_option: true,
        del_option: true,
      }),
    },
    {
      name: "persistent-index-lazy",
      config: persistentIndexConfig({ array_storage: false }),
    },
    {
      name: "persistent-array-index-lazy",
      config: persistentIndexConfig({ array_storage: true }),
    },
    {
      name: "persistent-find-tour",
      config: persistentIndexConfig({ findi_option: true, tour_option: true }),
    },
  ];

  cases.push(...featureCompileCases(), ...pairwiseCompileCases());
  return cases;
}

function buildStressCases() {
  return [
    ...regressionCases(),
    {
      name: "stress-index-inc-exc",
      config: indexLazyConfig("inc exc"),
      body: indexStressBody("inc exc"),
    },
    {
      name: "stress-index-inc-inc",
      config: indexLazyConfig("inc inc"),
      body: indexStressBody("inc inc"),
    },
    {
      name: "stress-key-range",
      config: keyRangeLazyConfig("inc exc"),
      body: keyRangeStressBody("inc exc"),
    },
    {
      name: "stress-key-range-inc-inc",
      config: keyRangeLazyConfig("inc inc"),
      body: keyRangeStressBody("inc inc"),
    },
    {
      name: "stress-treap-beats-add",
      config: treapBeatsAddConfig(),
      body: treapBeatsAddStressBody(),
    },
    {
      name: "stress-array-storage-index",
      config: arrayStorageIndexConfig(),
      body: indexStressBody("inc exc"),
    },
    {
      name: "stress-persistent-index",
      config: persistentIndexConfig({ array_storage: false }),
      body: persistentIndexStressBody(),
    },
    {
      name: "stress-persistent-array-index",
      config: persistentIndexConfig({ array_storage: true }),
      body: persistentIndexStressBody(),
    },
  ];
}

function indexLazyConfig(rangeType) {
  return baseCppConfig({
    range_type: rangeType,
    merge_option: true,
    size_option: true,
    spliti_option: true,
    insi_option: true,
    deli_option: true,
    enable_value: true,
    val_type: "long long",
    range_agg: true,
    range_sum: true,
    lazy_prop: true,
    range_add: true,
    range_set: true,
    range_reverse_index: true,
    range_update_index: true,
    range_query_index: true,
  });
}

function keyRangeLazyConfig(rangeType) {
  return baseCppConfig({
    range_type: rangeType,
    key_type: "int",
    merge_option: true,
    split_option: true,
    size_option: true,
    find_option: true,
    ins_option: true,
    del_option: true,
    enable_value: true,
    val_type: "long long",
    range_agg: true,
    range_sum: true,
    lazy_prop: true,
    range_add: true,
    range_set: true,
    range_update_key: true,
    range_query_key: true,
  });
}

function treapBeatsConfig() {
  return baseCppConfig({
    range_type: "inc exc",
    merge_option: true,
    size_option: true,
    enable_value: true,
    val_type: "long long",
    range_agg: true,
    lazy_prop: true,
    range_update_index: true,
    range_query_index: true,
    treap_beats: true,
    beats_chmin: true,
    beats_chmax: true,
    beats_add: true,
  });
}

function treapBeatsAddConfig() {
  return baseCppConfig({
    range_type: "inc exc",
    merge_option: true,
    size_option: true,
    enable_value: true,
    val_type: "long long",
    range_agg: true,
    lazy_prop: true,
    range_update_index: true,
    range_query_index: true,
    treap_beats: true,
    beats_add: true,
  });
}

function arrayStorageIndexConfig() {
  return {
    ...indexLazyConfig("inc exc"),
    array_storage: true,
    array_storage_size: "1 << 17",
    augmented_ptr: true,
  };
}

function persistentIndexConfig(overrides = {}) {
  return {
    ...indexLazyConfig("inc exc"),
    persistent: true,
    size_biased_merge: true,
    merge_option: true,
    size_option: true,
    array_storage_size: "1 << 20",
    min_option: true,
    max_option: true,
    findi_option: true,
    modi_option: true,
    rot_option: true,
    tour_option: true,
    ...overrides,
    augmented_ptr: Boolean(overrides.augmented_ptr || overrides.array_storage),
  };
}

function compileHarness(generated) {
  if (/\bmain\s*\(/.test(generated)) return generated;
  return `#include <bits/stdc++.h>
using namespace std;

${generated}

int main() {
    return 0;
}
`;
}

function stressHarness(generated, body) {
  return `#include <bits/stdc++.h>
using namespace std;

${generated}

static const unsigned test_seed = std::stoul(std::getenv("BYOT_SEED"));
static void fail_test(const string& msg) {
    cerr << "seed=" << test_seed << " " << msg << "\\n";
    exit(1);
}

${body.replace(/int main\(\)\s*\{/, "int main() {\n    mt.seed(test_seed);").replace(/mt19937 rng\(\d+\)/g, "mt19937 rng(test_seed)")}
`;
}

function indexStressBody(rangeType) {
  const hiExpr = rangeType === "inc exc" ? "r" : "r - 1";
  return `
int main() {
    mt19937 rng(1234567);
    ptr root = nullptr;
    vector<long long> brute;

    auto make_node = [](long long x) {
        return new Node(Value{x});
    };
    auto range_sum_brute = [&](int l, int r) {
        long long res = 0;
        for (int i = l; i < r; i++) res += brute[i];
        return res;
    };
    auto check_all = [&]() {
        if (sz(root) != (int)brute.size()) fail_test("size mismatch");
        for (int l = 0; l <= (int)brute.size(); l++) {
            for (int r = l; r <= (int)brute.size(); r++) {
                long long got = queryi(root, l, ${hiExpr}).sum;
                long long exp = range_sum_brute(l, r);
                if (got != exp) {
                    cerr << "query mismatch l=" << l << " r=" << r << " got=" << got << " exp=" << exp << "\\n";
                    return 1;
                }
            }
        }
        return 0;
    };

    for (int step = 0; step < 900; step++) {
        int n = (int)brute.size();
        int op = uniform_int_distribution<int>(0, n == 0 ? 1 : 6)(rng);
        if (op == 0 && n < 35) {
            int pos = uniform_int_distribution<int>(0, n)(rng);
            long long val = uniform_int_distribution<int>(-20, 20)(rng);
            insi(root, make_node(val), pos);
            brute.insert(brute.begin() + pos, val);
        } else if (op == 1 && n > 0) {
            int pos = uniform_int_distribution<int>(0, n - 1)(rng);
            ptr removed = deli(root, pos);
            if (removed) delete removed;
            brute.erase(brute.begin() + pos);
        } else if (n > 0) {
            int l = uniform_int_distribution<int>(0, n - 1)(rng);
            int r = uniform_int_distribution<int>(l + 1, n)(rng);
            if (op == 2) {
                long long delta = uniform_int_distribution<int>(-9, 9)(rng);
                Lazy lazy = lid;
                lazy.val = delta;
                lazy.inc = true;
                updi(root, l, ${hiExpr}, lazy);
                for (int i = l; i < r; i++) brute[i] += delta;
            } else if (op == 3) {
                long long val = uniform_int_distribution<int>(-15, 15)(rng);
                Lazy lazy = lid;
                lazy.val = val;
                lazy.inc = false;
                updi(root, l, ${hiExpr}, lazy);
                for (int i = l; i < r; i++) brute[i] = val;
            } else if (op == 4) {
                reversei(root, l, ${hiExpr});
                reverse(brute.begin() + l, brute.begin() + r);
            } else {
                long long got = queryi(root, l, ${hiExpr}).sum;
                long long exp = range_sum_brute(l, r);
                if (got != exp) {
                    cerr << "point query mismatch step=" << step << " l=" << l << " r=" << r << " got=" << got << " exp=" << exp << "\\n";
                    return 1;
                }
            }
        }
        if (step % 37 == 0 && check_all()) return 1;
    }
    if (check_all()) return 1;
    delete root;
}
`;
}

function keyRangeStressBody(rangeType) {
  const hiExpr = rangeType === "inc exc" ? "hi" : "hi - 1";
  return `
int main() {
    mt19937 rng(987654);
    ptr root = nullptr;
    vector<pair<int, long long>> brute;

    auto pos_of = [&](int key) {
        return lower_bound(brute.begin(), brute.end(), pair<int, long long>{key, LLONG_MIN});
    };
    auto check_total = [&]() {
        long long exp = 0;
        for (auto [_, value] : brute) exp += value;
        long long got = query(root, -1000000, ${rangeType === "inc exc" ? "1000000" : "999999"}).sum;
        if (got != exp) {
            cerr << "total mismatch got=" << got << " exp=" << exp << "\\n";
            return 1;
        }
        return 0;
    };

    for (int step = 0; step < 700; step++) {
        int op = uniform_int_distribution<int>(0, 5)(rng);
        if (op == 0 && (int)brute.size() < 45) {
            int key = uniform_int_distribution<int>(-80, 80)(rng);
            auto it = pos_of(key);
            if (it != brute.end() && it->first == key) continue;
            long long val = uniform_int_distribution<int>(-30, 30)(rng);
            ins(root, new Node(key, Value{val}));
            brute.insert(it, {key, val});
        } else if (op == 1 && !brute.empty()) {
            int idx = uniform_int_distribution<int>(0, (int)brute.size() - 1)(rng);
            int key = brute[idx].first;
            ptr removed = del(root, key);
            if (removed) delete removed;
            brute.erase(brute.begin() + idx);
        } else if (!brute.empty()) {
            int a = uniform_int_distribution<int>(-90, 90)(rng);
            int b = uniform_int_distribution<int>(-90, 90)(rng);
            int lo = min(a, b);
            int hi = max(a, b) + 1;
            if (op == 2) {
                long long delta = uniform_int_distribution<int>(-7, 7)(rng);
                Lazy lazy = lid;
                lazy.val = delta;
                lazy.inc = true;
                upd(root, lo, ${hiExpr}, lazy);
                for (auto& [key, value] : brute) if (lo <= key && key < hi) value += delta;
            } else if (op == 3) {
                long long val = uniform_int_distribution<int>(-20, 20)(rng);
                Lazy lazy = lid;
                lazy.val = val;
                lazy.inc = false;
                upd(root, lo, ${hiExpr}, lazy);
                for (auto& [key, value] : brute) if (lo <= key && key < hi) value = val;
            } else {
                long long exp = 0;
                for (auto [key, value] : brute) if (lo <= key && key < hi) exp += value;
                long long got = query(root, lo, ${hiExpr}).sum;
                if (got != exp) {
                    cerr << "range mismatch step=" << step << " lo=" << lo << " hi=" << hi << " got=" << got << " exp=" << exp << "\\n";
                    return 1;
                }
            }
        }
        if (step % 29 == 0 && check_total()) return 1;
    }
    if (check_total()) return 1;
    delete root;
}
`;
}

function treapBeatsAddStressBody() {
  return `
int main() {
    mt19937 rng(424242);
    ptr root = nullptr;
    vector<long long> brute;

    for (int i = 0; i < 40; i++) {
        long long val = uniform_int_distribution<int>(-40, 40)(rng);
        root = merge(root, new Node(Value::make(val)));
        brute.push_back(val);
    }

    auto range_sum_brute = [&](int l, int r) {
        long long res = 0;
        for (int i = l; i < r; i++) res += brute[i];
        return res;
    };
    auto check_all = [&]() {
        for (int l = 0; l <= (int)brute.size(); l++) {
            for (int r = l; r <= (int)brute.size(); r++) {
                long long got = queryi(root, l, r).sum;
                long long exp = range_sum_brute(l, r);
                if (got != exp) {
                    cerr << "beats add mismatch l=" << l << " r=" << r << " got=" << got << " exp=" << exp << "\\n";
                    return 1;
                }
            }
        }
        return 0;
    };

    for (int step = 0; step < 600; step++) {
        int l = uniform_int_distribution<int>(0, (int)brute.size() - 1)(rng);
        int r = uniform_int_distribution<int>(l + 1, (int)brute.size())(rng);
        if (uniform_int_distribution<int>(0, 2)(rng)) {
            long long delta = uniform_int_distribution<int>(-8, 8)(rng);
            updi(root, l, r, add_tag(delta));
            for (int i = l; i < r; i++) brute[i] += delta;
        } else {
            long long got = queryi(root, l, r).sum;
            long long exp = range_sum_brute(l, r);
            if (got != exp) {
                cerr << "beats add range mismatch step=" << step << " l=" << l << " r=" << r << " got=" << got << " exp=" << exp << "\\n";
                return 1;
            }
        }
        if (step % 31 == 0 && check_all()) return 1;
    }
    if (check_all()) return 1;
    delete root;
}
`;
}

function persistentIndexStressBody() {
  return `
int main() {
    mt19937 rng(314159);
    vector<ptr> roots;
    vector<vector<long long>> states;

    ptr root = nullptr;
    vector<long long> brute;
    for (int i = 0; i < 12; i++) {
        long long val = uniform_int_distribution<int>(-20, 20)(rng);
        root = merge(root, new Node(Value{val}));
        brute.push_back(val);
    }
    roots.push_back(root);
    states.push_back(brute);

    auto brute_sum = [](const vector<long long>& a, int l, int r) {
        long long res = 0;
        for (int i = l; i < r; i++) res += a[i];
        return res;
    };
    auto check_version = [&](int id) {
        const auto& a = states[id];
        ptr rt = roots[id];
        vector<pair<ptr, Node>> snapshot;
        function<void(ptr)> capture = [&](ptr n) {
            if (!n) return;
            snapshot.emplace_back(n, *n);
            capture(n->l); capture(n->r);
        };
        capture(rt);
        if (sz(rt) != (int)a.size()) {
            cerr << "persistent size mismatch version=" << id << " got=" << sz(rt) << " exp=" << a.size() << "\\n";
            return 1;
        }
        for (int rep = 0; rep < 8; rep++) {
            int n = (int)a.size();
            int l = n ? uniform_int_distribution<int>(0, n - 1)(rng) : 0;
            int r = n ? uniform_int_distribution<int>(l + 1, n)(rng) : 0;
            long long got = queryi(rt, l, r).sum;
            long long exp = brute_sum(a, l, r);
            if (got != exp) {
                cerr << "persistent query mismatch version=" << id << " l=" << l << " r=" << r << " got=" << got << " exp=" << exp << "\\n";
                return 1;
            }
        }
        vector<long long> traversed;
        tour(rt, [&](ptr n) { traversed.push_back(n->val.sum); });
        if (traversed != a) fail_test("persistent traversal");
        if (!a.empty() && (mn(rt)->val.sum != a.front() || mx(rt)->val.sum != a.back())) fail_test("persistent minimum/maximum");
        for (int i = 0; i < (int)a.size(); ++i) if (findi(rt, i)->val.sum != a[i]) fail_test("persistent find by index");
        if (agg(rt).sum != brute_sum(a, 0, a.size())) fail_test("persistent cached aggregate");
        for (const auto& [n, before] : snapshot) {
            if (n->l != before.l || n->r != before.r || n->sz != before.sz || n->val.sum != before.val.sum || n->agg.sum != before.agg.sum || n->lazy.val != before.lazy.val || n->lazy.inc != before.lazy.inc || n->lazy.rev != before.lazy.rev) fail_test("read operation mutated a persistent version");
        }
        return 0;
    };

    for (int step = 0; step < 260; step++) {
        int base = uniform_int_distribution<int>(0, (int)roots.size() - 1)(rng);
        ptr cur = roots[base];
        vector<long long> now = states[base];
        int n = (int)now.size();
        int op = uniform_int_distribution<int>(0, n == 0 ? 1 : 8)(rng);

        if (op == 0 && n < 32) {
            int pos = uniform_int_distribution<int>(0, n)(rng);
            long long val = uniform_int_distribution<int>(-25, 25)(rng);
            insi(cur, new Node(Value{val}), pos);
            now.insert(now.begin() + pos, val);
        } else if (op == 1 && n > 0) {
            int pos = uniform_int_distribution<int>(0, n - 1)(rng);
            (void)deli(cur, pos);
            now.erase(now.begin() + pos);
        } else if (n > 0) {
            int l = uniform_int_distribution<int>(0, n - 1)(rng);
            int r = uniform_int_distribution<int>(l + 1, n)(rng);
            if (op == 2) {
                Lazy lazy = lid;
                lazy.val = uniform_int_distribution<int>(-8, 8)(rng);
                lazy.inc = true;
                updi(cur, l, r, lazy);
                for (int i = l; i < r; i++) now[i] += lazy.val;
            } else if (op == 3) {
                Lazy lazy = lid;
                lazy.val = uniform_int_distribution<int>(-18, 18)(rng);
                lazy.inc = false;
                updi(cur, l, r, lazy);
                for (int i = l; i < r; i++) now[i] = lazy.val;
            } else if (op == 4) {
                reversei(cur, l, r);
                reverse(now.begin() + l, now.begin() + r);
            } else if (op == 6) {
                now[l] = int(rng() % 31) - 15;
                modifyi(cur, l, [&](ptr n) { n->val = Value::make(now[l]); });
            } else if (op == 7) {
                rotate(cur, l);
                rotate(now.begin(), now.begin() + l, now.end());
            } else if (op == 8 && n <= 16) {
                cur = merge(cur, cur);
                auto copy = now;
                now.insert(now.end(), copy.begin(), copy.end());
            } else {
                long long got = queryi(cur, l, r).sum;
                long long exp = brute_sum(now, l, r);
                if (got != exp) {
                    cerr << "persistent live query mismatch step=" << step << " got=" << got << " exp=" << exp << "\\n";
                    return 1;
                }
            }
        }

        roots.push_back(cur);
        states.push_back(now);
        if (check_version((int)roots.size() - 1)) return 1;
        if (check_version(base)) return 1;
        int old = uniform_int_distribution<int>(0, (int)roots.size() - 1)(rng);
        if (check_version(old)) return 1;
    }

    for (int id = 0; id < (int)roots.size(); ++id) {
        if (check_version(id)) return 1;
    }
}
`;
}

function configFor(keys, overrides = {}) {
  return derive({ ...overrides, ...Object.fromEntries(keys.map(key => [key, true])) });
}

function featureCompileCases() {
  const variants = features.filter(f => f.type !== "select").map(f => ({
    name: f.key,
    config: configFor([f.key]),
  }));
  variants.push(
    { name: "long-long-extrema", config: configFor(["range_min", "range_max"], { val_type: "long long" }) },
    { name: "beats-key-updates", config: configFor(["beats_chmin", "beats_chmax", "range_update_key"]) },
    { name: "augmented-find", config: configFor(["augmented_ptr", "find_option", "findi_option", "order_option", "unite_option"]) },
  );
  return variants.map(({ name, config }) => {
    const cfg = { ...config, template: false, use_namespace_std: false, use_ll_typedef: false };
    let calls = "ptr n = nullptr;\n";
    if (cfg.n_merge_option) calls += "n = merge(n, n, n);\n";
    if (cfg.mod_option) calls += "modify(n, 0, [](ptr) {});\n";
    if (cfg.modi_option) calls += "modifyi(n, 0, [](ptr) {});\n";
    if (cfg.partition_key) calls += "(void)partition_key(n, [](ptr) { return true; });\n";
    if (cfg.partition_index) calls += "(void)partition_index(n, [](ptr) { return true; });\n";
    if (cfg.cumulative_partition_key) calls += "(void)cumulative_partition_key(n, [](Value) { return true; });\n";
    if (cfg.cumulative_partition_index) calls += "(void)cumulative_partition_index(n, [](Value) { return true; });\n";
    if (cfg.tour_option) calls += "tour(n, [](ptr) {});\n";
    return {
      name: `feature-${name}`,
      source: `#include <bits/stdc++.h>\nusing T = long long;\n${generateTreapCode(cfg)}\nint main() { ${calls} }\n`,
    };
  });
}

function compileCalls(cfg) {
  let calls = "ptr n = new Node();\n";
  if (cfg.augmented_ptr) calls += "ptr made = ptr::make(); (void)made;\n";
  if (cfg.n_merge_option) calls += "n = merge(); n = merge(n); n = merge(n, n, n, n);\n";
  if (cfg.mod_option) calls += "modify(n, {}, [](ptr) {});\n";
  if (cfg.modi_option) calls += "modifyi(n, 0, [](ptr) {});\n";
  if (cfg.partition_key) calls += "(void)partition_key(n, [](ptr) { return true; });\n";
  if (cfg.partition_index) calls += "(void)partition_index(n, [](ptr) { return true; });\n";
  if (cfg.cumulative_partition_key) calls += "(void)cumulative_partition_key(n, [](Value) { return true; });\n";
  if (cfg.cumulative_partition_index) calls += "(void)cumulative_partition_index(n, [](Value) { return true; });\n";
  if (cfg.tour_option) calls += "tour(n, [](ptr) {});\n";
  if (cfg.augmented_ptr && cfg.succ) calls += "for (Node& node : n) (void)node; (void)std::next(n);\n";
  if (cfg.plus_merge_option) calls += "ptr a, b; n = a + b; n = a + ptr{}; n = ptr{} + b; n = ptr{} + ptr{}; a += b; a += ptr{};\n";
  return calls;
}

function pairwiseCompileCases() {
  const keys = features.filter(f => f.type !== "select").map(f => f.key);
  const variants = [];
  for (let i = 0; i < keys.length; ++i) {
    for (let j = i + 1; j < keys.length; ++j) {
      const id = i * keys.length + j;
      try {
        const cfg = configFor([keys[i], keys[j]], {
          range_type: id % 2 ? "inc inc" : "inc exc",
          ...(id % 3 === 0 ? { key_type: "long long" } : {}),
          ...(id % 5 === 0 ? { val_type: "long long" } : {}),
        });
        variants.push({ name: `${keys[i]}+${keys[j]}`, cfg });
      } catch (error) {
        if (!/Incompatible treap features/.test(error.message)) throw error;
      }
    }
  }
  for (const feature of features.filter(f => f.type === "select")) {
    for (const option of feature.options) variants.push({ name: `${feature.key}=${option.value}`, cfg: configFor(["ins_option", "range_query_index", "range_sum"], { [feature.key]: option.value }) });
  }
  const cases = [];
  for (let start = 0; start < variants.length; start += 32) {
    const chunk = variants.slice(start, start + 32);
    const source = chunk.map(({ name, cfg }, i) => {
      const code = generateTreapCode({ ...cfg, template: false });
      return `#line 1 "${name}"\nnamespace variant_${i} {\nusing namespace std;\nusing ll = long long;\nusing T = long long;\n${code}\nvoid instantiate() { ${compileCalls(cfg)} }\n}\n`;
    }).join("\n");
    cases.push({
      name: `matrix-${String(cases.length).padStart(3, "0")}`,
      source: `#include <bits/stdc++.h>\n${source}\nint main() {}\n`,
    });
  }
  console.log(`Feature matrix: ${variants.length} configurations in ${cases.length} translation units`);
  return cases;
}

function regressionCases() {
  const cases = [...extendedRegressionCases()];
  for (const storage of ["raw", "augmented", "array"]) {
    for (const sizeBiased of [false, true]) {
      cases.push({
        name: `regression-empty-value-${storage}-${sizeBiased ? "size" : "priority"}`,
        config: configFor(["merge_option", "insi_option", "deli_option", "findi_option", "three_spliti_option"], {
          augmented_ptr: storage === "augmented",
          array_storage: storage === "array",
          size_biased_merge: sizeBiased,
        }),
        body: `
int main() {
    ptr n = new Node();
    if (sz(n) != 1) fail_test("a new node must have size 1");
    if (n->l || n->r) fail_test("a new node must have null children");
    for (int i = 1; i < 20; ++i) insi(n, new Node(), i);
    if (sz(n) != 20) fail_test("implicit insertion size");
    for (int i = 0; i < 20; ++i) if (!findi(n, i)) fail_test("implicit find");
    auto [a, b, c] = spliti(n, 3, 16);
    if (sz(a) != 3 || sz(b) != 13 || sz(c) != 4) fail_test("implicit split");
    n = merge(merge(a, b), c);
    ptr removed = deli(n, 7);
    if (sz(removed) != 1 || removed->l || removed->r) fail_test("removed node is not reusable");
    insi(n, removed, 2);
    if (sz(n) != 20) fail_test("implicit reinsertion size");
    delete n;
}
`,
      });
    }
  }
  for (const type of ["int", "long long"]) {
    for (const rangeType of ["inc exc", "inc inc"]) {
      cases.push({
        name: `regression-key-boundaries-${type.replace(" ", "-")}-${rangeType.replace(" ", "-")}`,
        config: configFor(["ins_option", "del_option", "del_all_option", "find_option", "size_option", "three_split_option", "lower_bound_option", "upper_bound_option"], { key_type: type, range_type: rangeType }),
        body: `
int main() {
    using K = ${type};
    const K low = numeric_limits<K>::lowest(), high = numeric_limits<K>::max();
    vector<K> keys = {low, K(-1), K(0), K(1), K(high - 1), high, high};
    ptr n = nullptr;
    for (K key : keys) ins(n, new Node(key));
    for (K key : keys) if (!find(n, key) || find(n, key)->key != key) fail_test("key was truncated by find");
    auto [a, b] = split(n, high);
    if (sz(a) != 5 || sz(b) != 2) fail_test("key was truncated by split");
    n = merge(a, b);
    auto [l, m, r] = split(n, K(high - 1), high);
    if (sz(l) != 4 || sz(m) != ${rangeType === "inc inc" ? 3 : 1} || sz(r) != ${rangeType === "inc inc" ? 0 : 2}) fail_test("range boundary overflow");
    n = merge(merge(l, m), r);
    ptr removed = del_all(n, high);
    if (sz(removed) != 2 || sz(n) != 5) fail_test("delete-all boundary overflow");
    delete removed;
    if (lower_bound(n, high) || upper_bound(n, K(high - 1))) fail_test("bound at maximum key");
    delete n;
}
`,
      });
    }
  }
  cases.push({
    name: "regression-key-set-identity",
    config: configFor(["key_set", "find_option", "ins_option", "merge_option"]),
    body: `
int main() {
    ptr n = new Node(42);
    push(n);
    if (n->key != 42) fail_test("identity lazy tag changes the key");
    delete n;
}
`,
  });
  cases.push({
    name: "regression-key-sum",
    config: configFor(["key_sum", "key_add", "key_set", "range_update_index", "range_query_index", "ins_option", "find_option"]),
    body: `
int main() {
    ptr n = nullptr;
    for (int key : {10, 20, 30}) ins(n, new Node(key, Value{}));
    if (queryi(n, 0, 3).ksum != 60) fail_test("key sums must start from each node's key");
    Lazy tag = lid;
    tag.kval = 2;
    updi(n, 0, 3, tag);
    if (queryi(n, 0, 3).ksum != 66) fail_test("key add sum");
    tag.kinc = false;
    tag.kval = 15;
    updi(n, 1, 2, tag);
    if (queryi(n, 0, 3).ksum != 59 || !find(n, 15)) fail_test("partial key set and key sum");
    delete n;
}
`,
  });
  cases.push({
    name: "regression-parent-pointers",
    config: configFor(["ins_option", "del_option", "size_option", "par_option", "order_option", "root_option", "succ", "pred", "min_option", "max_option"]),
    body: `
void check_parents(ptr n, ptr parent = nullptr) {
    if (!n) return;
    if (n->par != parent) fail_test("stale parent pointer");
    check_parents(n->l, n);
    check_parents(n->r, n);
}
int main() {
    ptr n = nullptr;
    for (int i = 0; i < 25; ++i) ins(n, new Node(i));
    auto [l, r] = split(n, 12);
    check_parents(l);
    check_parents(r);
    n = merge(l, r);
    ptr removed = del(n, n->key);
    check_parents(n);
    check_parents(removed);
    if (sz(removed) != 1) fail_test("deleted node size");
    ins(n, removed);
    int i = 0;
    for (ptr it = mn(n); it; it = succ(it), ++i) {
        if (order(it) != i || root(it) != n) fail_test("order/root mismatch");
    }
    if (i != 25 || succ(mx(n)) || pred(mn(n))) fail_test("iterator endpoints");
    delete n;
}
`,
  });
  for (let mask = 1; mask < 8; mask++) {
    cases.push({
      name: `regression-beats-${mask}`,
      config: configFor(["merge_option", "range_query_index", ...(mask & 1 ? ["beats_chmin"] : []), ...(mask & 2 ? ["beats_chmax"] : []), ...(mask & 4 ? ["beats_add"] : [])], { val_type: "long long" }),
      body: beatsStressBody(mask),
    });
  }
  return cases;
}

function extendedRegressionCases() {
  const cases = [];
  for (const type of ["int", "long long"]) {
    cases.push({
      name: `regression-extrema-${type.replace(" ", "-")}`,
      config: configFor(["range_min", "range_max", "range_add", "range_set", "range_update_index", "range_query_index", "merge_option"], { val_type: type }),
      body: `
int main() {
    using V = ${type};
    ptr zero = new Node();
    if (zero->val.mn != 0 || zero->val.mx != 0) fail_test("default value is not a singleton zero");
    delete zero;
    vector<V> a = {numeric_limits<V>::lowest(), -2, 0, 2, numeric_limits<V>::max()};
    ptr n = nullptr;
    for (V x : a) n = merge(n, new Node(Value::make(x)));
    for (int l = 0; l <= 5; ++l) for (int r = l; r <= 5; ++r) {
        auto got = queryi(n, l, r);
        V low = l == r ? numeric_limits<V>::max() : *min_element(a.begin() + l, a.begin() + r);
        V high = l == r ? numeric_limits<V>::lowest() : *max_element(a.begin() + l, a.begin() + r);
        if (got.mn != low || got.mx != high) fail_test("extrema identity/type mismatch");
    }
    Lazy tag = lid; tag.inc = false; tag.val = 7;
    updi(n, INT_MIN, INT_MAX, tag);
    if (agg(n).mn != 7 || agg(n).mx != 7) fail_test("aggregate is stale after a full update");
    tag.inc = true; tag.val = -3;
    updi(n, 1, 4, tag);
    if (queryi(n, 1, 4).mn != 4 || queryi(n, 0, 5).mx != 7) fail_test("extrema set/add");
    delete n;
}
`,
    });
  }
  cases.push({
    name: "regression-array-capacity",
    config: configFor(["array_storage", "merge_option", "size_option"], { array_storage_size: "8" }),
    body: `
int main() {
    ptr n = nullptr;
    for (int i = 0; i < NODE_CAP - 1; ++i) n = merge(n, ptr::make());
    bool exhausted = false;
    try { (void)ptr::make(); } catch (const bad_alloc&) { exhausted = true; }
    if (!exhausted || node_cnt != NODE_CAP - 1 || sz(n) != NODE_CAP - 1) fail_test("pool overflow must fail without corrupting existing nodes");
    if (ptr{} || ptr{}.get() || ptr(nullptr) != nullptr) fail_test("pool null pointer");
}
`,
  });
  cases.push({
    name: "regression-partitions",
    config: configFor(["ins_option", "range_sum", "range_add", "range_update_index", "partition_key", "partition_index", "cumulative_partition_key", "cumulative_partition_index"], { key_type: "long long", val_type: "long long" }),
    body: `
int main() {
    vector<long long> keys = {-(1LL << 40), 3, 1000, LLONG_MAX};
    vector<long long> values = {1, 2, 3, 4};
    ptr n = nullptr;
    for (int i = 0; i < 4; ++i) {
        ptr it = new Node(keys[i], Value::make(values[i]));
        it->pri = i;
        ins(n, it);
    }
    for (long long threshold : {LLONG_MIN, 0LL, 4LL, 1001LL, LLONG_MAX}) {
        auto pred = [&](ptr it) { return it->key < threshold; };
        int pos = lower_bound(keys.begin(), keys.end(), threshold) - keys.begin();
        optional<long long> got = partition_key(n, pred);
        if (got != optional<long long>(keys[pos]) || partition_index(n, pred) != pos) fail_test("partition must return the actual first matching key/index");
    }
    optional<long long> missing = partition_key(n, [](ptr) { return true; });
    if (missing) fail_test("no partition key must be represented without overflow");
    for (int step = 0; step < 4; ++step) {
        Lazy tag = lid; tag.val = 3;
        updi(n, 0, 4, tag);
        for (auto& x : values) x += 3;
        for (long long limit = 0; limit <= accumulate(values.begin(), values.end(), 0LL); ++limit) {
            int pos = 0; long long acc = 0;
            while (pos < 4 && acc + values[pos] <= limit) acc += values[pos++];
            auto pred = [&](Value v) { return v.sum <= limit; };
            optional<long long> expected = pos < 4 ? optional<long long>(keys[pos]) : nullopt;
            optional<long long> got = cumulative_partition_key(n, pred);
            if (got != expected || cumulative_partition_index(n, pred) != pos) fail_test("cumulative partition with pending lazy tags");
        }
    }
    delete n;
    if (optional<long long>(partition_key(nullptr, [](ptr) { return true; })) != nullopt) fail_test("empty partition");
    if (optional<long long>(cumulative_partition_key(nullptr, [](Value) { return true; })) != nullopt) fail_test("empty cumulative partition");
}
`,
  });
  for (const storage of ["raw", "augmented", "array"]) {
    cases.push({
      name: `regression-lazy-iterators-${storage}`,
      config: configFor(["build_option", "three_spliti_option", "findi_option", "rot_option", "modi_option", "order_option", "root_option", "succ", "pred", "min_option", "max_option"], {
        ...indexLazyConfig("inc exc"),
        augmented_ptr: storage === "augmented",
        array_storage: storage === "array",
      }),
      body: lazyIteratorStressBody(),
    });
  }
  for (const fast of [false, true]) {
    for (const variant of ["priority", "size", "persistent", "array"]) {
      cases.push({
        name: `regression-union-${fast ? "fast" : "amortized"}-${variant}`,
        config: configFor([fast ? "unite_fast_option" : "unite_option", "ins_option", "size_option", "tour_option", "del_all_option", "find_option", "lower_bound_option", "upper_bound_option"], {
          key_type: "long long",
          size_biased_merge: variant === "size",
          persistent: variant === "persistent",
          array_storage: variant === "array",
        }),
        body: unionStressBody(fast, variant === "persistent"),
      });
    }
  }
  cases.push({
    name: "regression-merge-overloads",
    config: configFor(["safe_merge_option", "safe_merge_plus", "n_merge_option", "size_option"]),
    body: `
int main() {
    ptr a = ptr::make(), b = ptr::make();
    ptr n = safe_merge(a, b);
    if (a || b || sz(n) != 2) fail_test("safe merge lvalues");
    delete n;
    a = ptr::make(); n = safe_merge(a, ptr::make());
    if (a || sz(n) != 2) fail_test("safe merge left lvalue");
    delete n;
    b = ptr::make(); n = safe_merge(ptr::make(), b);
    if (b || sz(n) != 2) fail_test("safe merge right lvalue");
    delete n;
    n = safe_merge(ptr::make(), ptr::make());
    if (sz(n) != 2) fail_test("safe merge rvalues");
    delete n;
    a = ptr::make(); b = ptr::make(); n = a + b + ptr::make();
    if (a || b || sz(n) != 3) fail_test("safe plus merge");
    delete n;
    a = ptr::make(); b = ptr::make(); a += b; a += ptr::make();
    if (b || sz(a) != 3) fail_test("safe plus assignment");
    delete a;
    n = merge(ptr::make(), ptr::make(), ptr::make(), ptr::make());
    if (sz(n) != 4 || merge() || merge(n) != n) fail_test("variadic merge");
    delete n;
}
`,
  });
  return cases;
}

function lazyIteratorStressBody() {
  return `
int check_tree(ptr n, ptr parent = nullptr) {
    if (!n) return 0;
    if (n->par != parent) fail_test("lazy tree parent mismatch");
    int count = 1 + check_tree(n->l, n) + check_tree(n->r, n);
    if (sz(n) != count) fail_test("subtree size mismatch");
    return count;
}
int main() {
    mt19937 rng(606);
    vector<ptr> sequence;
    vector<long long> values;
    for (int i = 0; i < 24; ++i) { sequence.push_back(new Node(Value::make(i))); values.push_back(i); }
    ptr n = build(sequence);
    for (int step = 0; step < 160; ++step) {
        int l = rng() % 24, r = l + 1 + rng() % (24 - l);
        switch (rng() % 4) {
            case 0:
                reversei(n, l, r);
                reverse(sequence.begin() + l, sequence.begin() + r);
                reverse(values.begin() + l, values.begin() + r);
                break;
            case 1:
                rotate(n, l);
                rotate(sequence.begin(), sequence.begin() + l, sequence.end());
                rotate(values.begin(), values.begin() + l, values.end());
                break;
            case 2: {
                Lazy tag = lid; tag.inc = rng() % 2; tag.val = int(rng() % 20) - 10;
                updi(n, l, r, tag);
                for (int i = l; i < r; ++i) values[i] = (tag.inc ? values[i] : 0) + tag.val;
                break;
            }
            default:
                values[l] = int(rng() % 31) - 15;
                modifyi(n, l, [&](ptr it) { it->val = Value::make(values[l]); });
        }
        if (agg(n).sum != accumulate(values.begin(), values.end(), 0LL)) fail_test("cached aggregate after mutation");
        for (int i = 23; i >= 0; --i) {
            if (root(sequence[i]) != n || order(sequence[i]) != i) fail_test("order with lazy ancestors");
        }
        ptr it = mn(n);
        for (int i = 0; i < 24; ++i) {
            if (it != sequence[i] || findi(n, i) != it || it->val.sum != values[i]) fail_test("lazy successor traversal");
            if (pred(it) != (i ? sequence[i - 1] : ptr(nullptr))) fail_test("lazy predecessor traversal");
            it = succ(it);
        }
        if (it || mx(n) != sequence.back()) fail_test("iterator endpoint");
        auto [a, b, c] = spliti(n, l, r);
        if (check_tree(a) != l || check_tree(b) != r - l || check_tree(c) != 24 - r) fail_test("split parent/size invariant");
        n = merge(merge(a, b), c);
        check_tree(n);
    }
    if (root(nullptr) || succ(nullptr) || pred(nullptr)) fail_test("empty iterator helpers");
    delete n;
}
`;
}

function unionStressBody(fast, persistent) {
  return `
int main() {
    mt19937 rng(909);
    for (int rep = 0; rep < 25; ++rep) {
        ptr a = nullptr, b = nullptr;
        vector<long long> expected, left, right;
        for (int i = 0; i < 40; ++i) {
            long long key = i < 4 ? (i % 2 ? LLONG_MAX : LLONG_MIN) : (long long)(int(rng() % 11) - 5) * (1LL << 35);
            if (i % 2) { ins(a, new Node(key)); left.push_back(key); }
            else { ins(b, new Node(key)); right.push_back(key); }
            expected.push_back(key);
        }
        sort(expected.begin(), expected.end()); sort(left.begin(), left.end()); sort(right.begin(), right.end());
        ptr n = ${fast ? "unite_fast" : "unite"}(a, b);
        auto collect = [](ptr t) { vector<long long> out; tour(t, [&](ptr it) { out.push_back(it->key); }); return out; };
        if (collect(n) != expected || sz(n) != 40) fail_test("treap union differs from multiset union");
        ${persistent ? 'if (collect(a) != left || collect(b) != right) fail_test("union mutated an old version");' : ""}
        for (long long key : {LLONG_MIN, 0LL, LLONG_MAX}) {
            auto first = lower_bound(expected.begin(), expected.end(), key), last = upper_bound(expected.begin(), expected.end(), key);
            ptr low = lower_bound(n, key), high = upper_bound(n, key);
            if (bool(low) != (first != expected.end()) || (low && low->key != *first)) fail_test("lower bound with duplicates");
            if (bool(high) != (last != expected.end()) || (high && high->key != *last)) fail_test("upper bound with duplicates");
            if (bool(find(n, key)) != (first != last)) fail_test("find with duplicates");
            ptr removed = del_all(n, key);
            if (sz(removed) != last - first) fail_test("delete all duplicate count");
            expected.erase(first, last);
            if (collect(n) != expected || sz(n) != (int)expected.size()) fail_test("delete all contents");
            delete removed;
        }
        delete n;
    }
}
`;
}

function beatsStressBody(mask) {
  return `
int main() {
    mt19937 rng(2024);
    vector<long long> a(24);
    ptr n = nullptr;
    for (auto& x : a) { x = int(rng() % 11) - 5; n = merge(n, new Node(Value::make(x))); }
    for (int step = 0; step < 800; ++step) {
        int l = rng() % a.size(), r = l + 1 + rng() % (a.size() - l);
        int op = rng() % 3;
        long long x = int(rng() % 31) - 15;
        ${mask & 1 ? "if (op == 0) { updi(n, l, r, chmin_tag(x)); for (int i = l; i < r; ++i) a[i] = min(a[i], x); }" : ""}
        ${mask & 2 ? "if (op == 1) { updi(n, l, r, chmax_tag(x)); for (int i = l; i < r; ++i) a[i] = max(a[i], x); }" : ""}
        ${mask & 4 ? "if (op == 2) { updi(n, l, r, add_tag(x)); for (int i = l; i < r; ++i) a[i] += x; }" : ""}
        if (step % 23 == 0) {
            for (int lo = 0; lo <= (int)a.size(); ++lo) {
                for (int hi = lo; hi <= (int)a.size(); ++hi) {
                    auto got = queryi(n, lo, hi);
                    long long expected = accumulate(a.begin() + lo, a.begin() + hi, 0LL);
                    if (got.sum != expected) fail_test("beats sum step=" + to_string(step) + " range=" + to_string(lo) + "," + to_string(hi));
                    if (lo == hi) continue;
                    ${mask & 1 ? "if (got.mx != *max_element(a.begin() + lo, a.begin() + hi)) fail_test(\"beats maximum\");" : ""}
                    ${mask & 2 ? "if (got.mn != *min_element(a.begin() + lo, a.begin() + hi)) fail_test(\"beats minimum\");" : ""}
                }
            }
        }
    }
    delete n;
}
`;
}

async function compileCase(name, source) {
  const cpp = join(outDir, `${name}.cpp`);
  const bin = join(outDir, name);
  await writeFile(cpp, source);
  const flags = args.sanitize ? ["-O1", "-g", "-fsanitize=address,undefined", "-fno-sanitize-recover=all", "-fno-omit-frame-pointer", "-fno-pie", "-no-pie"] : ["-O2"];
  await execFileChecked("g++", ["-std=c++17", ...flags, "-pipe", cpp, "-o", bin], {
    timeout: 60000,
    label: `compile ${name}`,
  });
  console.log(`compile ok: ${name}`);
  return bin;
}

async function runBinary(name, bin, timeout, seed, persistent) {
  await execFileChecked(bin, [], {
    timeout,
    label: `stress ${name} seed=${seed}`,
    env: { ...process.env, BYOT_SEED: String(seed), ASAN_OPTIONS: `detect_leaks=${persistent ? 0 : 1}` },
  });
  console.log(`stress ok: ${name} seed=${seed}`);
}

function execFileChecked(file, argv, options) {
  return new Promise((resolve, reject) => {
    execFile(file, argv, { timeout: options.timeout, env: options.env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${options.label} failed (${error.signal ?? `exit ${error.code}`}):\n${stdout}${stderr}`;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function runPool(tasks, limit) {
  let next = 0;
  const failures = [];
  const workers = Array.from({ length: limit }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        await task();
      } catch (error) {
        console.error(error.message);
        failures.push(error);
      }
    }
  });
  await Promise.all(workers);
  if (failures.length) throw new Error(`${failures.length} of ${tasks.length} BYOT cases failed`);
}
