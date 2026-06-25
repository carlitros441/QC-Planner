import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { addAuditEntry, formatDate, saveDoc } from './data';
import type { AssayResourceUsage, LabResource, LabResourceType, Personnel, Schedule } from './types';

type Draft<T> = Partial<T> & { id?: string };

const currentUserInfo = (user: User | null) => user?.email || user?.uid || 'unknown';
const localDate = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const daysUntil = (value?: string) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const target = new Date(`${formatDate(value)}T00:00:00`);
  const today = new Date(`${localDate()}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};
const isConsumable = (resource: LabResource) => resource.type !== 'Equipment';
const activeUsage = (usages: AssayResourceUsage[]) => usages.filter(usage => usage.status !== 'Voided');
const quantityUsed = (resourceId: string, usages: AssayResourceUsage[]) => activeUsage(usages)
  .filter(usage => usage.resource_id === resourceId)
  .reduce((sum, usage) => sum + Number(usage.quantity || 0), 0);
const quantityRemaining = (resource: LabResource, usages: AssayResourceUsage[]) => Math.max(0, Number(resource.quantity_received || 0) - quantityUsed(resource.id, usages));

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modalPanel wideModalPanel">
        <div className="modalHeader"><h2>{title}</h2><button className="ghostButton" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

function ResourceStatus({ resource, usages }: { resource: LabResource; usages: AssayResourceUsage[] }) {
  let label = 'Available';
  let className = 'resource-ok';
  const dueDate = resource.type === 'Equipment' ? resource.calibration_due_date : resource.expiration_date;
  const dueDays = daysUntil(dueDate);
  if (resource.active === false) {
    label = 'Inactive';
    className = 'resource-inactive';
  } else if (resource.type === 'Equipment' && !resource.calibration_due_date) {
    label = 'Calibration Not Set';
    className = 'resource-warning';
  } else if (dueDays < 0) {
    label = resource.type === 'Equipment' ? 'Calibration Overdue' : 'Expired';
    className = 'resource-overdue';
  } else if (isConsumable(resource) && quantityRemaining(resource, usages) <= Number(resource.minimum_quantity || 0)) {
    label = 'Low Stock';
    className = 'resource-warning';
  } else if (dueDays <= 30) {
    label = resource.type === 'Equipment' ? 'Calibration Due' : 'Expiring Soon';
    className = 'resource-warning';
  }
  return <span className={`resourceBadge ${className}`}>{label}</span>;
}

function emptyResource(): Draft<LabResource> {
  return {
    type: 'Material',
    name: '',
    catalog_number: '',
    lot_number: '',
    vendor: '',
    location: '',
    unit: 'each',
    quantity_received: 0,
    minimum_quantity: 0,
    expiration_date: '',
    equipment_id: '',
    calibration_due_date: '',
    notes: '',
    active: true
  };
}

function ResourceEditor({ resource, setResource, onSave }: { resource: Draft<LabResource>; setResource: (resource: Draft<LabResource>) => void; onSave: () => void }) {
  const equipment = resource.type === 'Equipment';
  return (
    <div className="formGrid">
      <label>Type<select value={resource.type || 'Material'} onChange={event => setResource({ ...resource, type: event.target.value as LabResourceType })}><option>Material</option><option>Reagent</option><option>Equipment</option></select></label>
      <label>Name<input required value={resource.name || ''} onChange={event => setResource({ ...resource, name: event.target.value })} /></label>
      {equipment ? <label>Equipment ID<input value={resource.equipment_id || ''} onChange={event => setResource({ ...resource, equipment_id: event.target.value })} /></label> : <label>Lot Number<input value={resource.lot_number || ''} onChange={event => setResource({ ...resource, lot_number: event.target.value })} /></label>}
      <label>Catalog / Model Number<input value={resource.catalog_number || ''} onChange={event => setResource({ ...resource, catalog_number: event.target.value })} /></label>
      <label>Vendor / Manufacturer<input value={resource.vendor || ''} onChange={event => setResource({ ...resource, vendor: event.target.value })} /></label>
      <label>Location<input value={resource.location || ''} onChange={event => setResource({ ...resource, location: event.target.value })} /></label>
      {equipment ? <label>Calibration Due<input type="date" value={formatDate(resource.calibration_due_date)} onChange={event => setResource({ ...resource, calibration_due_date: event.target.value })} /></label> : <>
        <label>Quantity Received<input type="number" min={0} step="any" value={resource.quantity_received || 0} onChange={event => setResource({ ...resource, quantity_received: Number(event.target.value || 0) })} /></label>
        <label>Unit<input value={resource.unit || ''} onChange={event => setResource({ ...resource, unit: event.target.value })} /></label>
        <label>Minimum Stock<input type="number" min={0} step="any" value={resource.minimum_quantity || 0} onChange={event => setResource({ ...resource, minimum_quantity: Number(event.target.value || 0) })} /></label>
        <label>Expiration Date<input type="date" value={formatDate(resource.expiration_date)} onChange={event => setResource({ ...resource, expiration_date: event.target.value })} /></label>
      </>}
      <label className="wide">Notes<input value={resource.notes || ''} onChange={event => setResource({ ...resource, notes: event.target.value })} /></label>
      <label className="checkLine wide"><input type="checkbox" checked={resource.active !== false} onChange={event => setResource({ ...resource, active: event.target.checked })} />Active</label>
      <button className="primaryButton wide" onClick={onSave}>Save Resource</button>
    </div>
  );
}

export function AssayResourcesModal({
  schedule,
  resources,
  usages,
  refreshUsages,
  user,
  canLog,
  canManage,
  onClose
}: {
  schedule: Schedule;
  resources: LabResource[];
  usages: AssayResourceUsage[];
  refreshUsages: () => Promise<void>;
  user: User | null;
  canLog: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const scheduleUsages = usages.filter(usage => usage.schedule_id === schedule.id);
  const [resourceId, setResourceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const selected = resources.find(resource => resource.id === resourceId);
  const remaining = selected ? quantityRemaining(selected, usages) : 0;
  const selectedDueDate = selected?.type === 'Equipment' ? selected.calibration_due_date : selected?.expiration_date;
  const selectedBlocked = !selected || selected.active === false || (selected.type === 'Equipment' && !selected.calibration_due_date) || daysUntil(selectedDueDate) < 0 || (isConsumable(selected) && (remaining <= 0 || quantity > remaining));
  const availableResources = resources.filter(resource => resource.active !== false);

  const logUsage = async () => {
    if (!canLog || !selected || selectedBlocked || schedule.status === 'Completed' || schedule.status === 'Deleted') return;
    const usedQuantity = selected.type === 'Equipment' ? 1 : Number(quantity || 0);
    if (usedQuantity <= 0) return setMessage('Enter a quantity greater than zero.');
    const payload: Omit<AssayResourceUsage, 'id'> = {
      schedule_id: schedule.id,
      resource_id: selected.id,
      resource_name: selected.name,
      resource_type: selected.type,
      quantity: usedQuantity,
      unit: selected.type === 'Equipment' ? 'use' : selected.unit || '',
      lot_number: selected.lot_number || '',
      equipment_id: selected.equipment_id || '',
      used_at: new Date().toISOString(),
      used_by: currentUserInfo(user),
      notes: notes.trim(),
      status: 'Active'
    };
    const usageId = await saveDoc('assayResourceUsage', payload);
    await addAuditEntry(schedule.id, 'RESOURCE_USAGE_LOGGED', null, { ...payload, id: usageId }, `Recorded ${selected.type.toLowerCase()} usage: ${selected.name}`, currentUserInfo(user));
    await refreshUsages();
    setResourceId('');
    setQuantity(1);
    setNotes('');
    setMessage(`${selected.name} recorded for this assay.`);
  };

  const voidUsage = async (usage: AssayResourceUsage) => {
    if (!canManage || usage.status === 'Voided') return;
    const reason = window.prompt('Reason for voiding this resource usage entry:');
    if (!reason) return;
    const after = { ...usage, status: 'Voided' as const, void_reason: reason, voided_at: new Date().toISOString(), voided_by: currentUserInfo(user) };
    await saveDoc('assayResourceUsage', after, usage.id);
    await addAuditEntry(schedule.id, 'RESOURCE_USAGE_VOIDED', usage, after, reason, currentUserInfo(user));
    await refreshUsages();
  };

  return (
    <Modal title="Assay Materials, Reagents & Equipment" onClose={onClose}>
      <div className="resourceAssayHeader">
        <div><strong>{schedule.batch_number}</strong><span>{schedule.test_name}</span></div>
        <span>{schedule.product_name || schedule.product_id}</span>
      </div>
      {message && <div className="infoBox">{message}</div>}
      {canLog && schedule.status !== 'Completed' && schedule.status !== 'Deleted' && <div className="resourceUsageForm">
        <label>Resource<select value={resourceId} onChange={event => { setResourceId(event.target.value); setQuantity(1); setMessage(''); }}><option value="">Select material, reagent, or equipment</option>{availableResources.map(resource => <option key={resource.id} value={resource.id}>{resource.type} / {resource.name}{resource.lot_number ? ` / Lot ${resource.lot_number}` : ''}{resource.equipment_id ? ` / ${resource.equipment_id}` : ''}</option>)}</select></label>
        {selected && <div className="resourceSelectionSummary"><ResourceStatus resource={selected} usages={usages} /><span>{isConsumable(selected) ? `${remaining} ${selected.unit || ''} available` : `Calibration due ${formatDate(selected.calibration_due_date) || 'not set'}`}</span></div>}
        {selected?.type !== 'Equipment' && <label>Quantity Used<input type="number" min={0.0001} max={remaining || undefined} step="any" value={quantity} onChange={event => setQuantity(Number(event.target.value || 0))} /></label>}
        <label>Notes<input value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <button className="primaryButton" disabled={selectedBlocked} onClick={logUsage}>Record Usage</button>
        {selectedBlocked && selected && <div className="errorBox">This resource cannot be used because it is expired, out of stock, inactive, over its available quantity, or overdue for calibration.</div>}
      </div>}
      <div className="tableWrap">
        <table>
          <thead><tr><th>Type</th><th>Resource</th><th>Lot / Equipment</th><th>Quantity</th><th>Used By</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {scheduleUsages.map(usage => <tr key={usage.id}><td>{usage.resource_type}</td><td>{usage.resource_name}</td><td>{usage.lot_number || usage.equipment_id || '-'}</td><td>{usage.quantity} {usage.unit}</td><td>{usage.used_by}</td><td>{formatDate(usage.used_at)}</td><td><span className={`resourceBadge ${usage.status === 'Voided' ? 'resource-inactive' : 'resource-ok'}`}>{usage.status}</span></td><td>{canManage && usage.status !== 'Voided' && <button onClick={() => voidUsage(usage)}>Void</button>}</td></tr>)}
            {!scheduleUsages.length && <tr><td colSpan={8}>No materials, reagents, or equipment recorded for this assay.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export default function LabResources({
  resources,
  usages,
  schedules,
  personnel,
  refreshResources,
  refreshUsages,
  user,
  canManage
}: {
  resources: LabResource[];
  usages: AssayResourceUsage[];
  schedules: Schedule[];
  personnel: Personnel[];
  refreshResources: () => Promise<void>;
  refreshUsages: () => Promise<void>;
  user: User | null;
  canManage: boolean;
}) {
  const [edit, setEdit] = useState<Draft<LabResource> | null>(null);
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const schedulesById = useMemo(() => new Map(schedules.map(schedule => [schedule.id, schedule])), [schedules]);
  const peopleByEmail = useMemo(() => new Map(personnel.map(person => [person.email.split(/[;,]/)[0].trim().toLowerCase(), person.name])), [personnel]);
  const resourceStatus = (resource: LabResource) => {
    const due = daysUntil(resource.type === 'Equipment' ? resource.calibration_due_date : resource.expiration_date);
    if (resource.active === false) return 'Inactive';
    if (resource.type === 'Equipment' && !resource.calibration_due_date) return 'Due Soon';
    if (due < 0) return 'Overdue';
    if (isConsumable(resource) && quantityRemaining(resource, usages) <= Number(resource.minimum_quantity || 0)) return 'Low Stock';
    if (due <= 30) return 'Due Soon';
    return 'Available';
  };
  const filtered = resources.filter(resource => (
    (typeFilter === 'All' || resource.type === typeFilter) &&
    (statusFilter === 'All' || resourceStatus(resource) === statusFilter) &&
    (!search || `${resource.name} ${resource.catalog_number || ''} ${resource.lot_number || ''} ${resource.equipment_id || ''}`.toLowerCase().includes(search.toLowerCase()))
  ));
  const lowStock = resources.filter(resource => isConsumable(resource) && resource.active !== false && quantityRemaining(resource, usages) <= Number(resource.minimum_quantity || 0)).length;
  const dueSoon = resources.filter(resource => {
    const due = daysUntil(resource.type === 'Equipment' ? resource.calibration_due_date : resource.expiration_date);
    return resource.active !== false && due >= 0 && due <= 30;
  }).length;
  const overdue = resources.filter(resource => resource.active !== false && daysUntil(resource.type === 'Equipment' ? resource.calibration_due_date : resource.expiration_date) < 0).length;

  const saveResource = async () => {
    if (!canManage || !edit?.name || !edit.type) return;
    const existing = edit.id ? resources.find(resource => resource.id === edit.id) : undefined;
    if (existing && existing.type !== edit.type && usages.some(usage => usage.resource_id === existing.id)) {
      setMessage('Resource type cannot be changed after assay usage has been recorded.');
      return;
    }
    if (edit.type === 'Equipment' && (!edit.equipment_id || !edit.calibration_due_date)) {
      setMessage('Equipment ID and calibration due date are required.');
      return;
    }
    if (edit.id && isConsumable(edit as LabResource) && Number(edit.quantity_received || 0) < quantityUsed(edit.id, usages)) {
      setMessage('Quantity received cannot be lower than the quantity already used.');
      return;
    }
    const payload: Draft<LabResource> = {
      ...edit,
      name: edit.name.trim(),
      active: edit.active !== false,
      updated_by: currentUserInfo(user),
      created_by: edit.created_by || currentUserInfo(user)
    };
    if (edit.type === 'Equipment') {
      Object.assign(payload, {
        lot_number: '',
        unit: '',
        quantity_received: 0,
        minimum_quantity: 0,
        expiration_date: ''
      });
    } else {
      Object.assign(payload, {
        equipment_id: '',
        calibration_due_date: ''
      });
    }
    await saveDoc('labResources', payload, edit.id);
    await refreshResources();
    setEdit(null);
    setMessage('Laboratory resource saved.');
  };

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">Laboratory control</p><h1>Lab Inventory</h1></div>{canManage && <button onClick={() => setEdit(emptyResource())}>Add Resource</button>}</div>
      {message && <div className="infoBox">{message}</div>}
      <div className="metricGrid">
        <div className="metricCard"><span>Active</span><p>Tracked resources</p><strong>{resources.filter(resource => resource.active !== false).length}</strong></div>
        <div className="metricCard"><span>Stock</span><p>At or below minimum</p><strong>{lowStock}</strong></div>
        <div className="metricCard"><span>Due</span><p>Within 30 days</p><strong>{dueSoon}</strong></div>
        <div className="metricCard"><span>Overdue</span><p>Expired or calibration overdue</p><strong>{overdue}</strong></div>
      </div>
      <div className="filtersBar resourceFilters">
        <label>Type<select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option>All</option><option>Material</option><option>Reagent</option><option>Equipment</option></select></label>
        <label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option>All</option><option>Available</option><option>Low Stock</option><option>Due Soon</option><option>Overdue</option><option>Inactive</option></select></label>
        <label>Search<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, lot, catalog, equipment ID" /></label>
      </div>
      <div className="tableWrap">
        <table>
          <thead><tr><th>Type</th><th>Name</th><th>Lot / Equipment ID</th><th>Inventory</th><th>Expiration / Calibration</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(resource => <tr key={resource.id}><td>{resource.type}</td><td><strong>{resource.name}</strong><small>{resource.catalog_number || resource.vendor || ''}</small></td><td>{resource.lot_number || resource.equipment_id || '-'}</td><td>{isConsumable(resource) ? `${quantityRemaining(resource, usages)} / ${resource.quantity_received || 0} ${resource.unit || ''}` : 'Tracked asset'}</td><td>{formatDate(resource.type === 'Equipment' ? resource.calibration_due_date : resource.expiration_date) || 'Not set'}</td><td>{resource.location || '-'}</td><td><ResourceStatus resource={resource} usages={usages} /></td><td>{canManage && <button onClick={() => setEdit(resource)}>Edit</button>}</td></tr>)}
            {!filtered.length && <tr><td colSpan={8}>No laboratory resources match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <div className="panelHeader"><h2>Recent Assay Usage</h2><span>{activeUsage(usages).length} active entries</span></div>
        <div className="compactList">
          {usages.slice().sort((a, b) => b.used_at.localeCompare(a.used_at)).slice(0, 20).map(usage => {
            const schedule = schedulesById.get(usage.schedule_id);
            return <div className="recordRow" key={usage.id}><div><strong>{usage.resource_name}</strong><span>{schedule ? `${schedule.batch_number} / ${schedule.test_name}` : usage.schedule_id}</span><small>{usage.quantity} {usage.unit} / {peopleByEmail.get(usage.used_by.toLowerCase()) || usage.used_by} / {formatDate(usage.used_at)}</small></div><span className={`resourceBadge ${usage.status === 'Voided' ? 'resource-inactive' : 'resource-ok'}`}>{usage.status}</span></div>;
          })}
          {!usages.length && <p>No assay resource usage has been recorded.</p>}
        </div>
      </div>
      {canManage && edit && <Modal title="Laboratory Resource" onClose={() => setEdit(null)}><ResourceEditor resource={edit} setResource={setEdit} onSave={saveResource} /></Modal>}
    </section>
  );
}
