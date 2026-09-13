import React, { useEffect, useRef, useState } from 'react';
import { clampRatio } from '../uiModel';

export function SplitPane({ settings, code }: { settings: React.ReactNode; code: React.ReactNode }) {
  const workspace = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [portrait, setPortrait] = useState(() => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches);
  const [ratios, setRatios] = useState({ portrait: 0.5, landscape: 0.46 });
  const [extent, setExtent] = useState(0);
  const axis = portrait ? 'portrait' : 'landscape';
  const ratio = clampRatio(ratios[axis], extent);

  useEffect(() => {
    const media = window.matchMedia('(orientation: portrait)');
    const update = () => { dragging.current = null; setPortrait(media.matches); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const padding = portrait ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setExtent((portrait ? element.clientHeight : element.clientWidth) - padding);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [portrait]);

  const resize = (value: number) => setRatios(previous => ({ ...previous, [axis]: clampRatio(value, extent) }));
  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current !== event.pointerId || !workspace.current) return;
    const bounds = workspace.current.getBoundingClientRect();
    const style = getComputedStyle(workspace.current);
    const padding = parseFloat(portrait ? style.paddingTop : style.paddingLeft);
    const position = (portrait ? event.clientY - bounds.top : event.clientX - bounds.left) - padding;
    resize((position - 6) / Math.max(1, extent - 12));
  }
  function finish(event: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current !== event.pointerId) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const decrement = portrait ? 'ArrowUp' : 'ArrowLeft';
    const increment = portrait ? 'ArrowDown' : 'ArrowRight';
    if (![decrement, increment, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    resize(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ratio + (event.key === increment ? 1 : -1) * (event.shiftKey ? 0.05 : 0.02));
  }
  const tracks = `minmax(0, ${ratio}fr) 12px minmax(0, ${1 - ratio}fr)`;
  return <div ref={workspace} className="split-workspace" data-orientation={axis} style={{ gridTemplateColumns: portrait ? 'minmax(0, 1fr)' : tracks, gridTemplateRows: portrait ? tracks : 'minmax(0, 1fr)' }}>
    <div className="pane-slot settings-slot">{settings}</div>
    <div className="split-handle" role="separator" tabIndex={0} aria-label="Resize settings and code" aria-controls="settings-pane code-pane"
      aria-orientation={portrait ? 'horizontal' : 'vertical'} aria-valuemin={Math.round(clampRatio(0, extent) * 100)} aria-valuemax={Math.round(clampRatio(1, extent) * 100)} aria-valuenow={Math.round(ratio * 100)} aria-valuetext={`Settings ${Math.round(ratio * 100)} percent`}
      onPointerDown={event => {
        if (event.button !== 0 || dragging.current !== null) return;
        event.preventDefault();
        dragging.current = event.pointerId;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { dragging.current = null; }}
      onKeyDown={keyDown} onDoubleClick={() => resize(portrait ? 0.5 : 0.46)}>
      <span className="split-grip" aria-hidden="true" />
    </div>
    <div className="pane-slot code-slot">{code}</div>
  </div>;
}
