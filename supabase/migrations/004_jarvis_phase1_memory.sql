-- ============================================================
-- JARVIS Phase 1 — Memory Foundation
-- Migration 004: entity_profiles, entity_observations,
--                corrections, commitments, entity_relationships,
--                business_directives, agent_memory_log,
--                communications_log, pending_entity_matches
-- ============================================================

-- Extensions MUST come before any indexes that depend on them
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ────────────────────────────────────────────────────────────
-- ENTITY PROFILES
-- Long-lived memory about people, companies, suburbs, etc.
-- JARVIS builds these over time from observations.
-- ────────────────────────────────────────────────────────────
create table entity_profiles (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organisations(id) on delete cascade,
  -- What kind of entity this is
  entity_type   text not null
                check (entity_type in (
                  'client', 'supplier', 'installer', 'suburb',
                  'product', 'material', 'staff_member'
                )),
  -- Canonical name (e.g. "John Smith", "Joondalup", "Bondor SolarSpan")
  name          text not null,
  -- Structured facts JARVIS has learned
  -- e.g. { "preferred_colour": "Surfmist", "typical_budget": "15000-25000",
  --        "communication_style": "prefers_text", "dogs_on_site": true }
  facts         jsonb default '{}'::jsonb,
  -- Relationships to other entities
  -- e.g. [{ "type": "lives_in", "entity_id": "...", "entity_name": "Joondalup" }]
  relationships jsonb default '[]'::jsonb,
  -- Visibility controls
  visibility_scope text not null default 'public'
                   check (visibility_scope in ('public', 'role_restricted', 'private')),
  visible_to_roles text[] default '{}',
  -- Link to existing records
  linked_job_ids  uuid[] default '{}',
  linked_user_id  uuid references users(id) on delete set null,
  -- Confidence & freshness
  observation_count int default 0,
  last_observed_at  timestamptz,
  -- Timestamps
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_entity_org on entity_profiles(org_id);
create index idx_entity_type on entity_profiles(org_id, entity_type);
create index idx_entity_name on entity_profiles(org_id, name);
create index idx_entity_name_trgm on entity_profiles using gin (name gin_trgm_ops);

-- ────────────────────────────────────────────────────────────
-- ENTITY OBSERVATIONS
-- Individual facts/events observed about entities.
-- These feed into entity_profiles.facts over time.
-- ────────────────────────────────────────────────────────────
create table entity_observations (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organisations(id) on delete cascade,
  entity_id       uuid not null references entity_profiles(id) on delete cascade,
  -- What was observed
  observation_type text not null
                   check (observation_type in (
                     'preference', 'behaviour', 'feedback', 'fact',
                     'interaction', 'issue', 'compliment', 'pattern'
                   )),
  -- The observation itself
  content         text not null,
  -- Structured data if applicable
  structured_data jsonb default '{}'::jsonb,
  -- Source: where this came from
  source_channel  text not null
                  check (source_channel in ('telegram', 'web', 'api', 'system', 'manual')),
  source_intention_id uuid references intention_log(id) on delete set null,
  source_job_id   uuid references jobs(id) on delete set null,
  -- Visibility controls
  visibility_scope text not null default 'public'
                   check (visibility_scope in ('public', 'role_restricted', 'private')),
  visible_to_roles text[] default '{}',
  -- Embedding for vector search
  embedding       vector(1536),
  -- Confidence (0-1): how sure are we this is accurate
  confidence      numeric(3,2) default 0.80
                  check (confidence >= 0 and confidence <= 1),
  -- Has this been superseded by a newer observation?
  superseded_by   uuid references entity_observations(id) on delete set null,
  is_active       boolean default true,
  -- Timestamps
  observed_at     timestamptz default now(),
  created_at      timestamptz default now()
);

create index idx_observation_entity on entity_observations(entity_id);
create index idx_observation_org on entity_observations(org_id);
create index idx_observation_type on entity_observations(observation_type);
create index idx_observation_active on entity_observations(entity_id, is_active)
  where is_active = true;
create index idx_observation_job on entity_observations(source_job_id)
  where source_job_id is not null;
create index idx_entity_observations_embedding on entity_observations
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- ────────────────────────────────────────────────────────────
-- CORRECTIONS
-- When JARVIS gets something wrong, the correction is logged.
-- This feeds back into better future behaviour.
-- ────────────────────────────────────────────────────────────
create table corrections (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references organisations(id) on delete cascade,
  -- What was wrong
  intention_id      uuid references intention_log(id) on delete set null,
  correction_type   text not null
                    check (correction_type in (
                      'wrong_intent', 'wrong_entity', 'wrong_value',
                      'wrong_action', 'missed_context', 'bad_suggestion',
                      'calculation_error', 'other'
                    )),
  -- The original (wrong) value/action
  original_value    text,
  -- The correct value/action
  corrected_value   text not null,
  -- Explanation of what went wrong
  explanation       text,
  -- Who corrected it
  corrected_by      uuid references users(id) on delete set null,
  corrected_via     text not null default 'telegram'
                    check (corrected_via in ('telegram', 'web', 'api', 'system')),
  -- Has this correction been applied to improve JARVIS?
  applied           boolean default false,
  applied_at        timestamptz,
  -- Pattern: if this correction applies broadly
  -- e.g. { "rule": "always_use_surfmist_for_colorbond", "scope": "global" }
  pattern           jsonb default '{}'::jsonb,
  -- Timestamps
  created_at        timestamptz default now()
);

create index idx_corrections_org on corrections(org_id);
create index idx_corrections_type on corrections(correction_type);
create index idx_corrections_unapplied on corrections(org_id, applied)
  where applied = false;
create index idx_corrections_intention on corrections(intention_id)
  where intention_id is not null;

-- ────────────────────────────────────────────────────────────
-- COMMITMENTS
-- Promises/commitments detected in conversations.
-- "I'll send that quote by 3pm" → tracked + reminder set.
-- ────────────────────────────────────────────────────────────
create table commitments (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organisations(id) on delete cascade,
  -- Who made the commitment
  committed_by    uuid references users(id) on delete set null,
  committed_to_name text,
  -- What was committed
  description     text not null,
  -- When it's due
  due_at          timestamptz,
  due_description text,
  -- Related entities
  job_id          uuid references jobs(id) on delete set null,
  entity_id       uuid references entity_profiles(id) on delete set null,
  -- Source
  source_intention_id uuid references intention_log(id) on delete set null,
  source_channel  text not null default 'telegram'
                  check (source_channel in ('telegram', 'web', 'api', 'system')),
  source_text     text,
  -- Status tracking
  status          text not null default 'active'
                  check (status in ('active', 'completed', 'overdue', 'cancelled')),
  completed_at    timestamptz,
  -- Reminder settings
  reminder_sent   boolean default false,
  reminder_at     timestamptz,
  -- Timestamps
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_commitments_org on commitments(org_id);
create index idx_commitments_user on commitments(committed_by);
create index idx_commitments_status on commitments(status)
  where status in ('active', 'overdue');
create index idx_commitments_due on commitments(due_at)
  where status = 'active' and due_at is not null;
create index idx_commitments_job on commitments(job_id)
  where job_id is not null;

-- ────────────────────────────────────────────────────────────
-- ENTITY RELATIONSHIPS
-- Explicit typed links between entities.
-- ────────────────────────────────────────────────────────────
create table entity_relationships (
  id                  uuid primary key default uuid_generate_v4(),
  org_id              uuid not null references organisations(id) on delete cascade,
  source_entity_id    uuid not null references entity_profiles(id) on delete cascade,
  target_entity_id    uuid not null references entity_profiles(id) on delete cascade,
  relationship_type   text not null
                      check (relationship_type in (
                        'lives_in', 'works_for', 'referred_by', 'neighbour_of',
                        'supplier_of', 'installed_by', 'repeat_client',
                        'related_to', 'subcontractor_of'
                      )),
  job_id              uuid references jobs(id) on delete set null,
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

create index idx_entity_rel_source on entity_relationships(source_entity_id);
create index idx_entity_rel_target on entity_relationships(target_entity_id);
create index idx_entity_rel_type on entity_relationships(relationship_type);
create index idx_entity_rel_org on entity_relationships(org_id);

-- ────────────────────────────────────────────────────────────
-- BUSINESS DIRECTIVES
-- Standing instructions / rules JARVIS must follow.
-- e.g. "Always use Surfmist for Colorbond unless client specifies"
-- ────────────────────────────────────────────────────────────
create table business_directives (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organisations(id) on delete cascade,
  directive_text  text not null,
  category        text not null
                  check (category in (
                    'pricing', 'quoting', 'scheduling', 'materials',
                    'communication', 'safety', 'quality', 'general'
                  )),
  priority        int not null default 5
                  check (priority >= 1 and priority <= 10),
  active          boolean not null default true,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_directives_org on business_directives(org_id);
create index idx_directives_active on business_directives(org_id, active, category)
  where active = true;

-- ────────────────────────────────────────────────────────────
-- AGENT MEMORY LOG
-- Append-only log of everything JARVIS does, with hash chain
-- for tamper detection. Separate from intention_log which
-- tracks inbound requests; this tracks agent-side events.
-- ────────────────────────────────────────────────────────────
create table agent_memory_log (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organisations(id) on delete cascade,
  event_type      text not null
                  check (event_type in (
                    'observation_stored', 'entity_created', 'entity_merged',
                    'fact_updated', 'correction_applied', 'directive_checked',
                    'search_performed', 'consolidation_run', 'embedding_generated',
                    'relationship_created', 'commitment_detected', 'commitment_resolved'
                  )),
  channel         text not null default 'system'
                  check (channel in ('telegram', 'web', 'api', 'system', 'cron')),
  entity_id       uuid references entity_profiles(id) on delete set null,
  job_id          uuid references jobs(id) on delete set null,
  content         jsonb not null default '{}'::jsonb,
  hash            text not null,
  previous_hash   text,
  created_at      timestamptz default now()
);

create index idx_agent_memory_org on agent_memory_log(org_id);
create index idx_agent_memory_type on agent_memory_log(event_type);
create index idx_agent_memory_entity on agent_memory_log(entity_id)
  where entity_id is not null;
create index idx_agent_memory_created on agent_memory_log(created_at desc);
create index idx_agent_memory_hash on agent_memory_log(hash);

-- ────────────────────────────────────────────────────────────
-- COMMUNICATIONS LOG
-- All messages JARVIS sees or sends across channels.
-- Embedding enables semantic search across conversations.
-- ────────────────────────────────────────────────────────────
create table communications_log (
  id                  uuid primary key default uuid_generate_v4(),
  org_id              uuid not null references organisations(id) on delete cascade,
  channel             text not null
                      check (channel in ('telegram', 'email', 'sms', 'web', 'whatsapp')),
  sender_entity_id    uuid references entity_profiles(id) on delete set null,
  recipient_entity_id uuid references entity_profiles(id) on delete set null,
  group_id            text,
  content_text        text not null,
  content_summary     text,
  embedding           vector(1536),
  source_message_id   text,
  thread_id           text,
  is_inbound          boolean not null default true,
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

create index idx_comms_org on communications_log(org_id);
create index idx_comms_channel on communications_log(channel);
create index idx_comms_sender on communications_log(sender_entity_id)
  where sender_entity_id is not null;
create index idx_comms_recipient on communications_log(recipient_entity_id)
  where recipient_entity_id is not null;
create index idx_comms_group on communications_log(group_id)
  where group_id is not null;
create index idx_comms_thread on communications_log(thread_id)
  where thread_id is not null;
create index idx_comms_created on communications_log(created_at desc);
create index idx_comms_embedding on communications_log
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- ────────────────────────────────────────────────────────────
-- PENDING ENTITY MATCHES
-- When JARVIS sees a name it can't confidently resolve,
-- it creates a pending match for human review.
-- ────────────────────────────────────────────────────────────
create table pending_entity_matches (
  id                  uuid primary key default uuid_generate_v4(),
  org_id              uuid not null references organisations(id) on delete cascade,
  source_identifier   text not null,
  source_channel      text not null
                      check (source_channel in ('telegram', 'email', 'sms', 'web', 'system')),
  suggested_entity_id uuid references entity_profiles(id) on delete set null,
  confidence          numeric(3,2) not null default 0.00
                      check (confidence >= 0 and confidence <= 1),
  resolved            boolean not null default false,
  resolved_entity_id  uuid references entity_profiles(id) on delete set null,
  resolved_at         timestamptz,
  resolved_by         uuid references users(id) on delete set null,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_pending_matches_org on pending_entity_matches(org_id);
create index idx_pending_matches_unresolved on pending_entity_matches(org_id, resolved)
  where resolved = false;
create index idx_pending_matches_source on pending_entity_matches(source_identifier);

-- ────────────────────────────────────────────────────────────
-- TRIGGERS
-- ────────────────────────────────────────────────────────────
create trigger trg_entity_profiles_updated before update on entity_profiles
  for each row execute function update_updated_at();

create trigger trg_commitments_updated before update on commitments
  for each row execute function update_updated_at();

create trigger trg_business_directives_updated before update on business_directives
  for each row execute function update_updated_at();

create trigger trg_pending_matches_updated before update on pending_entity_matches
  for each row execute function update_updated_at();

-- Auto-increment observation count on entity_profiles
create or replace function increment_observation_count()
returns trigger as $$
begin
  update entity_profiles
  set observation_count = observation_count + 1,
      last_observed_at = new.observed_at
  where id = new.entity_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_observation_count
  after insert on entity_observations
  for each row execute function increment_observation_count();

-- Auto-mark overdue commitments (called by cron)
create or replace function mark_overdue_commitments()
returns int as $$
  with overdue as (
    update commitments
    set status = 'overdue'
    where status = 'active'
      and due_at is not null
      and due_at < now()
    returning id
  )
  select count(*)::int from overdue;
$$ language sql security definer;

-- ────────────────────────────────────────────────────────────
-- RLS POLICIES
-- ────────────────────────────────────────────────────────────
alter table entity_profiles enable row level security;
alter table entity_observations enable row level security;
alter table corrections enable row level security;
alter table commitments enable row level security;

-- Entity profiles: org-scoped
create policy "Users can view entity profiles"
  on entity_profiles for select
  using (org_id = auth_org_id());

create policy "Users can create entity profiles"
  on entity_profiles for insert
  with check (org_id = auth_org_id());

create policy "Users can update entity profiles"
  on entity_profiles for update
  using (org_id = auth_org_id());

-- Entity observations: org-scoped
create policy "Users can view observations"
  on entity_observations for select
  using (org_id = auth_org_id());

create policy "Users can create observations"
  on entity_observations for insert
  with check (org_id = auth_org_id());

create policy "Users can update observations"
  on entity_observations for update
  using (org_id = auth_org_id());

-- Corrections: org-scoped
create policy "Users can view corrections"
  on corrections for select
  using (org_id = auth_org_id());

create policy "Users can create corrections"
  on corrections for insert
  with check (org_id = auth_org_id());

create policy "Admins can manage corrections"
  on corrections for all
  using (org_id = auth_org_id() and auth_role() = 'admin');

-- Commitments: org-scoped
create policy "Users can view commitments"
  on commitments for select
  using (org_id = auth_org_id());

create policy "Users can create commitments"
  on commitments for insert
  with check (org_id = auth_org_id());

create policy "Users can update commitments"
  on commitments for update
  using (org_id = auth_org_id());

-- Entity relationships: org-scoped
alter table entity_relationships enable row level security;

create policy "Users can view entity relationships"
  on entity_relationships for select
  using (org_id = auth_org_id());

create policy "Users can create entity relationships"
  on entity_relationships for insert
  with check (org_id = auth_org_id());

create policy "Service role full access to entity relationships"
  on entity_relationships for all
  using (auth.role() = 'service_role');

-- Business directives: org-scoped, admin-managed
alter table business_directives enable row level security;

create policy "Users can view business directives"
  on business_directives for select
  using (org_id = auth_org_id());

create policy "Admins can manage business directives"
  on business_directives for all
  using (org_id = auth_org_id() and auth_role() = 'admin');

create policy "Service role full access to business directives"
  on business_directives for all
  using (auth.role() = 'service_role');

-- Agent memory log: org-scoped, append-only for service role
alter table agent_memory_log enable row level security;

create policy "Users can view agent memory log"
  on agent_memory_log for select
  using (org_id = auth_org_id());

create policy "Service role can insert agent memory log"
  on agent_memory_log for insert
  with check (true);

create policy "Service role full access to agent memory log"
  on agent_memory_log for all
  using (auth.role() = 'service_role');

-- Communications log: org-scoped
alter table communications_log enable row level security;

create policy "Users can view communications log"
  on communications_log for select
  using (org_id = auth_org_id());

create policy "Users can create communications log"
  on communications_log for insert
  with check (org_id = auth_org_id());

create policy "Service role full access to communications log"
  on communications_log for all
  using (auth.role() = 'service_role');

-- Pending entity matches: org-scoped
alter table pending_entity_matches enable row level security;

create policy "Users can view pending entity matches"
  on pending_entity_matches for select
  using (org_id = auth_org_id());

create policy "Users can resolve pending entity matches"
  on pending_entity_matches for update
  using (org_id = auth_org_id());

create policy "Service role full access to pending entity matches"
  on pending_entity_matches for all
  using (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- Find or create an entity profile by name + type
create or replace function find_or_create_entity(
  p_org_id uuid,
  p_entity_type text,
  p_name text
)
returns uuid as $$
declare
  v_id uuid;
begin
  -- Try exact match first
  select id into v_id
  from entity_profiles
  where org_id = p_org_id
    and entity_type = p_entity_type
    and lower(name) = lower(p_name);

  if v_id is not null then
    return v_id;
  end if;

  -- Try fuzzy match (>0.4 similarity)
  select id into v_id
  from entity_profiles
  where org_id = p_org_id
    and entity_type = p_entity_type
    and similarity(name, p_name) > 0.4
  order by similarity(name, p_name) desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- Create new
  insert into entity_profiles (org_id, entity_type, name)
  values (p_org_id, p_entity_type, p_name)
  returning id into v_id;

  return v_id;
end;
$$ language plpgsql security definer;

-- Get all active observations for an entity
create or replace function get_entity_memory(p_entity_id uuid)
returns jsonb as $$
  select jsonb_build_object(
    'profile', (select row_to_json(ep) from entity_profiles ep where ep.id = p_entity_id),
    'observations', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'type', o.observation_type,
          'content', o.content,
          'confidence', o.confidence,
          'observed_at', o.observed_at
        ) order by o.observed_at desc
      )
      from entity_observations o
      where o.entity_id = p_entity_id and o.is_active = true),
      '[]'::jsonb
    ),
    'commitments', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'description', c.description,
          'status', c.status,
          'due_at', c.due_at,
          'created_at', c.created_at
        ) order by c.created_at desc
      )
      from commitments c
      where c.entity_id = p_entity_id and c.status in ('active', 'overdue')),
      '[]'::jsonb
    )
  );
