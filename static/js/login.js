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
    $("phoneField").hidden = !register;
    els.password.autocomplete = register ? "new-password" : "current-password";
    if (els.submitLabel) els.submitLabel.textContent = register ? "Create my account" : "Sign in securely";
    setError("");
  }

  function updateGoogleLabel() {
    const button = $("googleBtn");
    if (!button) return;
    const role = state.role === "guardian" ? "guardian" : "person";
    button.setAttribute(
      "aria-label",
      "Continue with Google as " + (role === "guardian" ? "a guardian" : "a visually impaired person")
    );
  }

  function setRole(role) {
    state.role = role;
    document.querySelectorAll("[data-role]").forEach(function (btn) {
      const on = btn.dataset.role === role;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    updateGoogleLabel();
  }

  let firebaseAuthPromise = null;

  function loadFirebaseAuth() {
    if (!firebaseAuthPromise) {
      firebaseAuthPromise = (async function () {
        const config = window.SAFETY_FIREBASE_CONFIG;
        if (!config || !config.apiKey) throw new Error("Firebase is not configured.");
        const appMod = await import("https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js");
        const authMod = await import("https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js");
        const existing = appMod.getApps();
        const app = existing.length ? existing[0] : appMod.initializeApp(config);
        return { auth: authMod.getAuth(app), authMod: authMod };
      })();
      firebaseAuthPromise.catch(function () { firebaseAuthPromise = null; });
    }
    return firebaseAuthPromise;
  }

  function googleErrorMessage(code) {
    const messages = {
      "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
      "auth/operation-not-allowed": "Google sign-in is not enabled for this Firebase project. In Firebase Console open Authentication → Sign-in method and enable Google.",
      "auth/configuration-not-found": "Firebase Authentication is not set up for this project yet. Open Firebase Console → Authentication → Get started, then enable the Google sign-in method.",
      "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The Firebase web API key is not valid. Check static/js/firebase-config.js.",
      "auth/unauthorized-domain": "This address is not authorised in Firebase. Add 127.0.0.1 under Authentication → Settings → Authorized domains.",
      "auth/network-request-failed": "Could not reach Google. Check your internet connection and try again.",
      "auth/account-exists-with-different-credential": "This email is already linked with a different sign-in method. Use that method instead.",
      "auth/internal-error": "Google sign-in is temporarily unavailable. Please try again.",
    };
    return messages[code] || "";
  }

  async function continueWithGoogle() {
    if (state.busy) return;
    const button = $("googleBtn");
    if (!button || button.disabled) return;
    setError("");

    if (!window.SAFETY_FIREBASE_CONFIG || !window.SAFETY_FIREBASE_CONFIG.apiKey) {
      // Fall back to the direct Google OAuth flow when Firebase is absent.
      window.location.href = "/api/auth/google/start?role=" + (state.role === "guardian" ? "guardian" : "person");
      return;
    }

    button.disabled = true;
    const label = button.querySelector("span");
    const original = label ? label.textContent : "";
    if (label) label.textContent = "Opening Google…";
    try {
      const firebase = await loadFirebaseAuth();
      const authMod = firebase.authMod;
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await authMod.signInWithPopup(firebase.auth, provider);
      const idToken = await result.user.getIdToken();
      await api("/api/auth/firebase", {
        method: "POST",
        body: { idToken: idToken, role: state.role === "guardian" ? "guardian" : "person" },
      });
      await authMod.signOut(firebase.auth).catch(function () {});
      window.location.href = "/app";
    } catch (err) {
      const code = err && err.code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        const friendly = googleErrorMessage(code);
        setError(friendly || (err && err.message) || "Google sign-in failed. Please try again.");
      }
      button.disabled = false;
      if (label) label.textContent = original;
    }
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
    updateGoogleLabel();

    const googleBtn = $("googleBtn");
    if (googleBtn) googleBtn.addEventListener("click", continueWithGoogle);

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

    const oauth = params.get("oauth");
    if (oauth) {
      const messages = {
        unconfigured: "Google sign-in is not configured yet. Add your Google OAuth Client ID and Secret to enable it.",
        denied: "Google sign-in was cancelled.",
        state: "Google sign-in session expired. Please try again.",
        exchange: "Google could not confirm your account. Please try again.",
        email: "Google did not return a verified email address.",
      };
      toast(messages[oauth] || "Google sign-in failed. Please try again.", "warn", 7000);
      history.replaceState({}, "", "/");
    }

    const guestBtn = $("guestBtn");
    if (guestBtn) {
      guestBtn.addEventListener("click", async function () {
        if (guestBtn.disabled) return;
        guestBtn.disabled = true;
        setError("");
        try {
          await api("/api/auth/guest", { method: "POST" });
          window.location.href = "/app";
        } catch (err) {
          setError(err.message || "Guest mode is unavailable right now.");
          guestBtn.disabled = false;
          if (err.status === 0) {
            toast("Server offline — run python run.py in the project folder.", "danger");
          }
        }
      });
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
