import { ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, GripVertical, RotateCcw } from 'lucide-react';

export const scheduleColumns = [
  { id: 'test_name', label: 'Test', width: 220 },
  { id: 'product', label: 'Product', width: 180 },
  { id: 'batch_number', label: 'Batch', width: 145 },
  { id: 'assignee', label: 'Main Analyst', width: 170 },
  { id: 'trainees', label: 'Trainees', width: 200 },
  { id: 'reviewer', label: 'QC Reviewer', width: 170 },
  { id: 'start_time', label: 'Date', width: 135 },
  { id: 'progress', label: 'Progress', width: 170 },
  { id: 'status', label: 'Status', width: 145 },
  { id: 'email_status', label: 'Email', width: 120 },
  { id: 'actions', label: 'Actions', width: 320 }
];
export type ColumnLayout = { order: string[]; hidden: string[]; widths: Record<string, number> };
export const defaultColumnLayout = (): ColumnLayout => ({ order: scheduleColumns.map(column => column.id), hidden: [], widths: Object.fromEntries(scheduleColumns.map(column => [column.id, column.width])) });
export const normalizeColumnLayout = (value: unknown): ColumnLayout => {
  const defaults = defaultColumnLayout();
  if (!value || typeof value !== 'object') return defaults;
  const input = value as Partial<ColumnLayout>;
  const valid = (id: unknown): id is string => typeof id === 'string' && defaults.order.includes(id);
  const order = Array.isArray(input.order) ? [...new Set(input.order.filter(valid))] : [];
  defaults.order = [...order, ...defaults.order.filter(id => !order.includes(id))];
  defaults.hidden = Array.isArray(input.hidden) ? [...new Set(input.hidden.filter(valid))] : [];
  if (defaults.hidden.length === defaults.order.length) defaults.hidden = [];
  for (const id of defaults.order) {
    const width = input.widths?.[id];
    if (typeof width === 'number' && Number.isFinite(width)) defaults.widths[id] = Math.max(90, Math.min(800, width));
  }
  return defaults;
};
export const reorderColumn = (layout: ColumnLayout, source: string, target: string): ColumnLayout => {
  if (source === target || !layout.order.includes(source) || !layout.order.includes(target)) return layout;
  const order = [...layout.order];
  order.splice(order.indexOf(source), 1);
  order.splice(layout.order.indexOf(target), 0, source);
  return { ...layout, order };
};

export function useScheduleColumns(userId: string) {
  const storageKey = `qc-planner:schedule-columns:v1:${userId}`;
  const [layout, setLayout] = useState<ColumnLayout>(() => {
    try { return normalizeColumnLayout(JSON.parse(localStorage.getItem(storageKey) || 'null')); }
    catch { return defaultColumnLayout(); }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Layout remains usable when browser storage is unavailable. */ }
  }, [layout, storageKey]);
  const visible = layout.order.filter(id => !layout.hidden.includes(id));
  const resize = (id: string, width: number) => setLayout(current => ({ ...current, widths: { ...current.widths, [id]: Math.max(90, Math.min(800, width)) } }));
  return { layout, setLayout, visible, resize };
}

export function ColumnSettings({ layout, setLayout, resize }: {
  layout: ColumnLayout; setLayout: (update: (current: ColumnLayout) => ColumnLayout) => void; resize: (id: string, width: number) => void;
}) {
  return <details className="columnSettings">
    <summary><Columns3 size={17} />Columns</summary>
    <div className="columnSettingsBody">
      <div className="columnSettingsHeading"><strong>Schedule columns</strong><button type="button" className="ghostButton" onClick={() => setLayout(() => defaultColumnLayout())}><RotateCcw size={16} />Reset Layout</button></div>
      {layout.order.map((id, index) => {
        const column = scheduleColumns.find(item => item.id === id)!;
        const shown = !layout.hidden.includes(id);
        return <div className="columnSettingRow" key={id}>
          <label><input type="checkbox" checked={shown} disabled={shown && layout.hidden.length === layout.order.length - 1} onChange={() => setLayout(current => ({ ...current, hidden: shown ? [...current.hidden, id] : current.hidden.filter(item => item !== id) }))} />{column.label}</label>
          <button type="button" title={`Move ${column.label} left`} aria-label={`Move ${column.label} left`} disabled={index === 0} onClick={() => setLayout(current => reorderColumn(current, id, current.order[index - 1]))}><ArrowUp size={16} /></button>
          <button type="button" title={`Move ${column.label} right`} aria-label={`Move ${column.label} right`} disabled={index === layout.order.length - 1} onClick={() => setLayout(current => reorderColumn(current, id, current.order[index + 1]))}><ArrowDown size={16} /></button>
          <label className="columnWidthInput"><span>Width (px)</span><input key={layout.widths[id]} aria-label={`${column.label} width in pixels`} type="number" min={90} max={800} step={1} defaultValue={layout.widths[id]} onBlur={event => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) resize(id, value);
            event.target.value = String(Number.isFinite(value) ? Math.max(90, Math.min(800, value)) : layout.widths[id]);
          }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
        </div>;
      })}
    </div>
  </details>;
}

export function ScheduleColumnHeader({ id, label, width, onResize, onMove, children, sort }: {
  id: string; label: string; width: number; onResize: (width: number) => void; onMove: (source: string, target: string) => void; children: ReactNode; sort?: 'ascending' | 'descending';
}) {
  const drag = useRef<{ start: number; width: number } | null>(null);
  return <th className="resizableHeader" scope="col" aria-sort={sort} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-qc-column')) event.preventDefault(); }} onDrop={event => {
    const source = event.dataTransfer.getData('application/x-qc-column');
    if (source) { event.preventDefault(); onMove(source, id); }
  }}>
    <div className="scheduleColumnHeading"><span className="columnDragHandle" draggable title={`Drag to move ${label}`} aria-label={`Drag to move ${label}`} onDragStart={event => { event.dataTransfer.setData('application/x-qc-column', id); event.dataTransfer.effectAllowed = 'move'; }}><GripVertical size={14} /></span>{children}</div>
    <span className="columnResizeHandle" role="separator" aria-label={`Resize ${label}`} aria-orientation="vertical" aria-valuemin={90} aria-valuemax={800} aria-valuenow={width} tabIndex={0}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onResize(width + (event.key === 'ArrowRight' ? 10 : -10)); } }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { start: event.clientX, width }; }}
      onPointerMove={event => { if (drag.current) onResize(drag.current.width + event.clientX - drag.current.start); }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; }} />
  </th>;
}
