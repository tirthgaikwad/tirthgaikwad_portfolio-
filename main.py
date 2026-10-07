import os
import re
import json
import base64
import uuid
import hmac
import asyncio
import urllib.request
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
from sqlalchemy import Column, Integer, String, func, delete, update, text, and_, or_, case, literal
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

chat_manager = ConnectionManager()
notification_manager = ConnectionManager()
team_chat_manager = RoomConnectionManager()

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
    is_system_message: int = 0
    temp_id: Optional[str] = None

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


@app.get("/api/profiles/{user_id}", response_model=ProfileDetailResponse)
async def get_single_profile(
    user_id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBUser).filter(DBUser.id == user_id))
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=404, detail="Developer not found.")
    
    f1 = await db.execute(select(func.count()).select_from(DBFollow).filter(DBFollow.followed_id == user_id))
    followers_count = f1.scalar()
    
    f2 = await db.execute(select(func.count()).select_from(DBFollow).filter(DBFollow.follower_id == user_id))
    following_count = f2.scalar()
    
    is_following = False
    is_saved = False   

    if current_user.id != user_id:
        cf = await db.execute(select(DBFollow).filter(DBFollow.follower_id == current_user.id, DBFollow.followed_id == user_id))
        is_following = bool(cf.scalars().first())
        
        cs = await db.execute(select(DBSavedProfile).filter(DBSavedProfile.user_id == current_user.id, DBSavedProfile.saved_user_id == user_id))
        is_saved = bool(cs.scalars().first())

        notif = DBNotification(
            user_id=user_id, 
            type="view", 
            content=f"{current_user.name} viewed your profile!", 
            timestamp=utc_now_iso()
        )
        db.add(notif)
        await db.commit()
        await db.refresh(notif)
        
        await notification_manager.send_personal_message(json.dumps({
            "id": notif.id, 
            "type": notif.type, 
            "content": notif.content, 
            "timestamp": notif.timestamp
        }), user_id)
        
    user_dict = {column.name: getattr(user, column.name) for column in user.__table__.columns}
    user_dict["followers_count"] = followers_count
    user_dict["following_count"] = following_count
    user_dict["is_following"] = is_following
    user_dict["is_saved"] = is_saved

    return user_dict


