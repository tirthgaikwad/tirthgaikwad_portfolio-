# ==========================================
# 38. GAP FINDER (research.html, gaps.js)
# ==========================================
# Finds research gaps: pairs of a sub-topic of a field and a method or technology (a "lens") that are each written about a lot,
# but almost never together. Counts come from OpenAlex (free open research data). OpenAlex gives a daily budget per key
# (about 1,000 calls with a free OPENALEX_API_KEY, about 100 without one), so:
#   - every result is shared by everyone and kept 30 days (table gap_cache),
#   - a field asked for when the budget is low is queued and scanned later; the people who asked are told when it is ready,
#   - popular fields are scanned in the background while the budget allows.
# No AI is used. People and teams come from Connect2Minds itself. main.py includes this router at its very end.
import asyncio
import json
import math
import os
import re
import time
from datetime import timedelta
from typing import Optional
from urllib.parse import quote_plus

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, select, update, delete, func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert

import main as core
from main import (
    Base, SessionLocal, AutocommitSession, DBUser, DBTeam, DBTeamMember, DBProjectItem,
    get_current_user_id, fetch_one_off, run_one_off, spawn_background, utc_now_iso, parse_timestamp,
    person_cards_query, person_card, create_notification, USER_DATA_KEPT, TeamCreate, TemplateBody,
    create_team, apply_project_template,
)

router = APIRouter()

OPENALEX = "https://api.openalex.org/works"
OPENALEX_KEY = os.getenv("OPENALEX_API_KEY", "")
OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO", "")
CACHE_DAYS = 30
SCAN_CALL_COST = 0.001                   # USD per OpenAlex call, as its headers report
DETAIL_RESERVE = 0.15                    # share of the daily budget kept for opening gaps
SEED_MIN_SHARE = 0.6                     # background scans only while this much of the budget is left
NEW_SCANS_PER_HOUR = 10                  # per account, for fields nobody has scanned yet
MAX_TOPICS = 15
MAX_GAPS = 40

# Methods and technologies a student project could bring to a field. query: OpenAlex search (| is "or"); skills: who can build it.
GAP_LENSES = [
    {"id": "drones", "label": "Drones", "query": 'drone|uav|"unmanned aerial"', "skills": ["drones", "embedded", "computer vision", "python"]},
    {"id": "iot", "label": "IoT sensors", "query": 'iot|"internet of things"|"sensor network"', "skills": ["iot", "arduino", "embedded", "raspberry pi"]},
    {"id": "vision", "label": "Computer vision", "query": '"computer vision"|"object detection"|"image recognition"', "skills": ["computer vision", "opencv", "deep learning", "python"]},
    {"id": "llm", "label": "Large language models", "query": '"large language model"|llm|chatgpt', "skills": ["llm", "nlp", "machine learning", "python"]},
    {"id": "ml", "label": "Machine learning", "query": '"machine learning"|"deep learning"', "skills": ["machine learning", "deep learning", "python", "data science"]},
    {"id": "blockchain", "label": "Blockchain", "query": "blockchain|\"smart contract\"", "skills": ["blockchain", "solidity", "web3"]},
    {"id": "arvr", "label": "AR / VR", "query": '"augmented reality"|"virtual reality"', "skills": ["unity", "ar", "vr", "3d"]},
    {"id": "robotics", "label": "Robotics", "query": "robot|robotics", "skills": ["robotics", "ros", "embedded", "c++"]},
    {"id": "satellite", "label": "Satellite imagery", "query": '"satellite imagery"|"remote sensing"', "skills": ["gis", "remote sensing", "python", "data science"]},
    {"id": "edge", "label": "Edge AI", "query": '"edge computing"|tinyml|"edge ai"', "skills": ["embedded", "tinyml", "machine learning", "c++"]},
    {"id": "mobile", "label": "Mobile apps", "query": '"mobile app"|"smartphone app"|"mobile application"', "skills": ["android", "flutter", "react native", "kotlin"]},
    {"id": "nlp", "label": "Speech & language", "query": '"speech recognition"|"natural language processing"', "skills": ["nlp", "speech", "python", "machine learning"]},
    {"id": "twin", "label": "Digital twins", "query": '"digital twin"', "skills": ["simulation", "iot", "3d", "python"]},
    {"id": "printing", "label": "3D printing", "query": '"3d printing"|"additive manufacturing"', "skills": ["3d printing", "cad", "mechanical"]},
    {"id": "games", "label": "Games & gamification", "query": 'gamification|"serious game"', "skills": ["unity", "game development", "ui/ux"]},
    {"id": "chatbot", "label": "Chatbots", "query": 'chatbot|"conversational agent"', "skills": ["nlp", "llm", "javascript", "python"]},
]
LENS_BY_ID = {lens["id"]: lens for lens in GAP_LENSES}
LOCAL_QUERY = 'india|indian|"low-cost"|hindi|marathi|tamil|bengali|telugu'

