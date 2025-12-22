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

# Mongo TLS / connectivity troubleshooting (Atlas, weird hosts, etc.)
export MONGO_TLS_CA_FILE="/path/to/ca.pem"                # prefer a valid CA bundle
export MONGO_TLS_FORCE_TLS12="1"                          # force TLS 1.2 if TLS 1.3 breaks
export MONGO_TLS_INSECURE="1"                             # NOT recommended; debug only
export MONGO_SERVER_SELECTION_TIMEOUT_MS="8000"
export MONGO_CONNECT_TIMEOUT_MS="8000"
export MONGO_SOCKET_TIMEOUT_MS="20000"
```

## HTTPS (Let’s Encrypt, Python-only)

This server can be served over HTTPS by running `uvicorn` with `--ssl-certfile` and `--ssl-keyfile`.
To obtain/renew a trusted cert from Let’s Encrypt **without installing system certbot**, this repo includes a small wrapper that uses the **`certbot` Python package**.

### 1) Issue a certificate (HTTP-01 standalone)

Requirements:
- Your domain’s DNS `A/AAAA` records must point to this machine.
- Port **80** must be reachable from the internet for the ACME challenge.

```bash
python3 -m pip install -r python_video_server/requirements.txt

# Staging by default (recommended first). Add --production when it works.
sudo -E python3 -m python_video_server.letsencrypt certonly \
  --email you@example.com \
  --domains example.com,www.example.com
```

### 1b) Issue a certificate (DNS-01 manual TXT record — no port 80, no root)

If your host already uses port **80** (or you don't have permission to bind it), use DNS-01.
This does **not** require any inbound ports on the machine, but you must be able to edit DNS for the domain.

```bash
python3 -m pip install -r python_video_server/requirements.txt

# Add --production when staging works.
python3 -m python_video_server.letsencrypt certonly \
  --challenge dns \
  --email you@example.com \
  --domains example.com,www.example.com
```

During issuance, certbot will prompt you to create a TXT record like:
- Name: `_acme-challenge.example.com`
- Type: `TXT`
- Value: (a token certbot prints)

After it propagates, press Enter and certbot will continue.

If you run into a situation where the prompt/token only shows up in logs, you can try the hook-based mode:

```bash
python3 -m python_video_server.letsencrypt certonly \
  --challenge dns \
  --dns-hooks \
  --email you@example.com \
  --domains example.com,www.example.com
```

Certificates will be written under:
- `python_video_server/certs/config/live/<primary-domain>/fullchain.pem`
- `python_video_server/certs/config/live/<primary-domain>/privkey.pem`

### 2) Run the video server on 443 with TLS

```bash
sudo -E uvicorn python_video_server.server:app --host 0.0.0.0 --port 443 \
  --ssl-certfile python_video_server/certs/config/live/example.com/fullchain.pem \
  --ssl-keyfile  python_video_server/certs/config/live/example.com/privkey.pem
```

Notes:
- Binding to ports **80/443** usually requires `sudo` (or a reverse proxy / port forwarding).
- If you’re behind a proxy/ingress, keep sending `X-Forwarded-Proto: https` so `/api/video/session` sets `Secure` cookies correctly.

### 3) Renew certificates

```bash
# Dry-run renewal (safe)
sudo -E python3 -m python_video_server.letsencrypt renew --dry-run

# Actual renew (typically run via cron/systemd timer)
sudo -E python3 -m python_video_server.letsencrypt renew --production
```

## Endpoints

- `POST /api/video/session`  
  Sets `video_auth` cookie (send `Authorization: Bearer <token>`).

- `GET|HEAD /api/video/{movieId}`  
  Streams the movie file (supports `Range: bytes=...`).

- `GET /healthz`

