import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { addAuditEntry, addDays, formatDate, removeDoc, saveDoc } from './data';
import type {
  Personnel,
  Product,
  Schedule,
  StabilityAssignment,
  StabilityFilters,
  StabilityProgram,
  StabilityProgramStatus,
  StabilityProtocol,
  StabilityTestTemplate,
  StabilityTimePointTemplate
} from './types';

type Draft<T> = Partial<T> & { id?: string };

const defaultStabilityFilters: StabilityFilters = {
  product: 'All',
  batch: 'All',
  protocol: 'All',
  timePoint: 'All',
  status: 'All',
  analyst: 'All',
  priority: 'All',
  dueWindow: 'All'
};

const defaultTimePoints: StabilityTimePointTemplate[] = [1, 3, 6, 12, 18, 24].map(months => ({
  id: crypto.randomUUID(),
  label: `${months}M`,
  months,
  window_start_offset_days: -30,
  window_end_offset_days: 15,
  tests: []
}));

const currentUserInfo = (user: User | null) => user?.email || user?.uid || 'unknown';
const activePersonnel = (personnel: Personnel[]) => personnel.filter(person => person.active !== false);

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addCalendarMonths(dateString: string, months: number) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const targetMonth = month - 1 + Number(months || 0);
  const target = new Date(year, targetMonth, day);
  const expectedMonth = ((targetMonth % 12) + 12) % 12;
  if (target.getMonth() !== expectedMonth) target.setDate(0);
  return localDate(target);
}

function diffDays(dateString: string) {
  if (!dateString) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateString}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

function statusForAssignment(program: StabilityProgram, assignment: StabilityAssignment, schedule?: Schedule) {
  if (schedule?.status) return schedule.status;
  return program.status;
}

function priorityForAssignment(assignment: StabilityAssignment, status: string) {
  if (status === 'Completed' || status === 'Deleted' || !assignment.include) return 'None';
  const basis = assignment.window_start || assignment.target_date || assignment.start_time;
  const days = diffDays(basis);
  if (days < 0) return 'High';
  if (days <= 30) return 'High';
  if (days <= 90) return 'Low';
  return 'None';
}

function dueWindowForAssignment(assignment: StabilityAssignment) {
  const days = diffDays(assignment.window_start || assignment.target_date || assignment.start_time);
  if (days < 0) return 'Overdue/Open';
  if (days <= 30) return 'Within 1 month';
  if (days <= 90) return 'Within 3 months';
  return 'Later';
}

function buildAssignments(protocol: StabilityProtocol, harvestDay: string): StabilityAssignment[] {
  return (protocol.time_points || []).flatMap(timePoint => {
    const target = addCalendarMonths(harvestDay, timePoint.months);
    const windowStart = addDays(target, timePoint.window_start_offset_days);
    const windowEnd = addDays(target, timePoint.window_end_offset_days);
    return (timePoint.tests || []).map(test => ({
      id: crypto.randomUUID(),
      time_point_id: timePoint.id,
      time_point_label: timePoint.label,
      months: Number(timePoint.months || 0),
      target_date: target,
      window_start: windowStart,
      window_end: windowEnd,
      window_start_offset_days: Number(timePoint.window_start_offset_days ?? -30),
      window_end_offset_days: Number(timePoint.window_end_offset_days ?? 15),
      test_name: test.name,
      qc_sample_id: test.qc_sample_id || '',
      include: true,
      assignee_id: '',
      trainee_id: '',
      reviewer_id: '',
      start_time: target,
      duration_days: 1
    }));
  });
}

function emptyProtocol(): Draft<StabilityProtocol> {
  return {
    name: '',
    description: '',
    time_points: defaultTimePoints.map(timePoint => ({ ...timePoint, id: crypto.randomUUID(), tests: [] }))
  };
}

function emptyProgram(): Draft<StabilityProgram> {
  return {
    product_id: '',
    product_name: '',
    batch_number: '',
    harvest_day_zero: '',
    protocol_id: '',
    protocol_name: '',
    status: 'Draft',
    assignments: []
  };
}

