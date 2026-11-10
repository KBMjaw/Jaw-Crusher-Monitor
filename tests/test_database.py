"""
tests/test_database.py
Integration tests for database.py using an in-memory SQLite DB.
No file system side effects — safe to run anywhere.
"""

import asyncio
import pytest
import database


# ── Async test helper ─────────────────────────────────────────────────────

@pytest.fixture
def event_loop():
    """Create a new event loop for each test."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def db(tmp_path, monkeypatch):
    """
    Set up a fresh in-memory database for each test.
    Monkeypatches DB_PATH to a temp file so init_db() uses it.
    """
    db_file = str(tmp_path / "test_crusher.db")
    monkeypatch.setattr("database.DB_PATH", db_file)
    monkeypatch.setattr("config.DB_PATH", db_file)

    await database.init_db()
    yield database._db
    await database.close_db()


# ── init_db tests ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_init_db_creates_tables(db):
    """All 5 tables must exist after init_db."""
    tables = ["jaw_states", "alerts", "oee_history", "vfd_logs", "shift_reports"]
    for table in tables:
        cur = await db.execute(
            f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'"
        )
        row = await cur.fetchone()
        assert row is not None, f"Table '{table}' not created"


@pytest.mark.asyncio
async def test_init_db_wal_mode(db):
    cur = await db.execute("PRAGMA journal_mode")
    row = await cur.fetchone()
    assert row[0] == "wal"


# ── save_jaw_state tests ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_jaw_state_inserts_row(db):
    await database.save_jaw_state("jaw filled", 0.95, "NORMAL", 20, 0, 0)
    cur = await db.execute("SELECT COUNT(*) FROM jaw_states")
    row = await cur.fetchone()
    assert row[0] == 1


@pytest.mark.asyncio
async def test_save_jaw_state_values(db):
    await database.save_jaw_state("jaw empty", 0.88, "NO RAW MATERIAL", 50, 0, 35)
    cur = await db.execute("SELECT jaw_label, confidence, machine_status, target_vfd_hz, empty_secs FROM jaw_states")
    row = await cur.fetchone()
    assert row[0] == "jaw empty"
    assert abs(row[1] - 0.88) < 0.001
    assert row[2] == "NO RAW MATERIAL"
    assert row[3] == 50
    assert row[4] == 35


@pytest.mark.asyncio
async def test_save_jaw_state_multiple_rows(db):
    for i in range(5):
        await database.save_jaw_state("jaw filled", 0.9, "NORMAL", 20)
    cur = await db.execute("SELECT COUNT(*) FROM jaw_states")
    row = await cur.fetchone()
    assert row[0] == 5


# ── save_alert / resolve_alert tests ──────────────────────────────────────

@pytest.mark.asyncio
async def test_save_alert_inserts_row(db):
    await database.save_alert("stone_stuck", "critical", "Stone stuck for 20s")
    cur = await db.execute("SELECT COUNT(*) FROM alerts")
    row = await cur.fetchone()
    assert row[0] == 1


@pytest.mark.asyncio
async def test_save_alert_no_duplicate(db):
    """Saving the same alert_id twice should not create a duplicate."""
    await database.save_alert("stone_stuck", "critical", "Stone stuck")
    await database.save_alert("stone_stuck", "critical", "Stone stuck again")
    cur = await db.execute("SELECT COUNT(*) FROM alerts WHERE alert_id='stone_stuck'")
    row = await cur.fetchone()
    assert row[0] == 1


@pytest.mark.asyncio
async def test_resolve_alert(db):
    await database.save_alert("stone_stuck", "critical", "Stone stuck")
    await database.resolve_alert("stone_stuck")
    cur = await db.execute("SELECT resolved FROM alerts WHERE alert_id='stone_stuck'")
    row = await cur.fetchone()
    assert row[0] == 1


@pytest.mark.asyncio
async def test_resolve_alert_sets_resolved_at(db):
    await database.save_alert("no_raw_material", "warning", "No feed")
    await database.resolve_alert("no_raw_material")
    cur = await db.execute("SELECT resolved_at FROM alerts WHERE alert_id='no_raw_material'")
    row = await cur.fetchone()
    assert row[0] is not None


@pytest.mark.asyncio
async def test_save_alert_after_resolve_creates_new(db):
    """After resolving, same alert_id can be inserted again."""
    await database.save_alert("stone_stuck", "critical", "First occurrence")
    await database.resolve_alert("stone_stuck")
    await database.save_alert("stone_stuck", "critical", "Second occurrence")
    cur = await db.execute("SELECT COUNT(*) FROM alerts WHERE alert_id='stone_stuck'")
    row = await cur.fetchone()
    assert row[0] == 2


# ── save_vfd_log tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_vfd_log_inserts_row(db):
    await database.save_vfd_log(37, "jaw partially filled", "NORMAL")
    cur = await db.execute("SELECT vfd_hz, jaw_label, machine_status FROM vfd_logs")
    row = await cur.fetchone()
    assert row[0] == 37
    assert row[1] == "jaw partially filled"
    assert row[2] == "NORMAL"


# ── save_oee_snapshot tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_oee_snapshot(db):
    state = {
        "shift"          : {"shift": "day"},
        "availability_pct": 85.5,
        "timer_run"      : "06:00:00",
        "timer_stuck"    : "00:10:00",
        "timer_no_feed"  : "00:20:00",
        "frames_running" : 1000,
        "frames_stuck"   : 50,
        "frames_no_feed" : 100,
        "tonnage_actual" : 95.0,
    }
    await database.save_oee_snapshot(state)
    cur = await db.execute("SELECT availability_pct, tonnage_actual FROM oee_history")
    row = await cur.fetchone()
    assert abs(row[0] - 85.5) < 0.01
    assert abs(row[1] - 95.0) < 0.01


# ── save_shift_report tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_shift_report(db):
    state = {
        "shift"          : {"shift": "night", "start": "18:00"},
        "timer_run"      : "04:00:00",
        "timer_stuck"    : "00:30:00",
        "timer_no_feed"  : "01:30:00",
        "availability_pct": 66.7,
        "tonnage_actual" : 88.0,
        "alert_count"    : 3,
    }
    await database.save_shift_report(state)
    cur = await db.execute("SELECT shift_type, availability_pct, total_alerts FROM shift_reports")
    row = await cur.fetchone()
    assert row[0] == "night"
    assert abs(row[1] - 66.7) < 0.01
    assert row[2] == 3


# ── get_shift_reports tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_shift_reports_empty(db):
    result = await database.get_shift_reports()
    assert result == []


@pytest.mark.asyncio
async def test_get_shift_reports_returns_rows(db):
    state = {
        "shift": {"shift": "day", "start": "06:00"},
        "timer_run": "05:00:00", "timer_stuck": "00:05:00",
        "timer_no_feed": "00:10:00", "availability_pct": 90.0,
        "tonnage_actual": 110.0, "alert_count": 1,
    }
    await database.save_shift_report(state)
    result = await database.get_shift_reports()
    assert len(result) == 1
    assert result[0]["shift_type"] == "day"


@pytest.mark.asyncio
async def test_get_shift_reports_limit(db):
    state = {
        "shift": {"shift": "day", "start": "06:00"},
        "timer_run": "01:00:00", "timer_stuck": "00:00:00",
        "timer_no_feed": "00:00:00", "availability_pct": 100.0,
        "tonnage_actual": 10.0, "alert_count": 0,
    }
    for _ in range(5):
        await database.save_shift_report(state)
    result = await database.get_shift_reports(limit=3)
    assert len(result) == 3


# ── get_alerts_history tests ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_alerts_history_empty(db):
    result = await database.get_alerts_history()
    assert result == []


@pytest.mark.asyncio
async def test_get_alerts_history_returns_rows(db):
    await database.save_alert("stone_stuck", "critical", "Stuck!")
    result = await database.get_alerts_history()
    assert len(result) == 1
    assert result[0]["alert_id"] == "stone_stuck"
    assert result[0]["level"] == "critical"
