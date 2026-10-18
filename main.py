import os
import random
import re
import json
import base64
import uuid
import hmac
import hashlib
import secrets
import math
import asyncio
import urllib.request
import urllib.error
import urllib.parse
import httpx
import html
import struct
import smtplib
from email.message import EmailMessage
from urllib.parse import urlparse
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.fernet import Fernet
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status, Depends, Request, Response, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, NoReturn
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
    # Section 21: the weekly email (1 = send it) and when the last one went out
    digest_on = Column(Integer, default=1)
    last_digest_at = Column(String, default="")
    # Section 26: a deletion the person asked for. account_status is "closing" until delete_after, then "deleted"
    delete_after = Column(String, default="")
    status_before_delete = Column(String, default="")
    # Section 30 (DPDP Act 2023): which privacy notice the person agreed to, and when
    consent_version = Column(String, default="")
    consent_at = Column(String, default="")
    # Section 31: login safety, email check, age, moderation, terms
    token_version = Column(Integer, default=0)       # raised to end every login of the person
    email_verified = Column(Integer, default=0)
    email_verified_at = Column(String, default="")
    totp_secret = Column(String, default="")         # two-step login secret, encrypted (seal_secret)
    totp_enabled = Column(Integer, default=0)
    birth_date = Column(String, default="")          # YYYY-MM-DD
    guardian_email = Column(String, default="")
    guardian_status = Column(String, default="")     # "", pending, approved, declined
    guardian_consent_at = Column(String, default="")
    suspended = Column(Integer, default=0)
    suspend_reason = Column(String, default="")
    terms_version = Column(String, default="")

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
    # Section 27: planning
    start_date = Column(String, default="")       # YYYY-MM-DD or empty
    estimate_hours = Column(Float, nullable=True)
    sprint_id = Column(Integer, nullable=True, index=True)   # empty: in the backlog
    is_milestone = Column(Integer, default=0)
    depends_on = Column(String, default="[]")      # JSON list of task ids this one waits for
    checklist = Column(String, default="[]")       # JSON [{id, text, done}]
    done_at = Column(String, default="")           # when it last moved to Done (for the burndown)

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
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_on INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_digest_at VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_after VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_before_delete VARCHAR DEFAULT ''",
    "ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS start_date VARCHAR DEFAULT ''",
    "ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS estimate_hours DOUBLE PRECISION",
    "ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS sprint_id INTEGER",
    "ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS is_milestone INTEGER DEFAULT 0",
    "ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS depends_on VARCHAR DEFAULT '[]'",
    "ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS checklist VARCHAR DEFAULT '[]'",
    "ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS done_at VARCHAR DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS ix_team_tasks_sprint_id ON team_tasks (sprint_id)",
    "UPDATE team_tasks SET done_at = updated_at WHERE status = 'done' AND COALESCE(done_at, '') = ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_email VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_status VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_at VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspend_reason VARCHAR DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR DEFAULT ''",
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
    spawn_background(digest_watch())
    spawn_background(study_watch())
    spawn_background(seed_practice_bank())
    await load_closed_accounts()
    spawn_background(account_delete_watch())
    spawn_background(visits_watch())

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
        self.rooms: dict[int, set[WebSocket]] = {}

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
        for connection in list(self.rooms.get(room_id, set())):
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

    def hub_viewers(self, team_id: int) -> list:
        """Who has Project Hub open for this team, and on which tool (sent by the page, never stored)."""
        seen = {}
        for user in self.teams.get(team_id, {}).values():
            if user.get("view"):
                seen[user["id"]] = {"user_id": user["id"], "name": user["name"], "profile_pic": user["profile_pic"], "tab": user["view"]}
        return list(seen.values())

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

# The addresses the pages are served from. Hosted: ALLOWED_ORIGINS=https://connect2minds.in,https://www.connect2minds.in in .env
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",") if o.strip()]

@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Headers every answer carries. The pages' host must send the same ones for the .html files (see DEPLOY.md)."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(self)")
    if request_is_https(request):
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lists such as /api/discover are large JSON; compressed they are 5-8 times smaller over the wire
app.add_middleware(GZipMiddleware, minimum_size=1000)

os.makedirs("static/uploads", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

SECRET_KEY = os.getenv("SECRET_KEY") or ""
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
    consent: Optional[bool] = False          # the DPDP notice box on the last sign-up step
    birth_date: Optional[str] = ""           # YYYY-MM-DD; under 18 needs guardian_email (section 31)
    guardian_email: Optional[str] = ""

# The privacy notice people agree to (privacy.html + dpdp.html). Change it when those pages change in substance:
# everyone who agreed to an older one is shown the "we updated our notice" bar again (section 30).
# TERMS_VERSION (section 31) works the same way for terms.html.
PRIVACY_VERSION = "2026-10-16"

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
    remember: bool = False      # "Keep me logged in"

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
    code: Optional[str] = ""      # two-step login code, when the account has it on (section 31)

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

def create_access_token(data: dict, minutes: Optional[int] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=minutes or ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    to_encode.setdefault("tv", TOKEN_VERSIONS.get(int(data.get("sub") or 0), 0))   # see token_user_id
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# The login cookies. "Secure" keeps them off plain http once the site runs on https: it follows how the page was reached
# (or the X-Forwarded-Proto header of a proxy in front), and COOKIE_SECURE=1 / 0 in .env forces it on or off.
# "Keep me logged in" on login.html keeps a login for REMEMBER_ME_DAYS; without it the cookie ends when the browser
# closes and the token itself stops working after SESSION_LOGIN_MINUTES. The cookie banner is section 29.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "auto").strip().lower()
REMEMBER_ME_DAYS = 30
SESSION_LOGIN_MINUTES = 60 * 12

def request_is_https(request) -> bool:
    if COOKIE_SECURE in ("1", "true", "yes", "on"):
        return True
    if COOKIE_SECURE in ("0", "false", "no", "off"):
        return False
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return (forwarded or request.url.scheme) == "https"

def set_login_cookie(response: Response, request, key: str, token: str, max_age: Optional[int]):
    """max_age None makes a cookie that ends when the browser closes."""
    response.set_cookie(key=key, value=token, httponly=True, max_age=max_age, samesite="lax", secure=request_is_https(request), path="/")

def clear_login_cookies(response: Response, request):
    for key in ("authToken", "adminToken"):
        response.delete_cookie(key=key, path="/", httponly=True, samesite="lax", secure=request_is_https(request))

# Accounts waiting to be erased, or already erased (section 26). Their old login cookies stop working at once.
# Kept in memory so the check costs no database read; filled at startup.
CLOSED_ACCOUNTS: set = set()
HIDDEN_ACCOUNT_STATUSES = ("rejected", "closing", "deleted")
CLOSED_DETAIL = "This account has been closed. Log in again to cancel a deletion that is still waiting."

# Section 31, in memory for the same reason: a person's token version (a password change, reset or "log out everywhere"
# raises it, ending older logins), suspended accounts, and under-18s waiting for a guardian (they may only read and
# use the few routes in GUARDIAN_OPEN_PATHS until the guardian agrees).
TOKEN_VERSIONS: dict = {}
SUSPENDED_ACCOUNTS: set = set()
GUARDIAN_PENDING: set = set()
SUSPENDED_DETAIL = "This account is suspended for breaking the terms of use. To appeal, write to Support (support.html)."
RELOGIN_DETAIL = "You were logged out because your password or login settings changed. Please log in again."
GUARDIAN_DETAIL = "Your parent or guardian has to agree before you can use Connect2Minds."
GUARDIAN_OPEN_PATHS = ("/api/logout", "/api/me/guardian", "/api/me/birth-date", "/api/me/delete", "/api/me/consent", "/api/me/email",
                       "/api/visits", "/api/enquiries", "/api/helpbot", "/api/notifications")

def token_user_id(payload: dict, request=None) -> int:
    """The account a decoded login token belongs to, once the in-memory checks pass. Raises 401 (or 403)."""
    user_id = int(payload.get("sub"))
    if user_id in CLOSED_ACCOUNTS:
        raise HTTPException(status_code=401, detail=CLOSED_DETAIL)
    if int(payload.get("tv") or 0) != TOKEN_VERSIONS.get(user_id, 0) or payload.get("purpose"):
        raise HTTPException(status_code=401, detail=RELOGIN_DETAIL)
    if user_id in SUSPENDED_ACCOUNTS:
        raise HTTPException(status_code=401, detail=SUSPENDED_DETAIL)
    if (request is not None and user_id in GUARDIAN_PENDING and request.method not in ("GET", "HEAD", "OPTIONS")
            and not request.url.path.startswith(GUARDIAN_OPEN_PATHS)):
        raise HTTPException(status_code=403, detail=GUARDIAN_DETAIL)
    return user_id

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("authToken")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated. No secure cookie found.")
        
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication token.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please log in again.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
    token_user_id(payload, request)
        
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
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication token.")
        user_id = int(user_id)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please log in again.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
    return token_user_id(payload, request)


def get_websocket_user_id(websocket: WebSocket) -> Optional[int]:
    """Identify a WebSocket client from its authToken cookie. Returns None if not authenticated."""
    token = websocket.cookies.get("authToken")
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = token_user_id(payload)
    except (jwt.PyJWTError, TypeError, ValueError, HTTPException):
        return None
    return None if user_id in GUARDIAN_PENDING else user_id


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
async def register_user(request: Request, profile: ProfileRegister, response: Response, db: AsyncSession = Depends(get_db)):
    # Auto-generate email if not provided
    user_email = profile.email.strip() if profile.email else ""
    if not profile.consent:
        raise HTTPException(status_code=400, detail="Please read the privacy notice and tick the box to agree before signing up.")
    birth_date, age = parse_birth_date(profile.birth_date)
    if age < MIN_AGE:
        raise HTTPException(status_code=400, detail=f"Connect2Minds is for people aged {MIN_AGE} and over.")
    guardian_email = check_guardian_email(profile.guardian_email, user_email) if age < ADULT_AGE else ""
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
    
    # 1. Official College Email Auto-Verify (once emails can be sent, only after the address is confirmed: section 31)
    if (user_email.endswith(".edu.in") or user_email.endswith(".ac.in")) and not EMAIL_READY:
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
        experience_years=experience_years,
        consent_version=PRIVACY_VERSION,
        consent_at=utc_now_iso(),
        terms_version=TERMS_VERSION,
        birth_date=birth_date,
    )

    db.add(new_user)
    try:
        await db.commit()
    except Exception:
        remove_id_card_file(id_card)
        raise
    await db.refresh(new_user)

    access_token = create_access_token(data={"sub": str(new_user.id)})
    set_login_cookie(response, request, "authToken", access_token, ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    
    await log_user_activity(db, new_user.id, "Account Created", f"Welcome! Your status is: {initial_status}.")
    if age < ADULT_AGE:
        MINOR_ACCOUNTS.add(new_user.id)
    guardian_sent = await start_guardian_wait(new_user.id, new_user.name or "", guardian_email) if guardian_email else False
    if not guardian_email:
        spawn_background(broadcast_directory({"type": "profile_added", "profile": directory_card(new_user)}))
    if EMAIL_READY and is_real_email(user_email):
        spawn_background(send_signup_code(new_user.id, new_user.name or "", user_email))
    return {"message": "Account registered.", "user_id": new_user.id, "status": initial_status,
            "guardian_needed": bool(guardian_email), "guardian_email_sent": guardian_sent, "email_ready": EMAIL_READY}


@app.post("/api/login")
@limiter.limit("5/minute") 
async def login_user(request: Request, credentials: UserLogin, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DBUser).filter(DBUser.roll_no == credentials.roll_no))
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials.")
        
    if not await check_password_async(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    if (user.suspended or 0) == 1:
        raise HTTPException(status_code=403, detail=SUSPENDED_DETAIL)
    if user.account_status == "deleted":
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    if user.guardian_status == "declined":
        raise HTTPException(status_code=403, detail="This account was closed because a parent or guardian did not agree.")
    if (user.totp_enabled or 0) == 1:   # the cookie comes from /api/login/2fa once the code is right (section 31)
        return {"two_factor": True, "ticket": two_factor_ticket(user.id, credentials.remember)}
    return await finish_login(request, response, db, user, credentials.remember)


async def finish_login(request: Request, response: Response, db: AsyncSession, user: DBUser, remember: bool) -> dict:
    """The end of a member login (after the password, and the two-step code when it is on)."""
    restored = user.account_status == "closing"
    if restored:
        await cancel_account_deletion(db, user)
        
    minutes = REMEMBER_ME_DAYS * 24 * 60 if remember else SESSION_LOGIN_MINUTES
    access_token = create_access_token(data={"sub": str(user.id)}, minutes=minutes)
    set_login_cookie(response, request, "authToken", access_token, minutes * 60 if remember else None)
    
    await log_user_activity(db, user.id, "Session Active", "You successfully logged into your account.")
    return {"message": "Login successful.", "user_id": user.id, "account_type": user.account_type, "is_admin": user.is_admin, "restored": restored,
            "guardian_needed": user.guardian_status == "pending"}


@app.post("/api/logout")
async def logout_user(request: Request, response: Response):
    clear_login_cookies(response, request)
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
    row = (await db.execute(select(*public_profile_columns(), DBUser.consent_version, *SAFETY_FLAG_COLUMNS()).filter(DBUser.id == current_user_id))).first()
    if not row:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    me = public_profile(row)
    me.update(safety_flags(row))   # section 31: email, two-step login, age, terms
    me["consent_needed"] = (row.consent_version or "") != PRIVACY_VERSION or me.get("terms_needed", False)   # the notice bar in shared.js
    return me


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


def visible_user_clause():
    """People who may be listed anywhere: not rejected, not waiting to be erased, not erased."""
    return and_(func.coalesce(DBUser.account_status, "").not_in(HIDDEN_ACCOUNT_STATUSES), func.coalesce(DBUser.suspended, 0) == 0,
                func.coalesce(DBUser.guardian_status, "") != "pending")

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
            visible_user_clause(),
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
    if receiver_id in CLOSED_ACCOUNTS:
        raise MessageRefused("This account has been closed, so it cannot receive messages.")
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
        spawn_background(push_notify([user_id], notif_type, content, link))
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
            await websocket.receive_text()
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


async def explain_missing_project(db: AsyncSession, project_id: int) -> NoReturn:
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


async def explain_missing_board_post(db: AsyncSession, post_id: int, action: str) -> NoReturn:
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
            await websocket.receive_text()
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

                elif msg_type == "plan_invite":
                    # "Plan together": everyone else in the caller's room is asked to open Project Hub
                    room = team_hub.room_of(websocket)
                    if room:
                        payload = json.dumps({"type": "plan_invite", "from": user_id, "name": user["name"], "tab": str(msg.get("tab") or "")[:30]})
                        for other_id, member in list(team_hub.rooms.get(room, {}).items()):
                            if other_id != user_id:
                                try:
                                    await member["ws"].send_text(payload)
                                except Exception:
                                    pass

                elif msg_type == "hub_view":
                    # Project Hub tells which tool this person is looking at, so teammates see who is where
                    tab = str(msg.get("tab") or "")[:30]
                    if user.get("view") != tab:
                        user["view"] = tab
                        await team_hub.broadcast(team_id, {"type": "hub_presence", "viewers": team_hub.hub_viewers(team_id)})

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
        if user.get("view"):
            await team_hub.broadcast(team_id, {"type": "hub_presence", "viewers": team_hub.hub_viewers(team_id)})
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
    # Section 27
    start_date: Optional[str] = None
    estimate_hours: Optional[float] = None
    sprint_id: Optional[int] = None
    is_milestone: Optional[bool] = None
    depends_on: Optional[List[int]] = None
    checklist: Optional[list] = None

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
    # Section 27
    start_date: Optional[str] = None
    estimate_hours: Optional[float] = None
    clear_estimate: Optional[bool] = False
    sprint_id: Optional[int] = None
    to_backlog: Optional[bool] = False
    is_milestone: Optional[bool] = None
    depends_on: Optional[List[int]] = None
    checklist: Optional[list] = None

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
        "updated_at": task.updated_at,
        **task_extra_fields(task),
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
    team_rows, member_rows, task_rows, board_rows, sprint_rows, item_rows, comment_rows, time_rows = await asyncio.gather(
        fetch_one_off(select(DBTeam.id, DBTeam.name, DBTeam.description, DBTeam.created_by).filter(DBTeam.id == team_id)),
        fetch_one_off(members_query(team_id)),
        fetch_one_off(select(DBTeamTask).filter(DBTeamTask.team_id == team_id).order_by(DBTeamTask.position.asc(), DBTeamTask.id.asc())),
        fetch_one_off(select(DBTeamBoard).filter(DBTeamBoard.team_id == team_id)),
        fetch_one_off(select(DBTeamSprint).where(DBTeamSprint.team_id == team_id).order_by(DBTeamSprint.start_date, DBTeamSprint.id)),
        fetch_one_off(select(DBProjectItem).where(DBProjectItem.team_id == team_id).order_by(DBProjectItem.kind, DBProjectItem.position, DBProjectItem.id)),
        fetch_one_off(select(DBTaskComment.task_id, func.count()).where(DBTaskComment.team_id == team_id).group_by(DBTaskComment.task_id)),
        fetch_one_off(select(DBTimeEntry).where(DBTimeEntry.team_id == team_id).order_by(DBTimeEntry.id.desc()).limit(3000)),
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
        "canvas": canvas,
        "sprints": [serialize_sprint(sprint) for (sprint,) in sprint_rows],
        "items": [serialize_item(item) for (item,) in item_rows],
        "comment_counts": {str(task_id): count for task_id, count in comment_rows},
        "time": [serialize_time(entry) for (entry,) in time_rows],
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
    values.update(clean_task_extras(data, partial=False))
    check_dates_order(values.get("start_date", ""), values.get("due_date", ""))
    await check_sprint(db, team_id, data.sprint_id)
    if data.sprint_id is not None:
        values["sprint_id"] = data.sprint_id
    if data.depends_on:
        values["depends_on"] = json.dumps(await check_dependencies(db, team_id, None, data.depends_on))
    if values["status"] == "done":
        values["done_at"] = utc_now_iso()

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
    spawn_background(record_activity(team_id, task["id"], current_user_id, [("created", "created the task")]))
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
    values.update(clean_task_extras(data, partial=True))
    check_dates_order(values.get("start_date", task.start_date or ""), values.get("due_date", task.due_date or ""))
    if data.to_backlog:
        values["sprint_id"] = None
    elif data.sprint_id is not None:
        await check_sprint(db, task.team_id, data.sprint_id)
        values["sprint_id"] = data.sprint_id
    if data.depends_on is not None:
        values["depends_on"] = json.dumps(await check_dependencies(db, task.team_id, task_id, data.depends_on))
    if "status" in values and values["status"] != (task.status or "todo"):
        values["done_at"] = utc_now_iso() if values["status"] == "done" else ""
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    history = describe_task_change(task, values, await team_member_names(task.team_id) if "assignee_id" in values else {})

    values["updated_at"] = utc_now_iso()
    result = await db.execute(update(DBTeamTask).where(DBTeamTask.id == task_id).values(**values).returning(*DBTeamTask.__table__.c))
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found.")
    updated = serialize_task(row)
    await team_hub.broadcast(task.team_id, {"type": "task_updated", "task": updated, "by": current_user_id})
    spawn_background(touch_board(task.team_id))
    # A plain move within a column is not worth a history line
    spawn_background(record_activity(task.team_id, task_id, current_user_id, history))
    return updated


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    task, role = await get_task_for_member(db, task_id, current_user_id)
    if role != "Admin" and current_user_id not in (task.created_by, task.assignee_id):
        raise HTTPException(status_code=403, detail="Only the person who created it, the assignee or an Admin can delete this task.")
    await db.execute(delete(DBTeamTask).where(DBTeamTask.id == task_id))
    await asyncio.gather(
        run_one_off(delete(DBTaskComment).where(DBTaskComment.task_id == task_id)),
        run_one_off(delete(DBTaskActivity).where(DBTaskActivity.task_id == task_id)),
        run_one_off(update(DBTimeEntry).where(DBTimeEntry.task_id == task_id).values(task_id=None)),   # the hours were still worked
    )
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
        run_one_off(delete(DBTeamSprint).where(DBTeamSprint.team_id == team_id)),
        run_one_off(delete(DBTaskComment).where(DBTaskComment.team_id == team_id)),
        run_one_off(delete(DBTaskActivity).where(DBTaskActivity.team_id == team_id)),
        run_one_off(delete(DBTimeEntry).where(DBTimeEntry.team_id == team_id)),
        run_one_off(delete(DBProjectItem).where(DBProjectItem.team_id == team_id)),
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
        await require_admin_second_factor(founder_user, credentials.code)
        
        founder_user.is_founder = 1
        founder_user.is_admin = 1   # kept so older checks still let the founder in; new code asks is_founder first
        await db.commit()
        
        access_token = create_access_token(data={"sub": str(founder_user.id)})
        admin_token = create_access_token(data={"sub": str(founder_user.id), "role": "founder"})
        
        set_login_cookie(response, request, "authToken", access_token, ACCESS_TOKEN_EXPIRE_MINUTES * 60)
        set_login_cookie(response, request, "adminToken", admin_token, ACCESS_TOKEN_EXPIRE_MINUTES * 60)
        
        # RETURN TOKEN DIRECTLY IN JSON FOR LOCALSTORAGE FALLBACK
        return {"message": "Founder Access Granted", "role": "founder", "user_id": founder_user.id, "token": admin_token}
    
    # --- REGULAR ADMIN LOGIN (the secure code is the admin's own account password) ---
    result = await db.execute(select(DBUser).filter(DBUser.name == credentials.name, DBUser.is_admin == 1))
    admin_user = None
    for candidate in result.scalars().all():
        if candidate.id in CLOSED_ACCOUNTS:
            continue
        if candidate.hashed_password and await check_password_async(credentials.bypass_code, candidate.hashed_password):
            admin_user = candidate
            break

    if not admin_user:
        raise HTTPException(status_code=403, detail="Unauthorized. Invalid name or bypass code.")
    if (admin_user.suspended or 0) == 1:
        raise HTTPException(status_code=403, detail=SUSPENDED_DETAIL)
    await require_admin_second_factor(admin_user, credentials.code)
        
    access_token = create_access_token(data={"sub": str(admin_user.id)})
    admin_token = create_access_token(data={"sub": str(admin_user.id), "role": "admin"})
    
    set_login_cookie(response, request, "authToken", access_token, ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    set_login_cookie(response, request, "adminToken", admin_token, ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    
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
    token_user_id(payload)
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
    return and_(USER_COLLEGE_KEY == key, is_student_clause(), func.coalesce(DBUser.teacher_of, "") != key, visible_user_clause())

def hub_people_clause(key: str):
    """Everyone who belongs to a college's hub: its students and its approved teachers."""
    return or_(hub_student_clause(key), and_(DBUser.teacher_of == key, visible_user_clause()))


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
        spawn_background(push_notify(user_ids, notif_type, content, link))
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
# Study perks (sections 32 to 34). The daily habit (cards, practice, timer, syllabus) is free for everyone; these are the extras.
FREE_STUDY_LIMITS = {"tutor_daily": 5, "ai_gen_daily": 1, "mock_weekly": 1, "freezes_monthly": 0, "full_test_report": False, "ai_note_files": False}
PAID_STUDY_LIMITS = {"tutor_daily": 60, "ai_gen_daily": 10, "mock_weekly": None, "freezes_monthly": 2, "full_test_report": True, "ai_note_files": True}
FREE_LIMITS.update(FREE_STUDY_LIMITS)

PLANS = {
    # ---- Freemium B2C and professional networking (self-serve, for one person) ----
    "free": {"line": "personal", "name": "Free", "rank": 0, "gst": "inclusive", "prices": {}, "self_serve": False,
             "limits": FREE_LIMITS, "blurb": "Everything you need to build a profile, find people and join teams."},
    "student_pro": {"line": "personal", "name": "Student Pro", "rank": 1, "gst": "inclusive", "prices": {"month": 9900, "year": 79900}, "self_serve": True,
                    "limits": {"new_conversations": 30, "board_applications": UNLIMITED, "teams": 10, "research_saves": UNLIMITED, "pro_intros": 10,
                               "advanced_filters": True, "profile_boost": False},
                    "blurb": "For your studies: 60 AI tutor questions a day, AI flashcards and quizzes, unlimited mock tests with the full report, streak freezes. Plus unlimited applications and more outreach."},
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
# The Exam Pass (section 36 plan work): a single ₹49 payment for 30 days of the study perks, for exam month.
# Networking stays at the free limits. It ranks between Free and Student Pro, so any paid plan wins over it.
PLANS["exam_pass"] = {"line": "personal", "name": "Exam Pass", "rank": 0.5, "gst": "inclusive", "prices": {"one_time": 4900}, "days": 30,
                      "self_serve": True, "study_only": True, "limits": dict(FREE_LIMITS),
                      "blurb": "30 days of every study perk for exam month, for one small payment. No renewal: it simply ends."}
PERSONAL_PLANS = [key for key, plan in PLANS.items() if plan["line"] == "personal" and key != "free"]
STUDY_METRICS = ("tutor_daily", "ai_gen_daily", "mock_weekly")
for _key in PERSONAL_PLANS:
    PLANS[_key]["limits"].update(PAID_STUDY_LIMITS)
PERIOD_DAYS = {"month": 30, "year": 365}
LIMIT_LABELS = {"new_conversations": "new conversations this month", "board_applications": "board applications this month",
                "teams": "teams", "research_saves": "saved research reports", "pro_intros": "introductions to professionals this month",
                "tutor_daily": "AI tutor questions today", "ai_gen_daily": "AI-made flashcard decks and quizzes today",
                "mock_weekly": "timed mock tests this week"}
# How often a counted limit starts again; anything not listed is monthly
LIMIT_PERIODS = {"tutor_daily": "day", "ai_gen_daily": "day", "mock_weekly": "week"}
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

def period_key(metric: str) -> str:
    """The usage_counters period a metric counts in: '2026-10' (month), '2026-10-17' (day), 'w2026-10-12' (the week's Monday).
    Days and weeks are on the site's clock (India time)."""
    period = LIMIT_PERIODS.get(metric, "month")
    if period == "day":
        return site_now().date().isoformat()
    if period == "week":
        today = site_now().date()
        return "w" + (today - timedelta(days=today.weekday())).isoformat()
    return this_month()

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
    rows = await fetch_one_off(select(DBUsageCounter.count).where(DBUsageCounter.user_id == user_id, DBUsageCounter.metric == metric, DBUsageCounter.period == period_key(metric)))
    return rows[0][0] if rows else 0

async def bump_usage(user_id: int, metric: str, by: int = 1):
    try:
        await run_one_off(pg_insert(DBUsageCounter).values(user_id=user_id, metric=metric, period=period_key(metric), count=by)
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
        if metric in STUDY_METRICS and plan_key == "free":
            better = "Student Pro, or the ₹49 Exam Pass for 30 days,"
        raise HTTPException(status_code=402, detail=f"You have used all {limit} {LIMIT_LABELS.get(metric, metric)} on the {PLANS.get(plan_key, PLANS['free'])['name']} plan. Upgrade to {better} on the Plans page to get more.")

async def has_feature(user_id: int, feature: str) -> bool:
    """A yes/no perk of the person's plan (full_test_report, ai_note_files, advanced_filters...). The founder has them all."""
    founder, plan_key = await personal_plan(user_id)
    return founder or bool(limit_of(plan_key, feature))


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
        limits = {metric: True if isinstance(value, bool) else UNLIMITED for metric, value in FREE_LIMITS.items()}
        limits["freezes_monthly"] = 2
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
    founder, current_plan = await personal_plan(current_user_id)
    if founder:
        raise HTTPException(status_code=400, detail="As the founder you already have every feature, free.")
    if plan.get("study_only") and PLANS.get(current_plan, {}).get("rank", 0) >= 1:
        raise HTTPException(status_code=400, detail="Your plan already includes everything in the Exam Pass.")
    total, gst = gst_split(plan, plan_price(body.plan_key, body.period))
    period_words = {"year": "yearly", "month": "monthly", "one_time": f"{plan.get('days', 30)} days"}.get(body.period, body.period)
    rows = await fetch_one_off(select(DBUser.name, DBUser.email).where(DBUser.id == current_user_id))
    payment_rows = await run_returning(DBPayment.__table__.insert().values(
        user_id=current_user_id, plan_key=body.plan_key, period=body.period, amount_paise=total, gst_paise=gst, status="created", method="razorpay", created_at=utc_now_iso(),
    ).returning(DBPayment.id))
    payment_id = payment_rows[0][0]
    order = await razorpay("POST", "/orders", {"amount": total, "currency": "INR", "receipt": f"c2m-{payment_id}",
                                               "notes": {"user_id": str(current_user_id), "plan_key": body.plan_key, "period": body.period}})
    await run_one_off(update(DBPayment).where(DBPayment.id == payment_id).values(razorpay_order_id=order["id"]))
    return {"key_id": RAZORPAY_KEY_ID, "order_id": order["id"], "amount": total, "currency": "INR", "name": BUSINESS_NAME,
            "description": f"{plan['name']} ({period_words})",
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


ENQUIRY_KINDS = ("institution", "recruiter", "sponsor", "support", "data_rights", "grievance", "takedown")   # the last four: organisation holds the topic (sections 30, 31)
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
        return token_user_id(jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]))
    except Exception:
        return None


# ---------- enquiries ----------
@app.post("/api/enquiries")
@limiter.limit("5/minute")
async def create_enquiry(request: Request, body: EnquiryBody):
    if body.kind not in ENQUIRY_KINDS:
        raise HTTPException(status_code=400, detail="Pick what you are asking about.")
    if body.kind == "data_rights" and body.organisation not in DATA_RIGHTS_TYPES:
        raise HTTPException(status_code=400, detail="Pick the kind of request.")
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
    what = {"support": f"New support message: {body.organisation.strip()[:80]}.",
            "data_rights": f"New data-rights request (DPDP Act): {body.organisation}. Reply within {DPDP_REPLY_DAYS} days.",
            "grievance": f"New grievance: {body.organisation.strip()[:80]}. Acknowledge within 24 hours, resolve within 15 days.",
            "takedown": "New copyright takedown request. Act on it within 36 hours."}.get(body.kind, f"New {body.kind} enquiry from {body.organisation.strip()[:80]}.")
    spawn_background(notify_founders("account", what, "founder.html?tab=enquiries"))
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
    conditions = [func.coalesce(DBUser.account_status, "") == "verified", DBUser.id != current_user_id, adult_clause()]
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
    helpbot_today = select(func.coalesce(func.sum(DBUsageCounter.count), 0), func.count()).where(DBUsageCounter.metric == "helpbot", DBUsageCounter.period == site_now().date().isoformat())
    counts, statuses, subs, paid, recent, helpbot_rows = await asyncio.gather(
        fetch_one_off(select(
            select(func.count()).select_from(DBUser).scalar_subquery(),
            select(func.count()).select_from(DBUser).where(DBUser.is_admin == 1, func.coalesce(DBUser.is_founder, 0) == 0).scalar_subquery(),
            select(func.count()).select_from(DBUser).where(func.coalesce(DBUser.teacher_of, "") != "").scalar_subquery(),
            select(func.count()).select_from(DBAdminRequest).where(func.lower(DBAdminRequest.status).in_(OPEN_APPLICATION)).scalar_subquery(),
            select(func.count()).select_from(DBTeacherRequest).where(DBTeacherRequest.status.in_(OPEN_APPLICATION)).scalar_subquery(),
            select(func.count()).select_from(DBEnquiry).where(DBEnquiry.status.in_(("new", "contacted"))).scalar_subquery(),
            select(func.count()).select_from(DBUser).where(func.coalesce(DBUser.account_status, "pending").in_(("pending", "appealed")), func.coalesce(DBUser.is_founder, 0) == 0, UNASSIGNED_CLAUSE).scalar_subquery(),
            select(func.count()).select_from(DBContentReport).where(DBContentReport.status.in_(("open", "reviewing"))).scalar_subquery(),
        )),
        fetch_one_off(select(DBUser.account_status, func.count()).group_by(DBUser.account_status)),
        fetch_one_off(select(DBSubscription.plan_key, DBSubscription.period, DBSubscription.years, DBSubscription.amount_paise, DBSubscription.gst_paise)
                      .where(DBSubscription.status == "active", DBSubscription.ends_at >= today_iso())),
        fetch_one_off(select(func.coalesce(func.sum(DBPayment.amount_paise), 0), func.coalesce(func.sum(DBPayment.gst_paise), 0), func.count())
                      .where(DBPayment.status == "paid", DBPayment.paid_at >= month_start)),
        fetch_one_off(select(DBPayment, DBUser.name).outerjoin(DBUser, DBUser.id == DBPayment.user_id).where(DBPayment.status.in_(("paid", "refunded"))).order_by(DBPayment.id.desc()).limit(10)),
        fetch_one_off(helpbot_today),
    )
    users, admins, teachers, admin_apps, teacher_apps, enquiries, unassigned, reports = counts[0]
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
        "open": {"admin_applications": admin_apps or 0, "teacher_applications": teacher_apps or 0, "enquiries": enquiries or 0, "unassigned_verification": unassigned or 0, "reports": reports or 0},
        "revenue_month_paise": revenue or 0, "revenue_month_gst_paise": revenue_gst or 0, "payments_month": payments or 0, "mrr_paise": round(mrr),
        "active_by_line": by_line, "payments_enabled": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET),
        "recent_payments": [{**serialize_payment(p), "name": name or ""} for p, name in recent],
        "helpbot": {"ai": helpbot_client() is not None, "answers_today": helpbot_rows[0][0] or 0, "people_today": helpbot_rows[0][1] or 0},
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
    period = body.period or ("one_time" if plan["line"] == "sponsor" or list(plan["prices"]) == ["one_time"] else ("trial" if body.plan_key == "inst_trial" else ("year" if "year" in plan["prices"] else "month")))
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
    open_first = case((DBEnquiry.status.in_(("new", "contacted")), 0), else_=1)
    rights_first = case((DBEnquiry.kind.in_(tuple(LEGAL_REPLY_DAYS)), 0), else_=1)   # DPDP, grievance and takedown requests have a legal reply date
    rows = await fetch_one_off(select(DBEnquiry).order_by(open_first, rights_first, DBEnquiry.id.desc()).limit(300))
    return {"enquiries": [{
        "reply_by": dpdp_reply_by(e.created_at, LEGAL_REPLY_DAYS[e.kind]) if e.kind in LEGAL_REPLY_DAYS else "",
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


# ==========================================
# 21. HOME ("TODAY"), PUSH NOTIFICATIONS AND THE WEEKLY EMAIL
# ==========================================
# Home answers "why open the site today": what is waiting for me, what is new for me, how my week went.
# Push and the weekly email carry the same things to people who do not have the site open.
class DBPushSubscription(Base):
    """One browser or phone that agreed to receive notifications."""
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    endpoint = Column(String, unique=True, index=True)
    p256dh = Column(String)
    auth = Column(String)
    created_at = Column(String)


HOME_WEEK_DAYS = 7
HOME_OPPORTUNITIES = 4
HOME_CHALLENGES = 2
HOME_PEOPLE = 6
HOME_POST_AGE_DAYS = 30      # a notice older than this no longer asks to be read or voted on from Home
HOME_OVERDUE_DAYS = 14       # work that is this late stops being listed
HOME_FOLLOW_GOAL = 5
HOME_SKILL_GOAL = 3


def home_item(kind: str, title: str, detail: str, link: str, due: str = "", urgent: bool = False) -> dict:
    return {"kind": kind, "title": title, "detail": detail, "link": link, "due": due, "urgent": urgent}

async def home_hub_items(me: dict, today) -> tuple:
    """What College Hub is waiting on this person for, and what came back for them (marks). One round of reads."""
    key, user_id, student = me["key"], me["id"], me["role"] == "student"
    attended = func.sum(case((DBAttendanceMark.status.in_(("present", "late")), 1), else_=0))
    posts, extras, groups, attendance = await asyncio.gather(
        fetch_one_off(select(DBCollegePost).where(DBCollegePost.college_key == key).order_by(DBCollegePost.id.desc()).limit(200)),
        hub_extras(key, me),
        fetch_one_off(select(DBTeam.id, DBTeam.name, DBTeam.activity_id).join(DBTeamMember, DBTeamMember.team_id == DBTeam.id)
                      .where(DBTeam.college_key == key, DBTeamMember.user_id == user_id)),
        fetch_one_off(select(func.count(), attended).select_from(DBAttendanceMark)
                      .join(DBAttendanceSession, DBAttendanceSession.id == DBAttendanceMark.session_id)
                      .where(DBAttendanceSession.college_key == key, DBAttendanceMark.user_id == user_id)),
    )
    today_text, tomorrow = today.isoformat(), (today + timedelta(days=1)).isoformat()
    soon = lambda day: bool(day) and day <= tomorrow
    recent_from = (today - timedelta(days=HOME_POST_AGE_DAYS)).isoformat()
    overdue_from = (today - timedelta(days=HOME_OVERDUE_DAYS)).isoformat()
    week_ago = (today - timedelta(days=HOME_WEEK_DAYS)).isoformat()
    group_of = {activity_id: (group_id, name or "your group") for group_id, name, activity_id in groups if activity_id}
    handed_in = {(row["activity_id"], row["group_id"]): row for row in extras["submissions"]}
    checked_in = {row["group_id"] for row in extras["checkins"] if row["week_start"] == this_week()}
    needs, news = [], []

    for (post,) in posts:
        if not post_is_for(post, me):
            continue
        card = with_post_extras(serialize_hub_post(post), extras, me)
        title = card["title"]
        if not student:
            continue
        if (card["created_at"] or "")[:10] >= recent_from:
            if card["needs_ack"] and not card.get("acked"):
                needs.append(home_item("ack", f"Read and confirm: {title}", "Your teacher asked everyone to confirm this notice.", "college-hub.html?tab=board"))
            if card["poll_options"] and not card.get("my_votes"):
                voted = card.get("poll_total", 0)
                needs.append(home_item("poll", f"Vote: {title}", f"{voted} {'person has' if voted == 1 else 'people have'} voted so far.", "college-hub.html?tab=board"))
        if card["kind"] != "activity":
            continue
        link = f"college-hub.html?tab=groups&activity={card['id']}"
        group = group_of.get(card["id"])
        if not group:
            if card["students_form_groups"] and not deadline_passed(card["deadline"]):
                needs.append(home_item("group", f"Join or form a group: {title}", f"Groups of {card['group_min']} to {card['group_max']}.",
                                       link, card["deadline"], soon(card["deadline"])))
            continue
        work = handed_in.get((card["id"], group[0]))
        submit_by = card["submit_by"]
        if card["accepts_work"] and not work and (not submit_by or submit_by >= overdue_from):
            late = deadline_passed(submit_by)
            needs.append(home_item("work", f"{'Overdue' if late else 'Hand in'}: {title}", f"For your group, {group[1]}.", link, submit_by, soon(submit_by)))
        if work and work["graded"] and (work["graded_at"] or "")[:10] >= week_ago:
            marks = f"{work['marks']} out of {card['max_marks']}" if work["marks"] is not None and card["max_marks"] else "Your teacher left feedback."
            news.append(home_item("marks", f"Marks are in: {title}", marks, link))
        if card["weekly_checkins"] and group[0] not in checked_in and not deadline_passed(submit_by or card["deadline"]):
            needs.append(home_item("checkin", f"This week's check-in: {title}", f"A short progress note from {group[1]}.", link))

    for event in extras["events"]:
        if event["date"] in (today_text, tomorrow) and addressed_to(event["department"], event["division"], me):
            when = " · ".join(part for part in (event["start_time"], event["location"]) if part)
            needs.append(home_item("event", f"{'Today' if event['date'] == today_text else 'Tomorrow'}: {event['title']}", when, "college-hub.html?tab=calendar", event["date"]))

    if student and attendance:
        total, came = attendance[0][0] or 0, attendance[0][1] or 0
        if total >= HUB_ATTENDANCE_MIN_SESSIONS and came * 100 < HUB_ATTENDANCE_LOW * total:
            needs.append(home_item("attendance", f"Your attendance is {round(came * 100 / total)}%", f"{came} of {total} classes. The line is {HUB_ATTENDANCE_LOW}%.",
                                   "college-hub.html?tab=attendance", urgent=True))
    if not student:
        waiting = sum(1 for row in extras["submissions"] if not row["graded"])
        if waiting:
            needs.append(home_item("grade", f"{waiting} {'piece' if waiting == 1 else 'pieces'} of work waiting for marks", "Handed in by your students' groups.", "college-hub.html?tab=board"))
    return needs, news


def home_opportunity(card: dict, match: list) -> dict:
    return {
        "id": card["id"], "title": card["title"], "category": card["category"], "description": card["description"][:160],
        "skills_required": card["skills_required"], "author_name": card["author_name"], "created_at": card["created_at"],
        "applicant_count": card["applicant_count"], "is_urgent": card["is_urgent"], "is_sponsored": card["is_sponsored"],
        "sponsor_name": card["sponsor_name"], "prize": card["prize"], "deadline": card["deadline"], "match": match,
    }

async def build_home(user_id: int) -> dict:
    """Everything the Home page shows. Also what the weekly email is written from."""
    today = datetime.now().date()
    since = (datetime.now(timezone.utc) - timedelta(days=HOME_WEEK_DAYS)).isoformat()
    i_follow = select(DBFollow.followed_id).where(DBFollow.follower_id == user_id)
    my_posts = select(DBBoardPost.id).where(DBBoardPost.author_id == user_id)

    def count_of(model, *conditions):
        return select(func.count()).select_from(model).where(*conditions).scalar_subquery()

    numbers = select(
        count_of(DBFollow, DBFollow.follower_id == user_id).label("following"),
        count_of(DBFollow, DBFollow.followed_id == user_id, DBFollow.timestamp >= since).label("new_followers"),
        count_of(DBTeamMember, DBTeamMember.user_id == user_id).label("teams"),
        select(func.count(func.distinct(DBNotification.content))).where(DBNotification.user_id == user_id, DBNotification.type == "view",
                                                                        DBNotification.timestamp >= since).scalar_subquery().label("profile_views"),
        count_of(DBBoardApplication, DBBoardApplication.user_id == user_id, DBBoardApplication.created_at >= since).label("applications"),
        count_of(DBBoardApplication, DBBoardApplication.post_id.in_(my_posts), DBBoardApplication.created_at >= since).label("applicants"),
        count_of(DBPushSubscription, DBPushSubscription.user_id == user_id).label("devices"),
    )
    # Unread messages the way the Messages page counts them: not from a cleared chat, a muted or a blocked person
    unread = (
        select(func.count(), func.count(func.distinct(DBMessage.sender_id))).select_from(DBMessage)
        .outerjoin(DBClearedChat, and_(DBClearedChat.user_id == user_id, DBClearedChat.cleared_with_user_id == DBMessage.sender_id))
        .where(DBMessage.receiver_id == user_id, or_(DBMessage.message_status.is_(None), DBMessage.message_status != "read"),
               DBMessage.id > func.coalesce(DBClearedChat.cleared_up_to_id, 0),
               ~exists().where(DBMutedUser.user_id == user_id, DBMutedUser.muted_user_id == DBMessage.sender_id),
               ~exists().where(DBBlockedUser.user_id == user_id, DBBlockedUser.blocked_user_id == DBMessage.sender_id))
    )
    me, me_rows, number_rows, unread_rows, post_rows, people_rows = await asyncio.gather(
        hub_identity(user_id),
        fetch_one_off(select(DBUser.skills, DBUser.bio, DBUser.email, DBUser.account_status, DBUser.digest_on,
                             (func.length(func.coalesce(DBUser.profile_pic, "")) > 0).label("has_photo")).where(DBUser.id == user_id)),
        fetch_one_off(numbers),
        fetch_one_off(unread),
        fetch_one_off(board_posts_query(user_id).limit(80)),
        fetch_one_off(person_cards_query(user_id, DBUser.id.not_in(i_follow)).order_by(DBUser.id.desc()).limit(200)),
    )
    row, counts = me_rows[0], number_rows[0]
    (needs, news), study, practice, progress, prep = await asyncio.gather(
        home_hub_items(me, today) if me["role"] != "none" else asyncio.sleep(0, ([], [])),
        home_study(user_id),
        practice_glance(user_id),
        progress_glance(user_id),
        prep_glance(user_id),
    )
    needs = study["needs"] + needs

    unread_count, unread_people = unread_rows[0][0] or 0, unread_rows[0][1] or 0
    if unread_count:
        needs.insert(0, home_item("message", f"{unread_count} unread {'message' if unread_count == 1 else 'messages'}",
                                  f"From {unread_people} {'person' if unread_people == 1 else 'people'}.", "inbox.html"))
    if counts.applicants:
        news.append(home_item("applicants", f"{counts.applicants} {'person' if counts.applicants == 1 else 'people'} applied to your posts this week",
                              "See who they are on the Opportunities board.", "board.html"))
    needs.sort(key=lambda item: (not item["urgent"], item["due"] or "9999"))

    # Opportunities: the ones that ask for a skill I list come first, the newest fill the rest
    my_skills = skill_keys(row.skills)
    opportunities, challenges = [], []
    for post in post_rows:
        card = board_card(post)
        if card["author_id"] == user_id or card["has_applied"]:
            continue
        match = [skill.strip() for skill in card["skills_required"].split(",") if skill.strip().lower() in my_skills]
        if card["is_sponsored"] and (not card["deadline"] or card["deadline"] >= today.isoformat()) and not card["winners_announced"]:
            challenges.append(home_opportunity(card, match))
        else:
            opportunities.append(home_opportunity(card, match))
    opportunities.sort(key=lambda card: (-len(card["match"]), -card["id"]))

    # People: same college, skills in common, or already following me
    my_college = college_key_of(me["college"])
    people = []
    for person_row in people_rows:
        card = person_card(person_row)
        card["same_college"] = bool(my_college) and college_key_of(card["college_name"]) == my_college
        card["shared_skills"] = [skill.strip() for skill in (card["skills"] or "").split(",") if skill.strip().lower() in my_skills][:3]
        card["score"] = 3 * card["same_college"] + len(card["shared_skills"]) + 2 * card["follows_me"]
        people.append(card)
    people.sort(key=lambda card: (-card["score"], -card["id"]))
    suggested = [card for card in people if card["score"] > 0][:HOME_PEOPLE] or people[:3]

    skills_listed = len(my_skills)
    checklist = [
        {"key": "photo", "label": "Add a profile photo", "link": "profile.html", "done": bool(row.has_photo)},
        {"key": "bio", "label": "Write a line about yourself", "link": "profile.html", "done": bool((row.bio or "").strip())},
        {"key": "skills", "label": f"List {HOME_SKILL_GOAL} skills", "link": "profile.html", "done": skills_listed >= HOME_SKILL_GOAL,
         "progress": f"{min(skills_listed, HOME_SKILL_GOAL)} of {HOME_SKILL_GOAL}"},
        {"key": "follow", "label": f"Follow {HOME_FOLLOW_GOAL} people", "link": "search.html", "done": counts.following >= HOME_FOLLOW_GOAL,
         "progress": f"{min(counts.following, HOME_FOLLOW_GOAL)} of {HOME_FOLLOW_GOAL}"},
        {"key": "team", "label": "Join or start a team", "link": "team.html", "done": counts.teams > 0},
    ]
    return {
        "me": {"name": me["name"], "role": me["role"], "college": me["college"], "account_status": row.account_status or "",
               "has_email": bool((row.email or "").strip()), "digest_on": (row.digest_on if row.digest_on is not None else 1) == 1},
        "today": today.isoformat(),
        "needs": needs, "news": news,
        "classes": study["classes"],
        "opportunities": opportunities[:HOME_OPPORTUNITIES], "challenges": challenges[:HOME_CHALLENGES],
        "people": suggested,
        "week": {"profile_views": counts.profile_views or 0, "new_followers": counts.new_followers or 0,
                 "applications": counts.applications or 0, "unread": unread_count,
                 "study_minutes": study["week_minutes"], "study_streak": study["streak"]},
        "practice": practice,
        "progress": {key: progress[key] for key in ("goal", "xp_today", "goal_met", "streak", "week_xp", "focus_today", "freezes", "paid")},
        "prep": prep,
        "studying_now": studying_count(college_key_of(me["college"]), user_id),
        "checklist": [] if all(step["done"] for step in checklist) else checklist,
        "push": {"available": bool(VAPID_PUBLIC), "devices": counts.devices or 0},
        "email_ready": bool(SMTP_HOST),
        "online_user_ids": all_online_user_ids(),
    }


@app.get("/api/home")
async def get_home(current_user_id: int = Depends(get_current_user_id)):
    """Everything the Home page shows, in one request."""
    return await build_home(current_user_id)


class HomeSettings(BaseModel):
    digest: Optional[bool] = None
    email: Optional[str] = None

@app.post("/api/home/settings")
async def save_home_settings(body: HomeSettings, current_user_id: int = Depends(get_current_user_id)):
    """The weekly email switch, and an email address for an account that has none yet."""
    values = {}
    if body.digest is not None:
        values["digest_on"] = 1 if body.digest else 0
    if body.email is not None:
        email = body.email.strip().lower()
        if len(email) > 254 or not EMAIL_PATTERN.match(email):
            raise HTTPException(status_code=400, detail="Enter a valid email address.")
        rows = await fetch_one_off(select(DBUser.email, exists().where(func.lower(DBUser.email) == email, DBUser.id != current_user_id)).where(DBUser.id == current_user_id))
        if not rows:
            raise HTTPException(status_code=401, detail="User account no longer exists.")
        if (rows[0][0] or "").strip():
            raise HTTPException(status_code=400, detail="Your account already has an email address.")
        if rows[0][1]:
            raise HTTPException(status_code=400, detail="That email address is used by another account.")
        values["email"] = email
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    try:
        await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(**values))
    except Exception:
        raise HTTPException(status_code=400, detail="That email address is used by another account.")
    return {"digest_on": values.get("digest_on"), "has_email": True if "email" in values else None}


# ---------- push: the server's key, the message format (RFC 8291), sending ----------
VAPID_KEY_FILE = os.path.join("private_uploads", "vapid_private.pem")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:noreply@connect2minds.invalid")
# The only places a push may be sent to: the push services of the browsers. Anything else is refused,
# so a made-up subscription cannot make this server call an address of someone's choosing.
PUSH_HOSTS = ("fcm.googleapis.com", ".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com")
PUSH_TITLES = {"message": "New message", "view": "Someone looked at your profile", "college": "College Hub",
               "board_reply": "Opportunities", "account": "Your account", "study": "My Study"}
PUSH_MESSAGE_GAP = 300        # seconds between two "new message" pushes about the same conversation

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

def load_vapid_key():
    """This server's key pair for Web Push: VAPID_PRIVATE_KEY (PEM) if set, else a key made once and kept in private_uploads."""
    try:
        pem = os.getenv("VAPID_PRIVATE_KEY", "").replace("\\n", "\n").encode()
        if not pem and os.path.exists(VAPID_KEY_FILE):
            with open(VAPID_KEY_FILE, "rb") as key_file:
                pem = key_file.read()
        if pem:
            return serialization.load_pem_private_key(pem, password=None)
        key = ec.generate_private_key(ec.SECP256R1())
        os.makedirs(os.path.dirname(VAPID_KEY_FILE), exist_ok=True)
        with open(VAPID_KEY_FILE, "wb") as key_file:
            key_file.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        return key
    except Exception as e:
        print("Push notifications are off:", e)
        return None

def raw_public_key(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)

VAPID_KEY = load_vapid_key()
VAPID_PUBLIC = b64url(raw_public_key(VAPID_KEY)) if VAPID_KEY else ""

def push_endpoint_ok(endpoint: str) -> bool:
    try:
        parts = urlparse(endpoint)
    except ValueError:
        return False
    host = parts.hostname or ""
    return parts.scheme == "https" and any(host == allowed or (allowed.startswith(".") and host.endswith(allowed)) for allowed in PUSH_HOSTS)

def encrypt_push(payload: bytes, p256dh: str, auth: str) -> bytes:
    """The body of a push message, encrypted for one browser (aes128gcm, RFC 8291)."""
    browser_public = b64url_decode(p256dh)
    sender = ec.generate_private_key(ec.SECP256R1())
    sender_public = raw_public_key(sender)
    shared = sender.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), browser_public))
    secret = HKDF(hashes.SHA256(), 32, b64url_decode(auth), b"WebPush: info\x00" + browser_public + sender_public).derive(shared)
    salt = os.urandom(16)
    content_key = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(secret)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(secret)
    return salt + struct.pack(">IB", 4096, len(sender_public)) + sender_public + AESGCM(content_key).encrypt(nonce, payload + b"\x02", None)

def vapid_header(endpoint: str) -> str:
    parts = urlparse(endpoint)
    claims = {"aud": f"{parts.scheme}://{parts.netloc}", "exp": int(datetime.now(timezone.utc).timestamp()) + 12 * 3600, "sub": VAPID_SUBJECT}
    return f"vapid t={jwt.encode(claims, VAPID_KEY, algorithm='ES256')}, k={VAPID_PUBLIC}"

async def send_push(user_ids: list, payload: dict) -> int:
    """Send one notification to every device of these people. Devices the push service no longer knows are forgotten."""
    if not VAPID_KEY or not user_ids:
        return 0
    rows = await fetch_one_off(select(DBPushSubscription.id, DBPushSubscription.endpoint, DBPushSubscription.p256dh, DBPushSubscription.auth)
                               .where(DBPushSubscription.user_id.in_(user_ids)).limit(3000))
    if not rows:
        return 0
    body, gone, sent = json.dumps(payload).encode(), [], 0
    async with httpx.AsyncClient(timeout=10) as client:
        async def deliver(row) -> bool:
            try:
                answer = await client.post(row.endpoint, content=encrypt_push(body, row.p256dh, row.auth), headers={
                    "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "normal",
                    "Authorization": vapid_header(row.endpoint)})
            except Exception as e:
                print("Push could not be sent:", e)
                return False
            if answer.status_code in (404, 410):
                gone.append(row.id)
            elif answer.status_code >= 300:
                print("Push refused:", answer.status_code, answer.text[:200])
            return answer.status_code < 300
        sent = sum(await asyncio.gather(*(deliver(row) for row in rows)))
    if gone:
        await run_one_off(delete(DBPushSubscription).where(DBPushSubscription.id.in_(gone)))
    return sent

push_users: Optional[set] = None    # ids of people with at least one device, so everyone else costs no database read
push_recent: dict = {}              # (user, link) -> when a "new message" push last went out

async def push_notify(user_ids, notif_type: str, content: str, link: str):
    """A bell notification, also sent to the devices of people who do not have the site open. Meant to run in the background."""
    global push_users
    try:
        if not VAPID_KEY:
            return
        if push_users is None:
            push_users = {row[0] for row in await fetch_one_off(select(DBPushSubscription.user_id).distinct())}
        away = [user_id for user_id in user_ids
                if user_id in push_users and not notification_manager.is_online(user_id) and not chat_manager.is_online(user_id)]
        if notif_type == "message":
            now = datetime.now(timezone.utc).timestamp()
            away = [user_id for user_id in away if now - push_recent.get((user_id, link), 0) > PUSH_MESSAGE_GAP]
            if len(push_recent) > 20000:
                push_recent.clear()
            for user_id in away:
                push_recent[(user_id, link)] = now
            content = "You have a new message."
        if away:
            await send_push(away, {"title": PUSH_TITLES.get(notif_type, "Connect2Minds"), "body": (content or "")[:180],
                                   "link": link or "home.html", "tag": f"{notif_type}:{link}"})
    except Exception as e:
        print("Error sending a push notification:", e)


class PushSubscribeBody(BaseModel):
    endpoint: str
    keys: dict

class PushEndpointBody(BaseModel):
    endpoint: str

@app.get("/api/push/key")
async def get_push_key(current_user_id: int = Depends(get_current_user_id)):
    return {"key": VAPID_PUBLIC}

@app.post("/api/push/subscribe")
async def push_subscribe(body: PushSubscribeBody, current_user_id: int = Depends(get_current_user_id)):
    """Remember this browser. A browser belongs to whoever switched notifications on in it last."""
    if not VAPID_KEY:
        raise HTTPException(status_code=503, detail="Notifications are not set up on this server.")
    p256dh, auth = str(body.keys.get("p256dh") or ""), str(body.keys.get("auth") or "")
    try:
        valid = len(b64url_decode(p256dh)) == 65 and len(b64url_decode(auth)) == 16
    except Exception:
        valid = False
    if not valid or len(body.endpoint) > 1000 or not push_endpoint_ok(body.endpoint):
        raise HTTPException(status_code=400, detail="This browser's notification address was not accepted.")
    await run_one_off(
        pg_insert(DBPushSubscription).values(user_id=current_user_id, endpoint=body.endpoint, p256dh=p256dh, auth=auth, created_at=utc_now_iso())
        .on_conflict_do_update(index_elements=["endpoint"], set_={"user_id": current_user_id, "p256dh": p256dh, "auth": auth})
    )
    if push_users is not None:
        push_users.add(current_user_id)
    return {"subscribed": True}

@app.post("/api/push/unsubscribe")
async def push_unsubscribe(body: PushEndpointBody, current_user_id: int = Depends(get_current_user_id)):
    await run_one_off(delete(DBPushSubscription).where(DBPushSubscription.endpoint == body.endpoint, DBPushSubscription.user_id == current_user_id))
    return {"subscribed": False}

push_test_at: dict = {}

@app.post("/api/push/test")
async def push_test(current_user_id: int = Depends(get_current_user_id)):
    """Send a test notification to the caller's own devices."""
    now = datetime.now(timezone.utc).timestamp()
    if now - push_test_at.get(current_user_id, 0) < 20:
        raise HTTPException(status_code=429, detail="Wait a few seconds before sending another test.")
    push_test_at[current_user_id] = now
    sent = await send_push([current_user_id], {"title": "Connect2Minds", "body": "Notifications are on. This is what one looks like.",
                                               "link": "home.html", "tag": "test"})
    return {"sent": sent}


# ---------- the weekly email ----------
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587") or 587)
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER
SITE_URL = os.getenv("SITE_URL", "http://127.0.0.1:5500").rstrip("/")
API_URL = os.getenv("API_URL", "http://127.0.0.1:8000").rstrip("/")
DIGEST_EVERY_DAYS = 7
DIGEST_BATCH = 100

def digest_token(user_id: int) -> str:
    return hmac.new(SECRET_KEY.encode(), f"digest-off:{user_id}".encode(), "sha256").hexdigest()[:32]

def digest_lines(home: dict) -> list:
    """(text, page) pairs worth writing to someone about. Empty means: send nothing this week."""
    lines = [(item["title"], item["link"]) for item in (home["needs"] + home["news"])[:6]]
    matching = [card for card in home["opportunities"] + home["challenges"] if card["match"]]
    if matching:
        count = len(matching)
        lines.append((f"{count} {'opportunity matches' if count == 1 else 'opportunities match'} your skills, such as \"{matching[0]['title']}\"", "board.html"))
    week = home["week"]
    if week["profile_views"]:
        lines.append((f"{week['profile_views']} {'person' if week['profile_views'] == 1 else 'people'} looked at your profile this week", "profile.html"))
    if week["new_followers"]:
        lines.append((f"{week['new_followers']} new {'follower' if week['new_followers'] == 1 else 'followers'} this week", "network.html"))
    return lines

def digest_email(home: dict, user_id: int) -> Optional[tuple]:
    """(subject, plain text, HTML) of this week's email, or None when there is nothing to say."""
    lines = digest_lines(home)
    if not lines:
        return None
    first_name = (home["me"]["name"] or "there").split()[0]
    off_link = f"{API_URL}/api/digest/off?u={user_id}&t={digest_token(user_id)}"
    subject = f"{first_name}, {len(lines)} {'thing' if len(lines) == 1 else 'things'} for you on Connect2Minds"
    plain = "\n".join([f"Hi {first_name},", "", "Here is what is waiting for you:", ""]
                      + [f"- {line}\n  {SITE_URL}/{page}" for line, page in lines]
                      + ["", f"Open your Home page: {SITE_URL}/home.html", "", f"Stop these weekly emails: {off_link}"])
    rows = "".join(f'<li style="margin:0 0 10px;"><a href="{html.escape(f"{SITE_URL}/{page}")}" style="color:#3525cd;text-decoration:none;font-weight:600;">{html.escape(line)}</a></li>'
                   for line, page in lines)
    page_html = (f'<div style="font-family:Arial,sans-serif;color:#0b1c30;max-width:520px;margin:0 auto;padding:24px;">'
                 f'<h2 style="margin:0 0 6px;">Hi {html.escape(first_name)},</h2><p style="color:#464555;margin:0 0 18px;">Here is what is waiting for you on Connect2Minds.</p>'
                 f'<ul style="padding-left:18px;margin:0 0 22px;">{rows}</ul>'
                 f'<a href="{html.escape(SITE_URL)}/home.html" style="display:inline-block;background:#3525cd;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Open Home</a>'
                 f'<p style="color:#777587;font-size:12px;margin:26px 0 0;">You get this once a week. <a href="{html.escape(off_link)}" style="color:#777587;">Stop these emails</a>.</p></div>')
    return subject, plain, page_html

def send_email_now(to: str, subject: str, plain: str, page_html: str):
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = SMTP_FROM, to, subject
    message.set_content(plain)
    message.add_alternative(page_html, subtype="html")
    server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) if SMTP_PORT == 465 else smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)
    with server:
        if SMTP_PORT != 465:
            server.starttls()
        if SMTP_USER:
            server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(message)

async def digest_watch():
    """Every few hours: write to the people whose last weekly email is a week old. Does nothing until SMTP_HOST is set."""
    while True:
        full_batch = False
        try:
            if SMTP_HOST and SMTP_FROM:
                cutoff = (datetime.now(timezone.utc) - timedelta(days=DIGEST_EVERY_DAYS)).isoformat()
                due = await fetch_one_off(
                    select(DBUser.id, DBUser.email)
                    .where(func.coalesce(DBUser.digest_on, 1) == 1, DBUser.email.like("%@%"), func.coalesce(DBUser.last_digest_at, "") < cutoff,
                           visible_user_clause())
                    .order_by(DBUser.id).limit(DIGEST_BATCH))
                full_batch = len(due) == DIGEST_BATCH
                for user_id, email in due:
                    try:
                        mail = digest_email(await build_home(user_id), user_id)
                        if mail:
                            await asyncio.to_thread(send_email_now, email.strip(), *mail)
                    except Exception as e:
                        print("Weekly email failed for account", user_id, ":", e)
                    # Marked either way: a quiet week is checked again next week, not every few hours
                    await run_one_off(update(DBUser).where(DBUser.id == user_id).values(last_digest_at=utc_now_iso()))
                    await asyncio.sleep(1)
        except Exception as e:
            print("Error sending weekly emails:", e)
        await asyncio.sleep(600 if full_batch else 6 * 3600)


@app.get("/api/home/digest-preview")
async def digest_preview(current_user_id: int = Depends(get_current_user_id)):
    """This week's email for the caller, as it would be written now. Nothing is sent."""
    mail = digest_email(await build_home(current_user_id), current_user_id)
    return {"would_send": bool(mail), "subject": mail[0] if mail else "", "text": mail[1] if mail else "", "email_ready": bool(SMTP_HOST and SMTP_FROM)}

@app.get("/api/digest/off")
async def digest_off(u: int, t: str):
    """The 'stop these emails' link in the weekly email. Works without logging in; the link itself is the proof."""
    if not hmac.compare_digest(t.encode(), digest_token(u).encode()):
        raise HTTPException(status_code=400, detail="This link is not valid.")
    await run_one_off(update(DBUser).where(DBUser.id == u).values(digest_on=0))
    return HTMLResponse('<div style="font-family:Arial,sans-serif;max-width:460px;margin:80px auto;text-align:center;color:#0b1c30;">'
                        '<h2>Weekly emails are off</h2><p style="color:#464555;">You can switch them back on from your Home page.</p>'
                        f'<p><a href="{html.escape(SITE_URL)}/home.html" style="color:#3525cd;">Open Connect2Minds</a></p></div>')


# ==========================================
# 22. MY STUDY: TIMETABLE, ATTENDANCE, PLANNER, GRADES, FOCUS TIMER, REMINDERS
# ==========================================
# Everything here is private to one student: nobody else can read it. The one shared piece is a class
# timetable a teacher publishes, which students of that class copy into their own.
class DBStudySubject(Base):
    __tablename__ = "study_subjects"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    name = Column(String)
    code = Column(String, default="")
    credits = Column(Float, nullable=True)
    goal = Column(Integer, default=75)             # attendance the student wants to stay above, per cent
    base_attended = Column(Integer, default=0)     # classes before the student started marking here
    base_total = Column(Integer, default=0)
    archived = Column(Integer, default=0)
    created_at = Column(String)

class DBStudySlot(Base):
    """One class in the week."""
    __tablename__ = "study_slots"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    subject_id = Column(Integer, index=True)
    weekday = Column(Integer)                      # 0 = Monday
    start_time = Column(String)                    # HH:MM
    end_time = Column(String)
    room = Column(String, default="")
    kind = Column(String, default="lecture")       # lecture, lab, tutorial

class DBStudyAttendance(Base):
    __tablename__ = "study_attendance"
    __table_args__ = (UniqueConstraint("user_id", "subject_id", "date", "slot_id", name="ux_study_attendance"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    subject_id = Column(Integer, index=True)
    date = Column(String)                          # YYYY-MM-DD
    slot_id = Column(Integer, default=0)           # 0: an extra class that is not on the timetable
    status = Column(String)                        # present, absent, cancelled

class DBStudyTask(Base):
    __tablename__ = "study_tasks"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    subject_id = Column(Integer, nullable=True)
    title = Column(String)
    kind = Column(String, default="assignment")    # assignment, practical, exam, other
    due_date = Column(String, default="")
    due_time = Column(String, default="")
    notes = Column(String, default="")
    done = Column(Integer, default=0)
    done_at = Column(String, default="")
    created_at = Column(String)

class DBStudyGrade(Base):
    __tablename__ = "study_grades"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    semester = Column(Integer)
    subject = Column(String)
    credits = Column(Float)
    points = Column(Float)                         # grade point, 0 to 10
    grade = Column(String, default="")             # the letter, if the student typed one

class DBStudySession(Base):
    """One finished stretch of the focus timer."""
    __tablename__ = "study_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    subject_id = Column(Integer, nullable=True)
    day = Column(String, index=True)
    minutes = Column(Integer)
    created_at = Column(String)

class DBStudySetting(Base):
    __tablename__ = "study_settings"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, unique=True, index=True)
    target_cgpa = Column(Float, nullable=True)
    focus_minutes = Column(Integer, default=25)
    break_minutes = Column(Integer, default=5)
    remind_classes = Column(Integer, default=0)
    remind_tasks = Column(Integer, default=1)
    remind_practice = Column(Integer, default=1)
    xp_goal = Column(Integer, nullable=True)       # daily XP goal (section 32); empty = XP_DEFAULT_GOAL

class DBClassTimetableSlot(Base):
    """A teacher's classes for one class of a college, published for its students to copy."""
    __tablename__ = "class_timetable_slots"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    department = Column(String, index=True)        # lower-cased, like college_key
    division = Column(String, default="")
    teacher_id = Column(Integer, index=True)
    subject = Column(String)
    code = Column(String, default="")
    weekday = Column(Integer)
    start_time = Column(String)
    end_time = Column(String)
    room = Column(String, default="")
    kind = Column(String, default="lecture")

class DBStudyReminder(Base):
    """A reminder that has gone out, so the same one is never sent twice."""
    __tablename__ = "study_reminders"
    __table_args__ = (UniqueConstraint("user_id", "key", name="ux_study_reminders"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    key = Column(String)
    sent_at = Column(String)


STUDY_MAX_SUBJECTS = 40
STUDY_MAX_SLOTS = 120
STUDY_MAX_TASKS = 400
STUDY_MAX_SEMESTERS = 14
STUDY_MAX_SESSION_MINUTES = 180
STUDY_SLOT_KINDS = ("lecture", "lab", "tutorial")
STUDY_TASK_KINDS = ("assignment", "practical", "exam", "other")
STUDY_MARKS = ("present", "absent", "cancelled")
STUDY_MIN_CLASSES = 4          # an attendance warning needs at least this many classes to mean something
STUDY_STREAK_DAYS = 370
# The site's own clock for "today" and "now": India unless SITE_UTC_OFFSET_MINUTES says otherwise.
SITE_UTC_OFFSET = int(os.getenv("SITE_UTC_OFFSET_MINUTES", "330") or 330)

def site_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=SITE_UTC_OFFSET)

def attendance_state(present: int, absent: int, goal: int) -> dict:
    """Where a subject stands against its goal: how many more classes can be missed, or must be attended."""
    total = present + absent
    state = {"present": present, "total": total, "percent": round(present * 100 / total) if total else None, "can_miss": 0, "need": 0}
    if not total or goal <= 0:
        return state
    if present * 100 >= goal * total:
        state["can_miss"] = (present * 100 - goal * total) // goal
    elif goal < 100:
        state["need"] = -((present * 100 - goal * total) // (100 - goal))    # rounded up
    else:
        state["need"] = None       # 100% can no longer be reached
    return state

def day_streak(days: set, today) -> int:
    """Days in a row with something done, ending today (or yesterday, so the streak is not lost before tonight)."""
    day = today if today.isoformat() in days else today - timedelta(days=1)
    streak = 0
    while day.isoformat() in days:
        streak += 1
        day -= timedelta(days=1)
    return streak


class StudySubjectBody(BaseModel):
    name: str
    code: Optional[str] = ""
    credits: Optional[float] = None
    goal: Optional[int] = 75
    base_attended: Optional[int] = 0
    base_total: Optional[int] = 0
    archived: Optional[bool] = False

class StudySlotBody(BaseModel):
    subject_id: int
    weekday: int
    start_time: str
    end_time: str
    room: Optional[str] = ""
    kind: Optional[str] = "lecture"

class StudyMarkBody(BaseModel):
    subject_id: int
    date: str
    slot_id: Optional[int] = 0
    status: str                    # present, absent, cancelled, or "" to take the mark back

class StudyTaskBody(BaseModel):
    title: str
    kind: Optional[str] = "assignment"
    subject_id: Optional[int] = None
    due_date: Optional[str] = ""
    due_time: Optional[str] = ""
    notes: Optional[str] = ""
    done: Optional[bool] = False

class StudyGradeRow(BaseModel):
    subject: str
    credits: float
    points: float
    grade: Optional[str] = ""

class StudyGradesBody(BaseModel):
    rows: List[StudyGradeRow]

class StudySessionBody(BaseModel):
    minutes: int
    subject_id: Optional[int] = None

class StudySettingsBody(BaseModel):
    target_cgpa: Optional[float] = None
    clear_target: Optional[bool] = False
    focus_minutes: Optional[int] = None
    break_minutes: Optional[int] = None
    remind_classes: Optional[bool] = None
    remind_tasks: Optional[bool] = None
    remind_practice: Optional[bool] = None

class ClassPublishBody(BaseModel):
    department: str
    division: Optional[str] = ""


def subject_card(subject: DBStudySubject) -> dict:
    return {"id": subject.id, "name": subject.name or "", "code": subject.code or "", "credits": subject.credits,
            "goal": subject.goal if subject.goal is not None else 75, "base_attended": subject.base_attended or 0,
            "base_total": subject.base_total or 0, "archived": bool(subject.archived)}

def slot_card(slot) -> dict:
    return {"id": slot.id, "subject_id": slot.subject_id, "weekday": slot.weekday, "start_time": slot.start_time or "",
            "end_time": slot.end_time or "", "room": slot.room or "", "kind": slot.kind or "lecture"}

def task_card(task: DBStudyTask) -> dict:
    return {"id": task.id, "title": task.title or "", "kind": task.kind or "assignment", "subject_id": task.subject_id,
            "due_date": task.due_date or "", "due_time": task.due_time or "", "notes": task.notes or "",
            "done": bool(task.done), "done_at": task.done_at or ""}

def settings_card(row) -> dict:
    return {"target_cgpa": row.target_cgpa if row else None, "focus_minutes": (row.focus_minutes if row else None) or 25,
            "break_minutes": (row.break_minutes if row else None) or 5,
            "remind_classes": bool(row.remind_classes) if row else False,
            "remind_tasks": bool(row.remind_tasks) if row and row.remind_tasks is not None else True,
            "remind_practice": bool(row.remind_practice) if row and row.remind_practice is not None else True}

def clean_subject(body: StudySubjectBody) -> dict:
    goal = body.goal if body.goal is not None else 75
    attended, total = body.base_attended or 0, body.base_total or 0
    if not (0 <= goal <= 100):
        raise HTTPException(status_code=400, detail="The attendance goal is a percentage from 0 to 100.")
    if not (0 <= attended <= total <= 2000):
        raise HTTPException(status_code=400, detail="Classes attended so far cannot be more than classes held.")
    if body.credits is not None and not (0 <= body.credits <= 40):
        raise HTTPException(status_code=400, detail="Credits must be between 0 and 40.")
    return {"name": clean_required(body.name, 80, "subject name"), "code": clean_text(body.code, 20, "subject code"), "credits": body.credits,
            "goal": goal, "base_attended": attended, "base_total": total, "archived": 1 if body.archived else 0}

def clean_slot_times(weekday: int, start_time: str, end_time: str, kind: str):
    if not (0 <= weekday <= 6):
        raise HTTPException(status_code=400, detail="Pick a day of the week.")
    if not HUB_TIME_PATTERN.match(start_time or "") or not HUB_TIME_PATTERN.match(end_time or "") or start_time > "23:59" or end_time > "23:59":
        raise HTTPException(status_code=400, detail="Give the start and end time of the class.")
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="The class must end after it starts.")
    if kind not in STUDY_SLOT_KINDS:
        raise HTTPException(status_code=400, detail="A class is a lecture, a lab or a tutorial.")

async def require_own_subject(user_id: int, subject_id: int):
    rows = await fetch_one_off(select(DBStudySubject.id).where(DBStudySubject.id == subject_id, DBStudySubject.user_id == user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That subject is not in your list.")

def class_keys(me: dict) -> tuple:
    return college_key_of(me["department"]), college_key_of(me["division"])

def class_slots_query(key: str, department: str, division: str):
    """The published classes a student of this class should see: the ones for the whole department and for their division."""
    return select(DBClassTimetableSlot).where(DBClassTimetableSlot.college_key == key, DBClassTimetableSlot.department == department,
                                              DBClassTimetableSlot.division.in_(("", division)))


@app.get("/api/study")
async def get_study(current_user_id: int = Depends(get_current_user_id)):
    """Everything the My Study page shows, in one request. All of it belongs to the caller."""
    now = site_now()
    today = now.date()
    since = (today - timedelta(days=STUDY_STREAK_DAYS)).isoformat()
    devices = select(func.count()).select_from(DBPushSubscription).where(DBPushSubscription.user_id == current_user_id).scalar_subquery()
    me, setting_rows, subjects, slots, marks, tasks, grades, sessions = await asyncio.gather(
        hub_identity(current_user_id),
        fetch_one_off(select(devices)),
        fetch_one_off(select(DBStudySubject).where(DBStudySubject.user_id == current_user_id).order_by(DBStudySubject.name)),
        fetch_one_off(select(DBStudySlot).where(DBStudySlot.user_id == current_user_id).order_by(DBStudySlot.weekday, DBStudySlot.start_time)),
        fetch_one_off(select(DBStudyAttendance.subject_id, DBStudyAttendance.date, DBStudyAttendance.slot_id, DBStudyAttendance.status)
                      .where(DBStudyAttendance.user_id == current_user_id).order_by(DBStudyAttendance.date.desc()).limit(6000)),
        fetch_one_off(select(DBStudyTask).where(DBStudyTask.user_id == current_user_id).order_by(DBStudyTask.done, DBStudyTask.due_date, DBStudyTask.id).limit(STUDY_MAX_TASKS)),
        fetch_one_off(select(DBStudyGrade).where(DBStudyGrade.user_id == current_user_id).order_by(DBStudyGrade.semester, DBStudyGrade.id)),
        fetch_one_off(select(DBStudySession.day, DBStudySession.subject_id, func.sum(DBStudySession.minutes))
                      .where(DBStudySession.user_id == current_user_id, DBStudySession.day >= since).group_by(DBStudySession.day, DBStudySession.subject_id)),
    )
    # Second round: the settings row, and what the college adds for people who have one
    department, division = class_keys(me)
    in_hub = me["role"] != "none"
    student = me["role"] == "student"
    attended = func.sum(case((DBAttendanceMark.status.in_(("present", "late")), 1), else_=0))
    settings_rows, practice, hub, class_rows, official, class_list, mine_published = await asyncio.gather(
        fetch_one_off(select(DBStudySetting).where(DBStudySetting.user_id == current_user_id)),
        practice_glance(current_user_id),
        home_hub_items(me, datetime.now().date()) if in_hub else asyncio.sleep(0, ([], [])),
        fetch_one_off(class_slots_query(me["key"], department, division)) if student and department else asyncio.sleep(0, []),
        fetch_one_off(select(func.count(), attended).select_from(DBAttendanceMark)
                      .join(DBAttendanceSession, DBAttendanceSession.id == DBAttendanceMark.session_id)
                      .where(DBAttendanceSession.college_key == me["key"], DBAttendanceMark.user_id == current_user_id)) if student else asyncio.sleep(0, []),
        fetch_one_off(select(func.trim(DBUser.department), func.trim(func.coalesce(DBUser.division, ""))).where(hub_student_clause(me["key"]), func.trim(func.coalesce(DBUser.department, "")) != "")
                      .distinct().limit(300)) if me["role"] == "teacher" else asyncio.sleep(0, []),
        fetch_one_off(select(DBClassTimetableSlot.department, DBClassTimetableSlot.division, func.count())
                      .where(DBClassTimetableSlot.teacher_id == current_user_id).group_by(DBClassTimetableSlot.department, DBClassTimetableSlot.division)) if me["role"] == "teacher" else asyncio.sleep(0, []),
    )

    counts: dict = {}
    for subject_id, _, _, mark in marks:
        counts.setdefault(subject_id, {"present": 0, "absent": 0, "cancelled": 0})[mark] = counts.get(subject_id, {}).get(mark, 0) + 1
    recent_from = (today - timedelta(days=45)).isoformat()
    by_day: dict = {}
    by_subject: dict = {}
    week_from = (today - timedelta(days=6)).isoformat()
    for day, subject_id, minutes in sessions:
        by_day[day] = by_day.get(day, 0) + int(minutes or 0)
        if day >= week_from:
            by_subject[str(subject_id or 0)] = by_subject.get(str(subject_id or 0), 0) + int(minutes or 0)
    official_total, official_came = (official[0][0] or 0, official[0][1] or 0) if official else (0, 0)
    teachers = {row.teacher_id for (row,) in class_rows}
    return {
        "me": {"role": me["role"], "college": me["college"], "department": me["department"], "division": me["division"]},
        "today": today.isoformat(), "weekday": today.weekday(), "now": now.strftime("%H:%M"),
        "settings": settings_card(settings_rows[0][0] if settings_rows else None),
        "push_devices": setting_rows[0][0] or 0,
        "subjects": [{**subject_card(subject), **counts.get(subject.id, {"present": 0, "absent": 0, "cancelled": 0})} for (subject,) in subjects],
        "slots": [slot_card(slot) for (slot,) in slots],
        "marks": [{"subject_id": subject_id, "date": date, "slot_id": slot_id or 0, "status": mark} for subject_id, date, slot_id, mark in marks if date >= recent_from],
        "tasks": [task_card(task) for (task,) in tasks],
        "hub_deadlines": [item for item in hub[0] if item["kind"] in ("work", "group", "checkin", "ack", "poll")],
        "grades": [{"id": grade.id, "semester": grade.semester, "subject": grade.subject or "", "credits": grade.credits or 0,
                    "points": grade.points or 0, "grade": grade.grade or ""} for (grade,) in grades],
        "timer": {"by_day": {day: minutes for day, minutes in by_day.items() if day >= (today - timedelta(days=34)).isoformat()},
                  "week_by_subject": by_subject, "streak": day_streak(set(by_day), today), "today": by_day.get(today.isoformat(), 0)},
        "class_timetable": {"slots": len(class_rows), "teachers": len(teachers)},
        "practice": practice,
        "official_attendance": {"total": official_total, "attended": official_came} if official_total else None,
        "teacher": {"classes": sorted({(dept, div) for dept, div in class_list}),
                    "published": [{"department": dept, "division": div, "slots": count} for dept, div, count in mine_published]} if me["role"] == "teacher" else None,
    }


# ---------- subjects and the timetable ----------
@app.post("/api/study/subjects")
async def create_study_subject(body: StudySubjectBody, current_user_id: int = Depends(get_current_user_id)):
    values = clean_subject(body)
    existing = await fetch_one_off(select(func.count()).select_from(DBStudySubject).where(DBStudySubject.user_id == current_user_id))
    if existing[0][0] >= STUDY_MAX_SUBJECTS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {STUDY_MAX_SUBJECTS} subjects. Remove an old one first.")
    rows = await run_returning(DBStudySubject.__table__.insert().values(user_id=current_user_id, created_at=utc_now_iso(), **values).returning(DBStudySubject.id))
    return {"id": rows[0][0], **values, "archived": bool(values["archived"]), "present": 0, "absent": 0, "cancelled": 0}

@app.put("/api/study/subjects/{subject_id}")
async def update_study_subject(subject_id: int, body: StudySubjectBody, current_user_id: int = Depends(get_current_user_id)):
    values = clean_subject(body)
    rows = await run_returning(update(DBStudySubject).where(DBStudySubject.id == subject_id, DBStudySubject.user_id == current_user_id).values(**values).returning(DBStudySubject.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That subject is not in your list.")
    return {"id": subject_id, **values, "archived": bool(values["archived"])}

@app.delete("/api/study/subjects/{subject_id}")
async def delete_study_subject(subject_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Removes a subject with its classes and attendance. Its tasks stay, without a subject."""
    rows = await run_returning(delete(DBStudySubject).where(DBStudySubject.id == subject_id, DBStudySubject.user_id == current_user_id).returning(DBStudySubject.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That subject is not in your list.")
    await asyncio.gather(
        run_one_off(delete(DBStudySlot).where(DBStudySlot.subject_id == subject_id, DBStudySlot.user_id == current_user_id)),
        run_one_off(delete(DBStudyAttendance).where(DBStudyAttendance.subject_id == subject_id, DBStudyAttendance.user_id == current_user_id)),
        run_one_off(update(DBStudyTask).where(DBStudyTask.subject_id == subject_id, DBStudyTask.user_id == current_user_id).values(subject_id=None)),
        run_one_off(update(DBStudySession).where(DBStudySession.subject_id == subject_id, DBStudySession.user_id == current_user_id).values(subject_id=None)),
    )
    return {"deleted": subject_id}

def clean_slot(body: StudySlotBody) -> dict:
    kind = body.kind or "lecture"
    clean_slot_times(body.weekday, body.start_time, body.end_time, kind)
    return {"subject_id": body.subject_id, "weekday": body.weekday, "start_time": body.start_time, "end_time": body.end_time,
            "room": clean_text(body.room, 40, "room"), "kind": kind}

@app.post("/api/study/slots")
async def create_study_slot(body: StudySlotBody, current_user_id: int = Depends(get_current_user_id)):
    values = clean_slot(body)
    await require_own_subject(current_user_id, body.subject_id)
    existing = await fetch_one_off(select(func.count()).select_from(DBStudySlot).where(DBStudySlot.user_id == current_user_id))
    if existing[0][0] >= STUDY_MAX_SLOTS:
        raise HTTPException(status_code=400, detail="Your timetable is full. Remove a class first.")
    rows = await run_returning(DBStudySlot.__table__.insert().values(user_id=current_user_id, **values).returning(DBStudySlot.id))
    return {"id": rows[0][0], **values}

@app.put("/api/study/slots/{slot_id}")
async def update_study_slot(slot_id: int, body: StudySlotBody, current_user_id: int = Depends(get_current_user_id)):
    values = clean_slot(body)
    await require_own_subject(current_user_id, body.subject_id)
    rows = await run_returning(update(DBStudySlot).where(DBStudySlot.id == slot_id, DBStudySlot.user_id == current_user_id).values(**values).returning(DBStudySlot.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That class is not on your timetable.")
    return {"id": slot_id, **values}

@app.delete("/api/study/slots/{slot_id}")
async def delete_study_slot(slot_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Takes a class off the timetable. Attendance already marked for it is kept."""
    rows = await run_returning(delete(DBStudySlot).where(DBStudySlot.id == slot_id, DBStudySlot.user_id == current_user_id).returning(DBStudySlot.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That class is not on your timetable.")
    return {"deleted": slot_id}


# ---------- attendance ----------
@app.post("/api/study/attendance")
async def mark_study_attendance(body: StudyMarkBody, current_user_id: int = Depends(get_current_user_id)):
    """One tap: present, absent or cancelled for one class on one day. An empty status takes the mark back."""
    today = site_now().date()
    if not HUB_DATE_PATTERN.match(body.date or "") or body.date > today.isoformat() or body.date < (today - timedelta(days=366)).isoformat():
        raise HTTPException(status_code=400, detail="Attendance can be marked for today or a past day.")
    slot_id = body.slot_id or 0
    mine = (DBStudyAttendance.user_id == current_user_id, DBStudyAttendance.subject_id == body.subject_id,
            DBStudyAttendance.date == body.date, DBStudyAttendance.slot_id == slot_id)
    if body.status == "":
        await run_one_off(delete(DBStudyAttendance).where(*mine))
        return {"subject_id": body.subject_id, "date": body.date, "slot_id": slot_id, "status": ""}
    if body.status not in STUDY_MARKS:
        raise HTTPException(status_code=400, detail="A class is present, absent or cancelled.")
    # Written only if the subject is the caller's own: the row is built from the subject itself
    source = select(literal(current_user_id), DBStudySubject.id, literal(body.date), literal(slot_id), literal(body.status)).where(
        DBStudySubject.id == body.subject_id, DBStudySubject.user_id == current_user_id)
    rows = await run_returning(
        pg_insert(DBStudyAttendance).from_select(["user_id", "subject_id", "date", "slot_id", "status"], source)
        .on_conflict_do_update(index_elements=["user_id", "subject_id", "date", "slot_id"], set_={"status": body.status})
        .returning(DBStudyAttendance.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That subject is not in your list.")
    return {"subject_id": body.subject_id, "date": body.date, "slot_id": slot_id, "status": body.status}


# ---------- planner ----------
async def clean_task(body: StudyTaskBody, user_id: int) -> dict:
    kind = body.kind or "assignment"
    if kind not in STUDY_TASK_KINDS:
        raise HTTPException(status_code=400, detail="Pick what kind of work this is.")
    due_date, due_time = (body.due_date or "").strip(), (body.due_time or "").strip()
    if due_date and not HUB_DATE_PATTERN.match(due_date):
        raise HTTPException(status_code=400, detail="Pick the date from the calendar.")
    if due_time and (not HUB_TIME_PATTERN.match(due_time) or not due_date):
        raise HTTPException(status_code=400, detail="A time needs a date with it.")
    if body.subject_id:
        await require_own_subject(user_id, body.subject_id)
    return {"title": clean_required(body.title, 140, "title"), "kind": kind, "subject_id": body.subject_id or None, "due_date": due_date,
            "due_time": due_time, "notes": clean_text(body.notes, 1000, "note"), "done": 1 if body.done else 0,
            "done_at": utc_now_iso() if body.done else ""}

@app.post("/api/study/tasks")
async def create_study_task(body: StudyTaskBody, current_user_id: int = Depends(get_current_user_id)):
    values = await clean_task(body, current_user_id)
    existing = await fetch_one_off(select(func.count()).select_from(DBStudyTask).where(DBStudyTask.user_id == current_user_id))
    if existing[0][0] >= STUDY_MAX_TASKS:
        raise HTTPException(status_code=400, detail="Your planner is full. Remove finished work first.")
    rows = await run_returning(DBStudyTask.__table__.insert().values(user_id=current_user_id, created_at=utc_now_iso(), **values).returning(DBStudyTask.id))
    return {"id": rows[0][0], **values, "done": bool(values["done"])}

@app.put("/api/study/tasks/{task_id}")
async def update_study_task(task_id: int, body: StudyTaskBody, current_user_id: int = Depends(get_current_user_id)):
    values = await clean_task(body, current_user_id)
    rows = await run_returning(update(DBStudyTask).where(DBStudyTask.id == task_id, DBStudyTask.user_id == current_user_id).values(**values).returning(DBStudyTask.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That is not in your planner.")
    return {"id": task_id, **values, "done": bool(values["done"])}

@app.delete("/api/study/tasks/{task_id}")
async def delete_study_task(task_id: int, current_user_id: int = Depends(get_current_user_id)):
    rows = await run_returning(delete(DBStudyTask).where(DBStudyTask.id == task_id, DBStudyTask.user_id == current_user_id).returning(DBStudyTask.id))
    if not rows:
        raise HTTPException(status_code=404, detail="That is not in your planner.")
    return {"deleted": task_id}


# ---------- grades ----------
@app.put("/api/study/grades/{semester}")
async def save_study_grades(semester: int, body: StudyGradesBody, current_user_id: int = Depends(get_current_user_id)):
    """Replaces one semester's subjects. An empty list removes the semester."""
    if not (1 <= semester <= STUDY_MAX_SEMESTERS):
        raise HTTPException(status_code=400, detail=f"Semesters are numbered 1 to {STUDY_MAX_SEMESTERS}.")
    if len(body.rows) > 20:
        raise HTTPException(status_code=400, detail="A semester holds up to 20 subjects.")
    rows = []
    for row in body.rows:
        if not (0 < row.credits <= 40):
            raise HTTPException(status_code=400, detail="Every subject needs its credits (more than 0).")
        if not (0 <= row.points <= 10):
            raise HTTPException(status_code=400, detail="Grade points go from 0 to 10.")
        rows.append({"user_id": current_user_id, "semester": semester, "subject": clean_required(row.subject, 80, "subject name"),
                     "credits": row.credits, "points": row.points, "grade": clean_text(row.grade, 4, "grade")})
    async with AutocommitSession() as db:
        await db.execute(delete(DBStudyGrade).where(DBStudyGrade.user_id == current_user_id, DBStudyGrade.semester == semester))
        if rows:
            await db.execute(DBStudyGrade.__table__.insert().values(rows))
    return {"semester": semester, "rows": [{key: row[key] for key in ("subject", "credits", "points", "grade")} for row in rows]}


# ---------- focus timer ----------
@app.post("/api/study/sessions")
async def log_study_session(body: StudySessionBody, current_user_id: int = Depends(get_current_user_id)):
    """A finished stretch of the timer. Counts for today on the site's clock."""
    if not (1 <= body.minutes <= STUDY_MAX_SESSION_MINUTES):
        raise HTTPException(status_code=400, detail=f"One sitting is 1 to {STUDY_MAX_SESSION_MINUTES} minutes.")
    if body.subject_id:
        await require_own_subject(current_user_id, body.subject_id)
    day = site_now().date().isoformat()
    saved = await run_returning(DBStudySession.__table__.insert().values(user_id=current_user_id, subject_id=body.subject_id or None, day=day,
                                                                         minutes=body.minutes, created_at=utc_now_iso()).returning(DBStudySession.id))
    xp = await award_xp(current_user_id, "focus", f"s{saved[0][0]}", body.minutes // XP_FOCUS_MINUTES_PER_POINT)
    return {"day": day, "minutes": body.minutes, "subject_id": body.subject_id or None, "xp": xp}


@app.put("/api/study/settings")
async def save_study_settings(body: StudySettingsBody, current_user_id: int = Depends(get_current_user_id)):
    values = {}
    if body.clear_target:
        values["target_cgpa"] = None
    elif body.target_cgpa is not None:
        if not (0 < body.target_cgpa <= 10):
            raise HTTPException(status_code=400, detail="A target CGPA is between 0 and 10.")
        values["target_cgpa"] = body.target_cgpa
    for field, low, high in (("focus_minutes", 5, 120), ("break_minutes", 1, 60)):
        value = getattr(body, field)
        if value is not None:
            if not (low <= value <= high):
                raise HTTPException(status_code=400, detail=f"That length must be between {low} and {high} minutes.")
            values[field] = value
    for field in ("remind_classes", "remind_tasks", "remind_practice"):
        if getattr(body, field) is not None:
            values[field] = 1 if getattr(body, field) else 0
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    await run_one_off(pg_insert(DBStudySetting).values(user_id=current_user_id, **values).on_conflict_do_update(index_elements=["user_id"], set_=values))
    rows = await fetch_one_off(select(DBStudySetting).where(DBStudySetting.user_id == current_user_id))
    return settings_card(rows[0][0])


# ---------- a class timetable: a teacher publishes theirs, students copy it ----------
@app.post("/api/study/class-timetable/publish")
async def publish_class_timetable(body: ClassPublishBody, current_user_id: int = Depends(get_current_user_id)):
    """Copies the teacher's own timetable to one class of their college, replacing what they published for it before."""
    me = await require_hub_teacher(current_user_id)
    department, division = clean_audience(body.department, body.division)
    if not department:
        raise HTTPException(status_code=400, detail="Pick the class this timetable is for.")
    rows = await fetch_one_off(select(DBStudySlot, DBStudySubject.name, DBStudySubject.code).join(DBStudySubject, DBStudySubject.id == DBStudySlot.subject_id)
                               .where(DBStudySlot.user_id == current_user_id))
    if not rows:
        raise HTTPException(status_code=400, detail="Add your classes to your own timetable first, then publish it.")
    department, division = college_key_of(department), college_key_of(division)
    copies = [{"college_key": me["key"], "department": department, "division": division, "teacher_id": current_user_id, "subject": name or "",
               "code": code or "", "weekday": slot.weekday, "start_time": slot.start_time, "end_time": slot.end_time, "room": slot.room or "",
               "kind": slot.kind or "lecture"} for slot, name, code in rows]
    async with AutocommitSession() as db:
        await db.execute(delete(DBClassTimetableSlot).where(DBClassTimetableSlot.teacher_id == current_user_id, DBClassTimetableSlot.college_key == me["key"],
                                                            DBClassTimetableSlot.department == department, DBClassTimetableSlot.division == division))
        await db.execute(DBClassTimetableSlot.__table__.insert().values(copies))
    return {"department": department, "division": division, "slots": len(copies)}

@app.post("/api/study/class-timetable/unpublish")
async def unpublish_class_timetable(body: ClassPublishBody, current_user_id: int = Depends(get_current_user_id)):
    await run_one_off(delete(DBClassTimetableSlot).where(DBClassTimetableSlot.teacher_id == current_user_id,
                                                         DBClassTimetableSlot.department == college_key_of(body.department),
                                                         DBClassTimetableSlot.division == college_key_of(body.division)))
    return {"slots": 0}

@app.post("/api/study/class-timetable/import")
async def import_class_timetable(current_user_id: int = Depends(get_current_user_id)):
    """Copies the classes teachers published for the caller's class into their own timetable. Running it again adds only what is new."""
    me = await hub_identity(current_user_id)
    department, division = class_keys(me)
    if me["role"] != "student" or not department:
        raise HTTPException(status_code=400, detail="A class timetable is for students with a college and department on their profile.")
    published, subjects, slots = await asyncio.gather(
        fetch_one_off(class_slots_query(me["key"], department, division)),
        fetch_one_off(select(DBStudySubject.id, DBStudySubject.name).where(DBStudySubject.user_id == current_user_id)),
        fetch_one_off(select(DBStudySlot.subject_id, DBStudySlot.weekday, DBStudySlot.start_time).where(DBStudySlot.user_id == current_user_id)),
    )
    if not published:
        raise HTTPException(status_code=404, detail="No teacher has published a timetable for your class yet.")
    subject_ids = {(name or "").strip().lower(): subject_id for subject_id, name in subjects}
    new_names = list(dict.fromkeys(row.subject.strip() for (row,) in published if row.subject.strip().lower() not in subject_ids))
    if len(subject_ids) + len(new_names) > STUDY_MAX_SUBJECTS:
        raise HTTPException(status_code=400, detail="There is no room for these subjects. Remove old ones first.")
    codes = {row.subject.strip().lower(): row.code or "" for (row,) in published}
    if new_names:
        created = await run_returning(DBStudySubject.__table__.insert().values([
            {"user_id": current_user_id, "name": name, "code": codes.get(name.lower(), ""), "goal": 75, "base_attended": 0, "base_total": 0,
             "archived": 0, "created_at": utc_now_iso()} for name in new_names]).returning(DBStudySubject.id, DBStudySubject.name))
        subject_ids.update({name.strip().lower(): subject_id for subject_id, name in created})
    have = {(subject_id, weekday, start_time) for subject_id, weekday, start_time in slots}
    fresh = []
    for (row,) in published:
        subject_id = subject_ids[row.subject.strip().lower()]
        if (subject_id, row.weekday, row.start_time) not in have:
            have.add((subject_id, row.weekday, row.start_time))
            fresh.append({"user_id": current_user_id, "subject_id": subject_id, "weekday": row.weekday, "start_time": row.start_time,
                          "end_time": row.end_time, "room": row.room or "", "kind": row.kind or "lecture"})
    if len(slots) + len(fresh) > STUDY_MAX_SLOTS:
        raise HTTPException(status_code=400, detail="Your timetable is full. Remove a class first.")
    if fresh:
        await run_one_off(DBStudySlot.__table__.insert().values(fresh))
    return {"subjects_added": len(new_names), "classes_added": len(fresh)}


# ---------- what Home shows from all this, in one round trip ----------
STUDY_HOME_SQL = text("""
SELECT
  (SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'goal', coalesce(s.goal, 75),
       'base_attended', coalesce(s.base_attended, 0), 'base_total', coalesce(s.base_total, 0))), '[]')
     FROM study_subjects s WHERE s.user_id = :me AND coalesce(s.archived, 0) = 0) AS subjects,
  (SELECT coalesce(json_agg(json_build_object('id', l.id, 'subject_id', l.subject_id, 'start_time', l.start_time, 'end_time', l.end_time,
       'room', l.room, 'kind', l.kind) ORDER BY l.start_time), '[]')
     FROM study_slots l WHERE l.user_id = :me AND l.weekday = :weekday) AS slots,
  (SELECT coalesce(json_agg(json_build_array(a.subject_id, a.status, a.n)), '[]')
     FROM (SELECT subject_id, status, count(*) AS n FROM study_attendance WHERE user_id = :me GROUP BY subject_id, status) a) AS counts,
  (SELECT coalesce(json_agg(json_build_array(a.subject_id, a.slot_id, a.status)), '[]')
     FROM study_attendance a WHERE a.user_id = :me AND a.date = :today) AS marked,
  (SELECT coalesce(json_agg(json_build_object('id', t.id, 'title', t.title, 'kind', t.kind, 'due_date', t.due_date, 'due_time', t.due_time) ORDER BY t.due_date), '[]')
     FROM study_tasks t WHERE t.user_id = :me AND coalesce(t.done, 0) = 0 AND t.due_date <> '' AND t.due_date <= :soon AND t.due_date >= :floor) AS tasks,
  (SELECT coalesce(json_agg(json_build_array(d.day, d.minutes)), '[]')
     FROM (SELECT day, sum(minutes) AS minutes FROM study_sessions WHERE user_id = :me AND day >= :since GROUP BY day) d) AS days
""")

async def home_study(user_id: int) -> dict:
    """Today's classes, what is due, attendance warnings and the study streak, for Home and the reminders."""
    now = site_now()
    today = now.date()
    rows = await fetch_one_off(STUDY_HOME_SQL.bindparams(
        me=user_id, weekday=today.weekday(), today=today.isoformat(), soon=(today + timedelta(days=1)).isoformat(),
        floor=(today - timedelta(days=HOME_OVERDUE_DAYS)).isoformat(), since=(today - timedelta(days=STUDY_STREAK_DAYS)).isoformat()))
    subjects, slots, counts, marked, tasks, days = [json.loads(value) if isinstance(value, str) else (value or []) for value in rows[0]]
    names = {subject["id"]: subject for subject in subjects}
    marks = {(subject_id, slot_id): mark for subject_id, slot_id, mark in marked}
    clock = now.strftime("%H:%M")
    needs = []

    classes = [{"slot_id": slot["id"], "subject_id": slot["subject_id"], "subject": names[slot["subject_id"]]["name"], "start_time": slot["start_time"],
                "end_time": slot["end_time"], "room": slot["room"] or "", "kind": slot["kind"] or "lecture",
                "status": marks.get((slot["subject_id"], slot["id"]), "")} for slot in slots if slot["subject_id"] in names]
    unmarked = [entry for entry in classes if not entry["status"] and entry["end_time"] <= clock]
    if unmarked:
        needs.append(home_item("mark", f"Mark today's attendance ({len(unmarked)} {'class' if len(unmarked) == 1 else 'classes'})",
                               ", ".join(dict.fromkeys(entry["subject"] for entry in unmarked))[:120], "study.html?tab=attendance"))
    for task in tasks:
        late = task["due_date"] < today.isoformat()
        label = {"exam": "Exam", "practical": "Practical", "assignment": "Due", "other": "Due"}.get(task["kind"], "Due")
        needs.append(home_item("task", f"{'Overdue' if late else label}: {task['title']}", task["due_time"] or "", "study.html?tab=planner", task["due_date"], True))

    tally: dict = {}
    for subject_id, mark, count in counts:
        tally.setdefault(subject_id, {})[mark] = count
    for subject in subjects:
        own = tally.get(subject["id"], {})
        present = subject["base_attended"] + own.get("present", 0)
        absent = (subject["base_total"] - subject["base_attended"]) + own.get("absent", 0)
        state = attendance_state(present, absent, subject["goal"])
        if state["total"] >= STUDY_MIN_CLASSES and state["percent"] is not None and present * 100 < subject["goal"] * state["total"]:
            detail = (f"Attend the next {state['need']} {'class' if state['need'] == 1 else 'classes'} to reach {subject['goal']}%."
                      if state["need"] else f"{present} of {state['total']} classes.")
            needs.append(home_item("attendance", f"{subject['name']} attendance is {state['percent']}%", detail, "study.html?tab=attendance", urgent=True))

    minutes = {day: int(total or 0) for day, total in days}
    week_from = (today - timedelta(days=6)).isoformat()
    return {"needs": needs, "classes": classes, "streak": day_streak(set(minutes), today),
            "week_minutes": sum(total for day, total in minutes.items() if day >= week_from), "today_minutes": minutes.get(today.isoformat(), 0)}


# ---------- reminders ----------
STUDY_WATCH_SECONDS = 300
STUDY_CLASS_LEAD = 10            # minutes before a class the reminder aims for
STUDY_EVENING_HOUR = 18          # "due tomorrow" goes out from this hour

async def claim_reminders(pairs: list) -> set:
    """Marks (user, key) reminders as sent and returns the ones that had not gone out before."""
    if not pairs:
        return set()
    rows = await run_returning(
        pg_insert(DBStudyReminder).values([{"user_id": user_id, "key": key, "sent_at": utc_now_iso()} for user_id, key in pairs])
        .on_conflict_do_nothing(index_elements=["user_id", "key"]).returning(DBStudyReminder.user_id, DBStudyReminder.key))
    return {(user_id, key) for user_id, key in rows}

async def study_reminders_pass(send=None) -> int:
    """One look for reminders that are due. send(user_ids, payload) defaults to a real push. Returns how many went out."""
    send = send or send_push
    now = site_now()
    today = now.date()
    sent = 0
    has_device = select(DBPushSubscription.user_id)

    # A class that starts in the next few minutes, for people who asked for class reminders
    window_from = now.strftime("%H:%M")
    window_to = (now + timedelta(minutes=STUDY_CLASS_LEAD + STUDY_WATCH_SECONDS // 60)).strftime("%H:%M")
    if window_to > window_from:      # not across midnight
        rows = await fetch_one_off(
            select(DBStudySlot.id, DBStudySlot.user_id, DBStudySlot.start_time, DBStudySlot.room, DBStudySubject.name)
            .join(DBStudySubject, DBStudySubject.id == DBStudySlot.subject_id)
            .join(DBStudySetting, DBStudySetting.user_id == DBStudySlot.user_id)
            .where(DBStudySlot.weekday == today.weekday(), DBStudySlot.start_time > window_from, DBStudySlot.start_time <= window_to,
                   DBStudySetting.remind_classes == 1, DBStudySlot.user_id.in_(has_device)).limit(5000))
        fresh = await claim_reminders([(row.user_id, f"class:{row.id}:{today.isoformat()}") for row in rows])
        for row in rows:
            if (row.user_id, f"class:{row.id}:{today.isoformat()}") in fresh:
                sent += await send([row.user_id], {"title": f"{row.name} at {row.start_time}", "body": f"Room {row.room}" if row.room else "Your next class.",
                                                   "link": "study.html", "tag": f"class:{row.id}"})

    # Work due tomorrow, told once in the evening (the bell gets it too)
    if now.hour >= STUDY_EVENING_HOUR:
        tomorrow = (today + timedelta(days=1)).isoformat()
        rows = await fetch_one_off(
            select(DBStudyTask.id, DBStudyTask.user_id, DBStudyTask.title, DBStudyTask.kind)
            .outerjoin(DBStudySetting, DBStudySetting.user_id == DBStudyTask.user_id)
            .where(DBStudyTask.due_date == tomorrow, func.coalesce(DBStudyTask.done, 0) == 0, func.coalesce(DBStudySetting.remind_tasks, 1) == 1).limit(5000))
        fresh = await claim_reminders([(row.user_id, f"task:{row.id}:{tomorrow}") for row in rows])
        for row in rows:
            if (row.user_id, f"task:{row.id}:{tomorrow}") in fresh:
                await create_notification(row.user_id, "study", f"{'Exam' if row.kind == 'exam' else 'Due'} tomorrow: {row.title}", utc_now_iso(), "study.html?tab=planner")
                sent += 1

    # Daily practice: one evening nudge for people who answered yesterday and not yet today (a streak they would lose)
    if now.hour >= PRACTICE_NUDGE_HOUR:
        yesterday = (today - timedelta(days=1)).isoformat()
        done_today = select(DBPracticeAnswer.user_id).where(DBPracticeAnswer.day == today.isoformat())
        rows = await fetch_one_off(
            select(DBPracticeAnswer.user_id).distinct()
            .outerjoin(DBStudySetting, DBStudySetting.user_id == DBPracticeAnswer.user_id)
            .where(DBPracticeAnswer.day == yesterday, DBPracticeAnswer.user_id.not_in(done_today), DBPracticeAnswer.user_id.in_(has_device),
                   func.coalesce(DBStudySetting.remind_practice, 1) == 1).limit(5000))
        fresh = await claim_reminders([(row[0], f"practice:{today.isoformat()}") for row in rows])
        for user_id, _ in fresh:
            sent += await send([user_id], {"title": "Keep your streak", "body": "Today's practice questions are waiting. It takes two minutes.",
                                           "link": "practice.html", "tag": "practice"})

    # Flashcards (section 33): one evening nudge for people with cards due who have not reviewed any today
    if now.hour >= PREP_EVENING_HOUR:
        reviewed_today = select(DBCardState.user_id).where(DBCardState.last_day == today.isoformat())
        rows = await fetch_one_off(
            select(DBCardState.user_id, func.count()).join(DBCardFollow, and_(DBCardFollow.user_id == DBCardState.user_id, DBCardFollow.deck_id == DBCardState.deck_id))
            .outerjoin(DBStudySetting, DBStudySetting.user_id == DBCardState.user_id)
            .where(DBCardState.due_day <= today.isoformat(), DBCardState.user_id.not_in(reviewed_today), DBCardState.user_id.in_(has_device),
                   func.coalesce(DBStudySetting.remind_practice, 1) == 1).group_by(DBCardState.user_id).limit(5000))
        due = dict(rows)
        fresh = await claim_reminders([(user_id, f"cards:{today.isoformat()}") for user_id in due])
        for user_id, _ in fresh:
            minutes = max(1, round(due[user_id] * 12 / 60))
            sent += await send([user_id], {"title": f"{due[user_id]} {'card' if due[user_id] == 1 else 'cards'} to review",
                                           "body": f"About {minutes} {'minute' if minutes == 1 else 'minutes'}. Reviewing today is what makes them stick.",
                                           "link": "prep.html?review=1", "tag": "cards"})
    return sent

async def study_watch():
    """Every few minutes: class and deadline reminders. Old 'already sent' marks are cleared once a day."""
    last_cleanup = ""
    while True:
        try:
            await study_reminders_pass()
            today = site_now().date().isoformat()
            if today != last_cleanup:
                last_cleanup = today
                await run_one_off(delete(DBStudyReminder).where(DBStudyReminder.sent_at < (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()))
                await tutor_cleanup()
        except Exception as e:
            print("Error sending study reminders:", e)
        await asyncio.sleep(STUDY_WATCH_SECONDS)


# ==========================================
# 23. NOTES AND PAST PAPERS: STUDENTS SHARE STUDY MATERIAL
# ==========================================
# Anyone logged in can read and upload. A file is always one the uploader sent through /api/upload/note-file.
# A note with several reports is hidden until a teacher of its college or the founder has looked at it.
class DBNote(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True, index=True)
    uploader_id = Column(Integer, index=True)
    college_key = Column(String, index=True)       # the uploader's college when it was shared
    college_name = Column(String, default="")
    title = Column(String)
    kind = Column(String, default="notes")         # notes, paper, lab, book
    subject = Column(String, default="")
    department = Column(String, default="")
    semester = Column(Integer, nullable=True)
    year = Column(Integer, nullable=True)          # the exam year of a past paper
    description = Column(String, default="")
    file_url = Column(String)
    file_name = Column(String, default="")
    file_size = Column(Integer, default=0)
    downloads = Column(Integer, default=0)
    removed = Column(Integer, default=0)           # 1: taken down by a moderator
    created_at = Column(String)

class DBNoteVote(Base):
    __tablename__ = "note_votes"
    __table_args__ = (UniqueConstraint("note_id", "user_id", name="ux_note_votes"),)
    id = Column(Integer, primary_key=True, index=True)
    note_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)

class DBNoteSave(Base):
    __tablename__ = "note_saves"
    __table_args__ = (UniqueConstraint("note_id", "user_id", name="ux_note_saves"),)
    id = Column(Integer, primary_key=True, index=True)
    note_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)

class DBNoteReport(Base):
    __tablename__ = "note_reports"
    __table_args__ = (UniqueConstraint("note_id", "user_id", name="ux_note_reports"),)
    id = Column(Integer, primary_key=True, index=True)
    note_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    reason = Column(String, default="")
    created_at = Column(String)


NOTE_KINDS = ("notes", "paper", "lab", "book")
NOTE_FILE_EXTENSIONS = {"pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "jpg", "jpeg", "png", "zip"}
NOTE_MAX_BYTES = 25 * 1024 * 1024
NOTE_LIST_LIMIT = 1500
NOTE_UPLOADS_PER_DAY = 20
NOTE_REPORTS_TO_HIDE = 3
NOTE_FILE_PATTERN = r"/(static/uploads/notes/note_{user_id}_[0-9a-f]{{12}}\.[a-z0-9.]+)$"

class NoteBody(BaseModel):
    title: str
    kind: Optional[str] = "notes"
    subject: Optional[str] = ""
    department: Optional[str] = ""
    semester: Optional[int] = None
    year: Optional[int] = None
    description: Optional[str] = ""
    file_url: Optional[str] = ""
    file_name: Optional[str] = ""
    may_share: Optional[bool] = False

class NoteReportBody(BaseModel):
    reason: Optional[str] = ""


@app.post("/api/upload/note-file")
async def upload_note_file(request: Request, file: UploadFile = File(...), current_user_id: int = Depends(get_current_user_id)):
    """The file of a note or past paper. Documents, slides, pictures and zip files up to 25 MB."""
    file_location = save_upload(file, "static/uploads/notes", f"note_{current_user_id}_{uuid.uuid4().hex[:12]}", NOTE_FILE_EXTENSIONS, NOTE_MAX_BYTES)
    return {"url": upload_url(request, file_location), "filename": file.filename, "size": os.path.getsize(file_location)}

def clean_note(body: NoteBody) -> dict:
    kind = body.kind or "notes"
    if kind not in NOTE_KINDS:
        raise HTTPException(status_code=400, detail="Pick what this is: notes, a past paper, a lab manual or a book.")
    if body.semester is not None and not (1 <= body.semester <= STUDY_MAX_SEMESTERS):
        raise HTTPException(status_code=400, detail=f"Semesters are numbered 1 to {STUDY_MAX_SEMESTERS}.")
    this_year = site_now().year
    if body.year is not None and not (1990 <= body.year <= this_year + 1):
        raise HTTPException(status_code=400, detail=f"The year must be between 1990 and {this_year + 1}.")
    return {"title": clean_required(body.title, 140, "title"), "kind": kind, "subject": clean_required(body.subject, 80, "subject"),
            "department": clean_text(body.department, 120, "branch"), "semester": body.semester, "year": body.year,
            "description": clean_text(body.description, 600, "description")}

async def note_moderator(user_id: int) -> tuple:
    """(is founder, the college key this person teaches at or '')."""
    rows = await fetch_one_off(select(DBUser.is_founder, DBUser.teacher_of).where(DBUser.id == user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    return (rows[0][0] or 0) == 1, (rows[0][1] or "").strip()


@app.get("/api/notes")
async def get_notes(current_user_id: int = Depends(get_current_user_id)):
    """Every shared note and paper, in one request. Searching, filtering and sorting happen in the browser."""
    votes = select(func.count()).select_from(DBNoteVote).where(DBNoteVote.note_id == DBNote.id).scalar_subquery()
    reports = select(func.count()).select_from(DBNoteReport).where(DBNoteReport.note_id == DBNote.id).scalar_subquery()
    rows, me = await asyncio.gather(
        fetch_one_off(
            select(DBNote, DBUser.name, votes.label("votes"), reports.label("reports"),
                   exists().where(DBNoteVote.note_id == DBNote.id, DBNoteVote.user_id == current_user_id).label("voted"),
                   exists().where(DBNoteSave.note_id == DBNote.id, DBNoteSave.user_id == current_user_id).label("saved"),
                   exists().where(DBNoteReport.note_id == DBNote.id, DBNoteReport.user_id == current_user_id).label("reported"))
            .outerjoin(DBUser, DBUser.id == DBNote.uploader_id)
            .where(func.coalesce(DBNote.removed, 0) == 0).order_by(DBNote.id.desc()).limit(NOTE_LIST_LIMIT)),
        fetch_one_off(select(DBUser.college_name, DBUser.department, DBUser.is_founder, DBUser.teacher_of).where(DBUser.id == current_user_id)),
    )
    if not me:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    founder, teaches = (me[0].is_founder or 0) == 1, (me[0].teacher_of or "").strip()
    my_college = teaches or college_key_of(me[0].college_name)
    notes = []
    for note, uploader, vote_count, report_count, voted, saved, reported in rows:
        mine = note.uploader_id == current_user_id
        moderates = founder or (bool(teaches) and teaches == note.college_key)
        hidden = (report_count or 0) >= NOTE_REPORTS_TO_HIDE
        if hidden and not (mine or moderates):
            continue
        notes.append({
            "id": note.id, "title": note.title or "", "kind": note.kind or "notes", "subject": note.subject or "", "department": note.department or "",
            "semester": note.semester, "year": note.year, "description": note.description or "", "file_url": note.file_url or "",
            "file_name": note.file_name or "", "file_size": note.file_size or 0, "downloads": note.downloads or 0, "created_at": note.created_at or "",
            "college": note.college_name or "", "same_college": bool(my_college) and note.college_key == my_college,
            "uploader_id": note.uploader_id, "uploader": uploader or "Someone", "votes": vote_count or 0, "voted": bool(voted), "saved": bool(saved),
            "reported": bool(reported), "mine": mine, "can_remove": mine or moderates, "hidden": hidden,
            "reports": (report_count or 0) if moderates else 0,
        })
    return {"notes": notes, "me": {"college": (me[0].college_name or "").strip(), "department": (me[0].department or "").strip(), "has_college": bool(my_college)}}


@app.post("/api/notes")
async def create_note(body: NoteBody, current_user_id: int = Depends(get_current_user_id)):
    values = clean_note(body)
    if not body.may_share:
        raise HTTPException(status_code=400, detail="Confirm that you are allowed to share this file.")
    match = re.search(NOTE_FILE_PATTERN.format(user_id=current_user_id), body.file_url or "")
    if not match or not os.path.isfile(match.group(1)):
        raise HTTPException(status_code=400, detail="Attach the file by uploading it here.")
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    me, recent = await asyncio.gather(
        fetch_one_off(select(DBUser.college_name, DBUser.name, DBUser.teacher_of).where(DBUser.id == current_user_id)),
        fetch_one_off(select(func.count()).select_from(DBNote).where(DBNote.uploader_id == current_user_id, DBNote.created_at >= day_ago)),
    )
    if recent[0][0] >= NOTE_UPLOADS_PER_DAY:
        raise HTTPException(status_code=429, detail=f"You can share {NOTE_UPLOADS_PER_DAY} files a day. Come back tomorrow.")
    college = (me[0].college_name or "").strip()
    values.update(uploader_id=current_user_id, college_key=(me[0].teacher_of or "").strip() or college_key_of(college), college_name=college,
                  file_url=body.file_url, file_name=clean_text(body.file_name, 200, "file name") or "file", file_size=os.path.getsize(match.group(1)),
                  downloads=0, removed=0, created_at=utc_now_iso())
    rows = await run_returning(DBNote.__table__.insert().values(**values).returning(DBNote.id))
    spawn_background(log_activity_later(current_user_id, "Shared Notes", f"You shared: {values['title']}."))
    return {"id": rows[0][0]}

@app.put("/api/notes/{note_id}")
async def update_note(note_id: int, body: NoteBody, current_user_id: int = Depends(get_current_user_id)):
    """The uploader corrects the details. The file itself stays."""
    rows = await run_returning(update(DBNote).where(DBNote.id == note_id, DBNote.uploader_id == current_user_id).values(**clean_note(body)).returning(DBNote.id))
    if not rows:
        raise HTTPException(status_code=404, detail="Only the person who shared this can edit it.")
    return {"id": note_id}

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: int, current_user_id: int = Depends(get_current_user_id)):
    """The uploader deletes their note with its file. A teacher of that college or the founder takes it down."""
    rows, (founder, teaches) = await asyncio.gather(
        fetch_one_off(select(DBNote.uploader_id, DBNote.college_key, DBNote.file_url, DBNote.title).where(DBNote.id == note_id)),
        note_moderator(current_user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That is no longer here.")
    uploader_id, college, file_url, title = rows[0]
    if uploader_id != current_user_id:
        if not (founder or (teaches and teaches == college)):
            raise HTTPException(status_code=403, detail="Only the person who shared this, a teacher of that college or the founder can remove it.")
        await run_one_off(update(DBNote).where(DBNote.id == note_id).values(removed=1))
        spawn_background(create_notification(uploader_id, "study", f"A moderator took down your shared file: {(title or '')[:80]}", utc_now_iso(), "notes.html"))
        return {"removed": note_id}
    await run_one_off(delete(DBNote).where(DBNote.id == note_id))
    await asyncio.gather(*(run_one_off(delete(model).where(model.note_id == note_id)) for model in (DBNoteVote, DBNoteSave, DBNoteReport)))
    match = re.search(NOTE_FILE_PATTERN.format(user_id=uploader_id), file_url or "")
    if match and os.path.isfile(match.group(1)):
        os.remove(match.group(1))
    return {"deleted": note_id}

async def toggle_note_mark(model, note_id: int, user_id: int) -> bool:
    """Adds the caller's vote or save if it is not there, removes it if it is. Returns whether it is there now."""
    found = await fetch_one_off(select(exists().where(DBNote.id == note_id, func.coalesce(DBNote.removed, 0) == 0)))
    if not found[0][0]:
        raise HTTPException(status_code=404, detail="That is no longer here.")
    gone = await run_returning(delete(model).where(model.note_id == note_id, model.user_id == user_id).returning(model.id))
    if gone:
        return False
    await run_one_off(pg_insert(model).values(note_id=note_id, user_id=user_id).on_conflict_do_nothing(index_elements=["note_id", "user_id"]))
    return True

@app.post("/api/notes/{note_id}/vote")
async def vote_note(note_id: int, current_user_id: int = Depends(get_current_user_id)):
    voted = await toggle_note_mark(DBNoteVote, note_id, current_user_id)
    count = await fetch_one_off(select(func.count()).select_from(DBNoteVote).where(DBNoteVote.note_id == note_id))
    return {"voted": voted, "votes": count[0][0]}

@app.post("/api/notes/{note_id}/save")
async def save_note(note_id: int, current_user_id: int = Depends(get_current_user_id)):
    return {"saved": await toggle_note_mark(DBNoteSave, note_id, current_user_id)}

@app.post("/api/notes/{note_id}/download")
async def count_note_download(note_id: int, current_user_id: int = Depends(get_current_user_id)):
    rows = await run_returning(update(DBNote).where(DBNote.id == note_id).values(downloads=func.coalesce(DBNote.downloads, 0) + 1).returning(DBNote.downloads))
    return {"downloads": rows[0][0] if rows else 0}

@app.post("/api/notes/{note_id}/report")
async def report_note(note_id: int, body: NoteReportBody, current_user_id: int = Depends(get_current_user_id)):
    """Tell the moderators something is wrong with a file (wrong subject, not theirs to share, spam)."""
    rows = await fetch_one_off(select(DBNote.uploader_id, DBNote.title).where(DBNote.id == note_id, func.coalesce(DBNote.removed, 0) == 0))
    if not rows:
        raise HTTPException(status_code=404, detail="That is no longer here.")
    if rows[0][0] == current_user_id:
        raise HTTPException(status_code=400, detail="This is your own file. You can delete it instead.")
    added = await run_returning(pg_insert(DBNoteReport).values(note_id=note_id, user_id=current_user_id, reason=clean_text(body.reason, 300, "reason"), created_at=utc_now_iso())
                                .on_conflict_do_nothing(index_elements=["note_id", "user_id"]).returning(DBNoteReport.id))
    if added:
        spawn_background(notify_founders("study", f"A shared file was reported: {(rows[0][1] or '')[:80]}", "notes.html?show=reported"))
    return {"reported": True}

@app.post("/api/notes/{note_id}/keep")
async def keep_note(note_id: int, current_user_id: int = Depends(get_current_user_id)):
    """A moderator looked at a reported file and found nothing wrong: its reports are cleared."""
    rows, (founder, teaches) = await asyncio.gather(
        fetch_one_off(select(DBNote.college_key).where(DBNote.id == note_id)), note_moderator(current_user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That is no longer here.")
    if not (founder or (teaches and teaches == rows[0][0])):
        raise HTTPException(status_code=403, detail="Only a teacher of that college or the founder can do this.")
    await run_one_off(delete(DBNoteReport).where(DBNoteReport.note_id == note_id))
    return {"kept": note_id}


# ==========================================
# 24. DAILY PRACTICE: ONE APTITUDE AND ONE CODING QUESTION A DAY, STREAKS AND A COLLEGE LEADERBOARD
# ==========================================
# The questions come from practice_bank.json (loaded once into an empty table) plus any the founder adds.
# Each day every track shows the next question of its list; when the list ends it starts again.
class DBPracticeQuestion(Base):
    __tablename__ = "practice_questions"
    id = Column(Integer, primary_key=True, index=True)
    track = Column(String, index=True)             # aptitude, coding
    topic = Column(String, default="")
    question = Column(String)
    code = Column(String, default="")              # a code listing shown under the question, if any
    options = Column(String)                       # JSON list of strings
    answer = Column(Integer)                       # index into options
    explanation = Column(String, default="")
    active = Column(Integer, default=1)
    created_by = Column(Integer, nullable=True)
    created_at = Column(String)
    # Section 35 (mock tests). daily = 0: only in tests and topic practice, never one of the daily questions,
    # so adding to the test bank does not change which question is "today's".
    section = Column(String, default="")           # quant, logical, verbal, technical
    difficulty = Column(Integer, nullable=True)    # 1 easy, 2 medium, 3 hard
    daily = Column(Integer, default=1)
    lang = Column(String, default="")              # the language of the code listing: python, c, java
    draft = Column(Integer, default=0)             # 1: written by the AI for the founder to check (active = 0 until approved)

class DBPracticeAnswer(Base):
    __tablename__ = "practice_answers"
    __table_args__ = (UniqueConstraint("user_id", "question_id", "day", name="ux_practice_answers"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    question_id = Column(Integer, index=True)
    day = Column(String, index=True, default="")   # the day it was the daily question; empty for practice on an earlier one
    chosen = Column(Integer)
    correct = Column(Integer, default=0)
    points = Column(Integer, default=0)
    answered_at = Column(String)


PRACTICE_TRACKS = (("aptitude", "Aptitude"), ("coding", "Coding and CS"))
PRACTICE_EPOCH = datetime(2026, 1, 5).date()
PRACTICE_POINTS_RIGHT = 10
PRACTICE_POINTS_TRIED = 2
PRACTICE_ARCHIVE_DAYS = 14
PRACTICE_BANK_FILE = "practice_bank.json"
PRACTICE_NUDGE_HOUR = 19
practice_cache: dict = {"at": 0.0, "by_track": {}, "by_id": {}}

class PracticeAnswerBody(BaseModel):
    question_id: int
    chosen: int

class PracticeQuestionBody(BaseModel):
    track: str
    topic: Optional[str] = ""
    question: str
    code: Optional[str] = ""
    options: List[str]
    answer: int
    explanation: Optional[str] = ""


async def seed_practice_bank():
    """Fills an empty question table from practice_bank.json. Runs at startup."""
    try:
        count = await fetch_one_off(select(func.count()).select_from(DBPracticeQuestion))
        if count[0][0] or not os.path.exists(PRACTICE_BANK_FILE):
            return
        with open(PRACTICE_BANK_FILE, encoding="utf-8") as bank_file:
            bank = json.load(bank_file)
        now_iso = utc_now_iso()
        rows = [{"track": item["track"], "topic": item.get("topic", ""), "question": item["q"], "code": item.get("code", ""),
                 "options": json.dumps(item["options"]), "answer": item["answer"], "explanation": item.get("why", ""), "active": 1, "created_at": now_iso}
                for item in bank if item["track"] in dict(PRACTICE_TRACKS) and 0 <= item["answer"] < len(item["options"])]
        if rows:
            await run_one_off(DBPracticeQuestion.__table__.insert().values(rows))
        practice_cache["at"] = 0.0
        print(f"Practice questions loaded: {len(rows)}")
    except Exception as e:
        print("Could not load the practice questions:", e)

async def practice_questions() -> dict:
    """Every active question, kept in memory for ten minutes (they rarely change)."""
    now = datetime.now(timezone.utc).timestamp()
    if now - practice_cache["at"] > 600 or not practice_cache["by_id"]:
        rows = await fetch_one_off(select(DBPracticeQuestion).where(func.coalesce(DBPracticeQuestion.active, 1) == 1).order_by(DBPracticeQuestion.id))
        by_track: dict = {track: [] for track, _ in PRACTICE_TRACKS}
        for (question,) in rows:
            if question.track in by_track and (question.daily if question.daily is not None else 1) == 1:
                by_track[question.track].append(question)
        practice_cache.update(at=now, by_track=by_track, by_id={question.id: question for (question,) in rows})
    return practice_cache

def daily_question(cache: dict, track: str, day):
    """The question a track shows on a day: the lists are walked one a day and start again at the end."""
    questions = cache["by_track"].get(track) or []
    return questions[(day - PRACTICE_EPOCH).days % len(questions)] if questions else None

def practice_card(question: DBPracticeQuestion, answer_row=None) -> dict:
    """A question as the browser gets it. The right answer and the explanation are added only once it has been answered."""
    card = {"id": question.id, "track": question.track, "topic": question.topic or "", "question": question.question or "",
            "code": question.code or "", "options": json_list(question.options), "mine": None}
    if answer_row is not None:
        card["mine"] = {"chosen": answer_row.chosen, "correct": bool(answer_row.correct), "points": answer_row.points or 0,
                        "answer": question.answer, "explanation": question.explanation or ""}
    return card

async def practice_glance(user_id: int) -> dict:
    """The practice streak and how much of today is done, for Home and My Study. One read."""
    today = site_now().date()
    rows, cache = await asyncio.gather(
        fetch_one_off(select(DBPracticeAnswer.day, func.count()).where(DBPracticeAnswer.user_id == user_id, DBPracticeAnswer.day != "").group_by(DBPracticeAnswer.day)),
        practice_questions())
    done = dict(rows)
    return {"streak": day_streak(set(done), today), "done_today": done.get(today.isoformat(), 0),
            "total_today": sum(1 for track, _ in PRACTICE_TRACKS if cache["by_track"].get(track))}


@app.get("/api/practice")
async def get_practice(current_user_id: int = Depends(get_current_user_id)):
    """Today's questions, the last two weeks to catch up on, the caller's streak and points, and their college's leaderboard."""
    today = site_now().date()
    week_from = (today - timedelta(days=6)).isoformat()
    college = select(USER_COLLEGE_KEY).where(DBUser.id == current_user_id).scalar_subquery()
    picture = case((func.length(DBUser.profile_pic) > 1000, ""), else_=DBUser.profile_pic)

    def board(*conditions):
        points = func.sum(DBPracticeAnswer.points)
        return (select(DBUser.id, DBUser.name, picture, points.label("points"))
                .join(DBPracticeAnswer, DBPracticeAnswer.user_id == DBUser.id)
                .where(USER_COLLEGE_KEY == college, visible_user_clause(), *conditions).group_by(DBUser.id, DBUser.name, DBUser.profile_pic)
                .having(points > 0).order_by(points.desc(), DBUser.id).limit(10))

    cache, answers, me, week_board, all_board = await asyncio.gather(
        practice_questions(),
        fetch_one_off(select(DBPracticeAnswer).where(DBPracticeAnswer.user_id == current_user_id).order_by(DBPracticeAnswer.id.desc()).limit(3000)),
        fetch_one_off(select(DBUser.college_name, DBUser.is_founder).where(DBUser.id == current_user_id)),
        fetch_one_off(board(DBPracticeAnswer.day >= week_from)),
        fetch_one_off(board()),
    )
    mine: dict = {}
    for (row,) in answers:
        mine.setdefault((row.question_id, row.day), row)
    latest: dict = {}
    for (row,) in reversed(answers):
        latest[row.question_id] = row          # the newest answer to a question, whatever day it counted for

    daily = []
    for track, label in PRACTICE_TRACKS:
        question = daily_question(cache, track, today)
        if question:
            daily.append({**practice_card(question, mine.get((question.id, today.isoformat()))), "track_label": label})
    archive = []
    for back in range(1, PRACTICE_ARCHIVE_DAYS + 1):
        day = today - timedelta(days=back)
        for track, label in PRACTICE_TRACKS:
            question = daily_question(cache, track, day)
            if question:
                answered = mine.get((question.id, day.isoformat())) or mine.get((question.id, "")) or latest.get(question.id)
                archive.append({**practice_card(question, answered), "track_label": label, "day": day.isoformat()})
    daily_days = {row.day for (row,) in answers if row.day}
    as_board = lambda rows: [{"id": user_id, "name": name or "Someone", "profile_pic": pic or "", "points": int(points or 0), "me": user_id == current_user_id}
                             for user_id, name, pic, points in rows]
    return {
        "today": today.isoformat(), "daily": daily, "archive": archive,
        "stats": {"streak": day_streak(daily_days, today), "points": sum(row.points or 0 for (row,) in answers),
                  "week_points": sum(row.points or 0 for (row,) in answers if row.day >= week_from),
                  "answered": len(answers), "correct": sum(1 for (row,) in answers if row.correct)},
        "college": (me[0].college_name or "").strip() if me else "",
        "leaderboard": {"week": as_board(week_board), "all": as_board(all_board)},
        "founder": bool(me) and (me[0].is_founder or 0) == 1,
        "bank": {track: len(cache["by_track"].get(track) or []) for track, _ in PRACTICE_TRACKS},
    }


@app.post("/api/practice/answer")
async def answer_practice(body: PracticeAnswerBody, current_user_id: int = Depends(get_current_user_id)):
    """One answer per question per day. Today's question earns points and keeps the streak; an earlier one is practice."""
    cache = await practice_questions()
    question = cache["by_id"].get(body.question_id)
    today = site_now().date()
    if not question:
        raise HTTPException(status_code=404, detail="That question is no longer here.")
    # Only questions that have already been shown can be answered, so nobody can read ahead
    shown_on = [today - timedelta(days=back) for back in range(0, PRACTICE_ARCHIVE_DAYS + 1)
                if daily_question(cache, question.track, today - timedelta(days=back)).id == question.id]
    if not shown_on:
        raise HTTPException(status_code=403, detail="That question has not come up yet.")
    options = json_list(question.options)
    if not (0 <= body.chosen < len(options)):
        raise HTTPException(status_code=400, detail="Pick one of the choices.")
    is_today = shown_on[0] == today
    correct = body.chosen == question.answer
    points = (PRACTICE_POINTS_RIGHT if correct else PRACTICE_POINTS_TRIED) if is_today else 0
    day = today.isoformat() if is_today else ""
    saved = await run_returning(
        pg_insert(DBPracticeAnswer).values(user_id=current_user_id, question_id=question.id, day=day, chosen=body.chosen, correct=1 if correct else 0,
                                           points=points, answered_at=utc_now_iso())
        .on_conflict_do_nothing(index_elements=["user_id", "question_id", "day"]).returning(DBPracticeAnswer.id))
    if not saved:
        raise HTTPException(status_code=409, detail="You have already answered this one.")
    glance, xp = await asyncio.gather(practice_glance(current_user_id),
                                      award_xp(current_user_id, "practice", f"q{question.id}:{day}", points) if points else asyncio.sleep(0, {"xp": 0}))
    return {"question_id": question.id, "correct": correct, "answer": question.answer, "explanation": question.explanation or "",
            "points": points, "daily": is_today, "streak": glance["streak"], "xp": xp}


@app.post("/api/founder/practice-questions")
async def add_practice_question(body: PracticeQuestionBody, founder_id: int = Depends(require_founder)):
    """The founder adds a question to the end of a track's list."""
    if body.track not in dict(PRACTICE_TRACKS):
        raise HTTPException(status_code=400, detail="Pick the track: aptitude or coding.")
    options = [clean_required(option, 300, "choice") for option in body.options]
    if not (2 <= len(options) <= 5) or len(set(options)) != len(options):
        raise HTTPException(status_code=400, detail="Give 2 to 5 different choices.")
    if not (0 <= body.answer < len(options)):
        raise HTTPException(status_code=400, detail="Mark which choice is right.")
    rows = await run_returning(DBPracticeQuestion.__table__.insert().values(
        track=body.track, topic=clean_text(body.topic, 60, "topic"), question=clean_required(body.question, 1200, "question"),
        code=(body.code or "").rstrip()[:3000], options=json.dumps(options), answer=body.answer, explanation=clean_text(body.explanation, 1500, "explanation"),
        active=1, created_by=founder_id, created_at=utc_now_iso()).returning(DBPracticeQuestion.id))
    practice_cache["at"] = 0.0
    return {"id": rows[0][0]}


# ==========================================
# 25. RESUME BUILDER
# ==========================================
# The resume itself is laid out in the browser (resume.js). The server keeps one saved copy per person
# and hands over what the first draft is filled from: the profile, the projects and the CGPA from My Study.
class DBResume(Base):
    __tablename__ = "resumes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, unique=True, index=True)
    data = Column(String)                          # JSON, shaped by resume.js
    updated_at = Column(String)


RESUME_TEMPLATES = ("classic", "modern")
RESUME_TEXT_FIELDS = {"name": 80, "headline": 120, "email": 160, "phone": 30, "city": 80, "summary": 700}
# The lists of a resume: how many entries each may hold and the fields of one entry with their length limits
RESUME_LISTS = {
    "links": (6, {"label": 40, "url": 300}),
    "education": (6, {"school": 140, "degree": 140, "years": 40, "score": 40}),
    "projects": (8, {"title": 120, "tech": 160, "description": 500, "link": 300}),
    "experience": (8, {"role": 120, "org": 140, "years": 40, "description": 500}),
}
RESUME_WORD_LISTS = {"skills": (40, 40), "achievements": (10, 200)}     # entries, characters each

class ResumeBody(BaseModel):
    data: dict

def clean_resume(data: dict) -> dict:
    """Keeps only what a resume is made of, trimmed to its limits. Anything else that was sent is dropped."""
    def words(value, limit) -> str:
        return str(value if value is not None else "").strip()[:limit]
    clean = {"template": data.get("template") if data.get("template") in RESUME_TEMPLATES else "classic", "show_cgpa": bool(data.get("show_cgpa"))}
    for field, limit in RESUME_TEXT_FIELDS.items():
        clean[field] = words(data.get(field), limit)
    for field, (most, shape) in RESUME_LISTS.items():
        entries = data.get(field) if isinstance(data.get(field), list) else []
        clean[field] = [{key: words(entry.get(key), limit) for key, limit in shape.items()} for entry in entries[:most] if isinstance(entry, dict)]
        clean[field] = [entry for entry in clean[field] if any(entry.values())]
    for field, (most, limit) in RESUME_WORD_LISTS.items():
        entries = data.get(field) if isinstance(data.get(field), list) else []
        clean[field] = [text_ for text_ in (words(entry, limit) for entry in entries[:most] if isinstance(entry, (str, int, float))) if text_]
    for entry in clean["links"] + clean["projects"]:
        key = "url" if "url" in entry else "link"
        if entry[key] and not HUB_LINK_PATTERN.match(entry[key]):
            raise HTTPException(status_code=400, detail="Links must start with http:// or https://")
    if not clean["name"]:
        raise HTTPException(status_code=400, detail="A resume needs your name.")
    return clean


@app.get("/api/resume")
async def get_resume(current_user_id: int = Depends(get_current_user_id)):
    """The caller's saved resume (if any) and what a first draft is filled from."""
    saved, profile, projects, grades = await asyncio.gather(
        fetch_one_off(select(DBResume.data, DBResume.updated_at).where(DBResume.user_id == current_user_id)),
        fetch_one_off(select(DBUser.name, DBUser.email, DBUser.college_name, DBUser.department, DBUser.city, DBUser.skills, DBUser.bio,
                             DBUser.github_username, DBUser.portfolio_link, DBUser.profession, DBUser.experience_years).where(DBUser.id == current_user_id)),
        fetch_one_off(select(DBProject).where(DBProject.user_id == current_user_id).order_by(DBProject.id.desc()).limit(12)),
        fetch_one_off(select(func.sum(DBStudyGrade.credits), func.sum(DBStudyGrade.credits * DBStudyGrade.points)).where(DBStudyGrade.user_id == current_user_id)),
    )
    if not profile:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    row = profile[0]
    credits, earned = (grades[0][0] or 0, grades[0][1] or 0) if grades else (0, 0)
    data = None
    if saved:
        try:
            data = json.loads(saved[0][0])
        except (ValueError, TypeError):
            data = None
    return {
        "saved": data, "updated_at": saved[0][1] if saved else "",
        "profile": {"name": row.name or "", "email": row.email or "", "college_name": (row.college_name or "").strip(), "department": (row.department or "").strip(),
                    "city": (row.city or "").strip(), "skills": row.skills or "", "bio": row.bio or "", "github_username": row.github_username or "",
                    "portfolio_link": row.portfolio_link or "", "profession": row.profession or "", "experience_years": row.experience_years},
        "projects": [serialize_project(project) for (project,) in projects],
        "cgpa": round(earned / credits, 2) if credits else None,
    }

@app.put("/api/resume")
async def save_resume(body: ResumeBody, current_user_id: int = Depends(get_current_user_id)):
    data = clean_resume(body.data)
    now_iso = utc_now_iso()
    await run_one_off(pg_insert(DBResume).values(user_id=current_user_id, data=json.dumps(data), updated_at=now_iso)
                      .on_conflict_do_update(index_elements=["user_id"], set_={"data": json.dumps(data), "updated_at": now_iso}))
    return {"saved": data, "updated_at": now_iso}

@app.delete("/api/resume")
async def delete_resume(current_user_id: int = Depends(get_current_user_id)):
    """Forget the saved resume. The next visit starts again from the profile."""
    await run_one_off(delete(DBResume).where(DBResume.user_id == current_user_id))
    return {"saved": None}


# ==========================================
# 26. DELETE MY ACCOUNT, DOWNLOAD MY DATA
# ==========================================
# Anyone can take their information off the site. A deletion waits DELETE_GRACE_DAYS: the account is hidden and
# logged out at once, and logging in again cancels it. Then erase_account() removes everything personal.
# What other people still rely on (messages, team chat, College Hub posts, notes, answers, marks) stays, and the
# account row becomes a nameless "Deleted user". Payment rows stay for the tax records, tied only to that row.
DELETE_GRACE_DAYS = 14
DELETED_NAME = "Deleted user"
EXPORT_ROWS_PER_TABLE = 20000

# The database has no foreign keys, so every column that holds a person's id is listed here, table by table.
# A new table that stores a person's id must be added to one of the two (account_test.py checks this).
USER_DATA_ERASED = {
    "history": ("user_id",),
    "notifications": ("user_id",),
    "follows": ("follower_id", "followed_id"),
    "saved_profiles": ("user_id", "saved_user_id"),
    "muted_users": ("user_id", "muted_user_id"),
    "blocked_users": ("user_id", "blocked_user_id"),
    "cleared_chats": ("user_id",),
    "archived_chats": ("user_id",),
    "projects": ("user_id",),
    "research_reports": ("user_id",),
    "board_applications": ("user_id",),
    "team_members": ("user_id",),
    "team_message_reactions": ("user_id",),
    "community_members": ("user_id",),
    "teacher_requests": ("user_id",),
    "admin_requests": ("user_id",),
    "admin_scopes": ("user_id",),
    "college_post_reads": ("user_id",),
    "college_resource_saves": ("user_id",),
    "usage_counters": ("user_id",),
    "recruiter_seats": ("user_id",),
    "recruiter_unlocks": ("user_id", "recruiter_id"),
    "recruiter_shortlists": ("user_id",),
    "github_stats": ("user_id",),
    "push_subscriptions": ("user_id",),
    "study_subjects": ("user_id",),
    "study_slots": ("user_id",),
    "study_attendance": ("user_id",),
    "study_tasks": ("user_id",),
    "study_grades": ("user_id",),
    "study_sessions": ("user_id",),
    "study_settings": ("user_id",),
    "study_reminders": ("user_id",),
    "class_timetable_slots": ("teacher_id",),
    "note_saves": ("user_id",),
    "practice_answers": ("user_id",),
    "resumes": ("user_id",),
}
USER_DATA_KEPT = {
    "messages": ("sender_id", "receiver_id"),
    "pro_chats": ("user_a", "user_b"),
    "teams": ("created_by",),
    "team_messages": ("sender_id", "pinned_by"),
    "team_resources": ("added_by",),
    "team_tasks": ("assignee_id", "created_by"),
    "board_posts": ("author_id",),             # sponsored ones stay; the rest go in erase_account()
    "college_posts": ("author_id",),
    "college_settings": ("updated_by",),
    "college_messages": ("sender_id",),
    "college_poll_votes": ("user_id",),
    "college_submissions": ("submitted_by", "graded_by"),
    "group_checkins": ("author_id", "teacher_id"),
    "college_events": ("author_id",),
    "college_resources": ("author_id",),
    "attendance_sessions": ("teacher_id",),
    "attendance_marks": ("user_id",),
    "college_questions": ("author_id",),
    "college_answers": ("author_id",),
    "college_question_votes": ("user_id",),
    "admin_scopes": ("granted_by",),
    "verification_log": ("student_id", "admin_id"),
    "subscriptions": ("user_id", "granted_by"),
    "payments": ("user_id",),
    "b2b_enquiries": ("user_id",),
    "recruiter_shortlists": ("added_by",),
    "challenge_submissions": ("user_id",),
    "notes": ("uploader_id",),
    "note_votes": ("user_id",),
    "note_reports": ("user_id",),
    "practice_questions": ("created_by",),
    "task_comments": ("user_id",),
    "task_activity": ("user_id",),
    "time_entries": ("user_id",),
    "project_items": ("created_by", "updated_by"),
    # other people's own settings and decisions about this person: kept, and not part of the download
    "cleared_chats": ("cleared_with_user_id",),
    "archived_chats": ("archived_user_id",),
    "admin_requests": ("decided_by",),
    "teacher_requests": ("decided_by",),
}
NOT_EXPORTED = {("cleared_chats", "cleared_with_user_id"), ("archived_chats", "archived_user_id"),
                ("admin_requests", "decided_by"), ("teacher_requests", "decided_by")}
PROFILE_NOT_EXPORTED = {"hashed_password", "id_card_image", "invite_code", "status_before_delete", "totp_secret", "token_version"}


def export_columns() -> dict:
    """table -> the columns whose rows belong in a person's download."""
    columns: dict = {}
    for registry in (USER_DATA_ERASED, USER_DATA_KEPT):
        for table, names in registry.items():
            columns.setdefault(table, [])
            columns[table] += [name for name in names if (table, name) not in NOT_EXPORTED and name not in columns[table]]
    return {table: names for table, names in columns.items() if names}


async def load_closed_accounts():
    try:
        rows = await fetch_one_off(select(DBUser.id).where(DBUser.account_status.in_(("closing", "deleted"))))
        CLOSED_ACCOUNTS.update(row[0] for row in rows)
    except Exception as e:
        print("Could not load closed accounts:", e)

async def close_account_sockets(user_id: int):
    """Close the person's open pages' live connections; the pages then find they are logged out."""
    sockets = list(chat_manager.active_connections.get(user_id, [])) + list(notification_manager.active_connections.get(user_id, []))
    for team_id in list(team_hub.teams):
        sockets += team_hub.sockets_of(team_id, user_id)
    for websocket in sockets:
        try:
            await websocket.close(code=4401)
        except Exception:
            pass

async def cancel_account_deletion(db: AsyncSession, user: DBUser):
    """Logging in during the waiting time brings the account back as it was."""
    user.account_status = user.status_before_delete or "pending"
    user.status_before_delete = ""
    user.delete_after = ""
    card = directory_card(user)
    await db.commit()
    CLOSED_ACCOUNTS.discard(user.id)
    spawn_background(broadcast_directory({"type": "profile_added", "profile": card}))
    spawn_background(log_activity_later(user.id, "Account Restored", "You logged in again, so your account will not be deleted."))


def account_rate_key(request: Request) -> str:
    """Limits count per account: a whole college often shares one internet address."""
    try:
        return "user:" + str(int(jwt.decode(request.cookies.get("authToken") or "", SECRET_KEY, algorithms=[ALGORITHM]).get("sub")))
    except Exception:
        return get_remote_address(request)


# ---------- download my data ----------
@app.get("/api/me/export")
@limiter.limit("5/hour", key_func=account_rate_key)
async def export_my_data(request: Request, current_user_id: int = Depends(get_current_user_id)):
    """Everything the site holds about the caller, as one JSON file. Never the password hash or the ID-card photo."""
    gate = asyncio.Semaphore(3)     # about 70 reads; a few at a time so other people's requests still get a connection

    async def read(table_name: str, columns: list):
        table = Base.metadata.tables[table_name]
        statement = (select(table).where(or_(*(table.c[name] == current_user_id for name in columns)))
                     .order_by(*table.primary_key.columns).limit(EXPORT_ROWS_PER_TABLE))
        async with gate:
            rows = await fetch_one_off(statement)
        return table_name, [dict(row._mapping) for row in rows]

    profile_rows, *tables = await asyncio.gather(
        fetch_one_off(select(DBUser).where(DBUser.id == current_user_id)),
        *(read(name, columns) for name, columns in export_columns().items()),
    )
    if not profile_rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    user = profile_rows[0][0]
    profile = {column.name: getattr(user, column.key) for column in DBUser.__table__.columns if column.name not in PROFILE_NOT_EXPORTED}
    profile["id_card_on_file"] = bool(user.id_card_image)
    data = {
        "exported_at": utc_now_iso(),
        "site": "Connect2Minds",
        "about": "Your profile and every row on the site that is linked to your account, table by table.",
        "profile": profile,
        "tables": {name: rows for name, rows in sorted(tables) if rows},
    }
    return Response(content=json.dumps(data, default=str, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="connect2minds-my-data.json"'})


# ---------- delete my account ----------
class AccountDeleteBody(BaseModel):
    password: str = ""
    confirm: str = ""

@app.get("/api/me/account")
async def my_account_state(current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBUser.is_founder, DBUser.plan, DBUser.teacher_of).where(DBUser.id == current_user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    return {"can_delete": (rows[0].is_founder or 0) != 1, "grace_days": DELETE_GRACE_DAYS,
            "has_plan": bool(rows[0].plan), "is_teacher": bool(rows[0].teacher_of)}

@app.post("/api/me/delete")
@limiter.limit("5/minute", key_func=account_rate_key)
async def request_account_deletion(request: Request, body: AccountDeleteBody, response: Response, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBUser.hashed_password, DBUser.is_founder).where(DBUser.id == current_user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    if (rows[0].is_founder or 0) == 1:
        raise HTTPException(status_code=400, detail="The founder account cannot be deleted.")
    if (body.confirm or "").strip().upper() != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm.")
    if not rows[0].hashed_password or not await check_password_async(body.password or "", rows[0].hashed_password):
        raise HTTPException(status_code=400, detail="That password is not right.")

    delete_after = (datetime.now(timezone.utc) + timedelta(days=DELETE_GRACE_DAYS)).isoformat()
    await asyncio.gather(
        run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(
            status_before_delete=func.coalesce(DBUser.account_status, "pending"), account_status="closing", delete_after=delete_after)),
        run_one_off(delete(DBPushSubscription).where(DBPushSubscription.user_id == current_user_id)),
    )
    CLOSED_ACCOUNTS.add(current_user_id)
    if push_users is not None:
        push_users.discard(current_user_id)
    clear_login_cookies(response, request)
    spawn_background(log_activity_later(current_user_id, "Account Deletion Requested", f"Your account will be deleted after {DELETE_GRACE_DAYS} days unless you log in again."))
    spawn_background(close_account_sockets(current_user_id))
    spawn_background(broadcast_directory({"type": "profile_removed", "id": current_user_id}))
    return {"delete_after": delete_after, "grace_days": DELETE_GRACE_DAYS}


def erase_deletes_sql() -> str:
    """One statement that deletes every erased row of one person (:uid), plus their own non-sponsored board posts."""
    parts = [f"e{i} AS (DELETE FROM {table} WHERE {' OR '.join(f'{column} = :uid' for column in columns)})"
             for i, (table, columns) in enumerate(USER_DATA_ERASED.items())]
    own_posts = "SELECT id FROM board_posts WHERE author_id = :uid AND COALESCE(is_sponsored, 0) = 0"
    parts.append(f"posts_applications AS (DELETE FROM board_applications WHERE post_id IN ({own_posts}))")
    parts.append(f"posts AS (DELETE FROM board_posts WHERE id IN ({own_posts}))")
    return "WITH " + ",\n".join(parts) + "\nSELECT 1"

def remove_upload(url: str, prefix: str):
    """Delete one file under static/uploads, only if its name starts with prefix (e.g. "chat_12_")."""
    path = urlparse(url or "").path.lstrip("/")
    folder, name = os.path.split(path)
    if folder.startswith("static/uploads") and ".." not in path and name.startswith(prefix):
        try:
            os.remove(path)
        except OSError:
            pass

def remove_user_files(user_id: int, id_card: str, proof_urls: list):
    import glob
    for path in glob.glob(f"static/uploads/user_{user_id}_*"):    # profile picture, banner, project pictures
        try:
            os.remove(path)
        except OSError:
            pass
    remove_id_card_file(id_card)
    for url in proof_urls:
        remove_upload(url, f"chat_{user_id}_")

async def erase_account(user_id: int) -> bool:
    """The end of the waiting time: remove everything personal and leave a nameless row. False if it was cancelled."""
    async with SessionLocal() as db:
        user = (await db.execute(select(DBUser.account_status, DBUser.roll_no, DBUser.id_card_image)
                                 .where(DBUser.id == user_id).with_for_update())).first()
        if not user or user.account_status != "closing":
            await db.rollback()
            return False
        team_ids = [row[0] for row in (await db.execute(select(DBTeamMember.team_id).where(DBTeamMember.user_id == user_id))).all()]
        proofs = (await db.execute(text(
            "SELECT id_proof_url, letter_url FROM teacher_requests WHERE user_id = :uid "
            "UNION ALL SELECT id_proof_url, letter_url FROM admin_requests WHERE user_id = :uid"), {"uid": user_id})).all()
        await db.execute(text(erase_deletes_sql()), {"uid": user_id})
        if user.roll_no and (await db.execute(text("SELECT to_regclass('public.profiles')"))).scalar():
            await db.execute(text("DELETE FROM profiles WHERE roll_no = :roll"), {"roll": user.roll_no})   # an old copy of the profile
        await db.execute(update(DBSubscription).where(DBSubscription.user_id == user_id, DBSubscription.status == "active").values(status="cancelled"))
        await db.execute(update(DBEnquiry).where(DBEnquiry.user_id == user_id).values(contact_name="", email="", phone="", message=""))
        await db.execute(update(DBUser).where(DBUser.id == user_id).values(
            name=DELETED_NAME, roll_no=None, email=None, hashed_password="", college_name="", department="", city="", division="",
            skills="", bio="", profile_pic="", banner_pic="", account_type="standard", github_username="", is_admin=0, is_ambassador=False,
            ambassador_strikes=0, account_status="deleted", id_barcode=None, id_card_image="", portfolio_link="", invite_code="",
            profession="", open_to="", experience_years=None, teacher_of="", verify_department="", recruiter_contact_ok=0,
            plan="", plan_until="", digest_on=0, last_digest_at="", delete_after="", status_before_delete="",
            email_verified=0, email_verified_at="", totp_secret="", totp_enabled=0, birth_date="", guardian_email="", suspend_reason=""))
        await db.commit()
    CLOSED_ACCOUNTS.add(user_id)

    # The account is already nameless; each step below runs on its own, so one failing does not stop the others
    try:
        await asyncio.to_thread(remove_user_files, user_id, user.id_card_image or "", [url for row in proofs for url in row if url])
    except Exception as e:
        print("Removing the files of account", user_id, "failed:", e)
    # Teams they were in: an empty team goes; a team left without an Admin gets its longest-standing member as Admin
    for team_id in team_ids:
        try:
            members = await fetch_one_off(select(DBTeamMember.id, DBTeamMember.role).where(DBTeamMember.team_id == team_id).order_by(DBTeamMember.id))
            if not members:
                async with SessionLocal() as db:
                    await purge_team(db, team_id)
                    await db.commit()
            elif not any(role == "Admin" for _, role in members):
                await run_one_off(update(DBTeamMember).where(DBTeamMember.id == members[0][0]).values(role="Admin"))
        except Exception as e:
            print("Tidying team", team_id, "after erasing account", user_id, "failed:", e)
    return True

async def account_delete_watch():
    """Every hour: erase the accounts whose waiting time is over."""
    while True:
        try:
            due = await fetch_one_off(select(DBUser.id).where(DBUser.account_status == "closing", func.coalesce(DBUser.delete_after, "") != "",
                                                              DBUser.delete_after < utc_now_iso()).order_by(DBUser.id).limit(20))
            for (user_id,) in due:
                try:
                    await erase_account(user_id)
                except Exception as e:
                    print("Erasing account", user_id, "failed:", e)
        except Exception as e:
            print("Error checking account deletions:", e)
        await asyncio.sleep(3600)


# ==========================================
# 27. PROJECT HUB PLANNING TOOLS
# ==========================================
# Project Hub (project_management.html) plans a Teams workspace. Section 12 holds the task board itself;
# this section adds what a project plan needs around it:
#   tasks: start dates, estimates, sprints, milestones, dependencies, checklists, comments and a history
#   sprints: time boxes with a goal; finishing one moves what is left to the next sprint or the backlog
#   items: one table for the document-like tools (brief, risks, decisions, docs, meeting notes, ideas, mind maps, roles)
#   time: a running timer per person, or hours logged by hand
#   templates: a ready-made plan for common kinds of student projects
# Every change is sent to the workspace's open pages over the Teams socket (team_hub), like the board already was.
class DBTeamSprint(Base):
    __tablename__ = "team_sprints"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    name = Column(String)
    goal = Column(String, default="")
    start_date = Column(String, default="")        # YYYY-MM-DD
    end_date = Column(String, default="")
    status = Column(String, default="planned")     # planned, active, done
    created_at = Column(String)
    completed_at = Column(String, default="")

class DBTaskComment(Base):
    __tablename__ = "task_comments"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)
    team_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    body = Column(String)
    attachment = Column(String, default="")        # an uploaded file's address (chat-file upload)
    created_at = Column(String)

class DBTaskActivity(Base):
    __tablename__ = "task_activity"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)
    team_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    action = Column(String)                        # created, moved, assigned, dated, edited, commented, ...
    detail = Column(String, default="")
    at = Column(String)

class DBTimeEntry(Base):
    __tablename__ = "time_entries"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    task_id = Column(Integer, nullable=True, index=True)
    user_id = Column(Integer, index=True)
    started_at = Column(String)
    ended_at = Column(String, default="")          # empty while the timer runs
    minutes = Column(Integer, default=0)
    note = Column(String, default="")
    day = Column(String, default="")               # YYYY-MM-DD the time counts for

class DBProjectItem(Base):
    __tablename__ = "project_items"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
    kind = Column(String, index=True)              # see PROJECT_ITEM_SCHEMA
    title = Column(String, default="")
    data = Column(String, default="{}")            # JSON, shaped by the kind's schema
    position = Column(Float, default=0)
    created_by = Column(Integer)
    updated_by = Column(Integer, nullable=True)
    created_at = Column(String)
    updated_at = Column(String)

Index("ix_time_entries_running", DBTimeEntry.user_id, DBTimeEntry.ended_at)
Index("ix_project_items_team_kind", DBProjectItem.team_id, DBProjectItem.kind)

MAX_CHECKLIST_ITEMS = 50
MAX_DEPENDENCIES = 20
SPRINT_STATUSES = ("planned", "active", "done")


def json_array(value) -> list:
    try:
        parsed = json.loads(value) if isinstance(value, str) else (value or [])
    except ValueError:
        return []
    return parsed if isinstance(parsed, list) else []

def json_object(value) -> dict:
    try:
        parsed = json.loads(value) if isinstance(value, str) else (value or {})
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}

def clean_date(value, what: str) -> str:
    value = (value or "").strip()
    if value:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail=f"The {what} must look like 2026-12-31.")
    return value


# ---------- tasks: the extra fields ----------
def clean_task_extras(data, partial: bool) -> dict:
    """The section 27 task fields that were sent, checked. Dependencies are checked separately (they need the team's tasks)."""
    values = {}
    if data.start_date is not None:
        values["start_date"] = clean_date(data.start_date, "start date")
    if data.estimate_hours is not None:
        if not math.isfinite(data.estimate_hours) or not (0 <= data.estimate_hours <= 1000):
            raise HTTPException(status_code=400, detail="The estimate must be between 0 and 1000 hours.")
        values["estimate_hours"] = round(data.estimate_hours, 2)
    if getattr(data, "clear_estimate", False):
        values["estimate_hours"] = None
    if data.is_milestone is not None:
        values["is_milestone"] = 1 if data.is_milestone else 0
    if data.checklist is not None:
        if len(data.checklist) > MAX_CHECKLIST_ITEMS:
            raise HTTPException(status_code=400, detail=f"A checklist can have up to {MAX_CHECKLIST_ITEMS} items.")
        items = []
        for entry in data.checklist:
            if not isinstance(entry, dict):
                continue
            text_ = str(entry.get("text") or "").strip()[:200]
            if text_:
                items.append({"id": str(entry.get("id") or uuid.uuid4().hex[:8])[:20], "text": text_, "done": bool(entry.get("done"))})
        values["checklist"] = json.dumps(items)
    return values

def check_dates_order(start: str, due: str):
    if start and due and start > due:
        raise HTTPException(status_code=400, detail="The start date must be on or before the due date.")

async def check_dependencies(db: AsyncSession, team_id: int, task_id: Optional[int], depends_on: list) -> list:
    """Only tasks of the same workspace, never the task itself, and no loop (A waits for B waits for A)."""
    wanted = list(dict.fromkeys(int(x) for x in depends_on if isinstance(x, (int, float)) and not isinstance(x, bool)))
    if len(wanted) > MAX_DEPENDENCIES:
        raise HTTPException(status_code=400, detail=f"A task can wait for up to {MAX_DEPENDENCIES} other tasks.")
    if not wanted:
        return []
    if task_id in wanted:
        raise HTTPException(status_code=400, detail="A task cannot wait for itself.")
    rows = (await db.execute(select(DBTeamTask.id, DBTeamTask.depends_on).where(DBTeamTask.team_id == team_id))).all()
    graph = {row.id: [int(x) for x in json_array(row.depends_on) if isinstance(x, int)] for row in rows}
    missing = [x for x in wanted if x not in graph]
    if missing:
        raise HTTPException(status_code=400, detail="A task can only wait for tasks of this workspace.")
    if task_id is not None:
        graph[task_id] = wanted
        # Walk from each dependency: reaching the task again means a loop
        seen, stack = set(), list(wanted)
        while stack:
            current = stack.pop()
            if current == task_id:
                raise HTTPException(status_code=400, detail="That would make the tasks wait for each other in a loop.")
            if current in seen:
                continue
            seen.add(current)
            stack.extend(graph.get(current, []))
    return wanted

async def check_sprint(db: AsyncSession, team_id: int, sprint_id: Optional[int]):
    if sprint_id is None:
        return
    found = (await db.execute(select(DBTeamSprint.id).where(DBTeamSprint.id == sprint_id, DBTeamSprint.team_id == team_id))).first()
    if not found:
        raise HTTPException(status_code=400, detail="That sprint is not part of this workspace.")

def task_extra_fields(task) -> dict:
    return {
        "start_date": getattr(task, "start_date", "") or "",
        "estimate_hours": getattr(task, "estimate_hours", None),
        "sprint_id": getattr(task, "sprint_id", None),
        "is_milestone": bool(getattr(task, "is_milestone", 0)),
        "depends_on": [x for x in json_array(getattr(task, "depends_on", "[]")) if isinstance(x, int)],
        "checklist": json_array(getattr(task, "checklist", "[]")),
        "done_at": getattr(task, "done_at", "") or "",
    }

COLUMN_NAMES = {"todo": "To Do", "inprogress": "In Progress", "review": "Review", "done": "Done"}

def describe_task_change(before, values: dict, members: dict) -> list:
    """Short lines for the task's history, one per thing that changed."""
    lines = []
    if "status" in values and values["status"] != (before.status or "todo"):
        lines.append(("moved", f"moved it to {COLUMN_NAMES.get(values['status'], values['status'])}"))
    if "assignee_id" in values and values["assignee_id"] != before.assignee_id:
        lines.append(("assigned", f"assigned it to {members.get(values['assignee_id'], 'someone')}" if values["assignee_id"] else "removed the assignee"))
    if ("due_date" in values and values["due_date"] != (before.due_date or "")) or ("start_date" in values and values["start_date"] != (before.start_date or "")):
        lines.append(("dated", f"set the dates to {values.get('start_date', before.start_date or '') or '…'} → {values.get('due_date', before.due_date or '') or '…'}"))
    if "sprint_id" in values and values["sprint_id"] != before.sprint_id:
        lines.append(("sprint", "moved it to the backlog" if values["sprint_id"] is None else "moved it to a sprint"))
    if "title" in values and values["title"] != (before.title or ""):
        lines.append(("edited", f"renamed it to “{values['title'][:80]}”"))
    if "priority" in values and values["priority"] != (before.priority or "medium"):
        lines.append(("edited", f"set the priority to {values['priority']}"))
    if "estimate_hours" in values and values["estimate_hours"] != before.estimate_hours:
        lines.append(("edited", f"estimated {values['estimate_hours']} h" if values["estimate_hours"] is not None else "removed the estimate"))
    if "is_milestone" in values and values["is_milestone"] != (before.is_milestone or 0):
        lines.append(("edited", "made it a milestone" if values["is_milestone"] else "made it a normal task"))
    if "depends_on" in values and values["depends_on"] != (before.depends_on or "[]"):
        lines.append(("edited", "changed what it waits for"))
    if "description" in values and values["description"] != (before.description or ""):
        lines.append(("edited", "edited the description"))
    if "checklist" in values and values["checklist"] != (before.checklist or "[]"):
        lines.append(("checklist", "updated the checklist"))
    return lines

async def record_activity(team_id: int, task_id: int, user_id: int, lines: list):
    if not lines:
        return
    now_iso = utc_now_iso()
    try:
        await run_one_off(DBTaskActivity.__table__.insert().values([
            {"task_id": task_id, "team_id": team_id, "user_id": user_id, "action": action, "detail": detail[:300], "at": now_iso} for action, detail in lines]))
    except Exception as e:
        print("Could not record task history:", e)

async def team_member_names(team_id: int) -> dict:
    rows = await fetch_one_off(select(DBTeamMember.user_id, DBUser.name).join(DBUser, DBUser.id == DBTeamMember.user_id).where(DBTeamMember.team_id == team_id))
    return {row[0]: row[1] or "Member" for row in rows}


@app.get("/api/tasks/{task_id}")
async def get_task_detail(task_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """One task with its comments, history and logged time (the task drawer)."""
    task, _ = await get_task_for_member(db, task_id, current_user_id)
    comments, activity, time_rows = await asyncio.gather(
        fetch_one_off(select(DBTaskComment, DBUser.name, DBUser.profile_pic).outerjoin(DBUser, DBUser.id == DBTaskComment.user_id)
                      .where(DBTaskComment.task_id == task_id).order_by(DBTaskComment.id)),
        fetch_one_off(select(DBTaskActivity, DBUser.name).outerjoin(DBUser, DBUser.id == DBTaskActivity.user_id)
                      .where(DBTaskActivity.task_id == task_id).order_by(DBTaskActivity.id.desc()).limit(60)),
        fetch_one_off(select(DBTimeEntry).where(DBTimeEntry.task_id == task_id).order_by(DBTimeEntry.id.desc()).limit(200)),
    )
    return {
        "task": serialize_task(task),
        "comments": [serialize_comment(c, name, pic) for c, name, pic in comments],
        "activity": [{"id": a.id, "user_id": a.user_id, "name": name or "Someone", "action": a.action, "detail": a.detail, "at": a.at} for a, name in activity],
        "time": [serialize_time(t) for (t,) in time_rows],
    }


# ---------- comments ----------
class CommentBody(BaseModel):
    body: str = ""
    attachment: Optional[str] = ""
    mentions: Optional[List[int]] = None

def serialize_comment(comment, name, picture) -> dict:
    return {"id": comment.id, "task_id": comment.task_id, "user_id": comment.user_id, "name": name or "Deleted user",
            "profile_pic": picture if picture and len(picture) < 1000 else "", "body": comment.body or "",
            "attachment": comment.attachment or "", "created_at": comment.created_at}

@app.post("/api/tasks/{task_id}/comments")
async def add_task_comment(task_id: int, body: CommentBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    task, _ = await get_task_for_member(db, task_id, current_user_id)
    text_ = clean_text(body.body, 3000, "comment")
    attachment = (body.attachment or "").strip()[:500]
    if attachment and not re.match(r"^https?://[^\s]+/static/uploads/chat/[\w.\-]+$", attachment):
        raise HTTPException(status_code=400, detail="Attach a file uploaded here.")
    if not text_ and not attachment:
        raise HTTPException(status_code=400, detail="Write something first.")
    row = (await db.execute(DBTaskComment.__table__.insert().values(task_id=task_id, team_id=task.team_id, user_id=current_user_id, body=text_,
                                                                  attachment=attachment, created_at=utc_now_iso()).returning(*DBTaskComment.__table__.c))).first()
    me = (await db.execute(select(DBUser.name, DBUser.profile_pic).where(DBUser.id == current_user_id))).first()
    comment = serialize_comment(row, me[0] if me else "", me[1] if me else "")
    await team_hub.broadcast(task.team_id, {"type": "comment_added", "comment": comment, "by": current_user_id})
    spawn_background(record_activity(task.team_id, task_id, current_user_id, [("commented", text_[:120] or "attached a file")]))
    # @mentions: only members of the workspace, never the writer
    members = await team_member_names(task.team_id)
    mentioned = [uid for uid in (body.mentions or [])[:20] if uid in members and uid != current_user_id]
    if mentioned:
        spawn_background(notify_many(mentioned, "mention", f"{comment['name']} mentioned you on “{(task.title or '')[:60]}”",
                                     f"project_management.html?team={task.team_id}&task={task_id}"))
    return comment

@app.delete("/api/comments/{comment_id}")
async def delete_task_comment(comment_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    row = (await db.execute(select(DBTaskComment).where(DBTaskComment.id == comment_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Comment not found.")
    _, role = await get_team_role(db, row.team_id, current_user_id)
    if row.user_id != current_user_id and role != "Admin":
        raise HTTPException(status_code=403, detail="Only the writer or an Admin can delete this comment.")
    await db.execute(delete(DBTaskComment).where(DBTaskComment.id == comment_id))
    await team_hub.broadcast(row.team_id, {"type": "comment_deleted", "id": comment_id, "task_id": row.task_id})
    return {"status": "deleted"}


# ---------- sprints ----------
class SprintBody(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None

class SprintCompleteBody(BaseModel):
    move_to: Optional[int] = None          # another sprint, or nothing for the backlog

def serialize_sprint(sprint) -> dict:
    return {"id": sprint.id, "team_id": sprint.team_id, "name": sprint.name or "", "goal": sprint.goal or "", "start_date": sprint.start_date or "",
            "end_date": sprint.end_date or "", "status": sprint.status or "planned", "created_at": sprint.created_at, "completed_at": sprint.completed_at or ""}

def clean_sprint(body: SprintBody, partial: bool) -> dict:
    values = {}
    if body.name is not None or not partial:
        values["name"] = clean_required(body.name, 60, "sprint name")
    if body.goal is not None:
        values["goal"] = clean_text(body.goal, 300, "sprint goal")
    if body.start_date is not None:
        values["start_date"] = clean_date(body.start_date, "start date")
    if body.end_date is not None:
        values["end_date"] = clean_date(body.end_date, "end date")
    if values.get("start_date") and values.get("end_date") and values["start_date"] > values["end_date"]:
        raise HTTPException(status_code=400, detail="The sprint must end on or after its first day.")
    return values

async def sprint_for_member(db: AsyncSession, sprint_id: int, user_id: int):
    sprint = (await db.execute(select(DBTeamSprint).where(DBTeamSprint.id == sprint_id))).scalars().first()
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found.")
    _, role = await get_team_role(db, sprint.team_id, user_id)
    return sprint, role

@app.post("/api/teams/{team_id}/sprints")
async def create_sprint(team_id: int, body: SprintBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    await get_team_role(db, team_id, current_user_id)
    values = clean_sprint(body, partial=False)
    row = (await db.execute(DBTeamSprint.__table__.insert().values(team_id=team_id, status="planned", created_at=utc_now_iso(), **values)
                            .returning(*DBTeamSprint.__table__.c))).first()
    sprint = serialize_sprint(row)
    await team_hub.broadcast(team_id, {"type": "sprint_saved", "sprint": sprint, "by": current_user_id})
    return sprint

@app.patch("/api/sprints/{sprint_id}")
async def update_sprint(sprint_id: int, body: SprintBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    sprint, _ = await sprint_for_member(db, sprint_id, current_user_id)
    values = clean_sprint(body, partial=True)
    start, end = values.get("start_date", sprint.start_date or ""), values.get("end_date", sprint.end_date or "")
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="The sprint must end on or after its first day.")
    if body.status is not None:
        if body.status not in ("planned", "active"):
            raise HTTPException(status_code=400, detail="Start a sprint, or put it back to planned. Finishing one has its own button.")
        if body.status == "active" and sprint.status != "active":
            running = (await db.execute(select(DBTeamSprint.name).where(DBTeamSprint.team_id == sprint.team_id, DBTeamSprint.status == "active",
                                                                       DBTeamSprint.id != sprint_id))).first()
            if running:
                raise HTTPException(status_code=409, detail=f"“{running[0]}” is still running. Finish it first.")
            values.setdefault("start_date", sprint.start_date or today_iso())
        values["status"] = body.status
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    row = (await db.execute(update(DBTeamSprint).where(DBTeamSprint.id == sprint_id).values(**values).returning(*DBTeamSprint.__table__.c))).first()
    saved = serialize_sprint(row)
    await team_hub.broadcast(sprint.team_id, {"type": "sprint_saved", "sprint": saved, "by": current_user_id})
    return saved

@app.post("/api/sprints/{sprint_id}/complete")
async def complete_sprint(sprint_id: int, body: SprintCompleteBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    """Finish a sprint. Tasks that are not done move to the chosen sprint, or back to the backlog."""
    sprint, _ = await sprint_for_member(db, sprint_id, current_user_id)
    if sprint.status == "done":
        raise HTTPException(status_code=400, detail="This sprint is already finished.")
    if body.move_to is not None:
        if body.move_to == sprint_id:
            raise HTTPException(status_code=400, detail="Pick another sprint for the unfinished tasks.")
        target = (await db.execute(select(DBTeamSprint.status).where(DBTeamSprint.id == body.move_to, DBTeamSprint.team_id == sprint.team_id))).first()
        if not target or target[0] == "done":
            raise HTTPException(status_code=400, detail="Unfinished tasks can only move to a sprint of this workspace that is not finished.")
    moved = (await db.execute(update(DBTeamTask).where(DBTeamTask.sprint_id == sprint_id, func.coalesce(DBTeamTask.status, "todo") != "done")
                              .values(sprint_id=body.move_to, updated_at=utc_now_iso()).returning(DBTeamTask.id))).all()
    row = (await db.execute(update(DBTeamSprint).where(DBTeamSprint.id == sprint_id).values(status="done", completed_at=utc_now_iso())
                            .returning(*DBTeamSprint.__table__.c))).first()
    saved = serialize_sprint(row)
    await team_hub.broadcast(sprint.team_id, {"type": "sprint_saved", "sprint": saved, "by": current_user_id})
    await team_hub.broadcast(sprint.team_id, {"type": "board_reload", "by": current_user_id})
    return {"sprint": saved, "moved": len(moved)}

@app.delete("/api/sprints/{sprint_id}")
async def delete_sprint(sprint_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    sprint, role = await sprint_for_member(db, sprint_id, current_user_id)
    if role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can delete a sprint. Its tasks go back to the backlog.")
    await db.execute(update(DBTeamTask).where(DBTeamTask.sprint_id == sprint_id).values(sprint_id=None))
    await db.execute(delete(DBTeamSprint).where(DBTeamSprint.id == sprint_id))
    await team_hub.broadcast(sprint.team_id, {"type": "sprint_deleted", "id": sprint_id, "by": current_user_id})
    await team_hub.broadcast(sprint.team_id, {"type": "board_reload", "by": current_user_id})
    return {"status": "deleted"}


# ---------- items: brief, risks, decisions, docs, meetings, ideas, mind maps, roles ----------
# Each kind lists its fields: (type, limit). Types: text (one line), long (many lines), date, int range,
# enum, words (list of short texts), member / members (workspace member ids), and a few kind-specific shapes.
PROJECT_ITEM_SCHEMA = {
    "brief": {"problem": ("long", 3000), "audience": ("long", 1000), "goals": ("words", (12, 300)), "scope_in": ("words", (20, 300)),
              "scope_out": ("words", (20, 300)), "deliverables": ("words", (20, 300)), "success": ("words", (12, 300)),
              "deadline": ("date", None), "stakeholders": ("words", (12, 160)), "notes": ("long", 4000)},
    "risk": {"description": ("long", 2000), "likelihood": ("int", (1, 3)), "impact": ("int", (1, 3)), "owner_id": ("member", None),
             "mitigation": ("long", 2000), "status": ("enum", ("open", "watching", "mitigated", "closed"))},
    "decision": {"context": ("long", 3000), "decision": ("long", 3000), "reasons": ("long", 3000), "alternatives": ("long", 2000),
                 "owner_id": ("member", None), "date": ("date", None), "status": ("enum", ("proposed", "decided", "reversed"))},
    "doc": {"body": ("long", 60000), "pinned": ("bool", None), "icon": ("text", 4)},
    "meeting": {"date": ("date", None), "time": ("text", 5), "attendees": ("members", None), "agenda": ("long", 4000), "notes": ("long", 20000),
                "actions": ("actions", None)},
    "idea": {"details": ("long", 1500), "column": ("text", 40), "color": ("enum", ("yellow", "blue", "green", "pink", "purple")), "task_id": ("int", (0, 2**31 - 1))},
    "mindmap": {"nodes": ("nodes", None)},
    "role": {"raci": ("raci", None), "notes": ("long", 500)},
}
ITEM_TITLE_LIMIT = 160
MAX_ITEMS_PER_TEAM = 2000

def clean_item_data(kind: str, data: dict, members: set, old: Optional[dict] = None) -> dict:
    """Keep only the kind's fields, each checked and trimmed. Fields not sent keep their old value."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="That is not a valid entry.")
    out = dict(old or {})
    for field, (kind_of, limit) in PROJECT_ITEM_SCHEMA[kind].items():
        if field not in data:
            continue
        value = data[field]
        if kind_of == "text":
            out[field] = str(value or "").strip()[:limit]
        elif kind_of == "long":
            out[field] = str(value or "")[:limit]
        elif kind_of == "bool":
            out[field] = bool(value)
        elif kind_of == "date":
            out[field] = clean_date(str(value or ""), field.replace("_", " "))
        elif kind_of == "int":
            low, high = limit
            try:
                number = int(value) if value not in (None, "") else None
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').capitalize()} must be a number.")
            if number is not None and not (low <= number <= high):
                raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').capitalize()} must be between {low} and {high}.")
            out[field] = number
        elif kind_of == "enum":
            if value not in limit:
                raise HTTPException(status_code=400, detail=f"Pick one of: {', '.join(limit)}.")
            out[field] = value
        elif kind_of == "words":
            most, each = limit
            words = [str(w).strip()[:each] for w in (value if isinstance(value, list) else []) if str(w).strip()]
            out[field] = words[:most]
        elif kind_of == "member":
            out[field] = int(value) if isinstance(value, int) and value in members else None
        elif kind_of == "members":
            out[field] = [int(v) for v in dict.fromkeys(value if isinstance(value, list) else []) if isinstance(v, int) and v in members][:50]
        elif kind_of == "actions":
            actions = []
            for a in (value if isinstance(value, list) else [])[:60]:
                if not isinstance(a, dict) or not str(a.get("text") or "").strip():
                    continue
                actions.append({"id": str(a.get("id") or uuid.uuid4().hex[:8])[:20], "text": str(a["text"]).strip()[:300],
                                "owner_id": a.get("owner_id") if a.get("owner_id") in members else None,
                                "due": clean_date(str(a.get("due") or ""), "action due date"),
                                "done": bool(a.get("done")), "task_id": a.get("task_id") if isinstance(a.get("task_id"), int) else None})
            out[field] = actions
        elif kind_of == "nodes":
            nodes, ids = [], set()
            for n in (value if isinstance(value, list) else [])[:300]:
                if not isinstance(n, dict):
                    continue
                node_id = str(n.get("id") or "")[:20]
                if not node_id or node_id in ids:
                    continue
                ids.add(node_id)
                nodes.append({"id": node_id, "text": str(n.get("text") or "").strip()[:120], "parent": str(n.get("parent") or "")[:20] or None,
                              "color": n.get("color") if n.get("color") in ("indigo", "emerald", "amber", "rose", "slate") else "indigo",
                              "collapsed": bool(n.get("collapsed"))})
            # A parent that does not exist (or a loop) puts the node under the root
            parents = {n["id"]: n["parent"] for n in nodes}
            root = nodes[0]["id"] if nodes else None
            for n in nodes:
                seen, current = set(), n["parent"]
                while current and current not in seen:
                    seen.add(current)
                    current = parents.get(current) if current in parents else None
                if n["id"] == root:
                    n["parent"] = None
                elif not n["parent"] or n["parent"] not in parents or n["id"] in seen:
                    n["parent"] = root
            out[field] = nodes
        elif kind_of == "raci":
            raci = {}
            for key, letter in (value.items() if isinstance(value, dict) else []):
                try:
                    uid = int(key)
                except (TypeError, ValueError):
                    continue
                if uid in members and letter in ("R", "A", "C", "I"):
                    raci[str(uid)] = letter
            out[field] = raci
    return out

def serialize_item(item) -> dict:
    return {"id": item.id, "team_id": item.team_id, "kind": item.kind, "title": item.title or "", "data": json_object(item.data),
            "position": item.position or 0, "created_by": item.created_by, "updated_by": item.updated_by,
            "created_at": item.created_at, "updated_at": item.updated_at}

class ItemBody(BaseModel):
    kind: Optional[str] = None
    title: Optional[str] = None
    data: Optional[dict] = None
    position: Optional[float] = None
    base_updated_at: Optional[str] = None     # the version the editor started from; a newer one on the server gives 409

async def team_member_ids(db: AsyncSession, team_id: int) -> set:
    return {row[0] for row in (await db.execute(select(DBTeamMember.user_id).where(DBTeamMember.team_id == team_id))).all()}

@app.post("/api/teams/{team_id}/items")
async def create_project_item(team_id: int, body: ItemBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    await get_team_role(db, team_id, current_user_id)
    if body.kind not in PROJECT_ITEM_SCHEMA:
        raise HTTPException(status_code=400, detail="Unknown kind of entry.")
    count = (await db.execute(select(func.count()).select_from(DBProjectItem).where(DBProjectItem.team_id == team_id))).scalar() or 0
    if count >= MAX_ITEMS_PER_TEAM:
        raise HTTPException(status_code=400, detail="This workspace has reached its limit of plan entries.")
    if body.kind == "brief":
        existing = (await db.execute(select(DBProjectItem).where(DBProjectItem.team_id == team_id, DBProjectItem.kind == "brief"))).scalars().first()
        if existing:
            raise HTTPException(status_code=409, detail="This workspace already has a brief.")
    title = clean_text(body.title, ITEM_TITLE_LIMIT, "title") or {"brief": "Project brief", "doc": "Untitled page", "mindmap": "Mind map"}.get(body.kind, "")
    if not title and body.kind not in ("idea",):
        raise HTTPException(status_code=400, detail="Give it a title.")
    data = clean_item_data(body.kind, body.data or {}, await team_member_ids(db, team_id))
    if body.kind == "idea":
        data["votes"] = []
    now_iso = utc_now_iso()
    position = body.position if body.position is not None and math.isfinite(body.position) else \
        (await db.execute(select(func.coalesce(func.max(DBProjectItem.position), 0) + 1).where(DBProjectItem.team_id == team_id, DBProjectItem.kind == body.kind))).scalar()
    row = (await db.execute(DBProjectItem.__table__.insert().values(team_id=team_id, kind=body.kind, title=title, data=json.dumps(data), position=position,
                                                                  created_by=current_user_id, updated_by=current_user_id, created_at=now_iso, updated_at=now_iso)
                            .returning(*DBProjectItem.__table__.c))).first()
    item = serialize_item(row)
    await team_hub.broadcast(team_id, {"type": "item_saved", "item": item, "by": current_user_id})
    return item

@app.patch("/api/items/{item_id}")
async def update_project_item(item_id: int, body: ItemBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    item = (await db.execute(select(DBProjectItem).where(DBProjectItem.id == item_id))).scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="That entry was deleted.")
    await get_team_role(db, item.team_id, current_user_id)
    values = {}
    if body.title is not None:
        title = clean_text(body.title, ITEM_TITLE_LIMIT, "title")
        if not title and item.kind != "idea":
            raise HTTPException(status_code=400, detail="Give it a title.")
        values["title"] = title
    if body.data is not None:
        old = json_object(item.data)
        data = clean_item_data(item.kind, body.data, await team_member_ids(db, item.team_id), old)
        if item.kind == "idea":
            data["votes"] = old.get("votes", [])       # votes only change through the vote button
        values["data"] = json.dumps(data)
    if body.position is not None and math.isfinite(body.position):
        values["position"] = body.position
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    values.update(updated_by=current_user_id, updated_at=utc_now_iso())
    statement = update(DBProjectItem).where(DBProjectItem.id == item_id)
    if body.base_updated_at:
        statement = statement.where(DBProjectItem.updated_at == body.base_updated_at)
    row = (await db.execute(statement.values(**values).returning(*DBProjectItem.__table__.c))).first()
    if not row:
        # Someone else saved first: hand back their version so the page can offer to reload or overwrite
        current = (await db.execute(select(DBProjectItem, DBUser.name).outerjoin(DBUser, DBUser.id == DBProjectItem.updated_by)
                                    .where(DBProjectItem.id == item_id))).first()
        if not current:
            raise HTTPException(status_code=404, detail="That entry was deleted.")
        raise HTTPException(status_code=409, detail={"message": f"{current[1] or 'A teammate'} changed this while you were editing.", "item": serialize_item(current[0])})
    saved = serialize_item(row)
    await team_hub.broadcast(item.team_id, {"type": "item_saved", "item": saved, "by": current_user_id})
    return saved

@app.delete("/api/items/{item_id}")
async def delete_project_item(item_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    item = (await db.execute(select(DBProjectItem).where(DBProjectItem.id == item_id))).scalars().first()
    if not item:
        return {"status": "deleted"}
    _, role = await get_team_role(db, item.team_id, current_user_id)
    if item.created_by != current_user_id and role != "Admin":
        raise HTTPException(status_code=403, detail="Only the person who added it or an Admin can delete this.")
    await db.execute(delete(DBProjectItem).where(DBProjectItem.id == item_id))
    await team_hub.broadcast(item.team_id, {"type": "item_deleted", "id": item_id, "kind": item.kind, "by": current_user_id})
    return {"status": "deleted"}

@app.post("/api/items/{item_id}/vote")
async def vote_on_idea(item_id: int, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    """Vote for an idea, or take the vote back. The row is locked so two votes at once both count."""
    item = (await db.execute(select(DBProjectItem).where(DBProjectItem.id == item_id).with_for_update())).scalars().first()
    if not item or item.kind != "idea":
        raise HTTPException(status_code=404, detail="That idea was deleted.")
    await get_team_role(db, item.team_id, current_user_id)
    data = json_object(item.data)
    votes = [v for v in data.get("votes", []) if isinstance(v, int)]
    voted = current_user_id not in votes
    data["votes"] = votes + [current_user_id] if voted else [v for v in votes if v != current_user_id]
    item.data = json.dumps(data)
    item.updated_at = utc_now_iso()
    await db.commit()
    saved = serialize_item(item)
    await team_hub.broadcast(item.team_id, {"type": "item_saved", "item": saved, "by": current_user_id})
    return {"voted": voted, "item": saved}


# ---------- time ----------
class TimerBody(BaseModel):
    task_id: Optional[int] = None
    note: Optional[str] = ""

class TimeLogBody(BaseModel):
    task_id: Optional[int] = None
    minutes: int
    day: Optional[str] = ""
    note: Optional[str] = ""

MAX_TIMER_MINUTES = 12 * 60     # a timer left running overnight counts as at most 12 hours

def serialize_time(entry) -> dict:
    return {"id": entry.id, "team_id": entry.team_id, "task_id": entry.task_id, "user_id": entry.user_id, "started_at": entry.started_at,
            "ended_at": entry.ended_at or "", "minutes": entry.minutes or 0, "note": entry.note or "", "day": entry.day or ""}

async def check_task_in_team(db: AsyncSession, team_id: int, task_id: Optional[int]):
    if task_id is None:
        return
    if not (await db.execute(select(DBTeamTask.id).where(DBTeamTask.id == task_id, DBTeamTask.team_id == team_id))).first():
        raise HTTPException(status_code=400, detail="That task is not part of this workspace.")

async def stop_running_timer(db: AsyncSession, user_id: int) -> Optional["DBTimeEntry"]:
    running = (await db.execute(select(DBTimeEntry).where(DBTimeEntry.user_id == user_id, DBTimeEntry.ended_at == "").with_for_update())).scalars().all()
    stopped = None
    for entry in running:
        started = parse_timestamp(entry.started_at)
        minutes = max(0, min(MAX_TIMER_MINUTES, round((datetime.now(timezone.utc) - started).total_seconds() / 60)))
        entry.ended_at = utc_now_iso()
        entry.minutes = minutes
        stopped = entry
    return stopped

@app.post("/api/teams/{team_id}/time/start")
async def start_timer(team_id: int, body: TimerBody, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    """Start a timer. A person has one running timer at a time, so any other one stops first."""
    await get_team_role(db, team_id, current_user_id)
    await check_task_in_team(db, team_id, body.task_id)
    stopped = await stop_running_timer(db, current_user_id)
    now = datetime.now(timezone.utc)
    entry = DBTimeEntry(team_id=team_id, task_id=body.task_id, user_id=current_user_id, started_at=now.isoformat(), ended_at="", minutes=0,
                        note=clean_text(body.note, 200, "note"), day=site_now().date().isoformat())
    db.add(entry)
    await db.commit()
    if stopped:
        await team_hub.broadcast(stopped.team_id, {"type": "time_changed", "entry": serialize_time(stopped), "by": current_user_id})
    started = serialize_time(entry)
    await team_hub.broadcast(team_id, {"type": "time_changed", "entry": started, "by": current_user_id})
    return {"running": started, "stopped": serialize_time(stopped) if stopped else None}

@app.post("/api/time/stop")
async def stop_timer(db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    stopped = await stop_running_timer(db, current_user_id)
    await db.commit()
    if not stopped:
        return {"stopped": None}
    entry = serialize_time(stopped)
    await team_hub.broadcast(stopped.team_id, {"type": "time_changed", "entry": entry, "by": current_user_id})
    return {"stopped": entry}

@app.post("/api/teams/{team_id}/time")
async def log_time(team_id: int, body: TimeLogBody, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    await get_team_role(db, team_id, current_user_id)
    await check_task_in_team(db, team_id, body.task_id)
    if not (1 <= body.minutes <= 24 * 60):
        raise HTTPException(status_code=400, detail="Log between 1 minute and 24 hours.")
    day = clean_date(body.day, "day") or site_now().date().isoformat()
    now_iso = utc_now_iso()
    row = (await db.execute(DBTimeEntry.__table__.insert().values(team_id=team_id, task_id=body.task_id, user_id=current_user_id, started_at=now_iso,
                                                                ended_at=now_iso, minutes=body.minutes, note=clean_text(body.note, 200, "note"), day=day)
                            .returning(*DBTimeEntry.__table__.c))).first()
    entry = serialize_time(row)
    await team_hub.broadcast(team_id, {"type": "time_changed", "entry": entry, "by": current_user_id})
    return entry

@app.delete("/api/time/{entry_id}")
async def delete_time(entry_id: int, db: AsyncSession = Depends(get_fast_db), current_user_id: int = Depends(get_current_user_id)):
    entry = (await db.execute(select(DBTimeEntry).where(DBTimeEntry.id == entry_id))).scalars().first()
    if not entry:
        return {"status": "deleted"}
    if entry.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own time.")
    await db.execute(delete(DBTimeEntry).where(DBTimeEntry.id == entry_id))
    await team_hub.broadcast(entry.team_id, {"type": "time_deleted", "id": entry_id, "by": current_user_id})
    return {"status": "deleted"}


# ---------- templates ----------
# Offsets are days from today. Tasks name their sprint (1, 2 ...) or None for the backlog, and may wait for earlier tasks (by index).
PROJECT_TEMPLATES = {
    "college": {
        "name": "College project", "description": "A semester project with a report, a working demo and a viva.",
        "brief": {"problem": "", "goals": ["A working prototype that solves the problem", "A clear report and presentation", "Every member can explain every part"],
                  "deliverables": ["Synopsis", "Working prototype", "Project report", "Presentation and viva"],
                  "success": ["Guide approves the synopsis", "Demo runs without help", "Report submitted on time"], "deadline_days": 90},
        "sprints": [("Sprint 1 · Research", 14, "Pick the problem and get the synopsis approved"), ("Sprint 2 · Build", 28, "A first working version"),
                    ("Sprint 3 · Polish", 21, "Testing, report and presentation")],
        "tasks": [("Pick the problem statement and title", 1, 0, 3, "Research", None), ("Read 5 related papers or projects", 1, 2, 7, "Research", [0]),
                  ("Write and submit the synopsis", 1, 7, 12, "Docs", [1]), ("Synopsis approved", 1, 14, 14, "Docs", [2], True),
                  ("Design the system (diagrams, database)", 2, 15, 20, "Design", [3]), ("Build the core features", 2, 18, 38, "Backend", [4]),
                  ("Build the screens", 2, 20, 40, "Frontend", [4]), ("First working demo", 2, 42, 42, "Docs", [5, 6], True),
                  ("Test and fix bugs", 3, 43, 52, "QA", [7]), ("Write the project report", 3, 43, 58, "Docs", [7]),
                  ("Make the presentation", 3, 55, 60, "Docs", [9]), ("Final submission and viva", 3, 63, 63, "Docs", [8, 10], True)],
        "risks": [("A member is busy with exams", 3, 2, "Plan around the exam timetable; keep a buffer week before each deadline."),
                  ("Guide changes the scope late", 2, 3, "Get the synopsis signed; write down every scope change in Decisions.")],
        "docs": [("Meeting notes with the guide", "## What the guide said\n\n- \n\n## What we must change\n\n- ")],
    },
    "hackathon": {
        "name": "Hackathon", "description": "A 24 to 48 hour build with a demo at the end.",
        "brief": {"goals": ["A demo that works live", "A clear 3-minute pitch"], "deliverables": ["Working demo", "Pitch deck", "Repository with a README"],
                  "success": ["Demo works on stage", "Judges understand the idea in one minute"], "deadline_days": 2},
        "sprints": [("Hackathon", 2, "Ship the demo")],
        "tasks": [("Agree on the idea and the one main feature", 1, 0, 0, "Idea", None), ("Set up the repository and deploy a hello world", 1, 0, 0, "DevOps", [0]),
                  ("Build the main feature", 1, 0, 1, "Backend", [1]), ("Build the screen people will see", 1, 0, 1, "Frontend", [1]),
                  ("Feature freeze", 1, 1, 1, "Idea", [2, 3], True), ("Make the pitch deck", 1, 1, 1, "Docs", [0]),
                  ("Rehearse the demo twice", 1, 1, 2, "Docs", [4, 5]), ("Submit", 1, 2, 2, "Docs", [6], True)],
        "risks": [("The live demo breaks on stage", 2, 3, "Record a backup video of the demo; freeze features early.")],
        "docs": [("Pitch outline", "## Problem\n\n## Our solution\n\n## Demo\n\n## Why it matters\n\n## Team")],
    },
    "startup": {
        "name": "Startup MVP", "description": "From an idea to the first users in about two months.",
        "brief": {"goals": ["Talk to 20 possible users", "Launch an MVP", "Get the first 50 users"], "deliverables": ["User interview notes", "MVP", "Landing page"],
                  "success": ["10 people use it every week", "Users would be disappointed without it"], "deadline_days": 60},
        "sprints": [("Sprint 1 · Discover", 14, "Learn what users really need"), ("Sprint 2 · Build", 21, "The smallest product worth using"),
                    ("Sprint 3 · Launch", 14, "First users and their feedback")],
        "tasks": [("Write down the problem and who has it", 1, 0, 2, "Research", None), ("Interview 20 possible users", 1, 2, 12, "Research", [0]),
                  ("Decide the one feature to build first", 1, 12, 14, "Product", [1], True), ("Design the screens", 2, 15, 19, "Design", [2]),
                  ("Build the MVP", 2, 18, 33, "Backend", [3]), ("Make a landing page", 2, 25, 30, "Frontend", [2]),
                  ("MVP ready", 2, 35, 35, "Product", [4], True), ("Invite the first users", 3, 36, 42, "Growth", [6]),
                  ("Collect feedback and fix the top 3 issues", 3, 40, 48, "Product", [7]), ("Decide what to build next", 3, 49, 49, "Product", [8], True)],
        "risks": [("Nobody really needs it", 2, 3, "Interview before building; decide on evidence, not opinions."),
                  ("The build takes longer than planned", 3, 2, "Cut features, not quality. Keep the scope list in the brief.")],
        "docs": [("Interview questions", "## Ask\n\n1. Tell me about the last time you had this problem.\n2. What did you do about it?\n3. What did that cost you?\n\n## Never ask\n\n- Would you use my app?")],
    },
    "research": {
        "name": "Research paper", "description": "A literature review, an experiment and a paper ready to submit.",
        "brief": {"goals": ["A clear research question", "Results that answer it", "A paper ready for a journal or conference"],
                  "deliverables": ["Literature review", "Experiment and data", "Paper draft", "Final paper"], "success": ["Supervisor approves the draft", "Paper submitted"], "deadline_days": 120},
        "sprints": [("Sprint 1 · Literature", 28, "Know what has been done"), ("Sprint 2 · Experiment", 42, "Results"), ("Sprint 3 · Writing", 35, "A paper to submit")],
        "tasks": [("Write the research question", 1, 0, 5, "Research", None), ("Collect and read 20 papers", 1, 3, 24, "Research", [0]),
                  ("Write the literature review", 1, 18, 28, "Writing", [1], ), ("Research question approved", 1, 28, 28, "Research", [2], True),
                  ("Design the experiment", 2, 29, 36, "Method", [3]), ("Collect the data", 2, 36, 60, "Method", [4]), ("Analyse the results", 2, 55, 70, "Analysis", [5]),
                  ("Write the first draft", 3, 70, 90, "Writing", [6]), ("Supervisor feedback", 3, 92, 95, "Writing", [7], True),
                  ("Revise and format for the venue", 3, 95, 103, "Writing", [8]), ("Submit the paper", 3, 105, 105, "Writing", [9], True)],
        "risks": [("Not enough data", 2, 3, "Plan a smaller backup experiment; ask the supervisor early.")],
        "docs": [("Reading list", "## Papers\n\n| Paper | Year | Key idea | Useful for |\n|---|---|---|---|\n")],
    },
}

class TemplateBody(BaseModel):
    template: str

@app.get("/api/project-templates")
async def list_project_templates(current_user_id: int = Depends(get_current_user_id)):
    return {"templates": [{"key": key, "name": t["name"], "description": t["description"], "tasks": len(t["tasks"]), "sprints": len(t["sprints"]),
                           "milestones": sum(1 for task in t["tasks"] if len(task) > 6 and task[6]), "task_titles": [task[0] for task in t["tasks"]]}
                          for key, t in PROJECT_TEMPLATES.items()]}

@app.post("/api/teams/{team_id}/apply-template")
async def apply_project_template(team_id: int, body: TemplateBody, db: AsyncSession = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    """Fill the workspace's plan from a template: brief, sprints, tasks with dates and dependencies, risks and a doc. Admins only."""
    await require_team_admin(db, team_id, current_user_id)
    template = PROJECT_TEMPLATES.get(body.template)
    if not template:
        raise HTTPException(status_code=400, detail="Unknown template.")
    today = site_now().date()
    day = lambda offset: (today + timedelta(days=offset)).isoformat()
    now_iso = utc_now_iso()

    # Sprints follow each other from today
    sprint_ids, start = [], 0
    for index, (name, length, goal) in enumerate(template["sprints"]):
        sprint = DBTeamSprint(team_id=team_id, name=name, goal=goal, start_date=day(start), end_date=day(start + length - 1),
                              status="active" if index == 0 else "planned", created_at=now_iso)
        if index == 0 and (await db.execute(select(DBTeamSprint.id).where(DBTeamSprint.team_id == team_id, DBTeamSprint.status == "active"))).first():
            sprint.status = "planned"
        db.add(sprint)
        await db.flush()
        sprint_ids.append(sprint.id)
        start += length

    # A task never starts before what it waits for is due (same day is fine); its due date moves along if needed
    starts, dues = [], []
    for task in template["tasks"]:
        waits = task[5] if len(task) > 5 and task[5] else []
        start_day = max([task[2]] + [dues[i] for i in waits])
        starts.append(start_day)
        dues.append(max(task[3], start_day))

    # Tasks, then their dependencies once every id is known
    base = (await db.execute(select(func.coalesce(func.max(DBTeamTask.position), 0)).where(DBTeamTask.team_id == team_id, DBTeamTask.status == "todo"))).scalar() or 0
    task_ids = []
    for index, task in enumerate(template["tasks"]):
        title, sprint_no, start_day, due_day, tag = task[0], task[1], starts[index], dues[index], task[4]
        row = DBTeamTask(team_id=team_id, title=title, description="", status="todo", position=base + index + 1, tag=tag[:30], priority="medium",
                         due_date=day(due_day), start_date=day(start_day), sprint_id=sprint_ids[sprint_no - 1] if sprint_no else None,
                         is_milestone=1 if len(task) > 6 and task[6] else 0, depends_on="[]", checklist="[]", done_at="",
                         created_by=current_user_id, created_at=now_iso, updated_at=now_iso)
        db.add(row)
        await db.flush()
        task_ids.append(row.id)
    for index, task in enumerate(template["tasks"]):
        waits = task[5] if len(task) > 5 and task[5] else []
        if waits:
            await db.execute(update(DBTeamTask).where(DBTeamTask.id == task_ids[index]).values(depends_on=json.dumps([task_ids[i] for i in waits])))

    # The brief (only if there is none yet), risks and docs
    brief = dict(template["brief"])
    deadline = day(brief.pop("deadline_days", 60))
    if not (await db.execute(select(DBProjectItem.id).where(DBProjectItem.team_id == team_id, DBProjectItem.kind == "brief"))).first():
        db.add(DBProjectItem(team_id=team_id, kind="brief", title="Project brief", data=json.dumps({**brief, "deadline": deadline}), position=1,
                             created_by=current_user_id, updated_by=current_user_id, created_at=now_iso, updated_at=now_iso))
    for index, (title, likelihood, impact, mitigation) in enumerate(template.get("risks", [])):
        db.add(DBProjectItem(team_id=team_id, kind="risk", title=title, position=index + 1, created_by=current_user_id, updated_by=current_user_id,
                             created_at=now_iso, updated_at=now_iso,
                             data=json.dumps({"description": "", "likelihood": likelihood, "impact": impact, "owner_id": None, "mitigation": mitigation, "status": "open"})))
    for index, (title, doc_body) in enumerate(template.get("docs", [])):
        db.add(DBProjectItem(team_id=team_id, kind="doc", title=title, position=index + 1, created_by=current_user_id, updated_by=current_user_id,
                             created_at=now_iso, updated_at=now_iso, data=json.dumps({"body": doc_body, "pinned": False, "icon": ""})))
    await db.commit()
    await team_hub.broadcast(team_id, {"type": "board_reload", "by": current_user_id})
    return {"tasks": len(task_ids), "sprints": len(sprint_ids)}


# Every column USER_DATA names (section 26) must exist; checked here, once every table above is defined
for _table, _columns in list(USER_DATA_ERASED.items()) + list(USER_DATA_KEPT.items()):
    for _column in _columns:
        assert _column in Base.metadata.tables[_table].c, f"USER_DATA names {_table}.{_column}, which does not exist"


# ==========================================
# 28. HELPER BOT (helpbot.js)
# ==========================================
# The helper bot works in the browser without any of this: it answers from helpbot_kb.json, looks things up through
# the person's own endpoints and asks before it changes anything. When ANTHROPIC_API_KEY is set in .env (and the
# `anthropic` package is installed) it can also hold a real conversation through Claude, here. The same knowledge
# base is the model's source of truth. The model only reads the person's own data; anything that would change
# something comes back to the browser as a card the person confirms, and the browser then calls the normal endpoint.
HELPBOT_MODEL = "claude-opus-5-5"
HELPBOT_MEMBER_DAILY = 40           # AI answers per account per day (India time), then the built-in guide answers
HELPBOT_VISITOR_DAILY = 10          # per internet address per day for people who are not logged in
HELPBOT_MAX_TURNS = 12
HELPBOT_MAX_ROUNDS = 5              # model calls per question (tool use)
HELPBOT_KB_FILE = "helpbot_kb.json"
helpbot_state = {"client": None, "kb": None, "kb_mtime": 0.0, "visitors": {}, "visitor_day": ""}


def helpbot_client():
    """The Claude client, or None when AI is not set up. A key added to .env later is picked up without a restart."""
    load_dotenv(override=False)
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    if helpbot_state["client"] is None:
        try:
            import anthropic
        except ImportError:
            return None
        helpbot_state["client"] = anthropic.AsyncAnthropic(max_retries=2, timeout=60.0)
    return helpbot_state["client"]

def helpbot_kb() -> dict:
    try:
        mtime = os.path.getmtime(HELPBOT_KB_FILE)
        if helpbot_state["kb"] is None or mtime != helpbot_state["kb_mtime"]:
            with open(HELPBOT_KB_FILE, encoding="utf-8") as handle:
                helpbot_state["kb"] = json.load(handle)
            helpbot_state["kb_mtime"] = mtime
    except (OSError, ValueError) as e:
        print("Could not read the helper bot's knowledge base:", e)
        helpbot_state["kb"] = helpbot_state["kb"] or {"articles": []}
    return helpbot_state["kb"]

def helpbot_system_text() -> str:
    """The stable part of the instructions: who the helper is and everything it knows about the site. Cached."""
    articles = helpbot_kb().get("articles", [])
    lines = [f"[{a['id']}] {a['title']} (page: {a['page']}; for: {a['audience']}): {a['answer']}" for a in articles]
    return (
        "You are the Connect2Minds helper, a friendly guide inside the Connect2Minds website: a place where Indian college "
        "students and professionals find teammates, chat and call, plan projects in teams (Project Hub), work with their "
        "teachers (College Hub) and track their studies (My Study).\n\n"
        "How to answer:\n"
        "- Keep answers short: two to four sentences, plain words, no headings. **Bold** is fine for a button or page name.\n"
        "- The site knowledge below is the truth about what the site can do. Do not invent features, prices or rules. "
        "If something is not covered, say you are not sure and suggest the Support page (article id support).\n"
        "- When a page or tool would help, call go_to with the matching article id; the person then gets a button that "
        "opens it and highlights what to press. Mention that in one short phrase.\n"
        "- For questions about the person's own things (what is due, classes, attendance, unread messages, project tasks, "
        "people with a skill), use the lookup tools instead of guessing. Never show data that is not the person's own.\n"
        "- You cannot change anything yourself. To add a planner task, mark attendance, start or stop a timer or create a "
        "project task, call propose_action: the person sees a card and must confirm it. Say that they need to confirm; "
        "never say it is done.\n"
        "- Reply in the language the person writes in (English, Hindi or Hinglish).\n"
        "- Gently decline requests unrelated to the site or studies, like writing whole assignments for someone (the "
        "honour code asks students to do their own work); explaining a concept briefly is fine.\n\n"
        "Site knowledge (article id, title, page, who it is for, facts):\n" + "\n".join(lines)
    )

HELPBOT_ACTION_TYPES = ["add_study_task", "mark_attendance", "start_timer", "stop_timer", "create_project_task"]

def helpbot_tools(member: bool) -> list:
    nullable = lambda kind, text: {"type": [kind, "null"], "description": text}
    tools = [{
        "name": "go_to",
        "description": "Offer the person a button that opens the page or tool of one site-knowledge article and highlights what to press.",
        "input_schema": {"type": "object", "properties": {"article_id": {"type": "string", "description": "An article id from the site knowledge."}},
                         "required": ["article_id"], "additionalProperties": False},
    }]
    if member:
        empty = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
        tools += [
            {"name": "my_today", "description": "What needs the person today: College Hub work, polls, unread messages, today's classes, the week's numbers.", "input_schema": empty},
            {"name": "my_study", "description": "The person's My Study data: subjects with attendance and how many classes they can miss or must attend, today's classes and planner items due in the next two weeks.",
             "input_schema": {"type": "object", "properties": {"subject": nullable("string", "Only this subject (part of its name), or null for all.")},
                              "required": ["subject"], "additionalProperties": False}},
            {"name": "my_unread", "description": "Who has sent the person messages they have not read yet.", "input_schema": empty},
            {"name": "my_project_tasks", "description": "Project Hub tasks assigned to the person that are not done, across their teams, soonest due first.", "input_schema": empty},
            {"name": "find_people", "description": "Find people on the site who list a skill (and optionally study at a college).",
             "input_schema": {"type": "object", "properties": {"skill": {"type": "string"}, "college": nullable("string", "Part of a college name, or null.")},
                              "required": ["skill", "college"], "additionalProperties": False}},
            {"name": "propose_action", "description": "Show the person a card to confirm a change. Nothing changes until they press Confirm. Fill only the fields the action needs.",
             "input_schema": {"type": "object", "additionalProperties": False,
                              "required": ["type", "title", "due_date", "subject", "status", "team"],
                              "properties": {
                                  "type": {"type": "string", "enum": HELPBOT_ACTION_TYPES},
                                  "title": nullable("string", "Task title (add_study_task, create_project_task)."),
                                  "due_date": nullable("string", "YYYY-MM-DD (add_study_task, create_project_task)."),
                                  "subject": nullable("string", "Subject name (mark_attendance, optional for add_study_task)."),
                                  "status": nullable("string", "present, absent or cancelled (mark_attendance)."),
                                  "team": nullable("string", "Team name (start_timer, create_project_task), or null for the person's only/last team."),
                              }}},
        ]
    return [{**tool, "strict": True, "eager_input_streaming": True} for tool in tools]


# ---------- what the lookup tools return (always the asking person's own data) ----------
async def helpbot_my_today(user_id: int) -> dict:
    home = await build_home(user_id)
    return {"today": home["today"], "needs": [{"title": n["title"], "detail": n["detail"], "due": n.get("due", "")} for n in home["needs"][:12]],
            "classes_today": home.get("classes", [])[:10], "week": home["week"]}

async def helpbot_my_study(user_id: int, subject: Optional[str]) -> dict:
    study = await get_study(current_user_id=user_id)
    wanted = (subject or "").strip().lower()
    names = {s["id"]: s["name"] for s in study["subjects"]}
    subjects = []
    for s in study["subjects"]:
        if s["archived"] or (wanted and wanted not in s["name"].lower()):
            continue
        state = attendance_state(s["base_attended"] + s["present"], s["absent"] + (s["base_total"] - s["base_attended"]), s["goal"])
        subjects.append({"subject": s["name"], "goal_percent": s["goal"], **state})
    until = (datetime.fromisoformat(study["today"]) + timedelta(days=14)).date().isoformat()
    return {
        "today": study["today"],
        "subjects": subjects,
        "classes_today": [{"subject": names.get(slot["subject_id"], ""), "start": slot["start_time"], "end": slot["end_time"], "room": slot["room"]}
                          for slot in study["slots"] if slot["weekday"] == study["weekday"]],
        "due_soon": [{"title": t["title"], "kind": t["kind"], "due": t["due_date"], "subject": names.get(t["subject_id"], "")}
                     for t in study["tasks"] if not t["done"] and t["due_date"] and t["due_date"] <= until][:15],
        "college_deadlines": [{"title": d.get("title", ""), "due": d.get("due", "")} for d in study.get("hub_deadlines", [])][:10],
    }

async def helpbot_my_unread(user_id: int) -> dict:
    rows = await fetch_one_off(select(DBUser.name, func.count()).join(DBUser, DBUser.id == DBMessage.sender_id)
                               .where(DBMessage.receiver_id == user_id, func.coalesce(DBMessage.message_status, "sent") != "read")
                               .group_by(DBUser.name).order_by(func.count().desc()).limit(10))
    return {"unread": [{"from": name or "Someone", "messages": count} for name, count in rows], "total": sum(c for _, c in rows)}

async def helpbot_my_project_tasks(user_id: int) -> dict:
    rows = await fetch_one_off(select(DBTeamTask.title, DBTeamTask.status, DBTeamTask.due_date, DBTeam.name)
                               .join(DBTeam, DBTeam.id == DBTeamTask.team_id)
                               .join(DBTeamMember, and_(DBTeamMember.team_id == DBTeamTask.team_id, DBTeamMember.user_id == user_id))
                               .where(DBTeamTask.assignee_id == user_id, func.coalesce(DBTeamTask.status, "todo") != "done")
                               .order_by(func.coalesce(func.nullif(DBTeamTask.due_date, ""), "9999"), DBTeamTask.id).limit(20))
    return {"tasks": [{"title": t, "status": COLUMN_NAMES.get(s or "todo", s), "due": d or "", "team": team} for t, s, d, team in rows]}

async def helpbot_find_people(user_id: int, skill: str, college: Optional[str]) -> dict:
    skill = (skill or "").strip().lower()[:40]
    if not skill:
        return {"people": []}
    conditions = [func.lower(func.coalesce(DBUser.skills, "")).like(f"%{skill}%")]
    if college and college.strip():
        conditions.append(func.lower(func.coalesce(DBUser.college_name, "")).like(f"%{college.strip().lower()[:80]}%"))
    rows = await fetch_one_off(person_cards_query(user_id, *conditions).limit(8))
    return {"people": [{"name": r.name, "college": r.college_name or "", "skills": (r.skills or "")[:120], "profile": f"profile.html?id={r.id}"} for r in rows]}


# ---------- the conversation ----------
class HelpbotTurn(BaseModel):
    role: str
    text: str

class HelpbotChat(BaseModel):
    messages: List[HelpbotTurn]
    page: Optional[str] = ""

@app.get("/api/helpbot/status")
async def helpbot_status():
    return {"ai": helpbot_client() is not None}

def helpbot_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

async def helpbot_take_quota(request: Request, user_id: Optional[int]) -> bool:
    """Counts one AI answer. False when today's allowance is used up (the browser then answers itself)."""
    day = site_now().date().isoformat()
    if user_id:
        rows = await run_returning(pg_insert(DBUsageCounter).values(user_id=user_id, metric="helpbot", period=day, count=1)
                                   .on_conflict_do_update(index_elements=["user_id", "metric", "period"], set_={"count": DBUsageCounter.count + 1})
                                   .returning(DBUsageCounter.count))
        return rows[0][0] <= HELPBOT_MEMBER_DAILY
    if helpbot_state["visitor_day"] != day:
        helpbot_state["visitor_day"], helpbot_state["visitors"] = day, {}
    address = get_remote_address(request)
    helpbot_state["visitors"][address] = helpbot_state["visitors"].get(address, 0) + 1
    return helpbot_state["visitors"][address] <= HELPBOT_VISITOR_DAILY

async def helpbot_run_tool(name: str, args, user_id: Optional[int], article_ids: set):
    """Runs one tool. Returns (result for the model, event for the browser or None)."""
    if not isinstance(args, dict):
        return {"error": "The tool input was not readable."}, None
    if name == "go_to":
        article_id = args.get("article_id")
        if article_id not in article_ids:
            return {"error": f"There is no article {article_id!r}. Use an id from the site knowledge."}, None
        return {"shown": "The person now has a button to open it."}, {"type": "navigate", "article": article_id}
    if not user_id:
        return {"error": "The person is not logged in, so their own data is not available. Suggest logging in or signing up."}, None
    if name == "my_today":
        return await helpbot_my_today(user_id), None
    if name == "my_study":
        subject = args.get("subject")
        return await helpbot_my_study(user_id, subject if isinstance(subject, str) else None), None
    if name == "my_unread":
        return await helpbot_my_unread(user_id), None
    if name == "my_project_tasks":
        return await helpbot_my_project_tasks(user_id), None
    if name == "find_people":
        if not isinstance(args.get("skill"), str):
            return {"error": "Give a skill to search for."}, None
        return await helpbot_find_people(user_id, args["skill"], args.get("college") if isinstance(args.get("college"), str) else None), None
    if name == "propose_action":
        if args.get("type") not in HELPBOT_ACTION_TYPES:
            return {"error": "Unknown action."}, None
        card = {k: (str(v)[:160] if v is not None else None) for k, v in args.items() if k in ("type", "title", "due_date", "subject", "status", "team")}
        return {"shown": "The person sees a card with Confirm and Cancel. Nothing has been changed yet."}, {"type": "action_card", "action": card}
    return {"error": f"Unknown tool {name}."}, None

@app.post("/api/helpbot/chat")
@limiter.limit("12/minute", key_func=account_rate_key)
async def helpbot_chat(request: Request, body: HelpbotChat):
    client = helpbot_client()
    if client is None:
        raise HTTPException(status_code=503, detail="The AI helper is not switched on. The built-in guide answers instead.")
    user_id = optional_user_id(request)
    turns = [t for t in body.messages[-HELPBOT_MAX_TURNS:] if t.role in ("user", "assistant") and t.text.strip()]
    while turns and turns[0].role != "user":
        turns.pop(0)
    if not turns or turns[-1].role != "user":
        raise HTTPException(status_code=400, detail="Ask a question first.")
    if not await helpbot_take_quota(request, user_id):
        raise HTTPException(status_code=429, detail="The AI helper has answered a lot today. The built-in guide answers until tomorrow.")

    name = ""
    if user_id:
        rows = await fetch_one_off(select(DBUser.name).where(DBUser.id == user_id))
        name = rows[0][0] if rows else ""
    context = (f"Right now: the person is on {str(body.page or 'a page')[:80]}; "
               f"{'they are logged in as ' + name if user_id else 'they are a visitor, not logged in (no personal lookups or actions)'}; "
               f"today is {site_now().strftime('%A %d %B %Y')} (India).")
    messages = [{"role": t.role, "content": t.text.strip()[:2000]} for t in turns]
    article_ids = {a["id"] for a in helpbot_kb().get("articles", [])}
    params = {
        "model": HELPBOT_MODEL,
        "max_tokens": 4000,
        "output_config": {"effort": "low"},          # short chat answers
        "system": [{"type": "text", "text": helpbot_system_text(), "cache_control": {"type": "ephemeral"}},
                   {"type": "text", "text": context}],
        "tools": helpbot_tools(bool(user_id)),
        "betas": ["server-side-fallback-2026-07-01"],
        "fallbacks": "default",                       # a declined request is retried on Anthropic's recommended model
    }

    async def stream():
        import anthropic
        try:
            for _ in range(HELPBOT_MAX_ROUNDS):
                async with client.beta.messages.stream(messages=messages, **params) as reply:
                    async for event in reply:
                        if event.type == "text":
                            yield helpbot_event({"type": "text", "text": event.text})
                    message = await reply.get_final_message()
                if message.stop_reason == "refusal":
                    yield helpbot_event({"type": "text", "text": "\n\nI can't help with that one. Ask me about the site, or try the Support page."})
                    break
                tool_uses = [b for b in message.content if b.type == "tool_use"]
                if not tool_uses or message.stop_reason == "max_tokens":
                    break
                results = []
                for block in tool_uses:
                    result, event = await helpbot_run_tool(block.name, block.input, user_id, article_ids)
                    if event:
                        yield helpbot_event(event)
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, ensure_ascii=False, default=str)[:12000],
                                    **({"is_error": True} if "error" in result else {})})
                messages.append({"role": "assistant", "content": message.content})
                messages.append({"role": "user", "content": results})
            yield helpbot_event({"type": "done"})
        except anthropic.RateLimitError:
            yield helpbot_event({"type": "error", "code": "busy"})
        except anthropic.AuthenticationError:
            yield helpbot_event({"type": "error", "code": "ai_off"})
        except anthropic.APIConnectionError:
            yield helpbot_event({"type": "error", "code": "offline"})
        except anthropic.APIStatusError as e:
            print("Helper bot API error:", e.status_code, getattr(e, "message", e))
            yield helpbot_event({"type": "error", "code": "error"})
        except ValueError as e:      # a tool input the SDK could not parse at all
            print("Helper bot could not read a tool call:", e)
            yield helpbot_event({"type": "error", "code": "error"})

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ==========================================
# 29. COOKIES AND VISIT COUNTS (cookies.js, cookies.html)
# ==========================================
# cookies.js asks every visitor once which optional cookies they allow and keeps the answer in the c2m_consent cookie,
# "v1.p1.a0": preferences (remembered layout, helper history, cached pages; browser storage only, never sent here) and
# analytics. The login cookies are essential and are set by set_login_cookie (section 3).
# With analytics allowed, cookies.js gives the browser a random visitor id (the c2m_vid cookie) and reports each page it
# opens to /api/visits. Only a keyed hash of that id is stored: not the id itself, the IP address or the account. One row
# per day, page and visitor with a count; rows older than VISIT_KEEP_DAYS are deleted. The founder console shows the totals.
VISIT_KEEP_DAYS = 180
CONSENT_COOKIE, VISITOR_COOKIE = "c2m_consent", "c2m_vid"

class DBPageVisit(Base):
    __tablename__ = "page_visits"
    __table_args__ = (UniqueConstraint("day", "page", "visitor", name="ux_page_visits"),)
    id = Column(Integer, primary_key=True, index=True)
    day = Column(String, index=True)                            # YYYY-MM-DD, site time
    page = Column(String)                                       # e.g. home.html
    visitor = Column(String)                                    # keyed hash of the c2m_vid cookie
    member = Column(Integer, default=0)                         # 1 when the visit came with a login
    count = Column(Integer, default=1)

class VisitBody(BaseModel):
    page: str

def consent_allows(request: Request, kind: str) -> bool:
    """kind "p" (preferences) or "a" (analytics), as cookies.js writes them."""
    parts = (request.cookies.get(CONSENT_COOKIE) or "").split(".")
    return len(parts) == 3 and parts[0] == "v1" and f"{kind}1" in parts[1:]

@app.post("/api/visits", status_code=204)
@limiter.limit("60/minute")
async def record_visit(request: Request, body: VisitBody):
    visitor = request.cookies.get(VISITOR_COOKIE) or ""
    if not consent_allows(request, "a") or not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", visitor):
        return Response(status_code=204)                        # no consent, no count
    page = (body.page or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{1,60}\.html", page) or not os.path.isfile(page):
        raise HTTPException(status_code=400, detail="Unknown page.")
    member_id = optional_user_id(request)
    if member_id in MINOR_ACCOUNTS:
        return Response(status_code=204)                        # children are never counted (DPDP Act Section 9(3))
    member = 1 if member_id else 0
    digest = hmac.new(SECRET_KEY.encode(), visitor.encode(), "sha256").hexdigest()[:24]
    await run_one_off(pg_insert(DBPageVisit).values(day=site_now().date().isoformat(), page=page, visitor=digest, member=member, count=1)
                      .on_conflict_do_update(index_elements=["day", "page", "visitor"],
                                             set_={"count": DBPageVisit.count + 1, "member": func.greatest(DBPageVisit.member, member)}))
    return Response(status_code=204)

@app.get("/api/founder/visits")
async def founder_visits(founder_id: int = Depends(require_founder)):
    """The last 30 days: visitors and page views per day, the most opened pages, and how many visitors were logged in."""
    today = site_now().date()
    start, week_start = (today - timedelta(days=29)).isoformat(), (today - timedelta(days=6)).isoformat()
    distinct_since = lambda day, *more: select(func.count(func.distinct(DBPageVisit.visitor))).where(DBPageVisit.day >= day, *more).scalar_subquery()
    daily, pages, totals = await asyncio.gather(
        fetch_one_off(select(DBPageVisit.day, func.count(func.distinct(DBPageVisit.visitor)), func.sum(DBPageVisit.count))
                      .where(DBPageVisit.day >= start).group_by(DBPageVisit.day)),
        fetch_one_off(select(DBPageVisit.page, func.sum(DBPageVisit.count), func.count(func.distinct(DBPageVisit.visitor)))
                      .where(DBPageVisit.day >= start).group_by(DBPageVisit.page).order_by(func.sum(DBPageVisit.count).desc()).limit(8)),
        fetch_one_off(select(distinct_since(week_start), distinct_since(start), distinct_since(start, DBPageVisit.member == 1))),
    )
    by_day = {day: (visitors, int(views or 0)) for day, visitors, views in daily}
    days = []
    for back in range(29, -1, -1):
        day = (today - timedelta(days=back)).isoformat()
        visitors, views = by_day.get(day, (0, 0))
        days.append({"day": day, "visitors": visitors, "views": views})
    week, month, members = totals[0]
    return {"days": days, "today": days[-1]["visitors"], "week": week or 0, "month": month or 0, "members_month": members or 0,
            "views_month": sum(d["views"] for d in days), "keep_days": VISIT_KEEP_DAYS,
            "top_pages": [{"page": page, "views": int(views or 0), "visitors": visitors} for page, views, visitors in pages]}

async def visits_watch():
    """Once a day: delete visit counts older than VISIT_KEEP_DAYS."""
    while True:
        try:
            cutoff = (site_now().date() - timedelta(days=VISIT_KEEP_DAYS)).isoformat()
            await run_one_off(delete(DBPageVisit).where(DBPageVisit.day < cutoff))
        except Exception as e:
            print("Error clearing old visit counts:", e)
        await asyncio.sleep(24 * 3600)


# ==========================================
# 30. DPDP ACT 2023 (dpdp.html, the "My rights" card on account.html)
# ==========================================
# India's Digital Personal Data Protection Act 2023. What the site does for it:
# - consent: sign-up refuses without the notice box (register_user) and saves which notice was agreed to and when;
#   people who agreed to an older notice (or signed up before there was one) get a bar in shared.js until they agree here;
# - access, correction, erasure: the data download and delete of section 26, and the profile editor;
# - nominee (Section 14): one person who may use these rights if the account holder dies or cannot;
# - grievances and other rights requests: enquiries of kind "data_rights" (section 20), shown first in the founder
#   console with the day a reply is due (DPDP_REPLY_DAYS).
DPDP_REPLY_DAYS = 90
DATA_RIGHTS_TYPES = ("Access my data", "Correct my data", "Erase my data", "Withdraw consent", "Nominee", "Complaint", "Something else")

class DBDataNominee(Base):
    __tablename__ = "data_nominees"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, unique=True, index=True)
    name = Column(String)
    relation = Column(String, default="")
    email = Column(String, default="")
    phone = Column(String, default="")
    updated_at = Column(String)

USER_DATA_ERASED["data_nominees"] = ("user_id",)

class NomineeBody(BaseModel):
    name: str
    relation: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""

def nominee_dict(row) -> Optional[dict]:
    if not row:
        return None
    return {"name": row.name or "", "relation": row.relation or "", "email": row.email or "", "phone": row.phone or "", "updated_at": row.updated_at or ""}


@app.get("/api/me/dpdp")
async def my_dpdp(current_user_id: int = Depends(get_current_user_id)):
    """The account card: which notice the person agreed to, and their nominee."""
    users, nominees = await asyncio.gather(
        fetch_one_off(select(DBUser.consent_version, DBUser.consent_at).where(DBUser.id == current_user_id)),
        fetch_one_off(select(DBDataNominee).where(DBDataNominee.user_id == current_user_id)),
    )
    if not users:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    version, at = users[0]
    return {"consent_version": version or "", "consent_at": at or "", "current_version": PRIVACY_VERSION,
            "consent_needed": (version or "") != PRIVACY_VERSION, "nominee": nominee_dict(nominees[0][0] if nominees else None)}


@app.post("/api/me/consent")
@limiter.limit("20/minute", key_func=account_rate_key)
async def agree_to_notice(request: Request, current_user_id: int = Depends(get_current_user_id)):
    """The person agrees to the current privacy notice (the bar shared.js shows)."""
    now_iso = utc_now_iso()
    await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(consent_version=PRIVACY_VERSION, consent_at=now_iso, terms_version=TERMS_VERSION))
    spawn_background(log_activity_later(current_user_id, "Privacy Notice Accepted", f"You agreed to the privacy notice of {PRIVACY_VERSION} and the terms of {TERMS_VERSION}."))
    return {"consent_version": PRIVACY_VERSION, "consent_at": now_iso}


@app.put("/api/me/nominee")
@limiter.limit("20/minute", key_func=account_rate_key)
async def set_nominee(request: Request, body: NomineeBody, current_user_id: int = Depends(get_current_user_id)):
    name = clean_required(body.name, 120, "nominee's name")
    relation = clean_text(body.relation, 60, "relation")
    email, phone = (body.email or "").strip()[:160], (body.phone or "").strip()[:20]
    if not email and not phone:
        raise HTTPException(status_code=400, detail="Give an email or a phone number for your nominee.")
    if email and not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address, or leave it empty.")
    if phone and not PHONE_PATTERN.match(phone):
        raise HTTPException(status_code=400, detail="Enter a valid phone number, or leave it empty.")
    values = {"name": name, "relation": relation, "email": email, "phone": phone, "updated_at": utc_now_iso()}
    rows = await run_returning(pg_insert(DBDataNominee).values(user_id=current_user_id, **values)
                               .on_conflict_do_update(index_elements=["user_id"], set_=values).returning(*DBDataNominee.__table__.c))
    spawn_background(log_activity_later(current_user_id, "Nominee Saved", f"{name} is your nominee under the DPDP Act."))
    return {"nominee": nominee_dict(rows[0])}


@app.delete("/api/me/nominee")
async def remove_nominee(current_user_id: int = Depends(get_current_user_id)):
    await run_one_off(delete(DBDataNominee).where(DBDataNominee.user_id == current_user_id))
    return {"nominee": None}

def dpdp_reply_by(created_at: str, days: int = DPDP_REPLY_DAYS) -> str:
    """The last day (YYYY-MM-DD) to answer a data-rights request (or another request in LEGAL_REPLY_DAYS) sent at created_at."""
    try:
        return (datetime.fromisoformat((created_at or "").replace("Z", "+00:00")) + timedelta(days=days)).date().isoformat()
    except ValueError:
        return ""

assert all(column in DBDataNominee.__table__.c for column in USER_DATA_ERASED["data_nominees"])


# ==========================================
# 31. LAUNCH SAFETY: REPORTS, PASSWORD RESET, EMAIL CHECK, TWO-STEP LOGIN, AGE GATE
# ==========================================
# What a public launch in India needs on top of sections 26 and 30:
# - reports (IT Rules 2021, Rule 3(2)): anyone can report a person, a message, a team or college chat message, a board
#   post or a team. The founder console's Safety tab shows them with the 24-hour acknowledge and 15-day resolve dates,
#   and can remove the content, warn, or suspend the account (users.suspended, kept in SUSPENDED_ACCOUNTS);
# - logins that can be ended: tokens carry users.token_version ("tv", see token_user_id near CLOSED_ACCOUNTS), raised by
#   a password change or reset, two-step login changes and "log out of all other devices";
# - password reset by an emailed link, email addresses checked with a 6-digit code (both need SMTP_HOST; until then
#   the founder can make a reset link by hand);
# - two-step login with an authenticator app (TOTP, RFC 6238, written here) and ten one-time backup codes;
# - age (DPDP Act Section 9): sign-up asks the date of birth; under 13 is refused, under 18 waits for a parent or
#   guardian to agree by an emailed link (users.guardian_status "pending", kept in GUARDIAN_PENDING);
# - TERMS_VERSION: like PRIVACY_VERSION, everyone is asked once to agree when the terms change.
# Every table here that holds a person's id is in USER_DATA_ERASED / USER_DATA_KEPT below.
TERMS_VERSION = "2026-10-16"
LEGAL_REPLY_DAYS = {"data_rights": DPDP_REPLY_DAYS, "grievance": 15, "takedown": 2}
EMAIL_READY = bool(SMTP_HOST and SMTP_FROM)
PLACEHOLDER_EMAIL_END = "@placeholder.connect2minds.local"
RESET_LINK_MINUTES = 30
FOUNDER_RESET_LINK_MINUTES = 24 * 60
EMAIL_CODE_MINUTES = 15
CODE_TRIES = 5
GUARDIAN_LINK_DAYS = 7
MIN_AGE, ADULT_AGE = 13, 18
TWO_FACTOR_TICKET_MINUTES = 5
BACKUP_CODE_COUNT = 10
REPORT_ACK_HOURS, REPORT_RESOLVE_DAYS = 24, 15
REPORT_KINDS = ("user", "message", "team_message", "college_message", "board_post", "team")
# Later sections add kinds of their own: kind -> (async target(target_id, reporter_id) -> (owner, snapshot, link), async remove(target_id))
EXTRA_REPORT_TARGETS: dict = {}
REPORT_REASONS = {
    "harassment": "Harassment or bullying", "hate": "Hate or discrimination", "sexual": "Sexual content",
    "violence": "Threats or violence", "self_harm": "Self-harm or suicide", "spam": "Spam",
    "scam": "Scam or fraud", "fake_profile": "Fake profile", "impersonation": "Pretending to be someone else",
    "privacy": "Shares someone's private information", "copyright": "Copyright", "other": "Something else",
}
REMOVED_TEXT = "This was removed by Connect2Minds for breaking the honour code."
MINOR_ACCOUNTS: set = set()   # under 18 when the server started or when they told us; never counted or found by recruiters

def adult_clause():
    """People who are 18 or older, or have not given a date of birth yet."""
    today = site_now()
    try:
        cutoff = today.replace(year=today.year - ADULT_AGE)
    except ValueError:            # 29 February
        cutoff = today.replace(year=today.year - ADULT_AGE, day=28)
    return func.coalesce(DBUser.birth_date, "") <= cutoff.strftime("%Y-%m-%d")


class DBAuthCode(Base):
    """A one-time code or link: a password reset, an email check, or a guardian's consent link. Only a hash is kept."""
    __tablename__ = "auth_codes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    purpose = Column(String, index=True)       # reset, verify_email, guardian
    code_hash = Column(String, index=True)
    target = Column(String, default="")        # the email address it was sent to
    expires_at = Column(String)
    attempts = Column(Integer, default=0)
    created_at = Column(String)

class DBBackupCode(Base):
    __tablename__ = "totp_backup_codes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    code_hash = Column(String)
    used_at = Column(String, default="")

class DBContentReport(Base):
    __tablename__ = "content_reports"
    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, index=True)
    target_kind = Column(String)
    target_id = Column(Integer)
    target_user_id = Column(Integer, index=True, nullable=True)   # whose content it is (the person, for kind "user")
    reason = Column(String)
    details = Column(String, default="")
    snapshot = Column(String, default="")      # the reported words as they were, so deleting them hides nothing
    link = Column(String, default="")          # where the founder can look
    status = Column(String, default="open")    # open, reviewing, actioned, dismissed
    action_taken = Column(String, default="")  # removed, warned, suspended
    founder_note = Column(String, default="")
    resolver_id = Column(Integer, nullable=True)
    created_at = Column(String)
    ack_at = Column(String, default="")
    resolved_at = Column(String, default="")

USER_DATA_ERASED["auth_codes"] = ("user_id",)
USER_DATA_ERASED["totp_backup_codes"] = ("user_id",)
USER_DATA_ERASED["content_reports"] = ("reporter_id",)
USER_DATA_KEPT["content_reports"] = ("target_user_id", "resolver_id")   # a record of what was done about someone stays
for _table in ("auth_codes", "totp_backup_codes", "content_reports"):
    for _registry in (USER_DATA_ERASED, USER_DATA_KEPT):
        assert all(column in Base.metadata.tables[_table].c for column in _registry.get(_table, ()))
SCHEMA_UPGRADES.append("CREATE INDEX IF NOT EXISTS ix_content_reports_open ON content_reports (status, id)")


# ---------- small helpers ----------
def code_hash(code: str) -> str:
    return hmac.new(SECRET_KEY.encode(), (code or "").strip().encode(), "sha256").hexdigest()

def iso_in(minutes: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()

def is_real_email(email: Optional[str]) -> bool:
    return bool(email) and EMAIL_PATTERN.match(email or "") is not None and not (email or "").endswith(PLACEHOLDER_EMAIL_END)

def mask_email(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    return (name[:2] + "•" * max(1, len(name) - 2) + "@" + domain) if domain else ""

async def send_email(to: str, subject: str, plain: str, page_html: str) -> bool:
    """Send one email on a worker thread. False when email is not set up or sending failed."""
    if not (SMTP_HOST and SMTP_FROM) or not is_real_email(to):
        return False
    try:
        await asyncio.to_thread(send_email_now, to, subject, plain, page_html)
        return True
    except Exception as e:
        print("Sending email failed:", e)
        return False

def simple_email(greeting: str, lines: list, button: Optional[tuple] = None, footer: str = "") -> tuple:
    """(plain text, HTML) for the short account emails of this section. button = (label, address)."""
    plain = "\n".join([greeting, ""] + lines + ([f"\n{button[0]}: {button[1]}"] if button else []) + (["", footer] if footer else []))
    paragraphs = "".join(f'<p style="color:#464555;margin:0 0 12px;line-height:1.5;">{html.escape(line)}</p>' for line in lines)
    action = (f'<a href="{html.escape(button[1])}" style="display:inline-block;background:#3525cd;color:#fff;padding:10px 18px;'
              f'border-radius:8px;text-decoration:none;font-weight:600;">{html.escape(button[0])}</a>') if button else ""
    page_html = (f'<div style="font-family:Arial,sans-serif;color:#0b1c30;max-width:520px;margin:0 auto;padding:24px;">'
                 f'<h2 style="margin:0 0 12px;">{html.escape(greeting)}</h2>{paragraphs}{action}'
                 + (f'<p style="color:#777587;font-size:12px;margin:26px 0 0;">{html.escape(footer)}</p>' if footer else "") + '</div>')
    return plain, page_html

async def new_auth_code(user_id: int, purpose: str, minutes: float, target: str = "", code: Optional[str] = None) -> str:
    """Make a code (a long random link token unless one is given), replacing the person's earlier one for the same purpose."""
    code = code or secrets.token_urlsafe(32)
    await run_one_off(delete(DBAuthCode).where(DBAuthCode.user_id == user_id, DBAuthCode.purpose == purpose))
    await run_one_off(DBAuthCode.__table__.insert().values(user_id=user_id, purpose=purpose, code_hash=code_hash(code), target=target,
                                                           expires_at=iso_in(minutes), attempts=0, created_at=utc_now_iso()))
    return code

async def find_link_code(purpose: str, token: str):
    """The live code row behind a link token, or None."""
    if not token or len(token) > 200:
        return None
    rows = await fetch_one_off(select(DBAuthCode).where(DBAuthCode.purpose == purpose, DBAuthCode.code_hash == code_hash(token),
                                                        DBAuthCode.expires_at > utc_now_iso()))
    return rows[0][0] if rows else None

async def check_typed_code(user_id: int, purpose: str, code: str):
    """A 6-digit code the person typed. Returns the row when right; counts wrong tries (CODE_TRIES at most)."""
    rows = await fetch_one_off(select(DBAuthCode).where(DBAuthCode.user_id == user_id, DBAuthCode.purpose == purpose,
                                                        DBAuthCode.expires_at > utc_now_iso()))
    if not rows:
        raise HTTPException(status_code=400, detail="That code has run out. Ask for a new one.")
    row = rows[0][0]
    if (row.attempts or 0) >= CODE_TRIES:
        raise HTTPException(status_code=400, detail="Too many wrong tries. Ask for a new code.")
    if not hmac.compare_digest(row.code_hash, code_hash(re.sub(r"\s", "", code or ""))):
        await run_one_off(update(DBAuthCode).where(DBAuthCode.id == row.id).values(attempts=DBAuthCode.attempts + 1))
        raise HTTPException(status_code=400, detail="That code is not right.")
    return row

async def bump_token_version(user_id: int, keep: Optional[tuple] = None) -> int:
    """End every login of this person. keep = (request, response, max_age) gives the device asking a fresh one."""
    rows = await run_returning(update(DBUser).where(DBUser.id == user_id)
                               .values(token_version=func.coalesce(DBUser.token_version, 0) + 1).returning(DBUser.token_version))
    TOKEN_VERSIONS[user_id] = rows[0][0]
    spawn_background(close_account_sockets(user_id))
    if keep:
        request, response, max_age = keep
        set_login_cookie(response, request, "authToken", create_access_token(data={"sub": str(user_id)}, minutes=max(1, (max_age or SESSION_LOGIN_MINUTES * 60) // 60)), max_age)
    return rows[0][0]

def cookie_lifetime(request: Request) -> Optional[int]:
    """Seconds left on this device's login, or None for a cookie that ends with the browser ("keep me logged in" off)."""
    try:
        payload = jwt.decode(request.cookies.get("authToken") or "", SECRET_KEY, algorithms=[ALGORITHM])
        left = int(payload["exp"] - datetime.now(timezone.utc).timestamp())
    except Exception:
        return None
    return left if left > SESSION_LOGIN_MINUTES * 60 + 60 else None

def age_on(birth: datetime, today: datetime) -> int:
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))

def parse_birth_date(value: Optional[str]) -> tuple:
    """(YYYY-MM-DD, age today in India). Raises 400 on a missing or impossible date."""
    try:
        birth = datetime.strptime((value or "").strip(), "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter your date of birth.")
    age = age_on(birth, site_now())
    if age < 0 or age > 120:
        raise HTTPException(status_code=400, detail="Check your date of birth.")
    return birth.strftime("%Y-%m-%d"), age

def is_minor(birth_date: Optional[str]) -> bool:
    try:
        return age_on(datetime.strptime(birth_date or "", "%Y-%m-%d"), site_now()) < ADULT_AGE
    except ValueError:
        return False

def check_guardian_email(value: Optional[str], own_email: str) -> str:
    email = (value or "").strip()[:160]
    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Under 18: enter your parent's or guardian's email address.")
    if email.lower() == (own_email or "").strip().lower():
        raise HTTPException(status_code=400, detail="Your guardian's email has to be different from your own.")
    return email

async def send_guardian_request(user_id: int, name: str, guardian_email: str) -> bool:
    token = await new_auth_code(user_id, "guardian", GUARDIAN_LINK_DAYS * 24 * 60, guardian_email)
    first = (name or "Your child").split()[0]
    plain, page_html = simple_email(
        "Hello,",
        [f"{name} has signed up to Connect2Minds, a site where college students study together, join teams and find opportunities.",
         f"{first} is under 18, so India's Digital Personal Data Protection Act asks for your consent before we use their personal data.",
         "The link shows what they share and lets you agree or say no. If you say no, the account and its data are erased.",
         f"The link works for {GUARDIAN_LINK_DAYS} days."],
        ("Review and decide", f"{SITE_URL}/guardian.html?t={token}"),
        "If you do not know who this is, ignore this email: nothing happens without your answer.")
    return await send_email(guardian_email, f"{first} asks for your consent to use Connect2Minds", plain, page_html)


# ---------- loading the in-memory sets at startup ----------
async def load_login_state():
    try:
        rows = await fetch_one_off(select(DBUser.id, DBUser.token_version, DBUser.suspended, DBUser.guardian_status)
                                   .where(or_(func.coalesce(DBUser.token_version, 0) > 0, func.coalesce(DBUser.suspended, 0) == 1,
                                              DBUser.guardian_status == "pending")))
        minors = await fetch_one_off(select(DBUser.id).where(func.coalesce(DBUser.birth_date, "") != "", ~adult_clause()))
        MINOR_ACCOUNTS.update(row[0] for row in minors)
        for user_id, version, suspended, guardian in rows:
            if version:
                TOKEN_VERSIONS[user_id] = version
            if suspended == 1:
                SUSPENDED_ACCOUNTS.add(user_id)
            if guardian == "pending":
                GUARDIAN_PENDING.add(user_id)
    except Exception as e:
        print("Could not load login state:", e)

async def auth_codes_watch():
    """Every hour: forget codes and links that have run out."""
    while True:
        try:
            await run_one_off(delete(DBAuthCode).where(DBAuthCode.expires_at < utc_now_iso()))
        except Exception as e:
            print("Error clearing old codes:", e)
        await asyncio.sleep(3600)

@app.on_event("startup")
async def launch_safety_startup():
    await load_login_state()
    spawn_background(auth_codes_watch())


# ---------- what /api/me adds (read in the same query as the rest of /api/me) ----------
def SAFETY_FLAG_COLUMNS() -> tuple:
    return (DBUser.email.label("safety_email"), DBUser.email_verified, DBUser.totp_enabled, DBUser.birth_date, DBUser.guardian_status,
            DBUser.guardian_email, DBUser.terms_version)

def safety_flags(r) -> dict:
    """r: a row with SAFETY_FLAG_COLUMNS."""
    return {"email_verified": (r.email_verified or 0) == 1, "email_real": is_real_email(r.safety_email), "email_ready": EMAIL_READY,
            "two_factor": (r.totp_enabled or 0) == 1, "birth_date_needed": not r.birth_date, "minor": is_minor(r.birth_date),
            "guardian_needed": r.guardian_status == "pending", "guardian_email": mask_email(r.guardian_email or "") if r.guardian_status == "pending" else "",
            "terms_needed": (r.terms_version or "") != TERMS_VERSION}

@app.get("/api/me/safety")
async def my_safety(current_user_id: int = Depends(get_current_user_id)):
    """The account page's password, email, two-step login and age cards."""
    rows, backups = await asyncio.gather(
        fetch_one_off(select(DBUser.email, DBUser.email_verified_at, *SAFETY_FLAG_COLUMNS()).where(DBUser.id == current_user_id)),
        fetch_one_off(select(func.count()).select_from(DBBackupCode).where(DBBackupCode.user_id == current_user_id, DBBackupCode.used_at == "")))
    flags = safety_flags(rows[0]) if rows else {}
    email = rows[0].email if rows else ""
    return {**flags, "email": email if is_real_email(email) else "", "email_verified_at": rows[0].email_verified_at or "" if rows else "",
            "birth_date": rows[0].birth_date or "" if rows else "", "backup_codes_left": backups[0][0] if backups else 0}


# ---------- password: change, forgot, reset ----------
class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str

class ForgotBody(BaseModel):
    who: str               # roll number / ID, or email

class ResetBody(BaseModel):
    token: str
    password: str

def check_new_password(password: Optional[str]) -> str:
    password = password or ""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Use at least 8 characters for your password.")
    if len(password) > 200:
        raise HTTPException(status_code=400, detail="That password is too long.")
    return password

@app.post("/api/me/password")
@limiter.limit("5/hour", key_func=account_rate_key)
async def change_password(request: Request, body: PasswordChangeBody, response: Response, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBUser.hashed_password, DBUser.name).where(DBUser.id == current_user_id))
    if not rows or not rows[0].hashed_password or not await check_password_async(body.current_password or "", rows[0].hashed_password):
        raise HTTPException(status_code=400, detail="Your current password is not right.")
    new_hash = await hash_password_async(check_new_password(body.new_password))
    await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(hashed_password=new_hash))
    await bump_token_version(current_user_id, (request, response, cookie_lifetime(request)))
    spawn_background(log_activity_later(current_user_id, "Password Changed", "Your password was changed. Other devices were logged out."))
    return {"status": "changed"}

@app.post("/api/me/logout-all")
@limiter.limit("10/hour", key_func=account_rate_key)
async def logout_everywhere(request: Request, response: Response, current_user_id: int = Depends(get_current_user_id)):
    await bump_token_version(current_user_id, (request, response, cookie_lifetime(request)))
    spawn_background(log_activity_later(current_user_id, "Logged Out Everywhere", "Every other device was logged out."))
    return {"status": "done"}

FORGOT_ANSWER = "If that account has an email address, a reset link is on its way. It works for 30 minutes."

@app.post("/api/password/forgot")
@limiter.limit("5/hour")
async def forgot_password(request: Request, body: ForgotBody):
    """Always the same answer, so nobody can find out which accounts exist."""
    who = (body.who or "").strip()[:160]
    if not who:
        raise HTTPException(status_code=400, detail="Enter your roll number, ID or email.")
    if not EMAIL_READY:
        return {"message": "Email is not set up on Connect2Minds yet, so we cannot send a link. Write to Support and we will help you get back in.", "email_ready": False}
    rows = await fetch_one_off(select(DBUser.id, DBUser.name, DBUser.email).where(
        or_(DBUser.roll_no == who, func.lower(DBUser.email) == who.lower()), visible_user_clause()).limit(2))
    if len(rows) == 1 and is_real_email(rows[0].email):
        user_id, name, email = rows[0]
        token = await new_auth_code(user_id, "reset", RESET_LINK_MINUTES, email)
        plain, page_html = simple_email(f"Hi {(name or 'there').split()[0]},",
            ["Someone (we hope you) asked to reset your Connect2Minds password.", f"The link works once, for {RESET_LINK_MINUTES} minutes."],
            ("Choose a new password", f"{SITE_URL}/reset.html?t={token}"),
            "If you did not ask for this, ignore this email; your password stays as it is.")
        spawn_background(send_email(email, "Reset your Connect2Minds password", plain, page_html))
    return {"message": FORGOT_ANSWER, "email_ready": True}

@app.get("/api/password/reset")
@limiter.limit("20/hour")
async def check_reset_link(request: Request, t: str = ""):
    row = await find_link_code("reset", t)
    if not row:
        return {"valid": False}
    rows = await fetch_one_off(select(DBUser.name).where(DBUser.id == row.user_id))
    return {"valid": True, "first_name": ((rows[0][0] if rows else "") or "").split(" ")[0]}

@app.post("/api/password/reset")
@limiter.limit("10/hour")
async def reset_password(request: Request, body: ResetBody):
    row = await find_link_code("reset", body.token)
    if not row:
        raise HTTPException(status_code=400, detail="This link has run out or was already used. Ask for a new one.")
    new_hash = await hash_password_async(check_new_password(body.password))
    deleted = await run_returning(delete(DBAuthCode).where(DBAuthCode.id == row.id).returning(DBAuthCode.id))
    if not deleted:   # used a moment ago in another tab
        raise HTTPException(status_code=400, detail="This link was already used. Ask for a new one.")
    await run_one_off(update(DBUser).where(DBUser.id == row.user_id).values(hashed_password=new_hash))
    await bump_token_version(row.user_id)
    spawn_background(log_activity_later(row.user_id, "Password Reset", "Your password was reset from an emailed link. Every device was logged out."))
    return {"status": "reset"}

@app.post("/api/founder/reset-link/{user_id}")
async def founder_reset_link(user_id: int, founder_id: int = Depends(require_founder)):
    """For people who cannot get email: the founder checks who they are, then sends this link by hand."""
    rows = await fetch_one_off(select(DBUser.name).where(DBUser.id == user_id, visible_user_clause()))
    if not rows:
        raise HTTPException(status_code=404, detail="No such account.")
    token = await new_auth_code(user_id, "reset", FOUNDER_RESET_LINK_MINUTES, "by founder")
    spawn_background(log_activity_later(user_id, "Reset Link Made", "The founder made a password reset link for your account."))
    return {"link": f"{SITE_URL}/reset.html?t={token}", "name": rows[0][0] or "", "hours": FOUNDER_RESET_LINK_MINUTES // 60}


# ---------- email check ----------
class EmailCodeBody(BaseModel):
    email: Optional[str] = ""      # empty: the account's own email

class EmailVerifyBody(BaseModel):
    code: str

@app.post("/api/me/email/send-code")
@limiter.limit("5/hour", key_func=account_rate_key)
async def send_email_code(request: Request, body: EmailCodeBody, current_user_id: int = Depends(get_current_user_id)):
    if not EMAIL_READY:
        raise HTTPException(status_code=503, detail="Email is not set up on Connect2Minds yet. Try again later.")
    rows = await fetch_one_off(select(DBUser.email, DBUser.name).where(DBUser.id == current_user_id))
    target = (body.email or "").strip()[:160] or (rows[0].email if rows else "")
    if not is_real_email(target):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    taken = await fetch_one_off(select(DBUser.id).where(func.lower(DBUser.email) == target.lower(), DBUser.id != current_user_id).limit(1))
    if taken:
        raise HTTPException(status_code=400, detail="Another account uses that email address.")
    code = f"{secrets.randbelow(1000000):06d}"
    await new_auth_code(current_user_id, "verify_email", EMAIL_CODE_MINUTES, target, code)
    plain, page_html = simple_email(f"Hi {((rows[0].name if rows else '') or 'there').split()[0]},",
        [f"Your Connect2Minds code is {code}.", f"Type it on the Account page within {EMAIL_CODE_MINUTES} minutes to confirm this email address."],
        footer="If you did not ask for this, ignore this email.")
    if not await send_email(target, f"{code} is your Connect2Minds code", plain, page_html):
        raise HTTPException(status_code=502, detail="We could not send the email. Check the address and try again.")
    return {"sent_to": target, "minutes": EMAIL_CODE_MINUTES}

async def send_signup_code(user_id: int, name: str, email: str):
    """Right after sign-up: a code to confirm the email address (typed on the Account page)."""
    try:
        code = f"{secrets.randbelow(1000000):06d}"
        await new_auth_code(user_id, "verify_email", 24 * 60, email, code)
        plain, page_html = simple_email(f"Welcome to Connect2Minds, {(name or 'there').split()[0]}!",
            [f"Your code to confirm this email address is {code}.", "Type it on the Account & privacy page within 24 hours."],
            ("Open Account & privacy", f"{SITE_URL}/account.html#emailCard"), "If you did not sign up, ignore this email.")
        await send_email(email, f"{code} is your Connect2Minds code", plain, page_html)
    except Exception as e:
        print("Sign-up email failed:", e)

@app.post("/api/me/email/verify")
@limiter.limit("20/hour", key_func=account_rate_key)
async def verify_email_code(request: Request, body: EmailVerifyBody, current_user_id: int = Depends(get_current_user_id)):
    row = await check_typed_code(current_user_id, "verify_email", body.code)
    taken = await fetch_one_off(select(DBUser.id).where(func.lower(DBUser.email) == row.target.lower(), DBUser.id != current_user_id).limit(1))
    if taken:
        raise HTTPException(status_code=400, detail="Another account uses that email address.")
    values = {"email": row.target, "email_verified": 1, "email_verified_at": utc_now_iso()}
    status_rows = await fetch_one_off(select(DBUser.account_status).where(DBUser.id == current_user_id))
    # A checked college address verifies a waiting student account, as it did at sign-up before emails could be checked
    if status_rows and status_rows[0][0] == "pending" and row.target.lower().endswith((".edu.in", ".ac.in")):
        values["account_status"] = "verified"
    await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(**values))
    await run_one_off(delete(DBAuthCode).where(DBAuthCode.id == row.id))
    spawn_background(log_activity_later(current_user_id, "Email Confirmed", f"{row.target} is confirmed as your email address."))
    return {"email": row.target, "email_verified": True, "account_status": values.get("account_status", "")}


# ---------- two-step login (TOTP) ----------
class TwoFactorSetupBody(BaseModel):
    password: str

class TwoFactorCodeBody(BaseModel):
    code: str

class TwoFactorOffBody(BaseModel):
    password: str
    code: str

class TwoFactorLoginBody(BaseModel):
    ticket: str
    code: str

TOTP_LAST_STEP: dict = {}     # user id -> the last time step used, so one code cannot log in twice

def totp_key() -> bytes:
    return base64.urlsafe_b64encode(hashlib.sha256(f"totp:{SECRET_KEY}".encode()).digest())

def seal_secret(secret: str) -> str:
    return Fernet(totp_key()).encrypt(secret.encode()).decode()

def open_secret(sealed: str) -> str:
    try:
        return Fernet(totp_key()).decrypt((sealed or "").encode()).decode()
    except Exception:
        return ""

def totp_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), "sha1").digest()
    offset = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1000000:06d}"

def totp_step_matching(secret: str, code: str, now: Optional[float] = None) -> Optional[int]:
    """The 30-second step whose code this is (now, or one step either side), or None."""
    code = re.sub(r"\s", "", code or "")
    if not secret or not re.fullmatch(r"\d{6}", code):
        return None
    step = int((now if now is not None else datetime.now(timezone.utc).timestamp()) // 30)
    for candidate in (step, step - 1, step + 1):
        if hmac.compare_digest(totp_at(secret, candidate), code):
            return candidate
    return None

async def check_second_factor(user_id: int, sealed_secret: str, code: str) -> bool:
    """An authenticator code (each used once) or an unused backup code."""
    step = totp_step_matching(open_secret(sealed_secret), code)
    if step is not None:
        if TOTP_LAST_STEP.get(user_id, -1) >= step:
            return False
        TOTP_LAST_STEP[user_id] = step
        return True
    typed = re.sub(r"[\s-]", "", code or "").lower()
    if len(typed) != 10:
        return False
    used = await run_returning(update(DBBackupCode).where(DBBackupCode.user_id == user_id, DBBackupCode.code_hash == code_hash(typed),
                                                          DBBackupCode.used_at == "").values(used_at=utc_now_iso()).returning(DBBackupCode.id))
    return bool(used)

async def new_backup_codes(user_id: int) -> list:
    codes = [secrets.token_hex(5) for _ in range(BACKUP_CODE_COUNT)]
    await run_one_off(delete(DBBackupCode).where(DBBackupCode.user_id == user_id))
    await run_one_off(DBBackupCode.__table__.insert().values([{"user_id": user_id, "code_hash": code_hash(c), "used_at": ""} for c in codes]))
    return [f"{c[:5]}-{c[5:]}" for c in codes]

async def check_own_password(user_id: int, password: str):
    rows = await fetch_one_off(select(DBUser.hashed_password, DBUser.totp_secret, DBUser.totp_enabled, DBUser.roll_no, DBUser.name).where(DBUser.id == user_id))
    if not rows or not rows[0].hashed_password or not await check_password_async(password or "", rows[0].hashed_password):
        raise HTTPException(status_code=400, detail="That password is not right.")
    return rows[0]

@app.post("/api/me/2fa/setup")
@limiter.limit("10/hour", key_func=account_rate_key)
async def two_factor_setup(request: Request, body: TwoFactorSetupBody, current_user_id: int = Depends(get_current_user_id)):
    me = await check_own_password(current_user_id, body.password)
    if (me.totp_enabled or 0) == 1:
        raise HTTPException(status_code=400, detail="Two-step login is already on.")
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(totp_secret=seal_secret(secret), totp_enabled=0))
    label = urllib.parse.quote(f"Connect2Minds:{me.roll_no or me.name or current_user_id}")
    return {"secret": secret, "uri": f"otpauth://totp/{label}?secret={secret}&issuer=Connect2Minds&digits=6&period=30"}

@app.post("/api/me/2fa/enable")
@limiter.limit("20/hour", key_func=account_rate_key)
async def two_factor_enable(request: Request, body: TwoFactorCodeBody, response: Response, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBUser.totp_secret, DBUser.totp_enabled).where(DBUser.id == current_user_id))
    if not rows or not rows[0].totp_secret:
        raise HTTPException(status_code=400, detail="Start the set-up again.")
    if (rows[0].totp_enabled or 0) == 1:
        raise HTTPException(status_code=400, detail="Two-step login is already on.")
    step = totp_step_matching(open_secret(rows[0].totp_secret), body.code)
    if step is None:
        raise HTTPException(status_code=400, detail="That code is not right. Check the time on your phone and try the newest code.")
    TOTP_LAST_STEP[current_user_id] = step
    await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(totp_enabled=1))
    codes = await new_backup_codes(current_user_id)
    await bump_token_version(current_user_id, (request, response, cookie_lifetime(request)))
    spawn_background(log_activity_later(current_user_id, "Two-Step Login On", "Logging in now also needs a code from your authenticator app."))
    return {"two_factor": True, "backup_codes": codes}

@app.post("/api/me/2fa/disable")
@limiter.limit("10/hour", key_func=account_rate_key)
async def two_factor_disable(request: Request, body: TwoFactorOffBody, response: Response, current_user_id: int = Depends(get_current_user_id)):
    me = await check_own_password(current_user_id, body.password)
    if (me.totp_enabled or 0) != 1:
        return {"two_factor": False}
    if not await check_second_factor(current_user_id, me.totp_secret, body.code):
        raise HTTPException(status_code=400, detail="That code is not right.")
    await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(totp_enabled=0, totp_secret=""))
    await run_one_off(delete(DBBackupCode).where(DBBackupCode.user_id == current_user_id))
    await bump_token_version(current_user_id, (request, response, cookie_lifetime(request)))
    spawn_background(log_activity_later(current_user_id, "Two-Step Login Off", "Logging in needs only your password again."))
    return {"two_factor": False}

@app.post("/api/me/2fa/backup-codes")
@limiter.limit("5/hour", key_func=account_rate_key)
async def two_factor_new_backups(request: Request, body: TwoFactorSetupBody, current_user_id: int = Depends(get_current_user_id)):
    me = await check_own_password(current_user_id, body.password)
    if (me.totp_enabled or 0) != 1:
        raise HTTPException(status_code=400, detail="Turn two-step login on first.")
    return {"backup_codes": await new_backup_codes(current_user_id)}

def two_factor_ticket(user_id: int, remember: bool) -> str:
    """What /api/login gives instead of a cookie when a code is still needed. Useless for anything else."""
    return create_access_token(data={"sub": str(user_id), "purpose": "2fa", "remember": bool(remember)}, minutes=TWO_FACTOR_TICKET_MINUTES)

async def require_admin_second_factor(user: DBUser, code: Optional[str]):
    """The admin tab of login.html: an account with two-step login on must also give its code."""
    if (user.totp_enabled or 0) != 1:
        return
    if not (code or "").strip():
        raise HTTPException(status_code=401, detail="Enter the 6-digit code from your authenticator app.", headers={"X-Two-Factor": "required"})
    if not await check_second_factor(user.id, user.totp_secret, code):
        raise HTTPException(status_code=401, detail="That code is not right.", headers={"X-Two-Factor": "required"})

@app.post("/api/login/2fa")
@limiter.limit("5/minute")
async def login_second_step(request: Request, body: TwoFactorLoginBody, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(body.ticket or "", SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="That took too long. Log in again.")
    if payload.get("purpose") != "2fa":
        raise HTTPException(status_code=401, detail="Log in again.")
    user = (await db.execute(select(DBUser).filter(DBUser.id == int(payload["sub"])))).scalars().first()
    if not user or (user.totp_enabled or 0) != 1:
        raise HTTPException(status_code=401, detail="Log in again.")
    if not await check_second_factor(user.id, user.totp_secret, body.code):
        raise HTTPException(status_code=400, detail="That code is not right.")
    return await finish_login(request, response, db, user, bool(payload.get("remember")))


# ---------- age and guardians ----------
class BirthDateBody(BaseModel):
    birth_date: str
    guardian_email: Optional[str] = ""

class GuardianDecisionBody(BaseModel):
    token: str
    decision: str          # approve, decline

class GuardianResendBody(BaseModel):
    guardian_email: Optional[str] = ""

class FounderGuardianBody(BaseModel):
    decision: str

async def start_guardian_wait(user_id: int, name: str, guardian_email: str) -> bool:
    await run_one_off(update(DBUser).where(DBUser.id == user_id).values(guardian_status="pending", guardian_email=guardian_email))
    GUARDIAN_PENDING.add(user_id)
    spawn_background(close_account_sockets(user_id))
    sent = await send_guardian_request(user_id, name, guardian_email)
    spawn_background(notify_founders("account", f"{name} is under 18 and waits for a guardian's consent.", "founder.html?tab=safety"))
    return sent

@app.post("/api/me/birth-date")
@limiter.limit("10/hour", key_func=account_rate_key)
async def save_birth_date(request: Request, body: BirthDateBody, current_user_id: int = Depends(get_current_user_id)):
    """For accounts made before sign-up asked the date of birth. Can be set once; Support can correct it."""
    rows = await fetch_one_off(select(DBUser.birth_date, DBUser.name, DBUser.email, DBUser.is_founder).where(DBUser.id == current_user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    if rows[0].birth_date:
        raise HTTPException(status_code=400, detail="Your date of birth is already saved. To correct it, write to Support.")
    birth_date, age = parse_birth_date(body.birth_date)
    if age < MIN_AGE:
        raise HTTPException(status_code=400, detail=f"Connect2Minds is for people aged {MIN_AGE} and over.")
    guardian = check_guardian_email(body.guardian_email, rows[0].email) if age < ADULT_AGE and (rows[0].is_founder or 0) != 1 else ""
    await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(birth_date=birth_date))
    if age < ADULT_AGE:
        MINOR_ACCOUNTS.add(current_user_id)
    sent = await start_guardian_wait(current_user_id, rows[0].name or "", guardian) if guardian else False
    return {"birth_date": birth_date, "guardian_needed": bool(guardian), "email_sent": sent}

@app.post("/api/me/guardian/resend")
@limiter.limit("5/hour", key_func=account_rate_key)
async def resend_guardian(request: Request, body: GuardianResendBody, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBUser.name, DBUser.email, DBUser.guardian_email, DBUser.guardian_status).where(DBUser.id == current_user_id))
    if not rows or rows[0].guardian_status != "pending":
        raise HTTPException(status_code=400, detail="Nothing is waiting for a guardian.")
    guardian = check_guardian_email(body.guardian_email or rows[0].guardian_email, rows[0].email)
    if guardian != rows[0].guardian_email:
        await run_one_off(update(DBUser).where(DBUser.id == current_user_id).values(guardian_email=guardian))
    sent = await send_guardian_request(current_user_id, rows[0].name or "", guardian)
    return {"email_sent": sent, "email_ready": EMAIL_READY, "guardian_email": mask_email(guardian)}

async def decide_guardian(user_id: int, approve: bool, by: str):
    if approve:
        await run_one_off(update(DBUser).where(DBUser.id == user_id).values(guardian_status="approved", guardian_consent_at=utc_now_iso()))
        GUARDIAN_PENDING.discard(user_id)
        await run_one_off(delete(DBAuthCode).where(DBAuthCode.user_id == user_id, DBAuthCode.purpose == "guardian"))
        spawn_background(create_notification(user_id, "account", "Your guardian agreed. Welcome to Connect2Minds!", utc_now_iso(), "home.html"))
        spawn_background(log_activity_later(user_id, "Guardian Consent", f"Your parent or guardian agreed ({by})."))
        return
    # No: the account and its data go now (the usual erase, without the 14-day wait)
    await run_one_off(update(DBUser).where(DBUser.id == user_id).values(
        status_before_delete=func.coalesce(DBUser.account_status, "pending"), account_status="closing", delete_after=utc_now_iso(), guardian_status="declined"))
    CLOSED_ACCOUNTS.add(user_id)
    GUARDIAN_PENDING.discard(user_id)
    spawn_background(close_account_sockets(user_id))
    spawn_background(erase_account(user_id))

@app.get("/api/guardian")
@limiter.limit("30/hour")
async def guardian_view(request: Request, t: str = ""):
    row = await find_link_code("guardian", t)
    if not row:
        return {"valid": False}
    rows = await fetch_one_off(select(DBUser.name, DBUser.college_name, DBUser.department, DBUser.birth_date, DBUser.guardian_status).where(DBUser.id == row.user_id))
    if not rows or rows[0].guardian_status != "pending":
        return {"valid": False}
    r = rows[0]
    return {"valid": True, "name": r.name or "", "college": r.college_name or "", "department": r.department or "", "birth_date": r.birth_date or ""}

@app.post("/api/guardian")
@limiter.limit("10/hour")
async def guardian_decide(request: Request, body: GuardianDecisionBody):
    if body.decision not in ("approve", "decline"):
        raise HTTPException(status_code=400, detail="Choose agree or decline.")
    row = await find_link_code("guardian", body.token)
    if not row:
        raise HTTPException(status_code=400, detail="This link has run out or was already used.")
    await decide_guardian(row.user_id, body.decision == "approve", "by the emailed link")
    await run_one_off(delete(DBAuthCode).where(DBAuthCode.id == row.id))
    return {"decision": body.decision}


# ---------- reports ----------
class ReportBody(BaseModel):
    kind: str
    target_id: int
    reason: str
    details: Optional[str] = ""

class ReportDecisionBody(BaseModel):
    action: str            # review, dismiss, remove, warn, suspend
    note: Optional[str] = ""

def snapshot_text(content: Optional[str]) -> str:
    text_ = content or ""
    if text_.startswith("data:") or len(text_) > 20000:
        return "[a picture, recording or file]"
    return text_[:2000]

async def report_target(kind: str, target_id: int, reporter_id: int) -> tuple:
    """(owner id, snapshot, link) of something the reporter can see. 404 otherwise."""
    missing = HTTPException(status_code=404, detail="We could not find that, or you cannot see it.")
    if kind in EXTRA_REPORT_TARGETS:
        return await EXTRA_REPORT_TARGETS[kind][0](target_id, reporter_id)
    if kind == "user":
        rows = await fetch_one_off(select(DBUser.name, DBUser.bio).where(DBUser.id == target_id, visible_user_clause()))
        if not rows:
            raise missing
        return target_id, f"{rows[0].name or ''}: {rows[0].bio or ''}"[:2000], f"profile.html?id={target_id}"
    if kind == "message":
        rows = await fetch_one_off(select(DBMessage.sender_id, DBMessage.receiver_id, DBMessage.content).where(DBMessage.id == target_id))
        if not rows or rows[0].receiver_id != reporter_id:
            raise missing
        return rows[0].sender_id, snapshot_text(rows[0].content), ""
    if kind == "team_message":
        rows = await fetch_one_off(select(DBTeamMessage.sender_id, DBTeamMessage.team_id, DBTeamMessage.content).where(DBTeamMessage.id == target_id))
        if not rows:
            raise missing
        member = await fetch_one_off(select(DBTeamMember.id).where(DBTeamMember.team_id == rows[0].team_id, DBTeamMember.user_id == reporter_id))
        if not member:
            raise missing
        return rows[0].sender_id, snapshot_text(rows[0].content), f"team.html?team={rows[0].team_id}"
    if kind == "college_message":
        rows = await fetch_one_off(select(DBCollegeMessage.sender_id, DBCollegeMessage.college_key, DBCollegeMessage.content).where(DBCollegeMessage.id == target_id))
        me = await fetch_one_off(select(DBUser.college_name, DBUser.teacher_of).where(DBUser.id == reporter_id))
        if not rows or not me or rows[0].college_key not in (college_key_of(me[0].college_name or ""), me[0].teacher_of or ""):
            raise missing
        return rows[0].sender_id, snapshot_text(rows[0].content), "college-hub.html"
    if kind == "board_post":
        rows = await fetch_one_off(select(DBBoardPost.author_id, DBBoardPost.title, DBBoardPost.description).where(DBBoardPost.id == target_id))
        if not rows:
            raise missing
        return rows[0].author_id, f"{rows[0].title or ''}\n{rows[0].description or ''}"[:2000], "board.html"
    if kind == "team":
        rows = await fetch_one_off(select(DBTeam.created_by, DBTeam.name, DBTeam.description).where(DBTeam.id == target_id))
        if not rows:
            raise missing
        return rows[0].created_by, f"{rows[0].name or ''}: {rows[0].description or ''}"[:2000], f"team.html?team={target_id}"
    raise HTTPException(status_code=400, detail="That cannot be reported.")

@app.post("/api/reports")
@limiter.limit("10/hour", key_func=account_rate_key)
async def create_report(request: Request, body: ReportBody, current_user_id: int = Depends(get_current_user_id)):
    if body.kind not in REPORT_KINDS and body.kind not in EXTRA_REPORT_TARGETS:
        raise HTTPException(status_code=400, detail="That cannot be reported.")
    if body.reason not in REPORT_REASONS:
        raise HTTPException(status_code=400, detail="Pick a reason.")
    owner_id, snapshot, link = await report_target(body.kind, body.target_id, current_user_id)
    if owner_id == current_user_id:
        raise HTTPException(status_code=400, detail="You cannot report yourself or your own posts.")
    already = await fetch_one_off(select(DBContentReport.id).where(DBContentReport.reporter_id == current_user_id, DBContentReport.target_kind == body.kind,
                                                                   DBContentReport.target_id == body.target_id, DBContentReport.status.in_(("open", "reviewing"))))
    if already:
        raise HTTPException(status_code=409, detail="You already reported this. We are looking at it.")
    now_iso = utc_now_iso()
    rows = await run_returning(DBContentReport.__table__.insert().values(
        reporter_id=current_user_id, target_kind=body.kind, target_id=body.target_id, target_user_id=owner_id, reason=body.reason,
        details=clean_text(body.details, 1000, "details"), snapshot=snapshot, link=link, status="open", created_at=now_iso).returning(DBContentReport.id))
    spawn_background(create_notification(current_user_id, "account", f"We got your report (#{rows[0][0]}). We will look at it and tell you what we decide within {REPORT_RESOLVE_DAYS} days.", now_iso, "support.html"))
    spawn_background(notify_founders("account", f"New report: {REPORT_REASONS[body.reason]}. Acknowledge within {REPORT_ACK_HOURS} hours.", "founder.html?tab=safety"))
    return {"id": rows[0][0], "status": "open", "resolve_days": REPORT_RESOLVE_DAYS}

@app.get("/api/report-reasons")
async def report_reasons():
    return {"reasons": [{"key": key, "label": label} for key, label in REPORT_REASONS.items()]}

def report_dict(r, reporter_name, target_name, earlier: int) -> dict:
    created = datetime.fromisoformat((r.created_at or utc_now_iso()).replace("Z", "+00:00"))
    return {"id": r.id, "kind": r.target_kind, "target_id": r.target_id, "target_user_id": r.target_user_id, "target_name": target_name or "",
            "reporter_id": r.reporter_id, "reporter_name": reporter_name or "", "reason": r.reason, "reason_label": REPORT_REASONS.get(r.reason, r.reason),
            "details": r.details or "", "snapshot": r.snapshot or "", "link": r.link or "", "status": r.status, "action_taken": r.action_taken or "",
            "founder_note": r.founder_note or "", "created_at": r.created_at or "", "ack_at": r.ack_at or "", "resolved_at": r.resolved_at or "",
            "ack_by": (created + timedelta(hours=REPORT_ACK_HOURS)).isoformat(), "resolve_by": (created + timedelta(days=REPORT_RESOLVE_DAYS)).isoformat(),
            "earlier_reports": earlier}

@app.get("/api/founder/safety")
async def founder_safety(founder_id: int = Depends(require_founder)):
    """The Safety tab: reports (open first), suspended accounts, under-18s waiting for a guardian."""
    reporter, target = aliased(DBUser), aliased(DBUser)
    open_first = case((DBContentReport.status.in_(("open", "reviewing")), 0), else_=1)
    reports, suspended, waiting = await asyncio.gather(
        fetch_one_off(select(DBContentReport, reporter.name, target.name)
                      .outerjoin(reporter, reporter.id == DBContentReport.reporter_id).outerjoin(target, target.id == DBContentReport.target_user_id)
                      .order_by(open_first, DBContentReport.id.desc()).limit(300)),
        fetch_one_off(select(DBUser.id, DBUser.name, DBUser.suspend_reason).where(DBUser.suspended == 1).order_by(DBUser.id)),
        fetch_one_off(select(DBUser.id, DBUser.name, DBUser.college_name, DBUser.birth_date, DBUser.guardian_email).where(DBUser.guardian_status == "pending").order_by(DBUser.id)),
    )
    per_person: dict = {}
    for r, _, _ in reports:
        per_person[r.target_user_id] = per_person.get(r.target_user_id, 0) + 1
    return {"reports": [report_dict(r, rn, tn, per_person.get(r.target_user_id, 1) - 1) for r, rn, tn in reports],
            "suspended": [{"id": i, "name": n or "", "reason": why or ""} for i, n, why in suspended],
            "guardian_waiting": [{"id": i, "name": n or "", "college": c or "", "birth_date": b or "", "guardian_email": g or ""} for i, n, c, b, g in waiting],
            "email_ready": EMAIL_READY}

async def remove_reported(kind: str, target_id: int):
    if kind in EXTRA_REPORT_TARGETS:
        await EXTRA_REPORT_TARGETS[kind][1](target_id)
    elif kind == "message":
        await run_one_off(update(DBMessage).where(DBMessage.id == target_id).values(content=REMOVED_TEXT))
    elif kind == "team_message":
        await run_one_off(update(DBTeamMessage).where(DBTeamMessage.id == target_id).values(content=REMOVED_TEXT))
    elif kind == "college_message":
        await run_one_off(update(DBCollegeMessage).where(DBCollegeMessage.id == target_id).values(content=REMOVED_TEXT))
    elif kind == "board_post":
        await run_one_off(delete(DBBoardApplication).where(DBBoardApplication.post_id == target_id))
        await run_one_off(delete(DBBoardPost).where(DBBoardPost.id == target_id))
    else:
        raise HTTPException(status_code=400, detail="Remove works for messages and board posts. Suspend the account or warn the person instead.")

async def set_suspended(user_id: int, on: bool, reason: str = ""):
    founder = await fetch_one_off(select(DBUser.is_founder).where(DBUser.id == user_id))
    if not founder:
        raise HTTPException(status_code=404, detail="No such account.")
    if on and (founder[0][0] or 0) == 1:
        raise HTTPException(status_code=400, detail="The founder account cannot be suspended.")
    await run_one_off(update(DBUser).where(DBUser.id == user_id).values(suspended=1 if on else 0, suspend_reason=reason[:300] if on else ""))
    if on:
        SUSPENDED_ACCOUNTS.add(user_id)
        spawn_background(close_account_sockets(user_id))
        spawn_background(broadcast_directory({"type": "profile_removed", "id": user_id}))
    else:
        SUSPENDED_ACCOUNTS.discard(user_id)

@app.post("/api/founder/reports/{report_id}")
async def founder_decide_report(report_id: int, body: ReportDecisionBody, founder_id: int = Depends(require_founder)):
    if body.action not in ("review", "dismiss", "remove", "warn", "suspend"):
        raise HTTPException(status_code=400, detail="Unknown action.")
    rows = await fetch_one_off(select(DBContentReport).where(DBContentReport.id == report_id))
    if not rows:
        raise HTTPException(status_code=404, detail="No such report.")
    report, note, now_iso = rows[0][0], (body.note or "").strip()[:500], utc_now_iso()
    values = {"ack_at": report.ack_at or now_iso, "founder_note": note or report.founder_note or "", "resolver_id": founder_id}
    if body.action == "review":
        values["status"] = "reviewing"
    else:
        reason = REPORT_REASONS.get(report.reason, report.reason or "").lower()
        if body.action == "remove":
            await remove_reported(report.target_kind, report.target_id)
        if body.action == "suspend" and report.target_user_id:
            await set_suspended(report.target_user_id, True, note or reason)
        if body.action in ("remove", "warn", "suspend") and report.target_user_id and body.action != "suspend":
            what = "Something you posted was removed" if body.action == "remove" else "A warning from Connect2Minds"
            spawn_background(create_notification(report.target_user_id, "account", f"{what}: {reason}." + (f" {note}" if note else "") + " Please follow the honour code. You can appeal through Support.", now_iso, "terms.html#honour-code"))
        values.update(status="dismissed" if body.action == "dismiss" else "actioned", resolved_at=now_iso,
                      action_taken={"remove": "removed", "warn": "warned", "suspend": "suspended"}.get(body.action, ""))
        outcome = "we found it does not break our rules" if body.action == "dismiss" else "we took action"
        spawn_background(create_notification(report.reporter_id, "account", f"About your report #{report.id}: {outcome}. Thank you for telling us.", now_iso, ""))
    await run_one_off(update(DBContentReport).where(DBContentReport.id == report_id).values(**values))
    return {"id": report_id, **{k: v for k, v in values.items() if k != "resolver_id"}}

@app.post("/api/founder/users/{user_id}/suspend")
async def founder_suspend(user_id: int, body: ReportDecisionBody, founder_id: int = Depends(require_founder)):
    """action "suspend" or "unsuspend", outside any report."""
    if body.action not in ("suspend", "unsuspend"):
        raise HTTPException(status_code=400, detail="Unknown action.")
    await set_suspended(user_id, body.action == "suspend", (body.note or "").strip())
    if body.action == "unsuspend":
        spawn_background(create_notification(user_id, "account", "Your account is active again.", utc_now_iso(), "home.html"))
    return {"suspended": body.action == "suspend"}

@app.post("/api/founder/guardian/{user_id}")
async def founder_guardian(user_id: int, body: FounderGuardianBody, founder_id: int = Depends(require_founder)):
    """When email is not set up: the founder checks with the guardian (phone or email) and records the answer."""
    if body.decision not in ("approve", "decline"):
        raise HTTPException(status_code=400, detail="Choose approve or decline.")
    rows = await fetch_one_off(select(DBUser.guardian_status).where(DBUser.id == user_id))
    if not rows or rows[0][0] != "pending":
        raise HTTPException(status_code=400, detail="This account is not waiting for a guardian.")
    await decide_guardian(user_id, body.decision == "approve", "recorded by the founder")
    return {"decision": body.decision}


# ==========================================
# 32. XP, DAILY GOAL AND STREAKS (progress.html, the Home ring)
# ==========================================
# Everything a student does to study earns XP: practice, focus minutes, flashcards, tests, helping others.
# A day counts for the streak when its XP reaches the person's daily goal; that day gets a "goal" marker row.
# Each action pays once (unique user, kind, ref) and each kind has a daily cap, so XP cannot be farmed.
class DBXpEvent(Base):
    __tablename__ = "xp_events"
    __table_args__ = (UniqueConstraint("user_id", "kind", "ref", name="ux_xp_events"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    day = Column(String, index=True)               # the site's day (India time)
    kind = Column(String)                          # a key of XP_RULES, or "goal" for the day's marker
    ref = Column(String)                           # what earned it, so it pays once
    points = Column(Integer, default=0)
    created_at = Column(String)

class DBStreakFreeze(Base):
    """A missed day that a streak freeze covered."""
    __tablename__ = "streak_freezes"
    __table_args__ = (UniqueConstraint("user_id", "day", name="ux_streak_freezes"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    day = Column(String)
    month = Column(String)                         # the month it was spent in, for the monthly allowance
    created_at = Column(String)


# kind: (label, daily cap)
XP_RULES = {
    "practice": ("Daily questions", 20),
    "topic": ("Topic practice", 30),
    "focus": ("Focus time", 48),
    "card": ("Flashcards", 60),
    "quiz": ("Quizzes", 15),
    "mock": ("Mock tests", 40),
    "unit": ("Units revised", 15),
    "contribute": ("Helping others", 25),
}
XP_GOALS = (10, 30, 50, 80)                        # casual, regular, serious, intense
XP_DEFAULT_GOAL = 30
XP_CALENDAR_DAYS = 84
XP_FOCUS_MINUTES_PER_POINT = 5
SCHEMA_UPGRADES.append("ALTER TABLE study_settings ADD COLUMN IF NOT EXISTS xp_goal INTEGER")
SCHEMA_UPGRADES.append("CREATE INDEX IF NOT EXISTS ix_xp_events_user_day ON xp_events (user_id, day)")
USER_DATA_ERASED["xp_events"] = ("user_id",)
USER_DATA_ERASED["streak_freezes"] = ("user_id",)
for _table in ("xp_events", "streak_freezes"):
    assert all(column in Base.metadata.tables[_table].c for column in USER_DATA_ERASED[_table])

AWARD_XP_SQL = text("""
WITH used AS (
  SELECT coalesce(sum(points), 0) AS n FROM xp_events WHERE user_id = :uid AND day = :day AND kind = :kind
), ins AS (
  INSERT INTO xp_events (user_id, day, kind, ref, points, created_at)
  SELECT :uid, :day, :kind, :ref, least(:points, :cap - n), :now FROM used WHERE n < :cap
  ON CONFLICT (user_id, kind, ref) DO NOTHING
  RETURNING points
), total AS (
  SELECT coalesce((SELECT sum(points) FROM xp_events WHERE user_id = :uid AND day = :day), 0)
       + coalesce((SELECT sum(points) FROM ins), 0) AS n
), goal AS (
  SELECT coalesce((SELECT xp_goal FROM study_settings WHERE user_id = :uid), :default_goal) AS n
), marker AS (
  INSERT INTO xp_events (user_id, day, kind, ref, points, created_at)
  SELECT :uid, :day, 'goal', :day, 0, :now FROM total, goal WHERE total.n >= goal.n
  ON CONFLICT (user_id, kind, ref) DO NOTHING
  RETURNING 1
)
SELECT coalesce((SELECT sum(points) FROM ins), 0), (SELECT n FROM total), (SELECT n FROM goal), (SELECT count(*) FROM marker)
""")

async def award_xp(user_id: int, kind: str, ref, points: int) -> dict:
    """Gives XP once per (kind, ref), up to the kind's daily cap. Never raises: XP must not break the action that earned it.
    Returns what was given, today's total, the goal and whether this action reached the goal."""
    if kind not in XP_RULES or points <= 0:
        return {"xp": 0}
    try:
        rows = await run_returning(AWARD_XP_SQL.bindparams(
            uid=user_id, day=site_now().date().isoformat(), kind=kind, ref=str(ref)[:120], points=int(points), cap=XP_RULES[kind][1],
            now=utc_now_iso(), default_goal=XP_DEFAULT_GOAL))
        given, total, goal, reached = rows[0]
        return {"xp": int(given or 0), "today": int(total or 0), "goal": int(goal or XP_DEFAULT_GOAL), "goal_reached": bool(reached)}
    except Exception as e:
        print("Error giving XP:", e)
        return {"xp": 0}

def freezes_per_month(founder: bool, plan_key: str) -> int:
    return 2 if founder else int(limit_of(plan_key, "freezes_monthly") or 0)

async def use_streak_freezes(user_id: int, met: set, frozen: set, today, left: int) -> list:
    """Covers the days missed since the last goal day, if the person has enough freezes left for all of them."""
    if left <= 0:
        return []
    covered = met | frozen
    missed, day = [], today - timedelta(days=1)
    while day.isoformat() not in covered and len(missed) <= left:
        missed.append(day.isoformat())
        day -= timedelta(days=1)
    if not missed or len(missed) > left or day.isoformat() not in covered:
        return []
    month, now_iso = today.strftime("%Y-%m"), utc_now_iso()
    await run_one_off(pg_insert(DBStreakFreeze).values([{"user_id": user_id, "day": d, "month": month, "created_at": now_iso} for d in missed])
                      .on_conflict_do_nothing(index_elements=["user_id", "day"]))
    return missed

PROGRESS_SQL = text("""
SELECT
  (SELECT coalesce(json_agg(json_build_array(d.day, d.xp, d.met)), '[]') FROM (
     SELECT day, sum(points) AS xp, bool_or(kind = 'goal') AS met FROM xp_events
     WHERE user_id = :me AND day >= :since GROUP BY day) d) AS days,
  (SELECT coalesce(json_agg(json_build_array(k.kind, k.xp)), '[]') FROM (
     SELECT kind, sum(points) AS xp FROM xp_events WHERE user_id = :me AND day = :today AND kind <> 'goal' GROUP BY kind) k) AS today_kinds,
  (SELECT coalesce(json_agg(json_build_array(f.day, f.month)), '[]') FROM streak_freezes f WHERE f.user_id = :me) AS freezes,
  (SELECT xp_goal FROM study_settings WHERE user_id = :me) AS goal,
  (SELECT coalesce(sum(points), 0) FROM xp_events WHERE user_id = :me AND day >= :week_from) AS week_xp,
  (SELECT coalesce(sum(points), 0) FROM xp_events WHERE user_id = :me) AS total_xp,
  (SELECT coalesce(sum(minutes), 0) FROM study_sessions WHERE user_id = :me AND day = :today) AS focus_today
""")

def week_start(day):
    """The Monday of a day's week."""
    return day - timedelta(days=day.weekday())

def progress_from(rows, today, founder: bool, plan_key: str) -> tuple:
    """Turns PROGRESS_SQL's row into numbers. Returns (glance without the freeze step, met days, frozen days, freezes left)."""
    days, today_kinds, freezes, goal, week_xp, total_xp, focus_today = rows[0]
    days, today_kinds, freezes = [json.loads(value) if isinstance(value, str) else (value or []) for value in (days, today_kinds, freezes)]
    per_day = {day: int(xp or 0) for day, xp, _ in days}
    met = {day for day, _, was_met in days if was_met}
    if per_day.get(today.isoformat(), 0) >= (goal or XP_DEFAULT_GOAL):
        met.add(today.isoformat())          # XP can reach the goal without its marker row (e.g. a goal lowered by hand)
    frozen = {day for day, _ in freezes}
    allowance = freezes_per_month(founder, plan_key)
    left = max(0, allowance - sum(1 for _, spent in freezes if spent == today.strftime("%Y-%m")))
    glance = {
        "today": today.isoformat(), "goal": goal or XP_DEFAULT_GOAL, "goals": list(XP_GOALS), "xp_today": per_day.get(today.isoformat(), 0),
        "goal_met": today.isoformat() in met,
        "by_kind": [{"kind": kind, "label": XP_RULES.get(kind, (kind, 0))[0], "xp": int(xp or 0), "cap": XP_RULES.get(kind, ("", 0))[1]}
                    for kind, xp in today_kinds],
        "week_xp": int(week_xp or 0), "total_xp": int(total_xp or 0), "focus_today": int(focus_today or 0),
        "per_day": per_day, "allowance": allowance, "paid": founder or plan_key != "free",
    }
    return glance, met, frozen, left

async def progress_glance(user_id: int) -> dict:
    """XP today against the goal, the streak (spending freezes when they are due), the last 12 weeks and freezes left.
    Two reads at the same time, plus one write only when a freeze is spent."""
    today = site_now().date()
    (founder, plan_key), rows = await asyncio.gather(
        personal_plan(user_id),
        fetch_one_off(PROGRESS_SQL.bindparams(me=user_id, today=today.isoformat(), since=(today - timedelta(days=STUDY_STREAK_DAYS)).isoformat(),
                                              week_from=week_start(today).isoformat())))
    glance, met, frozen, left = progress_from(rows, today, founder, plan_key)
    used_now = await use_streak_freezes(user_id, met, frozen, today, left)
    frozen |= set(used_now)
    covered = met | frozen
    per_day = glance.pop("per_day")
    best, run = 0, 0
    for back in range(STUDY_STREAK_DAYS, -1, -1):
        run = run + 1 if (today - timedelta(days=back)).isoformat() in covered else 0
        best = max(best, run)
    glance["calendar"] = [{"day": day, "xp": per_day.get(day, 0), "met": day in met, "frozen": day in frozen}
                          for day in ((today - timedelta(days=back)).isoformat() for back in range(XP_CALENDAR_DAYS - 1, -1, -1))]
    glance["streak"], glance["best_streak"] = day_streak(covered, today), best
    glance["freezes"] = {"per_month": glance.pop("allowance"), "left": left - len(used_now), "used_now": used_now}
    return glance


class XpGoalBody(BaseModel):
    goal: int

@app.get("/api/progress")
async def get_progress(current_user_id: int = Depends(get_current_user_id)):
    glance = await progress_glance(current_user_id)
    glance["rules"] = [{"kind": kind, "label": label, "cap": cap} for kind, (label, cap) in XP_RULES.items()]
    return glance

GOAL_MARKER_SQL = text("""
INSERT INTO xp_events (user_id, day, kind, ref, points, created_at)
SELECT :uid, :day, 'goal', :day, 0, :now
WHERE (SELECT coalesce(sum(points), 0) FROM xp_events WHERE user_id = :uid AND day = :day) >= :goal
ON CONFLICT (user_id, kind, ref) DO NOTHING
""")

@app.put("/api/progress/goal")
async def set_xp_goal(body: XpGoalBody, current_user_id: int = Depends(get_current_user_id)):
    if body.goal not in XP_GOALS:
        raise HTTPException(status_code=400, detail="Pick one of the daily goals.")
    await run_one_off(pg_insert(DBStudySetting).values(user_id=current_user_id, xp_goal=body.goal)
                      .on_conflict_do_update(index_elements=["user_id"], set_={"xp_goal": body.goal}))
    # A lower goal can already be met today
    await run_one_off(GOAL_MARKER_SQL.bindparams(uid=current_user_id, day=site_now().date().isoformat(), now=utc_now_iso(), goal=body.goal))
    return await progress_glance(current_user_id)


# ==========================================
# 33. EXAM PREP: SYLLABUS UNITS, PAST-PAPER QUESTIONS, FLASHCARDS (prep.html)
# ==========================================
# A syllabus belongs to a class (college + department + semester + subject) and is typed in once by a student or a
# teacher; everyone in that college can use it. Each student keeps their own progress per unit and links the syllabus
# to a subject of My Study (study_subjects.syllabus_id, exam_date).
# Past-paper questions sit on a syllabus; students add the years a question was asked, so the list sorts by "asked most".
# Flashcards: anyone makes decks; a public deck can be followed by others in the college. Review state is per person
# per card (spaced repetition, SM-2), so following a deck needs no copy.
class DBSyllabus(Base):
    __tablename__ = "syllabi"
    id = Column(Integer, primary_key=True, index=True)
    college_key = Column(String, index=True)
    college_name = Column(String, default="")
    department = Column(String, default="")        # as typed
    department_key = Column(String, index=True)    # lower-cased, like college_key
    semester = Column(Integer, nullable=True)
    subject = Column(String)
    subject_key = Column(String, index=True)       # lower-cased, spaces and punctuation folded, to find the same subject
    code = Column(String, default="")
    created_by = Column(Integer, index=True)
    updated_by = Column(Integer, nullable=True)
    teacher_checked = Column(Integer, default=0)   # 1 once a teacher of the college saved it
    removed = Column(Integer, default=0)
    created_at = Column(String)
    updated_at = Column(String)

class DBSyllabusUnit(Base):
    __tablename__ = "syllabus_units"
    id = Column(Integer, primary_key=True, index=True)
    syllabus_id = Column(Integer, index=True)
    number = Column(Integer)
    title = Column(String)
    topics = Column(String, default="")            # one topic a line

class DBSyllabusProgress(Base):
    __tablename__ = "syllabus_progress"
    __table_args__ = (UniqueConstraint("user_id", "unit_id", name="ux_syllabus_progress"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    syllabus_id = Column(Integer, index=True)
    unit_id = Column(Integer, index=True)
    status = Column(String, default="todo")        # todo, learning, revised, confident
    updated_at = Column(String)

class DBExamQuestion(Base):
    __tablename__ = "exam_questions"
    id = Column(Integer, primary_key=True, index=True)
    syllabus_id = Column(Integer, index=True)
    unit_id = Column(Integer, nullable=True)
    text = Column(String)
    text_key = Column(String, index=True)          # folded text, to spot the same question typed again
    marks = Column(Integer, nullable=True)
    source_note_id = Column(Integer, nullable=True)
    added_by = Column(Integer, index=True)
    removed = Column(Integer, default=0)
    created_at = Column(String)

class DBExamQuestionYear(Base):
    """One exam year a question was asked in. Several people can add years to the same question."""
    __tablename__ = "exam_question_years"
    __table_args__ = (UniqueConstraint("question_id", "year", name="ux_exam_question_years"),)
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, index=True)
    year = Column(Integer)
    added_by = Column(Integer, index=True)
    created_at = Column(String)

class DBExamQuestionVote(Base):
    """'Important': a student marks a question worth preparing."""
    __tablename__ = "exam_question_votes"
    __table_args__ = (UniqueConstraint("question_id", "user_id", name="ux_exam_question_votes"),)
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)

class DBCardDeck(Base):
    __tablename__ = "card_decks"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, index=True)
    title = Column(String)
    syllabus_id = Column(Integer, nullable=True, index=True)
    unit_id = Column(Integer, nullable=True)
    subject = Column(String, default="")           # the subject's name, for decks without a syllabus
    college_key = Column(String, index=True)
    public = Column(Integer, default=0)
    made_by_ai = Column(Integer, default=0)
    removed = Column(Integer, default=0)
    created_at = Column(String)
    updated_at = Column(String)

class DBCard(Base):
    __tablename__ = "cards"
    id = Column(Integer, primary_key=True, index=True)
    deck_id = Column(Integer, index=True)
    front = Column(String)
    back = Column(String)
    position = Column(Integer, default=0)
    created_at = Column(String)

class DBCardFollow(Base):
    """Decks a person reviews: their own and the public ones they follow."""
    __tablename__ = "card_follows"
    __table_args__ = (UniqueConstraint("user_id", "deck_id", name="ux_card_follows"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    deck_id = Column(Integer, index=True)
    created_at = Column(String)

class DBCardState(Base):
    """Where one person is with one card."""
    __tablename__ = "card_states"
    __table_args__ = (UniqueConstraint("user_id", "card_id", name="ux_card_states"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    card_id = Column(Integer, index=True)
    deck_id = Column(Integer, index=True)
    ease = Column(Float, default=2.5)
    interval_days = Column(Integer, default=0)
    due_day = Column(String, index=True)
    reps = Column(Integer, default=0)              # good reviews in a row
    lapses = Column(Integer, default=0)
    first_day = Column(String)                     # the day it was first seen, for the new-cards-a-day limit
    last_day = Column(String)


SCHEMA_UPGRADES.append("ALTER TABLE study_subjects ADD COLUMN IF NOT EXISTS syllabus_id INTEGER")
SCHEMA_UPGRADES.append("ALTER TABLE study_subjects ADD COLUMN IF NOT EXISTS exam_date VARCHAR DEFAULT ''")
SCHEMA_UPGRADES.append("CREATE INDEX IF NOT EXISTS ix_syllabi_class ON syllabi (college_key, department_key, semester)")
SCHEMA_UPGRADES.append("CREATE INDEX IF NOT EXISTS ix_card_states_due ON card_states (user_id, due_day)")
SCHEMA_UPGRADES.append("CREATE INDEX IF NOT EXISTS ix_cards_deck ON cards (deck_id, position)")
DBStudySubject.syllabus_id = Column(Integer, nullable=True)
DBStudySubject.exam_date = Column(String, default="")

USER_DATA_ERASED.update({
    "syllabus_progress": ("user_id",), "exam_question_votes": ("user_id",), "card_follows": ("user_id",), "card_states": ("user_id",),
})
# What a person typed in for their class stays for the class (like notes they shared), shown without a name
USER_DATA_KEPT.update({
    "syllabi": ("created_by", "updated_by"), "exam_questions": ("added_by",), "exam_question_years": ("added_by",), "card_decks": ("owner_id",),
})
for _registry in (USER_DATA_ERASED, USER_DATA_KEPT):
    for _table in ("syllabus_progress", "exam_question_votes", "card_follows", "card_states", "syllabi", "exam_questions", "exam_question_years", "card_decks"):
        assert all(column in Base.metadata.tables[_table].c for column in _registry.get(_table, ()))

PREP_UNIT_STATUSES = ("todo", "learning", "revised", "confident")
PREP_MAX_UNITS = 12
PREP_MAX_DECKS = 200
PREP_MAX_CARDS = 500           # in one deck
PREP_NEW_CARDS_A_DAY = 20
PREP_REVIEW_BATCH = 200
PREP_MARKS = (1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 20)
PREP_EVENING_HOUR = 19
CARD_GRADES = {1: "again", 2: "hard", 3: "good", 4: "easy"}
CARD_MAX_INTERVAL = 365


def fold_key(value: Optional[str]) -> str:
    """'Data  Structures & Algorithms!' -> 'data structures algorithms': for spotting the same subject or question."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (value or "").lower().replace("&", " ")).split())[:300]

def sm2_next(state: Optional[dict], grade: int, today) -> dict:
    """The next review of a card after a grade (1 again, 2 hard, 3 good, 4 easy). state holds ease, interval_days,
    reps, lapses (None for a card seen for the first time). 'Again' makes it due today, so it comes back in the session."""
    ease = (state or {}).get("ease") or 2.5
    interval = (state or {}).get("interval_days") or 0
    reps = (state or {}).get("reps") or 0
    lapses = (state or {}).get("lapses") or 0
    if grade == 1:
        reps, lapses, interval, ease = 0, lapses + (1 if state and state.get("reps") else 0), 0, max(1.3, ease - 0.2)
    elif grade == 2:
        interval, ease = max(1, round(interval * 1.2)), max(1.3, ease - 0.15)
        reps += 1
    elif grade == 3:
        interval = 1 if reps == 0 else 3 if reps == 1 else max(interval + 1, round(interval * ease))
        reps += 1
    else:
        interval = 4 if reps == 0 else max(interval + 2, round(max(interval, 1) * ease * 1.3))
        ease = min(3.0, ease + 0.15)
        reps += 1
    interval = min(CARD_MAX_INTERVAL, interval)
    return {"ease": round(ease, 2), "interval_days": interval, "reps": reps, "lapses": lapses,
            "due_day": (today + timedelta(days=interval)).isoformat()}

async def prep_identity(user_id: int) -> dict:
    """College and class of the caller, plus whether they may edit any syllabus of their college (a teacher there, the founder)."""
    rows = await fetch_one_off(select(DBUser.college_name, DBUser.department, DBUser.teacher_of, DBUser.is_founder).where(DBUser.id == user_id))
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    row = rows[0]
    teacher_key = (row.teacher_of or "").strip()
    key = teacher_key or college_key_of(row.college_name)
    return {"id": user_id, "college_key": key, "college": (row.college_name or "").strip(), "department": (row.department or "").strip(),
            "teacher": bool(teacher_key), "founder": (row.is_founder or 0) == 1}

def can_edit_syllabus(me: dict, syllabus) -> bool:
    return me["founder"] or syllabus.created_by == me["id"] or (me["teacher"] and me["college_key"] == syllabus.college_key)

def unit_card(unit) -> dict:
    return {"id": unit.id, "number": unit.number, "title": unit.title or "", "topics": [t for t in (unit.topics or "").split("\n") if t.strip()]}

def syllabus_card(syllabus, units: list, me: dict, users: int = 0) -> dict:
    return {"id": syllabus.id, "subject": syllabus.subject or "", "code": syllabus.code or "", "department": syllabus.department or "",
            "semester": syllabus.semester, "college": syllabus.college_name or "", "teacher_checked": bool(syllabus.teacher_checked),
            "mine": syllabus.created_by == me["id"], "can_edit": can_edit_syllabus(me, syllabus), "users": users,
            "units": [unit_card(unit) for unit in sorted(units, key=lambda u: (u.number or 0, u.id))], "updated_at": syllabus.updated_at or ""}

async def load_syllabus(syllabus_id: int, me: dict):
    """A syllabus of the caller's college (or any, for the founder). 404 otherwise."""
    rows = await fetch_one_off(select(DBSyllabus).where(DBSyllabus.id == syllabus_id, func.coalesce(DBSyllabus.removed, 0) == 0))
    if not rows or (rows[0][0].college_key != me["college_key"] and not me["founder"]):
        raise HTTPException(status_code=404, detail="That syllabus is not here, or it is for another college.")
    return rows[0][0]


# ---------- reading ----------
PREP_SQL = text("""
SELECT
  (SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'code', s.code, 'syllabus_id', s.syllabus_id,
       'exam_date', coalesce(s.exam_date, '')) ORDER BY s.id), '[]')
     FROM study_subjects s WHERE s.user_id = :me AND coalesce(s.archived, 0) = 0) AS subjects,
  (SELECT coalesce(json_agg(json_build_array(p.unit_id, p.status)), '[]') FROM syllabus_progress p WHERE p.user_id = :me) AS progress,
  (SELECT coalesce(json_agg(json_build_object('id', d.id, 'title', d.title, 'syllabus_id', d.syllabus_id, 'unit_id', d.unit_id, 'subject', d.subject,
       'public', d.public, 'mine', d.owner_id = :me, 'made_by_ai', coalesce(d.made_by_ai, 0),
       'cards', (SELECT count(*) FROM cards c WHERE c.deck_id = d.id),
       'followers', (SELECT count(*) FROM card_follows f2 WHERE f2.deck_id = d.id AND f2.user_id <> d.owner_id),
       'due', (SELECT count(*) FROM card_states cs WHERE cs.user_id = :me AND cs.deck_id = d.id AND cs.due_day <= :today),
       'seen', (SELECT count(*) FROM card_states cs WHERE cs.user_id = :me AND cs.deck_id = d.id)) ORDER BY d.id DESC), '[]')
     FROM card_decks d JOIN card_follows f ON f.deck_id = d.id AND f.user_id = :me WHERE coalesce(d.removed, 0) = 0) AS decks,
  (SELECT count(*) FROM card_states WHERE user_id = :me AND first_day = :today) AS new_today
""")

async def prep_state(user_id: int) -> dict:
    """Everything the Exam Prep page opens with: my subjects with their syllabus and progress, my decks with what is due."""
    today = site_now().date()
    me, rows, (founder, plan_key) = await asyncio.gather(prep_identity(user_id), fetch_one_off(PREP_SQL.bindparams(me=user_id, today=today.isoformat())),
                                                         personal_plan(user_id))
    subjects, progress, decks, new_today = rows[0]
    subjects, progress, decks = [json.loads(value) if isinstance(value, str) else (value or []) for value in (subjects, progress, decks)]
    syllabus_ids = sorted({s["syllabus_id"] for s in subjects if s["syllabus_id"]})
    syllabi, units, users = [], [], []
    if syllabus_ids:
        syllabi, units, users = await asyncio.gather(
            fetch_one_off(select(DBSyllabus).where(DBSyllabus.id.in_(syllabus_ids), func.coalesce(DBSyllabus.removed, 0) == 0)),
            fetch_one_off(select(DBSyllabusUnit).where(DBSyllabusUnit.syllabus_id.in_(syllabus_ids))),
            fetch_one_off(select(DBStudySubject.syllabus_id, func.count()).where(DBStudySubject.syllabus_id.in_(syllabus_ids)).group_by(DBStudySubject.syllabus_id)))
    by_syllabus: dict = {}
    for (unit,) in units:
        by_syllabus.setdefault(unit.syllabus_id, []).append(unit)
    used_by = dict(users)
    cards = {s.id: syllabus_card(s, by_syllabus.get(s.id, []), me, used_by.get(s.id, 0)) for (s,) in syllabi}
    status = {unit_id: state for unit_id, state in progress}
    for subject in subjects:
        syllabus = cards.get(subject["syllabus_id"])
        subject["syllabus"] = syllabus
        if not syllabus:
            subject["syllabus_id"] = None
        exam = subject["exam_date"]
        subject["days_left"] = (datetime.fromisoformat(exam).date() - today).days if exam else None
    due = sum(deck["due"] for deck in decks)
    unseen = sum(max(0, deck["cards"] - deck["seen"]) for deck in decks)
    return {"today": today.isoformat(), "me": {k: me[k] for k in ("college", "department", "teacher", "founder")},
            "subjects": subjects, "progress": status, "decks": decks,
            "cards": {"due": due, "new_left": max(0, PREP_NEW_CARDS_A_DAY - (new_today or 0)), "unseen": unseen,
                      "today_total": due + min(unseen, max(0, PREP_NEW_CARDS_A_DAY - (new_today or 0)))},
            "statuses": list(PREP_UNIT_STATUSES), "marks": list(PREP_MARKS), "paid": founder or plan_key != "free"}

@app.get("/api/prep")
async def get_prep(current_user_id: int = Depends(get_current_user_id)):
    return await prep_state(current_user_id)

PREP_GLANCE_SQL = text("""
SELECT
  (SELECT count(*) FROM card_states cs JOIN card_follows f ON f.user_id = cs.user_id AND f.deck_id = cs.deck_id
     WHERE cs.user_id = :me AND cs.due_day <= :today) AS due,
  (SELECT count(*) FROM cards c JOIN card_follows f ON f.deck_id = c.deck_id AND f.user_id = :me
     WHERE NOT EXISTS (SELECT 1 FROM card_states cs WHERE cs.user_id = :me AND cs.card_id = c.id)) AS unseen,
  (SELECT count(*) FROM card_states WHERE user_id = :me AND first_day = :today) AS new_today,
  (SELECT json_build_object('name', s.name, 'exam_date', s.exam_date, 'syllabus_id', s.syllabus_id,
       'units', (SELECT count(*) FROM syllabus_units u WHERE u.syllabus_id = s.syllabus_id),
       'done', (SELECT count(*) FROM syllabus_progress p WHERE p.user_id = :me AND p.syllabus_id = s.syllabus_id AND p.status IN ('revised', 'confident')))
     FROM study_subjects s WHERE s.user_id = :me AND coalesce(s.archived, 0) = 0 AND coalesce(s.exam_date, '') >= :today
     ORDER BY s.exam_date LIMIT 1) AS exam
""")

async def prep_glance(user_id: int) -> dict:
    """Cards to review today and the nearest exam, for Home and the evening reminder. One read."""
    today = site_now().date()
    rows = await fetch_one_off(PREP_GLANCE_SQL.bindparams(me=user_id, today=today.isoformat()))
    due, unseen, new_today, exam = rows[0]
    exam = json.loads(exam) if isinstance(exam, str) else exam
    if exam:
        exam["days_left"] = (datetime.fromisoformat(exam["exam_date"]).date() - today).days
        exam["units_left"] = max(0, (exam["units"] or 0) - (exam["done"] or 0))
    new_left = max(0, PREP_NEW_CARDS_A_DAY - (new_today or 0))
    return {"cards_due": (due or 0) + min(unseen or 0, new_left), "exam": exam}


# ---------- syllabi ----------
class SyllabusUnitBody(BaseModel):
    id: Optional[int] = None
    title: str
    topics: Optional[List[str]] = []

class SyllabusBody(BaseModel):
    subject: str
    code: Optional[str] = ""
    department: Optional[str] = ""
    semester: Optional[int] = None
    units: List[SyllabusUnitBody]

class SubjectLinkBody(BaseModel):
    syllabus_id: Optional[int] = None
    exam_date: Optional[str] = None
    clear_exam: Optional[bool] = False

class UnitStatusBody(BaseModel):
    unit_id: int
    status: str

def clean_units(units: List[SyllabusUnitBody]) -> list:
    if not (1 <= len(units) <= PREP_MAX_UNITS):
        raise HTTPException(status_code=400, detail=f"A syllabus has 1 to {PREP_MAX_UNITS} units.")
    cleaned = []
    for number, unit in enumerate(units, start=1):
        topics = [clean_text(t, 200, "topic") for t in (unit.topics or []) if (t or "").strip()][:40]
        cleaned.append({"id": unit.id, "number": number, "title": clean_required(unit.title, 160, f"title of unit {number}"), "topics": "\n".join(topics)})
    return cleaned

def clean_semester(value: Optional[int]) -> Optional[int]:
    if value is not None and not (1 <= value <= 12):
        raise HTTPException(status_code=400, detail="The semester is a number from 1 to 12.")
    return value

@app.get("/api/prep/syllabi")
async def list_syllabi(department: Optional[str] = "", semester: Optional[int] = None, q: Optional[str] = "",
                       current_user_id: int = Depends(get_current_user_id)):
    """Syllabi of my college, my department first; filtered by department, semester and a search."""
    me = await prep_identity(current_user_id)
    if not me["college_key"]:
        return {"syllabi": [], "college": "", "need_college": True}
    conditions = [DBSyllabus.college_key == me["college_key"], func.coalesce(DBSyllabus.removed, 0) == 0]
    if (department or "").strip():
        conditions.append(DBSyllabus.department_key == college_key_of(department))
    if semester:
        conditions.append(DBSyllabus.semester == semester)
    if fold_key(q):
        conditions.append(DBSyllabus.subject_key.contains(fold_key(q)))
    own_department = case((DBSyllabus.department_key == college_key_of(me["department"]), 0), else_=1)
    rows = await fetch_one_off(select(DBSyllabus).where(*conditions).order_by(own_department, DBSyllabus.semester, DBSyllabus.subject).limit(200))
    ids = [s.id for (s,) in rows]
    units, users = [], []
    if ids:
        units, users = await asyncio.gather(
            fetch_one_off(select(DBSyllabusUnit).where(DBSyllabusUnit.syllabus_id.in_(ids))),
            fetch_one_off(select(DBStudySubject.syllabus_id, func.count()).where(DBStudySubject.syllabus_id.in_(ids)).group_by(DBStudySubject.syllabus_id)))
    by_syllabus: dict = {}
    for (unit,) in units:
        by_syllabus.setdefault(unit.syllabus_id, []).append(unit)
    used_by = dict(users)
    return {"college": me["college"], "syllabi": [syllabus_card(s, by_syllabus.get(s.id, []), me, used_by.get(s.id, 0)) for (s,) in rows]}

@app.post("/api/prep/syllabi")
async def create_syllabus(body: SyllabusBody, current_user_id: int = Depends(get_current_user_id)):
    me = await prep_identity(current_user_id)
    if not me["college_key"]:
        raise HTTPException(status_code=400, detail="Add your college on your profile first. A syllabus is shared with your college.")
    subject = clean_required(body.subject, 120, "subject")
    department = clean_text(body.department, 120, "department") or me["department"]
    semester = clean_semester(body.semester)
    units = clean_units(body.units)
    same = await fetch_one_off(select(DBSyllabus.id).where(
        DBSyllabus.college_key == me["college_key"], DBSyllabus.department_key == college_key_of(department), DBSyllabus.semester == semester,
        DBSyllabus.subject_key == fold_key(subject), func.coalesce(DBSyllabus.removed, 0) == 0))
    if same:
        raise HTTPException(status_code=409, detail=f"Your class already has a syllabus for {subject}. Use that one (it is listed under Find your syllabus).")
    now_iso = utc_now_iso()
    async with AutocommitSession() as db:
        syllabus_id = (await db.execute(DBSyllabus.__table__.insert().values(
            college_key=me["college_key"], college_name=me["college"], department=department, department_key=college_key_of(department), semester=semester,
            subject=subject, subject_key=fold_key(subject), code=clean_text(body.code, 30, "subject code"), created_by=current_user_id,
            updated_by=current_user_id, teacher_checked=1 if me["teacher"] else 0, removed=0, created_at=now_iso, updated_at=now_iso).returning(DBSyllabus.id))).scalar()
        await db.execute(DBSyllabusUnit.__table__.insert().values([{"syllabus_id": syllabus_id, "number": u["number"], "title": u["title"], "topics": u["topics"]} for u in units]))
    spawn_background(award_xp(current_user_id, "contribute", f"syllabus:{syllabus_id}", 5))
    return {"id": syllabus_id}

@app.put("/api/prep/syllabi/{syllabus_id}")
async def edit_syllabus(syllabus_id: int, body: SyllabusBody, current_user_id: int = Depends(get_current_user_id)):
    """Units keep their id (and everyone's progress) when sent back with it; units left out are removed."""
    me = await prep_identity(current_user_id)
    syllabus = await load_syllabus(syllabus_id, me)
    if not can_edit_syllabus(me, syllabus):
        raise HTTPException(status_code=403, detail="Only the person who added this syllabus or a teacher of your college can change it. You can report a mistake.")
    units = clean_units(body.units)
    existing = {unit_id for (unit_id,) in await fetch_one_off(select(DBSyllabusUnit.id).where(DBSyllabusUnit.syllabus_id == syllabus_id))}
    keep = {u["id"] for u in units if u["id"] in existing}
    gone = existing - keep
    async with AutocommitSession() as db:
        await db.execute(update(DBSyllabus).where(DBSyllabus.id == syllabus_id).values(
            subject=clean_required(body.subject, 120, "subject"), subject_key=fold_key(body.subject), code=clean_text(body.code, 30, "subject code"),
            semester=clean_semester(body.semester), updated_by=current_user_id, updated_at=utc_now_iso(),
            teacher_checked=1 if (me["teacher"] or syllabus.teacher_checked) else 0))
        for u in units:
            if u["id"] in keep:
                await db.execute(update(DBSyllabusUnit).where(DBSyllabusUnit.id == u["id"]).values(number=u["number"], title=u["title"], topics=u["topics"]))
            else:
                await db.execute(DBSyllabusUnit.__table__.insert().values(syllabus_id=syllabus_id, number=u["number"], title=u["title"], topics=u["topics"]))
        if gone:
            await db.execute(delete(DBSyllabusUnit).where(DBSyllabusUnit.id.in_(gone)))
            await db.execute(delete(DBSyllabusProgress).where(DBSyllabusProgress.unit_id.in_(gone)))
            await db.execute(update(DBExamQuestion).where(DBExamQuestion.unit_id.in_(gone)).values(unit_id=None))
    return {"id": syllabus_id}

@app.delete("/api/prep/syllabi/{syllabus_id}")
async def delete_syllabus(syllabus_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Taken down for everyone. The person who added it can do that only while nobody else uses it."""
    me = await prep_identity(current_user_id)
    syllabus = await load_syllabus(syllabus_id, me)
    if not can_edit_syllabus(me, syllabus):
        raise HTTPException(status_code=403, detail="Only the person who added this syllabus or a teacher of your college can remove it.")
    others = await fetch_one_off(select(func.count()).select_from(DBStudySubject).where(DBStudySubject.syllabus_id == syllabus_id, DBStudySubject.user_id != current_user_id))
    if others[0][0] and not (me["teacher"] or me["founder"]):
        raise HTTPException(status_code=409, detail="Classmates are using this syllabus, so it stays. You can edit it instead.")
    await remove_syllabus(syllabus_id)
    return {"removed": syllabus_id}

async def remove_syllabus(syllabus_id: int):
    await run_one_off(update(DBSyllabus).where(DBSyllabus.id == syllabus_id).values(removed=1, updated_at=utc_now_iso()))
    await run_one_off(update(DBStudySubject).where(DBStudySubject.syllabus_id == syllabus_id).values(syllabus_id=None))

@app.put("/api/prep/subjects/{subject_id}")
async def link_subject(subject_id: int, body: SubjectLinkBody, current_user_id: int = Depends(get_current_user_id)):
    """Links one of my My Study subjects to a syllabus and/or sets its exam date."""
    await require_own_subject(current_user_id, subject_id)
    values: dict = {}
    if body.syllabus_id is not None:
        if body.syllabus_id:
            await load_syllabus(body.syllabus_id, await prep_identity(current_user_id))
        values["syllabus_id"] = body.syllabus_id or None
    if body.clear_exam:
        values["exam_date"] = ""
    elif body.exam_date:
        try:
            exam = datetime.fromisoformat(body.exam_date).date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Give the exam date as a date.")
        if not (site_now().date() - timedelta(days=30) <= exam <= site_now().date() + timedelta(days=400)):
            raise HTTPException(status_code=400, detail="That exam date is too far away.")
        values["exam_date"] = exam.isoformat()
    if not values:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    await run_one_off(update(DBStudySubject).where(DBStudySubject.id == subject_id, DBStudySubject.user_id == current_user_id).values(**values))
    return {"id": subject_id, **values}

class PrepSubjectBody(BaseModel):
    syllabus_id: int

@app.post("/api/prep/subjects")
async def add_subject_from_syllabus(body: PrepSubjectBody, current_user_id: int = Depends(get_current_user_id)):
    """Adds a syllabus's subject to My Study, already linked."""
    syllabus = await load_syllabus(body.syllabus_id, await prep_identity(current_user_id))
    count, same = await asyncio.gather(
        fetch_one_off(select(func.count()).select_from(DBStudySubject).where(DBStudySubject.user_id == current_user_id)),
        fetch_one_off(select(DBStudySubject.id).where(DBStudySubject.user_id == current_user_id, DBStudySubject.syllabus_id == syllabus.id)))
    if same:
        return {"id": same[0][0]}
    if count[0][0] >= STUDY_MAX_SUBJECTS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {STUDY_MAX_SUBJECTS} subjects.")
    rows = await run_returning(DBStudySubject.__table__.insert().values(
        user_id=current_user_id, name=syllabus.subject, code=syllabus.code or "", goal=75, base_attended=0, base_total=0, archived=0,
        syllabus_id=syllabus.id, exam_date="", created_at=utc_now_iso()).returning(DBStudySubject.id))
    return {"id": rows[0][0]}

@app.put("/api/prep/progress")
async def set_unit_status(body: UnitStatusBody, current_user_id: int = Depends(get_current_user_id)):
    if body.status not in PREP_UNIT_STATUSES:
        raise HTTPException(status_code=400, detail="Pick how far you are with this unit.")
    me = await prep_identity(current_user_id)
    rows = await fetch_one_off(select(DBSyllabusUnit.syllabus_id).where(DBSyllabusUnit.id == body.unit_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That unit is no longer in the syllabus.")
    await load_syllabus(rows[0][0], me)
    values = {"status": body.status, "updated_at": utc_now_iso()}
    await run_one_off(pg_insert(DBSyllabusProgress).values(user_id=current_user_id, syllabus_id=rows[0][0], unit_id=body.unit_id, **values)
                      .on_conflict_do_update(index_elements=["user_id", "unit_id"], set_=values))
    xp = await award_xp(current_user_id, "unit", f"unit:{body.unit_id}", 3) if body.status in ("revised", "confident") else {"xp": 0}
    return {"unit_id": body.unit_id, "status": body.status, "xp": xp}


# ---------- past-paper questions ----------
class ExamQuestionBody(BaseModel):
    syllabus_id: int
    unit_id: Optional[int] = None
    text: str
    marks: Optional[int] = None
    year: Optional[int] = None
    source_note_id: Optional[int] = None

class QuestionYearBody(BaseModel):
    year: int

class QuestionEditBody(BaseModel):
    unit_id: Optional[int] = None
    marks: Optional[int] = None
    text: Optional[str] = None

def clean_year(year: Optional[int]) -> Optional[int]:
    if year is not None and not (1990 <= year <= site_now().year):
        raise HTTPException(status_code=400, detail="Give the exam year, like 2024.")
    return year

async def load_question(question_id: int, me: dict):
    rows = await fetch_one_off(select(DBExamQuestion, DBSyllabus).join(DBSyllabus, DBSyllabus.id == DBExamQuestion.syllabus_id)
                               .where(DBExamQuestion.id == question_id, func.coalesce(DBExamQuestion.removed, 0) == 0))
    if not rows or (rows[0][1].college_key != me["college_key"] and not me["founder"]):
        raise HTTPException(status_code=404, detail="That question is no longer here.")
    return rows[0]

@app.get("/api/prep/syllabi/{syllabus_id}/questions")
async def list_exam_questions(syllabus_id: int, current_user_id: int = Depends(get_current_user_id)):
    """The syllabus's questions, asked-most first. Names are left out: who added a question does not matter."""
    me = await prep_identity(current_user_id)
    syllabus = await load_syllabus(syllabus_id, me)
    years = func.count(func.distinct(DBExamQuestionYear.year))
    rows = await fetch_one_off(
        select(DBExamQuestion, func.array_agg(func.distinct(DBExamQuestionYear.year)), years,
               select(func.count()).where(DBExamQuestionVote.question_id == DBExamQuestion.id).scalar_subquery(),
               exists().where(DBExamQuestionVote.question_id == DBExamQuestion.id, DBExamQuestionVote.user_id == current_user_id))
        .outerjoin(DBExamQuestionYear, DBExamQuestionYear.question_id == DBExamQuestion.id)
        .where(DBExamQuestion.syllabus_id == syllabus_id, func.coalesce(DBExamQuestion.removed, 0) == 0)
        .group_by(DBExamQuestion.id).limit(1000))
    questions = []
    for question, year_list, year_count, votes, voted in rows:
        questions.append({"id": question.id, "unit_id": question.unit_id, "text": question.text or "", "marks": question.marks,
                          "years": sorted([y for y in (year_list or []) if y], reverse=True), "votes": votes or 0, "voted": bool(voted),
                          "mine": question.added_by == current_user_id, "source_note_id": question.source_note_id,
                          "can_remove": question.added_by == current_user_id or me["founder"] or (me["teacher"] and me["college_key"] == syllabus.college_key)})
    questions.sort(key=lambda q: (-len(q["years"]), -q["votes"], -(q["years"][0] if q["years"] else 0), q["id"]))
    papers = sorted({y for q in questions for y in q["years"]}, reverse=True)
    return {"syllabus_id": syllabus_id, "questions": questions, "papers": papers}

@app.post("/api/prep/questions")
async def add_exam_question(body: ExamQuestionBody, current_user_id: int = Depends(get_current_user_id)):
    """A question from a past paper. If the same question is already listed, only the year is added to it."""
    me = await prep_identity(current_user_id)
    await load_syllabus(body.syllabus_id, me)
    text_value = clean_required(body.text, 2000, "question")
    key = fold_key(text_value)
    if len(key) < 8:
        raise HTTPException(status_code=400, detail="Type the whole question as it was asked.")
    if body.marks is not None and body.marks not in PREP_MARKS:
        raise HTTPException(status_code=400, detail="Pick the marks the question carried.")
    year = clean_year(body.year)
    if body.unit_id:
        unit = await fetch_one_off(select(DBSyllabusUnit.id).where(DBSyllabusUnit.id == body.unit_id, DBSyllabusUnit.syllabus_id == body.syllabus_id))
        if not unit:
            raise HTTPException(status_code=400, detail="That unit is not in this syllabus.")
    now_iso = utc_now_iso()
    same = await fetch_one_off(select(DBExamQuestion.id).where(DBExamQuestion.syllabus_id == body.syllabus_id, DBExamQuestion.text_key == key,
                                                               func.coalesce(DBExamQuestion.removed, 0) == 0))
    merged = bool(same)
    if same:
        question_id = same[0][0]
    else:
        rows = await run_returning(DBExamQuestion.__table__.insert().values(
            syllabus_id=body.syllabus_id, unit_id=body.unit_id or None, text=text_value, text_key=key, marks=body.marks,
            source_note_id=body.source_note_id or None, added_by=current_user_id, removed=0, created_at=now_iso).returning(DBExamQuestion.id))
        question_id = rows[0][0]
    if year:
        await run_one_off(pg_insert(DBExamQuestionYear).values(question_id=question_id, year=year, added_by=current_user_id, created_at=now_iso)
                          .on_conflict_do_nothing(index_elements=["question_id", "year"]))
    xp = await award_xp(current_user_id, "contribute", f"question:{question_id}:{year or 0}", 5)
    return {"id": question_id, "merged": merged, "xp": xp}

@app.post("/api/prep/questions/{question_id}/years")
async def add_question_year(question_id: int, body: QuestionYearBody, current_user_id: int = Depends(get_current_user_id)):
    await load_question(question_id, await prep_identity(current_user_id))
    year = clean_year(body.year)
    saved = await run_returning(pg_insert(DBExamQuestionYear).values(question_id=question_id, year=year, added_by=current_user_id, created_at=utc_now_iso())
                                .on_conflict_do_nothing(index_elements=["question_id", "year"]).returning(DBExamQuestionYear.id))
    xp = await award_xp(current_user_id, "contribute", f"question:{question_id}:{year}", 5) if saved else {"xp": 0}
    return {"id": question_id, "year": year, "added": bool(saved), "xp": xp}

@app.post("/api/prep/questions/{question_id}/vote")
async def vote_question(question_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Toggles 'important'."""
    await load_question(question_id, await prep_identity(current_user_id))
    removed = await run_returning(delete(DBExamQuestionVote).where(DBExamQuestionVote.question_id == question_id, DBExamQuestionVote.user_id == current_user_id)
                                  .returning(DBExamQuestionVote.id))
    if not removed:
        await run_one_off(pg_insert(DBExamQuestionVote).values(question_id=question_id, user_id=current_user_id).on_conflict_do_nothing(index_elements=["question_id", "user_id"]))
    return {"id": question_id, "voted": not removed}

@app.put("/api/prep/questions/{question_id}")
async def edit_exam_question(question_id: int, body: QuestionEditBody, current_user_id: int = Depends(get_current_user_id)):
    """The person who added it (or a teacher, the founder) fixes the unit, the marks or a typo."""
    me = await prep_identity(current_user_id)
    question, syllabus = await load_question(question_id, me)
    if question.added_by != current_user_id and not ((me["teacher"] and me["college_key"] == syllabus.college_key) or me["founder"]):
        raise HTTPException(status_code=403, detail="Only the person who added this question or a teacher can change it.")
    values: dict = {}
    if body.unit_id is not None:
        if body.unit_id and not await fetch_one_off(select(DBSyllabusUnit.id).where(DBSyllabusUnit.id == body.unit_id, DBSyllabusUnit.syllabus_id == syllabus.id)):
            raise HTTPException(status_code=400, detail="That unit is not in this syllabus.")
        values["unit_id"] = body.unit_id or None
    if body.marks is not None:
        if body.marks and body.marks not in PREP_MARKS:
            raise HTTPException(status_code=400, detail="Pick the marks the question carried.")
        values["marks"] = body.marks or None
    if body.text is not None:
        values["text"] = clean_required(body.text, 2000, "question")
        values["text_key"] = fold_key(values["text"])
    if values:
        await run_one_off(update(DBExamQuestion).where(DBExamQuestion.id == question_id).values(**values))
    return {"id": question_id}

@app.delete("/api/prep/questions/{question_id}")
async def delete_exam_question(question_id: int, current_user_id: int = Depends(get_current_user_id)):
    me = await prep_identity(current_user_id)
    question, syllabus = await load_question(question_id, me)
    if question.added_by != current_user_id and not ((me["teacher"] and me["college_key"] == syllabus.college_key) or me["founder"]):
        raise HTTPException(status_code=403, detail="Only the person who added this question or a teacher can remove it. You can report it.")
    await run_one_off(update(DBExamQuestion).where(DBExamQuestion.id == question_id).values(removed=1))
    return {"removed": question_id}


# ---------- flashcard decks ----------
class DeckBody(BaseModel):
    title: str
    syllabus_id: Optional[int] = None
    unit_id: Optional[int] = None
    subject: Optional[str] = ""
    public: Optional[bool] = False

class CardBody(BaseModel):
    front: str
    back: str

class CardsBody(BaseModel):
    cards: List[CardBody]

class ReviewBody(BaseModel):
    card_id: int
    grade: int

def clean_card(card: CardBody) -> dict:
    return {"front": clean_required(card.front, 600, "front of the card"), "back": clean_required(card.back, 2000, "back of the card")}

async def load_deck(deck_id: int, user_id: int, me: Optional[dict] = None, owner: bool = False):
    """A deck the person may see: their own, or a public one of their college. owner=True: only their own (or the founder)."""
    rows = await fetch_one_off(select(DBCardDeck).where(DBCardDeck.id == deck_id, func.coalesce(DBCardDeck.removed, 0) == 0))
    if not rows:
        raise HTTPException(status_code=404, detail="That deck is no longer here.")
    deck = rows[0][0]
    if deck.owner_id == user_id:
        return deck
    me = me or await prep_identity(user_id)
    if owner and not me["founder"]:
        raise HTTPException(status_code=403, detail="Only the person who made this deck can change it.")
    if not me["founder"] and not (deck.public and deck.college_key == me["college_key"]):
        raise HTTPException(status_code=404, detail="That deck is private, or it is for another college.")
    return deck

def deck_card(deck, cards: int = 0, followers: int = 0, following: bool = False, me_id: int = 0) -> dict:
    return {"id": deck.id, "title": deck.title or "", "syllabus_id": deck.syllabus_id, "unit_id": deck.unit_id, "subject": deck.subject or "",
            "public": bool(deck.public), "mine": deck.owner_id == me_id, "made_by_ai": bool(deck.made_by_ai), "cards": cards,
            "followers": followers, "following": following, "updated_at": deck.updated_at or ""}

async def deck_syllabus_fields(body: DeckBody, me: dict) -> dict:
    subject = clean_text(body.subject, 120, "subject")
    if body.syllabus_id:
        syllabus = await load_syllabus(body.syllabus_id, me)
        subject = syllabus.subject or subject
        if body.unit_id and not await fetch_one_off(select(DBSyllabusUnit.id).where(DBSyllabusUnit.id == body.unit_id, DBSyllabusUnit.syllabus_id == syllabus.id)):
            raise HTTPException(status_code=400, detail="That unit is not in this syllabus.")
    return {"syllabus_id": body.syllabus_id or None, "unit_id": (body.unit_id or None) if body.syllabus_id else None, "subject": subject}

@app.get("/api/prep/decks")
async def browse_decks(syllabus_id: Optional[int] = None, q: Optional[str] = "", current_user_id: int = Depends(get_current_user_id)):
    """Public decks of my college (for a syllabus, or by search), most followed first."""
    me = await prep_identity(current_user_id)
    followers = select(func.count()).where(DBCardFollow.deck_id == DBCardDeck.id, DBCardFollow.user_id != DBCardDeck.owner_id).scalar_subquery()
    count = select(func.count()).where(DBCard.deck_id == DBCardDeck.id).scalar_subquery()
    following = exists().where(DBCardFollow.deck_id == DBCardDeck.id, DBCardFollow.user_id == current_user_id)
    conditions = [DBCardDeck.public == 1, DBCardDeck.college_key == me["college_key"], func.coalesce(DBCardDeck.removed, 0) == 0, count > 0]
    if syllabus_id:
        conditions.append(DBCardDeck.syllabus_id == syllabus_id)
    if (q or "").strip():
        like = f"%{q.strip()[:60]}%"
        conditions.append(or_(DBCardDeck.title.ilike(like), DBCardDeck.subject.ilike(like)))
    rows = await fetch_one_off(select(DBCardDeck, count, followers, following).where(*conditions).order_by(followers.desc(), DBCardDeck.id.desc()).limit(60))
    return {"decks": [deck_card(d, c, f, bool(g), current_user_id) for d, c, f, g in rows]}

@app.get("/api/prep/decks/{deck_id}")
async def get_deck(deck_id: int, current_user_id: int = Depends(get_current_user_id)):
    deck = await load_deck(deck_id, current_user_id)
    cards, followers, following = await asyncio.gather(
        fetch_one_off(select(DBCard.id, DBCard.front, DBCard.back).where(DBCard.deck_id == deck_id).order_by(DBCard.position, DBCard.id)),
        fetch_one_off(select(func.count()).where(DBCardFollow.deck_id == deck_id, DBCardFollow.user_id != deck.owner_id)),
        fetch_one_off(select(DBCardFollow.id).where(DBCardFollow.deck_id == deck_id, DBCardFollow.user_id == current_user_id)))
    card = deck_card(deck, len(cards), followers[0][0], bool(following), current_user_id)
    card["items"] = [{"id": i, "front": f or "", "back": b or ""} for i, f, b in cards]
    return card

@app.post("/api/prep/decks")
async def create_deck(body: DeckBody, current_user_id: int = Depends(get_current_user_id)):
    me = await prep_identity(current_user_id)
    owned = await fetch_one_off(select(func.count()).select_from(DBCardDeck).where(DBCardDeck.owner_id == current_user_id, func.coalesce(DBCardDeck.removed, 0) == 0))
    if owned[0][0] >= PREP_MAX_DECKS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {PREP_MAX_DECKS} decks.")
    fields = await deck_syllabus_fields(body, me)
    if body.public and not me["college_key"]:
        raise HTTPException(status_code=400, detail="Add your college on your profile to share a deck with it.")
    now_iso = utc_now_iso()
    rows = await run_returning(DBCardDeck.__table__.insert().values(
        owner_id=current_user_id, title=clean_required(body.title, 120, "deck name"), college_key=me["college_key"], public=1 if body.public else 0,
        made_by_ai=0, removed=0, created_at=now_iso, updated_at=now_iso, **fields).returning(DBCardDeck.id))
    deck_id = rows[0][0]
    await run_one_off(pg_insert(DBCardFollow).values(user_id=current_user_id, deck_id=deck_id, created_at=now_iso).on_conflict_do_nothing(index_elements=["user_id", "deck_id"]))
    return {"id": deck_id}

@app.put("/api/prep/decks/{deck_id}")
async def edit_deck(deck_id: int, body: DeckBody, current_user_id: int = Depends(get_current_user_id)):
    me = await prep_identity(current_user_id)
    await load_deck(deck_id, current_user_id, me, owner=True)
    fields = await deck_syllabus_fields(body, me)
    await run_one_off(update(DBCardDeck).where(DBCardDeck.id == deck_id).values(
        title=clean_required(body.title, 120, "deck name"), public=1 if body.public else 0, updated_at=utc_now_iso(), **fields))
    return {"id": deck_id}

@app.delete("/api/prep/decks/{deck_id}")
async def delete_deck(deck_id: int, current_user_id: int = Depends(get_current_user_id)):
    """The owner's delete removes it for its followers too (their review history of it goes)."""
    await load_deck(deck_id, current_user_id, owner=True)
    await remove_deck(deck_id)
    return {"removed": deck_id}

async def remove_deck(deck_id: int):
    await run_one_off(update(DBCardDeck).where(DBCardDeck.id == deck_id).values(removed=1, updated_at=utc_now_iso()))
    await run_one_off(delete(DBCardFollow).where(DBCardFollow.deck_id == deck_id))
    await run_one_off(delete(DBCardState).where(DBCardState.deck_id == deck_id))

@app.post("/api/prep/decks/{deck_id}/cards")
async def add_cards(deck_id: int, body: CardsBody, current_user_id: int = Depends(get_current_user_id)):
    await load_deck(deck_id, current_user_id, owner=True)
    cards = [clean_card(card) for card in body.cards]
    if not cards:
        raise HTTPException(status_code=400, detail="Add at least one card.")
    count = (await fetch_one_off(select(func.count(), func.coalesce(func.max(DBCard.position), 0)).where(DBCard.deck_id == deck_id)))[0]
    if count[0] + len(cards) > PREP_MAX_CARDS:
        raise HTTPException(status_code=400, detail=f"A deck holds up to {PREP_MAX_CARDS} cards. Start a second deck for the rest.")
    now_iso = utc_now_iso()
    rows = await run_returning(DBCard.__table__.insert().values([{"deck_id": deck_id, "position": count[1] + i + 1, "created_at": now_iso, **card}
                                                                 for i, card in enumerate(cards)]).returning(DBCard.id))
    await run_one_off(update(DBCardDeck).where(DBCardDeck.id == deck_id).values(updated_at=now_iso))
    return {"ids": [row[0] for row in rows]}

async def load_own_card(card_id: int, user_id: int):
    rows = await fetch_one_off(select(DBCard.deck_id).where(DBCard.id == card_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That card is no longer here.")
    await load_deck(rows[0][0], user_id, owner=True)
    return rows[0][0]

@app.put("/api/prep/cards/{card_id}")
async def edit_card(card_id: int, body: CardBody, current_user_id: int = Depends(get_current_user_id)):
    await load_own_card(card_id, current_user_id)
    await run_one_off(update(DBCard).where(DBCard.id == card_id).values(**clean_card(body)))
    return {"id": card_id}

@app.delete("/api/prep/cards/{card_id}")
async def delete_card(card_id: int, current_user_id: int = Depends(get_current_user_id)):
    await load_own_card(card_id, current_user_id)
    await run_one_off(delete(DBCard).where(DBCard.id == card_id))
    await run_one_off(delete(DBCardState).where(DBCardState.card_id == card_id))
    return {"removed": card_id}

@app.post("/api/prep/decks/{deck_id}/follow")
async def follow_deck(deck_id: int, current_user_id: int = Depends(get_current_user_id)):
    deck = await load_deck(deck_id, current_user_id)
    saved = await run_returning(pg_insert(DBCardFollow).values(user_id=current_user_id, deck_id=deck_id, created_at=utc_now_iso())
                                .on_conflict_do_nothing(index_elements=["user_id", "deck_id"]).returning(DBCardFollow.id))
    if saved and deck.owner_id != current_user_id:
        spawn_background(award_xp(deck.owner_id, "contribute", f"follow:{deck_id}:{current_user_id}", 5))
    return {"id": deck_id, "following": True}

@app.delete("/api/prep/decks/{deck_id}/follow")
async def unfollow_deck(deck_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Stops reviewing a deck (and forgets where I was with it). Own decks are deleted instead."""
    rows = await fetch_one_off(select(DBCardDeck.owner_id).where(DBCardDeck.id == deck_id))
    if rows and rows[0][0] == current_user_id:
        raise HTTPException(status_code=400, detail="This is your own deck. Delete it instead.")
    await run_one_off(delete(DBCardFollow).where(DBCardFollow.deck_id == deck_id, DBCardFollow.user_id == current_user_id))
    await run_one_off(delete(DBCardState).where(DBCardState.deck_id == deck_id, DBCardState.user_id == current_user_id))
    return {"id": deck_id, "following": False}


# ---------- reviewing ----------
REVIEW_SQL = text("""
SELECT c.id, c.deck_id, c.front, c.back, d.title, cs.reps, cs.interval_days, cs.due_day
FROM card_states cs JOIN cards c ON c.id = cs.card_id JOIN card_decks d ON d.id = c.deck_id
JOIN card_follows f ON f.user_id = :me AND f.deck_id = d.id
WHERE cs.user_id = :me AND cs.due_day <= :today AND coalesce(d.removed, 0) = 0 AND (:deck = 0 OR d.id = :deck)
ORDER BY cs.due_day, cs.interval_days, c.id LIMIT :batch
""")
NEW_CARDS_SQL = text("""
SELECT c.id, c.deck_id, c.front, c.back, d.title
FROM cards c JOIN card_decks d ON d.id = c.deck_id JOIN card_follows f ON f.user_id = :me AND f.deck_id = d.id
WHERE coalesce(d.removed, 0) = 0 AND (:deck = 0 OR d.id = :deck)
  AND NOT EXISTS (SELECT 1 FROM card_states cs WHERE cs.user_id = :me AND cs.card_id = c.id)
ORDER BY d.id, c.position, c.id LIMIT :room
""")

@app.get("/api/prep/review")
async def review_queue(deck: Optional[int] = 0, current_user_id: int = Depends(get_current_user_id)):
    """Today's cards: the due ones first, then new ones up to the new-cards-a-day limit."""
    today = site_now().date().isoformat()
    due, new_today = await asyncio.gather(
        fetch_one_off(REVIEW_SQL.bindparams(me=current_user_id, today=today, deck=deck or 0, batch=PREP_REVIEW_BATCH)),
        fetch_one_off(select(func.count()).select_from(DBCardState).where(DBCardState.user_id == current_user_id, DBCardState.first_day == today)))
    room = max(0, min(PREP_NEW_CARDS_A_DAY - new_today[0][0], PREP_REVIEW_BATCH - len(due)))
    fresh = await fetch_one_off(NEW_CARDS_SQL.bindparams(me=current_user_id, deck=deck or 0, room=room)) if room else []
    as_card = lambda row, new: {"id": row.id, "deck_id": row.deck_id, "front": row.front or "", "back": row.back or "", "deck": row.title or "", "new": new}
    return {"today": today, "cards": [as_card(row, False) for row in due] + [as_card(row, True) for row in fresh],
            "new_left": room, "new_a_day": PREP_NEW_CARDS_A_DAY}

@app.post("/api/prep/review")
async def review_card(body: ReviewBody, current_user_id: int = Depends(get_current_user_id)):
    if body.grade not in CARD_GRADES:
        raise HTTPException(status_code=400, detail="Grade the card from 1 (again) to 4 (easy).")
    rows, state_rows = await asyncio.gather(
        fetch_one_off(select(DBCard.deck_id).join(DBCardFollow, and_(DBCardFollow.deck_id == DBCard.deck_id, DBCardFollow.user_id == current_user_id))
                      .where(DBCard.id == body.card_id)),
        fetch_one_off(select(DBCardState).where(DBCardState.user_id == current_user_id, DBCardState.card_id == body.card_id)))
    if not rows:
        raise HTTPException(status_code=404, detail="That card is not in a deck you review.")
    today = site_now().date()
    old = state_rows[0][0] if state_rows else None
    state = sm2_next({"ease": old.ease, "interval_days": old.interval_days, "reps": old.reps, "lapses": old.lapses} if old else None, body.grade, today)
    values = {**state, "last_day": today.isoformat()}
    await run_one_off(pg_insert(DBCardState).values(user_id=current_user_id, card_id=body.card_id, deck_id=rows[0][0], first_day=today.isoformat(), **values)
                      .on_conflict_do_update(index_elements=["user_id", "card_id"], set_=values))
    xp = await award_xp(current_user_id, "card", f"card:{body.card_id}:{today.isoformat()}", 1)
    return {"card_id": body.card_id, "grade": CARD_GRADES[body.grade], **state, "again_today": state["interval_days"] == 0, "xp": xp}


# ---------- reports ----------
async def syllabus_report_target(target_id: int, reporter_id: int) -> tuple:
    me = await prep_identity(reporter_id)
    syllabus = await load_syllabus(target_id, me)
    return syllabus.created_by, f"Syllabus: {syllabus.subject} ({syllabus.department}, semester {syllabus.semester or '?'})", "prep.html"

async def question_report_target(target_id: int, reporter_id: int) -> tuple:
    question, _ = await load_question(target_id, await prep_identity(reporter_id))
    return question.added_by, snapshot_text(question.text), "prep.html"

async def deck_report_target(target_id: int, reporter_id: int) -> tuple:
    deck = await load_deck(target_id, reporter_id)
    return deck.owner_id, f"Flashcard deck: {deck.title}", "prep.html"

async def remove_question(target_id: int):
    await run_one_off(update(DBExamQuestion).where(DBExamQuestion.id == target_id).values(removed=1))

EXTRA_REPORT_TARGETS.update({"syllabus": (syllabus_report_target, remove_syllabus), "exam_question": (question_report_target, remove_question),
                             "card_deck": (deck_report_target, remove_deck)})


# ==========================================
# 34. AI STUDY TUTOR (tutor.html)
# ==========================================
# Doubts, exam-style answers (2, 5, 10 marks), past-paper questions explained, and AI-made flashcards and quizzes for
# a syllabus unit or a shared note. Uses the same Claude client as the helper bot (ANTHROPIC_API_KEY in .env), with the
# cheapest fast model the founder picked. Every call's tokens are written to ai_usage; when the month's estimated spend
# reaches AI_MONTHLY_BUDGET_INR the free accounts pause first (at 80%), then everyone (at 100%).
class DBTutorThread(Base):
    __tablename__ = "tutor_threads"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    subject_id = Column(Integer, nullable=True)
    title = Column(String, default="")
    mode = Column(String, default="doubt")
    created_at = Column(String)
    updated_at = Column(String, index=True)

class DBTutorMessage(Base):
    __tablename__ = "tutor_messages"
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    role = Column(String)                          # user, assistant
    content = Column(String)
    created_at = Column(String)

class DBTutorQuiz(Base):
    __tablename__ = "tutor_quizzes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    title = Column(String, default="")
    questions = Column(String)                     # JSON list of {q, options, answer, why}
    score = Column(Integer, nullable=True)
    created_at = Column(String)
    finished_at = Column(String, default="")

class DBAiUsage(Base):
    """One model call: who, what for, tokens and the estimated cost (millionths of a US dollar)."""
    __tablename__ = "ai_usage"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    day = Column(String, index=True)
    month = Column(String, index=True)
    feature = Column(String)                       # doubt, answer, explain, cards, quiz, draft
    model = Column(String)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cache_read_tokens = Column(Integer, default=0)
    cache_write_tokens = Column(Integer, default=0)
    cost_micro_usd = Column(Integer, default=0)
    created_at = Column(String)

USER_DATA_ERASED.update({"tutor_threads": ("user_id",), "tutor_messages": ("user_id",), "tutor_quizzes": ("user_id",)})
USER_DATA_KEPT.update({"ai_usage": ("user_id",)})        # a cost record, like payments; it holds no content
for _registry in (USER_DATA_ERASED, USER_DATA_KEPT):
    for _table in ("tutor_threads", "tutor_messages", "tutor_quizzes", "ai_usage"):
        assert all(column in Base.metadata.tables[_table].c for column in _registry.get(_table, ()))
SCHEMA_UPGRADES.append("CREATE INDEX IF NOT EXISTS ix_tutor_messages_thread ON tutor_messages (thread_id, id)")

TUTOR_MODEL = "claude-haiku-5-5"       # the cheapest fast model (the founder's choice); quality per rupee
# US dollars per million tokens for TUTOR_MODEL (prompts under 100K tokens). Cache prices are estimates (10% and 125% of input).
TUTOR_PRICE = {"input": 0.10, "output": 0.50, "cache_read": 0.01, "cache_write": 0.125}
USD_TO_INR = float(os.getenv("USD_TO_INR", "88") or 88)
AI_BUDGET_DEFAULT_INR = 1000
TUTOR_MODES = ("doubt", "answer", "explain")
TUTOR_ANSWER_MARKS = (2, 3, 5, 8, 10, 15)
TUTOR_HISTORY = 12                     # earlier messages of a thread sent back to the model
TUTOR_KEEP_DAYS = 90
TUTOR_MAX_QUESTION = 3000
TUTOR_NOTE_MAX_BYTES = 8 * 1024 * 1024
TUTOR_NOTE_TYPES = {".pdf": ("document", "application/pdf"), ".png": ("image", "image/png"), ".jpg": ("image", "image/jpeg"), ".jpeg": ("image", "image/jpeg"), ".webp": ("image", "image/webp")}
tutor_state = {"spend_month": "", "spend_micro": 0, "spend_at": 0.0}

TUTOR_SYSTEM = (
    "You are the Connect2Minds study tutor: a patient, sharp tutor for Indian college students (engineering, science, commerce, "
    "arts, diploma). Students come to you the night before exams, after a confusing lecture, or while solving previous-year papers.\n\n"
    "How you teach:\n"
    "- Plain, clear English that a second-year student follows on the first read. Define a term the first time you use it.\n"
    "- Start with the direct answer, then the explanation. Use a small worked example whenever it helps.\n"
    "- For a doubt, stay focused: usually 2 to 4 short paragraphs or a short list. Offer to go deeper instead of writing everything.\n"
    "- Use the syllabus units given below as the scope. If the student's university or syllabus differs from what you expect, "
    "follow the syllabus given. Do not invent syllabus facts, university rules, exam dates or marking schemes.\n"
    "- If you are not sure of something (a formula constant, a date, a definition that varies between textbooks), say so briefly.\n"
    "- Code: give it in a fenced block with the language named, keep it short and runnable, and explain the key lines.\n"
    "- Maths: write it in plain text (x^2, sqrt(n), a/b). The page does not render LaTeX.\n"
    "- Help the student learn. When a message is clearly an assignment someone will submit for marks, explain the method and walk "
    "through it with them rather than handing over a finished submission. Past papers, practice and exam preparation are fine to "
    "answer in full.\n\n"
    "Writing an exam answer (when the student asks for an N-mark answer):\n"
    "- Write it the way a well-prepared student would write it in the answer booklet of an Indian university exam.\n"
    "- 2 marks: a precise definition or statement plus one example or key point, 3 to 5 lines.\n"
    "- 3 to 5 marks: a one-line introduction, then 4 to 6 numbered points with **bold** key terms, a small example or diagram "
    "described in words, about 150 to 250 words.\n"
    "- 8 to 15 marks: a heading, an introduction, the explanation in numbered sub-points under ### sub-headings, a labelled diagram "
    "described in words (or a simple text diagram in a code block), an example, advantages and disadvantages or a comparison table "
    "where the topic has them, and a short conclusion. About 400 to 700 words for 10 marks.\n"
    "- After the answer, add one line starting 'Examiner tip:' with what earns the marks for this question.\n\n"
    "Formatting: Markdown with ### headings, bullet or numbered lists, **bold** for key terms, tables with | when comparing, "
    "fenced code blocks for code. No HTML."
)


def tutor_cost_micro(usage) -> int:
    """Estimated cost of one call in millionths of a dollar, from the response's usage."""
    get = lambda name: int(getattr(usage, name, 0) or 0)
    dollars = (get("input_tokens") * TUTOR_PRICE["input"] + get("output_tokens") * TUTOR_PRICE["output"]
               + get("cache_read_input_tokens") * TUTOR_PRICE["cache_read"] + get("cache_creation_input_tokens") * TUTOR_PRICE["cache_write"]) / 1_000_000
    return round(dollars * 1_000_000)

async def record_ai_usage(user_id: int, feature: str, usage, model: str = TUTOR_MODEL):
    try:
        cost = tutor_cost_micro(usage)
        now = site_now()
        await run_one_off(DBAiUsage.__table__.insert().values(
            user_id=user_id, day=now.date().isoformat(), month=now.strftime("%Y-%m"), feature=feature, model=model,
            input_tokens=int(getattr(usage, "input_tokens", 0) or 0), output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
            cache_read_tokens=int(getattr(usage, "cache_read_input_tokens", 0) or 0), cache_write_tokens=int(getattr(usage, "cache_creation_input_tokens", 0) or 0),
            cost_micro_usd=cost, created_at=utc_now_iso()))
        if tutor_state["spend_month"] == now.strftime("%Y-%m"):
            tutor_state["spend_micro"] += cost
    except Exception as e:
        print("Could not record AI usage:", e)

def ai_budget_inr() -> float:
    load_dotenv(override=False)
    try:
        return float(os.getenv("AI_MONTHLY_BUDGET_INR") or AI_BUDGET_DEFAULT_INR)
    except ValueError:
        return float(AI_BUDGET_DEFAULT_INR)

async def ai_month_spend_inr() -> float:
    """This month's estimated AI spend in rupees, read from ai_usage at most once a minute."""
    month = site_now().strftime("%Y-%m")
    now = datetime.now(timezone.utc).timestamp()
    if tutor_state["spend_month"] != month or now - tutor_state["spend_at"] > 60:
        rows = await fetch_one_off(select(func.coalesce(func.sum(DBAiUsage.cost_micro_usd), 0)).where(DBAiUsage.month == month))
        tutor_state.update(spend_month=month, spend_micro=int(rows[0][0] or 0), spend_at=now)
    return tutor_state["spend_micro"] / 1_000_000 * USD_TO_INR

async def tutor_gate(user_id: int, metric: str) -> tuple:
    """Refuses when AI is off, the month's budget is used up for this person's plan, or their daily quota is spent.
    Returns (founder, plan_key)."""
    if helpbot_client() is None:
        raise HTTPException(status_code=503, detail="The AI tutor is not switched on yet. Your flashcards, units and past-paper questions all work without it.")
    founder, plan_key = await personal_plan(user_id)
    spend, budget = await ai_month_spend_inr(), ai_budget_inr()
    paid = founder or plan_key != "free"
    if spend >= budget or (not paid and spend >= 0.8 * budget):
        raise HTTPException(status_code=429, detail="The AI tutor is resting until the 1st of next month. Your flashcards, units, tests and past-paper questions still work.")
    await check_limit(user_id, metric)
    return founder, plan_key

async def tutor_quota(user_id: int) -> dict:
    founder, plan_key = await personal_plan(user_id)
    rows = await fetch_one_off(select(DBUsageCounter.metric, DBUsageCounter.count).where(
        DBUsageCounter.user_id == user_id, DBUsageCounter.metric.in_(("tutor_daily", "ai_gen_daily")), DBUsageCounter.period == site_now().date().isoformat()))
    used = dict(rows)
    limit = lambda metric: None if founder else limit_of(plan_key, metric)
    return {"plan": "founder" if founder else plan_key, "paid": founder or plan_key != "free",
            "questions": {"used": used.get("tutor_daily", 0), "limit": limit("tutor_daily")},
            "generations": {"used": used.get("ai_gen_daily", 0), "limit": limit("ai_gen_daily")},
            "note_files": founder or bool(limit_of(plan_key, "ai_note_files"))}

async def tutor_subject_context(user_id: int, subject_id: Optional[int], unit_id: Optional[int] = None) -> tuple:
    """(subject name, context text) for one of my My Study subjects, with its linked syllabus units."""
    if not subject_id:
        return "", ""
    rows = await fetch_one_off(select(DBStudySubject.name, DBStudySubject.syllabus_id, DBStudySubject.exam_date)
                               .where(DBStudySubject.id == subject_id, DBStudySubject.user_id == user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That subject is not in your list.")
    name, syllabus_id, exam_date = rows[0]
    lines = [f"Subject: {name}"]
    if syllabus_id:
        syllabus, units = await asyncio.gather(
            fetch_one_off(select(DBSyllabus.subject, DBSyllabus.department, DBSyllabus.semester, DBSyllabus.college_name).where(DBSyllabus.id == syllabus_id)),
            fetch_one_off(select(DBSyllabusUnit).where(DBSyllabusUnit.syllabus_id == syllabus_id).order_by(DBSyllabusUnit.number)))
        if syllabus:
            s = syllabus[0]
            lines.append(f"Course: {s.subject}, {s.department or 'department not given'}, semester {s.semester or 'not given'}, {s.college_name or ''}".strip(", "))
        for (unit,) in units:
            topics = ", ".join(t for t in (unit.topics or "").split("\n") if t.strip())
            marker = "  <- the student is asking about this unit" if unit_id and unit.id == unit_id else ""
            lines.append(f"Unit {unit.number}: {unit.title}{f' ({topics})' if topics else ''}{marker}")
    if exam_date:
        lines.append(f"Exam date: {exam_date}")
    return name, "\n".join(lines)


# ---------- reading ----------
@app.get("/api/tutor")
async def tutor_home(current_user_id: int = Depends(get_current_user_id)):
    """Whether AI is on, today's quota, my recent threads and my subjects to pick from."""
    quota, threads, subjects = await asyncio.gather(
        tutor_quota(current_user_id),
        fetch_one_off(select(DBTutorThread.id, DBTutorThread.title, DBTutorThread.mode, DBTutorThread.subject_id, DBTutorThread.updated_at)
                      .where(DBTutorThread.user_id == current_user_id).order_by(DBTutorThread.updated_at.desc()).limit(30)),
        fetch_one_off(select(DBStudySubject.id, DBStudySubject.name, DBStudySubject.syllabus_id).where(
            DBStudySubject.user_id == current_user_id, func.coalesce(DBStudySubject.archived, 0) == 0).order_by(DBStudySubject.id)))
    syllabus_ids = [sid for _, _, sid in subjects if sid]
    units = await fetch_one_off(select(DBSyllabusUnit.id, DBSyllabusUnit.syllabus_id, DBSyllabusUnit.number, DBSyllabusUnit.title)
                                .where(DBSyllabusUnit.syllabus_id.in_(syllabus_ids)).order_by(DBSyllabusUnit.number)) if syllabus_ids else []
    by_syllabus: dict = {}
    for unit_id, syllabus_id, number, title in units:
        by_syllabus.setdefault(syllabus_id, []).append({"id": unit_id, "number": number, "title": title or ""})
    spend, budget = await ai_month_spend_inr(), ai_budget_inr()
    paused = spend >= budget or (not quota["paid"] and spend >= 0.8 * budget)
    return {"ai_on": helpbot_client() is not None, "paused": paused, "quota": quota, "marks": list(TUTOR_ANSWER_MARKS),
            "threads": [{"id": i, "title": t or "Untitled", "mode": m, "subject_id": s, "updated_at": u or ""} for i, t, m, s, u in threads],
            "subjects": [{"id": i, "name": n or "", "syllabus_id": sid, "units": by_syllabus.get(sid, [])} for i, n, sid in subjects]}

@app.get("/api/tutor/threads/{thread_id}")
async def tutor_thread(thread_id: int, current_user_id: int = Depends(get_current_user_id)):
    rows, messages = await asyncio.gather(
        fetch_one_off(select(DBTutorThread).where(DBTutorThread.id == thread_id, DBTutorThread.user_id == current_user_id)),
        fetch_one_off(select(DBTutorMessage.id, DBTutorMessage.role, DBTutorMessage.content, DBTutorMessage.created_at)
                      .where(DBTutorMessage.thread_id == thread_id, DBTutorMessage.user_id == current_user_id).order_by(DBTutorMessage.id)))
    if not rows:
        raise HTTPException(status_code=404, detail="That conversation is no longer here.")
    t = rows[0][0]
    return {"id": t.id, "title": t.title or "", "mode": t.mode, "subject_id": t.subject_id,
            "messages": [{"id": i, "role": r, "text": c or "", "at": a or ""} for i, r, c, a in messages]}

@app.delete("/api/tutor/threads/{thread_id}")
async def delete_tutor_thread(thread_id: int, current_user_id: int = Depends(get_current_user_id)):
    await run_one_off(delete(DBTutorMessage).where(DBTutorMessage.thread_id == thread_id, DBTutorMessage.user_id == current_user_id))
    await run_one_off(delete(DBTutorThread).where(DBTutorThread.id == thread_id, DBTutorThread.user_id == current_user_id))
    return {"removed": thread_id}


# ---------- asking ----------
class TutorAskBody(BaseModel):
    text: str
    mode: Optional[str] = "doubt"
    thread_id: Optional[int] = None
    subject_id: Optional[int] = None
    unit_id: Optional[int] = None
    marks: Optional[int] = None
    question_id: Optional[int] = None      # a past-paper question (section 33)

def tutor_request_text(body: TutorAskBody, question_text: str) -> str:
    text = (body.text or "").strip()[:TUTOR_MAX_QUESTION]
    if body.mode == "answer":
        marks = body.marks or 5
        return f"Write a {marks}-mark exam answer for this question:\n\n{question_text or text}" + (f"\n\nMy note: {text}" if question_text and text else "")
    if body.mode == "explain":
        return (f"This question came in my university exam:\n\n{question_text or text}\n\nExplain what it is asking, which topic it tests, "
                f"and how to plan a good answer (the points to cover, roughly how long). Then give a model answer"
                f"{f' worth {body.marks} marks' if body.marks else ''}.") + (f"\n\nMy note: {text}" if question_text and text else "")
    return text

@app.post("/api/tutor/ask")
@limiter.limit("20/minute", key_func=account_rate_key)
async def tutor_ask(request: Request, body: TutorAskBody, current_user_id: int = Depends(get_current_user_id)):
    """Streams the tutor's answer (server-sent events: text, then done with the thread id; or error)."""
    if body.mode not in TUTOR_MODES:
        raise HTTPException(status_code=400, detail="Pick what you want: a doubt, an exam answer or a past-paper question explained.")
    if body.marks is not None and body.marks not in TUTOR_ANSWER_MARKS:
        raise HTTPException(status_code=400, detail="Pick the marks the answer is for.")
    question_text = ""
    if body.question_id:
        question, _ = await load_question(body.question_id, await prep_identity(current_user_id))
        question_text = question.text or ""
        body.marks = body.marks or (question.marks if question.marks in TUTOR_ANSWER_MARKS else None)
    if not question_text and len((body.text or "").strip()) < 3:
        raise HTTPException(status_code=400, detail="Type your question first.")
    history = []
    if body.thread_id:
        rows = await fetch_one_off(select(DBTutorThread.subject_id).where(DBTutorThread.id == body.thread_id, DBTutorThread.user_id == current_user_id))
        if not rows:
            raise HTTPException(status_code=404, detail="That conversation is no longer here.")
        body.subject_id = body.subject_id or rows[0][0]
        earlier = await fetch_one_off(select(DBTutorMessage.role, DBTutorMessage.content).where(DBTutorMessage.thread_id == body.thread_id)
                                      .order_by(DBTutorMessage.id.desc()).limit(TUTOR_HISTORY))
        history = [{"role": role, "content": content or ""} for role, content in reversed(earlier) if role in ("user", "assistant") and content]
        while history and history[0]["role"] != "user":
            history.pop(0)
    await tutor_gate(current_user_id, "tutor_daily")
    subject_name, context = await tutor_subject_context(current_user_id, body.subject_id, body.unit_id)
    asked = tutor_request_text(body, question_text)
    client = helpbot_client()
    today = site_now().strftime("%A %d %B %Y")
    params = {
        "model": TUTOR_MODEL,
        "max_tokens": 8000,
        "output_config": {"effort": "medium" if body.mode != "doubt" else "low"},
        "system": [{"type": "text", "text": TUTOR_SYSTEM, "cache_control": {"type": "ephemeral"}},
                   {"type": "text", "text": f"Today is {today} (India).\n{context or 'The student did not pick a subject.'}"}],
        "messages": history + [{"role": "user", "content": asked}],
    }
    shown = (body.text or "").strip()[:TUTOR_MAX_QUESTION] or question_text
    if body.mode == "answer":
        shown = f"{body.marks or 5}-mark answer: {question_text or shown}"
    elif body.mode == "explain":
        shown = f"Explain this exam question: {question_text or shown}"

    async def stream():
        import anthropic
        parts = []
        try:
            async with client.messages.stream(**params) as reply:
                async for event in reply:
                    if event.type == "text":
                        parts.append(event.text)
                        yield helpbot_event({"type": "text", "text": event.text})
                message = await reply.get_final_message()
            await record_ai_usage(current_user_id, body.mode, message.usage)
            if message.stop_reason == "refusal":
                parts.append("\n\nI can't help with that one. Ask me about your subjects.")
                yield helpbot_event({"type": "text", "text": parts[-1]})
            elif message.stop_reason == "max_tokens":
                parts.append("\n\n(That was getting long, so I stopped here. Ask me to continue.)")
                yield helpbot_event({"type": "text", "text": parts[-1]})
            answer = "".join(parts).strip()
            if not answer:
                yield helpbot_event({"type": "error", "code": "empty"})
                return
            await bump_usage(current_user_id, "tutor_daily")
            now_iso = utc_now_iso()
            thread_id = body.thread_id
            if not thread_id:
                title = (subject_name + ": " if subject_name else "") + re.sub(r"\s+", " ", shown)[:80]
                rows = await run_returning(DBTutorThread.__table__.insert().values(
                    user_id=current_user_id, subject_id=body.subject_id or None, title=title, mode=body.mode, created_at=now_iso, updated_at=now_iso)
                    .returning(DBTutorThread.id))
                thread_id = rows[0][0]
            else:
                await run_one_off(update(DBTutorThread).where(DBTutorThread.id == thread_id).values(updated_at=now_iso))
            await run_one_off(DBTutorMessage.__table__.insert().values([
                {"thread_id": thread_id, "user_id": current_user_id, "role": "user", "content": asked if body.mode != "doubt" else shown, "created_at": now_iso},
                {"thread_id": thread_id, "user_id": current_user_id, "role": "assistant", "content": answer, "created_at": now_iso}]))
            yield helpbot_event({"type": "done", "thread_id": thread_id, "shown": shown})
        except anthropic.RateLimitError:
            yield helpbot_event({"type": "error", "code": "busy"})
        except anthropic.AuthenticationError:
            yield helpbot_event({"type": "error", "code": "ai_off"})
        except anthropic.APIConnectionError:
            yield helpbot_event({"type": "error", "code": "offline"})
        except anthropic.APIStatusError as e:
            print("Tutor API error:", e.status_code, getattr(e, "message", e))
            yield helpbot_event({"type": "error", "code": "error"})

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- AI-made flashcards and quizzes ----------
class TutorGenerateBody(BaseModel):
    kind: str                              # cards, quiz
    subject_id: Optional[int] = None
    unit_id: Optional[int] = None
    note_id: Optional[int] = None
    topic: Optional[str] = ""
    count: Optional[int] = 10

CARDS_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["title", "cards"], "properties": {
    "title": {"type": "string"},
    "cards": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["front", "back"],
                                          "properties": {"front": {"type": "string"}, "back": {"type": "string"}}}}}}
QUIZ_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["title", "questions"], "properties": {
    "title": {"type": "string"},
    "questions": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["q", "options", "answer", "why"],
                                              "properties": {"q": {"type": "string"}, "options": {"type": "array", "items": {"type": "string"}},
                                                             "answer": {"type": "integer"}, "why": {"type": "string"}}}}}}

async def note_block(note_id: int, user_id: int) -> tuple:
    """(content block, note title) for a shared note's file: a PDF as a document, a photo as an image."""
    rows = await fetch_one_off(select(DBNote.title, DBNote.file_url, DBNote.file_size).where(DBNote.id == note_id, func.coalesce(DBNote.removed, 0) == 0))
    if not rows:
        raise HTTPException(status_code=404, detail="That note is no longer shared.")
    title, url, size = rows[0]
    match = re.search(r"(static/uploads/notes/note_\d+_[0-9a-f]{12}(\.[a-z0-9]+))$", url or "")
    if not match or match.group(2) not in TUTOR_NOTE_TYPES:
        raise HTTPException(status_code=400, detail="The tutor can read PDF files and photos of notes. This note is another kind of file.")
    path = match.group(1)
    if not os.path.isfile(path) or os.path.getsize(path) > TUTOR_NOTE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="That file is too big for the tutor to read (8 MB at most).")
    data = await asyncio.to_thread(lambda: base64.standard_b64encode(open(path, "rb").read()).decode("ascii"))
    kind, media = TUTOR_NOTE_TYPES[match.group(2)]
    return {"type": kind, "source": {"type": "base64", "media_type": media, "data": data}}, title or "the note"

def clean_cards(raw: list, limit: int) -> list:
    cards = []
    for card in raw or []:
        front, back = str(card.get("front", "")).strip()[:600], str(card.get("back", "")).strip()[:2000]
        if front and back:
            cards.append({"front": front, "back": back})
    return cards[:limit]

def clean_quiz(raw: list, limit: int) -> list:
    questions = []
    for q in raw or []:
        options = [str(o).strip()[:300] for o in (q.get("options") or []) if str(o).strip()][:5]
        answer = q.get("answer")
        if str(q.get("q", "")).strip() and len(options) >= 2 and isinstance(answer, int) and 0 <= answer < len(options) and len(set(options)) == len(options):
            questions.append({"q": str(q["q"]).strip()[:1200], "options": options, "answer": answer, "why": str(q.get("why", "")).strip()[:1500]})
    return questions[:limit]

@app.post("/api/tutor/generate")
@limiter.limit("10/minute", key_func=account_rate_key)
async def tutor_generate(request: Request, body: TutorGenerateBody, current_user_id: int = Depends(get_current_user_id)):
    """Flashcards (checked by the student, then saved as a deck) or a 10-question quiz, for a unit, a topic or a note."""
    if body.kind not in ("cards", "quiz"):
        raise HTTPException(status_code=400, detail="Pick flashcards or a quiz.")
    count = max(5, min(body.count or 10, 30 if body.kind == "cards" else 15))
    topic = clean_text(body.topic, 200, "topic")
    if not (body.unit_id or body.note_id or topic or body.subject_id):
        raise HTTPException(status_code=400, detail="Pick a unit or a note, or type a topic.")
    if body.note_id and not await has_feature(current_user_id, "ai_note_files"):
        raise HTTPException(status_code=402, detail="Making cards from a note's file is part of Student Pro and the Exam Pass. You can still make them from a unit or a topic.")
    await tutor_gate(current_user_id, "ai_gen_daily")
    subject_name, context = await tutor_subject_context(current_user_id, body.subject_id, body.unit_id)
    unit_line = ""
    if body.unit_id and context:
        unit_line = next((line for line in context.split("\n") if "<- the student is asking about this unit" in line), "").replace("  <- the student is asking about this unit", "")
    what = unit_line or topic or subject_name or "the attached notes"
    content: list = []
    note_title = ""
    if body.note_id:
        block, note_title = await note_block(body.note_id, current_user_id)
        content.append(block)
        what = f"the attached notes ({note_title})" + (f", focusing on {topic}" if topic else "")
    if body.kind == "cards":
        ask = (f"Make {count} flashcards for revising {what}. Each card tests one idea that is likely in an exam: a definition, a "
               f"difference, a formula with what its terms mean, a step of an algorithm, a key fact or a short why-question. The front is a "
               f"question or term (under 20 words); the back is the answer in 1 to 3 short sentences a student can recall. No duplicates. "
               f"Give the deck a short title.")
        schema = CARDS_SCHEMA
    else:
        ask = (f"Make a {count}-question multiple-choice quiz on {what} for revision before a university exam. Four options each, one "
               f"right answer (its index in 'answer', from 0), plausible wrong options, a mix of easy and harder questions, and a one- or "
               f"two-sentence explanation in 'why'. Give the quiz a short title.")
        schema = QUIZ_SCHEMA
    content.append({"type": "text", "text": ask})
    import anthropic
    client = helpbot_client()
    try:
        message = await client.messages.create(
            model=TUTOR_MODEL, max_tokens=12000,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
            system=[{"type": "text", "text": TUTOR_SYSTEM, "cache_control": {"type": "ephemeral"}},
                    {"type": "text", "text": context or "The student did not pick a subject."}],
            messages=[{"role": "user", "content": content}])
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="The tutor is busy right now. Try again in a minute.")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=503, detail="Could not reach the AI service. Check the internet connection and try again.")
    except anthropic.APIStatusError as e:
        print("Tutor generate error:", e.status_code, getattr(e, "message", e))
        raise HTTPException(status_code=502, detail="The tutor could not make that. Try again, or pick a smaller topic.")
    await record_ai_usage(current_user_id, body.kind, message.usage)
    if message.stop_reason == "refusal":
        raise HTTPException(status_code=400, detail="The tutor can't make cards for that one.")
    text_out = next((b.text for b in message.content if b.type == "text"), "")
    try:
        data = json.loads(text_out)
    except ValueError:
        raise HTTPException(status_code=502, detail="The tutor's answer came back cut short. Try again with fewer cards.")
    await bump_usage(current_user_id, "ai_gen_daily")
    title = str(data.get("title") or what).strip()[:120]
    if body.kind == "cards":
        cards = clean_cards(data.get("cards"), count)
        if not cards:
            raise HTTPException(status_code=502, detail="No cards came back. Try again.")
        return {"kind": "cards", "title": title, "cards": cards, "subject_id": body.subject_id, "unit_id": body.unit_id}
    questions = clean_quiz(data.get("questions"), count)
    if not questions:
        raise HTTPException(status_code=502, detail="No questions came back. Try again.")
    rows = await run_returning(DBTutorQuiz.__table__.insert().values(user_id=current_user_id, title=title, questions=json.dumps(questions),
                                                                     created_at=utc_now_iso(), finished_at="").returning(DBTutorQuiz.id))
    return {"kind": "quiz", "id": rows[0][0], "title": title, "questions": questions}

class SaveAiDeckBody(BaseModel):
    title: str
    subject_id: Optional[int] = None
    unit_id: Optional[int] = None
    public: Optional[bool] = False
    cards: List[CardBody]

@app.post("/api/tutor/save-deck")
async def save_ai_deck(body: SaveAiDeckBody, current_user_id: int = Depends(get_current_user_id)):
    """The cards the student kept, as a new deck marked 'made with the AI tutor'."""
    cards = [clean_card(card) for card in body.cards][:PREP_MAX_CARDS]
    if not cards:
        raise HTTPException(status_code=400, detail="Keep at least one card.")
    syllabus_id = None
    if body.subject_id:
        rows = await fetch_one_off(select(DBStudySubject.syllabus_id).where(DBStudySubject.id == body.subject_id, DBStudySubject.user_id == current_user_id))
        syllabus_id = rows[0][0] if rows else None
    deck = await create_deck(DeckBody(title=body.title, syllabus_id=syllabus_id, unit_id=body.unit_id if syllabus_id else None,
                                      public=bool(body.public)), current_user_id)
    await run_one_off(update(DBCardDeck).where(DBCardDeck.id == deck["id"]).values(made_by_ai=1))
    await add_cards(deck["id"], CardsBody(cards=[CardBody(**card) for card in cards]), current_user_id)
    return {"id": deck["id"], "cards": len(cards)}

class QuizDoneBody(BaseModel):
    score: int

@app.post("/api/tutor/quizzes/{quiz_id}/done")
async def finish_quiz(quiz_id: int, body: QuizDoneBody, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBTutorQuiz.questions, DBTutorQuiz.finished_at).where(DBTutorQuiz.id == quiz_id, DBTutorQuiz.user_id == current_user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That quiz is no longer here.")
    total = len(json_list(rows[0][0]))
    if not (0 <= body.score <= total):
        raise HTTPException(status_code=400, detail="That score does not fit the quiz.")
    if not rows[0][1]:
        await run_one_off(update(DBTutorQuiz).where(DBTutorQuiz.id == quiz_id).values(score=body.score, finished_at=utc_now_iso()))
    xp = await award_xp(current_user_id, "quiz", f"quiz:{quiz_id}", 5)
    return {"id": quiz_id, "score": body.score, "total": total, "xp": xp}


# ---------- the founder's view and tidying ----------
@app.get("/api/founder/ai-usage")
async def founder_ai_usage(founder_id: int = Depends(require_founder)):
    """This month's AI calls and estimated spend against the budget, by feature."""
    month = site_now().strftime("%Y-%m")
    rows, people = await asyncio.gather(
        fetch_one_off(select(DBAiUsage.feature, func.count(), func.sum(DBAiUsage.cost_micro_usd)).where(DBAiUsage.month == month).group_by(DBAiUsage.feature)),
        fetch_one_off(select(func.count(func.distinct(DBAiUsage.user_id))).where(DBAiUsage.month == month)))
    spend = sum(int(cost or 0) for _, _, cost in rows) / 1_000_000 * USD_TO_INR
    return {"month": month, "spend_inr": round(spend, 2), "budget_inr": ai_budget_inr(), "people": people[0][0] or 0, "model": TUTOR_MODEL,
            "ai_on": helpbot_client() is not None,
            "features": [{"feature": f, "calls": n, "spend_inr": round(int(c or 0) / 1_000_000 * USD_TO_INR, 2)} for f, n, c in rows]}

async def tutor_cleanup():
    """Conversations not touched for TUTOR_KEEP_DAYS are deleted (called once a day from study_watch)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=TUTOR_KEEP_DAYS)).isoformat()
    old = select(DBTutorThread.id).where(DBTutorThread.updated_at < cutoff)
    await run_one_off(delete(DBTutorMessage).where(DBTutorMessage.thread_id.in_(old)))
    await run_one_off(delete(DBTutorThread).where(DBTutorThread.updated_at < cutoff))
    await run_one_off(delete(DBTutorQuiz).where(DBTutorQuiz.created_at < cutoff))


# ==========================================
# 35. MOCK TESTS AND THE PLACEMENT TRACK (tests.html)
# ==========================================
# Timed tests drawn from the practice questions (the daily ones plus mock_bank.json, loaded with daily = 0), untimed
# topic practice, and a report: score and section scores for everyone; weak topics, time per question and the trend
# with Student Pro or the Exam Pass. The clock is the server's: answers after ends_at (plus a short grace) are not taken.
class DBMockAttempt(Base):
    __tablename__ = "mock_attempts"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    test_key = Column(String)
    question_ids = Column(String)                  # JSON list
    parts = Column(String)                         # JSON list of [label, first index, count]
    answers = Column(String)                       # JSON list: the chosen option or null
    seconds = Column(String)                       # JSON list: seconds spent on each question
    started_at = Column(String)
    ends_at = Column(String)                       # UTC ISO
    submitted_at = Column(String, default="")
    score = Column(Integer, nullable=True)
    total = Column(Integer, default=0)
    part_scores = Column(String, default="")       # JSON list of [label, right, count]

class DBTopicAnswer(Base):
    """One answer in untimed topic practice."""
    __tablename__ = "topic_answers"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    question_id = Column(Integer, index=True)
    chosen = Column(Integer)
    correct = Column(Integer, default=0)
    answered_at = Column(String)

SCHEMA_UPGRADES.extend([
    "ALTER TABLE practice_questions ADD COLUMN IF NOT EXISTS section VARCHAR DEFAULT ''",
    "ALTER TABLE practice_questions ADD COLUMN IF NOT EXISTS difficulty INTEGER",
    "ALTER TABLE practice_questions ADD COLUMN IF NOT EXISTS daily INTEGER DEFAULT 1",
    "ALTER TABLE practice_questions ADD COLUMN IF NOT EXISTS lang VARCHAR DEFAULT ''",
    "ALTER TABLE practice_questions ADD COLUMN IF NOT EXISTS draft INTEGER DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS ix_mock_attempts_user ON mock_attempts (user_id, id)",
])
USER_DATA_ERASED.update({"mock_attempts": ("user_id",), "topic_answers": ("user_id",)})
for _table in ("mock_attempts", "topic_answers"):
    assert all(column in Base.metadata.tables[_table].c for column in USER_DATA_ERASED[_table])

MOCK_BANK_FILE = "mock_bank.json"


def json_data(raw: Optional[str]) -> list:
    """A JSON list as stored, keeping numbers and nulls (json_list turns every item into text)."""
    try:
        value = json.loads(raw or "[]")
        return value if isinstance(value, list) else []
    except (ValueError, TypeError):
        return []
MOCK_GRACE_SECONDS = 30
MOCK_TOPIC_BATCH = 10
SECTION_LABELS = {"quant": "Quantitative", "logical": "Logical reasoning", "verbal": "Verbal ability", "technical": "Computer science"}
# The daily questions came before sections: their aptitude topics are sorted here
OLD_LOGICAL_TOPICS = ("Family relations", "Logic", "Directions", "Codes", "Seating", "Calendars")
DSA_TOPICS = ("Data structures", "Graphs", "Sorting", "Searching", "Complexity", "Dynamic programming", "Greedy algorithms",
              "Algorithms", "Recursion", "Trees", "Bit operations")
CORE_TOPICS = ("Operating systems", "DBMS", "SQL", "Computer networks", "Networks")
CODE_TOPICS = ("Python", "C", "Java", "OOP", "Loops", "Scope", "Number systems", "Git", "Web")
# key: title, kind (topic or pattern), minutes, parts [(label, section, topics or None, count)], blurb
MOCK_TESTS = {
    "quant": {"title": "Quantitative aptitude", "kind": "topic", "minutes": 25, "parts": [("Quantitative", "quant", None, 20)],
              "blurb": "Percentages, profit, time and work, speed, interest, ratios, probability."},
    "logical": {"title": "Logical reasoning", "kind": "topic", "minutes": 20, "parts": [("Logical reasoning", "logical", None, 15)],
                "blurb": "Coding, blood relations, directions, seating, syllogisms, puzzles."},
    "verbal": {"title": "Verbal ability", "kind": "topic", "minutes": 15, "parts": [("Verbal ability", "verbal", None, 15)],
               "blurb": "Synonyms, error spotting, fill in the blanks, idioms, reading."},
    "dsa": {"title": "Data structures and algorithms", "kind": "topic", "minutes": 20, "parts": [("DSA", "technical", DSA_TOPICS, 15)],
            "blurb": "Stacks, trees, graphs, sorting, searching and complexity."},
    "core": {"title": "CS core: OS, DBMS and networks", "kind": "topic", "minutes": 20, "parts": [("Core CS", "technical", CORE_TOPICS, 18)],
             "blurb": "Processes, memory, deadlocks, normal forms, SQL, TCP/IP and subnets."},
    "code": {"title": "Programming and code output", "kind": "topic", "minutes": 20, "parts": [("Programming", "technical", CODE_TOPICS, 15)],
             "blurb": "Predict the output in Python, C and Java, plus OOP."},
    "service": {"title": "Service company aptitude round", "kind": "pattern", "minutes": 50,
                "parts": [("Quantitative", "quant", None, 15), ("Logical reasoning", "logical", None, 10), ("Verbal ability", "verbal", None, 10)],
                "blurb": "In the style of mass-recruiter aptitude rounds: 35 questions in 50 minutes."},
    "product": {"title": "Product company screening round", "kind": "pattern", "minutes": 45,
                "parts": [("DSA", "technical", DSA_TOPICS, 12), ("Programming", "technical", CODE_TOPICS, 8), ("Core CS", "technical", CORE_TOPICS, 10)],
                "blurb": "In the style of online screening tests: 30 technical questions in 45 minutes."},
    "full": {"title": "Full placement mock", "kind": "pattern", "minutes": 75,
             "parts": [("Quantitative", "quant", None, 15), ("Logical reasoning", "logical", None, 10), ("Verbal ability", "verbal", None, 10),
                       ("Computer science", "technical", None, 20)],
             "blurb": "Aptitude and CS fundamentals together: 55 questions in 75 minutes."},
}
MOCK_PATTERN_NOTE = "Practice patterns written by Connect2Minds, modelled on public descriptions of common placement rounds. Not real papers of any company."


def question_section(question) -> str:
    if question.section:
        return question.section
    if question.track == "coding":
        return "technical"
    return "logical" if (question.topic or "") in OLD_LOGICAL_TOPICS else "quant"

async def seed_mock_bank():
    """Adds the mock_bank.json questions that are not in the table yet (daily = 0), and gives the old daily questions
    their section. Runs at startup; safe to run again."""
    try:
        if not os.path.exists(MOCK_BANK_FILE):
            return
        with open(MOCK_BANK_FILE, encoding="utf-8") as bank_file:
            bank = json.load(bank_file)
        rows = await fetch_one_off(select(DBPracticeQuestion.question, DBPracticeQuestion.code, DBPracticeQuestion.options))
        have = {(q or "", c or "", o or "") for q, c, o in rows}
        now_iso = utc_now_iso()
        new = [{"track": item["track"], "topic": item.get("topic", ""), "question": item["q"], "code": item.get("code", ""), "lang": item.get("lang", ""),
                "options": json.dumps(item["options"]), "answer": item["answer"], "explanation": item.get("why", ""), "active": 1, "daily": 0, "draft": 0,
                "section": item.get("section", ""), "difficulty": item.get("difficulty"), "created_at": now_iso}
               for item in bank if (item["q"], item.get("code", ""), json.dumps(item["options"])) not in have]
        if new:
            await run_one_off(DBPracticeQuestion.__table__.insert().values(new))
        await run_one_off(update(DBPracticeQuestion).where(func.coalesce(DBPracticeQuestion.section, "") == "", DBPracticeQuestion.track == "coding").values(section="technical"))
        await run_one_off(update(DBPracticeQuestion).where(func.coalesce(DBPracticeQuestion.section, "") == "", DBPracticeQuestion.track == "aptitude",
                                                           DBPracticeQuestion.topic.in_(OLD_LOGICAL_TOPICS)).values(section="logical"))
        await run_one_off(update(DBPracticeQuestion).where(func.coalesce(DBPracticeQuestion.section, "") == "", DBPracticeQuestion.track == "aptitude").values(section="quant"))
        practice_cache["at"] = 0.0
        if new:
            print(f"Mock-test questions added: {len(new)}")
    except Exception as e:
        print("Could not load the mock-test questions:", e)

@app.on_event("startup")
async def mock_startup():
    spawn_background(seed_mock_bank())

def test_pool(cache: dict, section: str, topics) -> list:
    return [q for q in cache["by_id"].values() if not q.draft and question_section(q) == section and (topics is None or (q.topic or "") in topics)]

def test_card(key: str, cache: dict) -> dict:
    test = MOCK_TESTS[key]
    questions = sum(count for _, _, _, count in test["parts"])
    pool = min(len(test_pool(cache, section, topics)) for _, section, topics, _ in test["parts"])
    return {"key": key, "title": test["title"], "kind": test["kind"], "minutes": test["minutes"], "questions": questions, "blurb": test["blurb"],
            "parts": [{"label": label, "count": count} for label, _, _, count in test["parts"]], "ready": pool > 0}

def question_payload(question, index: int) -> dict:
    """A question as the test page gets it: never the answer."""
    return {"index": index, "id": question.id, "topic": question.topic or "", "question": question.question or "", "code": question.code or "",
            "lang": question.lang or "", "options": json_list(question.options)}

def utc_after(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()

def is_past(iso: str, grace: int = 0) -> bool:
    return datetime.now(timezone.utc) > datetime.fromisoformat(iso) + timedelta(seconds=grace)

def score_attempt(attempt, cache: dict) -> tuple:
    """(score, part scores) from the saved answers."""
    ids, answers = json_data(attempt.question_ids), json_data(attempt.answers)
    right = [i < len(answers) and answers[i] is not None and cache["by_id"].get(qid) is not None and answers[i] == cache["by_id"][qid].answer
             for i, qid in enumerate(ids)]
    parts = [[label, sum(right[start:start + count]), count] for label, start, count in json_data(attempt.parts)]
    return sum(right), parts

async def finish_attempt(attempt, cache: dict) -> dict:
    score, parts = score_attempt(attempt, cache)
    await run_one_off(update(DBMockAttempt).where(DBMockAttempt.id == attempt.id, func.coalesce(DBMockAttempt.submitted_at, "") == "")
                      .values(submitted_at=utc_now_iso(), score=score, part_scores=json.dumps(parts)))
    xp = await award_xp(attempt.user_id, "mock", f"mock:{attempt.id}", 20)
    return {"score": score, "parts": parts, "xp": xp}

async def close_expired(user_id: int, cache: dict):
    """Scores tests whose time ran out while the page was closed."""
    rows = await fetch_one_off(select(DBMockAttempt).where(DBMockAttempt.user_id == user_id, func.coalesce(DBMockAttempt.submitted_at, "") == ""))
    for (attempt,) in rows:
        if is_past(attempt.ends_at, MOCK_GRACE_SECONDS):
            await finish_attempt(attempt, cache)

def attempt_summary(attempt) -> dict:
    return {"id": attempt.id, "test_key": attempt.test_key, "title": MOCK_TESTS.get(attempt.test_key, {}).get("title", "Test"),
            "started_at": attempt.started_at, "submitted_at": attempt.submitted_at or "", "score": attempt.score, "total": attempt.total,
            "percent": round(attempt.score * 100 / attempt.total) if attempt.total and attempt.score is not None else None,
            "parts": [{"label": label, "right": right, "count": count} for label, right, count in json_data(attempt.part_scores)]}

async def my_answers(user_id: int, cache: dict) -> list:
    """(question, correct, seconds or None) for everything the person answered: daily questions, topic practice and tests."""
    daily, topic, attempts = await asyncio.gather(
        fetch_one_off(select(DBPracticeAnswer.question_id, DBPracticeAnswer.correct).where(DBPracticeAnswer.user_id == user_id)),
        fetch_one_off(select(DBTopicAnswer.question_id, DBTopicAnswer.correct).where(DBTopicAnswer.user_id == user_id)),
        fetch_one_off(select(DBMockAttempt).where(DBMockAttempt.user_id == user_id, func.coalesce(DBMockAttempt.submitted_at, "") != "")))
    out = [(cache["by_id"].get(qid), bool(ok), None) for qid, ok in list(daily) + list(topic)]
    for (attempt,) in attempts:
        answers, seconds = json_data(attempt.answers), json_data(attempt.seconds)
        for i, qid in enumerate(json_data(attempt.question_ids)):
            question = cache["by_id"].get(qid)
            chosen = answers[i] if i < len(answers) else None
            if question is not None and chosen is not None:
                out.append((question, chosen == question.answer, seconds[i] if i < len(seconds) else None))
    return [row for row in out if row[0] is not None]

def insights(rows: list, attempts: list) -> dict:
    """Accuracy per topic, the weakest topics, the slowest topics in tests and the trend over the last tests."""
    topics: dict = {}
    for question, correct, seconds in rows:
        entry = topics.setdefault(question.topic or "Other", {"topic": question.topic or "Other", "section": question_section(question), "answered": 0,
                                                              "correct": 0, "seconds": [], })
        entry["answered"] += 1
        entry["correct"] += 1 if correct else 0
        if seconds:
            entry["seconds"].append(seconds)
    table = []
    for entry in topics.values():
        times = entry.pop("seconds")
        entry["accuracy"] = round(entry["correct"] * 100 / entry["answered"])
        entry["avg_seconds"] = round(sum(times) / len(times)) if times else None
        table.append(entry)
    table.sort(key=lambda e: (e["accuracy"], -e["answered"]))
    weak = [e for e in table if e["answered"] >= 3 and e["accuracy"] < 70][:4]
    slow = sorted([e for e in table if e["avg_seconds"]], key=lambda e: -e["avg_seconds"])[:3]
    trend = [{"id": a["id"], "title": a["title"], "percent": a["percent"], "at": a["submitted_at"]} for a in reversed(attempts) if a["percent"] is not None][-10:]
    return {"topics": table, "weak": weak, "slow": slow, "trend": trend}


# ---------- endpoints ----------
@app.get("/api/tests")
async def get_tests(current_user_id: int = Depends(get_current_user_id)):
    """The tests, this week's free test, an unfinished test to go back to, my results and (with the full report) my insights."""
    cache = await practice_questions()
    await close_expired(current_user_id, cache)
    (founder, plan_key), rows, used = await asyncio.gather(
        personal_plan(current_user_id),
        fetch_one_off(select(DBMockAttempt).where(DBMockAttempt.user_id == current_user_id).order_by(DBMockAttempt.id.desc()).limit(30)),
        usage_count(current_user_id, "mock_weekly"))
    attempts = [attempt_summary(a) for (a,) in rows if a.submitted_at]
    running = next(({"id": a.id, "test_key": a.test_key, "title": MOCK_TESTS.get(a.test_key, {}).get("title", "Test"), "ends_at": a.ends_at}
                    for (a,) in rows if not a.submitted_at), None)
    full = founder or bool(limit_of(plan_key, "full_test_report"))
    limit = None if founder else limit_of(plan_key, "mock_weekly")
    answered = await my_answers(current_user_id, cache)
    report = insights(answered, attempts)
    sections = {}
    for question, correct, _ in answered:
        s = sections.setdefault(question_section(question), [0, 0])
        s[0] += 1
        s[1] += 1 if correct else 0
    return {
        "tests": [test_card(key, cache) for key in MOCK_TESTS], "pattern_note": MOCK_PATTERN_NOTE,
        "week": {"used": used, "limit": limit}, "running": running, "attempts": attempts, "full_report": full,
        "sections": [{"section": key, "label": SECTION_LABELS[key], "answered": n, "accuracy": round(c * 100 / n) if n else None}
                     for key, (n, c) in sorted(sections.items(), key=lambda kv: list(SECTION_LABELS).index(kv[0]) if kv[0] in SECTION_LABELS else 9)],
        "insights": report if full else {"locked": True, "weak_count": len(report["weak"]), "answered": len(answered)},
        "topics": sorted({(question_section(q), q.topic or "") for q in cache["by_id"].values() if not q.draft and q.topic}),
        "founder": founder,
    }

@app.post("/api/tests/{test_key}/start")
@limiter.limit("10/minute", key_func=account_rate_key)
async def start_test(request: Request, test_key: str, current_user_id: int = Depends(get_current_user_id)):
    """Starts a timed test (or goes back to the one already running). Counts against the weekly free test."""
    if test_key not in MOCK_TESTS:
        raise HTTPException(status_code=404, detail="There is no such test.")
    cache = await practice_questions()
    await close_expired(current_user_id, cache)
    running = await fetch_one_off(select(DBMockAttempt).where(DBMockAttempt.user_id == current_user_id, func.coalesce(DBMockAttempt.submitted_at, "") == ""))
    if running:
        attempt = running[0][0]
        if attempt.test_key != test_key:
            raise HTTPException(status_code=409, detail=f"Finish or submit your {MOCK_TESTS.get(attempt.test_key, {}).get('title', 'other')} test first.")
        return await attempt_view(attempt, cache)
    await check_limit(current_user_id, "mock_weekly")
    test = MOCK_TESTS[test_key]
    # Questions from the person's tests of the last 30 days are used again only when a pool runs short
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    recent = await fetch_one_off(select(DBMockAttempt.question_ids).where(DBMockAttempt.user_id == current_user_id, DBMockAttempt.started_at >= since))
    seen = {qid for (ids,) in recent for qid in json_data(ids)}
    chosen_ids, parts = [], []
    for label, section, topics, count in test["parts"]:
        pool = [q for q in test_pool(cache, section, topics) if q.id not in chosen_ids]
        fresh = [q for q in pool if q.id not in seen]
        pick = random.sample(fresh, min(count, len(fresh)))
        if len(pick) < count:
            rest = [q for q in pool if q not in pick]
            pick += random.sample(rest, min(count - len(pick), len(rest)))
        if not pick:
            raise HTTPException(status_code=503, detail="This test's questions are still being loaded. Try again in a minute.")
        parts.append([label, len(chosen_ids), len(pick)])
        chosen_ids += [q.id for q in pick]
    now_iso = utc_now_iso()
    rows = await run_returning(DBMockAttempt.__table__.insert().values(
        user_id=current_user_id, test_key=test_key, question_ids=json.dumps(chosen_ids), parts=json.dumps(parts), answers=json.dumps([None] * len(chosen_ids)),
        seconds=json.dumps([0] * len(chosen_ids)), started_at=now_iso, ends_at=utc_after(test["minutes"] * 60), submitted_at="", total=len(chosen_ids))
        .returning(DBMockAttempt.id))
    await bump_usage(current_user_id, "mock_weekly")
    attempt = (await fetch_one_off(select(DBMockAttempt).where(DBMockAttempt.id == rows[0][0])))[0][0]
    return await attempt_view(attempt, cache)

async def attempt_view(attempt, cache: dict) -> dict:
    ids = json_data(attempt.question_ids)
    return {"id": attempt.id, "test_key": attempt.test_key, "title": MOCK_TESTS.get(attempt.test_key, {}).get("title", "Test"),
            "ends_at": attempt.ends_at, "server_now": utc_now_iso(), "answers": json_data(attempt.answers), "seconds": json_data(attempt.seconds),
            "parts": [{"label": label, "start": start, "count": count} for label, start, count in json_data(attempt.parts)],
            "questions": [question_payload(cache["by_id"][qid], i) for i, qid in enumerate(ids) if qid in cache["by_id"]]}

async def own_attempt(attempt_id: int, user_id: int):
    rows = await fetch_one_off(select(DBMockAttempt).where(DBMockAttempt.id == attempt_id, DBMockAttempt.user_id == user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="That test is not yours or no longer here.")
    return rows[0][0]

class TestAnswerBody(BaseModel):
    index: int
    chosen: Optional[int] = None           # None clears the answer
    seconds: Optional[int] = 0             # time spent on this question since the last save

@app.put("/api/tests/attempts/{attempt_id}/answer")
async def save_test_answer(attempt_id: int, body: TestAnswerBody, current_user_id: int = Depends(get_current_user_id)):
    """Saves one answer while the test runs, so nothing is lost if the page closes."""
    attempt = await own_attempt(attempt_id, current_user_id)
    if attempt.submitted_at:
        raise HTTPException(status_code=409, detail="This test is already submitted.")
    if is_past(attempt.ends_at, MOCK_GRACE_SECONDS):
        raise HTTPException(status_code=409, detail="Time is up. Your saved answers are being marked.")
    answers = json_data(attempt.answers)
    if not (0 <= body.index < len(answers)):
        raise HTTPException(status_code=400, detail="There is no such question in this test.")
    question = (await practice_questions())["by_id"].get(json_data(attempt.question_ids)[body.index])
    if body.chosen is not None and not (question and 0 <= body.chosen < len(json_list(question.options))):
        raise HTTPException(status_code=400, detail="Pick one of the choices.")
    # One statement, so two quick saves cannot overwrite each other's question: the JSON is rebuilt from the stored row
    await run_one_off(text("""
        UPDATE mock_attempts SET answers = jsonb_set(answers::jsonb, ARRAY[CAST(:i AS text)], coalesce(to_jsonb(CAST(:chosen AS integer)), 'null'::jsonb))::text,
                                 seconds = jsonb_set(seconds::jsonb, ARRAY[CAST(:i AS text)], to_jsonb(coalesce((seconds::jsonb ->> CAST(:n AS integer))::integer, 0) + :add))::text
        WHERE id = :id AND coalesce(submitted_at, '') = ''""").bindparams(i=str(body.index), n=body.index, chosen=body.chosen, add=max(0, min(body.seconds or 0, 3600)), id=attempt_id))
    return {"index": body.index, "chosen": body.chosen}

class TestSubmitBody(BaseModel):
    seconds: Optional[int] = 0             # time on the question that was open at the end
    index: Optional[int] = None

@app.post("/api/tests/attempts/{attempt_id}/submit")
async def submit_test(attempt_id: int, body: TestSubmitBody, current_user_id: int = Depends(get_current_user_id)):
    attempt = await own_attempt(attempt_id, current_user_id)
    cache = await practice_questions()
    if not attempt.submitted_at:
        if body.index is not None and body.seconds and not is_past(attempt.ends_at, MOCK_GRACE_SECONDS):
            await save_test_answer(attempt_id, TestAnswerBody(index=body.index, chosen=json_data(attempt.answers)[body.index] if 0 <= body.index < attempt.total else None,
                                                              seconds=body.seconds), current_user_id)
        attempt = await own_attempt(attempt_id, current_user_id)
        result = await finish_attempt(attempt, cache)
    else:
        result = {"xp": {"xp": 0}}
    return {**(await test_result(attempt_id, current_user_id)), "xp": result["xp"]}

@app.get("/api/tests/attempts/{attempt_id}")
async def test_result(attempt_id: int, current_user_id: int = Depends(get_current_user_id)):
    """A finished test: the score, the parts, every question with the right answer and why. Time per question and
    topic accuracy only with the full report."""
    attempt = await own_attempt(attempt_id, current_user_id)
    if not attempt.submitted_at:
        raise HTTPException(status_code=409, detail="This test is still running.")
    cache = await practice_questions()
    full = await has_feature(current_user_id, "full_test_report")
    answers, seconds = json_data(attempt.answers), json_data(attempt.seconds)
    review = []
    for i, qid in enumerate(json_data(attempt.question_ids)):
        q = cache["by_id"].get(qid)
        if q is None:
            continue
        chosen = answers[i] if i < len(answers) else None
        item = {**question_payload(q, i), "chosen": chosen, "answer": q.answer, "correct": chosen == q.answer, "why": q.explanation or ""}
        if full:
            item["seconds"] = seconds[i] if i < len(seconds) else 0
        review.append(item)
    summary = attempt_summary(attempt)
    by_topic: dict = {}
    for item in review:
        t = by_topic.setdefault(item["topic"] or "Other", [0, 0])
        t[0] += 1
        t[1] += 1 if item["correct"] else 0
    return {**summary, "review": review, "full_report": full, "unanswered": sum(1 for item in review if item["chosen"] is None),
            "topics": [{"topic": t, "count": n, "right": r} for t, (n, r) in sorted(by_topic.items(), key=lambda kv: kv[1][1] / kv[1][0])] if full else None,
            "time_used": round((datetime.fromisoformat(attempt.submitted_at) - datetime.fromisoformat(attempt.started_at)).total_seconds()),
            "minutes": MOCK_TESTS.get(attempt.test_key, {}).get("minutes")}


# ---------- untimed topic practice ----------
class TopicAnswerBody(BaseModel):
    question_id: int
    chosen: int

@app.get("/api/tests/practice")
async def topic_practice(section: Optional[str] = "", topic: Optional[str] = "", current_user_id: int = Depends(get_current_user_id)):
    """Ten questions of a section or topic, ones not answered yet first. Free and unlimited."""
    cache = await practice_questions()
    pool = [q for q in cache["by_id"].values() if not q.draft and (not section or question_section(q) == section) and (not topic or (q.topic or "") == topic)]
    if not pool:
        raise HTTPException(status_code=404, detail="No questions for that topic yet.")
    done = {qid for (qid,) in await fetch_one_off(select(DBTopicAnswer.question_id).where(DBTopicAnswer.user_id == current_user_id))}
    fresh = [q for q in pool if q.id not in done]
    pick = random.sample(fresh, min(MOCK_TOPIC_BATCH, len(fresh)))
    if len(pick) < MOCK_TOPIC_BATCH:
        rest = [q for q in pool if q not in pick]
        pick += random.sample(rest, min(MOCK_TOPIC_BATCH - len(pick), len(rest)))
    return {"section": section, "topic": topic, "left_new": max(0, len(fresh) - len(pick)), "questions": [question_payload(q, i) for i, q in enumerate(pick)]}

@app.post("/api/tests/practice/answer")
async def answer_topic_question(body: TopicAnswerBody, current_user_id: int = Depends(get_current_user_id)):
    question = (await practice_questions())["by_id"].get(body.question_id)
    if not question or question.draft:
        raise HTTPException(status_code=404, detail="That question is no longer here.")
    if not (0 <= body.chosen < len(json_list(question.options))):
        raise HTTPException(status_code=400, detail="Pick one of the choices.")
    correct = body.chosen == question.answer
    await run_one_off(DBTopicAnswer.__table__.insert().values(user_id=current_user_id, question_id=question.id, chosen=body.chosen,
                                                              correct=1 if correct else 0, answered_at=utc_now_iso()))
    xp = await award_xp(current_user_id, "topic", f"t{question.id}:{site_now().date().isoformat()}", 2)
    return {"question_id": question.id, "correct": correct, "answer": question.answer, "why": question.explanation or "", "xp": xp}


# ---------- the founder: AI drafts for the bank ----------
class DraftBody(BaseModel):
    section: str
    topic: str
    count: Optional[int] = 10

class DraftDecisionBody(BaseModel):
    action: str                             # approve, reject

DRAFT_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["questions"], "properties": {
    "questions": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["q", "options", "answer", "why", "difficulty"],
                                             "properties": {"q": {"type": "string"}, "options": {"type": "array", "items": {"type": "string"}},
                                                            "answer": {"type": "integer"}, "why": {"type": "string"}, "difficulty": {"type": "integer"}}}}}}

@app.post("/api/founder/practice-drafts")
async def draft_questions(body: DraftBody, founder_id: int = Depends(require_founder)):
    """The AI writes questions for a topic; they wait (active = 0, draft = 1) until the founder approves each one."""
    if body.section not in SECTION_LABELS:
        raise HTTPException(status_code=400, detail="Pick a section.")
    topic = clean_required(body.topic, 60, "topic")
    client = helpbot_client()
    if client is None:
        raise HTTPException(status_code=503, detail="AI is not switched on (ANTHROPIC_API_KEY).")
    count = max(3, min(body.count or 10, 20))
    import anthropic
    try:
        message = await client.messages.create(
            model=TUTOR_MODEL, max_tokens=12000, output_config={"effort": "high", "format": {"type": "json_schema", "schema": DRAFT_SCHEMA}},
            messages=[{"role": "user", "content": (
                f"Write {count} original multiple-choice questions for Indian campus placement preparation. Section: {SECTION_LABELS[body.section]}. "
                f"Topic: {topic}. Four options each, exactly one correct (its index from 0 in 'answer'), plausible wrong options, difficulty 1 to 3, "
                f"and a one- or two-sentence explanation that shows the working. Work every answer out carefully before writing it; "
                f"use Indian rupees (₹) for money. Do not copy questions from any company's real papers.")}])
    except anthropic.APIError as e:
        print("Draft questions error:", e)
        raise HTTPException(status_code=502, detail="The AI could not write them. Try again.")
    await record_ai_usage(founder_id, "draft", message.usage)
    data = json.loads(next((b.text for b in message.content if b.type == "text"), "{}") or "{}")
    rows = [{"track": "coding" if body.section == "technical" else "aptitude", "section": body.section, "topic": topic, "question": q["q"][:1200],
             "code": "", "lang": "", "options": json.dumps(q["options"]), "answer": q["answer"], "explanation": q.get("why", "")[:1500],
             "difficulty": max(1, min(3, q.get("difficulty") or 2)), "active": 0, "daily": 0, "draft": 1, "created_by": founder_id, "created_at": utc_now_iso()}
            for q in clean_quiz(data.get("questions"), count)]
    if rows:
        await run_one_off(DBPracticeQuestion.__table__.insert().values(rows))
    return {"added": len(rows)}

@app.get("/api/founder/practice-drafts")
async def list_drafts(founder_id: int = Depends(require_founder)):
    rows = await fetch_one_off(select(DBPracticeQuestion).where(DBPracticeQuestion.draft == 1).order_by(DBPracticeQuestion.id.desc()).limit(200))
    return {"drafts": [{"id": q.id, "section": q.section, "topic": q.topic, "question": q.question, "options": json_list(q.options), "answer": q.answer,
                        "why": q.explanation or "", "difficulty": q.difficulty} for (q,) in rows]}

@app.post("/api/founder/practice-drafts/{question_id}")
async def decide_draft(question_id: int, body: DraftDecisionBody, founder_id: int = Depends(require_founder)):
    if body.action == "approve":
        await run_one_off(update(DBPracticeQuestion).where(DBPracticeQuestion.id == question_id, DBPracticeQuestion.draft == 1).values(draft=0, active=1))
    elif body.action == "reject":
        await run_one_off(delete(DBPracticeQuestion).where(DBPracticeQuestion.id == question_id, DBPracticeQuestion.draft == 1))
    else:
        raise HTTPException(status_code=400, detail="Approve or reject.")
    practice_cache["at"] = 0.0
    return {"id": question_id, "action": body.action}


# ==========================================
# 36. STUDYING TOGETHER: WHO IS STUDYING NOW, STUDY ROOMS, THE WEEKLY LEAGUE (rooms.html, progress.html)
# ==========================================
# Presence and live rooms are kept in memory (one server process; the same note as the socket managers: several
# processes would need Redis). Rooms themselves are rows, so a room survives a restart; its members just rejoin.
# Room events go over the notification socket as type "room_state", "room_reaction" or "room_nudge" (never "content").
class DBStudyRoom(Base):
    __tablename__ = "study_rooms"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    college_key = Column(String, index=True)
    subject = Column(String, default="")
    created_by = Column(Integer, index=True)
    public = Column(Integer, default=1)            # 1: anyone of the college sees it; 0: by invite code only
    invite_code = Column(String, index=True)
    focus_minutes = Column(Integer, default=25)
    break_minutes = Column(Integer, default=5)
    closed = Column(Integer, default=0)
    created_at = Column(String)
    last_used_at = Column(String)

class DBLeagueBadge(Base):
    """A top-three finish in a college's weekly league."""
    __tablename__ = "league_badges"
    __table_args__ = (UniqueConstraint("user_id", "week", name="ux_league_badges"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    week = Column(String)                          # the Monday, YYYY-MM-DD
    college_key = Column(String)
    rank = Column(Integer)
    xp = Column(Integer)
    created_at = Column(String)

USER_DATA_ERASED.update({"league_badges": ("user_id",)})
USER_DATA_KEPT.update({"study_rooms": ("created_by",)})
for _registry in (USER_DATA_ERASED, USER_DATA_KEPT):
    for _table in ("league_badges", "study_rooms"):
        assert all(column in Base.metadata.tables[_table].c for column in _registry.get(_table, ()))

ROOM_MAX_MEMBERS = 30
ROOM_STALE_SECONDS = 75               # a member whose page has not pinged for this long has left
ROOM_REACTIONS = ("👍", "🔥", "💪", "☕", "🎉", "😴")
ROOM_WATCH_SECONDS = 5
ROOM_KEEP_DAYS = 30                   # rooms nobody used for this long are closed
STUDYING_MAX_MINUTES = 180
LEAGUE_SIZE = 20
LEAGUE_MIN_XP = 10                    # to be told about your finish
LEAGUE_HOUR = 6                       # Monday morning (India time): last week's results go out
studying_now: dict = {}               # user_id -> {"college", "until" (timestamp), "subject", "room"}
league_state: dict = {}               # {"done": the week whose results went out}, so Mondays do not ask the database every 5 s
rooms_live: dict = {}                 # room_id -> {"members": {user_id: {...}}, "phase", "ends_at", "started_by"}


def now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()

def studying_count(college_key: str, but: int = 0) -> int:
    t = now_ts()
    return sum(1 for uid, s in list(studying_now.items()) if s["until"] > t and s["college"] == college_key and uid != but)

class StudyingBody(BaseModel):
    minutes: Optional[int] = 25
    subject: Optional[str] = ""

@app.post("/api/study/now")
async def start_studying(body: StudyingBody, current_user_id: int = Depends(get_current_user_id)):
    """The focus timer started: count me as studying until it ends."""
    me = await prep_identity(current_user_id)
    minutes = max(1, min(body.minutes or 25, STUDYING_MAX_MINUTES))
    studying_now[current_user_id] = {"college": me["college_key"], "until": now_ts() + minutes * 60, "subject": (body.subject or "").strip()[:80],
                                     "room": studying_now.get(current_user_id, {}).get("room")}
    return {"studying_now": studying_count(me["college_key"], current_user_id)}

@app.delete("/api/study/now")
async def stop_studying(current_user_id: int = Depends(get_current_user_id)):
    studying_now.pop(current_user_id, None)
    return {"stopped": True}


# ---------- rooms ----------
class RoomBody(BaseModel):
    name: str
    subject: Optional[str] = ""
    public: Optional[bool] = True
    focus_minutes: Optional[int] = 25
    break_minutes: Optional[int] = 5

class RoomTimerBody(BaseModel):
    action: str                           # start, pause, skip
class RoomReactBody(BaseModel):
    emoji: str
class RoomNudgeBody(BaseModel):
    user_id: int
class RoomCodeBody(BaseModel):
    code: str
class RoomPingBody(BaseModel):
    subject: Optional[str] = ""

def room_live(room_id: int) -> dict:
    return rooms_live.setdefault(room_id, {"members": {}, "phase": "idle", "ends_at": 0.0, "started_by": None, "round": 0})

def room_state(room, live: dict, me_id: int = 0) -> dict:
    t = now_ts()
    return {"id": room.id, "name": room.name or "", "subject": room.subject or "", "public": bool(room.public), "owner_id": room.created_by,
            "mine": room.created_by == me_id, "code": room.invite_code if room.created_by == me_id or me_id in live["members"] else "",
            "focus_minutes": room.focus_minutes or 25, "break_minutes": room.break_minutes or 5,
            "phase": live["phase"], "seconds_left": max(0, round(live["ends_at"] - t)) if live["phase"] in ("focus", "break") else 0,
            "paused_left": live.get("paused_left", 0), "round": live["round"],
            "members": sorted([{"id": uid, **{k: m[k] for k in ("name", "pic", "subject")}} for uid, m in live["members"].items()], key=lambda m: m["name"].lower())}

async def load_room(room_id: int, me: dict):
    rows = await fetch_one_off(select(DBStudyRoom).where(DBStudyRoom.id == room_id, func.coalesce(DBStudyRoom.closed, 0) == 0))
    if not rows:
        raise HTTPException(status_code=404, detail="That room is closed.")
    room = rows[0][0]
    if room.college_key != me["college_key"] and not me["founder"]:
        raise HTTPException(status_code=404, detail="That room is for another college.")
    return room

async def room_broadcast(room, payload_type: str = "room_state", extra: Optional[dict] = None, only: Optional[int] = None):
    live = room_live(room.id)
    for uid in ([only] if only else list(live["members"])):
        message = {"type": payload_type, "room_id": room.id, **(extra or {})}
        if payload_type == "room_state":
            message["room"] = room_state(room, live, uid)
        await notification_manager.send_personal_message(json.dumps(message), uid)

@app.get("/api/rooms")
async def list_rooms(current_user_id: int = Depends(get_current_user_id)):
    """Open rooms of my college with who is in them, my own rooms, and how many people of my college are studying now."""
    me = await prep_identity(current_user_id)
    rows = await fetch_one_off(select(DBStudyRoom).where(func.coalesce(DBStudyRoom.closed, 0) == 0, or_(
        and_(DBStudyRoom.college_key == me["college_key"], DBStudyRoom.public == 1), DBStudyRoom.created_by == current_user_id))
        .order_by(DBStudyRoom.last_used_at.desc()).limit(60))
    rooms = [room_state(room, room_live(room.id), current_user_id) for (room,) in rows]
    rooms.sort(key=lambda r: (-len(r["members"]), not r["mine"]))
    t = now_ts()
    return {"college": me["college"], "rooms": rooms, "studying_now": studying_count(me["college_key"], current_user_id),
            "studying_people": sum(1 for s in studying_now.values() if s["until"] > t and s["college"] == me["college_key"]),
            "reactions": list(ROOM_REACTIONS), "in_room": studying_now.get(current_user_id, {}).get("room")}

@app.post("/api/rooms")
async def create_room(body: RoomBody, current_user_id: int = Depends(get_current_user_id)):
    me = await prep_identity(current_user_id)
    if not me["college_key"]:
        raise HTTPException(status_code=400, detail="Add your college on your profile first. Rooms are for classmates.")
    focus, rest = body.focus_minutes or 25, body.break_minutes or 5
    if not (10 <= focus <= 120 and 1 <= rest <= 30):
        raise HTTPException(status_code=400, detail="Focus is 10 to 120 minutes and a break 1 to 30.")
    open_rooms = await fetch_one_off(select(func.count()).select_from(DBStudyRoom).where(DBStudyRoom.created_by == current_user_id, func.coalesce(DBStudyRoom.closed, 0) == 0))
    if open_rooms[0][0] >= 5:
        raise HTTPException(status_code=400, detail="You can keep 5 rooms open. Close one first.")
    now_iso = utc_now_iso()
    rows = await run_returning(DBStudyRoom.__table__.insert().values(
        name=clean_required(body.name, 60, "room name"), college_key=me["college_key"], subject=clean_text(body.subject, 80, "subject"), created_by=current_user_id,
        public=1 if body.public else 0, invite_code=uuid.uuid4().hex[:6].upper(), focus_minutes=focus, break_minutes=rest, closed=0,
        created_at=now_iso, last_used_at=now_iso).returning(DBStudyRoom.id))
    return {"id": rows[0][0]}

async def member_card(user_id: int, subject: str = "") -> dict:
    rows = await fetch_one_off(select(DBUser.name, case((func.length(DBUser.profile_pic) > 1000, ""), else_=DBUser.profile_pic)).where(DBUser.id == user_id))
    name, pic = rows[0] if rows else ("Someone", "")
    return {"name": name or "Someone", "pic": pic or "", "subject": subject[:80], "seen": now_ts()}

async def join_room_by(room, current_user_id: int, subject: str = "") -> dict:
    live = room_live(room.id)
    if current_user_id not in live["members"] and len(live["members"]) >= ROOM_MAX_MEMBERS:
        raise HTTPException(status_code=409, detail="This room is full.")
    # One room at a time
    for other_id, other in rooms_live.items():
        if other_id != room.id and current_user_id in other["members"]:
            other["members"].pop(current_user_id, None)
    live["members"][current_user_id] = await member_card(current_user_id, subject)
    me_now = studying_now.get(current_user_id)
    if me_now:
        me_now["room"] = room.id
    await run_one_off(update(DBStudyRoom).where(DBStudyRoom.id == room.id).values(last_used_at=utc_now_iso()))
    spawn_background(room_broadcast(room))
    return room_state(room, live, current_user_id)

@app.get("/api/rooms/{room_id}")
async def get_room(room_id: int, current_user_id: int = Depends(get_current_user_id)):
    room = await load_room(room_id, await prep_identity(current_user_id))
    if not room.public and room.created_by != current_user_id and current_user_id not in room_live(room_id)["members"]:
        raise HTTPException(status_code=403, detail="This room is private. Ask for its code.")
    return room_state(room, room_live(room_id), current_user_id)

@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: int, body: RoomPingBody, current_user_id: int = Depends(get_current_user_id)):
    room = await load_room(room_id, await prep_identity(current_user_id))
    if not room.public and room.created_by != current_user_id and current_user_id not in room_live(room_id)["members"]:
        raise HTTPException(status_code=403, detail="This room is private. Ask for its code.")
    return await join_room_by(room, current_user_id, body.subject or "")

@app.post("/api/rooms/join-code")
async def join_room_code(body: RoomCodeBody, current_user_id: int = Depends(get_current_user_id)):
    code = (body.code or "").strip().upper()[:12]
    rows = await fetch_one_off(select(DBStudyRoom).where(DBStudyRoom.invite_code == code, func.coalesce(DBStudyRoom.closed, 0) == 0))
    if not rows:
        raise HTTPException(status_code=404, detail="No open room has that code.")
    room = rows[0][0]
    me = await prep_identity(current_user_id)
    if room.college_key != me["college_key"] and not me["founder"]:
        raise HTTPException(status_code=404, detail="That room is for another college.")
    return await join_room_by(room, current_user_id)

@app.post("/api/rooms/{room_id}/ping")
async def ping_room(room_id: int, body: RoomPingBody, current_user_id: int = Depends(get_current_user_id)):
    """The room page says it is still open (every 30 s). Changing what I study updates my card."""
    live = rooms_live.get(room_id)
    if not live or current_user_id not in live["members"]:
        raise HTTPException(status_code=409, detail="You are not in this room any more.")
    member = live["members"][current_user_id]
    member["seen"] = now_ts()
    if body.subject is not None and (body.subject or "")[:80] != member["subject"]:
        member["subject"] = (body.subject or "")[:80]
        room = await load_room(room_id, await prep_identity(current_user_id))
        spawn_background(room_broadcast(room))
    return {"ok": True}

@app.post("/api/rooms/{room_id}/leave")
async def leave_room(room_id: int, current_user_id: int = Depends(get_current_user_id)):
    live = rooms_live.get(room_id)
    if live and live["members"].pop(current_user_id, None) is not None:
        rows = await fetch_one_off(select(DBStudyRoom).where(DBStudyRoom.id == room_id))
        if rows:
            spawn_background(room_broadcast(rows[0][0]))
    if studying_now.get(current_user_id, {}).get("room") == room_id:
        studying_now[current_user_id]["room"] = None
    return {"left": room_id}

@app.post("/api/rooms/{room_id}/timer")
async def room_timer(room_id: int, body: RoomTimerBody, current_user_id: int = Depends(get_current_user_id)):
    """The room's shared timer. The owner runs it; when the owner is not in the room, any member can."""
    room = await load_room(room_id, await prep_identity(current_user_id))
    live = room_live(room_id)
    if current_user_id not in live["members"]:
        raise HTTPException(status_code=409, detail="Join the room first.")
    if room.created_by != current_user_id and room.created_by in live["members"]:
        raise HTTPException(status_code=403, detail="The person who made the room runs its timer.")
    t = now_ts()
    if body.action == "start":
        if live["phase"] == "paused":
            live.update(phase=live.get("paused_phase", "focus"), ends_at=t + live.get("paused_left", 0))
        else:
            live.update(phase="focus", ends_at=t + (room.focus_minutes or 25) * 60, round=live["round"] + 1)
        live["started_by"] = current_user_id
    elif body.action == "pause":
        if live["phase"] in ("focus", "break"):
            live.update(paused_phase=live["phase"], paused_left=max(0, live["ends_at"] - t), phase="paused")
    elif body.action == "skip":
        advance_room(room, live, t)
    elif body.action == "stop":
        live.update(phase="idle", ends_at=0.0)
    else:
        raise HTTPException(status_code=400, detail="Start, pause, skip or stop.")
    spawn_background(room_broadcast(room))
    return room_state(room, live, current_user_id)

def advance_room(room, live: dict, t: float):
    """Focus ends -> break; break ends -> the next focus starts by itself."""
    if live["phase"] == "focus":
        live.update(phase="break", ends_at=t + (room.break_minutes or 5) * 60)
        live["focus_done"] = live["round"]
    elif live["phase"] == "break":
        live.update(phase="focus", ends_at=t + (room.focus_minutes or 25) * 60, round=live["round"] + 1)

@app.post("/api/rooms/{room_id}/react")
async def room_react(room_id: int, body: RoomReactBody, current_user_id: int = Depends(get_current_user_id)):
    if body.emoji not in ROOM_REACTIONS:
        raise HTTPException(status_code=400, detail="Pick one of the reactions.")
    room = await load_room(room_id, await prep_identity(current_user_id))
    if current_user_id not in room_live(room_id)["members"]:
        raise HTTPException(status_code=409, detail="Join the room first.")
    spawn_background(room_broadcast(room, "room_reaction", {"emoji": body.emoji, "from": current_user_id}))
    return {"ok": True}

@app.post("/api/rooms/{room_id}/nudge")
async def room_nudge(room_id: int, body: RoomNudgeBody, current_user_id: int = Depends(get_current_user_id)):
    """A friendly 'back to work' to one member, once a minute at most."""
    room = await load_room(room_id, await prep_identity(current_user_id))
    live = room_live(room_id)
    if current_user_id not in live["members"] or body.user_id not in live["members"] or body.user_id == current_user_id:
        raise HTTPException(status_code=409, detail="You can nudge someone in the same room.")
    key = (room_id, current_user_id, body.user_id)
    last = live.setdefault("nudges", {}).get(key, 0)
    if now_ts() - last < 60:
        raise HTTPException(status_code=429, detail="Give them a minute.")
    live["nudges"][key] = now_ts()
    spawn_background(room_broadcast(room, "room_nudge", {"from": current_user_id, "from_name": live["members"][current_user_id]["name"]}, only=body.user_id))
    return {"ok": True}

@app.delete("/api/rooms/{room_id}")
async def close_room(room_id: int, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBStudyRoom).where(DBStudyRoom.id == room_id))
    if not rows or rows[0][0].created_by != current_user_id:
        raise HTTPException(status_code=403, detail="Only the person who made the room can close it.")
    await run_one_off(update(DBStudyRoom).where(DBStudyRoom.id == room_id).values(closed=1))
    live = rooms_live.pop(room_id, None)
    if live:
        for uid in live["members"]:
            await notification_manager.send_personal_message(json.dumps({"type": "room_closed", "room_id": room_id}), uid)
    return {"closed": room_id}

async def rooms_pass():
    """Moves timers on, drops members who left without saying so. Returns the rooms that changed."""
    t = now_ts()
    changed = set()
    for room_id, live in list(rooms_live.items()):
        stale = [uid for uid, m in live["members"].items() if t - m["seen"] > ROOM_STALE_SECONDS]
        for uid in stale:
            live["members"].pop(uid, None)
            changed.add(room_id)
        if live["phase"] in ("focus", "break") and t >= live["ends_at"]:
            changed.add(room_id)
        if not live["members"] and live["phase"] != "idle":
            live.update(phase="idle", ends_at=0.0)
    if changed:
        rows = await fetch_one_off(select(DBStudyRoom).where(DBStudyRoom.id.in_(changed)))
        for (room,) in rows:
            live = rooms_live.get(room.id)
            if live and live["phase"] in ("focus", "break") and t >= live["ends_at"]:
                advance_room(room, live, t)
            await room_broadcast(room)
    for uid, s in list(studying_now.items()):
        if s["until"] < t:
            studying_now.pop(uid, None)
    return changed

async def rooms_watch():
    last_tidy = ""
    while True:
        try:
            await rooms_pass()
            today = site_now().date().isoformat()
            if today != last_tidy:
                last_tidy = today
                cutoff = (datetime.now(timezone.utc) - timedelta(days=ROOM_KEEP_DAYS)).isoformat()
                await run_one_off(update(DBStudyRoom).where(DBStudyRoom.last_used_at < cutoff, func.coalesce(DBStudyRoom.closed, 0) == 0).values(closed=1))
            await league_pass()
        except Exception as e:
            print("Error in study rooms:", e)
        await asyncio.sleep(ROOM_WATCH_SECONDS)

@app.on_event("startup")
async def rooms_startup():
    spawn_background(rooms_watch())


# ---------- the weekly league ----------
LEAGUE_SQL = text("""
SELECT u.id, u.name, CASE WHEN length(coalesce(u.profile_pic, '')) > 1000 THEN '' ELSE coalesce(u.profile_pic, '') END, sum(x.points) AS xp
FROM xp_events x JOIN users u ON u.id = x.user_id
WHERE x.day >= :from AND x.day < :to AND lower(trim(coalesce(u.college_name, ''))) = :college
  AND coalesce(u.account_status, '') NOT IN ('rejected', 'closing', 'deleted')
GROUP BY u.id, u.name, u.profile_pic HAVING sum(x.points) > 0
ORDER BY xp DESC, u.id LIMIT :limit
""")
LEAGUE_FOLLOWING_SQL = text("""
SELECT u.id, u.name, CASE WHEN length(coalesce(u.profile_pic, '')) > 1000 THEN '' ELSE coalesce(u.profile_pic, '') END,
       coalesce((SELECT sum(points) FROM xp_events x WHERE x.user_id = u.id AND x.day >= :from AND x.day < :to), 0) AS xp
FROM users u
WHERE (u.id = :me OR u.id IN (SELECT followed_id FROM follows WHERE follower_id = :me))
  AND coalesce(u.account_status, '') NOT IN ('rejected', 'closing', 'deleted')
ORDER BY xp DESC, u.id LIMIT 50
""")

def league_week(day=None) -> tuple:
    """(monday, next monday) as YYYY-MM-DD for the week holding day (default: today, India time)."""
    day = day or site_now().date()
    monday = day - timedelta(days=day.weekday())
    return monday.isoformat(), (monday + timedelta(days=7)).isoformat()

def league_rows(rows, me_id: int) -> list:
    return [{"rank": i + 1, "id": uid, "name": name or "Someone", "pic": pic or "", "xp": int(xp or 0), "me": uid == me_id} for i, (uid, name, pic, xp) in enumerate(rows)]

@app.get("/api/league")
async def get_league(current_user_id: int = Depends(get_current_user_id)):
    """This week's league for my college and among the people I follow, my place, last week's finish and my badges."""
    me = await prep_identity(current_user_id)
    start, end = league_week()
    last_start, last_end = league_week(site_now().date() - timedelta(days=7))
    college_rows, following_rows, my_xp, badges, last_rows = await asyncio.gather(
        fetch_one_off(LEAGUE_SQL.bindparams(**{"from": start, "to": end, "college": me["college_key"], "limit": 500})) if me["college_key"] else asyncio.sleep(0, []),
        fetch_one_off(LEAGUE_FOLLOWING_SQL.bindparams(**{"from": start, "to": end, "me": current_user_id})),
        fetch_one_off(select(func.coalesce(func.sum(DBXpEvent.points), 0)).where(DBXpEvent.user_id == current_user_id, DBXpEvent.day >= start, DBXpEvent.day < end)),
        fetch_one_off(select(DBLeagueBadge.week, DBLeagueBadge.rank, DBLeagueBadge.xp).where(DBLeagueBadge.user_id == current_user_id).order_by(DBLeagueBadge.week.desc()).limit(20)),
        fetch_one_off(LEAGUE_SQL.bindparams(**{"from": last_start, "to": last_end, "college": me["college_key"], "limit": 500})) if me["college_key"] else asyncio.sleep(0, []))
    table = league_rows(college_rows, current_user_id)
    mine = next((row for row in table if row["me"]), None)
    last = next((row for row in league_rows(last_rows, current_user_id) if row["me"]), None)
    days_left = (datetime.fromisoformat(end).date() - site_now().date()).days
    above = table[mine["rank"] - 2] if mine and mine["rank"] > 1 else None
    return {"college": me["college"], "week_start": start, "days_left": days_left, "my_xp": int(my_xp[0][0] or 0),
            "my_rank": mine["rank"] if mine else None, "players": len(table),
            "to_next": (above["xp"] - mine["xp"] + 1) if above and mine else None,
            "college_table": table[:LEAGUE_SIZE] + ([mine] if mine and mine["rank"] > LEAGUE_SIZE else []),
            "following_table": league_rows(following_rows, current_user_id),
            "last_week": {"rank": last["rank"], "xp": last["xp"], "players": len(last_rows)} if last else None,
            "badges": [{"week": w, "rank": r, "xp": x} for w, r, x in badges]}

async def league_badges_of(user_ids) -> dict:
    """user id -> number of top-three weekly finishes (for profile badges)."""
    if not user_ids:
        return {}
    rows = await fetch_one_off(select(DBLeagueBadge.user_id, func.count(), func.min(DBLeagueBadge.rank)).where(DBLeagueBadge.user_id.in_(list(user_ids))).group_by(DBLeagueBadge.user_id))
    return {uid: {"count": n, "best": best} for uid, n, best in rows}

async def league_pass(send=None, now=None) -> int:
    """Once a week (Monday morning): last week's results per college. Top three get a badge; everyone with at least
    LEAGUE_MIN_XP is told their place. Returns how many people were told."""
    now = now or site_now()
    if now.weekday() != 0 or now.hour < LEAGUE_HOUR:
        return 0
    start, end = league_week(now.date() - timedelta(days=7))
    if league_state.get("done") == start and send is None:
        return 0
    claimed = await claim_reminders([(0, f"league:{start}")])
    league_state["done"] = start
    if not claimed:
        return 0
    send = send or (lambda uid, text, link: create_notification(uid, "study", text, utc_now_iso(), link))
    colleges = await fetch_one_off(text("""
        SELECT DISTINCT lower(trim(coalesce(u.college_name, ''))), max(u.college_name) FROM xp_events x JOIN users u ON u.id = x.user_id
        WHERE x.day >= :from AND x.day < :to AND trim(coalesce(u.college_name, '')) <> '' GROUP BY 1""").bindparams(**{"from": start, "to": end}))
    told = 0
    for key, name in colleges:
        rows = league_rows(await fetch_one_off(LEAGUE_SQL.bindparams(**{"from": start, "to": end, "college": key, "limit": 500})), 0)
        top = [row for row in rows[:3]]
        if top:
            await run_one_off(pg_insert(DBLeagueBadge).values([{"user_id": r["id"], "week": start, "college_key": key, "rank": r["rank"], "xp": r["xp"],
                                                                 "created_at": utc_now_iso()} for r in top]).on_conflict_do_nothing(index_elements=["user_id", "week"]))
        for row in rows:
            if row["xp"] < LEAGUE_MIN_XP:
                continue
            medal = {1: "You won", 2: "You came 2nd in", 3: "You came 3rd in"}.get(row["rank"])
            text_out = (f"{medal} last week's league at {name} with {row['xp']} XP. A badge is on your profile." if medal
                        else f"You finished #{row['rank']} of {len(rows)} at {name} last week with {row['xp']} XP. A new week has started.")
            await send(row["id"], text_out, "progress.html")
            told += 1
    return told

@app.get("/api/league/badges/{user_id}")
async def get_league_badges(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Top-three weekly finishes of anyone, for their profile."""
    return (await league_badges_of([user_id])).get(user_id) or {"count": 0, "best": None}
