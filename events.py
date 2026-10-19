# ==========================================
# 37. EVENTS (events.html, event.html, event-create.html, event-manage.html, event-checkin.html, my-events.html,
#     ticket.html, certificate-check.html, host.html, event-print.html)
# ==========================================
# Kept out of main.py (16,000 lines). main.py includes this router at its very end, so every helper imported below
# already exists. Times are stored as UTC ISO strings with seconds ("2026-10-20T04:30:00+00:00") and shown in India time.
# Descriptions are Markdown, rendered in the browser by markdown.js, which escapes everything first.
import asyncio
import base64
import csv
import hashlib
import hmac
import html
import io
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import HTMLResponse, Response, FileResponse
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, UniqueConstraint, select, update, delete, func, and_, or_, literal
from sqlalchemy.dialects.postgresql import insert as pg_insert

import main as core
from main import (
    Base, SessionLocal, AutocommitSession, DBUser, DBFollow, DBTeam, DBTeamMember, DBChannel, DBAdminScope, DBContentReport, DBStudySlot,
    get_current_user_id, optional_user_id, require_founder, college_key_of, clean_text, clean_link, fetch_one_off, run_one_off, run_returning,
    spawn_background, notify_many, notify_founders, claim_reminders, award_xp, utc_now_iso, site_now, limiter, account_rate_key,
    is_professional_account, college_licence, save_upload, upload_url, MAX_IMAGE_BYTES, SECRET_KEY, SITE_URL, API_URL,
    USER_DATA_ERASED, USER_DATA_KEPT, SCHEMA_UPGRADES, XP_RULES, PUSH_TITLES, EXTRA_REPORT_TARGETS, MINOR_ACCOUNTS, SITE_UTC_OFFSET,
    send_email, simple_email, notification_manager,
)

router = APIRouter()


# ---------- tables ----------
class DBEventHost(Base):
    """Who puts an event on: a department, club, college cell or company. Events can also be hosted by a person alone (host_id 0)."""
    __tablename__ = "event_hosts"
    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String, default="club")          # department, club, college, company
    name = Column(String)
    college_key = Column(String, default="", index=True)
    college_name = Column(String, default="")
    description = Column(String, default="")
    logo_url = Column(String, default="")
    banner_url = Column(String, default="")
    links = Column(String, default="[]")           # JSON list of http(s) links
    verified = Column(Integer, default=0)          # made or approved by a teacher, an admin or the founder
    status = Column(String, default="active")      # active, pending (a student asked; a teacher decides), rejected
    created_by = Column(Integer, index=True)
    decided_by = Column(Integer, nullable=True)
    created_at = Column(String)

class DBEventHostMember(Base):
    __tablename__ = "event_host_members"
    __table_args__ = (UniqueConstraint("host_id", "user_id", name="ux_event_host_members"),)
    id = Column(Integer, primary_key=True, index=True)
    host_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    role = Column(String, default="admin")         # admin: may post events as the host; member: shown on the host page
    created_at = Column(String)

class DBHostFollower(Base):
    __tablename__ = "host_followers"
    __table_args__ = (UniqueConstraint("host_id", "user_id", name="ux_host_followers"),)
    id = Column(Integer, primary_key=True, index=True)
    host_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    created_at = Column(String)

class DBEvent(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, index=True)
    host_id = Column(Integer, default=0, index=True)
    created_by = Column(Integer, index=True)
    college_key = Column(String, default="", index=True)   # the organiser's college: decides who approves and who "my college" means
    college_name = Column(String, default="")
    department = Column(String, default="")
    title = Column(String)
    tagline = Column(String, default="")
    kind = Column(String, default="other")
    tags = Column(String, default="")              # comma separated, at most 5
    description = Column(String, default="")       # Markdown
    poster_url = Column(String, default="")
    mode = Column(String, default="offline")       # offline, online, hybrid
    venue = Column(String, default="")
    address = Column(String, default="")
    room = Column(String, default="")
    map_link = Column(String, default="")
    city = Column(String, default="")
    online_link = Column(String, default="")       # shown only to confirmed registrants and staff
    group_link = Column(String, default="")        # WhatsApp or Discord, same rule
    start_at = Column(String, default="")
    end_at = Column(String, default="")
    reg_open_at = Column(String, default="")
    reg_close_at = Column(String, default="")
    cancel_cutoff_hours = Column(Integer, default=2)
    visibility = Column(String, default="college")  # public, college, department, link
    invite_code = Column(String, default="")
    eligibility = Column(String, default="{}")     # {"departments": [], "colleges": [], "verified_only": 0, "minors_ok": 1}
    capacity = Column(Integer, default=0)          # 0: no limit
    waitlist_on = Column(Integer, default=1)
    manual_approval = Column(Integer, default=0)
    walkins_on = Column(Integer, default=0)
    is_team_event = Column(Integer, default=0)
    team_min = Column(Integer, default=1)
    team_max = Column(Integer, default=4)
    collect_fields = Column(String, default="name,email,college,department")
    form_fields = Column(String, default="[]")     # custom questions: [{"key", "label", "type", "options", "required", "help"}]
    agenda = Column(String, default="[]")          # [{"key", "title", "start", "end", "room", "speaker", "details"}]
    speakers = Column(String, default="[]")        # [{"name", "role", "org", "photo", "bio", "link", "kind"}]
    faqs = Column(String, default="[]")            # [{"q", "a"}]
    sponsors = Column(String, default="[]")        # [{"name", "logo", "link", "tier"}]
    takes_photos = Column(Integer, default=0)
    contact_name = Column(String, default="")
    contact_phone = Column(String, default="")
    contact_email = Column(String, default="")
    certificates_on = Column(Integer, default=1)   # participation certificates for everyone checked in
    status = Column(String, default="draft")       # draft, pending, changes, published, rejected, cancelled, completed, archived, removed
    approval_steps = Column(String, default="[]")  # e.g. ["teacher", "college_admin"]; empty when the organiser may publish
    approval_index = Column(Integer, default=0)
    change_status = Column(String, default="")     # "" or "pending": a big edit of a published event waits for approval
    pending_changes = Column(String, default="{}")
    reviewer_note = Column(String, default="")
    featured = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    cancelled_reason = Column(String, default="")
    created_at = Column(String)
    updated_at = Column(String)
    submitted_at = Column(String, default="")
    published_at = Column(String, default="")
    completed_at = Column(String, default="")
    deleted_at = Column(String, default="")

class DBEventStaff(Base):
    __tablename__ = "event_staff"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="ux_event_staff"),)
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    role = Column(String, default="manager")       # owner, manager, volunteer, viewer
    added_by = Column(Integer, nullable=True)
    created_at = Column(String)

class DBEventRegistration(Base):
    __tablename__ = "event_registrations"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="ux_event_registrations"),)
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    status = Column(String, default="confirmed")   # pending, confirmed, waitlisted, rejected, cancelled, removed, no_show
    answers = Column(String, default="{}")         # custom question key -> answer
    profile = Column(String, default="{}")         # the profile fields the organiser asked for, as the person sent them
    consents = Column(String, default="{}")
    show_publicly = Column(Integer, default=0)     # in "who is going" (opt-in)
    looking_for_team = Column(Integer, default=0)
    team_id = Column(Integer, nullable=True, index=True)   # event_teams.id
    qr_version = Column(Integer, default=1)        # raised to make old ticket screenshots stop working
    ref_code = Column(String, default="")
    note = Column(String, default="")              # why an organiser added or moved this person by hand
    anonymised = Column(Integer, default=0)
    created_at = Column(String)
    updated_at = Column(String)
    confirmed_at = Column(String, default="")
    waitlisted_at = Column(String, default="")
    cancelled_at = Column(String, default="")

class DBEventTeam(Base):
    __tablename__ = "event_teams"
    __table_args__ = (UniqueConstraint("event_id", "name_key", name="ux_event_teams_name"),)
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    name = Column(String)
    name_key = Column(String)
    leader_id = Column(Integer, index=True)
    invite_code = Column(String, index=True)
    workspace_id = Column(Integer, nullable=True)  # the Team workspace (teams.id) made for it
    locked = Column(Integer, default=0)
    created_at = Column(String)

class DBEventCheckin(Base):
    __tablename__ = "event_checkins"
    __table_args__ = (UniqueConstraint("registration_id", "session_key", name="ux_event_checkins"),)
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    registration_id = Column(Integer, index=True)
    session_key = Column(String, default="")       # "" is the event itself; agenda keys for sessions
    checked_by = Column(Integer, nullable=True)
    checked_at = Column(String)
    method = Column(String, default="qr")          # qr, manual, walkin, offline

class DBEventAnnouncement(Base):
    __tablename__ = "event_announcements"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    author_id = Column(Integer, index=True)
    title = Column(String)
    body = Column(String, default="")
    audience = Column(String, default="all")       # all, confirmed, waitlisted, checked_in, not_checked_in, team:<id>
    channels = Column(String, default="bell,push")
    pinned = Column(Integer, default=0)
    send_at = Column(String, default="")
    sent_at = Column(String, default="")
    recipients = Column(Integer, default=0)
    created_at = Column(String)

class DBEventCertificate(Base):
    __tablename__ = "event_certificates"
    __table_args__ = (UniqueConstraint("event_id", "user_id", "kind", name="ux_event_certificates"),)
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    kind = Column(String, default="participation")
    code = Column(String, unique=True, index=True)
    holder_name = Column(String)                   # as it was on the day: a later name change does not alter a certificate
    issued_by = Column(Integer, nullable=True)
    issued_at = Column(String)
    revoked_at = Column(String, default="")
    on_profile = Column(Integer, default=0)        # the holder chooses to show it on their profile

class DBEventApproval(Base):
    __tablename__ = "event_approvals"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    step = Column(String)                          # submitted, teacher, college_admin, founder, changes (for edits of a published event)
    approver_id = Column(Integer, index=True)
    decision = Column(String)                      # submitted, approved, changes, rejected
    comment = Column(String, default="")
    created_at = Column(String)

class DBEventSave(Base):
    __tablename__ = "event_saves"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="ux_event_saves"),)
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    created_at = Column(String)

class DBEventAudit(Base):
    __tablename__ = "event_audit_log"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, index=True)
    actor_id = Column(Integer, index=True)
    action = Column(String)
    details = Column(String, default="{}")
    created_at = Column(String)

SCHEMA_UPGRADES.extend([
    "CREATE INDEX IF NOT EXISTS ix_events_status_start ON events (status, start_at)",
    "CREATE INDEX IF NOT EXISTS ix_event_registrations_event_status ON event_registrations (event_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_event_checkins_event_reg ON event_checkins (event_id, registration_id)",
])

# The person's own rows go when they delete their account; what they did for others (events, decisions, check-ins) stays.
USER_DATA_ERASED.update({"event_registrations": ("user_id",), "event_saves": ("user_id",), "host_followers": ("user_id",),
                         "event_staff": ("user_id",), "event_host_members": ("user_id",), "event_certificates": ("user_id",)})
USER_DATA_KEPT.update({"events": ("created_by",), "event_hosts": ("created_by", "decided_by"), "event_checkins": ("checked_by",),
                       "event_approvals": ("approver_id",), "event_audit_log": ("actor_id",), "event_announcements": ("author_id",),
                       "event_teams": ("leader_id",)})
for _registry in (USER_DATA_ERASED, USER_DATA_KEPT):
    for _table in ("event_registrations", "event_saves", "host_followers", "event_staff", "event_host_members", "event_certificates", "events",
                   "event_hosts", "event_checkins", "event_approvals", "event_audit_log", "event_announcements", "event_teams"):
        assert all(column in Base.metadata.tables[_table].c for column in _registry.get(_table, ()))

XP_RULES.update({"event_attend": ("Events attended", 20), "event_organise": ("Events organised", 50)})
PUSH_TITLES["event"] = "Events"


# ---------- rules and limits ----------
EVENT_KINDS = {
    "seminar": "Seminar", "workshop": "Workshop", "webinar": "Webinar", "hackathon": "Hackathon", "competition": "Competition",
    "fest": "Cultural / fest", "sports": "Sports", "guest_lecture": "Guest lecture", "placement": "Placement drive",
    "recruitment": "Club recruitment", "orientation": "Orientation", "conference": "Conference / paper presentation",
    "exhibition": "Exhibition", "training": "Training / bootcamp", "meetup": "Meetup", "quiz": "Quiz", "other": "Other",
}
EVENT_MODES = ("offline", "online", "hybrid")
VISIBILITIES = ("public", "college", "department", "link")
HOST_KINDS = ("department", "club", "college", "company")
PROFILE_FIELDS = {"name": "Name", "email": "Email", "phone": "Phone", "college": "College", "department": "Department",
                  "year": "Year of study", "roll_no": "Roll number", "skills": "Skills"}
QUESTION_TYPES = ("short", "long", "number", "dropdown", "multi", "radio", "checkbox", "date", "phone", "email", "url", "file")
LISTED_STATUSES = ("published", "completed", "archived", "cancelled")
LIVE_STATUSES = ("draft", "pending", "changes", "published")     # counted towards the active-event limit
ACTIVE_REG = ("pending", "confirmed", "waitlisted")
MAX_QUESTIONS = 20
MAX_TAGS = 5
EVENT_REPORTS_TO_HIDE = 3
STUDENT_ACTIVE_EVENTS = 2
FREE_ACTIVE_EVENTS = 3
FREE_REGISTRATIONS = 300
FREE_ANNOUNCEMENTS_DAILY, LICENCE_ANNOUNCEMENTS_DAILY = 3, 20
PRO_REVIEWED_EVENTS = 3            # a professional's first public events the founder reviews
APPROVAL_NUDGE_HOURS, APPROVAL_ESCALATE_DAYS = 48, 5
CHECKIN_OPENS_MINUTES = 60
ANONYMISE_AFTER_DAYS = 730
ARCHIVE_AFTER_DAYS = 90
EVENT_WATCH_SECONDS = 60
ANSWER_FILE_DIR = os.path.join("private_uploads", "event_files")
ANSWER_FILE_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
STAFF_ROLES = ("owner", "manager", "volunteer", "viewer")
MANAGERS = ("owner", "manager")
# Edits that change what people signed up for. Made by someone who needs approval, they wait for it on a published event.
MAJOR_FIELDS = ("title", "kind", "start_at", "end_at", "mode", "venue", "address", "room", "city", "visibility", "eligibility", "host_id")
SCAM_WARNING = "Never pay money to an organiser you do not know. Connect2Minds events in this version are always free."

UTC = timezone.utc
SITE_TZ = timezone(timedelta(minutes=SITE_UTC_OFFSET))


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).replace(microsecond=0).isoformat()

def now_iso() -> str:
    return iso(datetime.now(UTC))

