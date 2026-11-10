"""
tests/test_vfd_controller.py
Unit tests for VFDController — no hardware required.
All Modbus I/O is replaced with MagicMock / AsyncMock.
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from vfd_controller import VFDController, _decode_abb_status_word


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ok_response():
    """A Modbus write-register response that reports no error."""
    r = MagicMock()
    r.isError.return_value = False
    return r


def _err_response():
    """A Modbus write-register response that reports an error."""
    r = MagicMock()
    r.isError.return_value = True
    return r


def _read_response(sw, act1):
    """A Modbus read-holding-registers response with two register values."""
    r = MagicMock()
    r.isError.return_value = False
    r.registers = [sw, act1]
    return r


def _make_connected_vfd():
    """Return a VFDController that is already connected and initialised."""
    vfd = VFDController()
    vfd._enabled     = True
    vfd._connected   = True
    vfd._initialized = True
    vfd._last_rpm    = -1   # sentinel — forces write on first call
    vfd._client      = MagicMock()
    return vfd


# ─────────────────────────────────────────────────────────────────────────────
# _decode_abb_status_word
# ─────────────────────────────────────────────────────────────────────────────

class TestDecodeAbbStatusWord:

    def test_none_returns_empty(self):
        assert _decode_abb_status_word(None) == {}

    def test_zero_all_false(self):
        d = _decode_abb_status_word(0x0000)
        assert d["rdy_on"]       is False
        assert d["running"]      is False
        assert d["tripped"]      is False
        assert d["remote"]       is False
        assert d["at_setpoint"]  is False

    def test_rdy_on_bit0(self):
        assert _decode_abb_status_word(0x0001)["rdy_on"] is True

    def test_rdy_run_bit1(self):
        assert _decode_abb_status_word(0x0002)["rdy_run"] is True

    def test_running_bit2(self):
        assert _decode_abb_status_word(0x0004)["running"] is True

    def test_tripped_bit3(self):
        assert _decode_abb_status_word(0x0008)["tripped"] is True

    def test_alarm_bit7(self):
        assert _decode_abb_status_word(0x0080)["alarm"] is True

    def test_at_setpoint_bit8(self):
        assert _decode_abb_status_word(0x0100)["at_setpoint"] is True

    def test_remote_bit9(self):
        assert _decode_abb_status_word(0x0200)["remote"] is True

    def test_raw_field_is_hex_string(self):
        d = _decode_abb_status_word(0x0F0F)
        assert d["raw"] == "0x0F0F"

    def test_combined_bits(self):
        # bit0 + bit2 + bit9 = rdy_on + running + remote
        sw = 0x0001 | 0x0004 | 0x0200
        d = _decode_abb_status_word(sw)
        assert d["rdy_on"]  is True
        assert d["running"] is True
        assert d["remote"]  is True
        assert d["tripped"] is False

    def test_full_running_word_0x0337(self):
        # 0x0337 = rdy_on|rdy_run|running|off2|off3|at_setpoint|remote
        # (0x0037 | 0x0100 | 0x0200)
        d = _decode_abb_status_word(0x0337)
        assert d["rdy_on"]      is True
        assert d["rdy_run"]     is True
        assert d["running"]     is True
        assert d["remote"]      is True
        assert d["at_setpoint"] is True


# ─────────────────────────────────────────────────────────────────────────────
# VFDController — initial state
# ─────────────────────────────────────────────────────────────────────────────

class TestVFDControllerInit:

    def test_not_enabled_by_default(self):
        vfd = VFDController()
        assert vfd._enabled is False

    def test_not_connected_by_default(self):
        vfd = VFDController()
        assert vfd._connected is False

    def test_not_initialized_by_default(self):
        vfd = VFDController()
        assert vfd._initialized is False

    def test_last_rpm_sentinel(self):
        vfd = VFDController()
        assert vfd._last_rpm == -1

    def test_counters_zero(self):
        vfd = VFDController()
        assert vfd._total_writes       == 0
        assert vfd._total_errors       == 0
        assert vfd._consecutive_errors == 0

    def test_status_property_returns_dict(self):
        vfd = VFDController()
        s = vfd.status
        assert isinstance(s, dict)

    def test_status_has_required_keys(self):
        vfd = VFDController()
        s = vfd.status
        for key in [
            "enabled", "mode", "profile", "connected", "initialized",
            "target_rpm", "actual_rpm", "status_word",
            "last_write_ts", "last_error", "total_writes",
            "total_errors", "consecutive_errors",
        ]:
            assert key in s, f"Missing key: {key}"

    def test_status_target_rpm_zero_when_sentinel(self):
        vfd = VFDController()
        assert vfd.status["target_rpm"] == 0   # sentinel -1 → 0


# ─────────────────────────────────────────────────────────────────────────────
# connect() — disabled path
# ─────────────────────────────────────────────────────────────────────────────

class TestConnectDisabled:

    def test_connect_noop_when_disabled(self):
        """When VFD_ENABLED=false, connect() must not touch Modbus."""
        vfd = VFDController()
        with patch("config.VFD_ENABLED", False):
            asyncio.run(vfd.connect())
        assert vfd._connected is False
        assert vfd._client    is None


# ─────────────────────────────────────────────────────────────────────────────
# set_speed() — disabled / not-connected guards
# ─────────────────────────────────────────────────────────────────────────────

class TestSetSpeedGuards:

    def test_set_speed_noop_when_disabled(self):
        vfd = VFDController()
        vfd._enabled = False
        # Should return immediately without touching anything
        asyncio.run(vfd.set_speed(900))
        assert vfd._total_writes == 0

    def test_set_speed_noop_when_same_rpm(self):
        """set_speed must not write to Modbus if RPM hasn't changed."""
        vfd = _make_connected_vfd()
        vfd._last_rpm = 900       # pretend 900 was already written
        asyncio.run(vfd.set_speed(900))
        vfd._client.write_register.assert_not_called()

    def test_set_speed_writes_on_change(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        asyncio.run(vfd.set_speed(900))
        assert vfd._client.write_register.call_count == 2   # REF1 + CW

    def test_set_speed_second_call_same_rpm_no_write(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        asyncio.run(vfd.set_speed(1110))
        first_count = vfd._client.write_register.call_count
        asyncio.run(vfd.set_speed(1110))   # same — should not write again
        assert vfd._client.write_register.call_count == first_count


# ─────────────────────────────────────────────────────────────────────────────
# _sync_write_speed — success path
# ─────────────────────────────────────────────────────────────────────────────

class TestSyncWriteSpeedSuccess:

    def _write(self, vfd, rpm):
        """Run _sync_write_speed synchronously (it's a plain def, not async)."""
        vfd._sync_write_speed(rpm)

    def test_ref1_written_with_correct_scaled_value(self):
        """REF1 register = rpm × VFD_SCALE (default ≈ 13.333)."""
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 900)
        first_call = vfd._client.write_register.call_args_list[0]
        expected_ref = int(round(900 * 13.333))
        assert first_call == call(address=0x0001, value=expected_ref, slave=1)

    def test_cw_run_written_for_nonzero_rpm(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 1110)
        second_call = vfd._client.write_register.call_args_list[1]
        assert second_call == call(address=0x0000, value=0x047F, slave=1)

    def test_cw_stop_written_for_zero_rpm(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 0)
        second_call = vfd._client.write_register.call_args_list[1]
        assert second_call == call(address=0x0000, value=0x047E, slave=1)

    def test_success_increments_total_writes(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 900)
        assert vfd._total_writes == 1

    def test_success_resets_consecutive_errors(self):
        vfd = _make_connected_vfd()
        vfd._consecutive_errors = 3
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 900)
        assert vfd._consecutive_errors == 0

    def test_success_updates_last_rpm(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 1290)
        assert vfd._last_rpm == 1290

    def test_success_clears_last_error(self):
        vfd = _make_connected_vfd()
        vfd._last_error = "previous error"
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 900)
        assert vfd._last_error == ""

    def test_success_updates_last_write_ts(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        before = time.time()
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, 900)
        assert vfd._last_write_ts >= before


