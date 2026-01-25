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
or
python3 -m uvicorn python_video_server.server:app --host 0.0.0.0 --port 8000   --ssl-certfile python_video_server/certs/config/live/[site]/fullchain.pem   --ssl-keyfile  python_video_server/certs/config/live/[site]/privkey.pem
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

## Video auth / usage

`GET /api/video/{movieId}` accepts auth in three ways (in priority order):

1) `video_auth` cookie (best for browser `<video>` tags)
2) `Authorization: Bearer <token>` header
3) `?token=<token>` query param (debug only; tokens in URLs leak via logs/referrers)

### Browser `<video>` (cookie flow)

Because HTML `<video>` cannot send an `Authorization` header, the pattern is:

1. Your JS calls `POST /api/video/session` with `Authorization: Bearer <token>`
2. The server responds `204` and sets a `video_auth` cookie (scoped to `/api/video`)
3. Your `<video>` loads `/api/video/{movieId}` and the cookie is used automatically

Example (curl):

```bash
# 1) exchange header token -> cookie
curl -i -X POST "https://video.example.com/api/video/session" \
  -H "Authorization: Bearer $JWT"

# 2) then the <video> element can simply use:
# https://video.example.com/api/video/<movieId>
```

Cross-site note (frontend on a different origin):
- Set `CORS_ALLOW_ORIGINS` to your exact app origin (not `*`) and ensure your frontend uses `credentials: "include"` on the `/api/video/session` request.
- If the video host is cross-site, you’ll usually need `VIDEO_COOKIE_SAMESITE=None` **and** HTTPS, otherwise browsers may block the cookie.

### Non-browser clients (header flow)

```bash
curl -I "https://video.example.com/api/video/<movieId>" \
  -H "Authorization: Bearer $JWT"
```

### Token in URL (debug flow)

```bash
curl -I "https://video.example.com/api/video/<movieId>?token=$JWT"
```

### Seeking / Range requests (example)

```bash
curl -i "https://video.example.com/api/video/<movieId>" \
  -H "Authorization: Bearer $JWT" \
  -H "Range: bytes=0-1023"
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

## Let’s Encrypt certs (python-only helper)

This repo includes `python_video_server/letsencrypt.py`, a wrapper around the **certbot Python package** (no system `certbot` needed).

Certificates (and certbot state) are stored under:
- `python_video_server/certs/config/live/<primary-domain>/fullchain.pem`
- `python_video_server/certs/config/live/<primary-domain>/privkey.pem`

You can override the storage directory with `LETSENCRYPT_BASE_DIR` (optional).

### Issue a cert (HTTP-01 standalone, easiest)

Requirements:
- DNS `A/AAAA` records point to this host
- Port **80** reachable from the internet
- You can bind port 80 (often requires `sudo`)

```bash
python -m pip install -r python_video_server/requirements.txt

# staging by default (recommended first)
sudo -E python -m python_video_server.letsencrypt certonly \
  --email you@example.com \
  --domains example.com,www.example.com

# production (real cert)
sudo -E python -m python_video_server.letsencrypt certonly \
  --email you@example.com \
  --domains example.com,www.example.com \
  --production
```

Then run uvicorn with those certs:

```bash
sudo -E uvicorn python_video_server.server:app --host 0.0.0.0 --port 443 \
  --ssl-certfile python_video_server/certs/config/live/example.com/fullchain.pem \
  --ssl-keyfile  python_video_server/certs/config/live/example.com/privkey.pem
```

### Issue a cert (DNS-01 manual TXT, no port 80)

Use this if you cannot expose/bind port 80. Certbot will prompt you to create a TXT record.

```bash
python -m pip install -r python_video_server/requirements.txt

python -m python_video_server.letsencrypt certonly \
  --challenge dns \
  --email you@example.com \
  --domains example.com,www.example.com \
  --production
```

### Renew certs

```bash
# dry-run (safe)
sudo -E python -m python_video_server.letsencrypt renew --dry-run

# real renewal
sudo -E python -m python_video_server.letsencrypt renew --production
```

## Endpoints

- `POST /api/video/session`  
  Sets `video_auth` cookie (send `Authorization: Bearer <token>`). Returns `204 No Content`.

- `GET|HEAD /api/video/{movieId}`  
  Streams the movie file (supports `Range: bytes=...`). Returns `200` (full file) or `206` (partial content) or `404` (not found).

- `GET /healthz`  
  Health check endpoint. Returns JSON with server status, video files directory, MongoDB database name, and OpenSSL version.

## Functions Reference

### Public Endpoints
- `create_video_session(request, response, authorization)` - POST `/api/video/session` - Creates video authentication cookie
- `stream_video(movie_id, request, authorization, range)` - GET|HEAD `/api/video/{movie_id}` - Streams video file with Range support
- `healthz()` - GET `/healthz` - Health check endpoint

### Helper Functions (Internal)
- `_env_str(name, default)` - Get environment variable as string
- `_jwt_secret()` - Get JWT secret from environment
- `_mongo_uri()` - Get MongoDB connection URI from environment
- `_mongo_db_name()` - Get MongoDB database name (from env or parsed from URI)
- `_env_int(name, default)` - Get environment variable as integer
- `_video_files_dir()` - Get video files directory path (default: `./public/video`)
- `_parse_bearer(authorization)` - Parse Bearer token from Authorization header
- `_is_safe_relative_file(path)` - Security check: validates file path is safe (no directory traversal)
- `_guess_content_type(file_path)` - Guess MIME content type from file extension
- `_parse_range(range_header, file_size)` - Parse HTTP Range header into start/end tuple
- `_file_iter(path, start, end, chunk_size)` - Generator that yields file chunks for streaming
- `_get_token(request, authorization)` - Get authentication token from cookie, header, or query string (priority order)
- `_verify_token(token)` - Verify JWT token and return decoded payload
- `_mongo_client()` - Create MongoDB client with TLS/connection timeout configuration
- `_mongo_client_cached()` - Cached MongoDB client (LRU cache, reused across requests)
- `_shutdown()` - Event handler for graceful MongoDB client shutdown

