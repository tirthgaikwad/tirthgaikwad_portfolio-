import os
import shutil
import json
import uuid
import urllib.request
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status, Depends, Request, Response, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import bcrypt
import jwt
from datetime import datetime, timedelta

# --- RATE LIMITING IMPORTS ---
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# --- ASYNC DATABASE IMPORTS ---
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import Column, Integer, String, func, delete
from database import engine, Base, get_db

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

class DBTeamMessage(Base):
    __tablename__ = "team_messages"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, index=True)
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

# --- ASYNC HELPER FUNCTION ---
async def log_user_activity(db: AsyncSession, user_id: int, action: str, detail: str):
    new_log = DBHistory(
        user_id=user_id,
        time=datetime.now().isoformat(),
        action=action,
        detail=detail
    )
    db.add(new_log)
    await db.commit()

# ==========================================
# 2. APPLICATION & WEBSOCKET SETUP
# ==========================================
app = FastAPI(title="ProPartner Secure Production API")

@app.on_event("startup")
async def startup_event():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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

    async def send_personal_message(self, message: str, user_id: int):
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_text(message)
                except Exception:
                    pass

class RoomConnectionManager:
    def __init__(self):
        self.rooms: dict[int, dict[int, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: int, user_id: int):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        self.rooms[room_id][user_id] = websocket

    def disconnect(self, room_id: int, user_id: int):
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            del self.rooms[room_id][user_id]
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast_to_room(self, room_id: int, message: str):
        if room_id in self.rooms:
            for uid, connection in self.rooms[room_id].items():
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

SECRET_KEY = os.getenv("SECRET_KEY", "fallback-secret-key-for-dev")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 

# ==========================================
# 3. PYDANTIC SCHEMAS
# ==========================================
class ProfileRegister(BaseModel):
    name: str
    email: str
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

class UserLogin(BaseModel):
    roll_no: str
    password: str

class ProfileResponse(BaseModel):
    id: int
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

class ProfileDetailResponse(ProfileResponse):
    followers_count: int
    following_count: int
    is_following: bool
    is_saved: bool   

class MessageCreate(BaseModel):
    sender_id: int
    receiver_id: int
    content: str

class MessageResponse(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    content: str
    timestamp: datetime
    
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

class TeamMessageCreate(BaseModel):
    content: str
    is_system_message: int = 0

class TeamMessageResponse(BaseModel):
    id: int
    team_id: int
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


# ==========================================
# 5. CORE API ENDPOINTS
# ==========================================
@app.post("/api/register", status_code=status.HTTP_201_CREATED)
async def register_user(profile: ProfileRegister, response: Response, db: AsyncSession = Depends(get_db)):
    # Check for existing user by roll number or email
    result = await db.execute(select(DBUser).filter((DBUser.roll_no == profile.roll_no) | (DBUser.email == profile.email)))
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
    if profile.email.endswith(".edu.in") or profile.email.endswith(".ac.in"):
        initial_status = "verified"
        
    # 2. Professional Invite Code Auto-Verify
    elif profile.account_type == "professional" and profile.invite_code:
        # In a full build, you'd check if the invite_code is valid in the DB here
        initial_status = "verified"
    
    new_user = DBUser(
        roll_no=profile.roll_no,
        email=profile.email,
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
    return {"message": "Login successful.", "user_id": user.id, "account_type": user.account_type}


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
    current_user: DBUser = Depends(get_current_user)
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
            timestamp=datetime.now().isoformat()
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
@app.websocket("/api/ws/{user_id}")
async def chat_websocket_endpoint(websocket: WebSocket, user_id: int):
    await chat_manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        chat_manager.disconnect(websocket, user_id)


@app.post("/api/messages", response_model=MessageResponse)
async def send_message(
    msg: MessageCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    if current_user.id != msg.sender_id:
        raise HTTPException(status_code=403, detail="Not authorized to send as this user.")
        
    new_msg = DBMessage(
        sender_id=msg.sender_id,
        receiver_id=msg.receiver_id,
        content=msg.content,
        timestamp=datetime.now().isoformat()
    )
    db.add(new_msg)
    
    notif = DBNotification(
        user_id=msg.receiver_id, 
        type="message", 
        content=f"New message from {current_user.name}", 
        timestamp=datetime.now().isoformat()
    )
    db.add(notif)
    
    await db.commit()
    await db.refresh(new_msg)
    await db.refresh(notif)

    result = await db.execute(select(DBUser).filter(DBUser.id == msg.receiver_id))
    receiver = result.scalars().first()
    r_name = receiver.name if receiver else "a developer"
    await log_user_activity(db, current_user.id, "Message Sent", f"You sent a message to {r_name}.")

    msg_data = {
        "id": new_msg.id,
        "sender_id": new_msg.sender_id,
        "receiver_id": new_msg.receiver_id,
        "content": new_msg.content,
        "timestamp": new_msg.timestamp.isoformat() if isinstance(new_msg.timestamp, datetime) else new_msg.timestamp
    }
    await chat_manager.send_personal_message(json.dumps(msg_data), msg.receiver_id)
    
    await notification_manager.send_personal_message(json.dumps({
        "id": notif.id, 
        "type": notif.type, 
        "content": notif.content, 
        "timestamp": notif.timestamp
    }), msg.receiver_id)

    return new_msg

@app.delete("/api/messages/{msg_id}")
async def delete_personal_message(msg_id: int, db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    result = await db.execute(select(DBMessage).filter(DBMessage.id == msg_id))
    msg = result.scalars().first()
    if msg and (msg.sender_id == current_user.id or msg.receiver_id == current_user.id):
        await db.execute(delete(DBMessage).where(DBMessage.id == msg_id))
        await db.commit()
    return {"status": "deleted"}


@app.get("/api/messages/{user_id}", response_model=List[MessageResponse])
async def get_messages(
    user_id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view these messages.")
        
    result = await db.execute(select(DBMessage).filter(
        (DBMessage.sender_id == user_id) | (DBMessage.receiver_id == user_id)
    ))
    return result.scalars().all()


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
            timestamp=datetime.now().isoformat()
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
            timestamp=datetime.now().isoformat()
        )
        db.add(new_follow)
        
        await log_user_activity(db, current_user.id, "New Connection", f"You started following {target_name}.")
        
        notif = DBNotification(
            user_id=user_id, 
            type="follow", 
            content=f"{current_user.name} started following you!", 
            timestamp=datetime.now().isoformat()
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
@app.post("/api/upload/profile-pic")
async def upload_profile_pic(
    file: UploadFile = File(...), 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    if not file.content_type.startswith("image/"): 
        raise HTTPException(status_code=400, detail="Invalid file. Not an image.")
        
    file_extension = file.filename.split(".")[-1]
    safe_filename = f"user_{current_user.id}_profile.{file_extension}"
    file_location = f"static/uploads/{safe_filename}"
    
    with open(file_location, "wb") as buffer: 
        shutil.copyfileobj(file.file, buffer)
        
    image_url = f"http://127.0.0.1:8000/{file_location}"
    current_user.profile_pic = image_url
    
    await log_user_activity(db, current_user.id, "Profile Updated", "You updated your profile picture.")
    await db.commit()
    await db.refresh(current_user)
    
    return {"message": "Profile picture updated successfully!", "url": image_url}


@app.post("/api/upload/banner-pic")
async def upload_banner_pic(
    file: UploadFile = File(...), 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    if not file.content_type.startswith("image/"): 
        raise HTTPException(status_code=400, detail="Invalid file. Not an image.")
        
    file_extension = file.filename.split(".")[-1]
    safe_filename = f"user_{current_user.id}_banner.{file_extension}"
    file_location = f"static/uploads/{safe_filename}"
    
    with open(file_location, "wb") as buffer: 
        shutil.copyfileobj(file.file, buffer)
        
    image_url = f"http://127.0.0.1:8000/{file_location}"
    current_user.banner_pic = image_url
    
    await log_user_activity(db, current_user.id, "Profile Updated", "You updated your profile banner.")
    await db.commit()
    await db.refresh(current_user)
    
    return {"message": "Banner picture updated successfully!", "url": image_url}


@app.post("/api/upload/project-pic")
async def upload_project_pic(
    file: UploadFile = File(...), 
    current_user: DBUser = Depends(get_current_user)
):
    if not file.content_type.startswith("image/"): 
        raise HTTPException(status_code=400, detail="Invalid file. Not an image.")
        
    file_extension = file.filename.split(".")[-1]
    safe_filename = f"user_{current_user.id}_proj_{uuid.uuid4().hex[:8]}.{file_extension}"
    file_location = f"static/uploads/{safe_filename}"
    
    with open(file_location, "wb") as buffer: 
        shutil.copyfileobj(file.file, buffer)
        
    image_url = f"http://127.0.0.1:8000/{file_location}"
    
    return {"message": "Project image uploaded successfully!", "url": image_url}


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
        created_at=datetime.now().isoformat()
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
        
    if post.author_id != current_user.id:
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
    new_team = DBTeam(
        name=team_data.name,
        description=team_data.description,
        created_by=current_user.id,
        created_at=datetime.now().isoformat(),
        avatar_url=team_data.avatar_url
    )
    db.add(new_team)
    await db.commit()
    await db.refresh(new_team)

    admin_member = DBTeamMember(
        team_id=new_team.id,
        user_id=current_user.id,
        role="Admin",
        joined_at=datetime.now().isoformat()
    )
    db.add(admin_member)
    await db.commit()

    await log_user_activity(db, current_user.id, "Team Created", f"You created the team {team_data.name}.")
    return new_team


@app.get("/api/teams", response_model=List[TeamResponse])
async def get_my_teams(db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    t_res = await db.execute(select(DBTeamMember.team_id).filter(DBTeamMember.user_id == current_user.id))
    t_ids = [t for t in t_res.scalars().all()]
    
    if not t_ids:
        res = await db.execute(select(DBTeam).filter(DBTeam.created_by == current_user.id))
        return res.scalars().all()
        
    res = await db.execute(select(DBTeam).filter((DBTeam.created_by == current_user.id) | (DBTeam.id.in_(t_ids))))
    return res.scalars().all()


@app.post("/api/teams/{team_id}/members")
async def add_team_member(
    team_id: int,
    member_data: TeamMemberAdd,
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    admin_check_res = await db.execute(select(DBTeamMember).filter(
        DBTeamMember.team_id == team_id,
        DBTeamMember.user_id == current_user.id,
        DBTeamMember.role == "Admin"
    ))
    if not admin_check_res.scalars().first():
        raise HTTPException(status_code=403, detail="Only Admins can add members.")

    exist_res = await db.execute(select(DBTeamMember).filter(
        DBTeamMember.team_id == team_id,
        DBTeamMember.user_id == member_data.user_id
    ))
    if exist_res.scalars().first():
        raise HTTPException(status_code=400, detail="User is already in the team.")

    new_member = DBTeamMember(
        team_id=team_id,
        user_id=member_data.user_id,
        role=member_data.role,
        joined_at=datetime.now().isoformat()
    )
    db.add(new_member)
    await db.commit()

    team_res = await db.execute(select(DBTeam).filter(DBTeam.id == team_id))
    team = team_res.scalars().first()
    
    notif = DBNotification(
        user_id=member_data.user_id,
        type="team_invite",
        content=f"You were added to the team: {team.name} as {member_data.role}.",
        timestamp=datetime.now().isoformat()
    )
    db.add(notif)
    await db.commit()

    return {"message": "Member added successfully."}


@app.get("/api/teams/{team_id}/members", response_model=List[TeamMemberResponse])
async def get_team_members(
    team_id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    in_team_res = await db.execute(select(DBTeamMember).filter(DBTeamMember.team_id == team_id, DBTeamMember.user_id == current_user.id))
    if not in_team_res.scalars().first():
        raise HTTPException(status_code=403, detail="You are not a member of this team.")

    mem_res = await db.execute(select(DBTeamMember).filter(DBTeamMember.team_id == team_id))
    members = mem_res.scalars().all()
    
    result = []
    for m in members:
        u_res = await db.execute(select(DBUser).filter(DBUser.id == m.user_id))
        user = u_res.scalars().first()
        result.append({
            "id": m.id,
            "team_id": m.team_id,
            "user_id": m.user_id,
            "role": m.role,
            "joined_at": m.joined_at,
            "user_name": user.name if user else "Unknown",
            "user_profile_pic": user.profile_pic if user else ""
        })
    return result


@app.get("/api/teams/{team_id}/messages", response_model=List[TeamMessageResponse])
async def get_team_messages(
    team_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    in_team_res = await db.execute(select(DBTeamMember).filter(DBTeamMember.team_id == team_id, DBTeamMember.user_id == current_user.id))
    if not in_team_res.scalars().first():
        raise HTTPException(status_code=403, detail="Not a member of this team.")

    # FAST JOIN FOR TEAM MESSAGES
    query = (
        select(DBTeamMessage, DBUser)
        .outerjoin(DBUser, DBTeamMessage.sender_id == DBUser.id)
        .filter(DBTeamMessage.team_id == team_id)
        .order_by(DBTeamMessage.id.asc())
    )
    msg_res = await db.execute(query)
    rows = msg_res.all()
    
    result = []
    for msg, user in rows:
        result.append({
            "id": msg.id,
            "team_id": msg.team_id,
            "sender_id": msg.sender_id,
            "content": msg.content,
            "timestamp": msg.timestamp,
            "is_system_message": msg.is_system_message,
            "sender_name": user.name if user else "System",
            "sender_pic": user.profile_pic if user else ""
        })
    return result


@app.post("/api/teams/{team_id}/messages", response_model=TeamMessageResponse)
async def send_team_message(
    team_id: int,
    msg_data: TeamMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DBUser = Depends(get_current_user)
):
    in_team_res = await db.execute(select(DBTeamMember).filter(DBTeamMember.team_id == team_id, DBTeamMember.user_id == current_user.id))
    if not in_team_res.scalars().first():
        raise HTTPException(status_code=403, detail="Not a member of this team.")

    new_msg = DBTeamMessage(
        team_id=team_id,
        sender_id=current_user.id,
        content=msg_data.content,
        timestamp=datetime.now().isoformat(),
        is_system_message=msg_data.is_system_message
    )
    db.add(new_msg)
    await db.commit()
    await db.refresh(new_msg)

    msg_payload = {
        "id": new_msg.id,
        "team_id": new_msg.team_id,
        "sender_id": new_msg.sender_id,
        "content": new_msg.content,
        "timestamp": new_msg.timestamp,
        "is_system_message": new_msg.is_system_message,
        "sender_name": current_user.name,
        "sender_pic": current_user.profile_pic
    }
    await team_chat_manager.broadcast_to_room(team_id, json.dumps(msg_payload))
    return msg_payload


@app.websocket("/api/ws/teams/{team_id}/{user_id}")
async def team_websocket_endpoint(websocket: WebSocket, team_id: int, user_id: int):
    await team_chat_manager.connect(websocket, team_id, user_id)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        team_chat_manager.disconnect(team_id, user_id)

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
    
    team_name = team.name
    await db.delete(team)
    
    await log_user_activity(db, current_user.id, "Workspace Deleted", f"You permanently deleted the team: {team_name}.")
    await db.commit()
    
    return {"message": "Team deleted successfully."}

# ==========================================
# 13. ADMIN & VERIFICATION SYSTEM
# ==========================================
FOUNDER_NAME = "Gopale Omkar Ravindra"
FOUNDER_CODE = os.getenv("FOUNDER_CODE", "140325")

@app.post("/api/admin/apply")
async def apply_for_admin(db: AsyncSession = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    existing = await db.execute(select(DBAdminRequest).filter(DBAdminRequest.user_id == current_user.id))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="You have already applied for admin access.")
    
    req = DBAdminRequest(
        user_id=current_user.id,
        name=current_user.name,
        status="Pending",
        requested_at=datetime.now().isoformat()
    )
    db.add(req)
    await db.commit()
    return {"message": "Admin request submitted successfully."}

@app.post("/api/admin/login")
async def admin_login(credentials: AdminLogin, response: Response, db: AsyncSession = Depends(get_db)):
    # --- FOUNDER GOD-MODE BYPASS ---
    if credentials.bypass_code == FOUNDER_CODE and credentials.name == FOUNDER_NAME:
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
    
    # --- REGULAR ADMIN LOGIN ---
    result = await db.execute(select(DBUser).filter(DBUser.name == credentials.name, DBUser.is_admin == 1))
    admin_user = result.scalars().first()
    
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
@app.get("/api/ambassador/pending")
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
        
    result = await db.execute(select(DBUser).filter(DBUser.id == target_id, DBUser.college_name == current_user.college_name))
    target_user = result.scalars().first()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="Student not found in your jurisdiction.")
        
    if action == "approve":
        target_user.account_status = "verified"
    elif action == "reject":
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