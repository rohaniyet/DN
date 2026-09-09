-- =====================================================================
-- DN Manager - database schema (Supabase / Postgres)
-- Single-user app for Annex-I debit note management.
-- Safe to re-run.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- suppliers -------------------------------------------------
create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  ntn         text,
  city        text,
  fbr_name    text,
  active      boolean default true,
  created_at  timestamptz default now()
);
create unique index if not exists suppliers_ntn_uk
  on suppliers (ntn) where ntn is not null and ntn <> '';
create index if not exists suppliers_name_ix on suppliers (lower(name));

-- ---------- purchase master (FBR Annex-A rows) ------------------------
create table if not exists purchase_master (
  id            uuid primary key default gen_random_uuid(),
  inv_ref_no    text not null,
  invoice_no    text,
  invoice_base  text,          -- invoice no without the -1/-2 part suffix, normalised
  part_no       int  default 0,
  invoice_date  date,
  supplier_name text,
  supplier_ntn  text,
  purchase_type text,
  hs_code       text,
  product       text,
  uom           text,
  quantity      numeric(18,4) default 0,
  value_excl    numeric(18,2) default 0,
  tax_rate      text,
  sales_tax     numeric(18,2) default 0,
  period        text,          -- YYYY-MM of the return the row came from
  created_at    timestamptz default now(),
  constraint purchase_master_ref_uk unique (inv_ref_no)
);
create index if not exists pm_base_ix   on purchase_master (invoice_base);
create index if not exists pm_ntn_ix    on purchase_master (supplier_ntn);
create index if not exists pm_period_ix on purchase_master (period);

-- ---------- reason list ----------------------------------------------
create table if not exists reasons (
  id         serial primary key,
  label      text unique not null,
  sort_order int default 0,
  active     boolean default true
);
insert into reasons(label, sort_order) values
  ('Material Rejected',1),('Low Quality',2),('Rate Difference',3),
  ('Wrong Invoice',4),('Short Receipt',5),('Other',9)
on conflict (label) do nothing;

-- ---------- debit notes ----------------------------------------------
create table if not exists debit_notes (
  id             uuid primary key default gen_random_uuid(),
  dn_no          text not null,
  dn_date        date not null default current_date,
  supplier_id    uuid references suppliers(id),
  supplier_name  text,
  supplier_ntn   text,
  supplier_city  text,
  reason         text,
  reason_note    text,
  gate_pass_no   text,
  gate_pass_date date,
  status         text not null default 'draft'
                 check (status in ('draft','printed','filed','cancelled')),
  filed_period   text,
  remarks        text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  constraint debit_notes_no_uk unique (dn_no)
);
create index if not exists dn_date_ix   on debit_notes (dn_date);
create index if not exists dn_status_ix on debit_notes (status);

create table if not exists debit_note_items (
  id           uuid primary key default gen_random_uuid(),
  dn_id        uuid not null references debit_notes(id) on delete cascade,
  sr           int default 1,
  invoice_no   text,
  invoice_base text,
  invoice_date date,
  product      text,
  hs_code      text,
  uom          text,
  quantity     numeric(18,4) default 0,
  rate         numeric(18,4) default 0,
  value_excl   numeric(18,2) default 0,
  tax_rate     numeric(6,2)  default 18,
  sales_tax    numeric(18,2) default 0,
  total        numeric(18,2) default 0
);
create index if not exists dni_dn_ix   on debit_note_items (dn_id);
create index if not exists dni_base_ix on debit_note_items (invoice_base);

-- ---------- Annex-I runs / generated upload lines ---------------------
create table if not exists annexi_runs (
  id           uuid primary key default gen_random_uuid(),
  period       text not null,
  status       text not null default 'draft' check (status in ('draft','committed')),
  line_count   int default 0,
  total_value  numeric(18,2) default 0,
  created_at   timestamptz default now(),
  committed_at timestamptz
);

