import React, { useState, useEffect, useRef, useMemo } from 'react';
import { features } from './codegen/features';
import { computeDisabled, createDefaultConfig as defaultConfig, deriveConfig as derive, setAvailableFeature, activateFeature, isEnabled, isVisible } from './codegen/depsUtil';
import { SettingsBlock } from './components/SettingsBlock';
import { CodePanel } from './components/CodePanel';
import { SplitPane } from './components/SplitPane';
import { Dialog } from './components/Dialog';
import { Icon } from './components/Icon';
import { generateTreapCode, type TreapConfig } from './codegen/treapConfig';
import { settingsSection, SETTINGS_SECTIONS, type SectionId } from './uiModel';
import { TODO_TEXT } from './TODO';

// Sections (group the toggles by these)
const SECTIONS = Array.from(new Set(features.map(feature => feature.section)));

export default function App() {
  const [config, setConfig] = useState(() => derive(defaultConfig()));
  const [search, setSearch] = useState('');
  const [help, setHelp] = useState(false);
  const [flashStates, setFlashStates] = useState<Record<string, 'enabled' | 'disabled' | null>>({});
  const prevConfigRef = useRef<TreapConfig>(config);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsScroll = useRef<HTMLDivElement>(null);
  const disabled = useMemo(() => computeDisabled(config), [config]);
  const code = useMemo(() => generateTreapCode(config), [config]);
  const [previousCode, setPreviousCode] = useState(code);
  const prevCodeRef = useRef(code);

  function commitConfig(next: TreapConfig, sourceKey?: string) {
    setConfig(current => sourceKey ? setAvailableFeature(current, sourceKey, next[sourceKey]) : derive(next));
  }
  function activate(key: string) {
    setConfig(current => activateFeature(current, key));
  }

  // Reset disabled selects and checkboxes to default values immediately when they get disabled
  useEffect(() => {
    let needsReset = false;
    const newConfig = { ...config };
    features.forEach(f => {
      if (disabled[f.key]) {
        if (f.type === 'select') {
          // Reset selects to default (first option)
          if (newConfig[f.key] !== f.options?.[0]?.value) {
            newConfig[f.key] = f.options?.[0]?.value ?? '';
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
    if (needsReset) commitConfig(newConfig);
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
        if (f.type === 'select') {
          const defaultVal = f.options?.[0]?.value;
          const wasDefault = prevVal === defaultVal || !prevVal;
          const isDefault = currVal === defaultVal || !currVal;
          if (!wasDefault && isDefault) newFlashStates[key] = 'disabled';
          else if (wasDefault && !isDefault) newFlashStates[key] = 'enabled';
        } else {
          // Checkbox
          if (prevVal && !currVal) newFlashStates[key] = 'disabled';
          else if (!prevVal && currVal) newFlashStates[key] = 'enabled';
        }
      }
    });
    if (Object.keys(newFlashStates).length > 0) {
      // Clear any existing timeout
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      setFlashStates(newFlashStates);
      // Clear flash states after animation completes (1s)
      flashTimeoutRef.current = setTimeout(() => { setFlashStates({}); flashTimeoutRef.current = null; }, 1000);
    }
    prevConfigRef.current = { ...config };
  }, [config]);
  useEffect(() => () => { if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current); }, []);

  // Track code changes and compute diff
  useEffect(() => {
    if (prevCodeRef.current !== code) {
      // Retain the previous generated source instead of racing a short-lived diff timeout.
      setPreviousCode(prevCodeRef.current);
      prevCodeRef.current = code;
    }
  }, [code]);
  useEffect(() => { if (settingsScroll.current) settingsScroll.current.scrollTop = 0; }, [search]);

  const visibleFeatures = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = new Set(features.filter(feature => words.every(word => `${feature.label} ${feature.key} ${feature.section} ${feature.tooltip || ''}`.toLowerCase().includes(word))).map(feature => feature.key));
    for (const feature of features) {
      if (!matching.has(feature.key)) continue;
      let parent = feature.subOptionOf;
      while (parent) { matching.add(parent); parent = features.find(f => f.key === parent)?.subOptionOf; }
    }
    return features.filter(feature => isVisible(config, feature.key) && (!words.length || matching.has(feature.key)));
  }, [config, search]);
  const blocks = useMemo(() => SETTINGS_SECTIONS.map(section => ({
    ...section,
    groups: SECTIONS.map(name => ({ name, features: visibleFeatures.filter(feature => feature.section === name && settingsSection(feature) === section.id) })).filter(group => group.features.length),
  })), [visibleFeatures]);
  const enabled = features.filter(feature => feature.type !== 'select' && isEnabled(config, feature.key)).length;
  const orderedWarning = config.key_type !== 'none' && (config.range_reverse_key || config.range_reverse_index || config.rot_option || config.key_add || config.key_set);

  function jumpToSection(id: SectionId) {
    setSearch('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const scroll = settingsScroll.current, section = document.getElementById(`settings-${id}`);
      if (!scroll || !section) return;
      scroll.scrollTo({ top: scroll.scrollTop + section.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8, behavior: 'auto' });
    }));
  }

  const settings = <section id="settings-pane" className="settings-panel" aria-label="Treap settings">
    <header className="settings-heading"><div><span className="eyebrow">BUILD YOUR TEMPLATE</span><h1>Configure your treap</h1></div><span className="enabled-count">{enabled} enabled</span></header>
    <div className="settings-search"><Icon name="search" /><input type="search" aria-label="Search settings" placeholder="Search settings..." value={search} onChange={event => setSearch(event.target.value)} /></div>
    <nav className="section-nav" aria-label="Jump to settings section">
      {SETTINGS_SECTIONS.map(item => <button type="button" key={item.id} aria-controls={`settings-${item.id}`} onClick={() => jumpToSection(item.id)}>{item.label}</button>)}
    </nav>
    <div ref={settingsScroll} id="settings-content" className="settings-content" aria-label="All settings sections">
      <p className="settings-hint">{search ? 'Searching all sections, including parent controls.' : 'Double-click unavailable options to enable their prerequisites.'}</p>
      {orderedWarning && <aside className="inline-notice"><strong>Keep keys ordered.</strong> Reversing, rotating, or changing keys can invalidate key-based operations. Use index operations after reordering, or restore sorted keys first.</aside>}
      {blocks.map(block => <SettingsBlock key={block.id} {...block} config={config} setConfig={commitConfig} activate={activate} flashStates={flashStates} />)}
      {!visibleFeatures.length && <div className="empty-settings"><Icon name="search" /><p>No matching settings.</p><button className="text-button" onClick={() => setSearch('')}>Clear search</button></div>}
    </div>
    <footer className="settings-footer"><span>Options update the code instantly</span><button className="text-button" onClick={() => { setConfig(derive(defaultConfig())); setSearch(''); }}><Icon name="reset" />Reset</button></footer>
  </section>;

  return <div className="app" data-design="studio">
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><Icon name="code" /></span><div><strong>BYOT</strong><span>Build your own treap</span></div></div>
      <div className="app-actions"><button className="icon-button" onClick={() => setHelp(true)} aria-label="Help and information"><Icon name="info" /></button></div>
    </header>
    {/* Settings and code share an orientation-aware, resizable workspace. */}
    <SplitPane settings={settings} code={<CodePanel code={code} previous={previousCode} onClearChanges={() => setPreviousCode(code)} />} />
    <footer className="app-footer"><span>Client-side · No uploads</span><span><a href="https://codeforces.com/blog/entry/136858" target="_blank" rel="noopener noreferrer">Codeforces blog</a><button className="text-button" onClick={() => setHelp(true)}>Notes & ideas</button></span></footer>
    <Dialog open={help} onClose={() => setHelp(false)} label="BYOT help and information" className="help-dialog">
      <div className="help-content"><header><div><span className="eyebrow">A SMALL GUIDE</span><h2>Make it your own.</h2></div><button className="icon-button" onClick={() => setHelp(false)} aria-label="Close help"><Icon name="close" /></button></header>
        <p>All four settings sections are shown together. Options can be on, off, or unavailable. Double-click an unavailable option to enable it with its prerequisites, or use the activation button in its information panel. Switching off a prerequisite switches off dependent options. Right-click retains its normal browser behavior.</p>
        <p>Subsections stay together in columns. Their rendered heights are measured and partitioned to minimize the tallest column; widening the settings pane adds more columns.</p>
        <h3>A workspace that fits</h3><p>Drag the middle bar with a mouse or finger. Portrait windows stack settings above code; landscape windows put them side by side. Focus the bar and use arrow keys, Home, or End to resize with a keyboard. Double-click it to reset the split.</p>
        <h3>Code and changes</h3><p>The Changes view aligns repeated lines. Deleted text fades for three seconds, then its rows disappear and the code collapses at once. Added-line highlights fade over the same interval. If no changed line is visible, the first change is brought into view with some context above it. Whitespace-only edits are ignored. Copy always gives you the current C++, without line numbers or deleted code. Expand opens a desktop dialog or uses native fullscreen on touch devices when available.</p>
        <h3>Handles and containers</h3><p><code>ptr::weak_ptr</code> is a non-owning node handle that safe merges do not clear. The short alias is weak_ptr; ptr::weak_ptr avoids ambiguity with std::weak_ptr. It does not track expiration or provide shared ownership: deleting a node invalidates its handles. Pointer subscripts return node handles; use modification helpers when editing raw node values.</p>
        <p>Containers own their roots and are move-only. Map and DynamicArray subscript assignments update aggregates through proxies; iteration is read-only. DynamicArray forces pointer subscripting to Index. split(cut) keeps the left part and returns the right. merge(rhs) appends and empties rhs; key containers require ordered ranges, with equal boundary keys allowed only for multiset. Expensive safety checks are off by default; enable them to emit treap_safety-guarded traversal checks. Cheap bounds and end-iterator checks remain on. Iterators support --, but decrementing end() throws. Array storage uses a shared arena, so erase and clear do not recover arena capacity.</p>
        <h3>Partition results</h3><p>The key type's maximum value is the default missing-result sentinel. Choose <code>std::optional</code> if an actual maximum key must be distinguished from a missing result, or if your custom key has no numeric limits.</p>
        <h3>Possible next steps</h3><pre className="roadmap">{TODO_TEXT}</pre>
      </div>
    </Dialog>
  </div>;
}
