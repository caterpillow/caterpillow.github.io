import { edges, features, mutualExclusions } from './features'

// Helper to determine if a dependency is satisfied (including selects with 'none')
export function isEnabled(config: Record<string, boolean|string>, dep: string): boolean {
  const feature = features.find(f => f.key === dep);
  if (feature && feature.type === 'select') {
    const val = config[dep] as string | undefined;
    const defaultVal = feature.options?.[0]?.value;
    // Treat 'none' or first select option as not enabled
    return !!val && val !== defaultVal;
  }
  // For checkboxes / others, just boolean
  return !!config[dep];
}

// Topological sort to order features based on dependency edges
export function topsort(pairs: Array<[string, string]>): string[] {
  const graph: Record<string, string[]> = {};
  const deg: Record<string, number> = {};
  pairs.forEach(([a, b]) => {
    if (!graph[b]) graph[b] = [];
    if (!deg[a]) deg[a] = 0;
    if (!deg[b]) deg[b] = 0;
    graph[b].push(a);
    deg[a]++;
  });
  const sorted: string[] = [];
  const queue = Object.keys(deg).filter(k => deg[k] === 0);
  while (queue.length) {
    const current = queue.shift()!;
    sorted.push(current);
    (graph[current] || []).forEach(neighbor => {
      deg[neighbor]--;
      if (deg[neighbor] === 0) queue.push(neighbor);
    });
  }
  if (sorted.length !== Object.keys(deg).length) {
    throw new Error('Cycle detected in dependency graph!');
  }
  return sorted;
}

// Determine if a feature should be disabled based on dependencies (fix for selects)
export function computeDisabled(config: Record<string, boolean|string>) {
  const disabled: Record<string, boolean> = {};
  for (const [id, dep] of edges) {
    if (!isEnabled(config, dep)) disabled[id] = true;
  }
  for (const [id1, id2] of mutualExclusions) {
    if (config[id1]) disabled[id2] = true;
    if (config[id2]) disabled[id1] = true;
  }
  return disabled;
}

export function createDefaultConfig(): Record<string, boolean|string> {
  const cfg: Record<string, boolean|string> = {};
  for (const f of features) cfg[f.key] = f.type === 'select' ? f.options?.[0]?.value || '' : false;
  // Override defaults for specific settings
  cfg.use_namespace_std = true;
  cfg.tab_char = '4spaces';
  // derived
  cfg.pull = false;
  cfg.push = false;
  return cfg;
}

// Inverted dependency map: for every id gives a list of prerequisites (i.e. what you must enable to enable this)
function prereqMap() {
  const map: Record<string, string[]> = {};
  edges.forEach(([id, prereq]) => {
    if (!map[id]) map[id] = [];
    map[id].push(prereq);
  });
  return map;
}

const prereqs = prereqMap();

export function enableWithDependencies(cfg: Record<string, boolean|string>, key: string, resolveConflicts = true) {
  const visited = new Set<string>();
  function enable(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    (prereqs[id] || []).forEach(enable);
    const feature = features.find(f => f.key === id);
    if (!feature) return;
    if (!isEnabled(cfg, id)) cfg[id] = feature.type === 'select' ? feature.options?.[1]?.value || '' : true;
    if (resolveConflicts) {
      for (const [a, b] of mutualExclusions) {
        const other = a === id ? b : b === id ? a : undefined;
        if (other) cfg[other] = false;
      }
    }
  }
  enable(key);
}

export function deriveConfig(config: Record<string, boolean|string>) {
  const cfg = { ...createDefaultConfig(), ...config };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, dep] of edges) {
      if (isEnabled(cfg, id) && !isEnabled(cfg, dep)) {
        const feature = features.find(f => f.key === id);
        cfg[id] = feature?.type === 'select' ? feature.options?.[0]?.value || '' : false;
        changed = true;
      }
    }
  }
  cfg.pull = !!(cfg.size_option || cfg.range_agg || cfg.par_option);
  cfg.push = !!cfg.lazy_prop;
  return cfg;
}

export function normalizeConfig(config: Record<string, boolean|string>) {
  const cfg = { ...createDefaultConfig(), ...config };
  for (const feature of features) {
    if (isEnabled(cfg, feature.key)) enableWithDependencies(cfg, feature.key, false);
  }
  for (const [a, b] of mutualExclusions) {
    if (cfg[a] && cfg[b]) throw new Error(`Incompatible treap features: ${a} and ${b}`);
  }
  return deriveConfig(cfg);
}
