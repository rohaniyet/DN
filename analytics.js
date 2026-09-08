/* ===== DN Manager - dashboard and analytics ===================== */
(function (D) {
  "use strict";
  const INK = "#12212b", MUTED = "#516475", GRID = "#e7edf2", BRAND = "#0b6b5b";

  const noteValue = (n) => (n.items || []).reduce((a, i) => a + D.num(i.value_excl), 0);
  const noteTax   = (n) => (n.items || []).reduce((a, i) => a + D.num(i.sales_tax), 0);

  function baseOptions(valueFmt) {
    return {
      responsive: true, maintainAspectRatio: false,
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
  function shorten(v) {
    const n = Math.abs(v);
    if (n >= 1e7) return (v / 1e7).toFixed(1).replace(/\.0$/, "") + " Cr";
    if (n >= 1e5) return (v / 1e5).toFixed(1).replace(/\.0$/, "") + " Lac";
    if (n >= 1e3) return Math.round(v / 1e3) + "k";
    return String(v);
  }

  /* ---------------- dashboard ---------------- */
  D.views.dashboard = async function (view) {
    const [notes, master] = await Promise.all([D.getNotes(), D.masterStats()]);
    const live = notes.filter(n => n.status !== "cancelled");
    const open = live.filter(n => n.status === "draft" || n.status === "printed");
    const thisPeriod = D.period();
    const thisMonth = live.filter(n => D.period(n.dn_date) === thisPeriod);

    const filed = live.filter(n => n.status === "filed");
    const money3 = (set) => {
      const v = set.reduce((a, n) => a + noteValue(n), 0);
      const t = set.reduce((a, n) => a + noteTax(n), 0);
      return '<div class="n">Excl. <b>' + D.money(v, 0) + "</b></div>" +
             '<div class="n">GST <b>' + D.money(t, 0) + "</b> &nbsp;·&nbsp; Total <b>" + D.money(v + t, 0) + "</b></div>";
    };

    view.innerHTML =
      '<div class="page-head"><h1>Dashboard</h1><div class="spacer"></div>' +
      '<button class="btn" id="qMaster">Import purchase master</button>' +
      '<button class="btn primary" id="qNew">New debit note</button></div>' +

      '<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="stat"><div class="k">This month</div><div class="v">' + thisMonth.length + "</div>" + money3(thisMonth) + "</div>" +
      '<div class="stat b3"><div class="k">Open (not filed)</div><div class="v">' + open.length + "</div>" + money3(open) + "</div>" +
      '<div class="stat b4"><div class="k">Filed to date</div><div class="v">' + filed.length + "</div>" + money3(filed) + "</div>" +
      '<div class="stat b2"><div class="k">Purchase master</div><div class="v">' + master.total.toLocaleString("en-PK") + "</div>" +
      '<div class="n">invoice parts</div><div class="n">' + master.periods.length + " periods loaded</div></div></div>" +

      '<div class="grid g2">' +
      '<div class="card"><h2>Debit note value by month <span style="font-weight:400;color:#516475;font-size:12px">(excl. sales tax)</span></h2><div style="height:270px"><canvas id="cMonth"></canvas></div></div>' +
      '<div class="card"><h2>Open notes by supplier <span style="font-weight:400;color:#516475;font-size:12px">(excl. sales tax)</span></h2><div style="height:270px"><canvas id="cOpen"></canvas></div></div>' +
      "</div>" +

      '<div class="card"><h2>Latest debit notes</h2><div class="tbl-wrap" style="max-height:40vh"><table><thead><tr>' +
      "<th>DN No.</th><th>Date</th><th>Supplier</th><th>Reason</th>" +
      '<th class="num">Excl. tax</th><th class="num">Sales tax</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
      (live.slice(0, 12).map(n => "<tr><td><b>" + D.esc(n.dn_no) + "</b></td><td>" + D.dmy(n.dn_date) + "</td>" +
        "<td>" + D.esc(n.supplier_name || "") + "</td><td>" + D.esc(n.reason || "") + "</td>" +
        '<td class="num">' + D.money(noteValue(n)) + '</td><td class="num">' + D.money(noteTax(n)) + "</td>" +
        '<td class="num"><b>' + D.money(noteValue(n) + noteTax(n)) + '</b></td>' +
        '<td><span class="tag ' + n.status + '">' + n.status + "</span></td></tr>").join("") ||
        '<tr><td colspan="8" class="empty">No debit notes yet.</td></tr>') +
      "</tbody></table></div></div>";

    D.$("#qNew").onclick = () => D.go("note", "new");
    D.$("#qMaster").onclick = () => D.go("master");

    const byMonth = {};
    live.forEach(n => { const p = D.period(n.dn_date); byMonth[p] = (byMonth[p] || 0) + noteValue(n); });
    const months = Object.keys(byMonth).sort().slice(-12);
    new Chart(D.$("#cMonth"), {
      type: "bar",
      data: { labels: months.map(D.periodLabel), datasets: [{ data: months.map(m => D.round2(byMonth[m])), backgroundColor: BRAND, borderRadius: 4, maxBarThickness: 34 }] },
      options: baseOptions(v => "Rs. " + D.money(v))
    });

    const bySupp = {};
    open.forEach(n => { const s = n.supplier_name || "(no supplier)"; bySupp[s] = (bySupp[s] || 0) + noteValue(n); });
    const top = Object.entries(bySupp).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const hOpts = baseOptions(v => "Rs. " + D.money(v));
    hOpts.indexAxis = "y";
    hOpts.scales = {
      x: { grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { color: MUTED, font: { size: 11 }, callback: (v) => shorten(v) } },
      y: { grid: { display: false }, border: { color: GRID }, ticks: { color: INK, font: { size: 11 } } }
    };
    new Chart(D.$("#cOpen"), {
      type: "bar",
      data: { labels: top.map(t => t[0].length > 26 ? t[0].slice(0, 26) + "…" : t[0]),
        datasets: [{ data: top.map(t => D.round2(t[1])), backgroundColor: BRAND, borderRadius: 4, maxBarThickness: 22 }] },
      options: hOpts
    });
  };

  /* ---------------- analytics ---------------- */
  D.views.analytics = async function (view) {
    const notes = (await D.getNotes()).filter(n => n.status !== "cancelled");
    const master = await D.all("purchase_master", "period,value_excl");

    const periods = Array.from(new Set(notes.map(n => D.period(n.dn_date)))).sort();
    const purchByPeriod = {};
    master.forEach(m => { if (m.period) purchByPeriod[m.period] = (purchByPeriod[m.period] || 0) + D.num(m.value_excl); });

    const rows = periods.map(p => {
      const ns = notes.filter(n => D.period(n.dn_date) === p);
      const v = ns.reduce((a, n) => a + noteValue(n), 0);
      const purch = purchByPeriod[p] || 0;
      return { period: p, count: ns.length, value: v, tax: ns.reduce((a, n) => a + noteTax(n), 0),
        purchases: purch, share: purch ? (v / purch) * 100 : null };
    });

    const bySupplier = {};
    notes.forEach(n => {
      const k = n.supplier_name || "(no supplier)";
      bySupplier[k] = bySupplier[k] || { name: k, count: 0, value: 0, tax: 0 };
      bySupplier[k].count++; bySupplier[k].value += noteValue(n); bySupplier[k].tax += noteTax(n);
    });
    const suppliers = Object.values(bySupplier).sort((a, b) => b.value - a.value);

    const byReason = {};
    notes.forEach(n => {
      const k = n.reason || "(not set)";
      byReason[k] = byReason[k] || { name: k, count: 0, value: 0, tax: 0 };
      byReason[k].count++; byReason[k].value += noteValue(n); byReason[k].tax += noteTax(n);
    });
    const reasons = Object.values(byReason).sort((a, b) => b.value - a.value);

    const totalValue = notes.reduce((a, n) => a + noteValue(n), 0);
    const totalTax = notes.reduce((a, n) => a + noteTax(n), 0);
    const totalPurch = Object.values(purchByPeriod).reduce((a, b) => a + b, 0);

    view.innerHTML =
      '<div class="page-head"><h1>Analytics</h1><div class="spacer"></div>' +
      '<button class="btn" id="anXls">Export analytics</button></div>' +
      '<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="stat"><div class="k">Debit notes</div><div class="v">' + notes.length + "</div>" +
      '<div class="n">' + periods.length + " months</div></div>" +
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
        '<td class="num">' + (r.purchases ? D.money(r.purchases) : "—") + '</td>' +
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

    const money = v => "Rs. " + D.money(v);
    new Chart(D.$("#aMonth"), {
      type: "bar",
      data: { labels: rows.map(r => D.periodLabel(r.period)),
        datasets: [{ data: rows.map(r => D.round2(r.value)), backgroundColor: BRAND, borderRadius: 4, maxBarThickness: 34 }] },
      options: baseOptions(money)
    });
    new Chart(D.$("#aCount"), {
      type: "line",
      data: { labels: rows.map(r => D.periodLabel(r.period)),
        datasets: [{ data: rows.map(r => r.count), borderColor: BRAND, backgroundColor: BRAND,
          borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: .25, fill: false }] },
      options: baseOptions(v => v + " notes")
    });

    const hOpts = () => {
      const o = baseOptions(money);
      o.indexAxis = "y";
      o.scales = {
        x: { grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { color: MUTED, font: { size: 11 }, callback: (v) => shorten(v) } },
        y: { grid: { display: false }, border: { color: GRID }, ticks: { color: INK, font: { size: 11 } } }
      };
      o.plugins.tooltip.callbacks.label = (c) => money(c.parsed.x);
      return o;
    };
    const top = suppliers.slice(0, 10);
    new Chart(D.$("#aSupp"), {
      type: "bar",
      data: { labels: top.map(s => s.name.length > 26 ? s.name.slice(0, 26) + "…" : s.name),
        datasets: [{ data: top.map(s => D.round2(s.value)), backgroundColor: BRAND, borderRadius: 4, maxBarThickness: 20 }] },
      options: hOpts()
    });
    new Chart(D.$("#aReason"), {
      type: "bar",
      data: { labels: reasons.map(r => r.name),
        datasets: [{ data: reasons.map(r => D.round2(r.value)), backgroundColor: BRAND, borderRadius: 4, maxBarThickness: 20 }] },
      options: hOpts()
    });

    D.$("#anXls").onclick = () => {
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
    };
  };
})(window.DN);
