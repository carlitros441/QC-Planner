import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { AnalystAssayQualification, AnalystTrainingRecord, Personnel, PersonnelTimeOff, Schedule } from './types';

type PersonnelDraft = Partial<Personnel> & { id?: string };

const normalizeAssayName = (value?: string) => String(value || '').trim().toLowerCase();
const dateOnly = (value?: string) => String(value || '').split('T')[0];
const today = () => new Date().toISOString().split('T')[0];

const endDateForDuration = (startDate: string, durationDays = 1) => {
  const start = dateOnly(startDate);
  if (!start) return '';
  const end = new Date(`${start}T00:00:00`);
  end.setDate(end.getDate() + Math.max(1, Number(durationDays || 1)) - 1);
  return end.toISOString().split('T')[0];
};

export const qualificationForAssay = (person: Personnel, assayName: string) => (
  (person.assay_qualifications || []).find(item => normalizeAssayName(item.assay_name) === normalizeAssayName(assayName))
);

export const isAvailableForAssayDates = (person: Personnel, startDate?: string, durationDays = 1) => {
  const start = dateOnly(startDate);
  if (!start) return true;
  const end = endDateForDuration(start, durationDays);
  return !(person.time_off || []).some(period => period.start_date && period.end_date && period.start_date <= end && period.end_date >= start);
};

export const qualifiedAnalystsForAssay = (personnel: Personnel[], assayName: string, startDate?: string, durationDays = 1) => (
  personnel.filter(person => person.active !== false
    && qualificationForAssay(person, assayName)?.status === 'Qualified'
    && isAvailableForAssayDates(person, startDate, durationDays))
);

export const trainingAnalystsForAssay = (personnel: Personnel[], assayName: string, startDate?: string, durationDays = 1) => (
  personnel.filter(person => person.active !== false
    && qualificationForAssay(person, assayName)?.status === 'In Training'
    && isAvailableForAssayDates(person, startDate, durationDays))
);

export const rollingAssigneeForAssay = (personnel: Personnel[], schedules: Schedule[], assayName: string, startDate?: string, durationDays = 1) => {
  const candidates = qualifiedAnalystsForAssay(personnel, assayName, startDate, durationDays);
  if (!candidates.length) return '';
  const assayKey = normalizeAssayName(assayName);
  const lastAssignment = new Map<string, string>();
  schedules.forEach(schedule => {
    if (schedule.status === 'Deleted' || normalizeAssayName(schedule.test_name) !== assayKey) return;
    const scheduledAt = String(schedule.start_time || '');
    if (!scheduledAt || scheduledAt <= String(lastAssignment.get(schedule.assignee_id) || '')) return;
    lastAssignment.set(schedule.assignee_id, scheduledAt);
  });
  return [...candidates]
    .sort((left, right) => {
      const dateComparison = String(lastAssignment.get(left.id) || '').localeCompare(String(lastAssignment.get(right.id) || ''));
      return dateComparison || left.name.localeCompare(right.name);
    })[0].id;
};

