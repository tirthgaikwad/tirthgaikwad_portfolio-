from pydantic import BaseModel, EmailStr, HttpUrl
from typing import Optional, List
from datetime import datetime

# ==========================================
# USER SCHEMAS
# ==========================================

class UserBase(BaseModel):
    email: EmailStr
    name: str
    roll_no: Optional[str] = None
    bio: Optional[str] = None
    college_name: Optional[str] = None
    department: Optional[str] = None
    division: Optional[str] = None
    city: Optional[str] = None
    profile_pic: Optional[str] = None
    banner_pic: Optional[str] = None
    skills: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    account_type: str

    class Config:
        orm_mode = True

# Specialized response for when viewing a full profile
class UserProfileResponse(UserResponse):
    followers_count: int
    following_count: int
    is_following: bool
    is_saved: bool

    class Config:
        orm_mode = True


# ==========================================
# PROJECT SCHEMAS
# ==========================================

class ProjectBase(BaseModel):
    title: str
    description: str
    tech_stack: str
    github_link: Optional[str] = None
    live_link: Optional[str] = None
    image_url: Optional[str] = None

class ProjectCreate(ProjectBase):
    pass

class ProjectResponse(ProjectBase):
    id: int
    user_id: int

    class Config:
        orm_mode = True


# ==========================================
# MESSAGE SCHEMAS
# ==========================================

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
    is_read: bool

    class Config:
        orm_mode = True


# ==========================================
# NOTIFICATION SCHEMAS
# ==========================================

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    content: str
    type: str
    timestamp: datetime
    is_read: int

    class Config:
        orm_mode = True


# ==========================================
# BOARD POST SCHEMAS (Hackathon / Projects)
# ==========================================

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
    created_at: datetime
    author_id: int
    author_name: str
    author_pic: Optional[str] = ""
    author_college: str

    class Config:
        orm_mode = True


# ==========================================
# AUTHENTICATION & UTILITY SCHEMAS
# ==========================================

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class StatusResponse(BaseModel):
    status: str
    message: Optional[str] = None