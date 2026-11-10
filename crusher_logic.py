"""
crusher_logic.py — Crusher State Machine + Timers + VFD + OEE
Device  : Raspberry Pi 4
Plant   : Kannan Blue Metals
"""

import time
import threading
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

from config import (
    VFD_SPEEDS,
    PARTIAL_STUCK_TIME,
    EMPTY_NO_FEED_TIME,
    DAY_SHIFT_START,
    NIGHT_SHIFT_START,
)

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════

class MachineStatus(str, Enum):
    NORMAL          = "NORMAL"
    STONE_STUCK     = "STONE STUCK"
    NO_RAW_MATERIAL = "NO RAW MATERIAL"
    FAULT           = "FAULT"
    STOPPED         = "STOPPED"


class ShiftType(str, Enum):
    DAY   = "day"
    NIGHT = "night"


class AlertLevel(str, Enum):
    INFO     = "info"
    WARNING  = "warning"
    CRITICAL = "critical"


# ═══════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════

@dataclass
class Alert:
    id        : str
    level     : AlertLevel
    message   : str
    timestamp : datetime = field(default_factory=datetime.now)
    resolved  : bool     = False

    def to_dict(self):
        return {
            "id"        : self.id,
            "level"     : self.level.value,
            "message"   : self.message,
            "timestamp" : self.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "resolved"  : self.resolved,
        }


@dataclass
class ShiftInfo:
    shift_type  : ShiftType
    start_time  : datetime

    @property
    def elapsed_minutes(self) -> float:
        return (datetime.now() - self.start_time).total_seconds() / 60

    def to_dict(self):
        return {
            "shift"           : self.shift_type.value,
            "start"           : self.start_time.strftime("%H:%M"),
            "elapsed_minutes" : round(self.elapsed_minutes, 1),
        }


# ═══════════════════════════════════════════════════════════
# ELAPSED TIMER
# ═══════════════════════════════════════════════════════════

class ElapsedTimer:
    """Accumulated timer — start/stop/reset"""

    def __init__(self, name: str):
        self.name     = name
        self._total   = 0.0
        self._start   = None
        self._running = False

    def start(self):
        if not self._running:
            self._start   = time.time()
            self._running = True

    def stop(self):
        if self._running:
            self._total  += time.time() - self._start
            self._running = False

    def reset(self):
        self._total   = 0.0
        self._start   = None
        self._running = False

    @property
    def seconds(self) -> float:
        if self._running:
            return self._total + (time.time() - self._start)
        return self._total

    @property
    def minutes(self) -> float:
        return self.seconds / 60.0

    @property
    def hms(self) -> str:
        s   = int(self.seconds)
        h   = s // 3600
        m   = (s % 3600) // 60
        sec = s % 60
        return f"{h:02d}:{m:02d}:{sec:02d}"


# ═══════════════════════════════════════════════════════════
# CRUSHER LOGIC — MAIN CLASS
# ═══════════════════════════════════════════════════════════

