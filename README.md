## Oscars Pool 2026
Little nodejs + mongodb app that I hack together with ChatGPT and Cursor to keep track of watched movies for an incoming Oscars Pool with some friends.

![Oscars Pool 2026](https://raw.githubusercontent.com/quoije/oscars-pool/refs/heads/prod/img/preview.png)

## Features
- User accounts: register, login, JWT auth
- Optional registration "verification" via `DOG_NAMES` (if unset, verification is skipped)
- Mark nominees as watched (per user), with watched date
- Browse movies by Oscar year + API for available years
- User stats: watched count/ratio and watched titles
- Movie details pulled from OMDb (title/plot/rating/poster) via IMDb ID (optional)
- Admin movie management: add, edit (optionally refresh from OMDb), delete
- Built-in player page with multiple source options (VOD link, direct video URL, embed, or server file)
- Resume playback: per-user playback progress saving (time/duration)
- Global settings: active Oscar year, “completion” modal content for checklist
- Password flows: admin temp password reset + forced change on next login
- App version display (footer) managed from Admin panel (no GitHub dependency)

## Setup
Create a `.env` file at the project root (same folder as `package.json`).

Minimal steps:

```bash
npm install
node index.js
```

Add this to your `.env` (**required**: `MONGO_URI`, `JWT_SECRET`):

```bash
# required
MONGO_URI=mongodb://127.0.0.1:27017/oscars-pool # MongoDB connection string
JWT_SECRET=replace-with-a-random-string         # JWT signing secret (auth)

# optional
DOG_NAMES=woof,WOOF,Woof                        # registration verification answers (comma-separated)
OMDB_API=your_omdb_key                          # OMDb API key (movie info)
```

Generate a good `JWT_SECRET`:

```bash
openssl rand -hex 32
```

## Database (MongoDB)
This app uses **MongoDB** via Mongoose. Provide a connection string in `MONGO_URI`.

- Use **MongoDB Atlas** (recommended) or a local MongoDB instance.
- `MONGO_URI` examples:
  - Atlas: `mongodb+srv://USER:PASS@cluster0.XXXX.mongodb.net/<dbName>?retryWrites=true&w=majority`
  - Local: `mongodb://127.0.0.1:27017/<dbName>`
- Collections are created/managed automatically from the models in `models/` (e.g. `User`, `Movie`, `Setting`, `PlaybackProgress`).

## More `.env` options
The app also reads these environment variables (all optional):

```bash
PORT=5000                         # server port (default: 5000)
JWT_EXPIRES_IN=8h                 # JWT expiry (default: 8h)
VIDEO_FILES_DIR=/abs/path/to/video # where server video files live (default: ./public/video)
VIDEO_SESSION_MAX_AGE_SECONDS=28800 # video_auth cookie max-age (default: 8h)
MOVIES_CACHE_TTL_MS=30000         # movies route cache TTL (default: 30000ms)
```

Notes:
- The server serves the UI from `public/` (open `http://localhost:5000` by default).
- If you use `video_file` in a movie record, it must be a **relative path** under `VIDEO_FILES_DIR` (the backend blocks traversal/absolute paths).

## Python video server (optional)
There is also a standalone Python server in `python_video_server/` that mirrors `/api/video/:id` (Range streaming + JWT + Mongo).
See `python_video_server/README.md` for full instructions. In addition to `MONGO_URI` and `JWT_SECRET`, you may need:

```bash
export MONGO_DB_NAME="oscars-pool"  # if your MONGO_URI doesn't include a /<dbName> path
```
