"""Safety & Emergency Assistance System — FastAPI backend.

Realtime safety and emergency assistance platform for visually impaired users
and their guardians. REST for state, WebSockets for live updates.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import math
import os
import secrets
import time
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .security import (
    hash_password,
    new_id,
    new_link_code,
    normalize_email,
    sign_token,
    valid_email,
    verify_password,
    verify_token,
)

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
COOKIE = "safety_session"
THEMES = {"sunset", "cyber", "aurora", "ocean", "midnight", "magma", "forest", "titanium"}
OAUTH_STATE_COOKIE = "oauth_state"
GUEST_ID = "usr_guest"
GUEST_USER = {
    "id": GUEST_ID,
    "name": "Guest",
    "email": "",
    "phone": "",
    "role": "guest",
    "avatar_hue": 42,
    "provider": "guest",
    "link_code": None,
    "created_at": None,
    "last_seen": None,
}
GUEST_SETTINGS = {
    "autoShare": False,
    "shareSeconds": 5,
    "checkinMinutes": 10,
    "checkinEnabled": False,
    "theme": "sunset",
    "voice": False,
    "textScale": 1,
    "reduceMotion": False,
    "highContrast": False,
    "sosHoldMs": 2000,
}


def google_config(base_url: str | None = None) -> tuple[str, str, str]:
    """Return (client_id, client_secret, redirect_uri) from env or data/oauth.json."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI", "").strip()
    config_file = ROOT / "data" / "oauth.json"
    if (not client_id or not client_secret) and config_file.exists():
        try:
            config = json.loads(config_file.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            config = {}
        client_id = client_id or str(config.get("client_id", "")).strip()
        client_secret = client_secret or str(config.get("client_secret", "")).strip()
        redirect_uri = redirect_uri or str(config.get("redirect_uri", "")).strip()
    if not redirect_uri:
        base = (base_url or "http://127.0.0.1:8000").rstrip("/")
        redirect_uri = base + "/api/auth/google/callback"
    return client_id, client_secret, redirect_uri


# --------------------------------------------------------------------------- realtime
class Manager:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.rooms.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        peers = self.rooms.get(user_id)
        if peers:
            peers.discard(ws)
            if not peers:
                self.rooms.pop(user_id, None)

    async def send(self, user_id: str, payload: dict) -> None:
        peers = list(self.rooms.get(user_id, ()))
        for ws in peers:
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(user_id, ws)

    async def send_many(self, user_ids, payload: dict) -> None:
        targets = {uid for uid in user_ids if uid}
        if targets:
            await asyncio.gather(*(self.send(uid, payload) for uid in targets))


manager = Manager()


# --------------------------------------------------------------------------- models
class LoginIn(BaseModel):
    email: str
    password: str


class RegisterIn(BaseModel):
    name: str
    email: str
    password: str
    role: Literal["person", "guardian"] = "person"
    phone: str = ""


class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float = Field(default=0, ge=0, le=100000)
    speed: float | None = None
    heading: float | None = None
    source: Literal["device"] = "device"


class StatusIn(BaseModel):
    state: Literal["safe", "help", "uncomfortable", "checkin"]
    note: str = ""
    source: str = "manual"


class AlertIn(BaseModel):
    type: Literal["sos", "emergency"] = "sos"
    message: str = ""
    lat: float | None = None
    lng: float | None = None


class CheckinIn(BaseModel):
    personId: str


class LinkIn(BaseModel):
    code: str


class MessageIn(BaseModel):
    toId: str
    text: str


class ProfileIn(BaseModel):
    name: str | None = None
    phone: str | None = None
    settings: dict | None = None


# --------------------------------------------------------------------------- helpers
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ago(seconds: int) -> str:
    return iso(utcnow() - timedelta(seconds=seconds))


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "phone": user.get("phone") or "",
        "role": user["role"],
        "avatarHue": user.get("avatar_hue", 42),
        "provider": user.get("provider", "password"),
        "createdAt": user.get("created_at"),
        "lastSeen": user.get("last_seen"),
    }


def me_payload(user: dict) -> dict:
    data = public_user(user)
    if user.get("role") == "guest":
        data["linkCode"] = None
        data["settings"] = dict(GUEST_SETTINGS)
        data["readOnly"] = True
        return data
    data["linkCode"] = user.get("link_code")
    data["settings"] = db.settings_for(user["id"])
    return data


def get_user(user_id: str) -> dict | None:
    return db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))