# ==========================================
# 5b. PROFILE UPDATE ENDPOINT
# ==========================================
@app.put("/api/profiles/{user_id}")
async def update_profile(
    user_id: int,
    profile_data: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own profile.")
    
    update_fields = profile_data.dict(exclude_none=True)
    
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update.")
    
    for field, value in update_fields.items():
        setattr(current_user, field, value)
    
    await log_user_activity(db, current_user.id, "Profile Updated", "You updated your profile information.")
    await db.commit()
    await db.refresh(current_user)
    
    return {"message": "Profile updated successfully.", "user_id": current_user.id}


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

async def broadcast_presence(user_id: int, online: bool):
    payload = json.dumps({"type": "presence", "user_id": user_id, "online": online})
    for other_id in chat_manager.get_online_user_ids():
        if other_id != user_id:
            await chat_manager.send_personal_message(payload, other_id)


@app.websocket("/api/ws/{user_id}")
async def chat_websocket_endpoint(websocket: WebSocket, user_id: int):
    if get_websocket_user_id(websocket) != user_id:
        await websocket.close(code=1008)
        return
    was_online = chat_manager.is_online(user_id)
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
        if not chat_manager.is_online(user_id):
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
    online_ids = chat_manager.get_online_user_ids()
    return {"online_user_ids": online_ids}

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
@app.post("/api/save/{user_id}")
async def toggle_save_profile(
    user_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot save your own profile.")
        
    result = await db.execute(select(DBSavedProfile).filter(
        DBSavedProfile.user_id == current_user.id, 
        DBSavedProfile.saved_user_id == user_id
    ))
    existing_save = result.scalars().first()
    
    t_result = await db.execute(select(DBUser).filter(DBUser.id == user_id))
    target_user = t_result.scalars().first()
    target_name = target_user.name if target_user else "a developer"
    
    if existing_save:
        await db.delete(existing_save)
        await log_user_activity(db, current_user.id, "Removed Bookmark", f"Unsaved {target_name}'s profile.")
        await db.commit()
        return {"status": "unsaved"}
    else:
        new_save = DBSavedProfile(
            user_id=current_user.id, 
            saved_user_id=user_id, 
            timestamp=utc_now_iso()
        )
        db.add(new_save)
        await log_user_activity(db, current_user.id, "Profile Saved", f"Bookmarked {target_name}'s profile.")
        await db.commit()
        return {"status": "saved"}


@app.get("/api/saved_profiles", response_model=List[ProfileResponse])
async def get_saved_profiles(
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBSavedProfile.saved_user_id).filter(DBSavedProfile.user_id == current_user.id))
    ids = [sid for sid in result.scalars().all()]
    if not ids: return []
    u_result = await db.execute(select(DBUser).filter(DBUser.id.in_(ids)))
    return u_result.scalars().all()


@app.post("/api/follow/{user_id}")
async def toggle_follow(
    user_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot follow yourself.")
        
    result = await db.execute(select(DBFollow).filter(
        DBFollow.follower_id == current_user.id, 
        DBFollow.followed_id == user_id
    ))
    existing_follow = result.scalars().first()
    
    t_result = await db.execute(select(DBUser).filter(DBUser.id == user_id))
    target_user = t_result.scalars().first()
    target_name = target_user.name if target_user else "a developer"
    
    if existing_follow:
        await db.delete(existing_follow)
        await log_user_activity(db, current_user.id, "Unfollowed Connection", f"You stopped following {target_name}.")
        await db.commit()
        return {"status": "unfollowed"}
    else:
        new_follow = DBFollow(
            follower_id=current_user.id, 
            followed_id=user_id, 
            timestamp=utc_now_iso()
        )
        db.add(new_follow)
        
        await log_user_activity(db, current_user.id, "New Connection", f"You started following {target_name}.")
        
        notif = DBNotification(
            user_id=user_id, 
            type="follow", 
            content=f"{current_user.name} started following you!", 
            timestamp=utc_now_iso()
        )
        db.add(notif)
        await db.commit()
        await db.refresh(notif)
        
        await notification_manager.send_personal_message(json.dumps({
            "id": notif.id, 
            "type": notif.type, 
            "content": notif.content, 
            "timestamp": notif.timestamp
        }), user_id)

        return {"status": "followed"}


@app.get("/api/users/{user_id}/followers", response_model=List[ProfileResponse])
async def get_followers(
    user_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBFollow.follower_id).filter(DBFollow.followed_id == user_id))
    ids = [fid for fid in result.scalars().all()]
    if not ids: return []
    u_result = await db.execute(select(DBUser).filter(DBUser.id.in_(ids)))
    return u_result.scalars().all()


@app.get("/api/users/{user_id}/following", response_model=List[ProfileResponse])
async def get_following(
    user_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBFollow.followed_id).filter(DBFollow.follower_id == user_id))
    ids = [fid for fid in result.scalars().all()]
    if not ids: return []
    u_result = await db.execute(select(DBUser).filter(DBUser.id.in_(ids)))
    return u_result.scalars().all()


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


