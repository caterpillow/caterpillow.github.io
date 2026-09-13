import React, { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines, highlightCpp, type DiffLine } from '../uiModel';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function CodePanel({ code, previous, onClearChanges }: { code: string; previous: string; onClearChanges: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const scrollPosition = useRef({ top: 0, left: 0 });
  const wasExpanded = useRef(false);
  const [mode, setMode] = useState<'none' | 'dialog' | 'native'>('none');
  const [showChanges, setShowChanges] = useState(true);
  const [highlight, setHighlight] = useState(true);
  const [fontSize, setFontSize] = useState(13);
  const [notice, setNotice] = useState('');
  const changes = useMemo(() => diffLines(previous, code), [previous, code]);
  const currentTokens = useMemo(() => highlightCpp(code), [code]);
  const previousTokens = useMemo(() => highlightCpp(previous), [previous]);
  const rows: DiffLine[] = showChanges ? changes : code.split('\n').map((text, i) => ({ kind: 'equal', text, newLine: i + 1 }));
  const added = changes.filter(row => row.kind === 'add').length;
  const removed = changes.filter(row => row.kind === 'remove').length;

  useEffect(() => {
    const update = () => {
      if (document.fullscreenElement === panel.current) setMode('native');
      else setMode(current => current === 'native' ? 'none' : current);
    };
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    if (mode === 'none' && wasExpanded.current) expandButton.current?.focus();
    wasExpanded.current = mode !== 'none';
  }, [mode]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2400);
    return () => clearTimeout(timer);
  }, [notice]);

  async function copyCode() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
      else {
        const area = document.createElement('textarea');
        const focused = document.activeElement as HTMLElement | null;
        area.value = code;
        area.readOnly = true;
        area.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        (panel.current ?? document.body).appendChild(area);
        try {
          area.focus(); area.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
        } finally { area.remove(); focused?.focus(); }
      }
      setNotice('Copied generated C++');
    } catch { setNotice('Copy failed. Select the code and copy manually.'); }
  }
  function close() {
    if (mode === 'native' && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => setNotice('Use your browser controls to exit fullscreen.'));
    } else setMode('none');
  }
  async function expand() {
    if (mode !== 'none') { close(); return; }
    const element = panel.current;
    if (element?.requestFullscreen && window.matchMedia('(pointer: coarse)').matches) {
      try { await element.requestFullscreen(); setMode('native'); return; } catch { setMode('dialog'); }
    } else setMode('dialog');
  }

  const content = <section ref={panel} id="code-pane" className="code-panel" aria-label="Generated C++">
    <header className="code-toolbar">
      <div className="code-heading"><Icon name="code" /><h2>C++ <span>template</span></h2><span className="line-count">{currentTokens.length} lines</span></div>
      <div className="code-actions">
        <button className="button copy-button" onClick={copyCode} aria-label="Copy generated C++"><Icon name={notice.startsWith('Copied') ? 'check' : 'copy'} /><span>Copy</span></button>
        <button ref={expandButton} className="icon-button" onClick={expand} aria-label={mode === 'none' ? 'Expand code' : 'Close expanded code'} autoFocus={mode === 'dialog'}><Icon name={mode === 'none' ? 'expand' : 'close'} /></button>
      </div>
    </header>
    <div className="code-options">
      <label><input type="checkbox" checked={showChanges} onChange={event => setShowChanges(event.target.checked)} />Changes</label>
      <label><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)} />Highlight</label>
      <select aria-label="Code font size" value={fontSize} onChange={event => setFontSize(Number(event.target.value))}>{[12, 13, 14, 16, 18].map(size => <option key={size} value={size}>{size}px</option>)}</select>
      {/* Clear the diff on demand without changing the generated source. */}
      {(added > 0 || removed > 0) && <button className="text-button" onClick={onClearChanges}>Clear changes</button>}
    </div>
    <div className="code-scroll" tabIndex={0} aria-label="Scrollable C++ source" style={{ fontSize }}
      ref={element => { if (element) { element.scrollTop = scrollPosition.current.top; element.scrollLeft = scrollPosition.current.left; } }}
      onScroll={event => { scrollPosition.current = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft }; }}>
      <pre><code>{rows.map((row, i) => {
        const tokens = row.kind === 'remove' ? previousTokens[(row.oldLine ?? 1) - 1] : currentTokens[(row.newLine ?? 1) - 1];
        return <span className={`code-line diff-${row.kind}`} key={`${row.kind}-${row.oldLine}-${row.newLine}-${i}`}>
          <span className="line-number" aria-hidden="true">{row.newLine ?? row.oldLine}</span>
          <span className="change-marker" aria-hidden="true">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '}</span>
          <span className="line-source">{highlight && tokens ? tokens.map((token, j) => <span className={`tok-${token.kind}`} key={j}>{token.text}</span>) : row.text}{!row.text && '\u200b'}</span>
        </span>;
      })}</code></pre>
    </div>
    <footer className="code-status"><span role="status" aria-live="polite">{notice || 'C++17 · Copy excludes diff markers'}</span><span className="diff-count"><span>+{added}</span><span>−{removed}</span></span></footer>
  </section>;

  return mode === 'dialog' ? <>
    <div className="code-placeholder"><Icon name="expand" /><p>Code is expanded</p><button className="button" onClick={close}>Restore split view</button></div>
    <Dialog open onClose={close} label="Expanded generated C++" className="code-dialog">{content}</Dialog>
  </> : content;
}