def parse_moment(value: str) -> Optional[datetime]:
    """'2026-10-20T10:00' (India time, from a datetime-local field) or a full ISO string with its offset."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="That date and time is not valid.")
    return moment if moment.tzinfo else moment.replace(tzinfo=SITE_TZ)

def when(value: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None

def local_label(value: str) -> str:
    moment = when(value)
    return moment.astimezone(SITE_TZ).strftime("%a %d %b %Y, %I:%M %p").replace(" 0", " ") if moment else ""

def jload(raw, fallback):
    try:
        value = json.loads(raw or "")
        return value if isinstance(value, type(fallback)) else fallback
    except (TypeError, ValueError):
        return fallback

def slugify(title: str, event_id: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (title or "event").lower()).strip("-")[:60].strip("-") or "event"
    return f"{base}-{event_id}"

def id_from_slug(slug: str) -> int:
    match = re.search(r"(\d+)$", slug or "")
    if not match:
        raise HTTPException(status_code=404, detail="Event not found.")
    return int(match.group(1))

def notify(user_ids, content: str, link: str):
    """Bell (and push for people without the site open) for each person, in the background."""
    ids = [uid for uid in dict.fromkeys(user_ids) if uid]
    if ids:
        spawn_background(notify_many(ids, "event", content[:300], link))

async def email_people(user_ids, subject: str, lines: list, link: str):
    """Important changes (cancelled, moved) also go by email when email is set up. Never raises."""
    try:
        if not core.EMAIL_READY or not user_ids:
            return
        rows = await fetch_one_off(select(DBUser.id, DBUser.email, DBUser.name).where(DBUser.id.in_(list(user_ids))))
        for _, email, name in rows:
            if email:
                plain, page = simple_email(f"Hello {(name or '').split(' ')[0] or 'there'},", lines, ("Open the event", f"{SITE_URL}/{link}"),
                                           "You get this because you registered for this event on Connect2Minds.")
                await send_email(email, subject, plain, page)
    except Exception as e:
        print("Error emailing event registrants:", e)

async def audit(event_id: int, actor_id: int, action: str, details: Optional[dict] = None):
    try:
        await run_one_off(DBEventAudit.__table__.insert().values(event_id=event_id, actor_id=actor_id or 0, action=action,
                                                                  details=json.dumps(details or {})[:4000], created_at=now_iso()))
    except Exception as e:
        print("Error writing the event audit log:", e)


# ---------- who is asking ----------
async def actor_of(user_id: Optional[int]) -> dict:
    """Everything the event rules need about a person, from two small reads. A visitor (None) gets an empty actor."""
    if not user_id:
        return {"id": 0, "founder": False, "teacher_key": "", "admin_colleges": set(), "verified": False, "professional": False,
                "college_key": "", "college": "", "department": "", "name": "", "minor": False, "skills": "", "logged_in": False}
    rows, scopes = await asyncio.gather(
        fetch_one_off(select(DBUser.name, DBUser.college_name, DBUser.department, DBUser.teacher_of, DBUser.is_founder, DBUser.account_status,
                             DBUser.account_type, DBUser.profession, DBUser.skills, DBUser.email, DBUser.roll_no).where(DBUser.id == user_id)),
        fetch_one_off(select(DBAdminScope.college_key).where(DBAdminScope.user_id == user_id)),
    )
    if not rows:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    r = rows[0]
    teacher_key = (r.teacher_of or "").strip()
    return {"id": user_id, "name": r.name or "", "founder": (r.is_founder or 0) == 1, "teacher_key": teacher_key,
            "admin_colleges": {c for (c,) in scopes if c}, "verified": r.account_status == "verified",
            "professional": not teacher_key and is_professional_account(r.account_type, r.profession),
            "college_key": teacher_key or college_key_of(r.college_name), "college": (r.college_name or "").strip(),
            "department": (r.department or "").strip(), "minor": user_id in MINOR_ACCOUNTS, "skills": r.skills or "",
            "email": r.email or "", "roll_no": r.roll_no or "", "logged_in": True}

def college_trusted(actor: dict, college_key: str) -> bool:
    """A teacher or a scoped admin of this college (or the founder): may publish there and approve there."""
    return actor["founder"] or (bool(college_key) and (actor["teacher_key"] == college_key or college_key in actor["admin_colleges"]))

def can_create(actor: dict) -> bool:
    return actor["founder"] or bool(actor["teacher_key"]) or bool(actor["admin_colleges"]) or actor["professional"] or actor["verified"]

def cannot_create_reason(actor: dict) -> str:
    if not actor["logged_in"]:
        return "Log in to create an event."
    return "Only verified students, teachers, admins and professionals can create events. Get your student ID verified first (your profile shows how)."

async def approval_steps_for(actor: dict, visibility: str, college_key: str) -> list:
    """The approvals an event needs before it goes live. Empty: the organiser publishes it themselves."""
    if college_trusted(actor, college_key):
        return []
    if actor["professional"]:
        published = await fetch_one_off(select(func.count()).select_from(DBEvent).where(
            DBEvent.created_by == actor["id"], DBEvent.visibility == "public", DBEvent.status.in_(("published", "completed", "archived"))))
        return ["founder"] if (published[0][0] or 0) < PRO_REVIEWED_EVENTS else []
    steps = ["teacher"]
    if visibility == "public":
        steps.append("college_admin")
    return steps

def can_approve_step(actor: dict, step: str, college_key: str) -> bool:
    if actor["founder"]:
        return True
    if step == "teacher":
        return bool(college_key) and actor["teacher_key"] == college_key
    if step == "college_admin":
        return bool(college_key) and college_key in actor["admin_colleges"]
    return False

async def staff_role(event_id: int, user_id: Optional[int]) -> str:
    if not user_id:
        return ""
    rows = await fetch_one_off(select(DBEventStaff.role).where(DBEventStaff.event_id == event_id, DBEventStaff.user_id == user_id))
    return rows[0][0] if rows else ""

async def load_event(event_id: int) -> DBEvent:
    rows = await fetch_one_off(select(DBEvent).where(DBEvent.id == event_id, DBEvent.deleted_at == ""))
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found.")
    return rows[0][0]

async def require_staff(event_id: int, user_id: int, roles=MANAGERS) -> tuple:
    """(event, role, actor) when the person is staff in one of the roles; the founder counts as a manager everywhere."""
    event, role, actor = await asyncio.gather(load_event(event_id), staff_role(event_id, user_id), actor_of(user_id))
    if role in roles:
        return event, role, actor
    if actor["founder"] and ("manager" in roles or "owner" in roles):
        return event, "manager", actor
    raise HTTPException(status_code=403, detail="Only the organisers of this event can do this.")

def open_reports_count():
    return (select(func.count()).select_from(DBContentReport)
            .where(DBContentReport.target_kind == "event", DBContentReport.target_id == DBEvent.id, DBContentReport.status.in_(("open", "reviewing")))
            .correlate(DBEvent).scalar_subquery())

def audience_clause(actor: dict):
    """Listed events this person may see: public ones, their college's, their department's. Link-only events are never listed."""
    clauses = [DBEvent.visibility == "public"]
    if actor["college_key"]:
        clauses.append(and_(DBEvent.visibility == "college", DBEvent.college_key == actor["college_key"]))
        if actor["teacher_key"]:
            clauses.append(and_(DBEvent.visibility == "department", DBEvent.college_key == actor["college_key"]))
        elif actor["department"]:
            clauses.append(and_(DBEvent.visibility == "department", DBEvent.college_key == actor["college_key"],
                                func.lower(DBEvent.department) == actor["department"].lower()))
    for key in actor["admin_colleges"]:
        clauses.append(and_(DBEvent.visibility.in_(("college", "department")), DBEvent.college_key == key))
    return or_(*clauses)

def listed_clause(actor: dict):
    base = and_(DBEvent.deleted_at == "", DBEvent.status.in_(LISTED_STATUSES), open_reports_count() < EVENT_REPORTS_TO_HIDE)
    return base if actor["founder"] else and_(base, audience_clause(actor))

async def may_view(event: DBEvent, actor: dict, code: str = "") -> bool:
    """Can this person open the event page? Staff and approvers always; others when it is listed for them or they hold the link."""
    if actor["founder"] or (actor["id"] and await staff_role(event.id, actor["id"])):
        return True
    if event.status in ("pending", "changes") or event.change_status == "pending":
        steps = jload(event.approval_steps, [])
        if any(can_approve_step(actor, step, event.college_key) for step in steps) and event.status == "pending":
            return True
    if event.status not in LISTED_STATUSES:
        return False
    hidden = await fetch_one_off(select(func.count()).select_from(DBContentReport).where(
        DBContentReport.target_kind == "event", DBContentReport.target_id == event.id, DBContentReport.status.in_(("open", "reviewing"))))
    if (hidden[0][0] or 0) >= EVENT_REPORTS_TO_HIDE:
        return False
    if actor["id"]:
        mine = await fetch_one_off(select(DBEventRegistration.id).where(DBEventRegistration.event_id == event.id, DBEventRegistration.user_id == actor["id"]))
        if mine:
            return True
    if event.visibility == "public":
        return True
    if event.visibility == "link":
        return bool(code) and hmac.compare_digest(code, event.invite_code or "")
    if not actor["college_key"] or actor["college_key"] != event.college_key:
        return event.college_key in actor["admin_colleges"]
    if event.visibility == "department" and not actor["teacher_key"]:
        return (actor["department"] or "").lower() == (event.department or "").lower()
    return True


# ---------- what the browser gets ----------
def display_status(event: DBEvent, confirmed: int = 0) -> str:
    """The badge people see: Draft, In review, Open, Almost full, Full, Closed, Live, Completed, Cancelled..."""
    if event.status != "published":
        return {"draft": "Draft", "pending": "In review", "changes": "Changes requested", "rejected": "Rejected", "cancelled": "Cancelled",
                "completed": "Completed", "archived": "Completed", "removed": "Removed"}.get(event.status, event.status.title())
    now = now_iso()
    if event.start_at and event.start_at <= now <= (event.end_at or event.start_at):
        return "Live"
    if event.reg_open_at and now < event.reg_open_at:
        return "Opens soon"
    if event.reg_close_at and now > event.reg_close_at:
        return "Closed"
    if event.capacity and confirmed >= event.capacity:
        return "Full" if not event.waitlist_on else "Waitlist"
    if event.capacity and confirmed >= 0.9 * event.capacity:
        return "Almost full"
    return "Open"

def event_card(event: DBEvent, host: Optional[dict] = None, confirmed: int = 0, saved: bool = False, mine: str = "") -> dict:
    return {"id": event.id, "slug": event.slug, "title": event.title, "tagline": event.tagline or "", "kind": event.kind,
            "kind_label": EVENT_KINDS.get(event.kind, "Other"), "tags": [t for t in (event.tags or "").split(",") if t],
            "poster_url": event.poster_url or "", "mode": event.mode, "venue": event.venue or "", "city": event.city or "",
            "start_at": event.start_at or "", "end_at": event.end_at or "", "reg_close_at": event.reg_close_at or "",
            "visibility": event.visibility, "college_name": event.college_name or "", "department": event.department or "",
            "capacity": event.capacity or 0, "confirmed": confirmed, "seats_left": max(0, (event.capacity or 0) - confirmed) if event.capacity else None,
            "status": event.status, "display_status": display_status(event, confirmed), "featured": bool(event.featured),
            "host": host or {"id": 0, "name": "", "kind": "individual", "verified": False}, "saved": saved, "my_status": mine,
            "is_team_event": bool(event.is_team_event), "price": 0}

async def hosts_by_id(host_ids) -> dict:
    ids = [h for h in set(host_ids) if h]
    if not ids:
        return {}
    rows = await fetch_one_off(select(DBEventHost.id, DBEventHost.name, DBEventHost.kind, DBEventHost.verified, DBEventHost.logo_url).where(DBEventHost.id.in_(ids)))
    return {r.id: {"id": r.id, "name": r.name, "kind": r.kind, "verified": bool(r.verified), "logo_url": r.logo_url or ""} for r in rows}

async def people_by_id(user_ids) -> dict:
    ids = [u for u in set(user_ids) if u]
    if not ids:
        return {}
    rows = await fetch_one_off(select(DBUser.id, DBUser.name, DBUser.profile_pic, DBUser.college_name, DBUser.account_status).where(DBUser.id.in_(ids)))
    return {r.id: {"id": r.id, "name": r.name or "Deleted user", "profile_pic": r.profile_pic or "", "college_name": r.college_name or "",
                   "verified": r.account_status == "verified"} for r in rows}

async def confirmed_counts(event_ids) -> dict:
    ids = list(set(event_ids))
    if not ids:
        return {}
    rows = await fetch_one_off(select(DBEventRegistration.event_id, func.count()).where(
        DBEventRegistration.event_id.in_(ids), DBEventRegistration.status == "confirmed").group_by(DBEventRegistration.event_id))
    return dict(rows)

async def host_label(event: DBEvent, hosts: dict, people: dict) -> dict:
    if event.host_id and event.host_id in hosts:
        return hosts[event.host_id]
    person = people.get(event.created_by) or {"name": "An organiser", "verified": False}
    return {"id": 0, "name": person["name"], "kind": "individual", "verified": person.get("verified", False), "user_id": event.created_by}

async def cards_for(events: list, actor: dict) -> list:
    if not events:
        return []
    ids = [e.id for e in events]
    hosts, people, counts = await asyncio.gather(hosts_by_id([e.host_id for e in events]), people_by_id([e.created_by for e in events]), confirmed_counts(ids))
    saved, mine = set(), {}
    if actor["id"]:
        save_rows, reg_rows = await asyncio.gather(
            fetch_one_off(select(DBEventSave.event_id).where(DBEventSave.user_id == actor["id"], DBEventSave.event_id.in_(ids))),
            fetch_one_off(select(DBEventRegistration.event_id, DBEventRegistration.status).where(DBEventRegistration.user_id == actor["id"], DBEventRegistration.event_id.in_(ids))))
        saved = {r[0] for r in save_rows}
        mine = dict(reg_rows)
    return [event_card(e, await host_label(e, hosts, people), counts.get(e.id, 0), e.id in saved, mine.get(e.id, "")) for e in events]


# ---------- cleaning what organisers send ----------
class EventBody(BaseModel):
    updated_at: Optional[str] = None
    host_id: Optional[int] = None
    title: Optional[str] = None
    tagline: Optional[str] = None
    kind: Optional[str] = None
    tags: Optional[List[str]] = None
    description: Optional[str] = None
    poster_url: Optional[str] = None
    mode: Optional[str] = None
    venue: Optional[str] = None
    address: Optional[str] = None
    room: Optional[str] = None
    map_link: Optional[str] = None
    city: Optional[str] = None
    online_link: Optional[str] = None
    group_link: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    reg_open_at: Optional[str] = None
    reg_close_at: Optional[str] = None
    cancel_cutoff_hours: Optional[int] = None
    visibility: Optional[str] = None
    department: Optional[str] = None
    eligibility: Optional[dict] = None
    capacity: Optional[int] = None
    waitlist_on: Optional[bool] = None
    manual_approval: Optional[bool] = None
    walkins_on: Optional[bool] = None
    is_team_event: Optional[bool] = None
    team_min: Optional[int] = None
    team_max: Optional[int] = None
    collect_fields: Optional[List[str]] = None
    form_fields: Optional[list] = None
    agenda: Optional[list] = None
    speakers: Optional[list] = None
    faqs: Optional[list] = None
    sponsors: Optional[list] = None
    takes_photos: Optional[bool] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    certificates_on: Optional[bool] = None

def short_list(items, limit: int, keys: dict) -> str:
    """A JSON list of small dicts, each value cut to its limit. keys: name -> max length (0: boolean, -1: link)."""
    out = []
    for item in (items or [])[:limit]:
        if not isinstance(item, dict):
            continue
        row = {}
        for key, size in keys.items():
            value = item.get(key)
            if size == 0:
                row[key] = bool(value)
            elif size == -1:
                row[key] = clean_link(str(value or ""), "link")
            elif isinstance(value, list):
                row[key] = [str(v)[:120] for v in value[:30] if str(v).strip()]
            else:
                row[key] = str(value or "").strip()[:size]
        out.append(row)
    return json.dumps(out)

def clean_questions(fields) -> str:
    cleaned, keys = [], set()
    for index, field in enumerate((fields or [])[:MAX_QUESTIONS + 1]):
        if not isinstance(field, dict):
            continue
        if index >= MAX_QUESTIONS:
            raise HTTPException(status_code=400, detail=f"A form can have at most {MAX_QUESTIONS} questions.")
        label = str(field.get("label") or "").strip()[:200]
        if not label:
            raise HTTPException(status_code=400, detail=f"Question {index + 1} needs a question.")
        kind = field.get("type") if field.get("type") in QUESTION_TYPES else "short"
        options = [str(o).strip()[:120] for o in (field.get("options") or [])[:30] if str(o).strip()]
        if kind in ("dropdown", "multi", "radio") and len(options) < 2:
            raise HTTPException(status_code=400, detail=f"Question {index + 1} ({label}) needs at least two choices.")
        key = re.sub(r"[^a-z0-9_]", "", str(field.get("key") or "")) or f"q{secrets.token_hex(3)}"
        while key in keys:
            key = f"q{secrets.token_hex(3)}"
        keys.add(key)
        cleaned.append({"key": key, "label": label, "type": kind, "options": options, "required": bool(field.get("required")),
                        "help": str(field.get("help") or "").strip()[:300]})
    return json.dumps(cleaned)

def clean_eligibility(value) -> str:
    value = value if isinstance(value, dict) else {}
    departments = [str(d).strip()[:120] for d in (value.get("departments") or [])[:30] if str(d).strip()]
    colleges = [str(c).strip()[:150] for c in (value.get("colleges") or [])[:30] if str(c).strip()]
    return json.dumps({"departments": departments, "colleges": colleges, "verified_only": bool(value.get("verified_only")),
                       "minors_ok": value.get("minors_ok") is not False})

async def clean_event_values(body: EventBody, actor: dict, event: Optional[DBEvent]) -> dict:
    """Checks and tidies every field that was sent. Returns the column values to write."""
    v = {}
    if body.title is not None:
        v["title"] = clean_text(body.title, 100, "title")
    if body.tagline is not None:
        v["tagline"] = clean_text(body.tagline, 140, "tagline")
    if body.kind is not None:
        if body.kind not in EVENT_KINDS:
            raise HTTPException(status_code=400, detail="Pick an event type from the list.")
        v["kind"] = body.kind
    if body.tags is not None:
        tags = [re.sub(r"[,\s]+", " ", str(t)).strip()[:24] for t in body.tags if str(t).strip()]
        if len(tags) > MAX_TAGS:
            raise HTTPException(status_code=400, detail=f"Use at most {MAX_TAGS} tags.")
        v["tags"] = ",".join(dict.fromkeys(tags))
    if body.description is not None:
        v["description"] = clean_text(body.description, 5000, "description")
    if body.poster_url is not None:
        poster = body.poster_url.strip()
        if poster and not re.search(r"/static/uploads/events/poster_\d+_[0-9a-f]+\.(jpg|jpeg|png|webp)$", poster):
            raise HTTPException(status_code=400, detail="Upload the poster with the poster button.")
        v["poster_url"] = poster
    if body.mode is not None:
        if body.mode not in EVENT_MODES:
            raise HTTPException(status_code=400, detail="Mode must be offline, online or hybrid.")
        v["mode"] = body.mode
    for field, limit in (("venue", 150), ("address", 300), ("room", 80), ("city", 80), ("contact_name", 80), ("contact_phone", 20), ("department", 120)):
        value = getattr(body, field)
        if value is not None:
            v[field] = clean_text(value, limit, field.replace("_", " "))
    if body.contact_email is not None:
        email = body.contact_email.strip()[:200]
        if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status_code=400, detail="The contact email is not valid.")
        v["contact_email"] = email
    if body.contact_phone:
        if not re.match(r"^[+0-9 ()-]{6,20}$", v["contact_phone"]):
            raise HTTPException(status_code=400, detail="The contact phone can only have digits, spaces and + ( ) -.")
    for field, what in (("map_link", "map link"), ("online_link", "online link"), ("group_link", "group link")):
        value = getattr(body, field)
        if value is not None:
            v[field] = clean_link(value, what)
    for field in ("start_at", "end_at", "reg_open_at", "reg_close_at"):
        value = getattr(body, field)
        if value is not None:
            moment = parse_moment(value)
            v[field] = iso(moment) if moment else ""
    if body.cancel_cutoff_hours is not None:
        v["cancel_cutoff_hours"] = max(0, min(int(body.cancel_cutoff_hours), 720))
    if body.visibility is not None:
        if body.visibility not in VISIBILITIES:
            raise HTTPException(status_code=400, detail="Pick who can see the event.")
        if actor["professional"] and body.visibility in ("college", "department") and not actor["college_key"]:
            raise HTTPException(status_code=400, detail="Events by companies and professionals are public or invite-link only.")
        v["visibility"] = body.visibility
    if body.eligibility is not None:
        v["eligibility"] = clean_eligibility(body.eligibility)
    if body.capacity is not None:
        v["capacity"] = max(0, min(int(body.capacity), 100000))
    for field in ("waitlist_on", "manual_approval", "walkins_on", "is_team_event", "takes_photos", "certificates_on"):
        value = getattr(body, field)
        if value is not None:
            v[field] = 1 if value else 0
    if body.team_min is not None:
        v["team_min"] = max(1, min(int(body.team_min), 20))
    if body.team_max is not None:
        v["team_max"] = max(1, min(int(body.team_max), 20))
    if body.collect_fields is not None:
        v["collect_fields"] = ",".join(f for f in PROFILE_FIELDS if f in body.collect_fields or f == "name")
    if body.form_fields is not None:
        v["form_fields"] = clean_questions(body.form_fields)
    if body.agenda is not None:
        agenda = jload(short_list(body.agenda, 40, {"key": 12, "title": 150, "start": 30, "end": 30, "room": 80, "speaker": 120, "details": 500}), [])
        for item in agenda:
            item["key"] = re.sub(r"[^a-z0-9]", "", item["key"]) or f"s{secrets.token_hex(3)}"
            for edge in ("start", "end"):
                moment = parse_moment(item[edge]) if item[edge] else None
                item[edge] = iso(moment) if moment else ""
        v["agenda"] = json.dumps([item for item in agenda if item["title"]])
    if body.speakers is not None:
        v["speakers"] = short_list(body.speakers, 30, {"name": 100, "role": 120, "org": 120, "photo": -1, "bio": 600, "link": -1, "kind": 20})
    if body.faqs is not None:
        v["faqs"] = short_list(body.faqs, 30, {"q": 200, "a": 1000})
    if body.sponsors is not None:
        v["sponsors"] = short_list(body.sponsors, 20, {"name": 100, "logo": -1, "link": -1, "tier": 40})
    if body.host_id is not None:
        if body.host_id:
            member = await fetch_one_off(select(DBEventHostMember.role).join(DBEventHost, DBEventHost.id == DBEventHostMember.host_id).where(
                DBEventHostMember.host_id == body.host_id, DBEventHostMember.user_id == actor["id"], DBEventHostMember.role == "admin",
                DBEventHost.status == "active"))
            if not member and not actor["founder"]:
                raise HTTPException(status_code=403, detail="You can only post as a host you manage.")
        v["host_id"] = body.host_id or 0

    # Checks that look at several fields together, using what is already saved for anything not sent
    merged = {c: getattr(event, c) for c in ("start_at", "end_at", "reg_open_at", "reg_close_at", "team_min", "team_max", "visibility", "mode")} if event else {}
    merged.update({k: v[k] for k in v if k in ("start_at", "end_at", "reg_open_at", "reg_close_at", "team_min", "team_max", "visibility", "mode")})
    if merged.get("start_at") and merged.get("end_at") and merged["end_at"] <= merged["start_at"]:
        raise HTTPException(status_code=400, detail="The event must end after it starts.")
    if merged.get("reg_close_at") and merged.get("reg_open_at") and merged["reg_close_at"] <= merged["reg_open_at"]:
        raise HTTPException(status_code=400, detail="Registration must close after it opens.")
    if merged.get("reg_close_at") and merged.get("end_at") and merged["reg_close_at"] > merged["end_at"]:
        raise HTTPException(status_code=400, detail="Registration cannot close after the event ends.")
    if (merged.get("team_min") or 1) > (merged.get("team_max") or 1):
        raise HTTPException(status_code=400, detail="The smallest team size cannot be more than the largest.")
    return v

def missing_for_submit(event: DBEvent) -> list:
    """What still has to be filled in before an event can be submitted or published (the review checklist)."""
    missing = []
    if len((event.title or "").strip()) < 5:
        missing.append("A title of at least 5 characters")
    if len((event.description or "").strip()) < 20:
        missing.append("A description of at least 20 characters")
    if not event.start_at or not event.end_at:
        missing.append("A start and end time")
    elif event.end_at <= now_iso():
        missing.append("An end time in the future")
    if event.mode in ("offline", "hybrid") and not (event.venue or "").strip():
        missing.append("A venue")
    if event.mode in ("online", "hybrid") and not (event.online_link or "").strip():
        missing.append("The online meeting link")
    if event.visibility == "department" and not (event.department or "").strip():
        missing.append("The department the event is for")
    return missing

def apply_defaults(values: dict, actor: dict):
    """Sensible registration times when the organiser left them empty: open now, close an hour before the start."""
    start = when(values.get("start_at", ""))
    if start and not values.get("reg_close_at"):
        values["reg_close_at"] = iso(start - timedelta(hours=1))
        if values["reg_close_at"] <= now_iso():
            values["reg_close_at"] = values["start_at"]
    if not values.get("reg_open_at"):
        values["reg_open_at"] = now_iso()


# ---------- templates ----------
def q(label, kind="short", required=False, options=None, help_=""):
    return {"key": "", "label": label, "type": kind, "required": required, "options": options or [], "help": help_}

EVENT_TEMPLATES = {
    "seminar": {"label": "Seminar", "hours": 2, "values": {"kind": "seminar", "capacity": 120, "collect_fields": ["name", "email", "college", "department", "year"],
                "description": "## What it is about\n\n## Who should attend\n\n## Speaker\n", "form_fields": [q("Any question for the speaker?", "long")]}},
    "workshop": {"label": "Workshop", "hours": 3, "values": {"kind": "workshop", "capacity": 40, "collect_fields": ["name", "email", "college", "department", "year"],
                 "description": "## What you will learn\n\n## What to bring\n- A laptop\n\n## Prerequisites\n",
                 "form_fields": [q("Your experience with the topic", "radio", True, ["None", "Beginner", "Intermediate", "Advanced"]), q("Will you bring a laptop?", "radio", True, ["Yes", "No"])]}},
    "hackathon": {"label": "Hackathon", "hours": 24, "values": {"kind": "hackathon", "capacity": 200, "is_team_event": True, "team_min": 2, "team_max": 4,
                  "collect_fields": ["name", "email", "phone", "college", "department", "year", "skills"],
                  "description": "## The challenge\n\n## Rules\n\n## Prizes\n\n## Judging criteria\n\n## Timeline\n",
                  "form_fields": [q("GitHub profile", "url"), q("T-shirt size", "dropdown", False, ["S", "M", "L", "XL", "XXL"]), q("Dietary needs", "short")]}},
    "competition": {"label": "Competition", "hours": 3, "values": {"kind": "competition", "capacity": 100, "collect_fields": ["name", "email", "college", "department", "year"],
                    "description": "## The competition\n\n## Rules\n\n## Prizes\n", "form_fields": []}},
    "fest": {"label": "Fest", "hours": 8, "values": {"kind": "fest", "capacity": 0, "visibility": "public", "takes_photos": True,
             "collect_fields": ["name", "email", "college"], "description": "## What is happening\n\n## Schedule\n\n## Food and passes\n", "form_fields": []}},
    "guest_lecture": {"label": "Guest lecture", "hours": 1.5, "values": {"kind": "guest_lecture", "capacity": 150, "collect_fields": ["name", "email", "department", "year"],
                      "description": "## About the guest\n\n## Topic\n", "form_fields": [q("A question for the guest", "long")]}},
    "placement": {"label": "Placement drive", "hours": 6, "values": {"kind": "placement", "capacity": 0, "manual_approval": True,
                  "collect_fields": ["name", "email", "phone", "college", "department", "year", "roll_no", "skills"],
                  "description": "## About the company\n\n## Roles\n\n## Eligibility\n\n## Rounds\n",
                  "form_fields": [q("CGPA", "number", True), q("Active backlogs", "number", True), q("Resume (PDF)", "file", True)]}},
    "recruitment": {"label": "Club recruitment", "hours": 2, "values": {"kind": "recruitment", "capacity": 0, "manual_approval": True,
                    "collect_fields": ["name", "email", "phone", "department", "year"], "description": "## About the club\n\n## Roles we need\n\n## How selection works\n",
                    "form_fields": [q("Which role do you want?", "dropdown", True, ["Technical", "Design", "Events", "Marketing"]), q("Why do you want to join?", "long", True)]}},
}


# ---------- serialising one event ----------
async def event_detail(event: DBEvent, actor: dict, role: str) -> dict:
    hosts, people, counts = await asyncio.gather(hosts_by_id([event.host_id]), people_by_id([event.created_by]), confirmed_counts([event.id]))
    confirmed = counts.get(event.id, 0)
    card = event_card(event, await host_label(event, hosts, people), confirmed)
    registration = None
    if actor["id"]:
        rows = await fetch_one_off(select(DBEventRegistration).where(DBEventRegistration.event_id == event.id, DBEventRegistration.user_id == actor["id"]))
        registration = rows[0][0] if rows else None
        saved = await fetch_one_off(select(DBEventSave.id).where(DBEventSave.event_id == event.id, DBEventSave.user_id == actor["id"]))
        card["saved"] = bool(saved)
    is_staff = bool(role) or actor["founder"]
    confirmed_me = registration is not None and registration.status == "confirmed"
    waitlisted, going = await asyncio.gather(
        fetch_one_off(select(func.count()).select_from(DBEventRegistration).where(DBEventRegistration.event_id == event.id, DBEventRegistration.status == "waitlisted")),
        who_is_going(event, actor))
    detail = dict(card)
    detail.update({
        "description": event.description or "", "address": event.address or "", "room": event.room or "", "map_link": event.map_link or "",
        "reg_open_at": event.reg_open_at or "", "cancel_cutoff_hours": event.cancel_cutoff_hours or 0, "eligibility": jload(event.eligibility, {}),
        "waitlist_on": bool(event.waitlist_on), "manual_approval": bool(event.manual_approval), "walkins_on": bool(event.walkins_on),
        "team_min": event.team_min or 1, "team_max": event.team_max or 1, "collect_fields": [f for f in (event.collect_fields or "").split(",") if f],
        "form_fields": jload(event.form_fields, []), "agenda": jload(event.agenda, []), "speakers": jload(event.speakers, []),
        "faqs": jload(event.faqs, []), "sponsors": jload(event.sponsors, []), "takes_photos": bool(event.takes_photos),
        "certificates_on": bool(event.certificates_on), "waitlisted": waitlisted[0][0] or 0, "going": going,
        "share_url": f"{API_URL}/e/{event.slug}", "page_url": f"{SITE_URL}/event.html?id={event.id}",
        "online_link": event.online_link if (confirmed_me or is_staff) else "", "group_link": event.group_link if (confirmed_me or is_staff) else "",
        "has_online_link": bool(event.online_link),
        "contact": {"name": event.contact_name, "phone": event.contact_phone, "email": event.contact_email} if (registration or is_staff) else None,
        "scam_warning": SCAM_WARNING if not (card["host"].get("verified")) else "",
        "registration": registration_dict(registration) if registration else None,
        "eligible": eligibility_problem(event, actor) if actor["id"] else "Log in to register.",
        "my_role": role or ("manager" if actor["founder"] else ""), "cancelled_reason": event.cancelled_reason or "",
        "published_at": event.published_at or "", "completed_at": event.completed_at or "",
        "announcements": await announcements_for(event, registration, is_staff),
    })
    if is_staff:
        detail.update({"invite_code": event.invite_code, "approval_steps": jload(event.approval_steps, []), "approval_index": event.approval_index or 0,
                       "change_status": event.change_status or "", "pending_changes": jload(event.pending_changes, {}),
                       "reviewer_note": event.reviewer_note or "", "updated_at": event.updated_at, "created_by": event.created_by,
                       "missing": missing_for_submit(event), "host_id": event.host_id or 0})
    return detail

def registration_dict(reg) -> dict:
    return {"id": reg.id, "status": reg.status, "team_id": reg.team_id, "created_at": reg.created_at, "show_publicly": bool(reg.show_publicly),
            "looking_for_team": bool(reg.looking_for_team), "answers": jload(reg.answers, {}), "profile": jload(reg.profile, {})}

async def who_is_going(event: DBEvent, actor: dict) -> dict:
    """The count for everyone; names only of people who said they may be shown: those the viewer follows first."""
    rows = await fetch_one_off(select(DBEventRegistration.user_id, DBEventRegistration.show_publicly).where(
        DBEventRegistration.event_id == event.id, DBEventRegistration.status == "confirmed"))
    count = len(rows)
    shown = [uid for uid, show in rows if show]
    followed = set()
    if actor["id"] and shown:
        follow_rows = await fetch_one_off(select(DBFollow.followed_id).where(DBFollow.follower_id == actor["id"], DBFollow.followed_id.in_(shown)))
        followed = {r[0] for r in follow_rows}
    people = await people_by_id(sorted(shown, key=lambda uid: (uid not in followed, uid))[:12])
    faces = [dict(people[uid], followed=uid in followed) for uid in sorted(people, key=lambda uid: (uid not in followed, uid))]
    same_college = 0
    if actor["college_key"] and shown:
        same = await fetch_one_off(select(func.count()).select_from(DBUser).where(DBUser.id.in_(shown), func.lower(func.trim(func.coalesce(DBUser.college_name, ""))) == actor["college_key"]))
        same_college = same[0][0] or 0
    return {"count": count, "people": faces, "following": len(followed), "same_college": same_college}

def eligibility_problem(event: DBEvent, actor: dict) -> str:
    """'' when the person may register, else the exact reason shown on the button."""
    rules = jload(event.eligibility, {})
    if actor["minor"] and rules.get("minors_ok") is False:
        return "This event is for people aged 18 and over."
    if rules.get("verified_only") and not (actor["verified"] or actor["teacher_key"] or actor["founder"]):
        return "Only verified students can register. Get your student ID verified first."
    colleges = [college_key_of(c) for c in rules.get("colleges") or []]
    if colleges and actor["college_key"] not in colleges and not actor["founder"]:
        return "Only for students of " + ", ".join(rules["colleges"][:3]) + ("..." if len(rules["colleges"]) > 3 else "") + "."
    departments = [d.lower() for d in rules.get("departments") or []]
    if departments and (actor["department"] or "").lower() not in departments and not actor["teacher_key"] and not actor["founder"]:
        return "Only for " + ", ".join(rules["departments"][:3]) + ("..." if len(rules["departments"]) > 3 else "") + "."
    return ""

async def announcements_for(event: DBEvent, registration, is_staff: bool) -> list:
    """Sent announcements a registrant may see on the page (pinned first). Staff see scheduled ones too."""
    if not (is_staff or registration):
        return []
    rows = await fetch_one_off(select(DBEventAnnouncement).where(DBEventAnnouncement.event_id == event.id).order_by(DBEventAnnouncement.pinned.desc(), DBEventAnnouncement.id.desc()).limit(30))
    out = []
    for (a,) in rows:
        if not is_staff and (not a.sent_at or a.audience not in ("all", registration.status if registration else "")):
            continue
        out.append({"id": a.id, "title": a.title, "body": a.body, "pinned": bool(a.pinned), "sent_at": a.sent_at, "send_at": a.send_at,
                    "audience": a.audience, "channels": a.channels, "recipients": a.recipients})
    return out


# ---------- hosts ----------
class HostBody(BaseModel):
    kind: str = "club"
    name: str
    description: Optional[str] = ""
    logo_url: Optional[str] = ""
    banner_url: Optional[str] = ""
    links: Optional[List[str]] = []

def host_dict(h: DBEventHost) -> dict:
    return {"id": h.id, "kind": h.kind, "name": h.name, "college_name": h.college_name or "", "description": h.description or "",
            "logo_url": h.logo_url or "", "banner_url": h.banner_url or "", "links": jload(h.links, []), "verified": bool(h.verified),
            "status": h.status, "created_by": h.created_by}

def clean_host_image(url: str) -> str:
    url = (url or "").strip()
    if url and not re.search(r"/static/uploads/events/poster_\d+_[0-9a-f]+\.(jpg|jpeg|png|webp)$", url):
        raise HTTPException(status_code=400, detail="Upload pictures with the upload button.")
    return url

@router.post("/api/hosts")
@limiter.limit("10/day", key_func=account_rate_key)
async def create_host(request: Request, body: HostBody, current_user_id: int = Depends(get_current_user_id)):
    """Teachers, admins and the founder make hosts that are live and verified at once. A verified student asks, and a
    teacher of their college decides. A professional makes a company host, which the founder may verify later."""
    actor = await actor_of(current_user_id)
    if body.kind not in HOST_KINDS:
        raise HTTPException(status_code=400, detail="Pick what kind of host this is.")
    if not can_create(actor):
        raise HTTPException(status_code=403, detail=cannot_create_reason(actor))
    name = clean_text(body.name, 100, "name")
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Give the host a name of at least 3 characters.")
    trusted = actor["founder"] or bool(actor["teacher_key"]) or bool(actor["admin_colleges"])
    if actor["professional"] and body.kind != "company":
        raise HTTPException(status_code=400, detail="A professional account can create a company host.")
    status_ = "active" if (trusted or actor["professional"]) else "pending"
    links = [clean_link(link, "link") for link in (body.links or [])[:5] if (link or "").strip()]
    rows = await run_returning(DBEventHost.__table__.insert().values(
        kind=body.kind, name=name, college_key=actor["college_key"] if body.kind != "company" else "", college_name=actor["college"] if body.kind != "company" else "",
        description=clean_text(body.description, 1500, "description"), logo_url=clean_host_image(body.logo_url), banner_url=clean_host_image(body.banner_url),
        links=json.dumps(links), verified=1 if trusted else 0, status=status_, created_by=current_user_id, created_at=now_iso()).returning(DBEventHost.id))
    host_id = rows[0][0]
    await run_one_off(DBEventHostMember.__table__.insert().values(host_id=host_id, user_id=current_user_id, role="admin", created_at=now_iso()))
    if status_ == "pending":
        teachers = await fetch_one_off(select(DBUser.id).where(DBUser.teacher_of == actor["college_key"]))
        notify([t for (t,) in teachers], f"{actor['name']} asked to create the host \"{name}\". Approve it in College Hub, Events.", "college-hub.html?tab=events")
    return {"id": host_id, "status": status_}

@router.get("/api/hosts/mine")
async def my_hosts(current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBEventHost, DBEventHostMember.role).join(DBEventHostMember, DBEventHostMember.host_id == DBEventHost.id)
                               .where(DBEventHostMember.user_id == current_user_id).order_by(DBEventHost.name))
    actor = await actor_of(current_user_id)
    return {"hosts": [dict(host_dict(h), my_role=role) for h, role in rows], "can_create": can_create(actor),
            "reason": "" if can_create(actor) else cannot_create_reason(actor)}

@router.get("/api/hosts/{host_id}")
async def get_host(host_id: int, request: Request):
    viewer = optional_user_id(request)
    rows = await fetch_one_off(select(DBEventHost).where(DBEventHost.id == host_id))
    if not rows or (rows[0][0].status != "active" and not viewer):
        raise HTTPException(status_code=404, detail="Host not found.")
    host = rows[0][0]
    actor = await actor_of(viewer)
    members, followers, following = await asyncio.gather(
        fetch_one_off(select(DBEventHostMember.user_id, DBEventHostMember.role).where(DBEventHostMember.host_id == host_id)),
        fetch_one_off(select(func.count()).select_from(DBHostFollower).where(DBHostFollower.host_id == host_id)),
        fetch_one_off(select(DBHostFollower.id).where(DBHostFollower.host_id == host_id, DBHostFollower.user_id == (viewer or 0))))
    if host.status != "active" and viewer not in [m for m, _ in members] and not college_trusted(actor, host.college_key):
        raise HTTPException(status_code=404, detail="Host not found.")
    people = await people_by_id([m for m, _ in members])
    events = await fetch_one_off(select(DBEvent).where(DBEvent.host_id == host_id, listed_clause(actor)).order_by(DBEvent.start_at.desc()).limit(60))
    cards = await cards_for([e for (e,) in events], actor)
    now = now_iso()
    return {"host": host_dict(host), "followers": followers[0][0] or 0, "following": bool(following),
            "members": [dict(people.get(m, {"id": m, "name": "Deleted user"}), role=role) for m, role in members],
            "my_role": next((role for m, role in members if m == viewer), ""),
            "upcoming": [c for c in cards if (c["end_at"] or "") >= now and c["status"] == "published"],
            "past": [c for c in cards if not ((c["end_at"] or "") >= now and c["status"] == "published")]}

@router.patch("/api/hosts/{host_id}")
async def edit_host(host_id: int, body: HostBody, current_user_id: int = Depends(get_current_user_id)):
    await require_host_admin(host_id, current_user_id)
    links = [clean_link(link, "link") for link in (body.links or [])[:5] if (link or "").strip()]
    await run_one_off(update(DBEventHost).where(DBEventHost.id == host_id).values(
        name=clean_text(body.name, 100, "name"), description=clean_text(body.description, 1500, "description"),
        logo_url=clean_host_image(body.logo_url), banner_url=clean_host_image(body.banner_url), links=json.dumps(links)))
    return {"ok": True}

async def require_host_admin(host_id: int, user_id: int):
    rows = await fetch_one_off(select(DBEventHostMember.role).where(DBEventHostMember.host_id == host_id, DBEventHostMember.user_id == user_id))
    if rows and rows[0][0] == "admin":
        return
    if (await actor_of(user_id))["founder"]:
        return
    raise HTTPException(status_code=403, detail="Only the host's admins can do this.")

class HostMemberBody(BaseModel):
    user_id: Optional[int] = None
    email: Optional[str] = ""
    role: str = "member"

@router.post("/api/hosts/{host_id}/members")
async def add_host_member(host_id: int, body: HostMemberBody, current_user_id: int = Depends(get_current_user_id)):
    """Add someone by account id or by the email of their account."""
    await require_host_admin(host_id, current_user_id)
    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="Role must be admin or member.")
    user_id = body.user_id
    if not user_id and body.email:
        rows = await fetch_one_off(select(DBUser.id).where(func.lower(DBUser.email) == body.email.strip().lower(), core.visible_user_clause()))
        user_id = rows[0][0] if rows else None
    if not user_id or not await people_by_id([user_id]):
        raise HTTPException(status_code=404, detail="Nobody with that account was found.")
    await run_one_off(pg_insert(DBEventHostMember).values(host_id=host_id, user_id=user_id, role=body.role, created_at=now_iso())
                      .on_conflict_do_update(index_elements=["host_id", "user_id"], set_={"role": body.role}))
    hosts = await hosts_by_id([host_id])
    notify([user_id], f"You were added to {hosts.get(host_id, {}).get('name', 'a host')} as {body.role}.", f"host.html?id={host_id}")
    return {"ok": True, "user_id": user_id}

@router.delete("/api/hosts/{host_id}/members/{user_id}")
async def remove_host_member(host_id: int, user_id: int, current_user_id: int = Depends(get_current_user_id)):
    if user_id != current_user_id:
        await require_host_admin(host_id, current_user_id)
    admins = await fetch_one_off(select(DBEventHostMember.user_id).where(DBEventHostMember.host_id == host_id, DBEventHostMember.role == "admin"))
    if [a for (a,) in admins] == [user_id]:
        raise HTTPException(status_code=400, detail="A host needs at least one admin. Make someone else an admin first.")
    await run_one_off(delete(DBEventHostMember).where(DBEventHostMember.host_id == host_id, DBEventHostMember.user_id == user_id))
    return {"ok": True}

@router.post("/api/hosts/{host_id}/follow")
async def follow_host(host_id: int, current_user_id: int = Depends(get_current_user_id)):
    removed = await run_returning(delete(DBHostFollower).where(DBHostFollower.host_id == host_id, DBHostFollower.user_id == current_user_id).returning(DBHostFollower.id))
    if removed:
        return {"following": False}
    if not await hosts_by_id([host_id]):
        raise HTTPException(status_code=404, detail="Host not found.")
    await run_one_off(pg_insert(DBHostFollower).values(host_id=host_id, user_id=current_user_id, created_at=now_iso()).on_conflict_do_nothing())
    return {"following": True}

class DecisionBody(BaseModel):
    decision: str                      # approve, changes, reject
    comment: Optional[str] = ""

@router.post("/api/hosts/{host_id}/decision")
async def decide_host(host_id: int, body: DecisionBody, current_user_id: int = Depends(get_current_user_id)):
    actor = await actor_of(current_user_id)
    rows = await fetch_one_off(select(DBEventHost).where(DBEventHost.id == host_id))
    if not rows or rows[0][0].status != "pending":
        raise HTTPException(status_code=404, detail="There is no host request to decide.")
    host = rows[0][0]
    if not college_trusted(actor, host.college_key):
        raise HTTPException(status_code=403, detail="Only a teacher or admin of this college can decide.")
    if body.decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Approve or reject.")
    approved = body.decision == "approve"
    await run_one_off(update(DBEventHost).where(DBEventHost.id == host_id).values(status="active" if approved else "rejected", verified=1 if approved else 0, decided_by=current_user_id))
    comment = clean_text(body.comment, 500, "comment")
    notify([host.created_by], f"Your host \"{host.name}\" was {'approved' if approved else 'not approved'}" + (f": {comment}" if comment else "."), f"host.html?id={host_id}")
    return {"status": "active" if approved else "rejected"}


# ---------- creating and editing events ----------
async def active_event_limit(actor: dict, college_key: str) -> Optional[int]:
    if actor["founder"]:
        return None
    if college_trusted(actor, college_key) and await college_licence(college_key):
        return None
    if not actor["teacher_key"] and not actor["admin_colleges"] and not actor["professional"]:
        return STUDENT_ACTIVE_EVENTS
    return FREE_ACTIVE_EVENTS

@router.get("/api/events/templates")
async def event_templates():
    return {"templates": [{"key": key, "label": t["label"], "hours": t["hours"], "values": t["values"]} for key, t in EVENT_TEMPLATES.items()],
            "kinds": EVENT_KINDS, "profile_fields": PROFILE_FIELDS, "question_types": QUESTION_TYPES, "max_questions": MAX_QUESTIONS}

@router.post("/api/events")
@limiter.limit("5/day", key_func=account_rate_key)
async def create_event(request: Request, body: EventBody, current_user_id: int = Depends(get_current_user_id)):
    """A new draft. Only the organiser sees it until it is submitted."""
    actor = await actor_of(current_user_id)
    if not can_create(actor):
        raise HTTPException(status_code=403, detail=cannot_create_reason(actor))
    limit = await active_event_limit(actor, actor["college_key"])
    if limit is not None:
        active = await fetch_one_off(select(func.count()).select_from(DBEvent).where(DBEvent.created_by == current_user_id, DBEvent.deleted_at == "",
                                                                                      DBEvent.status.in_(LIVE_STATUSES), or_(DBEvent.end_at == "", DBEvent.end_at > now_iso())))
        if (active[0][0] or 0) >= limit:
            raise HTTPException(status_code=402, detail=f"You can have {limit} active events at a time on the free plan. Finish, cancel or delete one first. Colleges with the institution licence have no limit.")
    values = await clean_event_values(body, actor, None)
    if not values.get("title"):
        values["title"] = "Untitled event"
    now = now_iso()
    values.setdefault("visibility", "public" if actor["professional"] else "college")
    values.setdefault("department", actor["department"])
    rows = await run_returning(DBEvent.__table__.insert().values(
        created_by=current_user_id, college_key=actor["college_key"] if not actor["professional"] else "", college_name=actor["college"] if not actor["professional"] else "",
        invite_code=secrets.token_urlsafe(9), status="draft", created_at=now, updated_at=now, slug="", **values).returning(DBEvent.id))
    event_id = rows[0][0]
    await asyncio.gather(
        run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(slug=slugify(values["title"], event_id))),
        run_one_off(DBEventStaff.__table__.insert().values(event_id=event_id, user_id=current_user_id, role="owner", added_by=current_user_id, created_at=now)))
    spawn_background(audit(event_id, current_user_id, "created", {"title": values["title"]}))
    return {"id": event_id, "status": "draft"}

@router.post("/api/events/{event_id}/duplicate")
@limiter.limit("5/day", key_func=account_rate_key)
async def duplicate_event(request: Request, event_id: int, current_user_id: int = Depends(get_current_user_id)):
    """A new draft with everything but the dates, registrations and approvals of an event you organised."""
    event, _, actor = await require_staff(event_id, current_user_id)
    copy_fields = ("host_id", "title", "tagline", "kind", "tags", "description", "poster_url", "mode", "venue", "address", "room", "map_link", "city",
                   "visibility", "department", "eligibility", "capacity", "waitlist_on", "manual_approval", "walkins_on", "is_team_event", "team_min",
                   "team_max", "collect_fields", "form_fields", "speakers", "faqs", "sponsors", "takes_photos", "contact_name", "contact_phone",
                   "contact_email", "certificates_on", "cancel_cutoff_hours")
    values = {field: getattr(event, field) for field in copy_fields}
    values["title"] = (values["title"] or "Event")[:93] + " (copy)"
    limit = await active_event_limit(actor, event.college_key)
    if limit is not None:
        active = await fetch_one_off(select(func.count()).select_from(DBEvent).where(DBEvent.created_by == current_user_id, DBEvent.deleted_at == "",
                                                                                      DBEvent.status.in_(LIVE_STATUSES), or_(DBEvent.end_at == "", DBEvent.end_at > now_iso())))
        if (active[0][0] or 0) >= limit:
            raise HTTPException(status_code=402, detail=f"You can have {limit} active events at a time on the free plan.")
    now = now_iso()
    rows = await run_returning(DBEvent.__table__.insert().values(created_by=current_user_id, college_key=event.college_key, college_name=event.college_name,
                                                                  invite_code=secrets.token_urlsafe(9), status="draft", created_at=now, updated_at=now, slug="",
                                                                  agenda="[]", **values).returning(DBEvent.id))
    new_id = rows[0][0]
    await asyncio.gather(
        run_one_off(update(DBEvent).where(DBEvent.id == new_id).values(slug=slugify(values["title"], new_id))),
        run_one_off(DBEventStaff.__table__.insert().values(event_id=new_id, user_id=current_user_id, role="owner", added_by=current_user_id, created_at=now)))
    spawn_background(audit(new_id, current_user_id, "duplicated", {"from": event_id}))
    return {"id": new_id}

@router.patch("/api/events/{event_id}")
async def edit_event(event_id: int, body: EventBody, current_user_id: int = Depends(get_current_user_id)):
    """Saves an edit. A stale updated_at gets 409 with the newer copy. A big change to a published event by someone who needs
    approval is kept aside until it is approved; everything else takes effect at once."""
    event, role, actor = await require_staff(event_id, current_user_id)
    if event.status in ("cancelled", "completed", "archived", "removed", "rejected"):
        raise HTTPException(status_code=409, detail="This event can no longer be edited.")
    if body.updated_at and event.updated_at and body.updated_at != event.updated_at:
        newer = await event_detail(event, actor, role)
        raise HTTPException(status_code=409, detail={"message": "Someone else saved this event while you were editing. Your changes were not saved; the newer version is loaded.", "event": newer})
    values = await clean_event_values(body, actor, event)
    if "host_id" in values and values["host_id"] != event.host_id and role != "owner" and not actor["founder"]:
        raise HTTPException(status_code=403, detail="Only the owner can change the host.")
    values = {k: val for k, val in values.items() if getattr(event, k) != val}
    if not values:
        return {"ok": True, "updated_at": event.updated_at, "pending_changes": False}
    now = now_iso()
    major = {k: val for k, val in values.items() if k in MAJOR_FIELDS}
    # Fewer seats is a big change (0 means no limit, so it is more seats)
    if "capacity" in values and values["capacity"] and (not event.capacity or values["capacity"] < event.capacity):
        major["capacity"] = values["capacity"]
    steps = await approval_steps_for(actor, values.get("visibility", event.visibility), event.college_key)
    held = event.status == "published" and major and steps
    if held:
        pending = jload(event.pending_changes, {})
        pending.update(major)
        minor = {k: val for k, val in values.items() if k not in major}
        await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(
            pending_changes=json.dumps(pending), change_status="pending", approval_steps=json.dumps(steps), approval_index=0, submitted_at=now, updated_at=now, **minor))
        spawn_background(audit(event_id, current_user_id, "edit_held_for_approval", {"fields": list(major)}))
        spawn_background(tell_approvers(event, steps[0], f"{actor['name']} wants to change {', '.join(sorted(major))} of \"{event.title}\"."))
        return {"ok": True, "updated_at": now, "pending_changes": True}
    if "title" in values:
        values["slug"] = slugify(values["title"], event_id)
    await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(updated_at=now, **values))
    spawn_background(audit(event_id, current_user_id, "edited", {"fields": list(values)}))
    if event.status == "published":
        spawn_background(tell_registrants_of_change(event, values))
    return {"ok": True, "updated_at": now, "pending_changes": False}

async def tell_registrants_of_change(event: DBEvent, changed: dict):
    """Date, time, place or mode changes go to everyone registered, by bell, push and email."""
    labels = {"start_at": "the start time", "end_at": "the end time", "venue": "the venue", "address": "the address", "room": "the room",
              "mode": "whether it is online or offline", "city": "the city"}
    what = [label for field, label in labels.items() if field in changed]
    if not what:
        return
    rows = await fetch_one_off(select(DBEventRegistration.user_id).where(DBEventRegistration.event_id == event.id, DBEventRegistration.status.in_(ACTIVE_REG)))
    ids = [uid for (uid,) in rows]
    title = changed.get("title", event.title)
    start = changed.get("start_at", event.start_at)
    message = f"\"{title}\" changed {', '.join(what)}. It now starts {local_label(start)}. If you can no longer come, cancel so someone else gets the seat."
    notify(ids, message, f"event.html?id={event.id}")
    await email_people(ids, f"Changed: {title}", [message], f"event.html?id={event.id}")

async def tell_approvers(event: DBEvent, step: str, message: str):
    if step == "teacher":
        if event.college_key:
            rows = await fetch_one_off(select(DBUser.id).where(DBUser.teacher_of == event.college_key))
            notify([r for (r,) in rows], message, "college-hub.html?tab=events")
    elif step == "college_admin":
        rows = await fetch_one_off(select(DBAdminScope.user_id).where(DBAdminScope.college_key == event.college_key))
        notify([r for (r,) in rows], message, "college-hub.html?tab=events")
        await notify_founders("event", message, "founder.html?tab=events")
    else:
        await notify_founders("event", message, "founder.html?tab=events")

@router.post("/api/events/{event_id}/submit")
async def submit_event(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Draft (or changes requested) -> published when the organiser may publish, else -> pending for the first approver."""
    event, role, actor = await require_staff(event_id, current_user_id)
    if event.status not in ("draft", "changes"):
        raise HTTPException(status_code=409, detail="Only a draft can be submitted.")
    missing = missing_for_submit(event)
    if missing:
        raise HTTPException(status_code=400, detail="Fill these in first: " + "; ".join(missing) + ".")
    values = {"start_at": event.start_at, "reg_open_at": event.reg_open_at, "reg_close_at": event.reg_close_at}
    apply_defaults(values, actor)
    steps = await approval_steps_for(actor, event.visibility, event.college_key)
    now = now_iso()
    await run_one_off(DBEventApproval.__table__.insert().values(event_id=event_id, step="submitted", approver_id=current_user_id, decision="submitted", created_at=now))
    if not steps:
        await publish_now(event, current_user_id, values)
        return {"status": "published"}
    await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(status="pending", approval_steps=json.dumps(steps), approval_index=0,
                                                                         submitted_at=now, updated_at=now, reviewer_note="",
                                                                         reg_open_at=values["reg_open_at"], reg_close_at=values["reg_close_at"]))
    spawn_background(audit(event_id, current_user_id, "submitted", {"steps": steps}))
    spawn_background(tell_approvers(event, steps[0], f"{actor['name']} asks you to approve the event \"{event.title}\"."))
    return {"status": "pending", "steps": steps}

