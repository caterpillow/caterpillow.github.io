// BYOT modular code generator: blocks defined above
import { normalizeConfig } from './depsUtil';
import { generateWrapper } from './wrappers';

export type TreapConfig = Record<string, boolean|string>;

function usesAugmentedPtr(cfg: TreapConfig) {
  return !!(cfg.augmented_ptr || cfg.array_storage);
}

function usesStrongPtr(cfg: TreapConfig) {
  return usesAugmentedPtr(cfg) && !!(cfg.safe_merge_option || cfg.safe_merge_plus);
}

function partitionType(cfg: TreapConfig) {
  return cfg.partition_result === 'optional' ? `std::optional<${cfg.key_type}>` : String(cfg.key_type);
}

function partitionNone(cfg: TreapConfig) {
  return cfg.partition_result === 'optional' ? 'std::nullopt' : 'partition_none';
}

function arrayStorageSize(cfg: TreapConfig) {
  return String(cfg.array_storage_size || '1 << 17');
}

function persistScope(cfg: TreapConfig) {
  return cfg.persistent && cfg.array_storage ? '    PersistentScope _;\n' : '';
}

function usesSizeBiasedMerge(cfg: TreapConfig) {
  return !!(cfg.size_biased_merge || cfg.persistent);
}

function valueType(cfg: TreapConfig) {
  return cfg.val_type === 'int' ? 'int' : 'long long';
}

function upperSplit(cfg: TreapConfig, tree: string, key: string) {
  return `${cfg.range_type === 'inc exc' ? 'split' : 'split_le'}(${tree}, ${key})`;
}

function upperIndex(cfg: TreapConfig, tree: string, index: string) {
  return cfg.range_type === 'inc exc' ? index : `${index} < sz(${tree}) ? ${index} + 1 : sz(${tree})`;
}

// Small helper utilities for conditional code wrapping
function helpers(cfg: TreapConfig) {
  return {
    pull(name: string) {
      return cfg.pull ? `pull(${name})` : name;
    },
  };
}

function extremeFn(cfg: TreapConfig, name: string, side: string) {
  let out = `ptr ${name}(ptr n) {\n`;
  if (cfg.persistent && cfg.push) out += persistScope(cfg);
  out += '    while (n) {\n';
  if (cfg.persistent && cfg.push) out += '        clone(n);\n';
  if (cfg.push) out += '        push(n);\n';
  out += `        if (!n->${side}) return n;\n`;
  out += `        n = n->${side};\n`;
  out += '    }\n';
  out += '    return nullptr;\n';
  out += '}\n\n';
  return out;
}

