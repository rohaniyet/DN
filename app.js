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

  /* screens an entry-only user may open */
  const ENTRY_ROUTES = ["dashboard", "notes", "note"];
  D.mayOpen = (name) => D.isAdmin() || ENTRY_ROUTES.indexOf(name) >= 0;

  async function render() {
    const r = currentRoute();
    if (!D.mayOpen(r.name)) {
      D.$("#view").innerHTML = '<div class="card"><div class="msg warn">' +
        "This screen is only for the owner login. Your account can create debit notes, " +
        "print any of them, and edit the ones you made yourself.</div></div>";
      return;
    }
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
    await D.loadProfile(session.user);
    if (!D.me.active) {
      await D.sb.auth.signOut();
      return showLogin("This account is not allowed into DN Manager.", "err");
    }
    D.$("#loginScreen").hidden = true;
    D.$("#appShell").hidden = false;
    D.$("#whoami").textContent = session.user.email + (D.isAdmin() ? "" : " · entry");
    D.$$("#mainNav a").forEach(a => { a.hidden = !D.mayOpen(a.dataset.route); });
    await D.loadSettings().catch(() => {});
    if (!location.hash) location.hash = "#/dashboard";
    await render();
    /* the supplier list is only needed once a form is opened */
    D.refreshSuppliers().catch(() => {});
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

  const signupLink = D.$("#liSignup");
  if (signupLink) signupLink.addEventListener("click", async (e) => {
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
