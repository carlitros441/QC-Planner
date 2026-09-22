import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function MultiSelectFilter({ label, options, values, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const names = values.map(value => options.find(option => option.value === value)?.label || value);
  return <div className="multiFilter" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); }
  }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span id={`${id}-label`}>{label}</span>
    <button type="button" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-controls={`${id}-options`} onClick={() => { setOpen(!open); setSearch(''); }} title={names.join(', ') || 'All'}>
      <span id={`${id}-value`}>{values.length === 0 ? 'All' : values.length === 1 ? names[0] : `${values.length} selected`}</span><ChevronDown size={16} />
    </button>
    {open && <div className="multiFilterMenu" id={`${id}-options`} role="group" aria-label={label}>
      <input type="search" aria-label={`Search ${label}`} placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} />
      <label><input type="checkbox" checked={!values.length} onChange={() => onChange([])} />All</label>
      {options.filter(option => option.label.toLowerCase().includes(search.toLowerCase())).map(option => <label key={option.value}>
        <input type="checkbox" checked={values.includes(option.value)} onChange={() => onChange(values.includes(option.value) ? values.filter(value => value !== option.value) : [...values, option.value])} />{option.label}
      </label>)}
      {!options.some(option => option.label.toLowerCase().includes(search.toLowerCase())) && <p>No matching options</p>}
    </div>}
  </div>;
}