const fragments: {[key: string]: (cfg: TreapConfig) => string} = {
  intro: () => "",
  comment: (cfg) => cfg.comments ? "// Treap code generated with comments\n" : "",

  // Forward declarations for iterator helpers
  forwardDecls: (cfg) => {
    const augmentedPtr = usesAugmentedPtr(cfg);
    const decls: string[] = [];
    decls.push('struct Node;');
    if (cfg.enable_value && cfg.lazy_prop) decls.push('struct Lazy;');
    if (!augmentedPtr) decls.push('using ptr = struct Node *;');
    else decls.push('struct ptr;')
    if (cfg.succ) decls.push('ptr succ(ptr n);');
    if (cfg.pred) decls.push('ptr pred(ptr n);');
    if (cfg.merge_option) decls.push('ptr merge(ptr l, ptr r);');
    if (augmentedPtr || cfg.mn_option) decls.push('ptr mn(ptr n);');
    if (decls.length == 0) return '';
    return decls.join(' ') + '\n\n';
  },

  // ptr type: augmented wrapper or plain alias
  ptrType: (cfg) => {
    if (usesAugmentedPtr(cfg)) {
      let s = '';
      s += 'struct ptr {\n';
      if (cfg.succ) {
        s += '    using iterator_category = std::forward_iterator_tag;\n';
        s += '    using value_type = Node;\n';
        s += '    using difference_type = std::ptrdiff_t;\n';
        s += '    using pointer = Node*;\n';
        s += '    using reference = Node&;\n';
        s += '#if __cpp_lib_concepts\n';
        s += '    using iterator_concept = std::forward_iterator_tag;\n';
        s += '#endif\n';
        s += '\n\n';
      }
      if (cfg.array_storage) {
        s += '    int p;\n';
        s += '    ptr(std::nullptr_t = nullptr) : p(0) {}\n';
        s += '    ptr(int p) : p(p) {}\n';
        s += '    ptr(Node *p);\n\n';
      } else {
        s += '    Node *p;\n';
        s += '    ptr(std::nullptr_t = nullptr) : p(nullptr) {}\n';
        s += '    ptr(Node *p) : p(p) {}\n\n';
      }
      s += `    ptr &operator=(std::nullptr_t) { p = ${cfg.array_storage ? '0' : 'nullptr'}; return *this; }\n`;
      if (cfg.array_storage) s += '    ptr &operator=(Node *n);\n';
      else s += '    ptr &operator=(Node *n) { p = n; return *this; }\n';
      s += `    bool operator==(std::nullptr_t) const noexcept { return p == ${cfg.array_storage ? '0' : 'nullptr'}; }\n`;
      s += `    bool operator!=(std::nullptr_t) const noexcept { return p != ${cfg.array_storage ? '0' : 'nullptr'}; }\n\n`;
      s += '    template <class... Args>\n';
      s += '    static ptr make(Args&&... args);\n\n';
      if (cfg.array_storage) {
        s += '    Node &operator*() const;\n';
        s += '    Node *operator->() const;\n';
        s += '    Node *get() const;\n';
        s += '    operator Node*() const;\n';
      } else {
        s += '    Node &operator*() const { return *p; }\n';
        s += '    Node *operator->() const { return p; }\n';
        s += '    Node *get() const { return p; }\n';
        s += '    operator Node*() const { return p; }\n';
      }
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
        s += `    friend ptr operator+(ptr &lhs, ptr &rhs) { ptr res = merge(lhs, rhs); ${cfg.safe_merge_plus ? "lhs = rhs = nullptr; " : ""}return res; }\n`;
        s += `    friend ptr operator+(ptr &lhs, ptr &&rhs) { ptr res = merge(lhs, rhs); ${cfg.safe_merge_plus ? "lhs = nullptr; " : ""}return res; }\n`;
        s += `    friend ptr operator+(ptr &&lhs, ptr &rhs) { ptr res = merge(lhs, rhs); ${cfg.safe_merge_plus ? "rhs = nullptr; " : ""}return res; }\n`;
        s += `    friend ptr operator+(ptr &&lhs, ptr &&rhs) { return merge(lhs, rhs); }\n`;
        s += `    friend ptr &operator+=(ptr &lhs, ptr &rhs) { lhs = merge(lhs, rhs); ${cfg.safe_merge_plus ? "rhs = nullptr; " : ""}return lhs; }\n`;
        s += `    friend ptr &operator+=(ptr &lhs, ptr &&rhs) { return lhs = merge(lhs, rhs); }\n`;
      }
      s += '\n';
      if (cfg.subscript === 'index') s += '    template<class Index, std::enable_if_t<std::is_integral_v<Index>, int> = 0>\n    ptr operator[](Index i) const;\n';
      if (cfg.subscript === 'key') s += `    template<class Key, std::enable_if_t<std::is_convertible_v<Key, ${cfg.key_type}>, int> = 0>\n    ptr operator[](Key key)${cfg.subscript_key_mode === 'insert' ? '' : ' const'};\n`;
      s += '    inline ptr begin() const { return mn(*this); }\n';
      s += '    inline ptr end() const { return ptr{nullptr}; }\n';
      s += '};\n\n';
      s += 'inline ptr begin(ptr n) { return n.begin(); }\n';
      s += 'inline ptr end(ptr n) { return n.end(); }\n\n';
      return s;
    }
    return '';
  },

  strongPtrType: (cfg) => {
    if (!usesStrongPtr(cfg)) return '';
    let s = 'class strong_ptr {\n';
    s += '    ptr p;\n';
    s += 'public:\n';
    s += '    strong_ptr(std::nullptr_t = nullptr) : p(nullptr) {}\n';
    s += '    strong_ptr(ptr n) : p(n) {}\n';
    s += '    strong_ptr(Node *n) : p(n) {}\n';
    s += '    strong_ptr &operator=(ptr n) { p = n; return *this; }\n';
    s += '    strong_ptr &operator=(Node *n) { p = n; return *this; }\n';
    s += '    strong_ptr &operator=(std::nullptr_t) { p = nullptr; return *this; }\n';
    s += '    operator ptr() const { return p; }\n';
    s += '    explicit operator bool() const { return bool(p); }\n';
    s += '    Node *get() const { return p.get(); }\n';
    s += '    Node *operator->() const { return p.get(); }\n';
    s += '    Node &operator*() const { return *p; }\n';
    s += '    bool operator==(std::nullptr_t) const { return p == nullptr; }\n';
    s += '    bool operator!=(std::nullptr_t) const { return p != nullptr; }\n';
    s += '    bool operator==(strong_ptr n) const { return p == n.p; }\n';
    s += '    bool operator!=(strong_ptr n) const { return p != n.p; }\n';
    s += '    friend bool operator==(strong_ptr a, ptr b) { return a.p == b; }\n';
    s += '    friend bool operator==(ptr a, strong_ptr b) { return a == b.p; }\n';
    s += '    friend bool operator!=(strong_ptr a, ptr b) { return a.p != b; }\n';
    s += '    friend bool operator!=(ptr a, strong_ptr b) { return a != b.p; }\n';
    s += '    template<class L, class R, std::enable_if_t<(std::is_same_v<std::decay_t<L>, strong_ptr> || std::is_same_v<std::decay_t<R>, strong_ptr>) && std::is_convertible_v<L, ptr> && std::is_convertible_v<R, ptr>, int> = 0>\n';
    s += '    friend ptr operator+(L&& lhs, R&& rhs) {\n';
    s += '        ptr res = merge(ptr(lhs), ptr(rhs));\n';
    if (cfg.safe_merge_plus) {
      s += '        if constexpr (std::is_same_v<L, ptr&>) lhs = nullptr;\n';
      s += '        if constexpr (std::is_same_v<R, ptr&>) rhs = nullptr;\n';
    }
    s += '        return res;\n';
    s += '    }\n';
    s += '    friend ptr& operator+=(ptr& lhs, strong_ptr rhs) { return lhs = merge(lhs, ptr(rhs)); }\n';
    s += '    template<class R, std::enable_if_t<std::is_convertible_v<R, ptr>, int> = 0>\n';
    s += '    strong_ptr& operator+=(R&& rhs) { p = *this + std::forward<R>(rhs); return *this; }\n';
    s += '};\n\n';
    return s;
  },

  subscriptFn: (cfg) => {
    if (cfg.subscript === 'index') return 'template<class Index, std::enable_if_t<std::is_integral_v<Index>, int>>\nptr ptr::operator[](Index i) const {\n    if constexpr (std::is_signed_v<Index>) if (i < 0) return nullptr;\n    if (std::uintmax_t(i) >= std::uintmax_t(sz(*this))) return nullptr;\n    return findi(*this, int(i));\n}\n\n';
    if (cfg.subscript !== 'key') return '';
    const declaration = `template<class Key, std::enable_if_t<std::is_convertible_v<Key, ${cfg.key_type}>, int>>\n`;
    if (cfg.subscript_key_mode !== 'insert') return declaration + `ptr ptr::operator[](Key key) const { return find(*this, static_cast<${cfg.key_type}>(key)); }\n\n`;
    return declaration + `ptr ptr::operator[](Key key) {\n    ${cfg.key_type} k = key;\n    if (ptr n = find(*this, k)) return n;\n    ins(*this, ptr::make(k));\n    return find(*this, k);\n}\n\n`;
  },

  partitionConst: (cfg) => {
    if (cfg.partition_result === 'optional' || !(cfg.partition_key || cfg.cumulative_partition_key)) return '';
    return `static_assert(std::numeric_limits<${cfg.key_type}>::is_specialized, "Use optional partitions for keys without numeric_limits");\nconst ${cfg.key_type} partition_none = std::numeric_limits<${cfg.key_type}>::max();\n\n`;
  },

  valueStruct: (cfg) => {
    if (!cfg.enable_value) return "";
    let out = '';
    if (cfg.comments) out += '// You can implement your own monoid here for custom operations.\n';
    out += 'struct Value {\n';
    if (cfg.range_sum || cfg.treap_beats) out += '    long long sum;\n';
    if (cfg.range_max && !cfg.treap_beats) out += `    ${valueType(cfg)} mx;\n`;
    if (cfg.range_min && !cfg.treap_beats) out += `    ${valueType(cfg)} mn;\n`;
    if (cfg.key_sum) out += `    ${cfg.key_type === 'T' ? 'T' : 'long long'} ksum;\n`;
    if (cfg.treap_beats && cfg.beats_chmin) out += '    long long mx, mxcnt, mx2;\n';
    if (cfg.treap_beats && cfg.beats_chmax) out += '    long long mn, mncnt, mn2;\n';
    out += '\n';
    // Value::make for beats
    if (cfg.treap_beats) {
      const args: string[] = ['x * len'];
      if (cfg.key_sum) args.push('0');
      if (cfg.beats_chmin) args.push('x', 'len', 'std::numeric_limits<long long>::lowest()');
      if (cfg.beats_chmax) args.push('x', 'len', 'std::numeric_limits<long long>::max()');
      out += '    static Value make(long long x, long long len = 1) {\n';
      out += `        return {${args.join(', ')}};\n`;
      out += '    }\n\n';
    } else {
      const args: string[] = [];
      if (cfg.range_sum) args.push('1LL * x * len');
      if (cfg.range_max) args.push('x');
      if (cfg.range_min) args.push('x');
      if (cfg.key_sum) args.push('0');
      out += `    static Value make(${valueType(cfg)} x, long long len = 1) {\n`;
      out += `        return {${args.join(', ')}};\n`;
      out += '    }\n\n';
    }
    // can_break and can_tag for beats
    if (cfg.treap_beats) {
      const breakArgs: string[] = [];
      const tagArgs: string[] = [];
      if (cfg.beats_chmin) {
        breakArgs.push('lazy.mn >= mx');
        tagArgs.push(`(mxcnt == sz || (__int128)mx2${cfg.beats_add ? ' + lazy.add' : ''} < lazy.mn)`);
      }
      if (cfg.beats_chmax) {
        breakArgs.push('lazy.mx <= mn');
        tagArgs.push(`(mncnt == sz || (__int128)mn2${cfg.beats_add ? ' + lazy.add' : ''} > lazy.mx)`);
      }
      if (cfg.beats_add) breakArgs.push('lazy.add == 0');
      if (cfg.range_reverse_key || cfg.range_reverse_index) breakArgs.push('!lazy.rev');
      if (cfg.key_add || cfg.key_set) breakArgs.push('lazy.kval == 0');
      if (cfg.key_set) breakArgs.push('lazy.kinc');
      out += '    bool can_break(const Lazy& lazy) const {\n';
      out += `        return ${breakArgs.join(' && ') || 'true'};\n`;
      out += '    }\n\n';
      out += '    bool can_tag(const Lazy& lazy, int sz) const {\n';
      out += `        return ${tagArgs.length ? tagArgs.join(' && ') : 'true'};\n`;
      out += '    }\n\n';
    }
    if (cfg.lazy_prop) {
      out += `    void upd(Lazy lazy${cfg.size_option ? ', int sz' : ''});\n`;
      if (cfg.range_agg) out += '\n';
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
    const identity: string[] = [];
    if (cfg.range_reverse_key || cfg.range_reverse_index) identity.push('!rev');
    if (cfg.range_add || cfg.range_set) identity.push('val == 0');
    if (cfg.range_set) identity.push('inc');
    if (cfg.key_add || cfg.key_set) identity.push('kval == 0');
    if (cfg.key_set) identity.push('kinc');
    if (cfg.treap_beats && cfg.beats_chmin) identity.push('mn == std::numeric_limits<long long>::max()');
    if (cfg.treap_beats && cfg.beats_chmax) identity.push('mx == std::numeric_limits<long long>::lowest()');
    if (cfg.treap_beats && cfg.beats_add) identity.push('add == 0');
    out += `    bool empty() const { return ${identity.join(' && ') || 'true'}; }\n\n`;
    if (cfg.treap_beats && cfg.beats_add && (cfg.beats_chmin || cfg.beats_chmax)) {
      out += '    static long long shifted(long long x, long long d) {\n';
      out += '        return std::clamp<__int128>((__int128)x + d, std::numeric_limits<long long>::lowest(), std::numeric_limits<long long>::max());\n';
      out += '    }\n\n';
    }
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
    if (cfg.treap_beats && cfg.beats_add) {
      if (cfg.beats_chmin) out += '        if (mn != std::numeric_limits<long long>::max()) mn = shifted(mn, oth.add);\n';
      if (cfg.beats_chmax) out += '        if (mx != std::numeric_limits<long long>::lowest()) mx = shifted(mx, oth.add);\n';
      out += '        add += oth.add;\n';
    }
    if (cfg.treap_beats && cfg.beats_chmin && cfg.beats_chmax) {
      out += '        mn = std::clamp(mn, oth.mx, oth.mn);\n';
      out += '        mx = std::clamp(mx, oth.mx, oth.mn);\n';
    } else {
      if (cfg.treap_beats && cfg.beats_chmin) out += '        mn = std::min(mn, oth.mn);\n';
      if (cfg.treap_beats && cfg.beats_chmax) out += '        mx = std::max(mx, oth.mx);\n';
    }
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
    out += 'std::mt19937 mt(std::chrono::high_resolution_clock::now().time_since_epoch().count());\n\n';
    out += "struct Node {\n";
    if (cfg.array_storage) {
      out += '    static void *operator new(std::size_t);\n';
      out += '    static void operator delete(void*) {}\n\n';
    }
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
    if (!usesSizeBiasedMerge(cfg)) intNames.push("pri");
    out += `    int ${intNames.join(", ")};\n`;

    // Pointers
    const ptrNames: string[] = ["l", "r"];
    if (cfg.par_option && !usesStrongPtr(cfg)) ptrNames.push("par");
    out += `    ptr ${ptrNames.join(", ")};\n`;
    if (cfg.par_option && usesStrongPtr(cfg)) out += '    strong_ptr par;\n';
    out += '\n';

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
        params.push('Value val = Value::make(0)');
        inits.push('val(val)');
      }
      if (cfg.range_agg) inits.push('agg(val)');
      const paramStr = params.join(', ');
      const initStr = inits.length ? ` : ${inits.join(', ')}` : '';
      out += `    Node(${paramStr})${initStr} {\n`;
      if (!usesSizeBiasedMerge(cfg)) out += '        pri = mt();\n';
      if (cfg.lazy_prop) out += '        lazy = lid;\n';
      if (cfg.size_option) out += '        sz = 1;\n';
      out += '        l = r = nullptr;\n';
      if (cfg.par_option) out += '        par = nullptr;\n';
      if (cfg.key_sum) out += '        this->val.ksum = agg.ksum = key;\n';
      out += '    }\n';
    } else {
      // No key and no value: simple default constructor (cannot delegate)
      out += '    Node() {\n';
      if (!usesSizeBiasedMerge(cfg)) out += '        pri = mt();\n';
      if (cfg.lazy_prop) out += '        lazy = lid;\n';
      if (cfg.size_option) out += '        sz = 1;\n';
      out += '        l = r = nullptr;\n';
      if (cfg.par_option) out += '        par = nullptr;\n';
      out += '    }\n';
    }

    if (cfg.array_storage || cfg.persistent) {
      out += "\n    ~Node() {}\n";
    } else {
      out += "\n    ~Node() {\n";
      out += `        delete l${usesAugmentedPtr(cfg) ? ".p" : ""};\n`;
      out += `        delete r${usesAugmentedPtr(cfg) ? ".p" : ""};\n`;
      out += "    }\n";
    }

    out += "};\n\n";
    if (cfg.array_storage) {
      out += `const int NODE_CAP = ${arrayStorageSize(cfg)};\n`;
      out += 'static_assert(NODE_CAP > 1);\n';
      out += 'alignas(Node) unsigned char nodes[NODE_CAP][sizeof(Node)];\n';
      out += 'int node_cnt = 0;\n\n';
      out += 'ptr::ptr(Node *n) : p(n ? int((reinterpret_cast<std::uintptr_t>(n) - reinterpret_cast<std::uintptr_t>(nodes)) / sizeof(Node)) : 0) {}\n';
      out += 'ptr &ptr::operator=(Node *n) { return *this = ptr(n); }\n';
      out += 'Node &ptr::operator*() const { return *get(); }\n';
      out += 'Node *ptr::operator->() const { return get(); }\n';
      out += 'Node *ptr::get() const { return p ? std::launder(reinterpret_cast<Node*>(nodes[p])) : nullptr; }\n';
      out += 'ptr::operator Node*() const { return get(); }\n\n';
      out += 'void *Node::operator new(std::size_t) {\n';
      out += '    if (node_cnt + 1 >= NODE_CAP) throw std::bad_alloc();\n';
      out += '    return nodes[++node_cnt];\n';
      out += '}\n\n';
    }
    if (usesAugmentedPtr(cfg)) {
      out += 'template <class... Args>\n';
      out += 'ptr ptr::make(Args&&... args) {\n';
      out += '    return ptr(new Node(std::forward<Args>(args)...));\n';
      out += '}\n\n';
    }
    return out;
  },

  persistentHelpers: (cfg) => {
    if (!cfg.persistent) return '';
    let s = '';
    if (cfg.array_storage) {
      s += 'int persist_depth = 0, version_start = 0;\n';
      s += 'struct PersistentScope {\n';
      s += '    PersistentScope() { if (persist_depth++ == 0) version_start = node_cnt; }\n';
      s += '    ~PersistentScope() { --persist_depth; }\n';
      s += '};\n\n';
      s += 'ptr cloned(ptr n) { return n ? ptr(new Node(*n)) : nullptr; }\n';
      s += 'ptr& clone(ptr& n) { if (n && n.p <= version_start) n = cloned(n); return n; }\n\n';
    } else {
      s += 'ptr cloned(ptr n) { return n ? new Node(*n) : nullptr; }\n';
      s += 'ptr& clone(ptr& n) { if (n) n = cloned(n); return n; }\n\n';
    }
    return s;
  },

  mergeFn: (cfg) => {
    if (!cfg.merge_option) return '';
    const h = helpers(cfg);
    let s = '';
    s += 'ptr merge(ptr l, ptr r) {\n';
    s += persistScope(cfg);
    if (cfg.par_option) s += '    if (l) l->par = nullptr;\n    if (r) r->par = nullptr;\n';
    s += '    if (!l || !r) return l ? l : r;\n';
    if (cfg.persistent) s += '    clone(l), clone(r);\n';
    if (cfg.push) s += '    push(l), push(r);\n';
    if (usesSizeBiasedMerge(cfg)) {
      s += '    if (std::uniform_int_distribution<int>(1, sz(l) + sz(r))(mt) <= sz(l))\n';
      s += `        return l->r = merge(l->r, r), ${h.pull('l')};\n`;
      s += `    else\n        return r->l = merge(l, r->l), ${h.pull('r')};\n`;
    } else {
      s += `    if (l->pri > r->pri)\n        return l->r = merge(l->r, r), ${h.pull('l')};\n`;
      s += `    else\n        return r->l = merge(l, r->l), ${h.pull('r')};\n`;
    }
    s += '}\n\n';
    return s;
  },

  safeMergeFn: (cfg) => {
    if (!cfg.safe_merge_option) return '';
    let s = '';
    s += `ptr safe_merge(ptr &lhs, ptr &rhs) { ptr res = merge(lhs, rhs); lhs = rhs = nullptr; return res; }\n`;
    s += `ptr safe_merge(ptr &lhs, ptr &&rhs) { ptr res = merge(lhs, rhs); lhs = nullptr; return res; }\n`;
    s += `ptr safe_merge(ptr &&lhs, ptr &rhs) { ptr res = merge(lhs, rhs); rhs = nullptr; return res; }\n`;
    s += `ptr safe_merge(ptr &&lhs, ptr &&rhs) { return merge(lhs, rhs); }\n`;
    return s;
  },

  splitFn: (cfg) => {
    if (!cfg.split_option) return '';
    const h = helpers(cfg);
    let s = '';
    if (cfg.comments) s += '// (-inf, k) and [k, inf)\n';
    s += `void split(ptr n, ${cfg.key_type} k, ptr &l, ptr &r, bool inclusive = false) {\n`;
    s += persistScope(cfg);
    s += '    if (!n) { l = r = nullptr; return; }\n';
    if (cfg.persistent) s += '    clone(n);\n';
    if (cfg.push) s += '    push(n);\n';
    s += `    if (n->key < k || (inclusive && !(k < n->key))) split(n->r, k, n->r, r, inclusive), ${h.pull('l = n')};\n`;
    s += `    else split(n->l, k, l, n->l, inclusive), ${h.pull('r = n')};\n`;
    if (cfg.par_option) s += '    if (l) l->par = nullptr;\n    if (r) r->par = nullptr;\n';
    s += '}\n\n';
    s += `std::pair<ptr, ptr> split(ptr n, ${cfg.key_type} k) { ptr l, r; split(n, k, l, r); return {l, r}; }\n`;
    s += `std::pair<ptr, ptr> split_le(ptr n, ${cfg.key_type} k) { ptr l, r; split(n, k, l, r, true); return {l, r}; }\n\n`;
    return s;
  },

  pushFn: (cfg) => {
    if (!cfg.lazy_prop) return '';
    let s = `void apply(ptr${cfg.persistent ? '&' : ''} n, Lazy lazy) {\n`;
    s += '    if (!n || lazy.empty()) return;\n';
    s += persistScope(cfg);
    if (cfg.persistent) s += '    clone(n);\n';
    if (cfg.key_add || cfg.key_set) {
      if (cfg.key_set) s += '    if (!lazy.kinc) n->key = {};\n';
      s += '    n->key += lazy.kval;\n';
    }
    if (cfg.enable_value) s += `    n->val.upd(lazy${cfg.size_option ? ', 1' : ''});\n`;
    if (cfg.range_agg) s += `    n->agg.upd(lazy${cfg.size_option ? ', sz(n)' : ''});\n`;
    if (cfg.range_reverse_key || cfg.range_reverse_index) s += '    if (lazy.rev) std::swap(n->l, n->r);\n';
    s += '    n->lazy += lazy;\n';
    s += '}\n\n';
    s += 'void push(ptr n) {\n';
    s += '    if (!n || n->lazy.empty()) return;\n';
    s += '    apply(n->l, n->lazy), apply(n->r, n->lazy);\n';
    s += '    n->lazy = lid;\n}\n\n';
    return s;
  },

  pullFn: (cfg) => {
    // Always useful, but can conditionally enrich for fields
    if (!cfg.pull) return '';
    let s = 'ptr pull(ptr n) {\n';
    s += '    if (!n) return nullptr;\n';

    if (cfg.size_option) s += '    n->sz = sz(n->l) + 1 + sz(n->r);\n';
    if (cfg.range_agg) s += '    n->agg = agg(n->l) + n->val + agg(n->r);\n';
    if (cfg.par_option) s += '    if (n->l) n->l->par = n;\n    if (n->r) n->r->par = n;\n';
    s += '    return n;\n}\n\n';
    return s;
  },

  threeSplit: (cfg) => {
    if (!cfg.three_split_option || !cfg.split_option) return '';
    const incExc = cfg.range_type === 'inc exc';
    let out = '';
    if (cfg.comments) out += `// cuts out [lo, hi${incExc ? ')' : ']'}\n`;
    out += `std::tuple<ptr, ptr, ptr> split(ptr n, ${cfg.key_type} lo, ${cfg.key_type} hi) {\n`;
    out += `    auto [lm, r] = ${upperSplit(cfg, 'n', 'hi')};\n`;
    out += '    auto [l, m] = split(lm, lo);\n';
    out += '    return {l, m, r};\n';
    out += '}\n\n';
    return out;
  },
  findFn: (cfg) => {
    if (!cfg.find_option) return '';
    let out  = '';
    out += `ptr find(ptr n, ${cfg.key_type} k) {\n`;
    out += '    if (!n) return nullptr;\n';
    if (cfg.persistent && cfg.push) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
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
    out += '    if (!n) return nullptr;\n';
    if (cfg.persistent && cfg.push) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
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
    out += persistScope(cfg);
    out += '    if (!n) { n = it; return; }\n';
    if (cfg.persistent) out += '    clone(n);\n';
    if (cfg.push) out += '    push(n);\n';
    if (usesSizeBiasedMerge(cfg)) {
      out += '    ptr l, r;\n';
      out += '    split(n, it->key, l, r);\n';
      out += '    n = merge(merge(l, it), r);\n';
    } else {
      out += '    if (n->pri < it->pri) split(n, it->key, it->l, it->r), n = it;\n';
      out += '    else if (it->key <= n->key) ins(n->l, it);\n';
      out += '    else ins(n->r, it);\n';
      if (cfg.pull) out += '    pull(n);\n';
    }
    out += '}\n\n';
    return out;
  },
  delFn: (cfg) => {
    if (!cfg.del_option) return '';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let out = '';
    if (cfg.comments) out += '// returns pointer to deleted node\n';
    out += `ptr del(ptr& n, ${ktype} k) {\n`;
    out += persistScope(cfg);
    out += '    if (!n) return nullptr;\n';
    if (cfg.persistent) out += '    clone(n);\n';
    if (cfg.push) out += '    push(n);\n';
    out += `    if (n->key == k) { ptr ret = n; n = merge(n->l, n->r); ret->l = ret->r = nullptr; ${cfg.par_option ? 'ret->par = nullptr; ' : ''}return ${helpers(cfg).pull('ret')}; }\n`;
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
    out += persistScope(cfg);
    out += '    if (!n) { n = it; return; }\n';
    if (cfg.persistent) out += '    clone(n);\n';
    if (cfg.push) out += '    push(n);\n';
    if (usesSizeBiasedMerge(cfg)) {
      out += '    ptr l, r;\n';
      out += '    spliti(n, i, l, r);\n';
      out += '    n = merge(merge(l, it), r);\n';
    } else {
      out += '    if (n->pri < it->pri) spliti(n, i, it->l, it->r), n = it;\n';
      out += '    else if (i <= sz(n->l)) insi(n->l, it, i);\n';
      out += '    else insi(n->r, it, i - 1 - sz(n->l));\n';
      out += '    pull(n);\n';
    }
    out += '}\n\n';
    return out;
  },
  deliFn: (cfg) => {
    if (!cfg.deli_option) return '';
    let out = '';
    if (cfg.comments) out += '// returns pointer to deleted node\n';
    out += 'ptr deli(ptr& n, int i) {\n';
    out += persistScope(cfg);
    out += '    if (!n) return nullptr;\n';
    if (cfg.persistent) out += '    clone(n);\n';
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += `    if (i == sz(n->l)) { ptr ret = n; n = merge(n->l, n->r); ret->l = ret->r = nullptr; ${cfg.par_option ? 'ret->par = nullptr; ' : ''}return pull(ret); }\n`;
    out += '    ptr ret = i <= sz(n->l) ? deli(n->l, i) : deli(n->r, i - 1 - sz(n->l));\n';
    out += '    pull(n);\n';
    out += '    return ret;\n';
    out += '}\n\n';
    return out;
  },
  minFn: (cfg) => cfg.min_option ? extremeFn(cfg, 'mn', 'l') : '',
  maxFn: (cfg) => cfg.max_option ? extremeFn(cfg, 'mx', 'r') : '',
  threeSplitIndex: (cfg) => {
    if (!cfg.three_spliti_option || !cfg.spliti_option) return '';
    const incExc = cfg.range_type === 'inc exc';
    let out = '';
    if (cfg.comments) out += `// cuts out [lo, hi${incExc ? ')' : ']'}\n`;
    out += 'std::tuple<ptr, ptr, ptr> spliti(ptr n, int lo, int hi) {\n';
    out += `    auto [lm, r] = spliti(n, ${upperIndex(cfg, 'n', 'hi')});\n`;
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
    out += persistScope(cfg);
    out += '    if (!n) { l = r = nullptr; return; }\n';
    if (cfg.persistent) out += '    clone(n);\n';
    if (cfg.push) out += '    push(n);\n';
    out += `    if (i <= sz(n->l)) spliti(n->l, i, l, n->l), ${h.pull('r = n')};\n`;
    out += `    else spliti(n->r, i - 1 - sz(n->l), n->r, r), ${h.pull('l = n')};\n`;
    if (cfg.par_option) out += '    if (l) l->par = nullptr;\n    if (r) r->par = nullptr;\n';
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
    out += `void modify(ptr${cfg.persistent ? '&' : ''} n, ${ktype} k, Op op) {\n`;
    out += persistScope(cfg);
    out += '    if (!n) return;\n';
    if (cfg.persistent) out += '    clone(n);\n';
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
    out += `void modifyi(ptr${cfg.persistent ? '&' : ''} n, int i, Op op) {\n`;
    out += persistScope(cfg);
    out += '    if (!n) return;\n';
    if (cfg.persistent) out += '    clone(n);\n';
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
    if (cfg.persistent && cfg.push) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
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
    if (cfg.persistent && cfg.push) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
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
    if (cfg.comments) out += `// finds the smallest key such that pred returns false (${partitionNone(cfg)} if none)\n`;
    out += 'template<typename Pred>\n';
    out += `${partitionType(cfg)} partition_key(ptr n, Pred pred) {\n`;
    out += `    if (!n) return ${partitionNone(cfg)};\n`;
    if (cfg.persistent && cfg.lazy_prop) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (pred(n)) return partition_key(n->r, pred);\n';
    out += `    if (auto res = partition_key(n->l, pred); ${cfg.partition_result === 'optional' ? 'res.has_value()' : 'res != partition_none'}) return res;\n`;
    out += '    return n->key;\n';
    out += '}\n\n';
    return out;
  },
  partitionIndex: (cfg) => {
    if (!cfg.partition_index) return '';
    let out = '';
    if (cfg.comments) out += '// find smallest index such that pred returns false\n';
    out += 'template<typename Pred>\nint partition_index(ptr n, Pred pred) {\n';
    out += '    if (!n) return 0;\n';
    if (cfg.persistent && cfg.lazy_prop) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
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
      out += `// find the key of the first prefix aggregate that makes the predicate false (${partitionNone(cfg)} if always true)\n`;
      out += '// eg. find the smallest prefix that has sum > x\n';
    }
    out += 'template <typename Pred>\n';
    out += `${partitionType(cfg)} cumulative_partition_key(ptr n, Pred pred, Value acc = vid) {\n`;
    out += `    if (!n) return ${partitionNone(cfg)};\n`;
    if (cfg.persistent && cfg.lazy_prop) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
    if (cfg.lazy_prop) out += '    push(n);\n';
    out += '    if (!pred(acc + agg(n->l))) return n->l ? cumulative_partition_key(n->l, pred, acc) : n->key;\n';
    out += '    if (!pred(acc = acc + agg(n->l) + n->val)) return n->key;\n';
    out += '    return cumulative_partition_key(n->r, pred, acc);\n';
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
    if (cfg.persistent && cfg.lazy_prop) {
      out += persistScope(cfg);
      out += '    clone(n);\n';
    }
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
    out += persistScope(cfg);
    out += '    if (!l || !r) return l ? l : r;\n';
    out += '    if (mn(l)->key > mn(r)->key) std::swap(l, r);\n';
    out += '    ptr res = nullptr;\n';
    out += '    while (r) {\n';
    out += '        auto [lt, rt] = split_le(l, mn(r)->key);\n';
    out += '        res = merge(res, lt);\n';
    out += '        std::tie(l, r) = std::make_pair(r, rt);\n';
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
    out += persistScope(cfg);
    out += '    if (!l || !r) return l ? l : r;\n';
    if (cfg.persistent) out += '    clone(l), clone(r);\n';
    if (cfg.lazy_prop) out += '    push(l), push(r);\n';
    if (usesSizeBiasedMerge(cfg)) out += '    if (std::uniform_int_distribution<int>(1, sz(l) + sz(r))(mt) > sz(l)) std::swap(l, r);\n';
    else out += '    if (l->pri < r->pri) std::swap(l, r);\n';
    out += '    auto [lhs, rhs] = split(r, l->key);\n';
    out += '    l->l = unite_fast(l->l, lhs);\n';
    out += '    l->r = unite_fast(l->r, rhs);\n';
    out += `    return ${helpers(cfg).pull('l')};\n`;
    out += '}\n\n';
    return out;
  },
  heapifyFn: (cfg) => {
    if (!cfg.heapify_option) return '';
    let out = '';
    out += 'void heapify(ptr n) {\n';
    if (usesSizeBiasedMerge(cfg)) {
      out += '    (void)n;\n';
      out += '}\n\n';
      return out;
    }
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
    out += persistScope(cfg);
    out += '    if (r == -69) r = (int) ns.size() - 1;\n';
    out += '    if (l > r) return nullptr;\n';
    out += '    int m = l + (r - l) / 2;\n';
    out += '    ptr n = ns[m];\n';
    if (cfg.persistent) out += '    clone(n);\n';
    if (cfg.push) out += '    push(n);\n';
    if (cfg.par_option) out += '    n->par = nullptr;\n';
    out += '    n->l = build(ns, l, m - 1);\n';
    out += '    n->r = build(ns, m + 1, r);\n';
    out += '    heapify(n);\n';
    out += `    return ${helpers(cfg).pull('n')};\n`;
    out += '}\n\n';
    return out;
  },
  tourFn: (cfg) => {
    if (!cfg.tour_option) return '';
    let out = '';
    out += 'template <typename Op>\nvoid tour(ptr n, Op op) {\n';
    out += persistScope(cfg);
    out += '    std::stack<ptr> stk;\n';
    out += '    while (n || !stk.empty()) {\n';
    out += '        for (; n; n = n->l) ';
    if (cfg.persistent) out += 'clone(n), ';
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
    out += '    if (!n) return nullptr;\n';
    if (cfg.push) out += '    clean(n);\n';
    out += `    if (n->r) { n = n->r; ${cfg.push ? 'push(n); ' : ''}while (n->l) { n = n->l; ${cfg.push ? 'push(n); ' : ''}} }\n`;
    out += '    else { while (n->par && n->par->r == n) n = n->par; n = n->par; }\n';
    out += '    return n;\n';
    out += '}\n\n';
    return out;
  },
  predFn: (cfg) => {
    if (!cfg.pred) return '';
    let out = '';
    out += 'ptr pred(ptr n) {\n';
    out += '    if (!n) return nullptr;\n';
    if (cfg.push) out += '    clean(n);\n';
    out += `    if (n->l) { n = n->l; ${cfg.push ? 'push(n); ' : ''}while (n->r) { n = n->r; ${cfg.push ? 'push(n); ' : ''}} }\n`;
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
    s += persistScope(cfg);
    s += `    auto [lm, r] = ${upperSplit(cfg, 'n', 'hi')};\n`;
    s += '    auto [l, m] = split(lm, lo);\n';
    s += '    Lazy upd = lid;\n';
    s += '    upd.rev = true;\n';
    s += '    apply(m, upd);\n';
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
    s += persistScope(cfg);
    s += `    auto [lm, r] = spliti(n, ${upperIndex(cfg, 'n', 'hi')});\n`;
    s += '    auto [l, m] = spliti(lm, lo);\n';
    s += '    Lazy upd = lid;\n';
    s += '    upd.rev = true;\n';
    s += '    apply(m, upd);\n';
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
      s += persistScope(cfg);
      s += `    auto [lm, r] = ${upperSplit(cfg, 'n', 'hi')};\n`;
      s += '    auto [l, m] = split(lm, lo);\n';
      s += `    updi(m, 0, sz(m)${incExc ? '' : ' - 1'}, lazy);\n`;
      s += '    n = merge(l, merge(m, r));\n';
      s += '}\n\n';
      return s;
    } else {
      let s = '';
      s += `void upd(ptr& n, ${ktype} lo, ${ktype} hi, Lazy lazy) {\n`;
      s += persistScope(cfg);
      s += `    auto [lm, r] = ${upperSplit(cfg, 'n', 'hi')};\n`;
      s += '    auto [l, m] = split(lm, lo);\n';
      s += '    apply(m, lazy);\n';
      s += '    n = merge(l, merge(m, r));\n';
      s += '}\n\n';
      return s;
    }
  },
  rangeUpdateIndexFn: (cfg) => {
    if (!cfg.range_update_index) return '';
    const incExc = cfg.range_type === 'inc exc';
    const fn = incExc ? 'updi' : 'updi_impl';
    let s = '';
    s += `void ${fn}(ptr${cfg.persistent ? '&' : ''} n, int lo, int hi, Lazy lazy) {\n`;
    s += persistScope(cfg);
    s += '    lo = std::max(lo, 0), hi = std::min(hi, sz(n));\n';
    s += '    if (!n || lo >= hi || lazy.empty()) return;\n';
    if (cfg.range_reverse_key || cfg.range_reverse_index) s += '    if (lazy.rev) throw std::invalid_argument("Use reverse/reversei for range reversal");\n';
    if (cfg.treap_beats) s += '    if (n->agg.can_break(lazy)) return;\n';
    if (cfg.persistent) s += '    clone(n);\n';
    if (cfg.push) s += '    push(n);\n';
    s += `    if (lo == 0 && n->sz == hi${cfg.treap_beats ? ' && n->agg.can_tag(lazy, sz(n))' : ''}) {\n`;
    s += '        apply(n, lazy);\n';
    s += '        return;\n';
    s += '    }\n';
    if (cfg.enable_value || cfg.key_add || cfg.key_set) {
      s += '    if (lo <= sz(n->l) && sz(n->l) < hi) {\n';
      if (cfg.enable_value) s += `        n->val.upd(lazy${cfg.size_option ? ', 1' : ''});\n`;
      if (cfg.key_set) s += '        if (!lazy.kinc) n->key = {};\n';
      if (cfg.key_add || cfg.key_set) s += '        n->key += lazy.kval;\n';
      s += '    }\n';
    }
    s += `    ${fn}(n->l, lo, hi, lazy);\n`;
    s += `    ${fn}(n->r, lo - 1 - sz(n->l), hi - 1 - sz(n->l), lazy);\n`;
    s += '    pull(n);\n';
    s += '}\n\n';
    if (!incExc) {
      s += `void updi(ptr${cfg.persistent ? '&' : ''} n, int lo, int hi, Lazy lazy) {\n`;
      s += persistScope(cfg);
      s += `    updi_impl(n, lo, ${upperIndex(cfg, 'n', 'hi')}, lazy);\n`;
      s += '}\n\n';
    }
    return s;
  },
  rangeQueryKeyFn: (cfg) => {
    if (!cfg.range_query_key) return '';
    const incExc = cfg.range_type === 'inc exc';
    const ktype = cfg.key_type && cfg.key_type !== 'none' ? cfg.key_type : 'int';
    let s = '';
    s += `Value query(ptr& n, ${ktype} lo, ${ktype} hi) {\n`;
    s += persistScope(cfg);
    s += `    auto [lm, r] = ${upperSplit(cfg, 'n', 'hi')};\n`;
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
    const fn = incExc ? 'queryi' : 'queryi_impl';
    let s = '';
    s += `Value ${fn}(ptr n, int lo, int hi) {\n`;
    if (cfg.persistent && cfg.push) s += persistScope(cfg);
    s += '    lo = std::max(lo, 0), hi = std::min(hi, sz(n));\n';
    s += '    if (!n || lo >= hi) return vid;\n';
    if (cfg.persistent && cfg.push) s += '    clone(n);\n';
    if (cfg.push) s += '    push(n);\n';
    s += '    if (lo <= 0 && sz(n) <= hi) return n->agg;\n';
    s += `    return ${fn}(n->l, lo, hi) + (lo <= sz(n->l) && sz(n->l) < hi ? n->val : vid) + ${fn}(n->r, lo - 1 - sz(n->l), hi - 1 - sz(n->l));\n`;
    s += '}\n\n';
    if (!incExc) {
      s += 'Value queryi(ptr n, int lo, int hi) {\n';
      if (cfg.persistent && cfg.push) s += persistScope(cfg);
      s += `    return queryi_impl(n, lo, ${upperIndex(cfg, 'n', 'hi')});\n`;
      s += '}\n\n';
    }
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
    const valId: string[] = [];
    if (cfg.range_sum || cfg.treap_beats) valId.push('0');
    if (cfg.range_max) valId.push(`std::numeric_limits<${valueType(cfg)}>::lowest()`);
    if (cfg.range_min) valId.push(`std::numeric_limits<${valueType(cfg)}>::max()`);
    if (cfg.key_sum) valId.push('0');
    if (cfg.treap_beats) {
      if (cfg.beats_chmin) valId.push('std::numeric_limits<long long>::lowest()', '0', 'std::numeric_limits<long long>::lowest()');
      if (cfg.beats_chmax) valId.push('std::numeric_limits<long long>::max()', '0', 'std::numeric_limits<long long>::max()');
    }
    if (valId.length === 0) return 'const Value vid = {};\n\n';
    return `const Value vid = {${valId.join(', ')}};\n\n`;
  },
  lidConst: (cfg) => {
    if (!cfg.lazy_prop) return '';
    const lazyId: string[] = [];
    if (cfg.range_reverse_key || cfg.range_reverse_index) lazyId.push('false');
    if (cfg.range_add || cfg.range_set) lazyId.push('0');
    if (cfg.range_set) lazyId.push('true');
    if (cfg.key_add || cfg.key_set) lazyId.push('0');
    if (cfg.key_set) lazyId.push('true');
    if (cfg.treap_beats && cfg.beats_chmin) lazyId.push('std::numeric_limits<long long>::max()');
    if (cfg.treap_beats && cfg.beats_chmax) lazyId.push('std::numeric_limits<long long>::lowest()');
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
      if (cfg.beats_add) {
        s += '    sum += lazy.add * sz;\n';
        if (cfg.beats_chmin) s += '    mx += lazy.add; if (mxcnt < sz) mx2 += lazy.add;\n';
        if (cfg.beats_chmax) s += '    mn += lazy.add; if (mncnt < sz) mn2 += lazy.add;\n';
      }
      if (cfg.beats_chmin) {
        s += '    if (lazy.mn < mx) {\n';
        if (cfg.beats_chmax) {
          s += '        if (mn == mx) mn = lazy.mn;\n';
          s += '        else if (mn2 == mx) mn2 = lazy.mn;\n';
        }
        s += '        sum = (__int128)sum + ((__int128)lazy.mn - mx) * mxcnt;\n';
        s += '        mx = lazy.mn;\n';
        s += '    }\n';
      }
      if (cfg.beats_chmax) {
        s += '    if (lazy.mx > mn) {\n';
        if (cfg.beats_chmin) {
          s += '        if (mx == mn) mx = lazy.mx;\n';
          s += '        else if (mx2 == mn) mx2 = lazy.mx;\n';
        }
        s += '        sum = (__int128)sum + ((__int128)lazy.mx - mn) * mncnt;\n';
        s += '        mn = lazy.mx;\n';
        s += '    }\n';
      }
    } else {
      // Non-beats logic
      if (cfg.range_set) {
        if (cfg.range_sum) s += '    if (!lazy.inc) sum = 0;\n';
        if (cfg.range_max) s += '    if (!lazy.inc) mx = 0;\n';
        if (cfg.range_min) s += '    if (!lazy.inc) mn = 0;\n';

      }
      if (cfg.range_add || cfg.range_set) {
        if (cfg.range_sum) s += `    sum += lazy.val${cfg.size_option ? ' * sz' : ''};\n`;
        if (cfg.range_max) s += '    mx += lazy.val;\n';
        if (cfg.range_min) s += '    mn += lazy.val;\n';
      }
    }
    if (cfg.key_sum && cfg.key_set) s += '    if (!lazy.kinc) ksum = 0;\n';
    if (cfg.key_sum && (cfg.key_add || cfg.key_set)) s += `    ksum += lazy.kval${cfg.key_type === 'T' ? '' : ' * 1LL'} * sz;\n`;
    s += '}\n\n';
    return s;
  },
  // n-ary merge (variadic)
  nMergeFn: (cfg) => {
    if (!cfg.n_merge_option) return '';
    let s = '';
    s += 'ptr merge() { return nullptr; }\n';
    s += 'ptr merge(ptr n) { return n; }\n\n';
    s += 'template<typename... Args>\n';
    s += 'ptr merge(ptr l, ptr r, ptr next, Args... args) {\n';
    s += '    return merge(l, merge(r, next, args...));\n';
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
    s += persistScope(cfg);
    s += '    auto [lm, r] = split_le(n, k);\n';
    s += '    auto [l, m] = split(lm, k);\n';
    s += '    n = merge(l, r);\n';
    s += '    return m;\n';
    s += '}\n\n';
    return s;
  },
  // rotate by index
  rotateFn: (cfg) => {
    if (!cfg.rot_option) return '';
    let s = '';
    if (cfg.comments) s += '// rotates treap such that index i is at the start\n';
    s += 'void rotate(ptr& n, int i) {\n';
    s += persistScope(cfg);
    s += '    auto [l, r] = spliti(n, i);\n';
    s += '    n = merge(r, l);\n';
    s += '}\n\n';
    return s;
  },
  // clean up to root (flush lazy)
  cleanFn: (cfg) => {
    if (!cfg.clean_option && !(cfg.lazy_prop && (cfg.succ || cfg.pred || cfg.order_option))) return '';
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
    s += 'int _order(ptr n, ptr from) {\n';
    s += '    if (!n) return -1;\n';
    s += '    int res = _order(n->par, n);\n';
    s += '    if (from == n->r || !from) res += sz(n->l) + 1;\n';
    s += '    return res;\n';
    s += '}\n\n';
    s += `int order(ptr n) { ${cfg.push ? 'clean(n); ' : ''}return _order(n, nullptr); }\n\n`;
    return s;
  },
  // root of a node via parent pointers
  rootFn: (cfg) => {
    if (!cfg.root_option) return '';
    let s = '';
    s += 'ptr root(ptr n) {\n';
    s += '    if (!n) return nullptr;\n';
    s += '    while (n->par) n = n->par;\n';
    s += '    return n;\n';
    s += '}\n\n';
    return s;
  }
};

