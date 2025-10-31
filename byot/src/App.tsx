import React, { useState, useEffect } from "react";
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
  const disabled = computeDisabled(config);
  const prereqs = prereqMap();
  const columns = splitSectionsIntoColumns(SECTIONS);

  // Reset disabled selects to default value (None) immediately when they get disabled
  useEffect(() => {
    let needsReset = false;
    const newConfig = { ...config };
    features.forEach(f => {
      if (f.type === "select" && disabled[f.key]) {
        if (newConfig[f.key] !== f.options?.[0]?.value) {
          newConfig[f.key] = f.options?.[0]?.value;
          needsReset = true;
        }
      }
    });
    if (needsReset) setConfig(derive(newConfig));
    // eslint-disable-next-line
  }, [disabled]);

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
              {/* TODO: Add preset buttons and copy actions here */}
            </div>
            <pre className="bg-gray-900 text-green-200 p-2 rounded overflow-x-auto text-xs min-h-[18rem] h-full">
{generateTreapCode(config)}
            </pre>
          </div>
        </main>
      </div>
      <footer className="mt-5 text-gray-400 text-xs">&copy; 2025 caterpillow | <a className="underline" href="https://codeforces.com/blog/entry/136858" target="_blank" rel="noopener noreferrer">Codeforces Blogpost</a></footer>
    </div>
  );
}