async def publish_now(event: DBEvent, actor_id: int, values: Optional[dict] = None):
    now = now_iso()
    values = dict(values or {})
    if not values.get("reg_open_at"):
        values["reg_open_at"] = now
    await run_one_off(update(DBEvent).where(DBEvent.id == event.id).values(status="published", published_at=now, updated_at=now, change_status="",
                                                                         approval_index=len(jload(event.approval_steps, [])), **values))
    spawn_background(audit(event.id, actor_id, "published"))
    if event.created_by != actor_id:
        notify([event.created_by], f"\"{event.title}\" is approved and now published.", f"event-manage.html?id={event.id}")
    if event.host_id:
        followers = await fetch_one_off(select(DBHostFollower.user_id).where(DBHostFollower.host_id == event.host_id))
        hosts = await hosts_by_id([event.host_id])
        name = hosts.get(event.host_id, {}).get("name", "A host you follow")
        if event.visibility != "link":
            notify([f for (f,) in followers if f != event.created_by], f"{name} published a new event: {event.title}.", f"event.html?id={event.id}")

@router.post("/api/events/{event_id}/approval")
async def decide_event(event_id: int, body: DecisionBody, current_user_id: int = Depends(get_current_user_id)):
    """Approve the current step (publishing after the last), ask for changes, or reject. Comments are required for the last two.
    Works for new events and for held edits of published ones."""
    event = await load_event(event_id)
    actor = await actor_of(current_user_id)
    reviewing_edit = event.status == "published" and event.change_status == "pending"
    if event.status != "pending" and not reviewing_edit:
        raise HTTPException(status_code=409, detail="This event is not waiting for approval.")
    steps = jload(event.approval_steps, [])
    index = event.approval_index or 0
    step = steps[index] if index < len(steps) else "founder"
    if not can_approve_step(actor, step, event.college_key):
        raise HTTPException(status_code=403, detail="You cannot approve this step.")
    if event.created_by == current_user_id and not actor["founder"]:
        raise HTTPException(status_code=403, detail="You cannot approve your own event.")
    if body.decision not in ("approve", "changes", "reject"):
        raise HTTPException(status_code=400, detail="Approve, ask for changes or reject.")
    comment = clean_text(body.comment, 1000, "comment")
    if body.decision != "approve" and len(comment) < 5:
        raise HTTPException(status_code=400, detail="Say what should change, or why it is rejected.")
    now = now_iso()
    await run_one_off(DBEventApproval.__table__.insert().values(event_id=event_id, step=("changes:" if reviewing_edit else "") + step, approver_id=current_user_id,
                                                               decision={"approve": "approved", "changes": "changes", "reject": "rejected"}[body.decision], comment=comment, created_at=now))
    spawn_background(audit(event_id, current_user_id, f"approval_{body.decision}", {"step": step, "comment": comment, "edit": reviewing_edit}))
    link = f"event-manage.html?id={event_id}"
    if reviewing_edit:
        if body.decision != "approve":
            await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(change_status="", pending_changes="{}", reviewer_note=comment, updated_at=now))
            notify([event.created_by], f"Your change to \"{event.title}\" was not approved: {comment}", link)
            return {"status": "published", "change_status": ""}
        if index + 1 < len(steps):
            await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(approval_index=index + 1, updated_at=now))
            spawn_background(tell_approvers(event, steps[index + 1], f"A change to \"{event.title}\" needs your approval."))
            return {"status": "published", "change_status": "pending"}
        changes = jload(event.pending_changes, {})
        if "title" in changes:
            changes["slug"] = slugify(changes["title"], event_id)
        await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(change_status="", pending_changes="{}", reviewer_note=comment, updated_at=now, **changes))
        notify([event.created_by], f"Your change to \"{event.title}\" was approved and is live.", link)
        spawn_background(tell_registrants_of_change(event, changes))
        return {"status": "published", "change_status": ""}
    if body.decision == "reject":
        await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(status="rejected", reviewer_note=comment, updated_at=now))
        notify([event.created_by], f"\"{event.title}\" was not approved: {comment}", link)
        return {"status": "rejected"}
    if body.decision == "changes":
        await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(status="changes", reviewer_note=comment, approval_index=0, updated_at=now))
        notify([event.created_by], f"Changes requested for \"{event.title}\": {comment}", link)
        return {"status": "changes"}
    if index + 1 < len(steps):
        await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(approval_index=index + 1, updated_at=now))
        spawn_background(tell_approvers(event, steps[index + 1], f"\"{event.title}\" was approved by a teacher and needs your approval to go public."))
        return {"status": "pending", "next_step": steps[index + 1]}
    values = {"reg_open_at": event.reg_open_at or now, "reg_close_at": event.reg_close_at}
    if values["reg_open_at"] < now:
        values["reg_open_at"] = now
    await publish_now(event, current_user_id, values)
    return {"status": "published"}

