/* Appearance: 8 themes + accessibility preferences. Shared by login and app. */
(function () {
  "use strict";

  const THEMES = [
    { id: "cyber", name: "Cyber Night", icon: "moon", swatch: "#ff6b2c" },
    { id: "sunset", name: "Sunset Ember", icon: "sun", swatch: "#e8c77c" },
    { id: "aurora", name: "Aurora Violet", icon: "spark", swatch: "#a78bfa" },
    { id: "ocean", name: "Ocean Deep", icon: "palette", swatch: "#22d3ee" },
    { id: "midnight", name: "Midnight Blue", icon: "moon", swatch: "#7ba7ff" },
    { id: "magma", name: "Magma Red", icon: "sun", swatch: "#ff5d5d" },
    { id: "forest", name: "Forest Moss", icon: "spark", swatch: "#6ee7a0" },
    { id: "titanium", name: "Titanium Graphite", icon: "contrast", swatch: "#dbe3ee" },
  ];
  const KEY = { theme: "aegis.theme", scale: "aegis.scale", reduce: "aegis.reduce", contrast: "aegis.contrast" };
  const root = document.documentElement;
  let closeHandler = null;
  let lastFocus = null;

  function store(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) {}
  }
  function read(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function getAppearance() {
    return {
      theme: root.dataset.theme || "sunset",
      textScale: parseFloat(root.style.getPropertyValue("--app-scale")) || 1,
      reduceMotion: root.classList.contains("reduce-motion"),
      highContrast: root.classList.contains("high-contrast"),
    };
  }

  function emit() {
    document.dispatchEvent(new CustomEvent("aegis:appearance", { detail: getAppearance() }));
  }

  function applyTheme(id, options) {
    const theme = THEMES.some(function (t) { return t.id === id; }) ? id : "sunset";
    root.dataset.theme = theme;
    store(KEY.theme, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
      if (bg) meta.setAttribute("content", bg);
    }
    if (!options || !options.silent) emit();
    return theme;
  }

  function applyScale(value, options) {
    const scale = [1, 1.12, 1.25].includes(Number(value)) ? Number(value) : 1;
    root.style.setProperty("--app-scale", String(scale));
    store(KEY.scale, scale);
    if (!options || !options.silent) emit();
  }

  function applyReduce(value, options) {
    root.classList.toggle("reduce-motion", !!value);
    store(KEY.reduce, value ? "1" : "0");
    if (!options || !options.silent) emit();
  }

  function applyContrast(value, options) {
    root.classList.toggle("high-contrast", !!value);
    store(KEY.contrast, value ? "1" : "0");
    if (!options || !options.silent) emit();
  }

  function applyAll(appearance) {
    const a = appearance || {};
    if (a.theme) applyTheme(a.theme, { silent: true });
    if (a.textScale != null) applyScale(a.textScale, { silent: true });
    if (a.reduceMotion != null) applyReduce(a.reduceMotion, { silent: true });
    if (a.highContrast != null) applyContrast(a.highContrast, { silent: true });
  }

  function init() {
    applyTheme(root.dataset.theme || read(KEY.theme, "sunset"), { silent: true });
    applyScale(parseFloat(root.style.getPropertyValue("--app-scale")) || read(KEY.scale, 1), { silent: true });
    if (read(KEY.reduce, "0") === "1") root.classList.add("reduce-motion");
    if (read(KEY.contrast, "0") === "1") root.classList.add("high-contrast");
  }

  /* --------------------------------------------------------------- dialog */
  function optionMarkup(t, activeTheme) {
    return (
      '<button type="button" class="theme-option ' + (t.id === activeTheme ? "active" : "") + '" data-theme-id="' + t.id + '" ' +
      'style="--swatch:' + t.swatch + '" aria-pressed="' + (t.id === activeTheme ? "true" : "false") + '">' +
      window.icon(t.icon) + "<span>" + t.name + "</span></button>"
    );
  }

  function openDialog(options) {
    const opts = options || {};
    closeDialog();
    const current = getAppearance();
    lastFocus = document.activeElement;
    const host = document.getElementById("modalRoot") || document.body;
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML =
      '<div class="sheet theme-panel" role="dialog" aria-modal="true" aria-labelledby="themeTitle">' +
        '<div class="sheet-head">' +
          '<div><p class="eyebrow">Appearance</p><h2 id="themeTitle">Themes</h2>' +
          "<p>Eight hand-tuned moods. Your choice is saved on this device and to your account.</p></div>" +
          '<button class="close-btn" type="button" data-close-theme aria-label="Close appearance settings">' + window.icon("x") + "</button>" +
        "</div>" +
        '<div class="theme-grid" role="group" aria-label="Color themes">' +
          THEMES.map(function (t) { return optionMarkup(t, current.theme); }).join("") +
        "</div>" +
        '<div class="theme-section">' +
          "<div><h4>Text size</h4><p>Scales the whole interface</p></div>" +
          '<div class="segmented" data-scale role="group" aria-label="Text size">' +
            '<button type="button" data-scale-value="1" class="' + (current.textScale === 1 ? "active" : "") + '">Default</button>' +
            '<button type="button" data-scale-value="1.12" class="' + (current.textScale === 1.12 ? "active" : "") + '">Large</button>' +
            '<button type="button" data-scale-value="1.25" class="' + (current.textScale === 1.25 ? "active" : "") + '">Larger</button>' +
          "</div>" +
        "</div>" +
        '<div class="theme-section">' +
          "<div><h4>Reduce motion</h4><p>Calmer transitions and no pulsing</p></div>" +
          '<label class="switch"><input type="checkbox" data-toggle-reduce ' + (current.reduceMotion ? "checked" : "") + '><span class="track"></span></label>' +
        "</div>" +
        '<div class="theme-section">' +
          "<div><h4>High contrast</h4><p>Stronger borders and brighter text</p></div>" +
          '<label class="switch"><input type="checkbox" data-toggle-contrast ' + (current.highContrast ? "checked" : "") + '><span class="track"></span></label>' +
        "</div>" +
        '<div class="sheet-actions">' +
          '<button class="btn btn-ghost" type="button" data-close-theme>Cancel</button>' +
          '<button class="btn btn-primary" type="button" data-close-theme>Done</button>' +
        "</div>" +
      "</div>";
    host.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      closeHandler = null;
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    }

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    closeHandler = close;
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });

    overlay.addEventListener("click", function (event) {
      const closeBtn = event.target.closest("[data-close-theme]");
      if (closeBtn) {
        close();
        if (opts.onDone) opts.onDone();
        return;
      }

      const button = event.target.closest("[data-theme-id]");
      if (button) {
        const id = button.dataset.themeId;
        applyTheme(id);
        overlay.querySelectorAll("[data-theme-id]").forEach(function (el) {
          const on = el.dataset.themeId === id;
          el.classList.toggle("active", on);
          el.setAttribute("aria-pressed", on ? "true" : "false");
        });
        return;
      }

      const scaleBtn = event.target.closest("[data-scale-value]");
      if (scaleBtn) {
        const value = parseFloat(scaleBtn.dataset.scaleValue);
        applyScale(value);
        overlay.querySelectorAll("[data-scale-value]").forEach(function (el) {
          el.classList.toggle("active", parseFloat(el.dataset.scaleValue) === value);
        });
      }
    });

    overlay.addEventListener("change", function (event) {
      if (event.target.matches("[data-toggle-reduce]")) applyReduce(event.target.checked);
      if (event.target.matches("[data-toggle-contrast]")) applyContrast(event.target.checked);
    });

    const focusTarget = overlay.querySelector("[data-theme-id].active") || overlay.querySelector("[data-close-theme]");
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  function closeDialog() {
    if (closeHandler) closeHandler();
  }

  document.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-open-themes]");
    if (!trigger) return;
    event.preventDefault();
    openDialog();
  });

  window.AegisTheme = {
    themes: THEMES,
    init: init,
    apply: applyTheme,
    applyAll: applyAll,
    applyScale: applyScale,
    applyReduce: applyReduce,
    applyContrast: applyContrast,
    getAppearance: getAppearance,
    openDialog: openDialog,
    closeDialog: closeDialog,
  };

  init();
})();
