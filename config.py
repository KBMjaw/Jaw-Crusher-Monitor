# config.py — All settings in one place
# Kannan Blue Metals — Crusher Monitor
#
# Sensitive values (RTSP_URL, AUTH_PASS) must live in a .env file:
#   RTSP_URL=rtsp://user:pass@ip:port/path
#   AUTH_USER=admin
#   AUTH_PASS=changeme
#
# VFD Modbus settings (also recommended in .env):
#   VFD_ENABLED=true
#   VFD_MODE=rtu                   # "rtu" (RS-485 serial) or "tcp" (Modbus TCP)
#   VFD_PORT=/dev/ttyUSB0          # serial port (RTU) or IP address (TCP)
#   VFD_TCP_PORT=502               # TCP port (TCP mode only)
#   VFD_BAUDRATE=9600
#   VFD_SLAVE_ID=1
#   VFD_FREQ_REGISTER=0x2001       # holding register for frequency command
#   VFD_CMD_REGISTER=0x2000        # holding register for run/stop command
#   VFD_SCALE=20                   # register value = rpm × scale (ABB RPM mode: 20000=1000rpm)
#   VFD_CMD_RUN=0x0002             # value to write to CMD register to run
#   VFD_CMD_STOP=0x0001            # value to write to CMD register to stop
# .env is listed in .gitignore and must never be committed.

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()  # loads .env from the current working directory (or parent dirs)

# ── Base directory (repo root, works on Pi and dev machine) ─────────────
_BASE = Path(os.environ.get("CRUSHER_BASE", Path(__file__).parent)).resolve()

# ── Model & Stream ──────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("MODEL_PATH", str(_BASE / "weights" / "best.pt"))

# SECURITY: RTSP_URL must be set in .env — no default to prevent credential leakage
RTSP_URL   = os.environ.get("RTSP_URL", "")

# ── Auth (single-user, server-side)
AUTH_USER = os.environ.get("AUTH_USER", "admin")
AUTH_PASS = os.environ.get("AUTH_PASS", "")

# Refuse to start without a real password — default of admin123 removed intentionally
if not AUTH_PASS:
    raise RuntimeError(
        "AUTH_PASS is not set. Add AUTH_PASS=<yourpassword> to .env and restart."
    )

# ── Inference ───────────────────────────────────────────────────────────
CONF_THRESHOLD = 0.50

# ── FPS / Buffering ─────────────────────────────────────────────────────
TARGET_FPS     = 10
FRAME_INTERVAL = 1.0 / TARGET_FPS

# ── RTSP Reconnect ──────────────────────────────────────────────────────
MAX_RETRIES    = 1
RETRY_DELAY    = 60

# ── Frame Saving ────────────────────────────────────────────────────────
SAVE_ANNOTATED = False
OUTPUT_DIR     = os.environ.get("OUTPUT_DIR", str(_BASE / "output_frames"))

# ── Display ─────────────────────────────────────────────────────────────
HEADLESS       = True

# ── Logging ─────────────────────────────────────────────────────────────
LOG_DIR        = os.environ.get("LOG_DIR", str(_BASE / "logs"))
LOG_LEVEL      = os.environ.get("LOG_LEVEL", "INFO").upper()

# ── Server ──────────────────────────────────────────────────────────────
HOST           = "0.0.0.0"
PORT           = 8000

# ── Static files ────────────────────────────────────────────────────────
STATIC_DIR     = os.environ.get("STATIC_DIR", str(_BASE / "static"))

# ── Database ────────────────────────────────────────────────────────────
DB_PATH        = os.environ.get("DB_PATH", str(_BASE / "crusher_data.db"))

# ── Crusher VFD Target Speeds (RPM) ─────────────────────────────────────
# Motor rated 1500 RPM @ 50 Hz (4-pole). Equivalent Hz setpoints:
#   30 Hz → 900 RPM,  37 Hz → 1110 RPM,  43 Hz → 1290 RPM
VFD_SPEEDS = {
    "jaw filled"           : 900,
    "jaw partially filled" : 1110,
    "jaw empty"            : 1290,
}

