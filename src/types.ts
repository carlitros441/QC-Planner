export type Status = 'Scheduled' | 'In Progress' | 'Completed' | 'Deleted';
export type ProtocolType = 'QC Sample Plan' | 'EM Protocol';
export type Role = 'Admin' | 'Manager' | 'Supervisor' | 'QA' | 'Analyst';

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

export interface Schedule extends BaseDoc {
  product_id: string;
  product_name: string;
  batch_number: string;
  protocol_name: string;
  protocol_type: ProtocolType;
  harvest_day_zero?: string;
  delta_day?: number | null;
  test_name: string;
  workflow_step?: string;
  assignee_id: string;
  start_time: string;
  end_time?: string;
  is_all_day: boolean;
  duration_days?: number | null;
  status: Status;
  progress?: number;
  email_status?: 'pending' | 'processing' | 'sent' | 'failed' | 'drafted';
  email_error?: string | null;
  created_by?: string;
  updated_by?: string;
  completed_by?: string;
  deleted_by?: string;
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
}
