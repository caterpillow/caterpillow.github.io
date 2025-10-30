import { edges, mutualExclusions } from './features'

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

// Determine if a feature should be disabled based on dependencies
export function computeDisabled(config: Record<string, boolean|string>) {
  // Mark all features as enabled by default
  const disabled: Record<string, boolean> = {};
  // For each edge, if dependency not satisfied, disable
  for (const [id, dep] of edges) {
    if (!config[dep]) disabled[id] = true;
  }
  // Mutual exclusions: If one is selected, disable the other
  for (const [id1, id2] of mutualExclusions) {
    if (config[id1]) disabled[id2] = true;
    if (config[id2]) disabled[id1] = true;
  }
  return disabled;
}
