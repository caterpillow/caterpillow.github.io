// BYOT modular code generator: readable, easy blocks
import { features } from './features';

export type TreapConfig = Record<string, boolean|string>;

// Each code fragment takes the current config and outputs C++ code for that block
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
};

// Output in logical order for easy reading/extension
const ORDER = [
  'intro', 'comment', 'valueStruct', 'lazyStruct', 'nodeStruct',
  'pushFn', 'pullFn', 'mergeFn', 'splitFn',
];

export function generateTreapCode(cfg: TreapConfig): string {
  let code = '';
  ORDER.forEach(block => { code += fragments[block](cfg); });
  return code.trim() || '// Enable some features to generate code.';
}
