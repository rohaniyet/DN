/* ===== DN Manager - shell, auth and router ====================== */
(function (D) {
  "use strict";
  D.views = D.views || {};
  D.cache = { suppliers: null, reasons: null };

  D.refreshSuppliers = async function () { D.cache.suppliers = await D.getSuppliers(); return D.cache.suppliers; };
  D.suppliers = async function () { return D.cache.suppliers || (await D.refreshSuppliers()); };
  D.reasons = async function () {
    if (!D.cache.reasons) D.cache.reasons = await D.getReasons();
    return D.cache.reasons;
  };

  /* ---------- router ---------- */
  function currentRoute() {
    const h = (location.hash || "").replace(/^#\/?/, "").split("/");
    return { name: h[0] || "dashboard", arg: h[1] || "" };
  }
  D.go = (name, arg) => { location.hash = "#/" + name + (arg ? "/" + arg : ""); };

  async function render() {
    const r = currentRoute();
    const fn = D.views[r.name] || D.views.dashboard;
    D.$$("#mainNav a").forEach(a => a.classList.toggle("on", a.dataset.route === r.name));
    const view = D.$("#view");
    view.innerHTML = '<div class="empty">Loading…</div>';
    try { await fn(view, r.arg); }
    catch (e) {
      console.error(e);
      view.innerHTML = '<div class="card"><div class="msg err">' + D.esc(e.message || String(e)) + "</div></div>";
    }
  }
  window.addEventListener("hashchange", render);
  D.render = render;

  /* ---------- auth ---------- */
  function showLogin(msg, kind) {
    D.$("#appShell").hidden = true;
    D.$("#loginScreen").hidden = false;
    const m = D.$("#loginMsg");
    if (msg) { m.hidden = false; m.className = "msg " + (kind || "err"); m.textContent = msg; }
    else m.hidden = true;
  }

  async function startApp(session) {
    D.$("#loginScreen").hidden = true;
    D.$("#appShell").hidden = false;
    D.$("#whoami").textContent = session.user.email;
    await D.loadSettings();
    await D.refreshSuppliers().catch(() => {});
    if (!location.hash) location.hash = "#/dashboard";
    await render();
  }

  async function boot() {
    const { data } = await D.sb.auth.getSession();
    if (data && data.session) return startApp(data.session);
    showLogin();
  }

  D.$("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = D.$("#liBtn"); btn.disabled = true; btn.textContent = "Signing in…";
    const email = D.$("#liEmail").value.trim(), password = D.$("#liPass").value;
    const { data, error } = await D.sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = "Sign in";
    if (error) return showLogin(error.message, "err");
    startApp(data.session);
  });

  D.$("#liSignup").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = D.$("#liEmail").value.trim(), password = D.$("#liPass").value;
    if (!email || password.length < 6) return showLogin("Enter your email and a password of at least 6 characters, then click again.", "warn");
    const { data, error } = await D.sb.auth.signUp({ email, password });
    if (error) return showLogin(error.message, "err");
    if (data.session) return startApp(data.session);
    showLogin("Account created. Check your email to confirm, then sign in.", "ok");
  });

  D.$("#btnLogout").addEventListener("click", async () => {
    await D.sb.auth.signOut();
    location.hash = "";
    location.reload();
  });

  D.$$("#mainNav a").forEach(a => a.addEventListener("click", () => D.go(a.dataset.route)));

  boot();
})(window.DN);
