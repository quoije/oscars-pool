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

## Endpoints

- `POST /api/video/session`  
  Sets `video_auth` cookie (send `Authorization: Bearer <token>`).

- `GET|HEAD /api/video/{movieId}`  
  Streams the movie file (supports `Range: bytes=...`).

- `GET /healthz`

