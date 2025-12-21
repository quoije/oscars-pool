## Oscars Pool 2026
Little nodejs + mongodb app that I hack together with ChatGPT to keep track of watched movies for an incoming Oscars Pool with some friends.

![Oscars Pool 2026](https://github.com/quoije/oscar-pool/blob/prod/img/preview.png)

## Setup
Config those in your .env file:

**DOG_NAMES=**`woof, WOOF, Woof` &nbsp;&nbsp;&nbsp;&nbsp;(for "verification")<br>
**GITHUB_OWNER=**`quoije` &nbsp;&nbsp;&nbsp;&nbsp;(for version history)<br> 
**GITHUB_REPO=**`oscars-pool` &nbsp;&nbsp;&nbsp;&nbsp;(for version history)<br>
**JWT_SECRET=**`RANDOM STRING` &nbsp;&nbsp;&nbsp;&nbsp;(for authentication token)<br>
**MONGO_URI=**`mongodb+srv://USER:PASS@cluster0.XXXX.mongodb.net/?retryWrites=true&w=majority&appName=Cluster69`<br>
**OMDB_API=**`1234567` &nbsp;&nbsp;&nbsp;&nbsp;(for movie info)

run with **node .\index.js**

## Python video file server (mp4/mkv)
This repo also includes a small Python server that serves local video files with **HTTP Range** support (required for HTML5 `<video>` seeking).

- Put your files in: `./media/` (repo root)
- Served as: `http://localhost:8001/media/<filename>`
- List endpoint: `http://localhost:8001/api/media`

### Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run

```bash
python3 video_server.py
```

### Use in the web player
Set the movie's `video_src` (or `vod_link`) to something like:

- `http://localhost:8001/media/MyMovie.mp4`
- `http://localhost:8001/media/MyMovie.mkv`

If the Node app is on a different origin/port, the video server enables CORS by default. You can lock it down with:

```bash
export CORS_ORIGINS="http://localhost:5000"
```