class CrusherLogic:
    """
    Core crusher brain.

    Call update(label, conf) every frame from camera.py.
    Call get_state() to get full state dict for WebSocket/API.
    """

    def __init__(self):
        self._lock = threading.Lock()

        # ── Jaw / Machine state ────────────────────────────────
        self.jaw_label      : str            = "unknown"
        self.jaw_conf       : float          = 0.0
        self.machine_status : MachineStatus  = MachineStatus.STOPPED
        self.prev_status    : MachineStatus  = MachineStatus.STOPPED
        self.status_since   : datetime       = datetime.now()

        # ── Session start / last activity (for daily report) ───
        self.session_start  : datetime       = datetime.now()
        self.last_active    : datetime       = datetime.now()
        self.first_run_at   : Optional[datetime] = None  # first NORMAL status today

        # ── VFD ────────────────────────────────────────────────
        self.target_vfd_rpm  : int   = 0      # RPM to send to VFD controller

        # ── Partial / Empty timers ─────────────────────────────
        self._partial_start : Optional[float] = None
        self._empty_start   : Optional[float] = None

        # ── Shift-change detection cache (checked every 30 s) ──
        self._last_shift_check : float = 0.0

        # ── Auto-saved shift report, picked up by the DB background task ──
        self._pending_shift_snapshot : Optional[dict] = None

        # ── Shift timers (accumulated) ─────────────────────────
        self.timer_run      = ElapsedTimer("run")
        self.timer_idle     = ElapsedTimer("idle")
        self.timer_stuck    = ElapsedTimer("stuck")
        self.timer_no_feed  = ElapsedTimer("no_feed")
        self.timer_shift    = ElapsedTimer("shift")
        self.timer_shift.start()

        # ── OEE counters ───────────────────────────────────────
        self.frame_count        : int   = 0
        self.frames_running     : int   = 0
        self.frames_stuck       : int   = 0
        self.frames_no_feed     : int   = 0
        self.tonnage_actual     : float = 0.0

        # ── Alerts ─────────────────────────────────────────────
        self.alerts         : list[Alert] = []
        self._alert_ids     : set         = set()

        # ── State history (last 100) ───────────────────────────
        self.history        : list[dict]  = []

        # ── Shift ──────────────────────────────────────────────
        self.shift          : ShiftInfo  = self._detect_shift()

        log.info("CrusherLogic initialized.")

    # ═══════════════════════════════════════════════════════
    # PUBLIC — Called every frame from camera.py
    # ═══════════════════════════════════════════════════════

    def update(self, label: str, conf: float):
        """
        Main entry point. Call once per YOLO inference frame.

        label : e.g. "jaw filled", "jaw partially filled", "jaw empty"
        conf  : confidence 0.0–1.0
        """
        with self._lock:
            self.jaw_label  = label
            self.jaw_conf   = conf
            self.frame_count += 1
            self.last_active = datetime.now()

            now = time.time()

            # ── VFD target speed ──────────────────────────────
            self.target_vfd_rpm = VFD_SPEEDS.get(label, 0)

            # ── Timer logic (your original logic, production-safe) ──
            if label == "jaw partially filled":
                if self._partial_start is None:
                    self._partial_start = now
                self._empty_start = None

            elif label == "jaw empty":
                if self._empty_start is None:
                    self._empty_start = now
                self._partial_start = None

            elif label == "jaw filled":
                self._partial_start = None
                self._empty_start   = None

            else:
                # Unknown label — reset both
                self._partial_start = None
                self._empty_start   = None

            # ── Elapsed durations ─────────────────────────────
            partial_secs = int(now - self._partial_start) if self._partial_start else 0
            empty_secs   = int(now - self._empty_start)   if self._empty_start   else 0

            # ── Status evaluation ─────────────────────────────
            prev = self.machine_status

            if partial_secs >= PARTIAL_STUCK_TIME:
                self.machine_status = MachineStatus.STONE_STUCK
            elif empty_secs >= EMPTY_NO_FEED_TIME:
                self.machine_status = MachineStatus.NO_RAW_MATERIAL
            elif label in VFD_SPEEDS:
                self.machine_status = MachineStatus.NORMAL
            else:
                self.machine_status = MachineStatus.STOPPED

            # ── State change tracking ─────────────────────────
            if self.machine_status != prev:
                self.prev_status  = prev
                self.status_since = datetime.now()
                self._add_history(prev.value, self.machine_status.value)
                log.info(
                    f"Status change: {prev.value} → {self.machine_status.value}"
                )

            # ── Accumulated shift timers ──────────────────────
            if self.machine_status == MachineStatus.NORMAL:
                # Record first time machine ever went NORMAL this session
                if self.first_run_at is None:
                    self.first_run_at = datetime.now()
                self.timer_run.start()
                self.timer_stuck.stop()
                self.timer_no_feed.stop()
                self.timer_idle.stop()
                self.frames_running += 1
            elif self.machine_status == MachineStatus.STONE_STUCK:
                self.timer_stuck.start()
                self.timer_run.stop()
                self.timer_no_feed.stop()
                self.frames_stuck += 1
            elif self.machine_status == MachineStatus.NO_RAW_MATERIAL:
                self.timer_no_feed.start()
                self.timer_run.stop()
                self.timer_stuck.stop()
                self.frames_no_feed += 1
            else:
                self.timer_idle.start()
                self.timer_run.stop()
                self.timer_stuck.stop()
                self.timer_no_feed.stop()

            # ── Alerts ────────────────────────────────────────
            if self.machine_status == MachineStatus.STONE_STUCK:
                self._raise_alert(
                    "stone_stuck",
                    AlertLevel.CRITICAL,
                    f"Stone stuck — jaw partially filled for {partial_secs}s"
                )
            elif self.machine_status == MachineStatus.NO_RAW_MATERIAL:
                self._raise_alert(
                    "no_raw_material",
                    AlertLevel.WARNING,
                    f"No raw material — jaw empty for {empty_secs}s"
                )
            else:
                self._resolve_alert("stone_stuck")
                self._resolve_alert("no_raw_material")

            # ── Shift check (throttled to once every 30 s) ───────
            if now - self._last_shift_check >= 30:
                self._last_shift_check = now
                new_shift = self._detect_shift()
                if new_shift.shift_type != self.shift.shift_type:
                    log.info(
                        f"Shift change: {self.shift.shift_type.value} → "
                        f"{new_shift.shift_type.value}"
                    )
                    # Snapshot the outgoing shift's state so the DB background
                    # task can persist it to shift_reports before it's lost.
                    self._pending_shift_snapshot = self._state_locked()
                    self.shift = new_shift
                    self._reset_shift_timers()

            # ── Per-frame debug log (use DEBUG level to avoid log bloat) ─
            log.debug(
                f"Label: {label} | Conf: {conf:.2f} | "
                f"VFD: {self.target_vfd_rpm} RPM | "
                f"Status: {self.machine_status.value} | "
                f"partial_secs: {partial_secs} | empty_secs: {empty_secs}"
            )

    def update_tonnage(self, tonnes: float):
        """Call when tonnage sensor/scale updates"""
        with self._lock:
            self.tonnage_actual += tonnes

    # ═══════════════════════════════════════════════════════
    # PUBLIC — State output
    # ═══════════════════════════════════════════════════════

    def get_state(self) -> dict:
        """Full state dict — sent via WebSocket each frame"""
        with self._lock:
            run_min  = self.timer_run.minutes
            shift_min = self.timer_shift.minutes
            avail = round((run_min / shift_min * 100), 1) if shift_min > 0 else 0.0

            return {
                # Jaw & detection
                "jaw_label"       : self.jaw_label,
                "jaw_conf"        : round(self.jaw_conf, 3),

                # Machine status
                "machine_status"  : self.machine_status.value,
                "status_since"    : self.status_since.strftime("%H:%M:%S"),

                # VFD
                "target_vfd_rpm"   : self.target_vfd_rpm,

                # Timers
                "timer_run"       : self.timer_run.hms,
                "timer_stuck"     : self.timer_stuck.hms,
                "timer_no_feed"   : self.timer_no_feed.hms,
                "timer_idle"      : self.timer_idle.hms,
                "timer_shift"     : self.timer_shift.hms,

                # OEE
                "availability_pct": avail,
                "frames_running"  : self.frames_running,
                "frames_stuck"    : self.frames_stuck,
                "frames_no_feed"  : self.frames_no_feed,
                "frame_count"     : self.frame_count,
                "tonnage_actual"  : round(self.tonnage_actual, 2),

                # Alerts
                "active_alerts"   : [
                    a.to_dict() for a in self.alerts if not a.resolved
                ],
                "alert_count"     : sum(1 for a in self.alerts if not a.resolved),

                # Partial / empty elapsed durations (seconds)
                "partial_secs"    : int(time.time() - self._partial_start) if self._partial_start else 0,
                "empty_secs"      : int(time.time() - self._empty_start)   if self._empty_start   else 0,

                # Model session (for daily report)
                "session_start"   : self.session_start.strftime("%Y-%m-%d %H:%M:%S"),
                "last_active"     : self.last_active.strftime("%Y-%m-%d %H:%M:%S"),
                "first_run_at"    : self.first_run_at.strftime("%Y-%m-%d %H:%M:%S") if self.first_run_at else None,

                # Shift
                "shift"           : self.shift.to_dict(),
            }

    def get_history(self) -> list:
        with self._lock:
            return list(self.history)

    def reset_shift(self):
        with self._lock:
            self._reset_shift_timers()
            self.tonnage_actual = 0.0
            self.first_run_at   = None   # reset production start for new shift
            log.info("Shift reset by user.")

    # ═══════════════════════════════════════════════════════
    # PRIVATE HELPERS
    # ═══════════════════════════════════════════════════════

    def _detect_shift(self) -> ShiftInfo:
        now   = datetime.now()
        hour  = now.hour
        if DAY_SHIFT_START <= hour < NIGHT_SHIFT_START:
            stype = ShiftType.DAY
            start = now.replace(hour=DAY_SHIFT_START, minute=0, second=0, microsecond=0)
        else:
            stype = ShiftType.NIGHT
            if hour >= NIGHT_SHIFT_START:
                start = now.replace(hour=NIGHT_SHIFT_START, minute=0, second=0, microsecond=0)
            else:
                from datetime import timedelta
                start = (now - timedelta(days=1)).replace(
                    hour=NIGHT_SHIFT_START, minute=0, second=0, microsecond=0
                )
        return ShiftInfo(shift_type=stype, start_time=start)

    def _reset_shift_timers(self):
        for t in [
            self.timer_run, self.timer_idle,
            self.timer_stuck, self.timer_no_feed, self.timer_shift
        ]:
            t.reset()
        self.timer_shift.start()
        self.frames_running = 0
        self.frames_stuck   = 0
        self.frames_no_feed = 0

    def _raise_alert(self, alert_id: str, level: AlertLevel, message: str):
        if alert_id not in self._alert_ids:
            alert = Alert(id=alert_id, level=level, message=message)
            self.alerts.append(alert)
            self._alert_ids.add(alert_id)
            log.warning(f"ALERT [{level.value}]: {message}")

    def _resolve_alert(self, alert_id: str):
        if alert_id in self._alert_ids:
            for a in self.alerts:
                if a.id == alert_id and not a.resolved:
                    a.resolved = True
            self._alert_ids.discard(alert_id)
            # Prune resolved alerts — keep list bounded to avoid memory leak
            if len(self.alerts) > 200:
                self.alerts = self.alerts[-200:]

    def _add_history(self, from_status: str, to_status: str):
        entry = {
            "from"     : from_status,
            "to"       : to_status,
            "at"       : datetime.now().strftime("%H:%M:%S"),
            "jaw"      : self.jaw_label,
            "vfd_hz"   : self.target_vfd_rpm,
        }
        self.history.append(entry)
        if len(self.history) > 100:
            self.history = self.history[-100:]


# Global singleton
crusher_logic = CrusherLogic()
