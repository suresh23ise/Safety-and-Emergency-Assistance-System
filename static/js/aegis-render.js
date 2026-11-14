/* Aegis Assist — rendering, maps & DOM refresh. */
(function () {
  "use strict";

  const App = window.AegisApp;
  const A = window.Aegis;
  const state = App.state;
  const icon = A.icon;

  function accent() {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return value || "#e8c77c";
  }

  function pinIcon(person) {
    const hue = person && typeof person.avatarHue === "number" ? person.avatarHue : 42;
    const letters = A.initials(person && person.name);
    return window.L.divIcon({
      className: "",
      html: '<div class="map-pin" style="--hue:' + hue + '">' + A.escapeHtml(letters) + "</div>",
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
  }

  function disposeElement(el) {
    if (!el) return;
    if (el._aegisMap) {
      try { el._aegisMap.remove(); } catch (e) {}
      el._aegisMap = null;
    }
    if (el._leaflet_id) {
      try { delete el._leaflet_id; } catch (e) {}
      try { el.removeAttribute("_leaflet_id"); } catch (e) {}
    }
    el.innerHTML = "";
  }

  function initMap(elId, points, person, opts) {
    const el = document.getElementById(elId);
    if (!el) return;
    const valid = (points || []).filter(function (p) { return p && p.lat != null && p.lng != null; });
    if (!valid.length) {
      disposeElement(el);
      el.innerHTML = App.mapFallbackHtml(null);
      return;
    }
    if (!window.L) {
      disposeElement(el);
      el.innerHTML = App.mapFallbackHtml(valid[valid.length - 1]);
      return;
    }

    disposeElement(el);
    const last = valid[valid.length - 1];
    const center = [last.lat, last.lng];
    let map;
    try {
      map = window.L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true });
    } catch (err) {
      el.innerHTML = App.mapFallbackHtml(last);
      return;
    }
    map.setView(center, valid.length > 1 ? 16 : 17);
    window.L.control.zoom({ position: "bottomright" }).addTo(map);
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a> &copy; <a href="https://carto.com/" target="_blank" rel="noopener">CARTO</a>',
    }).addTo(map);

    const color = accent();
    const latlngs = valid.map(function (p) { return [p.lat, p.lng]; });
    let line = null;
    if (latlngs.length > 1) {
      line = window.L.polyline(latlngs, { color: color, weight: 3, opacity: 0.62, lineJoin: "round" }).addTo(map);
      if (opts && opts.fit) map.fitBounds(line.getBounds(), { padding: [36, 36], maxZoom: 17 });
    }

    let circle = null;
    if (last.accuracy) {
      circle = window.L.circle(center, {
        radius: Math.max(5, Number(last.accuracy) || 10),
        color: color,
        weight: 1,
        opacity: 0.4,
        fillColor: color,
        fillOpacity: 0.07,
      }).addTo(map);
    }

    let marker = null;
    if (person) {
      marker = window.L.marker(center, { icon: pinIcon(person), keyboard: false, alt: person.name }).addTo(map);
    }

    state.mapObj = {
      map: map,
      marker: marker,
      line: line,
      circle: circle,
      trail: latlngs.slice(),
      personId: person ? person.id : null,
      follow: state.follow !== false,
      elId: elId,
    };
    el._aegisMap = map;
    setTimeout(function () {
      if (!map._container || !document.body.contains(map._container)) return;
      try { map.invalidateSize(); } catch (e) {}
    }, 120);
  }

  function currentPoints() {
    if (App.isPerson()) {
      if (!state.ownTrail.length && state.dash.location) state.ownTrail = [state.dash.location];
      return state.ownTrail;
    }
    const p = App.selectedPerson();
    if (!p) return [];
    const base = state.trail && state.trail.personId === p.user.id ? state.trail.points.slice() : [];
    const loc = p.location;
    if (loc && (!base.length || base[base.length - 1].ts !== loc.ts)) base.push(loc);
    return base;
  }

  function initCurrentMaps() {
    if (document.getElementById("personMap")) {
      initMap("personMap", currentPoints(), state.me);
    }
    if (document.getElementById("guardianMap")) {
      const p = App.selectedPerson();
      if (p) initMap("guardianMap", currentPoints(), p.user, { fit: false });
    }
    if (document.getElementById("historyMap")) {
      const p = App.selectedPerson();
      const data = state.history.data;
      if (data) {
        initMap("historyMap", data.locations || [], App.isPerson() ? state.me : p && p.user, { fit: true });
      }
    }
  }

  function updateMapMarker(loc) {
    const m = state.mapObj;
    if (!m || !m.map || !m.marker || !loc) return;
    const ll = [loc.lat, loc.lng];
    m.marker.setLatLng(ll);
    if (m.circle) {
      m.circle.setLatLng(ll);
      m.circle.setRadius(Math.max(5, Number(loc.accuracy) || 10));
    }
    m.trail.push(ll);
    if (m.trail.length > 1200) m.trail.shift();
    if (m.line) m.line.setLatLngs(m.trail);
    if (m.follow) m.map.panTo(ll, { animate: true, duration: 0.4 });
  }

  function refreshLiveText(loc) {
    if (!loc) return;
    document.querySelectorAll("[data-live-coords]").forEach(function (el) { el.textContent = App.coordText(loc); });
    document.querySelectorAll("[data-live-acc]").forEach(function (el) { el.textContent = "±" + Math.round(loc.accuracy || 0) + " m"; });
    document.querySelectorAll("[data-live-lastseen]").forEach(function (el) { el.textContent = A.timeAgo(loc.ts); });
  }

  function recenter() {
    const m = state.mapObj;
    if (!m || !m.map || !m.trail.length) {
      A.toast("No location to recenter on yet.", "warn");
      return;
    }
    const last = m.trail[m.trail.length - 1];
    m.map.setView(last, 17, { animate: true });
    m.follow = true;
    state.follow = true;
  }

  function renderNav() {
    const nav = App.$("mainNav");
    if (!nav) return;
    const active = App.activeAlertCount();
    const unread = App.unreadMessages();
    nav.innerHTML = App.navItems().map(function (item) {
      let badge = "";
      if (item.id === "alerts" && active) badge = '<span class="badge">' + active + "</span>";
      if (item.id === "messages" && unread && item.id !== "alerts") badge = '<span class="badge">' + unread + "</span>";
      return '<button class="nav-pill ' + (state.view === item.id ? "active" : "") + '" type="button" data-view="' + item.id + '">' +
        icon(item.icon) + "<span>" + item.label + "</span>" + badge + "</button>";
    }).join("");
  }

  function render() {
    if (!state.dash || !state.me) return;
    if (state.sos.holding) {
      state.pendingRender = true;
      return;
    }

    // Preserve an in-progress status note across realtime renders.
    const noteEl = App.$("statusNote");
    if (noteEl) state.statusNoteDraft = noteEl.value;

    if (document.getElementById("popover")) {
      document.getElementById("popover").remove();
      state.popover = null;
    }
    if (state.mapObj) {
      const mapEl = document.getElementById(state.mapObj.elId) || document.querySelector(".map");
      disposeElement(mapEl);
      state.mapObj = null;
    }

    renderNav();

    const bell = App.$("bellBadge");
    const count = App.activeAlertCount();
    if (bell) {
      bell.hidden = !count;
      bell.textContent = count > 9 ? "9+" : String(count);
    }
    App.$("topAvatar").innerHTML = A.avatar(state.me, 32);

    const root = App.$("appRoot");
    root.innerHTML = App.views.viewHtml();
    document.title = (App.isPerson() ? "Safety console" : "Guardian console") + " · Aegis Assist";

    afterRender();
  }

  function afterRender() {
    initCurrentMaps();

    if (App.isGuardian() && (state.view === "home" || state.view === "map") && App.ensureTrail) {
      App.ensureTrail();
    }

    const draft = App.$("statusNote");
    if (draft && state.statusNoteDraft) draft.value = state.statusNoteDraft;

    const input = App.$("chatInput");
    if (input) {
      input.value = state.chat.draft || "";
      const thread = App.$("chatThread");
      if (thread) thread.scrollTop = thread.scrollHeight;
      if (state.chat.focus) {
        state.chat.focus = false;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (App.updateCountdown) App.updateCountdown();
  }

  App.render = render;
  App.initMap = initMap;
  App.updateMapMarker = updateMapMarker;
  App.refreshLiveText = refreshLiveText;
  App.recenter = recenter;
  App.afterRender = afterRender;
})();
