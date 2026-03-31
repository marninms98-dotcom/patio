-- ============================================================
-- JARVIS Phase 2 — Multi-Channel Awareness + Memory Consolidation
-- Migration 005: staff_agent_preferences, seasonal_context,
--                outbound_message_queue, active_threads,
--                email_sync_state
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- A) STAFF AGENT PREFERENCES
-- Per-staff configuration for how JARVIS interacts with them.
-- Links Telegram user IDs to entity_profiles.
-- ────────────────────────────────────────────────────────────
create table staff_agent_preferences (
  id                        uuid primary key default uuid_generate_v4(),
  telegram_user_id          bigint unique not null,
  entity_id                 uuid references entity_profiles(id) on delete set null,
  display_name              text not null,
  role                      text not null default 'staff'
                            check (role in ('owner', 'manager', 'estimator', 'crew', 'supplier')),
  notification_preferences  jsonb not null default '{"morning_brief":true,"job_updates":true,"chase_results":true}'::jsonb,
  communication_style       text not null default 'professional',
  areas_of_responsibility   text[] default '{}',
  delegated_authority_level int not null default 3,
  is_active                 boolean not null default true,
  onboarded                 boolean not null default false,
  timezone                  text not null default 'Australia/Perth',
  quiet_hours_start         time not null default '20:00',
  quiet_hours_end           time not null default '06:00',
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

create index idx_staff_prefs_telegram on staff_agent_preferences(telegram_user_id);
create index idx_staff_prefs_entity on staff_agent_preferences(entity_id)
  where entity_id is not null;
create index idx_staff_prefs_active on staff_agent_preferences(is_active)
  where is_active = true;

-- ────────────────────────────────────────────────────────────
-- B) SEASONAL CONTEXT
-- Perth seasonal data that affects quoting, scheduling,
-- lead urgency, and material availability.
-- ────────────────────────────────────────────────────────────
create table seasonal_context (
  id                        uuid primary key default uuid_generate_v4(),
  month                     int not null check (month >= 1 and month <= 12),
  season_name               text not null,
  demand_multiplier         float not null default 1.0,
  lead_followup_urgency     text not null default 'normal'
                            check (lead_followup_urgency in ('low', 'normal', 'high', 'urgent')),
  scheduling_notes          text,
  material_notes            text,
  marketing_spend_modifier  float not null default 1.0,
  updated_at                timestamptz default now(),
  unique(month)
);

-- Seed with Perth seasonal data
insert into seasonal_context (month, season_name, demand_multiplier, lead_followup_urgency, scheduling_notes, material_notes, marketing_spend_modifier) values
  (1,  'Peak Summer',      1.4, 'urgent', 'Fully booked 4-6 weeks out. Prioritise high-value installs.', 'Order SolarSpan 2 weeks ahead — supplier backlogs.', 0.7),
  (2,  'Peak Summer',      1.3, 'urgent', 'Still peak. Start booking March/April slots.', 'Colorbond stock tight in popular colours.', 0.7),
  (3,  'Early Autumn',     1.1, 'high',   'Cooling slightly. Good time for larger projects.', 'Stock levels normalising.', 1.0),
  (4,  'Autumn',           1.0, 'normal', 'Comfortable install weather. Push outdoor living angle.', NULL, 1.0),
  (5,  'Late Autumn',      0.9, 'normal', 'Enquiries slowing. Focus on converting existing leads.', NULL, 1.2),
  (6,  'Early Winter',     0.7, 'low',    'Wet season starting. Schedule around rain days.', 'Good time to negotiate supplier pricing.', 1.3),
  (7,  'Winter',           0.6, 'low',    'Lowest demand. Maintenance and warranty work. Plan ahead.', 'Pre-order for spring at winter pricing.', 1.4),
  (8,  'Late Winter',      0.8, 'normal', 'Enquiries picking up. Spring campaigns starting.', 'Start restocking popular sizes.', 1.2),
  (9,  'Early Spring',     1.0, 'high',   'Strong ramp-up. Book installations ahead.', NULL, 1.1),
  (10, 'Spring',           1.1, 'high',   'High demand. Marketing ROI peaks.', 'Ensure SolarSpan stock for Nov/Dec rush.', 1.0),
  (11, 'Late Spring',      1.2, 'urgent', 'Pre-Christmas rush starting. Quote fast.', 'Lead times increasing on custom orders.', 0.9),
  (12, 'Pre-Christmas',    1.4, 'urgent', 'Deadline pressure — clients want done before Christmas.', 'Suppliers closing mid-Dec. Order early.', 0.8);