def latest_location(user_id: str) -> dict | None:
    row = db.fetch_one(
        "SELECT * FROM locations WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
        (user_id,),
    )
    if not row:
        return None
    return {
        "lat": row["lat"],
        "lng": row["lng"],
        "accuracy": row["accuracy"],
        "speed": row["speed"],
        "heading": row["heading"],
        "source": row["source"],
        "ts": row["ts"],
    }


def latest_status(user_id: str) -> dict | None:
    row = db.fetch_one(
        "SELECT * FROM status_updates WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
        (user_id,),
    )
    return serialize_status(row) if row else None


def serialize_status(row: dict) -> dict:
    return {
        "id": row["id"],
        "personId": row["user_id"],
        "state": row["state"],
        "note": row["note"],
        "source": row["source"],
        "ts": row["ts"],
    }


def serialize_alert(row: dict) -> dict:
    return {
        "id": row["id"],
        "personId": row["user_id"],
        "personName": row.get("person_name"),
        "personPhone": row.get("person_phone"),
        "type": row["type"],
        "severity": row["severity"],
        "message": row["message"],
        "lat": row["lat"],
        "lng": row["lng"],
        "ts": row["ts"],
        "status": row["status"],
        "ackedBy": row["acked_by"],
        "ackedAt": row["acked_at"],
        "resolvedAt": row["resolved_at"],
    }


def alerts_for(user_id: str, limit: int = 30, active_only: bool = False) -> list[dict]:
    sql = (
        "SELECT a.*, u.name AS person_name, u.phone AS person_phone FROM alerts a "
        "JOIN users u ON u.id = a.user_id WHERE a.user_id = ? "
    )
    if active_only:
        sql += "AND a.status != 'resolved' "
    sql += "ORDER BY a.ts DESC LIMIT ?"
    return [serialize_alert(r) for r in db.fetch_all(sql, (user_id, limit))]


def watcher_ids(person_id: str) -> list[str]:
    rows = db.fetch_all(
        "SELECT l.guardian_id FROM links l JOIN users u ON u.id = l.guardian_id WHERE l.person_id = ?",
        (person_id,),
    )
    return [r["guardian_id"] for r in rows]


def person_ids_for(guardian_id: str) -> list[str]:
    rows = db.fetch_all(
        "SELECT l.person_id FROM links l JOIN users u ON u.id = l.person_id WHERE l.guardian_id = ? AND u.role = 'person'",
        (guardian_id,),
    )
    return [r["person_id"] for r in rows]


def guardian_rows_for(person_id: str) -> list[dict]:
    rows = db.fetch_all(
        "SELECT u.* FROM links l JOIN users u ON u.id = l.guardian_id WHERE l.person_id = ? AND u.role = 'guardian' ORDER BY u.name",
        (person_id,),
    )
    return rows


def is_linked(person_id: str, guardian_id: str) -> bool:
    return bool(
        db.fetch_one(
            "SELECT 1 AS ok FROM links WHERE person_id = ? AND guardian_id = ?",
            (person_id, guardian_id),
        )
    )


def can_view_person(user: dict, person_id: str) -> bool:
    person = get_user(person_id)
    if not person or person["role"] != "person":
        return False
    if user["id"] == person_id:
        return True
    return is_linked(person_id, user["id"])


def require_person_access(user: dict, person_id: str) -> dict:
    if not can_view_person(user, person_id):
        raise HTTPException(status_code=403, detail="You do not have access to this person.")
    return get_user(person_id)  # type: ignore[return-value]


def can_message(user: dict, peer_id: str) -> bool:
    peer = get_user(peer_id)
    if not peer:
        return False
    if user["role"] == "person" and peer["role"] == "guardian":
        return is_linked(user["id"], peer_id)
    if user["role"] == "guardian" and peer["role"] == "person":
        return is_linked(peer_id, user["id"])
    return False


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def distance_24h(person_id: str) -> int:
    rows = db.fetch_all(
        "SELECT lat, lng FROM locations WHERE user_id = ? AND ts >= ? ORDER BY ts ASC",
        (person_id, ago(86400)),
    )
    total = 0.0
    for a, b in zip(rows, rows[1:]):
        total += haversine_m((a["lat"], a["lng"]), (b["lat"], b["lng"]))
    return int(total)


def unread_count(user_id: str, peer_id: str) -> int:
    return int(
        db.scalar(
            "SELECT COUNT(*) FROM messages WHERE to_id = ? AND from_id = ? AND read_at IS NULL",
            (user_id, peer_id),
        )
        or 0
    )


