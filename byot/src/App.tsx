import React, { useState } from "react";
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
  const [config, setConfig] = useState(defaultConfig());
  const disabled = computeDisabled(config);
  const prereqs = prereqMap();

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
    setConfig(newConfig);
  }

  // Split sections into three columns
  const columns = splitSectionsIntoColumns(SECTIONS);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-4">
      <h1 className="text-4xl font-bold mb-4 text-blue-700 text-center">Build Your Own Treap <span className="text-base font-normal">(BYOT Next)</span></h1>
      <div className="w-full max-w-7xl flex flex-col md:flex-row gap-6 mt-4">
        {/* Wider settings: 70% of container, each card min-w-[220px] for less cramming */}
        <div className="flex w-full md:w-[70%] gap-4">
          {columns.map((sectionList, idx) => (
            <aside
              key={idx}
              className="flex-1 min-w-[260px] bg-white rounded-lg shadow p-5 flex flex-col gap-4 max-h-[80vh] overflow-y-auto"
            >
              {sectionList.map(section => (
                <ToggleGroup
                  key={section}
                  groupName={section}
                  features={features.filter(f => f.section === section)}
                  config={config}
                  setConfig={setConfig}
                  disabledMap={disabled}
                  enableDependencies={enableDependencies}
                  bigInputs
                />
              ))}
            </aside>
          ))}
        </div>
        {/* Main Content: Code & Preset Chooser */}
        <main className="flex-1 bg-white rounded-lg shadow p-6 min-h-[350px]">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Resulting Code</div>
              {/* TODO: Add preset buttons and copy actions here */}
            </div>
            <pre className="bg-gray-900 text-green-200 p-2 rounded overflow-x-auto text-xs min-h-[18rem]">
{generateTreapCode(config)}
            </pre>
          </div>
        </main>
      </div>
      <footer className="mt-5 text-gray-400 text-xs">&copy; 2025 caterpillow | <a className="underline" href="https://codeforces.com/blog/entry/136858" target="_blank" rel="noopener noreferrer">Codeforces Blogpost</a></footer>
    </div>
  );
}
