/* ===== DN Manager - FBR purchase master (Annex-A) =============== */
(function (D) {
  "use strict";

  const FIELDS = [
    { key: "inv_ref_no",    label: "Invoice Ref No.",   req: true,  syn: ["Invoice Ref No", "Inv Ref No", "Reference No", "Invoice Reference", "Ref No", "InvoiceRefNo"] },
    { key: "invoice_no",    label: "Invoice No.",       req: true,  syn: ["Invoice No", "Bill No", "Document No", "Invoice Number", "Sales Tax Invoice No"] },
    { key: "invoice_date",  label: "Invoice Date",      req: false, syn: ["Invoice Date", "Bill Date", "Doc Date", "Date of Invoice", "Date"] },
    { key: "supplier_name", label: "Supplier Name",     req: false, syn: ["Supplier Name", "Seller Name", "Name of Supplier", "Supplier", "Seller Business Name"] },
    { key: "supplier_ntn",  label: "Supplier NTN/CNIC", req: false, syn: ["Supplier NTN", "Seller NTN", "NTN/CNIC", "NTN", "Registration No", "Seller Registration No"] },
    { key: "purchase_type", label: "Purchase Type",     req: false, syn: ["Purchase Type", "Sale Type", "Type of Purchase", "Nature"] },
    { key: "hs_code",       label: "HS Code",           req: false, syn: ["HS Code", "HSCode", "HS Codes", "Item HS Code"] },
    { key: "product",       label: "Product / Item",    req: false, syn: ["Product Description", "Description", "Item", "Product", "Goods Description"] },
    { key: "uom",           label: "UOM",               req: false, syn: ["UOM", "Unit of Measure", "Unit", "UoM"] },
    { key: "quantity",      label: "Quantity",          req: false, syn: ["Quantity", "Qty", "Quantity / Electricity Units", "Qty."] },
    { key: "value_excl",    label: "Value excl. tax",   req: true,  syn: ["Value Excluding Sales Tax", "Value of Sales Excluding Sales Tax", "Taxable Value", "Value Excl Sales Tax", "Value Excluding Tax", "Amount Excluding Sales Tax", "Value"] },
    { key: "tax_rate",      label: "Tax rate",          req: false, syn: ["Rate", "Sales Tax Rate", "Tax Rate", "GST Rate"] },
    { key: "sales_tax",     label: "Sales tax",         req: false, syn: ["Sales Tax", "Sales Tax / FED in ST Mode", "ST Amount", "Sales Tax Amount", "GST"] }
  ];

  D.views.master = async function (view) {
    const stats = await D.masterStats();
    view.innerHTML =
      '<div class="page-head"><h1>Purchase Master</h1><div class="spacer"></div>' +
      '<button class="btn primary" id="mImport">Import Annex-A file</button></div>' +
      '<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="stat"><div class="k">Invoice parts on file</div><div class="v">' + stats.total.toLocaleString("en-PK") + "</div></div>" +
      '<div class="stat b2"><div class="k">Periods loaded</div><div class="v">' + stats.periods.length + "</div>" +
      '<div class="n">' + (stats.periods.length ? D.periodLabel(stats.periods[stats.periods.length - 1].period) + " → " + D.periodLabel(stats.periods[0].period) : "—") + "</div></div>" +
      '<div class="stat b4"><div class="k">Total value excl. tax</div><div class="v">' +
        D.money(stats.periods.reduce((a, b) => a + b.value, 0), 0) + "</div></div>" +
      '<div class="stat b3"><div class="k">Latest period</div><div class="v">' +
        (stats.periods[0] ? D.periodLabel(stats.periods[0].period) : "—") + "</div>" +
      '<div class="n">' + (stats.periods[0] ? stats.periods[0].rows + " rows" : "") + "</div></div></div>" +

      '<div class="card"><h2>Search invoices</h2>' +
      '<div class="sub">Type an invoice number, reference or supplier. Available value is what is still left to debit on that part.</div>' +
      '<label class="f" style="max-width:420px"><input id="mQ" placeholder="e.g. 3953 or 0688329DIFYTG6F143552"></label>' +
      '<div class="tbl-wrap" style="margin-top:12px;max-height:52vh"><table><thead><tr>' +
      "<th>Invoice No.</th><th>Ref No.</th><th>Date</th><th>Supplier</th><th>UOM</th>" +
      '<th class="num">Qty</th><th class="num">Value</th><th class="num">Used</th><th class="num">Available</th>' +
      '</tr></thead><tbody id="mBody"><tr><td colspan="9" class="empty">Start typing to search.</td></tr></tbody></table></div></div>' +

      '<div class="card"><h2>Periods loaded</h2><div class="tbl-wrap" style="max-height:36vh"><table><thead><tr>' +
      '<th>Period</th><th class="num">Rows</th><th class="num">Value excl. tax</th></tr></thead><tbody>' +
      (stats.periods.map(p => "<tr><td>" + D.periodLabel(p.period) + '</td><td class="num">' + p.rows +
        '</td><td class="num">' + D.money(p.value) + "</td></tr>").join("") ||
        '<tr><td colspan="3" class="empty">Nothing imported yet.</td></tr>') +
      "</tbody></table></div></div>";

    D.$("#mQ").oninput = D.debounce(async () => {
      const rows = await D.searchMaster(D.$("#mQ").value);
      D.$("#mBody").innerHTML = rows.length ? rows.map(r =>
        "<tr><td><b>" + D.esc(r.invoice_no) + "</b></td><td>" + D.esc(r.inv_ref_no) + "</td>" +
        "<td>" + D.dmy(r.invoice_date) + "</td><td>" + D.esc(r.supplier_name || "") + "</td>" +
        "<td>" + D.esc(r.uom || "") + '</td><td class="num">' + D.qty(r.quantity) + '</td>' +
        '<td class="num">' + D.money(r.value_excl) + '</td><td class="num">' + D.money(r.used_value) + '</td>' +
        '<td class="num"><b>' + D.money(r.avail_value) + "</b></td></tr>").join("")
        : '<tr><td colspan="9" class="empty">No match.</td></tr>';
    }, 300);

    D.$("#mImport").onclick = () => importWizard(view);
  };

  /* ---------------- import wizard ---------------- */
  function importWizard(view) {
    D.modal.open("Import Annex-A purchase data",
      '<div class="msg warn">Rows are matched on <b>Invoice Ref No.</b> — anything already on file is refreshed, only genuinely new invoice parts are added. Upload the same file every month, nothing gets duplicated.</div>' +
      '<label class="f" style="margin-top:14px">Excel or CSV file<input type="file" id="mFile" accept=".xlsx,.xls,.csv"></label>' +
      '<div id="mStep2" style="margin-top:14px"></div>',
      '<button class="btn" data-close>Cancel</button><button class="btn primary" id="mRun" disabled>Import</button>');

    let parsed = null;
    D.$("#mFile").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const box = D.$("#mStep2");
      box.innerHTML = '<div class="empty">Reading…</div>';
      let sheets;
      try { sheets = await D.readSheet(file); }
      catch (err) { box.innerHTML = '<div class="msg err">' + D.esc(err.message) + "</div>"; return; }
      const useful = sheets.filter(s => s.aoa.length > 1);
      if (!useful.length) { box.innerHTML = '<div class="msg err">No data rows found in this file.</div>'; return; }

      box.innerHTML =
        '<div class="row"><label class="f" style="min-width:220px">Sheet<select id="mSheet">' +
        useful.map((s, i) => '<option value="' + i + '">' + D.esc(s.name) + " (" + (s.aoa.length - 1) + " rows)</option>").join("") +
        "</select></label>" +
        '<label class="f" style="width:150px">Header row<input type="number" id="mHdr" min="1" value="1"></label></div>' +
        '<div id="mMap" style="margin-top:12px"></div>';

      const drawMapping = () => {
        const sh = useful[+D.$("#mSheet").value];
        const hdrIdx = Math.max(0, (+D.$("#mHdr").value || 1) - 1);
        const { headers, rows } = D.aoaToObjects(sh.aoa, hdrIdx);
        const saved = D.settings.master_map || {};
        parsed = { headers, rows, map: {} };
        D.$("#mMap").innerHTML =
          '<div class="sub">' + rows.length + " data rows found. Check the column mapping:</div>" +
          '<div class="grid g2">' + FIELDS.map(f => {
            const guess = (saved[f.key] && headers.includes(saved[f.key])) ? saved[f.key] : D.guessColumn(headers, f.syn);
            parsed.map[f.key] = guess;
            return '<label class="f">' + D.esc(f.label) + (f.req ? " *" : "") +
              '<select data-map="' + f.key + '"><option value="">— not in file —</option>' +
              headers.map(h => '<option value="' + D.esc(h) + '"' + (h === guess ? " selected" : "") + ">" + D.esc(h) + "</option>").join("") +
              "</select></label>";
          }).join("") + "</div>";
        D.$$("[data-map]").forEach(s => s.onchange = () => { parsed.map[s.dataset.map] = s.value; });
        D.$("#mRun").disabled = false;
      };
      D.$("#mSheet").onchange = drawMapping;
      D.$("#mHdr").onchange = drawMapping;
      drawMapping();
    };

    D.$("#mRun").onclick = async () => {
      if (!parsed) return;
      const missing = FIELDS.filter(f => f.req && !parsed.map[f.key]);
      if (missing.length) return D.toast("Map these first: " + missing.map(f => f.label).join(", "), "err");

      const btn = D.$("#mRun"); btn.disabled = true; btn.textContent = "Importing…";
      const g = (row, key) => { const c = parsed.map[key]; return c ? row[c] : ""; };
      const seen = new Set(); const recs = [];
      parsed.rows.forEach(row => {
        const ref = String(g(row, "inv_ref_no") || "").trim();
        const inv = String(g(row, "invoice_no") || "").trim();
        if (!ref || seen.has(ref)) return;
        seen.add(ref);
        const date = D.toDate(g(row, "invoice_date"));
        recs.push({
          inv_ref_no: ref, invoice_no: inv,
          invoice_base: D.invBase(inv), part_no: D.invPart(inv),
          invoice_date: date,
          supplier_name: String(g(row, "supplier_name") || "").trim(),
          supplier_ntn: String(g(row, "supplier_ntn") || "").trim(),
          purchase_type: String(g(row, "purchase_type") || "").trim(),
          hs_code: String(g(row, "hs_code") || "").trim(),
          product: String(g(row, "product") || "").trim(),
          uom: String(g(row, "uom") || "").trim(),
          quantity: D.round4(g(row, "quantity")),
          value_excl: D.round2(g(row, "value_excl")),
          tax_rate: String(g(row, "tax_rate") || "").trim(),
          sales_tax: D.round2(g(row, "sales_tax")),
          period: date ? date.slice(0, 7) : null
        });
      });
      if (!recs.length) { btn.disabled = false; btn.textContent = "Import"; return D.toast("No usable rows found", "err"); }
      try {
        await D.saveSettings({ master_map: parsed.map });
        await D.importMaster(recs, (done, total) => { btn.textContent = "Importing " + done + " / " + total; });
        D.modal.close();
        D.toast(recs.length.toLocaleString("en-PK") + " invoice parts imported / refreshed");
        D.views.master(view);
      } catch (e) {
        btn.disabled = false; btn.textContent = "Import";
        D.toast(e.message, "err");
      }
    };
  }
})(window.DN);