# ── Crusher Timer Thresholds (seconds) ─────────────────────────────────
PARTIAL_STUCK_TIME  = 15
EMPTY_NO_FEED_TIME  = 30

# ── Shift Times (24h hour values) ───────────────────────────────────────
DAY_SHIFT_START     = 6
NIGHT_SHIFT_START   = 18

# ═════════════════════════════════════════════════════════════════════════
# VFD Modbus Control
# ═════════════════════════════════════════════════════════════════════════
# Defaults below are configured for the installed drive at Kannan Blue Metals:
#   ABB ACS580, Frame R4, with Embedded Fieldbus (EFB) — Modbus RTU
#   ABB Drives communication profile, REF1 in RPM, motor nominal 1000 RPM @ 50 Hz
#
# ABB drive must be configured on the keypad before Modbus control works:
#   Par 58.01  Protocol enable            = Modbus RTU
#   Par 58.03  Node address               = 1
#   Par 58.04  Baud rate                  = 9600
#   Par 58.05  Parity                     = 8 NONE 1
#   Par 58.06  Communication profile      = ABB Drives Classic  ← also "Refresh settings" here
#   Par 58.26  EFB ref1 type              = Speed               ← NEW: RPM mode
#   Par 19.11  Ext1 control loc / source  = EFB (Embedded Fieldbus)
#   Par 28.11  Speed ref1 source          = EFB ref1
#   Par 46.01  Speed scaling              = 1500.00 RPM         (← 20000 = 1500 RPM)
#   Par 58.14  Communication loss action  = Fault / Warning
#   Par 96.07  Parameter save             = Save                (persist all of the above)
#   Then press LOC/REM on the keypad once → switch to REM mode.
#
# Hardware: connect Pi to drive terminal X5
#     Pi USB-to-RS485 → X5  A+ ↔ B+ ↔ DGND   (twisted pair recommended)
# ═════════════════════════════════════════════════════════════════════════

# Master switch
VFD_ENABLED       = os.environ.get("VFD_ENABLED", "false").lower() == "true"
VFD_MODE          = os.environ.get("VFD_MODE", "rtu")          # "rtu" | "tcp"

# RTU (RS-485) settings — match ABB defaults
VFD_PORT          = os.environ.get("VFD_PORT", "/dev/ttyUSB0")
VFD_BAUDRATE      = int(os.environ.get("VFD_BAUDRATE", "9600"))
VFD_PARITY        = os.environ.get("VFD_PARITY", "N")          # N / E / O
VFD_STOPBITS      = int(os.environ.get("VFD_STOPBITS", "1"))
VFD_BYTESIZE      = int(os.environ.get("VFD_BYTESIZE", "8"))

# TCP settings (only used when VFD_MODE=tcp)
VFD_TCP_HOST      = os.environ.get("VFD_TCP_HOST", "192.168.0.200")
VFD_TCP_PORT      = int(os.environ.get("VFD_TCP_PORT", "502"))

# Modbus device settings
VFD_SLAVE_ID      = int(os.environ.get("VFD_SLAVE_ID", "1"))
VFD_TIMEOUT       = float(os.environ.get("VFD_TIMEOUT", "1.0"))  # seconds

# Drive profile (informational — controls init sequence & defaults)
# Options: "abb" | "delta" | "siemens" | "custom"
VFD_PROFILE       = os.environ.get("VFD_PROFILE", "abb").lower()

