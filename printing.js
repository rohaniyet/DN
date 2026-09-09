/* ===== DN Manager - printable debit note, PDF and bulk ZIP ======
   Layout follows the company's own debit-note stationery exactly.
   ================================================================ */
(function (D) {
  "use strict";
  const CO = window.DN_CONFIG.COMPANY;

  D.noteSheetHtml = function (n, copyLabel) {
    const items = (n.items || []).slice().sort((a, b) => (a.sr || 0) - (b.sr || 0));
    const val = items.reduce((a, i) => a + D.num(i.value_excl), 0);
    const tax = items.reduce((a, i) => a + D.num(i.sales_tax), 0);
    const tot = val + tax;
    const reason = n.reason === "Other" ? (n.reason_note || "Other") : (n.reason || n.reason_note || "");
    const reasonLine = [reason, n.gate_pass_no ? "GP " + n.gate_pass_no : ""].filter(Boolean).join(" ");
    const fbr = String(n.supplier_fbr_name || "").trim();
    const showFbr = fbr && D.norm(fbr) !== D.norm(n.supplier_name || "");

    const rows = items.map((it, i) =>
      "<tr>" +
      '<td class="c">' + (i + 1) + "</td>" +
      '<td class="c wrap">' + D.esc(it.invoice_no || "") + "</td>" +
      '<td class="c">' + D.dmyNum(it.invoice_date) + "</td>" +
      '<td class="c">' + D.esc(it.product || "") + "</td>" +
      '<td class="r">' + D.money(it.quantity) + "</td>" +
      '<td class="r">' + D.moneySmart(it.value_excl) + "</td>" +
      '<td class="r">' + D.moneySmart(it.sales_tax) + "</td>" +
      '<td class="r">' + D.moneySmart(D.num(it.value_excl) + D.num(it.sales_tax)) + "</td></tr>").join("");

    /* keep the sheet a full page tall, as the printed stationery is */
    const MIN_ROWS = 18;
    const filler = items.length < MIN_ROWS
      ? Array(MIN_ROWS - items.length).fill('<tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join("")
      : "";

    return '<div class="dn-sheet">' +
      '<div class="co">' +
      "<h2>" + D.esc(CO.name) + "</h2>" +
      "<div>Address: " + D.esc(CO.address) + "</div>" +
      "<div>Phone: " + D.esc(CO.phone) + "</div>" +
      "<div>STRN: " + D.esc(CO.strn) + "</div>" +
      "<div>NTN:" + D.esc(CO.ntn) + "</div>" +
      '<div class="title">' + D.esc(CO.title) + "</div>" +
      "</div>" +

      '<table class="head"><tr>' +
      '<td class="party">' +
      '<div class="ph">Supplier&rsquo;s Particulars</div>' +
      '<table class="kv">' +
      "<tr><td>Name:</td><td><b>" + D.esc(n.supplier_name || "") + "</b></td></tr>" +
      (showFbr ? "<tr><td>FBR Record:</td><td>" + D.esc(fbr) + "</td></tr>" : "") +
      "<tr><td>Address:</td><td>" + D.esc(n.supplier_city || "") + "</td></tr>" +
      "<tr><td>NTN:</td><td><b>" + D.esc(n.supplier_ntn || "") + "</b></td></tr>" +
      "</table></td>" +
      '<td class="copies">' +
      '<table class="cp"><tr>' + CO.copies.map(c =>
        "<td" + (copyLabel && copyLabel === c ? ' class="on"' : "") + ">" + D.esc(c) + "</td>").join("") + "</tr></table>" +
      '<table class="note-no">' +
      "<tr><td>Note No:</td><td><b>" + D.esc(n.dn_no || "") + "</b></td></tr>" +
      "<tr><td>Date:</td><td><b>" + D.dmyNum(n.dn_date) + "</b></td></tr>" +
      "</table></td></tr></table>" +

      '<table class="it"><thead>' +
      "<tr>" +
      '<th rowspan="2" class="w-sr">Sr.<br>No</th>' +
      '<th rowspan="2" class="w-inv">Original Sales<br>Tax Invoice No.</th>' +
      '<th rowspan="2" class="w-dt">Date per<br>Original Sales<br>Tax Invoice</th>' +
      '<th rowspan="2">Description</th>' +
      '<th rowspan="2" class="w-qty">QTY</th>' +
      '<th colspan="3" class="grp">Debit Adjustment</th></tr>' +
      "<tr>" +
      '<th class="w-amt">Value exclusive<br>of ST</th>' +
      '<th class="w-amt">Value of ST</th>' +
      '<th class="w-amt">Value inclusive<br>of ST</th></tr></thead><tbody>' +
      rows + filler +
      '<tr class="tot"><td class="c">Total</td><td></td><td></td><td></td><td></td>' +
      '<td class="r">' + D.moneySmart(val) + "</td>" +
      '<td class="r">' + D.moneySmart(tax) + "</td>" +
      '<td class="r">' + D.moneySmart(tot) + "</td></tr>" +
      "</tbody></table>" +

      '<div class="words"><b>Amount in Word:</b> &nbsp;' + D.esc(D.words(tot)) + "</div>" +

      '<table class="foot"><tr>' +
      "<td>" +
      '<div class="prep">Prepared By</div>' +
      '<div class="nt">Note: ' + D.esc(CO.note) + "</div>" +
      '<div class="nt"><b>Reason for Issuance of Debit Note:</b> ' + D.esc(reasonLine) + "</div>" +
      (n.remarks ? '<div class="nt">' + D.esc(n.remarks) + "</div>" : "") +
      "</td>" +
      '<td class="sign"><div>Authorised Signature:</div><div class="for"><b>' + D.esc(CO.footer) + "</b></div></td>" +
      "</tr></table></div>";
  };

  D.printNotes = function (notes) {
    D.$("#printArea").innerHTML = notes.map(n => D.noteSheetHtml(n)).join("");
    window.print();
  };

  async function sheetToPdf(html) {
    await D.needLib("html2canvas", "jspdf");
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
    await D.needLib("jszip");
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
