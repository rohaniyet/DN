/* ===== DN Manager - debit note register and entry =============== */
(function (D) {
  "use strict";

  const STATUSES = ["draft", "printed", "filed", "cancelled"];
  const tag = (s) => '<span class="tag ' + s + '">' + s + "</span>";

  /* ---------------- register ---------------- */
  D.views.notes = async function (view) {
    const notes = await D.getNotes();
    const total = (n) => (n.items || []).reduce((a, i) => a + D.num(i.value_excl), 0);
    const tax = (n) => (n.items || []).reduce((a, i) => a + D.num(i.sales_tax), 0);

    view.innerHTML =
      '<div class="page-head"><h1>Debit Notes</h1><div class="spacer"></div>' +
      '<button class="btn" id="nImport">Import old DN file</button>' +
      '<button class="btn" id="nBulk">Download selected (PDF)</button>' +
      '<button class="btn" id="nXls">Export list</button>' +
      '<button class="btn primary" id="nNew">New debit note</button></div>' +

      '<div class="card"><div class="row">' +
      '<label class="f" style="flex:1;min-width:220px">Search<input id="nQ" placeholder="DN no, supplier, invoice no, reason"></label>' +
      '<label class="f" style="width:150px">Status<select id="nSt"><option value="">All</option>' +
      STATUSES.map(s => '<option value="' + s + '">' + s + "</option>").join("") + "</select></label>" +
      '<label class="f" style="width:150px">From<input type="date" id="nFrom"></label>' +
      '<label class="f" style="width:150px">To<input type="date" id="nTo"></label>' +
      '<div class="spacer"></div><div id="nSum" class="sub" style="margin:0;text-align:right"></div></div></div>' +

      '<div class="card" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th style="width:34px"><input type="checkbox" id="nAll"></th>' +
      "<th>DN No.</th><th>Date</th><th>Supplier</th><th>Invoice(s)</th><th>Reason</th>" +
      '<th class="num">Value excl.</th><th class="num">Sales tax</th><th>Status</th><th style="width:210px"></th>' +
      '</tr></thead><tbody id="nBody"></tbody></table></div></div>';

    function filtered() {
      const q = D.norm(D.$("#nQ").value), st = D.$("#nSt").value,
        f = D.$("#nFrom").value, t = D.$("#nTo").value;
      return notes.filter(n => {
        if (st && n.status !== st) return false;
        if (f && n.dn_date < f) return false;
        if (t && n.dn_date > t) return false;
        if (!q) return true;
        const hay = D.norm(n.dn_no + n.supplier_name + n.reason + n.reason_note + n.gate_pass_no +
          (n.items || []).map(i => i.invoice_no + i.product).join(""));
        return hay.includes(q);
      });
    }

    function paint() {
      const rows = filtered();
      const v = rows.reduce((a, n) => a + total(n), 0), s = rows.reduce((a, n) => a + tax(n), 0);
      D.$("#nSum").innerHTML = "<b>" + rows.length + "</b> notes &nbsp;·&nbsp; value <b>" +
        D.money(v) + "</b> &nbsp;·&nbsp; sales tax <b>" + D.money(s) + "</b>";
      D.$("#nBody").innerHTML = rows.length ? rows.map(n => {
        const invs = D.uniqBy(n.items || [], i => i.invoice_no).map(i => i.invoice_no).filter(Boolean);
        return '<tr class="' + (n.status === "cancelled" ? "cancelled" : "") + '">' +
          '<td><input type="checkbox" class="pick" value="' + n.id + '"></td>' +
          "<td><b>" + D.esc(n.dn_no) + "</b></td><td>" + D.dmy(n.dn_date) + "</td>" +
          "<td>" + D.esc(n.supplier_name || "") + "</td>" +
          '<td style="max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + D.esc(invs.join(", ")) + '">' + D.esc(invs.join(", ")) + "</td>" +
          "<td>" + D.esc(n.reason === "Other" ? (n.reason_note || "Other") : (n.reason || "")) + "</td>" +
          '<td class="num">' + D.money(total(n)) + '</td><td class="num">' + D.money(tax(n)) + "</td>" +
          "<td>" + tag(n.status) + (n.filed_period ? '<div class="n" style="font-size:11px;color:#516475">' + D.periodLabel(n.filed_period) + "</div>" : "") + "</td>" +
          '<td><button class="btn sm" data-edit="' + n.id + '">Edit</button> ' +
          '<button class="btn sm" data-print="' + n.id + '">Print</button> ' +
          '<button class="btn sm" data-pdf="' + n.id + '">PDF</button> ' +
          '<button class="btn sm danger" data-cancel="' + n.id + '">' + (n.status === "filed" || n.status === "cancelled" ? "Cancel" : "Delete") + "</button></td></tr>";
      }).join("") : '<tr><td colspan="10" class="empty">No debit notes match.</td></tr>';

      D.$$("[data-edit]", view).forEach(b => b.onclick = () => D.go("note", b.dataset.edit));
      D.$$("[data-print]", view).forEach(b => b.onclick = async () => {
        const n = notes.find(x => x.id === b.dataset.print);
        D.printNotes([n]); await D.setNoteStatus([n.id], n.status === "draft" ? "printed" : n.status);
      });
      D.$$("[data-pdf]", view).forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = "…";
        try { await D.notesToPdf([notes.find(x => x.id === b.dataset.pdf)]); }
        catch (e) { D.toast(e.message, "err"); }
        b.disabled = false; b.textContent = "PDF";
      });
      D.$$("[data-cancel]", view).forEach(b => b.onclick = async () => {
        const n = notes.find(x => x.id === b.dataset.cancel);
        if (n.status === "draft" || n.status === "printed") {
          if (!confirm("Delete debit note " + n.dn_no + " permanently?")) return;
          await D.deleteNote(n.id); D.toast("Deleted");
        } else {
          if (!confirm("Mark debit note " + n.dn_no + " as cancelled?")) return;
          await D.setNoteStatus([n.id], "cancelled"); D.toast("Cancelled");
        }
        D.views.notes(view);
      });
      D.$("#nAll").checked = false;
    }

    ["nQ", "nSt", "nFrom", "nTo"].forEach(id => D.$("#" + id).oninput = paint);
    D.$("#nAll").onclick = (e) => D.$$(".pick", view).forEach(c => c.checked = e.target.checked);
    paint();

    D.$("#nNew").onclick = () => D.go("note", "new");
    D.$("#nImport").onclick = () => importNotes(view);

    D.$("#nBulk").onclick = async () => {
      const ids = D.$$(".pick:checked", view).map(c => c.value);
      if (!ids.length) return D.toast("Tick the debit notes you want first", "warn");
      const btn = D.$("#nBulk"); btn.disabled = true;
      try { await D.notesToPdf(notes.filter(n => ids.includes(n.id)), (i, t) => btn.textContent = "Building " + i + " / " + t); }
      catch (e) { D.toast(e.message, "err"); }
      btn.disabled = false; btn.textContent = "Download selected (PDF)";
    };

    D.$("#nXls").onclick = () => {
      const rows = filtered().map(n => ({
        "DN No": n.dn_no, "DN Date": D.dmy(n.dn_date), "Supplier": n.supplier_name, "NTN": n.supplier_ntn,
        "City": n.supplier_city, "Reason": n.reason === "Other" ? n.reason_note : n.reason,
        "Gate Pass No": n.gate_pass_no || "", "Gate Pass Date": D.dmy(n.gate_pass_date),
        "Invoices": D.uniqBy(n.items || [], i => i.invoice_no).map(i => i.invoice_no).join(", "),
        "Value excl. tax": D.round2(total(n)), "Sales tax": D.round2(tax(n)),
        "Total": D.round2(total(n) + tax(n)), "Status": n.status, "Filed in": D.periodLabel(n.filed_period)
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Debit Notes");
      XLSX.writeFile(wb, "Debit Notes " + D.today() + ".xlsx");
    };
  };

  /* ---------------- entry form ---------------- */
  D.views.note = async function (view, id) {
    const isNew = !id || id === "new";
    const reasons = await D.reasons();
    const note = isNew
      ? { dn_no: await D.nextDnNo(), dn_date: D.today(), status: "draft", items: [] }
      : await D.getNote(id);
    if (!note) throw new Error("Debit note not found");
    const items = (note.items || []).slice().sort((a, b) => (a.sr || 0) - (b.sr || 0));
    if (!items.length) items.push(blank());

    function blank() {
      return { invoice_no: "", invoice_date: null, product: "", hs_code: "", uom: "",
        quantity: 0, rate: 0, value_excl: 0, tax_rate: window.DN_CONFIG.DEFAULT_TAX_RATE, sales_tax: 0, total: 0 };
    }

    view.innerHTML =
      '<div class="page-head"><h1>' + (isNew ? "New debit note" : "Debit note " + D.esc(note.dn_no)) + "</h1>" +
      '<div class="spacer"></div><button class="btn" id="dBack">Back to register</button>' +
      '<button class="btn" id="dPrint">Print</button>' +
      '<button class="btn primary" id="dSave">Save</button></div>' +

      '<div class="card"><h2>Debit note</h2><div class="grid g4">' +
      '<label class="f">DN No.<input id="dNo" value="' + D.esc(note.dn_no) + '"></label>' +
      '<label class="f">Date<input type="date" id="dDate" value="' + (note.dn_date || D.today()) + '"></label>' +
      '<label class="f">Status<select id="dStatus">' + STATUSES.map(s =>
        '<option value="' + s + '"' + (s === note.status ? " selected" : "") + ">" + s + "</option>").join("") + "</select></label>" +
      '<label class="f">Gate Pass No.<input id="dGp" value="' + D.esc(note.gate_pass_no || "") + '"></label>' +
      "</div><div class=\"grid g4\" style=\"margin-top:12px\">" +
      '<label class="f">Supplier<input id="dSupp" autocomplete="off" value="' + D.esc(note.supplier_name || "") + '" placeholder="Type to search"></label>' +
      '<label class="f">NTN / CNIC<input id="dNtn" value="' + D.esc(note.supplier_ntn || "") + '"></label>' +
      '<label class="f">City<input id="dCity" value="' + D.esc(note.supplier_city || "") + '"></label>' +
      '<label class="f">Gate Pass Date<input type="date" id="dGpd" value="' + (note.gate_pass_date || "") + '"></label>' +
      "</div><div class=\"grid g3\" style=\"margin-top:12px\">" +
      '<label class="f">Reason<select id="dReason"><option value="">— select —</option>' +
      reasons.map(r => '<option value="' + D.esc(r.label) + '"' + (r.label === note.reason ? " selected" : "") + ">" + D.esc(r.label) + "</option>").join("") +
      "</select></label>" +
      '<label class="f">Reason detail (used when Reason is “Other”)<input id="dReasonNote" value="' + D.esc(note.reason_note || "") + '"></label>' +
      '<label class="f">Remarks<input id="dRemarks" value="' + D.esc(note.remarks || "") + '"></label>' +
      "</div></div>" +

      '<div class="card"><h2>Items</h2>' +
      '<div class="sub">Type the invoice number to search the purchase master — picking a row fills the date, product, UOM and HS code. Enter a rate to get the value, or a value to get the rate.</div>' +
      '<div class="tbl-wrap" style="max-height:none;overflow:visible"><table class="items"><thead><tr>' +
      '<th style="width:30px">#</th><th style="min-width:180px">Invoice No.</th><th style="width:120px">Inv. date</th>' +
      '<th style="min-width:150px">Product</th><th style="width:110px">HS Code</th><th style="width:90px">UOM</th>' +
      '<th style="width:100px">Qty</th><th style="width:110px">Rate</th><th style="width:130px">Value excl.</th>' +
      '<th style="width:70px">Tax %</th><th style="width:120px">Sales tax</th><th style="width:130px">Total</th><th style="width:36px"></th>' +
      '</tr></thead><tbody id="dItems"></tbody>' +
      '<tfoot><tr><th colspan="8" style="text-align:right">Totals</th>' +
      '<th class="num" id="tVal"></th><th></th><th class="num" id="tTax"></th><th class="num" id="tTot"></th><th></th></tr></tfoot>' +
      "</table></div>" +
      '<button class="btn sm" id="dAdd" style="margin-top:10px">+ Add row</button>' +
      '<div id="dWords" class="sub" style="margin-top:10px"></div></div>';

    D.$("#dBack").onclick = () => D.go("notes");

    /* supplier typeahead */
    D.typeahead(D.$("#dSupp"), D.supplierSearch,
      (s) => {
        D.$("#dSupp").value = s.name;
        D.$("#dNtn").value = s.ntn || "";
        D.$("#dCity").value = s.city || "";
        D.$("#dSupp").dataset.id = s.id;
      },
      (s) => "<b>" + D.esc(s.name) + "</b><small>" + D.esc(s.ntn || "no NTN") + (s.city ? " · " + D.esc(s.city) : "") + "</small>");
    if (note.supplier_id) D.$("#dSupp").dataset.id = note.supplier_id;

    /* ----- items grid ----- */
    function rowHtml(it, i) {
      return "<tr data-i=\"" + i + '"><td class="num">' + (i + 1) + "</td>" +
        '<td><input data-f="invoice_no" autocomplete="off" value="' + D.esc(it.invoice_no || "") + '"></td>' +
        '<td><input type="date" data-f="invoice_date" value="' + (it.invoice_date || "") + '"></td>' +
        '<td><input data-f="product" value="' + D.esc(it.product || "") + '"></td>' +
        '<td><input data-f="hs_code" value="' + D.esc(it.hs_code || "") + '"></td>' +
        '<td><input data-f="uom" value="' + D.esc(it.uom || "") + '"></td>' +
        '<td><input class="num" data-f="quantity" value="' + (D.num(it.quantity) || "") + '"></td>' +
        '<td><input class="num" data-f="rate" value="' + (D.num(it.rate) || "") + '"></td>' +
        '<td><input class="num" data-f="value_excl" value="' + (D.num(it.value_excl) || "") + '"></td>' +
        '<td><input class="num" data-f="tax_rate" value="' + (D.num(it.tax_rate) || 0) + '"></td>' +
        '<td><input class="num" data-f="sales_tax" value="' + (D.num(it.sales_tax) || "") + '"></td>' +
        '<td class="num" data-total>' + D.money(it.total) + "</td>" +
        '<td><button class="btn sm danger" data-rm="' + i + '">×</button></td></tr>';
    }

    function recalc(i, changed) {
      const it = items[i];
      if (changed === "quantity" || changed === "rate") it.value_excl = D.round2(D.num(it.quantity) * D.num(it.rate));
      else if (changed === "value_excl" && D.num(it.quantity)) it.rate = D.round4(D.num(it.value_excl) / D.num(it.quantity));
      if (changed !== "sales_tax") it.sales_tax = D.round2(D.num(it.value_excl) * D.num(it.tax_rate) / 100);
      it.total = D.round2(D.num(it.value_excl) + D.num(it.sales_tax));
    }

    function totals() {
      const v = items.reduce((a, i) => a + D.num(i.value_excl), 0);
      const t = items.reduce((a, i) => a + D.num(i.sales_tax), 0);
      D.$("#tVal").textContent = D.money(v);
      D.$("#tTax").textContent = D.money(t);
      D.$("#tTot").textContent = D.money(v + t);
      D.$("#dWords").innerHTML = "<b>Amount in words:</b> " + D.esc(D.words(v + t));
    }

    function paintItems() {
      D.$("#dItems").innerHTML = items.map(rowHtml).join("");
      D.$$("#dItems tr").forEach(tr => {
        const i = +tr.dataset.i;
        D.$$("input", tr).forEach(inp => {
          inp.oninput = () => {
            const f = inp.dataset.f;
            items[i][f] = (f === "invoice_date") ? (inp.value || null)
              : ["quantity", "rate", "value_excl", "tax_rate", "sales_tax"].includes(f) ? D.num(inp.value) : inp.value;
            if (f === "invoice_no") items[i].invoice_base = D.invBase(inp.value);
            recalc(i, f);
            const tr2 = D.$('#dItems tr[data-i="' + i + '"]');
            D.$("[data-f=value_excl]", tr2).value = D.num(items[i].value_excl) || "";
            D.$("[data-f=rate]", tr2).value = D.num(items[i].rate) || "";
            D.$("[data-f=sales_tax]", tr2).value = D.num(items[i].sales_tax) || "";
            D.$("[data-total]", tr2).textContent = D.money(items[i].total);
            totals();
          };
        });
        /* invoice typeahead against the purchase master */
        D.typeahead(D.$("[data-f=invoice_no]", tr), D.searchMaster,
          (m) => {
            const it = items[i];
            it.invoice_no = m.invoice_no; it.invoice_base = m.invoice_base;
            it.invoice_date = m.invoice_date; it.uom = m.uom || it.uom;
            it.product = m.product || it.product; it.hs_code = m.hs_code || it.hs_code;
            if (!D.num(it.quantity) && !D.num(it.value_excl)) { /* leave blank - he types the debited part */ }
            paintItems(); totals();
            if (!D.$("#dSupp").value && m.supplier_name) {
              D.$("#dSupp").value = m.supplier_name;
              D.$("#dNtn").value = m.supplier_ntn || "";
            }
          },
          (m) => "<b>" + D.esc(m.invoice_no) + "</b><small>" + D.dmy(m.invoice_date) + " · " +
            D.esc(m.supplier_name || "") + " · available " + D.money(m.avail_value) + "</small>");
        D.$("[data-rm=\"" + i + '"]', tr).onclick = () => {
          items.splice(i, 1); if (!items.length) items.push(blank()); paintItems(); totals();
        };
      });
      totals();
    }
    paintItems();
    D.$("#dAdd").onclick = () => { items.push(blank()); paintItems(); };

    function collect() {
      return {
        head: {
          id: note.id, dn_no: D.$("#dNo").value.trim(), dn_date: D.$("#dDate").value || D.today(),
          supplier_id: D.$("#dSupp").dataset.id || null,
          supplier_name: D.$("#dSupp").value.trim(), supplier_ntn: D.$("#dNtn").value.trim(),
          supplier_city: D.$("#dCity").value.trim(), reason: D.$("#dReason").value,
          reason_note: D.$("#dReasonNote").value.trim(), gate_pass_no: D.$("#dGp").value.trim(),
          gate_pass_date: D.$("#dGpd").value || null, remarks: D.$("#dRemarks").value.trim(),
          status: D.$("#dStatus").value, filed_period: note.filed_period || null
        },
        items: items.filter(i => i.invoice_no || D.num(i.value_excl))
      };
    }

    D.$("#dSave").onclick = async () => {
      const { head, items: rows } = collect();
      if (!head.dn_no) return D.toast("DN number is required", "err");
      if (!head.supplier_name) return D.toast("Supplier is required", "err");
      if (!rows.length) return D.toast("Add at least one item line", "err");
      const btn = D.$("#dSave"); btn.disabled = true; btn.textContent = "Saving…";
      try {
        const saved = await D.saveNote(head, rows);
        D.toast("Debit note " + saved.dn_no + " saved");
        D.go("notes");
      } catch (e) {
        D.toast(e.message.includes("duplicate") ? "DN number " + head.dn_no + " already exists" : e.message, "err");
        btn.disabled = false; btn.textContent = "Save";
      }
    };

    D.$("#dPrint").onclick = () => {
      const { head, items: rows } = collect();
      D.printNotes([Object.assign({}, head, { items: rows })]);
    };
  };

  /* ---------------- backfill import of old DN files ---------------- */
  const DN_FIELDS = [
    { key: "dn_no",         label: "DN No.",        req: true,  syn: ["Dr Note No", "DN No", "Debit Note No", "Note No", "DN #", "Debit Note Number"] },
    { key: "dn_date",       label: "DN Date",       req: false, syn: ["Dr Note Date", "DN Date", "Debit Note Date", "Date"] },
    { key: "supplier_name", label: "Supplier",      req: false, syn: ["Supplier Name", "Party Name", "Supplier", "Name"] },
    { key: "supplier_ntn",  label: "NTN",           req: false, syn: ["NTN", "Supplier NTN", "NTN/CNIC"] },
    { key: "invoice_no",    label: "Invoice No.",   req: false, syn: ["Invoice No", "Bill No", "Inv No", "Original Invoice No"] },
    { key: "invoice_date",  label: "Invoice Date",  req: false, syn: ["Invoice Date", "Bill Date", "Original Invoice Date"] },
    { key: "product",       label: "Product",       req: false, syn: ["Description", "Product", "Item", "Particulars"] },
    { key: "hs_code",       label: "HS Code",       req: false, syn: ["HS Code", "HSCode"] },
    { key: "uom",           label: "UOM",           req: false, syn: ["UOM", "Unit"] },
    { key: "quantity",      label: "Qty",           req: false, syn: ["Quantity", "Qty"] },
    { key: "rate",          label: "Rate",          req: false, syn: ["Rate", "Price"] },
    { key: "value_excl",    label: "Value excl.",   req: true,  syn: ["Value Excluding Sales Tax", "Taxable Value", "Amount", "Value", "Ex Tax Value"] },
    { key: "tax_rate",      label: "Tax %",         req: false, syn: ["Tax Rate", "ST Rate", "GST %"] },
    { key: "sales_tax",     label: "Sales tax",     req: false, syn: ["Sales Tax", "ST Amount", "GST"] },
    { key: "reason",        label: "Reason",        req: false, syn: ["Reason", "Remarks", "Narration"] },
    { key: "gate_pass_no",  label: "Gate Pass No.", req: false, syn: ["Gate Pass No", "GP No", "Gate Pass"] },
    { key: "gate_pass_date",label: "Gate Pass Date",req: false, syn: ["Gate Pass Date", "GP Date"] }
  ];

  const REASON_MAP = [
    [/rej(e|a)ct/i, "Material Rejected"], [/low\s*qual|quality/i, "Low Quality"],
    [/rate\s*(diff|defer|differ)/i, "Rate Difference"], [/wrong\s*(inv|bill)/i, "Wrong Invoice"],
    [/short\s*(receipt|recv|received|supply)/i, "Short Receipt"]
  ];
  function normaliseReason(text) {
    const t = String(text || "").trim();
    if (!t) return { reason: "", note: "" };
    for (const [re, label] of REASON_MAP) if (re.test(t)) return { reason: label, note: t };
    return { reason: "Other", note: t };
  }
  function pullGatePass(text) {
    const s = String(text || "");
    const no = s.match(/G\.?\s*P\.?\s*(?:PASS)?\s*#?\s*[-:]?\s*([A-Z0-9\-\/]{3,})/i);
    const dt = s.match(/DATED?\s+([0-9]{1,2}[-\/][A-Za-z0-9]{2,}[-\/][0-9]{2,4})/i);
    return { no: no ? no[1].replace(/^-+/, "") : "", date: dt ? D.toDate(dt[1]) : null };
  }

  function importNotes(view) {
    D.modal.open("Import old debit notes (backfill)",
      '<div class="msg warn">Rows are grouped by <b>DN No.</b> — several rows with the same DN number become one debit note with several item lines. A DN number that already exists is skipped.</div>' +
      '<label class="f" style="margin-top:14px">DN file (Excel)<input type="file" id="iFile" accept=".xlsx,.xls,.csv"></label>' +
      '<div id="iStep" style="margin-top:14px"></div>',
      '<button class="btn" data-close>Cancel</button><button class="btn primary" id="iRun" disabled>Import</button>');

    let parsed = null;
    D.$("#iFile").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const box = D.$("#iStep"); box.innerHTML = '<div class="empty">Reading…</div>';
      let sheets;
      try { sheets = await D.readSheet(file); } catch (err) { box.innerHTML = '<div class="msg err">' + D.esc(err.message) + "</div>"; return; }
      const useful = sheets.filter(s => s.aoa.length > 1);
      box.innerHTML = '<div class="row"><label class="f" style="min-width:220px">Sheet<select id="iSheet">' +
        useful.map((s, i) => '<option value="' + i + '">' + D.esc(s.name) + " (" + (s.aoa.length - 1) + " rows)</option>").join("") +
        '</select></label><label class="f" style="width:150px">Header row<input type="number" id="iHdr" min="1" value="1"></label></div>' +
        '<div id="iMap" style="margin-top:12px"></div>';

      const draw = () => {
        const sh = useful[+D.$("#iSheet").value];
        const hdrIdx = Math.max(0, (+D.$("#iHdr").value || 1) - 1);
        const { headers, rows } = D.aoaToObjects(sh.aoa, hdrIdx);
        const saved = D.settings.dn_map || {};
        parsed = { headers, rows, map: {} };
        D.$("#iMap").innerHTML = '<div class="sub">' + rows.length + " rows found. Check the mapping:</div>" +
          '<div class="grid g3">' + DN_FIELDS.map(f => {
            const guess = (saved[f.key] && headers.includes(saved[f.key])) ? saved[f.key] : D.guessColumn(headers, f.syn);
            parsed.map[f.key] = guess;
            return '<label class="f">' + D.esc(f.label) + (f.req ? " *" : "") +
              '<select data-imap="' + f.key + '"><option value="">— none —</option>' +
              headers.map(h => '<option value="' + D.esc(h) + '"' + (h === guess ? " selected" : "") + ">" + D.esc(h) + "</option>").join("") +
              "</select></label>";
          }).join("") + "</div>";
        D.$$("[data-imap]").forEach(s => s.onchange = () => parsed.map[s.dataset.imap] = s.value);
        D.$("#iRun").disabled = false;
      };
      D.$("#iSheet").onchange = draw; D.$("#iHdr").onchange = draw; draw();
    };

    D.$("#iRun").onclick = async () => {
      if (!parsed) return;
      const miss = DN_FIELDS.filter(f => f.req && !parsed.map[f.key]);
      if (miss.length) return D.toast("Map these first: " + miss.map(f => f.label).join(", "), "err");
      const btn = D.$("#iRun"); btn.disabled = true; btn.textContent = "Importing…";
      const g = (row, key) => { const c = parsed.map[key]; return c ? row[c] : ""; };
      try {
        const existing = new Set((await D.all("debit_notes", "dn_no")).map(n => String(n.dn_no).trim()));
        const groups = new Map(); let lastNo = "";
        parsed.rows.forEach(row => {
          let no = String(g(row, "dn_no") || "").trim();
          if (!no) no = lastNo; else lastNo = no;
          if (!no) return;
          const raw = String(g(row, "reason") || "");
          const rn = normaliseReason(raw), gp = pullGatePass(raw);
          if (!groups.has(no)) groups.set(no, {
            head: {
              dn_no: no, dn_date: D.toDate(g(row, "dn_date")) || D.today(),
              supplier_name: String(g(row, "supplier_name") || "").trim(),
              supplier_ntn: String(g(row, "supplier_ntn") || "").trim(),
              reason: rn.reason, reason_note: rn.note,
              gate_pass_no: String(g(row, "gate_pass_no") || "").trim() || gp.no,
              gate_pass_date: D.toDate(g(row, "gate_pass_date")) || gp.date,
              status: "draft"
            }, items: []
          });
          const grp = groups.get(no);
          const inv = String(g(row, "invoice_no") || "").trim();
          const val = D.round2(g(row, "value_excl"));
          const qty = D.round4(g(row, "quantity"));
          if (!inv && !val) return;
          const taxRate = D.num(g(row, "tax_rate")) || window.DN_CONFIG.DEFAULT_TAX_RATE;
          const st = D.num(g(row, "sales_tax")) || D.round2(val * taxRate / 100);
          grp.items.push({
            invoice_no: inv, invoice_base: D.invBase(inv), invoice_date: D.toDate(g(row, "invoice_date")),
            product: String(g(row, "product") || "").trim(), hs_code: String(g(row, "hs_code") || "").trim(),
            uom: String(g(row, "uom") || "").trim(), quantity: qty,
            rate: D.num(g(row, "rate")) || (qty ? D.round4(val / qty) : 0),
            value_excl: val, tax_rate: taxRate, sales_tax: st, total: D.round2(val + st)
          });
        });

        let added = 0, skipped = 0;
        for (const [no, grp] of groups) {
          if (existing.has(no)) { skipped++; continue; }
          if (!grp.items.length) { skipped++; continue; }
          await D.saveNote(grp.head, grp.items);
          added++;
          btn.textContent = "Importing " + added + " / " + groups.size;
        }
        await D.saveSettings({ dn_map: parsed.map });
        D.modal.close();
        D.toast(added + " debit notes imported" + (skipped ? ", " + skipped + " skipped (already on file or empty)" : ""));
        D.views.notes(view);
      } catch (e) {
        btn.disabled = false; btn.textContent = "Import";
        D.toast(e.message, "err");
      }
    };
  }
})(window.DN);
