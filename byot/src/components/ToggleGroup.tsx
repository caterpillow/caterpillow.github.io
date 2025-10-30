import React from "react";
import { FeatureMeta } from "../codegen/features";

interface ToggleGroupProps {
  groupName: string;
  features: FeatureMeta[];
  config: Record<string, boolean|String>;
  setConfig: (c: Record<string, boolean|String>) => void;
  disabledMap?: Record<string, boolean>;
  enableDependencies?: (id: string) => void;
  bigInputs?: boolean;
}

export function ToggleGroup({ groupName, features, config, setConfig, disabledMap, enableDependencies, bigInputs }: ToggleGroupProps) {
  function onCheckboxChange(k: string) {
    setConfig({ ...config, [k]: !config[k] });
  }
  function onCheckboxContextMenu(e: React.MouseEvent<HTMLInputElement>, k: string) {
    e.preventDefault();
    if (enableDependencies) enableDependencies(k);
  }
  function onCheckboxDoubleClick(e: React.MouseEvent<HTMLInputElement>, k: string) {
    if (disabledMap?.[k]) {
      e.preventDefault();
      if (enableDependencies) enableDependencies(k);
      return;
    }
    onCheckboxChange(k);
  }
  function setDrop(e: React.ChangeEvent<HTMLSelectElement>, k: string) {
    if (disabledMap?.[k]) return;
    setConfig({ ...config, [k]: e.target.value });
  }
  const checkboxSizeClass = bigInputs ? "w-6 h-6" : "w-4 h-4";
  const selectClass = bigInputs ? "border rounded px-2 py-2 min-w-[6rem] text-base" : "border rounded px-1 py-0.5 min-w-[6rem]";
  return (
    <fieldset className={bigInputs ? "mb-4" : "mb-2"}>
      <legend className="block mb-1 font-semibold text-sm">{groupName}</legend>
      {features.map(f => (
        f.type === "select" ? (
          <div key={f.key} className="flex items-center gap-2 mb-2">
            <label className="font-medium mr-2" htmlFor={`sel-${f.key}`}>{f.label}</label>
            <select
              id={`sel-${f.key}`}
              value={config[f.key] as string || (f.options && f.options[0]?.value) || ""}
              disabled={!!disabledMap?.[f.key]}
              onChange={e => setDrop(e, f.key)}
              onContextMenu={e => { e.preventDefault(); if (enableDependencies) enableDependencies(f.key); }}
              onDoubleClick={e => { if (disabledMap?.[f.key] && enableDependencies) { e.preventDefault(); enableDependencies(f.key); } }}
              className={selectClass}
            >
              {f.options?.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>
        ) : (
          <label key={f.key} className="flex items-center gap-2 mb-2 cursor-pointer group" htmlFor={`chk-${f.key}`}>
            <input
              id={`chk-${f.key}`}
              type="checkbox"
              checked={!!config[f.key]}
              className={`accent-blue-600 ${checkboxSizeClass}`}
              disabled={!!disabledMap?.[f.key]}
              onChange={() => onCheckboxChange(f.key)}
              onContextMenu={e => onCheckboxContextMenu(e, f.key)}
              onDoubleClick={e => onCheckboxDoubleClick(e, f.key)}
            />
            <span>{f.label}</span>
            {f.tooltip && (
              <span className="ml-1 text-gray-400 opacity-70 text-xs group-hover:opacity-100" title={f.tooltip}>ℹ️</span>
            )}
          </label>
        )
      ))}
    </fieldset>
  );
}
