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
