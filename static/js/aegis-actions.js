/* Safety & Emergency Assistance System — interactions, modals, SOS, sharing, chat, history. */
(function () {
  "use strict";

  const App = window.AegisApp;
  const A = window.Aegis;
  const state = App.state;
  const $ = App.$;
  const icon = A.icon;
  const esc = A.escapeHtml;

  /* ------------------------------------------------------------- ui helpers */
  let sheetCloser = null;

  function closeSheet() {
    if (sheetCloser) sheetCloser();
  }

  function openSheet(inner, options) {
    const opts = options || {};
    closeSheet();
    const host = $("modalRoot") || document.body;
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML =
      '<div class="sheet ' + (opts.wide ? "wide" : "") + (opts.className ? " " + opts.className : "") +
      '" role="dialog" aria-modal="true">' + inner + "</div>";
    host.appendChild(overlay);
    const lastFocus = document.activeElement;

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      sheetCloser = null;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    sheetCloser = close;
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay || event.target.closest("[data-close-sheet]")) {
        close();
        return;
      }
      const handler = event.target.closest("[data-sheet-action]");
      if (handler && opts.onAction) opts.onAction(handler.dataset.sheetAction, handler, overlay, close);
    });

    const focusable = overlay.querySelector("input, textarea, select, button");
    if (focusable) setTimeout(function () { focusable.focus(); }, 60);
    if (opts.onOpen) opts.onOpen(overlay, close);
    return { el: overlay, close: close };
  }

  function announce(text) {
    const live = $("liveRegion");
    if (!live) return;
    live.textContent = "";
    setTimeout(function () { live.textContent = text; }, 30);
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.98;
      utter.pitch = 1;
      utter.volume = 1;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  function say(text) {
    announce(text);
    if (App.settings().voice || state.me && state.me.role === "person") speak(text);
  }

  function refreshMe(user) {
    if (!user) return;
    state.me = Object.assign({}, state.me || {}, user);
    if (state.dash) state.dash.me = state.me;
    if (user.settings && window.AegisTheme) {
      window.AegisTheme.applyAll({
        theme: user.settings.theme,
        textScale: user.settings.textScale,
        reduceMotion: user.settings.reduceMotion,
        highContrast: user.settings.highContrast,
      });
    }
  }

  /* ------------------------------------------------------------- data loading */
  async function loadDashboard(quiet) {
    try {
      const data = await A.api("/api/dashboard");
      state.dash = data;
      state.me = Object.assign({}, data.me || state.me || {});
      if (data.people && data.people.length) {
        if (!data.people.some(function (p) { return p.user.id === state.selected; })) {
          state.selected = data.people[0].user.id;
        }
      }
      if (data.recentAlerts) {
        data.recentAlerts.forEach(function (a) { state.seenAlerts.add(a.id); });
      }
      if (state.dash.activeAlerts) {
        state.dash.activeAlerts.forEach(function (a) { state.seenAlerts.add(a.id); });
      }
      return state.dash;
    } catch (err) {
      if (err.status === 401) {
        window.location.href = "/?expired=1";
        return null;
      }
      if (!quiet) A.toast(err.message || "Could not load your console.", "danger");
      return null;
    }
  }

  async function ensureTrail() {
    if (!App.isGuardian()) return;
    const personId = App.activePersonId();
    if (!personId) return;
    if (state.trail.personId === personId && (state.trail.loaded || state.trail.loading)) return;
    state.trail = { personId: personId, points: [], loaded: false, loading: true, failed: false };
    try {
      const data = await A.api("/api/people/" + encodeURIComponent(personId) + "/locations?limit=120");
      if (state.trail.personId !== personId) return;
      state.trail.points = data.locations || [];
      state.trail.loaded = true;
      state.trail.loading = false;
      state.trail.failed = false;
      if (state.mapObj && state.mapObj.elId === "guardianMap") {
        const p = App.selectedPerson();
        if (p) {
          App.initMap("guardianMap", state.trail.points.concat(p.location ? [p.location] : []), p.user);
        }
      }
    } catch (err) {
      state.trail.loading = false;
      state.trail.failed = true;
    }
  }

  async function loadAlerts(force) {
    if (!App.isGuardian()) return;
    const personId = App.activePersonId();
    if (!personId) return;
    if (!force && state.alerts.personId === personId && state.alerts.data) return;
    state.alerts = { personId: personId, data: state.alerts.data || [], loading: true, failed: false };
    App.render();
    try {
      const data = await A.api("/api/people/" + encodeURIComponent(personId) + "/alerts?limit=200");
      state.alerts.data = data.alerts || [];
      state.alerts.loading = false;
    } catch (err) {
      state.alerts.loading = false;
      state.alerts.failed = true;
      A.toast(err.message || "Could not load alerts.", "danger");
    }
    App.render();
  }

  async function loadHistory(force) {
    const personId = App.activePersonId();
    if (!personId) return;
    if (!force && state.history.personId === personId && state.history.data) return;
    state.history.personId = personId;
    state.history.loading = true;
    state.history.failed = false;
    App.render();
    try {
      const data = await A.api(
        "/api/people/" + encodeURIComponent(personId) + "/history?days=" + state.history.days
      );
      if (state.history.personId !== personId) return;
      state.history.data = data;
      state.history.loading = false;
    } catch (err) {
      state.history.loading = false;
      state.history.failed = true;
      A.toast(err.message || "Could not load history.", "danger");
    }
    App.render();
  }

  async function loadThread(peerId, options) {
    if (!peerId) return;
    const opts = options || {};
    state.chat.peerId = peerId;
    if (!state.chat.thread || !state.chat.thread.peer || state.chat.thread.peer.id !== peerId) {
      state.chat.thread = null;
    }
    state.chat.loading = true;
    if (!opts.silent) App.render();
    try {
      const data = await A.api("/api/messages/" + encodeURIComponent(peerId));
      if (state.chat.peerId !== peerId) return;
      state.chat.thread = data;
      state.chat.loading = false;
      const peer = App.peersList().find(function (p) { return p.id === peerId; });
      if (peer) peer.unread = 0;
    } catch (err) {
      state.chat.loading = false;
      if (!opts.silent) A.toast(err.message || "Could not load messages.", "danger");
    }
    App.render();
  }

  /* ------------------------------------------------------------- navigation */
  function go(view) {
    if (!view) return;
    closePopover();
    state.view = view;
    state.chat.focus = false;
    App.render();
    if (view === "history") loadHistory();
    if (view === "alerts") loadAlerts();
    if (view === "map") ensureTrail();
    if (view === "messages") {
      const peers = App.peersList();
      if (peers.length) loadThread(state.chat.peerId || peers[0].id);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ------------------------------------------------------------- popovers */
  function closePopover() {
    const node = document.getElementById("popover");
    if (node) node.remove();
    state.popover = null;
  }

  function buildPopover(kind) {
    const el = document.createElement("div");
    el.className = "popover";
    el.id = "popover";
    el.setAttribute("role", kind === "notifications" ? "dialog" : "menu");

    if (kind === "profile") {
      const me = state.me || {};
      el.innerHTML =
        '<div class="menu-user">' + A.avatar(me, 40) +
          "<div><strong>" + esc(me.name || "You") + "</strong><small>" + esc(me.email || "") + "</small></div>" +
          '<span class="chip plain" style="margin-left:auto">' + esc(me.role === "person" ? "Person" : "Guardian") + "</span>" +
        "</div>" +
        '<div class="menu-sep"></div>' +
        '<button class="menu-item" type="button" data-action="edit-profile">' + icon("user") + " Edit profile</button>" +
        '<button class="menu-item" type="button" data-open-themes>' + icon("palette") + " Appearance &amp; accessibility</button>" +
        '<button class="menu-item" type="button" data-action="toggle-notifications">' + icon("bell") + " Desktop notifications</button>" +
        (App.isPerson()
          ? '<button class="menu-item" type="button" data-action="invite">' + icon("users") + " Invite a guardian</button>"
          : '<button class="menu-item" type="button" data-action="link-person">' + icon("plus") + " Link another person</button>") +
        '<div class="menu-sep"></div>' +
        '<button class="menu-item danger" type="button" data-action="logout">' + icon("logout") + " Sign out</button>";
      return el;
    }

    const items = notificationItems();
    el.innerHTML =
      '<div class="popover-head"><strong>Notifications</strong>' +
        (App.isGuardian()
          ? '<button class="link" type="button" data-action="notify-permission">Enable desktop</button>'
          : '<button class="link" type="button" data-view="alerts">View all</button>') +
      "</div>" +
      (items.length
        ? items.map(function (it) {
            return '<button class="notif-item" type="button" data-action="notif-open" data-view="' + esc(it.view) + '">' +
              '<span class="n-ico ' + esc(it.tone === "ok" ? "ok" : "") + '">' + icon(it.icon) + "</span>" +
              "<span><p>" + esc(it.title) + "</p><small>" + esc(it.time) + "</small></span></button>";
          }).join("")
        : '<p class="menu-note">You are all caught up. SOS alerts, check-in requests and messages will appear here.</p>') +
      '<div class="menu-sep"></div>' +
      '<button class="menu-item" type="button" data-view="alerts">' + icon("alert") + " Open alert centre</button>";
    return el;
  }

  function notificationItems() {
    const out = [];
    if (!state.dash) return out;
    if (App.isPerson()) {
      (state.dash.alerts || []).slice(0, 4).forEach(function (a) {
        out.push({
          icon: "alert",
          tone: a.status === "resolved" ? "ok" : "danger",
          title: App.alertTypeLabel(a.type) + " · " + (a.status === "resolved" ? "resolved" : a.status === "acknowledged" ? "acknowledged" : "active"),
          time: A.timeAgo(a.ts),
          view: "history",
        });
      });
      (state.dash.checkinRequests || []).forEach(function (r) {
        out.push({ icon: "bell", tone: "accent", title: r.guardianName + " asked for a check-in", time: A.timeAgo(r.ts), view: "home" });
      });
    } else {
      (state.dash.recentAlerts || []).slice(0, 5).forEach(function (a) {
        out.push({
          icon: "alert",
          tone: a.status === "resolved" ? "ok" : "danger",
          title: (a.personName ? a.personName.split(" ")[0] + " · " : "") + App.alertTypeLabel(a.type) + " " + a.status,
          time: A.timeAgo(a.ts),
          view: "alerts",
        });
      });
      (state.dash.people || []).forEach(function (p) {
        if (p.unread) {
          out.push({ icon: "message", title: p.unread + " new message" + (p.unread > 1 ? "s" : "") + " from " + p.user.name, time: "now", view: "messages" });
        }
      });
    }
    return out.sort(function (a, b) { return 0; }).slice(0, 6);
  }

  function togglePopover(kind) {
    if (state.popover === kind) {
      closePopover();
      return;
    }
    closePopover();
    const el = buildPopover(kind);
    document.body.appendChild(el);
    state.popover = kind;
  }

  document.addEventListener("click", function (event) {
    if (!state.popover) return;
    if (event.target.closest("#popover") || event.target.closest("[data-action='profile']") || event.target.closest("[data-action='notifications']")) return;
    closePopover();
  });

  /* ------------------------------------------------------------- status */
  async function postStatus(value) {
    const noteEl = $("statusNote");
    const note = (noteEl && noteEl.value.trim()) || "";
    try {
      const data = await A.api("/api/status", { method: "POST", body: { state: value, note: note, source: "manual" } });
      const st = data.status || data;
      if (state.dash) {
        state.dash.status = st;
        state.dash.statusHistory = [st].concat(state.dash.statusHistory || []).slice(0, 40);
        state.dash.checkinRequests = [];
      }
      if (noteEl) noteEl.value = "";
      state.statusNoteDraft = "";
      const info = App.statusInfo(value);
      A.toast("Status shared with your guardians: " + info.label + ".", "ok");
      say("Status sent. Your guardians can see that you are " + info.label.toLowerCase() + ".");
      if (value === "safe" || value === "checkin") resetCheckinTimer();
      App.render();
    } catch (err) {
      A.toast(err.message || "Could not share your status.", "danger");
    }
  }

  /* ------------------------------------------------------------- SOS */
  function alertLocation() {
    if (App.isPerson()) return state.dash && state.dash.location;
    const p = App.selectedPerson();
    return p && p.location;
  }

  async function sendAlert(type, message) {
    const loc = alertLocation();
    try {
      const data = await A.api("/api/alerts", {
        method: "POST",
        body: {
          type: type,
          message: message || "",
          lat: loc ? loc.lat : null,
          lng: loc ? loc.lng : null,
        },
      });
      const alert = data.alert || data;
      if (state.dash) {
        state.dash.alerts = [alert].concat(state.dash.alerts || []);
        state.dash.activeAlerts = [alert].concat(state.dash.activeAlerts || []);
      }
      state.seenAlerts.add(alert.id);
      A.sound(type === "sos" ? "sos" : "alert");
      return alert;
    } catch (err) {
      A.toast(err.message || "Could not send the alert.", "danger");
      return null;
    }
  }

  function sosConfirm() {
    let seconds = 5;
    let done = false;
    const sheet = openSheet(
      '<div class="sos-confirm">' +
        '<div class="confirm-icon">' + icon("alert") + "</div>" +
        "<h2>Send SOS?</h2>" +
        "<p>Every guardian will get an emergency alert with your live location and a link to this console.</p>" +
        '<div class="countdown-ring" id="sosCount">' + seconds + "</div>" +
        '<p class="small faint">Sending automatically…</p>' +
        '<div class="countdown-bar"><span id="sosBar"></span></div>' +
        '<div class="hstack wrap" style="justify-content:center">' +
          '<button class="btn btn-danger" type="button" id="sosSendNow">' + icon("alert") + " Send SOS now</button>" +
          '<button class="btn btn-ghost" type="button" id="sosCancel">Cancel</button>' +
        "</div>" +
      "</div>"
    );

    const countEl = document.getElementById("sosCount");
    const barEl = document.getElementById("sosBar");
    const timer = setInterval(function () {
      seconds -= 1;
      if (countEl) countEl.textContent = String(Math.max(0, seconds));
      if (barEl) barEl.style.width = Math.max(0, (seconds / 5) * 100) + "%";
      if (seconds <= 0) finish(true);
    }, 1000);

    async function finish(shouldSend) {
      if (done) return;
      done = true;
      clearInterval(timer);
      sheet.close();
      if (!shouldSend) {
        A.toast("SOS cancelled. Nothing was sent.", "info");
        return;
      }
      const alert = await sendAlert("sos", "");
      if (alert) {
        say("SOS sent. Your guardians have been alerted with your location.");
        A.toast("SOS sent. Your guardians have been alerted.", "ok", 6000);
        applyAlertToDash(alert);
        App.render();
      }
    }

    const cancelBtn = document.getElementById("sosCancel");
    const sendBtn = document.getElementById("sosSendNow");
    if (cancelBtn) cancelBtn.addEventListener("click", function () { finish(false); });
    if (sendBtn) sendBtn.addEventListener("click", function () { finish(true); });
  }

  function emergencyDialog() {
    const loc = alertLocation();
    const sheet = openSheet(
      '<div class="sheet-head"><div><p class="eyebrow">Emergency</p><h2>Send an emergency alert</h2>' +
        "<p>Your guardians receive this immediately, together with your current position.</p></div>" +
        '<button class="close-btn" type="button" data-close-sheet aria-label="Close">' + icon("x") + "</button></div>" +
      '<div class="vstack">' +
        '<div class="field"><label for="emergencyText">What is happening? (optional)</label>' +
          '<textarea class="input" id="emergencyText" maxlength="400" placeholder="I feel unsafe, please call me."></textarea></div>' +
        '<div class="chip plain">' + icon("pin") + " " + esc(loc ? App.coordText(loc) : "Last known location will be attached") + "</div>" +
        '<div class="hstack wrap" style="margin-top:.4rem">' +
          '<button class="btn btn-danger" type="button" id="emergencySend">' + icon("alert") + " Send emergency alert</button>" +
          '<button class="btn btn-ghost" type="button" data-close-sheet>Cancel</button>' +
          '<a class="btn btn-ghost" href="tel:112">' + icon("phone") + " Call 112</a>" +
        "</div>" +
      "</div>"
    );

    const input = document.getElementById("emergencyText");
    const send = document.getElementById("emergencySend");
    if (send) {
      send.addEventListener("click", async function () {
        send.disabled = true;
        const alert = await sendAlert("emergency", input ? input.value.trim() : "");
        sheet.close();
        if (alert) {
          applyAlertToDash(alert);
          say("Emergency alert sent to your guardians.");
          A.toast("Emergency alert sent.", "ok", 5000);
          App.render();
        }
      });
    }
  }

  function applyAlertToDash(alert) {
    if (!state.dash || !alert) return;
    if (App.isPerson()) {
      state.dash.alerts = [alert].concat((state.dash.alerts || []).filter(function (a) { return a.id !== alert.id; }));
      state.dash.activeAlerts = alert.status === "resolved"
        ? (state.dash.activeAlerts || []).filter(function (a) { return a.id !== alert.id; })
        : [alert].concat((state.dash.activeAlerts || []).filter(function (a) { return a.id !== alert.id; }));
      return;
    }
    const person = App.findPerson(alert.personId);
    if (person) {
      person.activeAlerts = alert.status === "resolved"
        ? (person.activeAlerts || []).filter(function (a) { return a.id !== alert.id; })
        : [alert].concat((person.activeAlerts || []).filter(function (a) { return a.id !== alert.id; }));
    }
    state.dash.recentAlerts = [alert].concat((state.dash.recentAlerts || []).filter(function (a) { return a.id !== alert.id; }));
    if (state.alerts.data) {
      state.alerts.data = [alert].concat(state.alerts.data.filter(function (a) { return a.id !== alert.id; }));
    }
  }

  /* ------------------------------------------------------------- sharing */
  function setSharingUi() {
    if (state.dash && state.dash.location) {
      if (!state.ownTrail.length || state.ownTrail[state.ownTrail.length - 1].ts !== state.dash.location.ts) {
        state.ownTrail.push(state.dash.location);
        if (state.ownTrail.length > 400) state.ownTrail.shift();
      }
    }
    App.render();
  }

  async function pushLocation(loc, source) {
    if (!App.isPerson()) return;
    try {
      await A.api("/api/locations", {
        method: "POST",
        body: {
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy || 12,
          speed: loc.speed == null ? null : loc.speed,
          heading: loc.heading == null ? null : loc.heading,
          source: source || "device",
        },
      });
      const stamped = Object.assign({}, loc, { ts: new Date().toISOString(), source: source || "device" });
      if (state.dash) state.dash.location = stamped;
      state.share.lastPost = Date.now();
      if (state.mapObj) {
        App.updateMapMarker(stamped);
        App.refreshLiveText(stamped);
      }
      if (state.ownTrail.length === 0 || state.ownTrail[state.ownTrail.length - 1].ts !== stamped.ts) {
        state.ownTrail.push(stamped);
      }
    } catch (err) {
      if (err.status === 403) stopSharing(true);
    }
  }

  function startDeviceGps() {
    if (!navigator.geolocation) {
      A.toast("This browser does not support location sharing.", "warn");
      return;
    }
    stopSharing(true);
    state.share.on = true;
    const minGap = Math.max(3, Number(App.settings().shareSeconds) || 5) * 1000;
    state.share.watchId = navigator.geolocation.watchPosition(
      function (pos) {
        if (Date.now() - state.share.lastPost < minGap) return;
        pushLocation(
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 15,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
          },
          "device"
        );
      },
      function (err) {
        A.toast("Location permission was not granted. Allow location access in your browser to share live position.", "warn", 5200);
        stopSharing(true);
        App.render();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    A.toast("Live location sharing is on. Guardians can follow your position.", "ok");
    App.render();
  }

  function stopSharing(quiet) {
    if (state.share.timer) {
      clearInterval(state.share.timer);
      state.share.timer = null;
    }
    if (state.share.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.share.watchId);
      state.share.watchId = null;
    }
    state.share.on = false;
    if (!quiet) A.toast("Location sharing paused.", "info");
  }

  /* ------------------------------------------------------------- check-ins */
  function resetCheckinTimer() {
    const minutes = Number(App.settings().checkinMinutes) || 10;
    state.checkin.next = Date.now() + minutes * 60 * 1000;
    updateCountdown();
  }

  function updateCountdown() {
    const el = $("checkinCountdown");
    if (!el) return;
    if (!state.checkin.next) resetCheckinTimer();
    const left = Math.max(0, state.checkin.next - Date.now());
    const total = Math.max(1, (Number(App.settings().checkinMinutes) || 10) * 60000);
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    el.textContent = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    el.style.color = left < total * 0.15 ? "var(--warn)" : "";
  }

  function tickCheckin() {
    updateCountdown();
    if (!App.isPerson()) return;
    if (!App.settings().checkinEnabled) return;
    if (state.checkin.busy || !state.checkin.next) return;
    if (Date.now() < state.checkin.next) return;
    state.checkin.busy = true;
    A.api("/api/status", { method: "POST", body: { state: "checkin", note: "Automatic safety check-in", source: "auto" } })
      .then(function (data) {
        const st = data.status || data;
        if (state.dash) {
          state.dash.status = st;
          state.dash.statusHistory = [st].concat(state.dash.statusHistory || []).slice(0, 40);
        }
        resetCheckinTimer();
        App.render();
      })
      .catch(function () { resetCheckinTimer(); })
      .finally(function () { state.checkin.busy = false; });
  }

  /* ------------------------------------------------------------- guardian actions */
  async function requestCheckin() {
    const personId = App.activePersonId();
    if (!personId) return;
    try {
      const data = await A.api("/api/checkin-requests", { method: "POST", body: { personId: personId } });
      if (data && data.alreadyPending) {
        A.toast("A check-in request is already pending.", "info");
      } else {
        A.toast("Check-in requested. " + (App.activePersonUser() ? A.firstName(App.activePersonUser().name) : "They") + " will be prompted.", "ok");
      }
    } catch (err) {
      A.toast(err.message || "Could not request a check-in.", "danger");
    }
  }

  async function updateAlert(id, action) {
    try {
      const data = await A.api("/api/alerts/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
      const alert = data.alert || data;
      applyAlertToDash(alert);
      A.sound("success");
      A.toast(action === "ack" ? "Alert acknowledged." : "Alert resolved.", "ok");
      if (state.alerts.personId) loadAlerts(true);
      App.render();
    } catch (err) {
      A.toast(err.message || "Could not update the alert.", "danger");
    }
  }

  async function linkPerson() {
    const sheet = openSheet(
      '<div class="sheet-head"><div><p class="eyebrow">Care circle</p><h2>Link a person</h2>' +
        "<p>Ask the person for their guardian link code and enter it below.</p></div>" +
        '<button class="close-btn" type="button" data-close-sheet aria-label="Close">' + icon("x") + "</button></div>" +
      '<div class="vstack">' +
        '<div class="field"><label for="linkCodeInput">Guardian link code</label>' +
          '<input class="input" id="linkCodeInput" placeholder="SAFE-XXXX" maxlength="12" style="letter-spacing:.12em;font-family:var(--font-mono);text-transform:uppercase" /></div>' +
        '<div class="form-error" id="linkError" hidden>' + icon("alert") + "<span></span></div>" +
        '<div class="hstack wrap" style="margin-top:.3rem">' +
          '<button class="btn btn-primary" type="button" id="linkSubmit">' + icon("plus") + " Link person</button>" +
          '<button class="btn btn-ghost" type="button" data-close-sheet>Cancel</button>' +
        "</div>" +
        '<p class="fineprint" style="margin-top:.4rem;text-align:left">The person you are linking can find this code in their account menu.</p>' +
      "</div>"
    );
    const input = document.getElementById("linkCodeInput");
    const errBox = document.getElementById("linkError");
    const submit = document.getElementById("linkSubmit");
    function showError(msg) {
      if (!errBox) return;
      errBox.querySelector("span").textContent = msg;
      errBox.hidden = false;
    }
    async function doLink() {
      const code = (input.value || "").trim().toUpperCase();
      if (!code) return showError("Enter the link code.");
      submit.disabled = true;
      try {
        await A.api("/api/links", { method: "POST", body: { code: code } });
        sheet.close();
        await refreshAll();
        A.toast("Person linked to your care circle.", "ok");
        state.view = "home";
        App.render();
      } catch (err) {
        showError(err.message || "Could not link this person.");
        submit.disabled = false;
      }
    }
    if (submit) submit.addEventListener("click", doLink);
    if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") doLink(); });
  }

  function inviteDialog() {
    const me = state.me || {};
    const code = me.linkCode || "—";
    const sheet = openSheet(
      '<div class="sheet-head"><div><p class="eyebrow">Care circle</p><h2>Invite a guardian</h2>' +
        "<p>Share this one-time code with someone you trust. They enter it once to see your live safety console.</p></div>" +
        '<button class="close-btn" type="button" data-close-sheet aria-label="Close">' + icon("x") + "</button></div>" +
      '<div class="vstack">' +
        '<div class="link-code-box"><div><p class="mini-label">Your guardian link code</p><span class="code" id="inviteCode">' + esc(code) + "</span></div>" +
          '<button class="btn btn-small btn-outline" type="button" id="inviteCopy">' + icon("copy") + " Copy</button></div>" +
        '<div class="hstack wrap">' +
          '<button class="btn btn-outline" type="button" id="inviteRotate">' + icon("refresh") + " Generate new code</button>" +
          '<button class="btn btn-ghost" type="button" data-close-sheet>Done</button>' +
        "</div>" +
        '<div class="help-list" style="margin-top:.6rem">' +
          "<li>" + icon("lock") + "<span>Only guardians who enter this code can see your position.</span></li>" +
          "<li>" + icon("refresh") + "<span>Generate a new code any time to revoke the old one.</span></li>" +
        "</div>" +
      "</div>"
    );
    document.getElementById("inviteCopy").addEventListener("click", function () {
      const value = (document.getElementById("inviteCode") || {}).textContent || "";
      A.copyText(value).then(function () { A.toast("Link code copied.", "ok"); }).catch(function () { A.toast("Could not copy. Select the code manually.", "warn"); });
    });
    document.getElementById("inviteRotate").addEventListener("click", async function () {
      try {
        const data = await A.api("/api/me/rotate-code", { method: "POST" });
        state.me.linkCode = data.linkCode;
        if (state.dash) state.dash.me.linkCode = data.linkCode;
        document.getElementById("inviteCode").textContent = data.linkCode;
        A.toast("New link code generated. The old one no longer works.", "ok");
      } catch (err) {
        A.toast(err.message || "Could not rotate the code.", "danger");
      }
    });
  }

  function editProfile() {
    const me = state.me || {};
    const sheet = openSheet(
      '<div class="sheet-head"><div><p class="eyebrow">Account</p><h2>Edit profile</h2>' +
        "<p>Your name and phone number are shown to the people you are linked with.</p></div>" +
        '<button class="close-btn" type="button" data-close-sheet aria-label="Close">' + icon("x") + "</button></div>" +
      '<div class="vstack">' +
        '<div class="field"><label for="profileName">Full name</label><input class="input" id="profileName" value="' + esc(me.name || "") + '" maxlength="60" /></div>' +
        '<div class="field"><label for="profilePhone">Phone</label><input class="input" id="profilePhone" value="' + esc(me.phone || "") + '" maxlength="30" /></div>' +
        '<div class="hstack wrap"><button class="btn btn-primary" type="button" id="profileSave">Save changes</button>' +
          '<button class="btn btn-ghost" type="button" data-close-sheet>Cancel</button></div>' +
      "</div>"
    );
    document.getElementById("profileSave").addEventListener("click", async function () {
      const name = document.getElementById("profileName").value.trim();
      const phone = document.getElementById("profilePhone").value.trim();
      try {
        const data = await A.api("/api/me", { method: "PATCH", body: { name: name, phone: phone } });
        refreshMe(data.user);
        sheet.close();
        await refreshAll();
        A.toast("Profile updated.", "ok");
        App.render();
      } catch (err) {
        A.toast(err.message || "Could not save your profile.", "danger");
      }
    });
  }

  async function refreshAll() {
    const data = await loadDashboard(true);
    if (data) {
      state.trail = { personId: null, points: [], loaded: false, loading: false, failed: false };
      state.alerts.personId = null;
      state.history.personId = null;
      state.history.data = null;
      state.alerts.data = null;
    }
    return data;
  }

  /* ------------------------------------------------------------- chat */
  async function sendMessage(text) {
    const peerId = state.chat.peerId;
    if (!peerId) return;
    const body = String(text || "").trim();
    if (!body) return;
    state.chat.draft = "";
    try {
      const data = await A.api("/api/messages", { method: "POST", body: { toId: peerId, text: body } });
      if (state.chat.thread && state.chat.thread.peer && state.chat.thread.peer.id === peerId) {
        state.chat.thread.messages.push(data.message);
      }
      App.render();
      const input = $("chatInput");
      if (input) input.focus();
    } catch (err) {
      state.chat.draft = body;
      A.toast(err.message || "Could not send the message.", "danger");
      App.render();
    }
  }

  /* ------------------------------------------------------------- appearance sync */
  async function saveSettings(patch) {
    try {
      const data = await A.api("/api/me", { method: "PATCH", body: { settings: patch } });
      refreshMe(data.user);
    } catch (err) {
      /* Local preference already applied; server sync is best-effort. */
    }
  }

  document.addEventListener("aegis:appearance", function (event) {
    if (!state.me || !state.booted) return;
    const a = event.detail || {};
    saveSettings({
      theme: a.theme,
      textScale: a.textScale,
      reduceMotion: a.reduceMotion,
      highContrast: a.highContrast,
    });
  });

  /* ------------------------------------------------------------- notifications */
  async function enableNotifications() {
    const result = await A.askNotifications();
    state.notifAsked = true;
    if (result === "granted") {
      A.toast("Desktop alerts enabled for this browser.", "ok");
      A.browserNotify("Safety & Emergency Assistance System", "Desktop alerts are on. You will be notified about emergencies.", "safety-ok");
    } else if (result === "unsupported") {
      A.toast("This browser does not support desktop notifications.", "warn");
    } else {
      A.toast("Desktop notifications were blocked. You can allow them in browser settings.", "warn");
    }
  }

  function notifyAlert(alert) {
    if (!alert) return;
    const name = alert.personName || (App.activePersonUser() ? App.activePersonUser().name : "Someone");
    const title = App.alertTypeLabel(alert.type) + " from " + name;
    A.browserNotify(title, alert.message || "Open the safety console now.", "alert-" + alert.id);
    if (App.settings().voice || alert.type === "sos") {
      speak(title + ". " + (alert.message || ""));
    }
    if (!App.isPerson() && alert.status === "active" && state.emergencyOpen !== alert.id) {
      showEmergencyOverlay(alert);
    }
  }

  function showEmergencyOverlay(alert) {
    state.emergencyOpen = alert.id;
    const phone = alert.personPhone;
    const existing = document.getElementById("emergencyOverlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.className = "emergency-screen";
    overlay.id = "emergencyOverlay";
    overlay.innerHTML =
      '<div class="emergency-card">' +
        '<div class="emergency-beacon">' + icon("alert") + "</div>" +
        '<p class="who">' + esc(App.alertTypeLabel(alert.type)) + " · " + esc(A.fmtTime(alert.ts)) + "</p>" +
        "<h1>" + esc(alert.personName || (App.activePersonUser() ? App.activePersonUser().name : "Emergency")) + " needs help</h1>" +
        '<p class="msg">' + esc(alert.message || "An emergency alert was raised.") + "</p>" +
        '<div class="emergency-meta">' +
          (alert.lat != null ? '<span class="chip danger">' + icon("pin") + " " + esc(App.coordText(alert)) + "</span>" : "") +
          '<span class="chip plain">' + icon("clock") + " " + esc(A.timeAgo(alert.ts)) + "</span>" +
        "</div>" +
        '<div class="emergency-actions">' +
          (phone ? '<a class="btn btn-primary" href="' + esc(App.telHref(phone)) + '">' + icon("phone") + " Call now</a>" : "") +
          '<button class="btn btn-light" type="button" data-action="ack-alert" data-id="' + esc(alert.id) + '">Acknowledge</button>' +
          '<button class="btn btn-ghost" type="button" id="emergencyReview">Open console</button>' +
        "</div>" +
        '<button class="emergency-dismiss" type="button" id="emergencyDismiss">Dismiss — I am handling it</button>' +
      "</div>";
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      state.emergencyOpen = null;
    }
    document.getElementById("emergencyDismiss").addEventListener("click", close);
    document.getElementById("emergencyReview").addEventListener("click", function () {
      close();
      go("alerts");
      loadAlerts(true);
    });
  }

  /* ------------------------------------------------------------- history export */
  function exportHistory() {
    const data = state.history.data;
    if (!data) {
      A.toast("Load the history first, then export.", "warn");
      return;
    }
    const name = (data.person && data.person.name) || "person";
    if (state.history.tab === "locations") {
      A.downloadCsv("safety-locations-" + name.replace(/\W+/g, "-").toLowerCase() + ".csv",
        (data.locations || []).map(function (p) {
          return { time: p.ts, latitude: p.lat, longitude: p.lng, accuracy_m: p.accuracy, speed_mps: p.speed, source: p.source };
        }));
    } else if (state.history.tab === "status") {
      A.downloadCsv("safety-checkins-" + name.replace(/\W+/g, "-").toLowerCase() + ".csv",
        (data.statuses || []).map(function (s) {
          return { time: s.ts, state: s.state, note: s.note, source: s.source };
        }));
    } else {
      A.downloadCsv("safety-alerts-" + name.replace(/\W+/g, "-").toLowerCase() + ".csv",
        (data.alerts || []).map(function (a) {
          return { time: a.ts, type: a.type, severity: a.severity, status: a.status, message: a.message, latitude: a.lat, longitude: a.lng, acknowledged_by: a.ackedBy, resolved_at: a.resolvedAt };
        }));
    }
    A.toast("CSV export started.", "ok");
  }

  /* ------------------------------------------------------------- logout */
  async function logout() {
    try {
      await A.api("/api/auth/logout", { method: "POST" });
    } catch (e) {}
    window.location.href = "/?loggedout=1";
  }

  function speakStatus() {
    const st = state.dash && state.dash.status;
    const loc = state.dash && state.dash.location;
    const info = App.statusInfo(st && st.state);
    const text = "Your latest status is " + info.label.toLowerCase() + ". " +
      (st && st.ts ? "Updated " + A.timeAgo(st.ts) + ". " : "") +
      (loc ? "Your last known location is " + App.coordText(loc) + "." : "Location sharing is not active.");
    speak(text);
    announce(text);
    A.toast(text, "info", 6500);
  }

  /* ------------------------------------------------------------- global events */
  document.addEventListener("click", function (event) {
    const viewBtn = event.target.closest("[data-view]");
    if (viewBtn) {
      event.preventDefault();
      go(viewBtn.dataset.view);
      return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;

    if (action === "profile") {
      event.preventDefault();
      togglePopover("profile");
      return;
    }
    if (action === "notifications") {
      event.preventDefault();
      togglePopover("notifications");
      return;
    }
    if (action === "notif-open") {
      closePopover();
      go(actionBtn.dataset.view);
      return;
    }
    if (action === "notify-permission") {
      enableNotifications();
      return;
    }
    if (action === "logout") {
      logout();
      return;
    }
    if (action === "edit-profile") {
      closePopover();
      editProfile();
      return;
    }
    if (action === "toggle-notifications") {
      closePopover();
      enableNotifications();
      return;
    }
    if (action === "status") {
      postStatus(actionBtn.dataset.state);
      return;
    }
    if (action === "sos-confirm") {
      sosConfirm();
      return;
    }
    if (action === "emergency") {
      emergencyDialog();
      return;
    }
    if (action === "recenter") {
      App.recenter();
      return;
    }
    if (action === "toggle-follow") {
      state.follow = !(state.follow !== false);
      if (state.mapObj) state.mapObj.follow = state.follow;
      App.render();
      A.toast(state.follow ? "Map will follow the live position." : "Map follow paused — pan freely.", "info", 2600);
      return;
    }
    if (action === "invite") {
      closePopover();
      inviteDialog();
      return;
    }
    if (action === "link-person") {
      closePopover();
      linkPerson();
      return;
    }
    if (action === "copy-code") {
      A.copyText(actionBtn.dataset.code || "").then(function () {
        A.toast("Link code copied.", "ok");
      }).catch(function () { A.toast("Could not copy the code.", "warn"); });
      return;
    }
    if (action === "chat") {
      closePopover();
      const peerId = actionBtn.dataset.peer;
      if (peerId) state.chat.peerId = peerId;
      state.view = "messages";
      state.chat.focus = true;
      loadThread(peerId);
      return;
    }
    if (action === "quick-message") {
      sendMessage(actionBtn.dataset.text);
      return;
    }
    if (action === "request-checkin") {
      requestCheckin();
      return;
    }
    if (action === "ack-alert") {
      const overlay = document.getElementById("emergencyOverlay");
      if (overlay) {
        overlay.remove();
        state.emergencyOpen = null;
      }
      updateAlert(actionBtn.dataset.id, "ack");
      return;
    }
    if (action === "resolve-alert") {
      const overlay = document.getElementById("emergencyOverlay");
      if (overlay) {
        overlay.remove();
        state.emergencyOpen = null;
      }
      updateAlert(actionBtn.dataset.id, "resolve");
      return;
    }
    if (action === "refresh-alerts") {
      loadAlerts(true);
      return;
    }
    if (action === "filter-alerts") {
      state.alertsFilter = actionBtn.dataset.filter || "all";
      App.render();
      return;
    }
    if (action === "history-tab") {
      state.history.tab = actionBtn.dataset.tab || "locations";
      App.render();
      if (!state.history.data) loadHistory(true);
      return;
    }
    if (action === "history-days") {
      state.history.days = Number(actionBtn.dataset.days) || 7;
      state.history.data = null;
      loadHistory(true);
      return;
    }
    if (action === "refresh-history") {
      loadHistory(true);
      return;
    }
    if (action === "export-history") {
      exportHistory();
      return;
    }
    if (action === "unlink") {
      const personId = actionBtn.dataset.person;
      const person = App.findPerson(personId);
      const sheet = openSheet(
        '<div class="sheet-head"><div><p class="eyebrow">Care circle</p><h2>Disconnect this person?</h2>' +
          "<p>You will stop receiving their safety updates and alerts. They can re-invite you at any time.</p></div>" +
          '<button class="close-btn" type="button" data-close-sheet aria-label="Close">' + icon("x") + "</button></div>" +
        '<div class="hstack wrap" style="justify-content:flex-end">' +
          '<button class="btn btn-ghost" type="button" data-close-sheet>Keep connected</button>' +
          '<button class="btn btn-danger" type="button" id="unlinkConfirm">' + icon("x") + " Disconnect " + esc(person ? A.firstName(person.user.name) : "person") + "</button>" +
        "</div>"
      );
      document.getElementById("unlinkConfirm").addEventListener("click", async function () {
        try {
          await A.api("/api/links/" + encodeURIComponent(personId), { method: "DELETE" });
          sheet.close();
          await refreshAll();
          state.selected = null;
          A.toast("Person disconnected from your care circle.", "ok");
          App.render();
        } catch (err) {
          A.toast(err.message || "Could not disconnect this person.", "danger");
        }
      });
      return;
    }
    if (action === "speak-status") {
      speakStatus();
      return;
    }
    if (action === "checkin-minutes") {
      const minutes = Number(actionBtn.dataset.minutes) || 10;
      if (state.me && state.me.settings) state.me.settings.checkinMinutes = minutes;
      resetCheckinTimer();
      saveSettings({ checkinMinutes: minutes });
      App.render();
      return;
    }
  });

  /* -------- form submits & field changes (delegated for re-rendered markup) */
  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (form && form.id === "chatForm") {
      event.preventDefault();
      const input = document.getElementById("chatInput");
      sendMessage(input ? input.value : "");
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target && event.target.id === "chatInput") {
      state.chat.draft = event.target.value;
      event.target.style.height = "44px";
      event.target.style.height = Math.min(130, event.target.scrollHeight) + "px";
    }
    if (event.target && event.target.id === "statusNote") {
      state.statusNoteDraft = event.target.value;
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.target && event.target.id === "chatInput" && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(event.target.value);
    }
  });

  document.addEventListener("change", function (event) {
    const el = event.target;
    if (!el) return;
    if (el.id === "shareToggle") {
      if (el.checked) startDeviceGps();
      else {
        stopSharing();
        App.render();
      }
      return;
    }
    if (el.id === "autoCheckinToggle") {
      const on = el.checked;
      if (state.me && state.me.settings) state.me.settings.checkinEnabled = on;
      saveSettings({ checkinEnabled: on });
      A.toast(on ? "Automatic check-ins are on." : "Automatic check-ins are off.", "info");
      return;
    }
    if (el.id === "voiceToggle") {
      const on = el.checked;
      if (state.me && state.me.settings) state.me.settings.voice = on;
      saveSettings({ voice: on });
      A.toast(on ? "Voice guidance is on." : "Voice guidance is off.", "info");
      if (on) speak("Voice guidance is on.");
      return;
    }
    if (el.id === "personSelect") {
      state.selected = el.value;
      state.trail = { personId: null, points: [], loaded: false, loading: false, failed: false };
      state.alerts = { personId: null, data: null, loading: false, failed: false };
      state.history = { personId: null, days: state.history.days, tab: state.history.tab, data: null, loading: false, failed: false };
      App.render();
      if (state.view === "history") loadHistory(true);
      if (state.view === "alerts") loadAlerts(true);
      return;
    }
  });

  /* -------- SOS press & hold (pointer + keyboard) */
  let holdTimer = null;
  let holdStart = 0;
  let holdDuration = 2000;

  function beginHold(button) {
    if (state.sos.holding) return;
    const settings = App.settings();
    holdDuration = Math.max(600, Number(settings.sosHoldMs) || 2000);
    state.sos.holding = true;
    state.sos.holdStart = Date.now();
    button.classList.add("holding");
    button.style.setProperty("--hold", holdDuration + "ms");
    button.setAttribute("aria-pressed", "true");
    announce("Hold to send SOS. Release to cancel.");
    const hint = button.querySelector(".sos-hold");
    if (hint) hint.textContent = "keep holding…";
    holdTimer = setTimeout(function () {
      endHold(button, true);
      sosConfirm();
    }, holdDuration);
  }

  function endHold(button, completed) {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (!state.sos.holding) return;
    state.sos.holding = false;
    button.classList.remove("holding");
    button.removeAttribute("aria-pressed");
    const hint = button.querySelector(".sos-hold");
    if (hint) hint.textContent = Math.round(holdDuration / 1000) + " seconds";
    if (!completed) announce("SOS cancelled.");
    if (state.pendingRender) {
      state.pendingRender = false;
      setTimeout(function () { App.render(); }, 60);
    }
  }

  document.addEventListener("pointerdown", function (event) {
    const button = event.target.closest("#sosBtn");
    if (!button) return;
    event.preventDefault();
    beginHold(button);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
    document.addEventListener(type, function (event) {
      const button = event.target.closest("#sosBtn");
      if (button && state.sos.holding) endHold(button, false);
    });
  });

  document.addEventListener("keydown", function (event) {
    const button = event.target.closest("#sosBtn");
    if (!button) return;
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      beginHold(button);
    }
  });

  document.addEventListener("keyup", function (event) {
    const button = event.target.closest("#sosBtn");
    if (button && (event.key === " " || event.key === "Enter") && state.sos.holding) {
      event.preventDefault();
      endHold(button, false);
    }
  });

  /* ------------------------------------------------------------- exports */
  Object.assign(App, {
    go: go,
    loadDashboard: loadDashboard,
    refreshAll: refreshAll,
    ensureTrail: ensureTrail,
    loadAlerts: loadAlerts,
    loadHistory: loadHistory,
    loadThread: loadThread,
    postStatus: postStatus,
    sendAlert: sendAlert,
    applyAlertToDash: applyAlertToDash,
    updateAlert: updateAlert,
    startDeviceGps: startDeviceGps,
    stopSharing: stopSharing,
    pushLocation: pushLocation,
    resetCheckinTimer: resetCheckinTimer,
    updateCountdown: updateCountdown,
    tickCheckin: tickCheckin,
    sendMessage: sendMessage,
    notifyAlert: notifyAlert,
    closePopover: closePopover,
    refreshMe: refreshMe,
    openSheet: openSheet,
    closeSheet: closeSheet,
    say: say,
    speak: speak,
    enableNotifications: enableNotifications,
  });
})();
