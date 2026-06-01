import { FormEvent, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { addDoc, collection } from 'firebase/firestore';
import {
  Activity,
  CalendarDays,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Mail,
  Settings,
  ShieldCheck,
  Users
} from 'lucide-react';
import { auth, db, hasFirebaseConfig } from './firebase';
import { addAuditEntry, addDays, displayTimestamp, formatDate, getOne, listDocs, loadAuditTrail, removeDoc, saveDoc } from './data';
import type { AdminSetting, AuditEntry, EmTest, Filters, Personnel, Product, Protocol, ProtocolType, Schedule, Status, WorkflowStep } from './types';

type Tab = 'Dashboard' | 'Create Schedule' | 'Schedules' | 'Calendar' | 'Products & Protocols' | 'Personnel' | 'Admin Settings';
type Draft<T> = Partial<T> & { id?: string };

const emptyFilters: Filters = { status: 'All', assignee: 'All', protocol: 'All', product: 'All', batch: 'All' };
const statusOrder: Status[] = ['Scheduled', 'In Progress', 'Completed', 'Deleted'];
const defaultSettings: AdminSetting = {
  id: 'general',
  organizationName: 'CTMC',
  website: 'www.CTMC.com',
  inviteMode: 'draft-only',
  defaultCalendarLocation: 'QC Laboratory',
  allowAnalystEdits: false
};

const currentUserInfo = (user: User | null) => user?.email || user?.uid || 'unknown';
const initials = (name?: string) => (name || 'NA').split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 3);

function useCollection<T>(collectionName: string, enabled: boolean, orderByField?: string, direction: 'asc' | 'desc' = 'asc') {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    if (!enabled) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(await listDocs<T>(collectionName, orderByField, direction));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    refresh().catch(console.error);
  }, [collectionName, enabled, orderByField, direction]);
  return { items, setItems, refresh, loading };
}

function useReferenceData(enabled: boolean) {
  const personnel = useCollection<Personnel>('personnel', enabled);
  const products = useCollection<Product>('products', enabled);
  const protocols = useCollection<Protocol>('protocols', enabled);
  return { personnel, products, protocols };
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modalPanel">
        <div className="modalHeader">
          <h2>{title}</h2>
          <button className="ghostButton" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: Status }) {
  return <span className={`badge status-${(status || 'Scheduled').replace(/\s+/g, '-').toLowerCase()}`}>{status || 'Scheduled'}</span>;
}

function EmailBadge({ status }: { status?: string }) {
  return <span className={`mailBadge mail-${status || 'pending'}`}>{status || 'pending'}</span>;
}

function ConfigRequired() {
  return (
    <main className="authPage">
      <section className="authCard">
        <ShieldCheck size={34} />
        <h1>Firebase setup required</h1>
        <p>Add the Firebase Web App values as Vite environment variables before deploying.</p>
        <code>.env.example</code>
      </section>
    </main>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth) return;
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="authPage">
      <form className="authCard" onSubmit={submit}>
        <div className="brandMark">www.CTMC.com</div>
        <h1>QC Planner</h1>
        <p>Sign in with an account created by your Firebase administrator.</p>
        <label>Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" required minLength={6} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <div className="errorBox">{error}</div>}
        <button className="primaryButton" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
      </form>
    </main>
  );
}

function filterSchedules(schedules: Schedule[], filters: Filters) {
  return schedules.filter(schedule =>
    (filters.status === 'All' || schedule.status === filters.status) &&
    (filters.assignee === 'All' || schedule.assignee_id === filters.assignee) &&
    (filters.protocol === 'All' || schedule.protocol_name === filters.protocol) &&
    (filters.product === 'All' || (schedule.product_name || schedule.product_id) === filters.product) &&
    (filters.batch === 'All' || schedule.batch_number === filters.batch)
  );
}

