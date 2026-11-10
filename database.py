"""
database.py — SQLite persistent storage
Crusher Monitor — Kannan Blue Metals

Uses a single persistent aiosqlite connection opened at startup (WAL mode).
All writes are serialised through _write_lock; reads run concurrently.
"""

import asyncio
import aiosqlite
import logging
from datetime import datetime
from typing import Optional

from config import DB_PATH

log = logging.getLogger(__name__)

# ── Shared connection (opened by init_db, closed by close_db) ────────────
_db: Optional[aiosqlite.Connection] = None
_write_lock = asyncio.Lock()

# ── Insert counter for periodic jaw_states pruning ───────────────────────
_jaw_state_insert_count = 0


async def init_db():
    """Open the shared connection, enable WAL mode, create tables."""
    global _db
    _db = await aiosqlite.connect(DB_PATH)
    _db.row_factory = aiosqlite.Row   # set once — avoids race condition in read functions
    # WAL mode: readers never block writers and vice-versa
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.execute("PRAGMA synchronous=NORMAL")

    # ── Jaw state changes ─────────────────────────────────
    await _db.execute("""
        CREATE TABLE IF NOT EXISTS jaw_states (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      TEXT    NOT NULL,
            jaw_label      TEXT    NOT NULL,
            confidence     REAL    NOT NULL,
            machine_status TEXT    NOT NULL,
            target_vfd_hz  INTEGER NOT NULL,
            partial_secs   INTEGER DEFAULT 0,
            empty_secs     INTEGER DEFAULT 0
        )
    """)

    # ── Alerts ────────────────────────────────────────────
    await _db.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_id    TEXT    NOT NULL,
            level       TEXT    NOT NULL,
            message     TEXT    NOT NULL,
            timestamp   TEXT    NOT NULL,
            resolved    INTEGER DEFAULT 0,
            resolved_at TEXT
        )
    """)

    # ── OEE history (per shift) ───────────────────────────
    await _db.execute("""
        CREATE TABLE IF NOT EXISTS oee_history (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp        TEXT    NOT NULL,
            shift            TEXT    NOT NULL,
            availability_pct REAL    NOT NULL,
            timer_run        TEXT    NOT NULL,
            timer_stuck      TEXT    NOT NULL,
            timer_no_feed    TEXT    NOT NULL,
            frames_running   INTEGER NOT NULL,
            frames_stuck     INTEGER NOT NULL,
            frames_no_feed   INTEGER NOT NULL,
            tonnage_actual   REAL    NOT NULL
        )
    """)

    # ── VFD Hz logs (every 5 seconds) ─────────────────────
    await _db.execute("""
        CREATE TABLE IF NOT EXISTS vfd_logs (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      TEXT    NOT NULL,
            vfd_hz         INTEGER NOT NULL,
            jaw_label      TEXT    NOT NULL,
            machine_status TEXT    NOT NULL
        )
    """)

    # ── Shift reports ─────────────────────────────────────
    await _db.execute("""
        CREATE TABLE IF NOT EXISTS shift_reports (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp        TEXT    NOT NULL,
            shift_type       TEXT    NOT NULL,
            shift_start      TEXT    NOT NULL,
            first_run_at     TEXT,
            total_runtime    TEXT    NOT NULL,
            total_stuck      TEXT    NOT NULL,
            total_no_feed    TEXT    NOT NULL,
            availability_pct REAL    NOT NULL,
            tonnage_actual   REAL    NOT NULL,
            total_alerts     INTEGER NOT NULL
        )
    """)

    # ── Migration: add first_run_at to existing DBs ───────
    try:
        await _db.execute("ALTER TABLE shift_reports ADD COLUMN first_run_at TEXT")
        await _db.commit()
        log.info("DB migration: added first_run_at column to shift_reports")
    except Exception:
        pass  # column already exists — no action needed

    await _db.commit()
    log.info("Database initialised at %s (WAL mode)", DB_PATH)


async def close_db():
    """Close the shared connection — called from lifespan shutdown."""
    global _db
    if _db:
        await _db.close()
        _db = None
        log.info("Database connection closed.")


# ── Write helpers ─────────────────────────────────────────────────────────

async def save_jaw_state(jaw_label: str, confidence: float,
                         machine_status: str, target_vfd_rpm: int,
                         partial_secs: int = 0, empty_secs: int = 0):
    """Save jaw state every second; prunes rows older than 7 days every 1 000 inserts."""
    global _jaw_state_insert_count
    try:
        async with _write_lock:
            await _db.execute("""
                INSERT INTO jaw_states
                    (timestamp, jaw_label, confidence, machine_status,
                     target_vfd_hz, partial_secs, empty_secs)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                jaw_label, round(confidence, 3), machine_status,
                target_vfd_rpm, partial_secs, empty_secs,
            ))
            _jaw_state_insert_count += 1
            if _jaw_state_insert_count % 1000 == 0:
                await _db.execute("""
                    DELETE FROM jaw_states
                    WHERE timestamp < datetime('now', 'localtime', '-7 days')
                """)
                log.debug("jaw_states pruned — rows older than 7 days removed")
            await _db.commit()
    except Exception as e:
        log.error("save_jaw_state error: %s", e)


