/* Safety & Emergency Assistance System — guardian console, live map, alerts & history views. */
(function () {
  "use strict";

  const App = window.AegisApp;
  const A = window.Aegis;
  const state = App.state;
  const icon = A.icon;
  const esc = A.escapeHtml;
  const avatar = A.avatar;
  const timeAgo = A.timeAgo;
  const V = () => App.views;

  function personSelect() {
    const people = (state.dash && state.dash.people) || [];
    if (!App.isGuardian() || people.length < 2) return "";
    return (
      '<label class="person-select">' + icon("users") +
        '<span class="sr-only">Choose person</span>' +
        '<select id="personSelect">' +
          people.map(function (p) {
            return '<option value="' + esc(p.user.id) + '" ' + (p.user.id === state.selected ? "selected" : "") + ">" + esc(p.user.name) + "</option>";
          }).join("") +
        "</select>" +
      "</label>"
    );
  }

  function selected() {
    const p = App.selectedPerson();
    return p;
  }

  function alertsFor(p) {
    const seen = new Set();
    const merged = [];
    (p.activeAlerts || []).concat(state.dash.recentAlerts || []).forEach(function (a) {
      if (a.personId !== p.user.id || seen.has(a.id)) return;
      seen.add(a.id);
      merged.push(a);
    });
    merged.sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });
    return merged;
  }

  function noPeopleView() {
    return V().pageHead({
      eyebrow: "Guardian console",
      title: "Your care circle is empty",
      sub: "Ask the person you care for for their guardian link code, then connect your accounts.",
      actions: '<button class="btn btn-ghost" type="button" data-action="logout">' + icon("logout") + " Sign out</button>",
    }) +
      '<section class="card" style="max-width:660px;margin:2.5rem auto;text-align:center;padding:2.5rem 1.5rem">' +
        '<div style="width:64px;height:64px;border-radius:20px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);margin:0 auto 1rem">' +
          '<svg class="icon" style="width:1.8rem;height:1.8rem"><use href="/static/assets/icons.svg#i-users"></use></svg>' +
        "</div>" +
        "<h2 style=\"font-family:var(--font-display);font-size:1.7rem\">Connect with someone you care for</h2>" +
        '<p class="muted" style="max-width:44ch;margin:.6rem auto 1.4rem;font-size:.88rem">' +
          "Every person account has a short link code (for example <span class='mono'>SAFE-XXXX</span>). Enter it once and their live safety console appears here." +
        "</p>" +
        '<div class="hstack" style="justify-content:center;flex-wrap:wrap">' +
          '<button class="btn btn-primary" type="button" data-action="link-person">' + icon("plus") + " Enter link code</button>" +
          '<button class="btn btn-ghost" type="button" data-action="logout">' + icon("logout") + " Sign out</button>" +
        "</div>" +
      "</section>";
  }

  function alertBanner(a, p) {
    const phone = p.user.phone;
    return (
      '<div class="alert-banner">' +
        '<span class="bang">' + icon("alert") + "</span>" +
        '<div class="ab-body"><strong>' + App.alertTypeLabel(a.type) + " from " + esc(A.firstName(p.user.name)) + " · " + timeAgo(a.ts) + "</strong>" +
          "<p>" + esc(a.message) + "</p></div>" +
        (a.status === "active"
          ? '<button class="btn btn-small btn-light" type="button" data-action="ack-alert" data-id="' + esc(a.id) + '">Acknowledge</button>'
          : "") +
        '<button class="btn btn-small btn-ghost" type="button" data-view="alerts">Review</button>' +
        (phone ? '<a class="btn btn-small btn-ghost" href="' + esc(App.telHref(phone)) + '">' + icon("phone") + " Call</a>" : "") +
      "</div>"
    );
  }

  function guardianHome() {
    const p = selected();
    if (!p) return noPeopleView();

    const loc = p.location;
    const st = p.status;
    const info = App.statusInfo(st && st.state);
    const active = (p.activeAlerts || [])[0];
    const settings = state.me.settings || {};
    const distance = (p.stats && p.stats.distance24h) || 0;
    const alerts7d = (p.stats && p.stats.alerts7d) || 0;
    const alerts = alertsFor(p);
    const statuses = (p.statusHistory || []).slice(0, 8);
    const phone = p.user.phone;

    const head = V().pageHead({
      eyebrow: "Guardian console",
      title: "Watching over " + A.firstName(p.user.name),
      sub:
        '<span class="dot" style="color:var(--' + (info.tone || "faint") + ')"></span>' +
        "<span>" + esc(A.firstName(p.user.name)) + " " + info.verb + "</span>" +
        '<span class="sep">·</span><span>Last GPS <span data-rel="' + esc(loc && loc.ts) + '">' + (loc ? timeAgo(loc.ts) : "pending") + "</span></span>" +
        '<span class="sep">·</span><span>' + esc(loc ? App.sourceLabel(loc.source) : "No location yet") + "</span>",
      actions:
        '<span class="chip accent">Live safety feed</span>' +
        personSelect() +
        '<button class="btn btn-outline" type="button" data-action="request-checkin"' + App.readOnlyAttr() + ">" + icon("bell") + " Request check-in</button>" +
        '<button class="btn btn-primary" type="button" data-action="chat" data-peer="' + esc(p.user.id) + '">' + icon("message") + " Message</button>",
    });

    const stats =
      '<div class="stat-grid">' +
        '<div class="stat-card"><span class="stat-icon ' + (info.tone || "") + '">' + icon(info.icon) + "</span>" +
          '<div><div class="stat-label">Current status</div><div class="stat-value">' + info.label + "</div>" +
          '<div class="stat-hint" data-rel="' + esc(st && st.ts) + '">' + (st ? timeAgo(st.ts) : "No check-in yet") + "</div></div></div>" +
        '<div class="stat-card"><span class="stat-icon"><span class="icon">' + icon("pin") + "</span></span>" +
          '<div><div class="stat-label">Last seen</div><div class="stat-value" data-live-lastseen>' + (loc ? timeAgo(loc.ts) : "—") + "</div>" +
          '<div class="stat-hint">' + (loc ? "±" + Math.round(loc.accuracy || 0) + " m accuracy" : "Waiting for signal") + "</div></div></div>" +
        '<div class="stat-card"><span class="stat-icon ok">' + icon("nav") + "</span>" +
          '<div><div class="stat-label">Distance today</div><div class="stat-value">' + esc(App.fmtKm(distance)) + "</div>" +
          '<div class="stat-hint">' + ((p.stats && p.stats.points24h) || 0) + " GPS points</div></div></div>" +
        '<div class="stat-card"><span class="stat-icon ' + (alerts7d ? "warn" : "ok") + '">' + icon("alert") + "</span>" +
          '<div><div class="stat-label">Alerts · 7 days</div><div class="stat-value">' + alerts7d + "</div>" +
          '<div class="stat-hint">' + ((p.activeAlerts || []).length ? (p.activeAlerts || []).length + " active now" : "No active alerts") + "</div></div></div>" +
      "</div>";

    const mapCard =
      '<section class="card map-card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow\">Live map</p><h2>" + (loc ? "Current position" : "Waiting for the first fix") + "</h2>" +
          '<p class="card-sub">' + (loc ? esc(App.coordText(loc)) + " · " + esc(App.sourceLabel(loc.source)) : "The map activates as soon as location is shared.") + "</p></div>" +
          '<div class="hstack wrap">' +
            '<span class="chip ' + (loc ? "ok" : "plain") + '"><span class="dot' + (loc ? " animate" : "") + '"></span>' + (loc ? "Live" : "Idle") + "</span>" +
            (loc && loc.source === "device" ? '<span class="chip info">Device GPS</span>' : "") +
            '<button class="chip ' + (state.follow === false ? "plain" : "accent") + '" type="button" data-action="toggle-follow">' + icon("nav") + " Follow</button>" +
          "</div>" +
        "</div>" +
        V().mapBox("guardianMap", "map tall", loc) +
        '<div class="map-meta">' +
          '<div><span class="mini-label">Coordinates</span><span class="mono" data-live-coords>' + esc(App.coordText(loc)) + "</span></div>" +
          '<div><span class="mini-label">Accuracy</span><span class="mono" data-live-acc>' + (loc ? "±" + Math.round(loc.accuracy || 0) + " m" : "—") + "</span></div>" +
          '<div><span class="mini-label">Updated</span><span class="mono" data-rel="' + esc(loc && loc.ts) + '">' + (loc ? timeAgo(loc.ts) : "—") + "</span></div>" +
          '<button class="btn btn-small btn-outline" type="button" data-action="recenter">' + icon("nav") + " Recenter</button>" +
        "</div>" +
      "</section>";

    const alertsCard =
      '<section class="card alerts-card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow\">Escalations</p><h2>Alerts</h2></div>" +
          '<button class="link" type="button" data-view="alerts">View all</button>' +
        "</div>" +
        (alerts.length
          ? '<div class="alert-list">' + alerts.slice(0, 4).map(function (a) { return V().alertItem(a, { showPerson: false }); }).join("") + "</div>"
          : V().emptyState("shield", "No alerts yet", "SOS and emergency alerts appear here instantly.")) +
      "</section>";

    const safetyCard =
      '<section class="card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow\">Wellbeing</p><h2>Safety check-ins</h2></div>" +
          '<button class="btn btn-small btn-outline" type="button" data-action="request-checkin"' + App.readOnlyAttr() + ">" + icon("bell") + " Request</button>" +
        "</div>" +
        '<div class="status-hero ' + (info.tone || "") + '">' +
          '<span class="big-dot">' + icon(info.icon) + "</span>" +
          "<div><h3>" + info.title + "</h3><p>" + (st ? esc(st.note || "No note attached") + " · " + timeAgo(st.ts) : "No check-in received yet.") + "</p></div>" +
          '<span class="chip ' + info.cls + '" style="margin-left:auto">' + info.label + "</span>" +
        "</div>" +
        (statuses.length
          ? '<div class="timeline">' + statuses.map(function (row) { return V().timelineItem({
              ts: row.ts,
              icon: App.statusInfo(row.state).icon,
              tone: App.statusInfo(row.state).tone,
              title: row.state === "safe" ? "Marked safe" : row.state === "checkin" ? "Safety check-in" : row.state === "help" ? "Asked for help" : "Felt uncomfortable",
              note: row.note,
              source: App.sourceLabel(row.source),
            }); }).join("") + "</div>"
          : V().emptyState("bell", "No check-ins yet", "Ask for a check-in to confirm how they are doing.")) +
      "</section>";

    const careCard =
      '<section class="card">' +
        '<div class="card-head"><div><p class="eyebrow">Care tools</p><h2>Quick actions</h2></div>' + icon("heart") + "</div>" +
        '<div class="quick-grid">' +
          '<button class="quick-tile" type="button" data-action="chat" data-peer="' + esc(p.user.id) + '">' + icon("message") + " Send a message</button>" +
          (phone ? '<a class="quick-tile" href="' + esc(App.telHref(phone)) + '">' + icon("phone") + " Call " + esc(A.firstName(p.user.name)) + "</a>"
            : '<span class="quick-tile">' + icon("phone") + " No phone on file</span>") +
          '<button class="quick-tile" type="button" data-view="history">' + icon("history") + " Review history</button>" +
          '<button class="quick-tile" type="button" data-action="toggle-notifications">' + icon("bell") + " Desktop alerts</button>" +
        "</div>" +
        '<hr class="divider" />' +
        '<div class="vstack" style="gap:.4rem">' +
          '<div class="hstack small muted"><span class="mini-label" style="width:64px">Phone</span><span>' + esc(phone || "Not provided") + "</span></div>" +
          '<div class="hstack small muted"><span class="mini-label" style="width:64px">Email</span><span class="truncate">' + esc(p.user.email) + "</span></div>" +
          '<div class="hstack small muted"><span class="mini-label" style="width:64px">Check-in</span><span>Every ' + (state.me.settings.checkinMinutes || 10) + " minutes</span></div>" +
        "</div>" +
        '<button class="btn btn-ghost btn-block" style="margin-top:.8rem" type="button" data-action="unlink" data-person="' + esc(p.user.id) + '">' + icon("x") + " Disconnect this person</button>" +
      "</section>";

    return head + (active ? alertBanner(active, p) : "") + stats +
      '<div class="guardian-grid">' + mapCard + alertsCard + "</div>" +
      '<div class="lower-grid">' + safetyCard + careCard + "</div>";
  }

  function guardianMapView() {
    const p = selected();
    if (!p) return noPeopleView();
    const loc = p.location;
    const info = App.statusInfo(p.status && p.status.state);
    const points = (state.trail && state.trail.personId === p.user.id ? state.trail.points : []).slice(-40).reverse();
    const phone = p.user.phone;

    const head = V().pageHead({
      eyebrow: "Live location",
      title: p.user.name + "'s map",
      sub: "Continuous position trail, accuracy and check-in context.",
      actions: personSelect() +
        '<button class="btn btn-outline" type="button" data-action="request-checkin"' + App.readOnlyAttr() + ">" + icon("bell") + " Check-in</button>" +
        '<button class="btn btn-primary" type="button" data-action="chat" data-peer="' + esc(p.user.id) + '">' + icon("message") + " Message</button>",
    });

    return head +
      '<div class="guardian-grid">' +
        '<section class="card map-card">' +
          '<div class="card-head">' +
            "<div><p class=\"eyebrow\">Tracking</p><h2>" + (loc ? "Live position" : "No position yet") + "</h2>" +
            '<p class="card-sub">' + esc(loc ? App.coordText(loc) : "Location sharing has not started.") + "</p></div>" +
            '<div class="hstack wrap">' +
              '<span class="chip ' + (loc ? "ok" : "plain") + '"><span class="dot' + (loc ? " animate" : "") + '"></span>' + (loc ? "Live" : "Idle") + "</span>" +
              '<button class="chip ' + (state.follow === false ? "plain" : "accent") + '" type="button" data-action="toggle-follow">Follow</button>' +
              '<button class="btn btn-small btn-outline" type="button" data-action="recenter">' + icon("nav") + " Recenter</button>" +
            "</div>" +
          "</div>" +
          V().mapBox("guardianMap", "map xtall", loc) +
          '<div class="map-meta">' +
            '<div><span class="mini-label">Accuracy</span><span class="mono" data-live-acc>' + (loc ? "±" + Math.round(loc.accuracy || 0) + " m" : "—") + "</span></div>" +
            '<div><span class="mini-label">Source</span><span>' + esc(loc ? App.sourceLabel(loc.source) : "—") + "</span></div>" +
            '<div><span class="mini-label">Trail points</span><span>' + ((state.trail && state.trail.points && state.trail.points.length) || 0) + "</span></div>" +
            '<div><span class="mini-label">Updated</span><span data-rel="' + esc(loc && loc.ts) + '">' + (loc ? timeAgo(loc.ts) : "—") + "</span></div>" +
          "</div>" +
        "</section>" +
        '<div class="stack">' +
          '<section class="card focus-card">' +
            avatar(p.user, 60) +
            '<div class="focus-copy"><h2>' + esc(p.user.name) + "</h2>" +
              "<p>" + info.label + " · last seen " + (loc ? timeAgo(loc.ts) : "—") + "</p>" +
              '<div class="hstack wrap" style="margin-top:.6rem">' + V().statusPill(p.status && p.status.state) +
                '<span class="chip plain">' + ((p.activeAlerts || []).length ? (p.activeAlerts || []).length + " active alert" : "No active alert") + "</span>" +
              "</div>" +
            "</div>" +
            '<div class="focus-actions">' +
              (phone ? '<a class="btn btn-primary" href="' + esc(App.telHref(phone)) + '">' + icon("phone") + " Call</a>" : "") +
              '<button class="btn btn-outline" type="button" data-action="chat" data-peer="' + esc(p.user.id) + '">' + icon("message") + " Message</button>" +
            "</div>" +
          "</section>" +
          '<section class="card">' +
            '<div class="card-head"><div><p class="eyebrow">Signals</p><h2>Location health</h2></div>' + icon("wifi") + "</div>" +
            '<div class="vstack small">' +
              '<div class="hstack" style="justify-content:space-between"><span class="muted">GPS accuracy</span><strong>' + (loc ? "±" + Math.round(loc.accuracy || 0) + " m" : "—") + "</strong></div>" +
              '<div class="hstack" style="justify-content:space-between"><span class="muted">Speed</span><strong>' + (loc && loc.speed != null ? Number(loc.speed).toFixed(1) + " m/s" : "—") + "</strong></div>" +
              '<div class="hstack" style="justify-content:space-between"><span class="muted">Source</span><strong>' + esc(loc ? App.sourceLabel(loc.source) : "—") + "</strong></div>" +
              '<div class="hstack" style="justify-content:space-between"><span class="muted">Coordinates</span><span class="mono" data-live-coords>' + esc(App.coordText(loc)) + "</span></div>" +
              '<div class="hstack" style="justify-content:space-between"><span class="muted">Check-ins today</span><strong>' + ((p.stats && p.stats.points24h) || 0) + "</strong></div>" +
            "</div>" +
          "</section>" +
        "</div>" +
      "</div>" +
      '<section class="card" style="margin-top:1rem">' +
        '<div class="card-head"><div><p class="eyebrow">Trail</p><h2>Recent positions</h2></div>' +
          '<button class="btn btn-small btn-outline" type="button" data-view="history">' + icon("history") + " Full history</button></div>" +
        (points.length
          ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Coordinates</th><th>Accuracy</th><th>Speed</th><th>Source</th></tr></thead><tbody>' +
            points.map(function (pt) {
              return "<tr><td data-rel=\"" + esc(pt.ts) + "\">" + timeAgo(pt.ts) + "</td><td class=\"mono\">" + esc(App.coordText(pt)) + "</td><td>" +
                Math.round(pt.accuracy || 0) + " m</td><td>" + (pt.speed != null ? Number(pt.speed).toFixed(1) + " m/s" : "—") + "</td><td>" + esc(App.sourceLabel(pt.source)) + "</td></tr>";
            }).join("") + "</tbody></table></div>"
          : V().emptyState("pin", "No trail yet", "Positions appear here as location is shared.")) +
      "</section>";
  }

  function alertsView() {
    const p = selected();
    if (!p) return noPeopleView();
    const filter = state.alertsFilter;
    const all = state.alerts.data || [];
    const list = all.filter(function (a) {
      if (filter === "active") return a.status !== "resolved";
      if (filter === "resolved") return a.status === "resolved";
      return true;
    });

    const counts = {
      all: all.length,
      active: all.filter(function (a) { return a.status !== "resolved"; }).length,
      resolved: all.filter(function (a) { return a.status === "resolved"; }).length,
    };

    const head = V().pageHead({
      eyebrow: "Guardian console",
      title: "Emergency alerts",
      sub: "Every SOS and emergency raised by " + A.firstName(p.user.name) + ".",
      actions: personSelect() +
        '<button class="btn btn-outline" type="button" data-action="refresh-alerts">' + icon("refresh") + " Refresh</button>" +
        '<button class="btn btn-primary" type="button" data-action="request-checkin"' + App.readOnlyAttr() + ">" + icon("bell") + " Request check-in</button>",
    });

    const loader = '<section class="card">' +
      '<div class="skeleton" style="height:18px;width:32%;margin-bottom:.7rem"></div>' +
      '<div class="skeleton" style="height:86px;margin-bottom:.6rem"></div>' +
      '<div class="skeleton" style="height:86px"></div></section>';

    const body = state.alerts.loading
      ? loader
      : (list.length
        ? '<div class="alert-list">' + list.map(function (a) { return V().alertItem(a, { showPerson: false, phone: p.user.phone }); }).join("") + "</div>"
        : '<section class="card">' + V().emptyState("shield", "All clear",
            filter === "all" ? "No alerts have been raised yet." : "No " + filter + " alerts to show.") + "</section>");

    return head +
      '<div class="history-toolbar">' +
        '<div class="segmented" role="group" aria-label="Filter alerts">' +
          [["all", "All"], ["active", "Active"], ["resolved", "Resolved"]].map(function (f) {
            return '<button type="button" class="' + (filter === f[0] ? "active" : "") + '" data-action="filter-alerts" data-filter="' + f[0] + '">' + f[1] + " · " + counts[f[0]] + "</button>";
          }).join("") +
        "</div>" +
        '<div class="spacer"></div>' +
        '<span class="chip plain">' + icon("users") + " " + esc(p.user.name) + "</span>" +
      "</div>" + body;
  }

  function historyTable(data) {
    if (state.history.tab === "locations") {
      const rows = (data.locations || []).slice(-140).reverse();
      return (rows.length
        ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Coordinates</th><th>Accuracy</th><th>Speed</th><th>Source</th></tr></thead><tbody>' +
          rows.map(function (pt) {
            return "<tr><td>" + esc(A.fmtDateTime(pt.ts)) + "</td><td class=\"mono\">" + esc(App.coordText(pt)) + "</td><td>" + Math.round(pt.accuracy || 0) +
              " m</td><td>" + (pt.speed != null ? Number(pt.speed).toFixed(1) + " m/s" : "—") + "</td><td>" + esc(App.sourceLabel(pt.source)) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
        : V().emptyState("pin", "No locations in this range", "Try a wider date range."));
    }
    if (state.history.tab === "status") {
      const rows = data.statuses || [];
      return (rows.length
        ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Status</th><th>Note</th><th>Source</th></tr></thead><tbody>' +
          rows.map(function (st) {
            const info = App.statusInfo(st.state);
            return "<tr><td>" + esc(A.fmtDateTime(st.ts)) + "</td><td><span class=\"chip " + info.cls + "\">" + info.label + "</span></td><td>" +
              esc(st.note || "—") + "</td><td>" + esc(App.sourceLabel(st.source)) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
        : V().emptyState("bell", "No check-ins in this range", "Try a wider date range."));
    }
    const rows = data.alerts || [];
    return (rows.length
      ? '<div class="alert-list">' + rows.map(function (a) { return V().alertItem(a, { showPerson: false }); }).join("") + "</div>"
      : V().emptyState("shield", "No alerts in this range", "Try a wider date range."));
  }

  function historyView() {
    const p = selected();
    if (!p && !App.isPerson()) return noPeopleView();
    const personId = App.activePersonId();
    const data = state.history.data && state.history.personId === personId ? state.history.data : null;
    const counts = data
      ? { locations: (data.locations || []).length, status: (data.statuses || []).length, alerts: (data.alerts || []).length }
      : { locations: 0, status: 0, alerts: 0 };
    const name = App.isPerson() ? "You" : (p ? p.user.name : "Person");

    const head = V().pageHead({
      eyebrow: App.isPerson() ? "Your safety record" : "Guardian console",
      title: "Safety history",
      sub: "Location trail, check-ins and emergencies for " + name + " · last " + state.history.days + " days.",
      actions: personSelect() +
        '<button class="btn btn-outline" type="button" data-action="export-history">' + icon("download") + " Export CSV</button>" +
        '<button class="btn btn-ghost" type="button" data-action="refresh-history">' + icon("refresh") + " Refresh</button>",
    });

    const tabs = '<div class="segmented" role="tablist" aria-label="History type">' +
      [["locations", "Locations"], ["status", "Safety"], ["alerts", "Alerts"]].map(function (t) {
        return '<button type="button" role="tab" aria-selected="' + (state.history.tab === t[0] ? "true" : "false") + '" class="' +
          (state.history.tab === t[0] ? "active" : "") + '" data-action="history-tab" data-tab="' + t[0] + '">' + t[1] + " · " + counts[t[0]] + "</button>";
      }).join("") + "</div>";

    const ranges = '<div class="segmented" role="group" aria-label="Date range">' +
      [[1, "24 hours"], [7, "7 days"], [30, "30 days"]].map(function (r) {
        return '<button type="button" class="' + (state.history.days === r[0] ? "active" : "") + '" data-action="history-days" data-days="' + r[0] + '">' + r[1] + "</button>";
      }).join("") + "</div>";

    let body;
    if (state.history.loading) {
      body = '<section class="card">' +
        '<div class="skeleton" style="height:220px;margin-bottom:.8rem"></div>' +
        '<div class="skeleton" style="height:16px;width:70%"></div></section>';
    } else if (!data) {
      body = '<section class="card">' + V().emptyState("history", "Nothing loaded yet", "Load this range to review the safety history.",
        '<button class="btn btn-outline" type="button" data-action="refresh-history">Load history</button>') + "</section>";
    } else {
      const summary =
        '<div class="history-summary">' +
          '<span class="chip plain">' + icon("pin") + " " + counts.locations + " positions</span>" +
          '<span class="chip plain">' + icon("bell") + " " + counts.status + " check-ins</span>" +
          '<span class="chip plain">' + icon("alert") + " " + counts.alerts + " alerts</span>" +
          (App.isPerson() ? "" : '<span class="chip plain">' + icon("nav") + " " + esc(App.fmtKm((p && p.stats && p.stats.distance24h) || 0)) + " in 24h</span>") +
        "</div>";

      const mapPart = state.history.tab === "locations"
        ? '<div style="margin-bottom:1rem">' + V().mapBox("historyMap", "map small", data.locations && data.locations.length ? data.locations[data.locations.length - 1] : null, "No positions in this range.") + "</div>"
        : "";

      body = '<section class="card">' + summary + mapPart + historyTable(data) + "</section>";
    }

    return head +
      '<div class="history-toolbar">' + tabs + '<div class="spacer"></div>' + ranges + "</div>" + body;
  }

  function viewHtml() {
    if (!state.dash || !state.me) {
      return '<div class="empty" style="min-height:50vh">' + icon("shield") + "<strong>Opening your safety console…</strong><span>Connecting to your account</span></div>";
    }
    if (state.view === "messages") return App.views.messagesView();
    if (App.isPerson()) {
      if (state.view === "history") return historyView();
      return App.views.personHome();
    }
    if (state.view === "map") return guardianMapView();
    if (state.view === "alerts") return alertsView();
    if (state.view === "history") return historyView();
    return guardianHome();
  }

  App.views = Object.assign(App.views || {}, {
    guardianHome: guardianHome,
    guardianMapView: guardianMapView,
    alertsView: alertsView,
    historyView: historyView,
    historyTable: historyTable,
    viewHtml: viewHtml,
    personSelect: personSelect,
    alertsFor: alertsFor,
  });
})();
