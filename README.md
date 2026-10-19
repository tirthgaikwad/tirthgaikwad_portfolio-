# Connect2Minds (Connect2Minds)

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

## Discover Talent

`search.html` loads `chat-common.js` and `discover.js`. One request (`GET /api/discover`) returns a small card for everyone else on the platform, with whether you follow or saved them, their follower count and who is online. Searching, filtering, sorting and paging then happen in the browser, so they are instant; the list is also kept in the browser and shown at once on the next visit while a fresh copy loads.

- The search box matches name, college, department, city, skills, bio and project titles/tech stacks. The search, filters, sort and page are kept in the address bar, so a link reopens the same view (`?q=react&sort=followers`; the older `?skill=` still works).
- "Best match" puts name and skill matches first, then people who share skills or a college with you.
- The page listens on `/api/ws/notifications/{user_id}`: profile edits, new sign-ups, follows and online status appear without a reload. "Online" means the person has Messages or Teams open.
- The directory is capped at the 1000 newest accounts. Beyond that the search would need to move to the server.

## Opportunities Board

`board.html` loads `chat-common.js` and `board.js`. One request (`GET /api/board`) returns every post with its author, how many people applied and whether you are one of them. Search, category tabs, sorting and paging happen in the browser, and the list is kept in the browser so the next visit paints at once.

- Anyone can post, edit and delete their own posts; admins can delete any post. Posting, editing and deleting update the page in place.
- "Apply" stores an application (with an optional note) in `board_applications` and sends the author a bell notification. The author opens "Applicants" on their post to read the notes and message people or add them to a team. Applying again does nothing; "Applied" withdraws.
- Ticking "Urgent" pins a post above the others with a red badge. It does not notify anyone.
- New, edited and deleted posts and applicant counts reach every open board over `/api/ws/notifications/{user_id}`.
- `board.html?new=1` opens the post form directly. The view (`q`, `category`, `sort`, `mine`, `applied`, `page`) is kept in the address bar.
- The board loads the 500 newest posts.

## Campus Network, My Network and Saved Profiles

`college.html` (`campus.js`), `network.html` (`network.js`) and `saved.html` (`saved.js`) follow the Discover pattern: one request each (`GET /api/campus`, `/api/network`, `/api/saved`), the list kept in the browser for the next visit, searching and sorting in the browser, and live updates over `/api/ws/notifications/{user_id}`. They share the person card, pagination and follow/save code in `chat-common.js`, and the same server query (`person_cards_query` in `main.py`) as Discover.

- Campus Network lists everyone whose college matches yours (ignoring case and spaces), with department tabs. The numbers at the top are counted from that list. With no college on your profile the page asks you to add one.
- My Network has Followers, Following and Mutual tabs (`?tab=`). Suggestions are ranked on the server: people who follow you, people followed by those you follow, shared skills, then your college. It considers the 400 newest accounts you do not follow.
- Saved Profiles supports ticking several people to remove them or add them to a team. Removing shows an Undo for 7 seconds.

## Activity History

`history.html` loads `history.js`. `GET /api/history` returns the 100 newest entries plus how many entries each category holds; "Load older activity" pages further back with `?before=<id>`. Categories are worked out on the server from the action name (`HISTORY_CATEGORIES` in `main.py`).

- Search and the time range only look through the entries that are loaded.
- "Export CSV" writes what is on screen. "Clear history" (`DELETE /api/history`) removes everything except the "Account Created" entry, which the admin growth chart is built from.

## Notifications

The header bell on every page is in `shared.js`. `GET /api/notifications` returns the 50 newest and the unread count; `POST /api/notifications/read` takes `{"ids": [...]}` or `{"all": true}`; `DELETE /api/notifications/{id}` removes one. A notification can carry a `link` (one of our own pages) that opens when it is clicked. Pages that do not open the notifications socket themselves get one from `shared.js`, so the badge is live everywhere.

## Research Collab

`research.html` is **Gap Finder** (`gaps.js`, `gaps.css`, server in `gaps.py`). A field is scanned in OpenAlex (open research data, no AI): its sub-topics are crossed with 16 methods (drones, IoT, computer vision, language models...), and pairs that are busy on their own but rarely studied together are shown as gaps, on a map and as ranked cards. A gap shows its few papers, people on Connect2Minds with the skills to build it (own college first), and teams already on it (the gap wall). "Start this project" makes a Project Hub workspace with the research template, a brief stating the gap and a reading list.
- OpenAlex has a daily budget (about 1,000 calls with a free `OPENALEX_API_KEY` in `.env`, about 100 without). Results are shared by everyone and kept 30 days (`gap_cache`); fields asked for when the budget is low are queued and the asker is notified; popular fields are scanned in the background. `OPENALEX_MAILTO` is optional.
- Gaps are saved with `/api/research` (the old saved briefings still open, read only).
- arXiv is not used because its API does not allow requests from a web page.

## Admin dashboard

`admin_dashboard.html` loads `admin.js`. The server decides who gets in: every `/api/admin/*` request needs the admin token set by the admin form on the login page.

- `GET /api/admin/overview` returns the totals, accounts by status, admin applications and sign-ups per week for the last 12 weeks. Sign-up dates come from each account's "Account Created" history entry; accounts without one are counted in the starting figure.
- Accounts can be searched and marked verified or rejected (`POST /api/admin/users/{id}/status`); the person is notified. The founder's account cannot be changed.
- "Announcement" (`POST /api/admin/announce`, 5 per minute) writes one bell notification for every account.
- Approving or denying admin applications is for the founder.

## Project Hub

`project_management.html` loads `chat-common.js` and `project-hub.js`. Every Teams workspace has one board: a kanban board, a planning canvas and two linked tools. One request (`GET /api/teams/{id}/board`) returns the board, its tasks, the canvas and the members, and the page listens on the workspace's WebSocket so teammates see changes as they happen.

- Any member can add, edit and move tasks and draw on the canvas. Deleting a task is for its creator, its assignee or an Admin. Board name, sprint label and linked tools are changed by Admins.
- The canvas is saved as a whole a moment after each change, so if two people draw at the same instant the later save wins.
- GitHub shows a public repository's recent commits, open pull requests and open issues (read-only, cached for 10 minutes, same lookup limit as the profile page). Figma shows a file that is shared as "anyone with the link can view".
- Export: tasks as CSV or JSON, the canvas as a PNG, and "PDF" through the browser's print dialog.
