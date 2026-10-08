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
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status, Depends, Request, Response, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
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
from sqlalchemy import Column, Integer, String, Float, func, delete, update, text, and_, or_, case, literal
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
    is_ambassador = Column(Integer, default=0) # NEW: Campus Ambassador flag
    ambassador_strikes = Column(Integer, default=0) # NEW: Accountability system
    account_status = Column(String, default="pending") # NEW: pending, verified, rejected, appealed
    
    id_barcode = Column(String, unique=True, nullable=True)
    id_card_image = Column(String, default="")
    portfolio_link = Column(String, default="")
    invite_code = Column(String, default="")

class DBAdminRequest(Base):
    __tablename__ = "admin_requests"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    name = Column(String)
    status = Column(String, default="Pending")
    requested_at = Column(String)

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

class DBTeam(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(String)
    created_by = Column(Integer, index=True)
    created_at = Column(String)
    avatar_url = Column(String, default="")

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
app = FastAPI(title="ProPartner Secure Production API")

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

    hashed_pwd = get_password_hash(profile.password)
    
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
        id_card_image=profile.id_card_image,
        portfolio_link=profile.portfolio_link,
        invite_code=profile.invite_code
    )
    
    db.add(new_user)
    await db.commit()
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
    return {"message": "Account registered.", "user_id": new_user.id, "status": initial_status}


@app.post("/api/login")
@limiter.limit("5/minute") 
async def login_user(request: Request, credentials: UserLogin, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DBUser).filter(DBUser.roll_no == credentials.roll_no))
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials.")
        
    if not verify_password(credentials.password, user.hashed_password):
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
    "profile_pic", "banner_pic", "account_type", "github_username", "is_admin", "account_status"
)

def public_profile_columns():
    return [getattr(DBUser, field) for field in PUBLIC_PROFILE_FIELDS]

def public_profile(row) -> dict:
    """The profile fields anyone logged in may see. Never includes the password hash, email or ID documents."""
    profile = {field: getattr(row, field) for field in PUBLIC_PROFILE_FIELDS}
    for field in PUBLIC_PROFILE_FIELDS:
        if profile[field] is None:
            profile[field] = 0 if field == "is_admin" else ""
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
            await create_notification(profile_id, "view", f"{rows[0][0]} viewed your profile!", utc_now_iso())
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
PROFILE_FIELD_LIMITS = {"name": 80, "college_name": 150, "department": 120, "city": 80, "division": 40, "skills": 500, "bio": 500}

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

