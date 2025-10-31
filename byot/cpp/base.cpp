// generated at caterpillow.github.io/byot

#include <bits/stdc++.h>

using namespace std;
using ll = long long;

mt19937 mt(chrono::steady_clock::now().time_since_epoch().count());

// using ptr = struct Node*;
struct Node; struct ptr; 
ptr succ(ptr n); ptr pred(ptr n); ptr mn(ptr n);

struct ptr {
    using iterator_category = std::bidirectional_iterator_tag;
    using value_type        = Node;
    using difference_type   = std::ptrdiff_t;
    using pointer           = Node*;
    using reference         = Node&;
#if __cpp_lib_concepts
    using iterator_concept  = std::bidirectional_iterator_tag; 
#endif    
    Node *p;
    ptr(Node *p = nullptr) : p(p) {}
    Node &operator*() const { return *p; }
    Node *operator->() const { return p; }
    explicit operator bool() const noexcept { return p; }
    bool operator==(const ptr &o) const noexcept { return p == o.p; }
    bool operator!=(const ptr &o) const noexcept { return p != o.p; }

    ptr &operator++() { return *this = succ(*this); }
    ptr operator++(int) { return std::exchange(*this, succ(*this)); }
    ptr &operator--() { return *this = pred(*this); }
    ptr operator--(int) { return std::exchange(*this, pred(*this)); }
};

inline ptr begin(ptr n) { return mn(n); }
inline ptr end(ptr) { return ptr{nullptr}; }

struct Node {
    int key;
    int sz;
    int pri;
    ptr l, r;
    ptr par;

    Node() : Node({}) {}
    Node(int key) : key(key) {
        pri = mt();
        sz = 1;
        l = r = nullptr;
        par = nullptr;
    }

    ~Node() {
        delete l.p;
        delete r.p;
    }
};

ptr succ(ptr n) {
    if (n->r) for (n = n->r; n->l; n = n->l);
    else { while (n->par && n->par->r == n) n = n->par; n = n->par; }
    return n;
}

ptr pred(ptr n) {
    if (n->l) for (n = n->l; n->r; n = n->r);
    else { while (n->par && n == n->par->l) n = n->par; n = n->par; }
    return n;
}

int sz(ptr n) { return n ? n->sz : 0; };

ptr pull(ptr n) {
    if (!n) return nullptr;
    if (n->l) n->l->par = n;
    if (n->r) n->r->par = n;
    n->sz = sz(n->l) + 1 + sz(n->r);
    return n;
}

ptr merge(ptr l, ptr r) {
    if (!l || !r) return l ? l : r;
    if (l->pri > r->pri) return l->r = merge(l->r, r), pull(l);
    else return r->l = merge(l, r->l), pull(r);
}

ptr mn(ptr n) {
    return n->l ? mn(n->l) : n;
}

int main() {
    cin.tie(0)->sync_with_stdio(0);
    
    const int n = 10;
    ptr treap {};
    for (int i = 0; i < n; i++) {
        treap = merge(treap, new Node((i + 1) * 10));
    }
    for (Node &x : treap) {
        cerr << x.key << '\n';
    }
    ptr it = begin(treap);
    it++;
    it = next(it);
}
