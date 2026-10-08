# Connect2Minds (ProPartner)

A networking platform for students and developers: profiles, skill search, follows, project portfolios, an opportunities board, direct chat, and team workspaces with channels.

- **Backend**: FastAPI + async SQLAlchemy on Postgres (`main.py`, `database.py`)
- **Frontend**: static HTML pages with `shared.js`, served separately from the API

## Setup

```bash
pip install -r requirements.txt
```

Create a `.env` file in the project root:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
SECRET_KEY=<long random string>
FOUNDER_CODE=<code for the founder admin login>
```

`DATABASE_URL` and `SECRET_KEY` are required; the server will not start without them. `FOUNDER_CODE` is optional, and founder login is disabled when it is not set. Never commit `.env`.

## Running

```bash
# API on port 8000
uvicorn main:app --reload --port 8000
```

Serve the HTML files on port 5500 (for example with the VS Code Live Server extension) and open `index.html`. The pages call the API on port 8000 of the same hostname, and the API only accepts requests from `http://127.0.0.1:5500` and `http://localhost:5500` (see the CORS settings in `main.py`).

Tables are created automatically on startup.

## Chat page

`inbox.html` loads `inbox.js` (direct chats, groups, attachments, search, settings) and `inbox-calls.js` (one-to-one voice and video calls).

- Calls use WebRTC with public STUN servers and no relay server, so a call can fail to connect between two very restrictive networks. Browsers only allow camera and microphone access on `localhost`/`127.0.0.1` or over HTTPS.
- Images and recordings embedded in older messages are decoded once and kept in `media_cache/` (not public, not committed).
- Every database query costs one network round trip to the database host. If the app feels slow, check how far the database region is from where the API runs.

## Teams page

`team.html` loads `chat-common.js` (helpers shared with the Messages page), `team.js` (workspaces, channels, messages, reactions, pins, resources, members) and `team-calls.js` (voice rooms and group calls).

- A workspace opens with one request (`GET /api/teams/{id}/bootstrap`) plus the first page of messages, and keeps one WebSocket open (`/api/ws/teams/{team_id}/{user_id}`) for everything live in that workspace.
- Voice rooms connect every participant directly to every other one (a WebRTC mesh). That is comfortable for about six people; larger rooms would need a media server.
- Roles: the creator and Admins can invite, change roles, remove members, and create, rename or delete channels. Only the creator can delete a workspace; everyone else can leave it.

## Profile page

`profile.html` loads `chat-common.js` and `profile.js`. One request (`GET /api/profiles/{id}/page`) returns the profile, follow counts, the viewer's relationship to it, and its projects. The site header on every page is filled from `GET /api/me`, cached in the browser.

- Profile and banner pictures are cropped in the browser and uploaded; the cropping library is only downloaded when a picture is being changed.
- GitHub is connected by username (no sign-in with GitHub). Results are cached on the server for 10 minutes; GitHub allows about 60 unauthenticated lookups per hour per server address.
- "Export Resume" builds a print layout and opens the browser's print dialog, which can save as PDF.

## Project Hub

`project_management.html` loads `chat-common.js` and `project-hub.js`. Every Teams workspace has one board: a kanban board, a planning canvas and two linked tools. One request (`GET /api/teams/{id}/board`) returns the board, its tasks, the canvas and the members, and the page listens on the workspace's WebSocket so teammates see changes as they happen.

- Any member can add, edit and move tasks and draw on the canvas. Deleting a task is for its creator, its assignee or an Admin. Board name, sprint label and linked tools are changed by Admins.
- The canvas is saved as a whole a moment after each change, so if two people draw at the same instant the later save wins.
- GitHub shows a public repository's recent commits, open pull requests and open issues (read-only, cached for 10 minutes, same lookup limit as the profile page). Figma shows a file that is shared as "anyone with the link can view".
- Export: tasks as CSV or JSON, the canvas as a PNG, and "PDF" through the browser's print dialog.
