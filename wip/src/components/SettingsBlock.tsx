import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FeatureMeta } from '../codegen/features';
import type { TreapConfig } from '../codegen/treapConfig';
import { COLUMN_GAP, columnCount, partitionGroups, type SectionId } from '../uiModel';
import { ToggleGroup } from './ToggleGroup';

interface Group { name: string; features: FeatureMeta[] }
interface Props {
  id: SectionId;
  label: string;
  groups: Group[];
  config: TreapConfig;
  setConfig: (config: TreapConfig, key?: string) => void;
  activate: (key: string) => void;
  flashStates: Record<string, 'enabled' | 'disabled' | null>;
}

export function SettingsBlock({ id, label, groups, config, setConfig, activate, flashStates }: Props) {
  const widthProbe = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const preferred = useRef<{ key: string; columns: number[][] }>();
  const [measurement, setMeasurement] = useState<{ width: number; heights: Record<string, number> }>({ width: 0, heights: {} });
  const ids = groups.map(group => group.name).join('\0');
  const count = columnCount(measurement.width, groups.length);
  const partitionKey = `${ids}\0${count}`;

  useLayoutEffect(() => {
    const host = widthProbe.current;
    if (!host) return;
    const measure = () => {
      const width = host.getBoundingClientRect().width;
      const heights = Object.fromEntries(groups.map(group => [group.name, elements.current.get(group.name)?.getBoundingClientRect().height ?? 0]));
      setMeasurement(previous => Math.abs(previous.width - width) < 0.01 && Object.keys(previous.heights).length === groups.length && groups.every(group => Math.abs((previous.heights[group.name] ?? -1) - heights[group.name]) < 0.01) ? previous : { width, heights });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    for (const element of elements.current.values()) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [ids, count, groups]);

  const layout = useMemo(() => {
    const heights = groups.map(group => measurement.heights[group.name] ?? 64);
    const columns = partitionGroups(heights, count, COLUMN_GAP, preferred.current?.key === partitionKey ? preferred.current.columns : undefined);
    const positions: { column: number; top: number }[] = [];
    let height = 0;
    columns.forEach((column, index) => {
      let top = 0;
      column.forEach(i => { positions[i] = { column: index, top }; top += heights[i] + COLUMN_GAP; });
      height = Math.max(height, top - (column.length ? COLUMN_GAP : 0));
    });
    return { positions, height, columns };
  }, [groups, measurement, count, partitionKey]);
  useLayoutEffect(() => { preferred.current = { key: partitionKey, columns: layout.columns }; }, [partitionKey, layout.columns]);

  return <section id={`settings-${id}`} className="settings-block" aria-labelledby={`heading-${id}`}>
    <header className="settings-block-heading"><h2 id={`heading-${id}`}>{label}</h2><span>{count ? `${count} ${count === 1 ? 'column' : 'columns'}` : 'No matches'}</span></header>
    <div ref={widthProbe} className="section-width-probe" aria-hidden="true" />
    <div className="section-columns" data-columns={count} style={{ height: layout.height }}>
      {groups.map((group, index) => {
        const position = layout.positions[index] ?? { column: 0, top: 0 };
        return <div key={group.name} data-subsection={group.name} data-column={position.column} className="subsection-slot"
          ref={element => { if (element) elements.current.set(group.name, element); else elements.current.delete(group.name); }}
          style={{ width: `calc((100% - ${Math.max(0, count - 1) * COLUMN_GAP}px) / ${Math.max(1, count)})`, left: `calc(${position.column} * (100% + ${COLUMN_GAP}px) / ${Math.max(1, count)})`, top: position.top }}>
          <ToggleGroup groupName={group.name} features={group.features} config={config} setConfig={setConfig} activate={activate} flashStates={flashStates} />
        </div>;
      })}
    </div>
  </section>;
}