create table if not exists annexi_lines (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references annexi_runs(id) on delete cascade,
  dn_id          uuid references debit_notes(id) on delete cascade,
  seq            int default 0,
  dn_no_display  text,
  supplier_name  text,
  supplier_ntn   text,
  purchase_type  text,
  tax_rate       text,
  hs_code        text,
  inv_ref_no     text,
  invoice_no     text,
  invoice_date   date,
  uom            text,
  quantity       numeric(18,4) default 0,
  value_excl     numeric(18,2) default 0,
  sales_tax      numeric(18,2) default 0,
  dn_date        date,
  reason         text,
  status         text default 'ready',   -- ready | pending
  pending_reason text
);
alter table annexi_lines add column if not exists orig_qty   numeric(18,4) default 0;
alter table annexi_lines add column if not exists orig_value numeric(18,2) default 0;

create index if not exists al_run_ix on annexi_lines (run_id);
create index if not exists al_ref_ix on annexi_lines (inv_ref_no);
create index if not exists al_dn_ix  on annexi_lines (dn_id);

-- ---------- settings --------------------------------------------------
create table if not exists app_settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
insert into app_settings(id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- ---------- capacity view --------------------------------------------
-- how much of every FBR invoice part is still available to be debited
drop view if exists v_invoice_capacity;
create view v_invoice_capacity with (security_invoker = true) as
select m.id, m.inv_ref_no, m.invoice_no, m.invoice_base, m.part_no, m.invoice_date,
       m.supplier_name, m.supplier_ntn, m.uom, m.quantity, m.value_excl,
       m.tax_rate, m.hs_code, m.purchase_type, m.product, m.period,
       coalesce(u.used_value,0) as used_value,
       coalesce(u.used_qty,0)   as used_qty,
       m.value_excl - coalesce(u.used_value,0) as avail_value,
       m.quantity   - coalesce(u.used_qty,0)   as avail_qty
from purchase_master m
left join (
  select l.inv_ref_no,
         sum(l.value_excl) as used_value,
         sum(l.quantity)   as used_qty
  from annexi_lines l
  join annexi_runs r on r.id = l.run_id
  where r.status = 'committed' and l.status = 'ready'
  group by l.inv_ref_no
) u on u.inv_ref_no = m.inv_ref_no;

-- ---------- row level security ---------------------------------------
do $$
declare t text;
begin
  foreach t in array array['suppliers','purchase_master','reasons','debit_notes',
                           'debit_note_items','annexi_runs','annexi_lines','app_settings']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on v_invoice_capacity to authenticated;

-- ---------------------------------------------------------------------
-- 2026-09-09: supplier naming, invoice capacity at entry time
-- ---------------------------------------------------------------------
alter table debit_notes add column if not exists supplier_fbr_name text;
alter table suppliers   add column if not exists address text;

-- what every invoice (all its FBR parts together) originally carried
drop view if exists v_invoice_summary;
create view v_invoice_summary with (security_invoker = true) as
select m.invoice_base,
       min(m.invoice_no)    as first_invoice_no,
       max(m.invoice_date)  as invoice_date,
       max(m.supplier_name) as supplier_name,
       max(m.supplier_ntn)  as supplier_ntn,
       max(m.uom)           as uom,
       max(m.hs_code)       as hs_code,
       max(m.product)       as product,
       max(m.tax_rate)      as tax_rate,
       count(*)             as parts,
       sum(m.quantity)      as total_qty,
       sum(m.value_excl)    as total_value,
       sum(m.sales_tax)     as total_tax
from purchase_master m
where m.invoice_base is not null and m.invoice_base <> ''
group by m.invoice_base;

-- what has already been debited against it by any live debit note
drop view if exists v_invoice_debited;
create view v_invoice_debited with (security_invoker = true) as
select i.invoice_base,
       sum(i.quantity)   as debited_qty,
       sum(i.value_excl) as debited_value,
       count(distinct i.dn_id) as note_count
from debit_note_items i
join debit_notes n on n.id = i.dn_id
where n.status <> 'cancelled'
  and i.invoice_base is not null and i.invoice_base <> ''
group by i.invoice_base;

grant select on v_invoice_summary, v_invoice_debited to authenticated;

-- ---------------------------------------------------------------------
-- 2026-09-09b: users and rights, plus summary views for speed
-- ---------------------------------------------------------------------

alter table debit_notes add column if not exists created_by       uuid;
alter table debit_notes add column if not exists created_by_email text;
create index if not exists dn_created_by_ix on debit_notes (created_by);

-- ---------- who may use the app, and with what rights ----------------
create table if not exists app_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'entry' check (role in ('admin','entry')),
  active     boolean not null default false,
  created_at timestamptz default now()
);

