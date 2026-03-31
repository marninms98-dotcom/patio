-- ============================================================
-- JARVIS Phase 6 — SOP Generation & Self-Improvement
-- Migration 009: action_trace_sequences, standard_procedures,
--   procedure_executions, prompt_rules
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ACTION TRACE SEQUENCES
-- Links intention_log entries into chains per job.
-- ────────────────────────────────────────────────────────────
create table if not exists action_trace_sequences (
  id                uuid primary key default uuid_generate_v4(),
  job_id            uuid not null references jobs(id) on delete cascade,
  intention_ids     uuid[] not null default '{}',
  phase             text,
  sequence_index    int not null default 0,
  action_type       text not null,
  duration_ms       int,
  gap_from_prev_ms  int,
  metadata          jsonb default '{}'::jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_action_trace_job on action_trace_sequences(job_id);
create index idx_action_trace_phase on action_trace_sequences(phase);
create index idx_action_trace_created on action_trace_sequences(created_at desc);

-- ────────────────────────────────────────────────────────────
-- 2. STANDARD PROCEDURES (SOPs)
-- Stores approved SOPs with step sequences and branching logic.
-- ────────────────────────────────────────────────────────────
create table if not exists standard_procedures (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null,
  description       text,
  job_type          text,
  step_sequence     jsonb not null default '[]'::jsonb,
  branching_logic   jsonb default '{}'::jsonb,
  approval_status   text not null default 'draft'
                    check (approval_status in ('draft', 'pending_review', 'approved', 'deprecated')),
  approved_by       text,
  version           int not null default 1,
  source_job_ids    uuid[] default '{}',
  pattern_frequency decimal(5,2),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_sop_job_type on standard_procedures(job_type);
create index idx_sop_status on standard_procedures(approval_status);
create index idx_sop_version on standard_procedures(name, version);

-- ────────────────────────────────────────────────────────────
-- 3. PROCEDURE EXECUTIONS
-- Tracks SOP execution per job with deviations.
-- ────────────────────────────────────────────────────────────
create table if not exists procedure_executions (
  id                uuid primary key default uuid_generate_v4(),
  job_id            uuid not null references jobs(id) on delete cascade,
  procedure_id      uuid not null references standard_procedures(id) on delete cascade,
  current_step      int not null default 0,
  status            text not null default 'active'
                    check (status in ('active', 'completed', 'deviated', 'paused', 'aborted')),
  deviations        jsonb default '[]'::jsonb,
  step_results      jsonb default '[]'::jsonb,
  started_at        timestamptz default now(),
  completed_at      timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_proc_exec_job on procedure_executions(job_id);
create index idx_proc_exec_procedure on procedure_executions(procedure_id);
create index idx_proc_exec_status on procedure_executions(status);

-- ────────────────────────────────────────────────────────────
-- 4. PROMPT RULES
-- Version-controlled prompt rules from owner directives,
-- learned patterns, and SOP-derived instructions.
-- ────────────────────────────────────────────────────────────
create table if not exists prompt_rules (
  id                uuid primary key default uuid_generate_v4(),
  rule_text         text not null,
  category          text not null,
  version           int not null default 1,
  active            boolean not null default false,
  source            varchar(50) not null default 'learned'
                    check (source in ('owner_directive', 'learned', 'sop')),
  previous_version  uuid references prompt_rules(id) on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_prompt_rules_category on prompt_rules(category);
create index idx_prompt_rules_active on prompt_rules(active) where active = true;
create index idx_prompt_rules_source on prompt_rules(source);

-- ────────────────────────────────────────────────────────────
-- TRIGGERS
-- ────────────────────────────────────────────────────────────
create trigger trg_action_trace_updated before update on action_trace_sequences
  for each row execute function update_timestamp();

create trigger trg_standard_procedures_updated before update on standard_procedures
  for each row execute function update_timestamp();

create trigger trg_procedure_executions_updated before update on procedure_executions
  for each row execute function update_timestamp();

create trigger trg_prompt_rules_updated before update on prompt_rules
  for each row execute function update_timestamp();

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table action_trace_sequences enable row level security;
alter table standard_procedures enable row level security;
alter table procedure_executions enable row level security;
alter table prompt_rules enable row level security;

create policy "Service role manages action traces" on action_trace_sequences for all using (auth.role() = 'service_role');
create policy "Users can view action traces" on action_trace_sequences for select using (true);

create policy "Service role manages standard procedures" on standard_procedures for all using (auth.role() = 'service_role');
create policy "Users can view standard procedures" on standard_procedures for select using (true);

create policy "Service role manages procedure executions" on procedure_executions for all using (auth.role() = 'service_role');
create policy "Users can view procedure executions" on procedure_executions for select using (true);

create policy "Service role manages prompt rules" on prompt_rules for all using (auth.role() = 'service_role');
create policy "Users can view prompt rules" on prompt_rules for select using (true);

-- ────────────────────────────────────────────────────────────
-- FEATURE FLAGS (ALL FALSE)
-- ────────────────────────────────────────────────────────────
insert into feature_flags (org_id, flag_key, enabled, shadow_mode, description) values
  ('00000000-0000-0000-0000-000000000001', 'sop_extraction_enabled', false, true, 'SOP extraction from completed job patterns'),
  ('00000000-0000-0000-0000-000000000001', 'sop_execution_enabled', false, true, 'SOP-guided job execution'),
  ('00000000-0000-0000-0000-000000000001', 'prompt_rules_enabled', false, true, 'Version-controlled prompt rules'),
  ('00000000-0000-0000-0000-000000000001', 'action_trace_analysis_enabled', false, true, 'Action sequence tracing and analysis')
on conflict (org_id, flag_key) do nothing;