# Scanned in the background while the budget allows, so most students find their field ready
SEED_FIELDS = [
    "agriculture", "healthcare", "education", "climate change", "water", "energy", "transport", "smart cities", "finance", "manufacturing",
    "mental health", "disaster management", "waste management", "air pollution", "food security", "elderly care", "accessibility", "tourism",
    "cybersecurity", "construction", "fisheries", "textiles", "rural development", "sports", "law", "journalism", "retail", "logistics",
    "biodiversity", "public health",
]


# ---------- tables ----------
class DBGapCache(Base):
    """One scanned field (key "scan:<field>|<local>") or one opened gap (key "detail:..."). Shared by everyone."""
    __tablename__ = "gap_cache"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    status = Column(String, default="ready")          # ready, queued, failed
    data = Column(String, default="{}")
    requested_by = Column(String, default="[]")       # people to tell when a queued scan is ready
    field = Column(String, default="")
    created_at = Column(String)
    updated_at = Column(String)

class DBGapClaim(Base):
    """A team that started a project on a gap: shown on the gap wall so teams find each other instead of duplicating work."""
    __tablename__ = "gap_claims"
    id = Column(Integer, primary_key=True, index=True)
    gap_key = Column(String, index=True)
    field = Column(String, default="", index=True)
    title = Column(String, default="")
    team_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    created_at = Column(String)

USER_DATA_KEPT["gap_claims"] = ("user_id",)          # a record of a team's project, like team_tasks


# ---------- OpenAlex, within its daily budget ----------
budget = {"remaining": None, "limit": None, "reset_at": 0.0}

def budget_left() -> Optional[float]:
    """What is left of today's OpenAlex budget in USD, or None when not known yet (or a new day began)."""
    if budget["remaining"] is None or time.time() >= budget["reset_at"]:
        return None
    return budget["remaining"]

def can_spend(calls: int, keep_share: float = 0.0) -> bool:
    left = budget_left()
    if left is None:
        return True
    keep = (budget["limit"] or 0) * keep_share
    return left - calls * SCAN_CALL_COST >= keep

async def openalex_get(params: dict) -> dict:
    """One OpenAlex request. The only place this module talks to OpenAlex, so tests can replace it."""
    query = dict(params)
    if OPENALEX_KEY:
        query["api_key"] = OPENALEX_KEY
    elif OPENALEX_MAILTO:
        query["mailto"] = OPENALEX_MAILTO
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.get(OPENALEX, params=query)
    headers = response.headers
    try:
        if headers.get("x-ratelimit-remaining-usd") is not None:
            budget["remaining"] = float(headers["x-ratelimit-remaining-usd"])
            budget["limit"] = float(headers.get("x-ratelimit-limit-usd") or budget["limit"] or 0)
            budget["reset_at"] = time.time() + float(headers.get("x-ratelimit-reset") or 3600)
    except ValueError:
        pass
    if response.status_code == 429:
        budget["remaining"] = 0.0
        raise RuntimeError("budget")
    response.raise_for_status()
    return response.json()

