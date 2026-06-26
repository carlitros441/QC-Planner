import { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { formatDate } from './data';
import {
  activeUsage,
  AssayResourcesModal,
  daysUntil,
  isConsumable,
  quantityRemaining
} from './LabResources';
import type { AssayResourceUsage, LabResource, Personnel, Schedule } from './types';

const personName = (personnel: Personnel[], id?: string) => personnel.find(person => person.id === id)?.name || 'Unassigned';
const scheduleLabel = (schedule: Schedule) => `${schedule.batch_number} ${schedule.test_name} ${schedule.product_name || schedule.product_id} ${schedule.protocol_name}`.toLowerCase();

function StatusBadge({ status }: { status?: string }) {
  return <span className={`badge status-${(status || 'Scheduled').replace(/\s+/g, '-').toLowerCase()}`}>{status || 'Scheduled'}</span>;
}

function readiness(schedule: Schedule, resources: LabResource[], usages: AssayResourceUsage[]) {
  const requirements = schedule.resource_requirements || [];
  if (!requirements.length) return { label: 'No Plan', className: 'resource-inactive' };
  let dueSoon = false;
  for (const requirement of requirements) {
    const resource = resources.find(item => item.id === requirement.resource_id);
    if (!resource || resource.active === false) return { label: 'Needs Setup', className: 'resource-warning' };
    const dueDate = resource.type === 'Equipment' ? resource.calibration_due_date : resource.expiration_date;
    const due = daysUntil(dueDate);
    if ((resource.type === 'Equipment' && !resource.calibration_due_date) || due < 0) return { label: 'Blocked', className: 'resource-overdue' };
    if (isConsumable(resource) && quantityRemaining(resource, usages) < Number(requirement.quantity || 1)) return { label: 'Low Stock', className: 'resource-warning' };
    if (due <= 30) dueSoon = true;
  }
  return dueSoon ? { label: 'Due Soon', className: 'resource-warning' } : { label: 'Ready', className: 'resource-ok' };
}

export default function AssayExecution({
  schedules,
  resources,
  usages,
  personnel,
  refreshSchedules,
  refreshUsages,
  user,
  canLog,
  canManage
}: {
  schedules: Schedule[];
  resources: LabResource[];
  usages: AssayResourceUsage[];
  personnel: Personnel[];
  refreshSchedules: () => Promise<void>;
  refreshUsages: () => Promise<void>;
  user: User | null;
  canLog: boolean;
  canManage: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState('Open');
  const [readinessFilter, setReadinessFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Schedule | null>(null);
  const activeUsages = activeUsage(usages);
  const rows = useMemo(() => schedules
    .map(schedule => ({
      schedule,
      state: readiness(schedule, resources, usages),
      scheduleUsages: activeUsages.filter(usage => usage.schedule_id === schedule.id)
    }))
    .filter(row => (
      (statusFilter === 'All' || (statusFilter === 'Open' ? !['Completed', 'Deleted'].includes(row.schedule.status) : row.schedule.status === statusFilter)) &&
      (readinessFilter === 'All' || row.state.label === readinessFilter) &&
      (assigneeFilter === 'All' || row.schedule.assignee_id === assigneeFilter || row.schedule.reviewer_id === assigneeFilter || row.schedule.trainee_id === assigneeFilter) &&
      (!search || scheduleLabel(row.schedule).includes(search.toLowerCase()))
    ))
    .sort((left, right) => String(left.schedule.start_time || '').localeCompare(String(right.schedule.start_time || ''))), [schedules, resources, usages, activeUsages, statusFilter, readinessFilter, assigneeFilter, search]);
  const plannedCount = schedules.filter(schedule => (schedule.resource_requirements || []).length > 0).length;
  const blockedCount = schedules.filter(schedule => ['Blocked', 'Low Stock', 'Needs Setup'].includes(readiness(schedule, resources, usages).label)).length;
  const readyCount = schedules.filter(schedule => readiness(schedule, resources, usages).label === 'Ready').length;
  const analysts = personnel.filter(person => person.active !== false);

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">Assay execution</p><h1>Scheduled Assay Resources</h1></div></div>
      <div className="metricGrid">
        <div className="metricCard"><span>Generated</span><p>Scheduled assays</p><strong>{schedules.length}</strong></div>
        <div className="metricCard"><span>Linked</span><p>Assays with resource plans</p><strong>{plannedCount}</strong></div>
        <div className="metricCard"><span>Ready</span><p>Inventory and calibration available</p><strong>{readyCount}</strong></div>
        <div className="metricCard"><span>Attention</span><p>Needs setup or inventory action</p><strong>{blockedCount}</strong></div>
      </div>
      <div className="filtersBar assayResourceFilters">
        <label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option>Open</option><option>All</option><option>Scheduled</option><option>In Progress</option><option>Pending Review</option><option>Completed</option><option>Deleted</option></select></label>
        <label>Resources<select value={readinessFilter} onChange={event => setReadinessFilter(event.target.value)}><option>All</option><option>Ready</option><option>Due Soon</option><option>Low Stock</option><option>Needs Setup</option><option>Blocked</option><option>No Plan</option></select></label>
        <label>Person<select value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)}><option>All</option>{analysts.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>Search<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Batch, test, product, protocol" /></label>
      </div>
      <div className="tableWrap">
        <table>
          <thead><tr><th>Date</th><th>Scheduled Assay</th><th>People</th><th>Planned Resources</th><th>Recorded Usage</th><th>Readiness</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map(({ schedule, state, scheduleUsages }) => (
              <tr key={schedule.id}>
                <td>{formatDate(schedule.start_time) || '-'}</td>
                <td><strong>{schedule.batch_number} / {schedule.test_name}</strong><small>{schedule.product_name || schedule.product_id} / {schedule.protocol_name}</small><small>QC Sample ID: {schedule.qc_sample_id || 'Not set'}</small></td>
                <td><span>{personName(personnel, schedule.assignee_id)}</span><small>Reviewer: {personName(personnel, schedule.reviewer_id)}</small></td>
                <td>{(schedule.resource_requirements || []).length ? <div className="miniResourceList">{(schedule.resource_requirements || []).slice(0, 4).map(requirement => {
                  const resource = resources.find(item => item.id === requirement.resource_id);
                  return <span key={requirement.id}>{requirement.resource_type}: {requirement.resource_name}{resource ? ` (${isConsumable(resource) ? `${quantityRemaining(resource, usages)} ${resource.unit || ''}` : `cal ${formatDate(resource.calibration_due_date) || 'not set'}`})` : ''}</span>;
                })}</div> : <span className="resourceBadge resource-inactive">No Plan</span>}</td>
                <td><strong>{scheduleUsages.length}</strong><small>{scheduleUsages.slice(0, 3).map(usage => usage.resource_name).join(', ') || 'No usage recorded'}</small></td>
                <td><span className={`resourceBadge ${state.className}`}>{state.label}</span></td>
                <td><button className="primaryButton" onClick={() => setSelected(schedule)}>Open Resources</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}>No scheduled assays match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && <AssayResourcesModal schedule={selected} resources={resources} usages={usages} refreshUsages={refreshUsages} refreshSchedules={refreshSchedules} user={user} canLog={canLog} canManage={canManage} onClose={() => setSelected(null)} />}
    </section>
  );
}
