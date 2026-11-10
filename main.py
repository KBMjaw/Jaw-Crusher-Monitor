"""
main.py — FastAPI WebSocket + REST API
Crusher Monitor — Kannan Blue Metals
"""

import json
import logging
import asyncio
import cv2
import os
import time as _time
from contextlib import asynccontextmanager
from datetime import datetime

from aiortc import (
    RTCPeerConnection, RTCSessionDescription, VideoStreamTrack,
    RTCConfiguration, RTCIceServer,
)
from aiortc import RTCRtpSender
from av import VideoFrame
from fractions import Fraction

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse

from camera import crusher_camera
from crusher_logic import crusher_logic
from config import (
    HOST, PORT, LOG_DIR, STATIC_DIR, AUTH_USER, AUTH_PASS, LOG_LEVEL,
    WEBRTC_STUN_URLS, WEBRTC_TURN_URLS, WEBRTC_TURN_USERNAME,
    WEBRTC_TURN_CREDENTIAL, WEBRTC_ICE_TRANSPORT_POLICY,
)
from database import (
    init_db, close_db, save_jaw_state, save_alert, resolve_alert,
    save_vfd_log, save_oee_snapshot, save_shift_report,
    get_alerts_history, get_oee_history, get_vfd_history,
    get_shift_reports, get_state_summary_today, get_period_summary,
)
from reports import (
    build_shift_pdf, build_shift_csv,
    build_period_pdf, build_period_csv, build_period_excel,
)
from vfd_controller import vfd_controller

# ── Logging ──────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(f"{LOG_DIR}/crusher_yolo.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)


# ── Background DB save tasks ──────────────────────────────────
_last_vfd_save   = 0.0
_last_oee_save   = 0.0
_last_alert_ids  = set()


async def _db_background_task():
    """Runs every second — saves VFD every 5s, OEE every 60s"""
    global _last_vfd_save, _last_oee_save, _last_alert_ids
    try:
        while True:
            try:
                now   = _time.time()
                state = crusher_logic.get_state()

                # ── Save jaw state every frame ──────────────────
                await save_jaw_state(
                    jaw_label      = state.get("jaw_label", "unknown"),
                    confidence     = state.get("jaw_conf", 0.0),
                    machine_status = state.get("machine_status", "STOPPED"),
                    target_vfd_rpm = state.get("target_vfd_rpm", 0),
                    partial_secs   = state.get("partial_secs", 0),
                    empty_secs     = state.get("empty_secs", 0),
                )

                # ── Save VFD log every 5 seconds ────────────────
                if now - _last_vfd_save >= 5:
                    await save_vfd_log(
                        vfd_rpm        = state.get("target_vfd_rpm", 0),
                        jaw_label      = state.get("jaw_label", "unknown"),
                        machine_status = state.get("machine_status", "STOPPED"),
                    )
                    _last_vfd_save = now

                # ── Save OEE snapshot every 60 seconds ──────────
                if now - _last_oee_save >= 60:
                    await save_oee_snapshot(state)
                    _last_oee_save = now

                # ── Save new alerts ─────────────────────────────
                active = state.get("active_alerts", [])
                current_ids = {a["id"] for a in active}

                for alert in active:
                    if alert["id"] not in _last_alert_ids:
                        await save_alert(
                            alert_id = alert["id"],
                            level    = alert["level"],
                            message  = alert["message"],
                        )

                # Resolve alerts no longer active
                for aid in _last_alert_ids - current_ids:
                    await resolve_alert(aid)

                _last_alert_ids = current_ids

            except Exception as e:
                log.error("DB background task error: %s", e)

            await asyncio.sleep(1)
    except asyncio.CancelledError:
        log.info("DB background task cancelled cleanly.")
        raise


async def _vfd_background_task():
    """
    Every 1 s: send target_vfd_rpm to the VFD (only on change).
    Every 5 s: read Status Word + actual Hz from the drive for diagnostics.

    Auto-control only runs when the camera is actively classifying frames.
    When the camera is off (startup, fault, manual-test mode) the background
    task does NOT touch the VFD frequency — manual /api/vfd/set/{hz} commands
    are left intact and the drive holds its last speed.
    """
    last_status_read = 0.0
    _FRAME_STALE_SECS = 30   # warn if no new inference frame for this long
    try:
        while True:
            try:
                cam_state = crusher_camera.get_state()

                # Watchdog the independent live-preview pipeline.
                frame_age = cam_state.get("live_frame_age_s")
                if cam_state.get("cam_status") == "live" and frame_age is not None:
                    if frame_age > _FRAME_STALE_SECS:
                        log.critical(
                            "CAMERA WATCHDOG: live preview frame is %.1fs old — "
                            "capture/preview may be stalled. Restart via POST /api/camera/restart",
                            frame_age,
                        )

                # Do not let a live preview alone activate automatic VFD control.
                # The YOLO worker must have loaded successfully.
                if (
                    cam_state.get("cam_status") == "live"
                    and cam_state.get("inference_status") == "running"
                ):
                    rpm = crusher_logic.get_state().get("target_vfd_rpm", 0)
                    await vfd_controller.set_speed(rpm)
                # If inference is unavailable, preserve the drive's last speed.

                now = _time.time()
                if now - last_status_read >= 5:
                    await vfd_controller.read_status()
                    last_status_read = now
            except Exception as e:
                log.error("VFD background task error: %s", e)
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        log.info("VFD background task cancelled cleanly.")
        raise


