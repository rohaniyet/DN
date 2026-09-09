/* ===== DN Manager - shared helpers ============================== */
window.DN = window.DN || {};
(function (D) {
  "use strict";
  D.views = D.views || {};   /* every screen registers itself here */

  /* ---------- dom ---------- */
  D.$  = (s, r) => (r || document).querySelector(s);
  D.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  D.el = (tag, attrs, html) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  D.esc = (s) => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  let toastTimer;
  D.toast = (text, kind) => {
    const t = D.$("#toast");
    t.textContent = text;
    t.style.background = kind === "err" ? "#96271b" : kind === "warn" ? "#8a5b12" : "#12212b";
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), kind === "err" ? 6000 : 3000);
  };

  /* ---------- modal ---------- */
  D.modal = {
    open(title, bodyHtml, footHtml) {
      const box = D.$("#modalBox");
      box.innerHTML =
        '<div class="modal-head"><h2>' + D.esc(title) + '</h2>' +
        '<button class="btn sm" data-close>Close</button></div>' +
        '<div class="modal-body">' + bodyHtml + "</div>" +
        (footHtml ? '<div class="modal-foot">' + footHtml + "</div>" : "");
      D.$("#modal").hidden = false;
      box.querySelectorAll("[data-close]").forEach(b => b.onclick = D.modal.close);
      return box;
    },
    close() { D.$("#modal").hidden = true; D.$("#modalBox").innerHTML = ""; }
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape") D.modal.close(); });

  /* ---------- numbers & dates ---------- */
  D.num = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    const n = parseFloat(String(v).replace(/[,\s]/g, "").replace(/[()]/g, ""));
    return isNaN(n) ? 0 : n;
  };
  D.money = (v, dp) => {
    const d = dp === undefined ? 2 : dp;
    return D.num(v).toLocaleString("en-PK", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  D.moneySmart = (v) => {
    const n = D.round2(v);
    return Number.isInteger(n) ? n.toLocaleString("en-PK")
      : n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  D.qty = (v) => {
    const n = D.num(v);
    return Number.isInteger(n) ? n.toLocaleString("en-PK")
      : n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };
  D.round2 = (n) => Math.round((D.num(n) + Number.EPSILON) * 100) / 100;
  D.round4 = (n) => Math.round((D.num(n) + Number.EPSILON) * 10000) / 10000;

  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  D.today = () => new Date().toISOString().slice(0, 10);
  D.period = (d) => (d || D.today()).slice(0, 7);
  D.periodLabel = (p) => { if (!p) return ""; const [y, m] = p.split("-"); return MON[+m - 1] + "-" + y.slice(2); };
  D.dmy = (d) => {
    if (!d) return "";
    const s = String(d).slice(0, 10), p = s.split("-");
    if (p.length !== 3) return s;
    return p[2] + "-" + MON[+p[1] - 1] + "-" + p[0].slice(2);
  };
  D.dmyNum = (d) => {            /* 05-05-2026 - the form used in the IRIS sample table */
    if (!d) return "";
    const p = String(d).slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "-" + p[1] + "-" + p[0] : String(d);
  };
  /* Excel serial / free text -> yyyy-mm-dd */
  D.toDate = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    if (typeof v === "number" && v > 20000 && v < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5);
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return m[1] + "-" + p2(m[2]) + "-" + p2(m[3]);
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);          /* dd-mm-yyyy */
    if (m) return yr(m[3]) + "-" + p2(m[2]) + "-" + p2(m[1]);
    m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);   /* 24-May-26 */
    if (m) {
      const i = MON.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
      if (i >= 0) return yr(m[3]) + "-" + p2(i + 1) + "-" + p2(m[1]);
    }
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
    function p2(x) { return String(x).padStart(2, "0"); }
    function yr(x) { x = String(x); return x.length === 2 ? (+x > 70 ? "19" : "20") + x : x; }
  };

  /* ---------- invoice number handling ---------- */
  /* normalised key, ignoring punctuation and case */
  D.norm = (s) => String(s === null || s === undefined ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  /* base = invoice number without the trailing -1 / -2 part suffix */
  D.invBase = (s) => D.norm(String(s || "").replace(/[-_ ]\s*\d{1,2}\s*$/, ""));
  D.invPart = (s) => { const m = String(s || "").match(/[-_ ]\s*(\d{1,2})\s*$/); return m ? +m[1] : 0; };

  /* ---------- amount in words (Pakistani numbering) ---------- */
  const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function below1000(n) {
    let s = "";
    if (n >= 100) { s += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) s += " "; }
    if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += " " + ONES[n % 10]; }
    else if (n > 0) s += ONES[n];
    return s;
  }
  D.words = (amount) => {
    let n = Math.floor(Math.abs(D.num(amount)));
    const paisa = Math.round((Math.abs(D.num(amount)) - n) * 100);
    if (n === 0 && !paisa) return "Zero Rs";
    const parts = [];
    const units = [[10000000, "Crore"], [100000, "Lac"], [1000, "Thousand"]];
    for (const [v, name] of units) {
      if (n >= v) { parts.push(below1000(Math.floor(n / v)) + " " + name); n %= v; }
    }
    if (n) parts.push(below1000(n));
    let out = parts.join(" ").trim() + " Rs";
    if (paisa) out += " and " + below1000(paisa) + " Paisa";
    return out;
  };

  /* ---------- misc ---------- */
  D.debounce = (fn, ms) => { let t; return function () { clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms || 250); }; };
  D.download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  D.safeName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  D.uniqBy = (arr, key) => { const m = new Map(); arr.forEach(x => { const k = key(x); if (!m.has(k)) m.set(k, x); }); return Array.from(m.values()); };

  /* header-name matching used by every importer */
  D.guessColumn = (headers, synonyms) => {
    const H = headers.map(h => D.norm(h));
    for (const syn of synonyms) {
      const s = D.norm(syn);
      let i = H.findIndex(h => h === s);
      if (i >= 0) return headers[i];
    }
    for (const syn of synonyms) {
      const s = D.norm(syn);
      let i = H.findIndex(h => h.includes(s) && s.length > 3);
      if (i >= 0) return headers[i];
    }
    return "";
  };

  /* read a sheet file -> {headers, rows}  (rows are objects keyed by header) */
  D.readSheet = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("File could not be read"));
    fr.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
        const sheets = wb.SheetNames.map(name => {
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", blankrows: false, raw: true });
          return { name, aoa };
        });
        resolve(sheets);
      } catch (err) { reject(err); }
    };
    fr.readAsArrayBuffer(file);
  });

  /* find the header row of an AOA: the row with most non-empty distinct text cells */
  D.headerRowIndex = (aoa) => {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(aoa.length, 25); i++) {
      const cells = (aoa[i] || []).filter(c => String(c).trim() !== "");
      const texty = cells.filter(c => typeof c === "string" && String(c).trim().length > 1).length;
      const score = texty * 2 + cells.length;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  };
  D.aoaToObjects = (aoa, headerRow) => {
    const hdr = (aoa[headerRow] || []).map((h, i) => String(h).trim() || ("Column " + (i + 1)));
    const seen = {}, headers = hdr.map(h => { seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? h + " (" + seen[h] + ")" : h; });
    const rows = [];
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const line = aoa[r] || [];
      if (line.every(c => String(c).trim() === "")) continue;
      const o = {};
      headers.forEach((h, i) => o[h] = line[i] === undefined ? "" : line[i]);
      rows.push(o);
    }
    return { headers, rows };
  };
})(window.DN);