-- ────────────────────────────────────────────────────────────
-- C) OUTBOUND MESSAGE QUEUE
-- All outbound messages (Telegram, email, SMS) go through
-- this queue for rate limiting, batching, and audit.
-- ────────────────────────────────────────────────────────────
create table outbound_message_queue (
  id              uuid primary key default uuid_generate_v4(),
  entity_id       uuid references entity_profiles(id) on delete set null,
  channel         text not null
                  check (channel in ('telegram', 'email', 'sms', 'whatsapp')),
  priority        int not null default 5
                  check (priority >= 1 and priority <= 10),
  content         jsonb not null,
  status          text not null default 'queued'
                  check (status in ('queued', 'sent', 'failed', 'cancelled', 'batched')),
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  error_message   text,
  intention_id    uuid references intention_log(id) on delete set null,
  created_at      timestamptz default now()
);

create index idx_outbound_queue_status on outbound_message_queue(status, scheduled_for)
  where status = 'queued';
create index idx_outbound_queue_entity on outbound_message_queue(entity_id, created_at desc);

-- ────────────────────────────────────────────────────────────
-- D) ACTIVE THREADS
-- Tracks multi-step workflows (e.g. lead chase sequence,
-- quote follow-up, warranty claim) with state + next action.
-- ────────────────────────────────────────────────────────────
create table active_threads (
  id                  uuid primary key default uuid_generate_v4(),
  thread_type         text not null,
  subject_entity_id   uuid references entity_profiles(id) on delete set null,
  related_job_id      text,
  current_step        int not null default 1,
  next_action_date    timestamptz,
  context_summary     text,
  status              text not null default 'active'
                      check (status in ('active', 'paused', 'completed', 'escalated')),
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_active_threads_status on active_threads(status, next_action_date)
  where status = 'active';

-- ────────────────────────────────────────────────────────────
-- E) EMAIL SYNC STATE
-- Tracks Microsoft Graph delta sync state per mailbox.
-- ────────────────────────────────────────────────────────────
create table email_sync_state (
  id                    uuid primary key default uuid_generate_v4(),
  mailbox               text unique not null,
  delta_token           text,
  subscription_id       text,
  subscription_expiry   timestamptz,
  last_sync_at          timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- TRIGGERS (updated_at)
-- update_updated_at_column() already exists from migration 003
-- ────────────────────────────────────────────────────────────
create trigger trg_staff_prefs_updated before update on staff_agent_preferences
  for each row execute function update_updated_at();

create trigger trg_seasonal_context_updated before update on seasonal_context
  for each row execute function update_updated_at();

create trigger trg_active_threads_updated before update on active_threads
  for each row execute function update_updated_at();

create trigger trg_email_sync_updated before update on email_sync_state
  for each row execute function update_updated_at();

-- outbound_message_queue is append-only / no updated_at needed

-- ────────────────────────────────────────────────────────────
-- RLS POLICIES
-- ────────────────────────────────────────────────────────────
alter table staff_agent_preferences enable row level security;
alter table seasonal_context enable row level security;
alter table outbound_message_queue enable row level security;
alter table active_threads enable row level security;
alter table email_sync_state enable row level security;

-- staff_agent_preferences: users can view, admins manage
create policy "Users can view staff preferences"
  on staff_agent_preferences for select
  using (true);

create policy "Admins can manage staff preferences"
  on staff_agent_preferences for all
  using (auth.role() = 'service_role');

-- seasonal_context: everyone can read, service role manages
create policy "Anyone can view seasonal context"
  on seasonal_context for select
  using (true);

create policy "Service role manages seasonal context"
  on seasonal_context for all
  using (auth.role() = 'service_role');

-- outbound_message_queue: service role only
create policy "Service role manages outbound queue"
  on outbound_message_queue for all
  using (auth.role() = 'service_role');

create policy "Users can view outbound queue"
  on outbound_message_queue for select
  using (true);

-- active_threads: service role manages, users can view
create policy "Users can view active threads"
  on active_threads for select
  using (true);

create policy "Service role manages active threads"
  on active_threads for all
  using (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- Seed authority_levels for complaint escalation (L4)
-- Ensures complaint emails always get escalated to owner
-- ────────────────────────────────────────────────────────────
insert into authority_levels (org_id, role, channel, action, allowed, requires_confirmation) values
  ('00000000-0000-0000-0000-000000000001', 'system', 'system', 'escalate_complaint', true, true);

-- email_sync_state: service role only
create policy "Service role manages email sync state"
  on email_sync_state for all
  using (auth.role() = 'service_role');
