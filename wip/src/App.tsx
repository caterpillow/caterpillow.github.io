import React, { useState, useEffect, useRef } from "react";
import { features, edges } from "./codegen/features";
import { computeDisabled } from "./codegen/depsUtil";
import { ToggleGroup } from "./components/ToggleGroup";
import { generateTreapCode } from "./codegen/treapConfig";

// Sections (group the toggles by these)
const SECTIONS = Array.from(new Set(features.map(f => f.section)));

function defaultConfig() {
  const cfg: Record<string, any> = {};
  for (const f of features) {
    if (f.type === "select") cfg[f.key] = f.options?.[0]?.value || "";
    else cfg[f.key] = false;
  }
  // Override defaults for specific settings
  cfg.use_namespace_std = true;
  cfg.tab_char = "4spaces";
  // derived
  cfg.pull = false;
  cfg.push = false;
  return cfg;
}

function derive(cfg: Record<string, any>) {
  cfg.pull = !!(cfg.size_option || cfg.range_agg || cfg.par_option);
  cfg.push = !!cfg.lazy_prop;
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

// Divide into three columns as equally as possible
function splitSectionsIntoColumns<T>(sections: T[]): T[][] {
  const cols = [[], [], []];
  sections.forEach((s, i) => cols[i % 3].push(s));
  return cols;
}

export default function App() {
  const [config, setConfig] = useState(derive(defaultConfig()));
  const [copyStatus, setCopyStatus] = useState('');
  const [flashStates, setFlashStates] = useState<Record<string, 'enabled' | 'disabled' | null>>({});
  const [codeDiff, setCodeDiff] = useState<{oldLines: Set<number>, newLines: Set<number>} | null>(null);
  const prevConfigRef = useRef<Record<string, any>>(derive(defaultConfig()));
  const prevCodeRef = useRef<string>('');
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const diffTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const disabled = computeDisabled(config);
  const prereqs = prereqMap();
  const columns = splitSectionsIntoColumns(SECTIONS);

  // Reset disabled selects and checkboxes to default values immediately when they get disabled
  useEffect(() => {
    let needsReset = false;
    const newConfig = { ...config };
    features.forEach(f => {
      if (disabled[f.key]) {
        if (f.type === "select") {
          // Reset selects to default (first option)
          if (newConfig[f.key] !== f.options?.[0]?.value) {
            newConfig[f.key] = f.options?.[0]?.value;
            needsReset = true;
          }
        } else {
          // Reset checkboxes to false
          if (newConfig[f.key] !== false) {
            newConfig[f.key] = false;
            needsReset = true;
          }
        }
      }
    });
    if (needsReset) setConfig(derive(newConfig));
    // eslint-disable-next-line
  }, [disabled]);

  // Detect config changes and trigger flash animations
  useEffect(() => {
    const prev = prevConfigRef.current;
    const newFlashStates: Record<string, 'enabled' | 'disabled' | null> = {};
    
    features.forEach(f => {
      const key = f.key;
      const prevVal = prev[key];
      const currVal = config[key];
      
      // Check if value changed
      if (prevVal !== currVal) {
        // Determine if it was enabled or disabled
        if (f.type === "select") {
          const defaultVal = f.options?.[0]?.value;
          const wasDefault = prevVal === defaultVal || !prevVal;
          const isDefault = currVal === defaultVal || !currVal;
          if (!wasDefault && isDefault) {
            newFlashStates[key] = 'disabled';
          } else if (wasDefault && !isDefault) {
            newFlashStates[key] = 'enabled';
          }
        } else {
          // Checkbox
          if (prevVal && !currVal) {
            newFlashStates[key] = 'disabled';
          } else if (!prevVal && currVal) {
            newFlashStates[key] = 'enabled';
          }
        }
      }
    });
    
    if (Object.keys(newFlashStates).length > 0) {
      // Clear any existing timeout
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      setFlashStates(newFlashStates);
      // Clear flash states after animation completes (1s)
      flashTimeoutRef.current = setTimeout(() => {
        setFlashStates({});
        flashTimeoutRef.current = null;
      }, 1000);
    }
    
    prevConfigRef.current = { ...config };
  }, [config]);

  // Track code changes and compute diff
  useEffect(() => {
    const currentCode = generateTreapCode(config);
    const prevCode = prevCodeRef.current;
    
    if (prevCode && prevCode !== currentCode) {
      // Clear any existing timeout
      if (diffTimeoutRef.current) {
        clearTimeout(diffTimeoutRef.current);
      }
      
      // Compute line-by-line diff
      const oldLines = prevCode.split('\n');
      const newLines = currentCode.split('\n');
      const oldSet = new Set<string>();
      const newSet = new Set<string>();
      
      // Build sets for quick lookup (with trimming to ignore whitespace-only differences)
      oldLines.forEach(line => oldSet.add(line.trim()));
      newLines.forEach(line => newSet.add(line.trim()));
      
      // Find lines that were added (in new but not in old) - highlight green
      const addedLines = new Set<number>();
      newLines.forEach((line, idx) => {
        if (!oldSet.has(line.trim())) {
          addedLines.add(idx);
        }
      });
      
      // Find lines that were removed (in old but not in new)
      // Highlight them red at their exact old positions in the NEW code (simple position-based)
      // If old code had 10 lines and line 5 was removed, highlight whatever is at position 5 in new code
      const removedAtNewPositions = new Set<number>();
      oldLines.forEach((line, oldIdx) => {
        if (!newSet.has(line.trim())) {
          // Line was removed from old code at position oldIdx
          // Highlight the corresponding position in new code (if new code has enough lines)
          if (oldIdx < newLines.length) {
            removedAtNewPositions.add(oldIdx);
          } else {
            // Old code was longer - highlight the last line of new code
            if (newLines.length > 0) {
              removedAtNewPositions.add(newLines.length - 1);
            }
          }
        }
      });
      
      setCodeDiff({
        oldLines: removedAtNewPositions,
        newLines: addedLines
      });
      
      // Clear diff after animation
      diffTimeoutRef.current = setTimeout(() => {
        setCodeDiff(null);
        diffTimeoutRef.current = null;
      }, 1000);
    }
    
    prevCodeRef.current = currentCode;
  }, [config]);

  function enableDependencies(key: string) {
    let newConfig = { ...config };
    // Recursively walk prereqs upstream
    function dfsEnable(feature: string, visited = new Set<string>()) {
      if (visited.has(feature)) return;
      visited.add(feature);
      // Enable all this feature's own prerequisites
      (prereqs[feature] || []).forEach(prereq => {
        // Enable prerequisite itself (handle select vs checkbox)
        const f = features.find(f => f.key === prereq);
        if (f) {
          if (f.type === "select") {
            // Pick first non-default value if not set
            if (!newConfig[prereq] || newConfig[prereq] === f.options?.[0]?.value) {
              newConfig[prereq] = f.options?.[1]?.value || f.options?.[0]?.value;
            }
          } else {
            newConfig[prereq] = true;
          }
        }
        dfsEnable(prereq, visited);
      });
    }
    dfsEnable(key);
    // Now enable the originally-clicked feature
    const f = features.find(f => f.key === key);
    if (f) {
      if (f.type === "select") {
        newConfig[key] = f.options?.[1]?.value || f.options?.[0]?.value;
      } else {
        newConfig[key] = true;
      }
    }
    setConfig(derive(newConfig));
  }

  function copyCode() {
    const code = generateTreapCode(config);
    const fullCode = config.signature ? `// generated at caterpillow.github.io/byot\n\n${code}` : code;
    navigator.clipboard.writeText(fullCode).then(() => {
      setCopyStatus('Copied!');
      setTimeout(() => setCopyStatus(''), 2000);
    }).catch(() => {
      setCopyStatus('Failed');
      setTimeout(() => setCopyStatus(''), 2000);
    });
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-4">
      <h1 className="text-4xl font-bold mb-4 text-blue-700 text-center">Build Your Own Treap <span className="text-base font-normal">(BYOT Next)</span></h1>
      <div className="w-full flex flex-row gap-8 justify-center mt-4">
        {/* Settings: 3 buffed cards, code card exactly 2x width (desktop only layout). */}
        <div className="flex flex-row gap-6 flex-none">
          {columns.map((sectionList, idx) => (
            <aside
              key={idx}
              className="w-[350px] flex-none bg-white border border-gray-300 rounded-lg shadow p-6 flex flex-col gap-4 min-h-[600px]"
            >
              {sectionList.map(section => (
                <ToggleGroup
                  key={section}
                  groupName={section}
                  features={features.filter(f => f.section === section)}
                  config={config}
                  setConfig={c => setConfig(derive({ ...c }))}
                  disabledMap={disabled}
                  enableDependencies={enableDependencies}
                  flashStates={flashStates}
                  bigInputs={false}
                />
              ))}
            </aside>
          ))}
        </div>
        <main className="w-[700px] flex-none bg-white border border-gray-300 rounded-lg shadow p-6 min-h-[600px] max-w-full">
          <div className="flex flex-col gap-2 h-full">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Resulting Code</div>
              <div className="flex items-center gap-2">
                {copyStatus && <span className="text-sm text-green-600">{copyStatus}</span>}
                <button
                  onClick={copyCode}
                  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                >
                  Copy
                </button>
              </div>
            </div>
            <pre className="bg-gray-900 text-green-200 p-2 rounded overflow-x-auto text-xs min-h-[18rem] h-full">
              {(() => {
                const code = generateTreapCode(config);
                const lines = code.split('\n');
                return lines.map((line, idx) => {
                  let className = '';
                  if (codeDiff) {
                    if (codeDiff.newLines.has(idx)) {
                      className = 'animate-diff-green block';
                    } else if (codeDiff.oldLines.has(idx)) {
                      className = 'animate-diff-red block';
                    }
                  }
                  return (
                    <span key={idx} className={className}>
                      {line}
                      {idx < lines.length - 1 && '\n'}
                    </span>
                  );
                });
              })()}
            </pre>
          </div>
        </main>
      </div>
      <footer className="mt-5 text-gray-400 text-xs">&copy; 2025 caterpillow | <a className="underline" href="https://codeforces.com/blog/entry/136858" target="_blank" rel="noopener noreferrer">Codeforces Blogpost</a></footer>
    </div>
  );
}