# ── Lifespan ─────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting Crusher Monitor backend...")
    log.info("Starting camera capture and live preview independently of YOLO.")

    # Init database
    await init_db()

    # Connect VFD Modbus
    await vfd_controller.connect()

    # Auto-start camera on boot. A camera/model failure must not prevent the
    # rest of the monitoring API from starting; /api/camera/restart can retry.
    try:
        crusher_camera.start()
        log.info("Camera capture start requested.")
    except Exception:
        log.exception("Camera could not start during application startup")

    # Start background tasks
    task_db  = asyncio.create_task(_db_background_task())
    task_vfd = asyncio.create_task(_vfd_background_task())

    yield

    log.info("Shutting down...")
    task_db.cancel()
    task_vfd.cancel()
    # Wait for tasks to finish their current cycle before touching VFD/DB
    await asyncio.gather(task_db, task_vfd, return_exceptions=True)
    # Close all active WebRTC peers before stopping the camera.
    if webrtc_peers:
        await asyncio.gather(
            *(pc.close() for pc in list(webrtc_peers)),
            return_exceptions=True,
        )
        webrtc_peers.clear()

    await vfd_controller.stop_drive()   # safe-stop the VFD on server shutdown
    await vfd_controller.disconnect()
    crusher_camera.stop()
    await close_db()


