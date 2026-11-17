/* Safety & Emergency Assistance System — rendering, maps & DOM refresh. */
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

  const ESRI_DARK = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
  const ESRI_DARK_LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
  const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const TILE_ATTRIBUTION =
    'Tiles &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
    '&copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>';

  function addTiles(map, el) {
    const streets = window.L.tileLayer(OSM_TILES, {
      maxZoom: 20,
      attribution: TILE_ATTRIBUTION,
    });
    const satellite = window.L.tileLayer(ESRI_IMAGERY, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    });
    const darkBase = window.L.tileLayer(ESRI_DARK, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    });
    const darkLabels = window.L.tileLayer(ESRI_DARK_LABELS, {
      maxZoom: 19,
      attribution: "",
    });
    const dark = window.L.layerGroup([darkBase, darkLabels]);

    streets.addTo(map);
    window.L.control
      .layers({ Streets: streets, Satellite: satellite, Dark: dark }, { Streets: streets }, {
        position: "topright",
        collapsed: true,
      })
      .addTo(map);
    window.L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 120 }).addTo(map);

    const FullscreenControl = window.L.Control.extend({
      onAdd: function () {
        const button = window.L.DomUtil.create("button", "leaflet-bar map-fs-btn");
        button.type = "button";
        button.title = "Full screen";
        button.setAttribute("aria-label", "Toggle full screen map");
        button.innerHTML = "&#x26F6;";
        window.L.DomEvent.on(button, "click", window.L.DomEvent.stop).on(button, "click", function () {
          const node = map.getContainer();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(function () {});
          } else if (node.requestFullscreen) {
            node.requestFullscreen().catch(function () {});
          }
        });
        return button;
      },
    });
    map.addControl(new FullscreenControl({ position: "topright" }));

    let errors = 0;
    let switched = false;
    streets.on("tileerror", function () {
      errors += 1;
      if (errors < 4 || switched) return;
      switched = true;
      try { map.removeLayer(streets); } catch (e) {}
      satellite.addTo(map);
      const note = el.querySelector(".map-empty-overlay small");
      if (note) note.textContent = "Using satellite tiles after a network delay.";
    });
    return streets;
  }

  function emptyMapOverlay(person) {
    const self = App.isPerson();
    const name = person && person.name ? A.firstName(person.name) : "the person you care for";
    const title = self ? "Turn on location sharing" : "No live position yet";
    const text = self
      ? "Tap <em>Share live location</em> below and allow your browser's location permission. Guardians will see this map update live."
      : "Ask " + A.escapeHtml(name) + " to open their console, turn on <em>Share live location</em>, and allow location access. The map updates automatically.";
    const action = self
      ? '<button class="btn btn-primary btn-small" type="button" data-action="start-sharing">Share my location now</button>'
      : '<button class="btn btn-outline btn-small" type="button" data-action="request-checkin">Request a check-in</button>';
    return (
      '<div class="map-empty-overlay">' +
        '<div class="map-empty-card">' +
          "<strong>" + title + "</strong>" +
          "<span>" + text + "</span>" +
          action +
          "<small>Map layers: OpenStreetMap streets, Esri satellite and dark — no API key required.</small>" +
        "</div>" +
      "</div>"
    );
  }

  function initMap(elId, points, person, opts) {
    const el = document.getElementById(elId);
    if (!el) return;
    const valid = (points || []).filter(function (p) { return p && p.lat != null && p.lng != null; });
    if (!window.L) {
      disposeElement(el);
      el.innerHTML = App.mapFallbackHtml(valid[valid.length - 1] || null);
      return;
    }

    disposeElement(el);
    const last = valid[valid.length - 1];
    let map;
    try {
      map = window.L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true });
    } catch (err) {
      el.innerHTML = App.mapFallbackHtml(last || null);
      return;
    }
    window.L.control.zoom({ position: "bottomright" }).addTo(map);

    if (!valid.length) {
      map.setView([21.5, 79], 4);
      addTiles(map, el);
      el.insertAdjacentHTML("beforeend", emptyMapOverlay(person));
      const emptyCard = el.querySelector(".map-empty-card");
      if (emptyCard && window.L) {
        window.L.DomEvent.disableClickPropagation(emptyCard);
        window.L.DomEvent.disableScrollPropagation(emptyCard);
      }
      state.mapObj = {
        map: map,
        marker: null,
        line: null,
        circle: null,
        trail: [],
        person: person || null,
        personId: person ? person.id : null,
        follow: state.follow !== false,
        elId: elId,
        empty: true,
      };
      el._aegisMap = map;
      setTimeout(function () {
        if (!map._container || !document.body.contains(map._container)) return;
        try { map.invalidateSize(); } catch (e) {}
      }, 120);
      return;
    }

    map.setView([last.lat, last.lng], valid.length > 1 ? 16 : 17);
    addTiles(map, el);
    const center = [last.lat, last.lng];
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
      person: person || null,
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
    if (!m || !m.map || !loc || loc.lat == null || loc.lng == null) return;
    const ll = [loc.lat, loc.lng];
    const color = accent();

    if (!m.marker && window.L) {
      if (m.empty) {
        m.empty = false;
        const overlay = m.map.getContainer().querySelector(".map-empty-overlay");
        if (overlay) overlay.remove();
        m.map.setView(ll, 16);
      }
      if (m.person) {
        m.marker = window.L.marker(ll, { icon: pinIcon(m.person), keyboard: false, alt: m.person.name }).addTo(m.map);
      }
      if (!m.circle && loc.accuracy) {
        m.circle = window.L.circle(ll, {
          radius: Math.max(5, Number(loc.accuracy) || 10),
          color: color,
          weight: 1,
          opacity: 0.4,
          fillColor: color,
          fillOpacity: 0.07,
        }).addTo(m.map);
      }
      m.trail = [ll];
      return;
    }

    if (!m.marker) return;
    m.marker.setLatLng(ll);
    if (m.circle) {
      m.circle.setLatLng(ll);
      m.circle.setRadius(Math.max(5, Number(loc.accuracy) || 10));
    }
    m.trail.push(ll);
    if (m.trail.length > 1200) m.trail.shift();
    if (m.line) {
      m.line.setLatLngs(m.trail);
    } else if (m.trail.length > 1 && window.L) {
      m.line = window.L.polyline(m.trail, { color: color, weight: 3, opacity: 0.62, lineJoin: "round" }).addTo(m.map);
    }
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
    document.title = (App.isGuest() ? "Guest preview" : App.isPerson() ? "Person console" : "Guardian console") + " · Safety & Emergency Assistance System";

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
    if (window.AegisVoice && window.AegisVoice.sync) window.AegisVoice.sync();
  }

  App.render = render;
  App.initMap = initMap;
  App.updateMapMarker = updateMapMarker;
  App.refreshLiveText = refreshLiveText;
  App.recenter = recenter;
  App.afterRender = afterRender;
})();
