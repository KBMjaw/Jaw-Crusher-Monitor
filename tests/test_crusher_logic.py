"""
tests/test_crusher_logic.py
Unit tests for CrusherLogic — state machine, timers, alerts, OEE.
No hardware required — runs fully on local PC.
"""

import time
from crusher_logic import CrusherLogic, MachineStatus, AlertLevel, ElapsedTimer


# ─────────────────────────────────────────────
# ElapsedTimer tests
# ─────────────────────────────────────────────

class TestElapsedTimer:

    def test_initial_state(self):
        t = ElapsedTimer("test")
        assert t.seconds == 0.0
        assert t.minutes == 0.0
        assert t.hms == "00:00:00"

    def test_start_accumulates(self):
        t = ElapsedTimer("test")
        t.start()
        time.sleep(0.1)
        assert t.seconds >= 0.09

    def test_stop_freezes_value(self):
        t = ElapsedTimer("test")
        t.start()
        time.sleep(0.1)
        t.stop()
        val = t.seconds
        time.sleep(0.1)
        assert abs(t.seconds - val) < 0.01  # not growing after stop

    def test_reset_clears(self):
        t = ElapsedTimer("test")
        t.start()
        time.sleep(0.05)
        t.stop()
        t.reset()
        assert t.seconds == 0.0

    def test_hms_format(self):
        t = ElapsedTimer("test")
        t._total = 3661  # 1 hour, 1 minute, 1 second
        assert t.hms == "01:01:01"

    def test_double_start_does_not_reset(self):
        t = ElapsedTimer("test")
        t.start()
        time.sleep(0.05)
        t.start()  # second start should be a no-op
        time.sleep(0.05)
        assert t.seconds >= 0.09

    def test_accumulates_across_start_stop_cycles(self):
        t = ElapsedTimer("test")
        t.start()
        time.sleep(0.05)
        t.stop()
        t.start()
        time.sleep(0.05)
        t.stop()
        assert t.seconds >= 0.09


# ─────────────────────────────────────────────
# CrusherLogic — initial state
# ─────────────────────────────────────────────

class TestCrusherLogicInit:

    def test_initial_status_is_stopped(self):
        logic = CrusherLogic()
        assert logic.machine_status == MachineStatus.STOPPED

    def test_initial_label_unknown(self):
        logic = CrusherLogic()
        assert logic.jaw_label == "unknown"

    def test_initial_frame_count_zero(self):
        logic = CrusherLogic()
        assert logic.frame_count == 0

    def test_initial_tonnage_zero(self):
        logic = CrusherLogic()
        assert logic.tonnage_actual == 0.0

    def test_initial_alerts_empty(self):
        logic = CrusherLogic()
        assert logic.alerts == []


# ─────────────────────────────────────────────
# CrusherLogic — status transitions
# ─────────────────────────────────────────────

