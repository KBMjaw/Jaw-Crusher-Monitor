"""Low-latency RTSP capture, YOLO inference and rate-limited JPEG preview."""
import asyncio
import logging
import os
import threading
import time
from datetime import datetime

import cv2
from ultralytics import YOLO

from config import (
    MODEL_PATH, RTSP_URL, CONF_THRESHOLD,
    SAVE_ANNOTATED, OUTPUT_DIR, HEADLESS, VFD_SPEEDS,
)
from crusher_logic import crusher_logic

log = logging.getLogger(__name__)

# The raw RTSP/WebRTC path remains at camera FPS. The JPEG preview is a
# separate, lower-priority path used by snapshots and MJPEG fallback.
PREVIEW_FPS = max(1.0, min(30.0, float(os.environ.get("PREVIEW_FPS", "10"))))
PREVIEW_JPEG_QUALITY = max(30, min(95, int(os.environ.get("PREVIEW_JPEG_QUALITY", "55"))))


class CrusherCamera:
    """Capture RTSP continuously; process only the newest available frame."""

    def __init__(self):
        self.model = None
        self.cap = None
        self.running = False

        self.capture_thread = None
        self.process_thread = None
        self.preview_thread = None
        self.thread = None  # Compatibility alias for older code.

        self._raw_condition = threading.Condition()
        self._raw_frame = None
        self._raw_seq = 0

        # Preview output is published independently from YOLO inference.
        self.latest_jpeg = None
        self.preview_frame_count = 0
        self.preview_fps = 0.0
        self.preview_timestamp = 0.0
        self._preview_lock = threading.RLock()
        self.latest_live_jpeg = None  # Compatibility alias for latest_jpeg.
        self.live_frame_count = 0      # Counts preview frames published to clients.
        self.capture_fps = 0.0         # Decoded RTSP frames per second.
        self.last_live_frame_time = 0.0
        self._last_capture_time = 0.0
        self.inference_fps = 0.0
        self._last_inference_time = 0.0

        self.latest_frame = None
        self.latest_state = {}
        self.status = "stopped"
        self.last_error = None
        self.fps_actual = 0.0
        self.frame_count = 0
        self._last_frame_time = 0.0
        self._lock = threading.RLock()

    def get_live_frame(self):
        """Return the newest preview JPEG without waiting for YOLO.

        Returns (jpeg_bytes, frame_count, age_seconds).
        Use this method from the MJPEG endpoint in main.py.
        """
        with self._preview_lock:
            age = (
                time.time() - self.preview_timestamp
                if self.preview_timestamp else None
            )
            return self.latest_jpeg, self.preview_frame_count, age

    def load_model(self):
        if self.model is not None:
            return
        if not MODEL_PATH or not os.path.isfile(MODEL_PATH):
            raise RuntimeError(f"YOLO model file missing: {MODEL_PATH}")
        log.info("Loading YOLO model: %s", MODEL_PATH)
        self.model = YOLO(MODEL_PATH)
        log.info("YOLO model loaded successfully")

    def _infer(self, frame):
        """Return (annotated_frame_or_none, label, confidence, inference_ok).

        The captured ndarray is immutable after publication. Ultralytics reads
        it for preprocessing; only make a full-resolution copy when an
        annotation window or annotated-frame saving actually needs one.
        """
        try:
            if self.model is None:
                raise RuntimeError("YOLO model is not loaded")

            results = self.model.predict(source=frame, verbose=False)
            if not results or results[0].probs is None:
                raise RuntimeError("YOLO returned no classification probabilities")

            result = results[0]
            class_id = int(result.probs.top1)
            confidence = float(result.probs.top1conf)
            names = self.model.names

            if class_id not in names:
                raise RuntimeError(f"Unknown YOLO class ID: {class_id}")

            label = " ".join(str(names[class_id]).lower().split())
            valid_labels = {
                "jaw empty", "jaw filled", "jaw partially filled",
            }
            if label not in valid_labels:
                raise RuntimeError(f"Unexpected classification label: {label}")

            annotated = frame.copy() if (not HEADLESS or SAVE_ANNOTATED) else None
            if confidence < CONF_THRESHOLD:
                log.warning("Low YOLO confidence: %s (%.3f)", label, confidence)
                return annotated, label, confidence, False

            return annotated, label, confidence, True

        except Exception:
            log.exception("YOLO inference failed")
            annotated = frame.copy() if (not HEADLESS or SAVE_ANNOTATED) else None
            return annotated, "unknown", 0.0, False

    def connect_rtsp(self):
        if not RTSP_URL:
            raise RuntimeError("RTSP_URL is empty. Set it in the backend .env file.")

        # Low-latency RTSP profile for a wired local network. UDP avoids TCP
        # head-of-line blocking when a packet is lost. Set RTSP_TRANSPORT=tcp
        # in .env if UDP is blocked or produces visible packet-loss artifacts.
        # Keep a small (non-zero) H.264 reorder/probe budget for reliable startup.
        transport = os.environ.get("RTSP_TRANSPORT", "udp").strip().lower()
        if transport not in {"tcp", "udp"}:
            log.warning("Invalid RTSP_TRANSPORT=%r; using udp", transport)
            transport = "udp"

        ffmpeg_options = [
            f"rtsp_transport;{transport}",
            "fflags;discardcorrupt",
            "flags;low_delay",
            "max_delay;50000",          # 50 ms (was 250 ms)
            "reorder_queue_size;4",     # was 16
            "probesize;100000",         # was 500000
            "analyzeduration;200000",   # was 1000000
            "rw_timeout;3000000",
        ]
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "|".join(ffmpeg_options)

        # Open/read timeouts should be passed while opening the FFmpeg capture.
        params = []
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            params.extend([cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000])
        if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            params.extend([cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000])

        log.info(
            "Opening RTSP stream: transport=%s, stable low-delay H.264 options",
            transport,
        )
        try:
            cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG, params)
        except (TypeError, cv2.error):
            cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)

        if not cap.isOpened():
            cap.release()
            raise RuntimeError("OpenCV/FFmpeg could not open the RTSP stream")

        # Best-effort hint; support depends on the OpenCV backend.
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def get_latest_frame(self):
        cap = self.cap
        if cap is None or not cap.isOpened():
            return False, None
        return cap.read()

    def start(self):
        if self.running:
            log.warning("Camera start ignored: already running")
            return

        if (
            (self.capture_thread and self.capture_thread.is_alive())
            or (self.process_thread and self.process_thread.is_alive())
            or (self.preview_thread and self.preview_thread.is_alive())
        ):
            log.warning("Camera start ignored: previous worker is still stopping")
            return

        # Do not load YOLO here. The process worker loads it independently
        # so RTSP capture and live preview can start without waiting for AI.
        if not RTSP_URL:
            raise RuntimeError("RTSP_URL is not configured")

        self.running = True
        self.last_error = None
        with self._preview_lock:
            self.latest_jpeg = None
            self.preview_frame_count = 0
            self.preview_fps = 0.0
            self.preview_timestamp = 0.0
            self.latest_live_jpeg = None
            self.live_frame_count = 0
            self.last_live_frame_time = 0.0
        with self._lock:
            self.latest_frame = None
            self.latest_state = {}
            self.frame_count = 0
            self.fps_actual = 0.0
            self.inference_fps = 0.0
            self._last_inference_time = 0.0
            self._last_frame_time = 0.0
            self.capture_fps = 0.0
            self._last_capture_time = 0.0
        with self._raw_condition:
            self._raw_frame = None
            self._raw_seq = 0
            self._raw_timestamp = 0.0
            self._raw_condition.notify_all()
        self._set_status("connecting")

        self.process_thread = threading.Thread(
            target=self._process_loop,
            name="crusher-yolo-process",
            daemon=True,
        )
        self.preview_thread = threading.Thread(
            target=self._preview_loop,
            name="crusher-camera-preview",
            daemon=True,
        )
        self.capture_thread = threading.Thread(
            target=self._capture_loop,
            name="crusher-rtsp-capture",
            daemon=True,
        )
        self.thread = self.capture_thread  # Compatibility alias.

        self.process_thread.start()
        self.preview_thread.start()
        self.capture_thread.start()
        log.info("Camera capture, preview and YOLO threads started")

    def stop(self):
        self.running = False
        with self._raw_condition:
            self._raw_condition.notify_all()

        current = threading.current_thread()
        if self.capture_thread and self.capture_thread is not current:
            self.capture_thread.join(timeout=8)
        if self.process_thread and self.process_thread is not current:
            self.process_thread.join(timeout=8)
        if self.preview_thread and self.preview_thread is not current:
            self.preview_thread.join(timeout=8)

        workers_alive = (
            (self.capture_thread and self.capture_thread.is_alive())
            or (self.process_thread and self.process_thread.is_alive())
            or (self.preview_thread and self.preview_thread.is_alive())
        )
        if workers_alive:
            log.warning("Camera worker did not exit before stop timeout")
            self._set_status("stopping")
        else:
            self._set_status("stopped")
        # VideoCapture is released by the capture thread that owns cap.
        log.info("Crusher camera stop requested")

    async def restart(self):
        await asyncio.to_thread(self.stop)
        await asyncio.sleep(1)
        if (
            (self.capture_thread and self.capture_thread.is_alive())
            or (self.process_thread and self.process_thread.is_alive())
            or (self.preview_thread and self.preview_thread.is_alive())
        ):
            raise RuntimeError("Previous camera worker is still stopping")
        await asyncio.to_thread(self.start)

    def _set_status(self, status, error=None):
        with self._lock:
            self.status = status
            if error is not None:
                self.last_error = str(error)

    def _update(self, state):
        """Publish inference metadata without blocking the video preview."""
        with self._lock:
            self.latest_state = state or {}

    def _publish_preview(self, jpeg_bytes, frame_b64, fps):
        """Publish the newest encoded frame independently of YOLO."""
        now = time.time()

        # This lock is used by the MJPEG endpoint and preview readers.
        with self._preview_lock:
            self.latest_jpeg = jpeg_bytes
            self.latest_live_jpeg = jpeg_bytes
            self.preview_frame_count += 1
            self.live_frame_count = self.preview_frame_count
            self.preview_fps = float(fps)
            self.preview_timestamp = now
            self.last_live_frame_time = now

        # WebRTC/MJPEG carry the video; do not retain a second base64 copy.
        with self._lock:
            self.latest_frame = frame_b64
            # camera_fps is the RTSP capture rate; preview_fps is tracked
            # separately so throttling JPEG preview does not look like a
            # camera frame-rate drop.
            self.frame_count += 1
            self._last_frame_time = now
            self.status = "live"
            self.last_error = None

    def get_raw_frame(self, last_seq=-1, timeout=0.0, copy_frame=True):
        """Return the newest RTSP frame and sequence number.

        WebRTC can use copy_frame=False because captured arrays are never
        modified after publication. Consumers that modify frames must copy.
        """
        with self._raw_condition:
            if timeout > 0:
                self._raw_condition.wait_for(
                    lambda: self._raw_seq != last_seq or not self.running,
                    timeout=float(timeout),
                )
            if self._raw_frame is None or self._raw_seq == last_seq:
                return None, self._raw_seq
            frame = self._raw_frame
            seq = self._raw_seq

        return (frame.copy() if copy_frame else frame), seq

    def get_raw_frame_snapshot(self, last_seq=-1, timeout=0.0, copy_frame=False):
        """Atomically return (frame, sequence, monotonic_capture_timestamp).

        Keeping the timestamp under the same condition lock prevents WebRTC
        diagnostics from accidentally pairing a frame with a newer timestamp.
        """
        with self._raw_condition:
            if timeout > 0:
                self._raw_condition.wait_for(
                    lambda: self._raw_seq != last_seq or not self.running,
                    timeout=float(timeout),
                )
            if self._raw_frame is None or self._raw_seq == last_seq:
                return None, self._raw_seq, self._raw_timestamp
            frame = self._raw_frame
            seq = self._raw_seq
            timestamp = self._raw_timestamp

        return (frame.copy() if copy_frame else frame), seq, timestamp

    def get_latest_jpeg(self):
        with self._preview_lock:
            age = (
                time.time() - self.preview_timestamp
                if self.preview_timestamp else None
            )
            return {
                "jpeg": self.latest_jpeg,
                "frame_count": self.preview_frame_count,
                "camera_fps": round(self.preview_fps, 1),
                "frame_age_s": round(age, 2) if age is not None else None,
            }

    def get_state(self):
        with self._lock:
            frame_age = (
                time.time() - self._last_frame_time
                if self._last_frame_time else None
            )
            return {
                "frame": self.latest_frame,
                "camera_fps": round(self.fps_actual, 1),
                "frame_count": self.frame_count,
                "cam_status": self.status,
                "frame_age_s": round(frame_age, 1) if frame_age is not None else None,
                "last_error": self.last_error,
                "capture_fps": round(self.capture_fps, 1),
                "preview_fps": round(self.preview_fps, 1),
                "live_frame_count": self.live_frame_count,
                "live_frame_age_s": (
                    round(time.time() - self.last_live_frame_time, 3)
                    if self.last_live_frame_time else None
                ),
                "raw_frame_age_s": (
                    round(time.monotonic() - self._raw_timestamp, 3)
                    if self._raw_timestamp else None
                ),
                "inference_fps": round(self.inference_fps, 1),
                **self.latest_state,
            }

    def _capture_loop(self):
        """Read RTSP independently and overwrite the single raw-frame slot."""
        max_retries = 10
        retry_delay = 3
        max_read_failures = 15
        retries = 0
        previous_capture_time = None

        while self.running:
            cap = None
            try:
                self._set_status("connecting")
                cap = self.connect_rtsp()
                self.cap = cap
                log.info("RTSP capture connected")

                read_failures = 0
                while self.running:
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        read_failures += 1
                        if read_failures == 1 or read_failures % 5 == 0:
                            log.warning(
                                "RTSP frame read failed (%d/%d)",
                                read_failures, max_read_failures,
                            )
                        if read_failures >= max_read_failures:
                            raise RuntimeError("Repeated RTSP frame read failures")
                        time.sleep(0.05)
                        continue

                    read_failures = 0
                    retries = 0

                    # Measure decoded RTSP capture rate independently of
                    # preview JPEG encoding and YOLO inference.
                    capture_now = time.monotonic()
                    if previous_capture_time is not None:
                        capture_interval = capture_now - previous_capture_time
                        if capture_interval > 0:
                            instantaneous_fps = 1.0 / capture_interval
                            with self._lock:
                                self.capture_fps = (
                                    instantaneous_fps
                                    if self.capture_fps <= 0
                                    else 0.2 * instantaneous_fps + 0.8 * self.capture_fps
                                )
                                self.fps_actual = self.capture_fps
                    previous_capture_time = capture_now

                    with self._raw_condition:
                        self._raw_frame = frame
                        self._raw_seq += 1
                        # Monotonic timestamp of the latest decoded source frame.
                        self._raw_timestamp = capture_now
                        # Wake both independent consumers: preview and inference.
                        self._raw_condition.notify_all()

            except Exception as exc:
                retries += 1
                log.exception(
                    "RTSP capture error (attempt %d/%d)", retries, max_retries
                )
                self._set_status("reconnecting", exc)
                if retries > max_retries:
                    log.error("Maximum RTSP reconnect attempts reached")
                    break
                for _ in range(retry_delay * 10):
                    if not self.running:
                        break
                    time.sleep(0.1)
            finally:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        log.exception("Error releasing RTSP capture")
                if self.cap is cap:
                    self.cap = None

        with self._raw_condition:
            self._raw_condition.notify_all()
        if self.running:
            self._set_status("error", "RTSP capture stopped unexpectedly")
        elif self.status != "error":
            self._set_status("stopped")
        log.info("RTSP capture thread exited")

    def _preview_loop(self):
        """Publish a rate-limited JPEG preview without touching raw WebRTC frames.

        RTSP capture and WebRTC continue at source FPS. JPEG encoding is capped
        independently because it is only needed for snapshots/MJPEG fallback.
        """
        last_seq = 0
        previous_publish_time = None
        min_interval = 1.0 / PREVIEW_FPS

        while self.running:
            with self._raw_condition:
                self._raw_condition.wait_for(
                    lambda: self._raw_seq != last_seq or not self.running,
                    timeout=0.5,
                )
                if not self.running:
                    break
                if self._raw_frame is None or self._raw_seq == last_seq:
                    continue

                # Published frames are never modified by the capture thread.
                frame = self._raw_frame
                last_seq = self._raw_seq

            now = time.monotonic()
            if previous_publish_time is not None:
                if now - previous_publish_time < min_interval:
                    continue

            try:
                ok, buffer = cv2.imencode(
                    ".jpg",
                    frame,
                    [cv2.IMWRITE_JPEG_QUALITY, PREVIEW_JPEG_QUALITY],
                )
                if not ok:
                    log.warning("Preview JPEG encoding failed; dropping frame")
                    continue

                jpeg_bytes = buffer.tobytes()
                fps = (
                    0.0 if previous_publish_time is None
                    else 1.0 / max(now - previous_publish_time, 1e-6)
                )
                previous_publish_time = now
                self._publish_preview(jpeg_bytes, None, fps)

            except Exception:
                log.exception("Preview frame processing failed")

        log.info("Camera preview thread exited")

    def _process_loop(self):
        """Load YOLO independently, then infer on the newest frame only."""
        last_seq = 0

        # Model loading happens only in this worker. A missing/broken model
        # must not stop RTSP capture or the independent browser preview.
        try:
            self.load_model()
        except Exception as exc:
            log.exception("YOLO model loading failed; live preview remains active")
            with self._lock:
                self.latest_state = {
                    "inference_status": "error",
                    "inference_error": str(exc),
                }
            return

        while self.running:
            with self._raw_condition:
                self._raw_condition.wait_for(
                    lambda: self._raw_seq != last_seq or not self.running,
                    timeout=0.5,
                )
                if not self.running:
                    break
                if self._raw_frame is None or self._raw_seq == last_seq:
                    continue
                # Capture publishes a fresh ndarray for each sequence and
                # never mutates it afterward. Inference can read this reference
                # directly; _infer only copies if annotation output is needed.
                frame = self._raw_frame
                last_seq = self._raw_seq

            try:
                annotated, label, confidence, inference_ok = self._infer(frame)

                if inference_ok:
                    try:
                        crusher_logic.update(label, confidence)
                    except Exception:
                        log.exception("Crusher logic update failed")

                try:
                    crusher_state = crusher_logic.get_state()
                except Exception:
                    log.exception("Could not read crusher logic state")
                    crusher_state = {}

                if not HEADLESS and annotated is not None:
                    try:
                        target_rpm = VFD_SPEEDS.get(label, 0)
                        machine_status = crusher_state.get("machine_status", "UNKNOWN")
                        color = (
                            (0, 255, 0)
                            if machine_status == "NORMAL"
                            else (0, 80, 255)
                        )
                        cv2.rectangle(
                            annotated, (20, 20), (620, 200), (30, 30, 30), -1
                        )
                        cv2.putText(
                            annotated, f"AI State: {label}", (40, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                            (255, 255, 255), 2,
                        )
                        cv2.putText(
                            annotated, f"VFD: {target_rpm} RPM", (40, 100),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                            (255, 255, 255), 2,
                        )
                        cv2.putText(
                            annotated, f"Status: {machine_status}", (40, 140),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2,
                        )
                        cv2.putText(
                            annotated, f"Confidence: {confidence:.2f}", (40, 180),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                            (200, 200, 200), 1,
                        )
                    except Exception:
                        log.exception("Could not draw camera overlay")

                if SAVE_ANNOTATED and annotated is not None:
                    try:
                        os.makedirs(OUTPUT_DIR, exist_ok=True)
                        filename = datetime.now().strftime(
                            "frame_%Y%m%d_%H%M%S_%f.jpg"
                        )
                        cv2.imwrite(os.path.join(OUTPUT_DIR, filename), annotated)
                    except Exception:
                        log.exception("Could not save annotated frame")

                inference_now = time.monotonic()
                with self._lock:
                    if self._last_inference_time:
                        inference_interval = inference_now - self._last_inference_time
                        if inference_interval > 0:
                            self.inference_fps = 1.0 / inference_interval
                    self._last_inference_time = inference_now

                self._update({
                    **crusher_state,
                    "inference_status": "running",
                    "inference_label": label,
                    "inference_confidence": round(float(confidence), 4),
                })

                if not HEADLESS and annotated is not None:
                    cv2.imshow("Crusher YOLO Live", annotated)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        self.running = False
                        break

                # No inference sleep: process the newest available source frame.

            except Exception:
                log.exception("Frame processing failed")

        if not HEADLESS:
            try:
                cv2.destroyAllWindows()
            except Exception:
                log.exception("Could not close OpenCV windows")
        log.info("YOLO processing thread exited")


crusher_camera = CrusherCamera()
