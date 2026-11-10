"""
vfd_controller.py — Modbus RTU / TCP VFD frequency control
Crusher Monitor — Kannan Blue Metals

Configured by default for ABB ACS580 with Embedded Fieldbus (EFB), ABB Drives
communication profile. Also supports Delta VFD and other Modbus drives via
.env overrides (see config.py header for the parameter map).

ABB ACS580 register map (raw Modbus addresses, holding registers):
    0x0000  Control Word  (CW)     ← we write
    0x0001  Reference 1   (REF1)   ← we write (rpm × VFD_SCALE)
    0x0003  Status Word   (SW)     ← we read for diagnostics
    0x0004  Actual ref 1  (ACT1)   ← actual running frequency

ABB Drives profile state machine — required boot sequence:
    1. Write CW = 0x0476 (PREPARE)    → drive goes to "Ready to switch on"
    2. Write CW = 0x0477 (SWITCH_ON)  → drive goes to "Switched on"
    3. Write CW = 0x047F (RUN)        → drive goes to "Operation enabled" (running)
    4. Write CW = 0x047E (STOP)       → drive ramps down to zero

The init sequence (steps 1 & 2) is run once on first connect when
VFD_INIT_SEQUENCE=true. After that, only CW + REF1 are written when the
target frequency changes — avoids flooding the RS-485 bus.

ABB Status Word bits (decoded for /api/vfd/status):
    bit 0   RDY_ON          ready to switch on
    bit 1   RDY_RUN         ready to run
    bit 2   RDY_REF         operation enabled (running)
    bit 3   TRIPPED         fault active
    bit 4   OFF_2_STA       OFF2 inactive (1=OK)
    bit 5   OFF_3_STA       OFF3 inactive (1=OK)
    bit 6   SWC_ON_INHIB    switch-on inhibited
    bit 7   ALARM           warning present
    bit 8   AT_SETPOINT     at setpoint
    bit 9   REMOTE          remote control active
    bit 10  ABOVE_LIMIT     supervised value > limit
    bit 11  EXT_RUN_ENABLE  external run enable
"""

import asyncio
import logging
import time
from typing import Optional

log = logging.getLogger(__name__)


def _decode_abb_status_word(sw: int) -> dict:
    """Decode the 16-bit ABB Drives profile Status Word into named booleans."""
    if sw is None:
        return {}
    return {
        "rdy_on"         : bool(sw & 0x0001),
        "rdy_run"        : bool(sw & 0x0002),
        "running"        : bool(sw & 0x0004),   # operation enabled
        "tripped"        : bool(sw & 0x0008),
        "off2_sta"       : bool(sw & 0x0010),
        "off3_sta"       : bool(sw & 0x0020),
        "swc_on_inhib"   : bool(sw & 0x0040),
        "alarm"          : bool(sw & 0x0080),
        "at_setpoint"    : bool(sw & 0x0100),
        "remote"         : bool(sw & 0x0200),   # MUST be true for Modbus to take effect
        "above_limit"    : bool(sw & 0x0400),
        "ext_run_enable" : bool(sw & 0x0800),
        "raw"            : f"0x{sw:04X}",
    }


