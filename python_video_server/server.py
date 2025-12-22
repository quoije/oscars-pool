import mimetypes
import os
import posixpath
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional, Tuple
from urllib.parse import quote

import jwt
from bson import ObjectId
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pymongo import MongoClient


def _env_str(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


JWT_SECRET = _env_str("JWT_SECRET")
MONGO_URI = _env_str("MONGO_URI")
VIDEO_FILES_DIR = Path(_env_str("VIDEO_FILES_DIR", str(Path.cwd() / "public" / "video"))).resolve()
COOKIE_MAX_AGE_SECONDS = int(_env_str("VIDEO_SESSION_MAX_AGE_SECONDS", "28800"))  # 8h


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
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET is not configured")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired video auth token")


def _mongo_client() -> MongoClient:
    if not MONGO_URI:
        raise HTTPException(status_code=500, detail="MONGO_URI is not configured")
    return MongoClient(MONGO_URI)


app = FastAPI()


@app.post("/api/video/session")
def create_video_session(request: Request, response: Response, authorization: Optional[str] = Header(default=None)):
    token = _parse_bearer(authorization)
    _verify_token(token)

    secure = request.url.scheme == "https" or (request.headers.get("x-forwarded-proto") == "https")
    encoded = quote(token, safe="")
    cookie_parts = [
        f"video_auth={encoded}",
        "Path=/api/video",
        f"Max-Age={COOKIE_MAX_AGE_SECONDS}",
        "SameSite=Lax",
        "HttpOnly",
    ]
    if secure:
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

    with _mongo_client() as client:
        db = client.get_default_database()
        movie = db["movies"].find_one({"_id": oid}, {"video_file": 1})

    video_file = (movie or {}).get("video_file") or ""
    if not isinstance(video_file, str) or not video_file.strip():
        raise HTTPException(status_code=404, detail="No server video file configured for this movie")
    video_file = video_file.strip()
    if not _is_safe_relative_file(video_file):
        raise HTTPException(status_code=400, detail="Invalid video_file path")

    full_path = (VIDEO_FILES_DIR / video_file).resolve()
    if not str(full_path).startswith(str(VIDEO_FILES_DIR) + os.sep) and full_path != VIDEO_FILES_DIR:
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
        "video_files_dir": str(VIDEO_FILES_DIR),
    }