def search_filter(*parts: str) -> str:
    return ",".join(f"title_and_abstract.search:{part}" for part in parts if part)

def field_key(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s&+-]", " ", (text or "").lower())).strip()[:60]

def topic_short(openalex_id: str) -> str:
    return (openalex_id or "").rsplit("/", 1)[-1]


# ---------- the scan ----------
SCAN_VERSION = 3                     # bump when the scoring changes: stored scans are scored again from their raw counts

def in_sentence(name: str) -> str:
    """A Title Case topic name for the middle of a sentence: ordinary words lower case, acronyms (IoT, COVID-19) kept."""
    return " ".join(word.lower() if word[:1].isupper() and word[1:].islower() else word for word in name.split())

def score_gaps(field: str, local: bool, total: int, topics: list, raw: dict) -> dict:
    """topics: [{id, name, count}] in the field; raw: lens id -> {total, min, full, counts: {topic id: papers}} (papers on field, lens and topic).
    A gap is a sub-topic and a lens that are both busy in the field, appear together far less than chance would give, and have
    only a few papers in absolute terms. At most 3 gaps per sub-topic and 4 per lens, so the list stays varied."""
    cells, found = [], []
    for topic in topics:
        row = []
        name_words = set(re.findall(r"[a-z]+", topic["name"].lower()))
        for lens in GAP_LENSES:
            info = raw.get(lens["id"], {"total": 0, "min": 0, "full": False, "counts": {}})
            observed = info["counts"].get(topic["id"])
            estimated = observed is None and info["full"]
            if observed is None:
                # Not among the 200 sub-topics OpenAlex listed for this lens: fewer papers than the smallest one listed
                observed = info["min"] // 2 if info["full"] else 0
            expected = topic["count"] * info["total"] / max(1, total)
            ratio = (observed + 1) / (expected + 1)
            row.append({"observed": observed, "expected": round(expected, 1), "untouched": round(max(0.0, 1 - min(1.0, ratio)), 3)})
            # A sub-topic that is itself about the lens (say "UAV applications" for drones) is not a gap
            about_lens = observed > topic["count"] * 0.3 or any(word in name_words for word in re.findall(r"[a-z]{3,}", lens["label"].lower()))
            if expected < 15 or observed > 60 or ratio >= 0.25 or about_lens:
                continue
            if estimated:
                count_text = f"Fewer than {info['min']:,} papers combine them"
            elif observed == 0:
                count_text = "No paper combines them yet"
            elif observed == 1:
                count_text = "Only 1 paper combines them"
            else:
                count_text = f"Only {observed:,} papers combine them"
            found.append({
                "key": f"{field}|{int(local)}|{topic['id']}|{lens['id']}",
                "topic_id": topic["id"], "topic": topic["name"], "lens": lens["id"], "lens_label": lens["label"],
                "observed": observed, "estimated": estimated, "expected": round(expected), "untouched": round(1 - ratio, 3),
                "topic_count": topic["count"], "lens_count": info["total"], "skills": lens["skills"],
                "title": f"{lens['label']} for {in_sentence(topic['name'])}",
                "why": (f"{count_text}, although {topic['count']:,} papers here are about {in_sentence(topic['name'])} "
                        f"and {info['total']:,} use {in_sentence(lens['label'])} (about {round(expected):,} would be normal)."),
                "score": round((expected + 1) / (observed + 1) * math.log10(expected + 10), 1),
            })
        cells.append(row)
    found.sort(key=lambda gap: -gap["score"])
    gaps_out, per_topic, per_lens = [], {}, {}
    for gap in found:
        if per_topic.get(gap["topic_id"], 0) >= 3 or per_lens.get(gap["lens"], 0) >= 4:
            continue
        per_topic[gap["topic_id"]] = per_topic.get(gap["topic_id"], 0) + 1
        per_lens[gap["lens"]] = per_lens.get(gap["lens"], 0) + 1
        gaps_out.append(gap)
    return {"cells": cells, "gaps": gaps_out[:MAX_GAPS], "v": SCAN_VERSION}

