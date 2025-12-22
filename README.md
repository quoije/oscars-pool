## Oscars Pool 2025
Little nodejs + mongodb app that I hack together with ChatGPT to keep track of watched movies for an incoming Oscars Pool with some friends. App is not secure, using old html standard and is not the most responsive but does the job. 

Would probably need to revamp everything, but didn't want to spend more time on it. 

![Oscars Pool 2025](https://github.com/quoije/oscar-pool/blob/2025/img/preview.png)

## Setup
Config those in your .env file:

**DOG_NAMES=**`woof, WOOF, Woof` &nbsp;&nbsp;&nbsp;&nbsp;(for "verification")<br>
**GITHUB_OWNER=**`quoije` &nbsp;&nbsp;&nbsp;&nbsp;(for version history)<br> 
**GITHUB_REPO=**`oscars-pool` &nbsp;&nbsp;&nbsp;&nbsp;(for version history)<br>
**JWT_SECRET=**`RANDOM STRING` &nbsp;&nbsp;&nbsp;&nbsp;(for authentication token)<br>
**MONGO_URI=**`mongodb+srv://USER:PASS@cluster0.XXXX.mongodb.net/?retryWrites=true&w=majority&appName=Cluster69`<br>
**OMDB_API=**`1234567` &nbsp;&nbsp;&nbsp;&nbsp;(for movie info)

run with **node .\index.js**
