// BYOT modular code generator: blocks defined above
import { features } from './features';

export type TreapConfig = Record<string, boolean|string>;

const fragments: {[key: string]: (cfg: TreapConfig) => string} = {
  intro: (cfg) => cfg.signature ? "// generated at caterpillow.github.io/byot\n\n" : "",
  comment: (cfg) => cfg.comments ? "// Treap code generated with comments\n" : "",

  valueStruct: (cfg) => {
    if (!cfg.enable_value) return "";
    let out = 'struct Value {\n';
    if (cfg.range_sum) out += '    long long sum;\n';
    if (cfg.range_max) out += '    int mx;\n';
    if (cfg.range_min) out += '    int mn;\n';
    // ... other aggregate fields ...
    out += '};\n\n';
    return out;
  },

  lazyStruct: (cfg) => {
    if (!cfg.lazy_prop) return '';
    let out = 'struct Lazy {\n';
    if (cfg.range_reverse_key || cfg.range_reverse_index) out += '    bool rev;\n';
    if (cfg.range_add) out += '    long long val;\n';
    // ...other tags...
    out += '};\n\n';
    return out;
  },

  nodeStruct: (cfg) => {
    let out = "struct Node {\n";
    if (cfg.enable_value) out += "    Value val;\n";
    if (cfg.range_agg) out += "    Value agg;\n";
    if (cfg.lazy_prop) out += "    Lazy lazy;\n";
    if (cfg.key_type && cfg.key_type !== "none") out += `    ${cfg.key_type} key;\n`;
    if (cfg.size_option) out += "    int sz;\n";
    out += "    int pri;\n    Node *l, *r;\n";
    if (cfg.par_option) out += "    Node *par;\n";
    out += "\n    Node() {}\n";
    out += "};\n\n";
    return out;
  },

  mergeFn: (cfg) => {
    if (!cfg.merge_option) return '';
    let s = '';
    s += 'ptr merge(ptr l, ptr r) {\n';
    s += '    if (!l || !r) return l ? l : r;\n';
    if (cfg.lazy_prop) s += '    push(l), push(r);\n';
    s += '    if (l->pri > r->pri)\n        return l->r = merge(l->r, r), pull(l);\n';
    s += '    else\n        return r->l = merge(l, r->l), pull(r);\n';
    s += '}\n\n';
    return s;
  },

  splitFn: (cfg) => {
    if (!cfg.split_option) return '';
    let s = '';
    s += `pair<ptr, ptr> split(ptr n, ${cfg.key_type !== 'none' ? cfg.key_type : 'int'} k) {\n`;
    s += '    if (!n) return {nullptr, nullptr};\n';
    if (cfg.lazy_prop) s += '    push(n);\n';
    s += '    if (k <= n->key) {\n';
    s += '        auto [l, r] = split(n->l, k);\n        n->l = r;\n        return {l, pull(n)};\n';
    s += '    } else {\n';
    s += '        auto [l, r] = split(n->r, k);\n        n->r = l;\n        return {pull(n), r};\n';
    s += '    }\n}\n\n';
    return s;
  },

  pushFn: (cfg) => {
    if (!cfg.lazy_prop) return '';
    let s = 'void push(ptr n) {\n';
    if (cfg.enable_value) s += '    n->val.upd(n->lazy);\n';
    if (cfg.range_agg) s += '    n->agg.upd(n->lazy);\n';
    if (cfg.range_reverse_key || cfg.range_reverse_index) s += '    if (n->lazy.rev) std::swap(n->l, n->r);\n';
    s += '    if (n->l) n->l->lazy += n->lazy;\n    if (n->r) n->r->lazy += n->lazy;\n    n->lazy = lid;\n}\n';
    return s;
  },

  pullFn: (cfg) => {
    // Always useful, but can conditionally enrich for fields
    let s = 'ptr pull(ptr n) {\n';
    s += '    if (!n) return nullptr;\n';
    if (cfg.lazy_prop) s += '    if (n->l) push(n->l);\n    if (n->r) push(n->r);\n';
    if (cfg.size_option) s += '    n->sz = sz(n->l) + 1 + sz(n->r);\n';
    if (cfg.range_agg) s += '    n->agg = agg(n->l) + n->val + agg(n->r);\n';
    s += '    return n;\n}\n\n';
    return s;
  },

  threeSplit: (cfg) => {
    if (!cfg.three_split_option || !cfg.split_option) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    out += `std::tuple<ptr, ptr, ptr> split(ptr n, ${ktype} lo, ${ktype} hi) {\n`;
    out += `    auto [lm, r] = split(n, hi);\n`;
    out += '    auto [l, m] = split(lm, lo);\n';
    out += '    return {l, m, r};\n';
    out += '}\n\n';
    return out;
  },
  findFn: (cfg) => {
    if (!cfg.find_option) return '';
    let out  = '';
    out += 'ptr find(ptr n, int k) {\n';
    out += '    if (!n) return 0;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (n->key == k) return n;\n';
    out += '    if (k <= n->key) return find(n->l, k);\n';
    out += '    else return find(n->r, k);\n';
    out += '}\n\n';
    return out;
  },
  findiFn: (cfg) => {
    if (!cfg.findi_option) return '';
    let out = '';
    out += 'ptr findi(ptr n, int i) {\n';
    out += '    if (!n) return 0;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (sz(n->l) == i) return n;\n';
    out += '    if (i < sz(n->l)) return findi(n->l, i);\n';
    out += '    else return findi(n->r, i - sz(n->l) - 1);\n';
    out += '}\n\n';
    return out;
  },
  insFn: (cfg) => {
    if (!cfg.ins_option) return '';
    let out = '';
    out += 'void ins(ptr& n, ptr it) {\n';
    out += '    if (!n) { n = it; return; }\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (n->pri < it->pri) {\n';
    out += '        auto [l, r] = split(n, it->key);\n';
    out += '        it->l = l, it->r = r, n = it;\n';
    out += '    } else if (it->key <= n->key) ins(n->l, it);\n';
    out += '    else ins(n->r, it);\n';
    if (cfg.size_option || cfg.range_agg || cfg.par_option) out += '    pull(n);\n';
    out += '}\n\n';
    return out;
  },
  delFn: (cfg) => {
    if (!cfg.del_option) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    out += `ptr del(ptr& n, ${ktype} k) {\n`;
    out += '    if (!n) return nullptr;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (n->key == k) { ptr ret = n; n = merge(n->l, n->r); ret->l = ret->r = nullptr; return ret; }\n';
    out += '    ptr ret = k <= n->key ? del(n->l, k) : del(n->r, k);\n';
    if (cfg.size_option || cfg.range_agg || cfg.par_option) out += '    pull(n);\n';
    out += '    return ret;\n';
    out += '}\n\n';
    return out;
  },
  insiFn: (cfg) => {
    if (!cfg.insi_option) return '';
    let out = '';
    out += 'void insi(ptr& n, ptr it, int i) {\n';
    out += '    if (!n) { n = it; return; }\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (n->pri < it->pri) {\n';
    out += '        auto [l, r] = spliti(n, i);\n';
    out += '        it->l = l, it->r = r, n = it;\n';
    out += '    } else if (i <= sz(n->l)) insi(n->l, it, i);\n';
    out += '    else insi(n->r, it, i - 1 - sz(n->l));\n';
    out += '    pull(n);\n';
    out += '}\n\n';
    return out;
  },
  deliFn: (cfg) => {
    if (!cfg.deli_option) return '';
    let out = '';
    out += 'ptr deli(ptr& n, int i) {\n';
    out += '    if (!n) return nullptr;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (i == sz(n->l)) { ptr ret = n; n = merge(n->l, n->r); ret->l = ret->r = nullptr; return ret; }\n';
    out += '    ptr ret = i <= sz(n->l) ? deli(n->l, i) : deli(n->r, i - 1 - sz(n->l));\n';
    out += '    pull(n);\n';
    out += '    return ret;\n';
    out += '}\n\n';
    return out;
  },
  minFn: (cfg) => {
    if (!cfg.min_option) return '';
    let out = 'ptr mn(ptr n) {\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    return n->l ? mn(n->l) : n;\n';
    out += '}\n\n';
    return out;
  },
  maxFn: (cfg) => {
    if (!cfg.max_option) return '';
    let out = 'ptr mx(ptr n) {\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    return n->r ? mx(n->r) : n;\n';
    out += '}\n\n';
    return out;
  },
  threeSplitIndex: (cfg) => {
    if (!cfg.three_spliti_option || !cfg.spliti_option) return '';
    let out = '';
    out += 'std::tuple<ptr, ptr, ptr> spliti(ptr n, int lo, int hi) {\n';
    out += '    auto [lm, r] = spliti(n, hi);\n';
    out += '    auto [l, m] = spliti(lm, lo);\n';
    out += '    return {l, m, r};\n';
    out += '}\n\n';
    return out;
  },
  splitiFn: (cfg) => {
    if (!cfg.spliti_option) return '';
    let out = '';
    out += 'std::pair<ptr, ptr> spliti(ptr n, int i) {\n';
    out += '    if (!n) return {nullptr, nullptr};\n';
    if (cfg.par_option) out += '    n->par = nullptr;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (i <= sz(n->l)) {\n        auto [l, r] = spliti(n->l, i);\n        n->l = r;\n        return {l, pull(n)};\n';
    out += '    } else {\n        auto [l, r] = spliti(n->r, i - 1 - sz(n->l));\n        n->r = l;\n        return {pull(n), r};\n';
    out += '    }\n}\n\n';
    return out;
  },
  modFn: (cfg) => {
    if (!cfg.mod_option) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    out += 'template <typename Op>\n';
    out += `void modify(ptr n, ${ktype} k, Op op) {\n`;
    out += '    if (!n) return;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (n->key == k) op(n);\n';
    out += '    else if (k <= n->key) modify(n->l, k, op);\n';
    out += '    else modify(n->r, k, op);\n';
    if (cfg.size_option || cfg.range_agg || cfg.par_option) out += '    pull(n);\n';
    out += '}\n\n';
    return out;
  },
  modIndexFn: (cfg) => {
    if (!cfg.modi_option) return '';
    let out = '';
    out += 'template <typename Op>\n';
    out += 'void modifyi(ptr n, int i, Op op) {\n';
    out += '    if (!n) return;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (sz(n->l) == i) op(n);\n';
    out += '    else if (i <= sz(n->l)) modifyi(n->l, i, op);\n';
    out += '    else modifyi(n->r, i - 1 - sz(n->l), op);\n';
    if (cfg.size_option || cfg.range_agg || cfg.par_option) out += '    pull(n);\n';
    out += '}\n\n';
    return out;
  },
  partitionKey: (cfg) => {
    if (!cfg.partition_key) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    out += 'template<typename Pred>\n';
    out += ` ${ktype} partition_key(ptr n, Pred pred) {\n`;
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (pred(n)) return n->r ? partition_key(n->r, pred) : n->key + 1;\n';
    out += '    else return n->l ? partition_key(n->l, pred) : n->key;\n';
    out += '}\n\n';
    return out;
  },
  partitionIndex: (cfg) => {
    if (!cfg.partition_index) return '';
    let out = '';
    out += 'template<typename Pred>\nint partition_index(ptr n, Pred pred) {\n';
    out += '    if (!n) return 0;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (pred(n)) return sz(n->l) + 1 + partition_index(n->r, pred);\n';
    out += '    else return partition_index(n->l, pred);\n';
    out += '}\n\n';
    return out;
  },
  cumulativePartitionKey: (cfg) => {
    if (!cfg.cumulative_partition_key) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    out += 'template <typename Pred>\n';
    out += ` ${ktype} cumulative_partition_key(ptr n, Pred pred, Value acc = vid) {\n`;
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (!pred(acc + agg(n->l))) return n->l ? cumulative_partition_key(n->l, pred, acc) : n->key;\n';
    out += '    if (!pred(acc = acc + agg(n->l) + n->val)) return n->key;\n';
    out += '    return n->r ? cumulative_partition_key(n->r, pred, acc) : n->key + 1;\n';
    out += '}\n\n';
    return out;
  },
  cumulativePartitionIndex: (cfg) => {
    if (!cfg.cumulative_partition_index) return '';
    let out = '';
    out += 'template <typename Pred>\nint cumulative_partition_index(ptr n, Pred pred, Value acc = vid) {\n';
    out += '    if (!n) return 0;\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (!pred(acc + agg(n->l))) return cumulative_partition_index(n->l, pred, acc);\n';
    out += '    if (!pred(acc = acc + agg(n->l) + n->val)) return sz(n->l);\n';
    out += '    return sz(n->l) + 1 + cumulative_partition_index(n->r, pred, acc);\n';
    out += '}\n\n';
    return out;
  },
  uniteFn: (cfg) => {
    if (!cfg.unite_option) return '';
    let out = '';
    out += 'ptr unite(ptr l, ptr r) {\n';
    out += '    if (!l || !r) return l ? l : r;\n';
    out += '    if (mn(l)->key > mn(r)->key) std::swap(l, r);\n';
    out += '    ptr res = 0;\n';
    out += '    while (r) {\n';
    out += '        auto [lt, rt] = split(l, mn(r)->key + 1);\n';
    out += '        res = merge(res, lt);\n';
    out += '        tie(l, r) = make_pair(r, rt);\n';
    out += '    }\n';
    out += '    return merge(res, l);\n';
    out += '}\n\n';
    return out;
  },
  uniteFastFn: (cfg) => {
    if (!cfg.unite_fast_option) return '';
    let out = '';
    out += 'ptr unite_fast(ptr l, ptr r) {\n';
    out += '    if (!l || !r) return l ? l : r;\n';
    if (cfg.lazy_prop) out += '    push(l), push(r);\n';
    out += '    if (l->pri < r->pri) std::swap(l, r);\n';
    out += '    auto [lhs, rhs] = split(r, l->key);\n';
    out += '    l->l = unite(l->l, lhs);\n';
    out += '    l->r = unite(l->r, rhs);\n';
    out += '    return pull(l);\n';
    out += '}\n\n';
    return out;
  },
  heapifyFn: (cfg) => {
    if (!cfg.heapify_option) return '';
    let out = '';
    out += 'void heapify(ptr n) {\n';
    out += '    if (!n) return;\n';
    out += '    ptr mx = n;\n';
    out += '    if (n->l && n->l->pri > mx->pri) mx = n->l;\n';
    out += '    if (n->r && n->r->pri > mx->pri) mx = n->r;\n';
    out += '    if (mx != n) std::swap(n->pri, mx->pri), heapify(mx);\n';
    out += '}\n\n';
    return out;
  },
  buildFn: (cfg) => {
    if (!cfg.build_option) return '';
    let out = '';
    out += 'ptr build(std::vector<ptr>& ns, int l = 0, int r = -69) {\n';
    out += '    if (r == -69) r = (int) ns.size() - 1;\n';
    out += '    if (l > r) return nullptr;\n';
    out += '    if (l == r) return ns[l];\n';
    out += '    int m = (l + r) / 2;\n';
    out += '    ns[m]->l = build(ns, l, m - 1);\n';
    out += '    ns[m]->r = build(ns, m + 1, r);\n';
    out += '    heapify(ns[m]);\n';
    out += '    return pull(ns[m]);\n';
    out += '}\n\n';
    return out;
  },
  tourFn: (cfg) => {
    if (!cfg.tour_option) return '';
    let out = '';
    out += 'template <typename Op>\nvoid tour(ptr n, Op op) {\n';
    out += '    std::stack<ptr> stk;\n';
    out += '    while (n || !stk.empty()) {\n';
    out += '        for (; n; n = n->l) ';
    if (cfg.lazy_prop) out += 'push(n), ';
    out += 'stk.push(n);\n';
    out += '        n = stk.top(); stk.pop();\n';
    out += '        op(n);\n';
    out += '        n = n->r;\n';
    out += '    }\n';
    out += '}\n\n';
    return out;
  },
};

// Unified, stable total order (no duplicates) for all blocks
const ORDER = [
  'intro', 'comment', 'valueStruct', 'lazyStruct', 'nodeStruct',
  'pushFn', 'pullFn', 'mergeFn', 'splitFn',
  'threeSplit', 'findFn', 'findiFn', 'insFn', 'delFn', 'insiFn', 'deliFn', 'minFn', 'maxFn',
  'threeSplitIndex','splitiFn','modFn','modIndexFn',
  'partitionKey','partitionIndex','cumulativePartitionKey','cumulativePartitionIndex',
  'uniteFn','uniteFastFn','heapifyFn','buildFn','tourFn'
  // ...new fragments here as you port more...
];

export function generateTreapCode(cfg: TreapConfig): string {
  let code = '';
  ORDER.forEach(block => { if (fragments[block]) code += fragments[block](cfg); });
  return code.trim() || '// Enable some features to generate code.';
}
