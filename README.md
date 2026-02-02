## Oscars Pool 2026
Little nodejs + mongodb app that I hack together with ChatGPT and Cursor to keep track of watched movies for an incoming Oscars Pool with some friends.

**Note:** The application interface now supports **English and French** via JSON locale bundles (default is English; the admin can force the site language from the Settings → Language tab).

**Disclaimer:** This was a fun, experimental project built with “AI slop” (Cursor, Claude and Copilot), so it may have security issues. For example, `python_video_server` uses the default token‑in‑URL approach to serve video files, which can leave user tokens in logs or browser history. There are ways to improve this, but at this point I’m blinder than Ray Charles.

| ![Movies](img/preview_movies.png) | ![Checklist](img/preview_checklist.png) |
| --- | --- |
| ![Statistics](img/preview_stats.png) | ![Admin](img/preview_admin.png) |

## Features

### User Features
- **User accounts**: register, login, JWT authentication
- **Dark mode**: follows system preference by default, with a user toggle (persisted per user)
- **Mobile-friendly UI**: improved responsive navbar + controls for small screens
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

## Localization (i18n)

The app ships with a lightweight client-side localization system and two locales: **English** and **French**.

- Locale files live in:
  - `public/locales/en.json`
  - `public/locales/fr.json`
- The i18n runtime is implemented in `public/js/localization.js` and exposed as `window.i18n`.
- The admin can choose the **site language** (currently `en` or `fr`) from the **Admin → Settings → Language** tab. This value is stored in MongoDB and used by the client to pick the active locale.
- Markup is localized via `data-i18n` attributes (and friends):
  - `data-i18n` → element text content
  - `data-i18n-placeholder` → input placeholders
  - `data-i18n-aria-label` → ARIA labels
  - `data-i18n-title` → `title` attributes
- JavaScript code uses a small helper to translate keys with an English fallback, for example:

  ```js
  // inside public/js/* files
  function t(key, fallback, params) {
    if (window.i18n && typeof window.i18n.t === 'function') {
      const base = window.i18n.t(key, params || {});
      return base && base !== key ? base : (fallback || key);
    }
    return fallback || key;
  }

  showResponse('success', t('admin.movies.updatedSuccessfully', 'Movie updated successfully.'));
  ```

To add new text:

1. Add an English entry in `public/locales/en.json` (this is the base source of truth).
2. Optionally add the corresponding French translation to `public/locales/fr.json` using the same key.
3. In HTML, wire it with `data-i18n="your.key"`, or in JS call `t('your.key', 'English fallback')`.

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

## First-time admin setup

On a brand new database (no users with `role: 69`), the app exposes a simple first-time setup flow to create the initial admin account.

1. **Start the app**
   - Make sure `.env` has at least `MONGO_URI` and `JWT_SECRET`.
   - Run:

     ```bash
     npm install
     node index.js
     ```

2. **Open the home page**
  - Visit `http://localhost:5050/` (or `http://localhost:${PORT}/` if you changed the port).
   - If no admin user exists yet, you'll see an **admin setup card** instead of the regular login form.
   - Fill in **name**, **email**, and **password**, then submit to create the first admin. The backend will:
     - create a `User` document with `role: 69` (admin), and
     - return a JWT so you're logged in immediately and redirected into the app.

3. **Access the admin panel**
   - Once logged in as admin, open the **Admin / Control** page (or navigate to `/control.html`).
   - From there you can:
     - Set the **active Oscar year** (Settings → Active year).
     - Configure the **Oscar date** for the countdown.
     - Adjust **points configuration** (points per movie / per correct pick).
     - Control **picks and version visibility**.
     - Choose the **site language** (Settings → Language → `en` / `fr`).
     - Manage movies, categories, winners, users, and the 100% completion modal.

After the first admin is created, the setup card disappears and the index page behaves as a normal login screen.

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
PORT=5050                         # server port (default: 5050)
JWT_EXPIRES_IN=8h                 # JWT expiry (default: 8h)
VIDEO_FILES_DIR=/abs/path/to/video # where server video files live (default: ./public/video)
VIDEO_SESSION_MAX_AGE_SECONDS=28800 # video_auth cookie max-age (default: 8h)
MOVIES_CACHE_TTL_MS=30000         # movies route cache TTL (default: 30000ms)
```

Notes:
- The server serves the UI from `public/` (open `http://localhost:5050` by default unless you override `PORT`).
- If you use `video_file` in a movie record, it must be a **relative path** under `VIDEO_FILES_DIR` (the backend blocks traversal/absolute paths).

## Python video server (optional)
There is also a standalone Python server in `python_video_server/` that mirrors `/api/video/:id` (Range streaming + JWT + Mongo). See `python_video_server/README.md` for setup and usage instructions.