def rescored(data: dict) -> dict:
    """A stored scan with the current scoring (no OpenAlex calls), when it was scored by an older version."""
    if data.get("v") == SCAN_VERSION or "raw" not in data or not data.get("topics"):
        return data
    return {**data, **score_gaps(data["field"], data.get("local", False), data["total"], data["topics"], data["raw"])}

async def run_scan(field: str, local: bool) -> dict:
    """About 17 OpenAlex calls: the field's sub-topics, then one call per lens that counts every sub-topic at once."""
    extra = LOCAL_QUERY if local else ""
    first = await openalex_get({"filter": search_filter(field, extra), "group_by": "topics.id", "per-page": 200})
    total = first.get("meta", {}).get("count", 0)
    topics = [{"id": topic_short(g["key"]), "name": g.get("key_display_name") or "", "count": g.get("count", 0)}
              for g in first.get("group_by", []) if g.get("count", 0) >= 150 and g.get("key_display_name")][:MAX_TOPICS]
    if total < 300 or len(topics) < 3:
        return {"field": field, "local": local, "total": total, "topics": topics, "lenses": [], "cells": [], "gaps": [], "too_small": True}

    raw = {}
    gate = asyncio.Semaphore(4)
    wanted = {topic["id"] for topic in topics}

    async def one(lens):
        async with gate:
            data = await openalex_get({"filter": search_filter(field, extra, lens["query"]), "group_by": "topics.id", "per-page": 200})
        groups = {topic_short(g["key"]): g.get("count", 0) for g in data.get("group_by", [])}
        # Only what the scoring needs is kept: the counts of the field's sub-topics and the smallest count listed
        raw[lens["id"]] = {"total": data.get("meta", {}).get("count", 0), "min": min(groups.values()) if groups else 0, "full": len(groups) >= 200,
                           "counts": {topic_id: count for topic_id, count in groups.items() if topic_id in wanted}}

    await asyncio.gather(*(one(lens) for lens in GAP_LENSES))
    return {"field": field, "local": local, "total": total, "topics": topics, "raw": raw,
            "lenses": [{"id": lens["id"], "label": lens["label"], "count": raw[lens["id"]]["total"]} for lens in GAP_LENSES],
            **score_gaps(field, local, total, topics, raw)}


async def cache_row(key: str):
    rows = await fetch_one_off(select(DBGapCache).where(DBGapCache.key == key))
    return rows[0][0] if rows else None

async def store(key: str, field: str, status: str, data: dict, requested_by: Optional[list] = None):
    now = utc_now_iso()
    values = {"status": status, "data": json.dumps(data, separators=(",", ":")), "field": field, "updated_at": now}
    if requested_by is not None:
        values["requested_by"] = json.dumps(requested_by)
    statement = pg_insert(DBGapCache).values(key=key, created_at=now, requested_by=values.get("requested_by", "[]"), **{k: v for k, v in values.items() if k != "requested_by"})
    await run_one_off(statement.on_conflict_do_update(index_elements=[DBGapCache.key], set_=values))

def is_fresh(row) -> bool:
    try:
        return (parse_timestamp(utc_now_iso()) - parse_timestamp(row.updated_at)) < timedelta(days=CACHE_DAYS)
    except Exception:
        return False

def scan_key(field: str, local: bool) -> str:
    return f"scan:{field}|{int(local)}"

recent_scans: dict = {}          # user id -> times of new scans in the last hour