function FiltersBar({ schedules, personnel, filters, setFilters }: { schedules: Schedule[]; personnel: Personnel[]; filters: Filters; setFilters: (filters: Filters) => void }) {
  const protocols = [...new Set(schedules.map(item => item.protocol_name).filter(Boolean))];
  const products = [...new Set(schedules.map(item => item.product_name || item.product_id).filter(Boolean))];
  const batches = [...new Set(schedules.map(item => item.batch_number).filter(Boolean))];
  return (
    <div className="filtersBar">
      <label>Status<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option>All</option>{statusOrder.map(status => <option key={status}>{status}</option>)}</select></label>
      <label>Assignee<select value={filters.assignee} onChange={event => setFilters({ ...filters, assignee: event.target.value })}><option value="All">All</option>{personnel.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>Protocol<select value={filters.protocol} onChange={event => setFilters({ ...filters, protocol: event.target.value })}><option>All</option>{protocols.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Product<select value={filters.product} onChange={event => setFilters({ ...filters, product: event.target.value })}><option>All</option>{products.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Batch<select value={filters.batch} onChange={event => setFilters({ ...filters, batch: event.target.value })}><option>All</option>{batches.map(item => <option key={item}>{item}</option>)}</select></label>
    </div>
  );
}

function Dashboard({ schedules, personnel, settings }: { schedules: Schedule[]; personnel: Personnel[]; settings: AdminSetting }) {
  const [filters, setFilters] = useState(emptyFilters);
  const filtered = filterSchedules(schedules, filters);
  const dueSoon = filtered.filter(item => item.status !== 'Completed' && item.status !== 'Deleted' && new Date(formatDate(item.start_time)) <= new Date(Date.now() + 7 * 86400000)).length;
  const completion = filtered.length ? Math.round((filtered.filter(item => item.status === 'Completed').length / filtered.length) * 100) : 0;

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">{settings.website || defaultSettings.website} operations</p><h1>Dashboard</h1></div></div>
      <FiltersBar schedules={schedules} personnel={personnel} filters={filters} setFilters={setFilters} />
      <div className="metricGrid">
        <Metric icon={<ClipboardList />} label="Visible Tests" value={filtered.length} />
        <Metric icon={<Activity />} label="Completion" value={`${completion}%`} />
        <Metric icon={<CalendarDays />} label="Due In 7 Days" value={dueSoon} />
        <Metric icon={<Mail />} label="Pending Invites" value={filtered.filter(item => item.email_status === 'pending').length} />
      </div>
      <div className="twoColumn">
        <div className="panel">
          <h2>Workload by analyst</h2>
          {personnel.map(person => {
            const count = filtered.filter(item => item.assignee_id === person.id && item.status !== 'Deleted').length;
            return <div className="barRow" key={person.id}><span>{person.name}</span><strong>{count}</strong></div>;
          })}
        </div>
        <div className="panel">
          <h2>Recent schedule activity</h2>
          <div className="compactList">
            {filtered.slice(0, 8).map(item => <div key={item.id}><strong>{item.batch_number}</strong><span>{item.test_name}</span><StatusBadge status={item.status} /></div>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return <div className="metricCard"><span>{icon}</span><p>{label}</p><strong>{value}</strong></div>;
}

function CreateSchedule({ products, protocols, personnel, refreshSchedules, user }: { products: Product[]; protocols: Protocol[]; personnel: Personnel[]; refreshSchedules: () => Promise<void>; user: User | null }) {
  const [form, setForm] = useState({ product_id: '', product_name: '', batch_number: '', protocol_name: '', harvest_day_zero: '' });
  const [configs, setConfigs] = useState<Record<string, { include: boolean; assignee_id: string; is_all_day: boolean; start_time: string; end_time: string; duration_days: number; delta_day: number; workflow_step: string }>>({});
  const [message, setMessage] = useState('');
  const selectedProduct = products.find(product => product.id === form.product_id);
  const options = protocols.filter(protocol => protocol.product_id === form.product_id || protocol.product_name === selectedProduct?.name);
  const selectedProtocol = options.find(protocol => protocol.name === form.protocol_name);
  const isEm = selectedProtocol?.protocol_type === 'EM Protocol';

  const chooseProduct = (productId: string) => {
    const product = products.find(item => item.id === productId);
    setForm({ product_id: productId, product_name: product?.name || '', batch_number: form.batch_number, protocol_name: '', harvest_day_zero: '' });
    setConfigs({});
  };

  const chooseProtocol = (protocolName: string) => {
    const protocol = options.find(item => item.name === protocolName);
    setForm({ ...form, protocol_name: protocolName });
    const tests = protocol?.protocol_type === 'EM Protocol' && protocol.em_tests?.length ? protocol.em_tests.map(item => item.name) : protocol?.tests || [];
    const deltaByName = (protocol?.em_tests || []).reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.name]: Number(item.delta_day || 0) }), {});
    setConfigs(Object.fromEntries(tests.map(test => [test, { include: protocol?.protocol_type === 'EM Protocol', assignee_id: '', is_all_day: true, start_time: '', end_time: '', duration_days: 1, delta_day: deltaByName[test] || 0, workflow_step: protocol?.workflow_steps?.[0]?.name || '' }])));
  };

  const updateHarvest = (value: string) => {
    setForm({ ...form, harvest_day_zero: value });
    if (!isEm) return;
    setConfigs(prev => Object.fromEntries(Object.entries(prev).map(([test, config]) => [test, { ...config, include: true, start_time: addDays(value, config.delta_day) }])));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!selectedProtocol) return;
    if (isEm && !form.harvest_day_zero) return setMessage('Select Day 0 Harvest for EM protocols.');
    const included = Object.entries(configs).filter(([, config]) => config.include);
    if (!included.length) return setMessage('Select at least one test.');
    for (const [test, config] of included) {
      if (!config.assignee_id || !config.start_time || (!config.is_all_day && !config.end_time)) return setMessage(`Complete required fields for ${test}.`);
    }
    try {
      await Promise.all(included.map(async ([testName, config]) => {
        const schedule: Omit<Schedule, 'id'> = {
          product_id: form.product_id,
          product_name: form.product_name,
          batch_number: form.batch_number,
          protocol_name: selectedProtocol.name,
          protocol_type: selectedProtocol.protocol_type || 'QC Sample Plan',
          harvest_day_zero: isEm ? form.harvest_day_zero : '',
          delta_day: isEm ? config.delta_day : null,
          test_name: testName,
          workflow_step: config.workflow_step,
          assignee_id: config.assignee_id,
          start_time: config.start_time,
          end_time: config.is_all_day ? '' : config.end_time,
          is_all_day: config.is_all_day,
          duration_days: isEm ? 1 : config.is_all_day ? config.duration_days : null,
          status: 'Scheduled',
          progress: 0,
          email_status: 'pending',
          created_by: currentUserInfo(user)
        };
        const id = await saveDoc('schedules', schedule);
        await addAuditEntry(id, 'CREATE', null, schedule, 'Initial schedule creation', currentUserInfo(user));
      }));
      setMessage('Schedules saved. Invite requests are pending.');
      setForm({ product_id: '', product_name: '', batch_number: '', protocol_name: '', harvest_day_zero: '' });
      setConfigs({});
      await refreshSchedules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save schedules.');
    }
  };

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">Assay planning</p><h1>Create New Schedule</h1></div></div>
      <form className="panel formGrid" onSubmit={submit}>
        <label>Product ID<select required value={form.product_id} onChange={event => chooseProduct(event.target.value)}><option value="">Select product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <label>Batch Number<input required value={form.batch_number} onChange={event => setForm({ ...form, batch_number: event.target.value })} /></label>
        <label>Protocol Name<select required disabled={!form.product_id} value={form.protocol_name} onChange={event => chooseProtocol(event.target.value)}><option value="">Select protocol</option>{options.map(protocol => <option key={protocol.id}>{protocol.name}</option>)}</select></label>
        {isEm && <label>Day 0 Harvest<input type="date" required value={form.harvest_day_zero} onChange={event => updateHarvest(event.target.value)} /></label>}
        <div className="wide">
          {Object.entries(configs).map(([testName, config]) => (
            <div className="testConfig" key={testName}>
              <label className="checkLine"><input type="checkbox" disabled={isEm} checked={config.include} onChange={event => setConfigs({ ...configs, [testName]: { ...config, include: event.target.checked } })} />{testName}</label>
              <select disabled={!config.include} required={config.include} value={config.assignee_id} onChange={event => setConfigs({ ...configs, [testName]: { ...config, assignee_id: event.target.value } })}><option value="">Assignee</option>{personnel.filter(person => person.active !== false).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
              <select disabled={!config.include} value={config.workflow_step} onChange={event => setConfigs({ ...configs, [testName]: { ...config, workflow_step: event.target.value } })}><option value="">Workflow step</option>{selectedProtocol?.workflow_steps?.map(step => <option key={step.id}>{step.name}</option>)}</select>
              {isEm ? <>
                <input type="number" step="1" value={config.delta_day} onChange={event => setConfigs({ ...configs, [testName]: { ...config, delta_day: Number(event.target.value || 0), start_time: addDays(form.harvest_day_zero, Number(event.target.value || 0)) } })} />
                <input type="date" disabled value={config.start_time} />
              </> : <>
                <label className="checkLine"><input type="checkbox" checked={config.is_all_day} onChange={event => setConfigs({ ...configs, [testName]: { ...config, is_all_day: event.target.checked } })} />All day</label>
                <input type={config.is_all_day ? 'date' : 'datetime-local'} disabled={!config.include} required={config.include} value={config.start_time} onChange={event => setConfigs({ ...configs, [testName]: { ...config, start_time: event.target.value } })} />
                {config.is_all_day ? <select value={config.duration_days} onChange={event => setConfigs({ ...configs, [testName]: { ...config, duration_days: Number(event.target.value) } })}><option value={1}>1 Day</option><option value={2}>2 Days</option><option value={3}>3 Days</option></select> : <input type="datetime-local" required={config.include} value={config.end_time} onChange={event => setConfigs({ ...configs, [testName]: { ...config, end_time: event.target.value } })} />}
              </>}
            </div>
          ))}
        </div>
        <button className="primaryButton">Save Schedules</button>
        {message && <div className="infoBox">{message}</div>}
      </form>
    </section>
  );
}