@router.get("/api/events/approvals")
async def approval_queue(current_user_id: int = Depends(get_current_user_id)):
    """What this teacher, admin or founder can decide now: new events, held edits and host requests."""
    actor = await actor_of(current_user_id)
    if not (actor["founder"] or actor["teacher_key"] or actor["admin_colleges"]):
        raise HTTPException(status_code=403, detail="The approval queue is for teachers, admins and the founder.")
    colleges = {actor["teacher_key"]} | actor["admin_colleges"]
    where = or_(DBEvent.status == "pending", and_(DBEvent.status == "published", DBEvent.change_status == "pending"))
    clause = and_(DBEvent.deleted_at == "", where) if actor["founder"] else and_(DBEvent.deleted_at == "", where, DBEvent.college_key.in_([c for c in colleges if c]))
    rows = await fetch_one_off(select(DBEvent).where(clause).order_by(DBEvent.submitted_at))
    items = []
    for (event,) in rows:
        steps = jload(event.approval_steps, [])
        index = event.approval_index or 0
        step = steps[index] if index < len(steps) else "founder"
        if not can_approve_step(actor, step, event.college_key) or event.created_by == current_user_id and not actor["founder"]:
            continue
        items.append({"event": event, "step": step})
    people = await people_by_id([i["event"].created_by for i in items])
    cards = {c["id"]: c for c in await cards_for([i["event"] for i in items], actor)}
    out = [{"card": cards[i["event"].id], "step": i["step"], "kind": "edit" if i["event"].status == "published" else "new",
            "pending_changes": jload(i["event"].pending_changes, {}), "submitted_at": i["event"].submitted_at,
            "organiser": people.get(i["event"].created_by), "description": i["event"].description, "visibility": i["event"].visibility,
            "missing": missing_for_submit(i["event"])} for i in items]
    host_clause = DBEventHost.status == "pending" if actor["founder"] else and_(DBEventHost.status == "pending", DBEventHost.college_key.in_([c for c in colleges if c]))
    host_rows = await fetch_one_off(select(DBEventHost).where(host_clause).order_by(DBEventHost.id))
    host_people = await people_by_id([h.created_by for (h,) in host_rows])
    return {"events": out, "hosts": [dict(host_dict(h), requested_by=host_people.get(h.created_by)) for (h,) in host_rows]}

class CancelBody(BaseModel):
    reason: str

@router.post("/api/events/{event_id}/cancel")
async def cancel_event(event_id: int, body: CancelBody, current_user_id: int = Depends(get_current_user_id)):
    event, role, actor = await require_staff(event_id, current_user_id)
    if event.status not in ("published", "pending", "changes", "draft"):
        raise HTTPException(status_code=409, detail="This event cannot be cancelled now.")
    reason = clean_text(body.reason, 500, "reason")
    if event.status == "published" and len(reason) < 5:
        raise HTTPException(status_code=400, detail="Tell registrants why it is cancelled.")
    await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(status="cancelled", cancelled_reason=reason, updated_at=now_iso()))
    spawn_background(audit(event_id, current_user_id, "cancelled", {"reason": reason}))
    rows = await fetch_one_off(select(DBEventRegistration.user_id).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status.in_(ACTIVE_REG)))
    ids = [uid for (uid,) in rows]
    message = f"Cancelled: \"{event.title}\" ({local_label(event.start_at)}). Reason: {reason}"
    notify(ids, message, f"event.html?id={event_id}")
    spawn_background(email_people(ids, f"Cancelled: {event.title}", [message], f"event.html?id={event_id}"))
    return {"status": "cancelled", "told": len(ids)}

@router.delete("/api/events/{event_id}")
async def delete_event(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Soft delete by the owner: hidden everywhere, rows and the audit log kept. A live event with people is cancelled first."""
    event, role, actor = await require_staff(event_id, current_user_id, roles=("owner",))
    active = await fetch_one_off(select(func.count()).select_from(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status.in_(ACTIVE_REG)))
    if event.status == "published" and (active[0][0] or 0) > 0:
        raise HTTPException(status_code=409, detail="People are registered. Cancel the event first (they will be told), then delete it.")
    await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(deleted_at=now_iso()))
    spawn_background(audit(event_id, current_user_id, "deleted"))
    return {"ok": True}


# ---------- reading events ----------
@router.get("/api/events")
async def list_events(request: Request, tab: str = "upcoming", q: str = "", kind: str = "", mode: str = "", college: str = "", department: str = "",
                      date_from: str = "", date_to: str = "", open_only: bool = False, seats: bool = False, sort: str = "soonest",
                      page: int = 1, size: int = 24):
    """Events for the Discover page. Works logged out (public events only)."""
    viewer = optional_user_id(request)
    actor = await actor_of(viewer)
    size = max(1, min(size, 60))
    now = now_iso()
    if tab in ("mine", "saved", "organising") and not viewer:
        raise HTTPException(status_code=401, detail="Log in to see your events.")
    if tab == "organising":
        clause = and_(DBEvent.deleted_at == "", DBEvent.id.in_(select(DBEventStaff.event_id).where(DBEventStaff.user_id == viewer)))
    elif tab == "mine":
        clause = and_(DBEvent.deleted_at == "", DBEvent.id.in_(select(DBEventRegistration.event_id).where(DBEventRegistration.user_id == viewer)))
    elif tab == "saved":
        clause = and_(listed_clause(actor), DBEvent.id.in_(select(DBEventSave.event_id).where(DBEventSave.user_id == viewer)))
    else:
        clause = and_(listed_clause(actor))
        if tab == "now":
            clause = and_(clause, DBEvent.status == "published", DBEvent.start_at <= now, DBEvent.end_at >= now)
        elif tab == "past":
            clause = and_(clause, or_(DBEvent.end_at < now, DBEvent.status.in_(("completed", "archived"))))
        elif tab == "all":                      # the month calendar: past and future events of the month
            pass
        else:
            clause = and_(clause, DBEvent.status == "published", DBEvent.end_at >= now)
    if q.strip():
        like = f"%{q.strip()[:80]}%"
        host_ids = select(DBEventHost.id).where(DBEventHost.name.ilike(like))
        clause = and_(clause, or_(DBEvent.title.ilike(like), DBEvent.tags.ilike(like), DBEvent.college_name.ilike(like), DBEvent.tagline.ilike(like), DBEvent.host_id.in_(host_ids)))
    if kind in EVENT_KINDS:
        clause = and_(clause, DBEvent.kind == kind)
    if mode in EVENT_MODES:
        clause = and_(clause, DBEvent.mode == mode)
    if college.strip() == "mine":              # the viewer's own college (College Hub's calendar), a teacher's being the one they teach at
        clause = and_(clause, DBEvent.college_key == actor["college_key"], DBEvent.college_key != "")
    elif college.strip():
        clause = and_(clause, DBEvent.college_key == college_key_of(college))
    if department.strip():
        clause = and_(clause, func.lower(DBEvent.department) == department.strip().lower())
    for value, op in ((date_from, ">="), (date_to, "<=")):
        moment = parse_moment(value + ("T00:00" if op == ">=" else "T23:59")) if re.match(r"^\d{4}-\d{2}-\d{2}$", value or "") else None
        if moment:
            clause = and_(clause, DBEvent.end_at >= iso(moment)) if op == ">=" else and_(clause, DBEvent.start_at <= iso(moment))
    if open_only:
        clause = and_(clause, DBEvent.status == "published", DBEvent.reg_open_at <= now, DBEvent.reg_close_at >= now)
    if seats:
        confirmed = (select(func.count()).select_from(DBEventRegistration).where(DBEventRegistration.event_id == DBEvent.id, DBEventRegistration.status == "confirmed")
                     .correlate(DBEvent).scalar_subquery())
        clause = and_(clause, or_(DBEvent.capacity == 0, confirmed < DBEvent.capacity))
    order = {"newest": [DBEvent.published_at.desc()], "popular": [DBEvent.view_count.desc()]}.get(sort, [DBEvent.start_at.desc() if tab == "past" else DBEvent.start_at])
    rows, total = await asyncio.gather(
        fetch_one_off(select(DBEvent).where(clause).order_by(DBEvent.featured.desc(), *order, DBEvent.id).offset((max(page, 1) - 1) * size).limit(size)),
        fetch_one_off(select(func.count()).select_from(DBEvent).where(clause)))
    return {"events": await cards_for([e for (e,) in rows], actor), "total": total[0][0] or 0, "page": page, "size": size,
            "can_create": can_create(actor) if viewer else False}

@router.get("/api/events/recommended")
async def recommended_events(current_user_id: int = Depends(get_current_user_id)):
    """Up to 8 open events ranked for this person: their college, their department, tags that match their skills, hosts they follow."""
    actor = await actor_of(current_user_id)
    now = now_iso()
    rows, followed = await asyncio.gather(
        fetch_one_off(select(DBEvent).where(listed_clause(actor), DBEvent.status == "published", DBEvent.end_at >= now,
                                            DBEvent.reg_close_at >= now).order_by(DBEvent.start_at).limit(200)),
        fetch_one_off(select(DBHostFollower.host_id).where(DBHostFollower.user_id == current_user_id)))
    mine = await fetch_one_off(select(DBEventRegistration.event_id).where(DBEventRegistration.user_id == current_user_id))
    skip = {r[0] for r in mine}
    hosts = {h for (h,) in followed}
    skills = {s.strip().lower() for s in (actor["skills"] or "").split(",") if s.strip()}
    scored = []
    for (event,) in rows:
        if event.id in skip:
            continue
        tags = {t.strip().lower() for t in (event.tags or "").split(",") if t.strip()}
        score = (3 if event.college_key and event.college_key == actor["college_key"] else 0) \
            + (2 if event.department and event.department.lower() == actor["department"].lower() else 0) \
            + 2 * len(tags & skills) + (3 if event.host_id in hosts else 0) + (1 if event.featured else 0)
        if score:
            scored.append((score, event.start_at, event))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return {"events": await cards_for([e for _, _, e in scored[:8]], actor)}

@router.get("/api/events/{event_id}")
async def get_event(event_id: int, request: Request, code: str = "", ref: str = ""):
    viewer = optional_user_id(request)
    event = await load_event(event_id)
    actor = await actor_of(viewer)
    if not await may_view(event, actor, code):
        raise HTTPException(status_code=404 if viewer else 401, detail="Event not found." if viewer else "Log in to see this event.")
    role = await staff_role(event_id, viewer)
    if not role and event.status == "published":
        spawn_background(run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(view_count=DBEvent.view_count + 1)))
    return await event_detail(event, actor, role)

@router.post("/api/events/{event_id}/save")
async def save_event(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    removed = await run_returning(delete(DBEventSave).where(DBEventSave.event_id == event_id, DBEventSave.user_id == current_user_id).returning(DBEventSave.id))
    if removed:
        return {"saved": False}
    event = await load_event(event_id)
    if not await may_view(event, await actor_of(current_user_id)):
        raise HTTPException(status_code=404, detail="Event not found.")
    await run_one_off(pg_insert(DBEventSave).values(event_id=event_id, user_id=current_user_id, created_at=now_iso()).on_conflict_do_nothing())
    return {"saved": True}


# ---------- sharing: link previews, calendar files, sitemap ----------
def ics_text(value: str) -> str:
    return (value or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

def ics_time(value: str) -> str:
    moment = when(value)
    return moment.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ") if moment else ""

@router.get("/api/events/{event_id}/calendar.ics")
async def event_ics(event_id: int, request: Request, code: str = ""):
    event = await load_event(event_id)
    if not await may_view(event, await actor_of(optional_user_id(request)), code):
        raise HTTPException(status_code=404, detail="Event not found.")
    place = ", ".join(p for p in (event.venue, event.room, event.address, event.city) if p) or ("Online" if event.mode == "online" else "")
    body = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Connect2Minds//Events//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
        f"UID:event-{event.id}@connect2minds", f"DTSTAMP:{ics_time(now_iso())}", f"DTSTART:{ics_time(event.start_at)}", f"DTEND:{ics_time(event.end_at)}",
        f"SUMMARY:{ics_text(event.title)}", f"DESCRIPTION:{ics_text((event.tagline or '') + chr(10) + SITE_URL + '/event.html?id=' + str(event.id))}",
        f"LOCATION:{ics_text(place)}", f"URL:{SITE_URL}/event.html?id={event.id}",
        "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", f"DESCRIPTION:{ics_text(event.title)}", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR", ""])
    return Response(content=body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{event.slug or "event"}.ics"'})

@router.get("/e/{slug}", response_class=HTMLResponse)
async def share_page(slug: str):
    """What WhatsApp, LinkedIn and Google read (they do not run scripts): title, description and poster as Open Graph tags plus a
    JSON-LD Event. People are sent straight on to the real page. Only public events have a preview; others show a plain title."""
    rows = await fetch_one_off(select(DBEvent).where(DBEvent.id == id_from_slug(slug), DBEvent.deleted_at == ""))
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found.")
    event = rows[0][0]
    target = f"{SITE_URL}/event.html?id={event.id}"
    public = event.visibility == "public" and event.status in LISTED_STATUSES
    title = event.title if public else "An event on Connect2Minds"
    description = (event.tagline or re.sub(r"[#*_`>\[\]()-]+", " ", event.description or "")[:200]).strip() if public else "Log in to see this event."
    when_label = local_label(event.start_at)
    place = event.venue or ("Online" if event.mode == "online" else event.city)
    if public and when_label:
        description = f"{when_label} · {place}. {description}"[:300]
    image = event.poster_url if public else ""
    data = {"@context": "https://schema.org", "@type": "Event", "name": event.title, "startDate": event.start_at, "endDate": event.end_at,
            "eventStatus": "https://schema.org/EventCancelled" if event.status == "cancelled" else "https://schema.org/EventScheduled",
            "eventAttendanceMode": {"online": "https://schema.org/OnlineEventAttendanceMode", "hybrid": "https://schema.org/MixedEventAttendanceMode"}.get(event.mode, "https://schema.org/OfflineEventAttendanceMode"),
            "location": {"@type": "VirtualLocation", "url": target} if event.mode == "online" else {"@type": "Place", "name": event.venue or event.city, "address": event.address or event.city},
            "image": [image] if image else [], "description": description, "url": target,
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "INR", "availability": "https://schema.org/InStock", "url": target}}
    e = html.escape
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} | Connect2Minds</title><meta name="description" content="{e(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Connect2Minds"><meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}"><meta property="og:url" content="{e(target)}">{f'<meta property="og:image" content="{e(image)}">' if image else ''}
<meta name="twitter:card" content="{'summary_large_image' if image else 'summary'}"><link rel="canonical" href="{e(target)}">
{('<script type="application/ld+json">' + json.dumps(data).replace("</", "<\\/") + '</script>') if public else ''}
<meta http-equiv="refresh" content="0; url={e(target)}"></head>
<body style="font-family:Arial,sans-serif;padding:24px"><p><a href="{e(target)}">Open {e(title)} on Connect2Minds</a></p></body></html>"""
    return HTMLResponse(page, headers={"Cache-Control": "public, max-age=300"})

@router.get("/api/events-sitemap.xml")
async def events_sitemap():
    rows = await fetch_one_off(select(DBEvent.id, DBEvent.updated_at).where(DBEvent.deleted_at == "", DBEvent.visibility == "public",
                                                                          DBEvent.status.in_(("published", "completed"))).order_by(DBEvent.id.desc()).limit(5000))
    urls = "".join(f"<url><loc>{html.escape(SITE_URL)}/event.html?id={event_id}</loc><lastmod>{(updated or '')[:10]}</lastmod></url>" for event_id, updated in rows)
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>',
                    media_type="application/xml")