def public_scan(data: dict) -> dict:
    """A stored scan as the page gets it: with the current scoring and without the raw counts."""
    return {key: value for key, value in rescored(data).items() if key != "raw"}

def scan_reply(row, data: Optional[dict] = None) -> dict:
    payload = public_scan(data if data is not None else json.loads(row.data or "{}"))
    return {**payload, "status": row.status if row else "ready", "scanned_at": row.updated_at if row else utc_now_iso()}

async def queue_scan(field: str, local: bool, user_id: int, row=None) -> dict:
    asked = json.loads(row.requested_by or "[]") if row else []
    if user_id not in asked:
        asked.append(user_id)
    old = public_scan(json.loads(row.data or "{}")) if row and row.status == "ready" else {}
    if row and row.status == "ready":
        # An old result keeps being shown; the refresh is queued with the people to tell
        await run_one_off(update(DBGapCache).where(DBGapCache.id == row.id).values(requested_by=json.dumps(asked[-50:])))
        return {**old, "status": "ready", "refreshing": True, "scanned_at": row.updated_at}
    await store(scan_key(field, local), field, "queued", {"field": field, "local": local}, asked[-50:])
    queued = (await fetch_one_off(select(func.count()).select_from(DBGapCache).where(DBGapCache.status == "queued")))[0][0]
    return {"field": field, "local": local, "status": "queued", "queue": queued,
            "ready_in_hours": max(1, round((budget["reset_at"] - time.time()) / 3600)) if budget_left() is not None else 1}


@router.get("/api/gaps")
async def find_gaps(field: str, local: bool = False, current_user_id: int = Depends(get_current_user_id)):
    """The gaps of a field: from the shared cache when anyone scanned it in the last 30 days, else scanned now if the budget allows,
    else queued (the person is told when it is ready)."""
    key_text = field_key(field)
    if len(key_text) < 3:
        raise HTTPException(status_code=400, detail="Type a field of at least 3 letters, like agriculture or healthcare.")
    row = await cache_row(scan_key(key_text, local))
    if row and row.status == "ready" and is_fresh(row):
        return scan_reply(row)
    if row and row.status == "queued":
        return await queue_scan(key_text, local, current_user_id, row)

    times = [t for t in recent_scans.get(current_user_id, []) if time.time() - t < 3600]
    if len(times) >= NEW_SCANS_PER_HOUR:
        raise HTTPException(status_code=429, detail="You started many new scans this hour. Try a field that is already ready, or come back in a while.")
    if not can_spend(len(GAP_LENSES) + 1, DETAIL_RESERVE):
        return await queue_scan(key_text, local, current_user_id, row)
    recent_scans[current_user_id] = times + [time.time()]
    try:
        data = await run_scan(key_text, local)
    except Exception as e:
        if row and row.status == "ready":
            return scan_reply(row)
        if str(e) == "budget":
            return await queue_scan(key_text, local, current_user_id, None)
        raise HTTPException(status_code=503, detail="The research database did not answer. Try again in a minute.")
    await store(scan_key(key_text, local), key_text, "ready", data, [])
    return {**public_scan(data), "status": "ready", "scanned_at": utc_now_iso()}


@router.get("/api/gaps/fields")
async def ready_fields(current_user_id: int = Depends(get_current_user_id)):
    """Fields already scanned: these open at once and cost nothing."""
    rows = await fetch_one_off(select(DBGapCache.field, DBGapCache.key, DBGapCache.data).where(DBGapCache.key.like("scan:%"), DBGapCache.status == "ready")
                               .order_by(DBGapCache.updated_at.desc()).limit(200))
    fields = []
    for field, key, data in rows:
        try:
            gaps = len(rescored(json.loads(data or "{}")).get("gaps", []))
        except ValueError:
            gaps = 0
        fields.append({"field": field, "local": key.endswith("|1"), "gaps": gaps})
    return {"fields": fields, "budget_low": not can_spend(len(GAP_LENSES) + 1, DETAIL_RESERVE)}