function Schedules({ schedules, personnel, refreshSchedules, user, settings }: { schedules: Schedule[]; personnel: Personnel[]; refreshSchedules: () => Promise<void>; user: User | null; settings: AdminSetting }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [edit, setEdit] = useState<Schedule | null>(null);
  const [audit, setAudit] = useState<Schedule | null>(null);
  const filtered = filterSchedules(schedules, filters);

  const saveSchedule = async (schedule: Schedule, action: string) => {
    const reason = window.prompt('Reason for this GMP audit trail entry:', action);
    if (reason === null) return;
    const before = await getOne<Schedule>('schedules', schedule.id);
    await saveDoc('schedules', { ...schedule, updated_by: currentUserInfo(user) }, schedule.id);
    await addAuditEntry(schedule.id, action, before, schedule, reason, currentUserInfo(user));
    await refreshSchedules();
    setEdit(null);
  };

  const setStatus = async (schedule: Schedule, status: Status) => {
    await saveSchedule({ ...schedule, status, progress: status === 'Completed' ? 100 : schedule.progress || 0 }, status === 'Deleted' ? 'DELETE_STATUS_RETAINED' : status.toUpperCase());
  };

  const handleEmailWorkflow = async (schedule: Schedule) => {
    if ((settings.inviteMode || 'draft-only') === 'draft-only') {
      downloadIcs(schedule, personnel, settings);
      const after = { ...schedule, email_status: 'drafted' as const, updated_by: currentUserInfo(user) };
      await saveDoc('schedules', after, schedule.id);
      await addAuditEntry(schedule.id, 'EMAIL_DRAFT_GENERATED', schedule, after, 'User generated .ics invite draft', currentUserInfo(user));
      await refreshSchedules();
      return;
    }

    if (!db) return;
    await addDoc(collection(db, 'mailRequests'), { schedule_id: schedule.id, status: 'pending', requested_by: currentUserInfo(user), created_at: new Date().toISOString() });
    await addAuditEntry(schedule.id, 'EMAIL_INVITE_REQUEST', null, { schedule_id: schedule.id, status: 'pending' }, 'User requested email invite workflow', currentUserInfo(user));
    await refreshSchedules();
  };

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">Execution control</p><h1>Schedules</h1></div></div>
      <FiltersBar schedules={schedules} personnel={personnel} filters={filters} setFilters={setFilters} />
      <div className="tableWrap">
        <table>
          <thead><tr><th>Test</th><th>Product</th><th>Batch</th><th>Assignee</th><th>Date</th><th>Progress</th><th>Status</th><th>Email</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(schedule => <tr key={schedule.id}>
              <td><strong>{schedule.test_name}</strong><small>{schedule.workflow_step || schedule.protocol_name}</small></td>
              <td>{schedule.product_name || schedule.product_id}</td>
              <td>{schedule.batch_number}</td>
              <td>{personnel.find(person => person.id === schedule.assignee_id)?.name || 'Unassigned'}</td>
              <td>{formatDate(schedule.start_time)}</td>
              <td><progress value={schedule.progress || (schedule.status === 'Completed' ? 100 : 0)} max={100} /></td>
              <td><StatusBadge status={schedule.status} /></td>
              <td><EmailBadge status={schedule.email_status} /></td>
              <td className="actions"><button onClick={() => setEdit(schedule)}>Edit</button><button onClick={() => setStatus(schedule, 'Completed')}>Complete</button><button onClick={() => setStatus(schedule, 'Deleted')}>Delete</button><button onClick={() => handleEmailWorkflow(schedule)}>{settings.inviteMode === 'apps-script' ? 'Queue Invite' : 'Draft Invite'}</button><button onClick={() => setAudit(schedule)}>Audit</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {edit && <Modal title="Edit Schedule" onClose={() => setEdit(null)}><ScheduleEditor schedule={edit} personnel={personnel} setSchedule={setEdit} onSave={item => saveSchedule(item, 'UPDATE')} /></Modal>}
      {audit && <AuditModal schedule={audit} onClose={() => setAudit(null)} />}
    </section>
  );
}