class VFDController:
    """
    Persistent Modbus connection to the VFD with:
      - connect() / disconnect()
      - set_speed(rpm)  — writes REF1 + CW (only on change)
      - stop_drive()       — writes stop command
      - reset_fault()      — writes 0x04FF to acknowledge a tripped state
      - status property    — for /api/vfd/status

    All Modbus I/O runs in asyncio.to_thread so the event loop is never blocked.
    """

    def __init__(self):
        self._client              = None
        self._connected           = False
        self._initialized         = False     # ABB state-machine init done?
        self._last_rpm            = -1        # sentinel — forces write on first call
        self._last_write_ts       = 0.0
        self._last_error          = ""
        self._total_writes        = 0
        self._total_errors        = 0
        self._consecutive_errors  = 0         # consecutive failures — alerts operator at threshold
        self._enabled             = False
        self._mode                = "rtu"
        self._profile             = "abb"
        self._last_status_raw : Optional[int] = None
        self._last_actual_rpm : Optional[float] = None

    # ─────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────

    async def connect(self):
        """Open the Modbus connection — no-op if VFD_ENABLED=false."""
        from config import (
            VFD_ENABLED, VFD_MODE, VFD_PROFILE,
            VFD_PORT, VFD_BAUDRATE, VFD_PARITY, VFD_STOPBITS, VFD_BYTESIZE,
            VFD_TCP_HOST, VFD_TCP_PORT, VFD_TIMEOUT,
        )
        self._enabled = VFD_ENABLED
        self._mode    = VFD_MODE
        self._profile = VFD_PROFILE

        if not VFD_ENABLED:
            log.info("VFD control disabled (VFD_ENABLED=false) — monitor-only mode.")
            return

        await asyncio.to_thread(self._sync_connect,
                                VFD_MODE, VFD_PORT, VFD_BAUDRATE,
                                VFD_PARITY, VFD_STOPBITS, VFD_BYTESIZE,
                                VFD_TCP_HOST, VFD_TCP_PORT, VFD_TIMEOUT)

    async def disconnect(self):
        """Close the Modbus connection — called from lifespan shutdown."""
        if self._client:
            await asyncio.to_thread(self._sync_disconnect)

    async def set_speed(self, rpm: int):
        """
        Send speed setpoint to the VFD.
        Only writes when the value differs from the last successful write.
        rpm=0 issues the stop command.
        """
        if not self._enabled:
            return
        # Run ABB init sequence asynchronously if needed — avoids blocking
        # the thread pool with time.sleep() during the 2-second handshake.
        if self._connected and not self._initialized:
            await self._run_init_sequence()
            if not self._initialized:
                self._total_errors += 1
                self._consecutive_errors += 1
                return
            self._last_rpm = -1   # force write after re-init
        # Pre-clamp before dedup so comparison is apples-to-apples with _last_rpm
        from config import VFD_MAX_RPM
        rpm = max(0, min(rpm, VFD_MAX_RPM))
        if rpm == self._last_rpm:
            return
        await asyncio.to_thread(self._sync_write_speed, rpm)

    async def stop_drive(self):
        """Force-stop the VFD (ramp to zero)."""
        if not self._enabled:
            return
        await asyncio.to_thread(self._sync_write_speed, 0)

    async def reset_fault(self):
        """Send fault-reset command (ABB CW = 0x04FF)."""
        if not self._enabled or not self._connected:
            return
        from config import VFD_CMD_REGISTER, VFD_SLAVE_ID
        try:
            await asyncio.to_thread(
                self._client.write_register,
                address=VFD_CMD_REGISTER, value=0x04FF, slave=VFD_SLAVE_ID,
            )
            log.info("VFD fault-reset command sent (CW=0x04FF)")
        except Exception as e:
            log.error("VFD reset_fault error: %s", e)

    async def read_status(self):
        """Read SW (0x0003) and ACT1 (0x0004) — refreshes the status dict."""
        if not self._enabled or not self._connected:
            return
        await asyncio.to_thread(self._sync_read_status)

    @property
    def status(self) -> dict:
        """Snapshot for /api/vfd/status."""
        return {
            "enabled"             : self._enabled,
            "mode"                : self._mode,
            "profile"             : self._profile,
            "connected"           : self._connected,
            "initialized"         : self._initialized,
            "target_rpm"          : self._last_rpm if self._last_rpm >= 0 else 0,
            "actual_rpm"          : self._last_actual_rpm,
            "status_word"         : _decode_abb_status_word(self._last_status_raw),
            "last_write_ts"       : self._last_write_ts,
            "last_error"          : self._last_error,
            "total_writes"        : self._total_writes,
            "total_errors"        : self._total_errors,
            "consecutive_errors"  : self._consecutive_errors,
        }

    # ─────────────────────────────────────────────────────────────────────
    # Sync helpers (run inside asyncio.to_thread)
    # ─────────────────────────────────────────────────────────────────────

    def _sync_connect(self, mode, port, baudrate, parity, stopbits,
                      bytesize, tcp_host, tcp_port, timeout):
        try:
            if mode == "tcp":
                from pymodbus.client import ModbusTcpClient
                self._client = ModbusTcpClient(
                    host=tcp_host, port=tcp_port, timeout=timeout
                )
                log.info("Connecting to VFD via Modbus TCP %s:%s …", tcp_host, tcp_port)
            else:
                from pymodbus.client import ModbusSerialClient
                self._client = ModbusSerialClient(
                    port=port, baudrate=baudrate,
                    parity=parity, stopbits=stopbits,
                    bytesize=bytesize, timeout=timeout,
                )
                log.info("Connecting to VFD via Modbus RTU %s @ %d-%s%d %d baud …",
                         port, bytesize, parity, stopbits, baudrate)

            self._connected = self._client.connect()
            if self._connected:
                log.info("✅ VFD Modbus connection established.")
                self._last_error = ""
            else:
                self._last_error = "client.connect() returned False"
                log.error("❌ VFD Modbus connection FAILED: %s", self._last_error)
        except Exception as e:
            self._connected = False
            self._last_error = str(e)
            log.error("❌ VFD connect exception: %s", e)

    def _sync_disconnect(self):
        try:
            if self._client:
                self._client.close()
                log.info("VFD Modbus connection closed.")
        except Exception as e:
            log.warning("VFD disconnect error: %s", e)
        finally:
            self._client      = None
            self._connected   = False
            self._initialized = False

    async def _run_init_sequence(self):
        """
        ABB Drives profile start-up handshake — runs asynchronously so the
        1-second delays between steps free the event loop instead of blocking
        a thread pool worker.

            CW = 0x0476  (PREPARE)    → await asyncio.sleep(1.0)
            CW = 0x0477  (SWITCH_ON)  → await asyncio.sleep(1.0)

        After this the drive is in "Switched on" state and the first RUN
        command (0x047F) will start it.  Skipped for non-ABB profiles.
        """
        from config import (
            VFD_INIT_SEQUENCE, VFD_PROFILE,
            VFD_CMD_REGISTER, VFD_SLAVE_ID,
            VFD_CMD_PREPARE, VFD_CMD_SWITCH_ON,
        )
        if not VFD_INIT_SEQUENCE or VFD_PROFILE != "abb":
            self._initialized = True
            return
        try:
            rr = await asyncio.to_thread(
                self._client.write_register,
                address=VFD_CMD_REGISTER, value=VFD_CMD_PREPARE, slave=VFD_SLAVE_ID,
            )
            if rr.isError():
                raise RuntimeError(f"PREPARE write error: {rr}")
            await asyncio.sleep(1.0)   # hardware settling — event loop stays free

            rr = await asyncio.to_thread(
                self._client.write_register,
                address=VFD_CMD_REGISTER, value=VFD_CMD_SWITCH_ON, slave=VFD_SLAVE_ID,
            )
            if rr.isError():
                raise RuntimeError(f"SWITCH_ON write error: {rr}")
            await asyncio.sleep(1.0)   # hardware settling — event loop stays free

            self._initialized = True
            log.info(
                "VFD init sequence OK (CW: 0x%04X → 0x%04X) — drive ready",
                VFD_CMD_PREPARE, VFD_CMD_SWITCH_ON,
            )
        except Exception as e:
            self._last_error = f"init sequence: {e}"
            log.error("❌ VFD init sequence failed: %s", e)

    def _sync_write_speed(self, rpm: int):
        """
        Write REF1 (speed in RPM) and CW (run/stop) to the VFD.
        Auto-clamps to [0, VFD_MAX_RPM] for safety.
        Auto-reconnects + re-inits if the connection is stale.
        """
        from config import (
            VFD_SLAVE_ID, VFD_FREQ_REGISTER, VFD_CMD_REGISTER,
            VFD_SCALE, VFD_MAX_RPM, VFD_CMD_RUN, VFD_CMD_STOP,
            VFD_MODE, VFD_PORT, VFD_BAUDRATE, VFD_PARITY,
            VFD_STOPBITS, VFD_BYTESIZE, VFD_TCP_HOST, VFD_TCP_PORT, VFD_TIMEOUT,
        )

        # Reconnect if stale
        if not self._connected or self._client is None:
            log.warning("VFD not connected — attempting reconnect …")
            self._sync_connect(VFD_MODE, VFD_PORT, VFD_BAUDRATE,
                               VFD_PARITY, VFD_STOPBITS, VFD_BYTESIZE,
                               VFD_TCP_HOST, VFD_TCP_PORT, VFD_TIMEOUT)
            if not self._connected:
                self._total_errors += 1
                self._consecutive_errors += 1
                if self._consecutive_errors % 5 == 1:
                    log.critical(
                        "VFD UNREACHABLE — %d consecutive failures. "
                        "Check RS-485 cable and drive power. Last error: %s",
                        self._consecutive_errors, self._last_error,
                    )
                return

        # Init is handled asynchronously in set_speed before reaching here.
        # If still not initialized (e.g. reconnect just happened), bail out —
        # set_speed will call _run_init_sequence on the next cycle.
        if not self._initialized:
            self._total_errors += 1
            return

        # Safety clamp
        original_rpm = rpm
        rpm = max(0, min(rpm, VFD_MAX_RPM))
        if rpm != original_rpm:
            log.warning("VFD speed clamped: %d → %d RPM (VFD_MAX_RPM=%d)",
                        original_rpm, rpm, VFD_MAX_RPM)

        ref_value = int(round(rpm * VFD_SCALE))
        cmd_value = VFD_CMD_STOP if rpm == 0 else VFD_CMD_RUN

        try:
            # 1. Write REF1 (speed setpoint)
            rr = self._client.write_register(
                address=VFD_FREQ_REGISTER, value=ref_value, slave=VFD_SLAVE_ID,
            )
            if rr.isError():
                raise RuntimeError(f"REF1 write error: {rr}")

            # 2. Write CW (run or stop)
            rc = self._client.write_register(
                address=VFD_CMD_REGISTER, value=cmd_value, slave=VFD_SLAVE_ID,
            )
            if rc.isError():
                raise RuntimeError(f"CW write error: {rc}")

            # Success
            self._last_rpm            = rpm
            self._last_write_ts       = time.time()
            self._total_writes       += 1
            self._last_error          = ""
            self._consecutive_errors  = 0
            log.info(
                "VFD ✅  REF1[0x%04X]=%d (%d RPM)  CW[0x%04X]=0x%04X  %s",
                VFD_FREQ_REGISTER, ref_value, rpm,
                VFD_CMD_REGISTER,  cmd_value,
                "RUN" if rpm > 0 else "STOP",
            )
        except Exception as e:
            self._total_errors += 1
            self._last_error    = str(e)
            self._connected     = False    # force reconnect next cycle
            self._initialized   = False    # force re-init next cycle
            log.error("VFD ❌  write failed: %s", e)

    def _sync_read_status(self):
        """Read SW (0x0003) and ACT1 (0x0004) for /api/vfd/status."""
        from config import VFD_SLAVE_ID, VFD_SCALE
        time.sleep(0.1)   # RS-485 bus turnaround gap after any preceding write
        try:
            rr = self._client.read_holding_registers(
                address=0x0003, count=2, slave=VFD_SLAVE_ID,
            )
            if rr.isError() or rr.registers is None:
                raise RuntimeError(f"SW/ACT1 read error: {rr}")
            sw, act1 = rr.registers[0], rr.registers[1]
            # ACT1 is signed; convert from unsigned 16-bit
            if act1 > 32767:
                act1 -= 65536
            self._last_status_raw = sw
            self._last_actual_rpm = round(act1 / VFD_SCALE, 1)
        except Exception as e:
            self._last_error = f"read_status: {e}"
            log.debug("VFD read_status failed: %s", e)


# ── Global singleton ─────────────────────────────────────────────────────
vfd_controller = VFDController()
