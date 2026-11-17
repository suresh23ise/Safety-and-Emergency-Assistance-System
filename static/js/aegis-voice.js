/* Safety & Emergency Assistance System — hands-free voice control & voice typing. */
(function () {
  "use strict";

  const App = window.AegisApp;
  const A = window.Aegis;
  if (!App || !A) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const V = {
    supported: !!SpeechRecognition,
    want: false,
    listening: false,
    speaking: false,
    rec: null,
    dictTarget: null,
    dictBase: "",
    pending: null,
    lastReply: "",
    restarting: false,
    greeted: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\u2018\u2019']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function setStatus(text) {
    const el = $("voiceStatus");
    if (el) el.textContent = text;
  }

  function setHearing(text) {
    const el = $("voiceHearing");
    if (el) el.textContent = text || "";
  }

  function showPanel(show) {
    const panel = $("voicePanel");
    if (panel) panel.hidden = !show;
  }

  function updateFab() {
    const fab = $("voiceFab");
    if (!fab) return;
    const active = V.want;
    fab.classList.toggle("listening", active);
    fab.classList.toggle("typing", !!V.dictTarget);
    fab.setAttribute("aria-pressed", active ? "true" : "false");
    fab.setAttribute("aria-label", active ? "Turn off voice control" : "Start voice control");
    const label = fab.querySelector("span");
    if (label) label.textContent = V.dictTarget ? "Typing" : active ? "Listening" : "Voice";
  }

  /* ------------------------------------------------------------ speech out */
  function speak(text) {
    if (!text) return;
    V.lastReply = text;
    setStatus(text);
    if (!window.speechSynthesis) return;

    const resume = V.want;
    V.speaking = true;
    updateFab();

    try { if (V.rec) V.rec.abort(); } catch (e) {}
    try { window.speechSynthesis.cancel(); } catch (e) {}

    let done = false;
    let guard = null;
    function finish() {
      if (done) return;
      done = true;
      if (guard) clearTimeout(guard);
      V.speaking = false;
      updateFab();
      if (resume && V.want) restartSoon();
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = navigator.language || "en-US";
    utter.rate = 0.98;
    utter.pitch = 1;
    utter.volume = 1;
    utter.onend = finish;
    utter.onerror = finish;
    guard = setTimeout(finish, Math.min(30000, 2500 + text.length * 95));

    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      finish();
    }
  }

  function reply(text) {
    setHearing("");
    A.toast(text, "info", 4600);
    speak(text);
  }

  /* ------------------------------------------------------------ recognition */
  function ensureRecognition() {
    if (!SpeechRecognition) return null;
    if (V.rec) return V.rec;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = navigator.language || "en-US";

    rec.onstart = function () {
      V.listening = true;
      updateFab();
    };

    rec.onresult = function (event) {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const chunk = result[0] ? result[0].transcript : "";
        if (result.isFinal) finalText += chunk;
        else interim += chunk;
      }

      if (interim.trim()) setHearing("\u201C" + interim.trim() + "\u201D");

      if (V.dictTarget) {
        handleDictation(finalText, interim);
        return;
      }

      if (finalText.trim()) {
        setHearing("\u201C" + finalText.trim() + "\u201D");
        handleCommand(finalText.trim());
      }
    };

    rec.onerror = function (event) {
      const error = (event && event.error) || "";
      V.listening = false;
      updateFab();

      if (error === "not-allowed" || error === "service-not-allowed") {
        V.want = false;
        V.dictTarget = null;
        showPanel(true);
        setStatus("Microphone blocked. Allow microphone access, then tap Voice again.");
        A.toast("Microphone access is blocked. Allow it in your browser, then start voice control again.", "warn", 7000);
        speak("Microphone access is blocked. Allow microphone access in your browser, then tap voice again.");
        return;
      }
      if (error === "audio-capture") {
        setStatus("No microphone was found. Connect a microphone and try again.");
        return;
      }
      if (error === "network") {
        setStatus("The speech service is offline. Check your internet connection, then say that again.");
        return;
      }
      /* "no-speech" and "aborted" are normal; onend restarts listening. */
    };

    rec.onend = function () {
      V.listening = false;
      updateFab();
      if (V.want && !V.speaking) restartSoon();
    };

    V.rec = rec;
    return rec;
  }

  function startRecognition() {
    const rec = ensureRecognition();
    if (!rec) return false;
    try {
      rec.start();
    } catch (err) {
      if (!err || err.name !== "InvalidStateError") {
        setStatus("The microphone could not start. Tap Voice to try again.");
        return false;
      }
    }
    V.listening = true;
    updateFab();
    return true;
  }

  function restartSoon() {
    if (V.restarting) return;
    V.restarting = true;
    setTimeout(function () {
      V.restarting = false;
      if (!V.want || V.speaking) return;
      startRecognition();
    }, 360);
  }

  /* ------------------------------------------------------------ on / off */
  function begin() {
    if (!V.supported) {
      A.toast("Voice control needs Chrome, Edge or Safari with microphone support.", "warn", 6500);
      return;
    }
    if (!App.state.me) return;

    V.want = true;
    V.pending = null;
    showPanel(true);
    setHearing("");
    setStatus(V.dictTarget ? "Voice typing on. Speak now." : "Listening… say help, I am safe, where am I, or stop.");
    startRecognition();
    updateFab();

    if (!V.greeted) {
      V.greeted = true;
      speak("Voice control is on. Say help for an emergency. I am safe. Where am I. Open messages. Or stop to finish.");
    } else {
      speak("Voice control on. Listening.");
    }
  }

  function stop(quiet) {
    const wasActive = V.want;
    V.want = false;
    V.pending = null;
    V.dictTarget = null;
    V.dictBase = "";
    if (V.rec) {
      try { V.rec.abort(); } catch (e) {}
    }
    V.listening = false;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    showPanel(false);
    setHearing("");
    updateFab();
    if (!quiet && wasActive) {
      A.toast("Voice control off.", "info", 2600);
      speak("Voice control off.");
    }
  }

  function toggle() {
    if (V.want) stop(false);
    else begin();
  }

  /* ------------------------------------------------------------ dictation */
  function dictate(targetId) {
    if (!V.supported) {
      A.toast("Voice typing needs Chrome, Edge or Safari with microphone support.", "warn", 6500);
      return;
    }
    const el = $(targetId);
    if (!el) {
      A.toast("That text field is not open right now.", "warn");
      return;
    }
    if (V.dictTarget === targetId && V.want) {
      finishDictation(true);
      return;
    }

    V.dictTarget = targetId;
    V.dictBase = el.value || "";
    V.want = true;
    showPanel(true);
    setHearing("");
    setStatus("Voice typing on. Speak, then say \u201Cstop dictation\u201D or tap the microphone again.");
    el.focus();
    startRecognition();
    updateFab();
    speak("Voice typing on. Speak now, then say stop dictation.");
  }

  function finishDictation(announce) {
    const target = V.dictTarget;
    V.dictTarget = null;
    V.dictBase = "";
    if (target) {
      const el = $(target);
      if (el) {
        el.value = String(el.value || "").replace(/\s+$/, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    updateFab();
    if (!V.want) return;
    if (announce) {
      setStatus("Voice typing finished. Still listening.");
      speak("Voice typing finished. Still listening.");
    } else {
      setStatus("Listening…");
    }
  }

  function handleDictation(finalText, interim) {
    const norm = normalize(finalText);
    const spoken = String(finalText || "").trim();

    if (/^(stop|end|finish|done|exit) (dictation|typing|voice typing|listening)$/.test(norm) || norm === "stop dictation") {
      finishDictation(true);
      return;
    }

    if (norm === "send" || norm === "send message" || norm === "send it") {
      const target = V.dictTarget;
      finishDictation(false);
      if (target === "chatInput") {
        const input = $("chatInput");
        if (input && input.value.trim()) {
          App.sendMessage(input.value);
          reply("Message sent.");
        } else {
          reply("There is no message to send yet.");
        }
      }
      return;
    }

    if (/^(clear|clear that|delete that|erase that|start over)$/.test(norm)) {
      const el = V.dictTarget ? $(V.dictTarget) : null;
      V.dictBase = "";
      if (el) {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      setStatus("Cleared. Speak again.");
      return;
    }

    const el = V.dictTarget ? $(V.dictTarget) : null;
    if (!el) {
      finishDictation(false);
      return;
    }

    if (spoken) {
      const base = String(V.dictBase || "").replace(/\s+$/, "");
      V.dictBase = (base ? base + " " : "") + spoken + " ";
    }
    el.value = V.dictBase + (interim ? String(interim).trim() : "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    setStatus("Voice typing… say \u201Cstop dictation\u201D when you are finished.");
  }

  /* ------------------------------------------------------------ commands */
  function matches(text, keywords) {
    return keywords.some(function (word) {
      return text === word || text.indexOf(word + " ") === 0 || text.indexOf(" " + word) > -1;
    });
  }

  function isYes(text) {
    return /^(yes|yeah|yep|sure|confirm|confirmed|do it|send it|send|ok|okay|please do|go ahead)$/.test(text);
  }

  function isNo(text) {
    return /^(no|nope|cancel|stop|dont|do not|negative|leave it)$/.test(text);
  }

  function firstName(user) {
    return String((user && user.name) || "").split(" ")[0] || "your contact";
  }

  function locationOf(person) {
    if (!person) return null;
    return App.isPerson() ? person.location : person.location;
  }

  function describeLocation(person, self) {
    const who = self ? "You" : firstName(person && person.user);
    const loc = person && person.location;
    if (!loc || loc.lat == null) {
      return self
        ? "You are not sharing your location right now. Say share my location to turn it on."
        : who + " has not shared a location yet. They need to turn on Share live location.";
    }
    const accuracy = loc.accuracy ? " Accurate to about " + Math.round(loc.accuracy) + " meters." : "";
    const updated = loc.ts ? " Updated " + A.timeAgo(loc.ts) + "." : "";
    return who + " last known location is " + App.coordText(loc) + "." + accuracy + updated;
  }

  function describeStatus(person, self) {
    const status = person && person.status;
    if (!status || !status.state) {
      return self ? "You have not shared a status yet." : firstName(person && person.user) + " has not shared a status yet.";
    }
    const info = App.statusInfo(status.state);
    const who = self ? "Your" : firstName(person && person.user) + "'s";
    return who + " latest status is " + info.label.toLowerCase() + ".";
  }

  function safeSelectedPerson() {
    return App.isPerson() ? { user: App.state.me, location: App.state.dash && App.state.dash.location, status: App.state.dash && App.state.dash.status } : App.selectedPerson();
  }

  function viewLabel(view) {
    const item = App.navItems().find(function (entry) { return entry.id === view; });
    return item ? item.label : view;
  }

  function goTo(view) {
    const allowed = App.navItems().some(function (item) { return item.id === view; });
    if (!allowed) {
      if (view === "map" && App.isPerson()) {
        reply("Your live map is on the home screen. Say open home.");
        return;
      }
      reply("That screen is not available for this account.");
      return;
    }
    App.go(view);
    reply("Opening " + viewLabel(view) + ".");
  }

  function readMessages(attempt) {
    attempt = attempt || 0;
    const peers = App.peersList();
    if (!peers.length) {
      reply("You have no conversations yet. Link a guardian or person to start messaging.");
      return;
    }
    if (App.state.view !== "messages") App.go("messages");

    const thread = App.state.chat.thread;
    if ((!thread || !thread.messages) && attempt < 5) {
      setTimeout(function () { readMessages(attempt + 1); }, 700);
      return;
    }
    if (!thread || !thread.messages || !thread.messages.length) {
      reply("There are no messages in this conversation yet.");
      return;
    }

    const meId = App.state.me && App.state.me.id;
    const recent = thread.messages.slice(-3);
    const summary = recent.map(function (msg) {
      return (msg.fromId === meId ? "You said: " : "They said: ") + msg.text;
    }).join(". ");
    reply("Here are your latest messages. " + summary);
  }

  function guardianPhone() {
    const me = App.state.me;
    if (!me) return "";
    if (App.isPerson()) {
      const guardians = (App.state.dash && App.state.dash.guardians) || [];
      const withPhone = guardians.find(function (g) { return g.phone; });
      return withPhone ? App.safePhone(withPhone) : "";
    }
    const person = App.selectedPerson();
    return person ? App.safePhone(person.user) : "";
  }

  function callNumber(number) {
    const spoken = String(number).split("").join(" ");
    reply("Calling " + spoken + ".");
    setTimeout(function () {
      window.location.href = "tel:" + number;
    }, 1100);
  }

  function matchPerson(query) {
    const people = (App.state.dash && App.state.dash.people) || [];
    const q = normalize(query);
    if (!q) return null;
    return people.find(function (p) {
      const name = normalize(p.user.name);
      return name.indexOf(q) > -1 || q.indexOf(name) > -1 || normalize(firstName(p.user)).indexOf(q) > -1;
    }) || null;
  }

  function confirmSos() {
    if (!App.isPerson()) {
      reply("SOS is only available from a person account. Open the person's page to send help.");
      return;
    }
    V.pending = { type: "sos" };
    reply("Say yes to send an SOS with your location to your guardians, or say cancel.");
  }

  function runPending(pending) {
    if (!pending) return;
    if (pending.type === "sos") {
      setStatus("Sending SOS…");
      App.sendAlert("sos", "Sent by voice control").then(function (alert) {
        if (alert) {
          reply("SOS sent. Your guardians have been alerted with your location.");
        } else {
          reply("I could not send the SOS. Say help to try again, or call 112.");
        }
      });
      return;
    }
    if (pending.type === "call") {
      callNumber(pending.number);
    }
  }

  function listCommands() {
    reply(
      "You can say: help, to send an SOS. I am safe. Uncomfortable. Share my location. Stop sharing. " +
      "Where am I. What is my status. Open messages. Read messages. Type a message. Send. " +
      "Call my guardian. Call 112. Repeat. Or stop, to turn voice control off."
    );
  }

  function handleCommand(raw) {
    const text = normalize(raw);
    if (!text) return;
    setHearing("\u201C" + String(raw).trim() + "\u201D");
    setStatus("Heard: \u201C" + String(raw).trim() + "\u201D");

    if (V.pending) {
      if (isYes(text)) {
        const pending = V.pending;
        V.pending = null;
        runPending(pending);
        return;
      }
      if (isNo(text)) {
        V.pending = null;
        reply("Cancelled. Nothing was sent.");
        return;
      }
      reply("Please say yes to confirm, or cancel.");
      return;
    }

    if (/^(stop|stop listening|stop voice|stop voice control|voice off|turn off voice|turn off voice control|close voice|quiet|silence|goodbye)$/.test(text)) {
      stop(false);
      return;
    }

    if (/^(help|help me|i need help|need help|sos|emergency|send sos|send an sos|i am in danger|im in danger)$/.test(text)) {
      confirmSos();
      return;
    }

    if (/^(what can i say|what can i do|commands|list commands|voice commands|how does this work)$/.test(text)) {
      listCommands();
      return;
    }

    if (/^(repeat|say that again|again)$/.test(text)) {
      if (V.lastReply) speak(V.lastReply);
      else reply("There is nothing to repeat yet.");
      return;
    }

    if (/^(i am safe|im safe|i feel safe|safe|all good|everything is fine)$/.test(text)) {
      if (!App.isPerson()) {
        reply("Status updates are only available from a person account.");
        return;
      }
      setStatus("Marking you safe…");
      App.postStatus("safe");
      return;
    }

    if (/^(i am uncomfortable|im uncomfortable|uncomfortable|not comfortable|i feel uncomfortable)$/.test(text)) {
      if (!App.isPerson()) {
        reply("Status updates are only available from a person account.");
        return;
      }
      setStatus("Sharing that you feel uncomfortable…");
      App.postStatus("uncomfortable");
      return;
    }

    if (/^(share my location|share location|start sharing|start sharing my location|turn on location|start location sharing|send my location)$/.test(text)) {
      if (!App.isPerson()) {
        reply("Only the person account can share their live location.");
        return;
      }
      App.startDeviceGps();
      reply("Live location sharing is on. Allow the location prompt if your browser asks. Your guardians can follow you now.");
      return;
    }

    if (/^(stop sharing|stop sharing my location|pause sharing|pause location|stop location|turn off location|stop location sharing)$/.test(text)) {
      if (!App.isPerson()) {
        reply("Only the person account can change location sharing.");
        return;
      }
      App.stopSharing();
      App.render();
      reply("Live location sharing is off.");
      return;
    }

    if (/^(where am i|where am i right now|my location|find me|locate me|what is my location)$/.test(text)) {
      const person = safeSelectedPerson();
      const self = App.isPerson();
      reply(describeStatus(person, self) + " " + describeLocation(person, self));
      return;
    }

    if (/^(where is|where s|find) /.test(text)) {
      if (App.isPerson()) {
        reply("You are signed in as the person. Say where am I to hear your location.");
        return;
      }
      const query = text.replace(/^(where is|where s|find)\s+/, "");
      const person = matchPerson(query);
      if (!person) {
        reply("I could not find that person in your care circle.");
        return;
      }
      App.state.selected = person.user.id;
      App.render();
      reply(describeLocation(person, false) + " " + describeStatus(person, false));
      return;
    }

    if (/^(what is my status|my status|status|how am i|am i safe)$/.test(text)) {
      const person = safeSelectedPerson();
      reply(describeStatus(person, App.isPerson()));
      return;
    }

    if (/^(read messages|read my messages|read the messages|check messages|any messages|read chat)$/.test(text)) {
      readMessages();
      return;
    }

    if (/^(type|write|dictate) (a )?(message|chat)$/.test(text) || /^(voice typing|dictate|dictation)$/.test(text)) {
      if (!App.peersList().length) {
        reply("You have no conversations yet, so there is nowhere to type a message.");
        return;
      }
      if (App.state.view !== "messages") App.go("messages");
      setStatus("Opening the message box in a moment…");
      setTimeout(function () { dictate("chatInput"); }, 700);
      return;
    }

    if (/^(type|write|dictate) (a )?note$/.test(text)) {
      if (!App.isPerson()) {
        reply("Notes are only available from the person account.");
        return;
      }
      if (App.state.view !== "home") App.go("home");
      setStatus("Opening your check-in note in a moment…");
      setTimeout(function () { dictate("statusNote"); }, 500);
      return;
    }

    if (/^(send|send message|send it|send the message)$/.test(text)) {
      const input = $("chatInput");
      if (!input || !input.value.trim()) {
        reply("There is no message to send. Say type a message first.");
        return;
      }
      const body = input.value;
      App.sendMessage(body);
      reply("Message sent.");
      return;
    }

    if (/^(call my guardian|call guardian|phone my guardian|call my carer|call my contact)$/.test(text)) {
      const href = guardianPhone();
      if (!href) {
        reply("No guardian phone number is saved. Add one in your profile, or say call 112 for an emergency.");
        return;
      }
      reply("Calling your guardian.");
      setTimeout(function () { window.location.href = href; }, 1100);
      return;
    }

    const numberMatch = text.match(/^call (\d{3,4})$/);
    if (numberMatch) {
      const number = numberMatch[1];
      V.pending = { type: "call", number: number };
      reply("Say yes to call " + number.split("").join(" ") + ".");
      return;
    }

    if (/^(call 112|call 911|call 999|call emergency services|call an ambulance|call the police|emergency call)$/.test(text)) {
      const number = text.indexOf("911") > -1 ? "911" : text.indexOf("999") > -1 ? "999" : "112";
      V.pending = { type: "call", number: number };
      reply("Say yes to call " + number.split("").join(" ") + ".");
      return;
    }

    if (matches(text, ["messages", "message", "chats", "chat", "inbox"])) {
      goTo("messages");
      return;
    }

    if (matches(text, ["live map", "map", "maps"])) {
      goTo("map");
      return;
    }

    if (matches(text, ["history", "my history"])) {
      goTo("history");
      return;
    }

    if (matches(text, ["alerts", "alert list", "emergency alerts"])) {
      goTo("alerts");
      return;
    }

    if (matches(text, ["overview", "dashboard"])) {
      goTo("home");
      return;
    }

    if (text === "home" || /^(open|go to|go|show|take me to) (my |the )?home$/.test(text) || /^(open|go to|go) (the )?overview$/.test(text)) {
      goTo("home");
      return;
    }

    if (/^(yes|yeah|no|nope)$/.test(text)) {
      reply("There is nothing waiting for confirmation.");
      return;
    }

    reply("I did not catch that. Say what can I say to hear the commands, or say stop to turn voice control off.");
  }

  /* ------------------------------------------------------------ wiring */
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener("click", function (event) {
      const target = event.target;
      if (!target || !target.closest) return;

      if (target.closest("#voiceFab")) {
        event.preventDefault();
        toggle();
        return;
      }
      if (target.closest("[data-voice-close]")) {
        event.preventDefault();
        stop(false);
        return;
      }
      const tryBtn = target.closest("[data-voice-try]");
      if (tryBtn) {
        event.preventDefault();
        showPanel(true);
        handleCommand(tryBtn.dataset.voiceTry || "");
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.altKey && event.shiftKey && (event.key === "v" || event.key === "V")) {
        event.preventDefault();
        toggle();
      }
    });

    window.addEventListener("beforeunload", function () {
      if (V.rec) {
        try { V.rec.abort(); } catch (e) {}
      }
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    });
  }

  function sync() {
    const dock = $("voiceDock");
    if (!dock) return;

    const show = !!V.supported && !!App.state.me && App.state.me.role !== "guest";
    dock.hidden = !show;

    if (!show) {
      if (V.want) stop(true);
      return;
    }

    if (V.dictTarget && !$(V.dictTarget)) {
      finishDictation(false);
    }
    updateFab();
  }

  bind();
  sync();

  window.AegisVoice = {
    supported: V.supported,
    sync: sync,
    start: begin,
    stop: function () { stop(false); },
    toggle: toggle,
    dictate: dictate,
    speak: speak,
  };
})();