# ---------- one gap ----------
def gap_parts(gap_key: str):
    parts = (gap_key or "").split("|")
    if len(parts) != 4 or parts[1] not in ("0", "1") or parts[3] not in LENS_BY_ID or not re.match(r"^T\d{1,8}$", parts[2]):
        raise HTTPException(status_code=400, detail="That gap does not exist.")
    return field_key(parts[0]), parts[1] == "1", parts[2], LENS_BY_ID[parts[3]]

async def gap_from_scan(gap_key: str) -> dict:
    field, local, _, _ = gap_parts(gap_key)
    row = await cache_row(scan_key(field, local))
    data = rescored(json.loads(row.data or "{}")) if row and row.status == "ready" else {}
    gap = next((g for g in data.get("gaps", []) if g["key"] == gap_key), None)
    if not gap:
        raise HTTPException(status_code=404, detail="That gap is not in the latest scan of this field.")
    return gap

async def people_for(skills: list, viewer_id: int) -> tuple:
    """Up to 5 people on the site with the skills a gap needs; people from the viewer's own college first."""
    my = await fetch_one_off(select(DBUser.college_name, DBUser.skills).where(DBUser.id == viewer_id))
    my_college = ((my[0][0] if my else "") or "").strip().lower()
    match = or_(*[func.lower(func.coalesce(DBUser.skills, "")).like(f"%{skill}%") for skill in skills])
    same_college = (func.lower(func.trim(func.coalesce(DBUser.college_name, ""))) == my_college) if my_college else None
    query = person_cards_query(viewer_id, match)
    if same_college is not None:
        query = query.order_by(same_college.desc(), DBUser.id.desc())
    rows = await fetch_one_off(query.limit(40))
    people = []
    for row in rows:
        card = person_card(row)
        have = {s.strip().lower() for s in (card.get("skills") or "").split(",") if s.strip()}
        card["matching_skills"] = [skill for skill in skills if any(skill in h for h in have)]
        card["same_college"] = bool(my_college) and (card.get("college_name") or "").strip().lower() == my_college
        people.append(card)
    # Most matching skills first; being from the viewer's college counts as one more
    people.sort(key=lambda p: (-(len(p["matching_skills"]) + (1 if p["same_college"] else 0)), not p["same_college"]))
    mine = {s.strip().lower() for s in ((my[0][1] if my else "") or "").split(",") if s.strip()}
    return people[:5], [skill for skill in skills if any(skill in h for h in mine)]

async def claims_for(gap_keys: Optional[list] = None, field: str = "", limit: int = 30) -> list:
    query = (select(DBGapClaim.gap_key, DBGapClaim.title, DBGapClaim.field, DBGapClaim.team_id, DBGapClaim.user_id, DBGapClaim.created_at,
                    DBTeam.name, DBUser.name, DBUser.college_name,
                    select(func.count()).select_from(DBTeamMember).where(DBTeamMember.team_id == DBGapClaim.team_id).scalar_subquery())
             .join(DBTeam, DBTeam.id == DBGapClaim.team_id).join(DBUser, DBUser.id == DBGapClaim.user_id)
             .order_by(DBGapClaim.id.desc()).limit(limit))
    if gap_keys is not None:
        query = query.where(DBGapClaim.gap_key.in_(gap_keys))
    if field:
        query = query.where(DBGapClaim.field == field)
    rows = await fetch_one_off(query)
    return [{"gap_key": r[0], "title": r[1], "field": r[2], "team_id": r[3], "lead_id": r[4], "created_at": r[5], "team_name": r[6],
             "lead_name": r[7], "college": r[8] or "", "members": r[9] or 0} for r in rows]

