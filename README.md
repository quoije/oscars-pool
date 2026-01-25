## Oscars Pool 2026
Little nodejs + mongodb app that I hack together with ChatGPT and Cursor to keep track of watched movies for an incoming Oscars Pool with some friends.

**Note:** The application interface is in French.

**Disclaimer:** This was a fun, experimental project built with “AI slop” (Cursor), so it may have security issues. For example, `python_video_server` uses the default token‑in‑URL approach to serve video files, which can leave user tokens in logs or browser history. There are ways to improve this, but at this point I’m blinder than Ray Charles.

![Oscars Pool 2026](img/preview.png)

## Features

### User Features
- **User accounts**: register, login, JWT authentication
- **Optional registration verification**: via `DOG_NAMES` environment variable (if unset, verification is skipped)
- **Multi-year support**: browse movies and stats by Oscar year (admin controls the active year)
- **Checklist + progress**: mark movies as watched (with date), progress bar, countdown to Oscars date
- **Movie details**: pulled from OMDb (title/plot/rating/poster) via IMDb ID (optional)
- **Movie ratings**: 1–5 star user ratings + global average
- **User statistics**: watched count, points from movies watched and Oscar picks, leaderboard
- **Video player**: direct video URL, server file (HD/low), embed, or legacy VOD link
- **Subtitles**: per-movie subtitle tracks in the player (VTT/SRT)
- **Resume playback**: per-user playback progress saving (time/duration)
- **Oscar picks**: make picks for each category, auto-save on selection
- **Scores**: view leaderboard with correct/incorrect pick counts, detailed breakdown per user

### Admin Features
- **Movie management**: add, edit (optionally refresh from OMDb), delete movies, search/bulk delete
- **Player source management**: configure video source, server files, low-quality fallback, subtitles
- **User management**: view/create/delete users, reset passwords (temp password + forced change on next login)
- **Oscar category management**: create, edit, delete categories with nominees, bulk delete
- **Winner management**: mark winners per category and overall winners by year (ties + optional points)
- **View all picks**: see everyone's picks in a comparison view
- **Global settings**: active Oscar year, Oscars date for countdown, points config, picks visibility
- **Completion modal**: customize 100% completion reward (title/text/HTML/video)
- **Database backup/restore**: create, download, and restore backups
- **App version control**: manage app version display (footer) from admin panel (no GitHub dependency)
- **Player UI settings**: control player page admin status display

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
- Collections are created/managed automatically from the models in `models/`:
  - `User` - user accounts
  - `Movie` - Oscar-nominated movies
  - `OscarCategory` - Oscar categories with nominees
  - `OscarPick` - user picks for each category
  - `Setting` - global settings (active year, etc.)
  - `PlaybackProgress` - video playback progress per user

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
There is also a standalone Python server in `python_video_server/` that mirrors `/api/video/:id` (Range streaming + JWT + Mongo). See `python_video_server/README.md` for setup and usage instructions.