function ScheduleEditor({ schedule, personnel, setSchedule, onSave }: { schedule: Schedule; personnel: Personnel[]; setSchedule: (schedule: Schedule) => void; onSave: (schedule: Schedule) => void }) {
  return <div className="formGrid"><label>Test Name<input value={schedule.test_name} onChange={event => setSchedule({ ...schedule, test_name: event.target.value })} /></label><label>Assignee<select value={schedule.assignee_id} onChange={event => setSchedule({ ...schedule, assignee_id: event.target.value })}>{personnel.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Start<input type={schedule.is_all_day ? 'date' : 'datetime-local'} value={schedule.start_time} onChange={event => setSchedule({ ...schedule, start_time: event.target.value })} /></label><label>Progress<input type="number" min={0} max={100} value={schedule.progress || 0} onChange={event => setSchedule({ ...schedule, progress: Number(event.target.value) })} /></label><button className="primaryButton wide" onClick={() => onSave(schedule)}>Save Schedule</button></div>;
}

function AuditModal({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => { loadAuditTrail(schedule.id).then(setEntries).catch(console.error); }, [schedule.id]);
  return <Modal title="GMP Audit Trail" onClose={onClose}><div className="auditList">{entries.map(entry => <div key={entry.id}><strong>{entry.action}</strong><span>{displayTimestamp(entry.timestamp)}</span><p>{entry.reason}</p><small>{entry.user}</small></div>)}{!entries.length && <p>No audit entries yet.</p>}</div></Modal>;
}

function CalendarView({ schedules, personnel }: { schedules: Schedule[]; personnel: Personnel[] }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [view, setView] = useState('dayGridMonth');
  const filtered = filterSchedules(schedules, filters);
  const events = filtered.map(schedule => {
    const person = personnel.find(item => item.id === schedule.assignee_id);
    const start = schedule.is_all_day ? formatDate(schedule.start_time) : schedule.start_time;
    const endDate = schedule.is_all_day ? addDays(formatDate(schedule.start_time), schedule.duration_days || 1) : schedule.end_time;
    return { id: schedule.id, title: `${initials(person?.initials || person?.name)}_${schedule.batch_number}_${schedule.test_name}`, start, end: endDate, allDay: schedule.is_all_day, backgroundColor: schedule.status === 'Completed' ? '#2d3748' : '#b11226', borderColor: '#841627' };
  });
  return <section className="screen"><div className="screenHeader"><div><p className="eyebrow">Calendar control</p><h1>QC Schedule Calendar</h1></div><select value={view} onChange={event => setView(event.target.value)}><option value="dayGridMonth">Month</option><option value="timeGridWeek">Week</option><option value="timeGridDay">Day</option><option value="listWeek">List</option></select></div><FiltersBar schedules={schedules} personnel={personnel} filters={filters} setFilters={setFilters} /><div className="calendarPanel"><FullCalendar plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialView={view} key={view} events={events} height="auto" headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }} /></div></section>;
}

