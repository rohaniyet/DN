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
