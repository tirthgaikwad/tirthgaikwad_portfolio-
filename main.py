import os
import re
import json
import base64
import uuid
import hmac
import math
import asyncio
import urllib.request
import urllib.error
import httpx
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status, Depends, Request, Response, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone

# --- RATE LIMITING IMPORTS ---
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# --- ASYNC DATABASE IMPORTS ---
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import aliased
from sqlalchemy import Column, Integer, String, Float, Boolean, func, delete, update, text, and_, or_, case, literal, exists, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import insert as pg_insert
from database import engine, Base, get_db, get_fast_db, SessionLocal, AutocommitSession

load_dotenv()

# ==========================================
# 1. DATABASE MODELS
# ==========================================
class DBUser(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    roll_no = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True) # NEW: For .edu.in bypass
    hashed_password = Column(String)
    name = Column(String)
    college_name = Column(String)
    department = Column(String)
    city = Column(String)
    division = Column(String)
    skills = Column(String)
    bio = Column(String)
    profile_pic = Column(String, default="")
    banner_pic = Column(String, default="")
    account_type = Column(String, default="standard") 
    github_username = Column(String, default="")
    
    # Trust & Safety Architecture
    is_admin = Column(Integer, default=0)
    is_founder = Column(Integer, default=0)
    is_ambassador = Column(Boolean, default=False) # Campus Ambassador flag (a true/false column in the database)
    ambassador_strikes = Column(Integer, default=0) # NEW: Accountability system
    account_status = Column(String, default="pending") # NEW: pending, verified, rejected, appealed
    
    id_barcode = Column(String, unique=True, nullable=True)
    id_card_image = Column(String, default="")
    portfolio_link = Column(String, default="")
    invite_code = Column(String, default="")

    # Professions (the list of choices lives in professions.js)
    profession = Column(String, default="")            # "Student" for students
    open_to = Column(String, default="")               # comma-separated choices from OPEN_TO_CHOICES
    experience_years = Column(Integer, nullable=True)

    # College Hub: the college (trimmed, lower-cased name) this person is an approved teacher for; empty for everyone else
    teacher_of = Column(String, default="")

    # Section 17: the department a verification request was passed on to (empty: the profile's own department)
    verify_department = Column(String, default="")
    # Section 19: "recruiters may contact me"
    recruiter_contact_ok = Column(Integer, default=0)
    # Section 18: the best active personal plan and its last day, kept here for badges and limits
    plan = Column(String, default="")
    plan_until = Column(String, default="")

class DBAdminRequest(Base):
    __tablename__ = "admin_requests"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    name = Column(String)
    status = Column(String, default="pending")    # pending, needs_info, approved, declined, withdrawn, revoked (old rows: Pending/Approved/Rejected)
    requested_at = Column(String)
    # The application form (section 17)
    college_name = Column(String, default="")
    college_key = Column(String, default="")
    departments = Column(String, default="[]")    # JSON list of department names
    role_at_college = Column(String, default="")
    staff_id = Column(String, default="")
    official_email = Column(String, default="")
    phone = Column(String, default="")
    hours = Column(Integer, default=0)
    languages = Column(String, default="")
    id_proof_url = Column(String, default="")
    letter_url = Column(String, default="")
    motivation = Column(String, default="")
    decision_note = Column(String, default="")
    info_question = Column(String, default="")
    info_answer = Column(String, default="")
    decided_by = Column(Integer, nullable=True)
    decided_at = Column(String, default="")
    updated_at = Column(String, default="")

class DBHistory(Base):
    __tablename__ = "history"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True) 
    time = Column(String)
    action = Column(String)
    detail = Column(String)

class DBMessage(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, index=True)
    receiver_id = Column(Integer, index=True)
    content = Column(String)
    timestamp = Column(String)
    message_status = Column(String, default="sent")  # sent, delivered, read

class DBProject(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    title = Column(String)
    description = Column(String)
    tech_stack = Column(String)
    github_link = Column(String)
    live_link = Column(String)
    image_url = Column(String, default="") 

class DBNotification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    type = Column(String) 
    content = Column(String)
    is_read = Column(Integer, default=0)
    timestamp = Column(String)
    link = Column(String, default="")              # page to open when the notification is clicked

class DBResearchReport(Base):
    __tablename__ = "research_reports"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    topic = Column(String)
    content = Column(String)                       # the report as JSON
    created_at = Column(String)

class DBFollow(Base):
    __tablename__ = "follows"
    id = Column(Integer, primary_key=True, index=True)
    follower_id = Column(Integer, index=True)
    followed_id = Column(Integer, index=True)
    timestamp = Column(String)

class DBSavedProfile(Base):
    __tablename__ = "saved_profiles"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)        
    saved_user_id = Column(Integer, index=True)  
    timestamp = Column(String)

class DBBoardPost(Base):
    __tablename__ = "board_posts"
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, index=True)
    title = Column(String)
    description = Column(String)
    skills_required = Column(String)
    author_id = Column(Integer, index=True)
    created_at = Column(String)
    is_urgent = Column(Integer, default=0)         # urgent posts are listed first
    # Sponsored challenges (section 19)
    is_sponsored = Column(Integer, default=0)
    kind = Column(String, default="post")          # post, bounty, hackathon
    sponsor_tier = Column(String, default="")      # basic, featured, hackathon
    sponsor_name = Column(String, default="")
    sponsor_url = Column(String, default="")
    sponsor_logo = Column(String, default="")
    prize = Column(String, default="")
    deadline = Column(String, default="")
    sponsored_until = Column(String, default="")
    max_team_size = Column(Integer, default=1)
    winners_announced = Column(Integer, default=0)

class DBBoardApplication(Base):
    __tablename__ = "board_applications"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    note = Column(String, default="")
    created_at = Column(String)

class DBMutedUser(Base):
    __tablename__ = "muted_users"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    muted_user_id = Column(Integer, index=True)

class DBBlockedUser(Base):
    __tablename__ = "blocked_users"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    blocked_user_id = Column(Integer, index=True)

class DBClearedChat(Base):
    __tablename__ = "cleared_chats"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    cleared_with_user_id = Column(Integer, index=True)
    cleared_at = Column(String)
    cleared_up_to_id = Column(Integer, nullable=True)  # messages with id <= this are hidden for user_id

class DBArchivedChat(Base):
    __tablename__ = "archived_chats"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    archived_user_id = Column(Integer, index=True)

class DBProChat(Base):
    """Two people whose conversation belongs in the Professionals section of Messages. user_a is the smaller id."""
    __tablename__ = "pro_chats"
    id = Column(Integer, primary_key=True, index=True)
    user_a = Column(Integer, index=True)
    user_b = Column(Integer, index=True)
    created_at = Column(String)

class DBTeam(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(String)
    created_by = Column(Integer, index=True)
    created_at = Column(String)
    avatar_url = Column(String, default="")

    # College Hub groups. An ordinary team leaves all of these empty.
    college_key = Column(String, default="", index=True)   # the college the group belongs to
    activity_id = Column(Integer, nullable=True)           # the notice-board activity it was formed for
    topic = Column(String, default="")
    teacher_managed = Column(Integer, default=0)           # 1: only a teacher of the college may change who is in it
    open_to_join = Column(Integer, default=0)              # 1: students of the college may add themselves

class DBTeamMember(Base):
    __tablename__ = "team_members"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    role = Column(String, default="Member")
    joined_at = Column(String)

class DBChannel(Base):
    __tablename__ = "channels"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    name = Column(String, index=True)
    channel_type = Column(String, default="text")
    created_at = Column(String)

class DBTeamMessage(Base):
    __tablename__ = "team_messages"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    channel_id = Column(Integer, index=True)
    sender_id = Column(Integer, index=True)
    content = Column(String)
    timestamp = Column(String)
    is_system_message = Column(Integer, default=0)
    is_pinned = Column(Integer, default=0)
    pinned_by = Column(Integer, nullable=True)
    reply_to_id = Column(Integer, nullable=True)

class DBTeamMessageReaction(Base):
    __tablename__ = "team_message_reactions"
    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, index=True)
    channel_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    emoji = Column(String)

class DBTeamResource(Base):
    __tablename__ = "team_resources"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    name = Column(String)
    url = Column(String)
    added_by = Column(Integer)
    created_at = Column(String)

class DBTeamTask(Base):
    __tablename__ = "team_tasks"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    title = Column(String)
    description = Column(String, default="")
    status = Column(String, default="todo")        # the board column: todo, inprogress, review, done
    position = Column(Float, default=0)            # order within the column; fractional so a move touches one row
    tag = Column(String, default="")
    priority = Column(String, default="medium")
    assignee_id = Column(Integer, nullable=True)
    due_date = Column(String, default="")          # YYYY-MM-DD or empty
    created_by = Column(Integer)
    created_at = Column(String)
    updated_at = Column(String)

class DBTeamBoard(Base):
    __tablename__ = "team_boards"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, unique=True, index=True)
    name = Column(String, default="")
    sprint_label = Column(String, default="")
    canvas = Column(String, default="[]")          # planning-canvas shapes as JSON
    github_repo = Column(String, default="")       # owner/repo
    figma_url = Column(String, default="")
    updated_at = Column(String)

class DBCommunity(Base):
    __tablename__ = "communities"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(String)
    banner_url = Column(String, default="")
    created_at = Column(String)

class DBCommunityMember(Base):
    __tablename__ = "community_members"
    id = Column(Integer, primary_key=True, index=True)
    community_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    joined_at = Column(String)

# --- TIME HELPERS ---
def utc_now_iso() -> str:
    """Current time as a UTC ISO-8601 string with offset."""
    return datetime.now(timezone.utc).isoformat()

def parse_timestamp(value: str) -> datetime:
    """Parse a stored timestamp. Older rows have no offset and were written in server-local time."""
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.astimezone()

# --- ASYNC HELPER FUNCTION ---
async def log_user_activity(db: AsyncSession, user_id: int, action: str, detail: str):
    new_log = DBHistory(
        user_id=user_id,
        time=utc_now_iso(),
        action=action,
        detail=detail
    )
    db.add(new_log)
    await db.commit()

# ==========================================
# 2. APPLICATION & WEBSOCKET SETUP
# ==========================================
app = FastAPI(title="Connect2Minds Secure Production API")

SCHEMA_UPGRADES = [
    "ALTER TABLE cleared_chats ADD COLUMN IF NOT EXISTS cleared_up_to_id INTEGER",
    "CREATE INDEX IF NOT EXISTS ix_messages_pair ON messages (sender_id, receiver_id, id)",
    "CREATE INDEX IF NOT EXISTS ix_messages_pair_reverse ON messages (receiver_id, sender_id, id)",
    "CREATE INDEX IF NOT EXISTS ix_messages_receiver_status ON messages (receiver_id, message_status)",
    "CREATE INDEX IF NOT EXISTS ix_team_messages_channel ON team_messages (channel_id, id)",
    "ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS is_pinned INTEGER DEFAULT 0",
    "ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS pinned_by INTEGER",
    "ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_team_message_reactions ON team_message_reactions (message_id, user_id, emoji)",
    "CREATE INDEX IF NOT EXISTS ix_team_members_user_team ON team_members (user_id, team_id)",
    "CREATE INDEX IF NOT EXISTS ix_team_tasks_board ON team_tasks (team_id, status, position)",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS is_urgent INTEGER DEFAULT 0",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_board_applications ON board_applications (post_id, user_id)",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link VARCHAR DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS ix_notifications_user_read ON notifications (user_id, is_read, id)",
    "CREATE INDEX IF NOT EXISTS ix_history_user_id ON history (user_id, id)",
    "CREATE INDEX IF NOT EXISTS ix_follows_followed_follower ON follows (followed_id, follower_id)",
    "CREATE INDEX IF NOT EXISTS ix_saved_profiles_pair ON saved_profiles (user_id, saved_user_id)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS profession VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS open_to VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS experience_years INTEGER",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_pro_chats_pair ON pro_chats (user_a, user_b)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS teacher_of VARCHAR DEFAULT ''",
    "ALTER TABLE teams ADD COLUMN IF NOT EXISTS college_key VARCHAR DEFAULT ''",
    "ALTER TABLE teams ADD COLUMN IF NOT EXISTS activity_id INTEGER",
    "ALTER TABLE teams ADD COLUMN IF NOT EXISTS topic VARCHAR DEFAULT ''",
    "ALTER TABLE teams ADD COLUMN IF NOT EXISTS teacher_managed INTEGER DEFAULT 0",
    "ALTER TABLE teams ADD COLUMN IF NOT EXISTS open_to_join INTEGER DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS ix_teams_college_key ON teams (college_key)",
    "CREATE INDEX IF NOT EXISTS ix_college_messages_room ON college_messages (college_key, room, id)",
    "ALTER TABLE college_posts ADD COLUMN IF NOT EXISTS poll_options VARCHAR DEFAULT '[]'",
    "ALTER TABLE college_posts ADD COLUMN IF NOT EXISTS poll_multi INTEGER DEFAULT 0",
    "ALTER TABLE college_posts ADD COLUMN IF NOT EXISTS needs_ack INTEGER DEFAULT 0",
    "ALTER TABLE college_posts ADD COLUMN IF NOT EXISTS accepts_work INTEGER DEFAULT 0",
    "ALTER TABLE college_posts ADD COLUMN IF NOT EXISTS submit_by VARCHAR DEFAULT ''",
    "ALTER TABLE college_posts ADD COLUMN IF NOT EXISTS max_marks INTEGER DEFAULT 0",
    "ALTER TABLE college_posts ADD COLUMN IF NOT EXISTS weekly_checkins INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_department VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS recruiter_contact_ok INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_until VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS college_name VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS college_key VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS departments VARCHAR DEFAULT '[]'",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS role_at_college VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS staff_id VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS official_email VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS phone VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS hours INTEGER DEFAULT 0",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS languages VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS id_proof_url VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS letter_url VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS motivation VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS decision_note VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS info_question VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS info_answer VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS decided_by INTEGER",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS decided_at VARCHAR DEFAULT ''",
    "ALTER TABLE admin_requests ADD COLUMN IF NOT EXISTS updated_at VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS department VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS designation VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS employee_id VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS official_email VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS phone VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS subjects VARCHAR DEFAULT '[]'",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS years INTEGER DEFAULT 0",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS id_proof_url VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS letter_url VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS profile_link VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS decision_note VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS info_question VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS info_answer VARCHAR DEFAULT ''",
    "ALTER TABLE teacher_requests ADD COLUMN IF NOT EXISTS updated_at VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS is_sponsored INTEGER DEFAULT 0",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS kind VARCHAR DEFAULT 'post'",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS sponsor_tier VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS sponsor_name VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS sponsor_url VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS sponsor_logo VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS prize VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS deadline VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS sponsored_until VARCHAR DEFAULT ''",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS max_team_size INTEGER DEFAULT 1",
    "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS winners_announced INTEGER DEFAULT 0",
    "UPDATE admin_requests SET status = lower(status) WHERE status IN ('Pending', 'Approved', 'Rejected')",
    "CREATE INDEX IF NOT EXISTS ix_subscriptions_owner ON subscriptions (user_id, status, ends_at)",
]

async def backfill_cleared_chats():
    """Older clear-chat rows only stored a time. Convert each one to a message id once."""
    async with SessionLocal() as db:
        result = await db.execute(select(DBClearedChat).filter(DBClearedChat.cleared_up_to_id.is_(None)))
        records = result.scalars().all()
        for rec in records:
            cleared_at = parse_timestamp(rec.cleared_at)
            m_result = await db.execute(select(DBMessage.id, DBMessage.timestamp).filter(or_(
                and_(DBMessage.sender_id == rec.user_id, DBMessage.receiver_id == rec.cleared_with_user_id),
                and_(DBMessage.sender_id == rec.cleared_with_user_id, DBMessage.receiver_id == rec.user_id)
            )))
            older = [m.id for m in m_result.all() if parse_timestamp(m.timestamp) < cleared_at]
            rec.cleared_up_to_id = max(older, default=0)
        if records:
            await db.commit()

@app.on_event("startup")
async def startup_event():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all cannot alter existing tables, so these idempotent statements cover the rest
        for statement in SCHEMA_UPGRADES:
            await conn.execute(text(statement))
    await backfill_cleared_chats()
    spawn_background(keep_pool_warm())
    spawn_background(subscription_watch())
    spawn_background(move_id_cards_to_files())

async def keep_pool_warm():
    """The database is far away and new connections are slow to open, so keep a few open and fresh."""
    async def ping():
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    while True:
        try:
            await asyncio.gather(*(ping() for _ in range(8)))
        except Exception as e:
            print("Database keep-alive failed:", e)
        await asyncio.sleep(120)

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    def is_online(self, user_id: int) -> bool:
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0

    def get_online_user_ids(self) -> List[int]:
        return [uid for uid, conns in self.active_connections.items() if len(conns) > 0]

    async def send_personal_message(self, message: str, user_id: int):
        for connection in list(self.active_connections.get(user_id, [])):
            try:
                await connection.send_text(message)
            except Exception:
                pass

    async def broadcast(self, message: str):
        for connections in list(self.active_connections.values()):
            for connection in list(connections):
                try:
                    await connection.send_text(message)
                except Exception:
                    pass

class RoomConnectionManager:
    def __init__(self):
        self.rooms: dict[int, set] = {}

    async def connect(self, websocket: WebSocket, room_id: int):
        await websocket.accept()
        self.rooms.setdefault(room_id, set()).add(websocket)

    def disconnect(self, websocket: WebSocket, room_id: int):
        connections = self.rooms.get(room_id)
        if connections:
            connections.discard(websocket)
            if not connections:
                del self.rooms[room_id]

    async def broadcast_to_room(self, room_id: int, message: str):
        for connection in list(self.rooms.get(room_id, ())):
            try:
                await connection.send_text(message)
            except Exception:
                pass

class TeamHub:
    """Live connections of people who have a workspace open on the Teams page, and who is in which voice room.

    A room is "voice:<channel id>" for a voice channel, or "call:<channel id>" for a call started in a text channel.
    Audio and video never pass through here: the hub only relays the WebRTC set-up messages between room members.
    """
    def __init__(self):
        self.teams: dict[int, dict] = {}        # team_id -> {websocket: user info}
        self.rooms: dict[str, dict] = {}        # room -> {user_id: {"ws", "muted", "video", "sharing", name, pic}}
        self.room_team: dict[str, int] = {}
        self.room_started: dict[str, float] = {}

    # ---- connections
    def connect(self, team_id: int, websocket: WebSocket, user: dict):
        self.teams.setdefault(team_id, {})[websocket] = user

    def disconnect(self, team_id: int, websocket: WebSocket):
        connections = self.teams.get(team_id)
        if connections:
            connections.pop(websocket, None)
            if not connections:
                del self.teams[team_id]

    def has_user(self, user_id: int) -> bool:
        return any(user["id"] == user_id for connections in self.teams.values() for user in connections.values())

    def user_ids(self) -> set:
        return {user["id"] for connections in self.teams.values() for user in connections.values()}

    def sockets_of(self, team_id: int, user_id: int) -> list:
        return [ws for ws, user in self.teams.get(team_id, {}).items() if user["id"] == user_id]

    async def broadcast(self, team_id: int, payload, exclude: Optional[WebSocket] = None):
        message = payload if isinstance(payload, str) else json.dumps(payload)
        for websocket in list(self.teams.get(team_id, {})):
            if websocket is exclude:
                continue
            try:
                await websocket.send_text(message)
            except Exception:
                pass

    async def broadcast_everywhere(self, message: str):
        for team_id in list(self.teams):
            await self.broadcast(team_id, message)

    async def send_to_user(self, team_id: int, user_id: int, payload: dict):
        message = json.dumps(payload)
        for websocket in self.sockets_of(team_id, user_id):
            try:
                await websocket.send_text(message)
            except Exception:
                pass

    # ---- voice rooms
    def voice_state(self, team_id: int) -> dict:
        state = {}
        for room, members in self.rooms.items():
            if self.room_team.get(room) == team_id and members:
                state[room] = [
                    {"user_id": uid, "name": m["name"], "profile_pic": m["profile_pic"],
                     "muted": m["muted"], "video": m["video"], "sharing": m["sharing"]}
                    for uid, m in members.items()
                ]
        return state

    def room_of(self, websocket: WebSocket) -> Optional[str]:
        for room, members in self.rooms.items():
            if any(m["ws"] is websocket for m in members.values()):
                return room
        return None

    def join_room(self, team_id: int, room: str, websocket: WebSocket, user: dict) -> bool:
        """Returns True if this person is the first one in the room."""
        members = self.rooms.setdefault(room, {})
        first = not members
        if first:
            self.room_team[room] = team_id
            self.room_started[room] = datetime.now(timezone.utc).timestamp()
        members[user["id"]] = {"ws": websocket, "muted": False, "video": False, "sharing": False,
                               "name": user["name"], "profile_pic": user["profile_pic"]}
        return first

    def leave_room(self, room: str, user_id: int):
        """Returns the call length in seconds if the room is now empty, otherwise None."""
        members = self.rooms.get(room)
        if not members or user_id not in members:
            return None
        del members[user_id]
        if members:
            return None
        del self.rooms[room]
        self.room_team.pop(room, None)
        started = self.room_started.pop(room, None)
        return int(datetime.now(timezone.utc).timestamp() - started) if started else 0


chat_manager = ConnectionManager()
notification_manager = ConnectionManager()
team_chat_manager = RoomConnectionManager()
team_hub = TeamHub()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lists such as /api/discover are large JSON; compressed they are 5-8 times smaller over the wire
app.add_middleware(GZipMiddleware, minimum_size=1000)

os.makedirs("static/uploads", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set. Add it to your .env file.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 

# ==========================================
# 3. PYDANTIC SCHEMAS
# ==========================================
class ProfileRegister(BaseModel):
    name: str
    email: Optional[str] = ""
    college_name: str
    department: str
    city: str
    division: str
    roll_no: str
    password: str 
    skills: str
    bio: str
    profile_pic: Optional[str] = ""
    banner_pic: Optional[str] = ""
    github_username: Optional[str] = ""
    account_type: Optional[str] = "standard"
    id_barcode: Optional[str] = None
    id_card_image: Optional[str] = ""
    portfolio_link: Optional[str] = None
    invite_code: Optional[str] = None
    profession: Optional[str] = ""
    open_to: Optional[str] = ""
    experience_years: Optional[int] = None

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    college_name: Optional[str] = None
    department: Optional[str] = None
    city: Optional[str] = None
    division: Optional[str] = None
    skills: Optional[str] = None
    bio: Optional[str] = None
    profile_pic: Optional[str] = None
    banner_pic: Optional[str] = None
    github_username: Optional[str] = None
    profession: Optional[str] = None
    open_to: Optional[str] = None
    experience_years: Optional[int] = None
    recruiter_contact_ok: Optional[bool] = None

class UserLogin(BaseModel):
    roll_no: str
    password: str

class ProfileResponse(BaseModel):
    id: int
    is_admin: int = 0
    name: str
    college_name: str
    department: str
    city: str
    division: str
    roll_no: str
    skills: str
    bio: str
    profile_pic: str
    banner_pic: str
    account_type: str
    github_username: Optional[str] = ""
    profession: Optional[str] = ""
    open_to: Optional[str] = ""
    experience_years: Optional[int] = 0

    class Config:
        from_attributes = True
    
    class Config:
        from_attributes = True

class ProfileDetailResponse(ProfileResponse):
    followers_count: int
    following_count: int
    is_following: bool
    is_saved: bool
    account_status: Optional[str] = ""   

class MessageCreate(BaseModel):
    sender_id: int
    receiver_id: int
    content: str
    temp_id: Optional[str] = None

class MessageResponse(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    content: str
    timestamp: datetime
    message_status: Optional[str] = "sent"
    
    class Config:
        from_attributes = True

class ProjectCreate(BaseModel):
    title: str
    description: str
    tech_stack: str
    github_link: Optional[str] = ""
    live_link: Optional[str] = ""
    image_url: Optional[str] = "" 

class ProjectResponse(BaseModel):
    id: int
    user_id: int
    title: str
    description: str
    tech_stack: str
    github_link: str
    live_link: str
    image_url: str
    
    class Config:
        from_attributes = True

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    type: str
    content: str
    is_read: int
    timestamp: datetime
    
    class Config:
        from_attributes = True

class BoardPostCreate(BaseModel):
    category: str
    title: str
    description: str
    skills_required: str
    is_urgent: Optional[bool] = False

class BoardApplicationCreate(BaseModel):
    note: Optional[str] = ""

class BoardPostResponse(BaseModel):
    id: int
    category: str
    title: str
    description: str
    skills_required: str
    created_at: str
    author_id: int
    author_name: str
    author_pic: str
    author_college: str

    class Config:
        from_attributes = True

class TeamCreate(BaseModel):
    name: str
    description: str
    avatar_url: Optional[str] = ""

class TeamResponse(BaseModel):
    id: int
    name: str
    description: str
    created_by: int
    created_at: str
    avatar_url: str
    
    class Config:
        from_attributes = True

class TeamMemberAdd(BaseModel):
    user_id: int
    role: str = "Member"

class TeamMemberResponse(BaseModel):
    id: int
    team_id: int
    user_id: int
    role: str
    joined_at: str
    user_name: Optional[str] = ""
    user_profile_pic: Optional[str] = ""

    class Config:
        from_attributes = True

class ChannelCreate(BaseModel):
    name: str
    channel_type: str = "text"

class ChannelResponse(BaseModel):
    id: int
    team_id: int
    name: str
    channel_type: str
    created_at: str

    class Config:
        from_attributes = True

class TeamMessageCreate(BaseModel):
    content: str
    is_system_message: int = 0   # accepted for older clients but ignored: only the server writes system messages
    temp_id: Optional[str] = None
    reply_to_id: Optional[int] = None

class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class ChannelRename(BaseModel):
    name: str

class MemberRoleUpdate(BaseModel):
    role: str

class ReactionToggle(BaseModel):
    emoji: str

class ResourceCreate(BaseModel):
    name: str
    url: str

class TeamMessageResponse(BaseModel):
    id: int
    team_id: int
    channel_id: Optional[int] = None
    sender_id: int
    content: str
    timestamp: str
    is_system_message: int
    sender_name: Optional[str] = ""
    sender_pic: Optional[str] = ""
    is_pinned: int = 0
    reactions: list = []
    reply_to: Optional[dict] = None

    class Config:
        from_attributes = True

class AdminLogin(BaseModel):
    name: str
    bypass_code: str

class AdminRequestResponse(BaseModel):
    id: int
    user_id: int
    name: str
    status: str
    requested_at: str

    class Config:
        from_attributes = True

class PendingUserResponse(BaseModel):
    id: int
    name: str
    college_name: Optional[str] = ""
    department: Optional[str] = ""
    roll_no: Optional[str] = ""
    id_barcode: Optional[str] = None
    id_card_image: Optional[str] = ""

    class Config:
        from_attributes = True

class AdminStatsResponse(BaseModel):
    total_users: int
    total_projects: int
    total_teams: int
    total_admins: int
    pending_requests: int

# ==========================================
# 4. COOKIE-BASED SECURITY FUNCTIONS
# ==========================================
def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

# bcrypt is slow on purpose (about 0.25 s); run it on a worker thread so a burst of logins does not stall every other request
async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(get_password_hash, password)

async def check_password_async(plain_password: str, hashed_password: str) -> bool:
    return await asyncio.to_thread(verify_password, plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("authToken")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated. No secure cookie found.")
        
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication token.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please log in again.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
        
    result = await db.execute(select(DBUser).filter(DBUser.id == int(user_id)))
    user = result.scalars().first()
    
    if user is None:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
        
    return user

async def get_current_user_id(request: Request) -> int:
    token = request.cookies.get("authToken")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated. No secure cookie found.")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication token.")
        return int(user_id)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please log in again.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


def get_websocket_user_id(websocket: WebSocket) -> Optional[int]:
    """Identify a WebSocket client from its authToken cookie. Returns None if not authenticated."""
    token = websocket.cookies.get("authToken")
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload.get("sub"))
    except (jwt.PyJWTError, TypeError, ValueError):
        return None


# ==========================================
# 5. CORE API ENDPOINTS
# ==========================================
STUDENT_PROFESSION = "Student"
PROFESSION_LENGTH = 80
OPEN_TO_CHOICES = ("mentoring", "collaboration", "hiring", "consulting", "speaking", "internships")
MAX_EXPERIENCE_YEARS = 70

def clean_open_to(value: Optional[str]) -> str:
    """Keeps the choices we know, in a fixed order, and drops anything else."""
    picked = {part.strip().lower() for part in (value or "").split(",")}
    return ",".join(choice for choice in OPEN_TO_CHOICES if choice in picked)

def clean_experience_years(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    if value < 0 or value > MAX_EXPERIENCE_YEARS:
        raise HTTPException(status_code=400, detail=f"Years of experience must be between 0 and {MAX_EXPERIENCE_YEARS}.")
    return value

def is_professional_account(account_type: Optional[str], profession: Optional[str]) -> bool:
    """The same rule professions.js uses in the browser."""
    return account_type == "professional" or (profession or "").strip() not in ("", STUDENT_PROFESSION)


@app.post("/api/register", status_code=status.HTTP_201_CREATED)
async def register_user(profile: ProfileRegister, response: Response, db: AsyncSession = Depends(get_db)):
    # Auto-generate email if not provided
    user_email = profile.email.strip() if profile.email else ""
    if not user_email:
        user_email = f"{profile.roll_no}@placeholder.connect2minds.local"
    
    # Check for existing user by roll number or email
    result = await db.execute(select(DBUser).filter((DBUser.roll_no == profile.roll_no) | (DBUser.email == user_email)))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Roll number or Email already registered.")
            
    if profile.id_barcode:
        bc_check = await db.execute(select(DBUser).filter(DBUser.id_barcode == profile.id_barcode))
        if bc_check.scalars().first():
            raise HTTPException(status_code=400, detail="This College ID barcode has already been registered.")

    hashed_pwd = await hash_password_async(profile.password)
    id_card = await store_id_card(profile.id_card_image) if (profile.id_card_image or "").strip() else ""

    # Professionals pick a profession when they sign up; everyone else is a student
    profession = (profile.profession or "").strip()[:PROFESSION_LENGTH]
    if not profession and profile.account_type != "professional":
        profession = STUDENT_PROFESSION
    experience_years = clean_experience_years(profile.experience_years)

    # ---------------------------------------------------------
    # SMART VERIFICATION LOGIC (The Gold Standard Bypass)
    # ---------------------------------------------------------
    initial_status = "pending" # Default provisional access
    
    # 1. Official College Email Auto-Verify
    if user_email.endswith(".edu.in") or user_email.endswith(".ac.in"):
        initial_status = "verified"
        
    # 2. Professional Invite Code Auto-Verify
    elif profile.account_type == "professional" and profile.invite_code:
        # In a full build, you'd check if the invite_code is valid in the DB here
        initial_status = "verified"
    
    new_user = DBUser(
        roll_no=profile.roll_no,
        email=user_email,
        hashed_password=hashed_pwd,
        name=profile.name,
        college_name=profile.college_name,
        department=profile.department,
        city=profile.city,
        division=profile.division,
        skills=profile.skills,
        bio=profile.bio,
        profile_pic=profile.profile_pic,
        banner_pic=profile.banner_pic,
        account_type=profile.account_type,
        account_status=initial_status, # Applies the smart logic
        github_username=profile.github_username,
        id_barcode=profile.id_barcode,
        id_card_image=id_card,
        portfolio_link=profile.portfolio_link,
        invite_code=profile.invite_code,
        profession=profession,
        open_to=clean_open_to(profile.open_to),
        experience_years=experience_years
    )

    db.add(new_user)
    try:
        await db.commit()
    except Exception:
        remove_id_card_file(id_card)
        raise
    await db.refresh(new_user)

    access_token = create_access_token(data={"sub": str(new_user.id)})
    
    response.set_cookie(
        key="authToken",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,
        path="/"
    )
    
    await log_user_activity(db, new_user.id, "Account Created", f"Welcome! Your status is: {initial_status}.")
    spawn_background(broadcast_directory({"type": "profile_added", "profile": directory_card(new_user)}))
    return {"message": "Account registered.", "user_id": new_user.id, "status": initial_status}


@app.post("/api/login")
@limiter.limit("5/minute") 
async def login_user(request: Request, credentials: UserLogin, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DBUser).filter(DBUser.roll_no == credentials.roll_no))
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials.")
        
    if not await check_password_async(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
        
    access_token = create_access_token(data={"sub": str(user.id)})
    
    response.set_cookie(
        key="authToken",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,
        path="/"
    )
    
    await log_user_activity(db, user.id, "Session Active", "You successfully logged into your account.")
    return {"message": "Login successful.", "user_id": user.id, "account_type": user.account_type, "is_admin": user.is_admin}


@app.post("/api/logout")
async def logout_user(response: Response):
    response.delete_cookie(key="authToken", path="/", httponly=True, samesite="lax")
    response.delete_cookie(key="adminToken", path="/", httponly=True, samesite="lax")
    return {"message": "Successfully logged out"}


@app.get("/api/profiles", response_model=List[ProfileResponse])
async def get_all_profiles(
    college: Optional[str] = None, 
    department: Optional[str] = None, 
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    query = select(DBUser)
    if college:
        query = query.filter(DBUser.college_name == college)
    if department:
        query = query.filter(DBUser.department == department)
        
    result = await db.execute(query)
    return result.scalars().all()


PUBLIC_PROFILE_FIELDS = (
    "id", "name", "college_name", "department", "city", "division", "roll_no", "skills", "bio",
    "profile_pic", "banner_pic", "account_type", "github_username", "is_admin", "account_status",
    "profession", "open_to", "experience_years", "is_founder", "teacher_of", "plan", "recruiter_contact_ok"
)
NUMBER_FIELDS = ("is_admin", "experience_years", "is_founder", "recruiter_contact_ok")   # sent as 0 when empty; every other empty field is sent as ""

def public_profile_columns():
    return [getattr(DBUser, field) for field in PUBLIC_PROFILE_FIELDS]

def public_profile(row) -> dict:
    """The profile fields anyone logged in may see. Never includes the password hash, email or ID documents."""
    profile = {field: getattr(row, field) for field in PUBLIC_PROFILE_FIELDS}
    for field in PUBLIC_PROFILE_FIELDS:
        if profile[field] is None:
            profile[field] = 0 if field in NUMBER_FIELDS else ""
    return profile

def serialize_project(project) -> dict:
    return {
        "id": project.id,
        "user_id": project.user_id,
        "title": project.title or "",
        "description": project.description or "",
        "tech_stack": project.tech_stack or "",
        "github_link": project.github_link or "",
        "live_link": project.live_link or "",
        "image_url": project.image_url or ""
    }

# (viewer, profile) -> the day a "viewed your profile" notification was last sent, so reloads do not spam
profile_view_notified: dict = {}

async def notify_profile_view(viewer_id: int, profile_id: int):
    today = datetime.now(timezone.utc).date().isoformat()
    if profile_view_notified.get((viewer_id, profile_id)) == today:
        return
    if len(profile_view_notified) > 20000:
        profile_view_notified.clear()
    profile_view_notified[(viewer_id, profile_id)] = today
    try:
        rows = await fetch_one_off(select(DBUser.name).filter(DBUser.id == viewer_id))
        if rows:
            await create_notification(profile_id, "view", f"{rows[0][0]} viewed your profile!", utc_now_iso(), f"profile.html?id={viewer_id}")
    except Exception as e:
        print("Error creating profile-view notification:", e)

async def load_profile(user_id: int, viewer_id: int, with_projects: bool) -> dict:
    """A profile with its follow counts and the viewer's relationship to it. The reads run side by side."""
    relationship = select(
        select(func.count()).select_from(DBFollow).where(DBFollow.followed_id == user_id).scalar_subquery(),
        select(func.count()).select_from(DBFollow).where(DBFollow.follower_id == user_id).scalar_subquery(),
        select(func.count()).select_from(DBFollow).where(DBFollow.follower_id == viewer_id, DBFollow.followed_id == user_id).scalar_subquery(),
        select(func.count()).select_from(DBSavedProfile).where(DBSavedProfile.user_id == viewer_id, DBSavedProfile.saved_user_id == user_id).scalar_subquery(),
    )
    reads = [
        fetch_one_off(select(*public_profile_columns()).filter(DBUser.id == user_id)),
        fetch_one_off(relationship),
    ]
    if with_projects:
        reads.append(fetch_one_off(select(DBProject).filter(DBProject.user_id == user_id).order_by(DBProject.id.desc())))
    results = await asyncio.gather(*reads)

    if not results[0]:
        raise HTTPException(status_code=404, detail="Developer not found.")
    profile = public_profile(results[0][0])
    followers, following, is_following, is_saved = results[1][0]
    profile["followers_count"] = followers or 0
    profile["following_count"] = following or 0
    profile["is_following"] = bool(is_following)
    profile["is_saved"] = bool(is_saved)
    if with_projects:
        profile["projects"] = [serialize_project(project) for (project,) in results[2]]

    if viewer_id != user_id:
        spawn_background(notify_profile_view(viewer_id, user_id))
    return profile


@app.get("/api/me")
async def get_me(db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """The logged-in person's own card, for the site header. One small query."""
    row = (await db.execute(select(*public_profile_columns()).filter(DBUser.id == current_user_id))).first()
    if not row:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    return public_profile(row)


@app.get("/api/profile-options")
async def get_profile_options(current_user_id: int = Depends(get_current_user_id)):
    """Colleges and departments already on the platform, as suggestions while editing a profile."""
    colleges, departments = await asyncio.gather(
        fetch_one_off(select(DBUser.college_name).where(DBUser.college_name != "").distinct().order_by(DBUser.college_name).limit(300)),
        fetch_one_off(select(DBUser.department).where(DBUser.department != "").distinct().order_by(DBUser.department).limit(300)),
    )
    return {"colleges": [c for (c,) in colleges if c], "departments": [d for (d,) in departments if d]}


# ==========================================
# 5a. DISCOVER TALENT DIRECTORY
# ==========================================
DIRECTORY_FIELDS = ("id", "name", "college_name", "department", "city", "skills", "profile_pic", "account_type", "account_status", "github_username",
                    "profession", "open_to", "experience_years", "is_admin", "is_founder", "teacher_of", "plan")
DIRECTORY_BIO_LENGTH = 160   # cards show two lines of it
DIRECTORY_LIMIT = 5000        # Discover filters in the browser; past this many people it needs server-side paging

def directory_card(row) -> dict:
    """The small card the Discover page shows for one person. Never includes the password hash, email or ID documents."""
    card = {}
    for field in DIRECTORY_FIELDS:
        value = getattr(row, field)
        card[field] = value if value is not None else (0 if field in NUMBER_FIELDS else "")
    card["bio"] = (row.bio or "")[:DIRECTORY_BIO_LENGTH]
    return card

async def broadcast_directory(payload: dict):
    """Tell every open Discover page that a person's card changed. Meant to run in the background."""
    await notification_manager.broadcast(json.dumps(payload))


def person_cards_query(viewer_id: int, *conditions, extra_columns=()):
    """People as directory cards with the viewer's relationship to each. Never lists the viewer,
    rejected accounts or people the viewer blocked. Shared by every page that shows people."""
    # A few old accounts may hold a whole picture as text; those are left out of the listing
    picture = case((func.length(DBUser.profile_pic) > 1000, ""), else_=DBUser.profile_pic).label("profile_pic")
    columns = [picture if field == "profile_pic" else getattr(DBUser, field) for field in DIRECTORY_FIELDS]
    return (
        select(
            *columns,
            func.left(DBUser.bio, DIRECTORY_BIO_LENGTH).label("bio"),
            select(func.count()).select_from(DBFollow).where(DBFollow.followed_id == DBUser.id).scalar_subquery().label("followers_count"),
            exists().where(DBFollow.follower_id == viewer_id, DBFollow.followed_id == DBUser.id).label("is_following"),
            exists().where(DBSavedProfile.user_id == viewer_id, DBSavedProfile.saved_user_id == DBUser.id).label("is_saved"),
            exists().where(DBFollow.follower_id == DBUser.id, DBFollow.followed_id == viewer_id).label("follows_me"),
            *extra_columns,
        )
        .where(
            DBUser.id != viewer_id,
            or_(DBUser.account_status.is_(None), DBUser.account_status != "rejected"),
            ~exists().where(DBBlockedUser.user_id == viewer_id, DBBlockedUser.blocked_user_id == DBUser.id),
            *conditions,
        )
    )

def person_card(row) -> dict:
    card = directory_card(row)
    card["followers_count"] = row.followers_count or 0
    card["is_following"] = bool(row.is_following)
    card["is_saved"] = bool(row.is_saved)
    card["follows_me"] = bool(row.follows_me)
    return card


@app.get("/api/discover")
async def get_discover_directory(current_user_id: int = Depends(get_current_user_id)):
    """Everything the Discover Talent page shows, in one request. Searching and filtering happen in the browser."""
    people_rows, project_rows = await asyncio.gather(
        fetch_one_off(person_cards_query(current_user_id).order_by(DBUser.id.desc()).limit(DIRECTORY_LIMIT)),
        fetch_one_off(select(DBProject.user_id, DBProject.title, DBProject.tech_stack)),
    )

    project_words: dict = {}
    for user_id, title, tech_stack in project_rows:
        project_words.setdefault(user_id, []).append(f"{title or ''} {tech_stack or ''}".strip())

    people = []
    for row in people_rows:
        card = person_card(row)
        card["projects_text"] = " ".join(project_words.get(row.id, []))[:200]
        people.append(card)
    return {"people": people, "online_user_ids": all_online_user_ids(), "total": len(people)}


# ==========================================
# 5a-2. CAMPUS NETWORK, MY NETWORK AND SAVED PROFILES
# ==========================================
def skill_keys(skills: Optional[str]) -> set:
    return {skill.strip().lower() for skill in (skills or "").split(",") if skill.strip()}


@app.get("/api/campus")
async def get_campus_network(current_user_id: int = Depends(get_current_user_id)):
    """Everyone from the viewer's own college, in one request."""
    my_college = select(func.lower(func.trim(DBUser.college_name))).where(DBUser.id == current_user_id).scalar_subquery()
    people_query = person_cards_query(
        current_user_id,
        func.trim(func.coalesce(DBUser.college_name, "")) != "",
        func.lower(func.trim(DBUser.college_name)) == my_college,
    ).order_by(DBUser.name).limit(DIRECTORY_LIMIT)
    people_rows, me_rows = await asyncio.gather(
        fetch_one_off(people_query),
        fetch_one_off(select(DBUser.college_name, DBUser.department, DBUser.account_status).where(DBUser.id == current_user_id)),
    )
    if not me_rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    return {
        "college": (me_rows[0].college_name or "").strip(),
        "department": (me_rows[0].department or "").strip(),
        "my_status": me_rows[0].account_status or "",
        "people": [person_card(row) for row in people_rows],
        "online_user_ids": all_online_user_ids(),
    }


NETWORK_SUGGESTIONS = 12
NETWORK_CANDIDATES = 400

@app.get("/api/network")
async def get_my_network(current_user_id: int = Depends(get_current_user_id)):
    """Followers, following and suggested people for the My Network page, in one request."""
    i_follow = select(DBFollow.followed_id).where(DBFollow.follower_id == current_user_id)
    follow_me = select(DBFollow.follower_id).where(DBFollow.followed_id == current_user_id)
    followed_me_at = (select(func.max(DBFollow.timestamp))
                      .where(DBFollow.follower_id == DBUser.id, DBFollow.followed_id == current_user_id).scalar_subquery().label("since"))
    i_followed_at = (select(func.max(DBFollow.timestamp))
                     .where(DBFollow.follower_id == current_user_id, DBFollow.followed_id == DBUser.id).scalar_subquery().label("since"))
    # How many of the people I follow also follow this person
    via = aliased(DBFollow)
    shared_follows = (select(func.count()).select_from(via)
                      .where(via.followed_id == DBUser.id, via.follower_id.in_(i_follow)).scalar_subquery().label("shared_follows"))

    followers, following, candidates, me_rows = await asyncio.gather(
        fetch_one_off(person_cards_query(current_user_id, DBUser.id.in_(follow_me), extra_columns=(followed_me_at,)).limit(DIRECTORY_LIMIT)),
        fetch_one_off(person_cards_query(current_user_id, DBUser.id.in_(i_follow), extra_columns=(i_followed_at,)).limit(DIRECTORY_LIMIT)),
        fetch_one_off(person_cards_query(current_user_id, DBUser.id.not_in(i_follow), extra_columns=(shared_follows,))
                      .order_by(DBUser.id.desc()).limit(NETWORK_CANDIDATES)),
        fetch_one_off(select(DBUser.college_name, DBUser.skills).where(DBUser.id == current_user_id)),
    )

    my_college = (me_rows[0].college_name or "").strip().lower() if me_rows else ""
    my_skills = skill_keys(me_rows[0].skills) if me_rows else set()

    def with_since(row) -> dict:
        card = person_card(row)
        card["since"] = row.since or ""
        return card

    suggestions = []
    for row in candidates:
        shared_skills = len(skill_keys(row.skills) & my_skills)
        same_college = bool(my_college) and (row.college_name or "").strip().lower() == my_college
        score = shared_skills * 2 + (row.shared_follows or 0) * 2 + (3 if same_college else 0) + (4 if row.follows_me else 0)
        if row.follows_me:
            reason = "Follows you"
        elif row.shared_follows:
            reason = f"Followed by {row.shared_follows} {'person' if row.shared_follows == 1 else 'people'} you follow"
        elif shared_skills:
            reason = f"{shared_skills} shared {'skill' if shared_skills == 1 else 'skills'}"
        elif same_college:
            reason = "From your college"
        else:
            reason = "New on Connect2Minds"
        card = person_card(row)
        card["reason"] = reason
        suggestions.append((score, row.followers_count or 0, row.id, card))
    suggestions.sort(key=lambda item: item[:3], reverse=True)

    return {
        "followers": sorted((with_since(row) for row in followers), key=lambda card: card["since"], reverse=True),
        "following": sorted((with_since(row) for row in following), key=lambda card: card["since"], reverse=True),
        "suggestions": [card for _, _, _, card in suggestions[:NETWORK_SUGGESTIONS]],
        "online_user_ids": all_online_user_ids(),
    }


@app.get("/api/saved")
async def get_saved_people(current_user_id: int = Depends(get_current_user_id)):
    """The viewer's saved profiles as cards, most recently saved first."""
    saved_ids = select(DBSavedProfile.saved_user_id).where(DBSavedProfile.user_id == current_user_id)
    saved_row = (select(func.max(DBSavedProfile.id))
                 .where(DBSavedProfile.user_id == current_user_id, DBSavedProfile.saved_user_id == DBUser.id).scalar_subquery().label("saved_row"))
    saved_at = (select(func.max(DBSavedProfile.timestamp))
                .where(DBSavedProfile.user_id == current_user_id, DBSavedProfile.saved_user_id == DBUser.id).scalar_subquery().label("saved_at"))
    rows = await fetch_one_off(
        person_cards_query(current_user_id, DBUser.id.in_(saved_ids), extra_columns=(saved_row, saved_at)).limit(DIRECTORY_LIMIT)
    )
    people = []
    for row in sorted(rows, key=lambda r: r.saved_row or 0, reverse=True):
        card = person_card(row)
        card["saved_at"] = row.saved_at or ""
        people.append(card)
    return {"people": people, "online_user_ids": all_online_user_ids()}


class SavedRemoval(BaseModel):
    ids: List[int]

@app.post("/api/saved/remove")
async def remove_saved_people(
    removal: SavedRemoval,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """Unsave several profiles in one statement."""
    ids = list(dict.fromkeys(removal.ids))[:500]
    if not ids:
        raise HTTPException(status_code=400, detail="Pick at least one profile to remove.")
    removed = await db.execute(
        delete(DBSavedProfile)
        .where(DBSavedProfile.user_id == current_user_id, DBSavedProfile.saved_user_id.in_(ids))
        .returning(DBSavedProfile.saved_user_id)
    )
    removed_ids = sorted({row[0] for row in removed.all()})
    if removed_ids:
        count = len(removed_ids)
        spawn_background(log_activity_later(current_user_id, "Removed Bookmark", f"Unsaved {count} {'profile' if count == 1 else 'profiles'}."))
    return {"removed": removed_ids}


@app.get("/api/profiles/{user_id}/page")
async def get_profile_page(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Everything the profile page shows, in one request."""
    return await load_profile(user_id, current_user_id, with_projects=True)


@app.get("/api/profiles/{user_id}", response_model=ProfileDetailResponse)
async def get_single_profile(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    return await load_profile(user_id, current_user_id, with_projects=False)


# ==========================================
# 5b. PROFILE UPDATE ENDPOINT
# ==========================================
PROFILE_FIELD_LIMITS = {"name": 80, "college_name": 150, "department": 120, "city": 80, "division": 40, "skills": 500, "bio": 500,
                        "profession": PROFESSION_LENGTH}

def is_own_upload(url: str, user_id: int, kind: str) -> bool:
    """True if the address points at a picture this person uploaded through our upload endpoints."""
    return bool(re.search(rf"/static/uploads/user_{user_id}_{kind}[\w.]*\.[a-z0-9]+(\?v=\d+)?$", url or ""))

@app.put("/api/profiles/{user_id}")
async def update_profile(
    user_id: int,
    profile_data: ProfileUpdate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    if current_user_id != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own profile.")

    values = {}
    for field, limit in PROFILE_FIELD_LIMITS.items():
        value = getattr(profile_data, field)
        if value is None:
            continue
        value = value.strip()
        if len(value) > limit:
            raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').capitalize()} is too long. The limit is {limit} characters.")
        values[field] = value
    if "name" in values and not values["name"]:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")
    if "skills" in values:
        values["skills"] = ", ".join(skill.strip() for skill in values["skills"].split(",") if skill.strip())
    if profile_data.open_to is not None:
        values["open_to"] = clean_open_to(profile_data.open_to)
    if profile_data.experience_years is not None:
        values["experience_years"] = clean_experience_years(profile_data.experience_years)
    if profile_data.recruiter_contact_ok is not None:
        values["recruiter_contact_ok"] = 1 if profile_data.recruiter_contact_ok else 0

    # Pictures are changed by uploading; this only accepts an address our own upload endpoints produced
    for field, kind in (("profile_pic", "profile"), ("banner_pic", "banner")):
        value = getattr(profile_data, field)
        if value is None:
            continue
        if value != "" and not is_own_upload(value, user_id, kind):
            raise HTTPException(status_code=400, detail="Pictures must be uploaded, not linked from another site.")
        values[field] = value

    if not values:
        raise HTTPException(status_code=400, detail="No fields to update.")

    result = await db.execute(update(DBUser).where(DBUser.id == user_id).values(**values).returning(*public_profile_columns()))
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Developer not found.")
    spawn_background(log_activity_later(user_id, "Profile Updated", "You updated your profile information."))
    spawn_background(broadcast_directory({"type": "profile_updated", "profile": directory_card(row)}))
    return {"message": "Profile updated successfully.", "user_id": user_id, "profile": public_profile(row)}


@app.get("/api/search", response_model=List[ProfileResponse])
async def search_network(
    skill: str,
    college: Optional[str] = None,
    department: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    search_term = f"%{skill}%"
    
    query = select(DBUser).filter(
        (DBUser.skills.ilike(search_term)) | 
        (DBUser.name.ilike(search_term)) |
        (DBUser.id.in_(
            select(DBProject.user_id).filter(
                (DBProject.tech_stack.ilike(search_term)) |
                (DBProject.description.ilike(search_term)) |
                (DBProject.title.ilike(search_term))
            )
        ))
    )
    
    if college:
        query = query.filter(DBUser.college_name == college)
    if department:
        query = query.filter(DBUser.department == department)
        
    result = await db.execute(query)
    return result.scalars().all()


@app.get("/api/tags")
async def get_tags(q: str = "", db: AsyncSession = Depends(get_db)):
    base_skills = {"Python", "JavaScript", "React", "Node.js", "FastAPI", "C++", "Java", "Machine Learning", "UI/UX", "Docker"}
    
    u_res = await db.execute(select(DBUser.skills))
    for u in u_res.scalars().all():
        if u:
            for s in u.split(','):
                if s.strip(): base_skills.add(s.strip().title())
                
    p_res = await db.execute(select(DBProject.tech_stack))
    for p in p_res.scalars().all():
        if p:
            for s in p.split(','):
                if s.strip(): base_skills.add(s.strip().title())
                
    all_skills = list(base_skills)
    
    if not q: 
        return sorted(all_skills)[:30]
        
    matched = [skill for skill in all_skills if q.lower() in skill.lower()]
    return sorted(matched)

# The first group whose words appear in an action's name is its category
HISTORY_CATEGORIES = (
    ("Network", ("follow", "connection", "bookmark", "saved")),
    ("Messages", ("message", "chat")),
    ("Board", ("opportunit", "post", "applied")),
    ("Teams", ("team", "workspace", "channel", "member", "task")),
    ("Profile", ("profile", "project", "portfolio", "github")),
    ("Account", ("account", "session", "admin", "appeal", "announcement")),
)
HISTORY_PAGE = 100

def history_category(action: Optional[str]) -> str:
    lowered = (action or "").lower()
    for name, words in HISTORY_CATEGORIES:
        if any(word in lowered for word in words):
            return name
    return "Other"


@app.get("/api/history")
async def get_history(
    before: Optional[int] = None,
    limit: int = HISTORY_PAGE,
    current_user_id: int = Depends(get_current_user_id)
):
    """One page of the viewer's activity log, newest first, with how many entries each category holds."""
    limit = max(1, min(limit, 500))
    page_query = select(DBHistory.id, DBHistory.time, DBHistory.action, DBHistory.detail).where(DBHistory.user_id == current_user_id)
    if before:
        page_query = page_query.where(DBHistory.id < before)
    rows, action_counts = await asyncio.gather(
        fetch_one_off(page_query.order_by(DBHistory.id.desc()).limit(limit + 1)),
        fetch_one_off(select(DBHistory.action, func.count()).where(DBHistory.user_id == current_user_id).group_by(DBHistory.action)),
    )
    counts: dict = {}
    for action, count in action_counts:
        category = history_category(action)
        counts[category] = counts.get(category, 0) + count
    return {
        "items": [
            {"id": row.id, "time": row.time or "", "action": row.action or "", "detail": row.detail or "", "category": history_category(row.action)}
            for row in rows[:limit]
        ],
        "has_more": len(rows) > limit,
        "counts": counts,
        "total": sum(counts.values()),
    }


@app.delete("/api/history")
async def clear_history(db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Clear the viewer's activity log. The sign-up entry stays: the admin growth chart is built from it."""
    removed = await db.execute(
        delete(DBHistory).where(DBHistory.user_id == current_user_id, DBHistory.action != "Account Created").returning(DBHistory.id)
    )
    return {"removed": len(removed.all())}


@app.post("/api/history")
async def manual_log_history(
    action_type: str, 
    detail: str, 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    await log_user_activity(db, current_user.id, action_type, detail)
    return {"status": "Logged"}


# ==========================================
# 6. LIVE WEBSOCKETS & MESSAGING
# ==========================================
MAX_MESSAGE_LENGTH = 5000
CALL_SIGNAL_TYPES = {"call_offer", "call_answer", "call_ice", "call_end", "call_decline", "call_busy", "call_taken"}
chat_background_tasks: set = set()

def spawn_background(coroutine):
    """Run a coroutine without blocking the WebSocket loop, keeping a reference so it is not garbage collected."""
    task = asyncio.create_task(coroutine)
    chat_background_tasks.add(task)
    task.add_done_callback(chat_background_tasks.discard)

def serialize_message(message: DBMessage) -> dict:
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "timestamp": message.timestamp,
        "message_status": message.message_status or "sent"
    }

# Older messages stored whole images and recordings inside the text. Listings send a short
# reference instead, and the browser fetches the media once from /api/messages/{id}/media.
INLINE_CONTENT_LIMIT = 20000
INLINE_MEDIA_PATTERN = re.compile(r"data:(image|audio|video)/([\w.+-]+)")

def message_listing_columns():
    is_oversized = func.length(DBMessage.content) > INLINE_CONTENT_LIMIT
    return [
        DBMessage.id, DBMessage.sender_id, DBMessage.receiver_id, DBMessage.timestamp, DBMessage.message_status,
        case((is_oversized, func.left(DBMessage.content, 300)), else_=DBMessage.content).label("content"),
        case((is_oversized, 1), else_=0).label("oversized")
    ]

def serialize_message_row(row) -> dict:
    content = row.content or ""
    if row.oversized:
        media = INLINE_MEDIA_PATTERN.search(content)
        if media and media.group(1) == "image":
            content = f"[IMAGE|/api/messages/{row.id}/media|photo.{media.group(2)}]"
        elif media and media.group(1) == "video":
            content = f"[VIDEO|/api/messages/{row.id}/media|video.{media.group(2)}]"
        elif media:
            content = f"[FILE|/api/messages/{row.id}/media|voice-memo.{media.group(2)}|]"
        else:
            content = content + "…"
    return {
        "id": row.id,
        "sender_id": row.sender_id,
        "receiver_id": row.receiver_id,
        "content": content,
        "timestamp": row.timestamp,
        "message_status": row.message_status or "sent"
    }

def user_card(user: Optional[DBUser], user_id: int) -> dict:
    """The small set of profile fields the chat UI needs for a contact."""
    return {
        "id": user_id,
        "name": user.name if user else f"User #{user_id}",
        "profile_pic": (user.profile_pic if user else "") or "",
        "college_name": (user.college_name if user else "") or "",
        "department": (user.department if user else "") or "",
        "skills": (user.skills if user else "") or ""
    }

def is_user_online(user_id: int) -> bool:
    """Online means connected on the Messages page or on the Teams page."""
    return chat_manager.is_online(user_id) or team_hub.has_user(user_id)

def all_online_user_ids() -> list:
    return sorted(set(chat_manager.get_online_user_ids()) | team_hub.user_ids())

async def broadcast_presence(user_id: int, online: bool):
    payload = json.dumps({"type": "presence", "user_id": user_id, "online": online})
    for other_id in chat_manager.get_online_user_ids():
        if other_id != user_id:
            await chat_manager.send_personal_message(payload, other_id)
    await team_hub.broadcast_everywhere(payload)
    await notification_manager.broadcast(payload)   # Discover pages


@app.websocket("/api/ws/{user_id}")
async def chat_websocket_endpoint(websocket: WebSocket, user_id: int):
    if get_websocket_user_id(websocket) != user_id:
        await websocket.close(code=1008)
        return
    was_online = is_user_online(user_id)
    await chat_manager.connect(websocket, user_id)
    spawn_background(_on_chat_connect(user_id, announce=not was_online))
    send_lock = asyncio.Lock()
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")

                # Handle typing indicator
                if msg_type == "typing":
                    target_id = msg.get("to")
                    if target_id:
                        await chat_manager.send_personal_message(json.dumps({
                            "type": "typing",
                            "from": user_id,
                            "typing": msg.get("typing", False)
                        }), int(target_id))

                # Handle instant direct chat message via WebSocket
                elif msg_type == "chat_message":
                    target_id = int(msg.get("to"))
                    content = (msg.get("content") or "").strip()
                    temp_id = msg.get("temp_id")
                    if not content or not target_id:
                        continue

                    # Deliver in the background so the WebSocket loop is never blocked.
                    # The lock keeps this sender's messages in the order they were sent.
                    spawn_background(_deliver_chat_message(send_lock, user_id, target_id, content, temp_id))

                # Call signalling: the server only relays, media flows directly between the two browsers
                elif msg_type in CALL_SIGNAL_TYPES:
                    target_id = int(msg.get("to"))
                    payload = {key: value for key, value in msg.items() if key != "to"}
                    payload["from"] = user_id
                    if msg_type == "call_offer":
                        spawn_background(_relay_call_offer(user_id, target_id, payload))
                    else:
                        await chat_manager.send_personal_message(json.dumps(payload), target_id)

            except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
                pass
    except WebSocketDisconnect:
        pass
    finally:
        chat_manager.disconnect(websocket, user_id)
        if not is_user_online(user_id):
            await broadcast_presence(user_id, False)


async def _on_chat_connect(user_id: int, announce: bool):
    """Messages that were waiting for this user are now delivered: update them and tell their senders."""
    rows = []
    try:
        async with SessionLocal() as db:
            result = await db.execute(
                update(DBMessage)
                .where(DBMessage.receiver_id == user_id, DBMessage.message_status == "sent")
                .values(message_status="delivered")
                .returning(DBMessage.id, DBMessage.sender_id)
            )
            rows = result.all()
            await db.commit()
    except Exception as e:
        print("Error marking messages delivered:", e)

    by_sender: dict[int, list] = {}
    for message_id, sender_id in rows:
        by_sender.setdefault(sender_id, []).append(message_id)
    for sender_id, message_ids in by_sender.items():
        await chat_manager.send_personal_message(json.dumps({
            "type": "delivered_receipt",
            "receiver_id": user_id,
            "message_ids": message_ids
        }), sender_id)

    if announce:
        await broadcast_presence(user_id, True)


async def _relay_call_offer(caller_id: int, callee_id: int, payload: dict):
    """Forward a call offer unless the two users cannot message each other or the callee is offline."""
    reason = None
    try:
        async with SessionLocal() as db:
            reason, _ = await get_messaging_rules(db, caller_id, callee_id)
    except Exception as e:
        print("Error checking call rules:", e)
        reason = "Call could not be started."
    if not reason and not chat_manager.is_online(callee_id):
        reason = "User is offline."
    if reason:
        await chat_manager.send_personal_message(json.dumps({
            "type": "call_unavailable",
            "from": callee_id,
            "call_id": payload.get("call_id"),
            "detail": reason
        }), caller_id)
        return
    await chat_manager.send_personal_message(json.dumps(payload), callee_id)


messaging_rules_cache: dict = {}

async def get_messaging_rules(db: AsyncSession, sender_id: int, receiver_id: int):
    """Returns (reason the message must be refused or None, whether the receiver has muted the sender)."""
    key = (sender_id, receiver_id)
    if key in messaging_rules_cache:
        return messaging_rules_cache[key]

    blocks = select(literal("block").label("kind"), DBBlockedUser.user_id.label("owner_id")).where(or_(
        and_(DBBlockedUser.user_id == receiver_id, DBBlockedUser.blocked_user_id == sender_id),
        and_(DBBlockedUser.user_id == sender_id, DBBlockedUser.blocked_user_id == receiver_id)
    ))
    mutes = select(literal("mute"), DBMutedUser.user_id).where(
        DBMutedUser.user_id == receiver_id,
        DBMutedUser.muted_user_id == sender_id
    )
    rows = (await db.execute(blocks.union_all(mutes))).all()

    refusal = None
    if any(kind == "block" and owner_id == receiver_id for kind, owner_id in rows):
        refusal = "You are blocked by this user."
    elif any(kind == "block" for kind, owner_id in rows):
        refusal = "You have blocked this user."
    rules = (refusal, refusal is None and any(kind == "mute" for kind, owner_id in rows))

    # Block and mute changes go through this server, which clears the cache when they happen
    if len(messaging_rules_cache) > 5000:
        messaging_rules_cache.clear()
    messaging_rules_cache[key] = rules
    return rules


class MessageRefused(Exception):
    pass


async def store_message(sender_id: int, receiver_id: int, content: str):
    """Check the rules and save a direct message. Returns (message dict, receiver has muted sender)."""
    if len(content) > MAX_MESSAGE_LENGTH:
        raise MessageRefused(f"Message is too long. The limit is {MAX_MESSAGE_LENGTH} characters.")
    async with AutocommitSession() as db:
        refusal, is_muted = await get_messaging_rules(db, sender_id, receiver_id)
        if refusal:
            raise MessageRefused(refusal)
        if (sender_id, receiver_id) not in KNOWN_CONVERSATIONS:
            await check_new_conversation(db, sender_id, receiver_id)
        new_msg = DBMessage(
            sender_id=sender_id,
            receiver_id=receiver_id,
            content=content,
            timestamp=utc_now_iso(),
            message_status="delivered" if chat_manager.is_online(receiver_id) else "sent"
        )
        db.add(new_msg)
        await db.flush()
        return serialize_message(new_msg), is_muted


async def create_notification(user_id: int, notif_type: str, content: str, timestamp: str, link: str = ""):
    """Save a bell notification and push it to the user if they are online. Meant to run in the background.
    link is the page the notification opens when clicked."""
    try:
        async with AutocommitSession() as db:
            notif = DBNotification(user_id=user_id, type=notif_type, content=content, timestamp=timestamp, link=link, is_read=0)
            db.add(notif)
            await db.flush()
        await notification_manager.send_personal_message(json.dumps({
            "id": notif.id,
            "type": notif.type,
            "content": notif.content,
            "timestamp": notif.timestamp,
            "link": link,
            "is_read": 0
        }), user_id)
    except Exception as e:
        print("Error creating notification:", e)


async def notify_new_message(receiver_id: int, timestamp: str, sender_id: int):
    """Bell notification for a new message. Runs after delivery so it never delays the message itself."""
    await create_notification(receiver_id, "message", "New message", timestamp, f"inbox.html?user={sender_id}")


async def _deliver_chat_message(send_lock: asyncio.Lock, sender_id: int, receiver_id: int, content: str, temp_id: str):
    """Check, persist and deliver a real-time WebSocket message, then acknowledge it to the sender."""
    async with send_lock:
        try:
            message, is_muted = await store_message(sender_id, receiver_id, content)
        except MessageRefused as refusal:
            await chat_manager.send_personal_message(json.dumps({
                "type": "message_failed",
                "temp_id": temp_id,
                "detail": str(refusal)
            }), sender_id)
            return
        except Exception as e:
            print("Error persisting websocket message:", e)
            await chat_manager.send_personal_message(json.dumps({
                "type": "message_failed",
                "temp_id": temp_id,
                "detail": "Message could not be saved."
            }), sender_id)
            return

        # Only deliver once the message is safely stored
        await chat_manager.send_personal_message(json.dumps({**message, "temp_id": temp_id, "muted": is_muted}), receiver_id)
        await chat_manager.send_personal_message(json.dumps({
            "type": "message_ack",
            "temp_id": temp_id,
            "id": message["id"],
            "receiver_id": receiver_id,
            "timestamp": message["timestamp"],
            "message_status": message["message_status"]
        }), sender_id)
        if not is_muted:
            spawn_background(notify_new_message(receiver_id, message["timestamp"], sender_id))


@app.post("/api/messages", response_model=MessageResponse)
async def send_message(msg: MessageCreate, current_user_id: int = Depends(get_current_user_id)):
    if current_user_id != msg.sender_id:
        raise HTTPException(status_code=403, detail="Not authorized to send as this user.")
    content = msg.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message is empty.")

    try:
        message, is_muted = await store_message(current_user_id, msg.receiver_id, content)
    except MessageRefused as refusal:
        raise HTTPException(status_code=403, detail=str(refusal))

    # Broadcast to receiver immediately
    await chat_manager.send_personal_message(json.dumps({**message, "temp_id": msg.temp_id, "muted": is_muted}), msg.receiver_id)
    if not is_muted:
        spawn_background(notify_new_message(msg.receiver_id, message["timestamp"], current_user_id))
    return message

@app.delete("/api/messages/{msg_id}")
async def delete_personal_message(msg_id: int, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    result = await db.execute(select(DBMessage).filter(DBMessage.id == msg_id))
    msg = result.scalars().first()
    if not msg:
        return {"status": "deleted"}
    if msg.sender_id != current_user_id:
        raise HTTPException(status_code=403, detail="You can only delete messages you sent.")

    sender_id, receiver_id = msg.sender_id, msg.receiver_id
    await db.execute(delete(DBMessage).where(DBMessage.id == msg_id))
    await db.commit()

    # Remove it live from both sides
    event = json.dumps({"type": "message_deleted", "id": msg_id, "sender_id": sender_id, "receiver_id": receiver_id})
    for user_id in {sender_id, receiver_id}:
        await chat_manager.send_personal_message(event, user_id)
    return {"status": "deleted"}


def cleared_boundary(owner_id: int, other_id):
    """Scalar subquery: the highest message id that owner_id has cleared in the chat with other_id (0 if none)."""
    return func.coalesce(
        select(func.max(DBClearedChat.cleared_up_to_id))
        .where(DBClearedChat.user_id == owner_id, DBClearedChat.cleared_with_user_id == other_id)
        .scalar_subquery(),
        0
    )


@app.get("/api/conversations")
async def get_conversations(db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """One row per person the user has chatted with: their card, the last message and the unread count."""
    other_id = case((DBMessage.sender_id == current_user_id, DBMessage.receiver_id), else_=DBMessage.sender_id)
    mine = (
        select(
            DBMessage.id.label("id"),
            other_id.label("other_id"),
            DBMessage.receiver_id.label("receiver_id"),
            DBMessage.message_status.label("message_status")
        )
        .where(or_(DBMessage.sender_id == current_user_id, DBMessage.receiver_id == current_user_id))
        .subquery()
    )
    is_unread = and_(
        mine.c.receiver_id == current_user_id,
        or_(mine.c.message_status.is_(None), mine.c.message_status != "read")
    )
    summary = (
        select(
            mine.c.other_id.label("other_id"),
            func.max(mine.c.id).label("last_id"),
            func.sum(case((is_unread, 1), else_=0)).label("unread")
        )
        .select_from(mine)
        .outerjoin(DBClearedChat, and_(
            DBClearedChat.user_id == current_user_id,
            DBClearedChat.cleared_with_user_id == mine.c.other_id
        ))
        .where(mine.c.id > func.coalesce(DBClearedChat.cleared_up_to_id, 0))
        .group_by(mine.c.other_id)
        .subquery()
    )
    query = (
        select(
            summary.c.other_id.label("contact_id"),
            summary.c.unread,
            DBArchivedChat.id.label("archived_id"),
            DBProChat.id.label("pro_id"),
            DBUser.name.label("contact_name"),
            DBUser.profile_pic, DBUser.college_name, DBUser.department, DBUser.skills,
            *message_listing_columns()
        )
        .join(DBMessage, DBMessage.id == summary.c.last_id)
        .outerjoin(DBUser, DBUser.id == summary.c.other_id)
        .outerjoin(DBArchivedChat, and_(
            DBArchivedChat.user_id == current_user_id,
            DBArchivedChat.archived_user_id == summary.c.other_id
        ))
        .outerjoin(DBProChat, and_(
            DBProChat.user_a == func.least(summary.c.other_id, current_user_id),
            DBProChat.user_b == func.greatest(summary.c.other_id, current_user_id)
        ))
        .order_by(summary.c.last_id.desc())
    )
    result = await db.execute(query)

    conversations = {}
    for row in result.all():
        if row.contact_id in conversations:
            continue
        conversations[row.contact_id] = {
            "id": row.contact_id,
            "name": row.contact_name or f"User #{row.contact_id}",
            "profile_pic": row.profile_pic or "",
            "college_name": row.college_name or "",
            "department": row.department or "",
            "skills": row.skills or "",
            "last_message": serialize_message_row(row),
            "unread": int(row.unread or 0),
            "archived": row.archived_id is not None,
            "pro": row.pro_id is not None
        }
    return list(conversations.values())


@app.get("/api/messages/with/{contact_id}")
async def get_conversation_messages(
    contact_id: int,
    before_id: Optional[int] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """One page of a conversation, oldest first. Pass the oldest id you hold as before_id to load earlier messages."""
    limit = max(1, min(limit, 100))
    query = select(*message_listing_columns()).filter(
        or_(
            and_(DBMessage.sender_id == current_user_id, DBMessage.receiver_id == contact_id),
            and_(DBMessage.sender_id == contact_id, DBMessage.receiver_id == current_user_id)
        ),
        DBMessage.id > cleared_boundary(current_user_id, contact_id)
    )
    if before_id:
        query = query.filter(DBMessage.id < before_id)
    result = await db.execute(query.order_by(DBMessage.id.desc()).limit(limit + 1))
    rows = result.all()
    has_more = len(rows) > limit
    return {
        "messages": [serialize_message_row(row) for row in reversed(rows[:limit])],
        "has_more": has_more
    }


LEGACY_MEDIA_CACHE_DIR = "media_cache"

@app.get("/api/messages/{msg_id}/media")
async def get_inline_message_media(msg_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Serve the image or recording embedded in an older message.

    Pulling a multi-megabyte row from the database takes many seconds, so the decoded file is kept
    on disk after the first request. The folder is not public: every request is still checked here.
    """
    result = await db.execute(select(DBMessage.sender_id, DBMessage.receiver_id).filter(DBMessage.id == msg_id))
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found.")
    if current_user_id not in (row.sender_id, row.receiver_id):
        raise HTTPException(status_code=403, detail="Not authorized to view this message.")

    headers = {"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}
    os.makedirs(LEGACY_MEDIA_CACHE_DIR, exist_ok=True)
    cached = [name for name in os.listdir(LEGACY_MEDIA_CACHE_DIR) if name.startswith(f"{msg_id}.") and not name.endswith(".tmp")]
    if cached:
        kind, subtype = cached[0].split(".", 2)[1:]
        return FileResponse(f"{LEGACY_MEDIA_CACHE_DIR}/{cached[0]}", media_type=f"{kind}/{subtype}", headers=headers)

    content = (await db.execute(select(DBMessage.content).filter(DBMessage.id == msg_id))).scalar() or ""
    media = re.search(r"data:(image|audio|video)/([\w.+-]+)(?:;[\w=.-]+)*;base64,([A-Za-z0-9+/=\s]+)", content)
    if not media or "svg" in media.group(2):
        raise HTTPException(status_code=404, detail="This message has no media.")
    try:
        data = base64.b64decode(media.group(3))
    except ValueError:
        raise HTTPException(status_code=404, detail="This message's media is damaged.")

    # Written under a temporary name first so a half-written file is never served
    final_path = f"{LEGACY_MEDIA_CACHE_DIR}/{msg_id}.{media.group(1)}.{media.group(2)}"
    temp_path = f"{final_path}.{uuid.uuid4().hex[:8]}.tmp"
    with open(temp_path, "wb") as buffer:
        buffer.write(data)
    os.replace(temp_path, final_path)
    return Response(content=data, media_type=f"{media.group(1)}/{media.group(2)}", headers=headers)


@app.get("/api/messages/{user_id}", response_model=List[MessageResponse])
async def get_messages(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    if current_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view these messages.")

    clear_res = await db.execute(select(DBClearedChat).filter(DBClearedChat.user_id == current_user_id))
    cleared_map = {rec.cleared_with_user_id: rec.cleared_up_to_id or 0 for rec in clear_res.scalars().all()}

    result = await db.execute(select(DBMessage).filter(
        (DBMessage.sender_id == user_id) | (DBMessage.receiver_id == user_id)
    ).order_by(DBMessage.id.asc()))

    filtered_msgs = []
    for msg in result.scalars().all():
        other_user = msg.sender_id if msg.receiver_id == user_id else msg.receiver_id
        if msg.id <= cleared_map.get(other_user, 0):
            continue
        filtered_msgs.append(msg)

    return filtered_msgs

# ==========================================
# 6.3 ONLINE STATUS & READ RECEIPTS
# ==========================================
@app.get("/api/users/online")
async def get_online_users(current_user_id: int = Depends(get_current_user_id)):
    """Return list of user IDs currently connected via WebSocket."""
    return {"online_user_ids": all_online_user_ids()}

@app.get("/api/users/{user_id}/online")
async def check_user_online(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Check if a specific user is online."""
    return {"user_id": user_id, "is_online": chat_manager.is_online(user_id)}

@app.get("/api/users/search")
async def search_users(q: str = "", db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Find people by name, for starting a chat or adding a group member."""
    term = q.strip()
    if not term:
        return []
    pattern = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    result = await db.execute(
        select(DBUser)
        .filter(DBUser.name.ilike(pattern, escape="\\"), DBUser.id != current_user_id)
        .order_by(DBUser.name)
        .limit(10)
    )
    return [user_card(user, user.id) for user in result.scalars().all()]

@app.get("/api/users/{user_id}/card")
async def get_user_card(user_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    result = await db.execute(select(DBUser).filter(DBUser.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return user_card(user, user.id)

@app.post("/api/messages/read/{contact_id}")
async def mark_messages_read(
    contact_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """Mark all messages from contact_id to the current user as 'read' (blue tick)."""
    result = await db.execute(
        update(DBMessage)
        .where(
            DBMessage.sender_id == contact_id,
            DBMessage.receiver_id == current_user_id,
            or_(DBMessage.message_status.is_(None), DBMessage.message_status != "read")
        )
        .values(message_status="read")
        .returning(DBMessage.id)
    )
    updated_ids = [row[0] for row in result.all()]

    # Notify the sender that their messages were read
    if updated_ids:
        await chat_manager.send_personal_message(json.dumps({
            "type": "read_receipt",
            "reader_id": current_user_id,
            "message_ids": updated_ids
        }), contact_id)

    return {"status": "ok", "updated_count": len(updated_ids)}

# ==========================================
# 6.5 CHAT ACTIONS (MUTE, BLOCK, CLEAR)
# ==========================================
@app.post("/api/users/{target_id}/mute")
async def toggle_mute(target_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    res = await db.execute(select(DBMutedUser).filter(DBMutedUser.user_id == current_user_id, DBMutedUser.muted_user_id == target_id))
    muted = res.scalars().first()
    if muted:
        await db.delete(muted)
        status = "unmuted"
    else:
        db.add(DBMutedUser(user_id=current_user_id, muted_user_id=target_id))
        status = "muted"
    await db.flush()
    messaging_rules_cache.clear()
    return {"status": status}

@app.post("/api/users/{target_id}/block")
async def toggle_block(target_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    res = await db.execute(select(DBBlockedUser).filter(DBBlockedUser.user_id == current_user_id, DBBlockedUser.blocked_user_id == target_id))
    blocked = res.scalars().first()
    if blocked:
        await db.delete(blocked)
        status = "unblocked"
    else:
        db.add(DBBlockedUser(user_id=current_user_id, blocked_user_id=target_id))
        status = "blocked"
    await db.flush()
    messaging_rules_cache.clear()
    return {"status": status}

@app.post("/api/users/{target_id}/clear_chat")
async def clear_chat(target_id: int, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    last_res = await db.execute(select(func.max(DBMessage.id)).filter(or_(
        and_(DBMessage.sender_id == current_user_id, DBMessage.receiver_id == target_id),
        and_(DBMessage.sender_id == target_id, DBMessage.receiver_id == current_user_id)
    )))
    last_id = last_res.scalar() or 0

    res = await db.execute(select(DBClearedChat).filter(DBClearedChat.user_id == current_user_id, DBClearedChat.cleared_with_user_id == target_id))
    cleared = res.scalars().first()
    now_iso = utc_now_iso()
    if cleared:
        cleared.cleared_at = now_iso
        cleared.cleared_up_to_id = last_id
    else:
        db.add(DBClearedChat(user_id=current_user_id, cleared_with_user_id=target_id, cleared_at=now_iso, cleared_up_to_id=last_id))
    await db.commit()
    return {"status": "cleared"}

@app.post("/api/users/{target_id}/archive")
async def toggle_archive(target_id: int, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    res = await db.execute(select(DBArchivedChat).filter(DBArchivedChat.user_id == current_user_id, DBArchivedChat.archived_user_id == target_id))
    archived = res.scalars().first()
    if archived:
        await db.delete(archived)
        status = "unarchived"
    else:
        db.add(DBArchivedChat(user_id=current_user_id, archived_user_id=target_id))
        status = "archived"
    await db.commit()
    return {"status": status}

@app.get("/api/chat/actions/state")
async def get_chat_actions_state(db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    muted_q = select(literal("muted").label("kind"), DBMutedUser.muted_user_id.label("target_id")).where(DBMutedUser.user_id == current_user_id)
    blocked_q = select(literal("blocked"), DBBlockedUser.blocked_user_id).where(DBBlockedUser.user_id == current_user_id)
    pro_q = (
        select(literal("pro"), case((DBProChat.user_a == current_user_id, DBProChat.user_b), else_=DBProChat.user_a))
        .where(or_(DBProChat.user_a == current_user_id, DBProChat.user_b == current_user_id))
    )
    rows = (await db.execute(muted_q.union_all(blocked_q, pro_q))).all()
    return {
        "muted": [target_id for kind, target_id in rows if kind == "muted"],
        "blocked": [target_id for kind, target_id in rows if kind == "blocked"],
        "pro": [target_id for kind, target_id in rows if kind == "pro"]
    }


@app.post("/api/pro-chats/{user_id}")
async def open_pro_chat(user_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Called when someone presses Message on the Professionals page. The conversation with that person goes to the
    Professionals section of Messages for both sides, unless the person is a student or the two already have a chat."""
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="You cannot start a chat with yourself.")
    low, high = min(user_id, current_user_id), max(user_id, current_user_id)
    row = (await db.execute(select(
        DBUser.account_type,
        DBUser.profession,
        exists().where(DBProChat.user_a == low, DBProChat.user_b == high).label("already_pro"),
        exists().where(or_(
            and_(DBMessage.sender_id == low, DBMessage.receiver_id == high),
            and_(DBMessage.sender_id == high, DBMessage.receiver_id == low)
        )).label("has_messages"),
    ).where(DBUser.id == user_id))).first()
    if not row:
        raise HTTPException(status_code=404, detail="This person is no longer on Connect2Minds.")
    if row.already_pro:
        return {"pro": True}
    if not is_professional_account(row.account_type, row.profession):
        return {"pro": False, "reason": "not_professional"}
    if row.has_messages:
        return {"pro": False, "reason": "existing_chat"}
    await check_limit(current_user_id, "pro_intros")
    await db.execute(
        pg_insert(DBProChat).values(user_a=low, user_b=high, created_at=utc_now_iso())
        .on_conflict_do_nothing(index_elements=["user_a", "user_b"])
    )
    spawn_background(bump_usage(current_user_id, "pro_intros"))
    KNOWN_CONVERSATIONS.add((current_user_id, user_id))   # the introduction is the conversation it opened
    return {"pro": True}


# ==========================================
# 7. FOLLOW, SAVED & NOTIFICATION ENDPOINTS
# ==========================================
async def get_two_names(db: AsyncSession, first_id: int, second_id: int):
    """Names of two people in one query. Either can come back as None if the account does not exist."""
    rows = (await db.execute(select(DBUser.id, DBUser.name).filter(DBUser.id.in_([first_id, second_id])))).all()
    names = {user_id: name for user_id, name in rows}
    return names.get(first_id), names.get(second_id)


@app.post("/api/save/{user_id}")
async def toggle_save_profile(
    user_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    if current_user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot save your own profile.")

    removed = await db.execute(
        delete(DBSavedProfile)
        .where(DBSavedProfile.user_id == current_user_id, DBSavedProfile.saved_user_id == user_id)
        .returning(DBSavedProfile.id)
    )
    was_saved = removed.first() is not None
    _, target_name = await get_two_names(db, current_user_id, user_id)
    if not was_saved:
        if target_name is None:
            raise HTTPException(status_code=404, detail="Developer not found.")
        db.add(DBSavedProfile(user_id=current_user_id, saved_user_id=user_id, timestamp=utc_now_iso()))
        await db.flush()

    target_name = target_name or "a developer"
    if was_saved:
        spawn_background(log_activity_later(current_user_id, "Removed Bookmark", f"Unsaved {target_name}'s profile."))
        return {"status": "unsaved"}
    spawn_background(log_activity_later(current_user_id, "Profile Saved", f"Bookmarked {target_name}'s profile."))
    return {"status": "saved"}


@app.get("/api/saved_profiles", response_model=List[ProfileResponse])
async def get_saved_profiles(
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    saved_ids = select(DBSavedProfile.saved_user_id).where(DBSavedProfile.user_id == current_user_id)
    result = await db.execute(select(*public_profile_columns()).filter(DBUser.id.in_(saved_ids)))
    return [public_profile(row) for row in result.all()]


@app.post("/api/follow/{user_id}")
async def toggle_follow(
    user_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    if current_user_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot follow yourself.")

    removed = await db.execute(
        delete(DBFollow)
        .where(DBFollow.follower_id == current_user_id, DBFollow.followed_id == user_id)
        .returning(DBFollow.id)
    )
    was_following = removed.first() is not None
    my_name, target_name = await get_two_names(db, current_user_id, user_id)

    if was_following:
        spawn_background(log_activity_later(current_user_id, "Unfollowed Connection", f"You stopped following {target_name or 'a developer'}."))
        spawn_background(broadcast_directory({"type": "follow_changed", "follower_id": current_user_id, "followed_id": user_id, "following": False}))
        return {"status": "unfollowed"}

    if target_name is None:
        raise HTTPException(status_code=404, detail="Developer not found.")
    now_iso = utc_now_iso()
    db.add(DBFollow(follower_id=current_user_id, followed_id=user_id, timestamp=now_iso))
    await db.flush()

    spawn_background(log_activity_later(current_user_id, "New Connection", f"You started following {target_name}."))
    spawn_background(create_notification(user_id, "follow", f"{my_name} started following you!", now_iso, f"profile.html?id={current_user_id}"))
    spawn_background(broadcast_directory({"type": "follow_changed", "follower_id": current_user_id, "followed_id": user_id, "following": True}))
    return {"status": "followed"}


async def list_connections(db: AsyncSession, id_query, viewer_id: int) -> list:
    """Public profiles for a set of user ids, each with whether the viewer follows that person."""
    viewer_follow = aliased(DBFollow)
    result = await db.execute(
        select(*public_profile_columns(), viewer_follow.id.label("viewer_follow_id"))
        .outerjoin(viewer_follow, and_(viewer_follow.follower_id == viewer_id, viewer_follow.followed_id == DBUser.id))
        .filter(DBUser.id.in_(id_query))
        .order_by(DBUser.name)
    )
    people = []
    for row in result.all():
        person = public_profile(row)
        person["is_following"] = row.viewer_follow_id is not None
        people.append(person)
    return people


@app.get("/api/users/{user_id}/followers")
async def get_followers(
    user_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    return await list_connections(db, select(DBFollow.follower_id).where(DBFollow.followed_id == user_id), current_user_id)


@app.get("/api/users/{user_id}/following")
async def get_following(
    user_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    return await list_connections(db, select(DBFollow.followed_id).where(DBFollow.follower_id == user_id), current_user_id)


@app.websocket("/api/ws/notifications/{user_id}")
async def notification_websocket_endpoint(websocket: WebSocket, user_id: int):
    if get_websocket_user_id(websocket) != user_id:
        await websocket.close(code=1008)
        return
    await notification_manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        notification_manager.disconnect(websocket, user_id)


NOTIFICATIONS_SHOWN = 50

@app.get("/api/notifications")
async def get_my_notifications(current_user_id: int = Depends(get_current_user_id)):
    """The newest bell notifications and how many are unread, for the header panel on every page."""
    rows, unread = await asyncio.gather(
        fetch_one_off(
            select(DBNotification.id, DBNotification.type, DBNotification.content, DBNotification.is_read,
                   DBNotification.timestamp, DBNotification.link)
            .where(DBNotification.user_id == current_user_id)
            .order_by(DBNotification.id.desc())
            .limit(NOTIFICATIONS_SHOWN)
        ),
        fetch_one_off(
            select(func.count()).select_from(DBNotification)
            .where(DBNotification.user_id == current_user_id, func.coalesce(DBNotification.is_read, 0) == 0)
        ),
    )
    return {
        "items": [
            {"id": row.id, "type": row.type or "", "content": row.content or "", "is_read": 1 if row.is_read else 0,
             "timestamp": row.timestamp or "", "link": row.link or ""}
            for row in rows
        ],
        "unread_count": unread[0][0] or 0,
    }


class NotificationsRead(BaseModel):
    ids: Optional[List[int]] = None
    all: bool = False

@app.post("/api/notifications/read")
async def mark_notifications_read(
    marked: NotificationsRead,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """Mark some or all of the viewer's notifications as read, in one statement."""
    statement = update(DBNotification).where(DBNotification.user_id == current_user_id, func.coalesce(DBNotification.is_read, 0) == 0)
    if not marked.all:
        ids = (marked.ids or [])[:500]
        if not ids:
            raise HTTPException(status_code=400, detail="Nothing to mark as read.")
        statement = statement.where(DBNotification.id.in_(ids))
    result = await db.execute(statement.values(is_read=1).returning(DBNotification.id))
    return {"marked": len(result.all())}


@app.delete("/api/notifications/{notif_id}")
async def delete_notification(
    notif_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    await db.execute(delete(DBNotification).where(DBNotification.id == notif_id, DBNotification.user_id == current_user_id))
    return {"status": "deleted"}


@app.get("/api/notifications/{user_id}", response_model=List[NotificationResponse])
async def get_notifications(
    user_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view notifications.")
        
    result = await db.execute(select(DBNotification).filter(DBNotification.user_id == user_id).order_by(DBNotification.id.desc()))
    return result.scalars().all()


@app.put("/api/notifications/{notif_id}/read")
async def mark_notification_read(
    notif_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBNotification).filter(DBNotification.id == notif_id))
    notif = result.scalars().first()
    if notif and notif.user_id == current_user.id:
        notif.is_read = 1
        await db.commit()
    return {"status": "success"}


# ==========================================
# 8. IMAGE & PROJECT UPLOADS
# ==========================================
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}
CHAT_FILE_EXTENSIONS = IMAGE_EXTENSIONS | {
    "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip", "rar", "json",
}
# Source files are stored as .txt so the browser never executes them from our origin
CODE_FILE_EXTENSIONS = {"html", "htm", "css", "js", "py"}

def save_upload(file: UploadFile, directory: str, basename: str, allowed_extensions: set, max_bytes: int) -> str:
    """Validate an upload by extension and size, write it to disk and return its path."""
    extension = os.path.splitext(file.filename or "")[1].lower().lstrip(".")
    if extension in CODE_FILE_EXTENSIONS and "txt" in allowed_extensions:
        extension = f"{extension}.txt"
    elif extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"File type '.{extension}' is not allowed.")

    os.makedirs(directory, exist_ok=True)
    file_location = f"{directory}/{basename}.{extension}"
    size = 0
    with open(file_location, "wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                break
            buffer.write(chunk)
    if size > max_bytes:
        os.remove(file_location)
        raise HTTPException(status_code=413, detail=f"File is too large. The limit is {max_bytes // (1024 * 1024)} MB.")
    return file_location

def upload_url(request: Request, file_location: str) -> str:
    return f"{str(request.base_url).rstrip('/')}/{file_location}"


def versioned_upload_url(request: Request, file_location: str) -> str:
    """Profile and banner pictures keep the same file name, so a version is added to get past the browser cache."""
    return f"{upload_url(request, file_location)}?v={int(datetime.now(timezone.utc).timestamp())}"

async def store_profile_picture(request: Request, file: UploadFile, user_id: int, kind: str, column: str, activity: str) -> str:
    file_location = save_upload(file, "static/uploads", f"user_{user_id}_{kind}", IMAGE_EXTENSIONS, MAX_IMAGE_BYTES)
    image_url = versioned_upload_url(request, file_location)
    await run_one_off(update(DBUser).where(DBUser.id == user_id).values(**{column: image_url}))
    spawn_background(log_activity_later(user_id, "Profile Updated", activity))
    if column == "profile_pic":
        spawn_background(broadcast_directory({"type": "profile_updated", "profile": {"id": user_id, "profile_pic": image_url}}))
    return image_url


@app.post("/api/upload/profile-pic")
async def upload_profile_pic(
    request: Request,
    file: UploadFile = File(...),
    current_user_id: int = Depends(get_current_user_id)
):
    image_url = await store_profile_picture(request, file, current_user_id, "profile", "profile_pic", "You updated your profile picture.")
    return {"message": "Profile picture updated successfully!", "url": image_url}


@app.post("/api/upload/banner-pic")
async def upload_banner_pic(
    request: Request,
    file: UploadFile = File(...),
    current_user_id: int = Depends(get_current_user_id)
):
    image_url = await store_profile_picture(request, file, current_user_id, "banner", "banner_pic", "You updated your profile banner.")
    return {"message": "Banner picture updated successfully!", "url": image_url}


@app.post("/api/upload/project-pic")
async def upload_project_pic(
    request: Request,
    file: UploadFile = File(...),
    current_user_id: int = Depends(get_current_user_id)
):
    file_location = save_upload(file, "static/uploads", f"user_{current_user_id}_proj_{uuid.uuid4().hex[:8]}", IMAGE_EXTENSIONS, MAX_IMAGE_BYTES)

    return {"message": "Project image uploaded successfully!", "url": upload_url(request, file_location)}


@app.post("/api/upload/chat-file")
async def upload_chat_file(
    request: Request,
    file: UploadFile = File(...),
    current_user_id: int = Depends(get_current_user_id)
):
    """Upload a file (image, video, audio, document, source file) for chat messages."""
    file_location = save_upload(file, "static/uploads/chat", f"chat_{current_user_id}_{uuid.uuid4().hex[:10]}", CHAT_FILE_EXTENSIONS, MAX_CHAT_FILE_BYTES)
    
    return {
        "url": upload_url(request, file_location),
        "filename": file.filename,
        "content_type": file.content_type,
        "size": os.path.getsize(file_location)
    }


# ==========================================
# 9. PROJECT PORTFOLIO ENDPOINTS
# ==========================================
def clean_project(project: ProjectCreate, user_id: int) -> dict:
    """Trimmed, checked project fields ready to store. Raises 400 with a readable reason."""
    title = project.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Give the project a title.")
    values = {
        "title": title[:120],
        "description": (project.description or "").strip()[:2000],
        "tech_stack": ", ".join(t.strip() for t in (project.tech_stack or "").split(",") if t.strip())[:300],
    }
    for field, label in (("github_link", "GitHub link"), ("live_link", "Live link")):
        link = (getattr(project, field) or "").strip()
        if link and not re.match(r"^https?://\S+$", link):
            raise HTTPException(status_code=400, detail=f"The {label} must start with http:// or https://")
        values[field] = link[:500]
    image_url = (project.image_url or "").strip()
    if image_url and not is_own_upload(image_url, user_id, "proj"):
        raise HTTPException(status_code=400, detail="Project pictures must be uploaded, not linked from another site.")
    values["image_url"] = image_url
    return values


@app.post("/api/projects", response_model=ProjectResponse)
async def create_project(
    project: ProjectCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    new_project = DBProject(user_id=current_user_id, **clean_project(project, current_user_id))
    db.add(new_project)
    await db.flush()
    spawn_background(log_activity_later(current_user_id, "Portfolio Expanded", f"You added a new project: {new_project.title}."))
    return serialize_project(new_project)


@app.get("/api/projects/{user_id}", response_model=List[ProjectResponse])
async def get_projects(
    user_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    result = await db.execute(select(DBProject).filter(DBProject.user_id == user_id).order_by(DBProject.id.desc()))
    return [serialize_project(project) for project in result.scalars().all()]


async def explain_missing_project(db: AsyncSession, project_id: int):
    """Called when an owner-only change matched nothing: say whether the project is missing or someone else's."""
    exists = (await db.execute(select(DBProject.id).filter(DBProject.id == project_id))).first()
    if exists:
        raise HTTPException(status_code=403, detail="Not authorized to change this project.")
    raise HTTPException(status_code=404, detail="Project not found.")


@app.put("/api/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    project: ProjectCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    result = await db.execute(
        update(DBProject)
        .where(DBProject.id == project_id, DBProject.user_id == current_user_id)
        .values(**clean_project(project, current_user_id))
        .returning(DBProject)
    )
    updated = result.scalars().first()
    if not updated:
        await explain_missing_project(db, project_id)
    return serialize_project(updated)


@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    result = await db.execute(
        delete(DBProject)
        .where(DBProject.id == project_id, DBProject.user_id == current_user_id)
        .returning(DBProject.title)
    )
    row = result.first()
    if not row:
        await explain_missing_project(db, project_id)
    spawn_background(log_activity_later(current_user_id, "Project Deleted", f"You removed the project: {row[0]}."))
    return {"message": "Project deleted successfully."}

# ==========================================
# 10. OPPORTUNITIES BOARD ROUTES
# ==========================================
@app.get("/api/board/posts", response_model=List[BoardPostResponse])
async def get_board_posts(db: AsyncSession = Depends(get_db)):
    # FAST JOIN FOR BOARD POSTS
    query = (
        select(DBBoardPost, DBUser)
        .outerjoin(DBUser, DBBoardPost.author_id == DBUser.id)
        .order_by(DBBoardPost.id.desc())
    )
    result_res = await db.execute(query)
    rows = result_res.all()
    
    out = []
    for post, author in rows:
        out.append({
            "id": post.id,
            "category": post.category,
            "title": post.title,
            "description": post.description,
            "skills_required": post.skills_required,
            "created_at": post.created_at,
            "author_id": author.id if author else 0,
            "author_name": author.name if author else "Unknown",
            "author_pic": author.profile_pic if author else "",
            "author_college": author.college_name if author else ""
        })
    return out

BOARD_CATEGORIES = ("Hackathon", "Side Project", "Research / AI", "Open Source")
BOARD_FIELD_LIMITS = {"title": 120, "skills_required": 300, "description": 2000}
BOARD_NOTE_LIMIT = 500
BOARD_POST_LIMIT = 500

def board_posts_query(viewer_id: int):
    """Posts with their author, how many people applied, and whether the viewer is one of them."""
    author_pic = case((func.length(DBUser.profile_pic) > 1000, ""), else_=DBUser.profile_pic).label("author_pic")
    return (
        select(
            DBBoardPost.id, DBBoardPost.category, DBBoardPost.title, DBBoardPost.description, DBBoardPost.skills_required,
            DBBoardPost.created_at, DBBoardPost.author_id, DBBoardPost.is_urgent,
            DBBoardPost.is_sponsored, DBBoardPost.kind, DBBoardPost.sponsor_tier, DBBoardPost.sponsor_name, DBBoardPost.sponsor_url, DBBoardPost.sponsor_logo,
            DBBoardPost.prize, DBBoardPost.deadline, DBBoardPost.sponsored_until, DBBoardPost.max_team_size, DBBoardPost.winners_announced,
            DBUser.name.label("author_name"), author_pic, DBUser.college_name.label("author_college"),
            select(func.count()).select_from(DBBoardApplication).where(DBBoardApplication.post_id == DBBoardPost.id).scalar_subquery().label("applicant_count"),
            exists().where(DBBoardApplication.post_id == DBBoardPost.id, DBBoardApplication.user_id == viewer_id).label("has_applied"),
        )
        .outerjoin(DBUser, DBBoardPost.author_id == DBUser.id)
        .order_by(case((and_(DBBoardPost.is_sponsored == 1, DBBoardPost.sponsored_until >= datetime.now().date().isoformat()), 0), else_=1), DBBoardPost.id.desc())
    )

def board_card(row) -> dict:
    return {
        "id": row.id,
        "category": row.category or "",
        "title": row.title or "",
        "description": row.description or "",
        "skills_required": row.skills_required or "",
        "created_at": row.created_at or "",
        "is_urgent": bool(row.is_urgent),
        "author_id": row.author_id or 0,
        "author_name": row.author_name or "Unknown",
        "author_pic": row.author_pic or "",
        "author_college": row.author_college or "",
        "applicant_count": row.applicant_count or 0,
        "has_applied": bool(row.has_applied),
        "is_sponsored": bool(row.is_sponsored) and (row.sponsored_until or "") >= datetime.now().date().isoformat(),
        "was_sponsored": bool(row.is_sponsored),
        "kind": row.kind or "post", "sponsor_tier": row.sponsor_tier or "", "sponsor_name": row.sponsor_name or "", "sponsor_url": row.sponsor_url or "",
        "sponsor_logo": row.sponsor_logo or "", "prize": row.prize or "", "deadline": row.deadline or "", "max_team_size": row.max_team_size or 1,
        "winners_announced": bool(row.winners_announced),
    }

def public_board_card(card: dict) -> dict:
    """A post as sent to everyone's open board: whether *they* applied is theirs to know, not the sender's."""
    return {key: value for key, value in card.items() if key != "has_applied"}

def clean_board_post(post_data: BoardPostCreate) -> dict:
    if post_data.category not in BOARD_CATEGORIES:
        raise HTTPException(status_code=400, detail="Pick one of the listed categories.")
    values = {"category": post_data.category, "is_urgent": 1 if post_data.is_urgent else 0}
    for field, limit in BOARD_FIELD_LIMITS.items():
        value = (getattr(post_data, field) or "").strip()
        label = field.replace("_required", "").capitalize()
        if not value:
            raise HTTPException(status_code=400, detail=f"{label} cannot be empty.")
        if len(value) > limit:
            raise HTTPException(status_code=400, detail=f"{label} is too long. The limit is {limit} characters.")
        values[field] = value
    values["skills_required"] = ", ".join(skill.strip() for skill in values["skills_required"].split(",") if skill.strip())
    return values

async def load_board_card(post_id: int, viewer_id: int) -> Optional[dict]:
    rows = await fetch_one_off(board_posts_query(viewer_id).where(DBBoardPost.id == post_id))
    return board_card(rows[0]) if rows else None

async def broadcast_applicant_count(post_id: int):
    """Tell every open board how many people have applied to a post now. Meant to run in the background."""
    try:
        rows = await fetch_one_off(select(func.count()).select_from(DBBoardApplication).where(DBBoardApplication.post_id == post_id))
        await broadcast_directory({"type": "board_applicants_changed", "post_id": post_id, "count": rows[0][0]})
    except Exception as e:
        print("Error broadcasting applicant count:", e)


@app.get("/api/board")
async def get_board(current_user_id: int = Depends(get_current_user_id)):
    """Everything the Opportunities Board shows, in one request. Searching and filtering happen in the browser."""
    post_rows, viewer_rows = await asyncio.gather(
        fetch_one_off(board_posts_query(current_user_id).limit(BOARD_POST_LIMIT)),
        fetch_one_off(select(DBUser.is_admin).where(DBUser.id == current_user_id)),
    )
    return {
        "posts": [board_card(row) for row in post_rows],
        "viewer_is_admin": bool(viewer_rows and viewer_rows[0][0] == 1),
        "viewer_is_founder": await founder_flag(current_user_id),
        "sponsor_credits": sum(sub.credits or 0 for sub in await sponsor_credits(current_user_id)),
        "categories": list(BOARD_CATEGORIES),
    }


@app.post("/api/board/posts")
async def create_board_post(
    post_data: BoardPostCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    values = clean_board_post(post_data)
    result = await db.execute(
        DBBoardPost.__table__.insert().values(**values, author_id=current_user_id, created_at=utc_now_iso()).returning(DBBoardPost.id)
    )
    card = await load_board_card(result.scalar(), current_user_id)
    spawn_background(log_activity_later(current_user_id, "Posted Opportunity", f"You created a new {values['category']} post."))
    spawn_background(broadcast_directory({"type": "board_post_added", "post": public_board_card(card)}))
    return {"status": "success", "message": "Opportunity published successfully!", "post": card}


async def explain_missing_board_post(db: AsyncSession, post_id: int, action: str):
    exists_already = (await db.execute(select(DBBoardPost.id).where(DBBoardPost.id == post_id))).first()
    if not exists_already:
        raise HTTPException(status_code=404, detail="Post not found.")
    raise HTTPException(status_code=403, detail=f"Not authorized to {action} this post.")


@app.patch("/api/board/posts/{post_id}")
async def update_board_post(
    post_id: int,
    post_data: BoardPostCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    values = clean_board_post(post_data)
    result = await db.execute(
        update(DBBoardPost).where(DBBoardPost.id == post_id, DBBoardPost.author_id == current_user_id).values(**values).returning(DBBoardPost.id)
    )
    if not result.first():
        await explain_missing_board_post(db, post_id, "edit")
    card = await load_board_card(post_id, current_user_id)
    spawn_background(log_activity_later(current_user_id, "Post Updated", f"You edited the post: {values['title']}."))
    spawn_background(broadcast_directory({"type": "board_post_updated", "post": public_board_card(card)}))
    return {"status": "success", "post": card}


@app.delete("/api/board/posts/{post_id}")
async def delete_board_post(
    post_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    viewer_is_admin = exists().where(DBUser.id == current_user_id, DBUser.is_admin == 1)
    result = await db.execute(
        delete(DBBoardPost)
        .where(DBBoardPost.id == post_id, or_(DBBoardPost.author_id == current_user_id, viewer_is_admin))
        .returning(DBBoardPost.title)
    )
    row = result.first()
    if not row:
        await explain_missing_board_post(db, post_id, "delete")
    spawn_background(run_one_off(delete(DBBoardApplication).where(DBBoardApplication.post_id == post_id)))
    spawn_background(run_one_off(delete(DBChallengeSubmission).where(DBChallengeSubmission.post_id == post_id)))
    spawn_background(log_activity_later(current_user_id, "Post Deleted", f"You removed the post: {row[0]}."))
    spawn_background(broadcast_directory({"type": "board_post_removed", "post_id": post_id}))
    return {"message": "Post deleted successfully."}


@app.post("/api/board/posts/{post_id}/apply")
async def apply_to_board_post(
    post_id: int,
    application: BoardApplicationCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    note = (application.note or "").strip()
    if len(note) > BOARD_NOTE_LIMIT:
        raise HTTPException(status_code=400, detail=f"Your note is too long. The limit is {BOARD_NOTE_LIMIT} characters.")

    my_name = select(DBUser.name).where(DBUser.id == current_user_id).scalar_subquery()
    already = exists().where(DBBoardApplication.post_id == post_id, DBBoardApplication.user_id == current_user_id)
    post = (await db.execute(select(DBBoardPost.author_id, DBBoardPost.title, my_name, DBBoardPost.is_sponsored, already).where(DBBoardPost.id == post_id))).first()
    if not post:
        raise HTTPException(status_code=404, detail="This post is no longer on the board.")
    if post[0] == current_user_id:
        raise HTTPException(status_code=400, detail="You cannot apply to your own post.")
    counts_toward_limit = not post[3] and not post[4]   # registering for a sponsored challenge is always free
    if counts_toward_limit:
        await check_limit(current_user_id, "board_applications")

    now_iso = utc_now_iso()
    inserted = await db.execute(
        pg_insert(DBBoardApplication)
        .values(post_id=post_id, user_id=current_user_id, note=note, created_at=now_iso)
        .on_conflict_do_nothing(index_elements=["post_id", "user_id"])
        .returning(DBBoardApplication.id)
    )
    if inserted.first():
        if counts_toward_limit:
            spawn_background(bump_usage(current_user_id, "board_applications"))
        spawn_background(create_notification(post[0], "board_reply", f"{post[2] or 'Someone'} applied to your post: {post[1]}", now_iso, "board.html?mine=1"))
        spawn_background(log_activity_later(current_user_id, "Applied to Opportunity", f"You applied to: {post[1]}."))
        spawn_background(broadcast_applicant_count(post_id))
    return {"status": "applied"}


@app.delete("/api/board/posts/{post_id}/apply")
async def withdraw_board_application(
    post_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    removed = await db.execute(
        delete(DBBoardApplication)
        .where(DBBoardApplication.post_id == post_id, DBBoardApplication.user_id == current_user_id)
        .returning(DBBoardApplication.id)
    )
    if removed.first():
        spawn_background(broadcast_applicant_count(post_id))
    return {"status": "withdrawn"}


@app.get("/api/board/posts/{post_id}/applicants")
async def get_board_applicants(post_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Who applied to a post, for its author (or an admin)."""
    viewer_is_admin = select(DBUser.is_admin).where(DBUser.id == current_user_id).scalar_subquery()
    post_rows, applicant_rows = await asyncio.gather(
        fetch_one_off(select(DBBoardPost.author_id, viewer_is_admin).where(DBBoardPost.id == post_id)),
        fetch_one_off(
            select(DBBoardApplication.note, DBBoardApplication.created_at, DBUser)
            .join(DBUser, DBBoardApplication.user_id == DBUser.id)
            .where(DBBoardApplication.post_id == post_id)
            .order_by(DBBoardApplication.id.desc())
        ),
    )
    if not post_rows:
        raise HTTPException(status_code=404, detail="Post not found.")
    if post_rows[0][0] != current_user_id and post_rows[0][1] != 1:
        raise HTTPException(status_code=403, detail="Only the person who posted this can see who applied.")
    return [dict(user_card(user, user.id), note=note or "", applied_at=created_at or "") for note, created_at, user in applicant_rows]


# ==========================================
# 11. GITHUB API INTEGRATION ENDPOINT
# ==========================================
GITHUB_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
GITHUB_CACHE_SECONDS = 600
github_cache: dict = {}   # lower-case username -> (expires at, data)

def fetch_github_profile(username: str) -> dict:
    """Blocking calls to GitHub's public API. Run this in a worker thread, never directly in a request."""
    headers = {"User-Agent": "Connect2Minds-App", "Accept": "application/vnd.github+json"}

    def get_json(url: str):
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
            return json.loads(response.read().decode())

    user_data = get_json(f"https://api.github.com/users/{username}")
    repos_data = get_json(f"https://api.github.com/users/{username}/repos?sort=updated&per_page=100")

    top_repos = []
    languages = {}
    total_stars = 0
    for repo in repos_data:
        if repo.get("fork"):
            continue
        total_stars += repo.get("stargazers_count", 0)
        lang = repo.get("language")
        if lang:
            languages[lang] = languages.get(lang, 0) + 1
        top_repos.append({
            "name": repo.get("name"),
            "description": repo.get("description") or "No description provided.",
            "html_url": repo.get("html_url"),
            "stargazers_count": repo.get("stargazers_count", 0),
            "forks_count": repo.get("forks_count", 0),
            "language": lang or "Other"
        })

    return {
        "username": user_data.get("login"),
        "name": user_data.get("name"),
        "avatar_url": user_data.get("avatar_url"),
        "html_url": user_data.get("html_url"),
        "public_repos": user_data.get("public_repos", 0),
        "followers": user_data.get("followers", 0),
        "following": user_data.get("following", 0),
        "total_stars": total_stars,
        "languages": dict(sorted(languages.items(), key=lambda item: -item[1])[:6]),
        "top_repos": top_repos[:6],
        "heatmap_url": f"https://ghchart.rshah.org/{user_data.get('login') or username}"
    }


@app.get("/api/github/{username}")
async def get_github_stats(username: str, current_user_id: int = Depends(get_current_user_id)):
    username = username.strip()
    if not GITHUB_USERNAME_PATTERN.match(username):
        raise HTTPException(status_code=400, detail="That is not a valid GitHub username.")

    cached = github_cache.get(username.lower())
    if cached and cached[0] > datetime.now(timezone.utc).timestamp():
        return cached[1]

    try:
        data = await asyncio.to_thread(fetch_github_profile, username)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise HTTPException(status_code=404, detail="No GitHub account has that username.")
        if e.code in (403, 429):
            raise HTTPException(status_code=503, detail="GitHub is limiting requests right now. Please try again in a few minutes.")
        raise HTTPException(status_code=502, detail="GitHub could not be reached.")
    except Exception:
        raise HTTPException(status_code=502, detail="GitHub could not be reached.")

    if len(github_cache) > 2000:
        github_cache.clear()
    github_cache[username.lower()] = (datetime.now(timezone.utc).timestamp() + GITHUB_CACHE_SECONDS, data)
    return data


@app.put("/api/user/github")
async def update_github_username(
    github_username: str = "",
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """Connect a GitHub account by username. An empty value disconnects it."""
    username = github_username.strip().lstrip("@")
    if username and not GITHUB_USERNAME_PATTERN.match(username):
        raise HTTPException(status_code=400, detail="That is not a valid GitHub username.")
    await db.execute(update(DBUser).where(DBUser.id == current_user_id).values(github_username=username))
    return {"status": "success", "github_username": username}


# ==========================================
# 12. TEAMS & COMMUNITIES (DISCORD-STYLE)
# ==========================================
async def run_one_off(statement):
    """Run one write on its own pooled connection, so several can run at the same time."""
    async with AutocommitSession() as session:
        await session.execute(statement)

async def log_activity_later(user_id: int, action: str, detail: str):
    """Activity-history entry written in the background, so it never slows the request down."""
    try:
        await run_one_off(DBHistory.__table__.insert().values(user_id=user_id, time=utc_now_iso(), action=action, detail=detail))
    except Exception as e:
        print("Error logging activity:", e)


@app.post("/api/teams", response_model=TeamResponse)
async def create_team(
    team_data: TeamCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    name = team_data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required.")
    owned = (await db.execute(select(func.count()).select_from(DBTeam).where(DBTeam.created_by == current_user_id, func.coalesce(DBTeam.college_key, "") == ""))).scalar() or 0
    await check_limit(current_user_id, "teams", used=owned)
    now_iso = utc_now_iso()
    new_team = DBTeam(
        name=name[:80],
        description=(team_data.description or "")[:300],
        created_by=current_user_id,
        created_at=now_iso,
        avatar_url=team_data.avatar_url
    )
    db.add(new_team)
    await db.flush()

    # Every team starts with its creator as Admin, a #general channel and a voice room, so it is usable straight away
    await asyncio.gather(
        run_one_off(DBTeamMember.__table__.insert().values(team_id=new_team.id, user_id=current_user_id, role="Admin", joined_at=now_iso)),
        run_one_off(DBChannel.__table__.insert().values([
            {"team_id": new_team.id, "name": "general", "channel_type": "text", "created_at": now_iso},
            {"team_id": new_team.id, "name": "voice-lounge", "channel_type": "voice", "created_at": now_iso},
        ])),
    )
    spawn_background(log_activity_later(current_user_id, "Team Created", f"You created the team {name}."))
    return new_team


@app.get("/api/teams", response_model=List[TeamResponse])
async def get_my_teams(db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    my_team_ids = select(DBTeamMember.team_id).where(DBTeamMember.user_id == current_user_id)
    res = await db.execute(
        select(DBTeam)
        .filter(or_(DBTeam.created_by == current_user_id, DBTeam.id.in_(my_team_ids)))
        .order_by(DBTeam.id.asc())
    )
    return res.scalars().all()


TEAM_ROLES = ("Admin", "Member")

async def fetch_one_off(statement):
    """Run one read on its own pooled connection, so several can run at the same time."""
    async with AutocommitSession() as session:
        return (await session.execute(statement)).all()

def members_query(team_id: int):
    return (
        select(DBTeamMember, DBUser.name, DBUser.profile_pic)
        .outerjoin(DBUser, DBTeamMember.user_id == DBUser.id)
        .filter(DBTeamMember.team_id == team_id)
        .order_by(DBTeamMember.id.asc())
    )

def serialize_members(rows) -> list:
    return [{
        "id": m.id,
        "team_id": m.team_id,
        "user_id": m.user_id,
        "role": m.role,
        "joined_at": m.joined_at,
        "user_name": name or "Unknown",
        "user_profile_pic": profile_pic or ""
    } for m, name, profile_pic in rows]

def serialize_channel(channel: DBChannel, last_message_id=None) -> dict:
    return {"id": channel.id, "team_id": channel.team_id, "name": channel.name,
            "channel_type": channel.channel_type, "created_at": channel.created_at,
            "last_message_id": last_message_id or 0}

def channels_query(team_id: int):
    last_ids = (
        select(DBTeamMessage.channel_id.label("channel_id"), func.max(DBTeamMessage.id).label("last_id"))
        .where(DBTeamMessage.team_id == team_id)
        .group_by(DBTeamMessage.channel_id)
        .subquery()
    )
    return (
        select(DBChannel, last_ids.c.last_id)
        .outerjoin(last_ids, last_ids.c.channel_id == DBChannel.id)
        .filter(DBChannel.team_id == team_id)
        .order_by(DBChannel.id.asc())
    )

def serialize_resource(resource: DBTeamResource) -> dict:
    return {"id": resource.id, "team_id": resource.team_id, "name": resource.name, "url": resource.url,
            "added_by": resource.added_by, "created_at": resource.created_at}

def resources_query(team_id: int):
    return select(DBTeamResource).filter(DBTeamResource.team_id == team_id).order_by(DBTeamResource.id.asc())

async def get_team_role(db: AsyncSession, team_id: int, user_id: int):
    """Returns (team, role). Raises 404 if the team does not exist and 403 if the user is not in it."""
    result = await db.execute(
        select(DBTeam, DBTeamMember.role)
        .outerjoin(DBTeamMember, and_(DBTeamMember.team_id == DBTeam.id, DBTeamMember.user_id == user_id))
        .filter(DBTeam.id == team_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Team not found.")
    if row[1] is None:
        raise HTTPException(status_code=403, detail="You are not a member of this team.")
    return row[0], row[1]

async def require_team_admin(db: AsyncSession, team_id: int, user_id: int) -> DBTeam:
    team, role = await get_team_role(db, team_id, user_id)
    if role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can do this.")
    return team

async def refuse_unless_teacher(db: AsyncSession, teacher_managed, college_key: Optional[str], user_id: int):
    """A College Hub group whose members a teacher has fixed can only be changed by a teacher of that college.
    Costs nothing for ordinary teams: the extra read only happens for a fixed group."""
    if not teacher_managed:
        return
    row = (await db.execute(select(DBUser.teacher_of).where(DBUser.id == user_id))).first()
    if not row or (row[0] or "") != (college_key or ""):
        raise HTTPException(status_code=403, detail="This group is managed by your teachers. A teacher changes it in College Hub.")

async def broadcast_members(team_id: int):
    rows = await fetch_one_off(members_query(team_id))
    await team_hub.broadcast(team_id, {"type": "members", "members": serialize_members(rows)})

async def broadcast_channels(team_id: int):
    rows = await fetch_one_off(channels_query(team_id))
    await team_hub.broadcast(team_id, {"type": "channels", "channels": [serialize_channel(c, last_id) for c, last_id in rows]})

async def broadcast_resources(team_id: int):
    rows = await fetch_one_off(resources_query(team_id))
    await team_hub.broadcast(team_id, {"type": "resources", "resources": [serialize_resource(r) for (r,) in rows]})


@app.get("/api/teams/{team_id}/bootstrap")
async def get_team_bootstrap(team_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Everything the Teams page needs to open a workspace, fetched with the queries running side by side."""
    team_rows, member_rows, channel_rows, resource_rows = await asyncio.gather(
        fetch_one_off(select(DBTeam).filter(DBTeam.id == team_id)),
        fetch_one_off(members_query(team_id)),
        fetch_one_off(channels_query(team_id)),
        fetch_one_off(resources_query(team_id)),
    )
    if not team_rows:
        raise HTTPException(status_code=404, detail="Team not found.")
    members = serialize_members(member_rows)
    me = next((m for m in members if m["user_id"] == current_user_id), None)
    if not me:
        raise HTTPException(status_code=403, detail="You are not a member of this team.")
    team = team_rows[0][0]
    return {
        "team": {"id": team.id, "name": team.name, "description": team.description or "", "created_by": team.created_by,
                 "created_at": team.created_at, "avatar_url": team.avatar_url or ""},
        "role": me["role"],
        "members": members,
        "channels": [serialize_channel(c, last_id) for c, last_id in channel_rows],
        "resources": [serialize_resource(r) for (r,) in resource_rows],
        "online_user_ids": all_online_user_ids(),
        "voice": team_hub.voice_state(team_id)
    }


@app.patch("/api/teams/{team_id}")
async def update_team(team_id: int, data: TeamUpdate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    team = await require_team_admin(db, team_id, current_user_id)
    values = {}
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Team name is required.")
        values["name"] = name[:80]
    if data.description is not None:
        values["description"] = data.description.strip()[:300]
    if values:
        await db.execute(update(DBTeam).where(DBTeam.id == team_id).values(**values))
    payload = {"id": team.id, "name": values.get("name", team.name), "description": values.get("description", team.description or ""),
               "created_by": team.created_by, "created_at": team.created_at, "avatar_url": team.avatar_url or ""}
    await team_hub.broadcast(team_id, {"type": "team_updated", "team": payload})
    return payload


@app.post("/api/teams/{team_id}/members")
async def add_team_member(
    team_id: int,
    member_data: TeamMemberAdd,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    if member_data.role not in TEAM_ROLES:
        raise HTTPException(status_code=400, detail="Role must be Admin or Member.")
    # One query: the team, the caller's role in it, whether the new person exists and is already a member
    caller = aliased(DBTeamMember)
    existing = aliased(DBTeamMember)
    result = await db.execute(
        select(DBTeam.name, caller.role, existing.id, DBUser.id, DBTeam.college_key, DBTeam.teacher_managed, DBUser.college_name, DBUser.teacher_of)
        .outerjoin(caller, and_(caller.team_id == DBTeam.id, caller.user_id == current_user_id))
        .outerjoin(existing, and_(existing.team_id == DBTeam.id, existing.user_id == member_data.user_id))
        .outerjoin(DBUser, DBUser.id == member_data.user_id)
        .filter(DBTeam.id == team_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Team not found.")
    team_name, caller_role, existing_id, target_id, team_college, teacher_managed, target_college, target_teacher_of = row
    if caller_role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can add members.")
    if target_id is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if existing_id is not None:
        raise HTTPException(status_code=400, detail="User is already in the team.")
    if team_college:
        # A College Hub group: its own rules (size, one group per activity) live in College Hub, so people are added there
        await refuse_unless_teacher(db, teacher_managed, team_college, current_user_id)
        if (target_college or "").strip().lower() != team_college and (target_teacher_of or "") != team_college:
            raise HTTPException(status_code=403, detail="Only people from this college can be in a college group.")

    now_iso = utc_now_iso()
    db.add(DBTeamMember(team_id=team_id, user_id=member_data.user_id, role=member_data.role, joined_at=now_iso))
    await db.flush()

    spawn_background(create_notification(
        member_data.user_id, "team_invite",
        f"You were added to the team: {team_name} as {member_data.role}.", now_iso, "team.html"
    ))
    spawn_background(broadcast_members(team_id))
    return {"message": "Member added successfully."}


@app.patch("/api/teams/{team_id}/members/{user_id}")
async def change_member_role(team_id: int, user_id: int, data: MemberRoleUpdate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    if data.role not in TEAM_ROLES:
        raise HTTPException(status_code=400, detail="Role must be Admin or Member.")
    team = await require_team_admin(db, team_id, current_user_id)
    if user_id == team.created_by:
        raise HTTPException(status_code=400, detail="The creator of the team is always an Admin.")
    result = await db.execute(
        update(DBTeamMember).where(DBTeamMember.team_id == team_id, DBTeamMember.user_id == user_id)
        .values(role=data.role).returning(DBTeamMember.id)
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="That person is not in this team.")
    spawn_background(broadcast_members(team_id))
    return {"status": "updated", "role": data.role}


@app.delete("/api/teams/{team_id}/members/{user_id}")
async def remove_team_member(team_id: int, user_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    team = await require_team_admin(db, team_id, current_user_id)
    await refuse_unless_teacher(db, team.teacher_managed, team.college_key, current_user_id)
    if user_id == team.created_by:
        raise HTTPException(status_code=400, detail="The creator of the team cannot be removed.")
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="Use Leave to remove yourself.")
    result = await db.execute(
        delete(DBTeamMember).where(DBTeamMember.team_id == team_id, DBTeamMember.user_id == user_id).returning(DBTeamMember.id)
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="That person is not in this team.")
    await evict_from_team(team_id, user_id, "removed")
    spawn_background(broadcast_members(team_id))
    return {"status": "removed"}


async def evict_from_team(team_id: int, user_id: int, reason: str):
    """Tell a person's open Teams pages they are no longer in this team and close those connections."""
    for websocket in team_hub.sockets_of(team_id, user_id):
        try:
            await websocket.send_text(json.dumps({"type": "evicted", "team_id": team_id, "reason": reason}))
            await websocket.close(code=1000)
        except Exception:
            pass


@app.get("/api/teams/{team_id}/members", response_model=List[TeamMemberResponse])
async def get_team_members(
    team_id: int,
    db: AsyncSession = Depends(get_fast_db),
    user_id: int = Depends(get_current_user_id)
):
    # Single JOIN; the membership check is done on the result instead of with a second query
    members = serialize_members((await db.execute(members_query(team_id))).all())
    if not any(m["user_id"] == user_id for m in members):
        raise HTTPException(status_code=403, detail="You are not a member of this team.")
    return members


@app.get("/api/teams/{team_id}/channels", response_model=List[ChannelResponse])
async def get_team_channels(
    team_id: int,
    db: AsyncSession = Depends(get_fast_db),
    user_id: int = Depends(get_current_user_id)
):
    # One query: no rows means not a member, a row without a channel means a member of a team with no channels
    rows = (await db.execute(
        select(DBTeamMember.id, DBChannel)
        .outerjoin(DBChannel, DBChannel.team_id == DBTeamMember.team_id)
        .filter(DBTeamMember.team_id == team_id, DBTeamMember.user_id == user_id)
        .order_by(DBChannel.id.asc())
    )).all()
    if not rows:
        raise HTTPException(status_code=403, detail="Not a member of this team.")
    return [channel for _, channel in rows if channel is not None]


def clean_channel_name(raw: str) -> str:
    name = re.sub(r"[^a-z0-9_-]+", "-", raw.strip().lower()).strip("-")[:40]
    if not name:
        raise HTTPException(status_code=400, detail="Channel name needs at least one letter or number.")
    return name


@app.post("/api/teams/{team_id}/channels", response_model=ChannelResponse)
async def create_team_channel(
    team_id: int,
    channel_data: ChannelCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    try:
        await require_team_admin(db, team_id, current_user_id)
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail="Only Admins can create channels." if e.status_code == 403 else e.detail)
    if channel_data.channel_type not in ("text", "voice"):
        raise HTTPException(status_code=400, detail="Channel type must be text or voice.")

    new_channel = DBChannel(
        team_id=team_id,
        name=clean_channel_name(channel_data.name),
        channel_type=channel_data.channel_type,
        created_at=utc_now_iso()
    )
    db.add(new_channel)
    await db.flush()
    spawn_background(broadcast_channels(team_id))
    return new_channel


@app.patch("/api/channels/{channel_id}")
async def rename_channel(channel_id: int, data: ChannelRename, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    channel, membership = await get_channel_for_member(db, channel_id, current_user_id)
    if membership.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can rename channels.")
    name = clean_channel_name(data.name)
    await db.execute(update(DBChannel).where(DBChannel.id == channel_id).values(name=name))
    spawn_background(broadcast_channels(channel.team_id))
    return {"id": channel_id, "name": name}


@app.delete("/api/channels/{channel_id}")
async def delete_channel(channel_id: int, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    channel, membership = await get_channel_for_member(db, channel_id, current_user_id)
    if membership.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can delete channels.")
    if channel.channel_type != "voice":
        others = await db.execute(select(func.count()).select_from(DBChannel).filter(
            DBChannel.team_id == channel.team_id, DBChannel.channel_type != "voice", DBChannel.id != channel_id
        ))
        if not others.scalar():
            raise HTTPException(status_code=400, detail="A team needs at least one text channel.")

    team_id = channel.team_id
    await db.execute(delete(DBTeamMessageReaction).where(DBTeamMessageReaction.channel_id == channel_id))
    await db.execute(delete(DBTeamMessage).where(DBTeamMessage.channel_id == channel_id))
    await db.execute(delete(DBChannel).where(DBChannel.id == channel_id))
    await db.commit()
    spawn_background(broadcast_channels(team_id))
    return {"status": "deleted"}


def serialize_team_message(msg: DBTeamMessage, user: Optional[DBUser]) -> dict:
    return {
        "id": msg.id,
        "team_id": msg.team_id,
        "channel_id": msg.channel_id,
        "sender_id": msg.sender_id,
        "content": msg.content,
        "timestamp": msg.timestamp,
        "is_system_message": msg.is_system_message or 0,
        "sender_name": user.name if user else "System",
        "sender_pic": (user.profile_pic if user else "") or "",
        "is_pinned": msg.is_pinned or 0,
        "reactions": [],
        "reply_to": None
    }

def reply_preview(message_id, sender_name, content) -> Optional[dict]:
    if message_id is None:
        return None
    return {"id": message_id, "sender_name": sender_name or "Unknown", "content": (content or "")[:200]}

def group_reactions(rows) -> dict:
    """rows of (message_id, emoji, user_id) -> {message_id: [{"emoji", "user_ids"}]} in first-used order."""
    grouped: dict = {}
    for message_id, emoji, user_id in rows:
        entries = grouped.setdefault(message_id, [])
        entry = next((e for e in entries if e["emoji"] == emoji), None)
        if not entry:
            entry = {"emoji": emoji, "user_ids": []}
            entries.append(entry)
        entry["user_ids"].append(user_id)
    return grouped

async def get_channel_for_member(db: AsyncSession, channel_id: int, user_id: int):
    """Returns (channel, membership) if the user belongs to the channel's team, otherwise raises 403."""
    result = await db.execute(
        select(DBChannel, DBTeamMember)
        .join(DBTeamMember, DBTeamMember.team_id == DBChannel.team_id)
        .filter(DBChannel.id == channel_id, DBTeamMember.user_id == user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=403, detail="Not a member of this team or channel not found.")
    return row[0], row[1]

async def load_team_messages(conditions: list, limit: Optional[int], newest_first: bool = False) -> list:
    """Messages with sender, reply preview and reactions. The reactions are read at the same time as the messages."""
    parent = aliased(DBTeamMessage)
    parent_user = aliased(DBUser)
    query = (
        select(DBTeamMessage, DBUser, parent.id, parent_user.name, parent.content)
        .outerjoin(DBUser, DBTeamMessage.sender_id == DBUser.id)
        .outerjoin(parent, parent.id == DBTeamMessage.reply_to_id)
        .outerjoin(parent_user, parent_user.id == parent.sender_id)
        .filter(*conditions)
    )
    ids = select(DBTeamMessage.id).filter(*conditions)
    if limit:
        query = query.order_by(DBTeamMessage.id.desc()).limit(limit)
        ids = ids.order_by(DBTeamMessage.id.desc()).limit(limit)
    else:
        query = query.order_by(DBTeamMessage.id.asc())
    reactions_query = (
        select(DBTeamMessageReaction.message_id, DBTeamMessageReaction.emoji, DBTeamMessageReaction.user_id)
        .filter(DBTeamMessageReaction.message_id.in_(ids))
        .order_by(DBTeamMessageReaction.id.asc())
    )
    rows, reaction_rows = await asyncio.gather(fetch_one_off(query), fetch_one_off(reactions_query))
    if limit and not newest_first:
        rows = list(reversed(rows))

    reactions = group_reactions(reaction_rows)
    messages = []
    for msg, user, parent_id, parent_sender, parent_content in rows:
        item = serialize_team_message(msg, user)
        item["reactions"] = reactions.get(msg.id, [])
        item["reply_to"] = reply_preview(parent_id, parent_sender, parent_content) if msg.reply_to_id else None
        messages.append(item)
    return messages


@app.get("/api/channels/{channel_id}/messages", response_model=List[TeamMessageResponse])
async def get_channel_messages(
    channel_id: int,
    before_id: Optional[int] = None,
    limit: Optional[int] = None,
    db: AsyncSession = Depends(get_fast_db),
    user_id: int = Depends(get_current_user_id)
):
    """Channel history, oldest first. Without limit it returns everything; with limit it returns the newest page."""
    is_member = (
        select(DBTeamMember.id)
        .join(DBChannel, DBChannel.team_id == DBTeamMember.team_id)
        .where(DBChannel.id == channel_id, DBTeamMember.user_id == user_id)
        .exists()
    )
    conditions = [DBTeamMessage.channel_id == channel_id, is_member]
    if before_id:
        conditions.append(DBTeamMessage.id < before_id)
    messages = await load_team_messages(conditions, max(1, min(limit, 100)) if limit else None)

    # An empty result is either an empty channel or no access: only then pay for the explicit check
    if not messages:
        await get_channel_for_member(db, channel_id, user_id)
    return messages


@app.get("/api/channels/{channel_id}/pins", response_model=List[TeamMessageResponse])
async def get_channel_pins(channel_id: int, db: AsyncSession = Depends(get_fast_db), user_id: int = Depends(get_current_user_id)):
    await get_channel_for_member(db, channel_id, user_id)
    return await load_team_messages([DBTeamMessage.channel_id == channel_id, DBTeamMessage.is_pinned == 1], None)


@app.get("/api/channels/{channel_id}/search", response_model=List[TeamMessageResponse])
async def search_channel_messages(channel_id: int, q: str = "", db: AsyncSession = Depends(get_fast_db), user_id: int = Depends(get_current_user_id)):
    """Search the whole history of a channel by message text or sender name. Newest matches first."""
    await get_channel_for_member(db, channel_id, user_id)
    term = q.strip()
    if not term:
        return []
    pattern = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    senders = select(DBUser.id).where(DBUser.name.ilike(pattern, escape="\\"))
    return await load_team_messages([
        DBTeamMessage.channel_id == channel_id,
        or_(DBTeamMessage.is_system_message.is_(None), DBTeamMessage.is_system_message == 0),
        or_(DBTeamMessage.content.ilike(pattern, escape="\\"), DBTeamMessage.sender_id.in_(senders))
    ], 30, newest_first=True)


async def publish_team_message(payload: dict, temp_id: Optional[str] = None):
    """Send a new channel message to everyone who has the channel or its workspace open."""
    event = {**payload, "temp_id": temp_id}
    await team_chat_manager.broadcast_to_room(payload["channel_id"], json.dumps(event))
    await team_hub.broadcast(payload["team_id"], {"type": "message", "message": event})


async def post_system_message(team_id: int, channel_id: int, actor_id: int, text_content: str):
    """A notice written by the server itself, such as a call starting or ending."""
    try:
        async with AutocommitSession() as db:
            msg = DBTeamMessage(team_id=team_id, channel_id=channel_id, sender_id=actor_id, content=text_content,
                                timestamp=utc_now_iso(), is_system_message=1)
            db.add(msg)
            await db.flush()
        await publish_team_message(serialize_team_message(msg, None))
    except Exception as e:
        print("Error posting system message:", e)


@app.post("/api/channels/{channel_id}/messages", response_model=TeamMessageResponse)
async def send_channel_message(
    channel_id: int,
    msg_data: TeamMessageCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    content = msg_data.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message is empty.")
    if len(content) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=400, detail=f"Message is too long. The limit is {MAX_MESSAGE_LENGTH} characters.")

    # Membership check, the sender's name and picture, and the message being replied to, in a single query
    parent = aliased(DBTeamMessage)
    parent_user = aliased(DBUser)
    result = await db.execute(
        select(DBChannel.team_id, DBUser.name, DBUser.profile_pic, parent.id, parent_user.name, parent.content)
        .join(DBTeamMember, DBTeamMember.team_id == DBChannel.team_id)
        .join(DBUser, DBUser.id == DBTeamMember.user_id)
        .outerjoin(parent, and_(parent.id == msg_data.reply_to_id, parent.channel_id == channel_id))
        .outerjoin(parent_user, parent_user.id == parent.sender_id)
        .filter(DBChannel.id == channel_id, DBTeamMember.user_id == current_user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=403, detail="Not a member of this team or channel not found.")
    team_id, sender_name, sender_pic, parent_id, parent_sender, parent_content = row

    new_msg = DBTeamMessage(
        team_id=team_id,
        channel_id=channel_id,
        sender_id=current_user_id,
        content=content,
        timestamp=utc_now_iso(),
        is_system_message=0,
        reply_to_id=parent_id
    )
    db.add(new_msg)
    await db.flush()

    msg_payload = serialize_team_message(new_msg, None)
    msg_payload["sender_name"] = sender_name
    msg_payload["sender_pic"] = sender_pic or ""
    msg_payload["reply_to"] = reply_preview(parent_id, parent_sender, parent_content)
    # temp_id lets the sender match this broadcast to the bubble it already drew
    await publish_team_message(msg_payload, msg_data.temp_id)
    return msg_payload


@app.delete("/api/channels/{channel_id}/messages/{msg_id}")
async def delete_channel_message(
    channel_id: int,
    msg_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    channel, membership = await get_channel_for_member(db, channel_id, current_user_id)
    result = await db.execute(select(DBTeamMessage).filter(DBTeamMessage.id == msg_id, DBTeamMessage.channel_id == channel_id))
    msg = result.scalars().first()
    if not msg:
        return {"status": "deleted"}
    if msg.sender_id != current_user_id and membership.role != "Admin":
        raise HTTPException(status_code=403, detail="Only the sender or a team Admin can delete this message.")

    await db.execute(delete(DBTeamMessageReaction).where(DBTeamMessageReaction.message_id == msg_id))
    await db.delete(msg)
    await db.commit()
    event = {"type": "message_deleted", "id": msg_id, "channel_id": channel_id}
    await team_chat_manager.broadcast_to_room(channel_id, json.dumps(event))
    await team_hub.broadcast(channel.team_id, event)
    return {"status": "deleted"}


@app.post("/api/channels/{channel_id}/messages/{msg_id}/reactions")
async def toggle_reaction(channel_id: int, msg_id: int, data: ReactionToggle, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Add the emoji if this person has not used it on the message, otherwise take it off."""
    emoji = data.emoji.strip()
    # Reactions are emoji only: no letters, quotes or markup
    if not emoji or len(emoji) > 16 or any(ord(ch) < 128 for ch in emoji):
        raise HTTPException(status_code=400, detail="That is not a valid reaction.")
    result = await db.execute(
        select(DBChannel.team_id, DBTeamMessage.id)
        .join(DBTeamMember, DBTeamMember.team_id == DBChannel.team_id)
        .outerjoin(DBTeamMessage, and_(DBTeamMessage.id == msg_id, DBTeamMessage.channel_id == channel_id))
        .filter(DBChannel.id == channel_id, DBTeamMember.user_id == current_user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=403, detail="Not a member of this team or channel not found.")
    if row[1] is None:
        raise HTTPException(status_code=404, detail="Message not found.")

    removed = await db.execute(
        delete(DBTeamMessageReaction)
        .where(DBTeamMessageReaction.message_id == msg_id, DBTeamMessageReaction.user_id == current_user_id, DBTeamMessageReaction.emoji == emoji)
        .returning(DBTeamMessageReaction.id)
    )
    if not removed.first():
        db.add(DBTeamMessageReaction(message_id=msg_id, channel_id=channel_id, user_id=current_user_id, emoji=emoji))
        await db.flush()

    rows = (await db.execute(
        select(DBTeamMessageReaction.message_id, DBTeamMessageReaction.emoji, DBTeamMessageReaction.user_id)
        .filter(DBTeamMessageReaction.message_id == msg_id).order_by(DBTeamMessageReaction.id.asc())
    )).all()
    reactions = group_reactions(rows).get(msg_id, [])
    await team_hub.broadcast(row[0], {"type": "reactions", "channel_id": channel_id, "message_id": msg_id, "reactions": reactions})
    return {"reactions": reactions}


@app.post("/api/channels/{channel_id}/messages/{msg_id}/pin")
async def toggle_pin(channel_id: int, msg_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    channel, _ = await get_channel_for_member(db, channel_id, current_user_id)
    result = await db.execute(
        update(DBTeamMessage)
        .where(DBTeamMessage.id == msg_id, DBTeamMessage.channel_id == channel_id)
        .values(is_pinned=case((func.coalesce(DBTeamMessage.is_pinned, 0) == 1, 0), else_=1), pinned_by=current_user_id)
        .returning(DBTeamMessage.is_pinned)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found.")
    await team_hub.broadcast(channel.team_id, {"type": "pin", "channel_id": channel_id, "message_id": msg_id, "is_pinned": row[0]})
    return {"is_pinned": row[0]}


@app.post("/api/teams/{team_id}/resources")
async def add_team_resource(team_id: int, data: ResourceCreate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    await get_team_role(db, team_id, current_user_id)
    name, url = data.name.strip()[:100], data.url.strip()[:500]
    if not name:
        raise HTTPException(status_code=400, detail="Give the resource a name.")
    if not re.match(r"^https?://\S+$", url):
        raise HTTPException(status_code=400, detail="The link must start with http:// or https://")
    resource = DBTeamResource(team_id=team_id, name=name, url=url, added_by=current_user_id, created_at=utc_now_iso())
    db.add(resource)
    await db.flush()
    spawn_background(broadcast_resources(team_id))
    return serialize_resource(resource)


@app.delete("/api/teams/{team_id}/resources/{resource_id}")
async def delete_team_resource(team_id: int, resource_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    _, role = await get_team_role(db, team_id, current_user_id)
    result = await db.execute(select(DBTeamResource).filter(DBTeamResource.id == resource_id, DBTeamResource.team_id == team_id))
    resource = result.scalars().first()
    if not resource:
        return {"status": "deleted"}
    if resource.added_by != current_user_id and role != "Admin":
        raise HTTPException(status_code=403, detail="Only the person who added it or an Admin can remove this.")
    await db.execute(delete(DBTeamResource).where(DBTeamResource.id == resource_id))
    spawn_background(broadcast_resources(team_id))
    return {"status": "deleted"}


@app.websocket("/api/ws/channels/{channel_id}/{user_id}")
async def channel_websocket_endpoint(websocket: WebSocket, channel_id: int, user_id: int):
    if get_websocket_user_id(websocket) != user_id:
        await websocket.close(code=1008)
        return
    async with SessionLocal() as db:
        member_res = await db.execute(
            select(DBChannel)
            .join(DBTeamMember, DBTeamMember.team_id == DBChannel.team_id)
            .filter(DBChannel.id == channel_id, DBTeamMember.user_id == user_id)
        )
        if not member_res.scalars().first():
            await websocket.close(code=1008)
            return
    await team_chat_manager.connect(websocket, channel_id)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        team_chat_manager.disconnect(websocket, channel_id)


# ---- the Teams page socket: one connection per open workspace
async def leave_voice_room(team_id: int, websocket: WebSocket, user: dict):
    room = team_hub.room_of(websocket)
    if not room:
        return
    call_seconds = team_hub.leave_room(room, user["id"])
    await team_hub.broadcast(team_id, {"type": "voice_state", "voice": team_hub.voice_state(team_id)})
    await team_hub.broadcast(team_id, {"type": "voice_left", "room": room, "user_id": user["id"]})
    # A call started from a text channel leaves a note there when the last person hangs up
    if call_seconds is not None and room.startswith("call:"):
        minutes, seconds = divmod(call_seconds, 60)
        spawn_background(post_system_message(team_id, int(room.split(":")[1]), user["id"], f"📞 Call ended · {minutes}:{seconds:02d}"))


@app.websocket("/api/ws/teams/{team_id}/{user_id}")
async def team_websocket_endpoint(websocket: WebSocket, team_id: int, user_id: int):
    if get_websocket_user_id(websocket) != user_id:
        await websocket.close(code=1008)
        return
    async with AutocommitSession() as db:
        result = await db.execute(
            select(DBUser.name, DBUser.profile_pic)
            .join(DBTeamMember, DBTeamMember.user_id == DBUser.id)
            .filter(DBTeamMember.team_id == team_id, DBUser.id == user_id)
        )
        row = result.first()
        channel_rows = (await db.execute(select(DBChannel.id, DBChannel.channel_type).filter(DBChannel.team_id == team_id))).all() if row else []
    if not row:
        await websocket.close(code=1008)
        return

    user = {"id": user_id, "name": row[0], "profile_pic": row[1] or ""}
    was_online = is_user_online(user_id)
    await websocket.accept()
    team_hub.connect(team_id, websocket, user)
    await websocket.send_text(json.dumps({"type": "hello", "voice": team_hub.voice_state(team_id), "online_user_ids": all_online_user_ids()}))
    if not was_online:
        await broadcast_presence(user_id, True)

    channel_types = {channel_id: channel_type for channel_id, channel_type in channel_rows}
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")

                if msg_type == "typing":
                    await team_hub.broadcast(team_id, {
                        "type": "typing", "channel_id": int(msg.get("channel_id")),
                        "user_id": user_id, "name": user["name"], "typing": bool(msg.get("typing", True))
                    }, exclude=websocket)

                elif msg_type == "voice_join":
                    channel_id = int(msg.get("channel_id"))
                    if channel_id not in channel_types:
                        # The channel may have been created after this connection opened
                        async with AutocommitSession() as db:
                            found = (await db.execute(select(DBChannel.channel_type).filter(DBChannel.id == channel_id, DBChannel.team_id == team_id))).first()
                        if not found:
                            continue
                        channel_types[channel_id] = found[0]
                    room = f"{'voice' if channel_types[channel_id] == 'voice' else 'call'}:{channel_id}"

                    await leave_voice_room(team_id, websocket, user)
                    # The same person joining from a second tab takes over from the first
                    previous = team_hub.rooms.get(room, {}).get(user_id)
                    if previous and previous["ws"] is not websocket:
                        try:
                            await previous["ws"].send_text(json.dumps({"type": "voice_replaced", "room": room}))
                        except Exception:
                            pass
                    first = team_hub.join_room(team_id, room, websocket, user)
                    others = [uid for uid in team_hub.rooms[room] if uid != user_id]
                    await websocket.send_text(json.dumps({"type": "voice_joined", "room": room, "peers": others}))
                    await team_hub.broadcast(team_id, {"type": "voice_state", "voice": team_hub.voice_state(team_id)})
                    if first and room.startswith("call:"):
                        spawn_background(post_system_message(team_id, channel_id, user_id, f"📞 {user['name']} started a call"))

                elif msg_type == "voice_leave":
                    await leave_voice_room(team_id, websocket, user)

                elif msg_type == "voice_update":
                    room = team_hub.room_of(websocket)
                    if room:
                        member = team_hub.rooms[room][user_id]
                        for key in ("muted", "video", "sharing"):
                            if key in msg:
                                member[key] = bool(msg[key])
                        await team_hub.broadcast(team_id, {"type": "voice_state", "voice": team_hub.voice_state(team_id)})

                elif msg_type == "rtc":
                    # WebRTC set-up messages go only to another person in the same room
                    room = team_hub.room_of(websocket)
                    target = team_hub.rooms.get(room, {}).get(int(msg.get("to"))) if room else None
                    if target:
                        try:
                            await target["ws"].send_text(json.dumps({"type": "rtc", "room": room, "from": user_id, "data": msg.get("data")}))
                        except Exception:
                            pass

            except (json.JSONDecodeError, ValueError, TypeError, AttributeError, KeyError):
                pass
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass   # closed from our side, for example when the person was removed from the team
    finally:
        await leave_voice_room(team_id, websocket, user)
        team_hub.disconnect(team_id, websocket)
        if not is_user_online(user_id):
            await broadcast_presence(user_id, False)


@app.post("/api/teams/{team_id}/leave")
async def leave_team(team_id: int, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    team_res = await db.execute(select(DBTeam).filter(DBTeam.id == team_id))
    team = team_res.scalars().first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
    if team.created_by == current_user_id:
        raise HTTPException(status_code=400, detail="You created this team, so you cannot leave it. Delete it instead.")
    await refuse_unless_teacher(db, team.teacher_managed, team.college_key, current_user_id)

    await db.execute(delete(DBTeamMember).where(DBTeamMember.team_id == team_id, DBTeamMember.user_id == current_user_id))
    await db.commit()
    await evict_from_team(team_id, current_user_id, "left")
    spawn_background(broadcast_members(team_id))
    return {"status": "left"}


# ==========================================
# 12b. PROJECT HUB: TASK BOARD, PLANNING CANVAS, LINKED REPO AND DESIGN FILE (one per team)
# ==========================================
TASK_COLUMNS = ("todo", "inprogress", "review", "done")
TASK_PRIORITIES = ("low", "medium", "high")
CANVAS_SHAPE_TYPES = ("rectangle", "circle", "database", "sticky", "text", "arrow", "line")
CANVAS_COLORS = ("indigo", "green", "amber", "rose", "slate")
MAX_CANVAS_SHAPES = 500
GITHUB_REPO_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$")
FIGMA_URL_PATTERN = re.compile(r"^https://(?:www\.)?figma\.com/(?:file|design|proto|board)/[A-Za-z0-9]+(?:/[^\s]*)?$")

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    column: Optional[str] = "todo"
    tag: Optional[str] = ""
    priority: Optional[str] = "medium"
    assignee_id: Optional[int] = None
    due_date: Optional[str] = ""

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    column: Optional[str] = None
    position: Optional[float] = None
    tag: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[int] = None
    clear_assignee: Optional[bool] = False
    due_date: Optional[str] = None

class BoardUpdate(BaseModel):
    name: Optional[str] = None
    sprint_label: Optional[str] = None
    github_repo: Optional[str] = None
    figma_url: Optional[str] = None

class CanvasSave(BaseModel):
    shapes: list
    client_id: Optional[str] = None


def serialize_task(task) -> dict:
    return {
        "id": task.id,
        "team_id": task.team_id,
        "title": task.title or "",
        "description": task.description or "",
        "column": task.status or "todo",
        "position": task.position or 0,
        "tag": task.tag or "",
        "priority": task.priority or "medium",
        "assignee_id": task.assignee_id,
        "due_date": task.due_date or "",
        "created_by": task.created_by,
        "created_at": task.created_at,
        "updated_at": task.updated_at
    }

def serialize_board(board, team_name: str) -> dict:
    return {
        "name": (board.name if board else "") or team_name,
        "sprint_label": (board.sprint_label if board else "") or "",
        "github_repo": (board.github_repo if board else "") or "",
        "figma_url": (board.figma_url if board else "") or "",
        "updated_at": (board.updated_at if board else None)
    }

def clean_task_fields(data, partial: bool) -> dict:
    """Checked task fields ready to store. With partial=True only the fields that were sent are returned."""
    values = {}
    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Give the task a title.")
        values["title"] = title[:160]
    elif not partial:
        raise HTTPException(status_code=400, detail="Give the task a title.")
    if data.description is not None:
        values["description"] = data.description.strip()[:2000]
    if data.column is not None:
        if data.column not in TASK_COLUMNS:
            raise HTTPException(status_code=400, detail="That is not a column on the board.")
        values["status"] = data.column
    if data.tag is not None:
        values["tag"] = data.tag.strip()[:30]
    if data.priority is not None:
        if data.priority not in TASK_PRIORITIES:
            raise HTTPException(status_code=400, detail="Priority must be low, medium or high.")
        values["priority"] = data.priority
    if data.due_date is not None:
        due = data.due_date.strip()
        if due:
            try:
                datetime.strptime(due, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="The due date must look like 2026-12-31.")
        values["due_date"] = due
    return values

async def check_assignee(db: AsyncSession, team_id: int, assignee_id: Optional[int]):
    if assignee_id is None:
        return
    found = await db.execute(select(DBTeamMember.id).filter(DBTeamMember.team_id == team_id, DBTeamMember.user_id == assignee_id))
    if not found.first():
        raise HTTPException(status_code=400, detail="Tasks can only be assigned to members of this workspace.")

async def touch_board(team_id: int, **values):
    """Create the team's board row if needed and update the given fields."""
    values["updated_at"] = utc_now_iso()
    statement = pg_insert(DBTeamBoard).values(team_id=team_id, **values)
    await run_one_off(statement.on_conflict_do_update(index_elements=[DBTeamBoard.team_id], set_=values))


@app.get("/api/teams/{team_id}/board")
async def get_team_board(team_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Everything Project Hub needs for one workspace, with the reads running side by side."""
    team_rows, member_rows, task_rows, board_rows = await asyncio.gather(
        fetch_one_off(select(DBTeam.id, DBTeam.name, DBTeam.description, DBTeam.created_by).filter(DBTeam.id == team_id)),
        fetch_one_off(members_query(team_id)),
        fetch_one_off(select(DBTeamTask).filter(DBTeamTask.team_id == team_id).order_by(DBTeamTask.position.asc(), DBTeamTask.id.asc())),
        fetch_one_off(select(DBTeamBoard).filter(DBTeamBoard.team_id == team_id)),
    )
    if not team_rows:
        raise HTTPException(status_code=404, detail="Team not found.")
    members = serialize_members(member_rows)
    me = next((m for m in members if m["user_id"] == current_user_id), None)
    if not me:
        raise HTTPException(status_code=403, detail="You are not a member of this team.")
    team = team_rows[0]
    board = board_rows[0][0] if board_rows else None
    try:
        canvas = json.loads(board.canvas) if board and board.canvas else []
    except ValueError:
        canvas = []
    return {
        "team": {"id": team.id, "name": team.name, "description": team.description or "", "created_by": team.created_by},
        "role": me["role"],
        "members": members,
        "board": serialize_board(board, team.name),
        "tasks": [serialize_task(task) for (task,) in task_rows],
        "canvas": canvas
    }


@app.patch("/api/teams/{team_id}/board")
async def update_team_board(team_id: int, data: BoardUpdate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    team = await require_team_admin(db, team_id, current_user_id)
    values = {}
    if data.name is not None:
        if not data.name.strip():
            raise HTTPException(status_code=400, detail="The board needs a name.")
        values["name"] = data.name.strip()[:80]
    if data.sprint_label is not None:
        values["sprint_label"] = data.sprint_label.strip()[:60]
    if data.github_repo is not None:
        repo = re.sub(r"^https?://(?:www\.)?github\.com/", "", data.github_repo.strip()).removesuffix(".git").strip("/")
        if repo and not GITHUB_REPO_PATTERN.match(repo):
            raise HTTPException(status_code=400, detail="Enter the repository as owner/name, for example fastapi/fastapi.")
        values["github_repo"] = repo
    if data.figma_url is not None:
        figma = data.figma_url.strip()
        if figma and not FIGMA_URL_PATTERN.match(figma):
            raise HTTPException(status_code=400, detail="Paste a link to a Figma file, starting with https://www.figma.com/")
        values["figma_url"] = figma[:500]
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")

    await touch_board(team_id, **values)
    board = (await db.execute(select(DBTeamBoard).filter(DBTeamBoard.team_id == team_id))).scalars().first()
    payload = serialize_board(board, team.name)
    await team_hub.broadcast(team_id, {"type": "board_updated", "board": payload})
    return payload


@app.post("/api/teams/{team_id}/tasks")
async def create_task(team_id: int, data: TaskCreate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    await get_team_role(db, team_id, current_user_id)
    values = clean_task_fields(data, partial=False)
    values.setdefault("status", "todo")
    await check_assignee(db, team_id, data.assignee_id)

    now_iso = utc_now_iso()
    # New tasks go to the bottom of their column
    next_position = (
        select(func.coalesce(func.max(DBTeamTask.position), 0) + 1)
        .where(DBTeamTask.team_id == team_id, DBTeamTask.status == values["status"])
        .scalar_subquery()
    )
    result = await db.execute(
        DBTeamTask.__table__.insert()
        .values(team_id=team_id, position=next_position, assignee_id=data.assignee_id,
                created_by=current_user_id, created_at=now_iso, updated_at=now_iso, **values)
        .returning(*DBTeamTask.__table__.c)
    )
    task = serialize_task(result.first())
    await team_hub.broadcast(team_id, {"type": "task_created", "task": task, "by": current_user_id})
    spawn_background(touch_board(team_id))
    return task


async def get_task_for_member(db: AsyncSession, task_id: int, user_id: int):
    """Returns (task, the caller's role in the task's team). 404 if missing, 403 if the caller is not in that team."""
    result = await db.execute(
        select(DBTeamTask, DBTeamMember.role)
        .outerjoin(DBTeamMember, and_(DBTeamMember.team_id == DBTeamTask.team_id, DBTeamMember.user_id == user_id))
        .filter(DBTeamTask.id == task_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found.")
    if row[1] is None:
        raise HTTPException(status_code=403, detail="You are not a member of this team.")
    return row[0], row[1]


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: int, data: TaskUpdate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Edit a task, or move it by sending a column and a position."""
    task, _ = await get_task_for_member(db, task_id, current_user_id)
    values = clean_task_fields(data, partial=True)
    if data.position is not None:
        if not math.isfinite(data.position):
            raise HTTPException(status_code=400, detail="That is not a valid position.")
        values["position"] = data.position
    if data.clear_assignee:
        values["assignee_id"] = None
    elif data.assignee_id is not None:
        await check_assignee(db, task.team_id, data.assignee_id)
        values["assignee_id"] = data.assignee_id
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")

    values["updated_at"] = utc_now_iso()
    result = await db.execute(update(DBTeamTask).where(DBTeamTask.id == task_id).values(**values).returning(*DBTeamTask.__table__.c))
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found.")
    updated = serialize_task(row)
    await team_hub.broadcast(task.team_id, {"type": "task_updated", "task": updated, "by": current_user_id})
    spawn_background(touch_board(task.team_id))
    return updated


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    task, role = await get_task_for_member(db, task_id, current_user_id)
    if role != "Admin" and current_user_id not in (task.created_by, task.assignee_id):
        raise HTTPException(status_code=403, detail="Only the person who created it, the assignee or an Admin can delete this task.")
    await db.execute(delete(DBTeamTask).where(DBTeamTask.id == task_id))
    await team_hub.broadcast(task.team_id, {"type": "task_deleted", "id": task_id, "by": current_user_id})
    spawn_background(touch_board(task.team_id))
    return {"status": "deleted"}


def clean_canvas_shapes(shapes: list) -> list:
    """Keep only well-formed shapes of known types. Text is stored as plain text and escaped when drawn."""
    if len(shapes) > MAX_CANVAS_SHAPES:
        raise HTTPException(status_code=400, detail=f"A canvas can hold up to {MAX_CANVAS_SHAPES} shapes.")
    cleaned = []
    for shape in shapes:
        if not isinstance(shape, dict) or shape.get("type") not in CANVAS_SHAPE_TYPES:
            raise HTTPException(status_code=400, detail="The canvas contains a shape this board does not support.")
        item = {"id": str(shape.get("id") or uuid.uuid4().hex[:12])[:40], "type": shape["type"]}
        for key in ("x", "y", "w", "h", "x2", "y2"):
            value = shape.get(key, 0)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise HTTPException(status_code=400, detail="The canvas contains a shape with an invalid position.")
            item[key] = round(max(-20000, min(20000, value)), 1)
        item["text"] = str(shape.get("text") or "")[:500]
        item["color"] = shape.get("color") if shape.get("color") in CANVAS_COLORS else "indigo"
        cleaned.append(item)
    return cleaned


@app.put("/api/teams/{team_id}/canvas")
async def save_team_canvas(team_id: int, data: CanvasSave, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    await get_team_role(db, team_id, current_user_id)
    shapes = clean_canvas_shapes(data.shapes)
    await touch_board(team_id, canvas=json.dumps(shapes, separators=(",", ":")))
    # client_id lets the page that saved recognise its own change coming back
    await team_hub.broadcast(team_id, {"type": "canvas_updated", "shapes": shapes, "by": current_user_id, "client_id": data.client_id})
    return {"status": "saved", "count": len(shapes)}


def fetch_github_repo(repo: str) -> dict:
    """Blocking calls to GitHub's public API for one repository. Run in a worker thread."""
    headers = {"User-Agent": "Connect2Minds-App", "Accept": "application/vnd.github+json"}

    def get_json(url: str):
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
            return json.loads(response.read().decode())

    # The four lookups run side by side, so the wait is the slowest one rather than the sum
    base = f"https://api.github.com/repos/{repo}"
    with ThreadPoolExecutor(max_workers=4) as pool:
        info, commits, pulls, issues = pool.map(get_json, [base, base + "/commits?per_page=5", base + "/pulls?state=open&per_page=5", base + "/issues?state=open&per_page=15"])
    return {
        "full_name": info.get("full_name"),
        "description": info.get("description") or "",
        "html_url": info.get("html_url"),
        "default_branch": info.get("default_branch"),
        "stars": info.get("stargazers_count", 0),
        "forks": info.get("forks_count", 0),
        "open_issues_and_pulls": info.get("open_issues_count", 0),
        "pushed_at": info.get("pushed_at"),
        "commits": [{
            "sha": (c.get("sha") or "")[:7],
            "message": ((c.get("commit") or {}).get("message") or "").split("\n")[0][:140],
            "author": ((c.get("commit") or {}).get("author") or {}).get("name") or "",
            "date": ((c.get("commit") or {}).get("author") or {}).get("date"),
            "url": c.get("html_url")
        } for c in commits if isinstance(c, dict)],
        "pulls": [{"number": pr.get("number"), "title": (pr.get("title") or "")[:140], "author": (pr.get("user") or {}).get("login") or "", "url": pr.get("html_url")} for pr in pulls],
        # GitHub lists pull requests among issues; keep the real issues only
        "issues": [{"number": i.get("number"), "title": (i.get("title") or "")[:140], "author": (i.get("user") or {}).get("login") or "", "url": i.get("html_url")} for i in issues if "pull_request" not in i][:5]
    }


@app.get("/api/github/repos/{owner}/{repo}")
async def get_github_repo(owner: str, repo: str, current_user_id: int = Depends(get_current_user_id)):
    full_name = f"{owner}/{repo}"
    if not GITHUB_REPO_PATTERN.match(full_name):
        raise HTTPException(status_code=400, detail="That is not a valid repository name.")

    cache_key = "repo:" + full_name.lower()
    cached = github_cache.get(cache_key)
    if cached and cached[0] > datetime.now(timezone.utc).timestamp():
        return cached[1]

    try:
        data = await asyncio.to_thread(fetch_github_repo, full_name)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise HTTPException(status_code=404, detail="No public repository has that name. Private repositories cannot be linked.")
        if e.code in (403, 429):
            raise HTTPException(status_code=503, detail="GitHub is limiting requests right now. Please try again in a few minutes.")
        raise HTTPException(status_code=502, detail="GitHub could not be reached.")
    except Exception:
        raise HTTPException(status_code=502, detail="GitHub could not be reached.")

    if len(github_cache) > 2000:
        github_cache.clear()
    github_cache[cache_key] = (datetime.now(timezone.utc).timestamp() + GITHUB_CACHE_SECONDS, data)
    return data


async def purge_team(db: AsyncSession, team_id: int):
    """Delete a team and everything in it. Used by My Teams and by College Hub."""
    # Reactions are found through the team's channels, so they go first; the rest can go at the same time.
    # Every statement is safe to repeat, so a delete that fails part-way can simply be run again.
    await db.execute(delete(DBTeamMessageReaction).where(DBTeamMessageReaction.channel_id.in_(
        select(DBChannel.id).where(DBChannel.team_id == team_id)
    )))
    await asyncio.gather(
        run_one_off(delete(DBTeamResource).where(DBTeamResource.team_id == team_id)),
        run_one_off(delete(DBTeamMember).where(DBTeamMember.team_id == team_id)),
        run_one_off(delete(DBTeamMessage).where(DBTeamMessage.team_id == team_id)),
        run_one_off(delete(DBChannel).where(DBChannel.team_id == team_id)),
        run_one_off(delete(DBTeamTask).where(DBTeamTask.team_id == team_id)),
        run_one_off(delete(DBTeamBoard).where(DBTeamBoard.team_id == team_id)),
        run_one_off(delete(DBTeam).where(DBTeam.id == team_id)),
        run_one_off(delete(DBCollegeSubmission).where(DBCollegeSubmission.group_id == team_id)),
        run_one_off(delete(DBGroupCheckin).where(DBGroupCheckin.group_id == team_id)),
    )


@app.delete("/api/teams/{team_id}")
async def delete_team(
    team_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    team_res = await db.execute(select(DBTeam.name, DBTeam.created_by, DBTeam.teacher_managed, DBTeam.college_key).filter(DBTeam.id == team_id))
    team = team_res.first()

    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")

    if team.created_by != current_user_id:
        raise HTTPException(status_code=403, detail="Only the workspace creator can delete this team.")
    await refuse_unless_teacher(db, team.teacher_managed, team.college_key, current_user_id)

    await purge_team(db, team_id)

    spawn_background(log_activity_later(current_user_id, "Workspace Deleted", f"You permanently deleted the team: {team.name}."))
    await team_hub.broadcast(team_id, {"type": "team_deleted", "team_id": team_id})

    return {"message": "Team deleted successfully."}

# ==========================================
# 13. ADMIN & VERIFICATION SYSTEM
# ==========================================
FOUNDER_NAME = "Gopale Omkar Ravindra"
FOUNDER_CODE = os.getenv("FOUNDER_CODE")  # Founder login is disabled when unset

@app.post("/api/admin/apply")
async def apply_for_admin():
    raise HTTPException(status_code=410, detail="Apply on the 'Apply as admin' page (apply-admin.html).")

@app.post("/api/admin/login")
@limiter.limit("5/minute")
async def admin_login(request: Request, credentials: AdminLogin, response: Response, db: AsyncSession = Depends(get_db)):
    # --- FOUNDER GOD-MODE BYPASS ---
    if FOUNDER_CODE and credentials.name == FOUNDER_NAME and hmac.compare_digest(credentials.bypass_code.encode(), FOUNDER_CODE.encode()):
        result = await db.execute(select(DBUser).filter(DBUser.name == FOUNDER_NAME))
        founder_user = result.scalars().first()
        
        if not founder_user:
            raise HTTPException(status_code=404, detail="Please create a normal account with your name first before claiming Founder access.")
        
        founder_user.is_founder = 1
        founder_user.is_admin = 1   # kept so older checks still let the founder in; new code asks is_founder first
        await db.commit()
        
        access_token = create_access_token(data={"sub": str(founder_user.id)})
        admin_token = create_access_token(data={"sub": str(founder_user.id), "role": "founder"})
        
        response.set_cookie(key="authToken", value=access_token, httponly=True, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, samesite="lax", path="/")
        response.set_cookie(key="adminToken", value=admin_token, httponly=True, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, samesite="lax", path="/")
        
        # RETURN TOKEN DIRECTLY IN JSON FOR LOCALSTORAGE FALLBACK
        return {"message": "Founder Access Granted", "role": "founder", "user_id": founder_user.id, "token": admin_token}
    
    # --- REGULAR ADMIN LOGIN (the secure code is the admin's own account password) ---
    result = await db.execute(select(DBUser).filter(DBUser.name == credentials.name, DBUser.is_admin == 1))
    admin_user = None
    for candidate in result.scalars().all():
        if candidate.hashed_password and await check_password_async(credentials.bypass_code, candidate.hashed_password):
            admin_user = candidate
            break

    if not admin_user:
        raise HTTPException(status_code=403, detail="Unauthorized. Invalid name or bypass code.")
        
    access_token = create_access_token(data={"sub": str(admin_user.id)})
    admin_token = create_access_token(data={"sub": str(admin_user.id), "role": "admin"})
    
    response.set_cookie(key="authToken", value=access_token, httponly=True, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, samesite="lax", path="/")
    response.set_cookie(key="adminToken", value=admin_token, httponly=True, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, samesite="lax", path="/")
    
    # RETURN TOKEN DIRECTLY IN JSON FOR LOCALSTORAGE FALLBACK
    return {"message": "Admin Access Granted", "role": "admin", "user_id": admin_user.id, "token": admin_token}

# Dependencies for admin routes
async def get_current_admin(request: Request, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("adminToken")
    
    # ADDED: CHECK HEADER IF BROWSER BLOCKS COOKIE
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            
    if not token:
        raise HTTPException(status_code=401, detail="Admin authentication required.")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid admin token.")
    if payload.get("role") not in ("admin", "founder"):
        raise HTTPException(status_code=403, detail="Insufficient permissions.")
    # A token outlives a revoked admin, so the flag is checked again every time
    rows = await fetch_one_off(select(DBUser.is_admin, DBUser.is_founder).where(DBUser.id == int(payload.get("sub") or 0)))
    if not rows or ((rows[0].is_admin or 0) != 1 and (rows[0].is_founder or 0) != 1):
        raise HTTPException(status_code=401, detail="Admin access has been removed.")
    return payload

async def founder_flag(user_id: int) -> bool:
    rows = await fetch_one_off(select(DBUser.is_founder).where(DBUser.id == user_id))
    return bool(rows) and (rows[0][0] or 0) == 1

async def get_founder_admin(admin_data: dict = Depends(get_current_admin)) -> dict:
    """The older admin-token routes that are now founder-only (the accounts dashboard)."""
    if admin_data.get("role") != "founder" or not await founder_flag(int(admin_data["sub"])):
        raise HTTPException(status_code=403, detail="Only the founder can do this.")
    return admin_data

@app.get("/api/admin/requests", response_model=List[AdminRequestResponse])
async def get_admin_requests(db: AsyncSession = Depends(get_db), admin_data: dict = Depends(get_current_admin)):
    result = await db.execute(select(DBAdminRequest).order_by(DBAdminRequest.id.desc()))
    return result.scalars().all()

@app.post("/api/admin/requests/{req_id}/accept")
async def accept_admin(req_id: int, db: AsyncSession = Depends(get_db), admin_data: dict = Depends(get_current_admin)):
    raise HTTPException(status_code=410, detail="Decide admin applications in the Founder console, where a department scope is given.")
    if admin_data.get("role") != "founder":
        raise HTTPException(status_code=403, detail="Only the founder can accept new admins.")
        
    req_res = await db.execute(select(DBAdminRequest).filter(DBAdminRequest.id == req_id))
    admin_req = req_res.scalars().first()
    if not admin_req:
        raise HTTPException(status_code=404, detail="Request not found.")
        
    admin_req.status = "Approved"
    
    user_res = await db.execute(select(DBUser).filter(DBUser.id == admin_req.user_id))
    user = user_res.scalars().first()
    if user:
        user.is_admin = 1
        
    await db.commit()
    return {"message": "Admin accepted."}

@app.post("/api/admin/requests/{req_id}/reject")
async def reject_admin(req_id: int, db: AsyncSession = Depends(get_db), admin_data: dict = Depends(get_current_admin)):
    raise HTTPException(status_code=410, detail="Decide admin applications in the Founder console.")
    if admin_data.get("role") != "founder":
        raise HTTPException(status_code=403, detail="Only the founder can reject new admins.")
        
    req_res = await db.execute(select(DBAdminRequest).filter(DBAdminRequest.id == req_id))
    admin_req = req_res.scalars().first()
    if not admin_req:
        raise HTTPException(status_code=404, detail="Request not found.")
        
    admin_req.status = "Rejected"
    await db.commit()
    return {"message": "Admin rejected."}

@app.get("/api/admin/stats", response_model=AdminStatsResponse)
async def get_admin_stats(db: AsyncSession = Depends(get_db), admin_data: dict = Depends(get_current_admin)):
    users = await db.execute(select(func.count()).select_from(DBUser))
    projects = await db.execute(select(func.count()).select_from(DBProject))
    teams = await db.execute(select(func.count()).select_from(DBTeam))
    admins = await db.execute(select(func.count()).select_from(DBUser).filter(DBUser.is_admin == 1))
    pending = await db.execute(select(func.count()).select_from(DBAdminRequest).filter(DBAdminRequest.status == "Pending"))
    
    return {
        "total_users": users.scalar() or 0,
        "total_projects": projects.scalar() or 0,
        "total_teams": teams.scalar() or 0,
        "total_admins": admins.scalar() or 0,
        "pending_requests": pending.scalar() or 0
    }

GROWTH_WEEKS = 12
ADMIN_USERS_PAGE = 25
ACCOUNT_STATUSES = ("pending", "verified", "rejected", "appealed", "active", "needs_info")

@app.get("/api/admin/overview")
async def get_admin_overview(admin_data: dict = Depends(get_founder_admin)):
    """Everything the admin dashboard shows on load, in one request."""
    def count_of(model, *conditions):
        query = select(func.count()).select_from(model)
        return (query.where(*conditions) if conditions else query).scalar_subquery()

    totals_rows, status_rows, signup_rows, request_rows = await asyncio.gather(
        fetch_one_off(select(
            count_of(DBUser), count_of(DBProject), count_of(DBTeam), count_of(DBUser, DBUser.is_admin == 1),
            count_of(DBAdminRequest, DBAdminRequest.status == "Pending"), count_of(DBBoardPost),
        )),
        fetch_one_off(select(DBUser.account_status, func.count()).group_by(DBUser.account_status)),
        fetch_one_off(select(DBHistory.time).where(DBHistory.action == "Account Created")),
        fetch_one_off(select(DBAdminRequest.id, DBAdminRequest.user_id, DBAdminRequest.name, DBAdminRequest.status, DBAdminRequest.requested_at)
                      .order_by(DBAdminRequest.id.desc()).limit(200)),
    )
    total_users, total_projects, total_teams, total_admins, pending_requests, total_posts = totals_rows[0]

    # Sign-ups per week, from each account's "Account Created" log entry. Accounts older than the log
    # (or whose entry was removed) are counted in the starting figure.
    today = datetime.now(timezone.utc).date()
    this_week = today - timedelta(days=today.weekday())
    week_starts = [this_week - timedelta(weeks=offset) for offset in range(GROWTH_WEEKS - 1, -1, -1)]
    signups = {start: 0 for start in week_starts}
    dated = 0
    for (stamp,) in signup_rows:
        try:
            day = parse_timestamp(stamp).astimezone(timezone.utc).date()
        except (TypeError, ValueError):
            continue
        dated += 1
        start = day - timedelta(days=day.weekday())
        if start in signups:
            signups[start] += 1
    running = max(0, (total_users or 0) - sum(signups.values()))
    growth = []
    for start in week_starts:
        running += signups[start]
        growth.append({"week": start.isoformat(), "signups": signups[start], "total": running})

    statuses: dict = {}
    for account_status, count in status_rows:
        statuses[account_status or "pending"] = statuses.get(account_status or "pending", 0) + count

    return {
        "role": admin_data.get("role"),
        "totals": {
            "users": total_users or 0, "projects": total_projects or 0, "teams": total_teams or 0,
            "admins": total_admins or 0, "pending_requests": pending_requests or 0, "posts": total_posts or 0,
        },
        "statuses": statuses,
        "growth": growth,
        "undated_accounts": max(0, (total_users or 0) - dated),
        "online": len(all_online_user_ids()),
        "requests": [
            {"id": row.id, "user_id": row.user_id, "name": row.name or "", "status": row.status or "Pending", "requested_at": row.requested_at or ""}
            for row in request_rows
        ],
    }


@app.get("/api/admin/users")
async def get_admin_users(
    q: str = "",
    status: str = "",
    page: int = 1,
    admin_data: dict = Depends(get_founder_admin)
):
    """Accounts for the admin dashboard, searchable and paged. Never returns password hashes."""
    conditions = []
    term = q.strip()
    if term:
        like = f"%{term}%"
        conditions.append(or_(DBUser.name.ilike(like), DBUser.email.ilike(like), DBUser.roll_no.ilike(like), DBUser.college_name.ilike(like)))
    if status in ACCOUNT_STATUSES:
        conditions.append(func.coalesce(DBUser.account_status, "pending") == status)
    page = max(1, page)

    rows, total = await asyncio.gather(
        fetch_one_off(
            select(DBUser.id, DBUser.name, DBUser.email, DBUser.roll_no, DBUser.college_name, DBUser.department,
                   DBUser.account_status, DBUser.account_type, DBUser.is_admin, DBUser.is_founder, DBUser.is_ambassador,
                   DBUser.teacher_of,
                   (func.length(func.coalesce(DBUser.id_card_image, "")) > 0).label("has_id_card"))
            .where(*conditions).order_by(DBUser.id.desc())
            .limit(ADMIN_USERS_PAGE).offset((page - 1) * ADMIN_USERS_PAGE)
        ),
        fetch_one_off(select(func.count()).select_from(DBUser).where(*conditions)),
    )
    return {
        "users": [
            {"id": row.id, "name": row.name or "", "email": row.email or "", "roll_no": row.roll_no or "",
             "college_name": row.college_name or "", "department": row.department or "",
             "account_status": row.account_status or "pending", "account_type": row.account_type or "standard",
             "is_admin": bool(row.is_admin), "is_founder": bool(row.is_founder), "is_ambassador": bool(row.is_ambassador),
             "is_teacher": bool((row.teacher_of or "").strip()), "has_id_card": bool(row.has_id_card)}
            for row in rows
        ],
        "total": total[0][0] or 0,
        "page": page,
        "page_size": ADMIN_USERS_PAGE,
    }


@app.get("/api/admin/users/{user_id}/id-card")
async def get_admin_user_id_card(user_id: int, admin_data: dict = Depends(get_founder_admin)):
    """The ID document a person uploaded at sign-up, for checking an account by hand."""
    rows = await fetch_one_off(select(DBUser.id_card_image).where(DBUser.id == user_id))
    image = await load_id_card(rows[0][0]) if rows else None
    if not image:
        raise HTTPException(status_code=404, detail="This account has no ID document.")
    return {"image": image}


class AccountStatusChange(BaseModel):
    status: str

@app.post("/api/admin/users/{user_id}/status")
async def set_account_status(
    user_id: int,
    change: AccountStatusChange,
    db: AsyncSession = Depends(get_fast_db),
    admin_data: dict = Depends(get_founder_admin)
):
    """Verify or reject an account. This is where pending and appealed accounts are settled."""
    if change.status not in ("verified", "rejected", "pending"):
        raise HTTPException(status_code=400, detail="Status must be verified, rejected or pending.")
    result = await db.execute(
        update(DBUser).where(DBUser.id == user_id, func.coalesce(DBUser.is_founder, 0) == 0)
        .values(account_status=change.status).returning(*[getattr(DBUser, field) for field in DIRECTORY_FIELDS], DBUser.bio)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found, or it belongs to the founder.")

    now_iso = utc_now_iso()
    messages = {
        "verified": "Your account was verified by an admin.",
        "rejected": "Your account was rejected by an admin. You can appeal from your profile.",
        "pending": "Your account is under review again.",
    }
    spawn_background(create_notification(user_id, "account", messages[change.status], now_iso, "profile.html"))
    spawn_background(broadcast_directory({"type": "profile_updated", "profile": directory_card(row)}))
    spawn_background(log_activity_later(int(admin_data["sub"]), "Admin Action", f"Set {row.name or 'an account'}'s status to {change.status}."))
    return {"id": user_id, "account_status": change.status}


class Announcement(BaseModel):
    message: str

@app.post("/api/admin/announce")
@limiter.limit("5/minute")
async def send_announcement(
    request: Request,
    announcement: Announcement,
    db: AsyncSession = Depends(get_fast_db),
    admin_data: dict = Depends(get_founder_admin)
):
    """Send one bell notification to every account, and show it at once to everyone who is online."""
    message = announcement.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Write the announcement first.")
    if len(message) > 300:
        raise HTTPException(status_code=400, detail="Announcements are limited to 300 characters.")

    now_iso = utc_now_iso()
    content = f"Announcement: {message}"
    result = await db.execute(
        DBNotification.__table__.insert().from_select(
            ["user_id", "type", "content", "is_read", "timestamp", "link"],
            select(DBUser.id, literal("announcement"), literal(content), literal(0), literal(now_iso), literal(""))
        )
    )
    await notification_manager.broadcast(json.dumps({"type": "announcement", "content": content, "timestamp": now_iso, "link": "", "is_read": 0}))
    spawn_background(log_activity_later(int(admin_data["sub"]), "Announcement Sent", message))
    return {"sent_to": result.rowcount or 0}


# ==========================================
# 13b. RESEARCH REPORTS
# ==========================================
RESEARCH_REPORT_LIMIT = 50
RESEARCH_CONTENT_LIMIT = 200_000

class ResearchReportCreate(BaseModel):
    topic: str
    content: dict

@app.get("/api/research")
async def list_research_reports(current_user_id: int = Depends(get_current_user_id)):
    """The viewer's saved research reports, newest first, without their contents."""
    rows = await fetch_one_off(
        select(DBResearchReport.id, DBResearchReport.topic, DBResearchReport.created_at)
        .where(DBResearchReport.user_id == current_user_id).order_by(DBResearchReport.id.desc()).limit(RESEARCH_REPORT_LIMIT)
    )
    return {"reports": [{"id": row.id, "topic": row.topic or "", "created_at": row.created_at or ""} for row in rows]}


@app.get("/api/research/{report_id}")
async def get_research_report(report_id: int, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(
        select(DBResearchReport.id, DBResearchReport.topic, DBResearchReport.content, DBResearchReport.created_at)
        .where(DBResearchReport.id == report_id, DBResearchReport.user_id == current_user_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Report not found.")
    try:
        content = json.loads(rows[0].content or "{}")
    except ValueError:
        content = {}
    return {"id": rows[0].id, "topic": rows[0].topic or "", "created_at": rows[0].created_at or "", "content": content}


@app.post("/api/research")
async def save_research_report(
    report: ResearchReportCreate,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    topic = report.topic.strip()[:200]
    if not topic:
        raise HTTPException(status_code=400, detail="The report needs a topic.")
    content = json.dumps(report.content)
    if len(content) > RESEARCH_CONTENT_LIMIT:
        raise HTTPException(status_code=400, detail="This report is too large to save.")
    saved = (await db.execute(select(func.count()).select_from(DBResearchReport).where(DBResearchReport.user_id == current_user_id))).scalar() or 0
    if saved >= RESEARCH_REPORT_LIMIT:
        raise HTTPException(status_code=400, detail=f"You can keep {RESEARCH_REPORT_LIMIT} reports. Delete one to save another.")
    await check_limit(current_user_id, "research_saves", used=saved)

    new_report = DBResearchReport(user_id=current_user_id, topic=topic, content=content, created_at=utc_now_iso())
    db.add(new_report)
    await db.flush()
    spawn_background(log_activity_later(current_user_id, "Research Saved", f"Saved a research report on: {topic}."))
    return {"id": new_report.id, "topic": topic, "created_at": new_report.created_at}


@app.delete("/api/research/{report_id}")
async def delete_research_report(
    report_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    await db.execute(delete(DBResearchReport).where(DBResearchReport.id == report_id, DBResearchReport.user_id == current_user_id))
    return {"status": "deleted"}


# ==========================================
# 14. DECENTRALIZED AMBASSADOR VERIFICATION ROUTES
# ==========================================
@app.get("/api/ambassador/pending", response_model=List[PendingUserResponse])
async def get_pending_users(db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    if not current_user.is_ambassador:
        raise HTTPException(status_code=403, detail="Ambassador access required.")
        
    # Ambassadors only see pending students from THEIR specific college
    query = select(DBUser).filter(
        DBUser.college_name == current_user.college_name,
        DBUser.account_status == "pending"
    )
    result = await db.execute(query)
    return result.scalars().all()

@app.post("/api/ambassador/verify/{target_id}/{action}")
async def ambassador_verify_action(target_id: int, action: str, db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    if not current_user.is_ambassador:
        raise HTTPException(status_code=403, detail="Ambassador access required.")
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'.")
        
    result = await db.execute(select(DBUser).filter(DBUser.id == target_id, DBUser.college_name == current_user.college_name))
    target_user = result.scalars().first()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="Student not found in your jurisdiction.")
        
    if action == "approve":
        target_user.account_status = "verified"
    else:
        target_user.account_status = "rejected"
        
    await db.commit()
    return {"message": f"User {action}d successfully."}

@app.post("/api/users/appeal")
async def appeal_rejection(db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    if current_user.account_status != "rejected":
        raise HTTPException(status_code=400, detail="You can only appeal if you have been rejected.")
        
    current_user.account_status = "appealed" # Sends them directly to your master admin dashboard
    await db.commit()
    return {"message": "Appeal sent to Founders."}


# ==========================================
# 15. COLLEGE HUB: TEACHER-RUN GROUPS, NOTICE BOARD AND CLASS CHAT
# A college is everyone whose college name matches (trimmed, lower-cased), as on Campus Network.
# A group is an ordinary team that carries the college's key, so it has the usual chat and task board.
# ==========================================
class DBTeacherRequest(Base):
    __tablename__ = "teacher_requests"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    college_key = Column(String, index=True)
    college_name = Column(String, default="")     # as the person wrote it, for the admin to read
    note = Column(String, default="")
    status = Column(String, default="pending")    # pending, needs_info, approved, declined, withdrawn
    requested_at = Column(String)
    decided_by = Column(Integer, nullable=True)
    decided_at = Column(String, default="")
    # The application form (section 17)
    department = Column(String, default="")
    designation = Column(String, default="")
    employee_id = Column(String, default="")
    official_email = Column(String, default="")
    phone = Column(String, default="")
    subjects = Column(String, default="[]")
    years = Column(Integer, default=0)
    id_proof_url = Column(String, default="")
    letter_url = Column(String, default="")
    profile_link = Column(String, default="")
    decision_note = Column(String, default="")
    info_question = Column(String, default="")
    info_answer = Column(String, default="")
    updated_at = Column(String, default="")

class DBCollegePost(Base):
    """One entry on a college's notice board: a notice, or an activity that groups are formed for."""
    __tablename__ = "college_posts"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    author_id = Column(Integer, index=True)
    kind = Column(String, default="notice")       # notice, activity
    title = Column(String)
    body = Column(String, default="")
    department = Column(String, default="")       # who it is for; empty means the whole college
    division = Column(String, default="")
    pinned = Column(Integer, default=0)
    group_min = Column(Integer, default=2)        # the rest only matters for an activity
    group_max = Column(Integer, default=5)
    deadline = Column(String, default="")         # YYYY-MM-DD or empty
    topics = Column(String, default="[]")         # JSON list of strings
    students_form_groups = Column(Integer, default=1)
    created_at = Column(String)
    updated_at = Column(String)
    # Added later (section 16): a poll, read confirmation, handing in work and weekly check-ins
    poll_options = Column(String, default="[]")   # JSON list of strings; empty means no poll
    poll_multi = Column(Integer, default=0)
    needs_ack = Column(Integer, default=0)
    accepts_work = Column(Integer, default=0)     # activity only: groups hand in their work
    submit_by = Column(String, default="")        # YYYY-MM-DD or empty
    max_marks = Column(Integer, default=0)        # 0 means feedback without marks
    weekly_checkins = Column(Integer, default=0)

class DBCollegeSetting(Base):
    __tablename__ = "college_settings"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, unique=True, index=True)
    students_can_form_groups = Column(Integer, default=1)
    updated_by = Column(Integer, nullable=True)
    updated_at = Column(String, default="")

class DBCollegeMessage(Base):
    __tablename__ = "college_messages"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    room = Column(String, index=True)             # "college", or "class:<department>|<division>"
    sender_id = Column(Integer, index=True)
    content = Column(String)
    timestamp = Column(String)


HUB_POST_KINDS = ("notice", "activity")
HUB_MAX_GROUP_SIZE = 50
HUB_MAX_TOPICS = 40
HUB_MAX_POLL_OPTIONS = 10
HUB_CHAT_PAGE = 50
HUB_COLLEGE_ROOM = "college"
HUB_PEOPLE_LIMIT = 3000
HUB_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HUB_NOT_FOR_YOU = "College Hub is for students of a college and its approved teachers."

USER_COLLEGE_KEY = func.lower(func.trim(func.coalesce(DBUser.college_name, "")))

def college_key_of(name: Optional[str]) -> str:
    return (name or "").strip().lower()

def class_room_of(department: Optional[str], division: Optional[str]) -> str:
    return f"class:{college_key_of(department)}|{college_key_of(division)}"

def is_student_clause():
    """The SQL form of 'not is_professional_account'."""
    return and_(
        func.coalesce(DBUser.account_type, "") != "professional",
        func.trim(func.coalesce(DBUser.profession, "")).in_(("", STUDENT_PROFESSION)),
    )

def hub_student_clause(key: str):
    """The students of a college. An approved teacher of the college is never one of them, whatever their profile says."""
    return and_(USER_COLLEGE_KEY == key, is_student_clause(), func.coalesce(DBUser.teacher_of, "") != key)

def hub_people_clause(key: str):
    """Everyone who belongs to a college's hub: its students and its approved teachers."""
    return or_(hub_student_clause(key), DBUser.teacher_of == key)


class TeacherRequestCreate(BaseModel):
    note: Optional[str] = ""

class TeacherDecision(BaseModel):
    action: str

class TeacherFlag(BaseModel):
    teacher: bool

class HubPostBody(BaseModel):
    kind: Optional[str] = "notice"
    title: str
    body: Optional[str] = ""
    department: Optional[str] = ""
    division: Optional[str] = ""
    pinned: Optional[bool] = False
    group_min: Optional[int] = 2
    group_max: Optional[int] = 5
    deadline: Optional[str] = ""
    topics: Optional[List[str]] = None
    students_form_groups: Optional[bool] = None
    poll_options: Optional[List[str]] = None
    poll_multi: Optional[bool] = False
    needs_ack: Optional[bool] = False
    accepts_work: Optional[bool] = False
    submit_by: Optional[str] = ""
    max_marks: Optional[int] = 0
    weekly_checkins: Optional[bool] = False

class HubGroupCreate(BaseModel):
    name: str
    topic: Optional[str] = ""
    activity_id: Optional[int] = None
    member_ids: Optional[List[int]] = None
    open_to_join: Optional[bool] = False

class HubGroupUpdate(BaseModel):
    name: Optional[str] = None
    topic: Optional[str] = None
    open_to_join: Optional[bool] = None
    teacher_managed: Optional[bool] = None

class HubMemberAdd(BaseModel):
    user_id: int

class HubMove(BaseModel):
    user_id: int
    to_group_id: int

class HubSettings(BaseModel):
    students_can_form_groups: bool

class HubAutofill(BaseModel):
    groups: List[List[int]]

class HubChatSend(BaseModel):
    room: str
    content: str


# ---------- who the caller is ----------
async def hub_identity(user_id: int) -> dict:
    """The caller's place on College Hub: role 'teacher', 'student' or 'none', and the college it is for."""
    rows = await fetch_one_off(select(
        DBUser.name, DBUser.college_name, DBUser.department, DBUser.division,
        DBUser.account_type, DBUser.profession, DBUser.teacher_of
    ).where(DBUser.id == user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    row = rows[0]
    own_key = college_key_of(row.college_name)
    teacher_key = (row.teacher_of or "").strip()
    if teacher_key:
        role, key = "teacher", teacher_key
    elif own_key and not is_professional_account(row.account_type, row.profession):
        role, key = "student", own_key
    else:
        role, key = "none", ""
    department, division = (row.department or "").strip(), (row.division or "").strip()
    return {
        "id": user_id, "name": row.name or "", "role": role, "key": key,
        "college": (row.college_name or "").strip(), "department": department, "division": division,
        "room": class_room_of(department, division) if role == "student" else "",
    }

async def require_hub_member(user_id: int) -> dict:
    me = await hub_identity(user_id)
    if me["role"] == "none":
        raise HTTPException(status_code=403, detail=HUB_NOT_FOR_YOU)
    return me

async def require_hub_teacher(user_id: int) -> dict:
    me = await hub_identity(user_id)
    if me["role"] != "teacher":
        raise HTTPException(status_code=403, detail="Only an approved teacher of this college can do this.")
    return me


# ---------- telling people ----------
async def hub_recipient_ids(key: str, room: str = HUB_COLLEGE_ROOM) -> list:
    """Ids of everyone who may see something in this room: the whole hub, or one class plus the teachers."""
    clause = hub_people_clause(key)
    if room != HUB_COLLEGE_ROOM:
        department, _, division = room[len("class:"):].partition("|")
        in_class = and_(
            hub_student_clause(key),
            func.lower(func.trim(func.coalesce(DBUser.department, ""))) == department,
            func.lower(func.trim(func.coalesce(DBUser.division, ""))) == division,
        )
        clause = or_(in_class, DBUser.teacher_of == key)
    rows = await fetch_one_off(select(DBUser.id).where(clause).limit(HUB_PEOPLE_LIMIT))
    return [row[0] for row in rows]

async def hub_push(key: str, payload: dict, room: str = HUB_COLLEGE_ROOM):
    """Send a live event to every open page of the people concerned. Meant to run in the background."""
    try:
        message = json.dumps(payload)
        for user_id in await hub_recipient_ids(key, room):
            await notification_manager.send_personal_message(message, user_id)
    except Exception as e:
        print("Error pushing a College Hub event:", e)

def hub_changed(key: str):
    """Something on the hub changed (a post, a group, the switch): open pages fetch it again."""
    spawn_background(hub_push(key, {"type": "college_hub_changed"}))

async def notify_many(user_ids, notif_type: str, content: str, link: str):
    """One bell notification for each person, saved in a single statement. Meant to run in the background."""
    user_ids = list(dict.fromkeys(user_ids))
    if not user_ids:
        return
    try:
        now_iso = utc_now_iso()
        async with AutocommitSession() as db:
            result = await db.execute(
                DBNotification.__table__.insert()
                .values([{"user_id": user_id, "type": notif_type, "content": content, "timestamp": now_iso, "link": link, "is_read": 0} for user_id in user_ids])
                .returning(DBNotification.id, DBNotification.user_id)
            )
            saved = result.all()
        for notif_id, user_id in saved:
            await notification_manager.send_personal_message(json.dumps({
                "id": notif_id, "type": notif_type, "content": content, "timestamp": now_iso, "link": link, "is_read": 0
            }), user_id)
    except Exception as e:
        print("Error creating notifications:", e)


# ---------- reading the hub ----------
def json_list(raw: Optional[str]) -> list:
    try:
        return [str(item) for item in json.loads(raw or "[]")]
    except (ValueError, TypeError):
        return []

def serialize_hub_post(post: DBCollegePost) -> dict:
    topics = json_list(post.topics)
    return {
        "id": post.id, "kind": post.kind or "notice", "title": post.title or "", "body": post.body or "",
        "author_id": post.author_id, "department": post.department or "", "division": post.division or "",
        "pinned": bool(post.pinned), "group_min": post.group_min or 1, "group_max": post.group_max or HUB_MAX_GROUP_SIZE,
        "deadline": post.deadline or "", "topics": topics, "students_form_groups": bool(post.students_form_groups),
        "created_at": post.created_at or "", "updated_at": post.updated_at or "",
        "poll_options": json_list(post.poll_options), "poll_multi": bool(post.poll_multi), "needs_ack": bool(post.needs_ack),
        "accepts_work": bool(post.accepts_work), "submit_by": post.submit_by or "", "max_marks": post.max_marks or 0,
        "weekly_checkins": bool(post.weekly_checkins),
    }

def post_is_for(post, me: dict) -> bool:
    """Teachers see every post of their college; a student sees the ones addressed to the college or to their class."""
    return addressed_to(post.department, post.division, me)

def addressed_to(department: Optional[str], division: Optional[str], me: dict) -> bool:
    """The same rule for anything with a department and a division: posts, events, resources, questions."""
    if me["role"] == "teacher":
        return True
    department, division = college_key_of(department), college_key_of(division)
    if department and department != college_key_of(me["department"]):
        return False
    return not division or division == college_key_of(me["division"])

def deadline_passed(deadline: Optional[str]) -> bool:
    return bool(deadline) and deadline < datetime.now().date().isoformat()


@app.get("/api/college-hub")
async def get_college_hub(current_user_id: int = Depends(get_current_user_id)):
    """Everything the College Hub page shows, in one request. The chat is read separately, one room at a time."""
    me = await hub_identity(current_user_id)
    public_me = {key: me[key] for key in ("id", "name", "role", "college", "department", "division", "room")}
    if me["role"] == "none":
        rows = await fetch_one_off(
            select(DBTeacherRequest.status, DBTeacherRequest.college_name)
            .where(DBTeacherRequest.user_id == current_user_id).order_by(DBTeacherRequest.id.desc()).limit(1)
        )
        return {"me": public_me, "request": {"status": rows[0].status, "college": rows[0].college_name} if rows else None}

    key = me["key"]
    picture = case((func.length(DBUser.profile_pic) > 1000, ""), else_=DBUser.profile_pic).label("profile_pic")
    team_ids = select(DBTeam.id).where(DBTeam.college_key == key)
    people, groups, members, posts, settings, extras, licence = await asyncio.gather(
        fetch_one_off(
            select(DBUser.id, DBUser.name, DBUser.college_name, DBUser.department, DBUser.division, picture, DBUser.teacher_of)
            .where(hub_people_clause(key)).order_by(DBUser.name).limit(HUB_PEOPLE_LIMIT)
        ),
        fetch_one_off(select(DBTeam).where(DBTeam.college_key == key).order_by(DBTeam.id)),
        fetch_one_off(select(DBTeamMember.team_id, DBTeamMember.user_id, DBTeamMember.role).where(DBTeamMember.team_id.in_(team_ids))),
        fetch_one_off(select(DBCollegePost).where(DBCollegePost.college_key == key).order_by(DBCollegePost.pinned.desc(), DBCollegePost.id.desc()).limit(300)),
        fetch_one_off(select(DBCollegeSetting.students_can_form_groups).where(DBCollegeSetting.college_key == key)),
        hub_extras(key, me),
        college_licence(key),
    )

    teacher_ids = {row.id for row in people if (row.teacher_of or "") == key}
    members_of: dict = {}
    for team_id, user_id, role in members:
        members_of.setdefault(team_id, []).append({"id": user_id, "role": role, "is_teacher": user_id in teacher_ids})
    if me["role"] == "teacher":
        # The college's name as most of its students write it
        names = [row.college_name.strip() for row in people if row.id not in teacher_ids and row.college_name]
        public_me["college"] = max(set(names), key=names.count) if names else (me["college"] or key)

    my_group_ids = {team_id for team_id, people_in in members_of.items() if any(member["id"] == current_user_id for member in people_in)}
    return {
        "me": public_me,
        "settings": {"students_can_form_groups": bool(settings[0][0]) if settings else True},
        "posts": [with_post_extras(serialize_hub_post(post), extras, me) for (post,) in posts if post_is_for(post, me)],
        "submissions": [row for row in extras["submissions"] if me["role"] == "teacher" or row["group_id"] in my_group_ids],
        "checkins": extras["checkins"],
        "events": [row for row in extras["events"] if addressed_to(row["department"], row["division"], me)],
        "today": datetime.now().date().isoformat(),
        "licence": licence,
        "groups": [{
            "id": team.id, "name": team.name or "", "topic": team.topic or "", "activity_id": team.activity_id,
            "created_by": team.created_by, "teacher_managed": bool(team.teacher_managed), "open_to_join": bool(team.open_to_join),
            "created_at": team.created_at or "", "members": members_of.get(team.id, []),
        } for (team,) in groups],
        "people": [{
            "id": row.id, "name": row.name or "", "department": (row.department or "").strip(), "division": (row.division or "").strip(),
            "profile_pic": row.profile_pic or "", "is_teacher": row.id in teacher_ids,
        } for row in people],
        "online_user_ids": all_online_user_ids(),
    }


# ---------- teacher access ----------
@app.post("/api/college-hub/teacher-request")
async def request_teacher_access(body: TeacherRequestCreate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Ask to be a teacher for the college named on your own profile. An admin decides."""
    row = (await db.execute(select(
        DBUser.college_name, DBUser.teacher_of,
        exists().where(DBTeacherRequest.user_id == current_user_id, DBTeacherRequest.status == "pending").label("waiting"),
    ).where(DBUser.id == current_user_id))).first()
    if not row:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    college = (row.college_name or "").strip()
    if not college:
        raise HTTPException(status_code=400, detail="Add your college or institution to your profile first.")
    if (row.teacher_of or "").strip():
        raise HTTPException(status_code=400, detail="You already have teacher access.")
    if row.waiting:
        raise HTTPException(status_code=400, detail="Your request is already waiting for an admin.")
    db.add(DBTeacherRequest(
        user_id=current_user_id, college_key=college_key_of(college), college_name=college,
        note=(body.note or "").strip()[:500], status="pending", requested_at=utc_now_iso()
    ))
    await db.flush()
    return {"status": "pending", "college": college}


@app.get("/api/admin/teacher-requests")
async def get_teacher_requests(admin_data: dict = Depends(get_founder_admin)):
    """Teacher-access requests, the waiting ones first."""
    rows = await fetch_one_off(
        select(DBTeacherRequest, DBUser.name, DBUser.email, DBUser.profession, DBUser.account_status)
        .outerjoin(DBUser, DBUser.id == DBTeacherRequest.user_id)
        .order_by(case((DBTeacherRequest.status == "pending", 0), else_=1), DBTeacherRequest.id.desc()).limit(200)
    )
    return [{
        "id": req.id, "user_id": req.user_id, "name": name or f"User #{req.user_id}", "email": email or "",
        "profession": profession or "", "account_status": account_status or "pending",
        "college": req.college_name or req.college_key, "note": req.note or "", "status": req.status or "pending",
        "requested_at": req.requested_at or "",
    } for req, name, email, profession, account_status in rows]


@app.post("/api/admin/teacher-requests/{request_id}")
async def decide_teacher_request(request_id: int, decision: TeacherDecision, db: AsyncSession = Depends(get_fast_db), admin_data: dict = Depends(get_founder_admin)):
    if decision.action not in ("approve", "decline"):
        raise HTTPException(status_code=400, detail="Action must be approve or decline.")
    status_now = "approved" if decision.action == "approve" else "declined"
    result = await db.execute(
        update(DBTeacherRequest).where(DBTeacherRequest.id == request_id, DBTeacherRequest.status == "pending")
        .values(status=status_now, decided_by=int(admin_data["sub"]), decided_at=utc_now_iso())
        .returning(DBTeacherRequest.user_id, DBTeacherRequest.college_key, DBTeacherRequest.college_name)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="That request was not found or has already been decided.")
    user_id, key, college = row
    if status_now == "approved":
        await db.execute(update(DBUser).where(DBUser.id == user_id).values(teacher_of=key))
        await ensure_institution_trial(key, college)
        message = f"You now have teacher access for {college} on College Hub."
        hub_changed(key)
    else:
        message = f"Your request for teacher access for {college} was declined."
    spawn_background(create_notification(user_id, "account", message, utc_now_iso(), "college-hub.html"))
    return {"id": request_id, "status": status_now}


@app.post("/api/admin/users/{user_id}/teacher")
async def set_teacher_access(user_id: int, flag: TeacherFlag, db: AsyncSession = Depends(get_fast_db), admin_data: dict = Depends(get_founder_admin)):
    """Give teacher access for the college on the person's own profile, or take it away."""
    row = (await db.execute(select(DBUser.college_name, DBUser.teacher_of).where(DBUser.id == user_id))).first()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found.")
    old_key = (row.teacher_of or "").strip()
    new_key = college_key_of(row.college_name) if flag.teacher else ""
    if flag.teacher and not new_key:
        raise HTTPException(status_code=400, detail="This account has no college on its profile.")
    await db.execute(update(DBUser).where(DBUser.id == user_id).values(teacher_of=new_key))
    if new_key:
        await ensure_institution_trial(new_key, (row.college_name or "").strip())
    for key in {old_key, new_key} - {""}:
        hub_changed(key)
    if old_key != new_key:
        message = "You now have teacher access on College Hub." if new_key else "Your teacher access on College Hub was removed."
        spawn_background(create_notification(user_id, "account", message, utc_now_iso(), "college-hub.html"))
    return {"id": user_id, "teacher_of": new_key}


# ---------- the switch ----------
@app.put("/api/college-hub/settings")
async def update_hub_settings(body: HubSettings, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    values = {"students_can_form_groups": 1 if body.students_can_form_groups else 0, "updated_by": current_user_id, "updated_at": utc_now_iso()}
    await db.execute(
        pg_insert(DBCollegeSetting).values(college_key=me["key"], **values)
        .on_conflict_do_update(index_elements=["college_key"], set_=values)
    )
    hub_changed(me["key"])
    return {"students_can_form_groups": body.students_can_form_groups}


# ---------- notice board ----------
def clean_hub_post(body: HubPostBody, default_students_form: bool) -> dict:
    kind = body.kind if body.kind in HUB_POST_KINDS else "notice"
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Give the post a title.")
    if len(title) > 120:
        raise HTTPException(status_code=400, detail="The title is too long. The limit is 120 characters.")
    text_body = (body.body or "").strip()
    if len(text_body) > 4000:
        raise HTTPException(status_code=400, detail="The text is too long. The limit is 4000 characters.")
    department, division = (body.department or "").strip()[:120], (body.division or "").strip()[:40]
    if division and not department:
        raise HTTPException(status_code=400, detail="Pick a department before a division.")
    values = {"kind": kind, "title": title, "body": text_body, "department": department, "division": division, "pinned": 1 if body.pinned else 0}
    options = []   # in the order given, without repeats
    for option in body.poll_options or []:
        option = (option or "").strip()[:120]
        if option and college_key_of(option) not in {college_key_of(have) for have in options}:
            options.append(option)
    if len(options) == 1:
        raise HTTPException(status_code=400, detail="A poll needs at least two choices.")
    if len(options) > HUB_MAX_POLL_OPTIONS:
        raise HTTPException(status_code=400, detail=f"A poll can have up to {HUB_MAX_POLL_OPTIONS} choices.")
    values.update({"poll_options": json.dumps(options), "poll_multi": 1 if options and body.poll_multi else 0, "needs_ack": 1 if body.needs_ack else 0})
    if kind != "activity":
        return values

    accepts_work = bool(body.accepts_work)
    submit_by = (body.submit_by or "").strip() if accepts_work else ""
    if submit_by and not HUB_DATE_PATTERN.match(submit_by):
        raise HTTPException(status_code=400, detail="The date to hand in work by must be a date.")
    max_marks = (body.max_marks or 0) if accepts_work else 0
    if not (0 <= max_marks <= 1000):
        raise HTTPException(status_code=400, detail="Marks can go from 0 up to 1000.")
    values.update({"accepts_work": 1 if accepts_work else 0, "submit_by": submit_by, "max_marks": max_marks, "weekly_checkins": 1 if body.weekly_checkins else 0})

    group_min, group_max = body.group_min or 1, body.group_max or HUB_MAX_GROUP_SIZE
    if not (1 <= group_min <= group_max <= HUB_MAX_GROUP_SIZE):
        raise HTTPException(status_code=400, detail=f"Group size must be between 1 and {HUB_MAX_GROUP_SIZE}, with the smallest not above the largest.")
    deadline = (body.deadline or "").strip()
    if deadline and not HUB_DATE_PATTERN.match(deadline):
        raise HTTPException(status_code=400, detail="The deadline must be a date.")
    topics = []   # in the order given, without repeats (whatever their capitals)
    for topic in body.topics or []:
        topic = (topic or "").strip()[:80]
        if topic and college_key_of(topic) not in {college_key_of(have) for have in topics}:
            topics.append(topic)
    if len(topics) > HUB_MAX_TOPICS:
        raise HTTPException(status_code=400, detail=f"An activity can list up to {HUB_MAX_TOPICS} topics.")
    students_form = default_students_form if body.students_form_groups is None else body.students_form_groups
    values.update({"group_min": group_min, "group_max": group_max, "deadline": deadline, "topics": json.dumps(topics), "students_form_groups": 1 if students_form else 0})
    return values

async def hub_post_audience(key: str, department: str, division: str, without: int) -> list:
    """Students a post is addressed to."""
    conditions = [hub_student_clause(key), DBUser.id != without]
    if department:
        conditions.append(func.lower(func.trim(func.coalesce(DBUser.department, ""))) == college_key_of(department))
    if division:
        conditions.append(func.lower(func.trim(func.coalesce(DBUser.division, ""))) == college_key_of(division))
    rows = await fetch_one_off(select(DBUser.id).where(*conditions).limit(HUB_PEOPLE_LIMIT))
    return [row[0] for row in rows]

async def announce_hub_post(key: str, values: dict, author_id: int):
    label = "New activity" if values["kind"] == "activity" else "New notice"
    audience = await hub_post_audience(key, values["department"], values["division"], author_id)
    await notify_many(audience, "college", f"{label} on College Hub: {values['title']}", "college-hub.html")


@app.post("/api/college-hub/posts")
async def create_hub_post(body: HubPostBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    setting = (await db.execute(select(DBCollegeSetting.students_can_form_groups).where(DBCollegeSetting.college_key == me["key"]))).first()
    values = clean_hub_post(body, bool(setting[0]) if setting else True)
    now_iso = utc_now_iso()
    post = DBCollegePost(college_key=me["key"], author_id=current_user_id, created_at=now_iso, updated_at=now_iso, **values)
    db.add(post)
    await db.flush()
    spawn_background(announce_hub_post(me["key"], values, current_user_id))
    hub_changed(me["key"])
    return serialize_hub_post(post)


@app.put("/api/college-hub/posts/{post_id}")
async def update_hub_post(post_id: int, body: HubPostBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    post = (await db.execute(select(DBCollegePost).where(DBCollegePost.id == post_id, DBCollegePost.college_key == me["key"]))).scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="That post is no longer on the board.")
    body.kind = post.kind   # a notice stays a notice and an activity an activity: groups may already hang on it
    values = clean_hub_post(body, bool(post.students_form_groups))
    poll_changed = values["poll_options"] != (post.poll_options or "[]") or values["poll_multi"] != (post.poll_multi or 0)
    if poll_changed and (await db.execute(select(exists().where(DBCollegePollVote.post_id == post_id)))).scalar():
        raise HTTPException(status_code=400, detail="People have already voted, so the poll's choices can no longer change.")
    for field, value in values.items():
        setattr(post, field, value)
    post.updated_at = utc_now_iso()
    await db.flush()
    hub_changed(me["key"])
    return serialize_hub_post(post)


@app.delete("/api/college-hub/posts/{post_id}")
async def delete_hub_post(post_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Removes a post. Groups formed for a deleted activity are kept, as groups of no activity."""
    me = await require_hub_teacher(current_user_id)
    result = await db.execute(delete(DBCollegePost).where(DBCollegePost.id == post_id, DBCollegePost.college_key == me["key"]).returning(DBCollegePost.id))
    if not result.first():
        raise HTTPException(status_code=404, detail="That post is no longer on the board.")
    await asyncio.gather(
        run_one_off(update(DBTeam).where(DBTeam.college_key == me["key"], DBTeam.activity_id == post_id).values(activity_id=None)),
        run_one_off(delete(DBCollegePollVote).where(DBCollegePollVote.post_id == post_id)),
        run_one_off(delete(DBCollegePostRead).where(DBCollegePostRead.post_id == post_id)),
        run_one_off(delete(DBCollegeSubmission).where(DBCollegeSubmission.activity_id == post_id)),
    )
    hub_changed(me["key"])
    return {"status": "deleted"}


# ---------- groups ----------
async def hub_group_context(key: str, activity_id: Optional[int], group_id: Optional[int] = None) -> dict:
    """What every group rule needs, read side by side: the activity, the switch, who is already in a group of
    that activity, which topics are taken, who the college's teachers are, and (for one group) its row and members."""
    reads = [
        fetch_one_off(select(DBCollegeSetting.students_can_form_groups).where(DBCollegeSetting.college_key == key)),
        fetch_one_off(select(DBUser.id).where(DBUser.teacher_of == key)),
    ]
    if activity_id is not None:
        reads.append(fetch_one_off(select(DBCollegePost).where(DBCollegePost.id == activity_id, DBCollegePost.college_key == key, DBCollegePost.kind == "activity")))
        reads.append(fetch_one_off(
            select(DBTeamMember.user_id, DBTeam.id, DBTeam.topic)
            .join(DBTeam, DBTeam.id == DBTeamMember.team_id)
            .where(DBTeam.college_key == key, DBTeam.activity_id == activity_id)
        ))
        reads.append(fetch_one_off(select(DBTeam.id, DBTeam.topic).where(DBTeam.college_key == key, DBTeam.activity_id == activity_id)))
    results = await asyncio.gather(*reads)
    context = {
        "students_allowed": bool(results[0][0][0]) if results[0] else True,
        "teacher_ids": {row[0] for row in results[1]},
        "activity": None, "group_of": {}, "topics_taken": {},
    }
    if activity_id is not None:
        if not results[2]:
            raise HTTPException(status_code=404, detail="That activity is no longer on the board.")
        context["activity"] = results[2][0][0]
        context["group_of"] = {user_id: team_id for user_id, team_id, _ in results[3] if user_id not in context["teacher_ids"]}
        context["topics_taken"] = {college_key_of(topic): team_id for team_id, topic in results[4] if topic}
    return context

def refuse_student_group_change(context: dict):
    """Raises when students are not the ones forming groups right now."""
    activity = context["activity"]
    if activity is not None:
        if not activity.students_form_groups:
            raise HTTPException(status_code=403, detail="Teachers are forming the groups for this activity.")
        if deadline_passed(activity.deadline):
            raise HTTPException(status_code=403, detail="The deadline for forming groups has passed.")
    elif not context["students_allowed"]:
        raise HTTPException(status_code=403, detail="Teachers have turned off student-made groups.")

def check_group_topic(context: dict, topic: str, own_group_id: Optional[int] = None) -> str:
    topic = (topic or "").strip()[:80]
    activity = context["activity"]
    if not topic or activity is None:
        return topic
    listed = json.loads(activity.topics or "[]")
    if listed:
        match = next((item for item in listed if college_key_of(item) == college_key_of(topic)), None)
        if match is None:
            raise HTTPException(status_code=400, detail="Pick one of the topics listed for this activity.")
        topic = match
    holder = context["topics_taken"].get(college_key_of(topic))
    if holder is not None and holder != own_group_id:
        raise HTTPException(status_code=400, detail="Another group has already taken that topic.")
    return topic

async def hub_student_ids(key: str, ids) -> set:
    """Which of these ids are students of the college."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        return set()
    rows = await fetch_one_off(select(DBUser.id).where(DBUser.id.in_(ids), hub_student_clause(key)))
    return {row[0] for row in rows}

def check_new_members(context: dict, student_ids: set, wanted: list, size_after: int):
    """Shared by create, add and move: real students of the college, not already grouped for the activity, within the size."""
    outsiders = [user_id for user_id in wanted if user_id not in student_ids]
    if outsiders:
        raise HTTPException(status_code=400, detail="Only students of this college can be put in a group.")
    activity = context["activity"]
    if activity is None:
        if size_after > HUB_MAX_GROUP_SIZE:
            raise HTTPException(status_code=400, detail=f"A group can have up to {HUB_MAX_GROUP_SIZE} students.")
        return
    taken = [user_id for user_id in wanted if user_id in context["group_of"]]
    if taken:
        raise HTTPException(status_code=400, detail="Someone you picked is already in a group for this activity." if len(wanted) > 1 else "That student is already in a group for this activity.")
    if size_after > (activity.group_max or HUB_MAX_GROUP_SIZE):
        raise HTTPException(status_code=400, detail=f"Groups for this activity can have up to {activity.group_max} students.")

async def create_college_group(key: str, creator_id: int, name: str, topic: str, activity_id: Optional[int], member_ids: list, teacher_managed: bool, open_to_join: bool) -> int:
    """A team that belongs to a college. Like any team it starts with its creator as Admin, #general and a voice room."""
    now_iso = utc_now_iso()
    async with AutocommitSession() as db:
        team = DBTeam(
            name=name[:80], description="", created_by=creator_id, created_at=now_iso, avatar_url="",
            college_key=key, activity_id=activity_id, topic=topic,
            teacher_managed=1 if teacher_managed else 0, open_to_join=1 if open_to_join else 0,
        )
        db.add(team)
        await db.flush()
        team_id = team.id
    members = [{"team_id": team_id, "user_id": creator_id, "role": "Admin", "joined_at": now_iso}]
    members += [{"team_id": team_id, "user_id": user_id, "role": "Member", "joined_at": now_iso} for user_id in dict.fromkeys(member_ids) if user_id != creator_id]
    await asyncio.gather(
        run_one_off(DBTeamMember.__table__.insert().values(members)),
        run_one_off(DBChannel.__table__.insert().values([
            {"team_id": team_id, "name": "general", "channel_type": "text", "created_at": now_iso},
            {"team_id": team_id, "name": "voice-lounge", "channel_type": "voice", "created_at": now_iso},
        ])),
    )
    return team_id

async def hub_group_row(key: str, group_id: int):
    """(team, [(user_id, role)]) for a group of this college. 404 if there is no such group."""
    team_rows, member_rows = await asyncio.gather(
        fetch_one_off(select(DBTeam).where(DBTeam.id == group_id, DBTeam.college_key == key)),
        fetch_one_off(select(DBTeamMember.user_id, DBTeamMember.role).where(DBTeamMember.team_id == group_id)),
    )
    if not team_rows:
        raise HTTPException(status_code=404, detail="That group no longer exists.")
    return team_rows[0][0], [(user_id, role) for user_id, role in member_rows]

async def take_over_group(team, members: list, teacher_id: int):
    """A teacher is taking the group's creator out of it: the teacher becomes the creator, so the group lives on."""
    await run_one_off(update(DBTeam).where(DBTeam.id == team.id).values(created_by=teacher_id, teacher_managed=1, open_to_join=0))
    if not any(user_id == teacher_id for user_id, _ in members):
        await run_one_off(DBTeamMember.__table__.insert().values(team_id=team.id, user_id=teacher_id, role="Admin", joined_at=utc_now_iso()))
    else:
        await run_one_off(update(DBTeamMember).where(DBTeamMember.team_id == team.id, DBTeamMember.user_id == teacher_id).values(role="Admin"))

def may_manage_group(me: dict, team, members: list) -> bool:
    """A teacher manages every group of the college; a student manages a group they are Admin of, unless a teacher fixed it."""
    if me["role"] == "teacher":
        return True
    return not team.teacher_managed and any(user_id == me["id"] and role == "Admin" for user_id, role in members)


@app.post("/api/college-hub/groups")
async def create_hub_group(body: HubGroupCreate, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    key, is_teacher = me["key"], me["role"] == "teacher"
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the group a name.")
    wanted = [user_id for user_id in dict.fromkeys(body.member_ids or []) if user_id != current_user_id]
    context, student_ids = await asyncio.gather(
        hub_group_context(key, body.activity_id),
        hub_student_ids(key, wanted + [current_user_id]),
    )
    if not is_teacher:
        refuse_student_group_change(context)
        if context["activity"] is not None and not post_is_for(context["activity"], me):
            raise HTTPException(status_code=403, detail="This activity is for another class.")
        wanted_with_me = wanted + [current_user_id]
    else:
        wanted_with_me = wanted
    check_new_members(context, student_ids, wanted_with_me, len(wanted_with_me))
    topic = check_group_topic(context, body.topic)

    group_id = await create_college_group(key, current_user_id, name, topic, body.activity_id, wanted, teacher_managed=is_teacher, open_to_join=bool(body.open_to_join) and not is_teacher)
    spawn_background(notify_many(wanted, "team_invite", f"You were added to the group {name[:80]} on College Hub.", "college-hub.html"))
    spawn_background(log_activity_later(current_user_id, "Team Created", f"You created the college group {name[:80]}."))
    hub_changed(key)
    return {"id": group_id}


@app.put("/api/college-hub/groups/{group_id}")
async def update_hub_group(group_id: int, body: HubGroupUpdate, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    team, members = await hub_group_row(me["key"], group_id)
    if not may_manage_group(me, team, members):
        raise HTTPException(status_code=403, detail="Only a teacher, or the student who runs this group, can change it.")
    values = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Give the group a name.")
        values["name"] = name[:80]
    if body.topic is not None:
        context = await hub_group_context(me["key"], team.activity_id)
        values["topic"] = check_group_topic(context, body.topic, own_group_id=group_id)
    if body.open_to_join is not None:
        values["open_to_join"] = 1 if body.open_to_join else 0
    if body.teacher_managed is not None:
        if me["role"] != "teacher":
            raise HTTPException(status_code=403, detail="Only a teacher can lock or unlock a group.")
        values["teacher_managed"] = 1 if body.teacher_managed else 0
        if body.teacher_managed:
            values["open_to_join"] = 0
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    await db.execute(update(DBTeam).where(DBTeam.id == group_id).values(**values))
    hub_changed(me["key"])
    return {"id": group_id, **values}


@app.post("/api/college-hub/groups/{group_id}/members")
async def add_hub_group_member(group_id: int, body: HubMemberAdd, current_user_id: int = Depends(get_current_user_id)):
    """A teacher or the student running the group adds someone; a student may also add themselves to an open group."""
    me = await require_hub_member(current_user_id)
    key = me["key"]
    team, members = await hub_group_row(key, group_id)
    joining_self = body.user_id == current_user_id and me["role"] == "student" and bool(team.open_to_join) and not team.teacher_managed
    if not joining_self and not may_manage_group(me, team, members):
        raise HTTPException(status_code=403, detail="Only a teacher, or the student who runs this group, can add people.")
    if any(user_id == body.user_id for user_id, _ in members):
        raise HTTPException(status_code=400, detail="That student is already in this group.")
    context, student_ids = await asyncio.gather(hub_group_context(key, team.activity_id), hub_student_ids(key, [body.user_id]))
    if me["role"] != "teacher":
        refuse_student_group_change(context)
    size_now = sum(1 for user_id, _ in members if user_id not in context["teacher_ids"])
    check_new_members(context, student_ids, [body.user_id], size_now + 1)

    await run_one_off(DBTeamMember.__table__.insert().values(team_id=group_id, user_id=body.user_id, role="Member", joined_at=utc_now_iso()))
    if not joining_self:
        spawn_background(notify_many([body.user_id], "team_invite", f"You were added to the group {team.name} on College Hub.", "college-hub.html"))
    spawn_background(broadcast_members(group_id))
    hub_changed(key)
    return {"status": "added"}


@app.delete("/api/college-hub/groups/{group_id}/members/{user_id}")
async def remove_hub_group_member(group_id: int, user_id: int, current_user_id: int = Depends(get_current_user_id)):
    """A teacher or the student running the group removes someone; a student may also leave a group that is not locked."""
    me = await require_hub_member(current_user_id)
    key = me["key"]
    team, members = await hub_group_row(key, group_id)
    leaving = user_id == current_user_id
    if leaving and team.teacher_managed and me["role"] != "teacher":
        raise HTTPException(status_code=403, detail="This group was set by your teachers. Ask a teacher to move you.")
    if not leaving and not may_manage_group(me, team, members):
        raise HTTPException(status_code=403, detail="Only a teacher, or the student who runs this group, can remove people.")
    if not any(member_id == user_id for member_id, _ in members):
        raise HTTPException(status_code=404, detail="That student is not in this group.")
    if user_id == team.created_by:
        if me["role"] != "teacher":
            raise HTTPException(status_code=400, detail="The person who created the group stays in it. Delete the group instead.")
        await take_over_group(team, members, current_user_id)
    if me["role"] != "teacher":
        refuse_student_group_change(await hub_group_context(key, team.activity_id))

    await run_one_off(delete(DBTeamMember).where(DBTeamMember.team_id == group_id, DBTeamMember.user_id == user_id))
    await evict_from_team(group_id, user_id, "left" if leaving else "removed")
    spawn_background(broadcast_members(group_id))
    hub_changed(key)
    return {"status": "left" if leaving else "removed"}


@app.post("/api/college-hub/groups/{group_id}/move")
async def move_hub_group_member(group_id: int, body: HubMove, current_user_id: int = Depends(get_current_user_id)):
    """A teacher moves a student from this group to another group of the same activity."""
    me = await require_hub_teacher(current_user_id)
    key = me["key"]
    if body.to_group_id == group_id:
        raise HTTPException(status_code=400, detail="The student is already in that group.")
    (team, members), (target, target_members) = await asyncio.gather(hub_group_row(key, group_id), hub_group_row(key, body.to_group_id))
    if target.activity_id != team.activity_id:
        raise HTTPException(status_code=400, detail="Both groups must belong to the same activity.")
    if not any(user_id == body.user_id for user_id, _ in members):
        raise HTTPException(status_code=404, detail="That student is not in this group.")
    if body.user_id == team.created_by:
        await take_over_group(team, members, current_user_id)
    context, student_ids = await asyncio.gather(hub_group_context(key, team.activity_id), hub_student_ids(key, [body.user_id]))
    context["group_of"].pop(body.user_id, None)   # they are leaving their current group in the same step
    size_now = sum(1 for user_id, _ in target_members if user_id not in context["teacher_ids"])
    check_new_members(context, student_ids, [body.user_id], size_now + 1)

    async with AutocommitSession() as db:
        await db.execute(delete(DBTeamMember).where(DBTeamMember.team_id == group_id, DBTeamMember.user_id == body.user_id))
        await db.execute(DBTeamMember.__table__.insert().values(team_id=body.to_group_id, user_id=body.user_id, role="Member", joined_at=utc_now_iso()))
    await evict_from_team(group_id, body.user_id, "removed")
    spawn_background(notify_many([body.user_id], "team_invite", f"A teacher moved you to the group {target.name} on College Hub.", "college-hub.html"))
    spawn_background(broadcast_members(group_id))
    spawn_background(broadcast_members(body.to_group_id))
    hub_changed(key)
    return {"status": "moved"}


@app.delete("/api/college-hub/groups/{group_id}")
async def delete_hub_group(group_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    team, members = await hub_group_row(me["key"], group_id)
    if me["role"] != "teacher" and (team.teacher_managed or team.created_by != current_user_id):
        raise HTTPException(status_code=403, detail="Only a teacher, or the student who created this group, can delete it.")
    await purge_team(db, group_id)
    await team_hub.broadcast(group_id, {"type": "team_deleted", "team_id": group_id})
    spawn_background(log_activity_later(current_user_id, "Workspace Deleted", f"You deleted the college group {team.name}."))
    hub_changed(me["key"])
    return {"status": "deleted"}


# ---------- activities: who is left over ----------
async def hub_unassigned(key: str, activity) -> list:
    """Students an activity is addressed to who are in no group for it, as (id, name) in name order."""
    conditions = [hub_student_clause(key)]
    if activity.department:
        conditions.append(func.lower(func.trim(func.coalesce(DBUser.department, ""))) == college_key_of(activity.department))
    if activity.division:
        conditions.append(func.lower(func.trim(func.coalesce(DBUser.division, ""))) == college_key_of(activity.division))
    grouped = select(DBTeamMember.user_id).join(DBTeam, DBTeam.id == DBTeamMember.team_id).where(DBTeam.college_key == key, DBTeam.activity_id == activity.id)
    rows = await fetch_one_off(select(DBUser.id, DBUser.name).where(*conditions, DBUser.id.not_in(grouped)).order_by(DBUser.name).limit(HUB_PEOPLE_LIMIT))
    return [(row.id, row.name or "") for row in rows]

async def hub_activity_or_404(key: str, activity_id: int):
    rows = await fetch_one_off(select(DBCollegePost).where(DBCollegePost.id == activity_id, DBCollegePost.college_key == key, DBCollegePost.kind == "activity"))
    if not rows:
        raise HTTPException(status_code=404, detail="That activity is no longer on the board.")
    return rows[0][0]


@app.post("/api/college-hub/activities/{activity_id}/remind")
async def remind_hub_activity(activity_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Nudge the students who have no group yet."""
    me = await require_hub_teacher(current_user_id)
    activity = await hub_activity_or_404(me["key"], activity_id)
    waiting = await hub_unassigned(me["key"], activity)
    spawn_background(notify_many([user_id for user_id, _ in waiting], "college", f"You are not in a group yet for: {activity.title}", "college-hub.html"))
    return {"reminded": len(waiting)}


@app.post("/api/college-hub/activities/{activity_id}/autofill")
async def autofill_hub_activity(activity_id: int, body: HubAutofill, current_user_id: int = Depends(get_current_user_id)):
    """Create one group for each list of students. The page proposes the lists (the left-over students, shuffled);
    every rule is checked again here, so a list that has gone stale is refused as a whole."""
    me = await require_hub_teacher(current_user_id)
    key = me["key"]
    activity, existing = await asyncio.gather(
        hub_activity_or_404(key, activity_id),
        fetch_one_off(select(func.count()).select_from(DBTeam).where(DBTeam.college_key == key, DBTeam.activity_id == activity_id)),
    )
    groups = [list(dict.fromkeys(group)) for group in body.groups if group]
    everyone = [user_id for group in groups for user_id in group]
    if not groups:
        raise HTTPException(status_code=400, detail="There is no one left to place.")
    if len(everyone) != len(set(everyone)):
        raise HTTPException(status_code=400, detail="A student appears in two of the proposed groups.")
    waiting = {user_id for user_id, _ in await hub_unassigned(key, activity)}
    if not set(everyone) <= waiting:
        raise HTTPException(status_code=400, detail="The list has changed since it was made. Open Auto-fill again.")
    if any(len(group) > (activity.group_max or HUB_MAX_GROUP_SIZE) for group in groups):
        raise HTTPException(status_code=400, detail=f"Groups for this activity can have up to {activity.group_max} students.")

    if len(groups) > HUB_MAX_TOPICS:
        raise HTTPException(status_code=400, detail=f"Auto-fill makes up to {HUB_MAX_TOPICS} groups at a time.")

    # One after another: each group opens a few connections of its own and the pool is small
    first_number = (existing[0][0] or 0) + 1
    for n, group in enumerate(groups):
        await create_college_group(key, current_user_id, f"Group {first_number + n}", "", activity_id, group, teacher_managed=True, open_to_join=False)
    spawn_background(notify_many(everyone, "team_invite", f"A teacher placed you in a group for: {activity.title}", "college-hub.html"))
    hub_changed(key)
    return {"created": len(groups)}


# ---------- chat ----------
def hub_room_allowed(me: dict, room: str) -> bool:
    if room == HUB_COLLEGE_ROOM:
        return True
    if not room.startswith("class:") or "|" not in room:
        return False
    return me["role"] == "teacher" or room == me["room"]

def serialize_hub_message(message: DBCollegeMessage, name: Optional[str], picture: Optional[str], teacher_of: Optional[str]) -> dict:
    return {
        "id": message.id, "room": message.room, "sender_id": message.sender_id, "sender_name": name or f"User #{message.sender_id}",
        "sender_pic": picture if picture and len(picture) <= 1000 else "", "is_teacher": (teacher_of or "") == message.college_key,
        "content": message.content or "", "timestamp": message.timestamp or "",
    }


@app.get("/api/college-hub/chat")
async def get_hub_chat(room: str = HUB_COLLEGE_ROOM, before_id: Optional[int] = None, current_user_id: int = Depends(get_current_user_id)):
    """The newest messages of a room, oldest first. before_id pages back."""
    me = await require_hub_member(current_user_id)
    if not hub_room_allowed(me, room):
        raise HTTPException(status_code=403, detail="That chat room belongs to another class.")
    conditions = [DBCollegeMessage.college_key == me["key"], DBCollegeMessage.room == room]
    if before_id:
        conditions.append(DBCollegeMessage.id < before_id)
    rows = await fetch_one_off(
        select(DBCollegeMessage, DBUser.name, DBUser.profile_pic, DBUser.teacher_of)
        .outerjoin(DBUser, DBUser.id == DBCollegeMessage.sender_id)
        .where(*conditions).order_by(DBCollegeMessage.id.desc()).limit(HUB_CHAT_PAGE + 1)
    )
    has_more = len(rows) > HUB_CHAT_PAGE
    messages = [serialize_hub_message(message, name, picture, teacher_of) for message, name, picture, teacher_of in rows[:HUB_CHAT_PAGE]]
    return {"room": room, "messages": messages[::-1], "has_more": has_more}


@app.post("/api/college-hub/chat")
async def send_hub_chat(body: HubChatSend, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    if not hub_room_allowed(me, body.room):
        raise HTTPException(status_code=403, detail="That chat room belongs to another class.")
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message is empty.")
    if len(content) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=400, detail=f"Message is too long. The limit is {MAX_MESSAGE_LENGTH} characters.")
    message = DBCollegeMessage(college_key=me["key"], room=body.room, sender_id=current_user_id, content=content, timestamp=utc_now_iso())
    db.add(message)
    await db.flush()
    picture = (await db.execute(select(DBUser.profile_pic).where(DBUser.id == current_user_id))).scalar()
    saved = serialize_hub_message(message, me["name"], picture, me["key"] if me["role"] == "teacher" else "")
    spawn_background(hub_push(me["key"], {"type": "college_chat", "message": saved}, body.room))
    return saved


@app.delete("/api/college-hub/chat/{message_id}")
async def delete_hub_chat(message_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """You can delete your own message; a teacher can delete any message of their college."""
    me = await require_hub_member(current_user_id)
    conditions = [DBCollegeMessage.id == message_id, DBCollegeMessage.college_key == me["key"]]
    if me["role"] != "teacher":
        conditions.append(DBCollegeMessage.sender_id == current_user_id)
    result = await db.execute(delete(DBCollegeMessage).where(*conditions).returning(DBCollegeMessage.room))
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="That message is gone, or it is not yours to delete.")
    spawn_background(hub_push(me["key"], {"type": "college_chat_deleted", "id": message_id, "room": row[0]}, row[0]))
    return {"status": "deleted"}


# ==========================================
# 16. COLLEGE HUB: POLLS, READ CONFIRMATION, HANDED-IN WORK, CHECK-INS, CALENDAR, RESOURCES, ATTENDANCE, Q&A
# Everything here belongs to one college (college_key) and uses the section 15 rules for who sees what:
# an item with a department and a division is for that class, an empty department means the whole college.
# ==========================================
class DBCollegePollVote(Base):
    __tablename__ = "college_poll_votes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", "option_index", name="ux_college_poll_votes"),)
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    option_index = Column(Integer)

class DBCollegePostRead(Base):
    __tablename__ = "college_post_reads"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="ux_college_post_reads"),)
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    read_at = Column(String)

class DBCollegeSubmission(Base):
    """The work one group hands in for one activity."""
    __tablename__ = "college_submissions"
    __table_args__ = (UniqueConstraint("activity_id", "group_id", name="ux_college_submissions"),)
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    activity_id = Column(Integer, index=True)
    group_id = Column(Integer, index=True)
    submitted_by = Column(Integer)
    link = Column(String, default="")
    file_url = Column(String, default="")
    file_name = Column(String, default="")
    note = Column(String, default="")
    late = Column(Integer, default=0)
    submitted_at = Column(String)
    updated_at = Column(String)
    marks = Column(Integer, nullable=True)
    feedback = Column(String, default="")
    graded_by = Column(Integer, nullable=True)
    graded_at = Column(String, default="")

class DBGroupCheckin(Base):
    """A group's progress note for one week (the week is named by its Monday)."""
    __tablename__ = "group_checkins"
    __table_args__ = (UniqueConstraint("group_id", "week_start", name="ux_group_checkins"),)
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    group_id = Column(Integer, index=True)
    activity_id = Column(Integer, nullable=True)
    author_id = Column(Integer)
    week_start = Column(String)
    done = Column(String, default="")
    next_steps = Column(String, default="")
    blockers = Column(String, default="")
    teacher_note = Column(String, default="")
    teacher_id = Column(Integer, nullable=True)
    created_at = Column(String)
    updated_at = Column(String)

class DBCollegeEvent(Base):
    __tablename__ = "college_events"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    author_id = Column(Integer)
    title = Column(String)
    kind = Column(String, default="event")        # exam, lecture, event, holiday, other
    date = Column(String, index=True)             # YYYY-MM-DD
    start_time = Column(String, default="")       # HH:MM or empty
    end_time = Column(String, default="")
    location = Column(String, default="")
    details = Column(String, default="")
    department = Column(String, default="")
    division = Column(String, default="")
    created_at = Column(String)

class DBCollegeResource(Base):
    __tablename__ = "college_resources"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    author_id = Column(Integer)
    title = Column(String)
    url = Column(String, default="")
    file_url = Column(String, default="")
    file_name = Column(String, default="")
    description = Column(String, default="")
    subject = Column(String, default="")
    department = Column(String, default="")
    division = Column(String, default="")
    created_at = Column(String)

class DBCollegeResourceSave(Base):
    __tablename__ = "college_resource_saves"
    __table_args__ = (UniqueConstraint("resource_id", "user_id", name="ux_college_resource_saves"),)
    id = Column(Integer, primary_key=True, index=True)
    resource_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)

class DBAttendanceSession(Base):
    __tablename__ = "attendance_sessions"
    __table_args__ = (Index("ix_attendance_sessions_class", "college_key", "department", "division"),)
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    teacher_id = Column(Integer)
    department = Column(String, default="")       # as written on the students' profiles
    division = Column(String, default="")
    subject = Column(String, default="")
    date = Column(String)
    created_at = Column(String)

class DBAttendanceMark(Base):
    __tablename__ = "attendance_marks"
    __table_args__ = (UniqueConstraint("session_id", "user_id", name="ux_attendance_marks"),)
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    status = Column(String, default="present")    # present, absent, late

class DBCollegeQuestion(Base):
    __tablename__ = "college_questions"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    author_id = Column(Integer, index=True)
    anonymous = Column(Integer, default=0)        # hidden from students; teachers still see who asked
    title = Column(String)
    body = Column(String, default="")
    subject = Column(String, default="")
    department = Column(String, default="")       # empty: asked to the whole college
    division = Column(String, default="")
    accepted_answer_id = Column(Integer, nullable=True)
    created_at = Column(String)

class DBCollegeAnswer(Base):
    __tablename__ = "college_answers"
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, index=True)
    author_id = Column(Integer)
    body = Column(String)
    created_at = Column(String)

class DBCollegeQuestionVote(Base):
    __tablename__ = "college_question_votes"
    __table_args__ = (UniqueConstraint("question_id", "user_id", name="ux_college_question_votes"),)
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)


HUB_EVENT_KINDS = ("exam", "lecture", "event", "holiday", "other")
HUB_ATTENDANCE_STATUSES = ("present", "absent", "late")
HUB_ATTENDANCE_LOW = 75          # per cent; a student who drops below it is told once
HUB_ATTENDANCE_MIN_SESSIONS = 4  # ...but not before there are enough sessions for the figure to mean something
HUB_EVENTS_PAST_DAYS = 60
HUB_TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")
HUB_LINK_PATTERN = re.compile(r"^https?://", re.IGNORECASE)


class HubVote(BaseModel):
    options: List[int]

class HubSubmission(BaseModel):
    link: Optional[str] = ""
    file_url: Optional[str] = ""
    file_name: Optional[str] = ""
    note: Optional[str] = ""

class HubGrade(BaseModel):
    marks: Optional[int] = None
    feedback: Optional[str] = ""

class HubCheckin(BaseModel):
    done: Optional[str] = ""
    next_steps: Optional[str] = ""
    blockers: Optional[str] = ""

class HubCheckinNote(BaseModel):
    teacher_note: Optional[str] = ""

class HubEventBody(BaseModel):
    title: str
    kind: Optional[str] = "event"
    date: str
    start_time: Optional[str] = ""
    end_time: Optional[str] = ""
    location: Optional[str] = ""
    details: Optional[str] = ""
    department: Optional[str] = ""
    division: Optional[str] = ""

class HubResourceBody(BaseModel):
    title: str
    url: Optional[str] = ""
    file_url: Optional[str] = ""
    file_name: Optional[str] = ""
    description: Optional[str] = ""
    subject: Optional[str] = ""
    department: Optional[str] = ""
    division: Optional[str] = ""

class HubAttendanceBody(BaseModel):
    department: Optional[str] = ""
    division: Optional[str] = ""
    subject: Optional[str] = ""
    date: str
    marks: dict

class HubQuestionBody(BaseModel):
    title: str
    body: Optional[str] = ""
    subject: Optional[str] = ""
    to_class: Optional[bool] = False
    anonymous: Optional[bool] = False

class HubAnswerBody(BaseModel):
    body: str

class HubAccept(BaseModel):
    answer_id: Optional[int] = None


# ---------- small shared pieces ----------
def clean_link(value: Optional[str], what: str) -> str:
    """A web address people will click: only http(s), so nothing can run script from the page."""
    value = (value or "").strip()[:1000]
    if value and not HUB_LINK_PATTERN.match(value):
        raise HTTPException(status_code=400, detail=f"The {what} must start with http:// or https://.")
    return value

def clean_text(value: Optional[str], limit: int, what: str) -> str:
    value = (value or "").strip()
    if len(value) > limit:
        raise HTTPException(status_code=400, detail=f"The {what} is too long. The limit is {limit} characters.")
    return value

def clean_audience(department: Optional[str], division: Optional[str]) -> tuple:
    department, division = (department or "").strip()[:120], (division or "").strip()[:40]
    if division and not department:
        raise HTTPException(status_code=400, detail="Pick a department before a division.")
    return department, division

def week_start_of(day) -> str:
    return (day - timedelta(days=day.weekday())).isoformat()

def this_week() -> str:
    return week_start_of(datetime.now().date())

def class_clause(key: str, department: str, division: str):
    """The students of one class of a college. An empty division means the whole department."""
    conditions = [hub_student_clause(key), func.lower(func.trim(func.coalesce(DBUser.department, ""))) == college_key_of(department)]
    if division:
        conditions.append(func.lower(func.trim(func.coalesce(DBUser.division, ""))) == college_key_of(division))
    return and_(*conditions)

async def hub_teacher_ids(key: str) -> list:
    rows = await fetch_one_off(select(DBUser.id).where(DBUser.teacher_of == key))
    return [row[0] for row in rows]

async def hub_push_teachers(key: str, payload: dict):
    """A live event for the college's teachers only. Meant to run in the background."""
    try:
        message = json.dumps(payload)
        for user_id in await hub_teacher_ids(key):
            await notification_manager.send_personal_message(message, user_id)
    except Exception as e:
        print("Error pushing a College Hub event to teachers:", e)

async def hub_post_or_404(key: str, post_id: int):
    rows = await fetch_one_off(select(DBCollegePost).where(DBCollegePost.id == post_id, DBCollegePost.college_key == key))
    if not rows:
        raise HTTPException(status_code=404, detail="That post is no longer on the board.")
    return rows[0][0]


# ---------- what the board needs, in one round trip ----------
HUB_EXTRAS_SQL = text("""
SELECT
  (SELECT coalesce(json_agg(json_build_array(v.post_id, v.user_id, v.option_index)), '[]')
     FROM college_poll_votes v JOIN college_posts p ON p.id = v.post_id WHERE p.college_key = :key) AS votes,
  (SELECT coalesce(json_agg(json_build_array(r.post_id, r.user_id)), '[]')
     FROM college_post_reads r JOIN college_posts p ON p.id = r.post_id
     WHERE p.college_key = :key AND (:teacher OR r.user_id = :me)) AS reads,
  (SELECT coalesce(json_agg(json_build_object(
       'id', s.id, 'activity_id', s.activity_id, 'group_id', s.group_id, 'submitted_by', s.submitted_by,
       'link', s.link, 'file_url', s.file_url, 'file_name', s.file_name, 'note', s.note, 'late', s.late = 1,
       'submitted_at', s.submitted_at, 'updated_at', s.updated_at, 'marks', s.marks, 'feedback', s.feedback,
       'graded', s.graded_at <> '', 'graded_at', s.graded_at)), '[]')
     FROM college_submissions s WHERE s.college_key = :key) AS submissions,
  (SELECT coalesce(json_agg(json_build_object(
       'id', c.id, 'group_id', c.group_id, 'week_start', c.week_start, 'author_id', c.author_id,
       'updated_at', c.updated_at, 'has_note', c.teacher_note <> '')), '[]')
     FROM (SELECT DISTINCT ON (group_id) * FROM group_checkins WHERE college_key = :key ORDER BY group_id, week_start DESC) c) AS checkins,
  (SELECT coalesce(json_agg(json_build_object(
       'id', e.id, 'title', e.title, 'kind', e.kind, 'date', e.date, 'start_time', e.start_time, 'end_time', e.end_time,
       'location', e.location, 'details', e.details, 'department', e.department, 'division', e.division,
       'author_id', e.author_id) ORDER BY e.date, e.start_time), '[]')
     FROM college_events e WHERE e.college_key = :key AND e.date >= :since) AS events
""")

async def hub_extras(key: str, me: dict) -> dict:
    since = (datetime.now().date() - timedelta(days=HUB_EVENTS_PAST_DAYS)).isoformat()
    rows = await fetch_one_off(HUB_EXTRAS_SQL.bindparams(key=key, teacher=me["role"] == "teacher", me=me["id"], since=since))
    loaded = [json.loads(value) if isinstance(value, str) else (value or []) for value in rows[0]]
    votes, reads, submissions, checkins, events = loaded
    return {"votes": votes, "reads": reads, "submissions": submissions, "checkins": checkins, "events": events}

def with_post_extras(post: dict, extras: dict, me: dict) -> dict:
    """Adds the poll results and the read confirmations a post shows. Teachers see who voted and who has read."""
    teacher = me["role"] == "teacher"
    if post["poll_options"]:
        count = len(post["poll_options"])
        voters = [[] for _ in range(count)]
        for post_id, user_id, option in extras["votes"]:
            if post_id == post["id"] and 0 <= option < count:
                voters[option].append(user_id)
        post["poll_counts"] = [len(ids) for ids in voters]
        post["poll_total"] = len({user_id for ids in voters for user_id in ids})
        post["my_votes"] = [n for n, ids in enumerate(voters) if me["id"] in ids]
        if teacher:
            post["poll_voters"] = voters
    if post["needs_ack"]:
        readers = [user_id for post_id, user_id in extras["reads"] if post_id == post["id"]]
        post["acked"] = me["id"] in readers
        if teacher:
            post["ack_ids"] = readers
    return post


# ---------- polls ----------
async def poll_counts_of(post_id: int, count: int) -> tuple:
    rows = await fetch_one_off(select(DBCollegePollVote.option_index, DBCollegePollVote.user_id).where(DBCollegePollVote.post_id == post_id))
    counts = [0] * count
    for option, _ in rows:
        if 0 <= option < count:
            counts[option] += 1
    return counts, len({user_id for _, user_id in rows})


@app.post("/api/college-hub/posts/{post_id}/vote")
async def vote_hub_poll(post_id: int, body: HubVote, current_user_id: int = Depends(get_current_user_id)):
    """A student's choice on a poll. Voting again replaces the earlier choice; an empty list takes the vote back."""
    me = await require_hub_member(current_user_id)
    if me["role"] != "student":
        raise HTTPException(status_code=403, detail="Polls are for students to answer.")
    post = await hub_post_or_404(me["key"], post_id)
    options = json_list(post.poll_options)
    if not options:
        raise HTTPException(status_code=400, detail="This post has no poll.")
    if not post_is_for(post, me):
        raise HTTPException(status_code=403, detail="This poll is for another class.")
    chosen = sorted(set(body.options))
    if any(not (0 <= option < len(options)) for option in chosen):
        raise HTTPException(status_code=400, detail="That choice is not on the poll.")
    if len(chosen) > 1 and not post.poll_multi:
        raise HTTPException(status_code=400, detail="Pick one choice on this poll.")

    async with AutocommitSession() as db:
        await db.execute(delete(DBCollegePollVote).where(DBCollegePollVote.post_id == post_id, DBCollegePollVote.user_id == current_user_id))
        if chosen:
            await db.execute(DBCollegePollVote.__table__.insert().values([{"post_id": post_id, "user_id": current_user_id, "option_index": option} for option in chosen]))
    counts, total = await poll_counts_of(post_id, len(options))
    spawn_background(hub_push(me["key"], {"type": "college_poll", "post_id": post_id, "counts": counts, "total": total}))
    return {"post_id": post_id, "counts": counts, "total": total, "my_votes": chosen}


# ---------- read confirmation ----------
@app.post("/api/college-hub/posts/{post_id}/ack")
async def ack_hub_post(post_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    if me["role"] != "student":
        raise HTTPException(status_code=403, detail="Only students confirm that they have read a notice.")
    post = await hub_post_or_404(me["key"], post_id)
    if not post.needs_ack or not post_is_for(post, me):
        raise HTTPException(status_code=400, detail="This post does not ask you to confirm.")
    await run_one_off(
        pg_insert(DBCollegePostRead).values(post_id=post_id, user_id=current_user_id, read_at=utc_now_iso())
        .on_conflict_do_nothing(index_elements=["post_id", "user_id"])
    )
    spawn_background(hub_push_teachers(me["key"], {"type": "college_ack", "post_id": post_id, "user_id": current_user_id}))
    return {"post_id": post_id, "acked": True}


@app.post("/api/college-hub/posts/{post_id}/ack-remind")
async def remind_hub_ack(post_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Tell the students a post is for who have not confirmed reading it yet."""
    me = await require_hub_teacher(current_user_id)
    post = await hub_post_or_404(me["key"], post_id)
    if not post.needs_ack:
        raise HTTPException(status_code=400, detail="This post does not ask students to confirm.")
    audience, readers = await asyncio.gather(
        hub_post_audience(me["key"], post.department, post.division, current_user_id),
        fetch_one_off(select(DBCollegePostRead.user_id).where(DBCollegePostRead.post_id == post_id)),
    )
    read = {row[0] for row in readers}
    waiting = [user_id for user_id in audience if user_id not in read]
    spawn_background(notify_many(waiting, "college", f"Please read and confirm: {post.title}", "college-hub.html"))
    return {"reminded": len(waiting)}


# ---------- handed-in work ----------
async def my_group_for(key: str, activity_id: int, user_id: int):
    rows = await fetch_one_off(
        select(DBTeam.id, DBTeam.name).join(DBTeamMember, DBTeamMember.team_id == DBTeam.id)
        .where(DBTeam.college_key == key, DBTeam.activity_id == activity_id, DBTeamMember.user_id == user_id)
    )
    return rows[0] if rows else None

async def group_student_ids(key: str, group_id: int) -> list:
    teachers = select(DBUser.id).where(DBUser.teacher_of == key)
    rows = await fetch_one_off(select(DBTeamMember.user_id).where(DBTeamMember.team_id == group_id, DBTeamMember.user_id.not_in(teachers)))
    return [row[0] for row in rows]


@app.put("/api/college-hub/activities/{activity_id}/submission")
async def submit_hub_work(activity_id: int, body: HubSubmission, current_user_id: int = Depends(get_current_user_id)):
    """Hand in (or replace) your group's work for an activity. Once a teacher has graded it, it stays as it is."""
    me = await require_hub_member(current_user_id)
    if me["role"] != "student":
        raise HTTPException(status_code=403, detail="Students hand in work; teachers review it.")
    await require_licence(me["key"], "Handing in work")
    activity, group = await asyncio.gather(hub_activity_or_404(me["key"], activity_id), my_group_for(me["key"], activity_id, current_user_id))
    if not activity.accepts_work:
        raise HTTPException(status_code=400, detail="This activity does not collect work.")
    if not group:
        raise HTTPException(status_code=400, detail="Join a group for this activity first. Work is handed in per group.")
    link, file_url = clean_link(body.link, "link"), clean_link(body.file_url, "file address")
    if not link and not file_url:
        raise HTTPException(status_code=400, detail="Add a link or a file.")
    note = clean_text(body.note, 2000, "note")
    now_iso = utc_now_iso()
    values = {
        "submitted_by": current_user_id, "link": link, "file_url": file_url, "file_name": (body.file_name or "").strip()[:200] if file_url else "",
        "note": note, "late": 1 if deadline_passed(activity.submit_by) else 0, "updated_at": now_iso,
    }
    async with AutocommitSession() as db:
        existing = (await db.execute(select(DBCollegeSubmission.id, DBCollegeSubmission.graded_at).where(
            DBCollegeSubmission.activity_id == activity_id, DBCollegeSubmission.group_id == group.id))).first()
        if existing and existing.graded_at:
            raise HTTPException(status_code=400, detail="A teacher has already graded this work, so it can no longer be changed.")
        if existing:
            await db.execute(update(DBCollegeSubmission).where(DBCollegeSubmission.id == existing.id).values(**values))
        else:
            await db.execute(pg_insert(DBCollegeSubmission).values(
                college_key=me["key"], activity_id=activity_id, group_id=group.id, submitted_at=now_iso, marks=None, feedback="", graded_at="", **values
            ).on_conflict_do_update(index_elements=["activity_id", "group_id"], set_=values))
    others = [user_id for user_id in await group_student_ids(me["key"], group.id) if user_id != current_user_id]
    spawn_background(notify_many(others, "college", f"{me['name']} handed in your group's work for: {activity.title}", "college-hub.html"))
    hub_changed(me["key"])
    return {"status": "submitted", "late": bool(values["late"])}


@app.put("/api/college-hub/submissions/{submission_id}/grade")
async def grade_hub_work(submission_id: int, body: HubGrade, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    await require_licence(me["key"], "Marks and feedback")
    rows = await fetch_one_off(
        select(DBCollegeSubmission, DBCollegePost.title, DBCollegePost.max_marks)
        .join(DBCollegePost, DBCollegePost.id == DBCollegeSubmission.activity_id)
        .where(DBCollegeSubmission.id == submission_id, DBCollegeSubmission.college_key == me["key"])
    )
    if not rows:
        raise HTTPException(status_code=404, detail="That submission is gone.")
    submission, title, max_marks = rows[0]
    marks = body.marks
    if max_marks:
        if marks is None or not (0 <= marks <= max_marks):
            raise HTTPException(status_code=400, detail=f"Give marks from 0 to {max_marks}.")
    else:
        marks = None
    feedback = clean_text(body.feedback, 2000, "feedback")
    first_time = not submission.graded_at
    await run_one_off(update(DBCollegeSubmission).where(DBCollegeSubmission.id == submission_id).values(
        marks=marks, feedback=feedback, graded_by=current_user_id, graded_at=utc_now_iso()))
    students_in = await group_student_ids(me["key"], submission.group_id)
    result = f" ({marks}/{max_marks})" if max_marks else ""
    spawn_background(notify_many(students_in, "college", f"{'Your work was reviewed' if first_time else 'Your review was updated'}{result}: {title}", "college-hub.html"))
    hub_changed(me["key"])
    return {"id": submission_id, "marks": marks, "feedback": feedback}


@app.delete("/api/college-hub/submissions/{submission_id}")
async def delete_hub_work(submission_id: int, current_user_id: int = Depends(get_current_user_id)):
    """A teacher removes a submission (to let the group hand in again); a student can take back ungraded work of their group."""
    me = await require_hub_member(current_user_id)
    rows = await fetch_one_off(select(DBCollegeSubmission).where(DBCollegeSubmission.id == submission_id, DBCollegeSubmission.college_key == me["key"]))
    if not rows:
        raise HTTPException(status_code=404, detail="That submission is gone.")
    submission = rows[0][0]
    if me["role"] != "teacher":
        if submission.graded_at:
            raise HTTPException(status_code=400, detail="Graded work stays. Ask a teacher if it needs to be handed in again.")
        if current_user_id not in await group_student_ids(me["key"], submission.group_id):
            raise HTTPException(status_code=403, detail="That is another group's work.")
    await run_one_off(delete(DBCollegeSubmission).where(DBCollegeSubmission.id == submission_id))
    hub_changed(me["key"])
    return {"status": "deleted"}


# ---------- weekly check-ins ----------
def serialize_checkin(row: DBGroupCheckin, names: dict) -> dict:
    return {
        "id": row.id, "group_id": row.group_id, "week_start": row.week_start, "author_id": row.author_id,
        "author_name": names.get(row.author_id, f"User #{row.author_id}"), "done": row.done or "", "next_steps": row.next_steps or "",
        "blockers": row.blockers or "", "teacher_note": row.teacher_note or "", "teacher_name": names.get(row.teacher_id, "") if row.teacher_id else "",
        "created_at": row.created_at or "", "updated_at": row.updated_at or "",
    }


@app.put("/api/college-hub/groups/{group_id}/checkin")
async def write_hub_checkin(group_id: int, body: HubCheckin, current_user_id: int = Depends(get_current_user_id)):
    """This week's progress note of a group. Any student in the group writes it; writing again the same week replaces it."""
    me = await require_hub_member(current_user_id)
    if me["role"] != "student":
        raise HTTPException(status_code=403, detail="Students write the check-in; teachers can add a note to it.")
    team, members = await hub_group_row(me["key"], group_id)
    if not any(user_id == current_user_id for user_id, _ in members):
        raise HTTPException(status_code=403, detail="Only the group's members write its check-in.")
    done, next_steps, blockers = clean_text(body.done, 2000, "'done' text"), clean_text(body.next_steps, 2000, "'next' text"), clean_text(body.blockers, 2000, "'blockers' text")
    if not (done or next_steps or blockers):
        raise HTTPException(status_code=400, detail="Write at least one line about this week.")
    now_iso = utc_now_iso()
    values = {"author_id": current_user_id, "done": done, "next_steps": next_steps, "blockers": blockers, "updated_at": now_iso}
    await run_one_off(pg_insert(DBGroupCheckin).values(
        college_key=me["key"], group_id=group_id, activity_id=team.activity_id, week_start=this_week(), created_at=now_iso, teacher_note="", **values
    ).on_conflict_do_update(index_elements=["group_id", "week_start"], set_=values))
    hub_changed(me["key"])
    return {"status": "saved", "week_start": this_week()}


@app.get("/api/college-hub/groups/{group_id}/checkins")
async def get_hub_checkins(group_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    team, members = await hub_group_row(me["key"], group_id)
    if me["role"] != "teacher" and not any(user_id == current_user_id for user_id, _ in members):
        raise HTTPException(status_code=403, detail="Only the group's members and teachers can read its check-ins.")
    rows = await fetch_one_off(select(DBGroupCheckin).where(DBGroupCheckin.group_id == group_id).order_by(DBGroupCheckin.week_start.desc()).limit(60))
    checkins = [row for (row,) in rows]
    ids = {row.author_id for row in checkins} | {row.teacher_id for row in checkins if row.teacher_id}
    names = {row.id: row.name or "" for row in await fetch_one_off(select(DBUser.id, DBUser.name).where(DBUser.id.in_(ids)))} if ids else {}
    return {"group_id": group_id, "this_week": this_week(), "checkins": [serialize_checkin(row, names) for row in checkins]}


@app.put("/api/college-hub/checkins/{checkin_id}/note")
async def note_hub_checkin(checkin_id: int, body: HubCheckinNote, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    note = clean_text(body.teacher_note, 2000, "note")
    result = await run_returning(
        update(DBGroupCheckin).where(DBGroupCheckin.id == checkin_id, DBGroupCheckin.college_key == me["key"])
        .values(teacher_note=note, teacher_id=current_user_id if note else None).returning(DBGroupCheckin.group_id)
    )
    if not result:
        raise HTTPException(status_code=404, detail="That check-in is gone.")
    if note:
        students_in = await group_student_ids(me["key"], result[0][0])
        spawn_background(notify_many(students_in, "college", "A teacher replied to your group's check-in.", "college-hub.html?tab=groups"))
    hub_changed(me["key"])
    return {"id": checkin_id, "teacher_note": note}


@app.post("/api/college-hub/activities/{activity_id}/checkin-remind")
async def remind_hub_checkins(activity_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Tell the students of every group of this activity that has not checked in this week."""
    me = await require_hub_teacher(current_user_id)
    activity = await hub_activity_or_404(me["key"], activity_id)
    done_groups = select(DBGroupCheckin.group_id).where(DBGroupCheckin.college_key == me["key"], DBGroupCheckin.week_start == this_week())
    teachers = select(DBUser.id).where(DBUser.teacher_of == me["key"])
    rows = await fetch_one_off(
        select(DBTeamMember.user_id, DBTeam.id).join(DBTeam, DBTeam.id == DBTeamMember.team_id)
        .where(DBTeam.college_key == me["key"], DBTeam.activity_id == activity_id, DBTeam.id.not_in(done_groups), DBTeamMember.user_id.not_in(teachers))
    )
    spawn_background(notify_many([user_id for user_id, _ in rows], "college", f"Your group has not checked in this week for: {activity.title}", "college-hub.html?tab=groups"))
    return {"groups": len({team_id for _, team_id in rows}), "reminded": len({user_id for user_id, _ in rows})}


async def run_returning(statement) -> list:
    async with AutocommitSession() as session:
        return (await session.execute(statement)).all()


# ---------- calendar ----------
def clean_event(body: HubEventBody) -> dict:
    title = clean_text(body.title, 120, "title")
    if not title:
        raise HTTPException(status_code=400, detail="Give the event a title.")
    date = (body.date or "").strip()
    if not HUB_DATE_PATTERN.match(date):
        raise HTTPException(status_code=400, detail="Pick a date for the event.")
    start, end = (body.start_time or "").strip(), (body.end_time or "").strip()
    if (start and not HUB_TIME_PATTERN.match(start)) or (end and not HUB_TIME_PATTERN.match(end)):
        raise HTTPException(status_code=400, detail="Times must look like 09:30.")
    if end and not start:
        raise HTTPException(status_code=400, detail="Give a start time before an end time.")
    if start and end and end <= start:
        raise HTTPException(status_code=400, detail="The event must end after it starts.")
    department, division = clean_audience(body.department, body.division)
    return {
        "title": title, "kind": body.kind if body.kind in HUB_EVENT_KINDS else "other", "date": date, "start_time": start, "end_time": end,
        "location": clean_text(body.location, 120, "place"), "details": clean_text(body.details, 2000, "details"),
        "department": department, "division": division,
    }


@app.post("/api/college-hub/events")
async def create_hub_event(body: HubEventBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    values = clean_event(body)
    rows = await run_returning(DBCollegeEvent.__table__.insert().values(college_key=me["key"], author_id=current_user_id, created_at=utc_now_iso(), **values).returning(DBCollegeEvent.id))
    if values["date"] >= datetime.now().date().isoformat():
        async def announce():
            audience = await hub_post_audience(me["key"], values["department"], values["division"], current_user_id)
            await notify_many(audience, "college", f"New on the calendar ({values['date']}): {values['title']}", "college-hub.html?tab=calendar")
        spawn_background(announce())
    hub_changed(me["key"])
    return {"id": rows[0][0], **values}


@app.put("/api/college-hub/events/{event_id}")
async def update_hub_event(event_id: int, body: HubEventBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    values = clean_event(body)
    rows = await run_returning(update(DBCollegeEvent).where(DBCollegeEvent.id == event_id, DBCollegeEvent.college_key == me["key"]).values(**values).returning(DBCollegeEvent.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That event is no longer on the calendar.")
    hub_changed(me["key"])
    return {"id": event_id, **values}


@app.delete("/api/college-hub/events/{event_id}")
async def delete_hub_event(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    rows = await run_returning(delete(DBCollegeEvent).where(DBCollegeEvent.id == event_id, DBCollegeEvent.college_key == me["key"]).returning(DBCollegeEvent.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That event is no longer on the calendar.")
    hub_changed(me["key"])
    return {"status": "deleted"}


# ---------- resources ----------
def clean_resource(body: HubResourceBody) -> dict:
    title = clean_text(body.title, 160, "title")
    if not title:
        raise HTTPException(status_code=400, detail="Give the resource a title.")
    url, file_url = clean_link(body.url, "link"), clean_link(body.file_url, "file address")
    if not url and not file_url:
        raise HTTPException(status_code=400, detail="Add a link or a file.")
    department, division = clean_audience(body.department, body.division)
    return {
        "title": title, "url": url, "file_url": file_url, "file_name": (body.file_name or "").strip()[:200] if file_url else "",
        "description": clean_text(body.description, 2000, "description"), "subject": clean_text(body.subject, 80, "subject"),
        "department": department, "division": division,
    }


@app.get("/api/college-hub/resources")
async def get_hub_resources(current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    mine = select(DBCollegeResourceSave.resource_id).where(DBCollegeResourceSave.user_id == current_user_id)
    saves = select(func.count()).where(DBCollegeResourceSave.resource_id == DBCollegeResource.id).correlate(DBCollegeResource).scalar_subquery()
    rows = await fetch_one_off(
        select(DBCollegeResource, DBUser.name, DBCollegeResource.id.in_(mine).label("saved"), saves.label("saves"))
        .outerjoin(DBUser, DBUser.id == DBCollegeResource.author_id)
        .where(DBCollegeResource.college_key == me["key"]).order_by(DBCollegeResource.id.desc()).limit(500)
    )
    return {"resources": [{
        "id": item.id, "title": item.title or "", "url": item.url or "", "file_url": item.file_url or "", "file_name": item.file_name or "",
        "description": item.description or "", "subject": item.subject or "", "department": item.department or "", "division": item.division or "",
        "author_id": item.author_id, "author_name": name or "", "created_at": item.created_at or "", "saved": bool(saved), "saves": saves_count or 0,
    } for item, name, saved, saves_count in rows if addressed_to(item.department, item.division, me)]}


@app.post("/api/college-hub/resources")
async def create_hub_resource(body: HubResourceBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    values = clean_resource(body)
    rows = await run_returning(DBCollegeResource.__table__.insert().values(college_key=me["key"], author_id=current_user_id, created_at=utc_now_iso(), **values).returning(DBCollegeResource.id))
    spawn_background(hub_push(me["key"], {"type": "college_resources_changed"}))
    return {"id": rows[0][0], **values}


@app.put("/api/college-hub/resources/{resource_id}")
async def update_hub_resource(resource_id: int, body: HubResourceBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    values = clean_resource(body)
    rows = await run_returning(update(DBCollegeResource).where(DBCollegeResource.id == resource_id, DBCollegeResource.college_key == me["key"]).values(**values).returning(DBCollegeResource.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That resource is gone.")
    spawn_background(hub_push(me["key"], {"type": "college_resources_changed"}))
    return {"id": resource_id, **values}


@app.delete("/api/college-hub/resources/{resource_id}")
async def delete_hub_resource(resource_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    rows = await run_returning(delete(DBCollegeResource).where(DBCollegeResource.id == resource_id, DBCollegeResource.college_key == me["key"]).returning(DBCollegeResource.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That resource is gone.")
    await run_one_off(delete(DBCollegeResourceSave).where(DBCollegeResourceSave.resource_id == resource_id))
    spawn_background(hub_push(me["key"], {"type": "college_resources_changed"}))
    return {"status": "deleted"}


@app.post("/api/college-hub/resources/{resource_id}/save")
async def save_hub_resource(resource_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    rows = await fetch_one_off(select(DBCollegeResource.department, DBCollegeResource.division).where(DBCollegeResource.id == resource_id, DBCollegeResource.college_key == me["key"]))
    if not rows or not addressed_to(rows[0].department, rows[0].division, me):
        raise HTTPException(status_code=404, detail="That resource is gone.")
    await run_one_off(pg_insert(DBCollegeResourceSave).values(resource_id=resource_id, user_id=current_user_id).on_conflict_do_nothing(index_elements=["resource_id", "user_id"]))
    return {"id": resource_id, "saved": True}


@app.delete("/api/college-hub/resources/{resource_id}/save")
async def unsave_hub_resource(resource_id: int, current_user_id: int = Depends(get_current_user_id)):
    await require_hub_member(current_user_id)
    await run_one_off(delete(DBCollegeResourceSave).where(DBCollegeResourceSave.resource_id == resource_id, DBCollegeResourceSave.user_id == current_user_id))
    return {"id": resource_id, "saved": False}


# ---------- attendance ----------
def attendance_class_filter(key: str, department: str, division: str):
    return and_(
        DBAttendanceSession.college_key == key,
        func.lower(func.trim(DBAttendanceSession.department)) == college_key_of(department),
        func.lower(func.trim(DBAttendanceSession.division)) == college_key_of(division),
    )

def serialize_session(session: DBAttendanceSession, marks: dict) -> dict:
    return {
        "id": session.id, "department": session.department or "", "division": session.division or "", "subject": session.subject or "",
        "date": session.date or "", "teacher_id": session.teacher_id, "created_at": session.created_at or "", "marks": marks,
    }


@app.get("/api/college-hub/attendance")
async def get_hub_attendance(department: str = "", division: str = "", current_user_id: int = Depends(get_current_user_id)):
    """A teacher reads one class's sessions with every mark; a student reads their own marks."""
    me = await require_hub_member(current_user_id)
    if me["role"] == "teacher":
        if not department.strip():
            raise HTTPException(status_code=400, detail="Pick a class.")
        sessions = await fetch_one_off(
            select(DBAttendanceSession).where(attendance_class_filter(me["key"], department, division))
            .order_by(DBAttendanceSession.date.desc(), DBAttendanceSession.id.desc()).limit(400)
        )
        ids = [session.id for (session,) in sessions]
        marks = await fetch_one_off(select(DBAttendanceMark.session_id, DBAttendanceMark.user_id, DBAttendanceMark.status).where(DBAttendanceMark.session_id.in_(ids))) if ids else []
        by_session: dict = {}
        for session_id, user_id, status_now in marks:
            by_session.setdefault(session_id, {})[str(user_id)] = status_now
        return {"sessions": [serialize_session(session, by_session.get(session.id, {})) for (session,) in sessions]}

    rows = await fetch_one_off(
        select(DBAttendanceSession, DBAttendanceMark.status)
        .join(DBAttendanceMark, DBAttendanceMark.session_id == DBAttendanceSession.id)
        .where(DBAttendanceSession.college_key == me["key"], DBAttendanceMark.user_id == current_user_id)
        .order_by(DBAttendanceSession.date.desc(), DBAttendanceSession.id.desc()).limit(1000)
    )
    return {"sessions": [serialize_session(session, {str(current_user_id): status_now}) for session, status_now in rows]}


async def clean_attendance(me: dict, body: HubAttendanceBody) -> tuple:
    department, division = clean_audience(body.department, body.division)
    if not department:
        raise HTTPException(status_code=400, detail="Pick a class.")
    date = (body.date or "").strip()
    if not HUB_DATE_PATTERN.match(date):
        raise HTTPException(status_code=400, detail="Pick the date of the class.")
    subject = clean_text(body.subject, 80, "subject")
    marks = {}
    for user_id, status_now in (body.marks or {}).items():
        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="A mark names an unknown student.")
        if status_now not in HUB_ATTENDANCE_STATUSES:
            raise HTTPException(status_code=400, detail="Each student is present, absent or late.")
        marks[user_id] = status_now
    if not marks:
        raise HTTPException(status_code=400, detail="There is no one to mark.")
    in_class = {row[0] for row in await fetch_one_off(select(DBUser.id).where(DBUser.id.in_(list(marks)), class_clause(me["key"], department, division)))}
    if set(marks) - in_class:
        raise HTTPException(status_code=400, detail="Only students of this class can be marked.")
    return {"department": department, "division": division, "subject": subject, "date": date}, marks

async def warn_low_attendance(key: str, user_ids: list):
    """Tell a student once, when their attendance has just gone under the line. Meant to run in the background."""
    try:
        present = func.sum(case((DBAttendanceMark.status.in_(("present", "late")), 1), else_=0))
        rows = await fetch_one_off(
            select(DBAttendanceMark.user_id, func.count(), present)
            .join(DBAttendanceSession, DBAttendanceSession.id == DBAttendanceMark.session_id)
            .where(DBAttendanceSession.college_key == key, DBAttendanceMark.user_id.in_(user_ids))
            .group_by(DBAttendanceMark.user_id)
        )
        last = await fetch_one_off(  # the newest mark of each student, to know where they stood before it
            select(DBAttendanceMark.user_id, DBAttendanceMark.status)
            .distinct(DBAttendanceMark.user_id)
            .join(DBAttendanceSession, DBAttendanceSession.id == DBAttendanceMark.session_id)
            .where(DBAttendanceSession.college_key == key, DBAttendanceMark.user_id.in_(user_ids))
            .order_by(DBAttendanceMark.user_id, DBAttendanceMark.id.desc())
        )
        last_status = dict(last)
        warn = []
        for user_id, total, attended in rows:
            attended = attended or 0
            if total < HUB_ATTENDANCE_MIN_SESSIONS or attended * 100 >= HUB_ATTENDANCE_LOW * total:
                continue
            before_attended = attended - (1 if last_status.get(user_id) in ("present", "late") else 0)
            if total - 1 >= HUB_ATTENDANCE_MIN_SESSIONS and before_attended * 100 < HUB_ATTENDANCE_LOW * (total - 1):
                continue   # already under the line before this class: told then
            warn.append(user_id)
        await notify_many(warn, "college", f"Your attendance is now under {HUB_ATTENDANCE_LOW}%.", "college-hub.html?tab=attendance")
    except Exception as e:
        print("Error checking attendance:", e)


@app.post("/api/college-hub/attendance")
async def create_hub_attendance(body: HubAttendanceBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    await require_licence(me["key"], "Attendance")
    values, marks = await clean_attendance(me, body)
    async with SessionLocal() as db:   # the session and its marks are saved together or not at all
        session = DBAttendanceSession(college_key=me["key"], teacher_id=current_user_id, created_at=utc_now_iso(), **values)
        db.add(session)
        await db.flush()
        await db.execute(DBAttendanceMark.__table__.insert().values([{"session_id": session.id, "user_id": user_id, "status": status_now} for user_id, status_now in marks.items()]))
        await db.commit()
        session_id = session.id
    spawn_background(warn_low_attendance(me["key"], list(marks)))
    return {"id": session_id, **values, "marks": {str(user_id): status_now for user_id, status_now in marks.items()}}


@app.put("/api/college-hub/attendance/{session_id}")
async def update_hub_attendance(session_id: int, body: HubAttendanceBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    await require_licence(me["key"], "Attendance")
    values, marks = await clean_attendance(me, body)
    async with SessionLocal() as db:
        found = (await db.execute(update(DBAttendanceSession).where(DBAttendanceSession.id == session_id, DBAttendanceSession.college_key == me["key"]).values(**values).returning(DBAttendanceSession.id))).first()
        if not found:
            raise HTTPException(status_code=404, detail="That class session is gone.")
        await db.execute(delete(DBAttendanceMark).where(DBAttendanceMark.session_id == session_id))
        await db.execute(DBAttendanceMark.__table__.insert().values([{"session_id": session_id, "user_id": user_id, "status": status_now} for user_id, status_now in marks.items()]))
        await db.commit()
    return {"id": session_id, **values, "marks": {str(user_id): status_now for user_id, status_now in marks.items()}}


@app.delete("/api/college-hub/attendance/{session_id}")
async def delete_hub_attendance(session_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_teacher(current_user_id)
    rows = await run_returning(delete(DBAttendanceSession).where(DBAttendanceSession.id == session_id, DBAttendanceSession.college_key == me["key"]).returning(DBAttendanceSession.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That class session is gone.")
    await run_one_off(delete(DBAttendanceMark).where(DBAttendanceMark.session_id == session_id))
    return {"status": "deleted"}


# ---------- questions and answers ----------
def question_visible(question, me: dict) -> bool:
    return addressed_to(question.department, question.division, me)

def question_author(question, name: Optional[str], picture: Optional[str], me: dict) -> dict:
    """Who asked. An anonymous question shows no name to students; its asker and the teachers still see it."""
    hidden = bool(question.anonymous) and me["role"] != "teacher" and question.author_id != me["id"]
    return {
        "author_id": None if hidden else question.author_id,
        "author_name": "Anonymous" if hidden else (name or f"User #{question.author_id}"),
        "author_pic": "" if hidden or not picture or len(picture) > 1000 else picture,
    }

async def question_or_404(me: dict, question_id: int):
    rows = await fetch_one_off(select(DBCollegeQuestion).where(DBCollegeQuestion.id == question_id, DBCollegeQuestion.college_key == me["key"]))
    if not rows or not question_visible(rows[0][0], me):
        raise HTTPException(status_code=404, detail="That question is gone.")
    return rows[0][0]

def qa_changed(key: str):
    spawn_background(hub_push(key, {"type": "college_qa_changed"}))


@app.get("/api/college-hub/questions")
async def get_hub_questions(current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    votes = select(func.count()).where(DBCollegeQuestionVote.question_id == DBCollegeQuestion.id).correlate(DBCollegeQuestion).scalar_subquery()
    answers = select(func.count()).where(DBCollegeAnswer.question_id == DBCollegeQuestion.id).correlate(DBCollegeQuestion).scalar_subquery()
    mine = exists().where(DBCollegeQuestionVote.question_id == DBCollegeQuestion.id, DBCollegeQuestionVote.user_id == current_user_id)
    rows = await fetch_one_off(
        select(DBCollegeQuestion, DBUser.name, DBUser.profile_pic, votes.label("votes"), answers.label("answers"), mine.label("voted"))
        .outerjoin(DBUser, DBUser.id == DBCollegeQuestion.author_id)
        .where(DBCollegeQuestion.college_key == me["key"]).order_by(DBCollegeQuestion.id.desc()).limit(400)
    )
    return {"questions": [{
        "id": question.id, "title": question.title or "", "body": question.body or "", "subject": question.subject or "",
        "department": question.department or "", "division": question.division or "", "anonymous": bool(question.anonymous),
        "mine": question.author_id == current_user_id, "accepted_answer_id": question.accepted_answer_id, "created_at": question.created_at or "",
        "votes": vote_count or 0, "answers": answer_count or 0, "voted": bool(voted), **question_author(question, name, picture, me),
    } for question, name, picture, vote_count, answer_count, voted in rows if question_visible(question, me)]}


@app.get("/api/college-hub/questions/{question_id}")
async def get_hub_question(question_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    question = await question_or_404(me, question_id)
    asker, answers = await asyncio.gather(
        fetch_one_off(select(DBUser.name, DBUser.profile_pic).where(DBUser.id == question.author_id)),
        fetch_one_off(
            select(DBCollegeAnswer, DBUser.name, DBUser.profile_pic, DBUser.teacher_of)
            .outerjoin(DBUser, DBUser.id == DBCollegeAnswer.author_id)
            .where(DBCollegeAnswer.question_id == question_id).order_by(DBCollegeAnswer.id)
        ),
    )
    name, picture = (asker[0].name, asker[0].profile_pic) if asker else (None, None)
    return {
        "id": question.id, "title": question.title or "", "body": question.body or "", "subject": question.subject or "",
        "department": question.department or "", "division": question.division or "", "anonymous": bool(question.anonymous),
        "mine": question.author_id == current_user_id, "accepted_answer_id": question.accepted_answer_id, "created_at": question.created_at or "",
        **question_author(question, name, picture, me),
        "answers": [{
            "id": answer.id, "author_id": answer.author_id, "author_name": answer_name or f"User #{answer.author_id}",
            "author_pic": answer_pic if answer_pic and len(answer_pic) <= 1000 else "", "is_teacher": (teacher_of or "") == me["key"],
            "body": answer.body or "", "created_at": answer.created_at or "",
        } for answer, answer_name, answer_pic, teacher_of in answers],
    }


@app.post("/api/college-hub/questions")
async def create_hub_question(body: HubQuestionBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    title = clean_text(body.title, 200, "question")
    if not title:
        raise HTTPException(status_code=400, detail="Write your question.")
    to_class = bool(body.to_class) and me["role"] == "student" and bool(me["department"])
    rows = await run_returning(DBCollegeQuestion.__table__.insert().values(
        college_key=me["key"], author_id=current_user_id, anonymous=1 if body.anonymous and me["role"] == "student" else 0,
        title=title, body=clean_text(body.body, 4000, "details"), subject=clean_text(body.subject, 80, "subject"),
        department=me["department"] if to_class else "", division=me["division"] if to_class else "", created_at=utc_now_iso(),
    ).returning(DBCollegeQuestion.id))
    qa_changed(me["key"])
    return {"id": rows[0][0]}


@app.delete("/api/college-hub/questions/{question_id}")
async def delete_hub_question(question_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    question = await question_or_404(me, question_id)
    if me["role"] != "teacher" and question.author_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the person who asked, or a teacher, can delete a question.")
    await asyncio.gather(
        run_one_off(delete(DBCollegeQuestion).where(DBCollegeQuestion.id == question_id)),
        run_one_off(delete(DBCollegeAnswer).where(DBCollegeAnswer.question_id == question_id)),
        run_one_off(delete(DBCollegeQuestionVote).where(DBCollegeQuestionVote.question_id == question_id)),
    )
    qa_changed(me["key"])
    return {"status": "deleted"}


@app.post("/api/college-hub/questions/{question_id}/answers")
async def answer_hub_question(question_id: int, body: HubAnswerBody, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    question = await question_or_404(me, question_id)
    text_body = clean_text(body.body, 4000, "answer")
    if not text_body:
        raise HTTPException(status_code=400, detail="Write your answer.")
    rows = await run_returning(DBCollegeAnswer.__table__.insert().values(question_id=question_id, author_id=current_user_id, body=text_body, created_at=utc_now_iso()).returning(DBCollegeAnswer.id))
    if question.author_id != current_user_id:
        who = "A teacher" if me["role"] == "teacher" else me["name"] or "Someone"
        spawn_background(notify_many([question.author_id], "college", f"{who} answered your question: {question.title[:80]}", "college-hub.html?tab=qa"))
    qa_changed(me["key"])
    return {"id": rows[0][0]}


@app.delete("/api/college-hub/answers/{answer_id}")
async def delete_hub_answer(answer_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    rows = await fetch_one_off(
        select(DBCollegeAnswer.author_id, DBCollegeAnswer.question_id).join(DBCollegeQuestion, DBCollegeQuestion.id == DBCollegeAnswer.question_id)
        .where(DBCollegeAnswer.id == answer_id, DBCollegeQuestion.college_key == me["key"])
    )
    if not rows:
        raise HTTPException(status_code=404, detail="That answer is gone.")
    if me["role"] != "teacher" and rows[0].author_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the person who wrote it, or a teacher, can delete an answer.")
    await asyncio.gather(
        run_one_off(delete(DBCollegeAnswer).where(DBCollegeAnswer.id == answer_id)),
        run_one_off(update(DBCollegeQuestion).where(DBCollegeQuestion.id == rows[0].question_id, DBCollegeQuestion.accepted_answer_id == answer_id).values(accepted_answer_id=None)),
    )
    qa_changed(me["key"])
    return {"status": "deleted"}


@app.post("/api/college-hub/questions/{question_id}/accept")
async def accept_hub_answer(question_id: int, body: HubAccept, current_user_id: int = Depends(get_current_user_id)):
    """The asker or a teacher marks the answer that solved it; no answer_id clears the mark."""
    me = await require_hub_member(current_user_id)
    question = await question_or_404(me, question_id)
    if me["role"] != "teacher" and question.author_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the person who asked, or a teacher, can mark the best answer.")
    if body.answer_id is not None:
        found = await fetch_one_off(select(DBCollegeAnswer.author_id).where(DBCollegeAnswer.id == body.answer_id, DBCollegeAnswer.question_id == question_id))
        if not found:
            raise HTTPException(status_code=404, detail="That answer is gone.")
        if found[0][0] != current_user_id:
            spawn_background(notify_many([found[0][0]], "college", f"Your answer was marked as the best one: {question.title[:80]}", "college-hub.html?tab=qa"))
    await run_one_off(update(DBCollegeQuestion).where(DBCollegeQuestion.id == question_id).values(accepted_answer_id=body.answer_id))
    qa_changed(me["key"])
    return {"id": question_id, "accepted_answer_id": body.answer_id}


@app.post("/api/college-hub/questions/{question_id}/vote")
async def vote_hub_question(question_id: int, current_user_id: int = Depends(get_current_user_id)):
    """'I have this question too'."""
    me = await require_hub_member(current_user_id)
    await question_or_404(me, question_id)
    await run_one_off(pg_insert(DBCollegeQuestionVote).values(question_id=question_id, user_id=current_user_id).on_conflict_do_nothing(index_elements=["question_id", "user_id"]))
    qa_changed(me["key"])
    return {"id": question_id, "voted": True}


@app.delete("/api/college-hub/questions/{question_id}/vote")
async def unvote_hub_question(question_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await require_hub_member(current_user_id)
    await run_one_off(delete(DBCollegeQuestionVote).where(DBCollegeQuestionVote.question_id == question_id, DBCollegeQuestionVote.user_id == current_user_id))
    qa_changed(me["key"])
    return {"id": question_id, "voted": False}


# ==========================================
# 17. ROLES: FOUNDER, ADMINS AND TEACHERS. APPLICATIONS AND THE VERIFICATION DESK
# The founder (users.is_founder) runs the platform. The founder row also has is_admin=1 for older checks,
# but everything new asks is_founder first: the founder is never treated as an admin, and never pays.
# An admin (is_admin, not founder) verifies accounts of one college, for the departments in admin_scopes.
# A teacher (users.teacher_of) runs College Hub for one college. Only the founder approves admins and teachers.
# ==========================================
class DBAdminScope(Base):
    __tablename__ = "admin_scopes"
    __table_args__ = (UniqueConstraint("user_id", "college_key", "department_key", name="ux_admin_scopes"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    college_key = Column(String, index=True)
    college_name = Column(String, default="")
    department_key = Column(String, index=True)
    department = Column(String, default="")       # as the founder approved it, for showing
    granted_by = Column(Integer, nullable=True)
    granted_at = Column(String, default="")

class DBVerificationLog(Base):
    __tablename__ = "verification_log"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, index=True)
    admin_id = Column(Integer, index=True)
    action = Column(String)                       # approve, reject, pass, needs_info, reverse
    reason = Column(String, default="")
    from_department = Column(String, default="")
    to_department = Column(String, default="")
    reversed = Column(Integer, default=0)
    created_at = Column(String)


OPEN_APPLICATION = ("pending", "needs_info")
TEACHER_DESIGNATIONS = ("Professor", "Associate Professor", "Assistant Professor", "Lecturer", "Lab Instructor",
                        "Head of Department", "Principal / Director", "Visiting Faculty")
ADMIN_ROLES = ("Faculty", "Non-teaching staff", "Training & placement cell", "Student coordinator", "Other")
REJECT_REASONS = {
    "unreadable": "the ID card photo could not be read",
    "mismatch": "the name or details on the ID card do not match the profile",
    "not_student": "the ID does not show that you study at this college",
    "fake": "the document does not look genuine",
    "other": "",
}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
PHONE_PATTERN = re.compile(r"^\+?[0-9][0-9 ()-]{7,15}$")
VERIFY_QUEUE_LIMIT = 300
MAX_ID_IMAGE_CHARS = 2_000_000

# ID photos live as files in a private folder (never under static/, so /static cannot serve them);
# users.id_card_image holds "file:<name>". Rows from before the move may still hold the whole "data:" picture.
ID_CARD_DIR = os.path.join("private_uploads", "id_cards")
ID_CARD_DATA_URL = re.compile(r"^data:image/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$")
ID_CARD_FILE = re.compile(r"^file:(idcard_[0-9a-f]{32}\.(jpg|png|webp|gif))$")
ID_CARD_EXTENSION = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "webp": "webp", "gif": "gif"}
ID_CARD_MIME = {"jpg": "jpeg", "png": "png", "webp": "webp", "gif": "gif"}

def write_id_card_file(data_url: str, check_size: bool = True) -> str:
    match = ID_CARD_DATA_URL.match(data_url or "")
    if not match or (check_size and len(data_url) > MAX_ID_IMAGE_CHARS):
        raise HTTPException(status_code=400, detail="Send a JPEG or PNG photo under 1.5 MB.")
    try:
        raw = base64.b64decode(re.sub(r"\s", "", match.group(2)), validate=True)
    except ValueError:
        raise HTTPException(status_code=400, detail="That photo could not be read.")
    name = f"idcard_{uuid.uuid4().hex}.{ID_CARD_EXTENSION[match.group(1)]}"
    os.makedirs(ID_CARD_DIR, exist_ok=True)
    with open(os.path.join(ID_CARD_DIR, name), "wb") as handle:
        handle.write(raw)
    return f"file:{name}"

async def store_id_card(data_url: str, check_size: bool = True) -> str:
    """Save a "data:image/..." photo as a file and return the "file:<name>" value for users.id_card_image."""
    return await asyncio.to_thread(write_id_card_file, data_url, check_size)

def read_id_card_file(value: str) -> Optional[str]:
    if (value or "").startswith("data:"):
        return value
    match = ID_CARD_FILE.match(value or "")
    if not match:
        return None
    try:
        with open(os.path.join(ID_CARD_DIR, match.group(1)), "rb") as handle:
            raw = handle.read()
    except OSError:
        return None
    return f"data:image/{ID_CARD_MIME[match.group(2)]};base64,{base64.b64encode(raw).decode('ascii')}"

async def load_id_card(value: str) -> Optional[str]:
    """The photo as a "data:" address, the same shape the verification pages always got. None when there is none."""
    return await asyncio.to_thread(read_id_card_file, value)

def remove_id_card_file(value: str):
    match = ID_CARD_FILE.match(value or "")
    if match:
        try:
            os.remove(os.path.join(ID_CARD_DIR, match.group(1)))
        except OSError:
            pass

async def move_id_cards_to_files():
    """One-time move at startup: photos still saved inside users.id_card_image become files. Later starts find nothing."""
    last_id = 0
    try:
        while True:
            rows = await fetch_one_off(select(DBUser.id, DBUser.id_card_image)
                                       .where(DBUser.id > last_id, DBUser.id_card_image.like("data:%")).order_by(DBUser.id).limit(5))
            if not rows:
                return
            for user_id, image in rows:
                last_id = user_id
                try:
                    marker = await store_id_card(image, check_size=False)
                except HTTPException:
                    print(f"ID photo of user {user_id} could not be read; left in the database.")
                    continue
                # Only replace the exact picture we copied, so a re-upload in the meantime is never overwritten
                moved = await run_returning(update(DBUser).where(DBUser.id == user_id, DBUser.id_card_image == image)
                                            .values(id_card_image=marker).returning(DBUser.id))
                if not moved:
                    remove_id_card_file(marker)
    except Exception as e:
        print("Moving ID photos to files stopped:", e)

EFFECTIVE_DEPARTMENT = func.lower(func.trim(func.coalesce(func.nullif(func.trim(DBUser.verify_department), ""), DBUser.department, "")))


class TeacherApplicationBody(BaseModel):
    department: str
    designation: str
    employee_id: str
    official_email: str
    phone: str
    subjects: Optional[List[str]] = None
    years: Optional[int] = 0
    id_proof_url: str
    letter_url: Optional[str] = ""
    profile_link: Optional[str] = ""
    note: Optional[str] = ""
    agree: bool = False

class AdminApplicationBody(BaseModel):
    role_at_college: str
    staff_id: str
    official_email: str
    phone: str
    departments: List[str]
    hours: Optional[int] = 0
    languages: Optional[str] = ""
    id_proof_url: str
    letter_url: Optional[str] = ""
    motivation: str
    agree: bool = False

class ApplicationAnswer(BaseModel):
    answer: str

class FounderDecision(BaseModel):
    action: str                                   # approve, decline, ask
    note: Optional[str] = ""
    departments: Optional[List[str]] = None       # admin applications: the scope to grant

class ScopeBody(BaseModel):
    departments: List[str]

class ReasonBody(BaseModel):
    reason: Optional[str] = ""

class VerifyAction(BaseModel):
    action: str                                   # approve, reject, pass, needs_info
    reason: Optional[str] = ""                    # reject: a key of REJECT_REASONS
    note: Optional[str] = ""
    department: Optional[str] = ""                # pass: the department it belongs to

class VerifyBulk(BaseModel):
    ids: List[int]

class IdCardUpload(BaseModel):
    image: str


# ---------- who is who ----------
def roles_of(row) -> dict:
    founder = (getattr(row, "is_founder", 0) or 0) == 1
    return {
        "founder": founder,
        "admin": (getattr(row, "is_admin", 0) or 0) == 1 and not founder,
        "teacher": bool((getattr(row, "teacher_of", "") or "").strip()),
    }

async def require_founder(current_user_id: int = Depends(get_current_user_id)) -> int:
    """For founder-only routes. Uses the normal login and checks the founder flag in the database."""
    if not await founder_flag(current_user_id):
        raise HTTPException(status_code=403, detail="Only the founder can do this.")
    return current_user_id

def clean_required(value: Optional[str], limit: int, what: str) -> str:
    value = clean_text(value, limit, what)
    if not value:
        raise HTTPException(status_code=400, detail=f"Fill in the {what}.")
    return value

def clean_contact(email: Optional[str], phone: Optional[str]) -> tuple:
    email, phone = (email or "").strip()[:160], (phone or "").strip()[:20]
    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if not PHONE_PATTERN.match(phone):
        raise HTTPException(status_code=400, detail="Enter a valid phone number.")
    return email, phone

def json_strings(values, limit_each: int, limit_count: int) -> list:
    out = []
    for value in values or []:
        value = (value or "").strip()[:limit_each]
        if value and college_key_of(value) not in {college_key_of(have) for have in out}:
            out.append(value)
    return out[:limit_count]

async def applicant_profile(user_id: int):
    rows = await fetch_one_off(select(DBUser.name, DBUser.college_name, DBUser.department, DBUser.is_admin, DBUser.is_founder, DBUser.teacher_of).where(DBUser.id == user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    return rows[0]


# ---------- teacher applications ----------
def serialize_teacher_application(req, extra: Optional[dict] = None) -> dict:
    return {
        "id": req.id, "user_id": req.user_id, "status": req.status or "pending", "college": req.college_name or req.college_key,
        "department": req.department or "", "designation": req.designation or "", "employee_id": req.employee_id or "",
        "official_email": req.official_email or "", "phone": req.phone or "", "subjects": json_list(req.subjects), "years": req.years or 0,
        "id_proof_url": req.id_proof_url or "", "letter_url": req.letter_url or "", "profile_link": req.profile_link or "",
        "note": req.note or "", "decision_note": req.decision_note or "", "info_question": req.info_question or "",
        "info_answer": req.info_answer or "", "requested_at": req.requested_at or "", "updated_at": req.updated_at or req.requested_at or "",
        "decided_at": req.decided_at or "", **(extra or {}),
    }


@app.post("/api/teacher-applications")
async def create_teacher_application(body: TeacherApplicationBody, current_user_id: int = Depends(get_current_user_id)):
    """Apply to be a teacher of the college on your profile. The founder checks it."""
    me = await applicant_profile(current_user_id)
    college = (me.college_name or "").strip()
    if not college:
        raise HTTPException(status_code=400, detail="Add your college or institution to your profile first.")
    if (me.teacher_of or "").strip():
        raise HTTPException(status_code=400, detail="You already have teacher access.")
    if body.designation not in TEACHER_DESIGNATIONS:
        raise HTTPException(status_code=400, detail="Pick your designation from the list.")
    if not body.agree:
        raise HTTPException(status_code=400, detail="Confirm the declarations before sending.")
    email, phone = clean_contact(body.official_email, body.phone)
    id_proof = clean_link(body.id_proof_url, "ID proof address")
    if not id_proof:
        raise HTTPException(status_code=400, detail="Attach a photo of your staff ID card.")
    years = body.years or 0
    if not (0 <= years <= 60):
        raise HTTPException(status_code=400, detail="Years of teaching must be between 0 and 60.")
    open_rows = await fetch_one_off(select(DBTeacherRequest.id).where(DBTeacherRequest.user_id == current_user_id, DBTeacherRequest.status.in_(OPEN_APPLICATION)))
    if open_rows:
        raise HTTPException(status_code=400, detail="You already have an application waiting. You can withdraw it and apply again.")
    now_iso = utc_now_iso()
    rows = await run_returning(DBTeacherRequest.__table__.insert().values(
        user_id=current_user_id, college_key=college_key_of(college), college_name=college, status="pending", requested_at=now_iso, updated_at=now_iso,
        department=clean_required(body.department, 120, "department"), designation=body.designation,
        employee_id=clean_required(body.employee_id, 60, "employee ID"), official_email=email, phone=phone,
        subjects=json.dumps(json_strings(body.subjects, 60, 15)), years=years, id_proof_url=id_proof,
        letter_url=clean_link(body.letter_url, "letter address"), profile_link=clean_link(body.profile_link, "profile link"),
        note=clean_text(body.note, 1000, "note"), decision_note="", info_question="", info_answer="", decided_at="",
    ).returning(DBTeacherRequest.id))
    spawn_background(notify_founders("account", f"New teacher application from {me.name or 'someone'} ({college}).", "founder.html?tab=teachers"))
    return {"id": rows[0][0], "status": "pending"}


@app.get("/api/teacher-applications/me")
async def my_teacher_application(current_user_id: int = Depends(get_current_user_id)):
    me = await applicant_profile(current_user_id)
    rows = await fetch_one_off(select(DBTeacherRequest).where(DBTeacherRequest.user_id == current_user_id).order_by(DBTeacherRequest.id.desc()).limit(1))
    return {
        "profile": {"name": me.name or "", "college": (me.college_name or "").strip(), "department": (me.department or "").strip(), "is_teacher": bool((me.teacher_of or "").strip())},
        "application": serialize_teacher_application(rows[0][0]) if rows else None,
        "designations": list(TEACHER_DESIGNATIONS),
    }


async def update_my_application(model, user_id: int, from_statuses: tuple, values: dict):
    rows = await run_returning(
        update(model).where(model.id == select(func.max(model.id)).where(model.user_id == user_id).scalar_subquery(), model.status.in_(from_statuses))
        .values(updated_at=utc_now_iso(), **values).returning(model.id)
    )
    if not rows:
        raise HTTPException(status_code=400, detail="There is no application in a state that allows this.")
    return rows[0][0]

@app.post("/api/teacher-applications/me/withdraw")
async def withdraw_teacher_application(current_user_id: int = Depends(get_current_user_id)):
    await update_my_application(DBTeacherRequest, current_user_id, OPEN_APPLICATION, {"status": "withdrawn"})
    return {"status": "withdrawn"}

@app.post("/api/teacher-applications/me/answer")
async def answer_teacher_application(body: ApplicationAnswer, current_user_id: int = Depends(get_current_user_id)):
    answer = clean_required(body.answer, 2000, "answer")
    await update_my_application(DBTeacherRequest, current_user_id, ("needs_info",), {"status": "pending", "info_answer": answer})
    spawn_background(notify_founders("account", "A teacher applicant answered your question.", "founder.html?tab=teachers"))
    return {"status": "pending"}


@app.get("/api/founder/teacher-applications")
async def founder_teacher_applications(status: str = "", founder_id: int = Depends(require_founder)):
    conditions = [DBTeacherRequest.status == status] if status else []
    rows = await fetch_one_off(
        select(DBTeacherRequest, DBUser.name, DBUser.email, DBUser.account_status, DBUser.profile_pic)
        .outerjoin(DBUser, DBUser.id == DBTeacherRequest.user_id).where(*conditions)
        .order_by(case((DBTeacherRequest.status.in_(OPEN_APPLICATION), 0), else_=1), DBTeacherRequest.id.desc()).limit(300)
    )
    return {"applications": [serialize_teacher_application(req, {
        "name": name or f"User #{req.user_id}", "email": email or "", "account_status": account_status or "pending",
        "profile_pic": pic if pic and len(pic) <= 1000 else "",
    }) for req, name, email, account_status, pic in rows]}


@app.post("/api/founder/teacher-applications/{request_id}")
async def founder_decide_teacher(request_id: int, body: FounderDecision, founder_id: int = Depends(require_founder)):
    note = clean_text(body.note, 1000, "note")
    rows = await fetch_one_off(select(DBTeacherRequest).where(DBTeacherRequest.id == request_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That application was not found.")
    req = rows[0][0]
    if req.status not in OPEN_APPLICATION:
        raise HTTPException(status_code=400, detail="That application has already been settled.")
    now_iso = utc_now_iso()
    if body.action == "approve":
        await run_one_off(update(DBTeacherRequest).where(DBTeacherRequest.id == request_id).values(status="approved", decision_note=note, decided_by=founder_id, decided_at=now_iso, updated_at=now_iso))
        await run_one_off(update(DBUser).where(DBUser.id == req.user_id).values(teacher_of=req.college_key))
        await ensure_institution_trial(req.college_key, req.college_name)
        hub_changed(req.college_key)
        message = f"You are now a teacher of {req.college_name} on College Hub."
    elif body.action == "decline":
        if not note:
            raise HTTPException(status_code=400, detail="Give the applicant a reason.")
        await run_one_off(update(DBTeacherRequest).where(DBTeacherRequest.id == request_id).values(status="declined", decision_note=note, decided_by=founder_id, decided_at=now_iso, updated_at=now_iso))
        message = f"Your teacher application was declined: {note}"
    elif body.action == "ask":
        if not note:
            raise HTTPException(status_code=400, detail="Write the question for the applicant.")
        await run_one_off(update(DBTeacherRequest).where(DBTeacherRequest.id == request_id).values(status="needs_info", info_question=note, info_answer="", updated_at=now_iso))
        message = f"The founder has a question about your teacher application: {note[:120]}"
    else:
        raise HTTPException(status_code=400, detail="Action must be approve, decline or ask.")
    spawn_background(create_notification(req.user_id, "account", message, now_iso, "apply-teacher.html"))
    return {"id": request_id, "status": {"approve": "approved", "decline": "declined", "ask": "needs_info"}[body.action]}


@app.get("/api/founder/teachers")
async def founder_teachers(founder_id: int = Depends(require_founder)):
    rows = await fetch_one_off(select(DBUser.id, DBUser.name, DBUser.email, DBUser.college_name, DBUser.department, DBUser.teacher_of)
                               .where(func.coalesce(DBUser.teacher_of, "") != "").order_by(DBUser.teacher_of, DBUser.name))
    return {"teachers": [{"id": r.id, "name": r.name or "", "email": r.email or "", "college": r.college_name or r.teacher_of, "department": r.department or "", "college_key": r.teacher_of} for r in rows]}


@app.post("/api/founder/teachers/{user_id}/revoke")
async def founder_revoke_teacher(user_id: int, body: ReasonBody, founder_id: int = Depends(require_founder)):
    rows = await run_returning(update(DBUser).where(DBUser.id == user_id, func.coalesce(DBUser.teacher_of, "") != "").values(teacher_of="").returning(DBUser.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That person is not a teacher.")
    old = await fetch_one_off(select(DBTeacherRequest.college_key).where(DBTeacherRequest.user_id == user_id, DBTeacherRequest.status == "approved").order_by(DBTeacherRequest.id.desc()).limit(1))
    if old:
        hub_changed(old[0][0])
    reason = clean_text(body.reason, 500, "reason")
    spawn_background(create_notification(user_id, "account", "Your teacher access was removed." + (f" Reason: {reason}" if reason else ""), utc_now_iso(), "apply-teacher.html"))
    return {"status": "revoked"}


# ---------- admin applications ----------
def serialize_admin_application(req, extra: Optional[dict] = None) -> dict:
    status_now = (req.status or "pending").lower()
    status_now = {"rejected": "declined"}.get(status_now, status_now)
    return {
        "id": req.id, "user_id": req.user_id, "status": status_now, "college": req.college_name or "", "departments": json_list(req.departments),
        "role_at_college": req.role_at_college or "", "staff_id": req.staff_id or "", "official_email": req.official_email or "", "phone": req.phone or "",
        "hours": req.hours or 0, "languages": req.languages or "", "id_proof_url": req.id_proof_url or "", "letter_url": req.letter_url or "",
        "motivation": req.motivation or "", "decision_note": req.decision_note or "", "info_question": req.info_question or "",
        "info_answer": req.info_answer or "", "requested_at": req.requested_at or "", "updated_at": req.updated_at or req.requested_at or "",
        "decided_at": req.decided_at or "", **(extra or {}),
    }


@app.post("/api/admin-applications")
async def create_admin_application(body: AdminApplicationBody, current_user_id: int = Depends(get_current_user_id)):
    me = await applicant_profile(current_user_id)
    if (me.is_founder or 0) == 1:
        raise HTTPException(status_code=400, detail="You are the founder.")
    if (me.is_admin or 0) == 1:
        raise HTTPException(status_code=400, detail="You are already an admin.")
    college = (me.college_name or "").strip()
    if not college:
        raise HTTPException(status_code=400, detail="Add your college or institution to your profile first.")
    if body.role_at_college not in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail="Pick your role at the college from the list.")
    if not body.agree:
        raise HTTPException(status_code=400, detail="Accept the code of conduct before sending.")
    departments = json_strings(body.departments, 120, 12)
    if not departments:
        raise HTTPException(status_code=400, detail="Pick at least one department you will verify.")
    email, phone = clean_contact(body.official_email, body.phone)
    id_proof = clean_link(body.id_proof_url, "ID proof address")
    if not id_proof:
        raise HTTPException(status_code=400, detail="Attach a photo of your college ID card.")
    hours = body.hours or 0
    if not (1 <= hours <= 60):
        raise HTTPException(status_code=400, detail="Hours per week must be between 1 and 60.")
    motivation = clean_required(body.motivation, 2000, "reason you want to help")
    if len(motivation) < 30:
        raise HTTPException(status_code=400, detail="Tell the founder a little more about why you want to help (at least 30 characters).")
    open_rows = await fetch_one_off(select(DBAdminRequest.id).where(DBAdminRequest.user_id == current_user_id, func.lower(DBAdminRequest.status).in_(OPEN_APPLICATION)))
    if open_rows:
        raise HTTPException(status_code=400, detail="You already have an application waiting. You can withdraw it and apply again.")
    now_iso = utc_now_iso()
    rows = await run_returning(DBAdminRequest.__table__.insert().values(
        user_id=current_user_id, name=me.name or "", status="pending", requested_at=now_iso, updated_at=now_iso,
        college_name=college, college_key=college_key_of(college), departments=json.dumps(departments), role_at_college=body.role_at_college,
        staff_id=clean_required(body.staff_id, 60, "staff or student ID"), official_email=email, phone=phone, hours=hours,
        languages=clean_text(body.languages, 120, "languages"), id_proof_url=id_proof, letter_url=clean_link(body.letter_url, "letter address"),
        motivation=motivation, decision_note="", info_question="", info_answer="", decided_at="",
    ).returning(DBAdminRequest.id))
    spawn_background(notify_founders("account", f"New admin application from {me.name or 'someone'} ({college}).", "founder.html?tab=admins"))
    return {"id": rows[0][0], "status": "pending"}


@app.get("/api/admin-applications/me")
async def my_admin_application(current_user_id: int = Depends(get_current_user_id)):
    me = await applicant_profile(current_user_id)
    rows, scopes, departments = await asyncio.gather(
        fetch_one_off(select(DBAdminRequest).where(DBAdminRequest.user_id == current_user_id).order_by(DBAdminRequest.id.desc()).limit(1)),
        fetch_one_off(select(DBAdminScope.department, DBAdminScope.college_name).where(DBAdminScope.user_id == current_user_id)),
        fetch_one_off(select(DBUser.department).where(USER_COLLEGE_KEY == college_key_of(me.college_name), func.coalesce(DBUser.department, "") != "").distinct()),
    )
    return {
        "profile": {"name": me.name or "", "college": (me.college_name or "").strip(), "department": (me.department or "").strip(),
                    "is_admin": (me.is_admin or 0) == 1 and (me.is_founder or 0) != 1, "is_founder": (me.is_founder or 0) == 1},
        "application": serialize_admin_application(rows[0][0]) if rows else None,
        "scopes": [d for d, _ in scopes],
        "college_departments": sorted({(d or "").strip() for (d,) in departments if (d or "").strip()}),
        "roles": list(ADMIN_ROLES),
    }

@app.post("/api/admin-applications/me/withdraw")
async def withdraw_admin_application(current_user_id: int = Depends(get_current_user_id)):
    await update_my_application(DBAdminRequest, current_user_id, OPEN_APPLICATION, {"status": "withdrawn"})
    return {"status": "withdrawn"}

@app.post("/api/admin-applications/me/answer")
async def answer_admin_application(body: ApplicationAnswer, current_user_id: int = Depends(get_current_user_id)):
    answer = clean_required(body.answer, 2000, "answer")
    await update_my_application(DBAdminRequest, current_user_id, ("needs_info",), {"status": "pending", "info_answer": answer})
    spawn_background(notify_founders("account", "An admin applicant answered your question.", "founder.html?tab=admins"))
    return {"status": "pending"}


async def replace_scopes(user_id: int, college_name: str, departments: list, granted_by: int):
    key, now_iso = college_key_of(college_name), utc_now_iso()
    async with AutocommitSession() as db:
        await db.execute(delete(DBAdminScope).where(DBAdminScope.user_id == user_id))
        if departments:
            await db.execute(DBAdminScope.__table__.insert().values([{
                "user_id": user_id, "college_key": key, "college_name": college_name, "department_key": college_key_of(d), "department": d,
                "granted_by": granted_by, "granted_at": now_iso} for d in departments]))


@app.get("/api/founder/admin-applications")
async def founder_admin_applications(status: str = "", founder_id: int = Depends(require_founder)):
    conditions = [func.lower(DBAdminRequest.status) == status] if status else []
    rows = await fetch_one_off(
        select(DBAdminRequest, DBUser.name, DBUser.email, DBUser.account_status, DBUser.profile_pic, DBUser.department)
        .outerjoin(DBUser, DBUser.id == DBAdminRequest.user_id).where(*conditions)
        .order_by(case((func.lower(DBAdminRequest.status).in_(OPEN_APPLICATION), 0), else_=1), DBAdminRequest.id.desc()).limit(300)
    )
    return {"applications": [serialize_admin_application(req, {
        "name": name or req.name or f"User #{req.user_id}", "email": email or "", "account_status": account_status or "pending",
        "profile_pic": pic if pic and len(pic) <= 1000 else "", "own_department": department or "",
    }) for req, name, email, account_status, pic, department in rows]}


@app.post("/api/founder/admin-applications/{request_id}")
async def founder_decide_admin(request_id: int, body: FounderDecision, founder_id: int = Depends(require_founder)):
    note = clean_text(body.note, 1000, "note")
    rows = await fetch_one_off(select(DBAdminRequest).where(DBAdminRequest.id == request_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That application was not found.")
    req = rows[0][0]
    if (req.status or "").lower() not in OPEN_APPLICATION:
        raise HTTPException(status_code=400, detail="That application has already been settled.")
    now_iso = utc_now_iso()
    if body.action == "approve":
        departments = json_strings(body.departments if body.departments is not None else json_list(req.departments), 120, 20)
        if not departments:
            raise HTTPException(status_code=400, detail="Give the admin at least one department.")
        college = req.college_name or ""
        if not college:
            profile = await applicant_profile(req.user_id)
            college = (profile.college_name or "").strip()
        await run_one_off(update(DBAdminRequest).where(DBAdminRequest.id == request_id).values(status="approved", decision_note=note, decided_by=founder_id, decided_at=now_iso, updated_at=now_iso, departments=json.dumps(departments)))
        await run_one_off(update(DBUser).where(DBUser.id == req.user_id).values(is_admin=1))
        await replace_scopes(req.user_id, college, departments, founder_id)
        message = f"You are now an admin for {college} ({', '.join(departments)}). Open the Verification desk from your account menu."
        link = "verify.html"
    elif body.action == "decline":
        if not note:
            raise HTTPException(status_code=400, detail="Give the applicant a reason.")
        await run_one_off(update(DBAdminRequest).where(DBAdminRequest.id == request_id).values(status="declined", decision_note=note, decided_by=founder_id, decided_at=now_iso, updated_at=now_iso))
        message, link = f"Your admin application was declined: {note}", "apply-admin.html"
    elif body.action == "ask":
        if not note:
            raise HTTPException(status_code=400, detail="Write the question for the applicant.")
        await run_one_off(update(DBAdminRequest).where(DBAdminRequest.id == request_id).values(status="needs_info", info_question=note, info_answer="", updated_at=now_iso))
        message, link = f"The founder has a question about your admin application: {note[:120]}", "apply-admin.html"
    else:
        raise HTTPException(status_code=400, detail="Action must be approve, decline or ask.")
    spawn_background(create_notification(req.user_id, "account", message, now_iso, link))
    return {"id": request_id, "status": {"approve": "approved", "decline": "declined", "ask": "needs_info"}[body.action]}


@app.get("/api/founder/admins")
async def founder_admins(founder_id: int = Depends(require_founder)):
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    admins, scopes, stats = await asyncio.gather(
        fetch_one_off(select(DBUser.id, DBUser.name, DBUser.email, DBUser.college_name).where(DBUser.is_admin == 1, func.coalesce(DBUser.is_founder, 0) == 0).order_by(DBUser.name)),
        fetch_one_off(select(DBAdminScope.user_id, DBAdminScope.department, DBAdminScope.college_name)),
        fetch_one_off(select(DBVerificationLog.admin_id, DBVerificationLog.action, func.count(), func.sum(DBVerificationLog.reversed))
                      .where(DBVerificationLog.created_at >= since).group_by(DBVerificationLog.admin_id, DBVerificationLog.action)),
    )
    scope_of: dict = {}
    for user_id, department, college in scopes:
        scope_of.setdefault(user_id, {"college": college, "departments": []})["departments"].append(department)
    stat_of: dict = {}
    for admin_id, action, count, reversed_count in stats:
        entry = stat_of.setdefault(admin_id, {"approve": 0, "reject": 0, "pass": 0, "needs_info": 0, "reversed": 0})
        if action in entry:
            entry[action] += count
        entry["reversed"] += reversed_count or 0
    return {"admins": [{
        "id": r.id, "name": r.name or "", "email": r.email or "", "college": (scope_of.get(r.id) or {}).get("college") or r.college_name or "",
        "departments": (scope_of.get(r.id) or {}).get("departments", []), "last_30_days": stat_of.get(r.id, {"approve": 0, "reject": 0, "pass": 0, "needs_info": 0, "reversed": 0}),
    } for r in admins]}


@app.put("/api/founder/admins/{user_id}/scope")
async def founder_set_scope(user_id: int, body: ScopeBody, founder_id: int = Depends(require_founder)):
    rows = await fetch_one_off(select(DBUser.college_name, DBUser.is_admin, DBUser.is_founder).where(DBUser.id == user_id))
    if not rows or (rows[0].is_admin or 0) != 1 or (rows[0].is_founder or 0) == 1:
        raise HTTPException(status_code=404, detail="That person is not an admin.")
    departments = json_strings(body.departments, 120, 20)
    if not departments:
        raise HTTPException(status_code=400, detail="Keep at least one department, or revoke the admin instead.")
    existing = await fetch_one_off(select(DBAdminScope.college_name).where(DBAdminScope.user_id == user_id).limit(1))
    college = existing[0][0] if existing else (rows[0].college_name or "")
    await replace_scopes(user_id, college, departments, founder_id)
    spawn_background(create_notification(user_id, "account", f"Your verification departments are now: {', '.join(departments)}.", utc_now_iso(), "verify.html"))
    return {"id": user_id, "departments": departments}


@app.post("/api/founder/admins/{user_id}/revoke")
async def founder_revoke_admin(user_id: int, body: ReasonBody, founder_id: int = Depends(require_founder)):
    rows = await run_returning(update(DBUser).where(DBUser.id == user_id, DBUser.is_admin == 1, func.coalesce(DBUser.is_founder, 0) == 0).values(is_admin=0).returning(DBUser.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That person is not an admin.")
    await run_one_off(delete(DBAdminScope).where(DBAdminScope.user_id == user_id))
    await run_one_off(update(DBAdminRequest).where(DBAdminRequest.user_id == user_id, func.lower(DBAdminRequest.status) == "approved").values(status="revoked", updated_at=utc_now_iso()))
    reason = clean_text(body.reason, 500, "reason")
    spawn_background(create_notification(user_id, "account", "Your admin access was removed." + (f" Reason: {reason}" if reason else ""), utc_now_iso(), "apply-admin.html"))
    return {"status": "revoked"}


async def notify_founders(notif_type: str, content: str, link: str):
    try:
        rows = await fetch_one_off(select(DBUser.id).where(DBUser.is_founder == 1))
        await notify_many([row[0] for row in rows], notif_type, content, link)
    except Exception as e:
        print("Error notifying the founder:", e)


# ---------- the verification desk ----------
async def verifier_of(user_id: int) -> dict:
    """Who may verify what: the founder everything, an admin the (college, department) pairs of their scope."""
    rows, scopes = await asyncio.gather(
        fetch_one_off(select(DBUser.is_admin, DBUser.is_founder, DBUser.name).where(DBUser.id == user_id)),
        fetch_one_off(select(DBAdminScope.college_key, DBAdminScope.department_key, DBAdminScope.department, DBAdminScope.college_name).where(DBAdminScope.user_id == user_id)),
    )
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    founder = (rows[0].is_founder or 0) == 1
    if not founder and (rows[0].is_admin or 0) != 1:
        raise HTTPException(status_code=403, detail="The verification desk is for admins.")
    return {"id": user_id, "name": rows[0].name or "", "founder": founder, "scopes": [(c, d) for c, d, _, _ in scopes],
            "scope_labels": [label for _, _, label, _ in scopes], "college": scopes[0][3] if scopes else ""}

def scope_clause(verifier: dict):
    if verifier["founder"]:
        return literal(True)
    if not verifier["scopes"]:
        return literal(False)
    return or_(*[and_(USER_COLLEGE_KEY == college, EFFECTIVE_DEPARTMENT == department) for college, department in verifier["scopes"]])

UNASSIGNED_CLAUSE = ~exists().where(DBAdminScope.college_key == USER_COLLEGE_KEY, DBAdminScope.department_key == EFFECTIVE_DEPARTMENT)

async def student_in_scope(verifier: dict, student_id: int):
    rows = await fetch_one_off(
        select(DBUser.id, DBUser.name, DBUser.college_name, DBUser.department, DBUser.verify_department, DBUser.account_status, DBUser.is_founder)
        .where(DBUser.id == student_id, scope_clause(verifier))
    )
    if not rows or (rows[0].is_founder or 0) == 1:
        raise HTTPException(status_code=403, detail="That account is not in your verification scope.")
    return rows[0]


@app.get("/api/verify/queue")
async def verify_queue(tab: str = "mine", current_user_id: int = Depends(get_current_user_id)):
    verifier = await verifier_of(current_user_id)
    statuses = ("needs_info",) if tab == "needs_info" else ("pending", "appealed")
    conditions = [func.coalesce(DBUser.account_status, "pending").in_(statuses), func.coalesce(DBUser.is_founder, 0) == 0, DBUser.id != current_user_id, scope_clause(verifier)]
    if tab == "unassigned":
        if not verifier["founder"]:
            raise HTTPException(status_code=403, detail="Only the founder sees accounts no admin covers.")
        conditions.append(UNASSIGNED_CLAUSE)
    joined = select(func.min(DBHistory.time)).where(DBHistory.user_id == DBUser.id, DBHistory.action == "Account Created").correlate(DBUser).scalar_subquery()
    picture = case((func.length(DBUser.profile_pic) > 1000, ""), else_=DBUser.profile_pic).label("profile_pic")
    rows = await fetch_one_off(
        select(DBUser.id, DBUser.name, DBUser.college_name, DBUser.department, DBUser.division, DBUser.roll_no, DBUser.verify_department,
               DBUser.account_status, DBUser.account_type, DBUser.profession, picture, joined.label("joined"),
               (func.length(func.coalesce(DBUser.id_card_image, "")) > 0).label("has_id_card"))
        .where(*conditions).order_by(DBUser.id).limit(VERIFY_QUEUE_LIMIT)
    )
    ids = [row.id for row in rows]
    logs = await fetch_one_off(
        select(DBVerificationLog.student_id, DBVerificationLog.action, DBVerificationLog.reason, DBVerificationLog.from_department, DBVerificationLog.to_department, DBVerificationLog.created_at, DBUser.name)
        .outerjoin(DBUser, DBUser.id == DBVerificationLog.admin_id)
        .where(DBVerificationLog.student_id.in_(ids)).order_by(DBVerificationLog.id.desc())
    ) if ids else []
    last: dict = {}
    for student_id, action, reason, from_d, to_d, at, admin_name in logs:
        last.setdefault(student_id, {"action": action, "reason": reason or "", "from": from_d or "", "to": to_d or "", "at": at or "", "by": admin_name or ""})
    return {"people": [{
        "id": r.id, "name": r.name or "", "college": r.college_name or "", "department": r.department or "", "division": r.division or "",
        "roll_no": r.roll_no or "", "routed_department": r.verify_department or "", "status": r.account_status or "pending",
        "account_type": r.account_type or "standard", "profession": r.profession or "", "profile_pic": r.profile_pic or "",
        "joined": r.joined or "", "has_id_card": bool(r.has_id_card), "last": last.get(r.id),
    } for r in rows]}


@app.get("/api/verify/summary")
async def verify_summary(current_user_id: int = Depends(get_current_user_id)):
    verifier = await verifier_of(current_user_id)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    waiting = and_(func.coalesce(DBUser.account_status, "pending").in_(("pending", "appealed")), func.coalesce(DBUser.is_founder, 0) == 0, DBUser.id != current_user_id)
    reads = [
        fetch_one_off(select(DBVerificationLog.action, func.count()).where(DBVerificationLog.admin_id == current_user_id, DBVerificationLog.created_at >= today_start).group_by(DBVerificationLog.action)),
        fetch_one_off(select(func.count()).select_from(DBUser).where(waiting, scope_clause(verifier))),
        fetch_one_off(select(func.count()).select_from(DBUser).where(func.coalesce(DBUser.account_status, "") == "needs_info", scope_clause(verifier))),
    ]
    if verifier["founder"]:
        reads.append(fetch_one_off(select(func.count()).select_from(DBUser).where(waiting, UNASSIGNED_CLAUSE)))
    results = await asyncio.gather(*reads)
    return {
        "founder": verifier["founder"], "college": verifier["college"], "departments": verifier["scope_labels"],
        "today": {action: count for action, count in results[0]}, "waiting": results[1][0][0] or 0, "needs_info": results[2][0][0] or 0,
        "unassigned": (results[3][0][0] or 0) if verifier["founder"] else 0,
        "reasons": {key: text_ for key, text_ in REJECT_REASONS.items()},
    }


@app.get("/api/verify/{student_id}/id-card")
async def verify_id_card(student_id: int, current_user_id: int = Depends(get_current_user_id)):
    verifier = await verifier_of(current_user_id)
    await student_in_scope(verifier, student_id)
    rows = await fetch_one_off(select(DBUser.id_card_image).where(DBUser.id == student_id))
    image = await load_id_card(rows[0][0]) if rows else None
    if not image:
        raise HTTPException(status_code=404, detail="This account has no ID document.")
    return {"image": image}


@app.get("/api/verify/{student_id}/departments")
async def verify_departments(student_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Departments of the student's college, to pass a request on to, and which of them have an admin."""
    verifier = await verifier_of(current_user_id)
    student = await student_in_scope(verifier, student_id)
    key = college_key_of(student.college_name)
    used, covered = await asyncio.gather(
        fetch_one_off(select(DBUser.department).where(USER_COLLEGE_KEY == key, func.coalesce(DBUser.department, "") != "").distinct()),
        fetch_one_off(select(DBAdminScope.department, DBAdminScope.department_key).where(DBAdminScope.college_key == key)),
    )
    names = {college_key_of(d): d.strip() for (d,) in used if d and d.strip()}
    for department, dept_key in covered:
        names.setdefault(dept_key, department)
    covered_keys = {dept_key for _, dept_key in covered}
    return {"departments": [{"name": name, "has_admin": dept_key in covered_keys} for dept_key, name in sorted(names.items(), key=lambda item: item[1])]}


async def apply_verification(verifier: dict, student, body: VerifyAction) -> dict:
    now_iso = utc_now_iso()
    current_department = (student.verify_department or "").strip() or (student.department or "").strip()
    values, message, log_values = {}, "", {"reason": "", "from_department": current_department, "to_department": ""}
    note = clean_text(body.note, 500, "note")
    if body.action == "approve":
        values = {"account_status": "verified"}
        message = "Your account is verified. Welcome to Connect2Minds!"
    elif body.action == "reject":
        if body.reason not in REJECT_REASONS:
            raise HTTPException(status_code=400, detail="Pick a reason for rejecting.")
        reason_text = REJECT_REASONS[body.reason] or note
        if not reason_text:
            raise HTTPException(status_code=400, detail="Write the reason for rejecting.")
        values = {"account_status": "rejected"}
        log_values["reason"] = reason_text if not note or body.reason == "other" else f"{reason_text}. {note}"
        message = f"Your account could not be verified: {log_values['reason']}. Fix your profile and appeal from your profile page."
    elif body.action == "pass":
        department = clean_required(body.department, 120, "department")
        if college_key_of(department) == college_key_of(current_department):
            raise HTTPException(status_code=400, detail="Pick a different department.")
        values = {"verify_department": department}
        log_values.update({"to_department": department, "reason": note})
        message = ""
    elif body.action == "needs_info":
        if not note:
            raise HTTPException(status_code=400, detail="Tell the student what to fix or upload again.")
        values = {"account_status": "needs_info"}
        log_values["reason"] = note
        message = f"Your verification needs something from you: {note} Upload a new ID photo from your profile page."
    else:
        raise HTTPException(status_code=400, detail="Action must be approve, reject, pass or needs_info.")
    result = await run_returning(update(DBUser).where(DBUser.id == student.id).values(**values).returning(*[getattr(DBUser, field) for field in DIRECTORY_FIELDS], DBUser.bio))
    await run_one_off(DBVerificationLog.__table__.insert().values(student_id=student.id, admin_id=verifier["id"], action=body.action, created_at=now_iso, **log_values))
    if message:
        spawn_background(create_notification(student.id, "account", message, now_iso, "profile.html"))
    if body.action == "pass":
        key = college_key_of(student.college_name)
        admins = await fetch_one_off(select(DBAdminScope.user_id).where(DBAdminScope.college_key == key, DBAdminScope.department_key == college_key_of(values["verify_department"])))
        targets = [row[0] for row in admins] or [row[0] for row in await fetch_one_off(select(DBUser.id).where(DBUser.is_founder == 1))]
        spawn_background(notify_many(targets, "account", f"{student.name or 'A student'} was passed to {values['verify_department']} for verification.", "verify.html"))
    if result:
        spawn_background(broadcast_directory({"type": "profile_updated", "profile": directory_card(result[0])}))
    return {"id": student.id, "action": body.action, **values}


@app.post("/api/verify/bulk")
async def verify_bulk(body: VerifyBulk, current_user_id: int = Depends(get_current_user_id)):
    """Approve many at once. Accounts outside your scope are skipped and counted."""
    verifier = await verifier_of(current_user_id)
    ids = list(dict.fromkeys(body.ids))[:100]
    done, skipped = 0, 0
    for student_id in ids:
        try:
            student = await student_in_scope(verifier, student_id)
            await apply_verification(verifier, student, VerifyAction(action="approve"))
            done += 1
        except HTTPException:
            skipped += 1
    return {"approved": done, "skipped": skipped}


@app.post("/api/verify/{student_id}")
async def verify_student(student_id: int, body: VerifyAction, current_user_id: int = Depends(get_current_user_id)):
    verifier = await verifier_of(current_user_id)
    student = await student_in_scope(verifier, student_id)
    return await apply_verification(verifier, student, body)


@app.get("/api/founder/verification-log")
async def founder_verification_log(admin_id: Optional[int] = None, founder_id: int = Depends(require_founder)):
    student = aliased(DBUser)
    conditions = [DBVerificationLog.admin_id == admin_id] if admin_id else []
    rows = await fetch_one_off(
        select(DBVerificationLog, DBUser.name, student.name)
        .outerjoin(DBUser, DBUser.id == DBVerificationLog.admin_id).outerjoin(student, student.id == DBVerificationLog.student_id)
        .where(*conditions).order_by(DBVerificationLog.id.desc()).limit(200)
    )
    return {"log": [{
        "id": log.id, "student_id": log.student_id, "student": student_name or f"User #{log.student_id}", "admin_id": log.admin_id,
        "admin": admin_name or f"User #{log.admin_id}", "action": log.action, "reason": log.reason or "", "from": log.from_department or "",
        "to": log.to_department or "", "reversed": bool(log.reversed), "at": log.created_at or "",
    } for log, admin_name, student_name in rows]}


@app.post("/api/founder/verification-log/{log_id}/reverse")
async def founder_reverse_verification(log_id: int, founder_id: int = Depends(require_founder)):
    rows = await run_returning(update(DBVerificationLog).where(DBVerificationLog.id == log_id, DBVerificationLog.reversed == 0, DBVerificationLog.action.in_(("approve", "reject", "needs_info")))
                               .values(reversed=1).returning(DBVerificationLog.student_id))
    if not rows:
        raise HTTPException(status_code=400, detail="That decision cannot be reversed (already reversed, or nothing to undo).")
    student_id = rows[0][0]
    await run_one_off(update(DBUser).where(DBUser.id == student_id).values(account_status="pending"))
    await run_one_off(DBVerificationLog.__table__.insert().values(student_id=student_id, admin_id=founder_id, action="reverse", reason=f"Reversed decision #{log_id}", created_at=utc_now_iso()))
    spawn_background(create_notification(student_id, "account", "Your verification is being looked at again.", utc_now_iso(), "profile.html"))
    return {"status": "pending"}


@app.post("/api/me/id-card")
async def upload_my_id_card(body: IdCardUpload, current_user_id: int = Depends(get_current_user_id)):
    """A new ID photo from the student (after "needs info" or a rejection). The request goes back in the queue."""
    marker = await store_id_card((body.image or "").strip())
    old = await fetch_one_off(select(DBUser.id_card_image).where(DBUser.id == current_user_id))
    rows = await run_returning(update(DBUser).where(DBUser.id == current_user_id).values(
        id_card_image=marker,
        account_status=case((func.coalesce(DBUser.account_status, "pending").in_(("needs_info", "rejected")), "pending"), else_=DBUser.account_status),
    ).returning(DBUser.account_status))
    if old:
        remove_id_card_file(old[0][0])
    return {"account_status": rows[0][0] if rows else "pending"}


# ==========================================
# 18. PLANS, LIMITS AND PAYMENTS (INR, Razorpay)
# PLANS is the one list of prices and limits; the pricing page reads it from /api/plans.
# Prices are in paise. B2C prices include 18% GST; business prices are before GST.
# The founder is never limited and never charged. Admins and teachers pay like everyone else.
# ==========================================
GST_RATE = 18
UNLIMITED = None
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
BUSINESS_NAME = os.getenv("BUSINESS_NAME", "Connect2Minds")
BUSINESS_GSTIN = os.getenv("BUSINESS_GSTIN", "")
INSTITUTION_TRIAL_DAYS = 60
MULTI_YEAR_DISCOUNT = {1: 0, 2: 10, 3: 18}   # per cent off the yearly price, for institutions

FREE_LIMITS = {"new_conversations": 10, "board_applications": 5, "teams": 3, "research_saves": 5, "pro_intros": 3,
               "advanced_filters": False, "profile_boost": False}

PLANS = {
    # ---- Freemium B2C and professional networking (self-serve, for one person) ----
    "free": {"line": "personal", "name": "Free", "rank": 0, "gst": "inclusive", "prices": {}, "self_serve": False,
             "limits": FREE_LIMITS, "blurb": "Everything you need to build a profile, find people and join teams."},
    "student_pro": {"line": "personal", "name": "Student Pro", "rank": 1, "gst": "inclusive", "prices": {"month": 9900, "year": 79900}, "self_serve": True,
                    "limits": {"new_conversations": 30, "board_applications": UNLIMITED, "teams": 10, "research_saves": UNLIMITED, "pro_intros": 10,
                               "advanced_filters": True, "profile_boost": False},
                    "blurb": "Low-cost upgrade for students: unlimited applications, more outreach and advanced filters."},
    "premium": {"line": "personal", "name": "Networking Premium", "rank": 2, "gst": "inclusive", "prices": {"month": 29900, "year": 249900}, "self_serve": True,
                "limits": {"new_conversations": UNLIMITED, "board_applications": UNLIMITED, "teams": 10, "research_saves": UNLIMITED, "pro_intros": UNLIMITED,
                           "advanced_filters": True, "profile_boost": False},
                "blurb": "Unrestricted messaging and direct outreach to professionals."},
    "premium_plus": {"line": "personal", "name": "Premium Plus", "rank": 3, "gst": "inclusive", "prices": {"month": 59900, "year": 499900}, "self_serve": True,
                     "limits": {"new_conversations": UNLIMITED, "board_applications": UNLIMITED, "teams": UNLIMITED, "research_saves": UNLIMITED, "pro_intros": UNLIMITED,
                                "advanced_filters": True, "profile_boost": True},
                     "blurb": "Everything in Premium, plus a profile boost (shown first in Discover and Professionals) and unlimited teams."},
    # ---- Recruiter access (enquiry, the founder switches it on) ----
    "recruiter_starter": {"line": "recruiter", "name": "Recruiter Starter", "gst": "extra", "prices": {"month": 299900, "year": 2999900},
                          "unlocks": 50, "seats": 1, "git_filters": False, "csv": False, "blurb": "Search verified talent and contact 50 people a month."},
    "recruiter_growth": {"line": "recruiter", "name": "Recruiter Growth", "gst": "extra", "prices": {"month": 799900, "year": 7999900},
                         "unlocks": 250, "seats": 3, "git_filters": True, "csv": True, "blurb": "250 contacts a month, GitHub-backed filters, CSV export and 3 seats."},
    "recruiter_enterprise": {"line": "recruiter", "name": "Recruiter Enterprise", "gst": "extra", "prices": {"year": 25000000}, "quote": True,
                             "unlocks": UNLIMITED, "seats": 10, "git_filters": True, "csv": True, "blurb": "Unlimited contacts and 10+ seats. Priced on request, from ₹2,50,000 a year."},
    # ---- Institutional SaaS licence (per college, yearly; enquiry) ----
    "inst_trial": {"line": "institution", "name": "Institution trial", "gst": "extra", "prices": {}, "max_students": 300, "hidden": True,
                   "blurb": f"{INSTITUTION_TRIAL_DAYS} days of the full institution features, free, when a college's first teacher is approved."},
    "inst_starter": {"line": "institution", "name": "Institution Starter", "gst": "extra", "prices": {"year": 4999900}, "max_students": 500,
                     "blurb": "Up to 500 students: attendance, marks, analytics, exports and admin controls."},
    "inst_growth": {"line": "institution", "name": "Institution Growth", "gst": "extra", "prices": {"year": 14999900}, "max_students": 2000,
                    "blurb": "Up to 2,000 students, with priority support."},
    "inst_campus": {"line": "institution", "name": "Institution Campus", "gst": "extra", "prices": {"year": 29999900}, "max_students": 5000,
                    "blurb": "Up to 5,000 students, several departments and campuses."},
    "inst_enterprise": {"line": "institution", "name": "Institution Enterprise", "gst": "extra", "prices": {"year": 5500}, "per_student": True, "quote": True,
                        "max_students": UNLIMITED, "blurb": "Above 5,000 students: ₹55 per student a year, priced on request."},
    # ---- Sponsored bounties and hackathons (per challenge; enquiry) ----
    "sponsor_basic": {"line": "sponsor", "name": "Bounty Basic", "gst": "extra", "prices": {"one_time": 499900}, "days": 30, "credits": 1, "tier": "basic",
                      "blurb": "One sponsored challenge on the Opportunities board for 30 days, with a Sponsored tag."},
    "sponsor_featured": {"line": "sponsor", "name": "Featured Challenge", "gst": "extra", "prices": {"one_time": 1499900}, "days": 60, "credits": 1, "tier": "featured",
                         "blurb": "Pinned for 60 days and pushed to students whose skills match."},
    "sponsor_hackathon": {"line": "sponsor", "name": "Hackathon Package", "gst": "extra", "prices": {"one_time": 4999900}, "days": 90, "credits": 1, "tier": "hackathon",
                          "blurb": "Registration, teams, submissions, judging, winners and a campus-wide push."},
    "sponsor_season": {"line": "sponsor", "name": "Season Pack", "gst": "extra", "prices": {"one_time": 5999900}, "days": 365, "credits": 5, "tier": "featured",
                       "blurb": "Five Featured challenges to use within a year."},
}
PERSONAL_PLANS = [key for key, plan in PLANS.items() if plan["line"] == "personal" and key != "free"]
PERIOD_DAYS = {"month": 30, "year": 365}
LIMIT_LABELS = {"new_conversations": "new conversations this month", "board_applications": "board applications this month",
                "teams": "teams", "research_saves": "saved research reports", "pro_intros": "introductions to professionals this month"}
MONTHLY_METRICS = ("new_conversations", "board_applications", "pro_intros")


class DBSubscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=True)       # the person, or the owner of a recruiter / sponsor plan
    college_key = Column(String, index=True, default="")        # institution licences belong to a college
    org_name = Column(String, default="")
    plan_key = Column(String, index=True)
    period = Column(String, default="month")                    # month, year, one_time, trial
    years = Column(Integer, default=1)
    status = Column(String, index=True, default="active")       # active, expired, cancelled
    starts_at = Column(String)                                  # YYYY-MM-DD
    ends_at = Column(String)                                    # YYYY-MM-DD, last day included
    amount_paise = Column(Integer, default=0)
    gst_paise = Column(Integer, default=0)
    credits = Column(Integer, default=0)                        # sponsor challenges left
    seats = Column(Integer, default=0)
    source = Column(String, default="razorpay")                 # razorpay, manual, trial
    granted_by = Column(Integer, nullable=True)
    note = Column(String, default="")
    reminded = Column(Integer, default=0)
    created_at = Column(String)

class DBPayment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    subscription_id = Column(Integer, nullable=True)
    plan_key = Column(String)
    period = Column(String, default="month")
    amount_paise = Column(Integer)
    gst_paise = Column(Integer, default=0)
    status = Column(String, index=True, default="created")      # created, paid, failed, refunded
    method = Column(String, default="razorpay")                 # razorpay, manual
    razorpay_order_id = Column(String, index=True, default="")
    razorpay_payment_id = Column(String, default="")
    reference = Column(String, default="")                      # manual payments: UPI / bank reference
    receipt_no = Column(String, default="")
    created_at = Column(String)
    paid_at = Column(String, default="")

class DBUsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("user_id", "metric", "period", name="ux_usage_counters"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    metric = Column(String)
    period = Column(String)                                     # YYYY-MM
    count = Column(Integer, default=0)


class OrderBody(BaseModel):
    plan_key: str
    period: str

class PaymentVerifyBody(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


def gst_split(plan: dict, amount: int) -> tuple:
    """(total to charge, the GST inside it) in paise."""
    if plan.get("gst") == "inclusive":
        return amount, round(amount * GST_RATE / (100 + GST_RATE))
    gst = round(amount * GST_RATE / 100)
    return amount + gst, gst

def plan_price(plan_key: str, period: str, years: int = 1) -> int:
    plan = PLANS.get(plan_key)
    if not plan or period not in plan["prices"]:
        raise HTTPException(status_code=400, detail="That plan cannot be bought for that period.")
    price = plan["prices"][period]
    if plan["line"] == "institution" and period == "year":
        price = round(price * years * (100 - MULTI_YEAR_DISCOUNT.get(years, 0)) / 100)
    return price

def this_month() -> str:
    return datetime.now().strftime("%Y-%m")

def today_iso() -> str:
    return datetime.now().date().isoformat()

def limit_of(plan_key: str, metric: str):
    return PLANS.get(plan_key or "free", PLANS["free"]).get("limits", FREE_LIMITS).get(metric, FREE_LIMITS.get(metric))

async def personal_plan(user_id: int) -> tuple:
    """(founder?, plan key) from the users row; a plan past its last day counts as free."""
    rows = await fetch_one_off(select(DBUser.is_founder, DBUser.plan, DBUser.plan_until).where(DBUser.id == user_id))
    if not rows:
        return False, "free"
    founder, plan, until = rows[0]
    if (founder or 0) == 1:
        return True, "founder"
    if plan in PLANS and until and until >= today_iso():
        return False, plan
    return False, "free"

async def usage_count(user_id: int, metric: str) -> int:
    rows = await fetch_one_off(select(DBUsageCounter.count).where(DBUsageCounter.user_id == user_id, DBUsageCounter.metric == metric, DBUsageCounter.period == this_month()))
    return rows[0][0] if rows else 0

async def bump_usage(user_id: int, metric: str, by: int = 1):
    try:
        await run_one_off(pg_insert(DBUsageCounter).values(user_id=user_id, metric=metric, period=this_month(), count=by)
                          .on_conflict_do_update(index_elements=["user_id", "metric", "period"], set_={"count": DBUsageCounter.count + by}))
    except Exception as e:
        print("Error counting usage:", e)

def upgrade_for(metric: str, plan_key: str) -> str:
    """The cheapest plan above plan_key that raises this limit."""
    current = limit_of(plan_key, metric)
    for key in PERSONAL_PLANS:
        if PLANS[key]["rank"] > PLANS.get(plan_key, PLANS["free"]).get("rank", 0):
            better = PLANS[key]["limits"].get(metric)
            if better is UNLIMITED or (current is not UNLIMITED and better > current):
                return key
    return "premium_plus"

async def check_limit(user_id: int, metric: str, used: Optional[int] = None):
    """Raises 402 when the person has used up a limit of their plan. used is given for totals (teams, reports);
    monthly limits are read from usage_counters."""
    founder, plan_key = await personal_plan(user_id)
    if founder:
        return
    limit = limit_of(plan_key, metric)
    if limit is UNLIMITED:
        return
    if used is None:
        used = await usage_count(user_id, metric)
    if used >= limit:
        better = PLANS[upgrade_for(metric, plan_key)]["name"]
        raise HTTPException(status_code=402, detail=f"You have used all {limit} {LIMIT_LABELS.get(metric, metric)} on the {PLANS.get(plan_key, PLANS['free'])['name']} plan. Upgrade to {better} on the Plans page to get more.")


# ---------- subscriptions ----------
def serialize_subscription(sub) -> dict:
    plan = PLANS.get(sub.plan_key, {})
    return {
        "id": sub.id, "user_id": sub.user_id, "college_key": sub.college_key or "", "org_name": sub.org_name or "", "plan_key": sub.plan_key,
        "plan_name": plan.get("name", sub.plan_key), "line": plan.get("line", ""), "period": sub.period, "years": sub.years or 1, "status": sub.status,
        "starts_at": sub.starts_at or "", "ends_at": sub.ends_at or "", "amount_paise": sub.amount_paise or 0, "gst_paise": sub.gst_paise or 0,
        "credits": sub.credits or 0, "seats": sub.seats or 0, "source": sub.source or "", "note": sub.note or "", "created_at": sub.created_at or "",
    }

async def refresh_user_plan(user_id: int):
    """users.plan / plan_until follow the best active personal subscription (shown as a badge, used by limits)."""
    rows = await fetch_one_off(select(DBSubscription.plan_key, DBSubscription.ends_at).where(
        DBSubscription.user_id == user_id, DBSubscription.status == "active", DBSubscription.plan_key.in_(PERSONAL_PLANS), DBSubscription.ends_at >= today_iso()))
    best = max(rows, key=lambda row: (PLANS[row[0]]["rank"], row[1]), default=None)
    await run_one_off(update(DBUser).where(DBUser.id == user_id).values(plan=best[0] if best else "", plan_until=best[1] if best else ""))

async def activate_subscription(*, user_id: Optional[int], plan_key: str, period: str, years: int = 1, amount: int = 0, gst: int = 0,
                                source: str, college_key: str = "", org_name: str = "", granted_by: Optional[int] = None, note: str = "",
                                starts_at: Optional[str] = None, ends_at: Optional[str] = None, credits: Optional[int] = None, seats: Optional[int] = None) -> int:
    plan = PLANS[plan_key]
    start = datetime.fromisoformat(starts_at).date() if starts_at else datetime.now().date()
    if not starts_at and user_id and plan["line"] == "personal":
        # Renewing the same plan early: the new period starts when the current one ends
        same = await fetch_one_off(select(func.max(DBSubscription.ends_at)).where(DBSubscription.user_id == user_id, DBSubscription.plan_key == plan_key, DBSubscription.status == "active"))
        if same and same[0][0] and same[0][0] >= start.isoformat():
            start = datetime.fromisoformat(same[0][0]).date() + timedelta(days=1)
    if ends_at:
        end = datetime.fromisoformat(ends_at).date()
    elif period == "one_time":
        end = start + timedelta(days=plan.get("days", 30) - 1)
    elif period == "trial":
        end = start + timedelta(days=INSTITUTION_TRIAL_DAYS - 1)
    else:
        end = start + timedelta(days=PERIOD_DAYS.get(period, 30) * (years or 1) - 1)
    rows = await run_returning(DBSubscription.__table__.insert().values(
        user_id=user_id, college_key=college_key, org_name=org_name, plan_key=plan_key, period=period, years=years or 1, status="active",
        starts_at=start.isoformat(), ends_at=end.isoformat(), amount_paise=amount, gst_paise=gst,
        credits=plan.get("credits", 0) if credits is None else credits, seats=plan.get("seats", 0) if seats is None else seats,
        source=source, granted_by=granted_by, note=note, reminded=0, created_at=utc_now_iso(),
    ).returning(DBSubscription.id))
    if user_id and plan["line"] == "personal":
        await refresh_user_plan(user_id)
    return rows[0][0]

async def college_licence(key: str) -> Optional[dict]:
    """The institution licence (or trial) a college has today."""
    if not key:
        return None
    rows = await fetch_one_off(select(DBSubscription).where(DBSubscription.college_key == key, DBSubscription.status == "active",
                                                           DBSubscription.plan_key.like("inst_%"), DBSubscription.ends_at >= today_iso()).order_by(DBSubscription.ends_at.desc()).limit(1))
    if not rows:
        return None
    sub = rows[0][0]
    plan = PLANS.get(sub.plan_key, {})
    return {"plan_key": sub.plan_key, "name": plan.get("name", sub.plan_key), "ends_at": sub.ends_at, "trial": sub.plan_key == "inst_trial", "max_students": plan.get("max_students")}

async def ensure_institution_trial(key: str, college_name: str = ""):
    """The first approved teacher of a college starts its free trial, once."""
    if not key:
        return
    seen = await fetch_one_off(select(DBSubscription.id).where(DBSubscription.college_key == key, DBSubscription.plan_key.like("inst_%")).limit(1))
    if not seen:
        await activate_subscription(user_id=None, plan_key="inst_trial", period="trial", source="trial", college_key=key, org_name=college_name, note="Started with the first approved teacher")

async def require_licence(key: str, feature: str):
    if not await college_licence(key):
        raise HTTPException(status_code=402, detail=f"{feature} is part of the Connect2Minds institution licence. Your college can start one from the Plans page.")


async def recruiter_access(user_id: int) -> Optional[dict]:
    """The recruiter plan this person may use: their own, or a seat on someone else's. The founder always may."""
    founder, _ = await personal_plan(user_id)
    if founder:
        return {"sub_id": 0, "plan_key": "recruiter_enterprise", "name": "Founder access", "owner": True, "owner_id": user_id, "unlocks": UNLIMITED,
                "seats": 0, "git_filters": True, "csv": True, "ends_at": ""}
    seat_subs = select(DBRecruiterSeat.subscription_id).where(DBRecruiterSeat.user_id == user_id)
    rows = await fetch_one_off(select(DBSubscription).where(
        or_(DBSubscription.user_id == user_id, DBSubscription.id.in_(seat_subs)), DBSubscription.status == "active",
        DBSubscription.plan_key.like("recruiter_%"), DBSubscription.ends_at >= today_iso()).order_by(DBSubscription.ends_at.desc()).limit(1))
    if not rows:
        return None
    sub = rows[0][0]
    plan = PLANS[sub.plan_key]
    return {"sub_id": sub.id, "plan_key": sub.plan_key, "name": plan["name"], "owner": sub.user_id == user_id, "owner_id": sub.user_id,
            "unlocks": plan["unlocks"], "seats": sub.seats or plan["seats"], "git_filters": plan["git_filters"], "csv": plan["csv"], "ends_at": sub.ends_at}

async def sponsor_credits(user_id: int) -> list:
    """Active sponsor packages with challenges left, newest first."""
    rows = await fetch_one_off(select(DBSubscription).where(DBSubscription.user_id == user_id, DBSubscription.status == "active",
                                                           DBSubscription.plan_key.like("sponsor_%"), DBSubscription.ends_at >= today_iso(), DBSubscription.credits > 0))
    return [row[0] for row in rows]


async def entitlements(user_id: int) -> dict:
    founder, plan_key = await personal_plan(user_id)
    usage_rows, teams, reports, subs, recruiter, credits = await asyncio.gather(
        fetch_one_off(select(DBUsageCounter.metric, DBUsageCounter.count).where(DBUsageCounter.user_id == user_id, DBUsageCounter.period == this_month())),
        fetch_one_off(select(func.count()).select_from(DBTeam).where(DBTeam.created_by == user_id, func.coalesce(DBTeam.college_key, "") == "")),
        fetch_one_off(select(func.count()).select_from(DBResearchReport).where(DBResearchReport.user_id == user_id)),
        fetch_one_off(select(DBSubscription).where(DBSubscription.user_id == user_id).order_by(DBSubscription.id.desc()).limit(50)),
        recruiter_access(user_id),
        sponsor_credits(user_id),
    )
    usage = {metric: count for metric, count in usage_rows}
    usage.update({"teams": teams[0][0] or 0, "research_saves": reports[0][0] or 0})
    if founder:
        limits = {metric: UNLIMITED for metric in FREE_LIMITS}
        limits.update({"advanced_filters": True, "profile_boost": True})
    else:
        limits = dict(PLANS[plan_key]["limits"])
    return {
        "founder": founder, "plan": plan_key, "plan_name": "Founder" if founder else PLANS[plan_key]["name"],
        "limits": limits, "usage": usage, "recruiter": recruiter,
        "sponsor_credits": sum(sub.credits or 0 for sub in credits) if not founder else UNLIMITED,
        "subscriptions": [serialize_subscription(sub) for (sub,) in subs],
        "payments_enabled": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET),
    }


@app.get("/api/plans")
async def get_plans():
    """Every plan with its price (in paise, with GST worked out). Public: the pricing page and the landing page read it."""
    out = {}
    for key, plan in PLANS.items():
        if plan.get("hidden"):
            continue
        prices = {}
        for period, amount in plan["prices"].items():
            total, gst = gst_split(plan, amount)
            prices[period] = {"base": amount if plan.get("gst") == "extra" else amount - gst, "gst": gst, "total": total}
        out[key] = {**{k: v for k, v in plan.items() if k not in ("prices",)}, "key": key, "prices": prices}
    return {"plans": out, "gst_rate": GST_RATE, "multi_year_discount": MULTI_YEAR_DISCOUNT, "trial_days": INSTITUTION_TRIAL_DAYS,
            "free_limits": FREE_LIMITS, "payments_enabled": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET), "razorpay_key_id": RAZORPAY_KEY_ID}


@app.get("/api/me/plan")
async def get_my_plan(current_user_id: int = Depends(get_current_user_id)):
    return await entitlements(current_user_id)


# ---------- Razorpay ----------
async def razorpay(method: str, path: str, payload: Optional[dict] = None) -> dict:
    if not (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET):
        raise HTTPException(status_code=503, detail="Online payments are not switched on yet. Please try again later.")
    try:
        async with httpx.AsyncClient(base_url="https://api.razorpay.com/v1", auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET), timeout=20) as client:
            response = await client.request(method, path, json=payload)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="The payment service could not be reached. Please try again.")
    if response.status_code >= 400:
        print("Razorpay error:", response.status_code, response.text[:300])
        raise HTTPException(status_code=502, detail="The payment service refused the request. Please try again.")
    return response.json()

def razorpay_signature_ok(order_id: str, payment_id: str, signature: str) -> bool:
    if not RAZORPAY_KEY_SECRET:
        return False
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), "sha256").hexdigest()
    return hmac.compare_digest(expected, signature or "")

async def settle_payment(order_id: str, payment_id: str, user_id: Optional[int] = None) -> Optional[int]:
    """Marks a payment paid and starts its plan, exactly once (the browser and the webhook may both report it)."""
    conditions = [DBPayment.razorpay_order_id == order_id, DBPayment.status != "paid"]
    if user_id is not None:
        conditions.append(DBPayment.user_id == user_id)
    now_iso = utc_now_iso()
    rows = await run_returning(update(DBPayment).where(*conditions).values(status="paid", razorpay_payment_id=payment_id, paid_at=now_iso,
                               receipt_no=func.concat("C2M-", func.to_char(func.now(), "YYYYMM"), "-", DBPayment.id))
                               .returning(DBPayment.id, DBPayment.user_id, DBPayment.plan_key, DBPayment.period, DBPayment.amount_paise, DBPayment.gst_paise))
    if not rows:
        return None
    payment = rows[0]
    sub_id = await activate_subscription(user_id=payment.user_id, plan_key=payment.plan_key, period=payment.period, amount=payment.amount_paise,
                                         gst=payment.gst_paise, source="razorpay")
    await run_one_off(update(DBPayment).where(DBPayment.id == payment.id).values(subscription_id=sub_id))
    spawn_background(create_notification(payment.user_id, "account", f"Payment received. {PLANS[payment.plan_key]['name']} is now active.", now_iso, "billing.html"))
    return sub_id


@app.post("/api/billing/order")
async def create_billing_order(body: OrderBody, current_user_id: int = Depends(get_current_user_id)):
    """A Razorpay order for a self-serve plan. The amount always comes from PLANS, never from the browser."""
    plan = PLANS.get(body.plan_key)
    if not plan or not plan.get("self_serve"):
        raise HTTPException(status_code=400, detail="That plan is arranged with our team. Use 'Talk to us' on the Plans page.")
    founder, _ = await personal_plan(current_user_id)
    if founder:
        raise HTTPException(status_code=400, detail="As the founder you already have every feature, free.")
    total, gst = gst_split(plan, plan_price(body.plan_key, body.period))
    rows = await fetch_one_off(select(DBUser.name, DBUser.email).where(DBUser.id == current_user_id))
    payment_rows = await run_returning(DBPayment.__table__.insert().values(
        user_id=current_user_id, plan_key=body.plan_key, period=body.period, amount_paise=total, gst_paise=gst, status="created", method="razorpay", created_at=utc_now_iso(),
    ).returning(DBPayment.id))
    payment_id = payment_rows[0][0]
    order = await razorpay("POST", "/orders", {"amount": total, "currency": "INR", "receipt": f"c2m-{payment_id}",
                                               "notes": {"user_id": str(current_user_id), "plan_key": body.plan_key, "period": body.period}})
    await run_one_off(update(DBPayment).where(DBPayment.id == payment_id).values(razorpay_order_id=order["id"]))
    return {"key_id": RAZORPAY_KEY_ID, "order_id": order["id"], "amount": total, "currency": "INR", "name": BUSINESS_NAME,
            "description": f"{plan['name']} ({'yearly' if body.period == 'year' else 'monthly'})",
            "prefill": {"name": rows[0].name or "", "email": rows[0].email or ""} if rows else {}}


@app.post("/api/billing/verify")
async def verify_billing_payment(body: PaymentVerifyBody, current_user_id: int = Depends(get_current_user_id)):
    if not razorpay_signature_ok(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="The payment could not be verified. If money left your account, it will be refunded automatically.")
    await settle_payment(body.razorpay_order_id, body.razorpay_payment_id, current_user_id)
    return await entitlements(current_user_id)


@app.post("/api/billing/webhook")
async def razorpay_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook not configured.")
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), body, "sha256").hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Bad signature.")
    try:
        event = json.loads(body)
        entity = event["payload"]["payment"]["entity"]
    except (ValueError, KeyError, TypeError):
        return {"status": "ignored"}
    if event.get("event") == "payment.captured":
        await settle_payment(entity.get("order_id", ""), entity.get("id", ""))
    elif event.get("event") == "payment.failed":
        await run_one_off(update(DBPayment).where(DBPayment.razorpay_order_id == entity.get("order_id", ""), DBPayment.status == "created").values(status="failed"))
    return {"status": "ok"}


@app.get("/api/billing/history")
async def billing_history(current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBPayment).where(DBPayment.user_id == current_user_id, DBPayment.status.in_(("paid", "refunded", "failed"))).order_by(DBPayment.id.desc()).limit(100))
    return {"payments": [serialize_payment(payment) for (payment,) in rows]}

def serialize_payment(payment) -> dict:
    return {"id": payment.id, "plan_key": payment.plan_key, "plan_name": PLANS.get(payment.plan_key, {}).get("name", payment.plan_key), "period": payment.period,
            "amount_paise": payment.amount_paise or 0, "gst_paise": payment.gst_paise or 0, "status": payment.status, "method": payment.method,
            "reference": payment.razorpay_payment_id or payment.reference or "", "receipt_no": payment.receipt_no or "", "created_at": payment.created_at or "",
            "paid_at": payment.paid_at or "", "user_id": payment.user_id}


@app.get("/api/billing/receipt/{payment_id}")
async def billing_receipt(payment_id: int, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBPayment, DBUser.name, DBUser.email).outerjoin(DBUser, DBUser.id == DBPayment.user_id).where(DBPayment.id == payment_id))
    if not rows or (rows[0][0].user_id != current_user_id and not await founder_flag(current_user_id)):
        raise HTTPException(status_code=404, detail="Receipt not found.")
    payment, name, email = rows[0]
    if payment.status not in ("paid", "refunded"):
        raise HTTPException(status_code=400, detail="There is no receipt for an unpaid order.")
    return {**serialize_payment(payment), "customer": name or "", "email": email or "", "business": BUSINESS_NAME, "gstin": BUSINESS_GSTIN, "gst_rate": GST_RATE,
            "taxable_paise": (payment.amount_paise or 0) - (payment.gst_paise or 0)}


async def subscription_watch():
    """Every few hours: end subscriptions past their last day, and remind people 3 days before the end."""
    while True:
        try:
            today = today_iso()
            ended = await run_returning(update(DBSubscription).where(DBSubscription.status == "active", DBSubscription.ends_at < today)
                                        .values(status="expired").returning(DBSubscription.user_id, DBSubscription.plan_key))
            for user_id, plan_key in ended:
                if user_id and PLANS.get(plan_key, {}).get("line") == "personal":
                    await refresh_user_plan(user_id)
                    await create_notification(user_id, "account", f"Your {PLANS[plan_key]['name']} plan has ended. Renew it from Plans & billing.", utc_now_iso(), "billing.html")
            soon = (datetime.now().date() + timedelta(days=3)).isoformat()
            due = await run_returning(update(DBSubscription).where(DBSubscription.status == "active", DBSubscription.reminded == 0, DBSubscription.ends_at <= soon,
                                                                  DBSubscription.user_id.isnot(None), DBSubscription.source != "trial")
                                      .values(reminded=1).returning(DBSubscription.user_id, DBSubscription.plan_key, DBSubscription.ends_at))
            for user_id, plan_key, ends_at in due:
                await create_notification(user_id, "account", f"Your {PLANS.get(plan_key, {}).get('name', plan_key)} plan ends on {ends_at}.", utc_now_iso(), "billing.html")
        except Exception as e:
            print("Error checking subscriptions:", e)
        await asyncio.sleep(6 * 3600)


# ---------- the first message to someone who does not follow you ----------
KNOWN_CONVERSATIONS: set = set()   # (sender, receiver) pairs that are past the check, so later messages skip it

async def check_new_conversation(db, sender_id: int, receiver_id: int):
    """A conversation counts against the monthly limit when it is new and the other person does not follow you back.
    Replies, followers and people a recruiter unlocked are free. Raises MessageRefused when the limit is used up."""
    row = (await db.execute(select(
        exists().where(or_(and_(DBMessage.sender_id == sender_id, DBMessage.receiver_id == receiver_id),
                           and_(DBMessage.sender_id == receiver_id, DBMessage.receiver_id == sender_id))),
        exists().where(DBFollow.follower_id == receiver_id, DBFollow.followed_id == sender_id),
        exists().where(DBRecruiterUnlock.recruiter_id == sender_id, DBRecruiterUnlock.user_id == receiver_id),
    ))).first()
    if len(KNOWN_CONVERSATIONS) > 50000:
        KNOWN_CONVERSATIONS.clear()
    if not any(row):
        try:
            await check_limit(sender_id, "new_conversations")
        except HTTPException as limit:
            raise MessageRefused(limit.detail)
        spawn_background(bump_usage(sender_id, "new_conversations"))
    KNOWN_CONVERSATIONS.add((sender_id, receiver_id))


# ==========================================
# 19. BUSINESS: ENQUIRIES, RECRUITER ACCESS, SPONSORED CHALLENGES, INSTITUTION ANALYTICS
# Business plans start with an enquiry; the founder switches the plan on (section 20).
# ==========================================
class DBEnquiry(Base):
    __tablename__ = "b2b_enquiries"
    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String, index=True)               # institution, recruiter, sponsor
    plan_key = Column(String, default="")
    organisation = Column(String)
    contact_name = Column(String)
    email = Column(String)
    phone = Column(String, default="")
    size = Column(String, default="")               # students, hires a year, or challenges
    message = Column(String, default="")
    user_id = Column(Integer, nullable=True)
    status = Column(String, index=True, default="new")   # new, contacted, won, lost
    founder_note = Column(String, default="")
    subscription_id = Column(Integer, nullable=True)
    created_at = Column(String)
    updated_at = Column(String)

class DBRecruiterSeat(Base):
    __tablename__ = "recruiter_seats"
    __table_args__ = (UniqueConstraint("subscription_id", "user_id", name="ux_recruiter_seats"),)
    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    added_at = Column(String)

class DBRecruiterUnlock(Base):
    __tablename__ = "recruiter_unlocks"
    __table_args__ = (UniqueConstraint("subscription_id", "user_id", name="ux_recruiter_unlocks"),)
    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, index=True)    # 0 for the founder
    recruiter_id = Column(Integer, index=True)       # who pressed Unlock
    user_id = Column(Integer, index=True)            # the candidate
    created_at = Column(String)

class DBRecruiterShortlist(Base):
    __tablename__ = "recruiter_shortlists"
    __table_args__ = (UniqueConstraint("subscription_id", "user_id", name="ux_recruiter_shortlists"),)
    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    stage = Column(String, default="shortlisted")   # shortlisted, contacted, interviewing, offer, hired, rejected
    note = Column(String, default="")
    added_by = Column(Integer)
    created_at = Column(String)
    updated_at = Column(String)

class DBGithubStats(Base):
    __tablename__ = "github_stats"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, unique=True, index=True)
    username = Column(String)
    repos = Column(Integer, default=0)
    followers = Column(Integer, default=0)
    stars = Column(Integer, default=0)
    languages = Column(String, default="[]")
    fetched_at = Column(String)

class DBChallengeSubmission(Base):
    __tablename__ = "challenge_submissions"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="ux_challenge_submissions"),)
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    team_id = Column(Integer, nullable=True)
    link = Column(String)
    note = Column(String, default="")
    score = Column(Integer, nullable=True)
    remarks = Column(String, default="")
    rank = Column(Integer, nullable=True)            # 1, 2, 3 ... for winners
    submitted_at = Column(String)
    updated_at = Column(String)


ENQUIRY_KINDS = ("institution", "recruiter", "sponsor")
SHORTLIST_STAGES = ("shortlisted", "contacted", "interviewing", "offer", "hired", "rejected")
CHALLENGE_KINDS = ("bounty", "hackathon")
SPONSOR_TIERS = {"basic": 30, "featured": 60, "hackathon": 90}
RECRUITER_RESULTS = 200
GITHUB_STATS_DAYS = 1


class EnquiryBody(BaseModel):
    kind: str
    plan_key: Optional[str] = ""
    organisation: str
    contact_name: str
    email: str
    phone: Optional[str] = ""
    size: Optional[str] = ""
    message: Optional[str] = ""

class ShortlistBody(BaseModel):
    user_id: int
    stage: Optional[str] = "shortlisted"
    note: Optional[str] = ""

class SeatBody(BaseModel):
    email: str

class ChallengeBody(BaseModel):
    title: str
    description: str
    skills_required: str
    kind: str = "bounty"
    tier: str = "basic"
    sponsor_name: str
    sponsor_url: Optional[str] = ""
    sponsor_logo: Optional[str] = ""
    prize: Optional[str] = ""
    deadline: str
    max_team_size: Optional[int] = 1

class ChallengeSubmissionBody(BaseModel):
    link: str
    note: Optional[str] = ""
    team_id: Optional[int] = None

class JudgeBody(BaseModel):
    score: Optional[int] = None
    remarks: Optional[str] = ""
    rank: Optional[int] = None


def optional_user_id(request: Request) -> Optional[int]:
    """The logged-in person if there is one; enquiries can also come from people without an account."""
    token = request.cookies.get("authToken")
    if not token:
        return None
    try:
        return int(jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]).get("sub"))
    except Exception:
        return None


# ---------- enquiries ----------
@app.post("/api/enquiries")
@limiter.limit("5/minute")
async def create_enquiry(request: Request, body: EnquiryBody):
    if body.kind not in ENQUIRY_KINDS:
        raise HTTPException(status_code=400, detail="Pick what you are asking about.")
    if body.plan_key and (body.plan_key not in PLANS or PLANS[body.plan_key]["line"] != body.kind):
        raise HTTPException(status_code=400, detail="That plan does not match the enquiry.")
    email = (body.email or "").strip()[:160]
    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    phone = (body.phone or "").strip()[:20]
    if phone and not PHONE_PATTERN.match(phone):
        raise HTTPException(status_code=400, detail="Enter a valid phone number, or leave it empty.")
    now_iso = utc_now_iso()
    rows = await run_returning(DBEnquiry.__table__.insert().values(
        kind=body.kind, plan_key=body.plan_key or "", organisation=clean_required(body.organisation, 160, "organisation"),
        contact_name=clean_required(body.contact_name, 120, "your name"), email=email, phone=phone, size=clean_text(body.size, 60, "size"),
        message=clean_text(body.message, 2000, "message"), user_id=optional_user_id(request), status="new", founder_note="", created_at=now_iso, updated_at=now_iso,
    ).returning(DBEnquiry.id))
    spawn_background(notify_founders("account", f"New {body.kind} enquiry from {body.organisation.strip()[:80]}.", "founder.html?tab=enquiries"))
    return {"id": rows[0][0], "status": "received"}


# ---------- recruiter access ----------
async def require_recruiter(user_id: int) -> dict:
    access = await recruiter_access(user_id)
    if not access:
        raise HTTPException(status_code=402, detail="Recruiter access is a paid plan. Ask for it from the Plans page (Recruiters tab).")
    return access

def contact_ok_clause():
    open_to = func.lower(func.coalesce(DBUser.open_to, ""))
    return or_(func.coalesce(DBUser.recruiter_contact_ok, 0) == 1, open_to.like("%hiring%"), open_to.like("%internships%"))

async def refresh_github_stats(rows):
    """Fill github_stats for people whose numbers are missing or older than a day. Meant to run in the background."""
    stale_before = (datetime.now(timezone.utc) - timedelta(days=GITHUB_STATS_DAYS)).isoformat()
    for user_id, username, fetched_at in rows[:10]:
        if fetched_at and fetched_at > stale_before:
            continue
        try:
            data = await asyncio.to_thread(fetch_github_profile, username)
        except Exception:
            continue
        values = {"username": username, "repos": data.get("public_repos") or 0, "followers": data.get("followers") or 0, "stars": data.get("total_stars") or 0,
                  "languages": json.dumps(list((data.get("languages") or {}).keys())), "fetched_at": utc_now_iso()}
        await run_one_off(pg_insert(DBGithubStats).values(user_id=user_id, **values).on_conflict_do_update(index_elements=["user_id"], set_=values))


@app.get("/api/recruiter/me")
async def recruiter_me(current_user_id: int = Depends(get_current_user_id)):
    access = await recruiter_access(current_user_id)
    if not access:
        return {"access": None}
    seats = []
    if access["sub_id"]:
        seats = [{"id": r.id, "name": r.name or "", "email": r.email or ""} for r in await fetch_one_off(
            select(DBUser.id, DBUser.name, DBUser.email).join(DBRecruiterSeat, DBRecruiterSeat.user_id == DBUser.id).where(DBRecruiterSeat.subscription_id == access["sub_id"]))]
    used = await usage_count(access["owner_id"], f"recruiter_unlocks:{access['sub_id']}") if access["sub_id"] else 0
    return {"access": access, "unlocks_used": used, "seat_members": seats}


@app.get("/api/recruiter/search")
async def recruiter_search(q: str = "", skills: str = "", college: str = "", department: str = "", city: str = "", open_to: str = "",
                           has_github: bool = False, min_repos: int = 0, contactable: bool = False, current_user_id: int = Depends(get_current_user_id)):
    """Verified people only. Skills must all be present. GitHub filters need a plan that includes them."""
    access = await require_recruiter(current_user_id)
    conditions = [func.coalesce(DBUser.account_status, "") == "verified", DBUser.id != current_user_id]
    for skill in [s.strip() for s in skills.split(",") if s.strip()][:8]:
        conditions.append(func.lower(func.coalesce(DBUser.skills, "")).like(f"%{skill.lower()}%"))
    for field, value in ((DBUser.college_name, college), (DBUser.department, department), (DBUser.city, city)):
        if value.strip():
            conditions.append(func.lower(func.coalesce(field, "")).like(f"%{value.strip().lower()}%"))
    if q.strip():
        like = f"%{q.strip().lower()}%"
        conditions.append(or_(func.lower(DBUser.name).like(like), func.lower(func.coalesce(DBUser.bio, "")).like(like), func.lower(func.coalesce(DBUser.skills, "")).like(like)))
    if open_to.strip():
        conditions.append(func.lower(func.coalesce(DBUser.open_to, "")).like(f"%{open_to.strip().lower()}%"))
    if contactable:
        conditions.append(contact_ok_clause())
    if access["git_filters"]:
        if has_github:
            conditions.append(func.coalesce(DBUser.github_username, "") != "")
        if min_repos > 0:
            conditions.append(func.coalesce(DBGithubStats.repos, 0) >= min_repos)
    picture = case((func.length(DBUser.profile_pic) > 1000, ""), else_=DBUser.profile_pic).label("profile_pic")
    sub_id = access["sub_id"]
    rows = await fetch_one_off(
        select(DBUser.id, DBUser.name, DBUser.college_name, DBUser.department, DBUser.city, DBUser.skills, picture, DBUser.github_username,
               DBUser.open_to, DBUser.profession, DBUser.experience_years, func.left(DBUser.bio, 240).label("bio"), contact_ok_clause().label("contact_ok"),
               DBGithubStats.repos, DBGithubStats.followers, DBGithubStats.stars, DBGithubStats.languages, DBGithubStats.fetched_at,
               exists().where(DBRecruiterUnlock.subscription_id == sub_id, DBRecruiterUnlock.user_id == DBUser.id).label("unlocked"),
               select(DBRecruiterShortlist.stage).where(DBRecruiterShortlist.subscription_id == sub_id, DBRecruiterShortlist.user_id == DBUser.id).correlate(DBUser).scalar_subquery().label("stage"))
        .outerjoin(DBGithubStats, DBGithubStats.user_id == DBUser.id).where(*conditions)
        .order_by(func.coalesce(DBGithubStats.repos, 0).desc(), DBUser.id.desc()).limit(RECRUITER_RESULTS)
    )
    spawn_background(refresh_github_stats([(r.id, r.github_username, r.fetched_at) for r in rows if r.github_username]))
    return {"people": [{
        "id": r.id, "name": r.name or "", "college": r.college_name or "", "department": r.department or "", "city": r.city or "", "skills": r.skills or "",
        "profile_pic": r.profile_pic or "", "github_username": r.github_username or "", "open_to": r.open_to or "", "profession": r.profession or "",
        "experience_years": r.experience_years, "bio": r.bio or "", "contact_ok": bool(r.contact_ok), "unlocked": bool(r.unlocked), "stage": r.stage or "",
        "github": {"repos": r.repos, "followers": r.followers, "stars": r.stars, "languages": json_list(r.languages)} if r.fetched_at else None,
    } for r in rows], "git_filters": access["git_filters"]}


@app.post("/api/recruiter/unlock/{user_id}")
async def recruiter_unlock(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Use one contact from the plan. Only people who are verified and open to being contacted."""
    access = await require_recruiter(current_user_id)
    rows = await fetch_one_off(select(DBUser.name, DBUser.email, DBUser.account_status, DBUser.recruiter_contact_ok, contact_ok_clause()).where(DBUser.id == user_id))
    if not rows or rows[0].account_status != "verified":
        raise HTTPException(status_code=404, detail="Only verified people can be contacted.")
    if not rows[0][4]:
        raise HTTPException(status_code=403, detail="This person has not said they are open to recruiters.")
    sub_id = access["sub_id"]
    already = await fetch_one_off(select(DBRecruiterUnlock.id).where(DBRecruiterUnlock.subscription_id == sub_id, DBRecruiterUnlock.user_id == user_id))
    if not already:
        metric = f"recruiter_unlocks:{sub_id}"
        if access["unlocks"] is not UNLIMITED and sub_id:
            used = await usage_count(access["owner_id"], metric)
            if used >= access["unlocks"]:
                raise HTTPException(status_code=402, detail=f"You have used all {access['unlocks']} contacts of {access['name']} this month. Upgrade from the Plans page.")
        await run_one_off(pg_insert(DBRecruiterUnlock).values(subscription_id=sub_id, recruiter_id=current_user_id, user_id=user_id, created_at=utc_now_iso())
                          .on_conflict_do_nothing(index_elements=["subscription_id", "user_id"]))
        if sub_id:
            await bump_usage(access["owner_id"], metric)
        spawn_background(create_notification(user_id, "account", "A recruiter on Connect2Minds is interested in your profile and may message you.", utc_now_iso(), "inbox.html"))
    return {"user_id": user_id, "email": (rows[0].email or "") if (rows[0].recruiter_contact_ok or 0) == 1 else "", "message_url": f"inbox.html?user={user_id}"}


@app.get("/api/recruiter/shortlist")
async def recruiter_shortlist(current_user_id: int = Depends(get_current_user_id)):
    access = await require_recruiter(current_user_id)
    rows = await fetch_one_off(
        select(DBRecruiterShortlist, DBUser.name, DBUser.college_name, DBUser.department, DBUser.skills, DBUser.github_username)
        .join(DBUser, DBUser.id == DBRecruiterShortlist.user_id).where(DBRecruiterShortlist.subscription_id == access["sub_id"]).order_by(DBRecruiterShortlist.updated_at.desc())
    )
    return {"shortlist": [{"user_id": s.user_id, "stage": s.stage, "note": s.note or "", "name": name or "", "college": college or "", "department": department or "",
                           "skills": skills or "", "github_username": github or "", "updated_at": s.updated_at or ""} for s, name, college, department, skills, github in rows],
            "stages": list(SHORTLIST_STAGES)}


@app.post("/api/recruiter/shortlist")
async def recruiter_shortlist_save(body: ShortlistBody, current_user_id: int = Depends(get_current_user_id)):
    access = await require_recruiter(current_user_id)
    if body.stage not in SHORTLIST_STAGES:
        raise HTTPException(status_code=400, detail="Pick a stage from the list.")
    now_iso = utc_now_iso()
    values = {"stage": body.stage, "note": clean_text(body.note, 1000, "note"), "updated_at": now_iso}
    await run_one_off(pg_insert(DBRecruiterShortlist).values(subscription_id=access["sub_id"], user_id=body.user_id, added_by=current_user_id, created_at=now_iso, **values)
                      .on_conflict_do_update(index_elements=["subscription_id", "user_id"], set_=values))
    return {"user_id": body.user_id, **values}


@app.delete("/api/recruiter/shortlist/{user_id}")
async def recruiter_shortlist_remove(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    access = await require_recruiter(current_user_id)
    await run_one_off(delete(DBRecruiterShortlist).where(DBRecruiterShortlist.subscription_id == access["sub_id"], DBRecruiterShortlist.user_id == user_id))
    return {"status": "removed"}


@app.post("/api/recruiter/seats")
async def recruiter_add_seat(body: SeatBody, current_user_id: int = Depends(get_current_user_id)):
    access = await require_recruiter(current_user_id)
    if not access["owner"] or not access["sub_id"]:
        raise HTTPException(status_code=403, detail="Only the person who holds the plan can add colleagues.")
    rows = await fetch_one_off(select(DBUser.id).where(func.lower(DBUser.email) == (body.email or "").strip().lower()))
    if not rows:
        raise HTTPException(status_code=404, detail="No account has that email. Ask your colleague to sign up first.")
    taken = await fetch_one_off(select(func.count()).select_from(DBRecruiterSeat).where(DBRecruiterSeat.subscription_id == access["sub_id"]))
    if (taken[0][0] or 0) + 1 >= (access["seats"] or 1):
        raise HTTPException(status_code=402, detail=f"{access['name']} includes {access['seats']} seat(s), and they are all in use.")
    await run_one_off(pg_insert(DBRecruiterSeat).values(subscription_id=access["sub_id"], user_id=rows[0][0], added_at=utc_now_iso()).on_conflict_do_nothing(index_elements=["subscription_id", "user_id"]))
    spawn_background(create_notification(rows[0][0], "account", f"You were given a seat on {access['name']}. Open Recruiter search from your account menu.", utc_now_iso(), "recruiter.html"))
    return {"status": "added"}


@app.delete("/api/recruiter/seats/{user_id}")
async def recruiter_remove_seat(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    access = await require_recruiter(current_user_id)
    if not access["owner"]:
        raise HTTPException(status_code=403, detail="Only the person who holds the plan can remove colleagues.")
    await run_one_off(delete(DBRecruiterSeat).where(DBRecruiterSeat.subscription_id == access["sub_id"], DBRecruiterSeat.user_id == user_id))
    return {"status": "removed"}


# ---------- sponsored challenges on the Opportunities board ----------
def clean_challenge(body: ChallengeBody) -> dict:
    if body.kind not in CHALLENGE_KINDS:
        raise HTTPException(status_code=400, detail="A challenge is a bounty or a hackathon.")
    if body.tier not in SPONSOR_TIERS:
        raise HTTPException(status_code=400, detail="Pick a sponsorship package.")
    deadline = (body.deadline or "").strip()
    if not HUB_DATE_PATTERN.match(deadline) or deadline < today_iso():
        raise HTTPException(status_code=400, detail="Pick a deadline from today on.")
    team_size = body.max_team_size or 1
    if not (1 <= team_size <= 10):
        raise HTTPException(status_code=400, detail="Teams can have 1 to 10 people.")
    skills = ", ".join(s.strip() for s in clean_required(body.skills_required, 300, "skills").split(",") if s.strip())
    return {
        "category": "Hackathon" if body.kind == "hackathon" else "Open Source", "title": clean_required(body.title, 120, "title"),
        "description": clean_required(body.description, 2000, "description"), "skills_required": skills, "is_urgent": 0,
        "is_sponsored": 1, "kind": body.kind, "sponsor_tier": body.tier, "sponsor_name": clean_required(body.sponsor_name, 120, "sponsor name"),
        "sponsor_url": clean_link(body.sponsor_url, "sponsor website"), "sponsor_logo": clean_link(body.sponsor_logo, "logo address"),
        "prize": clean_text(body.prize, 120, "prize"), "deadline": deadline, "max_team_size": team_size, "winners_announced": 0,
        "sponsored_until": (max(datetime.now().date() + timedelta(days=SPONSOR_TIERS[body.tier] - 1), datetime.fromisoformat(deadline).date() + timedelta(days=7))).isoformat(),
    }

async def notify_matching_students(post_id: int, title: str, skills: str, author_id: int):
    """Featured challenges reach students whose skills match. Meant to run in the background."""
    try:
        wanted = [s.strip().lower() for s in skills.split(",") if s.strip()][:6]
        if not wanted:
            return
        rows = await fetch_one_off(select(DBUser.id).where(or_(*[func.lower(func.coalesce(DBUser.skills, "")).like(f"%{s}%") for s in wanted]),
                                                           is_student_clause(), DBUser.id != author_id).limit(500))
        await notify_many([row[0] for row in rows], "board_reply", f"Sponsored challenge that matches your skills: {title[:90]}", f"board.html?post={post_id}")
    except Exception as e:
        print("Error notifying students about a challenge:", e)


@app.post("/api/board/challenges")
async def create_challenge(body: ChallengeBody, current_user_id: int = Depends(get_current_user_id)):
    """A sponsored bounty or hackathon. The founder can post any; a sponsor uses one challenge from their package."""
    values = clean_challenge(body)
    founder = await founder_flag(current_user_id)
    used_sub = None
    if not founder:
        packages = [sub for sub in await sponsor_credits(current_user_id) if body.tier == "basic" or PLANS[sub.plan_key]["tier"] in (body.tier, "hackathon") or (body.tier == "featured" and sub.plan_key == "sponsor_season")]
        if not packages:
            raise HTTPException(status_code=402, detail="Posting a sponsored challenge needs a sponsorship package for that tier. Ask for one from the Plans page (Sponsors tab).")
        used_sub = packages[0]
    rows = await run_returning(DBBoardPost.__table__.insert().values(author_id=current_user_id, created_at=utc_now_iso(), **values).returning(DBBoardPost.id))
    post_id = rows[0][0]
    if used_sub is not None:
        await run_one_off(update(DBSubscription).where(DBSubscription.id == used_sub.id).values(credits=DBSubscription.credits - 1))
    card = await load_board_card(post_id, current_user_id)
    spawn_background(broadcast_directory({"type": "board_post_added", "post": public_board_card(card)}))
    if body.tier in ("featured", "hackathon"):
        spawn_background(notify_matching_students(post_id, values["title"], values["skills_required"], current_user_id))
    return {"status": "success", "post": card}


async def challenge_or_404(post_id: int):
    rows = await fetch_one_off(select(DBBoardPost).where(DBBoardPost.id == post_id, DBBoardPost.is_sponsored == 1))
    if not rows:
        raise HTTPException(status_code=404, detail="That challenge is no longer on the board.")
    return rows[0][0]

async def may_judge(post, user_id: int) -> bool:
    return post.author_id == user_id or await founder_flag(user_id)


@app.post("/api/board/posts/{post_id}/submission")
async def submit_challenge(post_id: int, body: ChallengeSubmissionBody, current_user_id: int = Depends(get_current_user_id)):
    post = await challenge_or_404(post_id)
    if post.author_id == current_user_id:
        raise HTTPException(status_code=400, detail="You cannot enter your own challenge.")
    if post.deadline and post.deadline < today_iso():
        raise HTTPException(status_code=400, detail="The deadline for this challenge has passed.")
    if post.winners_announced:
        raise HTTPException(status_code=400, detail="The winners of this challenge have been announced.")
    link = clean_link(body.link, "submission link")
    if not link:
        raise HTTPException(status_code=400, detail="Add a link to your work (GitHub, a demo or a document).")
    team_id = None
    if body.team_id:
        member = await fetch_one_off(select(func.count()).select_from(DBTeamMember).where(DBTeamMember.team_id == body.team_id, DBTeamMember.user_id == current_user_id))
        size = await fetch_one_off(select(func.count()).select_from(DBTeamMember).where(DBTeamMember.team_id == body.team_id))
        if not member[0][0]:
            raise HTTPException(status_code=403, detail="You can only submit for a team you are in.")
        if (size[0][0] or 0) > (post.max_team_size or 1):
            raise HTTPException(status_code=400, detail=f"Teams for this challenge can have up to {post.max_team_size} people.")
        team_id = body.team_id
    now_iso = utc_now_iso()
    values = {"link": link, "note": clean_text(body.note, 1000, "note"), "team_id": team_id, "updated_at": now_iso}
    await run_one_off(pg_insert(DBBoardApplication).values(post_id=post_id, user_id=current_user_id, note="Registered with a submission", created_at=now_iso)
                      .on_conflict_do_nothing(index_elements=["post_id", "user_id"]))
    await run_one_off(pg_insert(DBChallengeSubmission).values(post_id=post_id, user_id=current_user_id, submitted_at=now_iso, remarks="", **values)
                      .on_conflict_do_update(index_elements=["post_id", "user_id"], set_=values))
    spawn_background(broadcast_applicant_count(post_id))
    return {"status": "submitted"}


@app.get("/api/board/posts/{post_id}/submissions")
async def challenge_submissions(post_id: int, current_user_id: int = Depends(get_current_user_id)):
    post = await challenge_or_404(post_id)
    judge = await may_judge(post, current_user_id)
    conditions = [DBChallengeSubmission.post_id == post_id]
    if not judge and not post.winners_announced:
        conditions.append(DBChallengeSubmission.user_id == current_user_id)
    rows = await fetch_one_off(select(DBChallengeSubmission, DBUser.name, DBUser.college_name, DBTeam.name)
                               .outerjoin(DBUser, DBUser.id == DBChallengeSubmission.user_id).outerjoin(DBTeam, DBTeam.id == DBChallengeSubmission.team_id)
                               .where(*conditions).order_by(func.coalesce(DBChallengeSubmission.rank, 999), DBChallengeSubmission.score.desc().nulls_last(), DBChallengeSubmission.id))
    public = not judge
    return {"judge": judge, "winners_announced": bool(post.winners_announced), "submissions": [{
        "id": s.id, "user_id": s.user_id, "name": name or "", "college": college or "", "team": team or "",
        "link": s.link if (judge or s.user_id == current_user_id or s.rank) else "", "note": s.note if (judge or s.user_id == current_user_id) else "",
        "score": s.score if (judge or s.user_id == current_user_id or not public) else None, "remarks": s.remarks if (judge or s.user_id == current_user_id) else "",
        "rank": s.rank, "submitted_at": s.submitted_at or "",
    } for s, name, college, team in rows if judge or s.user_id == current_user_id or s.rank]}


@app.put("/api/board/submissions/{submission_id}/judge")
async def judge_submission(submission_id: int, body: JudgeBody, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBChallengeSubmission.post_id).where(DBChallengeSubmission.id == submission_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That submission is gone.")
    post = await challenge_or_404(rows[0][0])
    if not await may_judge(post, current_user_id):
        raise HTTPException(status_code=403, detail="Only the sponsor who posted the challenge can judge it.")
    if body.score is not None and not (0 <= body.score <= 100):
        raise HTTPException(status_code=400, detail="Scores go from 0 to 100.")
    if body.rank is not None and not (1 <= body.rank <= 10):
        raise HTTPException(status_code=400, detail="Places go from 1 to 10.")
    await run_one_off(update(DBChallengeSubmission).where(DBChallengeSubmission.id == submission_id).values(
        score=body.score, rank=body.rank, remarks=clean_text(body.remarks, 1000, "remarks"), updated_at=utc_now_iso()))
    return {"status": "saved"}


@app.post("/api/board/posts/{post_id}/winners")
async def announce_winners(post_id: int, current_user_id: int = Depends(get_current_user_id)):
    post = await challenge_or_404(post_id)
    if not await may_judge(post, current_user_id):
        raise HTTPException(status_code=403, detail="Only the sponsor who posted the challenge can announce winners.")
    rows = await fetch_one_off(select(DBChallengeSubmission.user_id, DBChallengeSubmission.rank).where(DBChallengeSubmission.post_id == post_id))
    if not any(rank for _, rank in rows):
        raise HTTPException(status_code=400, detail="Give at least one submission a place first.")
    await run_one_off(update(DBBoardPost).where(DBBoardPost.id == post_id).values(winners_announced=1))
    winners = [(user_id, rank) for user_id, rank in rows if rank]
    for user_id, rank in winners:
        spawn_background(create_notification(user_id, "board_reply", f"Congratulations! You placed #{rank} in {post.title}.", utc_now_iso(), f"board.html?post={post_id}"))
    spawn_background(notify_many([user_id for user_id, rank in rows if not rank], "board_reply", f"The winners of {post.title} have been announced.", f"board.html?post={post_id}"))
    card = await load_board_card(post_id, current_user_id)
    spawn_background(broadcast_directory({"type": "board_post_updated", "post": public_board_card(card)}))
    return {"status": "announced", "winners": len(winners)}


# ---------- institution analytics ----------
async def analytics_college_for(user_id: int, college: str) -> str:
    """Which college this person may see analytics for: the founder any, a teacher theirs, an admin the college of their scope."""
    rows = await fetch_one_off(select(DBUser.is_founder, DBUser.teacher_of).where(DBUser.id == user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    if (rows[0].is_founder or 0) == 1:
        key = college_key_of(college)
        if not key:
            raise HTTPException(status_code=400, detail="Pick a college.")
        return key
    if (rows[0].teacher_of or "").strip():
        return rows[0].teacher_of
    scope = await fetch_one_off(select(DBAdminScope.college_key).where(DBAdminScope.user_id == user_id).limit(1))
    if scope:
        return scope[0][0]
    raise HTTPException(status_code=403, detail="Institution analytics are for a college's teachers and admins.")


@app.get("/api/institution/colleges")
async def institution_colleges(founder_id: int = Depends(require_founder)):
    """For the founder: colleges with students on the platform, and their licence."""
    rows = await fetch_one_off(select(func.min(DBUser.college_name), USER_COLLEGE_KEY.label("key"), func.count()).where(func.coalesce(DBUser.college_name, "") != "")
                               .group_by(USER_COLLEGE_KEY).order_by(func.count().desc()).limit(300))
    subs = await fetch_one_off(select(DBSubscription.college_key, DBSubscription.plan_key, DBSubscription.ends_at).where(DBSubscription.college_key != "", DBSubscription.status == "active", DBSubscription.ends_at >= today_iso()))
    licence = {key: {"plan_key": plan, "name": PLANS.get(plan, {}).get("name", plan), "ends_at": ends} for key, plan, ends in subs}
    return {"colleges": [{"name": name, "key": key, "people": count, "licence": licence.get(key)} for name, key, count in rows]}


@app.get("/api/institution/analytics")
async def institution_analytics(college: str = "", current_user_id: int = Depends(get_current_user_id)):
    key = await analytics_college_for(current_user_id, college)
    licence = await college_licence(key)
    if not licence and not await founder_flag(current_user_id):
        raise HTTPException(status_code=402, detail="Institution analytics are part of the institution licence. Start one from the Plans page (Institutions tab).")
    weeks_back = (datetime.now(timezone.utc) - timedelta(weeks=12)).isoformat()
    student = hub_student_clause(key)
    status_rows, skill_rows, name_rows, hub_rows, sub_rows, att_rows, qa_rows, group_rows, signup_rows = await asyncio.gather(
        fetch_one_off(select(DBUser.account_status, func.count()).where(student).group_by(DBUser.account_status)),
        fetch_one_off(select(DBUser.skills).where(student, func.coalesce(DBUser.skills, "") != "").limit(3000)),
        fetch_one_off(select(func.min(DBUser.college_name)).where(USER_COLLEGE_KEY == key)),
        fetch_one_off(text("""
            SELECT to_char(date_trunc('week', ts::timestamptz), 'YYYY-MM-DD') AS week, kind, count(*) FROM (
              SELECT timestamp AS ts, 'chat' AS kind FROM college_messages WHERE college_key = :key AND timestamp >= :since
              UNION ALL SELECT created_at, 'posts' FROM college_posts WHERE college_key = :key AND created_at >= :since
              UNION ALL SELECT submitted_at, 'work' FROM college_submissions WHERE college_key = :key AND submitted_at >= :since
              UNION ALL SELECT created_at, 'questions' FROM college_questions WHERE college_key = :key AND created_at >= :since
            ) AS activity GROUP BY 1, 2 ORDER BY 1""").bindparams(key=key, since=weeks_back)),
        fetch_one_off(select(func.count(), func.sum(DBCollegeSubmission.late), func.avg(case((DBCollegePost.max_marks > 0, DBCollegeSubmission.marks * 100.0 / DBCollegePost.max_marks), else_=None)))
                      .join(DBCollegePost, DBCollegePost.id == DBCollegeSubmission.activity_id).where(DBCollegeSubmission.college_key == key)),
        fetch_one_off(select(DBAttendanceSession.department, DBAttendanceSession.division, func.count(DBAttendanceMark.id),
                             func.sum(case((DBAttendanceMark.status.in_(("present", "late")), 1), else_=0)))
                      .join(DBAttendanceMark, DBAttendanceMark.session_id == DBAttendanceSession.id).where(DBAttendanceSession.college_key == key)
                      .group_by(DBAttendanceSession.department, DBAttendanceSession.division)),
        fetch_one_off(select(func.count(DBCollegeQuestion.id), func.count(DBCollegeQuestion.accepted_answer_id),
                             func.sum(case((exists().where(DBCollegeAnswer.question_id == DBCollegeQuestion.id), 1), else_=0))).where(DBCollegeQuestion.college_key == key)),
        fetch_one_off(select(func.count()).select_from(DBTeam).where(DBTeam.college_key == key)),
        fetch_one_off(select(DBHistory.time).join(DBUser, DBUser.id == DBHistory.user_id).where(student, DBHistory.action == "Account Created", DBHistory.time >= weeks_back)),
    )
    statuses: dict = {}
    for status_, count in status_rows:
        statuses[status_ or "pending"] = statuses.get(status_ or "pending", 0) + count
    total = sum(statuses.values())
    skills: dict = {}
    for (raw,) in skill_rows:
        for skill in {s.strip().lower(): s.strip() for s in raw.split(",") if s.strip()}.values():
            skills[skill] = skills.get(skill, 0) + 1
    activity: dict = {}
    for week, kind, count in hub_rows:
        activity.setdefault(week, {"chat": 0, "posts": 0, "work": 0, "questions": 0})[kind] = count
    signups: dict = {}
    for (stamp,) in signup_rows:
        try:
            day = parse_timestamp(stamp).date()
        except (TypeError, ValueError):
            continue
        week = (day - timedelta(days=day.weekday())).isoformat()
        signups[week] = signups.get(week, 0) + 1
    submissions, late, avg_marks = sub_rows[0]
    questions, solved, answered = qa_rows[0]
    max_students = (licence or {}).get("max_students")
    return {
        "college": name_rows[0][0] if name_rows and name_rows[0][0] else key, "key": key, "licence": licence,
        "students": total, "max_students": max_students, "over_limit": bool(max_students and total > max_students),
        "verification": statuses, "groups": group_rows[0][0] or 0,
        "activity": [{"week": week, **counts} for week, counts in sorted(activity.items())], "signups": [{"week": w, "count": c} for w, c in sorted(signups.items())],
        "work": {"submissions": submissions or 0, "late": int(late or 0), "average_marks_percent": round(float(avg_marks), 1) if avg_marks is not None else None},
        "attendance": [{"class": f"{dept}{' · Div ' + div if div else ''}", "marks": marks, "percent": round(attended * 100 / marks) if marks else 0} for dept, div, marks, attended in att_rows],
        "questions": {"total": questions or 0, "answered": int(answered or 0), "solved": solved or 0},
        "top_skills": [{"skill": name, "students": count} for name, count in sorted(skills.items(), key=lambda item: -item[1])[:12]],
    }


# ==========================================
# 20. THE FOUNDER CONSOLE: OVERVIEW, PLANS GIVEN BY HAND, ENQUIRIES
# ==========================================
class GrantBody(BaseModel):
    plan_key: str
    user_id: Optional[int] = None                  # the person, by account id ...
    email: Optional[str] = ""                      # ... or by login email (personal, recruiter and sponsor plans)
    college_name: Optional[str] = ""               # institution licences
    org_name: Optional[str] = ""
    period: Optional[str] = ""                     # month, year, one_time; empty picks the plan's own
    years: Optional[int] = 1
    starts_at: Optional[str] = ""
    ends_at: Optional[str] = ""
    amount_rupees: Optional[float] = 0             # what was actually paid, before GST for business plans
    reference: Optional[str] = ""                  # UPI / bank reference, if paid outside Razorpay
    note: Optional[str] = ""
    credits: Optional[int] = None
    seats: Optional[int] = None
    enquiry_id: Optional[int] = None

class ExtendBody(BaseModel):
    days: int

class EnquiryUpdate(BaseModel):
    status: str
    note: Optional[str] = ""


@app.get("/api/founder/overview")
async def founder_overview(founder_id: int = Depends(require_founder)):
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    counts, statuses, subs, paid, recent = await asyncio.gather(
        fetch_one_off(select(
            select(func.count()).select_from(DBUser).scalar_subquery(),
            select(func.count()).select_from(DBUser).where(DBUser.is_admin == 1, func.coalesce(DBUser.is_founder, 0) == 0).scalar_subquery(),
            select(func.count()).select_from(DBUser).where(func.coalesce(DBUser.teacher_of, "") != "").scalar_subquery(),
            select(func.count()).select_from(DBAdminRequest).where(func.lower(DBAdminRequest.status).in_(OPEN_APPLICATION)).scalar_subquery(),
            select(func.count()).select_from(DBTeacherRequest).where(DBTeacherRequest.status.in_(OPEN_APPLICATION)).scalar_subquery(),
            select(func.count()).select_from(DBEnquiry).where(DBEnquiry.status.in_(("new", "contacted"))).scalar_subquery(),
            select(func.count()).select_from(DBUser).where(func.coalesce(DBUser.account_status, "pending").in_(("pending", "appealed")), func.coalesce(DBUser.is_founder, 0) == 0, UNASSIGNED_CLAUSE).scalar_subquery(),
        )),
        fetch_one_off(select(DBUser.account_status, func.count()).group_by(DBUser.account_status)),
        fetch_one_off(select(DBSubscription.plan_key, DBSubscription.period, DBSubscription.years, DBSubscription.amount_paise, DBSubscription.gst_paise)
                      .where(DBSubscription.status == "active", DBSubscription.ends_at >= today_iso())),
        fetch_one_off(select(func.coalesce(func.sum(DBPayment.amount_paise), 0), func.coalesce(func.sum(DBPayment.gst_paise), 0), func.count())
                      .where(DBPayment.status == "paid", DBPayment.paid_at >= month_start)),
        fetch_one_off(select(DBPayment, DBUser.name).outerjoin(DBUser, DBUser.id == DBPayment.user_id).where(DBPayment.status.in_(("paid", "refunded"))).order_by(DBPayment.id.desc()).limit(10)),
    )
    users, admins, teachers, admin_apps, teacher_apps, enquiries, unassigned = counts[0]
    status_counts: dict = {}
    for status_, count in statuses:
        status_counts[status_ or "pending"] = status_counts.get(status_ or "pending", 0) + count
    mrr, by_line = 0, {}
    for plan_key, period, years, amount, gst in subs:
        line = PLANS.get(plan_key, {}).get("line", "other")
        by_line[line] = by_line.get(line, 0) + 1
        net = (amount or 0) - (gst or 0)
        if period == "month":
            mrr += net
        elif period == "year":
            mrr += net / (12 * (years or 1))
    revenue, revenue_gst, payments = paid[0]
    return {
        "users": users or 0, "verified": status_counts.get("verified", 0), "statuses": status_counts, "admins": admins or 0, "teachers": teachers or 0,
        "open": {"admin_applications": admin_apps or 0, "teacher_applications": teacher_apps or 0, "enquiries": enquiries or 0, "unassigned_verification": unassigned or 0},
        "revenue_month_paise": revenue or 0, "revenue_month_gst_paise": revenue_gst or 0, "payments_month": payments or 0, "mrr_paise": round(mrr),
        "active_by_line": by_line, "payments_enabled": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET),
        "recent_payments": [{**serialize_payment(p), "name": name or ""} for p, name in recent],
    }


@app.get("/api/founder/subscriptions")
async def founder_subscriptions(status: str = "active", founder_id: int = Depends(require_founder)):
    conditions = [DBSubscription.status == status] if status else []
    rows = await fetch_one_off(select(DBSubscription, DBUser.name, DBUser.email).outerjoin(DBUser, DBUser.id == DBSubscription.user_id)
                               .where(*conditions).order_by(DBSubscription.id.desc()).limit(300))
    return {"subscriptions": [{**serialize_subscription(sub), "name": name or "", "email": email or ""} for sub, name, email in rows],
            "plans": [{"key": key, "name": plan["name"], "line": plan["line"], "periods": list(plan["prices"].keys())} for key, plan in PLANS.items() if key not in ("free",)]}


@app.post("/api/founder/subscriptions")
async def founder_grant(body: GrantBody, founder_id: int = Depends(require_founder)):
    """Switch a plan on by hand: after an enquiry, a bank transfer or UPI payment, or as a gift."""
    plan = PLANS.get(body.plan_key)
    if not plan or body.plan_key == "free":
        raise HTTPException(status_code=400, detail="Pick a plan.")
    period = body.period or ("one_time" if plan["line"] == "sponsor" else ("trial" if body.plan_key == "inst_trial" else ("year" if "year" in plan["prices"] else "month")))
    for value, what in ((body.starts_at, "start date"), (body.ends_at, "end date")):
        if value and not HUB_DATE_PATTERN.match(value):
            raise HTTPException(status_code=400, detail=f"The {what} must be a date.")
    user_id, college_key, college_name = None, "", ""
    if plan["line"] == "institution":
        college_name = (body.college_name or "").strip()
        college_key = college_key_of(college_name)
        if not college_key:
            raise HTTPException(status_code=400, detail="Name the college this licence is for.")
    else:
        if body.user_id:
            rows = await fetch_one_off(select(DBUser.id).where(DBUser.id == body.user_id))
        elif (body.email or "").strip():
            rows = await fetch_one_off(select(DBUser.id).where(func.lower(DBUser.email) == body.email.strip().lower()))
        else:
            raise HTTPException(status_code=400, detail="Give the account's email or id.")
        if not rows:
            raise HTTPException(status_code=404, detail="No account matches that email or id.")
        user_id = rows[0][0]
    amount = max(0, round((body.amount_rupees or 0) * 100))
    total, gst = gst_split(plan, amount) if amount else (0, 0)
    years = max(1, min(3, body.years or 1))
    sub_id = await activate_subscription(user_id=user_id, plan_key=body.plan_key, period=period, years=years, amount=total, gst=gst, source="manual",
                                         college_key=college_key, org_name=(body.org_name or college_name).strip()[:160], granted_by=founder_id,
                                         note=clean_text(body.note, 500, "note"), starts_at=body.starts_at or None, ends_at=body.ends_at or None,
                                         credits=body.credits, seats=body.seats)
    if total:
        payer = user_id or founder_id
        await run_one_off(DBPayment.__table__.insert().values(
            user_id=payer, subscription_id=sub_id, plan_key=body.plan_key, period=period, amount_paise=total, gst_paise=gst, status="paid", method="manual",
            reference=clean_text(body.reference, 120, "reference"), created_at=utc_now_iso(), paid_at=utc_now_iso(), receipt_no=f"C2M-M-{sub_id}"))
    if body.enquiry_id:
        await run_one_off(update(DBEnquiry).where(DBEnquiry.id == body.enquiry_id).values(status="won", subscription_id=sub_id, updated_at=utc_now_iso()))
    if user_id:
        spawn_background(create_notification(user_id, "account", f"{plan['name']} is now active on your account.", utc_now_iso(), "billing.html"))
    if college_key:
        teachers = await fetch_one_off(select(DBUser.id).where(DBUser.teacher_of == college_key))
        spawn_background(notify_many([row[0] for row in teachers], "account", f"{college_name} now has {plan['name']} on Connect2Minds.", "institution.html"))
        hub_changed(college_key)
    return {"id": sub_id}


@app.post("/api/founder/subscriptions/{sub_id}/cancel")
async def founder_cancel_subscription(sub_id: int, founder_id: int = Depends(require_founder)):
    rows = await run_returning(update(DBSubscription).where(DBSubscription.id == sub_id, DBSubscription.status == "active").values(status="cancelled")
                               .returning(DBSubscription.user_id, DBSubscription.plan_key, DBSubscription.college_key))
    if not rows:
        raise HTTPException(status_code=404, detail="That subscription is not active.")
    user_id, plan_key, college_key = rows[0]
    if user_id and PLANS.get(plan_key, {}).get("line") == "personal":
        await refresh_user_plan(user_id)
    if college_key:
        hub_changed(college_key)
    return {"status": "cancelled"}


@app.post("/api/founder/subscriptions/{sub_id}/extend")
async def founder_extend_subscription(sub_id: int, body: ExtendBody, founder_id: int = Depends(require_founder)):
    if not (1 <= body.days <= 1100):
        raise HTTPException(status_code=400, detail="Extend by 1 to 1100 days.")
    rows = await fetch_one_off(select(DBSubscription.ends_at, DBSubscription.user_id, DBSubscription.plan_key).where(DBSubscription.id == sub_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    base = max(datetime.fromisoformat(rows[0][0]).date(), datetime.now().date() - timedelta(days=1))
    new_end = (base + timedelta(days=body.days)).isoformat()
    await run_one_off(update(DBSubscription).where(DBSubscription.id == sub_id).values(ends_at=new_end, status="active", reminded=0))
    if rows[0][1] and PLANS.get(rows[0][2], {}).get("line") == "personal":
        await refresh_user_plan(rows[0][1])
    return {"id": sub_id, "ends_at": new_end}


@app.post("/api/founder/payments/{payment_id}/refund")
async def founder_mark_refund(payment_id: int, founder_id: int = Depends(require_founder)):
    """Record a refund made in the Razorpay dashboard (or by bank). The plan it paid for is cancelled."""
    rows = await run_returning(update(DBPayment).where(DBPayment.id == payment_id, DBPayment.status == "paid").values(status="refunded").returning(DBPayment.subscription_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That payment is not a paid one.")
    if rows[0][0]:
        await founder_cancel_subscription(rows[0][0], founder_id)
    return {"status": "refunded"}


@app.get("/api/founder/payments")
async def founder_payments(founder_id: int = Depends(require_founder)):
    rows = await fetch_one_off(select(DBPayment, DBUser.name, DBUser.email).outerjoin(DBUser, DBUser.id == DBPayment.user_id).order_by(DBPayment.id.desc()).limit(300))
    return {"payments": [{**serialize_payment(p), "name": name or "", "email": email or ""} for p, name, email in rows]}


@app.get("/api/founder/enquiries")
async def founder_enquiries(founder_id: int = Depends(require_founder)):
    rows = await fetch_one_off(select(DBEnquiry).order_by(case((DBEnquiry.status.in_(("new", "contacted")), 0), else_=1), DBEnquiry.id.desc()).limit(300))
    return {"enquiries": [{
        "id": e.id, "kind": e.kind, "plan_key": e.plan_key or "", "plan_name": PLANS.get(e.plan_key or "", {}).get("name", ""), "organisation": e.organisation or "",
        "contact_name": e.contact_name or "", "email": e.email or "", "phone": e.phone or "", "size": e.size or "", "message": e.message or "",
        "status": e.status, "founder_note": e.founder_note or "", "subscription_id": e.subscription_id, "created_at": e.created_at or "", "updated_at": e.updated_at or "",
    } for (e,) in rows]}


@app.put("/api/founder/enquiries/{enquiry_id}")
async def founder_update_enquiry(enquiry_id: int, body: EnquiryUpdate, founder_id: int = Depends(require_founder)):
    if body.status not in ("new", "contacted", "won", "lost"):
        raise HTTPException(status_code=400, detail="Status must be new, contacted, won or lost.")
    rows = await run_returning(update(DBEnquiry).where(DBEnquiry.id == enquiry_id).values(status=body.status, founder_note=clean_text(body.note, 1000, "note"), updated_at=utc_now_iso()).returning(DBEnquiry.id))
    if not rows:
        raise HTTPException(status_code=404, detail="Enquiry not found.")
    return {"id": enquiry_id, "status": body.status}


@app.get("/api/founder/sponsored")
async def founder_sponsored(founder_id: int = Depends(require_founder)):
    rows = await fetch_one_off(
        select(DBBoardPost, DBUser.name, select(func.count()).select_from(DBChallengeSubmission).where(DBChallengeSubmission.post_id == DBBoardPost.id).correlate(DBBoardPost).scalar_subquery())
        .outerjoin(DBUser, DBUser.id == DBBoardPost.author_id).where(DBBoardPost.is_sponsored == 1).order_by(DBBoardPost.id.desc()).limit(200))
    return {"challenges": [{"id": p.id, "title": p.title or "", "kind": p.kind or "", "tier": p.sponsor_tier or "", "sponsor": p.sponsor_name or "", "prize": p.prize or "",
                            "deadline": p.deadline or "", "sponsored_until": p.sponsored_until or "", "winners_announced": bool(p.winners_announced),
                            "author": name or "", "submissions": count or 0} for p, name, count in rows]}