// Unified, stable total order (no duplicates) for all blocks
const ORDER = [
  'intro', 'comment',
  'forwardDecls', 'ptrType', 'strongPtrType', 'partitionConst',
  'lazyStruct', 'valueStruct',
  'vidConst', 'lidConst', 'beatsTagHelpers',
  'nodeStruct',
  'persistentHelpers',
  'valueUpd',
  'szFn', 'aggFn',
  'pushFn', 'pullFn', 'mergeFn', 'safeMergeFn', 'nMergeFn', 'splitFn',
  'threeSplit', 'splitiFn', 'threeSplitIndex', 'findFn', 'findiFn', 'insFn', 'delFn', 'delAllFn', 'insiFn', 'deliFn', 'minFn', 'maxFn',
  'subscriptFn', 'modFn','modIndexFn', 'rotateFn',
  'cleanFn', 'succFn','predFn', 'orderFn', 'rootFn',
  'lowerBound', 'upperBound', 'partitionKey','partitionIndex','cumulativePartitionKey','cumulativePartitionIndex',
  'uniteFn','uniteFastFn','heapifyFn','buildFn','tourFn',
  'rangeReverseKeyFn','rangeReverseIndexFn','rangeUpdateIndexFn','rangeUpdateKeyFn','rangeQueryKeyFn','rangeQueryIndexFn'
];

export function generateTreapCode(cfg: TreapConfig): string {
  cfg = normalizeConfig(cfg);
  let code = '';
  ORDER.forEach(block => { if (fragments[block]) code += fragments[block](cfg); });
  code += generateWrapper(cfg);
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
    code += `    ${cfg.use_namespace_std ? '' : 'std::'}cin.tie(0)->sync_with_stdio(0);\n`;
    code += '    \n';
    code += '}\n';
  }
  if (cfg.signature) {
    code = '// generated at caterpillow.github.io/byot\n\n' + code;
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
