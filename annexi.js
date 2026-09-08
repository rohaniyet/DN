/* ===== DN Manager - Annex-I matching engine and export ==========
   The export reproduces the IRIS "sample table" exactly: a grouped
   top row (Debit Note Details / Original Invoice Details / Revised
   Invoice Detail) over 24 columns, with the revised block worked out
   as original minus debit note, the same way the manual file did it.
   ================================================================ */
(function (D) {
  "use strict";

  const DEFAULT_COLS = [
    { key: "supplier_name", head: "Supplier Name",       group: "" },
    { key: "supplier_ntn",  head: "NTN",                 group: "" },
    { key: "purchase_type", head: "Purchase Type",       group: "" },
    { key: "rate_ratio",    head: "Rate",                group: "",  fmt: "0%" },
    { key: "hs_code",       head: "HS CODES",            group: "" },
    { key: "inv_ref_no",    head: "Invoice Ref No.",     group: "" },

    { key: "dn_no_display", head: "Dr Note NO",          group: "Debit Note Details" },
    { key: "dn_date",       head: "Date",                group: "Debit Note Details" },
    { key: "dn_qty",        head: "Qnty",                group: "Debit Note Details", fmt: "#,##0.00" },
    { key: "uom",           head: "UOM",                 group: "Debit Note Details" },
    { key: "dn_value",      head: "Ex. Value",           group: "Debit Note Details", fmt: "#,##0" },
    { key: "dn_tax",        head: "S.tax",               group: "Debit Note Details", fmt: "#,##0" },
    { key: "dn_total",      head: "TOTAL",               group: "Debit Note Details", fmt: "#,##0" },

    { key: "invoice_no",    head: "Original Invoice no", group: "Original Invoice Details" },
    { key: "invoice_date",  head: "Date",                group: "Original Invoice Details" },
    { key: "orig_qty",      head: "Qnty",                group: "Original Invoice Details", fmt: "#,##0.00" },
    { key: "orig_value",    head: "Ex. Value",           group: "Original Invoice Details", fmt: "#,##0" },
    { key: "orig_tax",      head: "S.Tax",               group: "Original Invoice Details", fmt: "#,##0" },
    { key: "orig_total",    head: "TOTAL ",              group: "Original Invoice Details", fmt: "#,##0" },

    { key: "rev_qty",       head: "Qnty",                group: "Revised Invoice Detail", fmt: "#,##0.00" },
    { key: "rev_value",     head: "Ex. Value",           group: "Revised Invoice Detail", fmt: "#,##0" },
    { key: "rev_tax",       head: "S. Tax",              group: "Revised Invoice Detail", fmt: "#,##0" },
    { key: "rev_total",     head: "Total",               group: "Revised Invoice Detail", fmt: "#,##0" },

    { key: "reason",        head: "Reason",              group: "" }
  ];
  D.ANNEXI_DEFAULT_COLS = DEFAULT_COLS;

  function columns() {
    const saved = D.settings.annexi_cols;
    if (Array.isArray(saved) && saved.length) return saved;
    return DEFAULT_COLS;
  }
  D.annexiColumns = columns;

  const pct = (rateText, fallback) => {
    const n = parseFloat(String(rateText || "").replace(/[^0-9.]/g, ""));
    if (isNaN(n) || n === 0) return fallback || window.DN_CONFIG.DEFAULT_TAX_RATE;
    return n <= 1 ? n * 100 : n;          /* accepts "18%", "18" and 0.18 */
  };
  const suffix = (i) => {
    if (i === 0) return "";
    let s = "", n = i;                    /* 1 -> B, 2 -> C ... 25 -> Z, 26 -> AA */
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  };

  /* fills the derived columns of one upload line */
  function derive(l, rate) {
    l.rate_ratio = D.round4(rate / 100);
    l.dn_qty     = D.round4(l.quantity);
    l.dn_value   = D.round2(l.value_excl);
    l.dn_tax     = D.round2(l.sales_tax);
    l.dn_total   = D.round2(l.dn_value + l.dn_tax);
    l.orig_tax   = D.round2(D.num(l.orig_value) * rate / 100);
    l.orig_total = D.round2(D.num(l.orig_value) + l.orig_tax);
    l.rev_qty    = D.round4(D.num(l.orig_qty) - l.dn_qty);
    l.rev_value  = D.round2(D.num(l.orig_value) - l.dn_value);
    l.rev_tax    = D.round2(l.orig_tax - l.dn_tax);
    l.rev_total  = D.round2(l.orig_total - l.dn_total);
    return l;
  }

  /* -----------------------------------------------------------------
     The matching engine.
     For every debit note: cover its ex-tax value with as many parts of
     the original invoice as needed, oldest part first, never debiting a
     part beyond what is still available on it.
     ----------------------------------------------------------------- */
  D.matchNotes = function (notes, capRows) {
    const byBase = new Map();
    capRows.forEach(r => {
      const k = r.invoice_base || "";
      if (!byBase.has(k)) byBase.set(k, []);
      byBase.get(k).push({
        ref: r.inv_ref_no, invoice_no: r.invoice_no, part: r.part_no || 0, date: r.invoice_date,
        supplier_name: r.supplier_name, supplier_ntn: r.supplier_ntn, purchase_type: r.purchase_type,
        hs_code: r.hs_code, uom: r.uom, tax_rate: r.tax_rate,
        availValue: D.round2(r.avail_value), availQty: D.round4(r.avail_qty),
        partValue: D.round2(r.value_excl), partQty: D.round4(r.quantity)
      });
    });
    byBase.forEach(list => list.sort((a, b) => (a.part - b.part) || String(a.invoice_no).localeCompare(String(b.invoice_no))));

    const results = [];
    notes.forEach(note => {
      const items = (note.items || []).slice().sort((a, b) => (a.sr || 0) - (b.sr || 0));
      const noteValue = D.round2(items.reduce((a, i) => a + D.num(i.value_excl), 0));
      const groups = new Map();
      items.forEach(it => {
        const base = it.invoice_base || D.invBase(it.invoice_no);
        if (!groups.has(base)) groups.set(base, { base: base, invoice_no: it.invoice_no, value: 0, qty: 0, item: it });
        const g = groups.get(base);
        g.value = D.round2(g.value + D.num(it.value_excl));
        g.qty = D.round4(g.qty + D.num(it.quantity));
      });

      const lines = []; const problems = [];
      let covered = 0;

      groups.forEach(g => {
        let parts = byBase.get(g.base) || [];
        if (!parts.length) { problems.push("invoice " + (g.invoice_no || g.base) + " not in purchase master"); return; }
        /* prefer the parts belonging to this supplier when the NTN is known */
        if (note.supplier_ntn) {
          const same = parts.filter(p => D.norm(p.supplier_ntn) === D.norm(note.supplier_ntn));
          if (same.length) parts = same;
        }
        let remaining = g.value;
        let remQty = g.qty;
        let used = false;
        for (const p of parts) {
          if (remaining <= 0.01) break;
          if (p.availValue <= 0.01) continue;
          const take = D.round2(Math.min(remaining, p.availValue));
          /* the debited quantity is HIS quantity, split across parts in the
             same proportion as the value; the last part takes the remainder
             so the lines add back to exactly what he wrote on the note */
          let qty;
          if (remaining - take <= 0.01 || g.value <= 0) qty = D.round4(remQty);
          else qty = D.round4(g.qty * (take / g.value));
          const rate = pct(p.tax_rate, D.num(g.item.tax_rate));
          lines.push(derive({
            dn_id: note.id, supplier_name: p.supplier_name || note.supplier_name,
            supplier_ntn: p.supplier_ntn || note.supplier_ntn,
            purchase_type: p.purchase_type || window.DN_CONFIG.DEFAULT_PURCHASE_TYPE,
            tax_rate: p.tax_rate || (rate + "%"), hs_code: p.hs_code || g.item.hs_code || "",
            inv_ref_no: p.ref, invoice_no: p.invoice_no, invoice_date: p.date,
            uom: p.uom || g.item.uom || "", quantity: qty, value_excl: take,
            sales_tax: D.round2(take * rate / 100),
            orig_qty: p.partQty, orig_value: p.partValue,
            dn_date: note.dn_date,
            reason: note.reason === "Other" ? (note.reason_note || "Other") : (note.reason || ""),
            status: "ready"
          }, rate));
          p.availValue = D.round2(p.availValue - take);
          p.availQty = D.round4(Math.max(0, p.availQty - qty));
          remQty = D.round4(remQty - qty);
          remaining = D.round2(remaining - take);
          covered = D.round2(covered + take);
          used = true;
        }
        if (remaining > 0.01)
          problems.push(used
            ? "invoice " + (g.invoice_no || g.base) + " short by " + D.money(remaining) + " (no capacity left on its parts)"
            : "invoice " + (g.invoice_no || g.base) + " has no available value left");
      });

      const ready = problems.length === 0 && lines.length > 0;
      lines.forEach((l, i) => { l.seq = i + 1; l.dn_no_display = note.dn_no + suffix(i); });
      results.push({
        note: note, lines: lines, ready: ready,
        value: noteValue, covered: covered,
        pending_reason: problems.join("; ")
      });
    });
    return results;
  };

  /* the columns that live in the annexi_lines table */
  const STORED = ["dn_id", "seq", "dn_no_display", "supplier_name", "supplier_ntn", "purchase_type",
    "tax_rate", "hs_code", "inv_ref_no", "invoice_no", "invoice_date", "uom", "quantity",
    "value_excl", "sales_tax", "orig_qty", "orig_value", "dn_date", "reason", "status", "pending_reason"];
  D.stripLine = (l) => { const o = {}; STORED.forEach(k => { if (l[k] !== undefined) o[k] = l[k]; }); return o; };

  /* ---------------- view ---------------- */
  D.views.annexi = async function (view) {
    const runs = await D.getRuns();
    view.innerHTML =
      '<div class="page-head"><h1>Annex-I working</h1><div class="spacer"></div>' +
      '<label class="f" style="width:170px">Return period<input type="month" id="aPeriod" value="' + D.period() + '"></label>' +
      '<button class="btn primary" id="aRun" style="align-self:flex-end">Match &amp; build</button></div>' +
      '<div class="card"><div class="sub" style="margin:0">Every debit note that is not yet filed is matched against the purchase master. ' +
      'Ready notes go into the IRIS upload sheet; anything pending stays open and is picked up again next month.</div></div>' +
      '<div id="aResult"></div>' +
      '<div class="card"><h2>Previous runs</h2><div class="tbl-wrap" style="max-height:34vh"><table><thead><tr>' +
      '<th>Period</th><th>Built</th><th>Status</th><th class="num">Lines</th><th class="num">Value</th><th style="width:120px"></th>' +
      "</tr></thead><tbody>" +
      (runs.map(r => "<tr><td><b>" + D.periodLabel(r.period) + "</b></td><td>" + D.dmy(r.created_at) + "</td>" +
        '<td><span class="tag ' + (r.status === "committed" ? "filed" : "draft") + '">' + r.status + "</span></td>" +
        '<td class="num">' + (r.line_count || 0) + '</td><td class="num">' + D.money(r.total_value) + "</td>" +
        '<td><button class="btn sm danger" data-undo="' + r.id + '">Undo</button></td></tr>').join("") ||
        '<tr><td colspan="6" class="empty">No runs yet.</td></tr>') +
      "</tbody></table></div></div>";

    D.$$("[data-undo]", view).forEach(b => b.onclick = async () => {
      if (!confirm("Undo this run? The debit notes in it go back to unfiled and their invoice capacity is released.")) return;
      const lines = D.ok(await D.sb.from("annexi_lines").select("dn_id").eq("run_id", b.dataset.undo));
      const ids = Array.from(new Set(lines.map(l => l.dn_id).filter(Boolean)));
      if (ids.length) await D.setNoteStatus(ids, "printed", { filed_period: null });
      await D.deleteRun(b.dataset.undo);
      D.toast("Run undone");
      D.views.annexi(view);
    });

    D.$("#aRun").onclick = async () => {
      const btn = D.$("#aRun"); btn.disabled = true; btn.textContent = "Matching…";
      const box = D.$("#aResult");
      try {
        const period = D.$("#aPeriod").value || D.period();
        const notes = (await D.getNotes()).filter(n => n.status === "draft" || n.status === "printed");
        if (!notes.length) { box.innerHTML = '<div class="card"><div class="msg ok">Nothing pending — every debit note is already filed.</div></div>'; return; }
        const bases = Array.from(new Set(notes.flatMap(n => (n.items || []).map(i => i.invoice_base || D.invBase(i.invoice_no))).filter(Boolean)));
        const caps = await D.capacityForBases(bases);
        const res = D.matchNotes(notes, caps);
        paintResult(box, res, period, view);
      } catch (e) { box.innerHTML = '<div class="card"><div class="msg err">' + D.esc(e.message) + "</div></div>"; }
      finally { btn.disabled = false; btn.textContent = "Match & build"; }
    };
  };

  function paintResult(box, res, period, view) {
    const ready = res.filter(r => r.ready), pend = res.filter(r => !r.ready);
    const readyLines = ready.flatMap(r => r.lines);
    const val = readyLines.reduce((a, l) => a + D.num(l.value_excl), 0);
    const tax = readyLines.reduce((a, l) => a + D.num(l.sales_tax), 0);
    const pendVal = pend.reduce((a, r) => a + r.value, 0);

    box.innerHTML =
      '<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="stat b4"><div class="k">Ready notes</div><div class="v">' + ready.length + "</div>" +
      '<div class="n">' + readyLines.length + " upload lines</div></div>" +
      '<div class="stat"><div class="k">Value covered</div><div class="v">' + D.money(val, 0) + "</div></div>" +
      '<div class="stat b2"><div class="k">Sales tax</div><div class="v">' + D.money(tax, 0) + "</div></div>" +
      '<div class="stat b3"><div class="k">Pending</div><div class="v">' + pend.length + "</div>" +
      '<div class="n">' + D.money(pendVal, 0) + " carried forward</div></div></div>" +

      '<div class="card"><div class="row"><h2 style="margin:0">Result — ' + D.periodLabel(period) + "</h2>" +
      '<div class="spacer"></div>' +
      '<button class="btn" id="aXls">Download Excel (2 sheets)</button>' +
      '<button class="btn primary" id="aCommit">Commit &amp; mark filed</button></div>' +
      '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr>' +
      "<th>DN No.</th><th>Date</th><th>Supplier</th><th>Invoice No.</th><th>Ref No.</th>" +
      '<th class="num">DN qty</th><th class="num">DN value</th><th class="num">Original value</th>' +
      '<th class="num">Revised value</th><th>Status</th>' +
      "</tr></thead><tbody>" +
      res.map(r => {
        if (r.ready) return r.lines.map(l =>
          "<tr><td><b>" + D.esc(l.dn_no_display) + "</b></td><td>" + D.dmy(l.dn_date) + "</td>" +
          "<td>" + D.esc(l.supplier_name || "") + "</td>" +
          "<td>" + D.esc(l.invoice_no) + "</td><td>" + D.esc(l.inv_ref_no) + "</td>" +
          '<td class="num">' + D.qty(l.dn_qty) + '</td><td class="num">' + D.money(l.dn_value) + "</td>" +
          '<td class="num">' + D.money(l.orig_value) + '</td><td class="num">' + D.money(l.rev_value) + "</td>" +
          '<td><span class="tag ready">ready</span></td></tr>').join("");
        return '<tr class="pending"><td><b>' + D.esc(r.note.dn_no) + "</b></td><td>" + D.dmy(r.note.dn_date) + "</td>" +
          "<td>" + D.esc(r.note.supplier_name || "") + '</td><td colspan="4" style="font-size:12px">' + D.esc(r.pending_reason) + "</td>" +
          '<td class="num">' + D.money(r.value) + '</td><td class="num"></td><td><span class="tag pending">pending</span></td></tr>';
      }).join("") +
      "</tbody></table></div></div>";

    D.$("#aXls").onclick = () => exportExcel(res, period);

    D.$("#aCommit").onclick = async () => {
      if (!ready.length) return D.toast("Nothing ready to commit", "warn");
      if (!confirm("Commit " + readyLines.length + " lines for " + D.periodLabel(period) +
        "?\nThe " + ready.length + " notes involved are marked filed and their invoice capacity is locked.")) return;
      const btn = D.$("#aCommit"); btn.disabled = true; btn.textContent = "Committing…";
      try {
        const run = await D.createRun(period);
        await D.saveRunLines(run.id, readyLines.map(D.stripLine));
        await D.commitRun(run.id, period, ready.map(r => r.note.id), readyLines.length, D.round2(val));
        D.toast("Committed — " + ready.length + " notes filed for " + D.periodLabel(period));
        D.views.annexi(view);
      } catch (e) { D.toast(e.message, "err"); btn.disabled = false; btn.textContent = "Commit & mark filed"; }
    };
  }

  /* ---------------- Excel export: exactly two sheets ---------------- */
  function exportExcel(res, period) {
    const cols = columns();
    const YELLOW = { fill: { fgColor: { rgb: "FFF2CC" } } };
    const GROUP = { font: { bold: true }, alignment: { horizontal: "center" },
      fill: { fgColor: { rgb: "F2F2F2" } } };
    const HEAD = { font: { bold: true }, fill: { fgColor: { rgb: "DDEBF7" } },
      alignment: { horizontal: "center", wrapText: true } };
    const NUMERIC = ["rate_ratio", "dn_qty", "dn_value", "dn_tax", "dn_total",
      "orig_qty", "orig_value", "orig_tax", "orig_total",
      "rev_qty", "rev_value", "rev_tax", "rev_total"];

    const valueOf = (l, key) => {
      if (key === "dn_date" || key === "invoice_date") return D.dmyNum(l[key]);
      if (NUMERIC.indexOf(key) >= 0) {
        const v = l[key];
        return (v === "" || v === null || v === undefined) ? "" : D.num(v);
      }
      return l[key] === null || l[key] === undefined ? "" : l[key];
    };

    function sheet(rows, withStatus) {
      /* the label sits only on the first column of its block, as in the sample */
      const groupRow = cols.map((c, i) =>
        (c.group && (i === 0 || cols[i - 1].group !== c.group)) ? c.group : ""
      ).concat(withStatus ? ["", ""] : []);
      const headRow = cols.map(c => c.head).concat(withStatus ? ["Status", "Remarks"] : []);
      const aoa = [groupRow, headRow];
      rows.forEach(r => {
        const line = cols.map(c => valueOf(r.line, c.key));
        if (withStatus) line.push(r.status, r.remark || "");
        aoa.push(line);
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const range = XLSX.utils.decode_range(ws["!ref"]);

      /* merge the group headings across their block */
      const merges = [];
      let i = 0;
      while (i < cols.length) {
        const g = cols[i].group;
        let j = i;
        while (j + 1 < cols.length && cols[j + 1].group === g) j++;
        if (g && j > i) merges.push({ s: { r: 0, c: i }, e: { r: 0, c: j } });
        i = j + 1;
      }
      ws["!merges"] = merges;

      for (let c = range.s.c; c <= range.e.c; c++) {
        const g = ws[XLSX.utils.encode_cell({ r: 0, c: c })];
        if (g) g.s = GROUP;
        const h = ws[XLSX.utils.encode_cell({ r: 1, c: c })];
        if (h) h.s = HEAD;
      }

      rows.forEach((r, i) => {
        const rowIdx = i + 2;
        cols.forEach((col, c) => {
          const ref = XLSX.utils.encode_cell({ r: rowIdx, c: c });
          const cell = ws[ref];
          if (cell && col.fmt && typeof cell.v === "number") cell.z = col.fmt;
          if (r.status === "pending") {
            if (!ws[ref]) ws[ref] = { t: "s", v: "" };
            ws[ref].s = Object.assign({}, ws[ref].s, YELLOW);
          }
        });
        if (r.status === "pending" && withStatus) {
          for (let c = cols.length; c <= range.e.c; c++) {
            const ref = XLSX.utils.encode_cell({ r: rowIdx, c: c });
            if (!ws[ref]) ws[ref] = { t: "s", v: "" };
            ws[ref].s = Object.assign({}, ws[ref].s, YELLOW);
          }
        }
      });

      ws["!cols"] = headRow.map((h, i) => ({ wch: Math.min(Math.max(String(h).length + 4, i === 0 ? 28 : 11), 30) }));
      ws["!freeze"] = { xSplit: 0, ySplit: 2 };
      return ws;
    }

    /* sheet 1 - every debit note, pending rows highlighted */
    const allRows = [];
    res.forEach(r => {
      if (r.ready) r.lines.forEach(l => allRows.push({ line: l, status: "ready", remark: "" }));
      else {
        const its = r.note.items || [];
        const it = its[0] || {};
        const rate = D.num(it.tax_rate) || window.DN_CONFIG.DEFAULT_TAX_RATE;
        const value = D.round2(its.reduce((a, x) => a + D.num(x.value_excl), 0));
        const line = {
          supplier_name: r.note.supplier_name, supplier_ntn: r.note.supplier_ntn,
          purchase_type: "", hs_code: it.hs_code || "", inv_ref_no: "",
          dn_no_display: r.note.dn_no, dn_date: r.note.dn_date,
          invoice_no: its.map(x => x.invoice_no).filter(Boolean).join(", "),
          invoice_date: it.invoice_date, uom: it.uom || "",
          quantity: D.round4(its.reduce((a, x) => a + D.num(x.quantity), 0)),
          value_excl: value,
          sales_tax: D.round2(its.reduce((a, x) => a + D.num(x.sales_tax), 0)),
          orig_qty: "", orig_value: "",
          reason: r.note.reason === "Other" ? (r.note.reason_note || "Other") : (r.note.reason || "")
        };
        derive(line, rate);
        line.orig_tax = ""; line.orig_total = "";
        line.rev_qty = ""; line.rev_value = ""; line.rev_tax = ""; line.rev_total = "";
        allRows.push({ line: line, status: "pending", remark: r.pending_reason });
      }
    });
    const readyRows = res.filter(r => r.ready).flatMap(r => r.lines.map(l => ({ line: l, status: "ready" })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(allRows, true), "All Debit Notes");
    XLSX.utils.book_append_sheet(wb, sheet(readyRows, false), "IRIS Upload");
    XLSX.writeFile(wb, "Annex-I debit notes " + D.periodLabel(period) + ".xlsx", { bookType: "xlsx" });
  }
  D.exportAnnexiExcel = exportExcel;
})(window.DN);
