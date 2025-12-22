import mimetypes
import os
import posixpath
from functools import lru_cache
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional, Tuple
from urllib.parse import quote
from urllib.parse import urlparse

import jwt
from bson import ObjectId
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pymongo import MongoClient
from pymongo.errors import PyMongoError


def _env_str(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def _jwt_secret() -> str:
    # Read env at runtime (important on Windows/uvicorn worker reloads).
    return _env_str("JWT_SECRET")


def _mongo_uri() -> str:
    # Read env at runtime (important on Windows/uvicorn worker reloads).
    return _env_str("MONGO_URI")

def _mongo_db_name() -> str:
    # Prefer explicit env var, otherwise try to parse from URI path.
    explicit = _env_str("MONGO_DB_NAME")
    if explicit:
        return explicit

    uri = _mongo_uri()
    if not uri:
        return ""

    try:
        parsed = urlparse(uri)
        # Path is like "/dbname"
        db = (parsed.path or "").lstrip("/")
        # Strip any extra segments just in case
        db = db.split("/")[0].strip()
        return db
    except Exception:
        return ""

def _env_int(name: str, default: int) -> int:
    try:
        return int(_env_str(name, str(default)))
    except Exception:
        return default


def _video_files_dir() -> Path:
    # Read env at runtime (important on Windows/uvicorn worker reloads).
    return Path(_env_str("VIDEO_FILES_DIR", str(Path.cwd() / "public" / "video"))).resolve()


def _parse_bearer(authorization: Optional[str]) -> str:
    raw = (authorization or "").strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return ""


def _is_safe_relative_file(p: str) -> bool:
    if not isinstance(p, str):
        return False
    s = p.strip()
    if not s or "\x00" in s:
        return False
    if s.startswith("/") or s.startswith("\\"):
        return False
    norm = posixpath.normpath(s.replace("\\", "/"))
    if norm == ".." or norm.startswith("../"):
        return False
    return True


def _guess_content_type(file_path: Path) -> str:
    ctype, _ = mimetypes.guess_type(str(file_path))
    return ctype or "application/octet-stream"


def _parse_range(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    # Only supports a single bytes range: "bytes=start-end"
    raw = (range_header or "").strip()
    if not raw:
        return None
    if not raw.lower().startswith("bytes="):
        return None
    spec = raw[6:].strip()
    if "," in spec:
        return None
    if "-" not in spec:
        return None
    start_s, end_s = spec.split("-", 1)
    start = int(start_s) if start_s else 0
    end = int(end_s) if end_s else (file_size - 1)
    if start < 0 or end < 0 or start > end or start >= file_size:
        return None
    end = min(end, file_size - 1)
    return start, end


def _file_iter(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024) -> Generator[bytes, None, None]:
    with path.open("rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            n = min(chunk_size, remaining)
            data = f.read(n)
            if not data:
                break
            remaining -= len(data)
            yield data


def _get_token(req: Request, authorization: Optional[str]) -> str:
    # Prefer cookie (for <video>), then Authorization header, then querystring token.
    cookie_token = (req.cookies.get("video_auth") or "").strip()
    if cookie_token:
        return cookie_token
    header_token = _parse_bearer(authorization)
    if header_token:
        return header_token
    qs = (req.query_params.get("token") or "").strip()
    return qs


def _verify_token(token: str) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Missing video auth token")
    secret = _jwt_secret()
    if not secret:
        raise HTTPException(status_code=500, detail="JWT_SECRET is not configured")
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired video auth token")


def _mongo_client() -> MongoClient:
    uri = _mongo_uri()
    if not uri:
        raise HTTPException(status_code=500, detail="MONGO_URI is not configured")
    kwargs = {
        # Fail fast instead of hanging for ~30s on each request.
        "serverSelectionTimeoutMS": _env_int("MONGO_SERVER_SELECTION_TIMEOUT_MS", 8000),
        "connectTimeoutMS": _env_int("MONGO_CONNECT_TIMEOUT_MS", 8000),
        "socketTimeoutMS": _env_int("MONGO_SOCKET_TIMEOUT_MS", 20000),
    }

    # On some hosts, the system CA store is missing/broken or overridden by env vars,
    # causing TLS handshake failures to MongoDB Atlas. Prefer certifi's CA bundle.
    ca_file = _env_str("MONGO_TLS_CA_FILE")
    if ca_file:
        kwargs["tlsCAFile"] = ca_file
    else:
        try:
            import certifi  # type: ignore

            kwargs["tlsCAFile"] = certifi.where()
        except Exception:
            # If certifi isn't available, fall back to system trust.
            pass

    # Optional escape hatch (NOT recommended): allow invalid certs for debugging only.
    if _env_str("MONGO_TLS_INSECURE", "0") in ("1", "true", "yes", "on"):
        kwargs["tlsAllowInvalidCertificates"] = True

    return MongoClient(uri, **kwargs)


@lru_cache(maxsize=1)
def _mongo_client_cached() -> MongoClient:
    # Reuse one client (connection pool) across requests.
    return _mongo_client()


app = FastAPI()

# CORS: needed so the app can call the Python host's /api/video/session
_cors_origins_raw = _env_str("CORS_ALLOW_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
_cors_allow_origin_regex = None
if len(_cors_origins) == 0 or (len(_cors_origins) == 1 and _cors_origins[0] == "*"):
    # With credentials, browsers can't accept Access-Control-Allow-Origin: *
    # Using a regex makes Starlette reflect the requesting Origin instead.
    _cors_origins = []
    _cors_allow_origin_regex = ".*"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/video/session")
def create_video_session(request: Request, response: Response, authorization: Optional[str] = Header(default=None)):
    token = _parse_bearer(authorization)
    _verify_token(token)

    secure = request.url.scheme == "https" or (request.headers.get("x-forwarded-proto") == "https")
    encoded = quote(token, safe="")
    cookie_max_age_seconds = int(_env_str("VIDEO_SESSION_MAX_AGE_SECONDS", "28800"))  # 8h
    cookie_samesite = _env_str("VIDEO_COOKIE_SAMESITE", "Lax")  # Lax|Strict|None
    samesite = (cookie_samesite or "Lax").strip().lower()
    if samesite not in ("lax", "strict", "none"):
        samesite = "lax"
    samesite_attr = "None" if samesite == "none" else ("Strict" if samesite == "strict" else "Lax")
    cookie_parts = [
        f"video_auth={encoded}",
        "Path=/api/video",
        f"Max-Age={cookie_max_age_seconds}",
        f"SameSite={samesite_attr}",
        "HttpOnly",
    ]
    # Modern browsers require Secure when SameSite=None
    if secure or samesite == "none":
        cookie_parts.append("Secure")
    response.headers["Set-Cookie"] = "; ".join(cookie_parts)
    response.status_code = 204
    return None


@app.api_route("/api/video/{movie_id}", methods=["GET", "HEAD"])
def stream_video(
    movie_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    range: Optional[str] = Header(default=None),  # noqa: A002
):
    token = _get_token(request, authorization)
    _verify_token(token)

    try:
        oid = ObjectId(movie_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid movie id")

    db_name = _mongo_db_name()
    if not db_name:
        raise HTTPException(
            status_code=500,
            detail="Mongo DB name not configured. Add it to MONGO_URI (…/dbname) or set MONGO_DB_NAME.",
        )

    try:
        client = _mongo_client_cached()
        db = client[db_name]
        movie = db["movies"].find_one({"_id": oid}, {"video_file": 1})
    except PyMongoError as e:
        raise HTTPException(
            status_code=502,
            detail=(
                "Failed to query MongoDB (TLS/connection issue). "
                "On some hosts you may need a CA bundle; try installing certifi or set MONGO_TLS_CA_FILE. "
                f"Original error: {type(e).__name__}: {e}"
            ),
        )

    video_file = (movie or {}).get("video_file") or ""
    if not isinstance(video_file, str) or not video_file.strip():
        raise HTTPException(status_code=404, detail="No server video file configured for this movie")
    video_file = video_file.strip()
    if not _is_safe_relative_file(video_file):
        raise HTTPException(status_code=400, detail="Invalid video_file path")

    video_dir = _video_files_dir()
    full_path = (video_dir / video_file).resolve()
    if not str(full_path).startswith(str(video_dir) + os.sep) and full_path != video_dir:
        raise HTTPException(status_code=400, detail="Invalid video_file path")
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Video file not found on server")

    stat = full_path.stat()
    file_size = stat.st_size
    content_type = _guess_content_type(full_path)

    # Shared headers (match the Node server behavior closely)
    base_headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": content_type,
        "Cache-Control": "private, max-age=0, must-revalidate",
    }

    if request.method == "HEAD":
        headers = dict(base_headers)
        headers["Content-Length"] = str(file_size)
        return Response(status_code=200, headers=headers)

    r = _parse_range(range or "", file_size)
    if r is None and (range or ""):
        # Invalid Range
        headers = dict(base_headers)
        headers["Content-Range"] = f"bytes */{file_size}"
        return Response(status_code=416, headers=headers)

    if r is None:
        # Full file
        return FileResponse(
            path=str(full_path),
            media_type=content_type,
            headers=base_headers,
        )

    start, end = r
    chunk_size = end - start + 1
    headers = dict(base_headers)
    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(chunk_size)

    return StreamingResponse(
        _file_iter(full_path, start, end),
        status_code=206,
        media_type=content_type,
        headers=headers,
    )


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "time": datetime.now(timezone.utc).isoformat(),
        "video_files_dir": str(_video_files_dir()),
        "mongo_db_name": _mongo_db_name() or None,
    }


@app.on_event("shutdown")
def _shutdown():
    # Close the cached Mongo client cleanly.
    try:
        client = _mongo_client_cached()
        client.close()
    except Exception:
        pass

