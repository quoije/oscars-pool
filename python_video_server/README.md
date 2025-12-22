# Python video server (Range streaming + JWT + Mongo)

This is a small standalone server that mirrors the app’s `/api/video/:id` behavior:

- Looks up `movies._id == :id` in MongoDB and reads the `video_file` field
- Streams the file from `VIDEO_FILES_DIR` with **HTTP Range** support (seeking works)
- Auth via the same JWT (`Authorization: Bearer ...`), plus a `video_auth` cookie for `<video>`

## Run

```bash
python -m pip install -r python_video_server/requirements.txt
export MONGO_URI="..."
export JWT_SECRET="..."
export VIDEO_FILES_DIR="/absolute/path/to/public/video"  # optional (default: ./public/video)
export VIDEO_SESSION_MAX_AGE_SECONDS="28800"             # optional (default: 8h)
uvicorn python_video_server.server:app --host 0.0.0.0 --port 8000
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

During issuance, you'll be prompted to create a TXT record like:
- Name: `_acme-challenge.example.com`
- Type: `TXT`
- Value: (a token certbot prints)

After it propagates, press Enter and certbot will continue.

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

