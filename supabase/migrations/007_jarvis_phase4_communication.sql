-- ============================================================
-- JARVIS Phase 4 — Communication Intelligence
-- Migration 007: persona_configs, cross_thread_signals,
--   cross_thread_actions, commitment_detection_results,
--   outbound_message_queue (v2), rate_limit_buckets,
--   rate_limit_violations + ALTER entity_profiles/staff_agent_preferences
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- CRITICAL ORDERING:
-- 1. CREATE persona_configs FIRST
-- 2. ADD UNIQUE on persona_configs(persona_type)
-- 3. THEN ALTER entity_profiles to add FK
-- 4. CREATE remaining tables
-- ────────────────────────────────────────────────────────────

-- Timestamp trigger (idempotent CREATE OR REPLACE)
create or replace function update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ────────────────────────────────────────────────────────────
-- 1. PERSONA CONFIGS
-- ────────────────────────────────────────────────────────────
create table persona_configs (
  id                      uuid primary key default uuid_generate_v4(),
  persona_type            varchar(50) not null,
  display_name            varchar(255),
  description             text,
  tone                    varchar(50),
  key_traits              text[] default '{}',
  response_length         varchar(20) default 'medium',
  emoji_usage             boolean default false,
  formality_level         varchar(20) default 'neutral',
  greeting_style          text,
  closing_style           text,
  decision_making_guidance text,
  expertise_deference     text,
  uncertainty_handling    text,
  culture_notes           text,
  ai_disclosure_required  boolean default false,
  metadata                jsonb default '{}'::jsonb,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index idx_persona_type on persona_configs(persona_type);
alter table persona_configs add constraint persona_configs_persona_type_unique unique (persona_type);

-- ────────────────────────────────────────────────────────────
-- ALTER entity_profiles: add persona_type FK
-- ────────────────────────────────────────────────────────────
alter table entity_profiles
  add column if not exists persona_type varchar(50)
  references persona_configs(persona_type) on delete set null;

-- ────────────────────────────────────────────────────────────
-- ALTER staff_agent_preferences: add rate limit + batching
-- ────────────────────────────────────────────────────────────
alter table staff_agent_preferences
  add column if not exists rate_limit_priority varchar(20) default 'normal',
  add column if not exists batch_messages boolean default false,
  add column if not exists batch_window_minutes int default 60;

-- ────────────────────────────────────────────────────────────
-- 2. CROSS THREAD SIGNALS
-- ────────────────────────────────────────────────────────────
create table cross_thread_signals (
  id                      uuid primary key default uuid_generate_v4(),
  source_channel          varchar(50),
  source_thread_id        varchar(255),
  signal_type             varchar(100) not null
                          check (signal_type in (
                            'supplier_delay', 'client_engagement', 'payment_received',
                            'commitment_made', 'schedule_change'
                          )),
  entity_id               uuid references entity_profiles(id) on delete cascade,
  signal_data             jsonb default '{}'::jsonb,
  created_at              timestamptz default now(),
  detected_at             timestamptz,
  propagated_to_channels  text[] default '{}',
  propagation_status      varchar(50) not null default 'detected'
                          check (propagation_status in ('detected', 'enriched', 'propagated', 'acted_upon')),
  source_message_id       varchar(255),
  source_event_id         uuid references event_queue(id) on delete set null,
  confidence_score        decimal(3,2),
  human_verified          boolean default false,
  metadata                jsonb default '{}'::jsonb,
  updated_at              timestamptz default now()
);

create index idx_cross_signals_entity on cross_thread_signals(entity_id);
create index idx_cross_signals_type on cross_thread_signals(signal_type);
create index idx_cross_signals_created on cross_thread_signals(created_at desc);
create index idx_cross_signals_status on cross_thread_signals(propagation_status);

-- ────────────────────────────────────────────────────────────
-- 3. CROSS THREAD ACTIONS
-- ────────────────────────────────────────────────────────────
create table cross_thread_actions (
  id                uuid primary key default uuid_generate_v4(),
  signal_id         uuid not null references cross_thread_signals(id) on delete cascade,
  action_type       varchar(100) not null
                    check (action_type in ('flag_crew', 'suggest_followup', 'trigger_workflow', 'log_observation')),
  target_channel    varchar(50),
  target_thread_id  varchar(255),
  action_status     varchar(50) not null default 'queued'
                    check (action_status in ('queued', 'executed', 'failed')),
  created_at        timestamptz default now(),
  executed_at       timestamptz,
  result            jsonb default '{}'::jsonb,
  metadata          jsonb default '{}'::jsonb
);

create index idx_cross_actions_signal on cross_thread_actions(signal_id);
create index idx_cross_actions_status on cross_thread_actions(action_status);

-- ────────────────────────────────────────────────────────────
-- 4. COMMITMENT DETECTION RESULTS (A/B testing)
-- ────────────────────────────────────────────────────────────
create table commitment_detection_results (
  id                      uuid primary key default uuid_generate_v4(),
  message_id              varchar(255) not null unique,
  channel                 varchar(50),
  thread_id               varchar(255),
  entity_id               uuid references entity_profiles(id) on delete set null,
  message_text            text,
  message_timestamp       timestamptz,
  regex_detected          boolean,
  regex_commitments       jsonb default '[]'::jsonb,
  regex_confidence        decimal(3,2),
  haiku_detected          boolean,
  haiku_commitments       jsonb default '[]'::jsonb,
  haiku_confidence        decimal(3,2),
  haiku_reasoning         text,
  haiku_tokens_used       int,
  agreement               boolean,
  discrepancy_type        varchar(100),
  classifier_used         varchar(20) default 'regex',
  used_at                 timestamptz,
  disagreement_severity   varchar(20),
  human_review_requested  boolean default false,
  human_review_result     varchar(50),
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index idx_commitment_message on commitment_detection_results(message_id);
create index idx_commitment_entity on commitment_detection_results(entity_id);
create index idx_commitment_agreement on commitment_detection_results(agreement);
create index idx_commitment_discrepancy on commitment_detection_results(discrepancy_type)
  where discrepancy_type is not null;
create index idx_commitment_created on commitment_detection_results(created_at desc);

-- ────────────────────────────────────────────────────────────
-- 5. OUTBOUND MESSAGE QUEUE (V2 — replaces Phase 2 version)
-- Drop old table if upgrading, or create fresh
-- ────────────────────────────────────────────────────────────
drop table if exists outbound_message_queue cascade;

create table outbound_message_queue (
  id                      uuid primary key default uuid_generate_v4(),
  communication_log_id    uuid references communications_log(id) on delete cascade,
  channel                 varchar(50) not null,
  recipient_id            varchar(255),
  recipient_type          varchar(50),
  message_content         text,
  message_type            varchar(50) default 'text',
  priority_level          varchar(20) not null default 'normal'
                          check (priority_level in ('urgent', 'high', 'normal', 'low')),
  scheduled_for           timestamptz,
  rate_limit_bucket       varchar(100),
  rate_limit_tokens_required int default 1,
  dedup_key               varchar(255),
  is_duplicate            boolean default false,
  duplicate_of            uuid references outbound_message_queue(id) on delete set null,
  status                  varchar(50) not null default 'queued'
                          check (status in ('queued', 'rate_limited', 'sending', 'sent', 'failed', 'deferred', 'cancelled')),
  attempt_count           int default 0,
  max_attempts            int default 3,
  last_attempt_at         timestamptz,
  error_message           text,
  error_code              varchar(50),
  next_retry_at           timestamptz,
  retry_backoff_ms        int default 5000,
  sent_at                 timestamptz,
  response_id             varchar(255),
  response_status         varchar(50),
  metadata                jsonb default '{}'::jsonb,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index idx_outbound_v2_status on outbound_message_queue(status, priority_level);
create index idx_outbound_v2_scheduled on outbound_message_queue(scheduled_for)
  where scheduled_for is not null;
create index idx_outbound_v2_bucket on outbound_message_queue(rate_limit_bucket);
create index idx_outbound_v2_dedup on outbound_message_queue(dedup_key)
  where is_duplicate = false;
create index idx_outbound_v2_retry on outbound_message_queue(next_retry_at)
  where status in ('queued', 'rate_limited', 'failed');
create index idx_outbound_v2_created on outbound_message_queue(created_at desc);

-- ────────────────────────────────────────────────────────────
-- 6. RATE LIMIT BUCKETS
-- ────────────────────────────────────────────────────────────
create table rate_limit_buckets (
  id                uuid primary key default uuid_generate_v4(),
  bucket_name       varchar(100) not null unique,
  channel           varchar(50),
  tokens_current    decimal(10,2),
  tokens_capacity   decimal(10,2),
  tokens_per_second decimal(10,4),
  last_refill_at    timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_rate_buckets_channel on rate_limit_buckets(channel);

-- ────────────────────────────────────────────────────────────
-- 7. RATE LIMIT VIOLATIONS
-- ────────────────────────────────────────────────────────────
create table rate_limit_violations (
  id                uuid primary key default uuid_generate_v4(),
  bucket_name       varchar(100),
  message_queue_id  uuid references outbound_message_queue(id) on delete set null,
  tokens_requested  int,
  tokens_available  decimal(10,2),
  violation_type    varchar(50),
  created_at        timestamptz default now()
);

create index idx_violations_bucket on rate_limit_violations(bucket_name);

-- ────────────────────────────────────────────────────────────
-- TRIGGERS
-- ────────────────────────────────────────────────────────────
create trigger trg_persona_configs_updated before update on persona_configs
  for each row execute function update_timestamp();

create trigger trg_cross_signals_updated before update on cross_thread_signals
  for each row execute function update_timestamp();

create trigger trg_commitment_results_updated before update on commitment_detection_results
  for each row execute function update_timestamp();

create trigger trg_outbound_v2_updated before update on outbound_message_queue
  for each row execute function update_timestamp();

create trigger trg_rate_buckets_updated before update on rate_limit_buckets
  for each row execute function update_timestamp();

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table persona_configs enable row level security;
alter table cross_thread_signals enable row level security;
alter table cross_thread_actions enable row level security;
alter table commitment_detection_results enable row level security;
alter table outbound_message_queue enable row level security;
alter table rate_limit_buckets enable row level security;
alter table rate_limit_violations enable row level security;

create policy "Service role manages persona configs" on persona_configs for all using (auth.role() = 'service_role');
create policy "Users can view persona configs" on persona_configs for select using (true);

create policy "Service role manages cross thread signals" on cross_thread_signals for all using (auth.role() = 'service_role');
create policy "Users can view cross thread signals" on cross_thread_signals for select using (true);

create policy "Service role manages cross thread actions" on cross_thread_actions for all using (auth.role() = 'service_role');
create policy "Users can view cross thread actions" on cross_thread_actions for select using (true);

create policy "Service role manages commitment results" on commitment_detection_results for all using (auth.role() = 'service_role');
create policy "Users can view commitment results" on commitment_detection_results for select using (true);

create policy "Service role manages outbound queue v2" on outbound_message_queue for all using (auth.role() = 'service_role');
create policy "Users can view outbound queue v2" on outbound_message_queue for select using (true);

create policy "Service role manages rate limit buckets" on rate_limit_buckets for all using (auth.role() = 'service_role');
create policy "Users can view rate limit buckets" on rate_limit_buckets for select using (true);

create policy "Service role manages rate limit violations" on rate_limit_violations for all using (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- FEATURE FLAGS
-- ────────────────────────────────────────────────────────────
insert into feature_flags (org_id, flag_key, enabled, shadow_mode, description) values
  ('00000000-0000-0000-0000-000000000001', 'persona_system_enabled', false, true, 'Dynamic persona system for context-aware responses'),
  ('00000000-0000-0000-0000-000000000001', 'cross_thread_intelligence_enabled', false, true, 'Cross-thread signal detection and propagation'),
  ('00000000-0000-0000-0000-000000000001', 'commitment_v2_enabled', false, true, 'Haiku-based commitment detection (A/B with regex)'),
  ('00000000-0000-0000-0000-000000000001', 'enhanced_outbound_queue_enabled', false, true, 'Redis leaky bucket outbound queue with dedup')
on conflict (org_id, flag_key) do nothing;