$$ language sql security definer stable;

-- Search entities by name (fuzzy)
create or replace function search_entities(
  p_org_id uuid,
  p_query text,
  p_entity_type text default null,
  p_limit int default 10
)
returns table (
  id uuid,
  entity_type text,
  name text,
  facts jsonb,
  observation_count int,
  similarity_score real
) as $$
  select
    ep.id,
    ep.entity_type,
    ep.name,
    ep.facts,
    ep.observation_count,
    similarity(ep.name, p_query) as similarity_score
  from entity_profiles ep
  where ep.org_id = p_org_id
    and (p_entity_type is null or ep.entity_type = p_entity_type)
    and (
      similarity(ep.name, p_query) > 0.2
      or ep.name ilike '%' || p_query || '%'
    )
  order by similarity(ep.name, p_query) desc
  limit p_limit;
$$ language sql security definer stable;

-- Get recent corrections for learning context
create or replace function get_recent_corrections(
  p_org_id uuid,
  p_limit int default 20
)
returns jsonb as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'type', c.correction_type,
        'original', c.original_value,
        'corrected', c.corrected_value,
        'explanation', c.explanation,
        'pattern', c.pattern,
        'created_at', c.created_at
      ) order by c.created_at desc
    ),
    '[]'::jsonb
  )
  from corrections c
  where c.org_id = p_org_id
  limit p_limit;
$$ language sql security definer stable;