export function PersonnelQualificationEditor({
  person,
  personnel,
  assayNames,
  currentUser,
  onChange
}: {
  person: PersonnelDraft;
  personnel: Personnel[];
  assayNames: string[];
  currentUser: string;
  onChange: (person: PersonnelDraft) => void;
}) {
  const [selectedAssay, setSelectedAssay] = useState('');
  const qualifications = person.assay_qualifications || [];
  const timeOff = person.time_off || [];
  const availableAssays = useMemo(() => assayNames.filter(name => !qualifications.some(item => normalizeAssayName(item.assay_name) === normalizeAssayName(name))), [assayNames, qualifications]);

  const setQualification = (id: string, patch: Partial<AnalystAssayQualification>) => {
    onChange({ ...person, assay_qualifications: qualifications.map(item => item.id === id ? { ...item, ...patch } : item) });
  };

  const addQualification = () => {
    if (!selectedAssay) return;
    onChange({
      ...person,
      assay_qualifications: [...qualifications, { id: crypto.randomUUID(), assay_name: selectedAssay, status: 'In Training', training_records: [] }]
    });
    setSelectedAssay('');
  };

  const addTrainingRecord = (qualification: AnalystAssayQualification) => {
    const record: AnalystTrainingRecord = {
      id: crypto.randomUUID(),
      training_date: today(),
      trainer: '',
      activity: '',
      status: 'Planned',
      notes: ''
    };
    setQualification(qualification.id, { training_records: [...(qualification.training_records || []), record] });
  };

  const setTrainingRecord = (qualification: AnalystAssayQualification, recordId: string, patch: Partial<AnalystTrainingRecord>) => {
    setQualification(qualification.id, { training_records: (qualification.training_records || []).map(record => record.id === recordId ? { ...record, ...patch } : record) });
  };

  const removeTrainingRecord = (qualification: AnalystAssayQualification, recordId: string) => {
    setQualification(qualification.id, { training_records: (qualification.training_records || []).filter(record => record.id !== recordId) });
  };

  const releaseQualification = (qualification: AnalystAssayQualification) => {
    setQualification(qualification.id, { status: 'Qualified', release_date: today(), released_by: currentUser });
  };

  const addTimeOff = () => {
    const period: PersonnelTimeOff = { id: crypto.randomUUID(), type: 'PTO', start_date: '', end_date: '', notes: '' };
    onChange({ ...person, time_off: [...timeOff, period] });
  };

  const setTimeOff = (id: string, patch: Partial<PersonnelTimeOff>) => {
    onChange({ ...person, time_off: timeOff.map(period => period.id === id ? { ...period, ...patch } : period) });
  };

  return (
    <>
      <div className="wide subPanel personnelQualificationPanel">
        <div className="panelHeader"><div><h3>Assay Qualifications & Training</h3><small>Only fully released analysts are eligible for independent assignment.</small></div></div>
        <div className="qualificationAddRow">
          <select value={selectedAssay} onChange={event => setSelectedAssay(event.target.value)}><option value="">Select assay</option>{availableAssays.map(name => <option key={name}>{name}</option>)}</select>
          <button type="button" disabled={!selectedAssay} onClick={addQualification}><Plus size={16} />Add Qualification</button>
        </div>
        <div className="qualificationList">
          {qualifications.map(qualification => {
            const completedTraining = (qualification.training_records || []).some(record => record.status === 'Completed');
            return <div className="qualificationEditor" key={qualification.id}>
              <div className="qualificationHeader">
                <div><strong>{qualification.assay_name}</strong><span className={`qualificationStatus qualification-${qualification.status.replace(/\s+/g, '-').toLowerCase()}`}>{qualification.status}</span></div>
                <div className="compactActions">
                  {qualification.status !== 'Qualified' && <button type="button" disabled={!completedTraining} title={completedTraining ? 'Release this analyst for independent testing' : 'Complete at least one training record before release'} onClick={() => releaseQualification(qualification)}><CheckCircle2 size={16} />Release</button>}
                  {qualification.status === 'Qualified' && <button type="button" onClick={() => setQualification(qualification.id, { status: 'In Training', release_date: '', released_by: '' })}><RotateCcw size={16} />Return to Training</button>}
                  {qualification.status === 'Not Qualified' && <button type="button" onClick={() => setQualification(qualification.id, { status: 'In Training' })}>Start Training</button>}
                  {qualification.status !== 'Not Qualified' && <button type="button" onClick={() => setQualification(qualification.id, { status: 'Not Qualified', release_date: '', released_by: '' })}>Revoke</button>}
                  <button type="button" title="Remove qualification record" onClick={() => onChange({ ...person, assay_qualifications: qualifications.filter(item => item.id !== qualification.id) })}><Trash2 size={16} /></button>
                </div>
              </div>
              {qualification.status === 'Qualified' && <div className="releaseRecord"><span>Released {qualification.release_date || 'Not dated'}</span><span>By {qualification.released_by || 'Not recorded'}</span></div>}
              <label>Qualification Notes<textarea value={qualification.notes || ''} onChange={event => setQualification(qualification.id, { notes: event.target.value })} /></label>
              <div className="panelHeader trainingHeader"><h4>Training Records</h4><button type="button" onClick={() => addTrainingRecord(qualification)}><Plus size={16} />Add Training</button></div>
              {(qualification.training_records || []).map(record => <div className="trainingRecord" key={record.id}>
                <input aria-label="Training date" type="date" value={record.training_date} onChange={event => setTrainingRecord(qualification, record.id, { training_date: event.target.value })} />
                <select aria-label="Trainer" value={record.trainer} onChange={event => setTrainingRecord(qualification, record.id, { trainer: event.target.value })}><option value="">Select trainer</option>{personnel.filter(item => item.active !== false && item.id !== person.id).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select>
                <input aria-label="Training activity" placeholder="Training activity" value={record.activity} onChange={event => setTrainingRecord(qualification, record.id, { activity: event.target.value })} />
                <select aria-label="Training status" value={record.status} onChange={event => setTrainingRecord(qualification, record.id, { status: event.target.value as AnalystTrainingRecord['status'] })}><option>Planned</option><option>Completed</option></select>
                <input aria-label="Training notes" placeholder="Notes or record reference" value={record.notes || ''} onChange={event => setTrainingRecord(qualification, record.id, { notes: event.target.value })} />
                <button type="button" title="Remove training record" onClick={() => removeTrainingRecord(qualification, record.id)}><Trash2 size={16} /></button>
              </div>)}
              {!(qualification.training_records || []).length && <p className="emptyState">No training records entered.</p>}
            </div>;
          })}
          {!qualifications.length && <p className="emptyState">No assay qualifications configured.</p>}
        </div>
      </div>

      <div className="wide subPanel personnelQualificationPanel">
        <div className="panelHeader"><div><h3>Future PTO & Vacations</h3></div><button type="button" onClick={addTimeOff}><Plus size={16} />Add Time Off</button></div>
        {timeOff.map(period => <div className="timeOffRecord" key={period.id}>
          <select aria-label="Time off type" value={period.type} onChange={event => setTimeOff(period.id, { type: event.target.value as PersonnelTimeOff['type'] })}><option>PTO</option><option>Vacation</option><option>Other</option></select>
          <input aria-label="Time off start" type="date" value={period.start_date} onChange={event => setTimeOff(period.id, { start_date: event.target.value })} />
          <input aria-label="Time off end" type="date" min={period.start_date} value={period.end_date} onChange={event => setTimeOff(period.id, { end_date: event.target.value })} />
          <input aria-label="Time off notes" placeholder="Notes" value={period.notes || ''} onChange={event => setTimeOff(period.id, { notes: event.target.value })} />
          <button type="button" title="Remove time-off record" onClick={() => onChange({ ...person, time_off: timeOff.filter(item => item.id !== period.id) })}><Trash2 size={16} /></button>
        </div>)}
        {!timeOff.length && <p className="emptyState">No future time off recorded.</p>}
      </div>
    </>
  );
}
