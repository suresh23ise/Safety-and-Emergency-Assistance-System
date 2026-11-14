"""Seeds a realistic demo family so the project is instantly explorable."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db
from .security import hash_password, new_id

DEMO_PASSWORD = "Aegis@123"

# A loop through Cubbon Park, Bengaluru.
ROUTE = [
    (12.9748, 77.5920),
    (12.9762, 77.5925),
    (12.9774, 77.5938),
    (12.9782, 77.5958),
    (12.9776, 77.5975),
    (12.9764, 77.5983),
    (12.9750, 77.5978),
    (12.9740, 77.5962),
    (12.9735, 77.5942),
    (12.9742, 77.5925),
]


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def seed_user(name: str, email: str, role: str, phone: str, hue: int, link_code: str | None = None) -> str:
    existing = db.fetch_one("SELECT id FROM users WHERE email = ?", (email,))
    if existing:
        return existing["id"]
    uid = new_id("usr")
    pwd, salt = hash_password(DEMO_PASSWORD)
    db.execute(
        "INSERT INTO users (id, name, email, phone, role, password_hash, password_salt, provider, avatar_hue, link_code, created_at, last_seen) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'password', ?, ?, ?, ?)",
        (uid, name, email, phone, role, pwd, salt, hue, link_code, db.now_iso(), db.now_iso()),
    )
    db.ensure_settings(uid)
    return uid


def interpolate(index: int, total: int) -> tuple[float, float]:
    """Walk the closed route and return a jittered coordinate."""
    pos = (index % total) / total * len(ROUTE)
    i = int(pos)
    frac = pos - i
    a = ROUTE[i % len(ROUTE)]
    b = ROUTE[(i + 1) % len(ROUTE)]
    lat = a[0] + (b[0] - a[0]) * frac
    lng = a[1] + (b[1] - a[1]) * frac
    jitter = 0.000012
    lat += ((index * 7919) % 13 - 6) * jitter
    lng += ((index * 104729) % 13 - 6) * jitter
    return round(lat, 6), round(lng, 6)


def ensure_demo() -> None:
    if db.meta_get("demo_seeded") == "v1":
        return

    ananya = seed_user("Ananya Verma", "ananya@aegis.demo", "person", "+91 90000 11111", 338, "AEGIS-7K2P")
    ramesh = seed_user("Ramesh Verma", "ramesh@aegis.demo", "guardian", "+91 90000 22222", 212)
    priya = seed_user("Priya Verma", "priya@aegis.demo", "guardian", "+91 90000 33333", 158)
    guest = seed_user("Guest Viewer", "guest@aegis.demo", "guest", "", 42)

    # Settings tuned for the demo person.
    db.execute(
        "UPDATE settings SET auto_share=1, share_seconds=5, checkin_minutes=10, checkin_enabled=1, voice=1 WHERE user_id=?",
        (ananya,),
    )

    now = utcnow()

    # ------------------------------------------------------------------ links
    for guardian in (ramesh, priya, guest):
        db.execute(
            "INSERT OR IGNORE INTO links (person_id, guardian_id, created_at) VALUES (?, ?, ?)",
            (ananya, guardian, db.now_iso()),
        )

    # -------------------------------------------------------------- location
    total = 96
    rows = []
    for i in range(total):
        lat, lng = interpolate(i, 24)
        ts = iso(now - timedelta(seconds=(total - i) * 110))
        rows.append((ananya, lat, lng, 8 + (i % 7), 1.1 + (i % 3) * 0.15, 0.0, "device", ts))
    db.executemany(
        "INSERT INTO locations (user_id, lat, lng, accuracy, speed, heading, source, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )

    # --------------------------------------------------------------- statuses
    statuses = []
    states = ["safe", "safe", "checkin", "safe", "checkin", "safe"]
    for i in range(9):
        state = states[i % len(states)]
        ts = iso(now - timedelta(minutes=8 * (8 - i) + 1))
        statuses.append((ananya, state, "Periodic safety check-in" if state == "checkin" else "All good", "auto", ts))
    statuses.append((ananya, "help", "Felt unsafe near the underpass, guardian called me.", "manual", iso(now - timedelta(days=2, minutes=20))))
    statuses.append((ananya, "safe", "Reached home safely.", "manual", iso(now - timedelta(days=2, minutes=4))))
    statuses.append((ananya, "uncomfortable", "Someone followed me for a block.", "manual", iso(now - timedelta(hours=27))))
    statuses.append((ananya, "safe", "Guardian confirmed I am okay.", "manual", iso(now - timedelta(hours=26, minutes=50))))
    db.executemany(
        "INSERT INTO status_updates (user_id, state, note, source, ts) VALUES (?, ?, ?, ?, ?)",
        statuses,
    )

    # ----------------------------------------------------------------- alerts
    sos_ts = iso(now - timedelta(days=2, minutes=24))
    db.execute(
        "INSERT INTO alerts (id, user_id, type, severity, message, lat, lng, ts, status, acked_by, acked_at, resolved_at) "
        "VALUES (?, ?, 'sos', 'critical', 'SOS activated near Kanteerava Stadium', ?, ?, ?, 'resolved', 'Ramesh Verma', ?, ?)",
        (new_id("alt"), ananya, 12.9712, 77.5935, sos_ts, iso(now - timedelta(days=2, minutes=22)), iso(now - timedelta(days=2, minutes=10))),
    )
    db.execute(
        "INSERT INTO alerts (id, user_id, type, severity, message, lat, lng, ts, status, acked_by, acked_at, resolved_at) "
        "VALUES (?, ?, 'emergency', 'high', 'Uncomfortable walking alone, please check in.', ?, ?, ?, 'resolved', 'Priya Verma', ?, ?)",
        (new_id("alt"), ananya, 12.9730, 77.5960, iso(now - timedelta(hours=27, minutes=2)), iso(now - timedelta(hours=27)), iso(now - timedelta(hours=26, minutes=55))),
    )

    # --------------------------------------------------------------- messages
    def msg(sender: str, receiver: str, text: str, minutes_ago: int, read: bool = True) -> None:
        db.execute(
            "INSERT INTO messages (id, from_id, to_id, text, ts, read_at) VALUES (?, ?, ?, ?, ?, ?)",
            (new_id("msg"), sender, receiver, text, iso(now - timedelta(minutes=minutes_ago)), iso(now - timedelta(minutes=minutes_ago)) if read else None),
        )

    msg(ramesh, ananya, "Good morning! Did you reach the park?", 95)
    msg(ananya, ramesh, "Yes papa, I'm at the rose garden. Sharing location now.", 93)
    msg(ramesh, ananya, "Perfect. I can see you. Stay on the main path.", 92)
    msg(ananya, ramesh, "Okay. I'll check in again in 10 minutes.", 90)
    msg(priya, ananya, "Call me if you need anything di.", 61)
    msg(ananya, priya, "Thanks Priya, all good so far 💛", 58, read=False)
    msg(ramesh, ananya, "I'm keeping the map open. Press SOS if anything feels off.", 20, read=False)

    db.meta_set("demo_seeded", "v1")
    db.meta_set("demo_person_id", ananya)
    db.meta_set("demo_guardian_id", ramesh)


def demo_person_id() -> str | None:
    return db.meta_get("demo_person_id")
