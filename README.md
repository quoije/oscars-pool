## Oscars Pool 2026
Little nodejs + mongodb app that I hack together with ChatGPT and Cursor to keep track of watched movies for an incoming Oscars Pool with some friends.

![Oscars Pool 2026](https://github.com/quoije/oscars-pool/blob/prod/img/preview.png)

## Features
- User accounts: register, login, JWT auth
- Simple registration verification via `DOG_NAMES`
- Mark nominees as watched (per user), with watched date
- Browse movies by Oscar year + API for available years
- User stats: watched count/ratio and watched titles
- Movie details pulled from OMDb (title/plot/rating/poster) via IMDb ID
- Admin movie management: add, edit (optionally refresh from OMDb), delete
- Built-in player page with multiple source options (VOD link, direct video file, embed)
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
DOG_NAMES=woof,WOOF,Woof                        # simple registration "verification"
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
