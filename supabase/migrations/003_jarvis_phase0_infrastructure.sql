-- ============================================================
-- JARVIS Phase 0 — Infrastructure & Safety Spine
-- Migration 003: intention_log, feature_flags, authority_levels
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- AUTHORITY LEVELS
-- Defines what each role/channel is allowed to do.
-- The orchestrator checks these before executing any action.
-- ────────────────────────────────────────────────────────────
create table authority_levels (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organisations(id) on delete cascade,
  role          text not null,
  channel       text not null
                check (channel in ('telegram', 'web', 'api', 'system', 'cron')),
  action        text not null,
  allowed       boolean not null default false,
  requires_confirmation boolean not null default true,
  max_per_day   int,
  cooldown_seconds int,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(org_id, role, channel, action)
);

create index idx_authority_org on authority_levels(org_id);
create index idx_authority_lookup on authority_levels(org_id, role, channel, action);

-- Seed default authority levels for SecureWorks
-- admin via telegram: can do most things with confirmation
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'read_job', true, false),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'update_job', true, true),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'create_job', true, true),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'send_quote', true, true),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'delete_job', true, true),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'view_pipeline', true, false),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'manage_schedule', true, true),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'telegram', 'run_report', true, false),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'web', 'read_job', true, false),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'web', 'update_job', true, false),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'web', 'create_job', true, false),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'web', 'send_quote', true, true),
  ('00000000-0000-0000-0000-000000000001', 'admin', 'web', 'delete_job', true, true);

-- estimator via telegram: read-only + limited create
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'estimator', 'telegram', 'read_job', true, false),
  ('00000000-0000-0000-0000-000000000001', 'estimator', 'telegram', 'update_job', true, true),
  ('00000000-0000-0000-0000-000000000001', 'estimator', 'telegram', 'view_pipeline', true, false),
  ('00000000-0000-0000-0000-000000000001', 'estimator', 'telegram', 'send_quote', false, true),
  ('00000000-0000-0000-0000-000000000001', 'estimator', 'telegram', 'delete_job', false, true);

-- system/cron: automated actions (no confirmation needed but logged)
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'system', 'cron', 'run_report', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'cron', 'send_reminder', true, false),
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'log_observation', true, false);

-- ────────────────────────────────────────────────────────────
-- INTENTION LOG
-- Every inbound message/request is parsed into an intention
-- before any action is taken. This is the audit spine.
-- ────────────────────────────────────────────────────────────
create table intention_log (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organisations(id) on delete cascade,
  -- Who triggered this
  user_id         uuid references users(id) on delete set null,
  channel         text not null
                  check (channel in ('telegram', 'web', 'api', 'system', 'cron')),
  -- Raw input
  raw_input       text not null,
  -- Parsed intention
  detected_intent text not null,
  confidence      numeric(3,2) check (confidence >= 0 and confidence <= 1),
  parsed_params   jsonb default '{}'::jsonb,
  -- Entity references (job, contact, etc.)
  entity_type     text,
  entity_id       uuid,
  -- Authority check result
  authority_check jsonb default '{}'::jsonb,
  authorised      boolean not null default false,
  -- Execution
  status          text not null default 'pending'
                  check (status in (
                    'pending', 'approved', 'denied', 'executed',
                    'failed', 'shadow'
                  )),
  result_summary  text,
  error_detail    text,
  -- Confirmation flow
  confirmation_token text unique,
  confirmation_expires_at timestamptz,
  confirmed_at    timestamptz,
  -- Chain verification
  hash            text,
  previous_hash   text,
  -- Timing
  created_at      timestamptz default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  duration_ms     int
);

create index idx_intention_org on intention_log(org_id);
create index idx_intention_user on intention_log(user_id);
create index idx_intention_status on intention_log(status);
create index idx_intention_created on intention_log(created_at desc);
create index idx_intention_entity on intention_log(entity_type, entity_id)
  where entity_type is not null;
create index idx_intention_confirm on intention_log(confirmation_token)
  where confirmation_token is not null;

-- ────────────────────────────────────────────────────────────
-- FEATURE FLAGS
-- Simple feature gate system. JARVIS checks these before
-- using any capability. Allows gradual rollout & kill switches.
-- ────────────────────────────────────────────────────────────
create table feature_flags (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organisations(id) on delete cascade,
  flag_key      text not null,
  enabled       boolean not null default false,
  shadow_mode   boolean not null default false,
  description   text,
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(org_id, flag_key)
);

create index idx_feature_flags_org on feature_flags(org_id);

-- Seed default flags
-- orchestrator_enabled + commitment_detection are ON from day one
-- All others OFF but in shadow_mode (logging without acting)
insert into feature_flags (org_id, flag_key, enabled, shadow_mode, description) values
  ('00000000-0000-0000-0000-000000000001', 'orchestrator_enabled', true, false, 'Master orchestrator — must be ON for JARVIS to function'),
  ('00000000-0000-0000-0000-000000000001', 'commitment_detection', true, false, 'Detect price/date/scope commitments in outbound messages'),
  ('00000000-0000-0000-0000-000000000001', 'group_chat_monitoring', false, true, 'Monitor Telegram group chats for actionable messages'),
  ('00000000-0000-0000-0000-000000000001', 'email_monitoring', false, true, 'Monitor inbound/outbound emails for commitments'),
  ('00000000-0000-0000-0000-000000000001', 'memory_system', false, true, 'Entity memory — observations, profiles, recall'),
  ('00000000-0000-0000-0000-000000000001', 'trust_graduation', false, true, 'Automatic authority level graduation based on track record'),
  ('00000000-0000-0000-0000-000000000001', 'nightly_consolidation', false, true, 'Nightly cron to consolidate observations into entity facts'),
  ('00000000-0000-0000-0000-000000000001', 'market_signals', false, true, 'Track supplier pricing changes and material availability');