function ProductsProtocols({ products, protocols, refreshProducts, refreshProtocols }: { products: Product[]; protocols: Protocol[]; refreshProducts: () => Promise<void>; refreshProtocols: () => Promise<void> }) {
  const [productEdit, setProductEdit] = useState<Draft<Product> | null>(null);
  const [protocolEdit, setProtocolEdit] = useState<Draft<Protocol> | null>(null);
  const saveProduct = async () => { if (!productEdit?.name) return; await saveDoc('products', productEdit, productEdit.id); await refreshProducts(); setProductEdit(null); };
  const saveProtocol = async () => {
    if (!protocolEdit?.name || !protocolEdit.product_id) return;
    const product = products.find(item => item.id === protocolEdit.product_id);
    const payload = { ...protocolEdit, product_name: product?.name || protocolEdit.product_name || '', product_type: product?.name || '', protocol_type: protocolEdit.protocol_type || 'QC Sample Plan' as ProtocolType };
    if (payload.protocol_type === 'EM Protocol') payload.tests = (payload.em_tests || []).map(item => item.name).filter(Boolean);
    await saveDoc('protocols', payload, payload.id);
    await refreshProtocols();
    setProtocolEdit(null);
  };
  return <section className="screen"><div className="screenHeader"><div><p className="eyebrow">Master data</p><h1>Products & Protocols</h1></div></div><div className="twoColumn"><div className="panel"><div className="panelHeader"><h2>Products</h2><button onClick={() => setProductEdit({ name: '', product_type: '', description: '', test_frequency: '' })}>Add Product</button></div>{products.map(product => <div className="recordRow" key={product.id}><div><strong>{product.name}</strong><span>{product.product_type}</span></div><div><button onClick={() => setProductEdit(product)}>Edit</button><button onClick={() => removeDoc('products', product.id).then(refreshProducts)}>Delete</button></div></div>)}</div><div className="panel"><div className="panelHeader"><h2>Protocols</h2><button onClick={() => setProtocolEdit({ name: '', product_id: '', product_name: '', protocol_type: 'QC Sample Plan', tests: [], em_tests: [], workflow_steps: [] })}>Add Protocol</button></div>{protocols.map(protocol => <div className="recordRow" key={protocol.id}><div><strong>{protocol.name}</strong><span>{protocol.protocol_type} / {protocol.product_name}</span><small>{(protocol.em_tests?.length ? protocol.em_tests.map(test => `${test.name} Day ${test.delta_day}`) : protocol.tests || []).join(', ')}</small></div><div><button onClick={() => setProtocolEdit({ ...protocol, em_tests: protocol.em_tests || [], workflow_steps: protocol.workflow_steps || [] })}>Edit</button><button onClick={() => removeDoc('protocols', protocol.id).then(refreshProtocols)}>Delete</button></div></div>)}</div></div>{productEdit && <Modal title="Product" onClose={() => setProductEdit(null)}><div className="formGrid"><label>Name<input value={productEdit.name || ''} onChange={event => setProductEdit({ ...productEdit, name: event.target.value })} /></label><label>Type<input value={productEdit.product_type || ''} onChange={event => setProductEdit({ ...productEdit, product_type: event.target.value })} /></label><label className="wide">Description<input value={productEdit.description || ''} onChange={event => setProductEdit({ ...productEdit, description: event.target.value })} /></label><button className="primaryButton wide" onClick={saveProduct}>Save Product</button></div></Modal>}{protocolEdit && <ProtocolModal protocol={protocolEdit} products={products} setProtocol={setProtocolEdit} onSave={saveProtocol} onClose={() => setProtocolEdit(null)} />}</section>;
}

