/* Login page interactions: email sign-in and account creation. */
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
      window.location.href = "/app";
    } catch (err) {
      setError(err.message || "Unable to sign in.");
      setBusy(false);
      if (err.status === 0) {
        toast("Server offline — run python run.py in the project folder.", "danger");
      }
    }
  }

  function bind() {
    els.email = $("authEmail");
    els.password = $("authPassword");
    els.submit = $("authSubmit");
    els.submitLabel = $("authSubmitLabel");
    els.error = $("authError");
    els.errorText = $("authErrorText");

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

    const params = new URLSearchParams(window.location.search);
    if (params.get("loggedout")) {
      toast("You have been signed out safely.", "ok");
      history.replaceState({}, "", "/");
    }
    if (params.get("expired")) {
      toast("Your session expired. Please sign in again.", "warn");
      history.replaceState({}, "", "/");
    }

    // Warm up audio on the first deliberate interaction.
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
