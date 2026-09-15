import React, { useState } from 'react';
import { type FeatureMeta, features as catalogue, dependencyEdges, forcedOptions, mutualExclusions } from '../codegen/features';
import { computeDisabled, isEnabled, isVisible } from '../codegen/depsUtil';
import { Icon } from './Icon';

interface ToggleGroupProps {
  groupName: string;
  features: FeatureMeta[];
  config: Record<string, boolean|string>;
  setConfig: (c: Record<string, boolean|string>, key?: string) => void;
  activate: (key: string) => void;
  flashStates?: Record<string, 'enabled' | 'disabled' | null>;
}

const labelFor = (key: string) => catalogue.find(feature => feature.key === key)?.label.replace(/^(Include|Enable|Choose) /, '') || key;

export function ToggleGroup({ groupName, features, config, setConfig, activate, flashStates }: ToggleGroupProps) {
  const [info, setInfo] = useState<string | null>(null);
  const disabled = computeDisabled(config);
  const required = forcedOptions(config);
  // Standardized touch targets without imposing fixed panel widths.
  const visible = features.filter(feature => isVisible(config, feature.key));
  // Separate regular features from suboptions while preserving their visual grouping.
  const roots = visible.filter(feature => !feature.subOptionOf || !visible.some(parent => parent.key === feature.subOptionOf));
  if (!roots.length) return null;

  function renderFeature(feature: FeatureMeta, nested = false): React.ReactNode {
    const id = `feature-${feature.key}`;
    const label = labelFor(feature.key).replace(/^./, char => char.toUpperCase());
    const needed = dependencyEdges(config).filter(([from, dep]) => from === feature.key && !isEnabled(config, dep)).map(([, dep]) => labelFor(dep));
    const conflicts = mutualExclusions.flatMap(([a, b]) => a === feature.key && isEnabled(config, b) ? [labelFor(b)] : b === feature.key && isEnabled(config, a) ? [labelFor(a)] : []);
    const blocked = !!disabled[feature.key];
    const locked = feature.key in required;
    const state = blocked ? 'unavailable' : isEnabled(config, feature.key) ? 'on' : 'off';
    const hasInfo = !!feature.tooltip || needed.length > 0 || conflicts.length > 0 || locked;
    const open = info === feature.key;
    const flash = flashStates?.[feature.key];
    const enable = () => {
      if (!blocked || locked) return;
      activate(feature.key);
      setInfo(null);
      requestAnimationFrame(() => document.getElementById(id)?.focus());
    };
    const children = visible.filter(child => child.subOptionOf === feature.key);
    return <div key={feature.key} data-feature={feature.key} data-state={state} data-required={locked || undefined} className={`${nested ? 'sub-option' : 'feature-card'} is-${state} ${feature.type === 'select' ? 'select-card' : ''} ${children.length ? 'has-sub-options' : ''} ${flash ? `animate-flash-${flash === 'enabled' ? 'green' : 'red'}` : ''}`}>
      <div className={`feature-row ${feature.type === 'select' ? 'select-row' : ''}`} onDoubleClick={event => {
        if (blocked && !(event.target as HTMLElement).closest('button')) { event.preventDefault(); enable(); }
      }}>
        <label className="feature-label" htmlFor={id}><span>{label}</span>{locked && <small className="required-label">Required by DynamicArray</small>}</label>
        {feature.type === 'select' ? <select id={id} disabled={blocked || locked} aria-label={feature.label} value={String(config[feature.key] ?? feature.options?.[0]?.value ?? '')} className="setting-select"
          aria-describedby={open ? `${id}-help` : undefined} onChange={event => setConfig({ ...config, [feature.key]: event.target.value }, feature.key)}>
          {feature.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : <input id={id} type="checkbox" role="switch" disabled={blocked || locked} className="setting-switch" aria-label={feature.label}
          aria-describedby={open ? `${id}-help` : undefined} checked={!!config[feature.key]}
          onChange={event => setConfig({ ...config, [feature.key]: event.target.checked }, feature.key)} />}
        {hasInfo && <button type="button" className="info-button" aria-label={`About ${label}`} aria-expanded={open} aria-controls={`${id}-help`}
          onClick={() => setInfo(open ? null : feature.key)} onKeyDown={event => { if (event.key === 'Escape') setInfo(null); }}><Icon name="info" /></button>}
      </div>
      {open && <div className="feature-help" role="note" id={`${id}-help`}>
        {feature.tooltip && <p>{feature.tooltip}</p>}
        {needed.length > 0 && <p>Also enables: {needed.join(', ')}.</p>}
        {conflicts.length > 0 && <p>Switches off: {conflicts.join(', ')}.</p>}
        {locked && <p>This setting is fixed while DynamicArray is selected.</p>}
        {blocked && <><p>Double-click the option to enable it with its prerequisites.</p><button type="button" className="text-button" onClick={enable}>Enable with prerequisites</button></>}
      </div>}
      {children.length > 0 && <div className="sub-options">{children.map(child => renderFeature(child, true))}</div>}
    </div>;
  }

  return <fieldset className="settings-group"><legend>{groupName}</legend><div className="feature-list">{roots.map(feature => renderFeature(feature))}</div></fieldset>;
}