@router.get("/api/gaps/detail")
async def gap_detail(key: str, current_user_id: int = Depends(get_current_user_id)):
    """The few papers that exist on the gap, papers per year, people who could build it and teams already on it."""
    gap = await gap_from_scan(key)
    field, local, topic_id, lens = gap_parts(key)
    (people, my_skills), claims = await asyncio.gather(people_for(lens["skills"], current_user_id), claims_for([key]))
    cached = await cache_row(f"detail:{key}")
    papers, years, later = [], [], False
    if cached and cached.status == "ready" and is_fresh(cached):
        stored = json.loads(cached.data or "{}")
        papers, years = stored.get("papers", []), stored.get("years", [])
    elif can_spend(2):
        try:
            base = search_filter(field, LOCAL_QUERY if local else "", lens["query"]) + f",topics.id:{topic_id}"
            listing, trend = await asyncio.gather(
                openalex_get({"filter": base, "sort": "cited_by_count:desc", "per-page": 8,
                              "select": "id,display_name,publication_year,cited_by_count,doi,primary_location"}),
                openalex_get({"filter": search_filter(field, LOCAL_QUERY if local else "", lens["query"]), "group_by": "publication_year"}),
            )
            papers = [{"title": w.get("display_name") or "", "year": w.get("publication_year"), "cited": w.get("cited_by_count", 0),
                       "url": w.get("doi") or ((w.get("primary_location") or {}).get("landing_page_url")) or w.get("id", ""),
                       "venue": (((w.get("primary_location") or {}).get("source")) or {}).get("display_name") or ""}
                      for w in listing.get("results", []) if w.get("display_name")]
            years = sorted(({"year": int(g["key"]), "count": g["count"]} for g in trend.get("group_by", []) if str(g.get("key", "")).isdigit() and int(g["key"]) >= 2010),
                           key=lambda y: y["year"])
            await store(f"detail:{key}", field, "ready", {"papers": papers, "years": years})
        except Exception:
            later = True
    else:
        later = True
    return {"gap": gap, "papers": papers, "years": years, "papers_later": later, "people": people, "my_skills": my_skills, "claims": claims}


@router.get("/api/gaps/wall")
async def gap_wall(field: str = "", current_user_id: int = Depends(get_current_user_id)):
    """Teams working on gaps, newest first (all fields, or one)."""
    return {"claims": await claims_for(None, field_key(field) if field else "", 40)}


# ---------- start a project on a gap ----------
class StartBody(BaseModel):
    key: str
    name: Optional[str] = ""

@router.post("/api/gaps/start")
async def start_gap_project(body: StartBody, current_user_id: int = Depends(get_current_user_id)):
    """A new team workspace for the gap: the research plan template, a brief that states the gap and a reading list of its papers."""
    gap = await gap_from_scan(body.key)
    field = gap_parts(body.key)[0]
    name = (body.name or gap["title"]).strip()[:80] or gap["title"][:80]
    async with AutocommitSession() as db:
        team = await create_team(TeamCreate(name=name, description=f"Research gap: {gap['title']} ({field})"[:300]), db, current_user_id)
        team_id = int(team.id)
    await run_one_off(update(DBTeam).where(DBTeam.id == team_id).values(topic=f"gap:{body.key}"[:200]))

    # The brief goes in first, so the template keeps it
    now = utc_now_iso()
    deadline = (core.site_now().date() + timedelta(days=120)).isoformat()
    brief = {"problem": f"{gap['why']} This project explores {in_sentence(gap['title'])}.", "audience": "",
             "goals": [f"Show what {in_sentence(gap['lens_label'])} can do for {in_sentence(gap['topic'])}", "A working prototype or experiment", "A paper or report on the results"],
             "deliverables": ["Literature review", "Prototype or experiment", "Results", "Paper or report"],
             "success": ["Supervisor approves the results", "Shared with others working on this"], "deadline": deadline}
    await run_one_off(DBProjectItem.__table__.insert().values(team_id=team_id, kind="brief", title="Project brief", data=json.dumps(brief), position=1,
                                                              created_by=current_user_id, updated_by=current_user_id, created_at=now, updated_at=now))
    async with SessionLocal() as db:
        await apply_project_template(team_id, TemplateBody(template="research"), db, current_user_id)

    # The reading list starts with the few papers that already exist on the gap
    detail = await cache_row(f"detail:{body.key}")
    papers = json.loads(detail.data or "{}").get("papers", []) if detail else []
    rows = "\n".join(f"| [{p['title'].replace('|', '/')[:120]}]({p['url']}) | {p.get('year') or ''} | | |" for p in papers if p.get("url"))
    reading = ("## Papers\n\nThese are the few papers that already combine the two topics (from Gap Finder). Add the important papers on each topic on its own too.\n\n"
               "| Paper | Year | Key idea | Useful for |\n|---|---|---|---|\n" + rows + "\n")
    await run_one_off(update(DBProjectItem).where(DBProjectItem.team_id == team_id, DBProjectItem.kind == "doc", DBProjectItem.title == "Reading list")
                      .values(data=json.dumps({"body": reading, "pinned": True, "icon": ""}), updated_at=now))
    await run_one_off(DBGapClaim.__table__.insert().values(gap_key=body.key, field=field, title=gap["title"][:160], team_id=team_id,
                                                           user_id=current_user_id, created_at=now))
    return {"team_id": team_id, "name": name}


