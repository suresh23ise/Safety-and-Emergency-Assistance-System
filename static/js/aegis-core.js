/* Aegis Assist — shared state & small helpers (classic script, exposes AegisApp). */
(function () {
  "use strict";

  const state = {
    me: null,
    dash: null,
    view: "home",
    selected: null,
    ws: null,
    wsAlive: false,
    wsRetry: 1000,
    wsEverOpen: false,
    pingTimer: null,
    mapObj: null,
    ownTrail: [],
    trail: { personId: null, points: [], loaded: false, loading: false, failed: false },
    history: { personId: null, days: 7, tab: "locations", data: null, loading: false, failed: false },
    alerts: { personId: null, data: null, loading: false, failed: false },
    alertsFilter: "all",
    chat: { peerId: null, thread: null, loading: false, draft: "", focus: false },
    sos: { holding: false, timer: null, complete: false, remaining: 5, countdown: null, esc: null },
    share: { on: false, watchId: null, timer: null, demoStep: 0, lastPost: 0, started: false },
    checkin: { next: 0, tick: null, timer: null, busy: false },
    popover: null,
    seenAlerts: new Set(),
    pendingRender: false,
    booted: false,
    follow: true,
    statusNoteDraft: "",
    soundOn: true,
    notifAsked: false,
    emergencyOpen: null,
  };

  const $ = (id) => document.getElementById(id);

  const isGuest = () => !!(state.me && state.me.role === "guest");
  const isPerson = () => !!(state.me && state.me.role === "person");
  const isGuardian = () => !!(state.me && (state.me.role === "guardian" || state.me.role === "guest"));
  const readOnlyAttr = () => (isGuest() ? "disabled" : "");
  const settings = () => (state.me && state.me.settings) || {};

  function selectedPerson() {
    if (!state.dash || !state.dash.people) return null;
    return state.dash.people.find((p) => p.user.id === state.selected) || state.dash.people[0] || null;
  }

  function activePersonId() {
    if (isPerson()) return state.me ? state.me.id : null;
    const p = selectedPerson();
    return p ? p.user.id : null;
  }

  function activePersonUser() {
    if (isPerson()) return state.me;
    const p = selectedPerson();
    return p ? p.user : null;
  }

  function findPerson(personId) {
    if (!state.dash || !state.dash.people) return null;
    return state.dash.people.find((p) => p.user.id === personId) || null;
  }

  function peersList() {
    if (!state.dash) return [];
    if (isPerson()) return state.dash.guardians || [];
    return (state.dash.people || []).map((p) => p.user);
  }

  function statusInfo(value) {
    const map = {
      safe: { label: "Safe", cls: "ok", tone: "ok", icon: "shield", title: "I'm safe", verb: "is safe" },
      checkin: { label: "Checked in", cls: "ok", tone: "ok", icon: "check", title: "Checked in", verb: "checked in" },
      help: { label: "Needs help", cls: "danger", tone: "danger", icon: "alert", title: "Needs help", verb: "needs help" },
      uncomfortable: { label: "Uncomfortable", cls: "warn", tone: "warn", icon: "alert", title: "Uncomfortable", verb: "feels uncomfortable" },
    };
    return map[value] || { label: "No status yet", cls: "plain", tone: "", icon: "clock", title: "No status yet", verb: "has not checked in yet" };
  }

  function alertTypeLabel(type) {
    return type === "sos" ? "SOS" : type === "emergency" ? "Emergency" : "Alert";
  }

  function sourceLabel(source) {
    return (
      {
        device: "Device GPS",
        simulated: "Simulated feed",
        demo: "Demo GPS",
        auto: "Automatic",
        "auto-checkin": "Auto check-in",
        manual: "Manual",
        sos: "SOS",
      }[source] || source || "Manual"
    );
  }

  function telHref(phone) {
    const clean = String(phone || "").replace(/[^\d+]/g, "");
    return clean ? "tel:" + clean : "";
  }

  function coordText(loc) {
    if (!loc) return "—";
    return Number(loc.lat).toFixed(5) + ", " + Number(loc.lng).toFixed(5);
  }

  function fmtKm(meters) {
    const m = Number(meters) || 0;
    if (m < 1000) return Math.round(m) + " m";
    return (m / 1000).toFixed(1) + " km";
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  function navItems() {
    if (isPerson()) {
      return [
        { id: "home", label: "Home", icon: "shield" },
        { id: "history", label: "My history", icon: "history" },
        { id: "messages", label: "Messages", icon: "message" },
      ];
    }
    if (isGuest()) {
      return [
        { id: "home", label: "Overview", icon: "shield" },
        { id: "map", label: "Live map", icon: "pin" },
        { id: "alerts", label: "Alerts", icon: "alert" },
        { id: "history", label: "History", icon: "history" },
      ];
    }
    return [
      { id: "home", label: "Overview", icon: "shield" },
      { id: "map", label: "Live map", icon: "pin" },
      { id: "alerts", label: "Alerts", icon: "alert" },
      { id: "history", label: "History", icon: "history" },
      { id: "messages", label: "Messages", icon: "message" },
    ];
  }

  function activeAlertCount() {
    if (!state.dash) return 0;
    if (isPerson()) return (state.dash.activeAlerts || []).length;
    return (state.dash.people || []).reduce((sum, p) => sum + ((p.activeAlerts || []).length), 0);
  }

  function unreadMessages() {
    if (!state.dash) return 0;
    if (isPerson()) return (state.dash.guardians || []).reduce((n, g) => n + (g.unread || 0), 0);
    return (state.dash.people || []).reduce((n, p) => n + (p.unread || 0), 0);
  }

  function latestAlertFor(personId) {
    if (!state.dash) return null;
    if (state.dash.people) {
      const p = findPerson(personId);
      if (p && p.activeAlerts && p.activeAlerts.length) return p.activeAlerts[0];
    }
    const pool = isPerson() ? state.dash.activeAlerts || [] : state.dash.recentAlerts || [];
    return pool.find((a) => a.personId === personId && a.status !== "resolved") || null;
  }

  function mapFallbackHtml(loc, message) {
    const icon = window.Aegis.icon;
    return (
      '<div class="map-fallback">' +
        icon("pin") +
        "<strong>" + (loc ? "Map tiles unavailable" : "Waiting for a GPS fix") + "</strong>" +
        '<span class="mono">' + (loc ? coordText(loc) : message || "Location will appear here once sharing starts.") + "</span>" +
      "</div>"
    );
  }

  function safePhone(user) {
    return user && user.phone ? telHref(user.phone) : "";
  }

  window.AegisApp = {
    state: state,
    $: $,
    isGuest: isGuest,
    isPerson: isPerson,
    isGuardian: isGuardian,
    readOnlyAttr: readOnlyAttr,
    settings: settings,
    selectedPerson: selectedPerson,
    activePersonId: activePersonId,
    activePersonUser: activePersonUser,
    findPerson: findPerson,
    peersList: peersList,
    statusInfo: statusInfo,
    alertTypeLabel: alertTypeLabel,
    sourceLabel: sourceLabel,
    telHref: telHref,
    coordText: coordText,
    fmtKm: fmtKm,
    greeting: greeting,
    navItems: navItems,
    activeAlertCount: activeAlertCount,
    unreadMessages: unreadMessages,
    latestAlertFor: latestAlertFor,
    mapFallbackHtml: mapFallbackHtml,
    safePhone: safePhone,
  };
})();
