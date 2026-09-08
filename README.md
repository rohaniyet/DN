# DN Manager

Debit note register and Annex-I workbench for the monthly Pakistani sales tax return.

Single-user web app: static front end + Supabase (Postgres, Auth, RLS).
No build step — the files in this repository are what runs.

## What it does

| Screen | Purpose |
|---|---|
| **Dashboard** | This month's notes, what is still open, purchase master status |
| **Debit Notes** | Register, entry form, print, PDF, bulk PDF as a ZIP, backfill import |
| **Annex-I** | Matches every unfiled note against the purchase master, builds the IRIS upload, marks notes filed |
| **Purchase Master** | Monthly Annex-A import (adds only new invoice parts) and invoice capacity search |
| **Suppliers** | Supplier register, built once from the purchase master, cities filled in by hand |
| **Analytics** | Value and count by month, top suppliers, reason split, DN as % of purchases |
| **Settings** | Annex-I column template, DN numbering, reason list |

## Matching rules

* The match key against the purchase master is the **invoice number**, never the supplier name.
* A supplier's invoice is uploaded to FBR in parts (`3953-1`, `3953-2`, …). A debit note is
  covered using as many parts as needed, oldest part first.
* Every extra line of the same note takes a letter — `3953`, `3953B`, `3953C` — and each line
  carries **that part's own Invoice Ref No.** and the full invoice number with its suffix.
* No part is ever debited beyond the value and quantity still available on it; committed
  Annex-I runs consume that capacity, so the same part is never claimed twice.
* UOM, invoice date and quantity are copied from the purchase data.
* A note whose invoice is not in the purchase data stays **pending**, is highlighted yellow in
  the export and is carried forward to the next month automatically.

## Export

One workbook, two sheets — as used in the manual working:

1. **All Debit Notes** — every note, pending rows highlighted yellow with the reason.
2. **IRIS Upload** — the ready lines only, in the exact column order of the sample table.

## Files

| File | Contents |
|---|---|
| `index.html` | shell and script loading |
| `config.js` | Supabase URL / publishable key, printed company details |
| `lib.js` | formatting, dates, invoice-number parsing, amount in words, sheet reading |
| `db.js` | every Supabase query |
| `suppliers.js` `master.js` `notes.js` `annexi.js` `analytics.js` `settings.js` | the screens |
| `printing.js` | the printed debit note, PDF and ZIP |
| `schema.sql` | database schema, run once in the Supabase SQL editor |

The publishable key in `config.js` is public by design; row level security is the real
boundary and every table is readable only by a signed-in user.
