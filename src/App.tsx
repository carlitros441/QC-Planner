import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react';
import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signInWithEmailAndPassword, signOut, updatePassword, User } from 'firebase/auth';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import {
  Activity,
  CalendarDays,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Mail,
  KeyRound,
  Settings,
  ShieldCheck,
  Timer,
  Users
} from 'lucide-react';
import { auth, hasFirebaseConfig } from './firebase';
import { addAuditEntry, addDays, displayTimestamp, formatDate, getOne, listDocs, loadAuditTrail, removeDoc, saveDoc } from './data';
import Stability from './Stability';
import type { AdminSetting, AuditEntry, EmTest, Filters, Personnel, Product, Protocol, ProtocolType, Schedule, StabilityProgram, StabilityProtocol, Status, WorkflowStep } from './types';

type Tab = 'Dashboard' | 'Create Schedule' | 'Schedules' | 'Calendar' | 'QC Stability' | 'Products & Protocols' | 'Personnel' | 'Admin Settings';
type Draft<T> = Partial<T> & { id?: string };

const emptyFilters: Filters = { status: 'All', assignee: 'All', protocol: 'All', product: 'All', batch: 'All', test: 'All' };
const statusOrder: Status[] = ['Scheduled', 'In Progress', 'Pending Review', 'Completed', 'Deleted'];
const defaultSettings: AdminSetting = {
  id: 'general',
  organizationName: 'CTMC',
  website: 'Quality Operations',
  inviteMode: 'draft-only',
  defaultCalendarLocation: 'QC Laboratory',
  allowAnalystEdits: false
};

const currentUserInfo = (user: User | null) => user?.email || user?.uid || 'unknown';
const auditDisplayText = (value: unknown, fallback: string) => {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['email', 'name', 'displayName', 'uid']) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
    }
  }
  return fallback;
};
const displaySiteLabel = (value?: string) => value && !/ctmc\.com/i.test(value) ? value : defaultSettings.website || 'Quality Operations';
const initials = (name?: string) => (name || 'NA').split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 3);
const getProtocolSampleId = (protocol: Protocol | undefined, testName: string) => {
  if (!protocol || !testName) return '';
  const emTest = protocol.em_tests?.find(test => test.name === testName);
  return emTest?.qc_sample_id || protocol.test_sample_ids?.[testName] || '';
};
const effectiveProgress = (schedule: Schedule) => {
  if (schedule.status === 'Completed' || schedule.review_status === 'Completed') return 100;
  if (schedule.status === 'Pending Review' || schedule.review_status === 'Pending Review') return 80;
  return Math.min(Number(schedule.progress || 0), 80);
};

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

function ProgressBar({ schedule }: { schedule: Schedule }) {
  const execution = Math.min(effectiveProgress(schedule), 80);
  const review = schedule.review_status === 'Completed' || schedule.status === 'Completed' ? 20 : 0;
  return (
    <div className="progressStack" title={`${execution + review}% complete`}>
      <span className="progressExecution" style={{ width: `${execution}%` }} />
      <span className="progressReview" style={{ width: `${review}%` }} />
      <em>{execution + review}%</em>
    </div>
  );
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
        <div className="brandMark">QC Planner</div>
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

function ChangePasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    if (!user.email) return setError('This account does not have an email address available for password verification.');
    if (newPassword.length < 6) return setError('New password must be at least 6 characters.');
    if (newPassword !== confirmPassword) return setError('New password and confirmation do not match.');
    setSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Change Password" onClose={onClose}>
      <form className="formGrid" onSubmit={submit}>
        <label className="wide">Signed-in Account<input value={user.email || user.uid} disabled readOnly /></label>
        <label>Current Password<input type="password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
        <label>New Password<input type="password" required minLength={6} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label>
        <label>Confirm New Password<input type="password" required minLength={6} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>
        <button className="primaryButton wide" disabled={saving}>{saving ? 'Updating...' : 'Update Password'}</button>
        {message && <div className="infoBox wide">{message}</div>}
        {error && <div className="errorBox wide">{error}</div>}
      </form>
    </Modal>
  );
}

function filterSchedules(schedules: Schedule[], filters: Filters) {
  return schedules.filter(schedule =>
    (filters.status === 'All' || schedule.status === filters.status) &&
    (filters.assignee === 'All' || schedule.assignee_id === filters.assignee) &&
    (filters.protocol === 'All' || schedule.protocol_name === filters.protocol) &&
    (filters.product === 'All' || (schedule.product_name || schedule.product_id) === filters.product) &&
    (filters.batch === 'All' || schedule.batch_number === filters.batch) &&
    (filters.test === 'All' || schedule.test_name === filters.test)
  );
}