# ---------- pictures ----------
IMAGE_MAGIC = ((b"\xff\xd8\xff", "jpg"), (b"\x89PNG\r\n\x1a\n", "png"), (b"RIFF", "webp"))

def sniff_image(head: bytes) -> str:
    for magic, kind in IMAGE_MAGIC:
        if head.startswith(magic) and (kind != "webp" or head[8:12] == b"WEBP"):
            return kind
    return ""

@router.post("/api/events/upload/poster")
@limiter.limit("30/hour", key_func=account_rate_key)
async def upload_poster(request: Request, file: UploadFile = File(...), current_user_id: int = Depends(get_current_user_id)):
    """A poster, host logo or host banner. The browser already shrank it to at most 1600 px; here the bytes must really be a picture."""
    head = file.file.read(16)
    file.file.seek(0)
    kind = sniff_image(head)
    if not kind:
        raise HTTPException(status_code=400, detail="That file is not a JPG, PNG or WebP picture.")
    file.filename = f"poster.{kind}"
    location = save_upload(file, "static/uploads/events", f"poster_{current_user_id}_{secrets.token_hex(8)}", {"jpg", "png", "webp"}, MAX_IMAGE_BYTES)
    return {"url": upload_url(request, location)}


# ---------- registering ----------
class RegisterBody(BaseModel):
    answers: Optional[dict] = None
    profile: Optional[dict] = None
    consents: Optional[dict] = None       # {"share": true (required), "sponsors": false, "photos": true}
    show_publicly: Optional[bool] = False
    looking_for_team: Optional[bool] = False
    ref: Optional[str] = ""
    code: Optional[str] = ""              # invite code of a link-only event

def check_answers(event: DBEvent, answers: dict, user_id: int) -> dict:
    """Every custom question answered as its type asks. File answers must be this person's upload for this event."""
    cleaned = {}
    for field in jload(event.form_fields, []):
        key, kind, label = field["key"], field["type"], field["label"]
        value = answers.get(key)
        empty = value in (None, "", []) or (kind == "checkbox" and value is False)
        if empty:
            if field.get("required"):
                raise HTTPException(status_code=400, detail=f"Answer \"{label}\".")
            continue
        if kind == "multi":
            values = [str(v)[:120] for v in (value if isinstance(value, list) else [value])]
            if any(v not in field["options"] for v in values):
                raise HTTPException(status_code=400, detail=f"Pick from the choices for \"{label}\".")
            cleaned[key] = values
        elif kind in ("dropdown", "radio"):
            if str(value) not in field["options"]:
                raise HTTPException(status_code=400, detail=f"Pick one of the choices for \"{label}\".")
            cleaned[key] = str(value)
        elif kind == "checkbox":
            cleaned[key] = True
        elif kind == "number":
            try:
                cleaned[key] = float(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"\"{label}\" must be a number.")
        elif kind == "email":
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(value)):
                raise HTTPException(status_code=400, detail=f"\"{label}\" must be an email address.")
            cleaned[key] = str(value)[:200]
        elif kind == "url":
            cleaned[key] = clean_link(str(value), label)
        elif kind == "phone":
            if not re.match(r"^[+0-9 ()-]{6,20}$", str(value)):
                raise HTTPException(status_code=400, detail=f"\"{label}\" must be a phone number.")
            cleaned[key] = str(value)
        elif kind == "date":
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(value)):
                raise HTTPException(status_code=400, detail=f"\"{label}\" must be a date.")
            cleaned[key] = str(value)
        elif kind == "file":
            files = value if isinstance(value, list) else [value]
            if len(files) > 3:
                raise HTTPException(status_code=400, detail=f"At most 3 files for \"{label}\".")
            for name in files:
                if not re.match(rf"^ev{event.id}_u{user_id}_[0-9a-f]{{16}}\.(pdf|jpg|jpeg|png)$", str(name)) or not os.path.exists(os.path.join(ANSWER_FILE_DIR, str(name))):
                    raise HTTPException(status_code=400, detail=f"Upload the file for \"{label}\" again.")
            cleaned[key] = [str(n) for n in files]
        else:
            cleaned[key] = clean_text(str(value), 2000 if kind == "long" else 300, label)
    return cleaned

def check_profile(event: DBEvent, sent: dict, actor: dict) -> dict:
    """The profile fields the organiser asked for, pre-filled in the browser and editable there."""
    out = {}
    for field in (event.collect_fields or "name").split(","):
        if field not in PROFILE_FIELDS:
            continue
        value = clean_text(str(sent.get(field) or ""), 200, PROFILE_FIELDS[field].lower())
        if not value and field in ("name", "email"):
            raise HTTPException(status_code=400, detail=f"Fill in your {PROFILE_FIELDS[field].lower()}.")
        out[field] = value
    return out

async def registration_cap(event: DBEvent) -> Optional[int]:
    """The free plan lets an event take FREE_REGISTRATIONS people; colleges with the licence, and the founder's events, have no cap."""
    if (await actor_of(event.created_by))["founder"] if event.created_by else False:
        return None
    if event.college_key and await college_licence(event.college_key):
        return None
    return FREE_REGISTRATIONS

async def timetable_clash(event: DBEvent, user_id: int) -> str:
    """'' or a warning when the event overlaps a class in the person's own timetable (My Study). Never blocks."""
    start, end = when(event.start_at), when(event.end_at)
    if not start or not end or (end - start) > timedelta(days=1):
        return ""
    local_start, local_end = start.astimezone(SITE_TZ), end.astimezone(SITE_TZ)
    rows = await fetch_one_off(select(DBStudySlot.start_time, DBStudySlot.end_time).where(DBStudySlot.user_id == user_id, DBStudySlot.weekday == local_start.weekday()))
    a, b = local_start.strftime("%H:%M"), local_end.strftime("%H:%M") if local_end.date() == local_start.date() else "23:59"
    for slot_start, slot_end in rows:
        if slot_start and slot_end and slot_start < b and a < slot_end:
            return f"This clashes with your {local_start.strftime('%A')} class at {slot_start}."
    return ""

@router.post("/api/events/{event_id}/register")
@limiter.limit("10/hour", key_func=account_rate_key)
async def register(request: Request, event_id: int, body: RegisterBody, current_user_id: int = Depends(get_current_user_id)):
    """One registration per person. The seat is taken inside one transaction that locks the event row, so two people can never
    get the last seat. Full events put people on the waitlist (when it is on)."""
    actor = await actor_of(current_user_id)
    event = await load_event(event_id)
    if not await may_view(event, actor, body.code or ""):
        raise HTTPException(status_code=404, detail="Event not found.")
    if event.status != "published":
        raise HTTPException(status_code=409, detail="Registration is not open for this event.")
    now = now_iso()
    if event.reg_open_at and now < event.reg_open_at:
        raise HTTPException(status_code=409, detail=f"Registration opens {local_label(event.reg_open_at)}.")
    if (event.reg_close_at and now > event.reg_close_at) or (event.end_at and now > event.end_at):
        raise HTTPException(status_code=409, detail="Registration has closed.")
    problem = eligibility_problem(event, actor)
    if problem:
        raise HTTPException(status_code=403, detail=problem)
    consents = body.consents or {}
    if not consents.get("share"):
        raise HTTPException(status_code=400, detail="Tick the box to share your details with the organisers. Without it they cannot run the event for you.")
    answers = check_answers(event, body.answers or {}, current_user_id)
    profile = check_profile(event, body.profile or {}, actor)
    cap = await registration_cap(event)
    ref = re.sub(r"[^A-Za-z0-9_-]", "", body.ref or "")[:40]
    clean_consents = {"share": True, "sponsors": bool(consents.get("sponsors")), "photos": bool(consents.get("photos")), "at": now}
    async with SessionLocal() as db:
        async with db.begin():
            locked = (await db.execute(select(DBEvent.capacity, DBEvent.waitlist_on, DBEvent.manual_approval).where(DBEvent.id == event_id).with_for_update())).first()
            existing = (await db.execute(select(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.user_id == current_user_id))).scalar_one_or_none()
            if existing and existing.status in ACTIVE_REG:
                raise HTTPException(status_code=409, detail="You are already registered.")
            if existing and existing.status in ("rejected", "removed"):
                raise HTTPException(status_code=403, detail="The organisers did not accept your registration for this event.")
            counts = dict((await db.execute(select(DBEventRegistration.status, func.count()).where(DBEventRegistration.event_id == event_id,
                                                                                                   DBEventRegistration.status.in_(ACTIVE_REG)).group_by(DBEventRegistration.status))).all())
            active_total = sum(counts.values())
            if cap is not None and active_total >= cap:
                raise HTTPException(status_code=402, detail=f"This event has reached the free plan's {cap} registrations. Ask the organisers.")
            capacity, waitlist_on, manual = locked
            full = bool(capacity) and counts.get("confirmed", 0) >= capacity
            if full and not waitlist_on:
                raise HTTPException(status_code=409, detail="This event is full.")
            status_ = "waitlisted" if full else ("pending" if manual else "confirmed")
            values = {"status": status_, "answers": json.dumps(answers), "profile": json.dumps(profile), "consents": json.dumps(clean_consents),
                      "show_publicly": 1 if body.show_publicly else 0, "looking_for_team": 1 if (body.looking_for_team and event.is_team_event) else 0,
                      "ref_code": ref, "updated_at": now, "confirmed_at": now if status_ == "confirmed" else "", "waitlisted_at": now if status_ == "waitlisted" else "",
                      "cancelled_at": "", "team_id": None}
            if existing:
                await db.execute(update(DBEventRegistration).where(DBEventRegistration.id == existing.id).values(qr_version=(existing.qr_version or 1) + 1, **values))
                reg_id = existing.id
            else:
                result = await db.execute(DBEventRegistration.__table__.insert().values(event_id=event_id, user_id=current_user_id, created_at=now, qr_version=1, **values)
                                          .returning(DBEventRegistration.id))
                reg_id = result.scalar_one()
            confirmed_after = counts.get("confirmed", 0) + (1 if status_ == "confirmed" else 0)
    message = {"confirmed": f"You are registered for \"{event.title}\". Your ticket is ready.",
               "pending": f"Your registration for \"{event.title}\" is waiting for the organisers to approve it.",
               "waitlisted": f"\"{event.title}\" is full. You are on the waitlist and will be told if a seat opens."}[status_]
    notify([current_user_id], message, f"ticket.html?reg={reg_id}" if status_ == "confirmed" else f"event.html?id={event_id}")
    if status_ == "confirmed" and actor["email"]:
        plain, page = simple_email(f"You're in, {(actor['name'] or '').split(' ')[0]}!",
                                   [f"{event.title}", f"{local_label(event.start_at)}", event.venue or ("Online" if event.mode == "online" else "")],
                                   ("Open your ticket", f"{SITE_URL}/ticket.html?reg={reg_id}"), "Show the QR code on your ticket at the entrance.")
        spawn_background(send_email(actor["email"], f"Registered: {event.title}", plain, page))
    if capacity:
        spawn_background(capacity_milestones(event, confirmed_after, capacity))
    spawn_background(audit(event_id, current_user_id, "registered", {"status": status_, "ref": ref}))
    return {"id": reg_id, "status": status_, "clash": await timetable_clash(event, current_user_id),
            "group_link": event.group_link if status_ == "confirmed" else "", "online_link": event.online_link if status_ == "confirmed" else ""}

async def capacity_milestones(event: DBEvent, confirmed: int, capacity: int):
    """Tells the owner once each when registrations reach half, 90% and all of the seats."""
    for share, label in ((1.0, "are all taken"), (0.9, "are 90% taken"), (0.5, "are half taken")):
        if confirmed >= share * capacity:
            if await claim_reminders([(event.created_by, f"ev:{event.id}:cap{int(share * 100)}")]):
                notify([event.created_by], f"The {capacity} seats of \"{event.title}\" {label} ({confirmed} registered).", f"event-manage.html?id={event.id}")
            return

@router.delete("/api/events/{event_id}/register")
async def cancel_registration(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    event = await load_event(event_id)
    rows = await fetch_one_off(select(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.user_id == current_user_id))
    if not rows or rows[0][0].status not in ACTIVE_REG:
        raise HTTPException(status_code=404, detail="You are not registered.")
    reg = rows[0][0]
    start = when(event.start_at)
    if reg.status == "confirmed" and start and event.cancel_cutoff_hours and datetime.now(UTC) > start - timedelta(hours=event.cancel_cutoff_hours):
        raise HTTPException(status_code=409, detail=f"Registrations can be cancelled until {event.cancel_cutoff_hours} hours before the start. Contact the organisers.")
    await run_one_off(update(DBEventRegistration).where(DBEventRegistration.id == reg.id).values(status="cancelled", cancelled_at=now_iso(), updated_at=now_iso(),
                                                                                                 qr_version=(reg.qr_version or 1) + 1))
    if reg.team_id:
        await leave_event_team(reg)
    spawn_background(audit(event_id, current_user_id, "cancelled_registration"))
    spawn_background(promote_waitlist(event_id))
    return {"status": "cancelled"}

async def promote_waitlist(event_id: int) -> int:
    """Fills free seats from the waitlist in order (free events: confirmed at once, as the spec allows). Returns how many moved up."""
    promoted = []
    async with SessionLocal() as db:
        async with db.begin():
            row = (await db.execute(select(DBEvent.capacity, DBEvent.status, DBEvent.title, DBEvent.waitlist_on).where(DBEvent.id == event_id).with_for_update())).first()
            if not row or row.status != "published" or not row.capacity:
                return 0
            confirmed = (await db.execute(select(func.count()).select_from(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status == "confirmed"))).scalar() or 0
            free = row.capacity - confirmed
            if free <= 0:
                return 0
            waiting = (await db.execute(select(DBEventRegistration.id, DBEventRegistration.user_id).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status == "waitlisted")
                                        .order_by(DBEventRegistration.waitlisted_at, DBEventRegistration.id).limit(free))).all()
            if waiting:
                now = now_iso()
                await db.execute(update(DBEventRegistration).where(DBEventRegistration.id.in_([w.id for w in waiting])).values(status="confirmed", confirmed_at=now, updated_at=now))
                promoted = waiting
            title = row.title
    for reg_id, user_id in promoted:
        notify([user_id], f"A seat opened at \"{title}\". You are now registered. Your ticket is ready.", f"ticket.html?reg={reg_id}")
    if promoted:
        spawn_background(email_people([u for _, u in promoted], f"You're in: {title}", [f"A seat opened at {title} and you moved up from the waitlist. You are now registered."], f"event.html?id={event_id}"))
        spawn_background(audit(event_id, 0, "waitlist_promoted", {"registrations": [r for r, _ in promoted]}))
    return len(promoted)

class RegistrationSettingsBody(BaseModel):
    show_publicly: Optional[bool] = None
    looking_for_team: Optional[bool] = None

@router.patch("/api/events/{event_id}/register")
async def edit_my_registration(event_id: int, body: RegistrationSettingsBody, current_user_id: int = Depends(get_current_user_id)):
    values = {}
    if body.show_publicly is not None:
        values["show_publicly"] = 1 if body.show_publicly else 0
    if body.looking_for_team is not None:
        values["looking_for_team"] = 1 if body.looking_for_team else 0
    rows = await run_returning(update(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.user_id == current_user_id,
                                                                 DBEventRegistration.status.in_(ACTIVE_REG)).values(updated_at=now_iso(), **values).returning(DBEventRegistration.id))
    if not rows:
        raise HTTPException(status_code=404, detail="You are not registered.")
    return {"ok": True}

@router.post("/api/events/{event_id}/upload/answer")
@limiter.limit("20/hour", key_func=account_rate_key)
async def upload_answer_file(request: Request, event_id: int, file: UploadFile = File(...), current_user_id: int = Depends(get_current_user_id)):
    """A file for a registration question (a resume, a document). Stored privately: only the person and the organisers can open it."""
    event = await load_event(event_id)
    if not await may_view(event, await actor_of(current_user_id)):
        raise HTTPException(status_code=404, detail="Event not found.")
    head = file.file.read(8)
    file.file.seek(0)
    extension = os.path.splitext(file.filename or "")[1].lower().lstrip(".")
    if not (head.startswith(b"%PDF") or sniff_image(head + b"\0" * 8) in ("jpg", "png")) or extension not in ANSWER_FILE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Upload a PDF, JPG or PNG file.")
    name = f"ev{event_id}_u{current_user_id}_{secrets.token_hex(8)}"
    location = save_upload(file, ANSWER_FILE_DIR, name, ANSWER_FILE_EXTENSIONS, MAX_IMAGE_BYTES)
    return {"name": os.path.basename(location), "label": file.filename or "file"}