function assignStatusClass(status: string) {
  if (status === 'Draft') return 'status-scheduled';
  return `status-${status.replace(/\s+/g, '-').toLowerCase()}`;
}

function StabilityBadge({ status }: { status: string }) {
  return <span className={`badge ${assignStatusClass(status)}`}>{status}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`priorityBadge priority-${priority.toLowerCase()}`}>{priority}</span>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modalPanel wideModalPanel">
        <div className="modalHeader">
          <h2>{title}</h2>
          <button className="ghostButton" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProgramEditor({
  program,
  protocols,
  products,
  personnel,
  setProgram,
  onSave,
  onPush
}: {
  program: Draft<StabilityProgram>;
  protocols: StabilityProtocol[];
  products: Product[];
  personnel: Personnel[];
  setProgram: (program: Draft<StabilityProgram>) => void;
  onSave: (program: Draft<StabilityProgram>) => Promise<void>;
  onPush: (program: Draft<StabilityProgram>) => Promise<void>;
}) {
  const selectedProtocol = protocols.find(protocol => protocol.id === program.protocol_id);
  const people = activePersonnel(personnel);
  const assignments = program.assignments || [];
  const setAssignment = (id: string, patch: Partial<StabilityAssignment>) => {
    setProgram({
      ...program,
      assignments: assignments.map(assignment => assignment.id === id ? { ...assignment, ...patch } : assignment)
    });
  };
  const removeAssignment = (id: string) => setProgram({ ...program, assignments: assignments.filter(assignment => assignment.id !== id) });
  const chooseProduct = (productId: string) => {
    const product = products.find(item => item.id === productId);
    setProgram({ ...program, product_id: productId, product_name: product?.name || '' });
  };
  const chooseProtocol = (protocolId: string) => {
    const protocol = protocols.find(item => item.id === protocolId);
    setProgram({
      ...program,
      protocol_id: protocolId,
      protocol_name: protocol?.name || '',
      assignments: protocol && program.harvest_day_zero ? buildAssignments(protocol, program.harvest_day_zero) : []
    });
  };
  const chooseHarvest = (harvestDay: string) => {
    setProgram({
      ...program,
      harvest_day_zero: harvestDay,
      assignments: selectedProtocol ? buildAssignments(selectedProtocol, harvestDay) : []
    });
  };
  const addCustomAssignment = () => {
    const target = program.harvest_day_zero || localDate(new Date());
    setProgram({
      ...program,
      assignments: [
        ...assignments,
        {
          id: crypto.randomUUID(),
          time_point_id: crypto.randomUUID(),
          time_point_label: 'Custom',
          months: 0,
          target_date: target,
          window_start: addDays(target, -30),
          window_end: addDays(target, 15),
          window_start_offset_days: -30,
          window_end_offset_days: 15,
          test_name: '',
          qc_sample_id: '',
          include: true,
          assignee_id: '',
          trainee_id: '',
          reviewer_id: '',
          start_time: target,
          duration_days: 1
        }
      ]
    });
  };

  return (
    <form className="formGrid" onSubmit={event => { event.preventDefault(); onSave(program); }}>
      <label>Product Name<select required value={program.product_id || ''} onChange={event => chooseProduct(event.target.value)}><option value="">Select product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label>Batch Number<input required value={program.batch_number || ''} onChange={event => setProgram({ ...program, batch_number: event.target.value })} /></label>
      <label>Harvest Day<input required type="date" value={formatDate(program.harvest_day_zero)} onChange={event => chooseHarvest(event.target.value)} /></label>
      <label>Stability Protocol<select required value={program.protocol_id || ''} onChange={event => chooseProtocol(event.target.value)}><option value="">Select protocol</option>{protocols.map(protocol => <option key={protocol.id} value={protocol.id}>{protocol.name}</option>)}</select></label>
      <div className="wide stabilityAssignmentHeader">
        <div>
          <h3>Draft Time Point Assignments</h3>
          <p>Review and edit each draft row before pushing it into the regular schedule queue.</p>
        </div>
        <button type="button" onClick={addCustomAssignment}>Add Custom Row</button>
      </div>
      <div className="wide stabilityAssignmentList">
        {assignments.map(assignment => (
          <div className="stabilityAssignment" key={assignment.id}>
            <label className="checkLine"><input type="checkbox" checked={assignment.include} onChange={event => setAssignment(assignment.id, { include: event.target.checked })} />Include</label>
            <label>Time Point<input value={assignment.time_point_label} onChange={event => setAssignment(assignment.id, { time_point_label: event.target.value })} /></label>
            <label>Months<input type="number" value={assignment.months} onChange={event => {
              const months = Number(event.target.value || 0);
              const target = addCalendarMonths(program.harvest_day_zero || localDate(new Date()), months);
              setAssignment(assignment.id, { months, target_date: target, window_start: addDays(target, assignment.window_start_offset_days), window_end: addDays(target, assignment.window_end_offset_days), start_time: target });
            }} /></label>
            <label>Target Date<input type="date" value={formatDate(assignment.target_date)} onChange={event => setAssignment(assignment.id, { target_date: event.target.value })} /></label>
            <label>Window Start<input type="date" value={formatDate(assignment.window_start)} onChange={event => setAssignment(assignment.id, { window_start: event.target.value })} /></label>
            <label>Window End<input type="date" value={formatDate(assignment.window_end)} onChange={event => setAssignment(assignment.id, { window_end: event.target.value })} /></label>
            <label>Test<input value={assignment.test_name} onChange={event => setAssignment(assignment.id, { test_name: event.target.value })} /></label>
            <label>QC Sample ID<input value={assignment.qc_sample_id || ''} onChange={event => setAssignment(assignment.id, { qc_sample_id: event.target.value })} /></label>
            <label>Main Analyst<select disabled={!assignment.include} required={assignment.include} value={assignment.assignee_id} onChange={event => setAssignment(assignment.id, { assignee_id: event.target.value, trainee_id: assignment.trainee_id === event.target.value ? '' : assignment.trainee_id, reviewer_id: assignment.reviewer_id === event.target.value ? '' : assignment.reviewer_id })}><option value="">Select analyst</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label>Trainee<select disabled={!assignment.include} value={assignment.trainee_id || ''} onChange={event => setAssignment(assignment.id, { trainee_id: event.target.value, reviewer_id: assignment.reviewer_id === event.target.value ? '' : assignment.reviewer_id })}><option value="">No trainee</option>{people.filter(person => person.id !== assignment.assignee_id && person.id !== assignment.reviewer_id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label>QC Reviewer<select disabled={!assignment.include} required={assignment.include} value={assignment.reviewer_id} onChange={event => setAssignment(assignment.id, { reviewer_id: event.target.value, trainee_id: assignment.trainee_id === event.target.value ? '' : assignment.trainee_id })}><option value="">Select reviewer</option>{people.filter(person => person.id !== assignment.assignee_id && person.id !== assignment.trainee_id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label>Scheduled Date<input disabled={!assignment.include} required={assignment.include} min={assignment.window_start} max={assignment.window_end} type="date" value={formatDate(assignment.start_time)} onChange={event => setAssignment(assignment.id, { start_time: event.target.value })} /></label>
            <label>Duration<input type="number" min={1} value={assignment.duration_days || 1} onChange={event => setAssignment(assignment.id, { duration_days: Number(event.target.value || 1) })} /></label>
            <button type="button" onClick={() => removeAssignment(assignment.id)}>Remove</button>
          </div>
        ))}
        {!assignments.length && <p className="emptyState">Select a protocol and harvest day to build a draft stability plan.</p>}
      </div>
      <button className="primaryButton" type="submit">Save Draft</button>
      <button className="primaryButton" type="button" onClick={() => onPush(program)}>Push To Schedules</button>
    </form>
  );
}

function ProtocolEditor({
  protocol,
  setProtocol,
  onSave
}: {
  protocol: Draft<StabilityProtocol>;
  setProtocol: (protocol: Draft<StabilityProtocol>) => void;
  onSave: (protocol: Draft<StabilityProtocol>) => Promise<void>;
}) {
  const timePoints = protocol.time_points || [];
  const setTimePoint = (id: string, patch: Partial<StabilityTimePointTemplate>) => {
    setProtocol({ ...protocol, time_points: timePoints.map(point => point.id === id ? { ...point, ...patch } : point) });
  };
  const setTest = (timePointId: string, testId: string, patch: Partial<StabilityTestTemplate>) => {
    setProtocol({
      ...protocol,
      time_points: timePoints.map(point => point.id === timePointId ? {
        ...point,
        tests: (point.tests || []).map(test => test.id === testId ? { ...test, ...patch } : test)
      } : point)
    });
  };
  const addTimePoint = () => setProtocol({
    ...protocol,
    time_points: [
      ...timePoints,
      { id: crypto.randomUUID(), label: 'Custom', months: 0, window_start_offset_days: -30, window_end_offset_days: 15, tests: [] }
    ]
  });
  const addTest = (timePointId: string) => setProtocol({
    ...protocol,
    time_points: timePoints.map(point => point.id === timePointId ? { ...point, tests: [...(point.tests || []), { id: crypto.randomUUID(), name: '', qc_sample_id: '' }] } : point)
  });

  return (
    <form className="formGrid" onSubmit={event => { event.preventDefault(); onSave(protocol); }}>
      <label>Protocol Name<input required value={protocol.name || ''} onChange={event => setProtocol({ ...protocol, name: event.target.value })} /></label>
      <label className="wide">Description<input value={protocol.description || ''} onChange={event => setProtocol({ ...protocol, description: event.target.value })} /></label>
      <div className="wide stabilityAssignmentHeader">
        <div>
          <h3>Time Points</h3>
          <p>Defaults are 1, 3, 6, 12, 18, and 24 months. Each time point can have its own tests and testing window.</p>
        </div>
        <button type="button" onClick={addTimePoint}>Add Time Point</button>
      </div>
      <div className="wide stabilityProtocolBuilder">
        {timePoints.map(point => (
          <div className="stabilityTimePoint" key={point.id}>
            <div className="inlineEdit stabilityTimePointRow">
              <input placeholder="Label" value={point.label} onChange={event => setTimePoint(point.id, { label: event.target.value })} />
              <input type="number" placeholder="Months" value={point.months} onChange={event => setTimePoint(point.id, { months: Number(event.target.value || 0) })} />
              <input type="number" placeholder="Window start days" value={point.window_start_offset_days} onChange={event => setTimePoint(point.id, { window_start_offset_days: Number(event.target.value || 0) })} />
              <input type="number" placeholder="Window end days" value={point.window_end_offset_days} onChange={event => setTimePoint(point.id, { window_end_offset_days: Number(event.target.value || 0) })} />
              <button type="button" onClick={() => setProtocol({ ...protocol, time_points: timePoints.filter(item => item.id !== point.id) })}>Remove</button>
            </div>
            <div className="stabilityTests">
              {(point.tests || []).map(test => <div className="inlineEdit stabilityTestRow" key={test.id}><input placeholder="QC test name" value={test.name} onChange={event => setTest(point.id, test.id, { name: event.target.value })} /><input placeholder="QC Sample ID" value={test.qc_sample_id || ''} onChange={event => setTest(point.id, test.id, { qc_sample_id: event.target.value })} /><button type="button" onClick={() => setTimePoint(point.id, { tests: (point.tests || []).filter(item => item.id !== test.id) })}>Remove Test</button></div>)}
              <button type="button" onClick={() => addTest(point.id)}>Add Test To {point.label || 'Time Point'}</button>
            </div>
          </div>
        ))}
      </div>
      <button className="primaryButton wide" type="submit">Save Stability Protocol</button>
    </form>
  );
}

export default function Stability({
  products,
  personnel,
  schedules,
  protocols,
  programs,
  refreshProtocols,
  refreshPrograms,
  refreshSchedules,
  user,
  canManage
}: {
  products: Product[];
  personnel: Personnel[];
  schedules: Schedule[];
  protocols: StabilityProtocol[];
  programs: StabilityProgram[];
  refreshProtocols: () => Promise<void>;
  refreshPrograms: () => Promise<void>;
  refreshSchedules: () => Promise<void>;
  user: User | null;
  canManage: boolean;
}) {
  const [filters, setFilters] = useState<StabilityFilters>(defaultStabilityFilters);
  const [message, setMessage] = useState('');
  const [protocolEdit, setProtocolEdit] = useState<Draft<StabilityProtocol> | null>(null);
  const [programEdit, setProgramEdit] = useState<Draft<StabilityProgram> | null>(null);
  const [detail, setDetail] = useState<StabilityProgram | null>(null);
  const schedulesById = useMemo(() => new Map(schedules.map(schedule => [schedule.id, schedule])), [schedules]);
  const productsById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const getPersonName = (id?: string) => personnel.find(person => person.id === id)?.name || 'Unassigned';
  const assignmentRows = programs.flatMap(program => (program.assignments || []).map(assignment => {
    const schedule = assignment.generated_schedule_id ? schedulesById.get(assignment.generated_schedule_id) : undefined;
    const status = statusForAssignment(program, assignment, schedule);
    const priority = priorityForAssignment(assignment, status);
    return { program, assignment, schedule, status, priority, dueWindow: dueWindowForAssignment(assignment) };
  }));
  const filteredRows = assignmentRows.filter(row => (
    (filters.product === 'All' || row.program.product_name === filters.product) &&
    (filters.batch === 'All' || row.program.batch_number === filters.batch) &&
    (filters.protocol === 'All' || row.program.protocol_name === filters.protocol) &&
    (filters.timePoint === 'All' || row.assignment.time_point_label === filters.timePoint) &&
    (filters.status === 'All' || row.status === filters.status) &&
    (filters.analyst === 'All' || [row.assignment.assignee_id, row.assignment.trainee_id, row.assignment.reviewer_id].includes(filters.analyst)) &&
    (filters.priority === 'All' || row.priority === filters.priority) &&
    (filters.dueWindow === 'All' || row.dueWindow === filters.dueWindow)
  ));
  const highPriority = assignmentRows.filter(row => row.priority === 'High' && row.status !== 'Completed' && row.status !== 'Deleted').length;
  const lowPriority = assignmentRows.filter(row => row.priority === 'Low' && row.status !== 'Completed' && row.status !== 'Deleted').length;
  const filterOptions = {
    products: [...new Set(programs.map(program => program.product_name).filter(Boolean))],
    batches: [...new Set(programs.map(program => program.batch_number).filter(Boolean))],
    protocols: [...new Set(programs.map(program => program.protocol_name).filter(Boolean))],
    timePoints: [...new Set(assignmentRows.map(row => row.assignment.time_point_label).filter(Boolean))]
  };

  const validateProtocol = (protocol: Draft<StabilityProtocol>) => {
    if (!protocol.name) return 'Protocol name is required.';
    if (!(protocol.time_points || []).length) return 'Add at least one time point.';
    for (const point of protocol.time_points || []) {
      if (!point.label) return 'Each time point needs a label.';
      if (!(point.tests || []).some(test => test.name.trim())) return `Add at least one test for ${point.label}.`;
    }
    return '';
  };

  const saveProtocol = async (protocol: Draft<StabilityProtocol>) => {
    if (!canManage) return;
    const error = validateProtocol(protocol);
    if (error) return setMessage(error);
    const payload = {
      ...protocol,
      time_points: (protocol.time_points || []).map(point => ({
        ...point,
        tests: (point.tests || []).map(test => ({ ...test, name: test.name.trim(), qc_sample_id: test.qc_sample_id?.trim() || '' })).filter(test => test.name)
      }))
    };
    await saveDoc('stabilityProtocols', payload, protocol.id);
    await refreshProtocols();
    setProtocolEdit(null);
    setMessage('Stability protocol saved.');
  };

  const validateProgram = (program: Draft<StabilityProgram>) => {
    if (!program.product_id || !program.product_name) return 'Select a product.';
    if (!program.batch_number) return 'Batch Number is required.';
    if (!program.harvest_day_zero) return 'Harvest Day is required.';
    if (!program.protocol_id || !program.protocol_name) return 'Select a stability protocol.';
    if (!(program.assignments || []).some(assignment => assignment.include)) return 'Include at least one draft assignment.';
    for (const assignment of (program.assignments || []).filter(item => item.include)) {
      if (!assignment.test_name) return 'Each included row needs a test name.';
      if (!assignment.assignee_id || !assignment.reviewer_id || !assignment.start_time) return `Complete analyst, reviewer, and schedule date for ${assignment.test_name}.`;
      if (assignment.assignee_id === assignment.reviewer_id) return `Reviewer must be different from main analyst for ${assignment.test_name}.`;
      if (assignment.trainee_id && assignment.trainee_id === assignment.assignee_id) return `Trainee must be different from main analyst for ${assignment.test_name}.`;
      if (assignment.trainee_id && assignment.trainee_id === assignment.reviewer_id) return `Trainee must be different from reviewer for ${assignment.test_name}.`;
      if (assignment.start_time < assignment.window_start || assignment.start_time > assignment.window_end) return `${assignment.test_name} scheduled date must be inside its testing window.`;
    }
    return '';
  };

  const saveProgram = async (program: Draft<StabilityProgram>) => {
    if (!canManage) return;
    const error = validateProgram(program);
    if (error) return setMessage(error);
    const payload = { ...program, status: program.status || 'Draft' as StabilityProgramStatus, updated_by: currentUserInfo(user) };
    if (!program.id) payload.created_by = currentUserInfo(user);
    const id = await saveDoc('stabilityPrograms', payload, program.id);
    await refreshPrograms();
    setProgramEdit({ ...payload, id });
    setMessage('Stability draft saved.');
  };

  const pushProgram = async (program: Draft<StabilityProgram>) => {
    if (!canManage) return;
    const error = validateProgram(program);
    if (error) return setMessage(error);
    const savedProgram = { ...program, status: program.status || 'Draft' as StabilityProgramStatus };
    let programId = savedProgram.id;
    if (!programId) {
      programId = await saveDoc('stabilityPrograms', { ...savedProgram, created_by: currentUserInfo(user), updated_by: currentUserInfo(user) });
      savedProgram.id = programId;
    }
    const assignments = (savedProgram.assignments || []).filter(assignment => assignment.include && !assignment.generated_schedule_id);
    if (!assignments.length) return setMessage('No unpushed stability assignments are available.');
    const generatedIds: string[] = [];
    const updatedAssignments = [...(savedProgram.assignments || [])];
    for (const assignment of assignments) {
      const schedule: Omit<Schedule, 'id'> = {
        product_id: savedProgram.product_id || '',
        product_name: savedProgram.product_name || '',
        batch_number: savedProgram.batch_number || '',
        protocol_name: `Stability - ${savedProgram.protocol_name || 'Protocol'}`,
        protocol_type: 'QC Sample Plan',
        stability_program_id: programId,
        stability_protocol_id: savedProgram.protocol_id,
        stability_time_point_id: assignment.time_point_id,
        stability_time_point_label: assignment.time_point_label,
        stability_target_date: assignment.target_date,
        stability_window_start: assignment.window_start,
        stability_window_end: assignment.window_end,
        harvest_day_zero: savedProgram.harvest_day_zero,
        delta_day: null,
        qc_sample_id: assignment.qc_sample_id || '',
        test_name: assignment.test_name,
        workflow_step: `${assignment.time_point_label} stability test`,
        assignee_id: assignment.assignee_id,
        trainee_id: assignment.trainee_id || '',
        reviewer_id: assignment.reviewer_id,
        start_time: assignment.start_time,
        end_time: '',
        is_all_day: true,
        duration_days: assignment.duration_days || 1,
        status: 'Scheduled',
        progress: 0,
        review_status: 'Not Ready',
        email_status: 'pending',
        created_by: currentUserInfo(user)
      };
      const scheduleId = await saveDoc('schedules', schedule);
      generatedIds.push(scheduleId);
      const index = updatedAssignments.findIndex(item => item.id === assignment.id);
      if (index >= 0) updatedAssignments[index] = { ...updatedAssignments[index], generated_schedule_id: scheduleId };
      await addAuditEntry(scheduleId, 'STABILITY_SCHEDULE_CREATE', null, schedule, `Generated from QC Stability program ${savedProgram.batch_number}`, currentUserInfo(user));
    }
    const nextProgram = {
      ...savedProgram,
      id: programId,
      assignments: updatedAssignments,
      generated_schedule_ids: [...(savedProgram.generated_schedule_ids || []), ...generatedIds],
      status: 'Scheduled' as StabilityProgramStatus,
      pushed_by: currentUserInfo(user),
      pushed_at: new Date().toISOString(),
      updated_by: currentUserInfo(user)
    };
    await saveDoc('stabilityPrograms', nextProgram, programId);
    await refreshPrograms();
    await refreshSchedules();
    setProgramEdit(nextProgram);
    setMessage(`${generatedIds.length} stability assignments pushed to Schedules.`);
  };

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">Stability control</p><h1>QC Stability</h1></div>{canManage && <button onClick={() => setProgramEdit(emptyProgram())}>Create Stability Program</button>}</div>
      {message && <div className="infoBox">{message}</div>}
      <div className="metricGrid">
        <div className="metricCard"><span>Programs</span><p>Draft stability programs</p><strong>{programs.filter(program => program.status === 'Draft').length}</strong></div>
        <div className="metricCard"><span>High</span><p>Due within 1 month</p><strong>{highPriority}</strong></div>
        <div className="metricCard"><span>Upcoming</span><p>Due within 3 months</p><strong>{lowPriority}</strong></div>
      </div>
      <div className="filtersBar">
        <label>Product<select value={filters.product} onChange={event => setFilters({ ...filters, product: event.target.value })}><option>All</option>{filterOptions.products.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Batch<select value={filters.batch} onChange={event => setFilters({ ...filters, batch: event.target.value })}><option>All</option>{filterOptions.batches.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Protocol<select value={filters.protocol} onChange={event => setFilters({ ...filters, protocol: event.target.value })}><option>All</option>{filterOptions.protocols.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Time Point<select value={filters.timePoint} onChange={event => setFilters({ ...filters, timePoint: event.target.value })}><option>All</option>{filterOptions.timePoints.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option>All</option><option>Draft</option><option>Scheduled</option><option>In Progress</option><option>Pending Review</option><option>Completed</option></select></label>
        <label>Analyst<select value={filters.analyst} onChange={event => setFilters({ ...filters, analyst: event.target.value })}><option value="All">All</option>{personnel.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>Priority<select value={filters.priority} onChange={event => setFilters({ ...filters, priority: event.target.value })}><option>All</option><option>High</option><option>Low</option><option>None</option></select></label>
        <label>Due Window<select value={filters.dueWindow} onChange={event => setFilters({ ...filters, dueWindow: event.target.value })}><option>All</option><option>Overdue/Open</option><option>Within 1 month</option><option>Within 3 months</option><option>Later</option></select></label>
      </div>
      <div className="twoColumn">
        <div className="panel">
          <div className="panelHeader"><h2>Stability Protocols</h2>{canManage && <button onClick={() => setProtocolEdit(emptyProtocol())}>Add Protocol</button>}</div>
          {protocols.map(protocol => <div className="recordRow" key={protocol.id}><div><strong>{protocol.name}</strong><span>{protocol.time_points?.length || 0} time points</span><small>{(protocol.time_points || []).map(point => `${point.label}: ${point.tests.length} test${point.tests.length === 1 ? '' : 's'}`).join(', ')}</small></div>{canManage && <div><button onClick={() => setProtocolEdit(protocol)}>Edit</button><button onClick={() => removeDoc('stabilityProtocols', protocol.id).then(refreshProtocols)}>Delete</button></div>}</div>)}
          {!protocols.length && <p>No stability protocols yet.</p>}
        </div>
        <div className="panel">
          <div className="panelHeader"><h2>Programs</h2>{canManage && <button onClick={() => setProgramEdit(emptyProgram())}>Add Draft</button>}</div>
          {programs.map(program => <div className="recordRow" key={program.id}><div><strong>{program.batch_number}</strong><span>{program.product_name} / {program.protocol_name}</span><small>Harvest {formatDate(program.harvest_day_zero)} / {program.assignments?.filter(assignment => assignment.include).length || 0} included tests</small></div><div><StabilityBadge status={program.status || 'Draft'} /><button onClick={() => setDetail(program)}>Details</button>{canManage && <button onClick={() => setProgramEdit(program)}>Edit</button>}{canManage && program.status === 'Draft' && <button onClick={() => removeDoc('stabilityPrograms', program.id).then(refreshPrograms)}>Delete</button>}</div></div>)}
          {!programs.length && <p>No stability programs yet.</p>}
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead><tr><th>Batch</th><th>Product</th><th>Time Point</th><th>Test</th><th>Window</th><th>Scheduled</th><th>Analyst</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>
            {filteredRows.map(row => <tr key={`${row.program.id}-${row.assignment.id}`}>
              <td>{row.program.batch_number}<small>{row.program.protocol_name}</small></td>
              <td>{row.program.product_name}</td>
              <td>{row.assignment.time_point_label}<small>Target {formatDate(row.assignment.target_date)}</small></td>
              <td>{row.assignment.test_name}<small>QC Sample ID: {row.assignment.qc_sample_id || 'Not set'}</small></td>
              <td>{formatDate(row.assignment.window_start)} to {formatDate(row.assignment.window_end)}</td>
              <td>{formatDate(row.schedule?.start_time || row.assignment.start_time)}</td>
              <td>{getPersonName(row.assignment.assignee_id)}<small>Reviewer: {getPersonName(row.assignment.reviewer_id)}</small></td>
              <td><PriorityBadge priority={row.priority} /></td>
              <td><StabilityBadge status={row.status} /></td>
            </tr>)}
            {!filteredRows.length && <tr><td colSpan={9}>No stability assignments match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {canManage && protocolEdit && <Modal title="Stability Protocol" onClose={() => setProtocolEdit(null)}><ProtocolEditor protocol={protocolEdit} setProtocol={setProtocolEdit} onSave={saveProtocol} /></Modal>}
      {canManage && programEdit && <Modal title="Stability Program Draft" onClose={() => setProgramEdit(null)}><ProgramEditor program={programEdit} products={products} protocols={protocols} personnel={personnel} setProgram={setProgramEdit} onSave={saveProgram} onPush={pushProgram} /></Modal>}
      {detail && <Modal title={`${detail.batch_number} Stability Details`} onClose={() => setDetail(null)}><div className="detailList">{(detail.assignments || []).filter(assignment => assignment.include).map(assignment => <div className="recordRow" key={assignment.id}><div><strong>{assignment.time_point_label} / {assignment.test_name}</strong><span>Target {formatDate(assignment.target_date)} / Window {formatDate(assignment.window_start)} to {formatDate(assignment.window_end)}</span><small>Main {getPersonName(assignment.assignee_id)} / Reviewer {getPersonName(assignment.reviewer_id)}</small></div><div>{assignment.generated_schedule_id ? <StabilityBadge status={schedulesById.get(assignment.generated_schedule_id)?.status || 'Scheduled'} /> : <StabilityBadge status="Draft" />}</div></div>)}</div></Modal>}
    </section>
  );
}