/* only these addresses get in; anyone else who signs up lands inactive
   and can see nothing at all */
create or replace function app_allowed(mail text) returns boolean
language sql immutable as $$
  select lower(coalesce(mail,'')) in ('sgft.tax@servis.com', 'dn@sgfl.com')
$$;

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into app_profiles(id, email, role, active)
  values (new.id, lower(new.email),
          case when lower(new.email) = 'sgft.tax@servis.com' then 'admin' else 'entry' end,
          app_allowed(new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_auth_user();

/* seed whoever already exists */
insert into app_profiles(id, email, role, active)
select u.id, lower(u.email),
       case when lower(u.email) = 'sgft.tax@servis.com' then 'admin' else 'entry' end,
       app_allowed(u.email)
from auth.users u
on conflict (id) do nothing;

update app_profiles set role = 'admin', active = true where email = 'sgft.tax@servis.com';
update app_profiles set role = 'entry', active = true where email = 'dn@sgfl.com';

/* every debit note made so far belongs to the owner */
update debit_notes
set created_by = (select id from app_profiles where role = 'admin' limit 1),
    created_by_email = (select email from app_profiles where role = 'admin' limit 1)
where created_by is null;

create or replace function has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_profiles p where p.id = auth.uid() and p.active)
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_profiles p where p.id = auth.uid() and p.active and p.role = 'admin')
$$;

grant execute on function has_access(), is_admin(), app_allowed(text) to authenticated;

-- ---------- policies ------------------------------------------------
alter table app_profiles enable row level security;
drop policy if exists prof_self on app_profiles;
create policy prof_self on app_profiles for select to authenticated
  using (id = auth.uid() or is_admin());

