# Python video server (Range streaming + JWT + Mongo)

This is a small standalone server that mirrors the app’s `/api/video/:id` behavior:

- Looks up `movies._id == :id` in MongoDB and reads the `video_file` field
- Streams the file from `VIDEO_FILES_DIR` with **HTTP Range** support (seeking works)
- Auth via the same JWT (`Authorization: Bearer ...`), plus a `video_auth` cookie for `<video>`

## Run

```bash
python -m pip install -r python_video_server/requirements.txt
export MONGO_URI="..."
export MONGO_DB_NAME="..."                            # optional; required if MONGO_URI doesn't include /<dbName>
export JWT_SECRET="..."
export VIDEO_FILES_DIR="/absolute/path/to/public/video"  # optional (default: ./public/video)
export VIDEO_SESSION_MAX_AGE_SECONDS="28800"             # optional (default: 8h)
uvicorn python_video_server.server:app --host 0.0.0.0 --port 8000
```

## Extra environment variables (optional)

```bash
# CORS (needed when the main app is on a different origin)
export CORS_ALLOW_ORIGINS="https://your-app.example.com"  # default: "*"

# Cookie behavior for /api/video/session
export VIDEO_COOKIE_SAMESITE="Lax"                        # Lax|Strict|None (default: Lax)

# Mongo TLS / connectivity troubleshooting (Atlas, odd hosts, etc.)
export MONGO_TLS_CA_FILE="/path/to/ca.pem"                # prefer a valid CA bundle
export MONGO_TLS_FORCE_TLS12="1"                          # force TLS 1.2 if TLS 1.3 breaks
export MONGO_TLS_INSECURE="1"                             # NOT recommended; debug only
export MONGO_SERVER_SELECTION_TIMEOUT_MS="8000"
export MONGO_CONNECT_TIMEOUT_MS="8000"
export MONGO_SOCKET_TIMEOUT_MS="20000"
```

## HTTPS (optional)

You can run behind a reverse proxy/ingress, or run `uvicorn` with TLS directly:

```bash
uvicorn python_video_server.server:app --host 0.0.0.0 --port 443 \
  --ssl-certfile /path/to/fullchain.pem \
  --ssl-keyfile  /path/to/privkey.pem
```

Notes:
- If you’re behind a proxy, forward `X-Forwarded-Proto: https` so `/api/video/session` can set `Secure` cookies correctly.
- This repo includes `python_video_server/letsencrypt.py` as an optional helper for cert issuance/renewal (kept intentionally lightweight here).

## Endpoints

- `POST /api/video/session`  
  Sets `video_auth` cookie (send `Authorization: Bearer <token>`).

- `GET|HEAD /api/video/{movieId}`  
  Streams the movie file (supports `Range: bytes=...`).

- `GET /healthz`

