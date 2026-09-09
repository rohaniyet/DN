/* ===== DN Manager - data access ================================= */
(function (D) {
  "use strict";
  const cfg = window.DN_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  D.sb = sb;

  function ok(res) { if (res.error) throw res.error; return res.data; }
  D.ok = ok;

  /* fetch every row of a table in pages (PostgREST caps at 1000) */
  async function all(table, select, tweak) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      let q = sb.from(table).select(select || "*").range(from, from + size - 1);
      if (tweak) q = tweak(q);
      const rows = ok(await q);
      out.push(...rows);
      if (rows.length < size) break;
    }
    return out;
  }
  D.all = all;

  /* ---------- settings ---------- */
  D.settings = {};
  D.loadSettings = async function () {
    const rows = ok(await sb.from("app_settings").select("data").eq("id", 1).limit(1));
    D.settings = (rows[0] && rows[0].data) || {};
    return D.settings;
  };
  D.saveSettings = async function (patch) {
    D.settings = Object.assign({}, D.settings, patch);
    ok(await sb.from("app_settings").upsert({ id: 1, data: D.settings, updated_at: new Date().toISOString() }));
    return D.settings;
  };

  /* ---------- suppliers ---------- */
  D.getSuppliers = () => all("suppliers", "*", q => q.order("name"));
  D.upsertSupplier = async (s) => ok(await sb.from("suppliers").upsert(s, { onConflict: "id" }).select())[0];
  D.deleteSupplier = async (id) => ok(await sb.from("suppliers").delete().eq("id", id));

  /* ---------- purchase master ---------- */
  D.masterCount = async () => {
    const r = await sb.from("purchase_master").select("id", { count: "exact", head: true });
    if (r.error) throw r.error; return r.count || 0;
  };
  D.masterStats = async () => {
    const rows = await all("purchase_master", "period,value_excl");
    const byPeriod = {};
    rows.forEach(r => {
      const p = r.period || "unknown";
      byPeriod[p] = byPeriod[p] || { period: p, rows: 0, value: 0 };
      byPeriod[p].rows++; byPeriod[p].value += D.num(r.value_excl);
    });
    return { total: rows.length, periods: Object.values(byPeriod).sort((a, b) => a.period < b.period ? 1 : -1) };
  };
  /* upsert on inv_ref_no -> only genuinely new FBR rows get added */
  D.importMaster = async function (records, onProgress) {
    let inserted = 0; const size = 400;
    for (let i = 0; i < records.length; i += size) {
      const chunk = records.slice(i, i + size);
      ok(await sb.from("purchase_master").upsert(chunk, { onConflict: "inv_ref_no", ignoreDuplicates: false }));
      inserted += chunk.length;
      if (onProgress) onProgress(inserted, records.length);
    }
    return inserted;
  };
  D.searchMaster = async function (term) {
    const t = String(term || "").trim();
    if (t.length < 2) return [];
    const like = "%" + t.replace(/[%_]/g, "") + "%";
    return ok(await sb.from("v_invoice_capacity").select("*")
      .or("invoice_no.ilike." + like + ",inv_ref_no.ilike." + like + ",supplier_name.ilike." + like)
      .order("invoice_no").limit(40));
  };
  D.capacityForBases = async function (bases) {
    if (!bases.length) return [];
    const out = []; const size = 60;
    for (let i = 0; i < bases.length; i += size) {
      out.push(...ok(await sb.from("v_invoice_capacity").select("*").in("invoice_base", bases.slice(i, i + size))));
    }
    return out;
  };

  /* what an invoice originally carried, and what is already debited off it */
  D.invoiceInfo = async function (base) {
    if (!base) return null;
    const [sum, deb] = await Promise.all([
      sb.from("v_invoice_summary").select("*").eq("invoice_base", base).limit(1),
      sb.from("v_invoice_debited").select("*").eq("invoice_base", base).limit(1)
    ]);
    if (sum.error) throw sum.error;
    if (deb.error) throw deb.error;
    const s = (sum.data || [])[0];
    if (!s) return null;
    const d = (deb.data || [])[0] || { debited_qty: 0, debited_value: 0, note_count: 0 };
    return {
      base: base, invoice_no: s.first_invoice_no, invoice_date: s.invoice_date,
      supplier_name: s.supplier_name, supplier_ntn: s.supplier_ntn,
      uom: s.uom, hs_code: s.hs_code, product: s.product, tax_rate: s.tax_rate, parts: s.parts,
      total_qty: D.num(s.total_qty), total_value: D.num(s.total_value), total_tax: D.num(s.total_tax),
      debited_qty: D.num(d.debited_qty), debited_value: D.num(d.debited_value),
      note_count: d.note_count || 0,
      rate: D.num(s.total_qty) ? D.round4(D.num(s.total_value) / D.num(s.total_qty)) : 0
    };
  };

  /* the supplier register learns from what he types on a debit note */
  D.rememberSupplier = async function (note) {
    const ntn = String(note.supplier_ntn || "").trim();
    const name = String(note.supplier_name || "").trim();
    if (!name) return null;
    const list = await D.getSuppliers();
    let found = ntn ? list.find(s => D.norm(s.ntn) === D.norm(ntn)) : null;
    if (!found) found = list.find(s => D.norm(s.name) === D.norm(name) ||
      (s.fbr_name && D.norm(s.fbr_name) === D.norm(name)));
    const city = String(note.supplier_city || "").trim();
    const fbr = String(note.supplier_fbr_name || "").trim();
    if (found) {
      const patch = {};
      if (city && !String(found.city || "").trim()) patch.city = city;
      if (ntn && !String(found.ntn || "").trim()) patch.ntn = ntn;
      if (fbr && !String(found.fbr_name || "").trim()) patch.fbr_name = fbr;
      if (!Object.keys(patch).length) return found;
      const row = ok(await sb.from("suppliers").update(patch).eq("id", found.id).select())[0];
      Object.assign(found, row || patch);
      return found;
    }
    const row = ok(await sb.from("suppliers").insert({
      name: name, ntn: ntn || null, city: city || null, fbr_name: fbr || null
    }).select())[0];
    D.cache.suppliers = null;
    return row;
  };

  /* ---------- debit notes ---------- */
  const NOTE_SELECT = "*, items:debit_note_items(*)";
  D.getNotes = (filters) => all("debit_notes", NOTE_SELECT, q => {
    let x = q.order("dn_date", { ascending: false }).order("dn_no", { ascending: false });
    if (filters && filters.status) x = x.eq("status", filters.status);
    if (filters && filters.from) x = x.gte("dn_date", filters.from);
    if (filters && filters.to) x = x.lte("dn_date", filters.to);
    return x;
  });
  D.getNote = async (id) => (ok(await sb.from("debit_notes").select(NOTE_SELECT).eq("id", id).limit(1)))[0];
  D.getNotesByIds = async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 50)
      out.push(...ok(await sb.from("debit_notes").select(NOTE_SELECT).in("id", ids.slice(i, i + 50))));
    return out;
  };

  D.saveNote = async function (note, items) {
    const head = Object.assign({}, note); delete head.items;
    head.updated_at = new Date().toISOString();
    let saved;
    if (head.id) {
      saved = ok(await sb.from("debit_notes").update(head).eq("id", head.id).select())[0];
      ok(await sb.from("debit_note_items").delete().eq("dn_id", head.id));
    } else {
      delete head.id;
      saved = ok(await sb.from("debit_notes").insert(head).select())[0];
    }
    const rows = items.map((it, i) => Object.assign({}, it, { id: undefined, dn_id: saved.id, sr: i + 1 }));
    rows.forEach(r => delete r.id);
    if (rows.length) ok(await sb.from("debit_note_items").insert(rows));
    return saved;
  };
  D.setNoteStatus = async (ids, status, extra) =>
    ok(await sb.from("debit_notes").update(Object.assign({ status: status, updated_at: new Date().toISOString() }, extra || {})).in("id", ids));
  D.deleteNote = async (id) => ok(await sb.from("debit_notes").delete().eq("id", id));

  D.nextDnNo = async function () {
    const rows = ok(await sb.from("debit_notes").select("dn_no"));
    let max = 0;
    rows.forEach(r => { const n = parseInt(String(r.dn_no).replace(/[^0-9]/g, ""), 10); if (!isNaN(n) && n > max) max = n; });
    if (max) return String(max + 1);
    return String(D.settings.start_dn_no || 1);
  };

  /* ---------- reasons ---------- */
  D.getReasons = async () => ok(await D.sb.from("reasons").select("*").eq("active", true).order("sort_order"));

  /* ---------- annex-I runs ---------- */
  D.createRun = async (period) => ok(await sb.from("annexi_runs").insert({ period: period }).select())[0];
  D.saveRunLines = async function (runId, lines) {
    ok(await sb.from("annexi_lines").delete().eq("run_id", runId));
    for (let i = 0; i < lines.length; i += 400)
      ok(await sb.from("annexi_lines").insert(lines.slice(i, i + 400).map(l => Object.assign({}, l, { run_id: runId }))));
  };
  D.commitRun = async function (runId, period, dnIds, lineCount, totalValue) {
    ok(await sb.from("annexi_runs").update({
      status: "committed", committed_at: new Date().toISOString(),
      line_count: lineCount, total_value: totalValue
    }).eq("id", runId));
    if (dnIds.length) await D.setNoteStatus(dnIds, "filed", { filed_period: period });
  };
  D.getRuns = () => all("annexi_runs", "*", q => q.order("created_at", { ascending: false }));
  D.deleteRun = async (id) => ok(await sb.from("annexi_runs").delete().eq("id", id));
})(window.DN);
