import type { TreapConfig } from './treapConfig';

export function generateWrapper(cfg: TreapConfig): string {
  const kind = cfg.wrapper_type;
  if (!kind || kind === 'none') return '';
  const names: Record<string, string> = { set: 'TreapSet', multiset: 'TreapMultiset', map: 'TreapMap', dynamic_array: 'DynamicArray' };
  const name = names[String(kind)];
  if (!name) throw new Error(`Unknown wrapper type: ${kind}`);
  const array = kind === 'dynamic_array';
  const map = kind === 'map';
  const multi = kind === 'multiset';
  const numeric = array || map;
  const key = String(cfg.key_type);
  const scalar = cfg.val_type === 'int' ? 'int' : 'long long';
  const index = array ? 'int' : key;
  const root = 'data_.root';
  const lookup = array ? 'at_index' : 'lookup';
  const scalarName = map ? 'mapped_type' : 'value_type';
  const rangeUpdate = array ? cfg.range_update_index : cfg.range_update_key;
  const rangeQuery = array ? cfg.range_query_index : cfg.range_query_key;
  let code = 'namespace wrapper_ops {\n';
  code += 'int size(ptr n) { return sz(n); }\n';
  code += 'ptr first(ptr n) { return mn(n); }\n';
  code += 'ptr next(ptr n) { return succ(n); }\n';
  code += 'ptr at_index(ptr n, int i) { return findi(n, i); }\n';
  code += 'ptr join(ptr l, ptr r) { return merge(l, r); }\n';
  code += `void divide(ptr& n, ${index} cut, ptr& right) { auto parts = ${array ? 'spliti' : 'split'}(n, cut); n = parts.first; right = parts.second; }\n`;
  if (!array) {
    code += 'ptr last(ptr n) { return mx(n); }\n';
    code += `ptr lookup(ptr n, ${key} key) { return find(n, key); }\n`;
    code += 'void insert_key(ptr& n, ptr it) { ins(n, it); }\n';
    code += `ptr remove_key(ptr& n, ${key} key) { return del(n, key); }\n`;
    code += `ptr remove_all(ptr& n, ${key} key) { return del_all(n, key); }\n`;
    code += `ptr lower(ptr n, ${key} key) { return lower_bound(n, key); }\n`;
    code += `ptr upper(ptr n, ${key} key) { return upper_bound(n, key); }\n`;
    code += `int rank(ptr n, ${key} key, bool inclusive = false) {\n    int result = 0;\n    while (n) {\n`;
    if (cfg.push) code += '        push(n);\n';
    code += '        if (n->key < key || (inclusive && !(key < n->key))) result += sz(n->l) + 1, n = n->r;\n        else n = n->l;\n    }\n    return result;\n}\n';
  } else {
    code += 'void insert_index(ptr& n, ptr it, int i) { insi(n, it, i); }\n';
    code += 'ptr remove_index(ptr& n, int i) { return deli(n, i); }\n';
    if (cfg.range_reverse_index) code += 'void reverse_range(ptr& n, int l, int r) { reversei(n, l, r); }\n';
    if (cfg.rot_option) code += 'void rotate_to(ptr& n, int i) { rotate(n, i); }\n';
  }
  if (numeric) {
    code += `void write(ptr& n, ${index} at, ${scalar} value) {\n    ${array ? 'modifyi' : 'modify'}(n, at, [&](ptr it) {\n        it->val = Value::make(value);\n`;
    if (cfg.key_sum) code += '        it->val.ksum = it->key;\n';
    code += '    });\n}\n';
  }
  if (cfg.range_agg) code += 'Value aggregate(ptr n) { return agg(n); }\n';
  if (rangeQuery) code += `Value query_range(ptr& n, ${index} l, ${index} r) { return ${array ? 'queryi' : 'query'}(n, l, r); }\n`;
  if (numeric && rangeUpdate) {
    code += `void change_range(ptr& n, ${index} l, ${index} r, Lazy tag) {\n`;
    if (!array) {
      if (cfg.key_add || cfg.key_set) code += `    if (tag.kval != decltype(tag.kval){}) throw std::invalid_argument("Ordered wrappers cannot change keys");\n`;
      if (cfg.key_set) code += '    if (!tag.kinc) throw std::invalid_argument("Ordered wrappers cannot change keys");\n';
      if (cfg.range_reverse_key || cfg.range_reverse_index) code += '    if (tag.rev) throw std::invalid_argument("Ordered wrappers cannot reverse keys");\n';
    }
    code += `    ${array ? 'updi' : 'upd'}(n, l, r, tag);\n}\n`;
  }
  code += '}\n\n';
  code += `class ${name} {\n    struct Storage {\n        ptr root = nullptr;\n        ~Storage() { delete root.get(); }\n    } data_;\n`;
  if (numeric) {
    code += `    ${scalar} read(${index} at) const {\n        ptr n = wrapper_ops::${lookup}(${root}, at);\n        if (!n) throw std::out_of_range("${name}::at");\n        return static_cast<${scalar}>(n->val.sum);\n    }\n`;
  }
  code += 'public:\n';
  if (!array) code += `    using key_type = ${key};\n`;
  if (map) code += `    using mapped_type = ${scalar};\n`;
  code += `    using value_type = ${map ? 'std::pair<key_type, mapped_type>' : array ? scalar : 'key_type'};\n\n`;
  code += `    ${name}() = default;\n    ${name}(const ${name}&) = delete;\n    ${name}& operator=(const ${name}&) = delete;\n`;
  code += `    ${name}(${name}&& other) noexcept { ${root} = std::exchange(other.${root}, nullptr); }\n`;
  code += `    ${name}& operator=(${name}&& other) noexcept {\n        if (this != &other) { clear(); ${root} = std::exchange(other.${root}, nullptr); }\n        return *this;\n    }\n`;
  code += `    ${name}(std::initializer_list<value_type> values) {\n        for (const auto& value : values) ${array ? 'push_back(value)' : map ? 'insert(value.first, value.second)' : 'insert(value)'};\n    }\n`;
  code += `    int size() const { return wrapper_ops::size(${root}); }\n    bool empty() const { return !${root}; }\n`;
  code += `    void clear() { delete std::exchange(${root}, nullptr).get(); }\n`;
  code += `    void swap(${name}& other) noexcept { ${root} = std::exchange(other.${root}, ${root}); }\n\n`;
  code += `    // Keep ${array ? '[0, cut); return [cut, size())' : 'keys < cut; return keys >= cut'} by transferring ownership without copying nodes.\n`;
  code += `    ${name} split(${index} cut) {\n`;
  if (array) code += '        if (cut < 0 || cut > size()) throw std::out_of_range("DynamicArray::split");\n';
  code += `        ${name} right;\n        wrapper_ops::divide(${root}, cut, right.${root});\n        return right;\n    }\n`;
  code += `    // Append rhs and empty it; ${array ? 'no node copies' : `require max(*this) ${multi ? '<=' : '<'} min(rhs)`}; self-merge is invalid.\n`;
  code += `    ${name}& merge(${name}& rhs) {\n        if (this == &rhs) throw std::invalid_argument("Cannot merge a container into itself");\n`;
  if (!array) {
    const last = `wrapper_ops::last(${root})->key`, first = `wrapper_ops::first(rhs.${root})->key`;
    code += `        if (!empty() && !rhs.empty() && ${multi ? `(${first} < ${last})` : `!(${last} < ${first})`})\n`;
    code += '            throw std::invalid_argument("merge requires ordered, separated key ranges");\n';
  }
  code += `        ${root} = wrapper_ops::join(${root}, rhs.${root});\n        rhs.${root} = nullptr;\n        return *this;\n    }\n`;
  code += '    // Append a temporary/moved rhs using the same ordering and ownership rules.\n';
  code += `    ${name}& merge(${name}&& rhs) { return merge(rhs); }\n\n`;
  code += '    class const_iterator {\n        ptr n;\n    public:\n';
  code += `        using value_type = ${name}::value_type;\n        using difference_type = std::ptrdiff_t;\n`;
  code += `        using iterator_category = std::${numeric ? 'input' : 'forward'}_iterator_tag;\n`;
  code += `        using reference = ${numeric ? 'value_type' : 'const value_type&'};\n`;
  if (numeric) code += '        struct pointer { value_type value; const value_type* operator->() const { return &value; } };\n';
  else code += '        using pointer = const value_type*;\n';
  code += '        const_iterator(ptr n = nullptr) : n(n) {}\n';
  code += `        reference operator*() const { return ${map ? `{n->key, static_cast<${scalar}>(n->val.sum)}` : array ? `static_cast<${scalar}>(n->val.sum)` : 'n->key'}; }\n`;
  code += `        pointer operator->() const { return ${numeric ? '{**this}' : '&n->key'}; }\n`;
  code += '        const_iterator& operator++() { n = wrapper_ops::next(n); return *this; }\n';
  code += '        const_iterator operator++(int) { auto old = *this; ++*this; return old; }\n';
  code += '        bool operator==(const_iterator other) const { return n == other.n; }\n        bool operator!=(const_iterator other) const { return n != other.n; }\n    };\n';
  code += '    using iterator = const_iterator;\n';
  code += `    iterator begin() const { return wrapper_ops::first(${root}); }\n    iterator end() const { return {}; }\n`;
  code += `    iterator kth(int i) const { return wrapper_ops::at_index(${root}, i); }\n\n`;
  if (numeric) {
    code += `    class reference {\n        ${name}* owner;\n        ${index} at;\n    public:\n`;
    code += `        reference(${name}& owner, ${index} at) : owner(&owner), at(at) {}\n`;
    code += `        operator ${scalarName}() const { return owner->read(at); }\n`;
    code += `        reference& operator=(${scalarName} value) { owner->set(at, value); return *this; }\n`;
    code += `        reference& operator=(const reference& other) { return *this = static_cast<${scalarName}>(other); }\n`;
    code += `        reference& operator+=(${scalarName} value) { return *this = static_cast<${scalarName}>(*this) + value; }\n`;
    code += `        reference& operator-=(${scalarName} value) { return *this = static_cast<${scalarName}>(*this) - value; }\n`;
    code += `        reference& operator++() { return *this += 1; }\n        ${scalarName} operator++(int) { ${scalarName} old = *this; ++*this; return old; }\n`;
    code += `        reference& operator--() { return *this -= 1; }\n        ${scalarName} operator--(int) { ${scalarName} old = *this; --*this; return old; }\n    };\n`;
    code += `    reference at(${index} i) { (void)read(i); return {*this, i}; }\n    ${scalarName} at(${index} i) const { return read(i); }\n`;
    code += `    void set(${index} i, ${scalarName} value) { (void)read(i); wrapper_ops::write(${root}, i, value); }\n`;
  }
  if (!array) {
    code += `    iterator find(key_type key) const { return wrapper_ops::lookup(${root}, key); }\n`;
    code += `    bool contains(key_type key) const { return bool(wrapper_ops::lookup(${root}, key)); }\n`;
    code += `    int count(key_type key) const { return wrapper_ops::rank(${root}, key, true) - wrapper_ops::rank(${root}, key); }\n`;
    code += `    int order_of_key(key_type key) const { return wrapper_ops::rank(${root}, key); }\n`;
    code += `    iterator lower_bound(key_type key) const { return wrapper_ops::lower(${root}, key); }\n`;
    code += `    iterator upper_bound(key_type key) const { return wrapper_ops::upper(${root}, key); }\n`;
    code += `    ${multi ? 'iterator' : 'std::pair<iterator, bool>'} insert(key_type key${map ? ', mapped_type value = {}' : ''}) {\n`;
    if (!multi) code += `        if (ptr n = wrapper_ops::lookup(${root}, key)) return {iterator(n), false};\n`;
    code += `        ptr n = ptr::make(key${map ? ', Value::make(value)' : ''});\n        wrapper_ops::insert_key(${root}, n);\n`;
    code += `        return ${multi ? 'iterator(n)' : '{iterator(n), true}'};\n    }\n`;
    code += `    int erase(key_type key) {\n        ptr removed = wrapper_ops::remove_all(${root}, key);\n        int count = wrapper_ops::size(removed);\n        delete removed.get();\n        return count;\n    }\n`;
    if (multi) code += `    bool erase_one(key_type key) { ptr n = wrapper_ops::remove_key(${root}, key); bool found = bool(n); delete n.get(); return found; }\n`;
    if (map) {
      code += '    std::pair<iterator, bool> insert(value_type value) { return insert(value.first, value.second); }\n';
      code += '    std::pair<iterator, bool> insert_or_assign(key_type key, mapped_type value) {\n        auto result = insert(key, value);\n        if (!result.second) set(key, value);\n        return result;\n    }\n';
      code += '    reference operator[](key_type key) { if (!contains(key)) insert(key); return {*this, key}; }\n';
    }
  } else {
    code += '    reference operator[](int i) { return at(i); }\n    value_type operator[](int i) const { return at(i); }\n';
    code += '    void insert(int i, value_type value) {\n        if (i < 0 || i > size()) throw std::out_of_range("DynamicArray::insert");\n';
    code += `        wrapper_ops::insert_index(${root}, ptr(new Node(${cfg.key_type !== 'none' ? '{}, ' : ''}Value::make(value))), i);\n    }\n`;
    code += `    value_type erase(int i) {\n        value_type value = read(i);\n        ptr removed = wrapper_ops::remove_index(${root}, i);\n        delete removed.get();\n        return value;\n    }\n`;
    code += '    void push_back(value_type value) { insert(size(), value); }\n    void push_front(value_type value) { insert(0, value); }\n';
    code += '    value_type pop_back() { return erase(size() - 1); }\n    value_type pop_front() { return erase(0); }\n';
    if (cfg.range_reverse_index) code += `    void reverse(int l, int r) { wrapper_ops::reverse_range(${root}, l, r); }\n`;
    if (cfg.rot_option) code += `    void rotate(int i) { wrapper_ops::rotate_to(${root}, i); }\n`;
  }
  if (cfg.range_agg) code += `    Value all() const { return wrapper_ops::aggregate(${root}); }\n`;
  if (rangeQuery) code += `    Value query(${index} l, ${index} r) { return wrapper_ops::query_range(${root}, l, r); }\n`;
  if (numeric && rangeUpdate) {
    code += `    void update(${index} l, ${index} r, Lazy tag) { wrapper_ops::change_range(${root}, l, r, tag); }\n`;
    if (cfg.range_add) code += `    void add(${index} l, ${index} r, ${scalar} value) { Lazy tag = lid; tag.val = value; update(l, r, tag); }\n`;
    if (cfg.range_set) code += `    void assign(${index} l, ${index} r, ${scalar} value) { Lazy tag = lid; tag.val = value; tag.inc = false; update(l, r, tag); }\n`;
    if (cfg.beats_add) code += `    void add(${index} l, ${index} r, ${scalar} value) { update(l, r, add_tag(value)); }\n`;
    if (cfg.beats_chmin) code += `    void chmin(${index} l, ${index} r, ${scalar} value) { update(l, r, chmin_tag(value)); }\n`;
    if (cfg.beats_chmax) code += `    void chmax(${index} l, ${index} r, ${scalar} value) { update(l, r, chmax_tag(value)); }\n`;
  }
  return code + '};\n\n';
}