-- ────────────────────────────────────────────────────────────
-- PENDING CONFIRMATIONS
-- When an action requires confirmation, a record is created
-- here. The user confirms via Telegram inline button or web UI.
-- ────────────────────────────────────────────────────────────
create table pending_confirmations (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organisations(id) on delete cascade,
  intention_id    uuid not null references intention_log(id) on delete cascade,
  user_id         uuid references users(id) on delete set null,
  channel         text not null
                  check (channel in ('telegram', 'web', 'api')),
  -- What we're asking the user to confirm
  action          text not null,
  description     text not null,
  params          jsonb default '{}'::jsonb,
  -- Token for callback matching (e.g. Telegram callback_data)
  token           text unique not null default encode(gen_random_bytes(12), 'hex'),
  -- State
  status          text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'denied', 'expired')),
  expires_at      timestamptz not null default (now() + interval '10 minutes'),
  responded_at    timestamptz,
  created_at      timestamptz default now()
);

create index idx_confirmations_token on pending_confirmations(token);
create index idx_confirmations_status on pending_confirmations(status)
  where status = 'pending';
create index idx_confirmations_expires on pending_confirmations(expires_at)
  where status = 'pending';

-- ────────────────────────────────────────────────────────────
-- TRIGGERS
-- ────────────────────────────────────────────────────────────
create trigger trg_authority_updated before update on authority_levels
  for each row execute function update_updated_at();

create trigger trg_feature_flags_updated before update on feature_flags
  for each row execute function update_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS POLICIES
-- ────────────────────────────────────────────────────────────
alter table authority_levels enable row level security;
alter table intention_log enable row level security;
alter table feature_flags enable row level security;
alter table pending_confirmations enable row level security;

-- Authority levels: admins can manage, all can read
create policy "Users can view authority levels"
  on authority_levels for select
  using (org_id = auth_org_id());

create policy "Admins can manage authority levels"
  on authority_levels for all
  using (org_id = auth_org_id() and auth_role() = 'admin');

-- Intention log: org-scoped read, system can insert
create policy "Users can view intention log"
  on intention_log for select
  using (org_id = auth_org_id());

create policy "Users can create intentions"
  on intention_log for insert
  with check (org_id = auth_org_id());

create policy "System can update intentions"
  on intention_log for update
  using (org_id = auth_org_id());

-- Feature flags: admins manage, all read
create policy "Users can view feature flags"
  on feature_flags for select
  using (org_id = auth_org_id());

create policy "Admins can manage feature flags"
  on feature_flags for all
  using (org_id = auth_org_id() and auth_role() = 'admin');

-- Pending confirmations: org-scoped
create policy "Users can view confirmations"
  on pending_confirmations for select
  using (org_id = auth_org_id());

create policy "Users can respond to confirmations"
  on pending_confirmations for update
  using (org_id = auth_org_id());

create policy "System can create confirmations"
  on pending_confirmations for insert
  with check (org_id = auth_org_id());

-- ────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- Check if a feature flag is enabled
create or replace function is_flag_enabled(p_org_id uuid, p_flag_key text)
returns boolean as $$
  select coalesce(
    (select enabled from feature_flags where org_id = p_org_id and flag_key = p_flag_key),
    false
  );
$$ language sql security definer stable;

-- Check if a feature flag is in shadow mode
create or replace function is_shadow_mode(p_org_id uuid, p_flag_key text)
returns boolean as $$
  select coalesce(
    (select shadow_mode from feature_flags where org_id = p_org_id and flag_key = p_flag_key),
    false
  );
$$ language sql security definer stable;

-- Check authority for an action
create or replace function check_authority(
  p_org_id uuid,
  p_role text,
  p_channel text,
  p_action text
)
returns jsonb as $$
  select coalesce(
    (select jsonb_build_object(
      'allowed', allowed,
      'requires_confirmation', requires_confirmation,
      'max_per_day', max_per_day,
      'cooldown_seconds', cooldown_seconds
    )
    from authority_levels
    where org_id = p_org_id
      and role = p_role
      and channel = p_channel
      and action = p_action),
    jsonb_build_object(
      'allowed', false,
      'requires_confirmation', true,
      'reason', 'no_rule_defined'
    )
  );
$$ language sql security definer stable;

-- Count intentions today (for rate limiting)
create or replace function count_intentions_today(
  p_org_id uuid,
  p_user_id uuid,
  p_action text
)
returns int as $$
  select count(*)::int
  from intention_log
  where org_id = p_org_id
    and user_id = p_user_id
    and detected_intent = p_action
    and created_at >= current_date
    and status not in ('denied', 'cancelled');
$$ language sql security definer stable;

-- Expire stale confirmations (called by cron or on-demand)
create or replace function expire_stale_confirmations()
returns int as $$
  with expired as (
    update pending_confirmations
    set status = 'expired'
    where status = 'pending'
      and expires_at < now()
    returning id
  )
  select count(*)::int from expired;
$$ language sql security definer;