async def save_alert(alert_id: str, level: str, message: str):
    """Save a new alert (no-op if already unresolved in DB)."""
    try:
        async with _write_lock:
            cur = await _db.execute(
                "SELECT id FROM alerts WHERE alert_id=? AND resolved=0", (alert_id,)
            )
            if await cur.fetchone():
                return
            await _db.execute("""
                INSERT INTO alerts (alert_id, level, message, timestamp)
                VALUES (?, ?, ?, ?)
            """, (
                alert_id, level, message,
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ))
            await _db.commit()
    except Exception as e:
        log.error("save_alert error: %s", e)


async def resolve_alert(alert_id: str):
    """Mark alert as resolved."""
    try:
        async with _write_lock:
            await _db.execute("""
                UPDATE alerts SET resolved=1, resolved_at=?
                WHERE alert_id=? AND resolved=0
            """, (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                alert_id,
            ))
            await _db.commit()
    except Exception as e:
        log.error("resolve_alert error: %s", e)


async def save_vfd_log(vfd_rpm: int, jaw_label: str, machine_status: str):
    """Save VFD reading every 5 seconds."""
    try:
        async with _write_lock:
            await _db.execute("""
                INSERT INTO vfd_logs (timestamp, vfd_hz, jaw_label, machine_status)
                VALUES (?, ?, ?, ?)
            """, (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                vfd_rpm, jaw_label, machine_status,
            ))
            await _db.commit()
    except Exception as e:
        log.error("save_vfd_log error: %s", e)


async def save_oee_snapshot(state: dict):
    """Save OEE snapshot every minute."""
    try:
        async with _write_lock:
            await _db.execute("""
                INSERT INTO oee_history
                    (timestamp, shift, availability_pct, timer_run,
                     timer_stuck, timer_no_feed, frames_running,
                     frames_stuck, frames_no_feed, tonnage_actual)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                state.get("shift", {}).get("shift", "day"),
                state.get("availability_pct", 0),
                state.get("timer_run", "00:00:00"),
                state.get("timer_stuck", "00:00:00"),
                state.get("timer_no_feed", "00:00:00"),
                state.get("frames_running", 0),
                state.get("frames_stuck", 0),
                state.get("frames_no_feed", 0),
                state.get("tonnage_actual", 0),
            ))
            await _db.commit()
    except Exception as e:
        log.error("save_oee_snapshot error: %s", e)


async def save_shift_report(state: dict):
    """Save shift report on shift change / manual reset."""
    try:
        async with _write_lock:
            await _db.execute("""
                INSERT INTO shift_reports
                    (timestamp, shift_type, shift_start, first_run_at,
                     total_runtime, total_stuck, total_no_feed,
                     availability_pct, tonnage_actual, total_alerts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                state.get("shift", {}).get("shift", "day"),
                state.get("shift", {}).get("start", ""),
                state.get("first_run_at"),
                state.get("timer_run", "00:00:00"),
                state.get("timer_stuck", "00:00:00"),
                state.get("timer_no_feed", "00:00:00"),
                state.get("availability_pct", 0),
                state.get("tonnage_actual", 0),
                state.get("alert_count", 0),
            ))
            await _db.commit()
    except Exception as e:
        log.error("save_shift_report error: %s", e)


# ── Read helpers (no write lock needed — WAL allows concurrent reads) ────