# ─────────────────────────────────────────────────────────────────────────────
# _sync_write_speed — RPM clamping
# ─────────────────────────────────────────────────────────────────────────────

class TestRPMClamping:

    def _write(self, vfd, rpm):
        vfd._sync_write_speed(rpm)

    def _patched_write(self, vfd, rpm):
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            self._write(vfd, rpm)

    def test_rpm_above_max_clamped_to_max(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        self._patched_write(vfd, 9999)
        assert vfd._last_rpm == 1290

    def test_negative_rpm_clamped_to_zero(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        self._patched_write(vfd, -100)
        assert vfd._last_rpm == 0

    def test_exact_max_rpm_not_clamped(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        self._patched_write(vfd, 1290)
        assert vfd._last_rpm == 1290

    def test_three_valid_speeds_written(self):
        """All three crusher speeds (900, 1110, 1290) must write successfully."""
        for rpm in (900, 1110, 1290):
            vfd = _make_connected_vfd()
            vfd._client.write_register.return_value = _ok_response()
            self._patched_write(vfd, rpm)
            assert vfd._last_rpm == rpm, f"Expected _last_rpm={rpm}"
            assert vfd._total_writes == 1


# ─────────────────────────────────────────────────────────────────────────────
# _sync_write_speed — error path
# ─────────────────────────────────────────────────────────────────────────────

class TestSyncWriteSpeedError:

    def _patched_write(self, vfd, rpm, responses):
        vfd._client.write_register.side_effect = responses
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            vfd._sync_write_speed(rpm)

    def test_ref1_error_response_increments_total_errors(self):
        vfd = _make_connected_vfd()
        self._patched_write(vfd, 900, [_err_response()])
        assert vfd._total_errors == 1

    def test_ref1_error_marks_disconnected(self):
        vfd = _make_connected_vfd()
        self._patched_write(vfd, 900, [_err_response()])
        assert vfd._connected is False

    def test_ref1_error_marks_uninitialized(self):
        vfd = _make_connected_vfd()
        self._patched_write(vfd, 900, [_err_response()])
        assert vfd._initialized is False

    def test_exception_increments_errors(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.side_effect = OSError("serial write timeout")
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            vfd._sync_write_speed(900)
        assert vfd._total_errors == 1

    def test_exception_stores_last_error(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.side_effect = OSError("serial write timeout")
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            vfd._sync_write_speed(900)
        assert "serial write timeout" in vfd._last_error

    def test_cw_error_response_increments_total_errors(self):
        """REF1 ok, CW write returns error → should count as error."""
        vfd = _make_connected_vfd()
        self._patched_write(vfd, 900, [_ok_response(), _err_response()])
        assert vfd._total_errors == 1

    def test_total_writes_not_incremented_on_error(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.side_effect = OSError("no response")
        with patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E):
            vfd._sync_write_speed(900)
        assert vfd._total_writes == 0


# ─────────────────────────────────────────────────────────────────────────────
# _sync_write_speed — reconnect path
# ─────────────────────────────────────────────────────────────────────────────

class TestReconnectPath:

    def test_reconnect_attempted_when_not_connected(self):
        """When _connected=False, _sync_connect should be called."""
        vfd = _make_connected_vfd()
        vfd._connected = False
        with patch.object(vfd, "_sync_connect") as mock_connect, \
             patch("config.VFD_SCALE", 13.333), \
             patch("config.VFD_MAX_RPM", 1290), \
             patch("config.VFD_FREQ_REGISTER", 0x0001), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_RUN",  0x047F), \
             patch("config.VFD_CMD_STOP", 0x047E), \
             patch("config.VFD_MODE", "rtu"), \
             patch("config.VFD_PORT", "/dev/ttyUSB0"), \
             patch("config.VFD_BAUDRATE", 9600), \
             patch("config.VFD_PARITY", "N"), \
             patch("config.VFD_STOPBITS", 1), \
             patch("config.VFD_BYTESIZE", 8), \
             patch("config.VFD_TCP_HOST", "192.168.0.200"), \
             patch("config.VFD_TCP_PORT", 502), \
             patch("config.VFD_TIMEOUT", 1.0):
            vfd._sync_write_speed(900)
        mock_connect.assert_called_once()

    def test_reconnect_failure_increments_errors(self):
        """If reconnect fails (_connected stays False), error counter must go up."""
        vfd = _make_connected_vfd()
        vfd._connected = False
        vfd._client    = None
        with patch.object(vfd, "_sync_connect"):   # connect() called but _connected stays False
            with patch("config.VFD_SCALE", 13.333), \
                 patch("config.VFD_MAX_RPM", 1290), \
                 patch("config.VFD_FREQ_REGISTER", 0x0001), \
                 patch("config.VFD_CMD_REGISTER",  0x0000), \
                 patch("config.VFD_SLAVE_ID", 1), \
                 patch("config.VFD_CMD_RUN",  0x047F), \
                 patch("config.VFD_CMD_STOP", 0x047E), \
                 patch("config.VFD_MODE", "rtu"), \
                 patch("config.VFD_PORT", "/dev/ttyUSB0"), \
                 patch("config.VFD_BAUDRATE", 9600), \
                 patch("config.VFD_PARITY", "N"), \
                 patch("config.VFD_STOPBITS", 1), \
                 patch("config.VFD_BYTESIZE", 8), \
                 patch("config.VFD_TCP_HOST", "192.168.0.200"), \
                 patch("config.VFD_TCP_PORT", 502), \
                 patch("config.VFD_TIMEOUT", 1.0):
                vfd._sync_write_speed(900)
        assert vfd._total_errors >= 1
        assert vfd._consecutive_errors >= 1


# ─────────────────────────────────────────────────────────────────────────────
# _sync_read_status
# ─────────────────────────────────────────────────────────────────────────────

class TestSyncReadStatus:

    def test_stores_status_word(self):
        vfd = _make_connected_vfd()
        vfd._client.read_holding_registers.return_value = _read_response(0x0237, 12000)
        with patch("config.VFD_SLAVE_ID", 1), patch("config.VFD_SCALE", 13.333):
            vfd._sync_read_status()
        assert vfd._last_status_raw == 0x0237

    def test_calculates_actual_rpm(self):
        vfd = _make_connected_vfd()
        vfd._client.read_holding_registers.return_value = _read_response(0x0237, 12000)
        with patch("config.VFD_SLAVE_ID", 1), patch("config.VFD_SCALE", 13.333):
            vfd._sync_read_status()
        expected = round(12000 / 13.333, 1)
        assert abs(vfd._last_actual_rpm - expected) < 0.5

    def test_handles_negative_act1_two_complement(self):
        """act1 > 32767 should be treated as signed negative (reverse direction)."""
        vfd = _make_connected_vfd()
        act1_unsigned = 65536 - 100   # -100 in 16-bit two's complement
        vfd._client.read_holding_registers.return_value = _read_response(0x0000, act1_unsigned)
        with patch("config.VFD_SLAVE_ID", 1), patch("config.VFD_SCALE", 13.333):
            vfd._sync_read_status()
        assert vfd._last_actual_rpm < 0

    def test_read_error_response_stores_last_error(self):
        vfd = _make_connected_vfd()
        err = _err_response()
        err.registers = None
        vfd._client.read_holding_registers.return_value = err
        with patch("config.VFD_SLAVE_ID", 1), patch("config.VFD_SCALE", 13.333):
            vfd._sync_read_status()
        assert vfd._last_error != ""

    def test_read_exception_stores_last_error(self):
        vfd = _make_connected_vfd()
        vfd._client.read_holding_registers.side_effect = OSError("timeout")
        with patch("config.VFD_SLAVE_ID", 1), patch("config.VFD_SCALE", 13.333):
            vfd._sync_read_status()
        assert "timeout" in vfd._last_error

    def test_read_status_skipped_when_disabled(self):
        vfd = VFDController()
        vfd._enabled   = False
        vfd._connected = True
        vfd._client    = MagicMock()
        asyncio.run(vfd.read_status())
        vfd._client.read_holding_registers.assert_not_called()

    def test_read_status_skipped_when_not_connected(self):
        vfd = VFDController()
        vfd._enabled   = True
        vfd._connected = False
        vfd._client    = MagicMock()
        asyncio.run(vfd.read_status())
        vfd._client.read_holding_registers.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# ABB init sequence (_run_init_sequence)
# ─────────────────────────────────────────────────────────────────────────────

class TestRunInitSequence:

    def test_non_abb_profile_skips_to_initialized(self):
        """Non-ABB profiles should immediately set _initialized=True."""
        vfd = _make_connected_vfd()
        vfd._initialized = False
        with patch("config.VFD_INIT_SEQUENCE", True), \
             patch("config.VFD_PROFILE", "delta"), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_PREPARE",   0x0476), \
             patch("config.VFD_CMD_SWITCH_ON", 0x0477):
            asyncio.run(vfd._run_init_sequence())
        assert vfd._initialized is True

    def test_init_sequence_disabled_skips_to_initialized(self):
        """VFD_INIT_SEQUENCE=false should immediately set _initialized=True."""
        vfd = _make_connected_vfd()
        vfd._initialized = False
        with patch("config.VFD_INIT_SEQUENCE", False), \
             patch("config.VFD_PROFILE", "abb"), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_PREPARE",   0x0476), \
             patch("config.VFD_CMD_SWITCH_ON", 0x0477):
            asyncio.run(vfd._run_init_sequence())
        assert vfd._initialized is True

    def test_abb_init_success_sets_initialized(self):
        """Successful PREPARE + SWITCH_ON writes should set _initialized=True."""
        vfd = _make_connected_vfd()
        vfd._initialized = False
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_INIT_SEQUENCE", True), \
             patch("config.VFD_PROFILE", "abb"), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_PREPARE",   0x0476), \
             patch("config.VFD_CMD_SWITCH_ON", 0x0477), \
             patch("asyncio.sleep", new_callable=AsyncMock):
            asyncio.run(vfd._run_init_sequence())
        assert vfd._initialized is True

    def test_abb_init_sends_prepare_command(self):
        vfd = _make_connected_vfd()
        vfd._initialized = False
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_INIT_SEQUENCE", True), \
             patch("config.VFD_PROFILE", "abb"), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_PREPARE",   0x0476), \
             patch("config.VFD_CMD_SWITCH_ON", 0x0477), \
             patch("asyncio.sleep", new_callable=AsyncMock):
            asyncio.run(vfd._run_init_sequence())
        all_calls = vfd._client.write_register.call_args_list
        prepare_sent = any(c.kwargs.get("value") == 0x0476 for c in all_calls)
        assert prepare_sent

    def test_abb_init_sends_switch_on_command(self):
        vfd = _make_connected_vfd()
        vfd._initialized = False
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_INIT_SEQUENCE", True), \
             patch("config.VFD_PROFILE", "abb"), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_PREPARE",   0x0476), \
             patch("config.VFD_CMD_SWITCH_ON", 0x0477), \
             patch("asyncio.sleep", new_callable=AsyncMock):
            asyncio.run(vfd._run_init_sequence())
        all_calls = vfd._client.write_register.call_args_list
        switch_on_sent = any(c.kwargs.get("value") == 0x0477 for c in all_calls)
        assert switch_on_sent

    def test_abb_init_failure_leaves_uninitialized(self):
        """If PREPARE write errors, _initialized must stay False."""
        vfd = _make_connected_vfd()
        vfd._initialized = False
        vfd._client.write_register.return_value = _err_response()
        with patch("config.VFD_INIT_SEQUENCE", True), \
             patch("config.VFD_PROFILE", "abb"), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_PREPARE",   0x0476), \
             patch("config.VFD_CMD_SWITCH_ON", 0x0477), \
             patch("asyncio.sleep", new_callable=AsyncMock):
            asyncio.run(vfd._run_init_sequence())
        assert vfd._initialized is False

    def test_abb_init_exception_stores_last_error(self):
        vfd = _make_connected_vfd()
        vfd._initialized = False
        vfd._client.write_register.side_effect = OSError("RS-485 timeout")
        with patch("config.VFD_INIT_SEQUENCE", True), \
             patch("config.VFD_PROFILE", "abb"), \
             patch("config.VFD_CMD_REGISTER",  0x0000), \
             patch("config.VFD_SLAVE_ID", 1), \
             patch("config.VFD_CMD_PREPARE",   0x0476), \
             patch("config.VFD_CMD_SWITCH_ON", 0x0477), \
             patch("asyncio.sleep", new_callable=AsyncMock):
            asyncio.run(vfd._run_init_sequence())
        assert "init sequence" in vfd._last_error


# ─────────────────────────────────────────────────────────────────────────────
# stop_drive()
# ─────────────────────────────────────────────────────────────────────────────

class TestStopDrive:

    def test_stop_drive_disabled_noop(self):
        vfd = VFDController()
        vfd._enabled = False
        asyncio.run(vfd.stop_drive())
        assert vfd._total_writes == 0

    def test_stop_drive_calls_sync_write_with_zero(self):
        vfd = _make_connected_vfd()
        with patch.object(vfd, "_sync_write_speed") as mock_write:
            asyncio.run(vfd.stop_drive())
        mock_write.assert_called_once_with(0)


# ─────────────────────────────────────────────────────────────────────────────
# reset_fault()
# ─────────────────────────────────────────────────────────────────────────────

class TestResetFault:

    def test_reset_fault_disabled_noop(self):
        vfd = VFDController()
        vfd._enabled   = False
        vfd._connected = True
        vfd._client    = MagicMock()
        asyncio.run(vfd.reset_fault())
        vfd._client.write_register.assert_not_called()

    def test_reset_fault_not_connected_noop(self):
        vfd = VFDController()
        vfd._enabled   = True
        vfd._connected = False
        vfd._client    = MagicMock()
        asyncio.run(vfd.reset_fault())
        vfd._client.write_register.assert_not_called()

    def test_reset_fault_sends_0x04ff(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.return_value = _ok_response()
        with patch("config.VFD_CMD_REGISTER", 0x0000), \
             patch("config.VFD_SLAVE_ID", 1):
            asyncio.run(vfd.reset_fault())
        vfd._client.write_register.assert_called_once_with(
            address=0x0000, value=0x04FF, slave=1
        )

    def test_reset_fault_exception_does_not_crash(self):
        vfd = _make_connected_vfd()
        vfd._client.write_register.side_effect = OSError("bus error")
        with patch("config.VFD_CMD_REGISTER", 0x0000), \
             patch("config.VFD_SLAVE_ID", 1):
            asyncio.run(vfd.reset_fault())   # must not raise


# ─────────────────────────────────────────────────────────────────────────────
# status property
# ─────────────────────────────────────────────────────────────────────────────

class TestStatusProperty:

    def test_status_reflects_enabled_flag(self):
        vfd = VFDController()
        vfd._enabled = True
        assert vfd.status["enabled"] is True

    def test_status_reflects_connected_flag(self):
        vfd = _make_connected_vfd()
        assert vfd.status["connected"] is True

    def test_status_reflects_total_writes(self):
        vfd = _make_connected_vfd()
        vfd._total_writes = 42
        assert vfd.status["total_writes"] == 42

    def test_status_actual_rpm_none_when_never_read(self):
        vfd = VFDController()
        assert vfd.status["actual_rpm"] is None

    def test_status_word_decoded(self):
        vfd = VFDController()
        vfd._last_status_raw = 0x0237
        sw = vfd.status["status_word"]
        assert sw["running"] is True
        assert sw["remote"]  is True

    def test_status_word_empty_when_never_read(self):
        vfd = VFDController()
        assert vfd.status["status_word"] == {}

    def test_status_target_rpm_after_write(self):
        vfd = _make_connected_vfd()
        vfd._last_rpm = 1110
        assert vfd.status["target_rpm"] == 1110

    def test_status_mode_and_profile(self):
        vfd = VFDController()
        vfd._mode    = "rtu"
        vfd._profile = "abb"
        s = vfd.status
        assert s["mode"]    == "rtu"
        assert s["profile"] == "abb"


# ─────────────────────────────────────────────────────────────────────────────
# disconnect()
# ─────────────────────────────────────────────────────────────────────────────

class TestDisconnect:

    def test_disconnect_calls_close_on_client(self):
        vfd = _make_connected_vfd()
        mock_client = vfd._client   # save ref before disconnect clears it
        asyncio.run(vfd.disconnect())
        mock_client.close.assert_called_once()

    def test_disconnect_noop_when_no_client(self):
        vfd = VFDController()
        vfd._client = None
        asyncio.run(vfd.disconnect())   # must not raise

    def test_disconnect_clears_connected_flag(self):
        vfd = _make_connected_vfd()
        asyncio.run(vfd.disconnect())
        assert vfd._connected   is False
        assert vfd._initialized is False
