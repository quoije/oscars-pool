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
