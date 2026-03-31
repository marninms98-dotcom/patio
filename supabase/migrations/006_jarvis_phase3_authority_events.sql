-- ============================================================
-- JARVIS Phase 3 — Authority & Event-Driven Operations
-- Migration 006: event_queue, tool_boundary_contracts,
--                scheduled_triggers, delegation_sessions,
--                trust_graduation_log + authority seeds
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- EVENT QUEUE
-- Central event processing queue. Railway workers poll this.
-- ────────────────────────────────────────────────────────────
create table event_queue (
  id              uuid primary key default uuid_generate_v4(),
  event_type      text not null
                  check (event_type in (
                    'webhook_ghl', 'payment_xero', 'status_change',
                    'schedule_trigger', 'email_inbound', 'thread_due'
                  )),
  source          text not null,
  payload         jsonb default '{}'::jsonb,
  priority        integer not null default 50
                  check (priority >= 0 and priority <= 100),
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  retry_count     integer not null default 0,
  max_retries     integer not null default 3,
  scheduled_for   timestamptz default now(),
  locked_by       text,
  locked_at       timestamptz,
  processed_at    timestamptz,
  error_message   text,
  created_at      timestamptz default now()
);

create index idx_event_queue_pending on event_queue (status, priority, scheduled_for)
  where status = 'pending';
create index idx_event_queue_locked on event_queue (locked_at)
  where status = 'processing';

