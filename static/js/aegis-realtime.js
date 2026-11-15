/* Safety & Emergency Assistance System — boot, realtime websocket, notifications & tickers. */
(function () {
  "use strict";

  const App = window.AegisApp;
  const A = window.Aegis;
  const state = App.state;
  const $ = App.$;

  /* ------------------------------------------------------------- connection ui */
  function setLive(on) {
    state.wsAlive = !!on;
    const pill = $("livePill");
    const label = $("liveLabel");
    if (pill) pill.classList.toggle("off", !on);
    if (label) label.textContent = on ? "Live" : "Offline";
  }

  function pingLoop() {
    if (state.pingTimer) clearInterval(state.pingTimer);
    state.pingTimer = setInterval(function () {
      const ws = state.ws;
      if (!ws || ws.readyState !== 1) return;
      try { ws.send(JSON.stringify({ type: "ping" })); } catch (e) {}
    }, 25000);
  }

  function connect() {
    if (state.ws && (state.ws.readyState === 0 || state.ws.readyState === 1)) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let ws;
    try {
      ws = new WebSocket(proto + "://" + window.location.host + "/ws");
    } catch (e) {
      scheduleReconnect();
      return;
    }
    state.ws = ws;

    ws.onopen = function () {
      state.wsRetry = 1000;
      setLive(true);
      if (state.wsEverOpen) {
        A.toast("Realtime connection restored.", "ok", 2600);
        App.refreshAll().then(function (data) { if (data) App.render(); });
      }
      state.wsEverOpen = true;
      pingLoop();
    };

    ws.onmessage = function (event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      handleEvent(msg);
    };

    ws.onclose = function (event) {
      setLive(false);
      state.ws = null;
      if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
      if (event && event.code === 4401) {
        window.location.href = "/?expired=1";
        return;
      }
      scheduleReconnect();
    };

    ws.onerror = function () {
      try { ws.close(); } catch (e) {}
    };
  }

  function scheduleReconnect() {
    setLive(false);
    const delay = Math.min(15000, state.wsRetry || 1000);
    state.wsRetry = Math.min(15000, delay * 1.7);
    setTimeout(connect, delay);
  }

  /* ------------------------------------------------------------- event handlers */
  function ensurePerson(personId) {
    const p = App.findPerson(personId);
    return p;
  }

  function pushStatusHistory(person, status) {
    if (!person || !status) return;
    person.statusHistory = person.statusHistory || [];
    if (!person.statusHistory.some(function (s) { return s.id === status.id; })) {
      person.statusHistory.unshift(status);
      person.statusHistory = person.statusHistory.slice(0, 40);
    }
  }

  function handleEvent(msg) {
    if (!msg || !msg.type) return;
    const type = msg.type;

    if (type === "hello") {
      setLive(true);
      return;
    }
    if (type === "pong") return;

    if (type === "location") {
      handleLocation(msg);
      return;
    }
    if (type === "status") {
      handleStatus(msg);
      return;
    }
    if (type === "alert") {
      handleAlert(msg);
      return;
    }
    if (type === "alert:update") {
      handleAlertUpdate(msg);
      return;
    }
    if (type === "message") {
      handleMessage(msg);
      return;
    }
    if (type === "checkin:request") {
      handleCheckinRequest(msg);
      return;
    }
    if (type === "checkin:fulfilled") {
      A.toast(App.activePersonUser() ? A.firstName(App.activePersonUser().name) + " completed the requested check-in." : "Check-in completed.", "ok");
      return;
    }
  }

  function handleLocation(msg) {
    const loc = msg.location;
    if (!loc) return;

    if (App.isPerson() && msg.personId === (state.me && state.me.id)) {
      if (state.dash) state.dash.location = loc;
      state.ownTrail.push(loc);
      if (state.ownTrail.length > 400) state.ownTrail.shift();
      if (state.mapObj && state.mapObj.elId === "personMap") {
        App.updateMapMarker(loc);
        App.refreshLiveText(loc);
      }
      return;
    }

    const person = ensurePerson(msg.personId);
    if (person) person.location = loc;
    const activeId = App.activePersonId();
    if (msg.personId === activeId) {
      if (state.mapObj && (state.mapObj.elId === "guardianMap" || state.mapObj.elId === "historyMap")) {
        if (state.mapObj.elId === "guardianMap") {
          App.updateMapMarker(loc);
          App.refreshLiveText(loc);
        }
      } else if (!document.getElementById("guardianMap")) {
        /* nothing to update visually */
      }
      if (state.trail.personId === msg.personId && state.trail.points.length) {
        state.trail.points.push(loc);
        if (state.trail.points.length > 600) state.trail.points.shift();
      }
    }
  }

  function handleStatus(msg) {
    const status = msg.status;
    if (!status) return;

    if (App.isPerson() && msg.personId === (state.me && state.me.id)) {
      if (state.dash) {
        state.dash.status = status;
        const history = state.dash.statusHistory || [];
        if (!history.some(function (s) { return s.id === status.id; })) {
          state.dash.statusHistory = [status].concat(history).slice(0, 40);
        }
      }
      App.render();
      return;
    }

    const person = ensurePerson(msg.personId);
    pushStatusHistory(person, status);
    if (person) person.status = status;
    if (msg.personId === App.activePersonId() && !state.sos.holding) {
      const info = App.statusInfo(status.state);
      A.toast((person ? A.firstName(person.user.name) : "They") + " is " + info.label.toLowerCase() + ".", status.state === "help" ? "danger" : "ok");
      App.render();
    }
  }

  function handleAlert(msg) {
    const alert = msg.alert;
    if (!alert) return;
    const alreadySeen = state.seenAlerts.has(alert.id);
    state.seenAlerts.add(alert.id);
    App.applyAlertToDash(alert);

    if (App.isPerson() && alert.personId === (state.me && state.me.id)) {
      App.render();
      return;
    }
    if (alreadySeen) return;

    const person = ensurePerson(alert.personId);
    if (person) alert.personName = alert.personName || person.user.name;
    App.notifyAlert(alert);
    A.toast((alert.personName ? A.firstName(alert.personName) : "Someone") + " raised a " + App.alertTypeLabel(alert.type) + " alert.", "danger", 7000);
    App.render();
  }

  function handleAlertUpdate(msg) {
    const alert = msg.alert;
    if (!alert) return;
    state.seenAlerts.add(alert.id);
    App.applyAlertToDash(alert);
    if (alert.status === "resolved" && state.emergencyOpen === alert.id) {
      const overlay = document.getElementById("emergencyOverlay");
      if (overlay) overlay.remove();
      state.emergencyOpen = null;
    }
    if (state.alerts.personId === alert.personId) {
      state.alerts.data = (state.alerts.data || []).map(function (a) { return a.id === alert.id ? alert : a; });
    }
    App.render();
    if (alert.status === "acknowledged") {
      A.toast("Alert acknowledged" + (alert.ackedBy ? " by " + alert.ackedBy : "") + ".", "info");
    }
    if (alert.status === "resolved") {
      A.toast("Alert resolved. " + (App.activePersonUser() ? A.firstName(App.activePersonUser().name) + " is marked safe." : "All clear."), "ok");
    }
  }

  function handleMessage(msg) {
    const m = msg.message;
    if (!m || !state.me) return;
    const mine = m.fromId === state.me.id;
    const peerId = mine ? m.toId : m.fromId;

    const peers = App.peersList();
    const peer = peers.find(function (p) { return p.id === peerId; });

    if (state.view === "messages" && state.chat.peerId === peerId) {
      if (state.chat.thread && state.chat.thread.peer && state.chat.thread.peer.id === peerId) {
        if (!state.chat.thread.messages.some(function (x) { return x.id === m.id; })) {
          state.chat.thread.messages.push(m);
        }
      } else {
        App.loadThread(peerId, { silent: true });
        return;
      }
      App.render();
      return;
    }

    if (!mine && peer) {
      peer.unread = (peer.unread || 0) + 1;
      const who = state.chat.peerId === peerId ? A.firstName(peer.name) : peer.name;
      A.browserNotify("New message from " + who, m.text, "msg-" + m.id);
      A.toast(who + ": " + m.text, "info", 6200);
      if (App.settings().voice) App.say("New message from " + who);
    }
    App.render();
  }

  function handleCheckinRequest(msg) {
    if (!App.isPerson()) return;
    const req = msg.request;
    if (!req) return;
    if (state.dash) {
      state.dash.checkinRequests = [req].concat(state.dash.checkinRequests || []);
    }
    A.sound("alert");
    A.toast(req.guardianName + " asked for a quick check-in.", "warn", 6000);
    A.browserNotify("Check-in requested", req.guardianName + " would like to know that you are safe.", "chk-" + req.id);
    App.say(req.guardianName + " asked for a check-in. Please tell us how you are.");
    App.render();
  }

  /* ------------------------------------------------------------- clocks */
  function refreshRelativeTimes() {
    document.querySelectorAll("[data-rel]").forEach(function (el) {
      const ts = el.getAttribute("data-rel");
      if (ts) el.textContent = A.timeAgo(ts);
    });
  }

  function startTickers() {
    setInterval(refreshRelativeTimes, 20000);
    setInterval(function () {
      if (!document.hidden) App.tickCheckin();
    }, 1000);
    setInterval(function () {
      if (document.hidden) return;
      App.refreshAll().then(function (data) {
        if (!data) return;
        if (state.view === "history" && !state.history.data) App.loadHistory(true);
        if (state.view === "alerts" && !state.alerts.data) App.loadAlerts(true);
        App.render();
      });
    }, 180000);
  }

  /* ------------------------------------------------------------- boot */
  let bootWatchdog = null;

  function showBootError(message) {
    const root = document.getElementById("appRoot");
    if (!root) return;
    root.innerHTML =
      '<div class="empty" style="min-height:50vh">' +
        A.icon("alert") +
        "<strong>Cannot reach the safety server</strong>" +
        "<span>" + A.escapeHtml(message) + "</span>" +
        '<button class="btn btn-primary" type="button" id="bootRetry" style="margin-top:1rem">Try again</button>' +
      "</div>";
    const retry = document.getElementById("bootRetry");
    if (retry) retry.addEventListener("click", function () { window.location.reload(); });
  }

  async function boot() {
    bootWatchdog = setTimeout(function () {
      if (!state.booted) showBootError("The server is taking longer than expected. Check that it is running, then try again.");
    }, 12000);

    let me;
    try {
      me = await A.api("/api/me");
    } catch (err) {
      if (err.status === 401) {
        window.location.href = "/?expired=1";
        return;
      }
      showBootError("The server did not respond. Make sure it is running, then try again.");
      return;
    }

    state.me = me;
    if (me.settings && window.AegisTheme) {
      const localTheme = (function () {
        try { return localStorage.getItem("aegis.theme"); } catch (e) { return null; }
      })();
      if (!localTheme) {
        window.AegisTheme.applyAll({
          theme: me.settings.theme,
          textScale: me.settings.textScale,
          reduceMotion: me.settings.reduceMotion,
          highContrast: me.settings.highContrast,
        });
      }
    }

    const dash = await App.loadDashboard(true);
    if (!dash) {
      showBootError("Your console could not be loaded. Check your connection, then try again.");
      return;
    }
    state.me = dash.me || me;
    state.booted = true;
    if (bootWatchdog) {
      clearTimeout(bootWatchdog);
      bootWatchdog = null;
    }

    if (App.isPerson()) {
      state.view = "home";
      App.resetCheckinTimer();
    } else {
      const people = dash.people || [];
      state.selected = people.length ? people[0].user.id : null;
      state.view = "home";
    }

    App.render();
    connect();
    startTickers();

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        if (!state.ws || state.ws.readyState > 1) connect();
        refreshRelativeTimes();
      }
    });

    window.addEventListener("online", function () {
      if (!state.ws || state.ws.readyState > 1) connect();
    });

    window.addEventListener("aegis:appearance", function () {
      const map = state.mapObj;
      if (map && map.line) {
        const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
        if (color) {
          try { map.line.setStyle({ color: color }); } catch (e) {}
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.AegisRealtime = { connect: connect };
})();
