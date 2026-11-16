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
- **One-tap safety statuses** — *I'm safe*, *Uncomfortable*, *Need help* — shared instantly with every linked guardian.
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

The server starts at **http://127.0.0.1:8000** and opens your browser automatically. On first launch an empty SQLite database is created at `data/safety.db`; no accounts or records are inserted.

### Sign-in options

- **Continue with Google** — real Google OAuth 2.0. A new Google account is created as a *person* account; an existing account with the same verified email is reused, so a guardian registered by email can also sign in with Google.
- **Email and password** — register a person or guardian account directly.
- **Continue as guest** — a read-only session with no personal data. Guests can open the console shell but cannot share location, post a status, raise an alert or send messages.

#### Enable Google sign-in

1. In Google Cloud Console, create an **OAuth 2.0 Client ID** of type *Web application*.
2. Add the authorized redirect URI: `http://127.0.0.1:8000/api/auth/google/callback`
3. Provide the credentials in either form:
   - Environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `GOOGLE_REDIRECT_URI`.
   - Or `data/oauth.json`:
     ```json
     {"client_id": "...", "client_secret": "...", "redirect_uri": "http://127.0.0.1:8000/api/auth/google/callback"}
     ```
4. Restart the server. Until credentials are present, the Google button returns to the login page with a setup message.

`data/oauth.json` is inside the git-ignored `data/` folder — never commit your client secret.

### Create your first accounts

1. Open the site and choose **Create account**.
2. Register the **person** account (select *Visually impaired*). Their **guardian link code** is shown in the care-circle card and account menu.
3. Sign out, then register a **guardian** account (or use a second browser/incognito window).
4. As the guardian, open the account menu → **Link another person** and enter the person's code (format `SAFE-XXXX`).
5. Sign back in as the person and switch on **Share live location**; allow the browser location prompt.

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

### Tech stack

| Layer | Choice |
| --- | --- |
| Backend | FastAPI, Uvicorn, Pydantic |
| Realtime | Native WebSocket (`/ws`) with heartbeat + reconnect |
| Database | SQLite (file-based, zero setup) |
| Auth | HS256 JWT in an `HttpOnly` cookie, `scrypt` password hashing |
| Frontend | Semantic HTML, modern CSS, vanilla JS classic scripts |
| Maps | Leaflet 1.9 + CARTO tiles |

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
| `GET` | `/api/auth/google/start` | Begin Google OAuth sign-in |
| `GET` | `/api/auth/google/callback` | Google OAuth redirect handler |
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
- Google sign-in uses OAuth 2.0 with a signed `state` cookie and only accepts Google-verified email addresses. Client secrets stay server-side in environment variables or the git-ignored `data/oauth.json`.
- Guest sessions are read-only: they carry a guest role in the signed cookie, never touch the database, and every state-changing endpoint rejects them with `403`.
- Before public deployment: serve over HTTPS, set a fixed signing key via a secret manager, review the rate limits, and configure backups. If you enable Google sign-in publicly, add your production HTTPS redirect URI to the Google OAuth client.

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

MIT — see [LICENSE](LICENSE).
