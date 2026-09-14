import { dependencyEdges, features, forcedOptions, mutualExclusions, preferences } from './features'

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
  for (const [id, dep] of dependencyEdges(config)) {
    if (!isEnabled(config, dep)) disabled[id] = true;
  }
  for (const [id1, id2] of mutualExclusions) {
    if (isEnabled(config, id1)) disabled[id2] = true;
    if (isEnabled(config, id2)) disabled[id1] = true;
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
function prereqMap(cfg: Record<string, boolean|string>) {
  const map: Record<string, string[]> = {};
  dependencyEdges(cfg).forEach(([id, prereq]) => {
    if (!map[id]) map[id] = [];
    map[id].push(prereq);
  });
  return map;
}

export function enableWithDependencies(cfg: Record<string, boolean|string>, key: string, resolveConflicts = true) {
  Object.assign(cfg, forcedOptions(cfg));
  const visited = new Set<string>();
  function enable(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const feature = features.find(f => f.key === id);
    if (!feature) return;
    if (!isEnabled(cfg, id)) cfg[id] = feature.type === 'select' ? feature.options?.[1]?.value || '' : true;
    (prereqMap(cfg)[id] || []).forEach(enable);
    if (resolveConflicts) {
      for (const [a, b] of mutualExclusions) {
        const other = a === id ? b : b === id ? a : undefined;
        if (other) {
          const f = features.find(feature => feature.key === other);
          cfg[other] = f?.type === 'select' ? f.options?.[0]?.value || '' : false;
        }
      }
    }
  }
  enable(key);
}

export function deriveConfig(config: Record<string, boolean|string>) {
  const cfg = { ...createDefaultConfig(), ...config, ...forcedOptions(config) };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, dep] of dependencyEdges(cfg)) {
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

export function setFeature(config: Record<string, boolean|string>, key: string, value: boolean|string) {
  const cfg = { ...config, [key]: value };
  Object.assign(cfg, forcedOptions(cfg));
  if (isEnabled(cfg, key)) {
    enableWithDependencies(cfg, key);
    if (!isEnabled(config, key)) {
      for (const [from, to] of preferences) if (from === key) enableWithDependencies(cfg, to);
    }
  }
  return deriveConfig(cfg);
}

export function setAvailableFeature(config: Record<string, boolean|string>, key: string, value: boolean|string) {
  if (computeDisabled(config)[key] || key in forcedOptions(config)) return config;
  return setFeature(config, key, value);
}

export function activateFeature(config: Record<string, boolean|string>, key: string) {
  const feature = features.find(f => f.key === key);
  if (!feature || key in forcedOptions(config)) return config;
  const value = feature.type === 'select' ? isEnabled(config, key) ? config[key] : feature.options?.[1]?.value || '' : true;
  return setFeature(config, key, value);
}

export function isVisible(config: Record<string, boolean|string>, key: string): boolean {
  const f = features.find(feature => feature.key === key);
  return !!f && (!f.subOptionOf || isEnabled(config, f.subOptionOf)) && Object.entries(f.visibleWhen || {}).every(([id, value]) => config[id] === value);
}

export function normalizeConfig(config: Record<string, boolean|string>) {
  const cfg = { ...createDefaultConfig(), ...config, ...forcedOptions(config) };
  for (const feature of features) {
    if (isEnabled(cfg, feature.key)) enableWithDependencies(cfg, feature.key, false);
  }
  for (const [a, b] of mutualExclusions) {
    if (isEnabled(cfg, a) && isEnabled(cfg, b)) throw new Error(`Incompatible treap features: ${a} and ${b}`);
  }
  return deriveConfig(cfg);
}
