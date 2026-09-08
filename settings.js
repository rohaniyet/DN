/* ===== DN Manager - settings ==================================== */
(function (D) {
  "use strict";
  const CO = window.DN_CONFIG.COMPANY;

  D.views.settings = async function (view) {
    const reasons = await D.getReasons();
    const cols = D.annexiColumns();

    view.innerHTML =
      '<div class="page-head"><h1>Settings</h1></div>' +

      '<div class="card"><h2>Annex-I upload template</h2>' +
      '<div class="sub">Upload your IRIS “sample table” once — the app copies its exact column headings and uses them for every Annex-I export. ' +
      "Then check that each heading points at the right field.</div>" +
      '<label class="f" style="max-width:420px">Sample table (Excel)<input type="file" id="tFile" accept=".xlsx,.xls,.csv"></label>' +
      '<div id="tMap" style="margin-top:14px"></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="tSave">Save template</button>' +
      '<button class="btn" id="tReset">Reset to default</button></div></div>' +

      '<div class="card"><h2>Numbering</h2>' +
      '<div class="sub">The next debit note number is the highest one on file plus 1. If nothing is on file yet, this is where it starts.</div>' +
      '<div class="row"><label class="f" style="width:200px">Starting DN number' +
      '<input id="sStart" value="' + D.esc(D.settings.start_dn_no || "") + '" placeholder="e.g. 3990"></label>' +
      '<button class="btn" id="sStartSave" style="align-self:flex-end">Save</button></div></div>' +

      '<div class="card"><h2>Reasons</h2>' +
      '<div class="sub">These fill the reason dropdown on the debit note form.</div>' +
      '<div class="tbl-wrap" style="max-height:34vh"><table><thead><tr><th>Reason</th><th style="width:100px">Order</th>' +
      '<th style="width:110px"></th></tr></thead><tbody id="rBody">' +
      reasons.map(r => '<tr><td>' + D.esc(r.label) + '</td><td class="num">' + r.sort_order + "</td>" +
        '<td><button class="btn sm danger" data-rdel="' + r.id + '">Remove</button></td></tr>').join("") +
      "</tbody></table></div>" +
      '<div class="row" style="margin-top:12px"><label class="f" style="width:280px">New reason<input id="rNew"></label>' +
      '<button class="btn" id="rAdd" style="align-self:flex-end">Add</button></div></div>' +

      '<div class="card"><h2>Company on the printed note</h2>' +
      '<div class="sub">Fixed for this installation — change it in <code>config.js</code> in the repository if it ever needs editing.</div>' +
      '<table style="max-width:620px"><tbody>' +
      "<tr><th>Name</th><td>" + D.esc(CO.name) + "</td></tr>" +
      "<tr><th>Address</th><td>" + D.esc(CO.address) + "</td></tr>" +
      "<tr><th>Phone</th><td>" + D.esc(CO.phone) + "</td></tr>" +
      "<tr><th>STRN</th><td>" + D.esc(CO.strn) + "</td></tr>" +
      "<tr><th>NTN</th><td>" + D.esc(CO.ntn) + "</td></tr>" +
      "<tr><th>Heading</th><td>" + D.esc(CO.title) + "</td></tr>" +
      "</tbody></table></div>";

    /* ----- annex-I template ----- */
    let draft = cols.slice();
    function drawMap() {
      D.$("#tMap").innerHTML = '<div class="grid g3">' + draft.map((c, i) =>
        '<label class="f">' + D.esc(c.head) +
        '<select data-col="' + i + '">' +
        D.ANNEXI_DEFAULT_COLS.map(f => '<option value="' + f.key + '"' + (f.key === c.key ? " selected" : "") + ">" + D.esc(f.head) + "</option>").join("") +
        '<option value=""' + (c.key ? "" : " selected") + ">— leave blank —</option></select></label>").join("") + "</div>";
      D.$$("[data-col]").forEach(s => s.onchange = () => draft[+s.dataset.col].key = s.value);
    }
    drawMap();

    D.$("#tFile").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const sheets = await D.readSheet(file);
        const sh = sheets.find(s => s.aoa.length) || sheets[0];
        const hdrIdx = D.headerRowIndex(sh.aoa);
        const heads = (sh.aoa[hdrIdx] || []).map(h => String(h).trim()).filter(Boolean);
        if (!heads.length) return D.toast("No headings found in that file", "err");
        draft = heads.map(h => ({ head: h, key: guessKey(h) }));
        drawMap();
        D.toast(heads.length + " headings read — check the mapping, then Save template");
      } catch (err) { D.toast(err.message, "err"); }
    };
    function guessKey(head) {
      const f = D.ANNEXI_DEFAULT_COLS.find(x => D.norm(x.head) === D.norm(head));
      if (f) return f.key;
      const syn = {
        supplier_name: ["supplier", "seller", "name"], supplier_ntn: ["ntn", "cnic", "registration"],
        purchase_type: ["purchase type", "sale type", "type"], tax_rate: ["rate"],
        hs_code: ["hs"], inv_ref_no: ["ref"], dn_no_display: ["debit note no", "dr note", "note no", "credit note no"],
        dn_date: ["debit note date", "dr note date", "note date"], invoice_no: ["invoice no", "original invoice", "document no"],
        invoice_date: ["invoice date", "doc date"], uom: ["uom", "unit"], quantity: ["quantity", "qty"],
        value_excl: ["value", "taxable"], sales_tax: ["sales tax", "st amount"], reason: ["reason", "remark"]
      };
      const h = D.norm(head);
      for (const k in syn) if (syn[k].some(s => h.includes(D.norm(s)))) return k;
      return "";
    }
    D.$("#tSave").onclick = async () => {
      await D.saveSettings({ annexi_cols: draft });
      D.toast("Annex-I template saved");
    };
    D.$("#tReset").onclick = async () => {
      await D.saveSettings({ annexi_cols: null });
      draft = D.ANNEXI_DEFAULT_COLS.slice(); drawMap();
      D.toast("Template reset to default");
    };

    /* ----- numbering ----- */
    D.$("#sStartSave").onclick = async () => {
      await D.saveSettings({ start_dn_no: D.$("#sStart").value.trim() });
      D.toast("Saved");
    };

    /* ----- reasons ----- */
    D.$("#rAdd").onclick = async () => {
      const label = D.$("#rNew").value.trim();
      if (!label) return;
      try {
        D.ok(await D.sb.from("reasons").insert({ label: label, sort_order: 50 }));
        D.cache.reasons = null; D.toast("Reason added"); D.views.settings(view);
      } catch (e) { D.toast(e.message, "err"); }
    };
    D.$$("[data-rdel]", view).forEach(b => b.onclick = async () => {
      D.ok(await D.sb.from("reasons").update({ active: false }).eq("id", b.dataset.rdel));
      D.cache.reasons = null; D.toast("Reason removed"); D.views.settings(view);
    });
  };
})(window.DN);
