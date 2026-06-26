import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { addAuditEntry, formatDate, getOne, saveDoc } from './data';
import type { AssayResourceRequirement, AssayResourceUsage, LabResource, LabResourceType, Personnel, Schedule } from './types';

type Draft<T> = Partial<T> & { id?: string };

const currentUserInfo = (user: User | null) => user?.email || user?.uid || 'unknown';
const localDate = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
export const daysUntil = (value?: string) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const target = new Date(`${formatDate(value)}T00:00:00`);
  const today = new Date(`${localDate()}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};
export const isConsumable = (resource: LabResource) => resource.type !== 'Equipment';
export const activeUsage = (usages: AssayResourceUsage[]) => usages.filter(usage => usage.status !== 'Voided');
export const quantityUsed = (resourceId: string, usages: AssayResourceUsage[]) => activeUsage(usages)
  .filter(usage => usage.resource_id === resourceId)
  .reduce((sum, usage) => sum + Number(usage.quantity || 0), 0);
export const quantityRemaining = (resource: LabResource, usages: AssayResourceUsage[]) => Math.max(0, Number(resource.quantity_received || 0) - quantityUsed(resource.id, usages));

const resourceLabel = (resource: LabResource) => `${resource.type} / ${resource.name}${resource.lot_number ? ` / Lot ${resource.lot_number}` : ''}${resource.equipment_id ? ` / ${resource.equipment_id}` : ''}`;

export function normalizeRequirement(requirement: Partial<AssayResourceRequirement>, resources: LabResource[]): AssayResourceRequirement | null {
  const resource = resources.find(item => item.id === requirement.resource_id);
  if (!resource) return null;
  return {
    id: requirement.id || crypto.randomUUID(),
    resource_id: resource.id,
    resource_name: resource.name,
    resource_type: resource.type,
    quantity: resource.type === 'Equipment' ? 1 : Math.max(0.0001, Number(requirement.quantity || 1)),
    unit: resource.type === 'Equipment' ? 'use' : resource.unit || requirement.unit || '',
    notes: requirement.notes?.trim() || ''
  };
}

export function normalizeRequirements(requirements: AssayResourceRequirement[] | undefined, resources: LabResource[]) {
  return (requirements || [])
    .map(requirement => normalizeRequirement(requirement, resources))
    .filter((requirement): requirement is AssayResourceRequirement => Boolean(requirement));
}

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

export function ResourceStatus({ resource, usages }: { resource: LabResource; usages: AssayResourceUsage[] }) {
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

export function ResourceRequirementEditor({
  requirements,
  resources,
  usages,
  onChange,
  disabled = false,
  compact = false
}: {
  requirements: AssayResourceRequirement[];
  resources: LabResource[];
  usages?: AssayResourceUsage[];
  onChange: (requirements: AssayResourceRequirement[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const availableResources = resources.filter(resource => resource.active !== false);
  const setRequirement = (id: string, patch: Partial<AssayResourceRequirement>) => {
    onChange(requirements.map(requirement => {
      if (requirement.id !== id) return requirement;
      const resource = patch.resource_id ? resources.find(item => item.id === patch.resource_id) : undefined;
      return {
        ...requirement,
        ...patch,
        ...(resource ? {
          resource_id: resource.id,
          resource_name: resource.name,
          resource_type: resource.type,
          unit: resource.type === 'Equipment' ? 'use' : resource.unit || '',
          quantity: resource.type === 'Equipment' ? 1 : Math.max(0.0001, Number(requirement.quantity || 1))
        } : {})
      };
    }));
  };
  const addRequirement = () => {
    const resource = availableResources[0];
    if (!resource) {
      onChange([...requirements, {
        id: crypto.randomUUID(),
        resource_id: '',
        resource_name: '',
        resource_type: 'Material',
        quantity: 1,
        unit: '',
        notes: ''
      }]);
      return;
    }
    onChange([...requirements, {
      id: crypto.randomUUID(),
      resource_id: resource.id,
      resource_name: resource.name,
      resource_type: resource.type,
      quantity: resource.type === 'Equipment' ? 1 : 1,
      unit: resource.type === 'Equipment' ? 'use' : resource.unit || '',
      notes: ''
    }]);
  };

  return (
    <div className={`requirementList ${compact ? 'compactRequirementList' : ''}`}>
      {requirements.map(requirement => {
        const selected = resources.find(resource => resource.id === requirement.resource_id);
        return (
          <div className="resourceRequirementRow" key={requirement.id}>
            <label>Needed Resource<select disabled={disabled} value={requirement.resource_id || ''} onChange={event => setRequirement(requirement.id, { resource_id: event.target.value })}><option value="">Select material, reagent, or equipment</option>{availableResources.map(resource => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}</option>)}</select></label>
            <label>Quantity<input disabled={disabled || selected?.type === 'Equipment'} type="number" min={0.0001} step="any" value={requirement.quantity || 1} onChange={event => setRequirement(requirement.id, { quantity: Number(event.target.value || 1) })} /></label>
            <label>Unit<input disabled value={selected?.type === 'Equipment' ? 'use' : selected?.unit || requirement.unit || ''} /></label>
            {usages && selected && <div className="resourceSelectionSummary"><ResourceStatus resource={selected} usages={usages} /><span>{isConsumable(selected) ? `${quantityRemaining(selected, usages)} ${selected.unit || ''} available` : `Calibration due ${formatDate(selected.calibration_due_date) || 'not set'}`}</span></div>}
            <label>Notes<input disabled={disabled} value={requirement.notes || ''} onChange={event => setRequirement(requirement.id, { notes: event.target.value })} /></label>
            {!disabled && <button type="button" onClick={() => onChange(requirements.filter(item => item.id !== requirement.id))}>Remove</button>}
          </div>
        );
      })}
      {!requirements.length && <div className="emptyState">No material, reagent, or equipment requirements are linked yet.</div>}
      {!disabled && <button type="button" onClick={addRequirement}>Add Resource Requirement</button>}
    </div>
  );
}

export function AssayResourcesModal({
  schedule,
  resources,
  usages,
  refreshUsages,
  refreshSchedules,
  user,
  canLog,
  canManage,
  onClose
}: {
  schedule: Schedule;
  resources: LabResource[];
  usages: AssayResourceUsage[];
  refreshUsages: () => Promise<void>;
  refreshSchedules?: () => Promise<void>;
  user: User | null;
  canLog: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const scheduleUsages = usages.filter(usage => usage.schedule_id === schedule.id);
  const [resourceId, setResourceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [planned, setPlanned] = useState<AssayResourceRequirement[]>(() => normalizeRequirements(schedule.resource_requirements, resources));
  const [usageDrafts, setUsageDrafts] = useState<Record<string, { resource_id: string; quantity: number; notes: string }>>({});
  const [message, setMessage] = useState('');
  const selected = resources.find(resource => resource.id === resourceId);
  const remaining = selected ? quantityRemaining(selected, usages) : 0;
  const selectedDueDate = selected?.type === 'Equipment' ? selected.calibration_due_date : selected?.expiration_date;
  const selectedBlocked = !selected || selected.active === false || (selected.type === 'Equipment' && !selected.calibration_due_date) || daysUntil(selectedDueDate) < 0 || (isConsumable(selected) && (remaining <= 0 || quantity > remaining));
  const availableResources = resources.filter(resource => resource.active !== false);
  const canRecord = canLog && schedule.status !== 'Completed' && schedule.status !== 'Deleted';

  useEffect(() => {
    const normalized = normalizeRequirements(schedule.resource_requirements, resources);
    setPlanned(normalized);
    setUsageDrafts(Object.fromEntries(normalized.map(requirement => [requirement.id, { resource_id: requirement.resource_id, quantity: requirement.quantity || 1, notes: '' }])));
  }, [schedule.id, schedule.resource_requirements, resources]);

  const resourceBlocked = (resource: LabResource | undefined, requestedQuantity: number) => {
    if (!resource) return true;
    const dueDate = resource.type === 'Equipment' ? resource.calibration_due_date : resource.expiration_date;
    return resource.active === false
      || (resource.type === 'Equipment' && !resource.calibration_due_date)
      || daysUntil(dueDate) < 0
      || (isConsumable(resource) && (quantityRemaining(resource, usages) <= 0 || Number(requestedQuantity || 0) > quantityRemaining(resource, usages)));
  };

  const logUsageForResource = async (resource: LabResource, usedQuantity: number, usageNotes: string, requirementId?: string) => {
    if (!canRecord || resourceBlocked(resource, usedQuantity)) return;
    const actualQuantity = resource.type === 'Equipment' ? 1 : Number(usedQuantity || 0);
    if (actualQuantity <= 0) return setMessage('Enter a quantity greater than zero.');
    const payload: Omit<AssayResourceUsage, 'id'> = {
      schedule_id: schedule.id,
      requirement_id: requirementId || '',
      resource_id: resource.id,
      resource_name: resource.name,
      resource_type: resource.type,
      quantity: actualQuantity,
      unit: resource.type === 'Equipment' ? 'use' : resource.unit || '',
      lot_number: resource.lot_number || '',
      equipment_id: resource.equipment_id || '',
      used_at: new Date().toISOString(),
      used_by: currentUserInfo(user),
      notes: usageNotes.trim(),
      status: 'Active'
    };
    const usageId = await saveDoc('assayResourceUsage', payload);
    await addAuditEntry(schedule.id, 'RESOURCE_USAGE_LOGGED', null, { ...payload, id: usageId }, `Recorded ${resource.type.toLowerCase()} usage: ${resource.name}`, currentUserInfo(user));
    await refreshUsages();
    setMessage(`${resource.name} recorded for this assay.`);
  };

  const logUsage = async () => {
    if (!selected || selectedBlocked) return;
    await logUsageForResource(selected, selected.type === 'Equipment' ? 1 : quantity, notes);
    setResourceId('');
    setQuantity(1);
    setNotes('');
  };

  const recordRequirementUsage = async (requirement: AssayResourceRequirement) => {
    const draft = usageDrafts[requirement.id] || { resource_id: requirement.resource_id, quantity: requirement.quantity || 1, notes: '' };
    const resource = resources.find(item => item.id === draft.resource_id);
    if (!resource || resourceBlocked(resource, draft.quantity)) return;
    await logUsageForResource(resource, resource.type === 'Equipment' ? 1 : draft.quantity, draft.notes || requirement.notes || '', requirement.id);
    setUsageDrafts(current => ({ ...current, [requirement.id]: { resource_id: requirement.resource_id, quantity: requirement.quantity || 1, notes: '' } }));
  };

  const savePlan = async () => {
    if (!canManage) return;
    const nextPlan = normalizeRequirements(planned, resources);
    const before = await getOne<Schedule>('schedules', schedule.id) || schedule;
    const after = { ...before, resource_requirements: nextPlan, updated_by: currentUserInfo(user) };
    await saveDoc('schedules', after, schedule.id);
    await addAuditEntry(schedule.id, 'RESOURCE_PLAN_UPDATE', before, after, 'Updated assay resource plan', currentUserInfo(user));
    await refreshSchedules?.();
    setPlanned(nextPlan);
    setUsageDrafts(Object.fromEntries(nextPlan.map(requirement => [requirement.id, { resource_id: requirement.resource_id, quantity: requirement.quantity || 1, notes: '' }])));
    setMessage('Assay resource plan saved.');
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
      <div className="panel assayResourcePlan">
        <div className="panelHeader"><h2>Planned Execution Resources</h2>{canManage && <button onClick={savePlan}>Save Plan</button>}</div>
        {canManage ? <ResourceRequirementEditor requirements={planned} resources={resources} usages={usages} onChange={setPlanned} compact /> : <ResourceRequirementEditor requirements={planned} resources={resources} usages={usages} onChange={setPlanned} disabled compact />}
        {canRecord && planned.length > 0 && <div className="tableWrap">
          <table>
            <thead><tr><th>Required</th><th>Actual Dropdown</th><th>Quantity</th><th>Readiness</th><th>Notes</th><th>Action</th></tr></thead>
            <tbody>
              {planned.map(requirement => {
                const draft = usageDrafts[requirement.id] || { resource_id: requirement.resource_id, quantity: requirement.quantity || 1, notes: '' };
                const options = availableResources.filter(resource => resource.type === requirement.resource_type);
                const resource = resources.find(item => item.id === draft.resource_id);
                const blocked = resourceBlocked(resource, draft.quantity);
                return (
                  <tr key={requirement.id}>
                    <td><strong>{requirement.resource_name}</strong><small>{requirement.resource_type} / {requirement.quantity} {requirement.unit}</small></td>
                    <td><select value={draft.resource_id || ''} onChange={event => setUsageDrafts(current => ({ ...current, [requirement.id]: { ...draft, resource_id: event.target.value } }))}><option value="">Select {requirement.resource_type.toLowerCase()}</option>{options.map(option => <option key={option.id} value={option.id}>{resourceLabel(option)}</option>)}</select></td>
                    <td>{resource?.type === 'Equipment' ? '1 use' : <input type="number" min={0.0001} step="any" value={draft.quantity || 1} onChange={event => setUsageDrafts(current => ({ ...current, [requirement.id]: { ...draft, quantity: Number(event.target.value || 1) } }))} />}</td>
                    <td>{resource ? <div className="resourceSelectionSummary"><ResourceStatus resource={resource} usages={usages} /><span>{isConsumable(resource) ? `${quantityRemaining(resource, usages)} ${resource.unit || ''} available` : `Calibration due ${formatDate(resource.calibration_due_date) || 'not set'}`}</span></div> : 'Select resource'}</td>
                    <td><input value={draft.notes || ''} onChange={event => setUsageDrafts(current => ({ ...current, [requirement.id]: { ...draft, notes: event.target.value } }))} /></td>
                    <td><button className="primaryButton" disabled={blocked} onClick={() => recordRequirementUsage(requirement)}>Record</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}
      </div>
      {canRecord && <div className="resourceUsageForm">
        <label>Additional Resource<select value={resourceId} onChange={event => { setResourceId(event.target.value); setQuantity(1); setMessage(''); }}><option value="">Select material, reagent, or equipment</option>{availableResources.map(resource => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}</option>)}</select></label>
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
