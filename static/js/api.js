/* Shared browser helpers: API client, toasts, formatting, sound, notifications. */
(function () {
  "use strict";

  async function api(path, options) {
    const opts = options || {};
    const init = {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (err) {
      const e = new Error("Cannot reach the server. Check that it is running.");
      e.status = 0;
      throw e;
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }
    if (!res.ok) {
      const detail = data && data.detail;
      let message = typeof detail === "string" ? detail : "Something went wrong. Please try again.";
      if (Array.isArray(detail) && detail[0] && detail[0].msg) message = detail[0].msg;
      const error = new Error(message);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function icon(name, cls) {
    return '<svg class="' + (cls || "icon") + '" aria-hidden="true"><use href="/static/assets/icons.svg#i-' + name + '"></use></svg>';
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toast(message, tone, ms) {
    const root = document.getElementById("toasts");
    if (!root) return;
    const node = document.createElement("div");
    node.className = "toast " + (tone || "info");
    node.setAttribute("role", "status");
    const names = { danger: "alert", ok: "check", warn: "alert", info: "shield" };
    node.innerHTML = icon(names[tone] || "shield") + '<span class="toast-text"></span>';
    node.querySelector(".toast-text").textContent = message;
    root.appendChild(node);
    const life = ms || 4200;
    setTimeout(function () {
      node.classList.add("leaving");
      setTimeout(function () { node.remove(); }, 240);
    }, life);
    return node;
  }

  function parseDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(ts) ? ts : ts + "Z");
    return isNaN(d.getTime()) ? null : d;
  }

  function timeAgo(ts) {
    const d = parseDate(ts);
    if (!d) return "—";
    const diff = Math.max(0, Date.now() - d.getTime()) / 1000;
    if (diff < 8) return "just now";
    if (diff < 60) return Math.floor(diff) + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 172800) return "yesterday";
    return Math.floor(diff / 86400) + "d ago";
  }

  function fmtTime(ts) {
    const d = parseDate(ts);
    if (!d) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDate(ts) {
    const d = parseDate(ts);
    if (!d) return "—";
    return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  }

  function fmtDateTime(ts) {
    const d = parseDate(ts);
    if (!d) return "—";
    return fmtDate(ts) + " · " + fmtTime(ts);
  }

  function dayLabel(ts) {
    const d = parseDate(ts);
    if (!d) return "—";
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join("") || "?";
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "friend";
  }

  function avatar(user, size, extraClass) {
    const hue = user && typeof user.avatarHue === "number" ? user.avatarHue : 42;
    const px = size || 44;
    return '<span class="avatar ' + (extraClass || "") + '" style="--hue:' + hue + ';width:' + px + 'px;height:' + px + 'px;font-size:' + Math.round(px / 2.9) + 'px" aria-hidden="true">' +
      escapeHtml(initials(user && user.name)) + "</span>";
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /* --------------------------------------------------------------- audio */
  let audioCtx = null;
  function context() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
    return audioCtx;
  }

  function tone(freq, start, duration, gainValue) {
    const ctx = context();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(gainValue || 0.07, ctx.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.05);
  }

  function sound(kind) {
    try {
      if (kind === "alert" || kind === "sos") {
        const repeats = kind === "sos" ? 4 : 3;
        for (let i = 0; i < repeats; i++) {
          tone(880, i * 0.42, 0.22, 0.09);
          tone(620, i * 0.42 + 0.2, 0.2, 0.07);
        }
      } else if (kind === "success") {
        tone(660, 0, 0.14, 0.05);
        tone(880, 0.14, 0.2, 0.05);
      } else {
        tone(520, 0, 0.12, 0.04);
      }
    } catch (e) {}
  }

  /* --------------------------------------------------------------- notifications */
  function notificationState() {
    return "Notification" in window ? Notification.permission : "unsupported";
  }

  async function askNotifications() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    try {
      return await Notification.requestPermission();
    } catch (e) {
      return "denied";
    }
  }

  function browserNotify(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, {
        body: body,
        tag: tag || "aegis",
        icon: "/static/assets/logo.svg",
        badge: "/static/assets/logo.svg",
        silent: false,
      });
      n.onclick = function () {
        window.focus();
        n.close();
      };
    } catch (e) {}
  }

  function downloadCsv(filename, rows) {
    if (!rows || !rows.length) return;
    const header = Object.keys(rows[0]);
    const escapeCell = function (value) {
      const s = String(value == null ? "" : value);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [header.join(",")]
      .concat(rows.map(function (row) { return header.map(function (key) { return escapeCell(row[key]); }).join(","); }))
      .join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  window.Aegis = {
    api: api, icon: icon, escapeHtml: escapeHtml, toast: toast,
    timeAgo: timeAgo, fmtTime: fmtTime, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    dayLabel: dayLabel, initials: initials, firstName: firstName, avatar: avatar,
    copyText: copyText, sound: sound, notificationState: notificationState,
    askNotifications: askNotifications, browserNotify: browserNotify, downloadCsv: downloadCsv,
    parseDate: parseDate,
  };
  // Convenience globals used by page scripts.
  window.api = api;
  window.icon = icon;
  window.escapeHtml = escapeHtml;
  window.toast = toast;
  window.timeAgo = timeAgo;
  window.fmtTime = fmtTime;
  window.fmtDate = fmtDate;
  window.fmtDateTime = fmtDateTime;
})();