async def forget_team_claims(team_id: int):
    await run_one_off(delete(DBGapClaim).where(DBGapClaim.team_id == team_id))

core.TEAM_PURGE_HOOKS.append(forget_team_claims)


# ---------- background: queued fields first, then popular ones ----------
async def gaps_watch():
    await asyncio.sleep(120)
    last_seed = 0.0
    while True:
        try:
            await work_queue_once()
            if time.time() - last_seed > 900 and can_spend(len(GAP_LENSES) + 1, SEED_MIN_SHARE):
                last_seed = time.time()
                await seed_once()
        except Exception as e:
            print("Error in the Gap Finder watcher:", e)
        await asyncio.sleep(60)

async def work_queue_once():
    rows = await fetch_one_off(select(DBGapCache).where(DBGapCache.status == "queued").order_by(DBGapCache.id).limit(3))
    for (row,) in rows:
        if not can_spend(len(GAP_LENSES) + 1, DETAIL_RESERVE):
            return
        local = row.key.endswith("|1")
        try:
            data = await run_scan(row.field, local)
        except Exception as e:
            if str(e) == "budget":
                return
            await run_one_off(update(DBGapCache).where(DBGapCache.id == row.id).values(status="failed", updated_at=utc_now_iso()))
            continue
        asked = json.loads(row.requested_by or "[]")
        await store(row.key, row.field, "ready", data, [])
        link = f"research.html?field={quote_plus(row.field)}" + ("&local=1" if local else "")
        for user_id in asked[:50]:
            spawn_background(create_notification(user_id, "research", f"Gap Finder: {len(data.get('gaps', []))} research gaps in \"{row.field}\" are ready.", utc_now_iso(), link))

async def seed_once():
    """Scan one popular field that has no fresh result yet."""
    rows = await fetch_one_off(select(DBGapCache.key, DBGapCache.updated_at, DBGapCache.status).where(DBGapCache.key.in_([scan_key(f, False) for f in SEED_FIELDS])))
    known = {key: (updated, status) for key, updated, status in rows}
    for field in SEED_FIELDS:
        found = known.get(scan_key(field, False))
        if found and found[1] == "ready":
            try:
                if (parse_timestamp(utc_now_iso()) - parse_timestamp(found[0])) < timedelta(days=CACHE_DAYS - 2):
                    continue
            except Exception:
                pass
        data = await run_scan(field, False)
        await store(scan_key(field, False), field, "ready", data, [])
        return

@core.app.on_event("startup")
async def gaps_startup():
    spawn_background(gaps_watch())
