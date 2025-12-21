import mimetypes
import os
import re
from pathlib import Path
from typing import Generator, Iterable, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

APP_NAME = "video-file-server"
BASE_DIR = Path(__file__).resolve().parent
MEDIA_DIR = BASE_DIR / "media"

# Allow common video types (what browsers can play is separate from what we serve).
ALLOWED_EXTS = {".mp4", ".mkv"}

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _safe_resolve_media_path(rel_path: str) -> Path:
    """
    Resolve a user-provided path against MEDIA_DIR, preventing path traversal.
    """
    # Normalize separators and strip leading slashes.
    rel_path = rel_path.replace("\\", "/").lstrip("/")
    if not rel_path:
        raise HTTPException(status_code=404, detail="Missing file path")

    candidate = (MEDIA_DIR / rel_path).resolve()
    media_root = MEDIA_DIR.resolve()
    try:
        candidate.relative_to(media_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid path") from exc

    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    if candidate.suffix.lower() not in ALLOWED_EXTS:
        raise HTTPException(status_code=415, detail="Unsupported file type")

    return candidate


def _guess_content_type(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".mkv":
        return "video/x-matroska"
    # Let mimetypes handle mp4 and others.
    ctype, _ = mimetypes.guess_type(str(path))
    return ctype or "application/octet-stream"


def _parse_range(range_header: str, size: int) -> Optional[Tuple[int, int]]:
    """
    Parse a single HTTP Range header of form: bytes=start-end
    Returns (start, end) inclusive, or None if header is missing/empty.
    Raises HTTPException for invalid ranges.
    """
    if not range_header:
        return None

    m = RANGE_RE.match(range_header.strip())
    if not m:
        raise HTTPException(status_code=416, detail="Invalid Range header")

    start_s, end_s = m.group(1), m.group(2)

    if start_s == "" and end_s == "":
        raise HTTPException(status_code=416, detail="Invalid Range header")

    if start_s == "":
        # suffix range: last N bytes
        suffix_len = int(end_s)
        if suffix_len <= 0:
            raise HTTPException(status_code=416, detail="Invalid Range header")
        if suffix_len > size:
            return (0, size - 1)
        return (size - suffix_len, size - 1)

    start = int(start_s)
    end = int(end_s) if end_s != "" else size - 1

    if start >= size or start < 0:
        raise HTTPException(status_code=416, detail="Range not satisfiable")

    if end < start:
        raise HTTPException(status_code=416, detail="Range not satisfiable")

    end = min(end, size - 1)
    return (start, end)


def _iter_file(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024) -> Generator[bytes, None, None]:
    with path.open("rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


app = FastAPI(title=APP_NAME)

# Default to permissive CORS because the player may be on another port/host.
# Configure with env: CORS_ORIGINS="http://localhost:5000,http://127.0.0.1:5000"
cors_origins_env = os.getenv("CORS_ORIGINS", "*").strip()
if cors_origins_env == "*":
    allow_origins: Iterable[str] = ["*"]
else:
    allow_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(allow_origins),
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "app": APP_NAME}


@app.get("/api/media")
def list_media() -> JSONResponse:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for p in sorted(MEDIA_DIR.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in ALLOWED_EXTS:
            continue
        rel = p.relative_to(MEDIA_DIR).as_posix()
        items.append(
            {
                "name": rel,
                "size": p.stat().st_size,
                "url": f"/media/{rel}",
            }
        )
    return JSONResponse({"items": items})


@app.api_route("/media/{file_path:path}", methods=["GET", "HEAD"])
async def serve_media(file_path: str, request: Request) -> Response:
    path = _safe_resolve_media_path(file_path)
    size = path.stat().st_size
    ctype = _guess_content_type(path)

    # Support byte ranges for HTML5 video seeking.
    range_header = request.headers.get("range", "")
    try:
        parsed = _parse_range(range_header, size) if range_header else None
    except HTTPException as exc:
        # Required by RFC: include */size
        headers = {"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"}
        return Response(status_code=exc.status_code, content=exc.detail, headers=headers)

    common_headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": ctype,
        # Helps some players / proxies behave better with range requests.
        "Cache-Control": "no-store",
    }

    if parsed is None:
        if request.method == "HEAD":
            return Response(status_code=200, headers={**common_headers, "Content-Length": str(size)})
        return StreamingResponse(
            _iter_file(path, 0, size - 1),
            status_code=200,
            headers={**common_headers, "Content-Length": str(size)},
            media_type=ctype,
        )

    start, end = parsed
    length = end - start + 1
    headers = {
        **common_headers,
        "Content-Length": str(length),
        "Content-Range": f"bytes {start}-{end}/{size}",
    }
    if request.method == "HEAD":
        return Response(status_code=206, headers=headers)

    return StreamingResponse(
        _iter_file(path, start, end),
        status_code=206,
        headers=headers,
        media_type=ctype,
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VIDEO_SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("VIDEO_SERVER_PORT", "8001"))
    reload = os.getenv("VIDEO_SERVER_RELOAD", "1").strip() not in {"0", "false", "False", "no", "NO"}
    uvicorn.run("video_server:app", host=host, port=port, reload=reload)