class TestStatusTransitions:

    def test_jaw_filled_sets_normal(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        assert logic.machine_status == MachineStatus.NORMAL

    def test_jaw_empty_sets_normal_initially(self):
        """Empty jaw is NORMAL until EMPTY_NO_FEED_TIME seconds pass."""
        logic = CrusherLogic()
        logic.update("jaw empty", 0.90)
        # Should still be NORMAL — threshold not reached yet
        assert logic.machine_status == MachineStatus.NORMAL

    def test_jaw_partially_filled_sets_normal_initially(self):
        """Partially filled jaw is NORMAL until PARTIAL_STUCK_TIME seconds pass."""
        logic = CrusherLogic()
        logic.update("jaw partially filled", 0.88)
        assert logic.machine_status == MachineStatus.NORMAL

    def test_unknown_label_sets_stopped(self):
        logic = CrusherLogic()
        logic.update("unknown_label", 0.50)
        assert logic.machine_status == MachineStatus.STOPPED

    def test_stone_stuck_after_partial_threshold(self):
        """Simulate partial for longer than PARTIAL_STUCK_TIME → STONE STUCK."""
        logic = CrusherLogic()
        # Manually set partial start to 20 seconds ago (threshold is 15s)
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)
        assert logic.machine_status == MachineStatus.STONE_STUCK

    def test_no_raw_material_after_empty_threshold(self):
        """Simulate empty for longer than EMPTY_NO_FEED_TIME → NO RAW MATERIAL."""
        logic = CrusherLogic()
        # Manually set empty start to 35 seconds ago (threshold is 30s)
        logic._empty_start = time.time() - 35
        logic.update("jaw empty", 0.90)
        assert logic.machine_status == MachineStatus.NO_RAW_MATERIAL

    def test_filled_resets_partial_timer(self):
        """jaw filled should clear the partial stuck timer."""
        logic = CrusherLogic()
        logic._partial_start = time.time() - 20
        logic.update("jaw filled", 0.95)
        assert logic._partial_start is None

    def test_filled_resets_empty_timer(self):
        """jaw filled should clear the empty timer."""
        logic = CrusherLogic()
        logic._empty_start = time.time() - 35
        logic.update("jaw filled", 0.95)
        assert logic._empty_start is None

    def test_partial_resets_empty_timer(self):
        """jaw partially filled should clear the empty timer."""
        logic = CrusherLogic()
        logic._empty_start = time.time() - 10
        logic.update("jaw partially filled", 0.88)
        assert logic._empty_start is None

    def test_empty_resets_partial_timer(self):
        """jaw empty should clear the partial timer."""
        logic = CrusherLogic()
        logic._partial_start = time.time() - 5
        logic.update("jaw empty", 0.90)
        assert logic._partial_start is None

    def test_normal_to_stuck_transition_recorded_in_history(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)  # NORMAL
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)  # STONE STUCK
        assert len(logic.history) > 0
        last = logic.history[-1]
        assert last["to"] == MachineStatus.STONE_STUCK.value


# ─────────────────────────────────────────────
# CrusherLogic — VFD speed
# ─────────────────────────────────────────────

class TestVFDSpeed:

    def test_filled_gives_low_speed(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        assert logic.target_vfd_rpm == 900

    def test_partially_filled_gives_mid_speed(self):
        logic = CrusherLogic()
        logic.update("jaw partially filled", 0.88)
        assert logic.target_vfd_rpm == 1110

    def test_empty_gives_high_speed(self):
        logic = CrusherLogic()
        logic.update("jaw empty", 0.90)
        assert logic.target_vfd_rpm == 1290

    def test_unknown_label_gives_zero_speed(self):
        logic = CrusherLogic()
        logic.update("bad_label", 0.50)
        assert logic.target_vfd_rpm == 0


# ─────────────────────────────────────────────
# CrusherLogic — Timers
# ─────────────────────────────────────────────

class TestTimers:

    def test_run_timer_starts_on_normal(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        time.sleep(0.05)
        assert logic.timer_run.seconds > 0

    def test_stuck_timer_starts_on_stone_stuck(self):
        logic = CrusherLogic()
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)
        time.sleep(0.05)
        assert logic.timer_stuck.seconds > 0

    def test_no_feed_timer_starts_on_no_material(self):
        logic = CrusherLogic()
        logic._empty_start = time.time() - 35
        logic.update("jaw empty", 0.90)
        time.sleep(0.05)
        assert logic.timer_no_feed.seconds > 0

    def test_run_timer_stops_when_stuck(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        time.sleep(0.05)
        run_val = logic.timer_run.seconds
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)
        time.sleep(0.05)
        # Run timer should not grow after switching to stuck
        assert abs(logic.timer_run.seconds - run_val) < 0.02

    def test_frame_count_increments(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        logic.update("jaw filled", 0.95)
        logic.update("jaw filled", 0.95)
        assert logic.frame_count == 3


# ─────────────────────────────────────────────
# CrusherLogic — Alerts
# ─────────────────────────────────────────────

class TestAlerts:

    def test_stone_stuck_raises_critical_alert(self):
        logic = CrusherLogic()
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)
        active = [a for a in logic.alerts if not a.resolved]
        assert any(a.id == "stone_stuck" for a in active)
        assert any(a.level == AlertLevel.CRITICAL for a in active)

    def test_no_raw_material_raises_warning_alert(self):
        logic = CrusherLogic()
        logic._empty_start = time.time() - 35
        logic.update("jaw empty", 0.90)
        active = [a for a in logic.alerts if not a.resolved]
        assert any(a.id == "no_raw_material" for a in active)
        assert any(a.level == AlertLevel.WARNING for a in active)

    def test_alert_resolved_when_normal(self):
        logic = CrusherLogic()
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)  # raises alert
        logic._partial_start = None
        logic.update("jaw filled", 0.95)             # resolves alert
        active = [a for a in logic.alerts if not a.resolved]
        assert not any(a.id == "stone_stuck" for a in active)

    def test_duplicate_alert_not_raised_twice(self):
        logic = CrusherLogic()
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)
        count_before = len(logic.alerts)
        logic.update("jaw partially filled", 0.88)  # same alert again
        assert len(logic.alerts) == count_before    # no duplicate added


