import React from "react";
import { FeatureMeta } from "../codegen/features";

interface ToggleGroupProps {
  groupName: string;
  features: FeatureMeta[];
  config: Record<string, boolean|String>;
  setConfig: (c: Record<string, boolean|String>) => void;
  disabledMap?: Record<string, boolean>;
  enableDependencies?: (id: string) => void;
  flashStates?: Record<string, 'enabled' | 'disabled' | null>;
}

export function ToggleGroup({ groupName, features, config, setConfig, disabledMap, enableDependencies, flashStates }: ToggleGroupProps) {
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
  // Standardized but refined sizing (not too giant)
  const checkboxSizeClass = "w-5 h-5 flex-shrink-0 cursor-pointer";
  const selectClass = "border rounded px-2 py-1.5 min-w-[7.6rem] text-base leading-6 flex-shrink-0 cursor-pointer";
  const labelClass = "flex items-center gap-3 mb-3 cursor-pointer select-none group leading-6";
  
  function getFlashClass(key: string): string {
    const flash = flashStates?.[key];
    if (flash === 'enabled') return 'animate-flash-green rounded px-1 -mx-1';
    if (flash === 'disabled') return 'animate-flash-red rounded px-1 -mx-1';
    return '';
  }
  // Separate regular features from suboptions
  const regularFeatures = features.filter(f => !f.subOptionOf);
  const subOptionsByParent = features.filter(f => f.subOptionOf).reduce((acc, f) => {
    if (!acc[f.subOptionOf!]) acc[f.subOptionOf!] = [];
    acc[f.subOptionOf!].push(f);
    return acc;
  }, {} as Record<string, typeof features>);

  function renderFeature(f: typeof features[0]) {
    if (f.type === "select") {
      return (
        <div key={f.key} className={`flex items-center gap-2 mb-3 ${getFlashClass(f.key)}`}>
          <label className="font-medium mr-2 min-w-fit" htmlFor={`sel-${f.key}`}>{f.label}</label>
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
      );
    } else {
      return (
        <label key={f.key} className={`${labelClass} ${getFlashClass(f.key)}`} htmlFor={`chk-${f.key}`}>
          <input
            id={`chk-${f.key}`}
            type="checkbox"
            checked={!!config[f.key]}
            className={`accent-blue-600 ${checkboxSizeClass} ${disabledMap?.[f.key] ? 'cursor-not-allowed' : ''}`}
            disabled={!!disabledMap?.[f.key]}
            onChange={() => onCheckboxChange(f.key)}
            onContextMenu={e => onCheckboxContextMenu(e, f.key)}
            onDoubleClick={e => onCheckboxDoubleClick(e, f.key)}
          />
          <span>{f.label}</span>
          {f.tooltip && (
            <span className="ml-1 text-gray-400 opacity-70 text-base group-hover:opacity-100" title={f.tooltip}>ℹ️</span>
          )}
        </label>
      );
    }
  }

  function renderSubOption(f: typeof features[0]) {
    // Suboptions are always checkboxes (for now), rendered smaller and indented
    const flashClass = getFlashClass(f.key);
    return (
      <div key={f.key} className="mb-3">
        <label className={`${labelClass} pl-8 text-sm opacity-90`} htmlFor={`chk-${f.key}`}>
          <input
            id={`chk-${f.key}`}
            type="checkbox"
            checked={!!config[f.key]}
            className={`accent-blue-600 w-4 h-4 flex-shrink-0 cursor-pointer ${disabledMap?.[f.key] ? 'cursor-not-allowed' : ''}`}
            disabled={!!disabledMap?.[f.key]}
            onChange={() => onCheckboxChange(f.key)}
            onContextMenu={e => onCheckboxContextMenu(e, f.key)}
            onDoubleClick={e => onCheckboxDoubleClick(e, f.key)}
          />
          <span className={flashClass}>{f.label}</span>
          {f.tooltip && (
            <span className="ml-1 text-gray-400 opacity-70 text-base group-hover:opacity-100" title={f.tooltip}>ℹ️</span>
          )}
        </label>
      </div>
    );
  }

  return (
    <fieldset className="mb-4">
      <legend className="block mb-1 font-semibold text-sm">{groupName}</legend>
      {regularFeatures.map(f => {
        const subOptions = subOptionsByParent[f.key] || [];
        const isParentEnabled = !f.subOptionOf && !!config[f.key];
        return (
          <React.Fragment key={f.key}>
            {renderFeature(f)}
            {isParentEnabled && subOptions.map(subOpt => renderSubOption(subOpt))}
          </React.Fragment>
        );
      })}
    </fieldset>
  );
}