function FiltersBar({ schedules, personnel, filters, setFilters }: { schedules: Schedule[]; personnel: Personnel[]; filters: Filters; setFilters: (filters: Filters) => void }) {
  const protocols = [...new Set(schedules.map(item => item.protocol_name).filter(Boolean))];
  const products = [...new Set(schedules.map(item => item.product_name || item.product_id).filter(Boolean))];
  const batches = [...new Set(schedules.map(item => item.batch_number).filter(Boolean))];
  const tests = [...new Set(schedules.map(item => item.test_name).filter(Boolean))];
  return (
    <div className="filtersBar">
      <label>Status<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option>All</option>{statusOrder.map(status => <option key={status}>{status}</option>)}</select></label>
      <label>Assignee<select value={filters.assignee} onChange={event => setFilters({ ...filters, assignee: event.target.value })}><option value="All">All</option>{personnel.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>Protocol<select value={filters.protocol} onChange={event => setFilters({ ...filters, protocol: event.target.value })}><option>All</option>{protocols.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Product<select value={filters.product} onChange={event => setFilters({ ...filters, product: event.target.value })}><option>All</option>{products.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Batch<select value={filters.batch} onChange={event => setFilters({ ...filters, batch: event.target.value })}><option>All</option>{batches.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Test<select value={filters.test} onChange={event => setFilters({ ...filters, test: event.target.value })}><option>All</option>{tests.map(item => <option key={item}>{item}</option>)}</select></label>
    </div>
  );
}

function Dashboard({ schedules, personnel, settings, refreshSchedules, user }: { schedules: Schedule[]; personnel: Personnel[]; settings: AdminSetting; refreshSchedules: () => Promise<void>; user: User | null }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [analystDetail, setAnalystDetail] = useState<Personnel | null>(null);
  const [detailSchedule, setDetailSchedule] = useState<Schedule | null>(null);
  const [lotDetail, setLotDetail] = useState<{ batch: string; product: string; harvestDay: string; schedules: Schedule[] } | null>(null);
  const [edit, setEdit] = useState<Schedule | null>(null);
  const filtered = filterSchedules(schedules, filters);
  const activeSchedules = filtered.filter(item => item.status !== 'Deleted');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lots = Object.values(activeSchedules.reduce<Record<string, { batch: string; product: string; harvestDay: string; schedules: Schedule[] }>>((acc, schedule) => {
    const harvestDay = formatDate(schedule.harvest_day_zero);
    if (!harvestDay) return acc;
    const key = `${schedule.product_id}|${schedule.batch_number}|${harvestDay}`;
    acc[key] = acc[key] || { batch: schedule.batch_number, product: schedule.product_name || schedule.product_id, harvestDay, schedules: [] };
    acc[key].schedules.push(schedule);
    return acc;
  }, {})).map(lot => {
    const harvest = new Date(`${lot.harvestDay}T00:00:00`);
    const completedCount = lot.schedules.filter(schedule => schedule.status === 'Completed').length;
    const allCompleted = lot.schedules.length > 0 && completedCount === lot.schedules.length;
    const daysUntil = Math.ceil((harvest.getTime() - today.getTime()) / 86400000);
    const status: Status = allCompleted ? 'Completed' : daysUntil < 0 ? 'In Progress' : 'Scheduled';
    return { ...lot, daysUntil, completedCount, allCompleted, status };
  });
  const nextLot = lots.filter(lot => !lot.allCompleted && lot.daysUntil >= 0).sort((a, b) => a.daysUntil - b.daysUntil)[0];
  const completedLots = lots.filter(lot => lot.allCompleted).sort((a, b) => b.harvestDay.localeCompare(a.harvestDay)).slice(0, 4);
  const currentOrUpcomingLots = lots.filter(lot => !lot.allCompleted).sort((a, b) => a.daysUntil - b.daysUntil);
  const currentActiveLots = [...currentOrUpcomingLots, ...completedLots];
  const getAssigneeName = (assigneeId: string) => personnel.find(person => person.id === assigneeId)?.name || 'Unassigned';
  const getTraineeName = (traineeId?: string) => traineeId ? personnel.find(person => person.id === traineeId)?.name || 'Unassigned' : 'None';
  const getReviewerName = (reviewerId?: string) => personnel.find(person => person.id === reviewerId)?.name || 'Unassigned';
  const saveDashboardSchedule = async (schedule: Schedule) => {
    const reason = window.prompt('Reason for this GMP audit trail entry:', 'Dashboard schedule update');
    if (reason === null) return;
    const before = await getOne<Schedule>('schedules', schedule.id);
    await saveDoc('schedules', { ...schedule, updated_by: currentUserInfo(user) }, schedule.id);
    await addAuditEntry(schedule.id, 'DASHBOARD_UPDATE', before, schedule, reason, currentUserInfo(user));
    await refreshSchedules();
    setEdit(null);
    setDetailSchedule(schedule);
  };
  const analystSchedules = analystDetail ? activeSchedules.filter(item => item.assignee_id === analystDetail.id || item.trainee_id === analystDetail.id) : [];
  const ScheduleDetails = ({ schedule }: { schedule: Schedule }) => (
    <div className="detailsGrid">
      <div><strong>Batch</strong><span>{schedule.batch_number}</span></div>
      <div><strong>Harvest Day</strong><span>{formatDate(schedule.harvest_day_zero) || 'Not set'}</span></div>
      <div><strong>Product</strong><span>{schedule.product_name || schedule.product_id}</span></div>
      <div><strong>Protocol</strong><span>{schedule.protocol_name}</span></div>
      <div><strong>Test</strong><span>{schedule.test_name}</span></div>
      <div><strong>QC Sample ID</strong><span>{schedule.qc_sample_id || 'Not set'}</span></div>
      <div><strong>Scheduled Date</strong><span>{formatDate(schedule.start_time)}</span></div>
      <div><strong>Main Analyst</strong><span>{getAssigneeName(schedule.assignee_id)}</span></div>
      <div><strong>Trainee Analyst</strong><span>{getTraineeName(schedule.trainee_id)}</span></div>
      <div><strong>QC Reviewer</strong><span>{getReviewerName(schedule.reviewer_id)}</span></div>
      <div><strong>Status</strong><StatusBadge status={schedule.status} /></div>
      <div><strong>Progress</strong><ProgressBar schedule={schedule} /></div>
      <div className="wide modalActions"><button className="primaryButton" onClick={() => setEdit(schedule)}>Edit Schedule</button></div>
    </div>
  );

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">{displaySiteLabel(settings.website)} operations</p><h1>Dashboard</h1></div></div>
      <FiltersBar schedules={schedules} personnel={personnel} filters={filters} setFilters={setFilters} />
      <div className="metricGrid">
        <Metric icon={<ClipboardList />} label="Visible Tests" value={filtered.length} />
        <Metric icon={<Mail />} label="Pending Invites" value={filtered.filter(item => item.email_status === 'pending').length} />
        <div className="metricCard lotMetric">
          <span><CalendarDays /></span>
          <p>Next Lot Release</p>
          <strong>{nextLot ? nextLot.batch : 'None'}</strong>
          <small>{nextLot ? `${nextLot.product} / Harvest ${nextLot.harvestDay} / ${nextLot.daysUntil === 0 ? 'Today' : `${nextLot.daysUntil} day${nextLot.daysUntil === 1 ? '' : 's'}`}` : 'No upcoming harvest day'}</small>
        </div>
      </div>
      <div className="twoColumn">
        <div className="panel">
          <h2>Workload by analyst</h2>
          {personnel.map(person => {
            const count = activeSchedules.filter(item => item.assignee_id === person.id || item.trainee_id === person.id).length;
            return <button className="barRow interactiveRow" key={person.id} onClick={() => setAnalystDetail(person)}><span>{person.name}</span><strong>{count}</strong></button>;
          })}
        </div>
        <div className="panel">
          <h2>Current active lots</h2>
          <div className="compactList">
            {currentActiveLots.map(lot => <button className="interactiveRow recentActivityRow" key={`${lot.product}-${lot.batch}-${lot.harvestDay}`} onClick={() => setLotDetail(lot)}><div><strong>{lot.batch}</strong><span>{lot.product}</span><small>{lot.allCompleted ? 'Previously completed lot' : lot.daysUntil < 0 ? `Harvest ${Math.abs(lot.daysUntil)} day${Math.abs(lot.daysUntil) === 1 ? '' : 's'} ago` : lot.daysUntil === 0 ? 'Harvest today' : `Harvest in ${lot.daysUntil} day${lot.daysUntil === 1 ? '' : 's'}`} / {lot.completedCount} of {lot.schedules.length} tests complete</small></div><StatusBadge status={lot.status} /></button>)}
            {!currentActiveLots.length && <p>No current, upcoming, or recently completed lots.</p>}
          </div>
        </div>
      </div>
      {analystDetail && <Modal title={`${analystDetail.name} Workload`} onClose={() => setAnalystDetail(null)}><div className="detailList">{analystSchedules.map(schedule => <div key={schedule.id} className="recordRow"><div><strong>{schedule.batch_number} / {schedule.test_name}</strong><span>{schedule.product_name || schedule.product_id}</span><small>Harvest {formatDate(schedule.harvest_day_zero) || 'not set'} / Scheduled {formatDate(schedule.start_time)}</small></div><div><StatusBadge status={schedule.status} /><button onClick={() => { setAnalystDetail(null); setDetailSchedule(schedule); }}>Details</button><button onClick={() => { setAnalystDetail(null); setEdit(schedule); }}>Edit</button></div></div>)}{!analystSchedules.length && <p>No active schedules for this analyst.</p>}</div></Modal>}
      {lotDetail && <Modal title={`${lotDetail.batch} Lot Details`} onClose={() => setLotDetail(null)}><div className="detailList">{lotDetail.schedules.map(schedule => <div key={schedule.id} className="recordRow"><div><strong>{schedule.test_name}</strong><span>{schedule.product_name || schedule.product_id}</span><small>QC Sample ID {schedule.qc_sample_id || 'not set'} / Scheduled {formatDate(schedule.start_time)}</small></div><div><StatusBadge status={schedule.status} /><button onClick={() => { setLotDetail(null); setDetailSchedule(schedule); }}>Details</button><button onClick={() => { setLotDetail(null); setEdit(schedule); }}>Edit</button></div></div>)}</div></Modal>}
      {detailSchedule && <Modal title="Schedule Details" onClose={() => setDetailSchedule(null)}><ScheduleDetails schedule={detailSchedule} /></Modal>}
      {edit && <Modal title="Edit Schedule" onClose={() => setEdit(null)}><ScheduleEditor schedule={edit} personnel={personnel} setSchedule={setEdit} onSave={saveDashboardSchedule} /></Modal>}
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return <div className="metricCard"><span>{icon}</span><p>{label}</p><strong>{value}</strong></div>;
}

function CreateSchedule({ products, protocols, personnel, refreshSchedules, user }: { products: Product[]; protocols: Protocol[]; personnel: Personnel[]; refreshSchedules: () => Promise<void>; user: User | null }) {
  const [form, setForm] = useState({ product_id: '', product_name: '', batch_number: '', protocol_name: '', harvest_day_zero: '' });
  const [configs, setConfigs] = useState<Record<string, { include: boolean; assignee_id: string; trainee_id: string; reviewer_id: string; is_all_day: boolean; start_time: string; end_time: string; duration_days: number; delta_day: number; workflow_step: string; qc_sample_id: string }>>({});
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
    setConfigs(Object.fromEntries(tests.map(test => [test, { include: protocol?.protocol_type === 'EM Protocol', assignee_id: '', trainee_id: '', reviewer_id: '', is_all_day: true, start_time: '', end_time: '', duration_days: 1, delta_day: deltaByName[test] || 0, workflow_step: protocol?.workflow_steps?.[0]?.name || '', qc_sample_id: getProtocolSampleId(protocol, test) }])));
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
    if (!form.harvest_day_zero) return setMessage('Select Harvest Day for this lot batch.');
    const included = Object.entries(configs).filter(([, config]) => config.include);
    if (!included.length) return setMessage('Select at least one test.');
    for (const [test, config] of included) {
      if (!config.assignee_id || !config.reviewer_id || !config.start_time || (!config.is_all_day && !config.end_time)) return setMessage(`Complete main analyst, reviewer, and date fields for ${test}.`);
      if (config.trainee_id && config.trainee_id === config.assignee_id) return setMessage(`Trainee analyst must be different from main analyst for ${test}.`);
      if (config.trainee_id && config.trainee_id === config.reviewer_id) return setMessage(`Trainee analyst must be different from QC reviewer for ${test}.`);
      if (config.assignee_id === config.reviewer_id) return setMessage(`Reviewer must be different from analyst for ${test}.`);
    }
    try {
      await Promise.all(included.map(async ([testName, config]) => {
        const schedule: Omit<Schedule, 'id'> = {
          product_id: form.product_id,
          product_name: form.product_name,
          batch_number: form.batch_number,
          protocol_name: selectedProtocol.name,
          protocol_type: selectedProtocol.protocol_type || 'QC Sample Plan',
          harvest_day_zero: form.harvest_day_zero,
          delta_day: isEm ? config.delta_day : null,
          qc_sample_id: getProtocolSampleId(selectedProtocol, testName),
          test_name: testName,
          workflow_step: config.workflow_step,
          assignee_id: config.assignee_id,
          trainee_id: config.trainee_id || '',
          reviewer_id: config.reviewer_id,
          start_time: config.start_time,
          end_time: config.is_all_day ? '' : config.end_time,
          is_all_day: config.is_all_day,
          duration_days: isEm ? 1 : config.is_all_day ? config.duration_days : null,
          status: 'Scheduled',
          progress: 0,
          review_status: 'Not Ready',
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
        <label>{isEm ? 'Day 0 Harvest' : 'Harvest Day'}<input type="date" required value={form.harvest_day_zero} onChange={event => updateHarvest(event.target.value)} /></label>
        <div className="wide">
          {Object.entries(configs).map(([testName, config]) => (
            <div className="testConfig" key={testName}>
              <label className="checkLine"><input type="checkbox" disabled={isEm} checked={config.include} onChange={event => setConfigs({ ...configs, [testName]: { ...config, include: event.target.checked } })} />{testName}</label>
              <select disabled={!config.include} required={config.include} value={config.assignee_id} onChange={event => setConfigs({ ...configs, [testName]: { ...config, assignee_id: event.target.value, trainee_id: config.trainee_id === event.target.value ? '' : config.trainee_id, reviewer_id: config.reviewer_id === event.target.value ? '' : config.reviewer_id } })}><option value="">Main Analyst</option>{personnel.filter(person => person.active !== false).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
              <select disabled={!config.include} value={config.trainee_id} onChange={event => setConfigs({ ...configs, [testName]: { ...config, trainee_id: event.target.value, reviewer_id: config.reviewer_id === event.target.value ? '' : config.reviewer_id } })}><option value="">Trainee Analyst</option>{personnel.filter(person => person.active !== false && person.id !== config.assignee_id && person.id !== config.reviewer_id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
              <select disabled={!config.include} required={config.include} value={config.reviewer_id} onChange={event => setConfigs({ ...configs, [testName]: { ...config, reviewer_id: event.target.value, trainee_id: config.trainee_id === event.target.value ? '' : config.trainee_id } })}><option value="">QC Reviewer</option>{personnel.filter(person => person.active !== false && person.id !== config.assignee_id && person.id !== config.trainee_id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
              <input disabled value={config.qc_sample_id || 'No QC Sample ID'} aria-label={`${testName} QC Sample ID`} />
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

function Schedules({ schedules, personnel, refreshSchedules, user }: { schedules: Schedule[]; personnel: Personnel[]; refreshSchedules: () => Promise<void>; user: User | null }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [edit, setEdit] = useState<Schedule | null>(null);
  const [audit, setAudit] = useState<Schedule | null>(null);
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' }>({ field: 'start_time', direction: 'asc' });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    test_name: 220,
    product: 180,
    batch_number: 145,
    assignee: 170,
    trainee: 170,
    reviewer: 170,
    start_time: 135,
    progress: 170,
    status: 145,
    email_status: 120,
    actions: 320
  });
  const getAssigneeName = (assigneeId: string) => personnel.find(person => person.id === assigneeId)?.name || 'Unassigned';
  const getTraineeName = (traineeId?: string) => traineeId ? personnel.find(person => person.id === traineeId)?.name || 'None' : 'None';
  const getReviewerName = (reviewerId?: string) => personnel.find(person => person.id === reviewerId)?.name || 'Unassigned';
  const toggleSort = (field: string) => setSort(current => current.field === field ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'asc' });
  const sortValue = (schedule: Schedule, field: string) => {
    if (field === 'assignee') return getAssigneeName(schedule.assignee_id);
    if (field === 'trainee') return getTraineeName(schedule.trainee_id);
    if (field === 'reviewer') return getReviewerName(schedule.reviewer_id);
    if (field === 'product') return schedule.product_name || schedule.product_id;
    if (field === 'progress') return schedule.progress || (schedule.status === 'Completed' ? 100 : 0);
    return String((schedule as unknown as Record<string, unknown>)[field] || '');
  };
  const filtered = filterSchedules(schedules, filters).sort((a, b) => {
    const left = sortValue(a, sort.field);
    const right = sortValue(b, sort.field);
    if (typeof left === 'number' && typeof right === 'number') return sort.direction === 'asc' ? left - right : right - left;
    return sort.direction === 'asc' ? String(left).localeCompare(String(right)) : String(right).localeCompare(String(left));
  });
  const sortLabel = (field: string) => sort.field === field ? (sort.direction === 'asc' ? ' ^' : ' v') : '';
  const startColumnResize = (field: string, event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[field] || 140;
    const move = (moveEvent: globalThis.MouseEvent) => {
      const width = Math.max(90, startWidth + moveEvent.clientX - startX);
      setColumnWidths(current => ({ ...current, [field]: width }));
    };
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
  };
  const sortableHeader = (field: string, label: string) => (
    <th className="resizableHeader">
      <button className="sortHeader" onClick={() => toggleSort(field)}>{label}{sortLabel(field)}</button>
      <span className="columnResizeHandle" onMouseDown={event => startColumnResize(field, event)} />
    </th>
  );

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
  const completeTest = async (schedule: Schedule) => {
    await saveSchedule({ ...schedule, status: 'Pending Review', progress: 80, review_status: 'Pending Review', test_completed_at: new Date().toISOString() }, 'TEST_COMPLETE');
  };
  const completeReview = async (schedule: Schedule) => {
    await saveSchedule({ ...schedule, status: 'Completed', progress: 100, review_status: 'Completed', review_completed_at: new Date().toISOString() }, 'REVIEW_COMPLETE');
  };

  const sendUpdatedInvite = async (schedule: Schedule) => {
    const latest = await getOne<Schedule>('schedules', schedule.id) || schedule;
    const after = { ...latest, email_status: 'pending' as const, email_error: null, updated_by: currentUserInfo(user) };
    await saveDoc('schedules', after, latest.id);
    await addAuditEntry(latest.id, 'EMAIL_INVITE_RESEND_REQUEST', latest, after, 'User queued updated calendar invite resend from Schedules tab', currentUserInfo(user));
    await refreshSchedules();
  };

  return (
    <section className="screen">
      <div className="screenHeader"><div><p className="eyebrow">Execution control</p><h1>Schedules</h1></div></div>
      <FiltersBar schedules={schedules} personnel={personnel} filters={filters} setFilters={setFilters} />
      <div className="tableWrap">
        <table>
          <colgroup>
            {['test_name', 'product', 'batch_number', 'assignee', 'trainee', 'reviewer', 'start_time', 'progress', 'status', 'email_status', 'actions'].map(field => <col key={field} style={{ width: `${columnWidths[field]}px` }} />)}
          </colgroup>
          <thead><tr>{sortableHeader('test_name', 'Test')}{sortableHeader('product', 'Product')}{sortableHeader('batch_number', 'Batch')}{sortableHeader('assignee', 'Main Analyst')}{sortableHeader('trainee', 'Trainee')}{sortableHeader('reviewer', 'QC Reviewer')}{sortableHeader('start_time', 'Date')}{sortableHeader('progress', 'Progress')}{sortableHeader('status', 'Status')}{sortableHeader('email_status', 'Email')}<th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(schedule => <tr key={schedule.id}>
              <td><strong>{schedule.test_name}</strong><small>{schedule.workflow_step || schedule.protocol_name}</small><small>QC Sample ID: {schedule.qc_sample_id || 'Not set'}</small></td>
              <td>{schedule.product_name || schedule.product_id}</td>
              <td>{schedule.batch_number}</td>
              <td>{getAssigneeName(schedule.assignee_id)}</td>
              <td>{getTraineeName(schedule.trainee_id)}</td>
              <td>{getReviewerName(schedule.reviewer_id)}<small>{schedule.review_status || 'Not Ready'}</small></td>
              <td>{formatDate(schedule.start_time)}</td>
              <td><ProgressBar schedule={schedule} /></td>
              <td><StatusBadge status={schedule.status} /></td>
              <td><EmailBadge status={schedule.email_status} /></td>
              <td className="actions"><button onClick={() => setEdit(schedule)}>Edit</button>{schedule.status !== 'Completed' && schedule.status !== 'Pending Review' && <button onClick={() => completeTest(schedule)}>Test Complete</button>}{schedule.status === 'Pending Review' && <button onClick={() => completeReview(schedule)}>Review Complete</button>}<button onClick={() => setStatus(schedule, 'Deleted')}>Delete</button><button onClick={() => sendUpdatedInvite(schedule)}>Send Updated Invite</button><button onClick={() => setAudit(schedule)}>Audit</button></td>
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
  const activePersonnel = personnel.filter(person => person.active !== false);
  const setHarvestDay = (harvestDay: string) => {
    setSchedule({
      ...schedule,
      harvest_day_zero: harvestDay,
      start_time: schedule.protocol_type === 'EM Protocol' && schedule.delta_day !== null && schedule.delta_day !== undefined ? addDays(harvestDay, Number(schedule.delta_day || 0)) : schedule.start_time
    });
  };
  return (
    <div className="formGrid">
      <label>Test Name<input value={schedule.test_name} onChange={event => setSchedule({ ...schedule, test_name: event.target.value })} /></label>
      <label>Main Analyst<select value={schedule.assignee_id} onChange={event => setSchedule({ ...schedule, assignee_id: event.target.value, trainee_id: schedule.trainee_id === event.target.value ? '' : schedule.trainee_id, reviewer_id: schedule.reviewer_id === event.target.value ? '' : schedule.reviewer_id })}>{activePersonnel.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>Trainee Analyst<select value={schedule.trainee_id || ''} onChange={event => setSchedule({ ...schedule, trainee_id: event.target.value, reviewer_id: schedule.reviewer_id === event.target.value ? '' : schedule.reviewer_id })}><option value="">No trainee</option>{activePersonnel.filter(person => person.id !== schedule.assignee_id && person.id !== schedule.reviewer_id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>QC Reviewer<select value={schedule.reviewer_id || ''} onChange={event => setSchedule({ ...schedule, reviewer_id: event.target.value, trainee_id: schedule.trainee_id === event.target.value ? '' : schedule.trainee_id })}><option value="">Select reviewer</option>{activePersonnel.filter(person => person.id !== schedule.assignee_id && person.id !== schedule.trainee_id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>QC Sample ID<input value={schedule.qc_sample_id || 'Not set'} readOnly disabled /></label>
      <label>Harvest Day<input type="date" value={formatDate(schedule.harvest_day_zero)} onChange={event => setHarvestDay(event.target.value)} /></label>
      <label>Start<input type={schedule.is_all_day ? 'date' : 'datetime-local'} value={schedule.start_time} onChange={event => setSchedule({ ...schedule, start_time: event.target.value })} /></label>
      <label>Duration Days<input type="number" min={1} step={1} value={schedule.duration_days || 1} onChange={event => setSchedule({ ...schedule, duration_days: Math.max(1, Number(event.target.value || 1)) })} /></label>
      <label>Execution Progress<input type="number" min={0} max={80} value={Math.min(schedule.progress || 0, 80)} onChange={event => setSchedule({ ...schedule, progress: Number(event.target.value) })} /></label>
      <button className="primaryButton wide" onClick={() => onSave(schedule)}>Save Schedule</button>
    </div>
  );
}

function AuditModal({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    setEntries([]);

    loadAuditTrail(schedule.id)
      .then(nextEntries => {
        if (active) setEntries(nextEntries);
      })
      .catch(error => {
        console.error('Unable to load GMP audit trail:', error);
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [schedule.id]);

  return (
    <Modal title="GMP Audit Trail" onClose={onClose}>
      <div className="auditList">
        {loading && <div className="infoBox auditState" role="status"><strong>Loading GMP Audit Trail...</strong></div>}
        {!loading && loadError && <div className="errorBox auditState" role="alert"><strong>Audit history could not be loaded.</strong><span>The schedule is still available. Close this window and try again.</span></div>}
        {!loading && !loadError && !entries.length && <div className="infoBox auditState" role="status"><strong>No GMP Audit Trail exists for this schedule.</strong><span>This schedule may have been created before audit tracking was enabled.</span></div>}
        {!loading && !loadError && entries.map(entry => <div key={entry.id}><strong>{auditDisplayText(entry.action, 'Schedule activity')}</strong><span>{displayTimestamp(entry.timestamp) || 'Timestamp unavailable'}</span><p>{auditDisplayText(entry.reason, 'No reason recorded.')}</p><small>{auditDisplayText(entry.user, 'User unavailable')}</small></div>)}
      </div>
    </Modal>
  );
}

function CalendarView({ schedules, personnel, refreshSchedules, user }: { schedules: Schedule[]; personnel: Personnel[]; refreshSchedules: () => Promise<void>; user: User | null }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [view, setView] = useState('dayGridMonth');
  const [selected, setSelected] = useState<Schedule | null>(null);
  const [edit, setEdit] = useState<Schedule | null>(null);
  const filtered = filterSchedules(schedules, filters);
  const events = filtered.map(schedule => {
    const person = personnel.find(item => item.id === schedule.assignee_id);
    const start = schedule.is_all_day ? formatDate(schedule.start_time) : schedule.start_time;
    const endDate = schedule.is_all_day ? addDays(formatDate(schedule.start_time), schedule.duration_days || 1) : schedule.end_time;
    return { id: schedule.id, title: `${initials(person?.initials || person?.name)}_${schedule.batch_number}_${schedule.test_name}`, start, end: endDate, allDay: schedule.is_all_day, backgroundColor: schedule.status === 'Completed' ? '#2d3748' : '#b11226', borderColor: '#841627' };
  });
  const saveCalendarSchedule = async (schedule: Schedule, action: string, reason: string) => {
    const before = await getOne<Schedule>('schedules', schedule.id);
    await saveDoc('schedules', { ...schedule, updated_by: currentUserInfo(user) }, schedule.id);
    await addAuditEntry(schedule.id, action, before, schedule, reason, currentUserInfo(user));
    await refreshSchedules();
    setSelected(schedule);
  };
  const saveCalendarEdit = async (schedule: Schedule) => {
    const reason = window.prompt('Reason for this GMP audit trail entry:', 'Calendar details update');
    if (reason === null) return;
    const before = await getOne<Schedule>('schedules', schedule.id);
    const after = { ...schedule, updated_by: currentUserInfo(user) };
    await saveDoc('schedules', after, schedule.id);
    await addAuditEntry(schedule.id, 'CALENDAR_DETAILS_UPDATE', before, after, reason, currentUserInfo(user));
    await refreshSchedules();
    setSelected(after);
    setEdit(null);
  };
  const resendInvite = async () => {
    if (!selected) return;
    const latest = await getOne<Schedule>('schedules', selected.id) || selected;
    const after = { ...latest, email_status: 'pending' as const, email_error: null, updated_by: currentUserInfo(user) };
    await saveDoc('schedules', after, latest.id);
    await addAuditEntry(latest.id, 'EMAIL_INVITE_RESEND_REQUEST', latest, after, 'User queued updated calendar invite resend from calendar details', currentUserInfo(user));
    await refreshSchedules();
    setSelected(after);
  };
  const saveDuration = async () => {
    if (!selected) return;
    const reason = window.prompt('Reason for updating assay duration:', 'Assay duration update');
    if (reason === null) return;
    const durationDays = Math.max(1, Math.round(Number(selected.duration_days || 1)));
    await saveCalendarSchedule({ ...selected, duration_days: durationDays }, 'DURATION_UPDATE', reason);
  };
  const markComplete = async () => {
    if (!selected) return;
    const reason = window.prompt('Reason for marking this test execution complete:', 'Testing completed');
    if (reason === null) return;
    const completed = { ...selected, status: 'Pending Review' as Status, progress: 80, review_status: 'Pending Review' as const, test_completed_at: new Date().toISOString(), completed_by: currentUserInfo(user) };
    await saveCalendarSchedule(completed, 'TEST_COMPLETE', reason);
  };
  const markReviewComplete = async () => {
    if (!selected) return;
    const reason = window.prompt('Reason for marking review complete:', 'QC review completed');
    if (reason === null) return;
    const completed = { ...selected, status: 'Completed' as Status, progress: 100, review_status: 'Completed' as const, review_completed_at: new Date().toISOString(), completed_by: currentUserInfo(user) };
    await saveCalendarSchedule(completed, 'REVIEW_COMPLETE', reason);
  };
  const saveProgress = async () => {
    if (!selected) return;
    const reason = window.prompt('Reason for updating progress:', 'Progress update');
    if (reason === null) return;
    const executionProgress = Math.min(selected.progress || 0, 80);
    const nextStatus: Status = executionProgress > 0 ? 'In Progress' : 'Scheduled';
    await saveCalendarSchedule({ ...selected, progress: executionProgress, status: nextStatus }, 'PROGRESS_UPDATE', reason);
  };
  return <section className="screen"><div className="screenHeader"><div><p className="eyebrow">Calendar control</p><h1>QC Schedule Calendar</h1></div><select value={view} onChange={event => setView(event.target.value)}><option value="dayGridMonth">Month</option><option value="timeGridWeek">Week</option><option value="timeGridDay">Day</option><option value="listWeek">List</option></select></div><FiltersBar schedules={schedules} personnel={personnel} filters={filters} setFilters={setFilters} /><div className="calendarPanel"><FullCalendar plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialView={view} key={view} events={events} height="auto" headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }} eventClick={info => setSelected(filtered.find(schedule => schedule.id === info.event.id) || null)} /></div>{selected && <Modal title="Scheduled Assay Details" onClose={() => setSelected(null)}><div className="detailsGrid"><div><strong>Test</strong><span>{selected.test_name}</span></div><div><strong>QC Sample ID</strong><span>{selected.qc_sample_id || 'Not set'}</span></div><div><strong>Batch</strong><span>{selected.batch_number}</span></div><div><strong>Product</strong><span>{selected.product_name || selected.product_id}</span></div><div><strong>Protocol</strong><span>{selected.protocol_name}</span></div><div><strong>Main Analyst</strong><span>{personnel.find(person => person.id === selected.assignee_id)?.name || 'Unassigned'}</span></div><div><strong>Trainee Analyst</strong><span>{selected.trainee_id ? personnel.find(person => person.id === selected.trainee_id)?.name || 'Unassigned' : 'None'}</span></div><div><strong>QC Reviewer</strong><span>{personnel.find(person => person.id === selected.reviewer_id)?.name || 'Unassigned'}</span></div><div><strong>Date</strong><span>{formatDate(selected.start_time)}</span></div><div><strong>Status</strong><StatusBadge status={selected.status} /></div><label>Duration Days<input type="number" min={1} step={1} value={selected.duration_days || 1} onChange={event => setSelected({ ...selected, duration_days: Math.max(1, Number(event.target.value || 1)) })} /></label><div className="wide"><strong>Progress</strong><ProgressBar schedule={selected} /></div><label className="wide">Execution Progress: {Math.min(selected.progress || 0, 80)}%<input type="range" min={0} max={80} step={5} value={Math.min(selected.progress || 0, 80)} onChange={event => setSelected({ ...selected, progress: Number(event.target.value) })} /></label><div className="wide modalActions"><button className="primaryButton" onClick={() => setEdit(selected)}>Edit Entry</button><button className="primaryButton" onClick={saveDuration}>Save Duration</button><button className="primaryButton" onClick={resendInvite}>Send Updated Invite</button><button className="primaryButton" onClick={saveProgress}>Save Progress</button><button className="primaryButton" onClick={markComplete}>Test Complete</button><button className="primaryButton" onClick={markReviewComplete}>Review Complete</button></div></div></Modal>}{edit && <Modal title="Edit Calendar Entry" onClose={() => setEdit(null)}><ScheduleEditor schedule={edit} personnel={personnel} setSchedule={setEdit} onSave={saveCalendarEdit} /></Modal>}</section>;
}

function ProductsProtocols({ products, protocols, refreshProducts, refreshProtocols }: { products: Product[]; protocols: Protocol[]; refreshProducts: () => Promise<void>; refreshProtocols: () => Promise<void> }) {
  const [productEdit, setProductEdit] = useState<Draft<Product> | null>(null);
  const [protocolEdit, setProtocolEdit] = useState<Draft<Protocol> | null>(null);
  const saveProduct = async () => { if (!productEdit?.name) return; await saveDoc('products', productEdit, productEdit.id); await refreshProducts(); setProductEdit(null); };
  const saveProtocol = async () => {
    if (!protocolEdit?.name || !protocolEdit.product_id) return;
    const product = products.find(item => item.id === protocolEdit.product_id);
    const payload = { ...protocolEdit, product_name: product?.name || protocolEdit.product_name || '', product_type: product?.name || '', protocol_type: protocolEdit.protocol_type || 'QC Sample Plan' as ProtocolType };
    if (payload.protocol_type === 'EM Protocol') {
      payload.em_tests = (payload.em_tests || []).map(item => ({ ...item, name: item.name.trim(), qc_sample_id: item.qc_sample_id?.trim() || '' })).filter(item => item.name);
      payload.tests = payload.em_tests.map(item => item.name);
    }
    if (payload.protocol_type !== 'EM Protocol') {
      payload.tests = (payload.tests || []).map(test => test.trim()).filter(Boolean);
      payload.test_sample_ids = Object.fromEntries(payload.tests.map(test => [test, payload.test_sample_ids?.[test]?.trim() || '']));
    }
    await saveDoc('protocols', payload, payload.id);
    await refreshProtocols();
    setProtocolEdit(null);
  };
  return <section className="screen"><div className="screenHeader"><div><p className="eyebrow">Master data</p><h1>Products & Protocols</h1></div></div><div className="twoColumn"><div className="panel"><div className="panelHeader"><h2>Products</h2><button onClick={() => setProductEdit({ name: '', product_type: '', description: '', test_frequency: '' })}>Add Product</button></div>{products.map(product => <div className="recordRow" key={product.id}><div><strong>{product.name}</strong><span>{product.product_type}</span></div><div><button onClick={() => setProductEdit(product)}>Edit</button><button onClick={() => removeDoc('products', product.id).then(refreshProducts)}>Delete</button></div></div>)}</div><div className="panel"><div className="panelHeader"><h2>Protocols</h2><button onClick={() => setProtocolEdit({ name: '', product_id: '', product_name: '', protocol_type: 'QC Sample Plan', tests: [], test_sample_ids: {}, em_tests: [], workflow_steps: [] })}>Add Protocol</button></div>{protocols.map(protocol => <div className="recordRow" key={protocol.id}><div><strong>{protocol.name}</strong><span>{protocol.protocol_type} / {protocol.product_name}</span><small>{(protocol.em_tests?.length ? protocol.em_tests.map(test => `${test.name} Day ${test.delta_day}${test.qc_sample_id ? ` / ${test.qc_sample_id}` : ''}`) : (protocol.tests || []).map(test => `${test}${protocol.test_sample_ids?.[test] ? ` / ${protocol.test_sample_ids[test]}` : ''}`)).join(', ')}</small></div><div><button onClick={() => setProtocolEdit({ ...protocol, test_sample_ids: protocol.test_sample_ids || {}, em_tests: protocol.em_tests || [], workflow_steps: protocol.workflow_steps || [] })}>Edit</button><button onClick={() => removeDoc('protocols', protocol.id).then(refreshProtocols)}>Delete</button></div></div>)}</div></div>{productEdit && <Modal title="Product" onClose={() => setProductEdit(null)}><div className="formGrid"><label>Name<input value={productEdit.name || ''} onChange={event => setProductEdit({ ...productEdit, name: event.target.value })} /></label><label>Type<input value={productEdit.product_type || ''} onChange={event => setProductEdit({ ...productEdit, product_type: event.target.value })} /></label><label className="wide">Description<input value={productEdit.description || ''} onChange={event => setProductEdit({ ...productEdit, description: event.target.value })} /></label><button className="primaryButton wide" onClick={saveProduct}>Save Product</button></div></Modal>}{protocolEdit && <ProtocolModal protocol={protocolEdit} products={products} setProtocol={setProtocolEdit} onSave={saveProtocol} onClose={() => setProtocolEdit(null)} />}</section>;
}

function ProtocolModal({ protocol, products, setProtocol, onSave, onClose }: { protocol: Draft<Protocol>; products: Product[]; setProtocol: (protocol: Draft<Protocol>) => void; onSave: () => void; onClose: () => void }) {
  const tests = protocol.tests || [];
  const testSampleIds = protocol.test_sample_ids || {};
  const emTests = protocol.em_tests || [];
  const steps = protocol.workflow_steps || [];
  const setTestName = (index: number, name: string) => {
    const previous = tests[index];
    const nextTests = tests.map((item, i) => i === index ? name : item);
    const nextSampleIds = { ...testSampleIds };
    if (previous !== name) {
      nextSampleIds[name] = nextSampleIds[previous] || '';
      delete nextSampleIds[previous];
    }
    setProtocol({ ...protocol, tests: nextTests, test_sample_ids: nextSampleIds });
  };
  const setTestSampleId = (testName: string, qcSampleId: string) => setProtocol({ ...protocol, test_sample_ids: { ...testSampleIds, [testName]: qcSampleId } });
  const removeTest = (index: number) => {
    const removed = tests[index];
    const nextSampleIds = { ...testSampleIds };
    delete nextSampleIds[removed];
    setProtocol({ ...protocol, tests: tests.filter((_, i) => i !== index), test_sample_ids: nextSampleIds });
  };
  const setEmTest = (index: number, patch: Partial<EmTest>) => setProtocol({ ...protocol, em_tests: emTests.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const setStep = (index: number, patch: Partial<WorkflowStep>) => setProtocol({ ...protocol, workflow_steps: steps.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return (
    <Modal title="Protocol" onClose={onClose}>
      <div className="formGrid">
        <label>Protocol Name<input value={protocol.name || ''} onChange={event => setProtocol({ ...protocol, name: event.target.value })} /></label>
        <label>Sub-Protocol Type<select value={protocol.protocol_type || 'QC Sample Plan'} onChange={event => setProtocol({ ...protocol, protocol_type: event.target.value as ProtocolType })}><option>QC Sample Plan</option><option>EM Protocol</option></select></label>
        <label>Product Name<select value={protocol.product_id || ''} onChange={event => setProtocol({ ...protocol, product_id: event.target.value, product_name: products.find(product => product.id === event.target.value)?.name || '' })}><option value="">Select product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        {protocol.protocol_type === 'EM Protocol' ? (
          <div className="wide subPanel">
            <div className="panelHeader"><h3>EM Tests, Delta Days, and QC Sample IDs</h3><button onClick={() => setProtocol({ ...protocol, em_tests: [...emTests, { name: '', delta_day: 0, qc_sample_id: '' }] })}>Add Test</button></div>
            {emTests.map((test, index) => <div className="inlineEdit sampleIdEdit emSampleIdEdit" key={index}><input placeholder="Test name" value={test.name} onChange={event => setEmTest(index, { name: event.target.value })} /><input type="number" placeholder="Delta day" value={test.delta_day} onChange={event => setEmTest(index, { delta_day: Number(event.target.value || 0) })} /><input placeholder="QC Sample ID" value={test.qc_sample_id || ''} onChange={event => setEmTest(index, { qc_sample_id: event.target.value })} /><button onClick={() => setProtocol({ ...protocol, em_tests: emTests.filter((_, i) => i !== index) })}>Remove</button></div>)}
          </div>
        ) : (
          <div className="wide subPanel">
            <div className="panelHeader"><h3>Tests and QC Sample IDs</h3><button onClick={() => setProtocol({ ...protocol, tests: [...tests, ''], test_sample_ids: testSampleIds })}>Add Test</button></div>
            {tests.map((test, index) => <div className="inlineEdit sampleIdEdit" key={index}><input placeholder="Test name" value={test} onChange={event => setTestName(index, event.target.value)} /><input placeholder="QC Sample ID" value={testSampleIds[test] || ''} onChange={event => setTestSampleId(test, event.target.value)} /><button onClick={() => removeTest(index)}>Remove</button></div>)}
          </div>
        )}
        <div className="wide subPanel"><div className="panelHeader"><h3>Dynamic assay workflow steps</h3><button onClick={() => setProtocol({ ...protocol, workflow_steps: [...steps, { id: crypto.randomUUID(), name: '', expected_days: 1, required: true }] })}>Add Step</button></div>{steps.map((step, index) => <div className="inlineEdit" key={step.id}><input placeholder="Step name" value={step.name} onChange={event => setStep(index, { name: event.target.value })} /><input type="number" min={0} value={step.expected_days || 0} onChange={event => setStep(index, { expected_days: Number(event.target.value) })} /><button onClick={() => setProtocol({ ...protocol, workflow_steps: steps.filter((_, i) => i !== index) })}>Remove</button></div>)}</div>
        <button className="primaryButton wide" onClick={onSave}>Save Protocol</button>
      </div>
    </Modal>
  );
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
    setDraft({ ...settings, website: displaySiteLabel(settings.website) });
  }, [settings]);

  const save = async () => {
    setMessage('');
    const payload = { ...defaultSettings, ...draft, website: displaySiteLabel(draft.website), id: 'general' };
    try {
      await saveDoc('adminSettings', payload, 'general');
      onSaved(payload);
      setMessage('Settings saved and applied.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save settings.');
    }
  };

  return <section className="screen"><div className="screenHeader"><div><p className="eyebrow">Configuration</p><h1>Admin Settings</h1></div></div><div className="panel formGrid"><label>Organization Name<input value={draft.organizationName || ''} onChange={event => setDraft({ ...draft, organizationName: event.target.value })} /></label><label>Dashboard Subtitle<input value={draft.website || ''} onChange={event => setDraft({ ...draft, website: event.target.value })} /></label><label>Email Workflow<select value={draft.inviteMode || 'draft-only'} onChange={event => setDraft({ ...draft, inviteMode: event.target.value as AdminSetting['inviteMode'] })}><option value="draft-only">Draft ICS Download</option><option value="apps-script">Apps Script Mail Queue</option></select></label><label>Calendar Location<input value={draft.defaultCalendarLocation || ''} onChange={event => setDraft({ ...draft, defaultCalendarLocation: event.target.value })} /></label><label className="checkLine wide"><input type="checkbox" checked={draft.allowAnalystEdits || false} onChange={event => setDraft({ ...draft, allowAnalystEdits: event.target.checked })} />Allow analyst edits</label><button className="primaryButton wide" onClick={save}>Save Settings</button>{message && <div className="infoBox wide">{message}</div>}</div></section>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [settings, setSettings] = useState<AdminSetting>(defaultSettings);
  const [handledActionLink, setHandledActionLink] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const dataEnabled = Boolean(user);
  const { personnel, products, protocols } = useReferenceData(dataEnabled);
  const schedules = useCollection<Schedule>('schedules', dataEnabled, 'start_time', 'desc');
  const stabilityProtocols = useCollection<StabilityProtocol>('stabilityProtocols', dataEnabled);
  const stabilityPrograms = useCollection<StabilityProgram>('stabilityPrograms', dataEnabled, 'updated_at', 'desc');

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
      .then(item => setSettings({ ...defaultSettings, ...(item || {}), website: displaySiteLabel(item?.website) }))
      .catch(console.error);
  }, [user]);

  useEffect(() => {
    if (!user || handledActionLink) return;
    const params = new URLSearchParams(window.location.search);
    const scheduleId = params.get('schedule') || params.get('scheduleId');
    const action = params.get('action');
    if (!scheduleId || !['test-complete', 'review-complete'].includes(action || '')) return;
    setHandledActionLink(true);
    getOne<Schedule>('schedules', scheduleId)
      .then(async schedule => {
        if (!schedule) throw new Error('Schedule was not found.');
        const after = action === 'test-complete'
          ? { ...schedule, status: 'Pending Review' as Status, progress: 80, review_status: 'Pending Review' as const, test_completed_at: new Date().toISOString(), completed_by: currentUserInfo(user) }
          : { ...schedule, status: 'Completed' as Status, progress: 100, review_status: 'Completed' as const, review_completed_at: new Date().toISOString(), completed_by: currentUserInfo(user) };
        await saveDoc('schedules', after, scheduleId);
        await addAuditEntry(scheduleId, action === 'test-complete' ? 'TEST_COMPLETE_EMAIL_LINK' : 'REVIEW_COMPLETE_EMAIL_LINK', schedule, after, 'Completed from email action link', currentUserInfo(user));
        await schedules.refresh();
        setTab('Schedules');
        window.history.replaceState({}, document.title, window.location.pathname);
      })
      .catch(error => window.alert(error instanceof Error ? error.message : 'Unable to apply email action link.'));
  }, [user, handledActionLink]);

  const tabs = useMemo(() => [
    ['Dashboard', LayoutDashboard],
    ['Create Schedule', FlaskConical],
    ['Schedules', ClipboardList],
    ['Calendar', CalendarDays],
    ['QC Stability', Timer],
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
        <div className="brand"><strong>QC Planner</strong><span>{displaySiteLabel(settings.website)}</span></div>
        <nav>{tabs.map(([name, Icon]) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}><Icon size={18} />{name}</button>)}</nav>
        <div className="accountActions">
          <button onClick={() => setShowPasswordModal(true)}><KeyRound size={18} />Change Password</button>
          <button className="signOut" onClick={() => auth && signOut(auth)}><LogOut size={18} />Sign Out</button>
        </div>
      </aside>
      <main>
        {tab === 'Dashboard' && <Dashboard schedules={schedules.items} personnel={personnel.items} settings={settings} refreshSchedules={schedules.refresh} user={user} />}
        {tab === 'Create Schedule' && <CreateSchedule products={products.items} protocols={protocols.items} personnel={personnel.items} refreshSchedules={schedules.refresh} user={user} />}
        {tab === 'Schedules' && <Schedules schedules={schedules.items} personnel={personnel.items} refreshSchedules={schedules.refresh} user={user} />}
        {tab === 'Calendar' && <CalendarView schedules={schedules.items} personnel={personnel.items} refreshSchedules={schedules.refresh} user={user} />}
        {tab === 'QC Stability' && <Stability products={products.items} personnel={personnel.items} schedules={schedules.items} protocols={stabilityProtocols.items} programs={stabilityPrograms.items} refreshProtocols={stabilityProtocols.refresh} refreshPrograms={stabilityPrograms.refresh} refreshSchedules={schedules.refresh} user={user} />}
        {tab === 'Products & Protocols' && <ProductsProtocols products={products.items} protocols={protocols.items} refreshProducts={products.refresh} refreshProtocols={protocols.refresh} />}
        {tab === 'Personnel' && <PersonnelPage personnel={personnel.items} refreshPersonnel={personnel.refresh} />}
        {tab === 'Admin Settings' && <AdminSettingsPage settings={settings} onSaved={setSettings} />}
      </main>
      {showPasswordModal && <ChangePasswordModal user={user} onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}