# ─────────────────────────────────────────────
# CrusherLogic — OEE / Availability
# ─────────────────────────────────────────────

class TestOEE:

    def test_availability_zero_at_start(self):
        logic = CrusherLogic()
        state = logic.get_state()
        # Shift just started — very little time elapsed, but timer_shift starts at init
        # availability = run / shift * 100 — should be near 0 with no updates
        assert state["availability_pct"] >= 0.0

    def test_availability_100_when_all_run(self):
        logic = CrusherLogic()
        # Force run timer = shift timer (100% availability)
        logic.timer_run._total = 100.0
        logic.timer_shift._total = 100.0
        logic.timer_shift._running = False
        state = logic.get_state()
        assert state["availability_pct"] == 100.0

    def test_availability_50_when_half_run(self):
        logic = CrusherLogic()
        logic.timer_run._total = 50.0
        logic.timer_shift._total = 100.0
        logic.timer_shift._running = False
        state = logic.get_state()
        assert state["availability_pct"] == 50.0

    def test_frames_running_count(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        logic.update("jaw filled", 0.95)
        assert logic.frames_running == 2

    def test_frames_stuck_count(self):
        logic = CrusherLogic()
        logic._partial_start = time.time() - 20
        logic.update("jaw partially filled", 0.88)
        assert logic.frames_stuck == 1

    def test_tonnage_update(self):
        logic = CrusherLogic()
        logic.update_tonnage(5.5)
        logic.update_tonnage(3.2)
        assert abs(logic.tonnage_actual - 8.7) < 0.01


# ─────────────────────────────────────────────
# CrusherLogic — get_state() dict
# ─────────────────────────────────────────────

class TestGetState:

    def test_get_state_returns_dict(self):
        logic = CrusherLogic()
        state = logic.get_state()
        assert isinstance(state, dict)

    def test_get_state_has_required_keys(self):
        logic = CrusherLogic()
        state = logic.get_state()
        required_keys = [
            "jaw_label", "jaw_conf", "machine_status", "status_since",
            "target_vfd_rpm", "timer_run", "timer_stuck", "timer_no_feed",
            "timer_idle", "timer_shift", "availability_pct",
            "frames_running", "frames_stuck", "frames_no_feed",
            "frame_count", "tonnage_actual", "active_alerts", "alert_count",
            "partial_secs", "empty_secs", "session_start", "last_active", "shift",
        ]
        for key in required_keys:
            assert key in state, f"Missing key: {key}"

    def test_get_state_machine_status_is_string(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        state = logic.get_state()
        assert isinstance(state["machine_status"], str)

    def test_get_state_after_update_reflects_label(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.92)
        state = logic.get_state()
        assert state["jaw_label"] == "jaw filled"
        assert abs(state["jaw_conf"] - 0.92) < 0.001

    def test_shift_dict_in_state(self):
        logic = CrusherLogic()
        state = logic.get_state()
        assert "shift" in state["shift"]
        assert "start" in state["shift"]
        assert "elapsed_minutes" in state["shift"]


# ─────────────────────────────────────────────
# CrusherLogic — reset_shift
# ─────────────────────────────────────────────

class TestResetShift:

    def test_reset_clears_timers(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        time.sleep(0.05)
        logic.reset_shift()
        assert logic.timer_run.seconds < 0.01

    def test_reset_clears_tonnage(self):
        logic = CrusherLogic()
        logic.update_tonnage(10.0)
        logic.reset_shift()
        assert logic.tonnage_actual == 0.0

    def test_reset_clears_frame_counters(self):
        logic = CrusherLogic()
        logic.update("jaw filled", 0.95)
        logic.update("jaw filled", 0.95)
        logic.reset_shift()
        assert logic.frames_running == 0
        assert logic.frames_stuck == 0
        assert logic.frames_no_feed == 0
