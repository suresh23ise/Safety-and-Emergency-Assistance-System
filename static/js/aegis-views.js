/* Safety & Emergency Assistance System — shared view primitives + person console + messaging. */
(function () {
  "use strict";

  const App = window.AegisApp;
  const A = window.Aegis;
  const state = App.state;
  const icon = A.icon;
  const esc = A.escapeHtml;
  const avatar = A.avatar;
  const timeAgo = A.timeAgo;

  function pageHead(opts) {
    return (
      '<div class="page-head">' +
        "<div>" +
          '<p class="eyebrow">' + esc(opts.eyebrow || "") + "</p>" +
          "<h1>" + esc(opts.title) + "</h1>" +
          (opts.sub ? '<p class="sub">' + opts.sub + "</p>" : "") +
        "</div>" +
        '<div class="head-actions">' + (opts.actions || "") + "</div>" +
      "</div>"
    );
  }

  function statusPill(value) {
    const info = App.statusInfo(value);
    return '<span class="chip ' + info.cls + ' status-pill"><span class="dot"></span>' + info.label + "</span>";
  }

  function mapBox(id, cls, loc, message) {
    return '<div class="' + cls + '" id="' + id + '">' + App.mapFallbackHtml(loc, message) + "</div>";
  }

  function emptyState(iconName, title, text, actionHtml) {
    return (
      '<div class="empty">' + icon(iconName) + "<strong>" + esc(title) + "</strong>" +
      "<span>" + esc(text) + "</span>" + (actionHtml || "") + "</div>"
    );
  }

  function personRow(user, opts) {
    const o = opts || {};
    const unread = user.unread || 0;
    const call = App.safePhone(user);
    return (
      '<div class="person-row">' +
        avatar(user, o.size || 40) +
        '<div class="p-info">' +
          '<div class="p-name">' + esc(user.name) + (unread ? ' <span class="badge">' + unread + "</span>" : "") + "</div>" +
          '<div class="p-sub">' + esc(o.sub || (user.role === "guardian" ? "Guardian" : "Visually impaired")) +
            (user.lastSeen ? " · active " + timeAgo(user.lastSeen) : "") + "</div>" +
        "</div>" +
        '<div class="p-actions">' +
          (call ? '<a class="mini-btn" href="' + esc(call) + '" aria-label="Call ' + esc(user.name) + '">' + icon("phone") + "</a>" : "") +
          (user.role !== "guardian"
            ? '<button class="mini-btn" type="button" data-action="chat" data-peer="' + esc(user.id) + '" aria-label="Message ' + esc(user.name) + '">' + icon("message") + "</button>"
            : '<button class="mini-btn" type="button" data-action="chat" data-peer="' + esc(user.id) + '" aria-label="Message ' + esc(user.name) + '">' + icon("message") + "</button>") +
        "</div>" +
      "</div>"
    );
  }

  function alertItem(a, opts) {
    const o = opts || {};
    const resolved = a.status === "resolved";
    const acked = a.status === "acknowledged";
    const canAct = !resolved;
    const canAck = canAct && state.me && state.me.role === "guardian";
    const targetPhone = o.phone || a.personPhone;
    const call = App.telHref(targetPhone);
    return (
      '<article class="alert-item ' + esc(a.severity || "") + (a.status === "active" ? " active" : "") + '">' +
        '<div class="a-top">' +
          '<span class="chip ' + (a.type === "sos" ? "danger" : "warn") + '">' + App.alertTypeLabel(a.type) + "</span>" +
          '<span class="chip ' + (resolved ? "ok" : acked ? "info" : "danger") + '">' +
            (resolved ? "Resolved" : acked ? "Acknowledged" : "Active") + "</span>" +
          (o.showPerson && a.personName ? '<span class="chip plain">' + esc(a.personName) + "</span>" : "") +
          '<span class="small faint" style="margin-left:auto" data-rel="' + esc(a.ts) + '">' + timeAgo(a.ts) + "</span>" +
        "</div>" +
        '<p class="a-msg">' + esc(a.message) + "</p>" +
        '<div class="a-meta">' +
          (a.lat != null ? "<span>" + icon("pin") + " " + esc(App.coordText(a)) + "</span>" : "") +
          (a.ackedBy ? "<span>Acknowledged by " + esc(a.ackedBy) + "</span>" : "") +
          (a.ackedAt ? "<span data-rel='" + esc(a.ackedAt) + "'>" + timeAgo(a.ackedAt) + "</span>" : "") +
        "</div>" +
        (canAct
          ? '<div class="a-actions">' +
              (canAck && a.status === "active"
                ? '<button class="btn btn-outline" type="button" data-action="ack-alert" data-id="' + esc(a.id) + '">Acknowledge</button>'
                : "") +
              '<button class="btn btn-ghost" type="button" data-action="resolve-alert" data-id="' + esc(a.id) + '">Resolve</button>' +
              (call ? '<a class="btn btn-ghost" href="' + esc(call) + '">Call</a>' : "") +
            "</div>"
          : "") +
      "</article>"
    );
  }

  function activeAlertBar(a) {
    return (
      '<div class="active-alert-bar">' + icon("alert") +
        "<span><strong>" + App.alertTypeLabel(a.type) + " is active</strong> — guardians have been notified.</span>" +
        '<button class="btn btn-small btn-light" type="button" data-action="resolve-alert" data-id="' + esc(a.id) + '">I\'m safe now</button>' +
      "</div>"
    );
  }

  function checkinRequests() {
    const reqs = (state.dash && state.dash.checkinRequests) || [];
    if (!reqs.length) return "";
    const r = reqs[0];
    return (
      '<div class="checkin-request">' +
        "<p>" + icon("bell") + " <strong>" + esc(r.guardianName) + "</strong> asked for a check-in " +
          '<span class="faint" data-rel="' + esc(r.ts) + '">' + timeAgo(r.ts) + "</span></p>" +
        '<div class="hstack wrap">' +
          '<button class="btn btn-small btn-primary" type="button" data-action="status" data-state="safe">I\'m safe</button>' +
          '<button class="btn btn-small btn-outline" type="button" data-action="status" data-state="help">I need help</button>' +
        "</div>" +
      "</div>"
    );
  }

  function timelineItem(item) {
    return (
      '<div class="tl-item">' +
        '<span class="tl-ico ' + esc(item.tone || "") + '">' + icon(item.icon) + "</span>" +
        '<div class="tl-body"><div class="tl-title">' + esc(item.title) + "</div>" +
          (item.note ? '<div class="tl-note">' + esc(item.note) + "</div>" : "") +
          '<div class="tl-note">' + esc(item.source || "") + "</div>" +
        "</div>" +
        '<span class="tl-time" data-rel="' + esc(item.ts) + '">' + timeAgo(item.ts) + "</span>" +
      "</div>"
    );
  }

  function statusTitle(st) {
    if (!st) return "Status update";
    return {
      safe: "Marked themselves safe",
      checkin: "Completed a safety check-in",
      help: "Asked for help",
      uncomfortable: "Felt uncomfortable",
    }[st.state] || "Status update";
  }

  function activityItems(dash) {
    const items = [];
    (dash.statusHistory || []).forEach(function (st) {
      const info = App.statusInfo(st.state);
      items.push({
        ts: st.ts,
        icon: info.icon,
        tone: info.tone,
        title: statusTitle(st),
        note: st.note,
        source: App.sourceLabel(st.source),
      });
    });
    (dash.alerts || []).forEach(function (a) {
      items.push({
        ts: a.ts,
        icon: "alert",
        tone: a.type === "sos" ? "danger" : "warn",
        title: App.alertTypeLabel(a.type) + " " + (a.status === "resolved" ? "resolved" : "raised"),
        note: a.message,
        source: a.status === "resolved" ? "Resolved" : "Active alert",
      });
    });
    items.sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });
    return items.slice(0, 7);
  }

  /* --------------------------------------------------------------- person */
  function personHome() {
    const dash = state.dash;
    const me = dash.me;
    const s = state.me;
    const settings = s.settings || {};
    const st = dash.status;
    const loc = dash.location;
    const info = App.statusInfo(st && st.state);
    const guardians = dash.guardians || [];
    const primary = guardians[0];
    const active = (dash.activeAlerts || [])[0];
    const unread = App.unreadMessages();
    const sharing = state.share.on;
    const holdSeconds = Math.round((settings.sosHoldMs || 2000) / 1000);

    const head = pageHead({
      eyebrow: "Your safety console",
      title: App.greeting() + ", " + A.firstName(me.name),
      sub:
        '<span class="dot" style="color:var(--' + (sharing ? "ok" : "warn") + ')"></span>' +
        "<span>" + (sharing ? "Live location is being shared" : "Location sharing is paused") + "</span>" +
        '<span class="sep">·</span><span>Updated <span data-rel="' + esc(loc && loc.ts) + '">' + (loc ? timeAgo(loc.ts) : "—") + "</span></span>",
      actions:
        statusPill(st && st.state) +
        '<button class="btn btn-outline" type="button" data-view="messages">' + icon("message") + " Messages" +
          (unread ? ' <span class="badge">' + unread + "</span>" : "") + "</button>",
    });

    const sosCard =
      '<section class="card sos-card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow danger-text\">Emergency</p><h2>One press. Help is on the way.</h2></div>" +
          '<span class="chip plain">' + icon("shield") + " " + guardians.length + " guardian" + (guardians.length === 1 ? "" : "s") + " linked</span>" +
        "</div>" +
        '<div class="sos-stage">' +
          '<div class="sos-halo" aria-hidden="true"></div>' +
          '<svg class="sos-progress" viewBox="0 0 236 236" aria-hidden="true">' +
            '<circle class="track" cx="118" cy="118" r="115"></circle>' +
            '<circle class="fill" id="sosRing" cx="118" cy="118" r="115"></circle>' +
          "</svg>" +
          '<button class="sos-btn" id="sosBtn" type="button" aria-label="Press and hold for ' + holdSeconds + ' seconds to send an emergency SOS with your live location">' +
            '<span class="sos-word">SOS</span>' +
            '<span class="sos-hint">Press &amp; hold</span>' +
            '<span class="sos-hold">' + holdSeconds + " seconds</span>" +
          "</button>" +
        "</div>" +
        '<p class="sos-copy">Hold for <strong>' + holdSeconds + " seconds</strong> to alert every guardian with your live location. Or " +
          '<button class="link" type="button" data-action="sos-confirm">send with confirmation</button>.</p>' +
        '<div class="sos-actions">' +
          '<button class="btn btn-ghost" type="button" data-action="emergency">' + icon("alert") + " Emergency alert</button>" +
          (primary && primary.phone
            ? '<a class="btn btn-ghost" href="' + esc(App.telHref(primary.phone)) + '">' + icon("phone") + " Call " + esc(A.firstName(primary.name)) + "</a>"
            : '<a class="btn btn-ghost" href="tel:112">' + icon("phone") + " Call 112</a>") +
        "</div>" +
        '<div class="sos-guardians-note">' + icon("shield") +
          "<span>" + (guardians.length
            ? "Every guardian receives an instant alert with your GPS position."
            : "No guardians yet — invite someone you trust to receive your SOS.") +
          "</span></div>" +
        (active ? activeAlertBar(active) : "") +
      "</section>";

    const statusCard =
      '<section class="card status-card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow\">Check-in</p><h2>How are you right now?</h2></div>" +
          '<span class="chip ' + info.cls + '"><span class="dot"></span>' + info.label + "</span>" +
        "</div>" +
        checkinRequests() +
        '<div class="status-options">' +
          '<button class="status-option safe' + (st && st.state === "safe" ? " active" : "") + '" type="button" data-action="status" data-state="safe">' +
            '<span class="status-ico">' + icon("shield") + "</span><strong>I'm safe</strong><small>All good right now</small></button>" +
          '<button class="status-option uncomfortable' + (st && st.state === "uncomfortable" ? " active" : "") + '" type="button" data-action="status" data-state="uncomfortable">' +
            '<span class="status-ico">' + icon("eye") + "</span><strong>Uncomfortable</strong><small>Something feels off</small></button>" +
          '<button class="status-option help' + (st && st.state === "help" ? " active" : "") + '" type="button" data-action="status" data-state="help">' +
            '<span class="status-ico">' + icon("alert") + "</span><strong>Need help</strong><small>Alert my guardians</small></button>" +
        "</div>" +
        '<div class="status-note-row">' +
          '<input class="input" id="statusNote" type="text" maxlength="140" placeholder="Optional note attached to your next check-in" aria-label="Optional note for your guardians" />' +
        "</div>" +
        '<div class="checkin-footer">' +
          "<div><p class=\"mini-label\">Automatic check-ins</p><p class=\"muted\">Every " + (settings.checkinMinutes || 10) + ' min · next in <span class="countdown" id="checkinCountdown">--:--</span></p></div>' +
          '<label class="switch" title="Send an automatic check-in"><input type="checkbox" id="autoCheckinToggle" ' + (settings.checkinEnabled ? "checked" : "") + '><span class="track"></span></label>' +
        "</div>" +
        '<div class="hstack wrap" style="margin-top:.7rem">' +
          '<span class="mini-label">Interval</span>' +
          '<div class="segmented tiny">' +
            [5, 10, 15, 30].map(function (m) {
              return '<button type="button" class="' + (Number(settings.checkinMinutes) === m ? "active" : "") + '" data-action="checkin-minutes" data-minutes="' + m + '">' + m + " min</button>";
            }).join("") +
          "</div>" +
        "</div>" +
      "</section>";

    const mapCard =
      '<section class="card map-card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow\">Live location</p><h2>" + (sharing ? "Sharing with guardians" : "Sharing is paused") + "</h2></div>" +
          '<label class="switch" title="Share live location"><input type="checkbox" id="shareToggle" ' + (sharing ? "checked" : "") + '><span class="track"></span></label>' +
        "</div>" +
        mapBox("personMap", "map", loc) +
        '<div class="map-meta">' +
          '<div><span class="mini-label">Coordinates</span><span class="mono" data-live-coords>' + esc(App.coordText(loc)) + "</span></div>" +
          '<div><span class="mini-label">Accuracy</span><span class="mono" data-live-acc>' + (loc ? "±" + Math.round(loc.accuracy || 0) + " m" : "—") + "</span></div>" +
          '<div><span class="mini-label">Updated</span><span class="mono" data-rel="' + esc(loc && loc.ts) + '">' + (loc ? timeAgo(loc.ts) : "—") + "</span></div>" +
          '<button class="btn btn-small btn-outline" type="button" data-action="recenter">' + icon("nav") + " Recenter</button>" +
        "</div>" +
        '<div class="share-note">' + icon(sharing ? "wifi" : "lock") +
          "<span>" + (sharing ? "Guardians can watch this map live using your device GPS." : "Guardians see your last known location. Turn on sharing to update it live.") + "</span>" +
        "</div>" +
      "</section>";

    const guardiansCard =
      '<section class="card guardians-card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow\">Care circle</p><h2>Your guardians</h2></div>" +
          '<button class="btn btn-small btn-outline" type="button" data-action="invite">' + icon("plus") + " Invite</button>" +
        "</div>" +
        '<div class="people-list">' +
          (guardians.length ? guardians.map(function (g) { return personRow(g, { sub: "Guardian" }); }).join("")
            : emptyState("users", "No guardians yet", "Share your link code with someone you trust.")) +
        "</div>" +
        '<div class="link-code-box">' +
          "<div><p class=\"mini-label\">Your guardian link code</p><span class=\"code\">" + esc(me.linkCode || "—") + "</span></div>" +
          '<button class="btn btn-small btn-outline" type="button" data-action="copy-code" data-code="' + esc(me.linkCode || "") + '">' + icon("copy") + " Copy</button>" +
        "</div>" +
      "</section>";

    const items = activityItems(dash);
    const activity =
      '<section class="card activity-card">' +
        '<div class="card-head">' +
          "<div><p class=\"eyebrow\">Timeline</p><h2>Recent activity</h2></div>" +
          '<button class="link" type="button" data-view="history">View all</button>' +
        "</div>" +
        (items.length
          ? '<div class="timeline">' + items.map(timelineItem).join("") + "</div>"
          : emptyState("clock", "Nothing here yet", "Your check-ins and alerts will appear here.")) +
      "</section>";

    const comfort =
      '<section class="card">' +
        '<div class="card-head"><div><p class="eyebrow">Comfort</p><h2>Accessibility</h2></div>' + icon("heart") + "</div>" +
        '<div class="hstack" style="justify-content:space-between;padding:.45rem 0">' +
          "<div><div class=\"strong small\">Voice guidance</div><div class=\"faint\" style=\"font-size:.7rem\">Speak alerts and messages aloud</div></div>" +
          '<label class="switch"><input type="checkbox" id="voiceToggle" ' + (settings.voice ? "checked" : "") + '><span class="track"></span></label>' +
        "</div>" +
        '<hr class="divider" />' +
        '<div class="vstack">' +
          '<button class="btn btn-outline btn-block" type="button" data-action="speak-status">' + icon("volume") + " Read my latest status</button>" +
          '<button class="btn btn-ghost btn-block" type="button" data-open-themes>' + icon("eye") + " Text size &amp; contrast</button>" +
          '<a class="btn btn-ghost btn-block" href="tel:112">' + icon("phone") + " Emergency services · 112</a>" +
        "</div>" +
      "</section>";

    return (
      head +
      '<div class="person-grid">' +
        sosCard +
        statusCard +
        mapCard +
        guardiansCard +
      "</div>" +
      '<div class="lower-grid">' + activity + comfort + "</div>"
    );
  }

  /* --------------------------------------------------------------- messages */
  function messagesView() {
    const peers = App.peersList();
    const head = pageHead({
      eyebrow: "Care circle",
      title: "Messages",
      sub: peers.length
        ? "A private channel between you and the people watching over you."
        : "Messages appear once you are linked with someone.",
    });

    if (!peers.length) {
      return head + '<section class="card">' +
        emptyState("message", "No conversations yet", "Link a guardian or person to start messaging.",
          App.isPerson() ? '<button class="btn btn-primary" type="button" data-action="invite">Invite a guardian</button>'
            : '<button class="btn btn-primary" type="button" data-action="link-person">Link a person</button>') +
        "</section>";
    }

    const peer = peers.find(function (p) { return p.id === state.chat.peerId; }) || peers[0];
    const thread = state.chat.thread && state.chat.thread.peer && state.chat.thread.peer.id === peer.id ? state.chat.thread : null;
    const messages = thread ? thread.messages : [];

    const side =
      '<aside class="card chat-side" aria-label="Conversations">' +
        '<div class="card-head" style="margin-bottom:.4rem;padding:.25rem .4rem 0"><div><p class="eyebrow">People</p><h2>Conversations</h2></div></div>' +
        peers.map(function (p) {
          const active = p.id === peer.id;
          const last = active && messages.length ? messages[messages.length - 1] : null;
          return (
            '<button class="conversation ' + (active ? "active" : "") + '" type="button" data-action="chat" data-peer="' + esc(p.id) + '">' +
              avatar(p, 36) +
              '<span class="c-body"><span class="c-name">' + esc(p.name) +
                (p.unread ? ' <span class="badge">' + p.unread + "</span>" : "") +
                (last ? '<span data-rel="' + esc(last.ts) + '">' + timeAgo(last.ts) + "</span>" : "") +
              "</span>" +
              '<span class="c-preview">' + esc(last ? last.text : (p.role === "guardian" ? "Guardian" : "Visually impaired")) + "</span></span>" +
            "</button>"
          );
        }).join("") +
      "</aside>";

    let threadHtml = "";
    if (state.chat.loading) {
      threadHtml = '<div class="chat-thread">' +
        '<div class="skeleton" style="height:44px;width:60%"></div>' +
        '<div class="skeleton" style="height:60px;width:72%;align-self:flex-end"></div>' +
        '<div class="skeleton" style="height:44px;width:50%"></div></div>';
    } else if (!messages.length) {
      threadHtml = '<div class="chat-thread"><div class="empty" style="margin:auto">' + icon("message") +
        "<strong>Say hello</strong><span>Messages are private between the two of you.</span></div></div>";
    } else {
      let lastDay = "";
      threadHtml = '<div class="chat-thread" id="chatThread">' + messages.map(function (m) {
        const day = A.dayLabel(m.ts);
        let sep = "";
        if (day !== lastDay) {
          lastDay = day;
          sep = '<span class="chat-day">' + esc(day) + "</span>";
        }
        const mine = state.me && m.fromId === state.me.id;
        return sep + '<div class="bubble ' + (mine ? "mine" : "") + '">' + esc(m.text) +
          '<span class="b-time">' + A.fmtTime(m.ts) + "</span></div>";
      }).join("") + "</div>";
    }

    const composer =
      '<form class="chat-composer" id="chatForm">' +
        '<textarea id="chatInput" rows="1" maxlength="1000" placeholder="Write a message to ' + esc(A.firstName(peer.name)) + '…" aria-label="Message"></textarea>' +
        '<button class="btn btn-primary send-btn" type="submit" aria-label="Send message">' + icon("send") + "</button>" +
      "</form>" +
      '<div class="chat-quick">' +
        ['I\'m safe', 'Call me when you can', 'On my way', 'I need help'].map(function (text) {
          return '<button type="button" data-action="quick-message" data-text="' + esc(text) + '">' + esc(text) + "</button>";
        }).join("") +
      "</div>";

    return head +
      '<div class="chat-layout">' + side +
        '<section class="card chat-panel" aria-label="Conversation">' +
          '<div class="chat-head">' +
            avatar(peer, 38) +
            '<div class="c-body"><strong>' + esc(peer.name) + "</strong>" +
              '<small><span class="dot" style="color:var(--ok)"></span>' +
              esc(peer.role === "guardian" ? "Guardian" : "Visually impaired") +
              (peer.phone ? " · " + esc(peer.phone) : "") + "</small></div>" +
            (peer.phone ? '<a class="mini-btn" href="' + esc(App.telHref(peer.phone)) + '" aria-label="Call ' + esc(peer.name) + '">' + icon("phone") + "</a>" : "") +
          "</div>" +
          threadHtml +
          composer +
        "</section>" +
      "</div>";
  }

  App.views = Object.assign(App.views || {}, {
    pageHead: pageHead,
    statusPill: statusPill,
    mapBox: mapBox,
    emptyState: emptyState,
    personRow: personRow,
    alertItem: alertItem,
    timelineItem: timelineItem,
    personHome: personHome,
    messagesView: messagesView,
  });
})();