# ── App ───────────────────────────────────────────────────────
app = FastAPI(
    title="Crusher Monitor API",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Serve PWA assets at root paths (/css, /js, /icons, /vendor, /assets)
# The multi-file ES-module app references these as absolute root paths.
for _sub in ("css", "js", "icons", "vendor", "assets"):
    _sub_dir = os.path.join(STATIC_DIR, _sub)
    if os.path.isdir(_sub_dir):
        app.mount(f"/{_sub}", StaticFiles(directory=_sub_dir), name=_sub)


@app.get("/health")
async def health():
    return JSONResponse({
        "status"    : "ok",
        "timestamp" : datetime.now().isoformat(),
        "vfd"       : vfd_controller.status.get("connected"),
        "camera"    : crusher_camera.get_state().get("cam_status"),
    })


# ── WebSocket Manager ─────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        log.info(f"WebSocket connected. Total: {len(self.active)}")

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        log.info(f"WebSocket disconnected. Total: {len(self.active)}")

    async def broadcast(self, data: dict):
        msg  = json.dumps(data)
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in self.active:
                self.active.remove(ws)


manager = ConnectionManager()

def _webrtc_ice_servers():
    """Build aiortc ICE servers from backend configuration."""
    servers = [RTCIceServer(urls=url) for url in WEBRTC_STUN_URLS]
    if WEBRTC_TURN_URLS:
        if not WEBRTC_TURN_USERNAME or not WEBRTC_TURN_CREDENTIAL:
            log.warning("TURN URLs configured without TURN credentials; TURN omitted")
        else:
            servers.append(RTCIceServer(
                urls=WEBRTC_TURN_URLS,
                username=WEBRTC_TURN_USERNAME,
                credential=WEBRTC_TURN_CREDENTIAL,
            ))
    return servers


@app.get("/api/webrtc/config")
async def webrtc_config():
    """Return browser ICE configuration. TURN credentials are necessarily
    delivered to the authenticated browser; use narrowly scoped/short-lived
    credentials and protect this endpoint with your application auth in production.
    """
    servers = [{"urls": url} for url in WEBRTC_STUN_URLS]
    if WEBRTC_TURN_URLS and WEBRTC_TURN_USERNAME and WEBRTC_TURN_CREDENTIAL:
        servers.append({
            "urls": WEBRTC_TURN_URLS,
            "username": WEBRTC_TURN_USERNAME,
            "credential": WEBRTC_TURN_CREDENTIAL,
        })
    return JSONResponse({
        "iceServers": servers,
        "iceTransportPolicy": WEBRTC_ICE_TRANSPORT_POLICY,
        "turnConfigured": bool(WEBRTC_TURN_URLS and WEBRTC_TURN_USERNAME and WEBRTC_TURN_CREDENTIAL),
    })


# Active WebRTC sessions. Each browser connection receives the raw RTSP feed;
# YOLO inference continues independently in camera.py.
webrtc_peers: set[RTCPeerConnection] = set()


class CrusherVideoTrack(VideoStreamTrack):
    """20 FPS latest-frame WebRTC track with bounded, millisecond-scale waits.

    It deliberately does not build a frame queue: each send uses the newest
    captured frame. If no new frame is ready, it repeats the previous frame.
    Scheduling is fixed-rate but does not burst to catch up after a late frame.
    """

    # Match the camera's measured ~19-20 FPS output.
    TARGET_FPS = max(
        1,
        min(30, int(os.environ.get("WEBRTC_TARGET_FPS", "20")))
    )
    FRAME_INTERVAL = 1.0 / TARGET_FPS
    CLOCK_RATE = 90000
    # Keep the camera/YOLO source at native resolution, but reduce WebRTC
    # encoder workload. Set WEBRTC_MAX_WIDTH=1920 to retain full HD.
    MAX_WIDTH = max(0, int(os.environ.get("WEBRTC_MAX_WIDTH", "1280")))
    MAX_HEIGHT = max(0, int(os.environ.get("WEBRTC_MAX_HEIGHT", "720")))

    def __init__(self, camera):
        super().__init__()
        self.camera = camera
        self.last_seq = -1
        self.last_frame = None
        self._pts = 0
        self._pts_step = self.CLOCK_RATE // self.TARGET_FPS
        self._time_base = Fraction(1, self.CLOCK_RATE)
        self._next_frame_time = _time.monotonic()
        self._last_age_log = 0.0
        self.frames_sent = 0
        self.repeated_frames = 0

    async def recv(self):
        # Match the measured camera rate (~20 FPS); aiortc's default track
        # clock is 30 FPS and can cause unnecessary repeats for a 20 FPS feed.
        now = _time.monotonic()
        delay = self._next_frame_time - now
        if delay > 0:
            await asyncio.sleep(delay)

        now = _time.monotonic()
        # Never try to "catch up" by sending frames in a burst after a
        # scheduling/encoding delay. If this call is late, restart the cadence
        # from now; otherwise retain the fixed-rate deadline.
        self._next_frame_time = max(
            self._next_frame_time + self.FRAME_INTERVAL,
            now + self.FRAME_INTERVAL,
        )

        # Non-blocking latest-frame read. The method only takes a short lock;
        # avoiding asyncio.to_thread removes executor scheduling overhead from
        # every frame. No FIFO queue is used, so stale frames cannot accumulate.
        frame, seq, raw_timestamp = self.camera.get_raw_frame_snapshot(
            self.last_seq,
            0.0,
            False,
        )

        if frame is not None:
            self.last_seq = seq
            self.last_frame = frame
        elif self.last_frame is not None:
            self.repeated_frames += 1

        if self.last_frame is None:
            import numpy as np
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
        else:
            frame = self.last_frame

        if raw_timestamp and _time.monotonic() - self._last_age_log >= 5.0:
            age_ms = max(0.0, (_time.monotonic() - raw_timestamp) * 1000.0)
            log.info("WebRTC source-frame age: %.1f ms", age_ms)
            self._last_age_log = _time.monotonic()

        height, width = frame.shape[:2]
        if (
            self.MAX_WIDTH > 0 and self.MAX_HEIGHT > 0
            and (width > self.MAX_WIDTH or height > self.MAX_HEIGHT)
        ):
            scale = min(self.MAX_WIDTH / width, self.MAX_HEIGHT / height)
            out_width = max(2, int(width * scale) // 2 * 2)
            out_height = max(2, int(height * scale) // 2 * 2)
            frame = cv2.resize(
                frame, (out_width, out_height),
                interpolation=cv2.INTER_AREA,
            )

        video_frame = VideoFrame.from_ndarray(frame, format="bgr24")
        self.frames_sent += 1
        self._pts += self._pts_step
        video_frame.pts = self._pts
        video_frame.time_base = self._time_base
        return video_frame


# ── WebRTC video endpoint ──────────────────────────────────────

@app.post("/api/webrtc/offer")
async def webrtc_offer(request: Request):
    """Accept a browser SDP offer and return an SDP answer for raw camera video."""
    try:
        payload = await request.json()
        sdp = payload.get("sdp")
        offer_type = payload.get("type", "offer")
        if not sdp or offer_type != "offer":
            return JSONResponse(
                {"error": "A valid WebRTC offer (sdp/type) is required"},
                status_code=400,
            )

        ice_servers = _webrtc_ice_servers()
        pc = RTCPeerConnection(
            configuration=RTCConfiguration(iceServers=ice_servers)
        )
        webrtc_peers.add(pc)

        @pc.on("connectionstatechange")
        async def on_connectionstatechange():
            log.info("WebRTC peer state: %s", pc.connectionState)
            # "disconnected" is often transient (Wi-Fi roam / brief packet
            # loss). Keep the peer alive so ICE can recover; close only terminal
            # states. The browser applies its own short disconnect grace period.
            if pc.connectionState in ("failed", "closed"):
                webrtc_peers.discard(pc)
                await pc.close()

        pc.addTrack(CrusherVideoTrack(crusher_camera))
        await pc.setRemoteDescription(
            RTCSessionDescription(sdp=sdp, type=offer_type)
        )

        # Prefer software H.264 (libx264 in aiortc/PyAV) for lower
        # encode/decode overhead where the browser supports it. Keep every
        # other negotiated video codec after H.264 as a compatibility fallback.
        video_transceiver = next(
            (transceiver for transceiver in pc.getTransceivers()
             if transceiver.kind == "video"),
            None,
        )
        if video_transceiver is not None:
            video_codecs = RTCRtpSender.getCapabilities("video").codecs
            h264_codecs = [
                codec for codec in video_codecs
                if codec.mimeType.lower() == "video/h264"
            ]
            fallback_codecs = [
                codec for codec in video_codecs
                if codec.mimeType.lower() != "video/h264"
            ]

            if h264_codecs:
                video_transceiver.setCodecPreferences(
                    h264_codecs + fallback_codecs
                )
                log.info(
                    "WebRTC video codec preference: H.264 first; "
                    "%d H.264 formats, %d fallback formats",
                    len(h264_codecs),
                    len(fallback_codecs),
                )
            else:
                log.warning(
                    "No H.264 encoder capability found; using default codec order"
                )

        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        return JSONResponse({
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type,
        })

    except Exception as exc:
        log.exception("WebRTC offer negotiation failed")
        if "pc" in locals():
            webrtc_peers.discard(pc)
            await pc.close()
        return JSONResponse(
            {"error": f"WebRTC negotiation failed: {exc}"},
            status_code=500,
        )


@app.get("/api/webrtc/status")
async def webrtc_status():
    """Lightweight diagnostics for active server-side WebRTC peers."""
    return JSONResponse({
        "peer_count": len(webrtc_peers),
        "peers": [
            {
                "connection_state": pc.connectionState,
                "ice_connection_state": pc.iceConnectionState,
                "signaling_state": pc.signalingState,
                "ice_gathering_state": pc.iceGatheringState,
            }
            for pc in list(webrtc_peers)
        ],
    })


# ── WebSocket Endpoint ────────────────────────────────────────
@app.websocket("/ws/camera")
async def camera_ws(websocket: WebSocket):
    await manager.connect(websocket)

    try:
        last_sent = 0.0
        update_interval = 0.1  # 10 telemetry updates per second

        while True:
            now = _time.monotonic()

            if now - last_sent >= update_interval:
                state = crusher_camera.get_state()

                # Video uses WebRTC; send telemetry only over WebSocket.
                state.pop("frame", None)
                await websocket.send_json(state)

                last_sent = now

            await asyncio.sleep(0.02)

    except WebSocketDisconnect:
        log.info("Camera WebSocket disconnected.")

    except Exception:
        log.exception("Camera WebSocket error.")

    finally:
        manager.disconnect(websocket)


# ── REST Endpoints ────────────────────────────────────────────

@app.post("/api/auth/login")
async def auth_login(request: Request):
    """
    Server-side credential check.
    Credentials are read from .env (AUTH_USER / AUTH_PASS).
    Returns 200 + role on success, 401 on failure.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid request body"}, status_code=400)
    username = body.get("username", "")
    password = body.get("password", "")
    if username == AUTH_USER and password == AUTH_PASS:
        log.info("Login success for user: %s", username)
        return JSONResponse({"ok": True, "role": "Plant Manager", "site": "Chennimalai"})
    log.warning("Failed login attempt for user: %s", username)
    return JSONResponse({"ok": False, "error": "Invalid username or password"}, status_code=401)


@app.get("/api/config")
async def get_public_config():
    """
    Returns non-secret backend config for the dashboard to display
    (RTSP host without credentials, VFD profile, etc.).
    """
    import re
    from config import RTSP_URL, MODEL_PATH, VFD_PROFILE, VFD_MODE, VFD_PORT, VFD_ENABLED, VFD_MAX_RPM
    # Strip user:pass@ from RTSP URL before exposing
    rtsp_safe = re.sub(r"://[^@/]+@", "://", RTSP_URL or "")
    return JSONResponse({
        "rtsp_host"   : rtsp_safe,
        "model"       : os.path.basename(MODEL_PATH or ""),
        "vfd_enabled" : VFD_ENABLED,
        "vfd_profile" : VFD_PROFILE,
        "vfd_mode"    : VFD_MODE,
        "vfd_port"    : VFD_PORT if VFD_ENABLED else None,
        "vfd_max_rpm" : VFD_MAX_RPM,
    })


@app.get("/api/status")
async def get_status():
    state    = crusher_camera.get_state()
    vfd_stat = vfd_controller.status
    return JSONResponse({
        "cam_status"          : state.get("cam_status"),
        "machine_status"      : state.get("machine_status"),
        "jaw_label"           : state.get("jaw_label"),
        "jaw_conf"            : state.get("jaw_conf"),
        "target_vfd_rpm"      : state.get("target_vfd_rpm"),
        "camera_fps"          : state.get("camera_fps"),
        "capture_fps"         : state.get("capture_fps"),
        "inference_fps"       : state.get("inference_fps"),
        "live_frame_count"    : state.get("live_frame_count"),
        "live_frame_age_s"    : state.get("live_frame_age_s"),
        "inference_status"    : state.get("inference_status", "starting"),
        "inference_error"     : state.get("inference_error"),
        "frame_count"         : state.get("frame_count"),
        "frame_age_s"         : state.get("frame_age_s"),
        "vfd_connected"       : vfd_stat.get("connected"),
        "vfd_consecutive_errors" : vfd_stat.get("consecutive_errors"),
    })


@app.get("/api/crusher")
async def get_crusher():
    return JSONResponse(crusher_logic.get_state())


@app.get("/api/oee")
async def get_oee():
    state = crusher_logic.get_state()
    return JSONResponse({
        "availability_pct" : state["availability_pct"],
        "timer_run"        : state["timer_run"],
        "timer_stuck"      : state["timer_stuck"],
        "timer_no_feed"    : state["timer_no_feed"],
        "timer_idle"       : state["timer_idle"],
        "timer_shift"      : state["timer_shift"],
        "frames_running"   : state["frames_running"],
        "frames_stuck"     : state["frames_stuck"],
        "frames_no_feed"   : state["frames_no_feed"],
        "tonnage_actual"   : state["tonnage_actual"],
    })


@app.get("/api/alerts")
async def get_alerts():
    state = crusher_logic.get_state()
    return JSONResponse({
        "active_alerts" : state["active_alerts"],
        "alert_count"   : state["alert_count"],
    })


@app.get("/api/history")
async def get_history():
    return JSONResponse({"history": crusher_logic.get_history()})


@app.get("/api/snapshot")
async def get_snapshot():
    """Return the newest independent preview as raw JPEG bytes."""
    jpeg, frame_count, frame_age = crusher_camera.get_live_frame()

    if jpeg is None:
        state = crusher_camera.get_state()
        return JSONResponse({
            "error": "No preview frame available",
            "cam_status": state.get("cam_status"),
            "last_error": state.get("last_error"),
        }, status_code=503)

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Frame-Count": str(frame_count),
            "X-Frame-Age": (
                str(round(frame_age, 3)) if frame_age is not None else ""
            ),
        },
    )


@app.post("/api/tonnage/{tonnes}")
async def add_tonnage(tonnes: float):
    if tonnes < 0 or tonnes > 1000:
        return JSONResponse({"ok": False, "error": "tonnes must be 0–1000"}, status_code=400)
    crusher_logic.update_tonnage(tonnes)
    return JSONResponse({"ok": True, "added": tonnes})


@app.post("/api/shift/reset")
async def reset_shift():
    # Save shift report before reset
    state = crusher_logic.get_state()
    await save_shift_report(state)
    crusher_logic.reset_shift()
    return JSONResponse({"ok": True, "message": "Shift reset and report saved"})


@app.post("/api/camera/restart")
async def restart_camera():
    log.info("Manual camera restart requested via API.")
    await crusher_camera.restart()
    return JSONResponse({"ok": True, "message": "Camera restart initiated."})


@app.get("/api/camera/status")
async def camera_status():
    state = crusher_camera.get_state()
    return JSONResponse({
        "cam_status": state.get("cam_status"),
        "camera_fps": state.get("camera_fps"),
        "capture_fps": state.get("capture_fps"),
        "inference_fps": state.get("inference_fps"),
        "live_frame_count": state.get("live_frame_count"),
        "live_frame_age_s": state.get("live_frame_age_s"),
        "inference_status": state.get("inference_status", "starting"),
        "inference_error": state.get("inference_error"),
        "frame_count": state.get("frame_count"),
        "frame_age_s": state.get("frame_age_s"),
        "last_error": state.get("last_error"),
    })


@app.get("/api/v1/live")
async def pwa_live():
    """PWA dashboard: live snapshot in the shape the JS service expects."""
    cam  = crusher_camera.get_state()
    cs   = crusher_logic.get_state()
    vfd  = vfd_controller.status

    machine_status = cs.get("machine_status", "STOPPED")
    jaw_label      = cs.get("jaw_label", "unknown")
    jaw_conf       = cs.get("jaw_conf", 0.0)
    target_rpm     = cs.get("target_vfd_rpm", 0)
    target_hz      = round(target_rpm * 50 / 1500, 1)
    actual_rpm     = vfd.get("actual_rpm") or 0
    actual_hz      = round(actual_rpm * 50 / 1500, 1)
    sw             = vfd.get("status_word") or {}

    MACHINE_TO_CRUSHER = {
        "NORMAL": "RUNNING", "STONE STUCK": "WARNING",
        "NO RAW MATERIAL": "RUNNING", "STOPPED": "STOPPED", "FAULT": "FAULT",
    }
    JAW_TO_AI = {
        "jaw filled": "FULL", "jaw partially filled": "PARTIAL", "jaw empty": "EMPTY",
    }

    if vfd.get("connected"):
        if sw.get("tripped"):  drive_status = "Fault"
        elif sw.get("running"): drive_status = "Running"
        else:                   drive_status = "Stopped"
    elif machine_status == "FAULT":                                        drive_status = "Fault"
    elif machine_status in ("NORMAL", "STONE STUCK", "NO RAW MATERIAL"):   drive_status = "Running"
    else:                                                                   drive_status = "Stopped"

    ai_state = JAW_TO_AI.get(jaw_label, "EMPTY")

    return JSONResponse({
        "timestamp" : datetime.now().isoformat() + "Z",
        "connection": {"source": "api", "online": cam.get("cam_status") == "live"},
        "crusher"   : {
            "status"        : MACHINE_TO_CRUSHER.get(machine_status, "STOPPED"),
            "motorCurrentA" : None,
        },
        "feeder"    : {
            "aiState"    : ai_state,
            "confidence" : round(jaw_conf * 100),
            "detectedAt" : datetime.now().isoformat() + "Z",
            "detecting"  : cam.get("cam_status") == "live",
        },
        "vfd"       : {
            "requestedMode": "AUTO",
            "mode"         : "AUTO",
            "manualHz"     : target_hz,
            "commandHz"    : target_hz,
            "outputHz"     : actual_hz if actual_hz > 0 else target_hz,
            "autoHz"       : target_hz,
            "manualAllowed": ai_state == "EMPTY",
            "atMax"        : target_rpm >= 1290,
            "interlock"    : machine_status == "FAULT",
            "driveStatus"  : drive_status,
        },
    })


@app.get("/api/v1/vfd/trend")
async def pwa_vfd_trend(minutes: int = 10):
    """PWA dashboard: VFD Hz trend — [{t: epoch_ms, hz: float}]."""
    data = await get_vfd_history(minutes)
    trend = []
    for row in reversed(data):   # DB returns DESC, we need ASC
        try:
            ts = datetime.strptime(row["timestamp"], "%Y-%m-%d %H:%M:%S")
            hz = round(int(row["vfd_hz"]) * 50 / 1500, 1)   # vfd_hz column stores RPM
            trend.append({"t": int(ts.timestamp() * 1000), "hz": hz})
        except Exception:
            pass
    return JSONResponse(trend)


@app.get("/api/v1/alerts")
async def pwa_alerts(limit: int = 100):
    """PWA dashboard: alert history in the shape the JS service expects."""
    data = await get_alerts_history(limit)
    alerts = []
    for a in data:
        alert_id = a.get("alert_id", "UNKNOWN")
        alerts.append({
            "id"         : str(a["id"]),
            "severity"   : a.get("level", "info"),
            "type"       : alert_id.upper().replace("-", "_"),
            "title"      : alert_id.replace("-", " ").replace("_", " ").title(),
            "description": a.get("message", ""),
            "time"       : a["timestamp"].replace(" ", "T") + "Z",
            "read"       : bool(a.get("resolved", 0)),
            "source"     : "Jaw Crusher",
        })
    return JSONResponse(alerts)


@app.get("/api/v1/analytics")
async def pwa_analytics(from_date: str = None, to_date: str = None, label: str = ""):
    """PWA dashboard: analytics summary for a date range."""
    from datetime import date as _date
    today     = _date.today().isoformat()
    from_date = from_date or today
    to_date   = to_date   or today

    summary  = await get_period_summary(from_date, to_date)
    vfd_data = await get_vfd_history(1440)  # last 24h of VFD samples

    run      = summary.get("run_secs",     0) or 0
    stuck    = summary.get("stuck_secs",   0) or 0
    no_feed  = summary.get("no_feed_secs", 0) or 0
    active   = run + stuck + no_feed
    avail    = summary.get("availability_pct", 0.0)

    # avg/peak Hz — vfd_hz column stores RPM, convert to Hz
    avg_hz  = round((summary.get("avg_vfd_hz", 0) or 0) * 50 / 1500, 1)
    peak_hz = round((summary.get("peak_vfd_hz", 0) or 0) * 50 / 1500, 1)

    trend = []
    for row in reversed(vfd_data):
        ts_str = row.get("timestamp", "")
        if ts_str[:10] < from_date or ts_str[:10] > to_date:
            continue
        try:
            ts = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
            hz = round(int(row["vfd_hz"]) * 50 / 1500, 1)
            trend.append({"t": int(ts.timestamp() * 1000), "hz": hz})
        except Exception:
            pass

    return JSONResponse({
        "period"        : {"from": from_date, "to": to_date, "label": label,
                           "days": 1, "generatedAt": datetime.now().isoformat()},
        "source"        : "api",
        "runtimeSec"    : run,
        "elapsedSec"    : active,
        "downtimeSec"   : stuck + no_feed,
        "feederRuntimeSec": run,
        "vfdRuntimeSec" : run,
        "outputT"       : 0,
        "avgTph"        : 0,
        "states"        : {"EMPTY": no_feed, "PARTIAL": stuck, "FULL": run},
        "detections"    : {"EMPTY": 0, "PARTIAL": 0, "FULL": 0},
        "vfd"           : {
            "avgHz"        : avg_hz,
            "minHz"        : 0,
            "maxHz"        : peak_hz,
            "trend"        : trend,
            "manualPeriods": [],
        },
        "stopEvents"    : [],
        "alerts"        : {
            "total": summary.get("total_alerts", 0), "fault": 0,
            "warning": 0, "info": summary.get("total_alerts", 0), "manual": 0,
        },
        "oee"           : {"availability": avail, "performance": 0, "quality": 0, "overall": 0},
        "days"          : [],
    })


@app.get("/api/v1/machines/feeder-1/status")
async def flutter_machine_status():
    """Flutter app compatible endpoint"""
    state = crusher_camera.get_state()
    cs    = crusher_logic.get_state()
    return JSONResponse({
        "cam_status"      : state.get("cam_status"),
        "machine_status"  : cs.get("machine_status"),
        "jaw_label"       : cs.get("jaw_label"),
        "jaw_conf"        : cs.get("jaw_conf"),
        "target_vfd_rpm"  : cs.get("target_vfd_rpm"),
        "availability_pct": cs.get("availability_pct"),
        "active_alerts"   : cs.get("active_alerts"),
        "timer_run"       : cs.get("timer_run"),
        "timer_stuck"     : cs.get("timer_stuck"),
        "timer_no_feed"   : cs.get("timer_no_feed"),
        "camera_fps"      : state.get("camera_fps"),
        "shift"           : cs.get("shift"),
    })


# ── NEW DB History Endpoints ──────────────────────────────────

@app.get("/api/db/alerts")
async def db_alerts(limit: int = 100):
    """Get alert history from database"""
    data = await get_alerts_history(limit)
    return JSONResponse({"alerts": data, "count": len(data)})


@app.get("/api/db/oee")
async def db_oee(hours: int = 24):
    """Get OEE history from database"""
    data = await get_oee_history(hours)
    return JSONResponse({"oee_history": data, "count": len(data)})


@app.get("/api/db/vfd")
async def db_vfd(minutes: int = 60):
    """Get VFD history from database"""
    data = await get_vfd_history(minutes)
    return JSONResponse({"vfd_logs": data, "count": len(data)})


@app.get("/api/db/shifts")
async def db_shifts(limit: int = 30):
    """Get shift reports from database"""
    data = await get_shift_reports(limit)
    return JSONResponse({"shift_reports": data, "count": len(data)})


@app.get("/api/db/summary")
async def db_summary():
    """Get today's state summary from database"""
    data = await get_state_summary_today()
    return JSONResponse({"summary": data})


# ── VFD Endpoints ────────────────────────────────────────────

@app.get("/api/vfd/status")
async def vfd_status():
    """Live Modbus connection status and write counters."""
    return JSONResponse(vfd_controller.status)


@app.post("/api/vfd/set/{rpm}")
async def vfd_set(rpm: int):
    """
    Manually override the VFD speed (0–1000 RPM).
    0 sends the stop command.
    """
    if rpm < 0 or rpm > 1500:
        return JSONResponse({"ok": False, "error": "rpm must be 0–1500"}, status_code=400)
    vfd_controller._last_rpm = -1         # force write even if value unchanged
    await vfd_controller.set_speed(rpm)
    return JSONResponse({"ok": True, "rpm": rpm})


@app.post("/api/vfd/stop")
async def vfd_force_stop():
    """Send stop command to VFD immediately."""
    await vfd_controller.stop_drive()
    return JSONResponse({"ok": True, "message": "Stop command sent to VFD."})


@app.post("/api/vfd/reset-fault")
async def vfd_reset_fault():
    """
    Send the ABB fault-reset command (CW = 0x04FF).
    Use after the drive has tripped — e.g. overcurrent, undervoltage.
    """
    await vfd_controller.reset_fault()
    return JSONResponse({"ok": True, "message": "Fault-reset command sent to VFD."})


# ── Report Endpoints ─────────────────────────────────────────

@app.get("/api/reports/shift-pdf")
async def report_shift_pdf(limit: int = 20):
    """
    Generate and return a PDF containing the last `limit` shift reports.
    The browser receives it as a file download.
    """
    try:
        rows       = await get_shift_reports(limit)
        live_state = crusher_logic.get_state()
        pdf_bytes  = await asyncio.to_thread(build_shift_pdf, rows, live_state)
        filename   = f"crusher_shift_report_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return Response(
            content     = pdf_bytes,
            media_type  = "application/pdf",
            headers     = {"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        log.error("PDF report error: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/reports/shift-csv")
async def report_shift_csv(limit: int = 20):
    """
    Generate and return a CSV file with a Daily Summary header block
    followed by the last `limit` shift reports.
    """
    try:
        rows       = await get_shift_reports(limit)
        live_state = crusher_logic.get_state()
        csv_text   = build_shift_csv(rows, live_state)
        filename   = f"crusher_shift_report_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
        return Response(
            content     = csv_text,
            media_type  = "text/csv",
            headers     = {"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        log.error("CSV report error: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Period Report Endpoints (DB-based, any date range) ───────

def _period_dates(period: str, from_date: str = "", to_date: str = "") -> tuple[str, str, str]:
    """Return (from_date, to_date, label) for a given period string."""
    from datetime import date, timedelta
    today = date.today()
    if period == "1w":
        return (today - timedelta(days=6)).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"), "1 Week"
    if period == "1m":
        return (today - timedelta(days=29)).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"), "1 Month"
    if period == "custom" and from_date and to_date:
        return from_date, to_date, "Custom Range"
    # default: 1d
    td = today.strftime("%Y-%m-%d")
    return td, td, "1 Day"


@app.get("/api/reports/pdf")
async def report_pdf(
    period: str   = "1d",
    from_date: str = "",
    to_date: str   = "",
):
    """
    Generate PDF for any period.
    ?period=1d|1w|1m|custom  &from_date=YYYY-MM-DD &to_date=YYYY-MM-DD
    """
    try:
        fd, td, label = _period_dates(period, from_date, to_date)
        summary   = await get_period_summary(fd, td)
        pdf_bytes = await asyncio.to_thread(build_period_pdf, summary, label, fd, td)
        filename  = f"crusher_report_{fd}_{td}.pdf"
        return Response(
            content    = pdf_bytes,
            media_type = "application/pdf",
            headers    = {"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        log.error("PDF report error: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/reports/csv")
async def report_csv(
    period: str   = "1d",
    from_date: str = "",
    to_date: str   = "",
):
    """Generate CSV for any period."""
    try:
        fd, td, label = _period_dates(period, from_date, to_date)
        summary  = await get_period_summary(fd, td)
        csv_text = await asyncio.to_thread(build_period_csv, summary, label, fd, td)
        filename = f"crusher_report_{fd}_{td}.csv"
        return Response(
            content    = csv_text,
            media_type = "text/csv",
            headers    = {"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        log.error("CSV report error: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/reports/excel")
async def report_excel(
    period: str   = "1d",
    from_date: str = "",
    to_date: str   = "",
):
    """Generate Excel .xlsx for any period."""
    try:
        fd, td, label  = _period_dates(period, from_date, to_date)
        summary        = await get_period_summary(fd, td)
        excel_bytes    = await asyncio.to_thread(build_period_excel, summary, label, fd, td)
        filename       = f"crusher_report_{fd}_{td}.xlsx"
        return Response(
            content    = excel_bytes,
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers    = {"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        log.error("Excel report error: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


# ── MJPEG Stream ──────────────────────────────────────────────

@app.get("/stream/mjpeg")
async def mjpeg_stream():
    """Serve the independent latest-JPEG preview as a continuous MJPEG stream."""

    async def generate():
        last_frame_count = -1
        while True:
            jpeg, frame_count, frame_age = crusher_camera.get_live_frame()

            if jpeg is not None and frame_count != last_frame_count:
                last_frame_count = frame_count
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii")
                    + jpeg
                    + b"\r\n"
                )
            elif frame_age is not None and frame_age > 5:
                await asyncio.sleep(0.1)
            else:
                # Short wait only when there is no newly published frame.
                await asyncio.sleep(0.01)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no",
        },
    )


# ── Dashboard + PWA root files ────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    html_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(html_path):
        with open(html_path, encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Dashboard not found.</h1>")


@app.get("/sw.js")
async def service_worker():
    """PWA service worker — must be served at root scope."""
    path = os.path.join(STATIC_DIR, "sw.js")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return Response(f.read(), media_type="application/javascript")
    return Response("", media_type="application/javascript")


@app.get("/manifest.webmanifest")
async def web_manifest():
    path = os.path.join(STATIC_DIR, "manifest.webmanifest")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return Response(f.read(), media_type="application/manifest+json")
    return Response("{}", media_type="application/manifest+json")


# ── Entry Point ───────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