# ── Register map ──────────────────────────────────────────────────────────
# ABB ACS580 (Embedded Fieldbus, ABB Drives profile):
#   40001 / raw 0  →  Control Word  (CW)
#   40002 / raw 1  →  Reference 1   (REF1 — speed or frequency)
#   40004 / raw 3  →  Status Word   (SW) — read only
#   40005 / raw 4  →  Actual ref 1  (ACT1) — read only
#
# Delta VFD-E/M (alternative — override in .env):
#   0x2000  Command,  0x2001  Frequency,  scale=100,  run=0x002, stop=0x001
VFD_CMD_REGISTER  = int(os.environ.get("VFD_CMD_REGISTER",  "0x0000"), 0)  # ABB CW
VFD_FREQ_REGISTER = int(os.environ.get("VFD_FREQ_REGISTER", "0x0001"), 0)  # ABB REF1

# ── Scaling ───────────────────────────────────────────────────────────────
# Register value = rpm × VFD_SCALE
# ABB ACS580 with par 46.01 = 1500 RPM:  20000 (= 100%) ↔ 1500 RPM  →  scale = 13.33
# Delta VFD (1 unit = 0.01 Hz, Hz mode):                               scale = 100
VFD_SCALE         = float(os.environ.get("VFD_SCALE", str(round(20000/1500, 6))))
VFD_MAX_RPM       = int(os.environ.get("VFD_MAX_RPM", "1290"))  # safety clamp (= 43 Hz equivalent)

# ── Command words ─────────────────────────────────────────────────────────
# ABB Drives profile control word values:
#   0x0476  Prepare (OFF1+OFF2+OFF3, RUN cleared)  → state: "Ready to switch on"
#   0x0477  Switch on (acknowledged)               → state: "Switched on"
#   0x047F  Run forward                            → state: "Operation enabled"
#   0x047E  Stop with ramp                         → state: ramp-to-zero
#   0x04FF  Run + reset fault                      → also acknowledges a fault
VFD_CMD_RUN       = int(os.environ.get("VFD_CMD_RUN",      "0x047F"), 0)
VFD_CMD_STOP      = int(os.environ.get("VFD_CMD_STOP",     "0x047E"), 0)
VFD_CMD_PREPARE   = int(os.environ.get("VFD_CMD_PREPARE",  "0x0476"), 0)
VFD_CMD_SWITCH_ON = int(os.environ.get("VFD_CMD_SWITCH_ON","0x0477"), 0)

# Run the prepare → switch_on → run handshake on first connect (required by ABB).
# Set to false for Delta / Siemens — they do not need this state machine.
VFD_INIT_SEQUENCE = os.environ.get("VFD_INIT_SEQUENCE", "true").lower() == "true"


# ── WebRTC transport ────────────────────────────────────────────────────
# LOCAL-LAN PROFILE: no public STUN/TURN is needed when the browser and
# FastAPI host are on the same reachable LAN. Host ICE candidates are preferred.
# If you later expose this dashboard over the internet, configure STUN/TURN.
WEBRTC_STUN_URLS = [
    item.strip() for item in os.environ.get(
        "WEBRTC_STUN_URLS",
        "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
    ).split(",") if item.strip()
]
WEBRTC_TURN_URLS = [
    item.strip() for item in os.environ.get("WEBRTC_TURN_URLS", "").split(",")
    if item.strip()
]
WEBRTC_TURN_USERNAME = os.environ.get("WEBRTC_TURN_USERNAME", "")
WEBRTC_TURN_CREDENTIAL = os.environ.get("WEBRTC_TURN_CREDENTIAL", "")
WEBRTC_ICE_TRANSPORT_POLICY = os.environ.get("WEBRTC_ICE_TRANSPORT_POLICY", "all")

# ICE settings above remain environment-configurable. For a local LAN,
# STUN is normally not required; TURN should be configured for restrictive
# NAT/firewall or internet-facing deployments.

# WebRTC browser delivery resolution. The RTSP source and YOLO inference remain
# at native camera resolution. 1280x720 reduces software-encoder load on CPU.
WEBRTC_MAX_WIDTH = int(os.environ.get("WEBRTC_MAX_WIDTH", "1280"))
WEBRTC_MAX_HEIGHT = int(os.environ.get("WEBRTC_MAX_HEIGHT", "720"))
