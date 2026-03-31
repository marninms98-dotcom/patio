-- ============================================================
-- JARVIS Phase 5 — Job Lifecycle Intelligence
-- Migration 008: jobs (extended), job_state_transitions,
--   job_scope, job_cost_tracking, job_margin_alerts,
--   scope_validation_rules
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. JOB STATE TRANSITIONS
-- Audit log of every state change with who/why/when.
-- ────────────────────────────────────────────────────────────
create table if not exists job_state_transitions (
  id                uuid primary key default uuid_generate_v4(),
  job_id            uuid not null references jobs(id) on delete cascade,
  from_state        text not null,
  to_state          text not null,
  triggered_by      text not null,
  trigger_channel   text,
  reason            text,
  metadata          jsonb default '{}'::jsonb,
  intention_id      uuid references intention_log(id) on delete set null,
  created_at        timestamptz default now()
);

create index idx_job_transitions_job on job_state_transitions(job_id);
create index idx_job_transitions_to on job_state_transitions(to_state);
create index idx_job_transitions_created on job_state_transitions(created_at desc);

-- ────────────────────────────────────────────────────────────
-- 2. JOB SCOPE
-- Structured scope data extracted from scope_json for validation.
-- ────────────────────────────────────────────────────────────
create table if not exists job_scope (
  id                uuid primary key default uuid_generate_v4(),
  job_id            uuid not null references jobs(id) on delete cascade,
  projection_mm     int,
  length_mm         int,
  height_mm         int,
  area_sqm          decimal(10,2),
  roof_type         text,
  sheet_type        text,
  sheet_colour      text,
  steel_colour      text,
  wind_rating       text,
  suburb            text,
  council           text,
  num_posts         int,
  num_beams         int,
  num_rafters       int,
  num_sheets        int,
  has_gutters       boolean default false,
  has_downpipes     boolean default false,
  has_fascia        boolean default false,
  attachment_type   text,
  footing_type      text,
  quoted_amount     decimal(12,2) check (quoted_amount is null or quoted_amount > 0),
  materials_list    jsonb default '[]'::jsonb,
  scope_hash        text,
  validated_at      timestamptz,
  validation_result jsonb default '{}'::jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_job_scope_job on job_scope(job_id);
create index idx_job_scope_suburb on job_scope(suburb);
create index idx_job_scope_hash on job_scope(scope_hash);

-- ────────────────────────────────────────────────────────────
-- 3. JOB COST TRACKING
-- Real-time cost tracking: materials, labour, overheads.
-- ────────────────────────────────────────────────────────────
create table if not exists job_cost_tracking (
  id                    uuid primary key default uuid_generate_v4(),
  job_id                uuid not null references jobs(id) on delete cascade,
  quoted_total          decimal(12,2),
  quoted_materials      decimal(12,2),
  quoted_labour         decimal(12,2),
  quoted_margin_pct     decimal(5,2),
  actual_materials      decimal(12,2) default 0,
  actual_labour         decimal(12,2) default 0,
  actual_overheads      decimal(12,2) default 0,
  actual_total          decimal(12,2) default 0,
  current_margin_pct    decimal(5,2),
  variance_materials    decimal(12,2) default 0,
  variance_labour       decimal(12,2) default 0,
  variance_total        decimal(12,2) default 0,
  last_xero_sync_at     timestamptz,
  last_crew_sync_at     timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index idx_job_cost_job on job_cost_tracking(job_id);

-- ────────────────────────────────────────────────────────────
-- 4. JOB MARGIN ALERTS
-- Triggered when cost tracking detects margin drift.
-- ────────────────────────────────────────────────────────────
create table if not exists job_margin_alerts (
  id                uuid primary key default uuid_generate_v4(),
  job_id            uuid not null references jobs(id) on delete cascade,
  cost_tracking_id  uuid references job_cost_tracking(id) on delete set null,
  alert_type        text not null
                    check (alert_type in (
                      'material_overrun', 'labour_overrun',
                      'margin_below_threshold', 'cost_spike'
                    )),
  severity          text not null default 'warning'
                    check (severity in ('info', 'warning', 'critical')),
  message           text not null,
  threshold_value   decimal(10,2),
  actual_value      decimal(10,2),
  acknowledged      boolean default false,
  acknowledged_by   text,
  acknowledged_at   timestamptz,
  created_at        timestamptz default now()
);

create index idx_margin_alerts_job on job_margin_alerts(job_id);
create index idx_margin_alerts_unack on job_margin_alerts(acknowledged)
  where acknowledged = false;

-- ────────────────────────────────────────────────────────────
-- 5. SCOPE VALIDATION RULES
-- Configurable validation rules for scope checking.
-- ────────────────────────────────────────────────────────────
create table if not exists scope_validation_rules (
  id                uuid primary key default uuid_generate_v4(),
  rule_name         text unique not null,
  description       text,
  job_type          text,
  field_name        text not null,
  validation_type   text not null
                    check (validation_type in (
                      'required', 'range', 'enum', 'custom', 'wind_rating'
                    )),
  parameters        jsonb default '{}'::jsonb,
  severity          text not null default 'error'
                    check (severity in ('error', 'warning', 'info')),
  enabled           boolean default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_scope_rules_type on scope_validation_rules(job_type);

-- ────────────────────────────────────────────────────────────
-- TRIGGERS
-- ────────────────────────────────────────────────────────────
create trigger trg_job_scope_updated before update on job_scope
  for each row execute function update_updated_at();

create trigger trg_job_cost_updated before update on job_cost_tracking
  for each row execute function update_updated_at();

create trigger trg_scope_rules_updated before update on scope_validation_rules
  for each row execute function update_updated_at();

-- job_state_transitions and job_margin_alerts are append-only

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table job_state_transitions enable row level security;
alter table job_scope enable row level security;
alter table job_cost_tracking enable row level security;
alter table job_margin_alerts enable row level security;
alter table scope_validation_rules enable row level security;

create policy "Service role manages job state transitions" on job_state_transitions for all using (auth.role() = 'service_role');
create policy "Users can view job state transitions" on job_state_transitions for select using (true);

create policy "Service role manages job scope" on job_scope for all using (auth.role() = 'service_role');
create policy "Users can view job scope" on job_scope for select using (true);

create policy "Service role manages job cost tracking" on job_cost_tracking for all using (auth.role() = 'service_role');
create policy "Users can view job cost tracking" on job_cost_tracking for select using (true);

create policy "Service role manages job margin alerts" on job_margin_alerts for all using (auth.role() = 'service_role');
create policy "Users can view job margin alerts" on job_margin_alerts for select using (true);

create policy "Service role manages scope validation rules" on scope_validation_rules for all using (auth.role() = 'service_role');
create policy "Users can view scope validation rules" on scope_validation_rules for select using (true);

-- ────────────────────────────────────────────────────────────
-- FEATURE FLAGS (ALL FALSE)
-- ────────────────────────────────────────────────────────────
insert into feature_flags (org_id, flag_key, enabled, shadow_mode, description) values
  ('00000000-0000-0000-0000-000000000001', 'job_state_machine_enabled', false, true, 'Job lifecycle state machine'),
  ('00000000-0000-0000-0000-000000000001', 'scope_validation_enabled', false, true, 'Scope validation against rules'),
  ('00000000-0000-0000-0000-000000000001', 'wind_rating_validation_enabled', false, true, 'Perth wind zone compliance checks'),
  ('00000000-0000-0000-0000-000000000001', 'anomaly_detection_enabled', false, true, 'Anomaly detection on scope measurements'),
  ('00000000-0000-0000-0000-000000000001', 'cost_tracking_enabled', false, true, 'Real-time job cost tracking'),
  ('00000000-0000-0000-0000-000000000001', 'xero_cost_sync_enabled', false, true, 'Sync material costs from Xero POs'),
  ('00000000-0000-0000-0000-000000000001', 'crew_schedule_sync_enabled', false, true, 'Sync labour costs from crew schedules'),
  ('00000000-0000-0000-0000-000000000001', 'margin_alerts_enabled', false, true, 'Margin drift alerts'),
  ('00000000-0000-0000-0000-000000000001', 'auto_material_ordering_enabled', false, true, 'Automated material order generation'),
  ('00000000-0000-0000-0000-000000000001', 'job_intelligence_briefs_enabled', false, true, 'AI-generated job intelligence briefs'),
  ('00000000-0000-0000-0000-000000000001', 'predictive_scheduling_enabled', false, true, 'Predictive scheduling suggestions')
on conflict (org_id, flag_key) do nothing;
