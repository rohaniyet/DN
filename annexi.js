/* ===== DN Manager - Annex-I matching engine and export ========== */
(function (D) {
  "use strict";

  const DEFAULT_COLS = [
    { key: "supplier_name",  head: "Supplier Name" },
    { key: "supplier_ntn",   head: "Supplier NTN/CNIC" },
    { key: "purchase_type",  head: "Purchase Type" },
    { key: "tax_rate",       head: "Rate" },
    { key: "hs_code",        head: "HS Code" },
    { key: "inv_ref_no",     head: "Invoice Ref No." },
    { key: "dn_no_display",  head: "Debit Note No." },
    { key: "dn_date",        head: "Debit Note Date" },
    { key: "invoice_no",     head: "Original Invoice No." },
    { key: "invoice_date",   head: "Original Invoice Date" },
    { key: "uom",            head: "UOM" },
    { key: "quantity",       head: "Quantity" },
    { key: "value_excl",     head: "Value Excluding Sales Tax" },
    { key: "sales_tax",      head: "Sales Tax" },
    { key: "reason",         head: "Reason" }
  ];
  D.ANNEXI_FIELDS = DEFAULT_COLS.map(c => c.key);

  function columns() {
    const saved = D.settings.annexi_cols;
    if (Array.isArray(saved) && saved.length) return saved;
    return DEFAULT_COLS;
  }

  const pct = (rateText, fallback) => {
    const n = parseFloat(String(rateText || "").replace(/[^0-9.]/g, ""));
    return isNaN(n) || n === 0 ? (fallback || window.DN_CONFIG.DEFAULT_TAX_RATE) : n;
  };
  const suffix = (i) => {
    if (i === 0) return "";
    let s = "", n = i;                       /* 1 -> B, 2 -> C ... 25 -> Z, 26 -> AA */
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  };

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
        let used = false;
        for (const p of parts) {
          if (remaining <= 0.01) break;
          if (p.availValue <= 0.01) continue;
          const take = D.round2(Math.min(remaining, p.availValue));
          let qty;
          if (Math.abs(take - p.availValue) < 0.01) qty = D.round4(p.availQty);
          else if (p.partValue > 0) qty = D.round4(Math.min(p.availQty, p.partQty * (take / p.partValue)));
          else qty = 0;
          const rate = pct(p.tax_rate, D.num(g.item.tax_rate));
          lines.push({
            dn_id: note.id, supplier_name: p.supplier_name || note.supplier_name,
            supplier_ntn: p.supplier_ntn || note.supplier_ntn,
            purchase_type: p.purchase_type || window.DN_CONFIG.DEFAULT_PURCHASE_TYPE,
            tax_rate: p.tax_rate || (rate + "%"), hs_code: p.hs_code || g.item.hs_code || "",
            inv_ref_no: p.ref, invoice_no: p.invoice_no, invoice_date: p.date,
            uom: p.uom || g.item.uom || "", quantity: qty, value_excl: take,
            sales_tax: D.round2(take * rate / 100),
            dn_date: note.dn_date,
            reason: note.reason === "Other" ? (note.reason_note || "Other") : (note.reason || ""),
            status: "ready"
          });
          p.availValue = D.round2(p.availValue - take);
          p.availQty = D.round4(Math.max(0, p.availQty - qty));
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
        "<td>" + '<span class="tag ' + (r.status === "committed" ? "filed" : "draft") + '">' + r.status + "</span></td>" +
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
      "<th>DN No.</th><th>Date</th><th>Supplier</th><th>Line</th><th>Invoice No.</th><th>Ref No.</th>" +
      '<th class="num">Qty</th><th class="num">Value</th><th class="num">Sales tax</th><th>Status</th>' +
      "</tr></thead><tbody>" +
      res.map(r => {
        if (r.ready) return r.lines.map(l =>
          "<tr><td><b>" + D.esc(l.dn_no_display) + "</b></td><td>" + D.dmy(l.dn_date) + "</td>" +
          "<td>" + D.esc(l.supplier_name || "") + "</td><td>" + l.seq + "</td>" +
          "<td>" + D.esc(l.invoice_no) + "</td><td>" + D.esc(l.inv_ref_no) + "</td>" +
          '<td class="num">' + D.qty(l.quantity) + '</td><td class="num">' + D.money(l.value_excl) + "</td>" +
          '<td class="num">' + D.money(l.sales_tax) + '</td><td><span class="tag ready">ready</span></td></tr>').join("");
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
        await D.saveRunLines(run.id, readyLines);
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
    const HEAD = { font: { bold: true }, fill: { fgColor: { rgb: "DDEBF7" } },
      alignment: { horizontal: "center", wrapText: true } };

    const valueOf = (l, key) => {
      switch (key) {
        case "dn_date": case "invoice_date": return D.dmy(l[key]);
        case "quantity": return D.num(l.quantity);
        case "value_excl": return D.num(l.value_excl);
        case "sales_tax": return D.num(l.sales_tax);
        default: return l[key] === null || l[key] === undefined ? "" : l[key];
      }
    };

    function sheet(rows, withStatus) {
      const header = cols.map(c => c.head).concat(withStatus ? ["Status", "Remarks"] : []);
      const aoa = [header];
      const marks = [];
      rows.forEach(r => {
        const line = cols.map(c => valueOf(r.line, c.key));
        if (withStatus) line.push(r.status, r.remark || "");
        aoa.push(line);
        marks.push(r.status === "pending");
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c: c })];
        if (cell) cell.s = HEAD;
      }
      marks.forEach((isPending, i) => {
        if (!isPending) return;
        for (let c = range.s.c; c <= range.e.c; c++) {
          const ref = XLSX.utils.encode_cell({ r: i + 1, c: c });
          if (!ws[ref]) ws[ref] = { t: "s", v: "" };
          ws[ref].s = YELLOW;
        }
      });
      ws["!cols"] = header.map(h => ({ wch: Math.min(Math.max(h.length + 3, 11), 34) }));
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
      return ws;
    }

    /* sheet 1 - every debit note, pending rows highlighted */
    const allRows = [];
    res.forEach(r => {
      if (r.ready) r.lines.forEach(l => allRows.push({ line: l, status: "ready", remark: "" }));
      else {
        const it = (r.note.items || [])[0] || {};
        allRows.push({
          status: "pending", remark: r.pending_reason,
          line: {
            supplier_name: r.note.supplier_name, supplier_ntn: r.note.supplier_ntn,
            purchase_type: "", tax_rate: "", hs_code: it.hs_code || "", inv_ref_no: "",
            dn_no_display: r.note.dn_no, dn_date: r.note.dn_date,
            invoice_no: (r.note.items || []).map(x => x.invoice_no).filter(Boolean).join(", "),
            invoice_date: it.invoice_date, uom: it.uom || "",
            quantity: (r.note.items || []).reduce((a, x) => a + D.num(x.quantity), 0),
            value_excl: r.value,
            sales_tax: (r.note.items || []).reduce((a, x) => a + D.num(x.sales_tax), 0),
            reason: r.note.reason === "Other" ? (r.note.reason_note || "Other") : (r.note.reason || "")
          }
        });
      }
    });
    const readyRows = res.filter(r => r.ready).flatMap(r => r.lines.map(l => ({ line: l, status: "ready" })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(allRows, true), "All Debit Notes");
    XLSX.utils.book_append_sheet(wb, sheet(readyRows, false), "IRIS Upload");
    XLSX.writeFile(wb, "Annex-I debit notes " + D.periodLabel(period) + ".xlsx", { bookType: "xlsx" });
  }
  D.annexiColumns = columns;
  D.ANNEXI_DEFAULT_COLS = DEFAULT_COLS;
})(window.DN);
