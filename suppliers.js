/* ===== DN Manager - suppliers =================================== */
(function (D) {
  "use strict";

  /* generic typeahead: wraps an input inside a .ta container */
  D.typeahead = function (input, search, onPick, renderItem) {
    const wrap = D.el("div", { class: "ta" });
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    let list = null, items = [], sel = -1;

    function close() { if (list) { list.remove(); list = null; } sel = -1; }
    function paint() {
      close();
      if (!items.length) return;
      list = D.el("div", { class: "ta-list" });
      items.forEach((it, i) => {
        const row = D.el("div", { class: i === sel ? "sel" : "" }, renderItem(it));
        row.onmousedown = (e) => { e.preventDefault(); close(); onPick(it); };
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }
    const run = D.debounce(async () => {
      try { items = await search(input.value); } catch (e) { items = []; }
      sel = -1; paint();
    }, 220);

    input.addEventListener("input", run);
    input.addEventListener("focus", () => { if (input.value) run(); });
    input.addEventListener("blur", () => setTimeout(close, 150));
    input.addEventListener("keydown", (e) => {
      if (!list) return;
      if (e.key === "ArrowDown") { sel = Math.min(sel + 1, items.length - 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); const it = items[sel]; close(); onPick(it); }
      else if (e.key === "Escape") close();
    });
    return { close: close };
  };

  /* supplier picker used by the debit-note form */
  D.supplierSearch = async function (term) {
    const t = D.norm(term);
    const list = await D.suppliers();
    if (!t) return list.slice(0, 15);
    return list.filter(s => D.norm(s.name).includes(t) || D.norm(s.ntn).includes(t) ||
      D.norm(s.fbr_name).includes(t) || D.norm(s.city).includes(t)).slice(0, 25);
  };

  D.views.suppliers = async function (view) {
    const list = await D.refreshSuppliers();
    view.innerHTML =
      '<div class="page-head"><h1>Suppliers</h1><div class="spacer"></div>' +
      '<button class="btn" id="sFromMaster">Build from purchase master</button>' +
      '<button class="btn primary" id="sNew">New supplier</button></div>' +
      '<div class="card"><div class="row"><label class="f" style="flex:1;max-width:340px">Search' +
      '<input id="sQ" placeholder="Name, NTN or city"></label>' +
      '<div class="spacer"></div><div id="sCount" class="sub" style="margin:0"></div></div></div>' +
      '<div class="card" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>Supplier</th><th>NTN</th><th>City</th><th>Name in FBR data</th><th style="width:130px"></th>' +
      "</tr></thead><tbody id=\"sBody\"></tbody></table></div></div>";

    function paint() {
      const t = D.norm(D.$("#sQ").value);
      const rows = list.filter(s => !t || D.norm(s.name + s.ntn + s.city + s.fbr_name).includes(t));
      D.$("#sCount").textContent = rows.length + " of " + list.length + " suppliers";
      D.$("#sBody").innerHTML = rows.length ? rows.map(s =>
        "<tr><td><b>" + D.esc(s.name) + "</b></td><td>" + D.esc(s.ntn || "") + "</td>" +
        "<td>" + (s.city ? D.esc(s.city) : '<span class="tag pending">missing</span>') + "</td>" +
        "<td>" + D.esc(s.fbr_name || "") + "</td>" +
        '<td><button class="btn sm" data-edit="' + s.id + '">Edit</button> ' +
        '<button class="btn sm danger" data-del="' + s.id + '">Delete</button></td></tr>').join("")
        : '<tr><td colspan="5" class="empty">No suppliers yet — import the purchase master, then click “Build from purchase master”.</td></tr>';

      D.$$("[data-edit]", view).forEach(b => b.onclick = () => form(list.find(x => x.id === b.dataset.edit)));
      D.$$("[data-del]", view).forEach(b => b.onclick = async () => {
        if (!confirm("Delete this supplier?")) return;
        await D.deleteSupplier(b.dataset.del); D.toast("Supplier deleted"); D.views.suppliers(view);
      });
    }
    D.$("#sQ").oninput = paint;
    paint();

    function form(s) {
      s = s || {};
      D.modal.open(s.id ? "Edit supplier" : "New supplier",
        '<div class="grid g2">' +
        '<label class="f">Supplier name<input id="fName" value="' + D.esc(s.name || "") + '"></label>' +
        '<label class="f">NTN / CNIC<input id="fNtn" value="' + D.esc(s.ntn || "") + '"></label>' +
        '<label class="f">City<input id="fCity" value="' + D.esc(s.city || "") + '"></label>' +
        '<label class="f">Name as it appears in FBR data<input id="fFbr" value="' + D.esc(s.fbr_name || "") + '"></label>' +
        "</div>",
        '<button class="btn" data-close>Cancel</button><button class="btn primary" id="fSave">Save</button>');
      D.$("#fSave").onclick = async () => {
        const rec = {
          name: D.$("#fName").value.trim(), ntn: D.$("#fNtn").value.trim(),
          city: D.$("#fCity").value.trim(), fbr_name: D.$("#fFbr").value.trim()
        };
        if (!rec.name) return D.toast("Supplier name is required", "err");
        if (s.id) rec.id = s.id;
        try { await D.upsertSupplier(rec); } catch (e) { return D.toast(e.message, "err"); }
        D.modal.close(); D.toast("Supplier saved"); D.views.suppliers(view);
      };
    }
    D.$("#sNew").onclick = () => form();

    /* one-time build of the supplier register out of the FBR purchase data */
    D.$("#sFromMaster").onclick = async () => {
      const btn = D.$("#sFromMaster"); btn.disabled = true; btn.textContent = "Reading master…";
      try {
        const rows = await D.all("purchase_master", "supplier_name,supplier_ntn");
        const byNtn = new Map();
        rows.forEach(r => {
          const ntn = String(r.supplier_ntn || "").trim();
          const key = ntn || D.norm(r.supplier_name);
          if (!key) return;
          if (!byNtn.has(key)) byNtn.set(key, { name: String(r.supplier_name || "").trim(), ntn: ntn, fbr_name: String(r.supplier_name || "").trim() });
        });
        const existing = new Set(list.map(s => (s.ntn || D.norm(s.name))));
        const fresh = Array.from(byNtn.entries()).filter(([k]) => !existing.has(k)).map(([, v]) => v);
        if (!fresh.length) { D.toast("No new suppliers found in the purchase master"); return; }
        for (let i = 0; i < fresh.length; i += 200)
          D.ok(await D.sb.from("suppliers").insert(fresh.slice(i, i + 200)));
        D.toast(fresh.length + " suppliers added — fill in the missing cities");
        D.views.suppliers(view);
      } catch (e) { D.toast(e.message, "err"); }
      finally { btn.disabled = false; btn.textContent = "Build from purchase master"; }
    };
  };
})(window.DN);
