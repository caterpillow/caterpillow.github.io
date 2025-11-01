// BYOT modular code generator: blocks defined above
import { features } from './features';

export type TreapConfig = Record<string, boolean|string>;

// Small helper utilities for conditional code wrapping
function helpers(cfg: TreapConfig) {
  return {
    pull(name: string) {
      return cfg.pull ? `pull(${name})` : name;
    },
  };
}

const fragments: {[key: string]: (cfg: TreapConfig) => string} = {
  intro: (cfg) => cfg.signature ? "// generated at caterpillow.github.io/byot\n\n" : "",
  comment: (cfg) => cfg.comments ? "// Treap code generated with comments\n" : "",

  // Forward declarations for iterator helpers
  forwardDecls: (cfg) => {
    const decls: string[] = [];
    decls.push('struct Node;');
    if (!cfg.augmented_ptr) decls.push('using ptr = struct Node *;');
    else decls.push('struct ptr;')
    if (cfg.succ) decls.push('ptr succ(ptr n);');
    if (cfg.pred) decls.push('ptr pred(ptr n);');
    if (cfg.merge_option) decls.push('ptr merge(ptr l, ptr r);');
    if (cfg.augmented_ptr || cfg.mn_option) decls.push('ptr mn(ptr n);');
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
      s += '    ptr(Node *p = nullptr) : p(p) {}\n\n';
      s += '    template <class... Args>\n';
      s += '    static ptr make(Args&&... args);\n\n';
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
      if (cfg.plus_merge_option) {
        s += '\n';
        s += `    friend ptr operator+(ptr &lhs, ptr &rhs) { ptr res = merge(lhs, rhs); ${cfg.safe_merge_plus ? "lhs.p = rhs.p = nullptr; " : ""}return res; }\n`;
        s += `    friend ptr operator+(ptr &lhs, ptr &&rhs) { ptr res = merge(lhs, rhs); ${cfg.safe_merge_plus ? "lhs.p = nullptr; " : ""}return res; }\n`;
        s += `    friend ptr operator+(ptr &&lhs, ptr &rhs) { ptr res = merge(lhs, rhs); ${cfg.safe_merge_plus ? "rhs.p = nullptr; " : ""}return res; }\n`;
        s += `    friend ptr operator+(ptr &&lhs, ptr &&rhs) { return merge(lhs, rhs); }\n`;
        s += `    friend ptr &operator+=(ptr &lhs, ptr &rhs) { lhs = merge(lhs, rhs); ${cfg.safe_merge_plus ? "rhs.p = nullptr; " : ""}return lhs; }\n`;
        s += `    friend ptr &operator+=(ptr &lhs, ptr &&rhs) { return lhs = merge(lhs, rhs); }\n`;
      }
      s += '\n';
      s += '    inline ptr begin() { return mn(*this); }\n';
      s += '    inline ptr end() { return ptr{nullptr}; }\n';
      s += '};\n\n';
      s += 'inline ptr begin(ptr n) { return n.begin(); }\n';
      s += 'inline ptr end(ptr n) { return n.end(); }\n\n';
      return s;
    }
    return '';
  },

  valueStruct: (cfg) => {
    if (!cfg.enable_value) return "";
    let out = '';
    if (cfg.comments) out += '// You can implement your own monoid here for custom operations.\n';
    out += 'struct Value {\n';
    if (cfg.range_sum || cfg.treap_beats) out += '    long long sum;\n';
    if (cfg.range_max && !cfg.treap_beats) out += '    int mx;\n';
    if (cfg.range_min && !cfg.treap_beats) out += '    int mn;\n';
    if (cfg.key_sum) out += `    ${cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int'} ksum;\n`;
    if (cfg.treap_beats && cfg.beats_chmin) out += '    long long mx, mxcnt, mx2;\n';
    if (cfg.treap_beats && cfg.beats_chmax) out += '    long long mn, mncnt, mn2;\n';
    out += '\n';
    // Value::make for beats
    if (cfg.treap_beats) {
      const inf = (cfg.val_type === 'int' ? '1\'000\'000\'000' : '1\'000\'000\'000\'000\'000\'000');
      const args: string[] = [];
      if (cfg.key_sum) args.push('0');
      if (cfg.treap_beats) args.push('x * len');
      if (cfg.beats_chmin) {
        args.push('x');
        args.push('len');
        args.push(`-${inf}`);
      }
      if (cfg.beats_chmax) {
        args.push('x');
        args.push('len');
        args.push(`${inf}`);
      }
      out += `    static Value make(long long x, long long len = 1) {\n`;
      out += `        return {${args.join(', ')}};\n`;
      out += '    }\n\n';
    }
    // can_break and can_tag for beats
    if (cfg.treap_beats) {
      const breakArgs: string[] = [];
      const tagArgs: string[] = [];
      if (cfg.beats_chmin) {
        breakArgs.push('lazy.mn >= mx');
        tagArgs.push('mx2 < lazy.mn');
      }
      if (cfg.beats_chmax) {
        breakArgs.push('lazy.mx <= mn');
        tagArgs.push('mn2 > lazy.mx');
      }
      if (cfg.beats_add) breakArgs.push('lazy.add == 0');
      out += '    bool can_break(const Lazy& lazy) {\n';
      out += `        return ${breakArgs.join(' && ')};\n`;
      out += '    }\n\n';
      out += '    bool can_tag(const Lazy& lazy) {\n';
      out += `        return ${tagArgs.join(' && ')};\n`;
      out += '    }\n\n';
    }
    // Inject valueOps here (operator+)
    if (cfg.range_agg) {
      out += '    Value operator+(const Value& oth) const {\n';
      out += '        Value res {};\n';
      if (cfg.range_sum || cfg.treap_beats) out += '        res.sum = sum + oth.sum;\n';
      if (cfg.range_max && !cfg.treap_beats) out += '        res.mx = std::max(mx, oth.mx);\n';
      if (cfg.range_min && !cfg.treap_beats) out += '        res.mn = std::min(mn, oth.mn);\n';
      if (cfg.key_sum) out += '        res.ksum = ksum + oth.ksum;\n';
      if (cfg.treap_beats && cfg.beats_chmin) {
        out += '        if (mx == oth.mx) res.mx = mx, res.mxcnt = mxcnt + oth.mxcnt, res.mx2 = std::max(mx2, oth.mx2);\n';
        out += '        else if (mx > oth.mx) res.mx = mx, res.mxcnt = mxcnt, res.mx2 = std::max(mx2, oth.mx);\n';
        out += '        else res.mx = oth.mx, res.mxcnt = oth.mxcnt, res.mx2 = std::max(mx, oth.mx2);\n';
      }
      if (cfg.treap_beats && cfg.beats_chmax) {
        out += '        if (mn == oth.mn) res.mn = mn, res.mncnt = mncnt + oth.mncnt, res.mn2 = std::min(mn2, oth.mn2);\n';
        out += '        else if (mn < oth.mn) res.mn = mn, res.mncnt = mncnt, res.mn2 = std::min(mn2, oth.mn);\n';
        out += '        else res.mn = oth.mn, res.mncnt = oth.mncnt, res.mn2 = std::min(mn, oth.mn2);\n';
      }
      out += '        return res;\n';
      out += '    }\n';
    }
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
    out += '\n';
    out += '    void operator+=(const Lazy oth) {\n';
    if (cfg.range_reverse_key || cfg.range_reverse_index) out += '        rev ^= oth.rev;\n';
    if (cfg.range_add || cfg.range_set) {
      if (cfg.range_set) out += '        if (!oth.inc) val = 0, inc = false;\n';
      out += '        val += oth.val;\n';
    }
    if (cfg.key_add || cfg.key_set) {
      if (cfg.key_set) out += '        if (!oth.kinc) kval = 0, kinc = false;\n';
      out += '        kval += oth.kval;\n';
    }
    if (cfg.treap_beats && cfg.beats_chmin && cfg.beats_chmax) {
      const addOffset = cfg.beats_add ? ' - add' : '';
      out += `        if (oth.mn${addOffset} <= mx) mn = mx = oth.mn${addOffset};\n`;
      out += `        else if (oth.mx${addOffset} >= mn) mn = mx = oth.mx${addOffset};\n`;
      out += '        else {\n';
      out += `            mn = std::min(mn, oth.mn${addOffset});\n`;
      out += `            mx = std::max(mx, oth.mx${addOffset});\n`;
      out += '        }\n';
    } else {
      if (cfg.treap_beats && cfg.beats_chmin) {
        const addOffset = cfg.beats_add ? ' - add' : '';
        out += `        mn = std::min(mn, oth.mn${addOffset});\n`;
      }
      if (cfg.treap_beats && cfg.beats_chmax) {
        const addOffset = cfg.beats_add ? ' - add' : '';
        out += `        mx = std::max(mx, oth.mx${addOffset});\n`;
      }
    }
    if (cfg.treap_beats && cfg.beats_add) out += '        add += oth.add;\n';
    out += '    }\n';
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
    let out = '';
    out += 'mt19937 mt(chrono::high_resolution_clock::now().time_since_epoch().count());\n\n';
    out += "struct Node {\n";
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
    if (cfg.augmented_ptr) {
      out += 'template <class... Args>\n';
      out += 'ptr ptr::make(Args&&... args) {\n';
      out += '    return ptr(new Node(std::forward<Args>(args)...));\n';
      out += '}\n\n';
    }
    return out;
  },

  mergeFn: (cfg) => {
    if (!cfg.merge_option) return '';
    const h = helpers(cfg);
    let s = '';
    s += 'ptr merge(ptr l, ptr r) {\n';
    s += '    if (!l || !r) return l ? l : r;\n';
    if (cfg.push) s += '    push(l), push(r);\n';
    s += `    if (l->pri > r->pri)\n        return l->r = merge(l->r, r), ${h.pull('l')};\n`;
    s += `    else\n        return r->l = merge(l, r->l), ${h.pull('r')};\n`;
    s += '}\n\n';
    return s;
  },

  safeMergeFn: (cfg) => {
    if (!cfg.safe_merge_option) return '';
    let s = '';
    s += `ptr safe_merge(ptr &lhs, ptr &rhs) { ptr res = merge(lhs, rhs); lhs.p = rhs.p = nullptr; return res; }\n`;
    s += `ptr safe_merge(ptr &lhs, ptr &&rhs) { ptr res = merge(lhs, rhs); lhs.p = nullptr; return res; }\n`;
    s += `ptr safe_merge(ptr &&lhs, ptr &rhs) { ptr res = merge(lhs, rhs); rhs.p = nullptr; return res; }\n`;
    s += `ptr safe_merge(ptr &&lhs, ptr &&rhs) { return merge(lhs, rhs); }\n`;
    return s;
  },

  splitFn: (cfg) => {
    if (!cfg.split_option) return '';
    const h = helpers(cfg);
    let s = '';
    if (cfg.comments) s += '// (-inf, k) and [k, inf)\n';
    s += 'void split(ptr n, int k, ptr &l, ptr &r) {\n';  
    s += '    if (!n) { l = r = nullptr; return; }\n';
    if (cfg.push) s += '    push(n);\n';
    s += `    if (k <= n->key) split(n->l, k, l, n->l), ${h.pull('r = n')};\n`;
    s += `    else split(n->r, k, n->r, r), ${h.pull('l = n')};\n`;
    s += '}\n\n';
    s += 'std::pair<ptr, ptr> split(ptr n, int k) { ptr l, r; split(n, k, l, r); return {l, r}; }\n\n';
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
    if (cfg.push) s += '    if (n->l) push(n->l);\n    if (n->r) push(n->r);\n';
    if (cfg.size_option) s += '    n->sz = sz(n->l) + 1 + sz(n->r);\n';
    if (cfg.range_agg) s += '    n->agg = agg(n->l) + n->val + agg(n->r);\n';
    s += '    return n;\n}\n\n';
    return s;
  },

  threeSplit: (cfg) => {
    if (!cfg.three_split_option || !cfg.split_option) return '';
    const incExc = cfg.range_type === 'inc exc';
    let out = '';
    if (cfg.comments) out += `// cuts out [lo, hi${incExc ? ')' : ']'}\n`;
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
    if (cfg.push) out += '    push(n);\n';
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
    if (cfg.push) out += '    push(n);\n';
    out += '    if (sz(n->l) == i) return n;\n';
    out += '    if (i < sz(n->l)) return findi(n->l, i);\n';
    out += '    else return findi(n->r, i - sz(n->l) - 1);\n';
    out += '}\n\n';
    return out;
  },
  insFn: (cfg) => {
    if (!cfg.ins_option) return '';
    let out = '';
    if (cfg.comments) out += '// only insert single nodes\n';
    out += 'void ins(ptr& n, ptr it) {\n';
    out += '    if (!n) { n = it; return; }\n';
    if (cfg.push) out += '    push(n);\n';
    out += '    if (n->pri < it->pri) split(n, it->key, it->l, it->r), n = it;\n';
    out += '    else if (it->key <= n->key) ins(n->l, it);\n';
    out += '    else ins(n->r, it);\n';
    if (cfg.pull) out += '    pull(n);\n';
    out += '}\n\n';
    return out;
  },
  delFn: (cfg) => {
    if (!cfg.del_option) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    if (cfg.comments) out += '// returns pointer to deleted node\n';
    out += `ptr del(ptr& n, ${ktype} k) {\n`;
    out += '    if (!n) return nullptr;\n';
    if (cfg.push) out += '    push(n);\n';
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
    if (cfg.comments) out += '// inserts node such that it will be at index i. only insert single nodes\n';
    out += 'void insi(ptr& n, ptr it, int i) {\n';
    out += '    if (!n) { n = it; return; }\n';
    if (cfg.push) out += '    push(n);\n';
    out += '    if (n->pri < it->pri) spliti(n, i, it->l, it->r), n = it;\n';
    out += '    else if (i <= sz(n->l)) insi(n->l, it, i);\n';
    out += '    else insi(n->r, it, i - 1 - sz(n->l));\n';
    out += '    pull(n);\n';
    out += '}\n\n';
    return out;
  },
  deliFn: (cfg) => {
    if (!cfg.deli_option) return '';
    let out = '';
    if (cfg.comments) out += '// returns pointer to deleted node\n';
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
    out += '    if (!n) return nullptr;\n';
    if (cfg.push) out += '    push(n);\n';
    out += `    while (n->l) n = n->l${cfg.push ? ", push(n)" : ""};\n`;
    out += `    return n;\n`;
    out += '}\n\n';
    return out;
  },
  maxFn: (cfg) => {
    if (!cfg.max_option) return '';
    const h = helpers(cfg);
    let out = 'ptr mx(ptr n) {\n';
    out += '    if (!n) return nullptr;\n';
    if (cfg.push) out += '    push(n);\n';
    out += `    while (n->r) n = n->r${cfg.push ? ", push(n)" : ""};\n`;
    out += `    return n;\n`;
    out += '}\n\n';
    return out;
  },
  threeSplitIndex: (cfg) => {
    if (!cfg.three_spliti_option || !cfg.spliti_option) return '';
    const incExc = cfg.range_type === 'inc exc';
    let out = '';
    if (cfg.comments) out += `// cuts out [lo, hi${incExc ? ')' : ']'}\n`;
    out += 'std::tuple<ptr, ptr, ptr> spliti(ptr n, int lo, int hi) {\n';
    out += '    auto [lm, r] = spliti(n, hi);\n';
    out += '    auto [l, m] = spliti(lm, lo);\n';
    out += '    return {l, m, r};\n';
    out += '}\n\n';
    return out;
  },
  splitiFn: (cfg) => {
    if (!cfg.spliti_option) return '';
    const h = helpers(cfg);
    let out = '';
    if (cfg.comments) out += '// (-inf, i) and [i, inf)\n';
    out += 'void spliti(ptr n, int i, ptr &l, ptr &r) {\n';
    out += '    if (!n) { l = r = nullptr; return; }\n';
    if (cfg.push) out += '    push(n);\n';
    out += `    if (i <= sz(n->l)) spliti(n->l, i, l, n->l), ${h.pull('r = n')};\n`;
    out += `    else spliti(n->r, i - 1 - sz(n->l), n->r, r), ${h.pull('l = n')};\n`;
    out += '}\n\n';
    out += 'std::pair<ptr, ptr> spliti(ptr n, int i) { ptr l, r; spliti(n, i, l, r); return {l, r}; }\n\n';
    return out;
  },
  modFn: (cfg) => {
    if (!cfg.mod_option) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    if (cfg.comments) out += '// performs an arbitrary operation on some node\n';
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
    if (cfg.comments) out += '// performs an arbitrary operation on some node\n';
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
  lowerBound: (cfg) => {
    if (!cfg.lower_bound_option) return '';
    let out = '';
    if (cfg.comments) out += '// finds the first iter in treap where bool(*iter < k) is false\n';
    out += `ptr lower_bound(ptr n, ${cfg.key_type} k) {\n`;
    out += '    if (!n) return nullptr;\n';
    if (cfg.push) out += '    push(n);\n';
    out += '    if (n->key < k) return lower_bound(n->r, k);\n';
    out += '    ptr rhs = lower_bound(n->l, k);\n';
    out += '    return rhs ? rhs : n;\n';
    out += '}\n\n';
    return out;
  },
  upperBound: (cfg) => {
    if (!cfg.upper_bound_option) return '';
    let out = '';
    if (cfg.comments) out += '// finds the first iter in treap where bool(k, *iter) is true\n';
    out += `ptr upper_bound(ptr n, ${cfg.key_type} k) {\n`;
    out += '    if (!n) return nullptr;\n';
    if (cfg.push) out += '    push(n);\n';
    out += '    if (!(k < n->key)) return upper_bound(n->r, k);\n';
    out += '    ptr lhs = upper_bound(n->l, k);\n';
    out += '    return lhs ? lhs : n;\n';
    out += '}\n\n';
    return out;
  },
  partitionKey: (cfg) => {
    if (!cfg.partition_key) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    if (cfg.comments) out += '// finds smallest key such that pred returns false\n';
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
    if (cfg.comments) out += '// find smallest index such that pred returns false\n';
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
    if (cfg.comments) {
      out += '// given a predicate that will return true for some prefix of aggregates,\n';
      out += '// find the key of the first prefix aggregate makes the predicate false (max key + 1 if always true)\n';
      out += '// eg. find the smallest prefix that has sum > x\n';
    }
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
    if (cfg.comments) {
      out += '// given a predicate that will return true for some prefix of aggregates,\n';
      out += '// find the index of the first prefix aggregate that makes the predicate false (sz(n) if always true)\n';
      out += '// eg. find the smallest prefix that has sum > x\n';
    }
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
    if (cfg.comments) out += '// proof of complexity: https://codeforces.com/blog/entry/108601\n';
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
    if (cfg.comments) out += '// fast in practice (i think?)\n';
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
    if (cfg.comments) s += '// you CANNOT use the normal range update for range reverses\n';
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
    if (cfg.comments) s += '// you CANNOT use the normal range update for range reverses\n';
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
    const inf = (cfg.val_type === 'int' ? '1\'000\'000\'000' : '1\'000\'000\'000\'000\'000\'000');
    const valId: string[] = [];
    if (cfg.range_sum || cfg.treap_beats) valId.push('0');
    if (cfg.range_max) valId.push(`-${inf}`);
    if (cfg.range_min) valId.push(`${inf}`);
    if (cfg.key_sum) valId.push('0');
    if (cfg.treap_beats) {
      if (cfg.beats_chmin) {
        valId.push(`-${inf}`);
        valId.push('0');
        valId.push(`-${inf}`);
      }
      if (cfg.beats_chmax) {
        valId.push(`${inf}`);
        valId.push('0');
        valId.push(`${inf}`);
      }
    }
    if (valId.length === 0) return 'const Value vid = {};\n\n';
    return `const Value vid = {${valId.join(', ')}};\n\n`;
  },
  lidConst: (cfg) => {
    if (!cfg.lazy_prop) return '';
    const inf = (cfg.val_type === 'int' ? '1\'000\'000\'000' : '1\'000\'000\'000\'000\'000\'000');
    const lazyId: string[] = [];
    if (cfg.range_reverse_key || cfg.range_reverse_index) lazyId.push('false');
    if (cfg.range_add || cfg.range_set) lazyId.push('0');
    if (cfg.range_set) lazyId.push('true');
    if (cfg.key_add || cfg.key_set) lazyId.push('0');
    if (cfg.key_set) lazyId.push('false');
    if (cfg.treap_beats && cfg.beats_chmin) lazyId.push(`${inf}`);
    if (cfg.treap_beats && cfg.beats_chmax) lazyId.push(`-${inf}`);
    if (cfg.treap_beats && cfg.beats_add) lazyId.push('0');
    if (lazyId.length === 0) return 'const Lazy lid = {};\n\n';
    return `const Lazy lid = {${lazyId.join(', ')}};\n\n`;
  },
  // Value operator+ (inside struct)
  valueOps: (cfg) => {
    if (!cfg.range_agg) return '';
    let s = '';
    s += '    Value operator+(const Value& oth) const {\n';
    s += '        Value res {};\n';
    if (cfg.range_sum || cfg.treap_beats) s += '        res.sum = sum + oth.sum;\n';
    if (cfg.range_max && !cfg.treap_beats) s += '        res.mx = std::max(mx, oth.mx);\n';
    if (cfg.range_min && !cfg.treap_beats) s += '        res.mn = std::min(mn, oth.mn);\n';
    if (cfg.key_sum) s += '        res.ksum = ksum + oth.ksum;\n';
    if (cfg.treap_beats && cfg.beats_chmin) {
      s += '        if (mx == oth.mx) res.mx = mx, res.mxcnt = mxcnt + oth.mxcnt, res.mx2 = std::max(mx2, oth.mx2);\n';
      s += '        else if (mx > oth.mx) res.mx = mx, res.mxcnt = mxcnt, res.mx2 = std::max(mx2, oth.mx);\n';
      s += '        else res.mx = oth.mx, res.mxcnt = oth.mxcnt, res.mx2 = std::max(mx, oth.mx2);\n';
    }
    if (cfg.treap_beats && cfg.beats_chmax) {
      s += '        if (mn == oth.mn) res.mn = mn, res.mncnt = mncnt + oth.mncnt, res.mn2 = std::min(mn2, oth.mn2);\n';
      s += '        else if (mn < oth.mn) res.mn = mn, res.mncnt = mncnt, res.mn2 = std::min(mn2, oth.mn);\n';
      s += '        else res.mn = oth.mn, res.mncnt = oth.mncnt, res.mn2 = std::min(mn, oth.mn2);\n';
    }
    s += '        return res;\n';
    s += '    }\n';
    return s;
  },
  // Value upd(lazy[, sz])
  valueUpd: (cfg) => {
    if (!cfg.enable_value || !cfg.lazy_prop) return '';
    let s = '';
    s += `void Value::upd(Lazy lazy${cfg.size_option ? ', int sz' : ''}) {\n`;
    if (cfg.treap_beats) {
      // Beats adjustments
      if (cfg.beats_add || cfg.beats_chmin || cfg.beats_chmax) {
        if (cfg.beats_chmin && cfg.beats_chmax) {
          s += '    if (mn == mx) {\n';
          s += '        mn = mx = std::min((long long)lazy.mn, (long long)mn);\n';
          s += '        mn = mx = std::max((long long)lazy.mx, (long long)mn);\n';
          s += '        sum = mn * mncnt;\n';
          s += '    } else {\n';
          s += '        if (lazy.mn < mx) sum -= (mx - lazy.mn) * mxcnt, mx = lazy.mn;\n';
          s += '        if (lazy.mx > mn) sum += (lazy.mx - mn) * mncnt, mn = lazy.mx;\n';
        } else {
          if (cfg.beats_chmin) s += '    if (lazy.mn < mx) sum -= (mx - lazy.mn) * mxcnt, mx = lazy.mn;\n';
          if (cfg.beats_chmax) s += '    if (lazy.mx > mn) sum += (lazy.mx - mn) * mncnt, mn = lazy.mx;\n';
        }
        if (cfg.beats_add) {
          s += `    sum += lazy.add${cfg.size_option ? ' * sz' : ''};\n`;
          if (cfg.beats_chmin) s += '    mx += lazy.add, mx2 += lazy.add;\n';
          if (cfg.beats_chmax) s += '    mn += lazy.add, mn2 += lazy.add;\n';
        }
      }
    } else {
      // Non-beats logic
      if (cfg.range_set) {
        if (cfg.range_sum) s += '    if (!lazy.inc) sum = 0;\n';
        if (cfg.range_max) s += '    if (!lazy.inc) mx = 0;\n';
        if (cfg.range_min) s += '    if (!lazy.inc) mn = 0;\n';
        if (cfg.key_set && cfg.key_sum) s += '    if (!lazy.kinc) ksum = 0;\n';
      }
      if (cfg.range_add || cfg.range_set) {
        if (cfg.range_sum) s += `    sum += lazy.val${cfg.size_option ? ' * sz' : ''};\n`;
        if (cfg.range_max) s += '    mx += lazy.val;\n';
        if (cfg.range_min) s += '    mn += lazy.val;\n';
      }
      if (cfg.key_add || cfg.key_set) {
        if (cfg.key_sum) s += `    ksum += lazy.val${cfg.size_option ? ' * sz' : ''};\n`;
      }
    }
    s += '}\n\n';
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
  // del_all by key
  delAllFn: (cfg) => {
    if (!cfg.del_all_option) return '';
    const incExc = cfg.range_type === 'inc exc';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let s = '';
    if (cfg.comments) s += '// removes all nodes with given key, and returns it in one big treap\n';
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
    if (cfg.comments) s += '// rotates treap such that index i is at the start\n';
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
  'valueUpd',
  'szFn', 'aggFn',
  'pushFn', 'pullFn', 'mergeFn', 'safeMergeFn', 'nMergeFn', 'splitFn',
  'threeSplit', 'findFn', 'findiFn', 'insFn', 'delFn', 'delAllFn', 'insiFn', 'deliFn', 'minFn', 'maxFn',
  'threeSplitIndex','splitiFn','modFn','modIndexFn', 'rotateFn',
  'succFn','predFn', 'cleanFn', 'orderFn', 'rootFn',
  'lowerBound', 'upperBound', 'partitionKey','partitionIndex','cumulativePartitionKey','cumulativePartitionIndex',
  'uniteFn','uniteFastFn','heapifyFn','buildFn','tourFn',
  'rangeReverseKeyFn','rangeReverseIndexFn','rangeUpdateKeyFn','rangeUpdateIndexFn','rangeQueryKeyFn','rangeQueryIndexFn'
];

export function generateTreapCode(cfg: TreapConfig): string {
  let code = '';
  ORDER.forEach(block => { if (fragments[block]) code += fragments[block](cfg); });
  code = code.trim() || '// Enable some features to generate code.';

  // Post-processing (from old byot.html)
  if (cfg.use_namespace_std) {
    code = code.replace(/std::/g, '');
  }
  if (cfg.use_ll_typedef) {
    code = code.replace(/long long/g, 'll');
  }
  if (cfg.namespace_treap) {
    const indented = code.split('\n').map(line => '    ' + line).join('\n');
    code = 'namespace Treap {\n\n' + indented + '\n\n}\n\nusing namespace Treap;\n\n';
  }
  if (cfg.template) {
    let prefix = '#include <bits/stdc++.h>\n\n';
    if (cfg.use_namespace_std) prefix += 'using namespace std;\n';
    if (cfg.use_ll_typedef) prefix += 'using ll = long long;\n\n';
    code = prefix + code;
    code += '\n\nint main() {\n';
    code += '    cin.tie(0)->sync_with_stdio(0);\n';
    code += '    \n';
    code += '}\n';
  }

  // Tab character replacement
  const tabChar = cfg.tab_char === '2spaces' ? '  ' :
                  cfg.tab_char === '3spaces' ? '   ' :
                  cfg.tab_char === '4spaces' ? '    ' :
                  cfg.tab_char === '8spaces' ? '        ' :
                  cfg.tab_char === 'tab' ? '\t' : '    ';
  code = code.replace(/ {4}/g, tabChar);

  return code;
}
