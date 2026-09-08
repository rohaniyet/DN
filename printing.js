/* ===== DN Manager - printable debit note, PDF and bulk ZIP ====== */
(function (D) {
  "use strict";
  const CO = window.DN_CONFIG.COMPANY;

  D.noteSheetHtml = function (n, copyLabel) {
    const items = (n.items || []).slice().sort((a, b) => (a.sr || 0) - (b.sr || 0));
    const val = items.reduce((a, i) => a + D.num(i.value_excl), 0);
    const tax = items.reduce((a, i) => a + D.num(i.sales_tax), 0);
    const tot = val + tax;
    const reason = n.reason === "Other" ? (n.reason_note || "Other") : (n.reason || n.reason_note || "");
    const rows = items.map((it, i) =>
      "<tr>" +
      '<td class="c">' + (i + 1) + "</td>" +
      "<td>" + D.esc(it.invoice_no || "") + "</td>" +
      '<td class="c">' + D.dmy(it.invoice_date) + "</td>" +
      "<td>" + D.esc(it.product || "") + "</td>" +
      '<td class="c">' + D.esc(it.hs_code || "") + "</td>" +
      '<td class="c">' + D.esc(it.uom || "") + "</td>" +
      '<td class="r">' + D.qty(it.quantity) + "</td>" +
      '<td class="r">' + D.money(it.value_excl) + "</td>" +
      '<td class="c">' + D.num(it.tax_rate) + "%</td>" +
      '<td class="r">' + D.money(it.sales_tax) + "</td>" +
      '<td class="r">' + D.money(it.total) + "</td></tr>").join("");

    return '<div class="dn-sheet">' +
      '<div class="co"><h2>' + D.esc(CO.name) + "</h2>" +
      "<div>" + D.esc(CO.address) + "</div>" +
      "<div>Phone: " + D.esc(CO.phone) + " &nbsp;|&nbsp; STRN: " + D.esc(CO.strn) + " &nbsp;|&nbsp; NTN: " + D.esc(CO.ntn) + "</div></div>" +
      '<div class="title">' + D.esc(CO.title) + "</div>" +
      '<div class="copy">(' + D.esc(copyLabel || CO.copies[0]) + ")</div>" +

      '<table class="meta"><tr>' +
      '<td style="width:62%"><b>Supplier:</b> ' + D.esc(n.supplier_name || "") + "<br>" +
      (n.supplier_city ? D.esc(n.supplier_city) + "<br>" : "") +
      "<b>NTN / CNIC:</b> " + D.esc(n.supplier_ntn || "") + "</td>" +
      '<td style="width:38%"><b>Debit Note No:</b> ' + D.esc(n.dn_no || "") + "<br>" +
      "<b>Date:</b> " + D.dmy(n.dn_date) + "<br>" +
      (n.gate_pass_no ? "<b>Gate Pass No:</b> " + D.esc(n.gate_pass_no) + "<br>" : "") +
      (n.gate_pass_date ? "<b>Gate Pass Date:</b> " + D.dmy(n.gate_pass_date) : "") +
      "</td></tr></table>" +

      '<table class="it"><thead><tr>' +
      "<th>Sr</th><th>Invoice No.</th><th>Inv. Date</th><th>Description</th><th>HS Code</th><th>UOM</th>" +
      "<th>Qty</th><th>Value Excl. S.Tax</th><th>Rate</th><th>Sales Tax</th><th>Total</th>" +
      "</tr></thead><tbody>" + rows +
      '<tr><td colspan="7" class="r"><b>Total</b></td>' +
      '<td class="r"><b>' + D.money(val) + '</b></td><td></td><td class="r"><b>' + D.money(tax) +
      '</b></td><td class="r"><b>' + D.money(tot) + "</b></td></tr></tbody></table>" +
      '<div class="words"><b>Amount in words:</b> ' + D.esc(D.words(tot)) + "</div>" +
      '<div class="rsn"><b>Reason:</b> ' + D.esc(reason) + (n.remarks ? " &nbsp;|&nbsp; <b>Remarks:</b> " + D.esc(n.remarks) : "") + "</div>" +
      '<div class="sig"><div>Prepared By</div><div>Checked By</div><div>Authorised Signatory</div></div>' +
      "</div>";
  };

  D.printNotes = function (notes) {
    D.$("#printArea").innerHTML = notes.map(n => D.noteSheetHtml(n)).join("");
    window.print();
  };

  async function sheetToPdf(html) {
    const holder = D.el("div", { style: "position:fixed;left:-10000px;top:0;background:#fff" });
    holder.innerHTML = html;
    document.body.appendChild(holder);
    try {
      const canvas = await html2canvas(holder.firstChild, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "p" });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const w = pw - 10, h = (canvas.height * w) / canvas.width;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 5, 5, w, Math.min(h, ph - 10));
      return pdf.output("blob");
    } finally { holder.remove(); }
  }

  /* one note -> straight PDF download; many -> a zip of one PDF per note */
  D.notesToPdf = async function (notes, onProgress) {
    if (!notes.length) return;
    if (notes.length === 1) {
      const n = notes[0];
      const blob = await sheetToPdf(D.noteSheetHtml(n));
      D.download(blob, D.safeName(n.supplier_name) + " - DN " + D.safeName(n.dn_no) + ".pdf");
      return;
    }
    const zip = new JSZip();
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (onProgress) onProgress(i + 1, notes.length);
      const blob = await sheetToPdf(D.noteSheetHtml(n));
      zip.file(D.safeName(n.supplier_name) + " - DN " + D.safeName(n.dn_no) + ".pdf", blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    D.download(out, "Debit Notes " + D.today() + ".zip");
  };
})(window.DN);
