from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Table
from sqlalchemy.orm import relationship
from datetime import datetime

# IMPORTANT: Adjust this import based on your database configuration file
# from database import Base
# If you don't have a separate database.py, keep the following two lines:
from sqlalchemy.ext.declarative import declarative_base
Base = declarative_base()

# ==========================================
# ASSOCIATION TABLES (For Many-to-Many Relationships)
# ==========================================

# Association table for the Follower system
followers_association = Table(
    'followers',
    Base.metadata,
    Column('follower_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('followed_id', Integer, ForeignKey('users.id'), primary_key=True)
)

# Association table for the Saved Profiles system
saved_profiles_association = Table(
    'saved_profiles',
    Base.metadata,
    Column('saver_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('saved_user_id', Integer, ForeignKey('users.id'), primary_key=True)
)


# ==========================================
# DATABASE MODELS
# ==========================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    
    # Profile Data
    name = Column(String(255), nullable=False)
    roll_no = Column(String(100))
    bio = Column(Text)
    college_name = Column(String(255))
    department = Column(String(255))
    division = Column(String(50))
    city = Column(String(100))
    profile_pic = Column(String(500))
    banner_pic = Column(String(500))
    skills = Column(String(500)) # Comma-separated skills
    
    # Subscription & Role Management (The "God Mode" and Premium update)
    account_type = Column(String(50), default="standard") # Values: 'standard', 'premium', 'founder'
    
    # Standard Relationships
    projects = relationship("Project", back_populates="owner")
    board_posts = relationship("BoardPost", back_populates="author")
    notifications = relationship("Notification", back_populates="user")
    
    # Many-to-Many Relationships
    following = relationship(
        "User",
        secondary=followers_association,
        primaryjoin=id==followers_association.c.follower_id,
        secondaryjoin=id==followers_association.c.followed_id,
        backref="followers"
    )
    
    saved_profiles = relationship(
        "User",
        secondary=saved_profiles_association,
        primaryjoin=id==saved_profiles_association.c.saver_id,
        secondaryjoin=id==saved_profiles_association.c.saved_user_id,
        backref="saved_by"
    )


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    tech_stack = Column(String(500), nullable=False)
    github_link = Column(String(500))
    live_link = Column(String(500))
    image_url = Column(Text) # Comma-separated URLs for multiple images
    
    owner = relationship("User", back_populates="projects")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    
    # Used for the Blue Tick Read Receipts logic
    is_read = Column(Boolean, default=False) 
    
    sender = relationship("User", foreign_keys=[sender_id])
    receiver = relationship("User", foreign_keys=[receiver_id])


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(String(500), nullable=False)
    type = Column(String(50), nullable=False) # e.g., 'message', 'follow', 'board_reply'
    timestamp = Column(DateTime, default=datetime.utcnow)
    is_read = Column(Integer, default=0) # 0 for unread, 1 for read
    
    user = relationship("User", back_populates="notifications")


class BoardPost(Base):
    __tablename__ = "board_posts"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(100), index=True)  # e.g., "Hackathon", "Side Project", "Research"
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    skills_required = Column(String(500), nullable=False) # Comma-separated skills
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    author = relationship("User", back_populates="board_posts")