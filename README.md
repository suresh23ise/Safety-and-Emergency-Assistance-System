# Safety & Emergency Assistance System

A realtime web application that connects a **visually impaired person** with the **guardians** who look after them. The person shares their live location and safety status from an accessible console; guardians monitor them, receive instant SOS alerts, request check-ins and review history — all from the same website.

The application ships with an **empty database**. No demo users, sample locations, fake alerts or example accounts are included — every account, care circle and record is created by real users.

Built with **FastAPI + SQLite + WebSockets** and a dependency-free frontend (vanilla JS + Leaflet). No build step and no Node.js required.

![Python](https://img.shields.io/badge/Python-3.10%2B-3776ab?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688?logo=fastapi&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-built--in-003b57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-6b7280)

---

## Features

### Person console (visually impaired user)
- **Hands-free voice control** — tap **Voice** (or press `Alt+Shift+V`) and speak: *help* (two-step SOS), *I am safe*, *share my location*, *where am I*, *open messages*, *read messages*, *type a message*, *send*, *call my guardian*, *call 112*, *stop*. Replies are spoken aloud.
- **Voice typing** — microphone buttons next to the chat composer, check-in note and emergency message let the person dictate instead of typing. Say *stop dictation* to finish.
- **One-tap safety statuses** — *I'm safe*, *Uncomfortable*, *Need help* — shared instantly with every linked guardian. Voice control can trigger the same actions.
- **Large SOS button** — press and hold for 2 seconds, review a 5-second confirmation countdown, then send. An accidental click never raises an alarm.
- **Emergency alert dialog** — describe what is happening and attach the current position.
- **Live GPS sharing** — uses the browser's real geolocation (`navigator.geolocation`) with an explicit on/off switch. Nothing is shared until the person enables it.
- **Automatic check-ins** — configurable interval (5/10/15/30 min) so guardians know the person is okay without manual interaction.
- **Voice guidance & screen-reader support** — speech synthesis, ARIA live regions, full keyboard operation.
- **Call & message guardians**, review personal history and export it as CSV.
- **Invite guardians** with a rotatable one-time link code.

### Guardian console
- **Live map** with a continuous GPS trail, accuracy circle, follow mode and recenter.
- **Safety dashboard** — current status, last seen, distance today, GPS point count, alerts in the last 7 days.
- **Full-screen emergency takeover** when an SOS arrives, with call, acknowledge and review actions (plus optional desktop notifications and voice).
- **Request a check-in** — the person is prompted immediately and fulfilment is confirmed in realtime.
- **Alert centre** — acknowledge → resolve workflow with filters for active/resolved.
- **History** — locations, safety updates and alerts across 1/7/30 days, with CSV export.
- **Care circle management** — link people with their code, unlink them, edit profile.
- **Messaging** — realtime chat with unread badges and notifications.

### Shared experience
- **8 themes**: Cyber Night, Sunset Ember, Aurora Violet, Ocean Deep, Midnight Blue, Magma Red, Forest Moss, Titanium Graphite.
- **Accessibility settings**: 3 text sizes, reduce motion, high contrast — saved locally and to the account.
- Responsive layout, keyboard-first navigation, reduced-motion and high-contrast CSS variants.

---

## Quick start

### Requirements
- Python **3.10+** (developed on 3.12)
- A modern browser with geolocation support (Chrome, Edge, Firefox or Safari)
- HTTPS or `localhost` for browser location permission

### Windows (one click)
```bat
start.bat
```

### Any platform
```bash
python -m pip install -r requirements.txt
python run.py
```

The server starts at **http://localhost:8000** and opens your browser automatically. On first launch an empty SQLite database is created at `data/safety.db`; no accounts or records are inserted.

### Sign-in options

- **Continue with Google** — Google Identity via Firebase Authentication. A new Google account is created with the role chosen in **I am joining as** (*person* or *guardian*); an existing account with the same verified email is reused and keeps its saved role.
- **Email and password** — register a person or guardian account directly.
- **Continue as guest** — a read-only session with no personal data. Guests can open the console shell but cannot share location, post a status, raise an alert or send messages.

#### Enable Google sign-in

Google sign-in uses **Firebase Authentication**. The public web config lives in `static/js/firebase-config.js`.

1. In [Firebase Console](https://console.firebase.google.com/) open project **final-year-project-59262**.
2. Go to **Authentication → Sign-in method** and enable **Google**.
3. Under **Authentication → Settings → Authorized domains**, make sure `localhost` is listed. If you open the site at `127.0.0.1`, add `127.0.0.1` there too (Firebase does not authorise it by default).
4. The browser signs in with a Google popup, then posts the Firebase ID token to `POST /api/auth/firebase`. The FastAPI server validates the token with Google (`iss`, `aud`, verified email) before creating the session.

The Firebase web API key is public by design — it is not a client secret. Never put a service-account key in the repository.

Direct Google OAuth is still supported as a fallback: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (or `data/oauth.json`) and the server exposes `/api/auth/google/start` and `/api/auth/google/callback`. `data/oauth.json` is git-ignored.

### Create your first accounts

1. Open the site and choose **Create account**.
2. In **I am joining as**, pick **Visually impaired person** or **Guardian**. The same choice applies to **Continue with Google**.
3. Register the **person** account. Their **guardian link code** is shown in the care-circle card and account menu.
4. Sign out, then register a **guardian** account (or use a second browser/incognito window).
5. As the guardian, open the account menu → **Link another person** and enter the person's code (format `SAFE-XXXX`).
6. Sign back in as the person and switch on **Share live location**; allow the browser location prompt.

Each person can invite multiple guardians. Codes can be rotated at any time to revoke old invitations.

> There are no default credentials. If you lose an account password, delete `data/safety.db` to reset the deployment and register again.

---

## How it works

```
Browser (person) ─┐
                  ├─ HTTP REST + WebSocket ──► FastAPI ──► SQLite (data/safety.db)
Browser (guardian)┘
```

- The person's console posts positions to `POST /api/locations`; linked guardians receive them over the shared `/ws` WebSocket.
- Status updates, SOS/emergency alerts, acknowledgements, resolutions, messages and check-in requests are pushed in realtime to the right users.
- Every read is authorised server-side: guardians can only read people who explicitly linked them, and people can only read their own records.
- The map is live even before the first GPS fix: it opens on a world view with a **No live position yet** card and a **Request a check-in** button. Leaflet is self-hosted under `static/vendor/leaflet/`, and tiles load from OpenStreetMap (default), Esri Satellite and Esri Dark Gray (all keyless) with automatic fallback. They need an internet connection but **no API key or Google Maps account**. If a marker never appears, the person must be signed in, have **Share live location** switched on, and allow the browser's location permission.

### Tech stack

| Layer | Choice |
| --- | --- |
| Backend | FastAPI, Uvicorn, Pydantic |
| Realtime | Native WebSocket (`/ws`) with heartbeat + reconnect |
| Database | SQLite (file-based, zero setup) |
| Auth | HS256 JWT in an `HttpOnly` cookie, `scrypt` password hashing |
| Frontend | Semantic HTML, modern CSS, vanilla JS classic scripts |
| Maps | Leaflet 1.9 (self-hosted) + OpenStreetMap, Esri Satellite and Esri Dark Gray tiles — no API key |
| Voice | Web Speech API (`SpeechRecognition` + `speechSynthesis`) |

---

## Project structure

```
├─ run.py                  # launcher (opens the browser)
├─ start.bat               # Windows one-click start
├─ requirements.txt
├─ server/
│  ├─ main.py              # FastAPI app: routes, WebSocket hub, auth
│  ├─ db.py                # SQLite schema + connection helpers
│  ├─ security.py          # JWT signing/verification, scrypt hashing
│  └─ __init__.py
├─ static/
│  ├─ index.html           # logo + sign in / create account page
│  ├─ app.html             # application shell
│  ├─ assets/              # logo + SVG icon sprite
│  ├─ css/                 # base (themes/accessibility), login, app
│  └─ js/
│     ├─ api.js            # fetch wrapper, toasts, sound, utilities
│     ├─ theme.js          # 8 themes + accessibility preferences
│     ├─ login.js          # sign-in and registration
│     ├─ aegis-core.js     # shared state and helpers
│     ├─ aegis-views.js    # person console + messages views
│     ├─ aegis-views2.js   # guardian home/map/alerts/history views
│     ├─ aegis-render.js   # rendering, Leaflet maps, navigation
│     ├─ aegis-actions.js  # modals, SOS, sharing, chat, history, events
│     ├─ aegis-voice.js    # hands-free voice control + voice typing
│     └─ aegis-realtime.js # boot, WebSocket events, notifications
└─ data/                   # created at runtime (git-ignored)
```

---

## API reference

All endpoints return JSON. Authentication is the `safety_session` HttpOnly cookie.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create a person or guardian account |
| `POST` | `/api/auth/login` | Email + password sign-in |
| `POST` | `/api/auth/guest` | Start a read-only guest session |
| `POST` | `/api/auth/firebase` | Exchange a Firebase ID token for a session |
| `GET` | `/api/auth/google/start` | Begin direct Google OAuth (fallback) |
| `GET` | `/api/auth/google/callback` | Google OAuth redirect handler (fallback) |
| `POST` | `/api/auth/logout` | Clear the session |
| `GET` | `/api/me` | Current user + settings + link code |
| `PATCH` | `/api/me` | Update name, phone or preferences |
| `POST` | `/api/me/rotate-code` | Replace the guardian link code |
| `GET` | `/api/dashboard` | Role-aware console payload |
| `POST` | `/api/locations` | Share a GPS position (person only) |
| `GET` | `/api/people/{id}/locations` | Location trail (linked guardians only) |
| `POST` | `/api/status` | Post a safety status/check-in |
| `GET` | `/api/people/{id}/status` | Status history |
| `POST` | `/api/alerts` | Raise SOS / emergency alert |
| `GET` | `/api/people/{id}/alerts` | Alerts for a person |
| `POST` | `/api/alerts/{id}/ack` | Acknowledge an alert |
| `POST` | `/api/alerts/{id}/resolve` | Resolve an alert |
| `POST` | `/api/checkin-requests` | Guardian asks for a check-in |
| `GET` | `/api/messages/{peerId}` | Conversation thread |
| `POST` | `/api/messages` | Send a message |
| `GET` | `/api/links` | List linked people/guardians |
| `POST` | `/api/links` | Link a person by code |
| `DELETE` | `/api/links/{personId}` | Unlink a person |
| `GET` | `/api/people/{id}/history` | Combined history for tables/CSV |
| `GET` | `/api/health` | Liveness probe |
| `WS` | `/ws` | Realtime event stream |

**Realtime event types:** `hello`, `location`, `status`, `alert`, `alert:update`, `message`, `checkin:request`, `checkin:fulfilled`, `ping`/`pong`.

### Data model

`users`, `settings`, `links`, `locations`, `status_updates`, `alerts`, `messages`, `checkin_requests`, and `meta`. Indexed on `(user_id, ts)` for history queries and message threads.

---

## Security & privacy notes

- Passwords are hashed with `scrypt` and a per-user salt — never stored or logged in plaintext.
- Sessions are signed JWTs delivered in an `HttpOnly`, `SameSite=Lax` cookie, so page scripts cannot read them. The signing key is generated locally in `data/session.key`.
- Every read is scoped by the `links` table: a guardian can only see people who explicitly linked them. A person can only read their own data.
- Login and registration are rate limited by client address.
- Link codes are short, rotatable bearer secrets; rotating one immediately invalidates the old value.
- No third-party analytics, advertising or location resale. GPS data stays in the local SQLite database.
- Google sign-in uses Firebase Authentication. The server validates every ID token against Google before creating a session, and only accepts verified email addresses.
- Guest sessions are read-only: they carry a guest role in the signed cookie, never touch the database, and every state-changing endpoint rejects them with `403`.
- Before public deployment: serve over HTTPS, set a fixed signing key via a secret manager, review the rate limits, and configure backups. If you enable Google sign-in publicly, add your production HTTPS domain to Firebase Authentication → Authorized domains.

---

## Accessibility

- Full keyboard path to every action, visible focus states and `aria-live` announcements.
- SOS supports both press-and-hold and keyboard press, with spoken feedback.
- 3 text scales, reduce-motion and high-contrast modes.
- Semantic landmarks, labelled controls, large touch targets and a high-contrast palette.
- Voice guidance reads statuses, alerts and incoming check-in requests aloud.
- **Hands-free voice control** for the person console: SOS (with a spoken yes/no confirmation), safety statuses, location sharing, navigation, message reading/sending, guardian calling and emergency calling. A floating **Voice** button stays available on every screen; `Alt+Shift+V` toggles it. Replies are spoken with `speechSynthesis`.
- **Voice typing** fills the chat composer, check-in note and emergency description; say *stop dictation* when finished.
- Voice control uses the browser's Web Speech API. Use Chrome, Edge or Safari with a microphone. If the browser blocks the microphone, spoken and on-screen instructions explain how to allow it.

---

## Scripts

| Command | Description |
| --- | --- |
| `python run.py` | Start on `http://localhost:8000` and open the browser |
| `python run.py --port 9000` | Start on another port |
| `python run.py --no-browser` | Start without opening a browser |
| `python run.py --reload` | Auto-reload on file changes (development) |

---

## License

MIT — see [LICENSE](LICENSE).
