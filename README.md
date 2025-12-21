## Oscars Pool 2026
Little nodejs + mongodb app that I hack together with ChatGPT and Cursor to keep track of watched movies for an incoming Oscars Pool with some friends.

![Oscars Pool 2026](https://github.com/quoije/oscars-pool/blob/2026/img/preview.png)

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
- Version endpoint backed by latest GitHub commit (cached)

## Setup
Config those in your .env file:

**DOG_NAMES=**`woof, WOOF, Woof` &nbsp;&nbsp;&nbsp;&nbsp;(for "verification")<br>
**GITHUB_OWNER=**`quoije` &nbsp;&nbsp;&nbsp;&nbsp;(for version history)<br> 
**GITHUB_REPO=**`oscars-pool` &nbsp;&nbsp;&nbsp;&nbsp;(for version history)<br>
**JWT_SECRET=**`RANDOM STRING` &nbsp;&nbsp;&nbsp;&nbsp;(for authentication token)<br>
**MONGO_URI=**`mongodb+srv://USER:PASS@cluster0.XXXX.mongodb.net/?retryWrites=true&w=majority&appName=Cluster69`<br>
**OMDB_API=**`1234567` &nbsp;&nbsp;&nbsp;&nbsp;(for movie info)

run with **node .\index.js**