do $$
declare t text;
begin
  /* reference data: everyone with access reads, only the owner writes */
  foreach t in array array['purchase_master','reasons','annexi_runs','annexi_lines','app_settings']
  loop
    execute format('drop policy if exists app_all on %I', t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (has_access())', t, t);
    execute format('create policy %I_write on %I for all to authenticated using (is_admin()) with check (is_admin())', t, t);
  end loop;
end $$;

/* the supplier register learns from data entry, so both roles may add to it */
drop policy if exists app_all on suppliers;
drop policy if exists sup_read on suppliers;
drop policy if exists sup_add on suppliers;
drop policy if exists sup_edit on suppliers;
drop policy if exists sup_del on suppliers;
create policy sup_read on suppliers for select to authenticated using (has_access());
create policy sup_add  on suppliers for insert to authenticated with check (has_access());
create policy sup_edit on suppliers for update to authenticated using (has_access()) with check (has_access());
create policy sup_del  on suppliers for delete to authenticated using (is_admin());

/* debit notes: everyone reads and prints, entry users edit only their own */
drop policy if exists app_all   on debit_notes;
drop policy if exists dn_select on debit_notes;
drop policy if exists dn_insert on debit_notes;
drop policy if exists dn_update on debit_notes;
drop policy if exists dn_delete on debit_notes;
create policy dn_select on debit_notes for select to authenticated using (has_access());
create policy dn_insert on debit_notes for insert to authenticated
  with check (has_access() and created_by = auth.uid());
create policy dn_update on debit_notes for update to authenticated
  using (has_access() and (is_admin() or created_by = auth.uid()))
  with check (has_access() and (is_admin() or created_by = auth.uid()));
create policy dn_delete on debit_notes for delete to authenticated using (is_admin());

drop policy if exists app_all    on debit_note_items;
drop policy if exists dni_select on debit_note_items;
drop policy if exists dni_write  on debit_note_items;
create policy dni_select on debit_note_items for select to authenticated using (has_access());
create policy dni_write on debit_note_items for all to authenticated
  using (exists (select 1 from debit_notes n where n.id = dn_id and (is_admin() or n.created_by = auth.uid())))
  with check (exists (select 1 from debit_notes n where n.id = dn_id and (is_admin() or n.created_by = auth.uid())));

-- ---------- summary views: the screens read these, not whole tables ---
drop view if exists v_note_totals;
create view v_note_totals with (security_invoker = true) as
select n.id, n.dn_no, n.dn_date, n.supplier_name, n.supplier_ntn, n.supplier_city,
       n.supplier_fbr_name, n.reason, n.reason_note, n.gate_pass_no, n.status,
       n.filed_period, n.created_by, n.created_by_email, n.updated_at,
       coalesce(sum(i.value_excl), 0) as value_excl,
       coalesce(sum(i.sales_tax), 0)  as sales_tax,
       count(i.id)                    as item_count,
       string_agg(distinct i.invoice_no, ', ') as invoices
from debit_notes n
left join debit_note_items i on i.dn_id = n.id
group by n.id;

drop view if exists v_note_monthly;
create view v_note_monthly with (security_invoker = true) as
select to_char(n.dn_date, 'YYYY-MM') as period,
       count(distinct n.id) as notes,
       coalesce(sum(i.value_excl), 0) as value_excl,
       coalesce(sum(i.sales_tax), 0)  as sales_tax
from debit_notes n left join debit_note_items i on i.dn_id = n.id
where n.status <> 'cancelled'
group by 1;

drop view if exists v_note_status;
create view v_note_status with (security_invoker = true) as
select n.status, to_char(n.dn_date, 'YYYY-MM') as period,
       count(distinct n.id) as notes,
       coalesce(sum(i.value_excl), 0) as value_excl,
       coalesce(sum(i.sales_tax), 0)  as sales_tax
from debit_notes n left join debit_note_items i on i.dn_id = n.id
group by 1, 2;

drop view if exists v_note_supplier;
create view v_note_supplier with (security_invoker = true) as
select coalesce(nullif(btrim(n.supplier_name), ''), '(no supplier)') as supplier,
       n.status,
       count(distinct n.id) as notes,
       coalesce(sum(i.value_excl), 0) as value_excl,
       coalesce(sum(i.sales_tax), 0)  as sales_tax
from debit_notes n left join debit_note_items i on i.dn_id = n.id
group by 1, 2;

drop view if exists v_note_reason;
create view v_note_reason with (security_invoker = true) as
select coalesce(nullif(btrim(n.reason), ''), '(not set)') as reason,
       count(distinct n.id) as notes,
       coalesce(sum(i.value_excl), 0) as value_excl,
       coalesce(sum(i.sales_tax), 0)  as sales_tax
from debit_notes n left join debit_note_items i on i.dn_id = n.id
where n.status <> 'cancelled'
group by 1;

drop view if exists v_master_periods;
create view v_master_periods with (security_invoker = true) as
select period,
       count(*) as rows_count,
       coalesce(sum(value_excl), 0) as value_excl,
       coalesce(sum(sales_tax), 0)  as sales_tax
from purchase_master
group by period;

grant select on v_note_totals, v_note_monthly, v_note_status, v_note_supplier,
                v_note_reason, v_master_periods, app_profiles to authenticated;
