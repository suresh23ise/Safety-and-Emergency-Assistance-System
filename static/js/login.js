/* Login page interactions: email auth, demo SSO, guest mode. */
(function () {
  "use strict";

  const els = {};
  const state = { mode: "login", role: "person", busy: false };

  function $(id) { return document.getElementById(id); }

  function setError(message) {
    if (!els.error) return;
    if (!message) {
      els.error.hidden = true;
      els.errorText.textContent = "";
      return;
    }
    els.errorText.textContent = message;
    els.error.hidden = false;
  }

  function setBusy(busy, label) {
    state.busy = busy;
    if (!els.submit) return;
    els.submit.disabled = busy;
    els.submitLabel.textContent = busy ? label || "Please wait…" : state.mode === "login" ? "Sign in securely" : "Create my account";
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("[data-mode]").forEach(function (tab) {
      const on = tab.dataset.mode === mode;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    const register = mode === "register";
    $("nameField").hidden = !register;
    $("roleField").hidden = !register;
    $("phoneField").hidden = !register;
    els.password.autocomplete = register ? "new-password" : "current-password";
    if (els.submitLabel) els.submitLabel.textContent = register ? "Create my account" : "Sign in securely";
    setError("");
  }

  function setRole(role) {
    state.role = role;
    document.querySelectorAll("[data-role]").forEach(function (btn) {
      const on = btn.dataset.role === role;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function openEmailPanel() {
    const panel = $("emailPanel");
    if (!panel) return;
    panel.classList.add("open");
    els.emailToggle.setAttribute("aria-expanded", "true");
    setTimeout(function () {
      els.email.focus({ preventScroll: true });
      if (els.email.getBoundingClientRect().bottom > window.innerHeight - 24) {
        panel.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 220);
  }

  function closeEmailPanel() {
    const panel = $("emailPanel");
    if (!panel) return;
    panel.classList.remove("open");
    els.emailToggle.setAttribute("aria-expanded", "false");
  }

  async function go(url) {
    window.location.href = url || "/app";
  }

  async function signInWithPassword(event) {
    event.preventDefault();
    if (state.busy) return;
    setError("");

    const email = els.email.value.trim();
    const password = els.password.value;
    if (!email) return setError("Please enter your email address.");
    if (!password) return setError("Please enter your password.");

    let payload;
    if (state.mode === "register") {
      const name = $("authName").value.trim();
      if (name.length < 2) return setError("Please enter your full name.");
      if (password.length < 8) return setError("Use at least 8 characters for your password.");
      payload = {
        name: name,
        email: email,
        password: password,
        role: state.role,
        phone: $("authPhone").value.trim(),
      };
    } else {
      payload = { email: email, password: password };
    }

    setBusy(true, state.mode === "register" ? "Creating account…" : "Signing in…");
    try {
      await api(state.mode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: payload,
      });
      await go("/app");
    } catch (err) {
      setError(err.message || "Unable to sign in.");
      setBusy(false);
      if (err.status === 0) {
        toast("Server offline — run python run.py in the project folder.", "danger");
      }
    }
  }

  function demo(role, provider) {
    if (state.busy) return;
    state.busy = true;
    AegisTheme.closeDialog();
    closeRoleDialog();
    toast(role === "guest" ? "Opening guest preview…" : "Preparing your demo workspace…", "info", 2600);
    api("/api/auth/demo", { method: "POST", body: { role: role, provider: provider || "demo" } })
      .then(function () { return go("/app"); })
      .catch(function (err) {
        state.busy = false;
        toast(err.message || "Could not start the demo.", "danger");
      });
  }

  function closeRoleDialog() {
    const overlay = document.getElementById("ssoDialog");
    if (overlay) overlay.remove();
  }

  function openRoleDialog(provider) {
    closeRoleDialog();
    const isApple = provider === "apple";
    const host = $("modalRoot") || document.body;
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.id = "ssoDialog";
    overlay.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ssoTitle">' +
        '<div class="sheet-head">' +
          '<div><p class="eyebrow">Demo single sign-on</p><h2 id="ssoTitle">Continue with ' + (isApple ? "Apple" : "Google") + "</h2>" +
          "<p>OAuth credentials aren't configured in this build. Pick a demo identity to explore the full experience.</p></div>" +
          '<button class="close-btn" type="button" data-close-sso aria-label="Close">' + icon("x") + "</button>" +
        "</div>" +
        '<div class="sso-intro">' +
          '<span class="sso-logo ' + (isApple ? "apple" : "") + '">' + icon(isApple ? "apple" : "globe") + "</span>" +
          "<p><strong>Aegis Assist</strong>Demo environment · no " + (isApple ? "Apple" : "Google") + " account is contacted</p>" +
        "</div>" +
        '<div class="role-cards">' +
          '<button class="role-card" type="button" data-sso-role="person">' +
            '<span class="role-icon">' + icon("shield") + "</span>" +
            "<span><strong>Ananya Verma</strong><small>Visually impaired · shares location and SOS</small></span>" +
            icon("arrow-right", "icon arrow") +
          "</button>" +
          '<button class="role-card" type="button" data-sso-role="guardian">' +
            '<span class="role-icon">' + icon("users") + "</span>" +
            "<span><strong>Ramesh Verma</strong><small>Guardian · monitors and responds</small></span>" +
            icon("arrow-right", "icon arrow") +
          "</button>" +
        "</div>" +
        '<p class="demo-note">' + icon("lock") +
          "For production, swap <span class='mono'>/api/auth/demo</span> for a real OAuth code exchange. Everything else — sessions, roles and linking — is already implemented." +
        "</p>" +
      "</div>";
    host.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(event) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay || event.target.closest("[data-close-sso]")) {
        close();
        return;
      }
      const roleBtn = event.target.closest("[data-sso-role]");
      if (roleBtn) demo(roleBtn.dataset.ssoRole, provider);
    });
    const first = overlay.querySelector("[data-sso-role]");
    if (first) first.focus({ preventScroll: true });
  }

  function bind() {
    els.emailToggle = $("emailToggle");
    els.emailPanel = $("emailPanel");
    els.email = $("authEmail");
    els.password = $("authPassword");
    els.submit = $("authSubmit");
    els.submitLabel = $("authSubmitLabel");
    els.error = $("authError");
    els.errorText = $("authErrorText");

    els.emailToggle.addEventListener("click", function () {
      const open = els.emailPanel.classList.contains("open");
      if (open) closeEmailPanel();
      else openEmailPanel();
    });

    document.querySelectorAll("[data-mode]").forEach(function (tab) {
      tab.addEventListener("click", function () { setMode(tab.dataset.mode); });
    });

    document.querySelectorAll("[data-role]").forEach(function (btn) {
      btn.addEventListener("click", function () { setRole(btn.dataset.role); });
    });

    $("authForm").addEventListener("submit", signInWithPassword);

    $("passwordToggle").addEventListener("click", function () {
      const show = els.password.type === "password";
      els.password.type = show ? "text" : "password";
      this.setAttribute("aria-label", show ? "Hide password" : "Show password");
      this.innerHTML = icon(show ? "eye" : "lock");
      els.password.focus();
    });

    document.querySelectorAll("[data-sso]").forEach(function (button) {
      button.addEventListener("click", function () {
        openRoleDialog(button.dataset.sso);
      });
    });

    document.querySelectorAll("[data-guest]").forEach(function (button) {
      button.addEventListener("click", function () { demo("guest", "guest"); });
    });

    document.querySelectorAll("[data-demo]").forEach(function (button) {
      button.addEventListener("click", function () { demo(button.dataset.demo, "demo"); });
    });

    // Improve SSO button semantics for assistive tech.
    document.querySelectorAll(".sso[data-sso]").forEach(function (button) {
      button.setAttribute("aria-haspopup", "dialog");
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get("loggedout")) {
      toast("You have been signed out safely.", "ok");
      history.replaceState({}, "", "/");
    }
    if (params.get("expired")) {
      toast("Your session expired. Please sign in again.", "warn");
      history.replaceState({}, "", "/");
    }

    // Warm up audio + notification permission on the first deliberate click.
    document.addEventListener("click", function once() {
      try { Aegis.sound("tap"); } catch (e) {}
      document.removeEventListener("click", once);
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
