"""Password hashing, signed session tokens and small helpers."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRET_FILE = ROOT / "data" / "session.key"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_SCRYPT = dict(n=2**14, r=8, p=1, dklen=32)


def _secret() -> bytes:
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes()
    value = secrets.token_bytes(48)
    SECRET_FILE.write_bytes(value)
    return value


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), **_SCRYPT)
    return digest.hex(), salt


def verify_password(password: str, password_hash: str | None, salt: str | None) -> bool:
    if not password_hash or not salt:
        return False
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), password_hash)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign_token(user_id: str, role: str, days: int = 7) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(time.time())
    payload = _b64(json.dumps({"sub": user_id, "role": role, "iat": now, "exp": now + days * 86400}, separators=(",", ":")).encode())
    body = f"{header}.{payload}".encode("ascii")
    sig = _b64(hmac.new(_secret(), body, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def verify_token(token: str | None) -> dict | None:
    if not token or token.count(".") != 2:
        return None
    header, payload, sig = token.split(".")
    expected = _b64(hmac.new(_secret(), f"{header}.{payload}".encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(_unb64(payload))
    except Exception:
        return None
    if int(data.get("exp", 0)) < time.time():
        return None
    return data


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def new_link_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "AEGIS-" + "".join(secrets.choice(alphabet) for _ in range(4))


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email)) and len(email) <= 120
