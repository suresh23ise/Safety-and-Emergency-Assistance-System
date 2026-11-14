# Aegis Assist — Safety & Emergency Assistance System

A complete, realtime web application that connects a **visually impaired person** with the **guardians** who look after them. The person shares their live location and safety status from an accessible console; guardians monitor them, receive instant SOS alerts, request check-ins and review history — all from the same website.

Built as a final-year full-stack project with **FastAPI + SQLite + WebSockets** and a hand-crafted, dependency-free frontend (vanilla JS + Leaflet). No build step, no Node.js required.

![Python](https://img.shields.io/badge/Python-3.10%2B-3776ab?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688?logo=fastapi&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-built--in-003b57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-6b7280)

---

## Highlights

### Person console (visually impaired user)
- **One-tap safety statuses** — *I'm safe*, *Uncomfortable*, *Need help* — shared instantly with every guardian.
- **Large SOS button** — press and hold for 2 seconds, review a 5-second confirmation countdown, then send. An accidental click never raises an alarm.
- **Emergency alert dialog** — describe what is happening and attach the current position.
- **Live GPS sharing** — real browser GPS (`navigator.geolocation`) or a built-in demo route, with a visible on/off switch.
- **Automatic check-ins** — configurable interval (5/10/15/30 min) so guardians know the person is okay even without interaction.
- **Voice guidance & screen-reader support** — speech synthesis, ARIA live regions, full keyboard operation, 2.0s hold with keyboard equivalent.
- **Call & message guardians**, view personal history and export it as CSV.
- **Invite guardians** with a rotatable one-time link code.

### Guardian console
- **Live map** with a continuous GPS trail, accuracy circle, follow mode and recenter.
- **Safety dashboard** — current status, last seen, distance today, GPS point count, alerts in the last 7 days.
- **Full-screen emergency takeover** when an SOS arrives, with call, acknowledge and review actions (plus desktop notifications and optional voice).
- **Request a check-in** — the person is prompted immediately and the guardian sees the fulfilment in realtime.
- **Alert centre** — acknowledge → resolve workflow with filters for active/resolved.
- **History** — locations, safety updates and alerts across 1/7/30 days, with CSV export.
- **Care circle management** — link people with a code, unlink them, edit profile.
- **Messaging** — realtime chat with unread badges and notifications.

### Shared experience
- **8 hand-tuned themes**: Cyber Night, Sunset Ember, Aurora Violet, Ocean Deep, Midnight Blue, Magma Red, Forest Moss, Titanium Graphite.
- **Accessibility settings**: 3 text sizes, reduce motion, high contrast — saved locally and to the account.
- **Guided demo single sign-on** for Google and Apple (no OAuth credentials needed), plus **Guest Mode** that is genuinely read-only.
- Responsive layout, keyboard-first navigation, reduced-motion and high-contrast CSS variants.

---

## Quick start

### Requirements
- Python **3.10+** (developed on 3.12)
- A modern browser (Chrome or Edge recommended — the theme system uses `color-mix()` and `mask-image`)

### Windows (one click)
```bat
start.bat
```

### Any platform
```bash
cd aegis-assist
python -m pip install -r requirements.txt
python run.py
```

The server starts at **http://127.0.0.1:8000** and opens your browser automatically.

> On first launch the SQLite database is created at `data/aegis.db` and seeded with demo accounts, a week of location history, safety check-ins and alerts.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Person (visually impaired) | `ananya@aegis.demo` | `Aegis@123` |
| Guardian | `ramesh@aegis.demo` | `Aegis@123` |
| Guardian | `priya@aegis.demo` | `Aegis@123` |
| Guest (read-only) | `guest@aegis.demo` | `Aegis@123` |

Ananya's guardian link code is **`AEGIS-7K2P`** on a fresh database.

The Google and Apple buttons open a clearly labelled demo identity picker — they never contact Google or Apple. You can also register a brand-new person or guardian account from the Email & Password panel.

---

## How it works

```
Browser (person) ─┐
                  ├─ HTTP REST + WebSocket ──► FastAPI ──► SQLite (data/aegis.db)
Browser (guardian)┘                              │
                                                 └─ demo GPS simulator / GPS relay
```

- The person's console posts positions to `POST /api/locations`; guardians receive them over the shared `/ws` WebSocket.
- A background simulator moves Ananya along a route in Cubbon Park, Bengaluru every few seconds. It pauses automatically whenever real device GPS is fresh, so the demo never fights the browser.
- Status updates, SOS/emergency alerts, acknowledgements, resolutions, messages and check-in requests are all pushed to the right users in realtime.
- Every write is authorised server-side: guardians can only read people they are linked to, and guests are rejected with `403`.

### Tech stack

| Layer | Choice |
| --- | --- |
| Backend | FastAPI, Uvicorn, Pydantic |
| Realtime | Native WebSocket (`/ws`) with heartbeat + reconnect |
| Database | SQLite (WAL-friendly, file-based, zero setup) |
| Auth | HS256 JWT in an `HttpOnly` cookie, `scrypt` password hashing |
| Frontend | Semantic HTML, modern CSS, vanilla JS classic scripts (no framework) |
| Maps | Leaflet 1.9 + CARTO dark tiles, canvas trail rendering |

---

## Project structure

```
aegis-assist/
├─ run.py                  # launcher (opens the browser)
├─ start.bat               # Windows one-click start
├─ requirements.txt
├─ server/
│  ├─ main.py              # FastAPI app: routes, WebSocket hub, auth, simulator
│  ├─ db.py                # SQLite schema + connection helpers
│  ├─ security.py          # JWT signing/verification, scrypt hashing
│  └─ seed.py              # demo users, routes, history, alerts, link codes
├─ static/
│  ├─ index.html           # logo + login / register page
│  ├─ app.html             # application shell
│  ├─ assets/              # shield logo + SVG icon sprite
│  ├─ css/                 # base (themes/accessibility), login, app
│  └─ js/
│     ├─ api.js            # fetch wrapper, toasts, sound, utilities
│     ├─ theme.js          # 8 themes + accessibility preferences
│     ├─ login.js          # sign-in, register, demo SSO, guest
│     ├─ aegis-core.js     # shared state and helpers
│     ├─ aegis-views.js    # person console + messages views
│     ├─ aegis-views2.js   # guardian home/map/alerts/history views
│     ├─ aegis-render.js   # rendering, Leaflet maps, navigation
│     ├─ aegis-actions.js  # modals, SOS, sharing, chat, history, events
│     └─ aegis-realtime.js # boot, WebSocket events, notifications, tickers
└─ data/                   # generated at runtime (git-ignored)
```

---

## API reference

All endpoints return JSON. Authentication is the `aegis_session` HttpOnly cookie.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create a person or guardian account |
| `POST` | `/api/auth/login` | Email + password sign-in |
| `POST` | `/api/auth/demo` | Demo identity for Google/Apple/Guest buttons |
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
| `GET` | `/api/people/{id}/history` | Combined history for CSV/table views |
| `GET` | `/api/health` | Liveness probe |
| `WS` | `/ws` | Realtime event stream |

**Realtime event types:** `hello`, `location`, `status`, `alert`, `alert:update`, `message`, `checkin:request`, `checkin:fulfilled`, `ping`/`pong`.

### Data model

`users`, `settings`, `links`, `locations`, `status_updates`, `alerts`, `messages`, `checkin_requests`, plus a `meta` table. Indexed on `(user_id, ts)` for history queries and message threads.

---

## Security & privacy notes

- Passwords are hashed with `scrypt` and a per-user salt — never stored or logged in plaintext.
- Sessions are signed JWTs delivered in an `HttpOnly`, `SameSite=Lax` cookie, so page scripts cannot read them.
- Every read is scoped by the `links` table: a guardian can only see people who explicitly linked them. A person can only read their own data.
- Guests are enforced read-only on the server (`403`), not just hidden in the UI.
- Link codes are short, rotatable bearer secrets; rotating one immediately invalidates the old value.
- This is a project/demo build: OAuth is simulated, transport is plain HTTP locally, and the JWT secret is generated for local use. For deployment, serve over HTTPS, set a fixed `AEGIS_SECRET`, add rate limiting, and wire real Google/Apple OAuth.
- The maps use CARTO/OSM tiles; GPS data stays in the local SQLite file.

---

## Accessibility

- Full keyboard path to every action, visible focus states and `aria-live` announcements.
- SOS supports both press-and-hold and keyboard press, with spoken feedback.
- 3 text scales, reduce-motion and high-contrast modes.
- Semantic landmarks, labelled controls, large touch targets and a high-contrast palette.
- Voice guidance reads statuses, alerts and incoming check-in requests aloud.

---

## Scripts

| Command | Description |
| --- | --- |
| `python run.py` | Start on `http://127.0.0.1:8000` and open the browser |
| `python run.py --port 9000` | Start on another port |
| `python run.py --no-browser` | Start without opening a browser |
| `python run.py --reload` | Auto-reload on file changes (development) |

---

## License

MIT — free to use for learning and projects. Demo names, places and phone numbers are fictional.
