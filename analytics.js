/* ===== DN Manager - dashboard and analytics =====================
   Every figure here comes from a summary view in the database, so a
   screen costs a few small rows instead of the whole table.
   ================================================================ */
(function (D) {
  "use strict";
  const INK = "#12212b", MUTED = "#516475", GRID = "#e7edf2", BRAND = "#0b6b5b";

  function baseOptions(valueFmt) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#12212b", padding: 10, cornerRadius: 6, displayColors: false,
          callbacks: { label: (c) => valueFmt(c.parsed.y !== undefined && c.parsed.y !== null ? c.parsed.y : c.parsed.x) }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { color: GRID }, ticks: { color: MUTED, font: { size: 11 } } },
        y: { grid: { color: GRID, drawTicks: false }, border: { display: false },
             ticks: { color: MUTED, font: { size: 11 }, callback: (v) => shorten(v) } }
      }
    };
  }
  function horizontal(valueFmt) {
    const o = baseOptions(valueFmt);
    o.indexAxis = "y";
    o.scales = {
      x: { grid: { color: GRID, drawTicks: false }, border: { display: false },
           ticks: { color: MUTED, font: { size: 11 }, callback: (v) => shorten(v) } },
      y: { grid: { display: false }, border: { color: GRID }, ticks: { color: INK, font: { size: 11 } } }
    };
    o.plugins.tooltip.callbacks.label = (c) => valueFmt(c.parsed.x);
    return o;
  }
  function shorten(v) {
    const n = Math.abs(v);
    if (n >= 1e7) return (v / 1e7).toFixed(1).replace(/\.0$/, "") + " Cr";
    if (n >= 1e5) return (v / 1e5).toFixed(1).replace(/\.0$/, "") + " Lac";
    if (n >= 1e3) return Math.round(v / 1e3) + "k";
    return String(v);
  }
  const money = (v) => "Rs. " + D.money(v);

  function bar(canvasId, labels, data, opts) {
    const el = D.$("#" + canvasId);
    if (!el) return;
    new Chart(el, {
      type: "bar",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: BRAND, borderRadius: 4, maxBarThickness: 30 }] },
      options: opts
    });
  }

  /* ---------------- dashboard ---------------- */
  D.views.dashboard = async function (view) {
    const [status, supplier, monthly, master, latest] = await Promise.all([
      D.noteStatus(), D.noteSupplier(), D.noteMonthly(), D.masterStats(), D.latestNotes(12)
    ]);

    const period = D.period();
    const sum = (rows) => rows.reduce((a, r) => ({
      notes: a.notes + (r.notes || 0),
      value: a.value + D.num(r.value_excl),
      tax: a.tax + D.num(r.sales_tax)
    }), { notes: 0, value: 0, tax: 0 });

    const live = status.filter(r => r.status !== "cancelled");
    const thisMonth = sum(live.filter(r => r.period === period));
    const open = sum(live.filter(r => r.status === "draft" || r.status === "printed"));
    const filed = sum(live.filter(r => r.status === "filed"));

    const money3 = (t) =>
      '<div class="n">Excl. <b>' + D.money(t.value, 0) + "</b></div>" +
      '<div class="n">GST <b>' + D.money(t.tax, 0) + "</b> &nbsp;·&nbsp; Total <b>" + D.money(t.value + t.tax, 0) + "</b></div>";

    view.innerHTML =
      '<div class="page-head"><h1>Dashboard</h1><div class="spacer"></div>' +
      (D.isAdmin() ? '<button class="btn" id="qMaster">Import purchase master</button>' : "") +
      '<button class="btn primary" id="qNew">New debit note</button></div>' +

      '<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="stat"><div class="k">This month</div><div class="v">' + thisMonth.notes + "</div>" + money3(thisMonth) + "</div>" +
      '<div class="stat b3"><div class="k">Open (not filed)</div><div class="v">' + open.notes + "</div>" + money3(open) + "</div>" +
      '<div class="stat b4"><div class="k">Filed to date</div><div class="v">' + filed.notes + "</div>" + money3(filed) + "</div>" +
      '<div class="stat b2"><div class="k">Purchase master</div><div class="v">' + master.total.toLocaleString("en-PK") + "</div>" +
      '<div class="n">invoice parts</div><div class="n">' + master.periods.length + " periods loaded</div></div></div>" +

      '<div class="grid g2">' +
      '<div class="card"><h2>Debit note value by month <span style="font-weight:400;color:#516475;font-size:12px">(excl. sales tax)</span></h2>' +
      '<div style="height:270px"><canvas id="cMonth"></canvas></div></div>' +
      '<div class="card"><h2>Open notes by supplier <span style="font-weight:400;color:#516475;font-size:12px">(excl. sales tax)</span></h2>' +
      '<div style="height:270px"><canvas id="cOpen"></canvas></div></div>' +
      "</div>" +

      '<div class="card"><h2>Latest debit notes</h2><div class="tbl-wrap" style="max-height:40vh"><table><thead><tr>' +
      "<th>DN No.</th><th>Date</th><th>Supplier</th><th>Reason</th>" +
      '<th class="num">Excl. tax</th><th class="num">Sales tax</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
      (latest.map(n => "<tr><td><b>" + D.esc(n.dn_no) + "</b></td><td>" + D.dmy(n.dn_date) + "</td>" +
        "<td>" + D.esc(n.supplier_name || "") + "</td><td>" + D.esc(n.reason || "") + "</td>" +
        '<td class="num">' + D.money(n.value_excl) + '</td><td class="num">' + D.money(n.sales_tax) + "</td>" +
        '<td class="num"><b>' + D.money(D.num(n.value_excl) + D.num(n.sales_tax)) + "</b></td>" +
        '<td><span class="tag ' + n.status + '">' + n.status + "</span></td></tr>").join("") ||
        '<tr><td colspan="8" class="empty">No debit notes yet.</td></tr>') +
      "</tbody></table></div></div>";

    D.$("#qNew").onclick = () => D.go("note", "new");
    if (D.$("#qMaster")) D.$("#qMaster").onclick = () => D.go("master");

    await D.needLib("chart");
    const months = monthly.slice().sort((a, b) => a.period < b.period ? -1 : 1).slice(-12);
    bar("cMonth", months.map(m => D.periodLabel(m.period)),
      months.map(m => D.round2(m.value_excl)), baseOptions(money));

    const openBySupp = {};
    supplier.filter(r => r.status === "draft" || r.status === "printed")
      .forEach(r => { openBySupp[r.supplier] = (openBySupp[r.supplier] || 0) + D.num(r.value_excl); });
    const top = Object.entries(openBySupp).sort((a, b) => b[1] - a[1]).slice(0, 8);
    bar("cOpen", top.map(t => t[0].length > 26 ? t[0].slice(0, 26) + "…" : t[0]),
      top.map(t => D.round2(t[1])), horizontal(money));
  };

  /* ---------------- analytics ---------------- */
  D.views.analytics = async function (view) {
    const [monthly, supplierRows, reasonRows, master] = await Promise.all([
      D.noteMonthly(), D.noteSupplier(), D.noteReason(), D.masterStats()
    ]);

    const purchByPeriod = {};
    master.periods.forEach(p => { purchByPeriod[p.period] = p.value; });

    const rows = monthly.slice().sort((a, b) => a.period < b.period ? -1 : 1).map(m => {
      const purch = purchByPeriod[m.period] || 0;
      const value = D.num(m.value_excl);
      return { period: m.period, count: m.notes, value: value, tax: D.num(m.sales_tax),
        purchases: purch, share: purch ? (value / purch) * 100 : null };
    });

    const bySupplier = {};
    supplierRows.filter(r => r.status !== "cancelled").forEach(r => {
      const s = bySupplier[r.supplier] = bySupplier[r.supplier] || { name: r.supplier, count: 0, value: 0, tax: 0 };
      s.count += r.notes; s.value += D.num(r.value_excl); s.tax += D.num(r.sales_tax);
    });
    const suppliers = Object.values(bySupplier).sort((a, b) => b.value - a.value);
    const reasons = reasonRows.map(r => ({ name: r.reason, count: r.notes, value: D.num(r.value_excl), tax: D.num(r.sales_tax) }))
      .sort((a, b) => b.value - a.value);

    const totalValue = rows.reduce((a, r) => a + r.value, 0);
    const totalTax = rows.reduce((a, r) => a + r.tax, 0);
    const totalNotes = rows.reduce((a, r) => a + r.count, 0);
    const totalPurch = master.periods.reduce((a, p) => a + p.value, 0);

    view.innerHTML =
      '<div class="page-head"><h1>Analytics</h1><div class="spacer"></div>' +
      '<button class="btn" id="anXls">Export analytics</button></div>' +
      '<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="stat"><div class="k">Debit notes</div><div class="v">' + totalNotes + "</div>" +
      '<div class="n">' + rows.length + " months</div></div>" +
      '<div class="stat b2"><div class="k">Value excl. sales tax</div><div class="v">' + D.money(totalValue, 0) + "</div>" +
      '<div class="n">Total with GST <b>' + D.money(totalValue + totalTax, 0) + "</b></div></div>" +
      '<div class="stat b4"><div class="k">Sales tax reversed</div><div class="v">' + D.money(totalTax, 0) + "</div>" +
      '<div class="n">' + (totalValue ? (totalTax / totalValue * 100).toFixed(1) : "0") + "% of the ex-tax value</div></div>" +
      '<div class="stat b3"><div class="k">Share of purchases</div><div class="v">' +
        (totalPurch ? (totalValue / totalPurch * 100).toFixed(2) + "%" : "—") + "</div>" +
      '<div class="n">of ' + D.money(totalPurch, 0) + " purchased</div></div></div>" +

      '<div class="grid g2">' +
      '<div class="card"><h2>Value by month</h2><div style="height:280px"><canvas id="aMonth"></canvas></div></div>' +
      '<div class="card"><h2>Number of notes by month</h2><div style="height:280px"><canvas id="aCount"></canvas></div></div>' +
      '<div class="card"><h2>Top suppliers by value</h2><div style="height:320px"><canvas id="aSupp"></canvas></div></div>' +
      '<div class="card"><h2>Value by reason</h2><div style="height:320px"><canvas id="aReason"></canvas></div></div>' +
      "</div>" +

      '<div class="card"><h2>Month by month</h2><div class="tbl-wrap" style="max-height:40vh"><table><thead><tr>' +
      '<th>Month</th><th class="num">Notes</th><th class="num">Value excl. tax</th><th class="num">Sales tax</th>' +
      '<th class="num">Total with GST</th><th class="num">Purchases</th><th class="num">DN as % of purchases</th></tr></thead><tbody>' +
      (rows.slice().reverse().map(r => "<tr><td><b>" + D.periodLabel(r.period) + '</b></td><td class="num">' + r.count + "</td>" +
        '<td class="num">' + D.money(r.value) + '</td><td class="num">' + D.money(r.tax) + "</td>" +
        '<td class="num"><b>' + D.money(r.value + r.tax) + "</b></td>" +
        '<td class="num">' + (r.purchases ? D.money(r.purchases) : "—") + "</td>" +
        '<td class="num">' + (r.share === null ? "—" : r.share.toFixed(2) + "%") + "</td></tr>").join("") ||
        '<tr><td colspan="7" class="empty">No data yet.</td></tr>') +
      "</tbody></table></div></div>" +

      '<div class="card"><h2>Supplier ranking</h2><div class="tbl-wrap" style="max-height:44vh"><table><thead><tr>' +
      '<th style="width:44px">#</th><th>Supplier</th><th class="num">Notes</th><th class="num">Value excl. tax</th>' +
      '<th class="num">Sales tax</th><th class="num">Total with GST</th><th class="num">Share</th></tr></thead><tbody>' +
      (suppliers.map((s, i) => "<tr><td>" + (i + 1) + "</td><td>" + D.esc(s.name) + '</td><td class="num">' + s.count + "</td>" +
        '<td class="num">' + D.money(s.value) + '</td><td class="num">' + D.money(s.tax) + "</td>" +
        '<td class="num"><b>' + D.money(s.value + s.tax) + '</b></td><td class="num">' +
        (totalValue ? (s.value / totalValue * 100).toFixed(1) + "%" : "—") + "</td></tr>").join("") ||
        '<tr><td colspan="7" class="empty">No data yet.</td></tr>') +
      "</tbody></table></div></div>";

    await D.needLib("chart");
    bar("aMonth", rows.map(r => D.periodLabel(r.period)), rows.map(r => D.round2(r.value)), baseOptions(money));
    new Chart(D.$("#aCount"), {
      type: "line",
      data: { labels: rows.map(r => D.periodLabel(r.period)),
        datasets: [{ data: rows.map(r => r.count), borderColor: BRAND, backgroundColor: BRAND,
          borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: .25, fill: false }] },
      options: baseOptions(v => v + " notes")
    });
    const top = suppliers.slice(0, 10);
    bar("aSupp", top.map(s => s.name.length > 26 ? s.name.slice(0, 26) + "…" : s.name),
      top.map(s => D.round2(s.value)), horizontal(money));
    bar("aReason", reasons.map(r => r.name), reasons.map(r => D.round2(r.value)), horizontal(money));

    D.$("#anXls").onclick = async () => {
      const btn = D.$("#anXls"); btn.disabled = true; btn.textContent = "Preparing…";
      try {
        await D.needLib("xlsx");
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
          Month: D.periodLabel(r.period), Notes: r.count, "Value excl. tax": D.round2(r.value),
          "Sales tax": D.round2(r.tax), "Total with GST": D.round2(r.value + r.tax),
          Purchases: D.round2(r.purchases),
          "DN % of purchases": r.share === null ? "" : D.round2(r.share)
        }))), "By month");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suppliers.map((s, i) => ({
          Rank: i + 1, Supplier: s.name, Notes: s.count, "Value excl. tax": D.round2(s.value),
          "Sales tax": D.round2(s.tax), "Total with GST": D.round2(s.value + s.tax)
        }))), "By supplier");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reasons.map(r => ({
          Reason: r.name, Notes: r.count, "Value excl. tax": D.round2(r.value),
          "Sales tax": D.round2(r.tax), "Total with GST": D.round2(r.value + r.tax)
        }))), "By reason");
        XLSX.writeFile(wb, "DN analytics " + D.today() + ".xlsx");
      } catch (e) { D.toast(e.message, "err"); }
      btn.disabled = false; btn.textContent = "Export analytics";
    };
  };
})(window.DN);