-- ────────────────────────────────────────────────────────────
-- TOOL BOUNDARY CONTRACTS
-- JSON Schema per MCP tool — rate limits, sequencing rules,
-- shadow mode control.
-- ────────────────────────────────────────────────────────────
create table tool_boundary_contracts (
  id                    uuid primary key default uuid_generate_v4(),
  tool_name             text unique not null,
  description           text,
  param_schema          jsonb default '{}'::jsonb,
  rate_limit_per_minute integer,
  rate_limit_per_hour   integer,
  rate_limit_per_day    integer,
  allowed_after_tools   text[] default '{}',
  blocked_after_tools   text[] default '{}',
  shadow_mode           boolean not null default true,
  enabled               boolean not null default true,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- SCHEDULED TRIGGERS
-- Cron-like schedules managed by Railway Node.js worker.
-- ────────────────────────────────────────────────────────────
create table scheduled_triggers (
  id              uuid primary key default uuid_generate_v4(),
  name            text unique not null,
  description     text,
  cron_expression text not null,
  timezone        text not null default 'Australia/Perth',
  event_type      text not null,
  payload         jsonb default '{}'::jsonb,
  enabled         boolean not null default true,
  last_fired_at   timestamptz,
  next_fire_at    timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- DELEGATION SESSIONS
-- Temporary authority delegation between staff members.
-- ────────────────────────────────────────────────────────────
create table delegation_sessions (
  id                          uuid primary key default uuid_generate_v4(),
  delegator_entity_id         uuid not null references entity_profiles(id) on delete cascade,
  delegate_entity_id          uuid not null references entity_profiles(id) on delete cascade,
  authority_levels_delegated  integer[] not null default '{3,4}',
  reason                      text,
  starts_at                   timestamptz not null default now(),
  expires_at                  timestamptz not null,
  active                      boolean not null default true,
  created_at                  timestamptz default now()
);

create index idx_delegation_active on delegation_sessions (delegate_entity_id, active)
  where active = true;

-- ────────────────────────────────────────────────────────────
-- TRUST GRADUATION LOG
-- Audit trail for authority level changes.
-- ────────────────────────────────────────────────────────────
create table trust_graduation_log (
  id                    uuid primary key default uuid_generate_v4(),
  action                text not null,
  previous_level        integer not null,
  new_level             integer not null,
  reason                text not null
                        check (reason in (
                          'auto_graduation', 'manual_set',
                          'rejection_reset', 'manual_override'
                        )),
  consecutive_approvals integer,
  changed_by            text not null,
  created_at            timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- TRIGGERS (updated_at)
-- ────────────────────────────────────────────────────────────
create trigger trg_tool_contracts_updated before update on tool_boundary_contracts
  for each row execute function update_updated_at();

create trigger trg_scheduled_triggers_updated before update on scheduled_triggers
  for each row execute function update_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS POLICIES
-- ────────────────────────────────────────────────────────────
alter table event_queue enable row level security;
alter table tool_boundary_contracts enable row level security;
alter table scheduled_triggers enable row level security;
alter table delegation_sessions enable row level security;
alter table trust_graduation_log enable row level security;

create policy "Service role manages event queue"
  on event_queue for all
  using (auth.role() = 'service_role');

create policy "Users can view event queue"
  on event_queue for select
  using (true);

create policy "Service role manages tool contracts"
  on tool_boundary_contracts for all
  using (auth.role() = 'service_role');

create policy "Users can view tool contracts"
  on tool_boundary_contracts for select
  using (true);

create policy "Service role manages scheduled triggers"
  on scheduled_triggers for all
  using (auth.role() = 'service_role');

create policy "Users can view scheduled triggers"
  on scheduled_triggers for select
  using (true);

create policy "Service role manages delegation sessions"
  on delegation_sessions for all
  using (auth.role() = 'service_role');

create policy "Users can view delegation sessions"
  on delegation_sessions for select
  using (true);

create policy "Service role manages trust graduation log"
  on trust_graduation_log for all
  using (auth.role() = 'service_role');

create policy "Users can view trust graduation log"
  on trust_graduation_log for select
  using (true);

-- ────────────────────────────────────────────────────────────
-- SEED: Scheduled Triggers (Perth AWST)
-- ────────────────────────────────────────────────────────────
insert into scheduled_triggers (name, description, cron_expression, event_type, payload) values
  ('morning_brief',         'Daily morning briefing for owner',            '0 6 * * 1-6',    'schedule_trigger', '{"action":"morning_brief"}'::jsonb),
  ('mid_morning_cycle',     'Mid-morning lead chase + follow-up cycle',    '0 10 * * 1-5',   'schedule_trigger', '{"action":"mid_morning_cycle"}'::jsonb),
  ('afternoon_review',      'Afternoon pipeline review',                   '0 15 * * 1-5',   'schedule_trigger', '{"action":"afternoon_review"}'::jsonb),
  ('end_of_day',            'End of day summary + next-day prep',          '0 17 * * 1-5',   'schedule_trigger', '{"action":"end_of_day"}'::jsonb),
  ('memory_consolidation',  'Nightly memory consolidation run',            '0 0 * * *',      'schedule_trigger', '{"action":"memory_consolidation"}'::jsonb),
  ('overdue_check',         'Check for overdue commitments + threads',     '0 9 * * 1-5',    'schedule_trigger', '{"action":"overdue_check"}'::jsonb),
  ('thread_due_scan',       'Scan active threads for due actions',         '*/30 * * * *',   'thread_due',       '{"action":"thread_due_scan"}'::jsonb);

-- ────────────────────────────────────────────────────────────
-- SEED: Authority Levels (tool-based, L1-L3)
-- Add unique constraint first for ON CONFLICT
-- ────────────────────────────────────────────────────────────
-- Level 1: Auto-Execute (read-only, internal ops)
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'read_job_details', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'read_contact', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'read_invoice', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'search_memory', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'store_observation', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'update_internal_note', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'log_communication', true, false)
on conflict (org_id, role, channel, action) do nothing;

-- Level 2: Execute & Notify
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_progress_update', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_stage1_chase', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_daily_digest', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'update_job_status', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_crew_notification', true, false)
on conflict (org_id, role, channel, action) do nothing;

-- Level 3: Propose & Wait (requires confirmation)
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_quote', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'negotiate_price', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'commit_start_date', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_stage2_chase', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_stage3_chase', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'create_invoice', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'schedule_job', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'order_materials', true, true)
on conflict (org_id, role, channel, action) do nothing;

-- Level 4: Escalate (blocked — requires manual owner intervention)
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'escalate_complaint', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'handle_dispute', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'send_stage4_chase', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'modify_pricing', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'legal_action', true, true),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'large_purchase', true, true)
on conflict (org_id, role, channel, action) do nothing;
