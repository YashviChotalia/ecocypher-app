-- EcoCypher ESG workspace: multi-company schema with row-level security.
-- Run once in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text not null default '',
  cin text,
  grid_ef numeric not null default 0.71,
  diesel_ef numeric not null default 2.68,
  lpg_ef numeric not null default 2.98,
  turnover_cr jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','manager','viewer')),
  name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','manager','viewer')),
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  city text not null default '',
  kind text not null default ''
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ref text not null,
  kind text not null check (kind in ('mrv','meter','invoice','audit','certificate','other')),
  title text not null,
  facility_id uuid references public.facilities(id) on delete set null,
  period_start date,
  period_end date,
  metrics jsonb not null default '{}'::jsonb,
  canonical_json text not null,
  sha256 text not null,
  anchor_status text not null default 'NONE',
  onchain_hash text,
  tx_hash text,
  audited boolean not null default false,
  auditor text,
  file_name text,
  file_size bigint,
  file_sha256 text,
  file_path text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (company_id, ref)
);

create table if not exists public.energy_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  grid_kwh numeric not null default 0 check (grid_kwh >= 0),
  renewable_kwh numeric not null default 0 check (renewable_kwh >= 0),
  diesel_l numeric not null default 0 check (diesel_l >= 0),
  lpg_kg numeric not null default 0 check (lpg_kg >= 0),
  evidence_id uuid references public.evidence(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (facility_id, month)
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  text text not null,
  channel text not null default 'other',
  status text not null default 'draft' check (status in ('draft','in_review','approved','rejected','published')),
  evidence_ids uuid[] not null default '{}',
  verdict text,
  score int,
  owner_name text,
  publish_on date,
  decision_note text,
  decided_by text,
  decided_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  detail text,
  at timestamptz not null default now()
);
create index if not exists activity_company_at on public.activity (company_id, at desc);

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function public.member_role(p_company uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where company_id = p_company and user_id = auth.uid()
$$;

create or replace function public.can_read(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where company_id = p_company and user_id = auth.uid())
$$;

create or replace function public.can_write(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(p_company) in ('admin','manager'), false)
$$;

create or replace function public.is_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(p_company) = 'admin', false)
$$;

-- Create a company and make the caller its admin.
create or replace function public.create_company(p_name text, p_industry text, p_cin text, p_member_name text)
returns public.companies language plpgsql security definer set search_path = public as $$
declare c public.companies;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.companies (name, industry, cin) values (p_name, coalesce(p_industry,''), p_cin) returning * into c;
  insert into public.members (company_id, user_id, role, name, email)
    values (c.id, auth.uid(), 'admin', coalesce(nullif(p_member_name,''), split_part(auth.email(), '@', 1)), auth.email());
  return c;
end $$;

-- Invites addressed to the signed-in user's email.
create or replace function public.my_invites()
returns table (id uuid, company_id uuid, company_name text, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.company_id, c.name, i.email, i.role, i.created_at
  from public.invites i join public.companies c on c.id = i.company_id
  where lower(i.email) = lower(auth.email())
$$;

create or replace function public.accept_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.invites;
begin
  select * into i from public.invites where id = invite_id and lower(email) = lower(auth.email());
  if not found then raise exception 'Invite not found'; end if;
  insert into public.members (company_id, user_id, role, name, email)
    values (i.company_id, auth.uid(), i.role,
      coalesce((select raw_user_meta_data->>'name' from auth.users where id = auth.uid()), split_part(auth.email(), '@', 1)), auth.email())
    on conflict (company_id, user_id) do update set role = excluded.role;
  delete from public.invites where id = i.id;
end $$;

-- ── Row-level security ───────────────────────────────────────────────────────
alter table public.companies enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.facilities enable row level security;
alter table public.evidence enable row level security;
alter table public.energy_records enable row level security;
alter table public.claims enable row level security;
alter table public.activity enable row level security;

create policy companies_read on public.companies for select using (public.can_read(id));
create policy companies_admin on public.companies for update using (public.is_admin(id));

create policy members_read on public.members for select using (public.can_read(company_id));
create policy members_admin_update on public.members for update using (public.is_admin(company_id));
create policy members_admin_delete on public.members for delete using (public.is_admin(company_id) or user_id = auth.uid());

create policy invites_read on public.invites for select using (public.is_admin(company_id));
create policy invites_admin_insert on public.invites for insert with check (public.is_admin(company_id));
create policy invites_admin_delete on public.invites for delete using (public.is_admin(company_id));

create policy facilities_read on public.facilities for select using (public.can_read(company_id));
create policy facilities_write on public.facilities for all using (public.can_write(company_id)) with check (public.can_write(company_id));

create policy energy_read on public.energy_records for select using (public.can_read(company_id));
create policy energy_write on public.energy_records for all using (public.can_write(company_id)) with check (public.can_write(company_id));

-- Evidence is append-only: no UPDATE policy, so a fingerprinted record cannot be edited through the API.
create policy evidence_read on public.evidence for select using (public.can_read(company_id));
create policy evidence_insert on public.evidence for insert with check (public.can_write(company_id));
create policy evidence_admin_delete on public.evidence for delete using (public.is_admin(company_id));

create policy claims_read on public.claims for select using (public.can_read(company_id));
create policy claims_write on public.claims for all using (public.can_write(company_id)) with check (public.can_write(company_id));

-- The audit trail is append-only too.
create policy activity_read on public.activity for select using (public.can_read(company_id));
create policy activity_insert on public.activity for insert with check (public.can_read(company_id));

-- ── File storage for evidence documents ─────────────────────────────────────
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;

create policy evidence_files_read on storage.objects for select
  using (bucket_id = 'evidence' and public.can_read(((storage.foldername(name))[1])::uuid));
create policy evidence_files_insert on storage.objects for insert
  with check (bucket_id = 'evidence' and public.can_write(((storage.foldername(name))[1])::uuid));