def person_overview(person_id: str, viewer_id: str) -> dict:
    person = get_user(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    active = alerts_for(person_id, 10, active_only=True)
    statuses = db.fetch_all(
        "SELECT * FROM status_updates WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT 12",
        (person_id,),
    )
    return {
        "user": public_user(person),
        "location": latest_location(person_id),
        "status": latest_status(person_id),
        "statusHistory": [serialize_status(r) for r in statuses],
        "activeAlerts": active,
        "unread": unread_count(viewer_id, person_id),
        "stats": {
            "distance24h": distance_24h(person_id),
            "checkins24h": int(
                db.scalar(
                    "SELECT COUNT(*) FROM status_updates WHERE user_id = ? AND ts >= ?",
                    (person_id, ago(86400)),
                )
                or 0
            ),
            "alerts7d": int(
                db.scalar(
                    "SELECT COUNT(*) FROM alerts WHERE user_id = ? AND ts >= ?",
                    (person_id, ago(7 * 86400)),
                )
                or 0
            ),
            "points24h": int(
                db.scalar(
                    "SELECT COUNT(*) FROM locations WHERE user_id = ? AND ts >= ?",
                    (person_id, ago(86400)),
                )
                or 0
            ),
        },
    }


# --------------------------------------------------------------------------- auth dependency
def token_from_request(request: Request) -> str | None:
    token = request.cookies.get(COOKIE)
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    return token


def current_user(request: Request) -> dict:
    data = verify_token(token_from_request(request))
    if not data:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    if data["sub"] == GUEST_ID:
        return dict(GUEST_USER)
    user = get_user(data["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    return user


def writer_user(user: dict = Depends(current_user)) -> dict:
    """Reject read-only guest sessions for every state-changing endpoint."""
    if user["role"] == "guest":
        raise HTTPException(status_code=403, detail="Guest mode is read-only. Sign in to make changes.")
    return user


def set_session(response: Response, user: dict) -> None:
    response.set_cookie(
        COOKIE,
        sign_token(user["id"], user["role"]),
        max_age=7 * 86400,
        httponly=True,
        samesite="lax",
        path="/",
    )


# --------------------------------------------------------------------------- rate limiter
_attempts: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request, limit: int = 12, window: int = 300) -> None:
    ip = (request.client.host if request.client else "local") or "local"
    bucket = _attempts[ip]
    now = time.time()
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait a few minutes.")
    bucket.append(now)


# --------------------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(title="Safety & Emergency Assistance System", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path == "/" or request.url.path == "/app" or request.url.path.startswith("/static/"):
        # Always revalidate so a redeploy is picked up without a hard refresh.
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/app")
def app_page():
    return FileResponse(STATIC / "app.html")


# --------------------------------------------------------------------------- auth routes
@app.post("/api/auth/register")
def register(body: RegisterIn, request: Request, response: Response):
    rate_limit(request)
    name = body.name.strip()
    email = normalize_email(body.email)
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name.")
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="That email address doesn't look right.")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Use at least 8 characters for your password.")
    if db.fetch_one("SELECT id FROM users WHERE email = ?", (email,)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    uid = new_id("usr")
    pwd, salt = hash_password(body.password)
    code = new_link_code() if body.role == "person" else None
    hue = (abs(hash(email)) % 360)
    db.execute(
        "INSERT INTO users (id, name, email, phone, role, password_hash, password_salt, provider, avatar_hue, link_code, created_at, last_seen) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'password', ?, ?, ?, ?)",
        (uid, name[:60], email, body.phone.strip()[:30], body.role, pwd, salt, hue, code, iso(), iso()),
    )
    db.ensure_settings(uid)
    user = get_user(uid)
    set_session(response, user)  # type: ignore[arg-type]
    return {"user": me_payload(user)}  # type: ignore[arg-type]


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    rate_limit(request)
    email = normalize_email(body.email)
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not verify_password(body.password, user["password_hash"], user["password_salt"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    db.execute("UPDATE users SET last_seen = ? WHERE id = ?", (db.now_iso(), user["id"]))
    set_session(response, user)
    return {"user": me_payload(user)}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.post("/api/auth/guest")
def guest_login(request: Request, response: Response):
    rate_limit(request, limit=30)
    user = dict(GUEST_USER)
    set_session(response, user)
    return {"user": me_payload(user), "readOnly": True}


@app.get("/api/auth/google/start")
def google_start(request: Request):
    client_id, client_secret, redirect_uri = google_config(str(request.base_url))
    if not client_id or not client_secret:
        return RedirectResponse("/?oauth=unconfigured", status_code=302)
    state = secrets.token_urlsafe(24)
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            "prompt": "select_account",
        }
    )
    response = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + query, status_code=302)
    response.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        max_age=600,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return response


@app.get("/api/auth/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        return RedirectResponse("/?oauth=denied", status_code=302)
    expected = request.cookies.get(OAUTH_STATE_COOKIE) or ""
    if not code or not state or not expected or not hmac.compare_digest(state, expected):
        return RedirectResponse("/?oauth=state", status_code=302)

    client_id, client_secret, redirect_uri = google_config(str(request.base_url))
    if not client_id or not client_secret:
        return RedirectResponse("/?oauth=unconfigured", status_code=302)

    try:
        body = urllib.parse.urlencode(
            {
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            }
        ).encode("utf-8")
        token_req = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(token_req, timeout=20) as res:
            token_data = json.loads(res.read().decode("utf-8"))
        access_token = token_data.get("access_token")
        if not access_token:
            raise ValueError("missing access token")
        info_req = urllib.request.Request(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": "Bearer " + access_token},
        )
        with urllib.request.urlopen(info_req, timeout=20) as res:
            info = json.loads(res.read().decode("utf-8"))
    except Exception:
        return RedirectResponse("/?oauth=exchange", status_code=302)

    if not info.get("email_verified"):
        return RedirectResponse("/?oauth=email", status_code=302)

    email = normalize_email(str(info.get("email", "")))
    if not valid_email(email):
        return RedirectResponse("/?oauth=email", status_code=302)

    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user:
        uid = new_id("usr")
        name = str(info.get("name") or email.split("@")[0]).strip()[:60] or "Google user"
        hue = abs(hash(email)) % 360
        db.execute(
            "INSERT INTO users (id, name, email, phone, role, password_hash, password_salt, provider, avatar_hue, link_code, created_at, last_seen) "
            "VALUES (?, ?, ?, '', 'person', NULL, NULL, 'google', ?, ?, ?, ?)",
            (uid, name, email, hue, new_link_code(), iso(), iso()),
        )
        db.ensure_settings(uid)
        user = get_user(uid)
    else:
        db.execute("UPDATE users SET last_seen = ? WHERE id = ?", (db.now_iso(), user["id"]))
    if not user:
        return RedirectResponse("/?oauth=exchange", status_code=302)

    target = RedirectResponse("/app", status_code=302)
    target.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    set_session(target, user)
    return target


@app.get("/api/me")
def api_me(user: dict = Depends(current_user)):
    db.execute("UPDATE users SET last_seen = ? WHERE id = ?", (db.now_iso(), user["id"]))
    payload = me_payload(user)
    return payload


@app.patch("/api/me")
def update_me(body: ProfileIn, user: dict = Depends(writer_user)):
    if body.name is not None:
        name = body.name.strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Name is too short.")
        db.execute("UPDATE users SET name = ? WHERE id = ?", (name[:60], user["id"]))
    if body.phone is not None:
        db.execute("UPDATE users SET phone = ? WHERE id = ?", (body.phone.strip()[:30], user["id"]))

    if body.settings:
        s = body.settings
        allowed = {
            "autoShare": ("auto_share", bool),
            "checkinEnabled": ("checkin_enabled", bool),
            "voice": ("voice", bool),
            "reduceMotion": ("reduce_motion", bool),
            "highContrast": ("high_contrast", bool),
            "theme": ("theme", str),
            "shareSeconds": ("share_seconds", int),
            "checkinMinutes": ("checkin_minutes", int),
            "sosHoldMs": ("sos_hold_ms", int),
            "textScale": ("text_scale", float),
        }
        for key, (column, kind) in allowed.items():
            if key not in s:
                continue
            value = s[key]
            if kind is bool:
                value = 1 if value else 0
            elif kind is int:
                value = int(value)
            elif kind is float:
                value = float(value)
            else:
                value = str(value)
                if value not in THEMES:
                    continue
            db.execute(f"UPDATE settings SET {column} = ? WHERE user_id = ?", (value, user["id"]))
    return {"user": me_payload(get_user(user["id"]))}  # type: ignore[arg-type]


@app.post("/api/me/rotate-code")
def rotate_code(user: dict = Depends(writer_user)):
    if user["role"] != "person":
        raise HTTPException(status_code=403, detail="Only a person account has a guardian link code.")
    for _ in range(12):
        code = new_link_code()
        if not db.fetch_one("SELECT 1 AS ok FROM users WHERE link_code = ?", (code,)):
            db.execute("UPDATE users SET link_code = ? WHERE id = ?", (code, user["id"]))
            return {"linkCode": code}
    raise HTTPException(status_code=500, detail="Could not generate a new code.")


# --------------------------------------------------------------------------- dashboard
@app.get("/api/dashboard")
async def dashboard(user: dict = Depends(current_user)):
    db.execute("UPDATE users SET last_seen = ? WHERE id = ?", (db.now_iso(), user["id"]))
    base = {"me": me_payload(user), "serverTime": db.now_iso()}

    if user["role"] == "person":
        guardians = []
        for g in guardian_rows_for(user["id"]):
            item = public_user(g)
            item["unread"] = unread_count(user["id"], g["id"])
            guardians.append(item)
        pending = db.fetch_all(
            "SELECT c.*, u.name AS guardian_name FROM checkin_requests c JOIN users u ON u.id = c.guardian_id "
            "WHERE c.person_id = ? AND c.fulfilled_at IS NULL ORDER BY c.ts DESC LIMIT 5",
            (user["id"],),
        )
        statuses = db.fetch_all(
            "SELECT * FROM status_updates WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT 20",
            (user["id"],),
        )
        base.update(
            {
                "guardians": guardians,
                "location": latest_location(user["id"]),
                "status": latest_status(user["id"]),
                "alerts": alerts_for(user["id"], 20),
                "activeAlerts": alerts_for(user["id"], 5, active_only=True),
                "checkinRequests": [
                    {"id": r["id"], "guardianId": r["guardian_id"], "guardianName": r["guardian_name"], "ts": r["ts"]}
                    for r in pending
                ],
                "statusHistory": [serialize_status(r) for r in statuses],
                "stats": {
                    "distance24h": distance_24h(user["id"]),
                    "checkins24h": int(
                        db.scalar("SELECT COUNT(*) FROM status_updates WHERE user_id = ? AND ts >= ?", (user["id"], ago(86400))) or 0
                    ),
                    "alerts7d": int(
                        db.scalar("SELECT COUNT(*) FROM alerts WHERE user_id = ? AND ts >= ?", (user["id"], ago(604800))) or 0
                    ),
                    "points24h": int(
                        db.scalar("SELECT COUNT(*) FROM locations WHERE user_id = ? AND ts >= ?", (user["id"], ago(86400))) or 0
                    ),
                },
            }
        )
    else:
        people = [person_overview(pid, user["id"]) for pid in person_ids_for(user["id"])]
        recent = []
        for p in people:
            for a in alerts_for(p["user"]["id"], 10):
                recent.append(a)
        recent.sort(key=lambda a: a["ts"], reverse=True)
        base.update({"people": people, "recentAlerts": recent[:12]})
    return base


# --------------------------------------------------------------------------- location
@app.post("/api/locations")
async def post_location(body: LocationIn, user: dict = Depends(writer_user)):
    if user["role"] != "person":
        raise HTTPException(status_code=403, detail="Only a person account can share live location.")
    db.execute(
        "INSERT INTO locations (user_id, lat, lng, accuracy, speed, heading, source, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user["id"], body.lat, body.lng, body.accuracy, body.speed, body.heading, body.source, db.now_iso()),
    )
    db.execute("UPDATE users SET last_seen = ? WHERE id = ?", (db.now_iso(), user["id"]))
    # Keep a generous rolling window of history.
    db.execute(
        "DELETE FROM locations WHERE user_id = ? AND id NOT IN "
        "(SELECT id FROM locations WHERE user_id = ? ORDER BY id DESC LIMIT 2000)",
        (user["id"], user["id"]),
    )
    payload = {
        "type": "location",
        "personId": user["id"],
        "location": {
            "lat": body.lat,
            "lng": body.lng,
            "accuracy": body.accuracy,
            "speed": body.speed,
            "heading": body.heading,
            "source": body.source,
            "ts": db.now_iso(),
        },
    }
    await manager.send_many(watcher_ids(user["id"]) + [user["id"]], payload)
    return {"ok": True}


@app.get("/api/people/{person_id}/locations")
def get_locations(person_id: str, limit: int = 500, user: dict = Depends(current_user)):
    require_person_access(user, person_id)
    limit = max(1, min(limit, 1500))
    rows = db.fetch_all(
        "SELECT lat, lng, accuracy, speed, heading, source, ts FROM locations WHERE user_id = ? ORDER BY ts ASC LIMIT ?",
        (person_id, limit),
    )
    return {"locations": rows}


# --------------------------------------------------------------------------- status
@app.post("/api/status")
async def post_status(body: StatusIn, user: dict = Depends(writer_user)):
    if user["role"] != "person":
        raise HTTPException(status_code=403, detail="Only a person account can post a safety status.")
    note = body.note.strip()[:300]
    ts = db.now_iso()
    status_id = db.execute(
        "INSERT INTO status_updates (user_id, state, note, source, ts) VALUES (?, ?, ?, ?, ?)",
        (user["id"], body.state, note, body.source[:20], ts),
    )
    fulfilled = db.fetch_all(
        "SELECT id FROM checkin_requests WHERE person_id = ? AND fulfilled_at IS NULL", (user["id"],)
    )
    if fulfilled:
        db.execute(
            "UPDATE checkin_requests SET fulfilled_at = ? WHERE person_id = ? AND fulfilled_at IS NULL",
            (db.now_iso(), user["id"]),
        )
    status = {
        "id": status_id,
        "personId": user["id"],
        "state": body.state,
        "note": note,
        "source": body.source[:20],
        "ts": ts,
    }
    await manager.send_many(watcher_ids(user["id"]) + [user["id"]], {"type": "status", "personId": user["id"], "status": status})
    if fulfilled:
        await manager.send_many(
            watcher_ids(user["id"]),
            {"type": "checkin:fulfilled", "personId": user["id"], "status": status},
        )
    return {"status": status}


@app.get("/api/people/{person_id}/status")
def get_statuses(person_id: str, limit: int = 100, user: dict = Depends(current_user)):
    require_person_access(user, person_id)
    limit = max(1, min(limit, 300))
    rows = db.fetch_all(
        "SELECT * FROM status_updates WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
        (person_id, limit),
    )
    return {"statuses": [serialize_status(r) for r in rows]}


# --------------------------------------------------------------------------- alerts
@app.post("/api/alerts")
async def create_alert(body: AlertIn, user: dict = Depends(writer_user)):
    if user["role"] != "person":
        raise HTTPException(status_code=403, detail="Only a person account can raise an alert.")
    loc = latest_location(user["id"])
    lat = body.lat if body.lat is not None else (loc["lat"] if loc else None)
    lng = body.lng if body.lng is not None else (loc["lng"] if loc else None)
    message = body.message.strip()[:500]
    if not message:
        if body.type == "sos":
            place = ""
            message = f"SOS activated{' near ' + place if place else ''} — immediate help needed."
        else:
            message = "Emergency alert — please check on me."
    severity = "critical" if body.type == "sos" else "high"
    alert_id = new_id("alt")
    ts = db.now_iso()
    db.execute(
        "INSERT INTO alerts (id, user_id, type, severity, message, lat, lng, ts, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
        (alert_id, user["id"], body.type, severity, message, lat, lng, ts),
    )
    if body.type == "sos":
        db.execute(
            "INSERT INTO status_updates (user_id, state, note, source, ts) VALUES (?, 'help', ?, 'sos', ?)",
            (user["id"], "SOS activated", ts),
        )
        db.execute(
            "UPDATE checkin_requests SET fulfilled_at = ? WHERE person_id = ? AND fulfilled_at IS NULL",
            (ts, user["id"]),
        )
    row = db.fetch_one(
        "SELECT a.*, u.name AS person_name, u.phone AS person_phone FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.id = ?",
        (alert_id,),
    )
    alert = serialize_alert(row)  # type: ignore[arg-type]
    await manager.send_many(watcher_ids(user["id"]) + [user["id"]], {"type": "alert", "personId": user["id"], "alert": alert})
    return {"alert": alert}


@app.get("/api/people/{person_id}/alerts")
def get_alerts(person_id: str, limit: int = 100, active: bool = False, user: dict = Depends(current_user)):
    require_person_access(user, person_id)
    limit = max(1, min(limit, 300))
    return {"alerts": alerts_for(person_id, limit, active_only=active)}


@app.post("/api/alerts/{alert_id}/ack")
async def ack_alert(alert_id: str, user: dict = Depends(writer_user)):
    alert = db.fetch_one("SELECT * FROM alerts WHERE id = ?", (alert_id,))
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    if user["role"] not in ("guardian", "person") or (
        user["role"] == "guardian" and not is_linked(alert["user_id"], user["id"])
    ):
        raise HTTPException(status_code=403, detail="You cannot acknowledge this alert.")
    if user["role"] == "person" and alert["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You cannot acknowledge this alert.")
    if alert["status"] == "active":
        db.execute(
            "UPDATE alerts SET status = 'acknowledged', acked_by = ?, acked_at = ? WHERE id = ?",
            (user["name"], db.now_iso(), alert_id),
        )
    row = db.fetch_one(
        "SELECT a.*, u.name AS person_name, u.phone AS person_phone FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.id = ?",
        (alert_id,),
    )
    payload_alert = serialize_alert(row)  # type: ignore[arg-type]
    await manager.send_many(watcher_ids(alert["user_id"]) + [alert["user_id"]], {"type": "alert:update", "alert": payload_alert})
    return {"alert": payload_alert}


@app.post("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, user: dict = Depends(writer_user)):
    alert = db.fetch_one("SELECT * FROM alerts WHERE id = ?", (alert_id,))
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    allowed = user["id"] == alert["user_id"] or (user["role"] == "guardian" and is_linked(alert["user_id"], user["id"]))
    if not allowed:
        raise HTTPException(status_code=403, detail="You cannot resolve this alert.")
    if alert["status"] != "resolved":
        db.execute("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?", (db.now_iso(), alert_id))
        if alert["type"] == "sos" and user["id"] == alert["user_id"]:
            db.execute(
                "INSERT INTO status_updates (user_id, state, note, source, ts) VALUES (?, 'safe', 'SOS resolved — I am safe.', 'sos', ?)",
                (alert["user_id"], db.now_iso()),
            )
    row = db.fetch_one(
        "SELECT a.*, u.name AS person_name, u.phone AS person_phone FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.id = ?",
        (alert_id,),
    )
    payload_alert = serialize_alert(row)  # type: ignore[arg-type]
    await manager.send_many(watcher_ids(alert["user_id"]) + [alert["user_id"]], {"type": "alert:update", "alert": payload_alert})
    return {"alert": payload_alert}


# --------------------------------------------------------------------------- check-ins
@app.post("/api/checkin-requests")
async def request_checkin(body: CheckinIn, user: dict = Depends(writer_user)):
    if user["role"] != "guardian" or not is_linked(body.personId, user["id"]):
        raise HTTPException(status_code=403, detail="Only a linked guardian can request a check-in.")
    existing = db.fetch_one(
        "SELECT id FROM checkin_requests WHERE person_id = ? AND guardian_id = ? AND fulfilled_at IS NULL AND ts >= ?",
        (body.personId, user["id"], ago(120)),
    )
    if existing:
        return {"ok": True, "alreadyPending": True}
    req_id = new_id("chk")
    ts = db.now_iso()
    db.execute(
        "INSERT INTO checkin_requests (id, person_id, guardian_id, ts) VALUES (?, ?, ?, ?)",
        (req_id, body.personId, user["id"], ts),
    )
    await manager.send(
        body.personId,
        {
            "type": "checkin:request",
            "request": {"id": req_id, "personId": body.personId, "guardianId": user["id"], "guardianName": user["name"], "ts": ts},
        },
    )
    return {"ok": True, "request": {"id": req_id, "ts": ts}}


# --------------------------------------------------------------------------- messages
@app.get("/api/messages/{peer_id}")
def get_messages(peer_id: str, limit: int = 200, user: dict = Depends(current_user)):
    if not can_message(user, peer_id):
        raise HTTPException(status_code=403, detail="You are not connected to this person.")
    limit = max(1, min(limit, 400))
    rows = db.fetch_all(
        "SELECT * FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY ts DESC LIMIT ?",
        (user["id"], peer_id, peer_id, user["id"], limit),
    )
    rows.reverse()
    db.execute(
        "UPDATE messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL",
        (db.now_iso(), user["id"], peer_id),
    )
    peer = get_user(peer_id)
    return {
        "peer": public_user(peer),  # type: ignore[arg-type]
        "messages": [
            {"id": r["id"], "fromId": r["from_id"], "toId": r["to_id"], "text": r["text"], "ts": r["ts"], "readAt": r["read_at"]}
            for r in rows
        ],
    }


@app.post("/api/messages")
async def send_message(body: MessageIn, user: dict = Depends(writer_user)):
    if not can_message(user, body.toId):
        raise HTTPException(status_code=403, detail="You are not connected to this person.")
    text = body.text.strip()[:1000]
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    msg_id = new_id("msg")
    ts = db.now_iso()
    db.execute(
        "INSERT INTO messages (id, from_id, to_id, text, ts) VALUES (?, ?, ?, ?, ?)",
        (msg_id, user["id"], body.toId, text, ts),
    )
    message = {"id": msg_id, "fromId": user["id"], "toId": body.toId, "text": text, "ts": ts, "readAt": None}
    await manager.send_many([user["id"], body.toId], {"type": "message", "message": message, "from": public_user(user)})
    return {"message": message}


# --------------------------------------------------------------------------- links
@app.get("/api/links")
def list_links(user: dict = Depends(current_user)):
    if user["role"] == "person":
        guardians = []
        for g in guardian_rows_for(user["id"]):
            item = public_user(g)
            item["unread"] = unread_count(user["id"], g["id"])
            guardians.append(item)
        return {"guardians": guardians, "linkCode": user.get("link_code")}
    people = [person_overview(pid, user["id"]) for pid in person_ids_for(user["id"])]
    return {"people": people}


@app.post("/api/links")
def add_link(body: LinkIn, user: dict = Depends(writer_user)):
    if user["role"] != "guardian":
        raise HTTPException(status_code=403, detail="Only a guardian can link to a person.")
    code = body.code.strip().upper()
    person = db.fetch_one("SELECT * FROM users WHERE UPPER(link_code) = ? AND role = 'person'", (code,))
    if not person:
        raise HTTPException(status_code=404, detail="No person found with that link code.")
    if is_linked(person["id"], user["id"]):
        raise HTTPException(status_code=409, detail="You are already linked to this person.")
    db.execute("INSERT OR IGNORE INTO links (person_id, guardian_id, created_at) VALUES (?, ?, ?)", (person["id"], user["id"], db.now_iso()))
    return {"ok": True, "person": public_user(person)}


@app.delete("/api/links/{person_id}")
def remove_link(person_id: str, user: dict = Depends(writer_user)):
    if user["role"] != "guardian":
        raise HTTPException(status_code=403, detail="Only a guardian can remove a link.")
    db.execute("DELETE FROM links WHERE person_id = ? AND guardian_id = ?", (person_id, user["id"]))
    return {"ok": True}


@app.get("/api/people/{person_id}/history")
def history(person_id: str, days: int = 7, user: dict = Depends(current_user)):
    require_person_access(user, person_id)
    since = ago(max(1, min(days, 90)) * 86400)
    locations = db.fetch_all(
        "SELECT lat, lng, accuracy, speed, heading, source, ts FROM locations WHERE user_id = ? AND ts >= ? ORDER BY ts ASC LIMIT 1200",
        (person_id, since),
    )
    statuses = db.fetch_all(
        "SELECT * FROM status_updates WHERE user_id = ? AND ts >= ? ORDER BY ts DESC LIMIT 300",
        (person_id, since),
    )
    alerts = alerts_for(person_id, 200)
    alerts = [a for a in alerts if a["ts"] >= since]
    return {
        "person": public_user(get_user(person_id)),  # type: ignore[arg-type]
        "locations": locations,
        "statuses": [serialize_status(s) for s in statuses],
        "alerts": alerts,
    }


@app.get("/api/health")
def health():
    return {"ok": True, "service": "safety-emergency-assistance", "time": db.now_iso()}


# --------------------------------------------------------------------------- websocket
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str | None = None):
    token = token or ws.cookies.get(COOKIE)
    data = verify_token(token)
    if not data:
        await ws.close(code=4401)
        return
    if data["sub"] == GUEST_ID:
        user = dict(GUEST_USER)
    else:
        user = get_user(data["sub"])
    if not user:
        await ws.close(code=4401)
        return
    await manager.connect(user["id"], ws)
    if user["role"] != "guest":
        db.execute("UPDATE users SET last_seen = ? WHERE id = ?", (db.now_iso(), user["id"]))
    try:
        await ws.send_json({"type": "hello", "userId": user["id"], "role": user["role"], "serverTime": db.now_iso()})
        while True:
            raw = await ws.receive_text()
            if raw == "ping":
                await ws.send_text('{"type":"pong"}')
            elif raw.startswith("{"):
                try:
                    import json as _json

                    msg = _json.loads(raw)
                    if msg.get("type") == "ping":
                        await ws.send_json({"type": "pong"})
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        manager.disconnect(user["id"], ws)
