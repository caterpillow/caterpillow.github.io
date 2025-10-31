// BYOT modular code generator: blocks defined above
import { features } from './features';

export type TreapConfig = Record<string, boolean|string>;

const fragments: {[key: string]: (cfg: TreapConfig) => string} = {
  intro: (cfg) => cfg.signature ? "// generated at caterpillow.github.io/byot\n\n" : "",
  comment: (cfg) => cfg.comments ? "// Treap code generated with comments\n" : "",

  // Forward declarations for iterator helpers
  forwardDecls: (cfg) => {
    const decls: string[] = [];
    decls.push('struct Node;');
    if (!cfg.augmented_ptr) decls.push('using ptr = struct Node;');
    else decls.push('struct ptr;')
    if (cfg.succ) decls.push('ptr succ(ptr n);');
    if (cfg.pred) decls.push('ptr pred(ptr n);');
    if (decls.length == 0) return '';
    return decls.join(' ') + '\n\n';
  },

  // ptr type: augmented wrapper or plain alias
  ptrType: (cfg) => {
    if (cfg.augmented_ptr) {
      let s = '';
      s += 'struct ptr {\n';
      if (cfg.succ || cfg.pred) {
        s += '    using iterator_category = std::bidirectional_iterator_tag;\n';
        s += '    using value_type        = Node;\n';
        s += '    using difference_type   = std::ptrdiff_t;\n';
        s += '    using pointer           = Node*;\n';
        s += '    using reference         = Node&;\n';
        s += '#if __cpp_lib_concepts\n';
        s += '    using iterator_concept  = std::bidirectional_iterator_tag;\n';
        s += '#endif\n';
        s += '\n\n';
      }
      s += '    Node *p;\n';
      s += '    ptr(Node *p = nullptr) : p(p) {}\n';
      s += '    Node &operator*() const { return *p; }\n';
      s += '    Node *operator->() const { return p; }\n';
      s += '    explicit operator bool() const noexcept { return p; }\n';
      s += '    bool operator==(const ptr &o) const noexcept { return p == o.p; }\n';
      s += '    bool operator!=(const ptr &o) const noexcept { return p != o.p; }\n';
      if (cfg.succ || cfg.pred) s += '\n';
      if (cfg.succ) {
        s += '    ptr &operator++() { return *this = succ(*this); }\n';
        s += '    ptr operator++(int) { return std::exchange(*this, succ(*this)); }\n';
      }
      if (cfg.pred) {
        s += '    ptr &operator--() { return *this = pred(*this); }\n';
        s += '    ptr operator--(int) { return std::exchange(*this, pred(*this)); }\n';
      }
      s += '};\n\n';
      if (cfg.min_option) {
        s += 'inline ptr begin(ptr n) { return mn(n); }\n';
        s += 'inline ptr end(ptr) { return ptr{nullptr}; }\n\n';
      }
      return s;
    }
    return 'using ptr = struct Node*;\n\n';
  },

  valueStruct: (cfg) => {
    if (!cfg.enable_value) return "";
    let out = 'struct Value {\n';
    if (cfg.range_sum || cfg.treap_beats) out += '    long long sum;\n';
    if (cfg.range_max) out += '    int mx;\n';
    if (cfg.range_min) out += '    int mn;\n';
    if (cfg.key_sum) out += `    ${cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int'} ksum;\n`;
    // Simple beats shape (optional)
    if (cfg.treap_beats && cfg.beats_chmin) out += '    long long mx2, mxcnt;\n';
    if (cfg.treap_beats && cfg.beats_chmax) out += '    long long mn2, mncnt;\n';
    out += '};\n\n';
    return out;
  },

  lazyStruct: (cfg) => {
    if (!cfg.lazy_prop) return '';
    let out = 'struct Lazy {\n';
    if (cfg.range_reverse_key || cfg.range_reverse_index) out += '    bool rev;\n';
    if (cfg.range_add || cfg.range_set) out += '    long long val;\n';
    if (cfg.range_set) out += '    bool inc;\n';
    if (cfg.key_add || cfg.key_set) out += `    ${cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int'} kval;\n`;
    if (cfg.key_set) out += '    bool kinc;\n';
    if (cfg.treap_beats && cfg.beats_chmin) out += '    long long mn;\n';
    if (cfg.treap_beats && cfg.beats_chmax) out += '    long long mx;\n';
    if (cfg.treap_beats && cfg.beats_add) out += '    long long add;\n';
    out += '};\n\n';
    return out;
  },

  beatsTagHelpers: (cfg) => {
    if (!cfg.treap_beats) return '';
    let s = '';
    if (cfg.beats_chmin) s += 'Lazy chmin_tag(long long x) { Lazy lazy = lid; lazy.mn = x; return lazy; }\n';
    if (cfg.beats_chmax) s += 'Lazy chmax_tag(long long x) { Lazy lazy = lid; lazy.mx = x; return lazy; }\n';
    if (cfg.beats_add) s += 'Lazy add_tag(long long x) { Lazy lazy = lid; lazy.add = x; return lazy; }\n';
    if (s) s += '\n';
    return s;
  },

  nodeStruct: (cfg) => {
    let out = "struct Node {\n";
    // Value lines (preserve order; combine when same type)
    {
      const valueFields: string[] = [];
      if (cfg.enable_value) valueFields.push('val');
      if (cfg.range_agg) valueFields.push('agg');
      if (valueFields.length) out += `    Value ${valueFields.join(', ')};\n`;
    }
    if (cfg.lazy_prop) out += "    Lazy lazy;\n";

    // Key and ints, combined appropriately
    if (cfg.key_type !== "none" && cfg.key_type !== "int") out += `    ${cfg.key_type} key;\n`;
    const intNames: string[] = [];
    if (cfg.key_type === "int") intNames.push("key");
    if (cfg.size_option) intNames.push("sz");
    intNames.push("pri");
    out += `    int ${intNames.join(", ")};\n`;

    // Pointers
    const ptrNames: string[] = ["l", "r"];
    if (cfg.par_option) ptrNames.push("par");
    out += `    ptr ${ptrNames.join(", ")};\n\n`;

    // Constructors
    const hasKey = cfg.key_type && cfg.key_type !== 'none';
    const hasVal = !!cfg.enable_value;

    if (hasKey || hasVal) {
      const params: string[] = [];
      const inits: string[] = [];
      if (hasKey) {
        params.push(`${cfg.key_type} key = {}`);
        inits.push('key(key)');
      }
      if (hasVal) {
        params.push('Value val = vid');
        inits.push('val(val)');
      }
      if (cfg.range_agg) inits.push('agg(val)');
      const paramStr = params.join(', ');
      const initStr = inits.length ? ` : ${inits.join(', ')}` : '';
      out += `    Node(${paramStr})${initStr} {\n`;
      out += '        pri = mt();\n';
      if (cfg.lazy_prop) out += '        lazy = lid;\n';
      if (cfg.size_option) out += '        sz = 1;\n';
      out += '        l = r = nullptr;\n';
      if (cfg.par_option) out += '        par = nullptr;\n';
      if (cfg.key_sum) out += '        val.ksum = agg.ksum = 0;\n';
      out += '    }\n';
    } else {
      // No key and no value: simple default constructor (cannot delegate)
      out += '    Node() {\n';
      out += '        pri = mt();\n';
      if (cfg.lazy_prop) out += '        lazy = lid;\n';
      if (cfg.size_option) out += '        sz = 0;\n';
      out += '        l = r = nullptr;\n';
      if (cfg.par_option) out += '        par = nullptr;\n';
      out += '    }\n';
    }

    out += "\n    ~Node() {\n";
    out += `        delete l${cfg.augmented_ptr ? ".p" : ""};\n`;
    out += `        delete r${cfg.augmented_ptr ? ".p" : ""};\n`;
    out += "    }\n";

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
    s += `pair<ptr, ptr> split(ptr n, ${cfg.key_type} k) {\n`;
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
    if (!cfg.pull) return '';
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
    let out = '';
    out += `std::tuple<ptr, ptr, ptr> split(ptr n, ${cfg.key_type} lo, ${cfg.key_type} hi) {\n`;
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
    if (cfg.pull) out += '    pull(n);\n';
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
    if (cfg.pull) out += '    pull(n);\n';
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
    if (cfg.pull) out += '    pull(n);\n';
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
    if (cfg.pull) out += '    pull(n);\n';
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
  succFn: (cfg) => {
    if (!cfg.succ) return '';
    let out = '';
    out += 'ptr succ(ptr n) {\n';
    out += `    if (n->r) for (n = n->r; n->l; ${cfg.push ? "push(n = n->l)" : "n = n->l"});\n`;
    out += '    else { while (n->par && n->par->r == n) n = n->par; n = n->par; }\n';
    out += '    return n;\n';
    out += '}\n\n';
    return out;
  },
  predFn: (cfg) => {
    if (!cfg.pred) return '';
    let out = '';
    out += 'ptr pred(ptr n) {\n';
    out += `    if (n->l) for (n = n->l; n->r; ${cfg.push ? "push(n = n->r)" : "n = n->r"});\n`;
    out += '    else { while (n->par && n == n->par->l) n = n->par; n = n->par; }\n';
    out += '    return n;\n';
    out += '}\n\n';
    return out;
  },
  // Range operations
  rangeReverseKeyFn: (cfg) => {
    if (!cfg.range_reverse_key) return '';
    const incExc = cfg.range_type === 'inc exc';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let s = '';
    s += `void reverse(ptr& n, ${ktype} lo, ${ktype} hi) {\n`;
    s += `    auto [lm, r] = split(n, ${incExc ? 'hi' : 'hi + 1'});\n`;
    s += `    auto [l, m] = split(lm, ${incExc ? 'lo' : 'lo + 1'});\n`;
    s += '    Lazy upd = lid;\n';
    s += '    upd.rev = true;\n';
    s += '    if (m) m->lazy += upd;\n';
    s += '    n = merge(merge(l, m), r);\n';
    s += '}\n\n';
    return s;
  },
  rangeReverseIndexFn: (cfg) => {
    if (!cfg.range_reverse_index) return '';
    const incExc = cfg.range_type === 'inc exc';
    let s = '';
    s += 'void reversei(ptr& n, int lo, int hi) {\n';
    s += `    auto [lm, r] = spliti(n, ${incExc ? 'hi' : 'hi + 1'});\n`;
    s += `    auto [l, m] = spliti(lm, ${incExc ? 'lo' : 'lo + 1'});\n`;
    s += '    Lazy upd = lid;\n';
    s += '    upd.rev = true;\n';
    s += '    if (m) m->lazy += upd;\n';
    s += '    n = merge(merge(l, m), r);\n';
    s += '}\n\n';
    return s;
  },
  rangeUpdateKeyFn: (cfg) => {
    if (!cfg.range_update_key) return '';
    const incExc = cfg.range_type === 'inc exc';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    if (cfg.treap_beats) {
      let s = '';
      s += `void upd(ptr& n, ${ktype} lo, ${ktype} hi, Lazy lazy) {\n`;
      s += `    auto [lm, r] = split(n, ${incExc ? 'hi' : 'hi + 1'});\n`;
      s += '    auto [l, m] = split(lm, lo);\n';
      s += '    updi(m, 0, sz(m), lazy);\n';
      s += '    n = merge(l, merge(m, r));\n';
      s += '}\n\n';
      return s;
    } else {
      let s = '';
      s += `void upd(ptr& n, ${ktype} lo, ${ktype} hi, Lazy lazy) {\n`;
      s += `    auto [lm, r] = split(n, ${incExc ? 'hi' : 'hi + 1'});\n`;
      s += '    auto [l, m] = split(lm, lo);\n';
      s += '    if (m) m->lazy += lazy;\n';
      s += '    n = merge(l, merge(m, r));\n';
      s += '}\n\n';
      return s;
    }
  },
  rangeUpdateIndexFn: (cfg) => {
    if (!cfg.range_update_index) return '';
    const incExc = cfg.range_type === 'inc exc';
    let s = '';
    s += 'void updi(ptr n, int lo, int hi, Lazy lazy) {\n';
    s += '    if (!n) return;\n';
    if (cfg.push) s += '    push(n);\n';
    s += `    if (lo >= n->sz || hi ${incExc ? '<=' : '<'} 0${cfg.treap_beats ? ' || n->agg.can_break(lazy)' : ''}) return;\n`;
    s += `    if (lo <= 0 && n->sz${incExc ? '' : ' - 1'} <= hi${cfg.treap_beats ? ' && n->agg.can_tag(lazy)' : ''}) {\n`;
    s += '        n->lazy += lazy;\n';
    if (cfg.push) s += '        push(n);\n';
    s += '        return;\n';
    s += '    }\n';
    s += `    if (lo <= sz(n->l) && sz(n->l) ${incExc ? '<' : '<='} hi) n->val.upd(lazy${cfg.size_option ? ', 1' : ''});\n`;
    s += '    updi(n->l, lo, hi, lazy);\n';
    s += '    updi(n->r, lo - 1 - sz(n->l), hi - 1 - sz(n->l), lazy);\n';
    s += '    pull(n);\n';
    s += '}\n\n';
    return s;
  },
  rangeQueryKeyFn: (cfg) => {
    if (!cfg.range_query_key) return '';
    const incExc = cfg.range_type === 'inc exc';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let s = '';
    s += `Value query(ptr& n, ${ktype} lo, ${ktype} hi) {\n`;
    s += `    auto [lm, r] = split(n, ${incExc ? 'hi' : 'hi + 1'});\n`;
    s += '    auto [l, m] = split(lm, lo);\n';
    s += '    Value res = agg(m);\n';
    s += '    n = merge(l, merge(m, r));\n';
    s += '    return res;\n';
    s += '}\n\n';
    return s;
  },
  rangeQueryIndexFn: (cfg) => {
    if (!cfg.range_query_index) return '';
    const incExc = cfg.range_type === 'inc exc';
    let s = '';
    s += 'Value queryi(ptr n, int lo, int hi) {\n';
    s += `    if (!n || lo >= sz(n) || hi ${incExc ? '<=' : '<'} 0) return vid;\n`;
    if (cfg.push) s += '    push(n);\n';
    s += `    if (lo <= 0 && sz(n)${incExc ? '' : ' - 1'} <= hi) return n->agg;\n`;
    s += `    return queryi(n->l, lo, hi) + (lo <= sz(n->l) && sz(n->l) ${incExc ? '<' : '<='} hi ? n->val : vid) + queryi(n->r, lo - 1 - sz(n->l), hi - 1 - sz(n->l));\n`;
    s += '}\n\n';
    return s;
  },
  // size helper
  szFn: (cfg) => {
    if (!cfg.size_option) return '';
    return 'int sz(ptr n) { return n ? n->sz : 0; }\n\n';
  },
  // agg accessor helper
  aggFn: (cfg) => {
    if (!cfg.range_agg) return '';
    return 'Value agg(ptr n) { return n ? n->agg : vid; }\n\n';
  },
  // identity constants for Value and Lazy
  vidConst: (cfg) => {
    if (!cfg.enable_value) return '';
    // Basic zero-initialized identity suitable for sum/min/max placeholders
    return 'const Value vid = {};\n\n';
  },
  lidConst: (cfg) => {
    if (!cfg.lazy_prop) return '';
    return 'const Lazy lid = {};\n\n';
  },
  // Value operator+
  valueOps: (cfg) => {
    if (!cfg.range_agg) return '';
    let s = '';
    s += 'Value operator+(const Value& a, const Value& b) {\n';
    s += '    Value res{};';
    if (cfg.range_sum || cfg.treap_beats) s += '    res.sum = a.sum + b.sum;';
    if (cfg.range_max) s += '    res.mx = std::max(a.mx, b.mx);';
    if (cfg.range_min) s += '    res.mn = std::min(a.mn, b.mn);';
    if (cfg.key_sum) s += '    res.ksum = a.ksum + b.ksum;';
    s += '\n    return res;\n';
    s += '}\n\n';
    return s;
  },
  // Value upd(lazy[, sz])
  valueUpd: (cfg) => {
    if (!cfg.enable_value || !cfg.lazy_prop) return '';
    let s = '';
    s += `void Value::upd(Lazy lazy${cfg.size_option ? ', int sz' : ''}) {\n`;
    if (cfg.range_set) {
      if (cfg.range_sum) s += '    if (!lazy.inc) sum = 0;';
      if (cfg.range_max) s += '    if (!lazy.inc) mx = 0;';
      if (cfg.range_min) s += '    if (!lazy.inc) mn = 0;';
      if (cfg.key_set && cfg.key_sum) s += '    if (!lazy.kinc) ksum = 0;';
    }
    if (cfg.range_add || cfg.range_set) {
      if (cfg.range_sum) s += `    sum += lazy.val${cfg.size_option ? ' * sz' : ''};`;
      if (cfg.range_max) s += '    mx += lazy.val;';
      if (cfg.range_min) s += '    mn += lazy.val;';
    }
    if (cfg.key_add || cfg.key_set) {
      if (cfg.key_sum) s += `    ksum += lazy.val${cfg.size_option ? ' * sz' : ''};`;
    }
    s += '\n}\n\n';
    return s;
  },
  // n-ary merge (variadic)
  nMergeFn: (cfg) => {
    if (!cfg.n_merge_option) return '';
    let s = '';
    s += 'template<typename... Args>\n';
    s += 'ptr merge(ptr l, Args... args) {\n';
    s += '    return merge(l, merge(args...));\n';
    s += '}\n\n';
    return s;
  },
  // plus merge operators
  plusMergeOps: (cfg) => {
    if (!cfg.plus_merge_option) return '';
    let s = '';
    s += 'ptr operator+(Node& lhs, Node& rhs) { return merge(&lhs, &rhs); }\n';
    s += 'ptr operator+(ptr lhs, Node& rhs) { return merge(lhs, &rhs); }\n';
    s += 'ptr operator+(Node& lhs, ptr rhs) { return merge(&lhs, rhs); }\n\n';
    return s;
  },
  // del_all by key
  delAllFn: (cfg) => {
    if (!cfg.del_all_option) return '';
    const incExc = cfg.range_type === 'inc exc';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let s = '';
    s += `ptr del_all(ptr& n, ${ktype} k) {\n`;
    s += `    auto [lm, r] = split(n, k ${incExc ? '+ 1' : '+ 1'});\n`;
    s += '    auto [l, m] = split(lm, k);';
    s += '    n = merge(l, r);';
    s += '    return m;';
    s += '}\n\n';
    return s;
  },
  // rotate by index
  rotateFn: (cfg) => {
    if (!cfg.rot_option) return '';
    let s = '';
    s += 'void rotate(ptr& n, int i) {\n';
    s += '    auto [l, r] = spliti(n, i);\n';
    s += '    n = merge(r, l);\n';
    s += '}\n\n';
    return s;
  },
  // clean up to root (flush lazy)
  cleanFn: (cfg) => {
    if (!cfg.clean_option) return '';
    let s = '';
    s += 'void clean(ptr n) {\n';
    s += '    if (!n) return;\n';
    s += '    clean(n->par);\n';
    s += '    push(n);\n';
    s += '}\n\n';
    return s;
  },
  // order of node via parent pointers
  orderFn: (cfg) => {
    if (!cfg.order_option) return '';
    let s = '';
    s += 'int order(ptr n, ptr from = 0) {\n';
    s += '    if (!n) return -1;\n';
    s += '    int res = order(n->par, n);\n';
    s += '    if (from == n->r || !from) res += sz(n->l) + 1;\n';
    s += '    return res;\n';
    s += '}\n\n';
    return s;
  },
  // root of a node via parent pointers
  rootFn: (cfg) => {
    if (!cfg.root_option) return '';
    let s = '';
    s += 'ptr root(ptr n) {\n';
    s += '    while (n->par) n = n->par;\n';
    s += '    return n;\n';
    s += '}\n\n';
    return s;
  }
};

// Unified, stable total order (no duplicates) for all blocks
const ORDER = [
  'intro', 'comment',
  'forwardDecls', 'ptrType',
  'valueStruct', 'lazyStruct', 'beatsTagHelpers',
  'vidConst', 'lidConst',
  'nodeStruct',
  'valueOps', 'valueUpd',
  'szFn', 'aggFn',
  'pushFn', 'pullFn', 'mergeFn', 'nMergeFn', 'plusMergeOps', 'splitFn',
  'threeSplit', 'findFn', 'findiFn', 'insFn', 'delFn', 'delAllFn', 'insiFn', 'deliFn', 'minFn', 'maxFn',
  'threeSplitIndex','splitiFn','modFn','modIndexFn', 'rotateFn',
  'succFn','predFn', 'cleanFn', 'orderFn', 'rootFn',
  'partitionKey','partitionIndex','cumulativePartitionKey','cumulativePartitionIndex',
  'uniteFn','uniteFastFn','heapifyFn','buildFn','tourFn',
  'rangeReverseKeyFn','rangeReverseIndexFn','rangeUpdateKeyFn','rangeUpdateIndexFn','rangeQueryKeyFn','rangeQueryIndexFn'
];

export function generateTreapCode(cfg: TreapConfig): string {
  let code = '';
  ORDER.forEach(block => { if (fragments[block]) code += fragments[block](cfg); });
  return code.trim() || '// Enable some features to generate code.';
}