@router.get("/api/events/{event_id}/files/{name}")
async def answer_file(event_id: int, name: str, current_user_id: int = Depends(get_current_user_id)):
    match = re.match(rf"^ev{event_id}_u(\d+)_[0-9a-f]{{16}}\.(pdf|jpg|jpeg|png)$", name)
    if not match:
        raise HTTPException(status_code=404, detail="File not found.")
    if int(match.group(1)) != current_user_id:
        await require_staff(event_id, current_user_id)
        spawn_background(audit(event_id, current_user_id, "opened_file", {"file": name}))
    path = os.path.join(ANSWER_FILE_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(path, headers={"Cache-Control": "private, no-store"})


# ---------- teams (team events) ----------
class TeamBody(BaseModel):
    name: Optional[str] = ""
    code: Optional[str] = ""

async def my_registration(event_id: int, user_id: int, statuses=ACTIVE_REG) -> DBEventRegistration:
    rows = await fetch_one_off(select(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.user_id == user_id))
    if not rows or rows[0][0].status not in statuses:
        raise HTTPException(status_code=403, detail="Register for the event first.")
    return rows[0][0]

async def team_members(team_id: int) -> list:
    rows = await fetch_one_off(select(DBEventRegistration.user_id, DBEventRegistration.status).where(DBEventRegistration.team_id == team_id,
                                                                                                     DBEventRegistration.status.in_(ACTIVE_REG)))
    return rows

async def team_dict(team: DBEventTeam, viewer: int, event: DBEvent) -> dict:
    members = await team_members(team.id)
    people = await people_by_id([u for u, _ in members])
    mine = any(u == viewer for u, _ in members)
    return {"id": team.id, "name": team.name, "leader_id": team.leader_id, "locked": bool(team.locked), "workspace_id": team.workspace_id if mine else None,
            "invite_code": team.invite_code if mine else "", "size": len(members), "max": event.team_max, "min": event.team_min,
            "members": [dict(people.get(u, {"id": u, "name": "Deleted user"}), status=s) for u, s in members]}

@router.get("/api/events/{event_id}/teams")
async def list_teams(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    """My team, the people looking for a team (ranked by skills shared with me) and, for organisers, every team."""
    event = await load_event(event_id)
    role = await staff_role(event_id, current_user_id)
    actor = await actor_of(current_user_id)
    reg_rows = await fetch_one_off(select(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.user_id == current_user_id))
    reg = reg_rows[0][0] if reg_rows else None
    if not role and not actor["founder"] and not (reg and reg.status in ACTIVE_REG):
        raise HTTPException(status_code=403, detail="Register for the event first.")
    mine = None
    if reg and reg.team_id:
        team_rows = await fetch_one_off(select(DBEventTeam).where(DBEventTeam.id == reg.team_id))
        mine = await team_dict(team_rows[0][0], current_user_id, event) if team_rows else None
    looking = await fetch_one_off(select(DBEventRegistration.user_id).where(DBEventRegistration.event_id == event_id, DBEventRegistration.looking_for_team == 1,
                                                                            DBEventRegistration.team_id.is_(None), DBEventRegistration.status.in_(ACTIVE_REG),
                                                                            DBEventRegistration.user_id != current_user_id))
    ids = [u for (u,) in looking]
    skill_rows = await fetch_one_off(select(DBUser.id, DBUser.name, DBUser.skills, DBUser.profile_pic, DBUser.college_name).where(DBUser.id.in_(ids))) if ids else []
    my_skills = {s.strip().lower() for s in (actor["skills"] or "").split(",") if s.strip()}
    seekers = []
    for uid, name, skills, pic, college in skill_rows:
        theirs = [s.strip() for s in (skills or "").split(",") if s.strip()]
        shared = [s for s in theirs if s.lower() in my_skills]
        seekers.append({"id": uid, "name": name or "", "profile_pic": pic or "", "college_name": college or "", "skills": theirs[:8], "shared": shared[:5]})
    seekers.sort(key=lambda s: (-len(s["shared"]), s["name"]))
    out = {"mine": mine, "looking": seekers[:50], "team_min": event.team_min, "team_max": event.team_max}
    if role or actor["founder"]:
        team_rows = await fetch_one_off(select(DBEventTeam).where(DBEventTeam.event_id == event_id).order_by(DBEventTeam.name))
        out["teams"] = [await team_dict(t, current_user_id, event) for (t,) in team_rows]
    return out

async def create_workspace(event: DBEvent, team_name: str, leader_id: int) -> int:
    """A Team workspace for the event team: channels and calls the members already know. Tagged so it does not count towards the
    person's own team limit."""
    now = now_iso()
    rows = await run_returning(DBTeam.__table__.insert().values(name=f"{team_name} · {event.title}"[:80], description=f"Team for {event.title}"[:300], created_by=leader_id,
                                                                created_at=now, avatar_url="", college_key="", topic=f"event:{event.id}").returning(DBTeam.id))
    workspace_id = rows[0][0]
    await asyncio.gather(
        run_one_off(DBTeamMember.__table__.insert().values(team_id=workspace_id, user_id=leader_id, role="Admin", joined_at=now)),
        run_one_off(DBChannel.__table__.insert().values([{"team_id": workspace_id, "name": "general", "channel_type": "text", "created_at": now},
                                                         {"team_id": workspace_id, "name": "voice-lounge", "channel_type": "voice", "created_at": now}])))
    return workspace_id

@router.post("/api/events/{event_id}/teams")
async def create_event_team(event_id: int, body: TeamBody, current_user_id: int = Depends(get_current_user_id)):
    event = await load_event(event_id)
    if not event.is_team_event:
        raise HTTPException(status_code=400, detail="This is not a team event.")
    reg = await my_registration(event_id, current_user_id)
    if reg.team_id:
        raise HTTPException(status_code=409, detail="You are already in a team. Leave it first.")
    name = clean_text(body.name, 60, "team name")
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Give your team a name.")
    if event.reg_close_at and now_iso() > event.reg_close_at:
        raise HTTPException(status_code=409, detail="Teams are locked: registration has closed.")
    try:
        rows = await run_returning(DBEventTeam.__table__.insert().values(event_id=event_id, name=name, name_key=name.lower(), leader_id=current_user_id,
                                                                         invite_code=secrets.token_hex(4).upper(), created_at=now_iso()).returning(DBEventTeam.id))
    except Exception:
        raise HTTPException(status_code=409, detail="Another team already has that name.")
    team_id = rows[0][0]
    workspace_id = await create_workspace(event, name, current_user_id)
    await asyncio.gather(
        run_one_off(update(DBEventTeam).where(DBEventTeam.id == team_id).values(workspace_id=workspace_id)),
        run_one_off(update(DBEventRegistration).where(DBEventRegistration.id == reg.id).values(team_id=team_id, looking_for_team=0, updated_at=now_iso())))
    spawn_background(audit(event_id, current_user_id, "team_created", {"team": name}))
    team_rows = await fetch_one_off(select(DBEventTeam).where(DBEventTeam.id == team_id))
    return await team_dict(team_rows[0][0], current_user_id, event)

@router.post("/api/events/{event_id}/teams/join")
async def join_event_team(event_id: int, body: TeamBody, current_user_id: int = Depends(get_current_user_id)):
    event = await load_event(event_id)
    reg = await my_registration(event_id, current_user_id)
    if reg.team_id:
        raise HTTPException(status_code=409, detail="You are already in a team. Leave it first.")
    code = re.sub(r"[^A-Za-z0-9]", "", body.code or "").upper()
    rows = await fetch_one_off(select(DBEventTeam).where(DBEventTeam.event_id == event_id, DBEventTeam.invite_code == code))
    if not rows:
        raise HTTPException(status_code=404, detail="No team has that code. Check it with your team leader.")
    team = rows[0][0]
    if team.locked:
        raise HTTPException(status_code=409, detail="This team is locked.")
    if len(await team_members(team.id)) >= (event.team_max or 1):
        raise HTTPException(status_code=409, detail=f"This team already has {event.team_max} members.")
    await run_one_off(update(DBEventRegistration).where(DBEventRegistration.id == reg.id).values(team_id=team.id, looking_for_team=0, updated_at=now_iso()))
    if team.workspace_id:
        exists_ = await fetch_one_off(select(DBTeamMember.id).where(DBTeamMember.team_id == team.workspace_id, DBTeamMember.user_id == current_user_id))
        if not exists_:
            await run_one_off(DBTeamMember.__table__.insert().values(team_id=team.workspace_id, user_id=current_user_id, role="Member", joined_at=now_iso()))
    actor = await actor_of(current_user_id)
    notify([team.leader_id], f"{actor['name']} joined your team {team.name} for \"{event.title}\".", f"event.html?id={event_id}")
    return await team_dict(team, current_user_id, event)

async def leave_event_team(reg: DBEventRegistration):
    rows = await fetch_one_off(select(DBEventTeam).where(DBEventTeam.id == reg.team_id))
    await run_one_off(update(DBEventRegistration).where(DBEventRegistration.id == reg.id).values(team_id=None, updated_at=now_iso()))
    if not rows:
        return
    team = rows[0][0]
    if team.workspace_id:
        await run_one_off(delete(DBTeamMember).where(DBTeamMember.team_id == team.workspace_id, DBTeamMember.user_id == reg.user_id))
    left = await team_members(team.id)
    if not left:
        await run_one_off(delete(DBEventTeam).where(DBEventTeam.id == team.id))
        if team.workspace_id:
            async with AutocommitSession() as db:
                await core.purge_team(db, team.workspace_id)
    elif team.leader_id == reg.user_id:
        new_leader = left[0][0]
        await run_one_off(update(DBEventTeam).where(DBEventTeam.id == team.id).values(leader_id=new_leader))
        if team.workspace_id:
            await run_one_off(update(DBTeamMember).where(DBTeamMember.team_id == team.workspace_id, DBTeamMember.user_id == new_leader).values(role="Admin"))
        notify([new_leader], f"You now lead the team {team.name}.", f"event.html?id={team.event_id}")

@router.post("/api/events/{event_id}/teams/leave")
async def leave_team(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    reg = await my_registration(event_id, current_user_id)
    if not reg.team_id:
        raise HTTPException(status_code=404, detail="You are not in a team.")
    rows = await fetch_one_off(select(DBEventTeam.locked).where(DBEventTeam.id == reg.team_id))
    if rows and rows[0][0]:
        raise HTTPException(status_code=409, detail="Teams are locked. Ask the organisers if you have to leave.")
    await leave_event_team(reg)
    return {"ok": True}


# ---------- tickets ----------
def ticket_token(reg_id: int, version: int) -> str:
    """No personal data: the registration id, its version and a signature only the server can make."""
    signature = hmac.new(SECRET_KEY.encode(), f"evt-ticket:{reg_id}:{version}".encode(), hashlib.sha256).digest()
    return f"C2M.{reg_id}.{version}.{base64.urlsafe_b64encode(signature[:15]).decode()}"

def read_ticket_token(token: str) -> tuple:
    match = re.match(r"^C2M\.(\d+)\.(\d+)\.([A-Za-z0-9_-]{20})$", (token or "").strip())
    if not match:
        raise HTTPException(status_code=400, detail="That is not a Connect2Minds ticket.")
    reg_id, version = int(match.group(1)), int(match.group(2))
    if not hmac.compare_digest(ticket_token(reg_id, version), token.strip()):
        raise HTTPException(status_code=400, detail="This ticket is not genuine.")
    return reg_id, version

async def my_ticket(reg_id: int, user_id: int) -> tuple:
    rows = await fetch_one_off(select(DBEventRegistration, DBEvent).join(DBEvent, DBEvent.id == DBEventRegistration.event_id)
                               .where(DBEventRegistration.id == reg_id, DBEventRegistration.user_id == user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return rows[0]

@router.get("/api/me/events/{reg_id}/ticket")
async def get_ticket(reg_id: int, current_user_id: int = Depends(get_current_user_id)):
    reg, event = await my_ticket(reg_id, current_user_id)
    actor = await actor_of(current_user_id)
    team = None
    if reg.team_id:
        team_rows = await fetch_one_off(select(DBEventTeam.name).where(DBEventTeam.id == reg.team_id))
        team = team_rows[0][0] if team_rows else None
    checked = await fetch_one_off(select(DBEventCheckin.checked_at).where(DBEventCheckin.registration_id == reg.id, DBEventCheckin.session_key == ""))
    hosts, people = await asyncio.gather(hosts_by_id([event.host_id]), people_by_id([event.created_by]))
    return {"registration_id": reg.id, "status": reg.status, "token": ticket_token(reg.id, reg.qr_version or 1) if reg.status == "confirmed" else "",
            "name": jload(reg.profile, {}).get("name") or actor["name"], "college": actor["college"], "team": team,
            "checked_in_at": checked[0][0] if checked else "", "takes_photos": bool(event.takes_photos),
            "event": {"id": event.id, "title": event.title, "start_at": event.start_at, "end_at": event.end_at, "venue": event.venue, "room": event.room,
                      "address": event.address, "mode": event.mode, "city": event.city, "status": event.status, "poster_url": event.poster_url,
                      "online_link": event.online_link if reg.status == "confirmed" else "", "group_link": event.group_link if reg.status == "confirmed" else "",
                      "host": await host_label(event, hosts, people)}}

@router.post("/api/me/events/{reg_id}/ticket/renew")
async def renew_ticket(reg_id: int, current_user_id: int = Depends(get_current_user_id)):
    """A new QR code. The old one (and every screenshot of it) stops working."""
    reg, event = await my_ticket(reg_id, current_user_id)
    if reg.status != "confirmed":
        raise HTTPException(status_code=409, detail="Only a confirmed registration has a ticket.")
    await run_one_off(update(DBEventRegistration).where(DBEventRegistration.id == reg_id).values(qr_version=(reg.qr_version or 1) + 1, updated_at=now_iso()))
    spawn_background(audit(event.id, current_user_id, "ticket_renewed"))
    return {"token": ticket_token(reg_id, (reg.qr_version or 1) + 1)}

@router.get("/api/me/events")
async def my_events(current_user_id: int = Depends(get_current_user_id)):
    """Registrations (upcoming, waitlisted, past), the events I organise and my certificates."""
    actor = await actor_of(current_user_id)
    regs, organising, certs = await asyncio.gather(
        fetch_one_off(select(DBEventRegistration, DBEvent).join(DBEvent, DBEvent.id == DBEventRegistration.event_id)
                      .where(DBEventRegistration.user_id == current_user_id, DBEvent.deleted_at == "").order_by(DBEvent.start_at.desc()).limit(300)),
        fetch_one_off(select(DBEvent, DBEventStaff.role).join(DBEventStaff, DBEventStaff.event_id == DBEvent.id)
                      .where(DBEventStaff.user_id == current_user_id, DBEvent.deleted_at == "").order_by(DBEvent.id.desc()).limit(200)),
        fetch_one_off(select(DBEventCertificate, DBEvent.title, DBEvent.start_at).join(DBEvent, DBEvent.id == DBEventCertificate.event_id)
                      .where(DBEventCertificate.user_id == current_user_id).order_by(DBEventCertificate.id.desc())))
    reg_ids = [r.id for r, _ in regs]
    checked = await fetch_one_off(select(DBEventCheckin.registration_id).where(DBEventCheckin.registration_id.in_(reg_ids), DBEventCheckin.session_key == "")) if reg_ids else []
    checked_ids = {c for (c,) in checked}
    event_cards = {c["id"]: c for c in await cards_for([e for _, e in regs] + [e for e, _ in organising], actor)}
    return {"registrations": [{"id": r.id, "status": r.status, "checked_in": r.id in checked_ids, "created_at": r.created_at, "event": event_cards[e.id]} for r, e in regs],
            "organising": [dict(event_cards[e.id], my_role=role) for e, role in organising],
            "certificates": [certificate_dict(c, title, start) for c, title, start in certs]}


# ---------- check-in ----------
class CheckinBody(BaseModel):
    token: Optional[str] = ""
    registration_id: Optional[int] = None
    walkin_user_id: Optional[int] = None
    session: Optional[str] = ""
    offline_at: Optional[str] = ""        # when the scan happened, for scans queued while the venue had no internet
    force: Optional[bool] = False         # a manager checking someone in outside the window

async def checkin_stats(event_id: int) -> dict:
    confirmed, checked = await asyncio.gather(
        fetch_one_off(select(func.count()).select_from(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status.in_(("confirmed", "no_show")))),
        fetch_one_off(select(DBEventCheckin.session_key, func.count()).where(DBEventCheckin.event_id == event_id).group_by(DBEventCheckin.session_key)))
    by_session = dict(checked)
    total = confirmed[0][0] or 0
    return {"registered": total, "checked_in": by_session.get("", 0), "remaining": max(0, total - by_session.get("", 0)), "sessions": by_session}

async def push_stats(event_id: int):
    """Live counters for every organiser page that is open (dashboard, scanners)."""
    try:
        stats = await checkin_stats(event_id)
        staff = await fetch_one_off(select(DBEventStaff.user_id).where(DBEventStaff.event_id == event_id))
        message = json.dumps({"type": "event_stats", "event_id": event_id, "stats": stats})
        for (uid,) in staff:
            await notification_manager.send_personal_message(message, uid)
    except Exception as e:
        print("Error sending event counters:", e)

@router.post("/api/events/{event_id}/checkin")
async def check_in(event_id: int, body: CheckinBody, current_user_id: int = Depends(get_current_user_id)):
    """By ticket QR, by registration (manual search) or a walk-in. Checking in twice says who did it and when instead of letting
    the person in again, which also defeats shared screenshots of one ticket."""
    event, role, actor = await require_staff(event_id, current_user_id, roles=("owner", "manager", "volunteer"))
    manager = role in MANAGERS or actor["founder"]
    session = re.sub(r"[^a-z0-9]", "", body.session or "")
    if session and session not in {s.get("key") for s in jload(event.agenda, [])}:
        raise HTTPException(status_code=400, detail="That session is not on the agenda.")
    start, end, now = when(event.start_at), when(event.end_at), datetime.now(UTC)
    scanned_at = parse_moment(body.offline_at) if body.offline_at else None
    moment = scanned_at if scanned_at and abs((now - scanned_at).total_seconds()) < 86400 else now
    if start and end and not (body.force and manager) and not (start - timedelta(minutes=CHECKIN_OPENS_MINUTES) <= moment <= end + timedelta(hours=2)):
        raise HTTPException(status_code=409, detail=f"Check-in opens {CHECKIN_OPENS_MINUTES} minutes before the start ({local_label(event.start_at)}).")
    method = "qr"
    if body.walkin_user_id:
        if not event.walkins_on and not manager:
            raise HTTPException(status_code=403, detail="Walk-ins are not allowed for this event.")
        reg = await walk_in(event, body.walkin_user_id, current_user_id)
        method = "walkin"
    elif body.token:
        reg_id, version = read_ticket_token(body.token)
        rows = await fetch_one_off(select(DBEventRegistration).where(DBEventRegistration.id == reg_id))
        reg = rows[0][0] if rows else None
        if not reg or reg.event_id != event_id:
            raise HTTPException(status_code=404, detail="This ticket is for a different event.")
        if version != (reg.qr_version or 1):
            raise HTTPException(status_code=409, detail="This is an old ticket. The person made a new one: ask them to open their ticket again.")
    elif body.registration_id:
        rows = await fetch_one_off(select(DBEventRegistration).where(DBEventRegistration.id == body.registration_id, DBEventRegistration.event_id == event_id))
        reg = rows[0][0] if rows else None
        if not reg:
            raise HTTPException(status_code=404, detail="Registration not found.")
        method = "manual"
    else:
        raise HTTPException(status_code=400, detail="Scan a ticket or pick a person.")
    if body.offline_at:
        method = "offline"
    person = (await people_by_id([reg.user_id])).get(reg.user_id, {"name": "Deleted user", "profile_pic": ""})
    team = None
    if reg.team_id:
        team_rows = await fetch_one_off(select(DBEventTeam.name).where(DBEventTeam.id == reg.team_id))
        team = team_rows[0][0] if team_rows else None
    who = {"registration_id": reg.id, "name": jload(reg.profile, {}).get("name") or person["name"], "profile_pic": person.get("profile_pic", ""),
           "college": person.get("college_name", ""), "team": team, "status": reg.status}
    if reg.status not in ("confirmed", "no_show"):
        label = {"pending": "still waiting for approval", "waitlisted": "on the waitlist", "cancelled": "cancelled", "rejected": "not accepted", "removed": "removed"}.get(reg.status, reg.status)
        return {"ok": False, "reason": f"Not admitted: this registration is {label}.", "person": who, "stats": await checkin_stats(event_id)}
    rows = await run_returning(pg_insert(DBEventCheckin).values(event_id=event_id, registration_id=reg.id, session_key=session, checked_by=current_user_id,
                                                                checked_at=iso(moment), method=method)
                               .on_conflict_do_nothing(index_elements=["registration_id", "session_key"]).returning(DBEventCheckin.id))
    if not rows:
        earlier = await fetch_one_off(select(DBEventCheckin.checked_at, DBEventCheckin.checked_by).where(DBEventCheckin.registration_id == reg.id, DBEventCheckin.session_key == session))
        by = (await people_by_id([earlier[0][1]])).get(earlier[0][1], {}).get("name", "an organiser") if earlier else "an organiser"
        at = when(earlier[0][0]).astimezone(SITE_TZ).strftime("%I:%M %p").lstrip("0") if earlier else ""
        return {"ok": False, "duplicate": True, "reason": f"Already checked in at {at} by {by}.", "person": who, "stats": await checkin_stats(event_id)}
    if reg.status == "no_show":
        await run_one_off(update(DBEventRegistration).where(DBEventRegistration.id == reg.id).values(status="confirmed", updated_at=now_iso()))
    if not session:
        notify([reg.user_id], f"You are checked in at \"{event.title}\". Enjoy!", f"event.html?id={event_id}")
        spawn_background(award_xp(reg.user_id, "event_attend", f"event:{event_id}", 10))
    spawn_background(push_stats(event_id))
    return {"ok": True, "person": who, "stats": await checkin_stats(event_id)}

async def walk_in(event: DBEvent, user_id: int, staff_id: int) -> DBEventRegistration:
    """Someone who turned up without registering: they need an account; they are registered and confirmed on the spot."""
    if not await people_by_id([user_id]):
        raise HTTPException(status_code=404, detail="Person not found.")
    now = now_iso()
    await run_one_off(pg_insert(DBEventRegistration).values(event_id=event.id, user_id=user_id, status="confirmed", answers="{}", profile="{}",
                                                            consents=json.dumps({"share": True, "walk_in": True, "at": now}), created_at=now, updated_at=now,
                                                            confirmed_at=now, note="Walk-in", qr_version=1)
                      .on_conflict_do_update(index_elements=["event_id", "user_id"], set_={"status": "confirmed", "confirmed_at": now, "updated_at": now, "note": "Walk-in"}))
    rows = await fetch_one_off(select(DBEventRegistration).where(DBEventRegistration.event_id == event.id, DBEventRegistration.user_id == user_id))
    spawn_background(audit(event.id, staff_id, "walk_in", {"user_id": user_id}))
    return rows[0][0]

@router.delete("/api/events/{event_id}/checkin/{registration_id}")
async def undo_check_in(event_id: int, registration_id: int, session: str = "", current_user_id: int = Depends(get_current_user_id)):
    await require_staff(event_id, current_user_id)
    await run_one_off(delete(DBEventCheckin).where(DBEventCheckin.event_id == event_id, DBEventCheckin.registration_id == registration_id,
                                                   DBEventCheckin.session_key == re.sub(r"[^a-z0-9]", "", session)))
    spawn_background(audit(event_id, current_user_id, "check_in_undone", {"registration_id": registration_id}))
    spawn_background(push_stats(event_id))
    return {"ok": True, "stats": await checkin_stats(event_id)}

@router.get("/api/events/{event_id}/checkin/stats")
async def get_checkin_stats(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    event, role, _ = await require_staff(event_id, current_user_id, roles=STAFF_ROLES)
    return dict(await checkin_stats(event_id), agenda=[{"key": s["key"], "title": s["title"]} for s in jload(event.agenda, [])],
                title=event.title, start_at=event.start_at, end_at=event.end_at, walkins_on=bool(event.walkins_on), my_role=role)

@router.get("/api/events/{event_id}/checkin/search")
async def checkin_search(event_id: int, q: str = "", current_user_id: int = Depends(get_current_user_id)):
    """Manual look-up at the door by name, roll number or email. Volunteers get only what they need: name, college, status."""
    await require_staff(event_id, current_user_id, roles=("owner", "manager", "volunteer"))
    term = q.strip()[:80]
    if len(term) < 2:
        return {"people": []}
    like = f"%{term}%"
    rows = await fetch_one_off(select(DBEventRegistration.id, DBEventRegistration.status, DBEventRegistration.user_id, DBUser.name, DBUser.college_name, DBUser.profile_pic)
                               .join(DBUser, DBUser.id == DBEventRegistration.user_id)
                               .where(DBEventRegistration.event_id == event_id, or_(DBUser.name.ilike(like), DBUser.roll_no.ilike(like), DBUser.email.ilike(like)))
                               .order_by(DBUser.name).limit(20))
    checked = await fetch_one_off(select(DBEventCheckin.registration_id).where(DBEventCheckin.event_id == event_id, DBEventCheckin.session_key == "",
                                                                               DBEventCheckin.registration_id.in_([r.id for r in rows]))) if rows else []
    done = {c for (c,) in checked}
    return {"people": [{"registration_id": r.id, "status": r.status, "name": r.name or "", "college": r.college_name or "", "profile_pic": r.profile_pic or "",
                        "checked_in": r.id in done} for r in rows]}

@router.get("/api/events/{event_id}/walkin-search")
async def walkin_search(event_id: int, q: str = "", current_user_id: int = Depends(get_current_user_id)):
    """People with an account who are not registered yet, for walk-ins."""
    event, role, actor = await require_staff(event_id, current_user_id, roles=("owner", "manager", "volunteer"))
    term = q.strip()[:80]
    if len(term) < 2:
        return {"people": []}
    like = f"%{term}%"
    registered = select(DBEventRegistration.user_id).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status.in_(ACTIVE_REG))
    rows = await fetch_one_off(select(DBUser.id, DBUser.name, DBUser.college_name, DBUser.profile_pic).where(
        or_(DBUser.name.ilike(like), DBUser.roll_no.ilike(like), DBUser.email.ilike(like)), DBUser.id.not_in(registered), core.visible_user_clause()).order_by(DBUser.name).limit(15))
    return {"people": [{"id": r.id, "name": r.name or "", "college": r.college_name or "", "profile_pic": r.profile_pic or ""} for r in rows]}


# ---------- organisers: registrations ----------
@router.get("/api/events/{event_id}/registrations")
async def list_registrations(event_id: int, status: str = "", q: str = "", format: str = "", current_user_id: int = Depends(get_current_user_id)):
    """Owners and managers see what the form asked for; volunteers see names and status only; viewers see counts.
    format=csv downloads the list, and every download is written to the audit log."""
    event, role, actor = await require_staff(event_id, current_user_id, roles=STAFF_ROLES)
    manager = role in MANAGERS or actor["founder"]
    counts = dict(await fetch_one_off(select(DBEventRegistration.status, func.count()).where(DBEventRegistration.event_id == event_id).group_by(DBEventRegistration.status)))
    if role == "viewer" and not actor["founder"]:
        return {"counts": counts, "registrations": [], "role": role}
    clause = DBEventRegistration.event_id == event_id
    if status:
        clause = and_(clause, DBEventRegistration.status == status)
    if q.strip():
        like = f"%{q.strip()[:80]}%"
        clause = and_(clause, or_(DBUser.name.ilike(like), DBUser.roll_no.ilike(like), DBUser.email.ilike(like)))
    rows = await fetch_one_off(select(DBEventRegistration, DBUser.name, DBUser.department, DBUser.college_name, DBUser.profile_pic)
                               .join(DBUser, DBUser.id == DBEventRegistration.user_id, isouter=True).where(clause).order_by(DBEventRegistration.id).limit(5000))
    checked = dict(await fetch_one_off(select(DBEventCheckin.registration_id, DBEventCheckin.checked_at).where(DBEventCheckin.event_id == event_id, DBEventCheckin.session_key == "")))
    teams = dict(await fetch_one_off(select(DBEventTeam.id, DBEventTeam.name).where(DBEventTeam.event_id == event_id)))
    questions = jload(event.form_fields, [])
    fields = [f for f in (event.collect_fields or "").split(",") if f]
    out = []
    for reg, name, department, college, pic in rows:
        item = {"id": reg.id, "user_id": reg.user_id, "name": name or "Deleted user", "status": reg.status, "checked_in_at": checked.get(reg.id, ""),
                "team": teams.get(reg.team_id, "") if reg.team_id else "", "profile_pic": pic or ""}
        if manager:
            item.update({"profile": jload(reg.profile, {}), "answers": jload(reg.answers, {}), "department": department or "", "college": college or "",
                         "created_at": reg.created_at, "ref_code": reg.ref_code or "", "note": reg.note or "", "consents": jload(reg.consents, {}),
                         "looking_for_team": bool(reg.looking_for_team)})
        out.append(item)
    if format == "csv":
        if not manager:
            raise HTTPException(status_code=403, detail="Only owners and managers can download the list.")
        spawn_background(audit(event_id, current_user_id, "exported_registrations", {"rows": len(out), "status": status}))
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["Registration", "Status", "Checked in"] + [PROFILE_FIELDS[f] for f in fields] + [qn["label"] for qn in questions] + ["Team", "Registered at", "Source"])
        for item in out:
            answers = item["answers"]
            writer.writerow([item["id"], item["status"], local_label(item["checked_in_at"]) if item["checked_in_at"] else ""]
                            + [csv_safe(item["profile"].get(f, "")) for f in fields]
                            + [csv_safe(", ".join(map(str, answers.get(qn["key"], []))) if isinstance(answers.get(qn["key"]), list) else answers.get(qn["key"], "")) for qn in questions]
                            + [csv_safe(item["team"]), local_label(item["created_at"]), item["ref_code"]])
        return Response(content="﻿" + buffer.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{event.slug or "event"}-registrations.csv"'})
    return {"counts": counts, "registrations": out, "role": role or "manager", "questions": questions, "fields": fields}

def csv_safe(value) -> str:
    """Spreadsheet programs run cells that start with = + - @ as formulas; a leading quote stops that."""
    value = str(value or "")
    return "'" + value if value[:1] in ("=", "+", "-", "@") else value

class BulkBody(BaseModel):
    ids: List[int]
    action: str                      # approve, reject, waitlist, confirm, remove
    reason: Optional[str] = ""

@router.patch("/api/events/{event_id}/registrations")
async def bulk_registrations(event_id: int, body: BulkBody, current_user_id: int = Depends(get_current_user_id)):
    event, role, actor = await require_staff(event_id, current_user_id)
    target = {"approve": "confirmed", "confirm": "confirmed", "reject": "rejected", "waitlist": "waitlisted", "remove": "removed"}.get(body.action)
    if not target:
        raise HTTPException(status_code=400, detail="Unknown action.")
    reason = clean_text(body.reason, 300, "reason")
    ids = list(dict.fromkeys(body.ids))[:1000]
    if not ids:
        raise HTTPException(status_code=400, detail="Pick at least one person.")
    now = now_iso()
    moved = []
    async with SessionLocal() as db:
        async with db.begin():
            capacity = (await db.execute(select(DBEvent.capacity).where(DBEvent.id == event_id).with_for_update())).scalar() or 0
            rows = (await db.execute(select(DBEventRegistration.id, DBEventRegistration.user_id, DBEventRegistration.status, DBEventRegistration.qr_version)
                                     .where(DBEventRegistration.event_id == event_id, DBEventRegistration.id.in_(ids)))).all()
            confirmed = (await db.execute(select(func.count()).select_from(DBEventRegistration).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status == "confirmed"))).scalar() or 0
            for reg_id, user_id, current, version in rows:
                if current == target:
                    continue
                if target == "confirmed":
                    if capacity and confirmed >= capacity and not reason:
                        raise HTTPException(status_code=409, detail=f"The event is full ({capacity} seats). Give a reason to add people beyond the limit, or raise the capacity.")
                    confirmed += 1
                values = {"status": target, "updated_at": now, "note": reason or ""}
                if target == "confirmed":
                    values["confirmed_at"] = now
                if target == "waitlisted":
                    values["waitlisted_at"] = now
                if target in ("rejected", "removed"):
                    values["qr_version"] = (version or 1) + 1
                await db.execute(update(DBEventRegistration).where(DBEventRegistration.id == reg_id).values(**values))
                moved.append((reg_id, user_id))
    texts = {"confirmed": f"You are registered for \"{event.title}\". Your ticket is ready.",
             "rejected": f"Your registration for \"{event.title}\" was not accepted." + (f" {reason}" if reason else ""),
             "waitlisted": f"You are on the waitlist for \"{event.title}\".", "removed": f"You were removed from \"{event.title}\"." + (f" {reason}" if reason else "")}
    for reg_id, user_id in moved:
        notify([user_id], texts[target], f"ticket.html?reg={reg_id}" if target == "confirmed" else f"event.html?id={event_id}")
    spawn_background(audit(event_id, current_user_id, f"registrations_{body.action}", {"ids": [r for r, _ in moved], "reason": reason}))
    if target in ("rejected", "removed", "waitlisted"):
        spawn_background(promote_waitlist(event_id))
    return {"changed": len(moved)}

class AddPersonBody(BaseModel):
    user_id: int
    reason: str

@router.post("/api/events/{event_id}/registrations/add")
async def add_registration(event_id: int, body: AddPersonBody, current_user_id: int = Depends(get_current_user_id)):
    """An organiser adds someone after the deadline or past the limits. The reason goes to the audit log."""
    event, role, actor = await require_staff(event_id, current_user_id)
    reason = clean_text(body.reason, 300, "reason")
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Give a reason for adding someone by hand.")
    reg = await walk_in(event, body.user_id, current_user_id)
    await run_one_off(update(DBEventRegistration).where(DBEventRegistration.id == reg.id).values(note=reason))
    notify([body.user_id], f"The organisers registered you for \"{event.title}\". Your ticket is ready.", f"ticket.html?reg={reg.id}")
    spawn_background(audit(event_id, current_user_id, "added_by_hand", {"user_id": body.user_id, "reason": reason}))
    return {"id": reg.id}


# ---------- organisers: announcements ----------
class AnnouncementBody(BaseModel):
    title: str
    body: Optional[str] = ""
    audience: str = "all"
    channels: Optional[List[str]] = None   # push, email (the bell is always used)
    pinned: Optional[bool] = False
    send_at: Optional[str] = ""

async def audience_ids(event_id: int, audience: str) -> list:
    clause = DBEventRegistration.event_id == event_id
    checked = select(DBEventCheckin.registration_id).where(DBEventCheckin.event_id == event_id, DBEventCheckin.session_key == "")
    if audience == "all":
        clause = and_(clause, DBEventRegistration.status.in_(ACTIVE_REG))
    elif audience in ("confirmed", "waitlisted", "pending"):
        clause = and_(clause, DBEventRegistration.status == audience)
    elif audience == "checked_in":
        clause = and_(clause, DBEventRegistration.id.in_(checked))
    elif audience == "not_checked_in":
        clause = and_(clause, DBEventRegistration.status.in_(("confirmed", "no_show")), DBEventRegistration.id.not_in(checked))
    elif audience.startswith("team:") and audience[5:].isdigit():
        clause = and_(clause, DBEventRegistration.team_id == int(audience[5:]), DBEventRegistration.status.in_(ACTIVE_REG))
    else:
        raise HTTPException(status_code=400, detail="Pick who gets the announcement.")
    return [uid for (uid,) in await fetch_one_off(select(DBEventRegistration.user_id).where(clause))]

async def send_announcement(announcement_id: int):
    rows = await fetch_one_off(select(DBEventAnnouncement, DBEvent).join(DBEvent, DBEvent.id == DBEventAnnouncement.event_id).where(DBEventAnnouncement.id == announcement_id))
    if not rows:
        return
    a, event = rows[0]
    claimed = await run_returning(update(DBEventAnnouncement).where(DBEventAnnouncement.id == announcement_id, DBEventAnnouncement.sent_at == "")
                                  .values(sent_at=now_iso()).returning(DBEventAnnouncement.id))
    if not claimed:
        return
    ids = await audience_ids(a.event_id, a.audience)
    channels = (a.channels or "").split(",")
    content = f"{event.title}: {a.title}" + (f". {a.body[:200]}" if a.body else "")
    if "push" in channels:
        notify(ids, content, f"event.html?id={a.event_id}")
    else:
        try:
            now = utc_now_iso()
            if ids:
                await run_one_off(core.DBNotification.__table__.insert().values([{"user_id": uid, "type": "event", "content": content[:300], "timestamp": now,
                                                                                  "link": f"event.html?id={a.event_id}", "is_read": 0} for uid in ids]))
        except Exception as e:
            print("Error saving announcement notifications:", e)
    if "email" in channels:
        await email_people(ids, f"{event.title}: {a.title}", [a.title] + ([a.body] if a.body else []), f"event.html?id={a.event_id}")
    await run_one_off(update(DBEventAnnouncement).where(DBEventAnnouncement.id == announcement_id).values(recipients=len(ids)))

@router.post("/api/events/{event_id}/announcements")
async def create_announcement(event_id: int, body: AnnouncementBody, current_user_id: int = Depends(get_current_user_id)):
    event, role, actor = await require_staff(event_id, current_user_id)
    title = clean_text(body.title, 120, "title")
    if len(title) < 3:
        raise HTTPException(status_code=400, detail="Give the announcement a title.")
    text_ = clean_text(body.body, 2000, "message")
    await audience_ids(event_id, body.audience)          # checks the audience
    channels = ",".join(["bell"] + [c for c in (body.channels or []) if c in ("push", "email")])
    send_at = ""
    if body.send_at:
        moment = parse_moment(body.send_at)
        if moment and moment > datetime.now(UTC) + timedelta(minutes=1):
            send_at = iso(moment)
    if not actor["founder"]:
        day_start = iso(datetime.combine(site_now().date(), datetime.min.time(), tzinfo=SITE_TZ))
        today = await fetch_one_off(select(func.count()).select_from(DBEventAnnouncement).where(DBEventAnnouncement.event_id == event_id, DBEventAnnouncement.created_at >= day_start))
        limit = LICENCE_ANNOUNCEMENTS_DAILY if (event.college_key and await college_licence(event.college_key)) else FREE_ANNOUNCEMENTS_DAILY
        if (today[0][0] or 0) >= limit:
            raise HTTPException(status_code=402, detail=f"An event can send {limit} announcements a day on its plan. Try again tomorrow.")
    rows = await run_returning(DBEventAnnouncement.__table__.insert().values(event_id=event_id, author_id=current_user_id, title=title, body=text_, audience=body.audience,
                                                                             channels=channels, pinned=1 if body.pinned else 0, send_at=send_at, sent_at="", created_at=now_iso())
                               .returning(DBEventAnnouncement.id))
    announcement_id = rows[0][0]
    spawn_background(audit(event_id, current_user_id, "announcement", {"title": title, "audience": body.audience, "scheduled": bool(send_at)}))
    if not send_at:
        await send_announcement(announcement_id)
    return {"id": announcement_id, "scheduled_for": send_at}

@router.patch("/api/events/{event_id}/announcements/{announcement_id}")
async def pin_announcement(event_id: int, announcement_id: int, pinned: bool = True, current_user_id: int = Depends(get_current_user_id)):
    await require_staff(event_id, current_user_id)
    await run_one_off(update(DBEventAnnouncement).where(DBEventAnnouncement.id == announcement_id, DBEventAnnouncement.event_id == event_id).values(pinned=1 if pinned else 0))
    return {"ok": True}

@router.delete("/api/events/{event_id}/announcements/{announcement_id}")
async def delete_announcement(event_id: int, announcement_id: int, current_user_id: int = Depends(get_current_user_id)):
    """Removes it from the page (and stops it if it was only scheduled). Bells already sent stay."""
    await require_staff(event_id, current_user_id)
    await run_one_off(delete(DBEventAnnouncement).where(DBEventAnnouncement.id == announcement_id, DBEventAnnouncement.event_id == event_id))
    return {"ok": True}


# ---------- organisers: staff ----------
class StaffBody(BaseModel):
    user_id: Optional[int] = None
    email: Optional[str] = ""
    role: str = "volunteer"

@router.get("/api/events/{event_id}/staff")
async def list_staff(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    await require_staff(event_id, current_user_id, roles=STAFF_ROLES)
    rows = await fetch_one_off(select(DBEventStaff.user_id, DBEventStaff.role).where(DBEventStaff.event_id == event_id))
    people = await people_by_id([u for u, _ in rows])
    order = {role: i for i, role in enumerate(STAFF_ROLES)}
    return {"staff": sorted([dict(people.get(u, {"id": u, "name": "Deleted user"}), role=r) for u, r in rows], key=lambda s: (order.get(s["role"], 9), s["name"]))}

@router.post("/api/events/{event_id}/staff")
async def add_staff(event_id: int, body: StaffBody, current_user_id: int = Depends(get_current_user_id)):
    """Only the owner adds or removes staff (the spec's role table)."""
    event, role, actor = await require_staff(event_id, current_user_id, roles=("owner",))
    if body.role not in ("manager", "volunteer", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be manager, volunteer or viewer.")
    user_id = body.user_id
    if not user_id and body.email:
        rows = await fetch_one_off(select(DBUser.id).where(func.lower(DBUser.email) == body.email.strip().lower(), core.visible_user_clause()))
        user_id = rows[0][0] if rows else None
    if not user_id or not await people_by_id([user_id]):
        raise HTTPException(status_code=404, detail="Nobody with that account was found.")
    if user_id == event.created_by and role == "owner" and user_id == current_user_id:
        raise HTTPException(status_code=400, detail="You are the owner.")
    current = await staff_role(event_id, user_id)
    if current == "owner":
        raise HTTPException(status_code=400, detail="To change the owner, transfer ownership.")
    await run_one_off(pg_insert(DBEventStaff).values(event_id=event_id, user_id=user_id, role=body.role, added_by=current_user_id, created_at=now_iso())
                      .on_conflict_do_update(index_elements=["event_id", "user_id"], set_={"role": body.role}))
    notify([user_id], f"You were added to \"{event.title}\" as {body.role}.", f"event-manage.html?id={event_id}" if body.role != "volunteer" else f"event-checkin.html?id={event_id}")
    spawn_background(audit(event_id, current_user_id, "staff_added", {"user_id": user_id, "role": body.role}))
    return {"ok": True, "user_id": user_id}

@router.delete("/api/events/{event_id}/staff/{user_id}")
async def remove_staff(event_id: int, user_id: int, current_user_id: int = Depends(get_current_user_id)):
    if user_id != current_user_id:
        await require_staff(event_id, current_user_id, roles=("owner",))
    if await staff_role(event_id, user_id) == "owner":
        raise HTTPException(status_code=400, detail="The owner cannot be removed. Transfer ownership first.")
    await run_one_off(delete(DBEventStaff).where(DBEventStaff.event_id == event_id, DBEventStaff.user_id == user_id))
    spawn_background(audit(event_id, current_user_id, "staff_removed", {"user_id": user_id}))
    return {"ok": True}

class TransferBody(BaseModel):
    user_id: int

@router.post("/api/events/{event_id}/transfer")
async def transfer_ownership(event_id: int, body: TransferBody, current_user_id: int = Depends(get_current_user_id)):
    """The new owner must already be a manager. The old owner stays on as a manager."""
    event, role, actor = await require_staff(event_id, current_user_id, roles=("owner",))
    if await staff_role(event_id, body.user_id) != "manager":
        raise HTTPException(status_code=400, detail="Make the person a manager first, then transfer ownership to them.")
    await asyncio.gather(
        run_one_off(update(DBEventStaff).where(DBEventStaff.event_id == event_id, DBEventStaff.user_id == body.user_id).values(role="owner")),
        run_one_off(update(DBEventStaff).where(DBEventStaff.event_id == event_id, DBEventStaff.role == "owner", DBEventStaff.user_id != body.user_id).values(role="manager")))
    notify([body.user_id], f"You are now the owner of \"{event.title}\".", f"event-manage.html?id={event_id}")
    spawn_background(audit(event_id, current_user_id, "ownership_transferred", {"to": body.user_id}))
    return {"ok": True}

@router.get("/api/events/{event_id}/audit")
async def get_audit(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    await require_staff(event_id, current_user_id)
    rows = await fetch_one_off(select(DBEventAudit).where(DBEventAudit.event_id == event_id).order_by(DBEventAudit.id.desc()).limit(300))
    people = await people_by_id([a.actor_id for (a,) in rows])
    return {"log": [{"id": a.id, "action": a.action, "details": jload(a.details, {}), "at": a.created_at,
                     "actor": people.get(a.actor_id, {}).get("name", "Connect2Minds" if not a.actor_id else "Deleted user")} for (a,) in rows]}

@router.get("/api/events/{event_id}/overview")
async def event_overview(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    """The dashboard's first tab: counters, the sources of registrations, a to-do list and the approval history."""
    event, role, actor = await require_staff(event_id, current_user_id, roles=STAFF_ROLES)
    counts, stats, sources, approvals, announcements, certs, staff = await asyncio.gather(
        fetch_one_off(select(DBEventRegistration.status, func.count()).where(DBEventRegistration.event_id == event_id).group_by(DBEventRegistration.status)),
        checkin_stats(event_id),
        fetch_one_off(select(DBEventRegistration.ref_code, func.count()).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status.in_(ACTIVE_REG + ("no_show",)))
                      .group_by(DBEventRegistration.ref_code)),
        fetch_one_off(select(DBEventApproval).where(DBEventApproval.event_id == event_id).order_by(DBEventApproval.id)),
        fetch_one_off(select(func.count()).select_from(DBEventAnnouncement).where(DBEventAnnouncement.event_id == event_id)),
        fetch_one_off(select(func.count()).select_from(DBEventCertificate).where(DBEventCertificate.event_id == event_id)),
        fetch_one_off(select(func.count()).select_from(DBEventStaff).where(DBEventStaff.event_id == event_id)))
    approvers = await people_by_id([a.approver_id for (a,) in approvals])
    count_map = dict(counts)
    todo = [
        {"label": "Add a poster", "done": bool(event.poster_url), "tab": "settings"},
        {"label": "Get it approved and published", "done": event.status in ("published", "completed", "archived"), "tab": "overview"},
        {"label": "Share the link or print the QR poster", "done": (event.view_count or 0) > 0, "tab": "overview"},
        {"label": "Add volunteers for check-in", "done": (staff[0][0] or 0) > 1, "tab": "staff"},
        {"label": "Send a first announcement", "done": (announcements[0][0] or 0) > 0, "tab": "communication"},
        {"label": "Issue certificates after the event", "done": (certs[0][0] or 0) > 0 or not event.certificates_on, "tab": "certificates"},
    ]
    return {"counts": count_map, "views": event.view_count or 0, "checkin": stats, "sources": {(k or "direct"): v for k, v in sources},
            "todo": todo, "approvals": [{"step": a.step, "decision": a.decision, "comment": a.comment, "at": a.created_at,
                                         "by": approvers.get(a.approver_id, {}).get("name", "")} for (a,) in approvals],
            "my_role": role or "manager"}


# ---------- certificates ----------
def certificate_dict(cert: DBEventCertificate, title: str, start: str) -> dict:
    return {"id": cert.id, "event_id": cert.event_id, "event_title": title, "event_date": start, "kind": cert.kind, "code": cert.code,
            "holder_name": cert.holder_name, "issued_at": cert.issued_at, "revoked": bool(cert.revoked_at), "on_profile": bool(cert.on_profile),
            "verify_url": f"{SITE_URL}/certificate-check.html?code={cert.code}"}

def new_certificate_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"    # no 0/O or 1/I: codes are typed in by people
    return "C2M-" + "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))

async def issue_participation(event: DBEvent, issued_by: int) -> int:
    """Participation certificates for everyone checked in who does not have one yet."""
    rows = await fetch_one_off(select(DBEventRegistration.user_id, DBEventRegistration.profile, DBUser.name)
                               .join(DBEventCheckin, and_(DBEventCheckin.registration_id == DBEventRegistration.id, DBEventCheckin.session_key == ""))
                               .join(DBUser, DBUser.id == DBEventRegistration.user_id)
                               .where(DBEventRegistration.event_id == event.id))
    if not rows:
        return 0
    now = now_iso()
    values = [{"event_id": event.id, "user_id": uid, "kind": "participation", "code": new_certificate_code(), "holder_name": (jload(profile, {}).get("name") or name or "")[:120],
               "issued_by": issued_by or None, "issued_at": now, "revoked_at": "", "on_profile": 0} for uid, profile, name in rows]
    made = await run_returning(pg_insert(DBEventCertificate).values(values).on_conflict_do_nothing(index_elements=["event_id", "user_id", "kind"])
                               .returning(DBEventCertificate.user_id))
    ids = [u for (u,) in made]
    notify(ids, f"Your certificate for \"{event.title}\" is ready.", "my-events.html?tab=certificates")
    return len(ids)

@router.post("/api/events/{event_id}/certificates/generate")
async def generate_certificates(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    event, role, actor = await require_staff(event_id, current_user_id)
    if event.start_at and now_iso() < event.start_at:
        raise HTTPException(status_code=409, detail="Certificates can be issued once the event has started.")
    issued = await issue_participation(event, current_user_id)
    spawn_background(audit(event_id, current_user_id, "certificates_issued", {"count": issued}))
    return {"issued": issued}

@router.get("/api/events/{event_id}/certificates")
async def list_certificates(event_id: int, current_user_id: int = Depends(get_current_user_id)):
    event, role, actor = await require_staff(event_id, current_user_id)
    rows = await fetch_one_off(select(DBEventCertificate).where(DBEventCertificate.event_id == event_id).order_by(DBEventCertificate.holder_name))
    return {"certificates": [certificate_dict(c, event.title, event.start_at) for (c,) in rows]}

@router.post("/api/events/{event_id}/certificates/{certificate_id}/revoke")
async def revoke_certificate(event_id: int, certificate_id: int, current_user_id: int = Depends(get_current_user_id)):
    await require_staff(event_id, current_user_id)
    rows = await run_returning(update(DBEventCertificate).where(DBEventCertificate.id == certificate_id, DBEventCertificate.event_id == event_id, DBEventCertificate.revoked_at == "")
                               .values(revoked_at=now_iso()).returning(DBEventCertificate.user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Certificate not found or already revoked.")
    spawn_background(audit(event_id, current_user_id, "certificate_revoked", {"certificate_id": certificate_id}))
    return {"ok": True}

@router.get("/api/certificates/{code}")
@limiter.limit("60/minute")
async def verify_certificate(request: Request, code: str):
    """Public: anyone can check a certificate code. Shows only what is printed on the certificate itself."""
    clean = re.sub(r"[^A-Z0-9-]", "", (code or "").upper())[:20]
    rows = await fetch_one_off(select(DBEventCertificate, DBEvent).join(DBEvent, DBEvent.id == DBEventCertificate.event_id).where(DBEventCertificate.code == clean))
    if not rows:
        raise HTTPException(status_code=404, detail="No certificate has this code. Check it letter by letter.")
    cert, event = rows[0]
    hosts, people = await asyncio.gather(hosts_by_id([event.host_id]), people_by_id([event.created_by]))
    host = await host_label(event, hosts, people)
    return {"code": cert.code, "holder_name": cert.holder_name, "kind": cert.kind, "event_title": event.title, "event_date": event.start_at,
            "event_end": event.end_at, "host": host["name"], "host_verified": host.get("verified", False), "college_name": event.college_name or "",
            "issued_at": cert.issued_at, "valid": not cert.revoked_at, "revoked_at": cert.revoked_at or ""}

@router.get("/api/me/certificates/{certificate_id}")
async def my_certificate(certificate_id: int, current_user_id: int = Depends(get_current_user_id)):
    rows = await fetch_one_off(select(DBEventCertificate, DBEvent).join(DBEvent, DBEvent.id == DBEventCertificate.event_id)
                               .where(DBEventCertificate.id == certificate_id, DBEventCertificate.user_id == current_user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Certificate not found.")
    cert, event = rows[0]
    hosts, people = await asyncio.gather(hosts_by_id([event.host_id]), people_by_id([event.created_by]))
    return dict(certificate_dict(cert, event.title, event.start_at), host=(await host_label(event, hosts, people))["name"], college_name=event.college_name or "",
                venue=event.venue or ("Online" if event.mode == "online" else ""), organiser=people.get(event.created_by, {}).get("name", ""))

class CertificateSettingsBody(BaseModel):
    on_profile: bool

@router.patch("/api/me/certificates/{certificate_id}")
async def certificate_settings(certificate_id: int, body: CertificateSettingsBody, current_user_id: int = Depends(get_current_user_id)):
    rows = await run_returning(update(DBEventCertificate).where(DBEventCertificate.id == certificate_id, DBEventCertificate.user_id == current_user_id)
                               .values(on_profile=1 if body.on_profile else 0).returning(DBEventCertificate.id))
    if not rows:
        raise HTTPException(status_code=404, detail="Certificate not found.")
    return {"ok": True}

@router.get("/api/users/{user_id}/event-record")
async def event_record(user_id: int, current_user_id: int = Depends(get_current_user_id)):
    """For the profile: certificates the person chose to show, and how many events they organised that went ahead."""
    certs, organised = await asyncio.gather(
        fetch_one_off(select(DBEventCertificate, DBEvent.title, DBEvent.start_at).join(DBEvent, DBEvent.id == DBEventCertificate.event_id)
                      .where(DBEventCertificate.user_id == user_id, DBEventCertificate.revoked_at == "",
                             or_(DBEventCertificate.on_profile == 1, literal(user_id == current_user_id))).order_by(DBEventCertificate.id.desc()).limit(30)),
        fetch_one_off(select(func.count()).select_from(DBEvent).join(DBEventStaff, and_(DBEventStaff.event_id == DBEvent.id, DBEventStaff.user_id == user_id))
                      .where(DBEvent.status.in_(("completed", "archived")), DBEvent.deleted_at == "", DBEventStaff.role.in_(MANAGERS))))
    return {"certificates": [certificate_dict(c, title, start) for c, title, start in certs], "organised": organised[0][0] or 0}


# ---------- reports (section 31) ----------
async def event_report_target(target_id: int, reporter_id: int) -> tuple:
    rows = await fetch_one_off(select(DBEvent).where(DBEvent.id == target_id, DBEvent.deleted_at == ""))
    if not rows or not await may_view(rows[0][0], await actor_of(reporter_id)):
        raise HTTPException(status_code=404, detail="We could not find that, or you cannot see it.")
    event = rows[0][0]
    return event.created_by, f"Event: {event.title}\n{(event.description or '')[:1500]}", f"event.html?id={event.id}"

async def remove_event(target_id: int):
    rows = await run_returning(update(DBEvent).where(DBEvent.id == target_id).values(status="removed", updated_at=now_iso(),
                                                                                       cancelled_reason="Removed by Connect2Minds for breaking the honour code.")
                               .returning(DBEvent.title))
    if rows:
        regs = await fetch_one_off(select(DBEventRegistration.user_id).where(DBEventRegistration.event_id == target_id, DBEventRegistration.status.in_(ACTIVE_REG)))
        notify([u for (u,) in regs], f"\"{rows[0][0]}\" was removed by Connect2Minds and will not take place on this site.", "my-events.html")

EXTRA_REPORT_TARGETS["event"] = (event_report_target, remove_event)


# ---------- founder ----------
@router.get("/api/founder/events")
async def founder_events(status: str = "", q: str = "", founder_id: int = Depends(require_founder)):
    clause = DBEvent.deleted_at == ""
    if status:
        clause = and_(clause, DBEvent.status == status)
    if q.strip():
        clause = and_(clause, or_(DBEvent.title.ilike(f"%{q.strip()[:80]}%"), DBEvent.college_name.ilike(f"%{q.strip()[:80]}%")))
    rows, reported, totals = await asyncio.gather(
        fetch_one_off(select(DBEvent).where(clause).order_by(DBEvent.id.desc()).limit(200)),
        fetch_one_off(select(DBContentReport.target_id, func.count()).where(DBContentReport.target_kind == "event", DBContentReport.status.in_(("open", "reviewing")))
                      .group_by(DBContentReport.target_id)),
        fetch_one_off(select(DBEvent.status, func.count()).where(DBEvent.deleted_at == "").group_by(DBEvent.status)))
    actor = await actor_of(founder_id)
    reports = dict(reported)
    cards = await cards_for([e for (e,) in rows], actor)
    return {"events": [dict(c, open_reports=reports.get(c["id"], 0), hidden=reports.get(c["id"], 0) >= EVENT_REPORTS_TO_HIDE) for c in cards], "totals": dict(totals)}

class FeatureBody(BaseModel):
    featured: bool

@router.post("/api/founder/events/{event_id}/feature")
async def feature_event(event_id: int, body: FeatureBody, founder_id: int = Depends(require_founder)):
    await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(featured=1 if body.featured else 0))
    spawn_background(audit(event_id, founder_id, "featured" if body.featured else "unfeatured"))
    return {"ok": True}

@router.post("/api/founder/events/{event_id}/unpublish")
async def unpublish_event(event_id: int, body: CancelBody, founder_id: int = Depends(require_founder)):
    reason = clean_text(body.reason, 500, "reason")
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="Give a reason; the organiser sees it.")
    event = await load_event(event_id)
    await run_one_off(update(DBEvent).where(DBEvent.id == event_id).values(status="changes", reviewer_note=reason, approval_index=0, updated_at=now_iso()))
    notify([event.created_by], f"\"{event.title}\" was taken down by Connect2Minds: {reason}. Edit it and submit it again.", f"event-manage.html?id={event_id}")
    spawn_background(audit(event_id, founder_id, "unpublished", {"reason": reason}))
    return {"ok": True}


# ---------- Home (section 21): "needs you" items about events ----------
async def home_event_items(user_id: int) -> list:
    """Event tomorrow or today (open your ticket), registration closing for a saved event, approvals waiting for a teacher.
    One round of reads, plus one more for teachers and admins."""
    now = datetime.now(UTC)
    soon = iso(now + timedelta(hours=36))
    items = []
    regs, saved, actor = await asyncio.gather(
        fetch_one_off(select(DBEventRegistration.id, DBEvent.id, DBEvent.title, DBEvent.start_at).join(DBEvent, DBEvent.id == DBEventRegistration.event_id)
                      .where(DBEventRegistration.user_id == user_id, DBEventRegistration.status == "confirmed", DBEvent.status == "published",
                             DBEvent.start_at >= iso(now - timedelta(hours=2)), DBEvent.start_at <= soon).order_by(DBEvent.start_at).limit(3)),
        fetch_one_off(select(DBEvent.id, DBEvent.title, DBEvent.reg_close_at).join(DBEventSave, DBEventSave.event_id == DBEvent.id)
                      .where(DBEventSave.user_id == user_id, DBEvent.status == "published", DBEvent.reg_close_at >= iso(now), DBEvent.reg_close_at <= soon,
                             DBEvent.id.not_in(select(DBEventRegistration.event_id).where(DBEventRegistration.user_id == user_id))).limit(2)),
        actor_of(user_id))
    for reg_id, event_id, title, start in regs:
        local = when(start).astimezone(SITE_TZ)
        day = "Today" if local.date() == site_now().date() else "Tomorrow"
        items.append(core.home_item("event", f"{day}: {title}", f"Starts {local.strftime('%I:%M %p').lstrip('0')}. Open your ticket at the entrance.",
                                    f"ticket.html?reg={reg_id}", local.date().isoformat(), urgent=day == "Today"))
    for event_id, title, close in saved:
        items.append(core.home_item("event", f"Registration closes soon: {title}", f"Closes {local_label(close)}.", f"event.html?id={event_id}",
                                    when(close).astimezone(SITE_TZ).date().isoformat()))
    if actor["teacher_key"] or actor["admin_colleges"]:
        colleges = [c for c in {actor["teacher_key"]} | actor["admin_colleges"] if c]
        waiting = await fetch_one_off(select(DBEvent.approval_steps, DBEvent.approval_index, DBEvent.college_key, DBEvent.created_by).where(
            DBEvent.deleted_at == "", DBEvent.college_key.in_(colleges), or_(DBEvent.status == "pending", DBEvent.change_status == "pending")))
        mine = 0
        for steps, index, key, created_by in waiting:
            steps = jload(steps, [])
            step = steps[index or 0] if (index or 0) < len(steps) else "founder"
            if can_approve_step(actor, step, key) and created_by != user_id:
                mine += 1
        if mine:
            items.append(core.home_item("event", f"{mine} event{'s' if mine > 1 else ''} to approve", "Students are waiting for your decision.",
                                        "college-hub.html?tab=events", "", urgent=True))
    return items


# ---------- the watcher ----------
async def events_pass(now: Optional[datetime] = None) -> dict:
    """Runs every minute. Each step is safe to repeat, and one-time messages are claimed so they go out once."""
    now = now or datetime.now(UTC)
    stamp = iso(now)
    done = {"completed": 0, "reminders": 0, "announcements": 0, "promoted": 0, "nudges": 0, "locked": 0}

    # Scheduled announcements
    due = await fetch_one_off(select(DBEventAnnouncement.id).where(DBEventAnnouncement.sent_at == "", DBEventAnnouncement.send_at != "", DBEventAnnouncement.send_at <= stamp))
    for (announcement_id,) in due:
        await send_announcement(announcement_id)
        done["announcements"] += 1

    # Reminders 24 hours and 1 hour before
    upcoming = await fetch_one_off(select(DBEvent.id, DBEvent.title, DBEvent.start_at).where(
        DBEvent.status == "published", DBEvent.deleted_at == "", DBEvent.start_at > stamp, DBEvent.start_at <= iso(now + timedelta(hours=24))))
    for event_id, title, start in upcoming:
        hours = (when(start) - now).total_seconds() / 3600
        key = "1h" if hours <= 1 else "24h"
        regs = await fetch_one_off(select(DBEventRegistration.user_id, DBEventRegistration.id).where(DBEventRegistration.event_id == event_id, DBEventRegistration.status == "confirmed"))
        fresh = await claim_reminders([(uid, f"ev:{event_id}:{key}") for uid, _ in regs])
        reg_of = dict(regs)
        for uid, _ in fresh:
            text_ = f"\"{title}\" starts in an hour. Keep your ticket ready." if key == "1h" else f"Tomorrow: \"{title}\" at {local_label(start)}. Your ticket is in My events."
            notify([uid], text_, f"ticket.html?reg={reg_of[uid]}")
            done["reminders"] += 1
        # People who saved the event but did not register: registration closes within a day
    closing = await fetch_one_off(select(DBEvent.id, DBEvent.title, DBEvent.reg_close_at).where(
        DBEvent.status == "published", DBEvent.deleted_at == "", DBEvent.reg_close_at > stamp, DBEvent.reg_close_at <= iso(now + timedelta(hours=24))))
    for event_id, title, close in closing:
        savers = await fetch_one_off(select(DBEventSave.user_id).where(DBEventSave.event_id == event_id, DBEventSave.user_id.not_in(
            select(DBEventRegistration.user_id).where(DBEventRegistration.event_id == event_id))))
        fresh = await claim_reminders([(uid, f"ev:{event_id}:closing") for (uid,) in savers])
        notify([uid for uid, _ in fresh], f"Registration for \"{title}\", which you saved, closes {local_label(close)}.", f"event.html?id={event_id}")
        done["reminders"] += len(fresh)

    # Lock teams when registration closes; tell leaders of teams that are too small
    to_lock = await fetch_one_off(select(DBEvent.id, DBEvent.title, DBEvent.team_min).where(DBEvent.is_team_event == 1, DBEvent.status == "published",
                                                                                            DBEvent.reg_close_at != "", DBEvent.reg_close_at <= stamp))
    for event_id, title, team_min in to_lock:
        locked = await run_returning(update(DBEventTeam).where(DBEventTeam.event_id == event_id, DBEventTeam.locked == 0).values(locked=1).returning(DBEventTeam.id, DBEventTeam.leader_id, DBEventTeam.name))
        for team_id, leader_id, name in locked:
            size = len(await team_members(team_id))
            if size < (team_min or 1):
                notify([leader_id], f"Your team {name} has {size} member{'s' if size != 1 else ''}; \"{title}\" needs at least {team_min}. Talk to the organisers.", f"event.html?id={event_id}")
            done["locked"] += 1

    # Seats freed by anything (cancellations, removals, deleted accounts) go to the waitlist
    waiting = await fetch_one_off(select(DBEventRegistration.event_id).join(DBEvent, DBEvent.id == DBEventRegistration.event_id)
                                  .where(DBEventRegistration.status == "waitlisted", DBEvent.status == "published", DBEvent.capacity > 0).distinct())
    for (event_id,) in waiting:
        done["promoted"] += await promote_waitlist(event_id)

    # Ended events: completed, no-shows marked, certificates and organiser XP
    ended = await fetch_one_off(select(DBEvent).where(DBEvent.status == "published", DBEvent.deleted_at == "", DBEvent.end_at != "", DBEvent.end_at < stamp))
    for (event,) in ended:
        claimed = await run_returning(update(DBEvent).where(DBEvent.id == event.id, DBEvent.status == "published").values(status="completed", completed_at=stamp)
                                      .returning(DBEvent.id))
        if not claimed:
            continue
        checked = select(DBEventCheckin.registration_id).where(DBEventCheckin.event_id == event.id, DBEventCheckin.session_key == "")
        await run_one_off(update(DBEventRegistration).where(DBEventRegistration.event_id == event.id, DBEventRegistration.status == "confirmed",
                                                            DBEventRegistration.id.not_in(checked)).values(status="no_show", updated_at=stamp))
        attended = (await checkin_stats(event.id))["checked_in"]
        if event.certificates_on and attended:
            await issue_participation(event, 0)
        if attended >= 5:
            managers = await fetch_one_off(select(DBEventStaff.user_id).where(DBEventStaff.event_id == event.id, DBEventStaff.role.in_(MANAGERS)))
            for (uid,) in managers:
                await award_xp(uid, "event_organise", f"event:{event.id}", 25)
        notify([event.created_by], f"\"{event.title}\" is over: {attended} people checked in. Certificates and the attendance sheet are on the dashboard.",
               f"event-manage.html?id={event.id}")
        spawn_background(audit(event.id, 0, "completed", {"checked_in": attended}))
        done["completed"] += 1

    # Approvals nobody has looked at: a nudge after 48 hours, the founder after 5 days
    waiting_approval = await fetch_one_off(select(DBEvent).where(DBEvent.deleted_at == "", or_(DBEvent.status == "pending", DBEvent.change_status == "pending"),
                                                                 DBEvent.submitted_at != "", DBEvent.submitted_at <= iso(now - timedelta(hours=APPROVAL_NUDGE_HOURS))))
    for (event,) in waiting_approval:
        steps = jload(event.approval_steps, [])
        step = steps[event.approval_index or 0] if (event.approval_index or 0) < len(steps) else "founder"
        late = event.submitted_at <= iso(now - timedelta(days=APPROVAL_ESCALATE_DAYS))
        key = f"ev:{event.id}:{'escalate' if late else 'nudge'}:{event.submitted_at}"
        if await claim_reminders([(0, key)]):
            if late:
                await notify_founders("event", f"\"{event.title}\" has waited {APPROVAL_ESCALATE_DAYS} days for approval.", "founder.html?tab=events")
            else:
                await tell_approvers(event, step, f"Reminder: \"{event.title}\" is still waiting for your approval.")
            done["nudges"] += 1
    return done

async def events_daily(now: Optional[datetime] = None):
    """Once a day: archive old events, anonymise old answers (DPDP: keep only counts), delete orphaned answer files."""
    now = now or datetime.now(UTC)
    await run_one_off(update(DBEvent).where(DBEvent.status == "completed", DBEvent.end_at < iso(now - timedelta(days=ARCHIVE_AFTER_DAYS))).values(status="archived"))
    old = select(DBEvent.id).where(DBEvent.end_at != "", DBEvent.end_at < iso(now - timedelta(days=ANONYMISE_AFTER_DAYS)))
    await run_one_off(update(DBEventRegistration).where(DBEventRegistration.event_id.in_(old), DBEventRegistration.anonymised == 0)
                      .values(answers="{}", profile="{}", consents="{}", ref_code="", note="", anonymised=1))
    if os.path.isdir(ANSWER_FILE_DIR):
        regs = await fetch_one_off(select(DBEventRegistration.event_id, DBEventRegistration.user_id, DBEventRegistration.answers).where(DBEventRegistration.anonymised == 0, DBEventRegistration.answers.like("%ev%_u%")))
        kept = set()
        for _, _, answers in regs:
            for value in jload(answers, {}).values():
                for name in (value if isinstance(value, list) else [value]):
                    kept.add(str(name))
        cutoff = now.timestamp() - 86400
        for name in os.listdir(ANSWER_FILE_DIR):
            path = os.path.join(ANSWER_FILE_DIR, name)
            if name not in kept and os.path.getmtime(path) < cutoff:
                try:
                    os.remove(path)
                except OSError:
                    pass

async def events_watch():
    last_day = ""
    while True:
        try:
            await events_pass()
            today = site_now().date().isoformat()
            if today != last_day:
                last_day = today
                await events_daily()
        except Exception as e:
            print("Error in the events watcher:", e)
        await asyncio.sleep(EVENT_WATCH_SECONDS)

core.HOME_NEED_SOURCES.append(home_event_items)

@core.app.on_event("startup")
async def events_startup():
    spawn_background(events_watch())