@app.get("/api/history", response_model=List[dict])
async def get_history(db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    result = await db.execute(select(DBHistory).filter(DBHistory.user_id == current_user.id).order_by(DBHistory.id.desc()))
    logs = result.scalars().all()
    return [{"id": l.id, "time": l.time, "action": l.action, "detail": l.detail} for l in logs]


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


async def create_notification(user_id: int, notif_type: str, content: str, timestamp: str):
    """Save a bell notification and push it to the user if they are online. Meant to run in the background."""
    try:
        async with AutocommitSession() as db:
            notif = DBNotification(user_id=user_id, type=notif_type, content=content, timestamp=timestamp)
            db.add(notif)
            await db.flush()
        await notification_manager.send_personal_message(json.dumps({
            "id": notif.id,
            "type": notif.type,
            "content": notif.content,
            "timestamp": notif.timestamp
        }), user_id)
    except Exception as e:
        print("Error creating notification:", e)


async def notify_new_message(receiver_id: int, timestamp: str):
    """Bell notification for a new message. Runs after delivery so it never delays the message itself."""
    await create_notification(receiver_id, "message", "New message", timestamp)


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
            spawn_background(notify_new_message(receiver_id, message["timestamp"]))


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
        spawn_background(notify_new_message(msg.receiver_id, message["timestamp"]))
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
            "archived": row.archived_id is not None
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
    rows = (await db.execute(muted_q.union_all(blocked_q))).all()
    return {
        "muted": [target_id for kind, target_id in rows if kind == "muted"],
        "blocked": [target_id for kind, target_id in rows if kind == "blocked"]
    }


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
        return {"status": "unfollowed"}

    if target_name is None:
        raise HTTPException(status_code=404, detail="Developer not found.")
    now_iso = utc_now_iso()
    db.add(DBFollow(follower_id=current_user_id, followed_id=user_id, timestamp=now_iso))
    await db.flush()

    spawn_background(log_activity_later(current_user_id, "New Connection", f"You started following {target_name}."))
    spawn_background(create_notification(user_id, "follow", f"{my_name} started following you!", now_iso))
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

@app.post("/api/board/posts")
async def create_board_post(
    post_data: BoardPostCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    new_post = DBBoardPost(
        category=post_data.category,
        title=post_data.title,
        description=post_data.description,
        skills_required=post_data.skills_required,
        author_id=current_user.id,
        created_at=utc_now_iso()
    )
    
    db.add(new_post)
    await log_user_activity(db, current_user.id, "Posted Opportunity", f"You created a new {post_data.category} post.")
    await db.commit()
    
    return {"status": "success", "message": "Opportunity published successfully!"}

@app.delete("/api/board/posts/{post_id}")
async def delete_board_post(
    post_id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBBoardPost).filter(DBBoardPost.id == post_id))
    post = result.scalars().first()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
        
    if post.author_id != current_user.id and current_user.is_admin != 1:
        raise HTTPException(status_code=403, detail="Not authorized to delete this post.")
        
    title = post.title
    await db.delete(post)
    await log_user_activity(db, current_user.id, "Post Deleted", f"You removed the post: {title}.")
    await db.commit()
    
    return {"message": "Post deleted successfully."}


# ==========================================
# 11. GITHUB API INTEGRATION ENDPOINT
# ==========================================
GITHUB_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
GITHUB_CACHE_SECONDS = 600
github_cache: dict = {}   # lower-case username -> (expires at, data)

def fetch_github_profile(username: str) -> dict:
    """Blocking calls to GitHub's public API. Run this in a worker thread, never directly in a request."""
    headers = {"User-Agent": "ProPartner-App", "Accept": "application/vnd.github+json"}

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
        select(DBTeam.name, caller.role, existing.id, DBUser.id)
        .outerjoin(caller, and_(caller.team_id == DBTeam.id, caller.user_id == current_user_id))
        .outerjoin(existing, and_(existing.team_id == DBTeam.id, existing.user_id == member_data.user_id))
        .outerjoin(DBUser, DBUser.id == member_data.user_id)
        .filter(DBTeam.id == team_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Team not found.")
    team_name, caller_role, existing_id, target_id = row
    if caller_role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can add members.")
    if target_id is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if existing_id is not None:
        raise HTTPException(status_code=400, detail="User is already in the team.")

    now_iso = utc_now_iso()
    db.add(DBTeamMember(team_id=team_id, user_id=member_data.user_id, role=member_data.role, joined_at=now_iso))
    await db.flush()

    spawn_background(create_notification(
        member_data.user_id, "team_invite",
        f"You were added to the team: {team_name} as {member_data.role}.", now_iso
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
    headers = {"User-Agent": "ProPartner-App", "Accept": "application/vnd.github+json"}

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


@app.delete("/api/teams/{team_id}")
async def delete_team(
    team_id: int,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
    team_res = await db.execute(select(DBTeam.name, DBTeam.created_by).filter(DBTeam.id == team_id))
    team = team_res.first()

    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")

    if team.created_by != current_user_id:
        raise HTTPException(status_code=403, detail="Only the workspace creator can delete this team.")

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
    )

    spawn_background(log_activity_later(current_user_id, "Workspace Deleted", f"You permanently deleted the team: {team.name}."))
    await team_hub.broadcast(team_id, {"type": "team_deleted", "team_id": team_id})

    return {"message": "Team deleted successfully."}

# ==========================================
# 13. ADMIN & VERIFICATION SYSTEM
# ==========================================
FOUNDER_NAME = "Gopale Omkar Ravindra"
FOUNDER_CODE = os.getenv("FOUNDER_CODE")  # Founder login is disabled when unset

@app.post("/api/admin/apply")
async def apply_for_admin(db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    existing = await db.execute(select(DBAdminRequest).filter(DBAdminRequest.user_id == current_user.id))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="You have already applied for admin access.")
    
    req = DBAdminRequest(
        user_id=current_user.id,
        name=current_user.name,
        status="Pending",
        requested_at=utc_now_iso()
    )
    db.add(req)
    await db.commit()
    return {"message": "Admin request submitted successfully."}

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
        founder_user.is_admin = 1
        founder_user.account_type = "premium" 
        await db.commit()
        
        access_token = create_access_token(data={"sub": str(founder_user.id)})
        admin_token = create_access_token(data={"sub": str(founder_user.id), "role": "founder"})
        
        response.set_cookie(key="authToken", value=access_token, httponly=True, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, samesite="lax", path="/")
        response.set_cookie(key="adminToken", value=admin_token, httponly=True, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, samesite="lax", path="/")
        
        # RETURN TOKEN DIRECTLY IN JSON FOR LOCALSTORAGE FALLBACK
        return {"message": "Founder Access Granted", "role": "founder", "user_id": founder_user.id, "token": admin_token}
    
    # --- REGULAR ADMIN LOGIN (the secure code is the admin's own account password) ---
    result = await db.execute(select(DBUser).filter(DBUser.name == credentials.name, DBUser.is_admin == 1))
    admin_user = next(
        (u for u in result.scalars().all() if u.hashed_password and verify_password(credentials.bypass_code, u.hashed_password)),
        None
    )

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
        if payload.get("role") != "admin" and payload.get("role") != "founder":
            raise HTTPException(status_code=403, detail="Insufficient permissions.")
        return payload
    except:
        raise HTTPException(status_code=401, detail="Invalid admin token.")

@app.get("/api/admin/requests", response_model=List[AdminRequestResponse])
async def get_admin_requests(db: AsyncSession = Depends(get_db), admin_data: dict = Depends(get_current_admin)):
    result = await db.execute(select(DBAdminRequest).order_by(DBAdminRequest.id.desc()))
    return result.scalars().all()

@app.post("/api/admin/requests/{req_id}/accept")
async def accept_admin(req_id: int, db: AsyncSession = Depends(get_db), admin_data: dict = Depends(get_current_admin)):
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

# ==========================================
# 14. DECENTRALIZED AMBASSADOR VERIFICATION ROUTES
# ==========================================
@app.get("/api/ambassador/pending", response_model=List[PendingUserResponse])
async def get_pending_users(db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    if current_user.is_ambassador != 1:
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
    if current_user.is_ambassador != 1:
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