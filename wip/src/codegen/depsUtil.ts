import { edges, mutualExclusions } from './features'
import { features } from './features'

// Helper to determine if a dependency is satisfied (including selects with 'none')
function isDepSatisfied(config: Record<string, boolean|string>, dep: string): boolean {
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
    if (!isDepSatisfied(config, dep)) disabled[id] = true;
  }
  for (const [id1, id2] of mutualExclusions) {
    if (config[id1]) disabled[id2] = true;
    if (config[id2]) disabled[id1] = true;
  }
  return disabled;
}