async def get_alerts_history(limit: int = 100):
    """Get last N alerts from DB."""
    try:
        cur = await _db.execute(
            "SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,)
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error("get_alerts_history error: %s", e)
        return []


async def get_oee_history(hours: int = 24):
    """Get OEE history for the last N hours."""
    try:
        cur = await _db.execute("""
            SELECT * FROM oee_history
            WHERE timestamp >= datetime('now', 'localtime', ?)
            ORDER BY id DESC
        """, (f"-{hours} hours",))
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error("get_oee_history error: %s", e)
        return []


async def get_vfd_history(minutes: int = 60):
    """Get VFD history for the last N minutes."""
    try:
        cur = await _db.execute("""
            SELECT * FROM vfd_logs
            WHERE timestamp >= datetime('now', 'localtime', ?)
            ORDER BY id DESC
        """, (f"-{minutes} minutes",))
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error("get_vfd_history error: %s", e)
        return []


async def get_shift_reports(limit: int = 30):
    """Get last N shift reports."""
    try:
        cur = await _db.execute(
            "SELECT * FROM shift_reports ORDER BY id DESC LIMIT ?", (limit,)
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error("get_shift_reports error: %s", e)
        return []


async def get_state_summary_today():
    """Summary of today's jaw states."""
    try:
        cur = await _db.execute("""
            SELECT machine_status, COUNT(*) as count
            FROM jaw_states
            WHERE timestamp >= date('now', 'localtime')
            GROUP BY machine_status
        """)
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error("get_state_summary_today error: %s", e)
        return []


async def get_period_summary(from_date: str, to_date: str) -> dict:
    """
    Aggregate DB data for any date range.
    from_date / to_date format: 'YYYY-MM-DD'
    Returns a summary dict used by reports.build_period_*().
    """
    try:
        from_dt = f"{from_date} 00:00:00"
        to_dt   = f"{to_date} 23:59:59"

        # ── Jaw states: run / stuck / no-feed counts + first/last timestamps ──
        cur = await _db.execute("""
            SELECT
                COUNT(CASE WHEN machine_status = 'NORMAL'         THEN 1 END) AS run_secs,
                COUNT(CASE WHEN machine_status = 'STONE STUCK'    THEN 1 END) AS stuck_secs,
                COUNT(CASE WHEN machine_status = 'NO RAW MATERIAL' THEN 1 END) AS no_feed_secs,
                MIN(CASE WHEN machine_status = 'NORMAL' THEN timestamp END)    AS first_run_at,
                MAX(timestamp)                                                  AS last_seen,
                COUNT(*)                                                        AS total_secs
            FROM jaw_states
            WHERE timestamp >= ? AND timestamp <= ?
        """, (from_dt, to_dt))
        jaw = dict(await cur.fetchone() or {})

        # ── Alert count for period ────────────────────────────────────────────
        cur = await _db.execute("""
            SELECT COUNT(*) AS total_alerts
            FROM alerts
            WHERE timestamp >= ? AND timestamp <= ?
        """, (from_dt, to_dt))
        alert_row   = await cur.fetchone()
        total_alerts = int(alert_row[0]) if alert_row else 0

        # ── VFD stats (exclude STOPPED rows) ─────────────────────────────────
        cur = await _db.execute("""
            SELECT MAX(vfd_hz) AS peak_vfd,
                   AVG(vfd_hz) AS avg_vfd
            FROM vfd_logs
            WHERE timestamp >= ? AND timestamp <= ?
              AND machine_status != 'STOPPED'
        """, (from_dt, to_dt))
        vfd_row = dict(await cur.fetchone() or {})

        # ── Availability ──────────────────────────────────────────────────────
        run_secs     = int(jaw.get("run_secs",     0) or 0)
        stuck_secs   = int(jaw.get("stuck_secs",   0) or 0)
        no_feed_secs = int(jaw.get("no_feed_secs", 0) or 0)
        active_secs  = run_secs + stuck_secs + no_feed_secs
        avail_pct    = round(run_secs / active_secs * 100, 1) if active_secs > 0 else 0.0

        return {
            "from_date":        from_date,
            "to_date":          to_date,
            "run_secs":         run_secs,
            "stuck_secs":       stuck_secs,
            "no_feed_secs":     no_feed_secs,
            "total_secs":       int(jaw.get("total_secs", 0) or 0),
            "first_run_at":     jaw.get("first_run_at"),
            "last_seen":        jaw.get("last_seen"),
            "availability_pct": avail_pct,
            "total_alerts":     total_alerts,
            "peak_vfd_hz":      int(vfd_row.get("peak_vfd") or 0),
            "avg_vfd_hz":       round(float(vfd_row.get("avg_vfd") or 0), 1),
        }
    except Exception as e:
        log.error("get_period_summary error: %s", e)
        return {}
