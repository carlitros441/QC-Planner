export type Status = 'Scheduled' | 'In Progress' | 'Pending Review' | 'Completed' | 'Deleted';
export type ProtocolType = 'QC Sample Plan' | 'EM Protocol';
export type Role = 'Admin' | 'Manager' | 'Supervisor' | 'QA' | 'Analyst';
export type AccessLevel = 'Viewer' | 'Analyst' | 'Supervisor' | 'Admin';

export interface BaseDoc {
  id: string;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface Product extends BaseDoc {
  name: string;
  product_type?: string;
  description?: string;
  test_frequency?: string;
}

export interface EmTest {
  name: string;
  delta_day: number;
  qc_sample_id?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  owner_role?: string;
  expected_days?: number;
  required?: boolean;
}

export interface Protocol extends BaseDoc {
  name: string;
  protocol_id?: string;
  protocol_type: ProtocolType;
  product_id: string;
  product_name: string;
  product_type?: string;
  tests: string[];
  test_sample_ids?: Record<string, string>;
  em_tests?: EmTest[];
  workflow_steps?: WorkflowStep[];
}

export interface Personnel extends BaseDoc {
  name: string;
  email: string;
  role: Role;
  initials?: string;
  active: boolean;
}

export interface AccessProfile extends BaseDoc {
  email: string;
  name: string;
  personnel_id: string;
  role: Role;
  access_level: AccessLevel;
  active: boolean;
}

export interface Schedule extends BaseDoc {
  product_id: string;
  product_name: string;
  batch_number: string;
  protocol_name: string;
  protocol_type: ProtocolType;
  stability_program_id?: string;
  stability_protocol_id?: string;
  stability_time_point_id?: string;
  stability_time_point_label?: string;
  stability_target_date?: string;
  stability_window_start?: string;
  stability_window_end?: string;
  harvest_day_zero?: string;
  delta_day?: number | null;
  qc_sample_id?: string;
  test_name: string;
  workflow_step?: string;
  assignee_id: string;
  trainee_id?: string;
  reviewer_id?: string;
  start_time: string;
  end_time?: string;
  is_all_day: boolean;
  duration_days?: number | null;
  status: Status;
  progress?: number;
  review_status?: 'Not Ready' | 'Pending Review' | 'Completed';
  test_completed_at?: unknown;
  review_completed_at?: unknown;
  email_status?: 'pending' | 'processing' | 'sent' | 'failed' | 'drafted';
  email_error?: string | null;
  created_by?: string;
  updated_by?: string;
  completed_by?: string;
  deleted_by?: string;
}

export type LabResourceType = 'Material' | 'Reagent' | 'Equipment';

export interface LabResource extends BaseDoc {
  type: LabResourceType;
  name: string;
  catalog_number?: string;
  lot_number?: string;
  vendor?: string;
  location?: string;
  unit?: string;
  quantity_received?: number;
  minimum_quantity?: number;
  expiration_date?: string;
  equipment_id?: string;
  calibration_due_date?: string;
  notes?: string;
  active: boolean;
  created_by?: string;
  updated_by?: string;
}

export interface AssayResourceUsage extends BaseDoc {
  schedule_id: string;
  resource_id: string;
  resource_name: string;
  resource_type: LabResourceType;
  quantity: number;
  unit?: string;
  lot_number?: string;
  equipment_id?: string;
  used_at: string;
  used_by: string;
  notes?: string;
  status: 'Active' | 'Voided';
  void_reason?: string;
  voided_at?: string;
  voided_by?: string;
}

export interface AuditEntry extends BaseDoc {
  schedule_id: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason: string;
  user: string;
  timestamp?: unknown;
}

export interface AdminSetting extends BaseDoc {
  organizationName?: string;
  website?: string;
  inviteMode?: 'apps-script' | 'draft-only';
  defaultCalendarLocation?: string;
  allowAnalystEdits?: boolean;
}

export interface Filters {
  status: string;
  assignee: string;
  protocol: string;
  product: string;
  batch: string;
  test: string;
}

export type StabilityProgramStatus = 'Draft' | 'Scheduled' | 'Completed';

export interface StabilityTestTemplate {
  id: string;
  name: string;
  qc_sample_id?: string;
}

export interface StabilityTimePointTemplate {
  id: string;
  label: string;
  months: number;
  window_start_offset_days: number;
  window_end_offset_days: number;
  tests: StabilityTestTemplate[];
}

export interface StabilityProtocol extends BaseDoc {
  name: string;
  description?: string;
  time_points: StabilityTimePointTemplate[];
}

export interface StabilityAssignment {
  id: string;
  time_point_id: string;
  time_point_label: string;
  months: number;
  target_date: string;
  window_start: string;
  window_end: string;
  window_start_offset_days: number;
  window_end_offset_days: number;
  test_name: string;
  qc_sample_id?: string;
  include: boolean;
  assignee_id: string;
  trainee_id?: string;
  reviewer_id: string;
  start_time: string;
  duration_days: number;
  generated_schedule_id?: string;
}

export interface StabilityProgram extends BaseDoc {
  product_id: string;
  product_name: string;
  batch_number: string;
  harvest_day_zero: string;
  protocol_id: string;
  protocol_name: string;
  status: StabilityProgramStatus;
  assignments: StabilityAssignment[];
  generated_schedule_ids?: string[];
  created_by?: string;
  updated_by?: string;
  pushed_by?: string;
  pushed_at?: unknown;
}

export interface StabilityFilters {
  product: string;
  batch: string;
  protocol: string;
  timePoint: string;
  status: string;
  analyst: string;
  priority: string;
  dueWindow: string;
}