@app.post("/api/upload/profile-pic")
async def upload_profile_pic(
    request: Request,
    file: UploadFile = File(...), 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    file_location = save_upload(file, "static/uploads", f"user_{current_user.id}_profile", IMAGE_EXTENSIONS, MAX_IMAGE_BYTES)
        
    image_url = upload_url(request, file_location)
    current_user.profile_pic = image_url
    
    await log_user_activity(db, current_user.id, "Profile Updated", "You updated your profile picture.")
    await db.commit()
    await db.refresh(current_user)
    
    return {"message": "Profile picture updated successfully!", "url": image_url}


@app.post("/api/upload/banner-pic")
async def upload_banner_pic(
    request: Request,
    file: UploadFile = File(...), 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    file_location = save_upload(file, "static/uploads", f"user_{current_user.id}_banner", IMAGE_EXTENSIONS, MAX_IMAGE_BYTES)
        
    image_url = upload_url(request, file_location)
    current_user.banner_pic = image_url
    
    await log_user_activity(db, current_user.id, "Profile Updated", "You updated your profile banner.")
    await db.commit()
    await db.refresh(current_user)
    
    return {"message": "Banner picture updated successfully!", "url": image_url}


@app.post("/api/upload/project-pic")
async def upload_project_pic(
    request: Request,
    file: UploadFile = File(...), 
    current_user: DBUser = Depends(get_current_user)
):
    file_location = save_upload(file, "static/uploads", f"user_{current_user.id}_proj_{uuid.uuid4().hex[:8]}", IMAGE_EXTENSIONS, MAX_IMAGE_BYTES)
        
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
@app.post("/api/projects", response_model=ProjectResponse)
async def create_project(
    project: ProjectCreate, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    new_project = DBProject(
        user_id=current_user.id,
        title=project.title,
        description=project.description,
        tech_stack=project.tech_stack,
        github_link=project.github_link,
        live_link=project.live_link,
        image_url=project.image_url
    )
    
    db.add(new_project)
    await log_user_activity(db, current_user.id, "Portfolio Expanded", f"You added a new project: {project.title}.")
    await db.commit()
    await db.refresh(new_project)
    
    return new_project


@app.get("/api/projects/{user_id}", response_model=List[ProjectResponse])
async def get_projects(
    user_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBProject).filter(DBProject.user_id == user_id))
    return result.scalars().all()


@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    result = await db.execute(select(DBProject).filter(DBProject.id == project_id))
    project = result.scalars().first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
        
    if project.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this project.")
        
    title = project.title
    await db.delete(project)
    await log_user_activity(db, current_user.id, "Project Deleted", f"You removed the project: {title}.")
    await db.commit()
    
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
@app.get("/api/github/{username}")
async def get_github_stats(username: str):
    if not username or username.strip() == "":
        raise HTTPException(status_code=400, detail="GitHub username is required.")
        
    headers = {"User-Agent": "ProPartner-App"}
    
    try:
        user_req = urllib.request.Request(f"https://api.github.com/users/{username}", headers=headers)
        with urllib.request.urlopen(user_req) as response:
            user_data = json.loads(response.read().decode())
            
        repos_req = urllib.request.Request(f"https://api.github.com/users/{username}/repos?sort=updated&per_page=10", headers=headers)
        with urllib.request.urlopen(repos_req) as response:
            repos_data = json.loads(response.read().decode())
            
        top_repos = []
        languages = {}
        
        for repo in repos_data:
            if not repo.get("fork"):
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
            "public_repos": user_data.get("public_repos", 0),
            "followers": user_data.get("followers", 0),
            "following": user_data.get("following", 0),
            "languages": languages,
            "top_repos": top_repos[:4],
            "heatmap_url": f"https://ghchart.rshah.org/{username}"
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail="GitHub profile not found or limit exceeded.")


@app.put("/api/user/github")
async def update_github_username(
    github_username: str, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    current_user.github_username = github_username.strip()
    await db.commit()
    return {"status": "success", "github_username": current_user.github_username}


# ==========================================
# 12. TEAMS & COMMUNITIES (DISCORD-STYLE)
# ==========================================
@app.post("/api/teams", response_model=TeamResponse)
async def create_team(
    team_data: TeamCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    name = team_data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required.")
    now_iso = utc_now_iso()
    new_team = DBTeam(
        name=name,
        description=team_data.description,
        created_by=current_user.id,
        created_at=now_iso,
        avatar_url=team_data.avatar_url
    )
    db.add(new_team)
    await db.flush()

    # Every team starts with its creator as Admin and a #general channel, so it is usable straight away
    db.add(DBTeamMember(team_id=new_team.id, user_id=current_user.id, role="Admin", joined_at=now_iso))
    db.add(DBChannel(team_id=new_team.id, name="general", channel_type="text", created_at=now_iso))
    await db.commit()

    await log_user_activity(db, current_user.id, "Team Created", f"You created the team {name}.")
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


@app.post("/api/teams/{team_id}/members")
async def add_team_member(
    team_id: int,
    member_data: TeamMemberAdd,
    db: AsyncSession = Depends(get_fast_db),
    current_user_id: int = Depends(get_current_user_id)
):
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
    return {"message": "Member added successfully."}


@app.get("/api/teams/{team_id}/members", response_model=List[TeamMemberResponse])
async def get_team_members(
    team_id: int,
    db: AsyncSession = Depends(get_fast_db),
    user_id: int = Depends(get_current_user_id)
):
    # Single JOIN; the membership check is done on the result instead of with a second query
    query = (
        select(DBTeamMember, DBUser.name, DBUser.profile_pic)
        .outerjoin(DBUser, DBTeamMember.user_id == DBUser.id)
        .filter(DBTeamMember.team_id == team_id)
        .order_by(DBTeamMember.id.asc())
    )
    rows = (await db.execute(query)).all()
    if not any(m.user_id == user_id for m, _, _ in rows):
        raise HTTPException(status_code=403, detail="You are not a member of this team.")

    return [{
        "id": m.id,
        "team_id": m.team_id,
        "user_id": m.user_id,
        "role": m.role,
        "joined_at": m.joined_at,
        "user_name": name or "Unknown",
        "user_profile_pic": profile_pic or ""
    } for m, name, profile_pic in rows]


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


@app.post("/api/teams/{team_id}/channels", response_model=ChannelResponse)
async def create_team_channel(
    team_id: int,
    channel_data: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    admin_check_res = await db.execute(select(DBTeamMember).filter(
        DBTeamMember.team_id == team_id,
        DBTeamMember.user_id == current_user.id,
        DBTeamMember.role == "Admin"
    ))
    if not admin_check_res.scalars().first():
        raise HTTPException(status_code=403, detail="Only Admins can create channels.")

    new_channel = DBChannel(
        team_id=team_id,
        name=channel_data.name.lower().replace(" ", "-"),
        channel_type=channel_data.channel_type,
        created_at=utc_now_iso()
    )
    db.add(new_channel)
    await db.commit()
    await db.refresh(new_channel)
    return new_channel


def serialize_team_message(msg: DBTeamMessage, user: Optional[DBUser]) -> dict:
    return {
        "id": msg.id,
        "team_id": msg.team_id,
        "channel_id": msg.channel_id,
        "sender_id": msg.sender_id,
        "content": msg.content,
        "timestamp": msg.timestamp,
        "is_system_message": msg.is_system_message,
        "sender_name": user.name if user else "System",
        "sender_pic": (user.profile_pic if user else "") or ""
    }

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
    query = (
        select(DBTeamMessage, DBUser)
        .outerjoin(DBUser, DBTeamMessage.sender_id == DBUser.id)
        .filter(DBTeamMessage.channel_id == channel_id, is_member)
    )
    if before_id:
        query = query.filter(DBTeamMessage.id < before_id)
    if limit:
        query = query.order_by(DBTeamMessage.id.desc()).limit(max(1, min(limit, 100)))
        rows = list(reversed((await db.execute(query)).all()))
    else:
        rows = (await db.execute(query.order_by(DBTeamMessage.id.asc()))).all()

    # An empty result is either an empty channel or no access: only then pay for the explicit check
    if not rows:
        await get_channel_for_member(db, channel_id, user_id)

    return [serialize_team_message(msg, user) for msg, user in rows]


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

    # Membership check and the sender's name and picture in a single query
    result = await db.execute(
        select(DBChannel.team_id, DBUser.name, DBUser.profile_pic)
        .join(DBTeamMember, DBTeamMember.team_id == DBChannel.team_id)
        .join(DBUser, DBUser.id == DBTeamMember.user_id)
        .filter(DBChannel.id == channel_id, DBTeamMember.user_id == current_user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=403, detail="Not a member of this team or channel not found.")

    new_msg = DBTeamMessage(
        team_id=row.team_id,
        channel_id=channel_id,
        sender_id=current_user_id,
        content=content,
        timestamp=utc_now_iso(),
        is_system_message=msg_data.is_system_message
    )
    db.add(new_msg)
    await db.flush()

    msg_payload = serialize_team_message(new_msg, None)
    msg_payload["sender_name"] = row.name
    msg_payload["sender_pic"] = row.profile_pic or ""
    # temp_id lets the sender match this broadcast to the bubble it already drew
    await team_chat_manager.broadcast_to_room(channel_id, json.dumps({**msg_payload, "temp_id": msg_data.temp_id}))
    return msg_payload


@app.delete("/api/channels/{channel_id}/messages/{msg_id}")
async def delete_channel_message(
    channel_id: int,
    msg_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    _, membership = await get_channel_for_member(db, channel_id, current_user_id)
    result = await db.execute(select(DBTeamMessage).filter(DBTeamMessage.id == msg_id, DBTeamMessage.channel_id == channel_id))
    msg = result.scalars().first()
    if not msg:
        return {"status": "deleted"}
    if msg.sender_id != current_user_id and membership.role != "Admin":
        raise HTTPException(status_code=403, detail="Only the sender or a team Admin can delete this message.")

    await db.delete(msg)
    await db.commit()
    await team_chat_manager.broadcast_to_room(channel_id, json.dumps({"type": "message_deleted", "id": msg_id, "channel_id": channel_id}))
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
    return {"status": "left"}


@app.delete("/api/teams/{team_id}")
async def delete_team(
    team_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: DBUser = Depends(get_current_user)
):
    team_res = await db.execute(select(DBTeam).filter(DBTeam.id == team_id))
    team = team_res.scalars().first()
    
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
        
    if team.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the workspace creator can delete this team.")
        
    await db.execute(delete(DBTeamMember).where(DBTeamMember.team_id == team_id))
    await db.execute(delete(DBTeamMessage).where(DBTeamMessage.team_id == team_id))
    await db.execute(delete(DBChannel).where(DBChannel.team_id == team_id))
    
    team_name = team.name
    await db.delete(team)
    
    await log_user_activity(db, current_user.id, "Workspace Deleted", f"You permanently deleted the team: {team_name}.")
    await db.commit()
    
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