function ProtocolModal({ protocol, products, setProtocol, onSave, onClose }: { protocol: Draft<Protocol>; products: Product[]; setProtocol: (protocol: Draft<Protocol>) => void; onSave: () => void; onClose: () => void }) {
  const emTests = protocol.em_tests || [];
  const steps = protocol.workflow_steps || [];
  const setEmTest = (index: number, patch: Partial<EmTest>) => setProtocol({ ...protocol, em_tests: emTests.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const setStep = (index: number, patch: Partial<WorkflowStep>) => setProtocol({ ...protocol, workflow_steps: steps.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <Modal title="Protocol" onClose={onClose}><div className="formGrid"><label>Protocol Name<input value={protocol.name || ''} onChange={event => setProtocol({ ...protocol, name: event.target.value })} /></label><label>Sub-Protocol Type<select value={protocol.protocol_type || 'QC Sample Plan'} onChange={event => setProtocol({ ...protocol, protocol_type: event.target.value as ProtocolType })}><option>QC Sample Plan</option><option>EM Protocol</option></select></label><label>Product Name<select value={protocol.product_id || ''} onChange={event => setProtocol({ ...protocol, product_id: event.target.value, product_name: products.find(product => product.id === event.target.value)?.name || '' })}><option value="">Select product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>{protocol.protocol_type === 'EM Protocol' ? <div className="wide subPanel"><div className="panelHeader"><h3>EM Tests and Delta Days</h3><button onClick={() => setProtocol({ ...protocol, em_tests: [...emTests, { name: '', delta_day: 0 }] })}>Add Test</button></div>{emTests.map((test, index) => <div className="inlineEdit" key={index}><input placeholder="Test name" value={test.name} onChange={event => setEmTest(index, { name: event.target.value })} /><input type="number" value={test.delta_day} onChange={event => setEmTest(index, { delta_day: Number(event.target.value || 0) })} /><button onClick={() => setProtocol({ ...protocol, em_tests: emTests.filter((_, i) => i !== index) })}>Remove</button></div>)}</div> : <label className="wide">Tests<input value={(protocol.tests || []).join(', ')} onChange={event => setProtocol({ ...protocol, tests: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} /></label>}<div className="wide subPanel"><div className="panelHeader"><h3>Dynamic assay workflow steps</h3><button onClick={() => setProtocol({ ...protocol, workflow_steps: [...steps, { id: crypto.randomUUID(), name: '', expected_days: 1, required: true }] })}>Add Step</button></div>{steps.map((step, index) => <div className="inlineEdit" key={step.id}><input placeholder="Step name" value={step.name} onChange={event => setStep(index, { name: event.target.value })} /><input type="number" min={0} value={step.expected_days || 0} onChange={event => setStep(index, { expected_days: Number(event.target.value) })} /><button onClick={() => setProtocol({ ...protocol, workflow_steps: steps.filter((_, i) => i !== index) })}>Remove</button></div>)}</div><button className="primaryButton wide" onClick={onSave}>Save Protocol</button></div></Modal>;
}

function PersonnelPage({ personnel, refreshPersonnel }: { personnel: Personnel[]; refreshPersonnel: () => Promise<void> }) {
  const [edit, setEdit] = useState<Draft<Personnel> | null>(null);
  const [message, setMessage] = useState('');
  const save = async () => {
    if (!edit?.name || !edit.email) return;
    setMessage('');
    try {
      await saveDoc('personnel', edit, edit.id);
      await refreshPersonnel();
      setEdit(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save analyst.');
    }
  };
  return <section className="screen"><div className="screenHeader"><div><p className="eyebrow">Assignments</p><h1>Users / Analysts</h1></div><button onClick={() => { setMessage(''); setEdit({ name: '', email: '', role: 'Analyst', initials: '', active: true }); }}>Add Analyst</button></div>{message && <div className="errorBox">{message}</div>}<div className="tableWrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Initials</th><th>Status</th><th>Actions</th></tr></thead><tbody>{personnel.map(person => <tr key={person.id}><td>{person.name}</td><td>{person.email}</td><td>{person.role}</td><td>{person.initials || initials(person.name)}</td><td>{person.active ? 'Active' : 'Inactive'}</td><td><button onClick={() => setEdit(person)}>Edit</button><button onClick={() => removeDoc('personnel', person.id).then(refreshPersonnel)}>Delete</button></td></tr>)}</tbody></table></div>{edit && <Modal title="Analyst" onClose={() => setEdit(null)}><div className="formGrid"><label>Name<input value={edit.name || ''} onChange={event => setEdit({ ...edit, name: event.target.value })} /></label><label>Email<input type="email" value={edit.email || ''} onChange={event => setEdit({ ...edit, email: event.target.value })} /></label><label>Role<select value={edit.role || 'Analyst'} onChange={event => setEdit({ ...edit, role: event.target.value as Personnel['role'] })}><option>Admin</option><option>Manager</option><option>Supervisor</option><option>QA</option><option>Analyst</option></select></label><label>Initials<input value={edit.initials || ''} onChange={event => setEdit({ ...edit, initials: event.target.value.toUpperCase() })} /></label><label className="checkLine wide"><input type="checkbox" checked={edit.active !== false} onChange={event => setEdit({ ...edit, active: event.target.checked })} />Active</label><button className="primaryButton wide" onClick={save}>Save Analyst</button></div></Modal>}</section>;
}

function AdminSettingsPage({ settings, onSaved }: { settings: AdminSetting; onSaved: (settings: AdminSetting) => void }) {
  const [draft, setDraft] = useState<Draft<AdminSetting>>(settings);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const save = async () => {
    setMessage('');
    const payload = { ...defaultSettings, ...draft, id: 'general' };
    try {
      await saveDoc('adminSettings', payload, 'general');
      onSaved(payload);
      setMessage('Settings saved and applied.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save settings.');
    }
  };

  return <section className="screen"><div className="screenHeader"><div><p className="eyebrow">Configuration</p><h1>Admin Settings</h1></div></div><div className="panel formGrid"><label>Organization Name<input value={draft.organizationName || ''} onChange={event => setDraft({ ...draft, organizationName: event.target.value })} /></label><label>Website<input value={draft.website || ''} onChange={event => setDraft({ ...draft, website: event.target.value })} /></label><label>Email Workflow<select value={draft.inviteMode || 'draft-only'} onChange={event => setDraft({ ...draft, inviteMode: event.target.value as AdminSetting['inviteMode'] })}><option value="draft-only">Draft ICS Download</option><option value="apps-script">Apps Script Mail Queue</option></select></label><label>Calendar Location<input value={draft.defaultCalendarLocation || ''} onChange={event => setDraft({ ...draft, defaultCalendarLocation: event.target.value })} /></label><label className="checkLine wide"><input type="checkbox" checked={draft.allowAnalystEdits || false} onChange={event => setDraft({ ...draft, allowAnalystEdits: event.target.checked })} />Allow analyst edits</label><button className="primaryButton wide" onClick={save}>Save Settings</button>{message && <div className="infoBox wide">{message}</div>}</div></section>;
}

function downloadIcs(schedule: Schedule, personnel: Personnel[], settings: AdminSetting) {
  const assignee = personnel.find(person => person.id === schedule.assignee_id);
  const start = schedule.is_all_day ? `DTSTART;VALUE=DATE:${formatDate(schedule.start_time).replace(/-/g, '')}` : `DTSTART:${new Date(schedule.start_time).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const endValue = schedule.is_all_day ? addDays(formatDate(schedule.start_time), schedule.duration_days || 1).replace(/-/g, '') : new Date(schedule.end_time || schedule.start_time).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const end = schedule.is_all_day ? `DTEND;VALUE=DATE:${endValue}` : `DTEND:${endValue}`;
  const organization = settings.organizationName || defaultSettings.organizationName;
  const location = settings.defaultCalendarLocation || defaultSettings.defaultCalendarLocation;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//QC Planner//${organization}//EN`, 'METHOD:REQUEST', 'BEGIN:VEVENT', `UID:${schedule.id}@qc-planner`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`, start, end, `SUMMARY:${schedule.batch_number} ${schedule.test_name}`, `DESCRIPTION:Product ${schedule.product_name} | Protocol ${schedule.protocol_name}`, `LOCATION:${location}`, assignee?.email ? `ATTENDEE;CN=${assignee.name}:mailto:${assignee.email}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${schedule.batch_number}-${schedule.test_name}.ics`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [settings, setSettings] = useState<AdminSetting>(defaultSettings);
  const dataEnabled = Boolean(user);
  const { personnel, products, protocols } = useReferenceData(dataEnabled);
  const schedules = useCollection<Schedule>('schedules', dataEnabled, 'start_time', 'desc');

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, current => {
      setUser(current);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    getOne<AdminSetting>('adminSettings', 'general')
      .then(item => setSettings({ ...defaultSettings, ...(item || {}) }))
      .catch(console.error);
  }, [user]);

  const tabs = useMemo(() => [
    ['Dashboard', LayoutDashboard],
    ['Create Schedule', FlaskConical],
    ['Schedules', ClipboardList],
    ['Calendar', CalendarDays],
    ['Products & Protocols', Activity],
    ['Personnel', Users],
    ['Admin Settings', Settings]
  ] as const, []);

  if (!hasFirebaseConfig) return <ConfigRequired />;
  if (!authReady) return <main className="loading">Loading QC Planner...</main>;
  if (!user) return <LoginScreen />;

  return (
    <div className="appShell">
      <aside>
        <div className="brand"><strong>QC Planner</strong><span>{settings.website || defaultSettings.website}</span></div>
        <nav>{tabs.map(([name, Icon]) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}><Icon size={18} />{name}</button>)}</nav>
        <button className="signOut" onClick={() => auth && signOut(auth)}><LogOut size={18} />Sign Out</button>
      </aside>
      <main>
        {tab === 'Dashboard' && <Dashboard schedules={schedules.items} personnel={personnel.items} settings={settings} />}
        {tab === 'Create Schedule' && <CreateSchedule products={products.items} protocols={protocols.items} personnel={personnel.items} refreshSchedules={schedules.refresh} user={user} />}
        {tab === 'Schedules' && <Schedules schedules={schedules.items} personnel={personnel.items} refreshSchedules={schedules.refresh} user={user} settings={settings} />}
        {tab === 'Calendar' && <CalendarView schedules={schedules.items} personnel={personnel.items} />}
        {tab === 'Products & Protocols' && <ProductsProtocols products={products.items} protocols={protocols.items} refreshProducts={products.refresh} refreshProtocols={protocols.refresh} />}
        {tab === 'Personnel' && <PersonnelPage personnel={personnel.items} refreshPersonnel={personnel.refresh} />}
        {tab === 'Admin Settings' && <AdminSettingsPage settings={settings} onSaved={setSettings} />}
      </main>
    </div>
  );
}
