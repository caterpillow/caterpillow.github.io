#!/usr/bin/env node

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
const keep = Boolean(args.keep);
const mode = args.mode ?? "all";
const outDir = args.outDir ? resolve(String(args.outDir)) : await mkdtemp(join(tmpdir(), "byot-test-"));

const esbuild = await import("esbuild");
const generatorBundle = join(outDir, "byot-generator.cjs");
await esbuild.build({
  entryPoints: [join(projectRoot, "src/codegen/treapConfig.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: generatorBundle,
  logLevel: "silent",
});
const { generateTreapCode } = require(generatorBundle);

const compileCases = buildCompileCases();
const stressCases = buildStressCases();
const compileOnly = mode === "compile";
const stressOnly = mode === "stress";
const selectedCompile = stressOnly ? [] : compileCases;
const selectedStress = compileOnly ? [] : stressCases;

const startedAt = Date.now();
try {
  console.log(`BYOT local tests: ${selectedCompile.length} compile cases, ${selectedStress.length} stress cases, ${jobs} jobs`);
  console.log(`workdir: ${outDir}`);

  const compileTasks = selectedCompile.map((testCase) => async () => {
    const source = compileHarness(generateTreapCode(derive(testCase.config)));
    return compileCase(testCase.name, source);
  });

  const stressTasks = selectedStress.map((testCase) => async () => {
    const code = generateTreapCode(derive(testCase.config));
    const source = stressHarness(code, testCase.body);
    const bin = await compileCase(testCase.name, source);
    await runBinary(testCase.name, bin, testCase.timeoutMs ?? 6000);
    return bin;
  });

  await runPool([...compileTasks, ...stressTasks], jobs);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`OK: BYOT tests passed in ${elapsed}s`);
} finally {
  if (!keep) await rm(outDir, { recursive: true, force: true });
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep") result.keep = true;
    else if (arg === "--compile-only") result.mode = "compile";
    else if (arg === "--stress-only") result.mode = "stress";
    else if (arg === "--jobs") result.jobs = argv[++i];
    else if (arg.startsWith("--jobs=")) result.jobs = arg.slice("--jobs=".length);
    else if (arg === "--out-dir") result.outDir = argv[++i];
    else if (arg.startsWith("--out-dir=")) result.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: npm run test:byot -- [--compile-only|--stress-only] [--jobs N] [--keep] [--out-dir DIR]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return result;
}

function derive(cfg) {
  return {
    signature: false,
    comments: false,
    template: false,
    use_namespace_std: false,
    use_ll_typedef: false,
    namespace_treap: false,
    tab_char: "4spaces",
    range_type: "inc exc",
    key_type: "none",
    val_type: "none",
    ...cfg,
    augmented_ptr: Boolean(cfg.augmented_ptr || cfg.array_storage),
    pull: Boolean(cfg.size_option || cfg.range_agg || cfg.par_option),
    push: Boolean(cfg.lazy_prop),
  };
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
  ];

  return cases;
}

function buildStressCases() {
  return [
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

static void fail_test(const string& msg) {
    cerr << msg << "\\n";
    exit(1);
}

${body}
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

async function compileCase(name, source) {
  const cpp = join(outDir, `${name}.cpp`);
  const bin = join(outDir, name);
  await writeFile(cpp, source);
  await execFileChecked("g++", ["-std=c++17", "-O2", "-pipe", cpp, "-o", bin], {
    timeout: 12000,
    label: `compile ${name}`,
  });
  console.log(`compile ok: ${name}`);
  return bin;
}

async function runBinary(name, bin, timeout) {
  await execFileChecked(bin, [], { timeout, label: `stress ${name}` });
  console.log(`stress ok: ${name}`);
}

function execFileChecked(file, argv, options) {
  return new Promise((resolve, reject) => {
    execFile(file, argv, { timeout: options.timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${options.label} failed: ${error.message}\n${stdout}${stderr}`;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function runPool(tasks, limit) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  });
  await Promise.all(workers);
}
