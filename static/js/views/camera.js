/**
 * Live Camera page.
 *
 * Primary transport: WebRTC (low-latency video).
 * Fallback transport: backend MJPEG (GET /stream/mjpeg).
 * Camera telemetry remains on REST/WebSocket and YOLO stays independent.
 */

import { icon } from '../ui/icons.js';
import { $, toast } from '../ui/components.js';
import { setHTML } from '../ui/widgets.js';
import { fmtDate, fmtTimeSec } from '../core/format.js';

const API_BASE = (window.CRUSHER_API_BASE || '').replace(/\/$/, '');
const CAMERA_NAME = 'Crusher Feeder Camera';
const CAMERA_LOCATION = 'Kannan Blue Metals';

let activeRoot = null;
let clockTimer = null;
let statusTimer = null;
let retryTimer = null;
let retryDelay = 2000;
let streamGeneration = 0;
let streamAttempt = null;
let streamAttemptRoot = null;

const apiUrl = (path) => `${API_BASE}${path}`;

// Browser-console diagnostics: await window.getCrusherCameraStats()
window.getCrusherCameraStats = async () => {
  const pc = window.cameraPeerConnection || window._crusherCameraPeer;

  if (!pc) {
    return {
      error: 'No active camera RTCPeerConnection',
      hint: 'Open the camera page and wait for WebRTC negotiation.',
    };
  }

  const reports = await pc.getStats();
  const inbound = [...reports.values()].filter((report) =>
    report.type === 'inbound-rtp' &&
    (report.kind === 'video' || report.mediaType === 'video')
  );

  return {
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    iceGatheringState: pc.iceGatheringState,
    signalingState: pc.signalingState,
    inboundVideo: inbound.map((report) => ({
      framesReceived: report.framesReceived,
      framesDecoded: report.framesDecoded,
      framesDropped: report.framesDropped,
      packetsReceived: report.packetsReceived,
      packetsLost: report.packetsLost,
      framesPerSecond: report.framesPerSecond,
      jitterMs: Number.isFinite(report.jitter)
        ? +(report.jitter * 1000).toFixed(2)
        : null,
      averageJitterBufferMs:
        report.jitterBufferEmittedCount > 0
          ? +(
              report.jitterBufferDelay /
              report.jitterBufferEmittedCount *
              1000
            ).toFixed(2)
          : null,
      totalDecodeTimeMs: Number.isFinite(report.totalDecodeTime)
        ? +(report.totalDecodeTime * 1000).toFixed(2)
        : null,
    })),
  };
};

const query = (selector, root = activeRoot) =>
  root ? $(selector, root) : null;

async function requestJSON(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    ...options,
    headers: { ...(options.headers || {}) },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body.error || `Backend returned HTTP ${response.status}`
    );
  }

  return body;
}

function setMessage(root, message) {
  const el = query('[data-camera-message]', root);

  if (el) {
    el.textContent = message;
  }

  const placeholder = query(
    '[data-stream-placeholder] small',
    root
  );

  if (
    placeholder &&
    !query('[data-view]', root)?.classList.contains('stream-ready')
  ) {
    placeholder.textContent = message;
  }

  const streamMessage = query('[data-stream-message]', root);

  if (streamMessage) {
    streamMessage.textContent = message;
  }
}

function setCameraStatus(
  root,
  status,
  fps,
  frameCount,
  frameAge,
  lastError
) {
  if (!root) return;

  const normalized = String(status || 'unknown').toLowerCase();

  const hasFrames =
    Number.isFinite(frameCount) && frameCount > 0;

  const live =
    normalized === 'live' &&
    hasFrames &&
    (frameAge == null || frameAge < 10);

  const label = live ? 'LIVE' : normalized.toUpperCase();

  const pill = query('[data-live-pill]', root);

  if (pill) {
    pill.className =
      `osd-pill ${live ? 'camera-live' : 'camera-not-live'}`;

    pill.innerHTML = `<i class="dot"></i>${label}`;
  }

  const statusEl = query('[data-camera-status]', root);

  if (statusEl) {
    statusEl.textContent = label;

    statusEl.className = live
      ? 't-green'
      : normalized === 'error'
        ? 't-red'
        : 'subtle';
  }

  const fpsEl = query('[data-camera-fps]', root);

  if (fpsEl) {
    fpsEl.textContent =
      Number.isFinite(fps) && fps > 0
        ? `${fps.toFixed(1)} FPS`
        : '—';
  }

  const framesEl = query('[data-camera-frames]', root);

  if (framesEl) {
    framesEl.textContent =
      Number.isFinite(frameCount)
        ? frameCount.toLocaleString()
        : '—';
  }

  const restart = query('[data-act="restart"]', root);

  if (restart) {
    restart.disabled = false;
  }

  if (live) {
    // The MJPEG image load event owns the live-preview message.
  } else if (lastError) {
    setMessage(root, lastError);
  } else if (
    normalized === 'connecting' ||
    normalized === 'reconnecting'
  ) {
    setMessage(
      root,
      'Connecting to the RTSP camera and waiting for the first decoded frame…'
    );
  } else if (normalized === 'error') {
    setMessage(
      root,
      'Camera error. Check the backend log and RTSP connection.'
    );
  } else if (!hasFrames) {
    setMessage(
      root,
      'Backend is reachable, but no camera frame has arrived yet.'
    );
  }
}

function stopLiveStream() {
  const video = query('[data-stream-video]');

  if (video) {
    video.onloadedmetadata = null;
    video.onclick = null;

    if (video._crusherPlayHandler) {
      const view = query('[data-view]');
      view?.removeEventListener('click', video._crusherPlayHandler);
      delete video._crusherPlayHandler;
    }

    video.pause();
    video.srcObject = null;
  }

  const image = query('[data-stream-image]');

  if (image) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
  }

  const pc = window._crusherCameraPeer;

  if (pc) {
    // Remove callbacks before closing so an old peer cannot trigger fallback
    // after the user has navigated away or started a newer connection.
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;

    try {
      pc.close();
    } catch (error) {
      console.debug('Error closing previous WebRTC peer:', error);
    }

    if (window._crusherCameraPeer === pc) {
      window._crusherCameraPeer = null;
    }

    if (window.cameraPeerConnection === pc) {
      window.cameraPeerConnection = null;
    }
  }
}

function scheduleStreamRetry(root, generation) {
  clearTimeout(retryTimer);

  retryTimer = setTimeout(() => {
    if (
      activeRoot !== root ||
      generation !== streamGeneration
    ) {
      return;
    }

    attachStream(root);
  }, retryDelay);

  retryDelay = Math.min(
    Math.round(retryDelay * 1.5),
    15000
  );
}

/**
 * Prefer WebRTC for low-latency video. If ICE negotiation or media fails,
 * fall back to the existing MJPEG endpoint so local and remote dashboards
 * remain usable even when UDP/TURN connectivity is unavailable.
 */
function attachStream(root) {
  // Prevent duplicate RTCPeerConnections when the router/render lifecycle,
  // reconnect button, or retry timer invokes this more than once.
  if (streamAttempt && streamAttemptRoot === root) {
    console.info(
      '[Camera] Stream initialization already in progress; reusing it.'
    );

    return streamAttempt;
  }

  const currentPeer = window._crusherCameraPeer;

  if (
    currentPeer &&
    !['closed', 'failed'].includes(currentPeer.connectionState)
  ) {
    console.info(
      '[Camera] Existing WebRTC peer is active; skipping duplicate initialization.'
    );

    return Promise.resolve();
  }

  clearTimeout(retryTimer);

  const generation = ++streamGeneration;
  streamAttemptRoot = root;

  streamAttempt = connectStream(root, generation).finally(() => {
    if (streamAttemptRoot === root) {
      streamAttempt = null;
      streamAttemptRoot = null;
    }
  });

  return streamAttempt;
}

async function connectStream(root, generation) {
  const video = query('[data-stream-video]', root);
  const image = query('[data-stream-image]', root);

  if (!video || !image) {
    throw new Error('Video elements are missing from camera view');
  }

  // Set these as DOM properties as well as HTML attributes. Firefox is more
  // likely to permit autoplay when the receiving video is explicitly muted.
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;

  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');

  setMessage(root, 'Loading WebRTC configuration…');

  let pc = null;

  try {
    const cfg = await requestJSON('/api/webrtc/config');

    if (activeRoot !== root || generation !== streamGeneration) {
      return;
    }

    pc = new RTCPeerConnection({
      iceServers: Array.isArray(cfg.iceServers)
        ? cfg.iceServers
        : [],

      iceTransportPolicy: cfg.iceTransportPolicy || 'all',
      bundlePolicy: 'max-bundle',
    });

    window._crusherCameraPeer = pc;
    // Alias used by browser-console diagnostics.
    window.cameraPeerConnection = pc;

    // Log state transitions before negotiation begins, so ICE failures are
    // visible in Firefox even if negotiation later falls back to MJPEG.
    pc.addEventListener('icegatheringstatechange', () => {
      console.info(
        '[Camera WebRTC] ICE gathering:',
        pc.iceGatheringState
      );
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      console.info(
        '[Camera WebRTC] ICE connection:',
        pc.iceConnectionState
      );
    });

    pc.addEventListener('connectionstatechange', () => {
      console.info(
        '[Camera WebRTC] Peer connection:',
        pc.connectionState
      );

      if (
        ['failed', 'disconnected'].includes(pc.connectionState) &&
        activeRoot === root &&
        generation === streamGeneration
      ) {
        fallbackToMjpeg(
          root,
          generation,
          `WebRTC ${pc.connectionState}`
        );
      }
    });

    pc.addTransceiver('video', {
      direction: 'recvonly',
    });

    pc.addEventListener('track', async (event) => {
      if (
        activeRoot !== root ||
        generation !== streamGeneration
      ) {
        return;
      }

      const stream =
        event.streams?.[0] ||
        new MediaStream([event.track]);

      video.srcObject = stream;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.hidden = false;

      image.hidden = true;

      query('[data-view]', root)?.classList.add('stream-ready');

      setMessage(
        root,
        'WebRTC media received; starting playback…'
      );

      try {
        await video.play();

        if (
          activeRoot === root &&
          generation === streamGeneration
        ) {
          setMessage(
            root,
            'Live preview connected through WebRTC.'
          );

          retryDelay = 2000;
        }
      } catch (error) {
        // Keep the received stream attached. A user click can start playback;
        // do not unnecessarily switch to MJPEG just because autoplay was denied.
        console.info(
          '[Camera WebRTC] Browser requires a user gesture for playback:',
          error.message
        );

        setMessage(
          root,
          'WebRTC connected. Click the video to start playback.'
        );
      }
    });

    // A click/tap is a user gesture and can unlock playback if Firefox blocks
    // autoplay despite the muted setting.
    const playOnUserGesture = () => {
      if (video.srcObject && video.paused) {
        video.play().catch((error) => {
          console.warn(
            '[Camera WebRTC] Playback still blocked:',
            error
          );
        });
      }
    };

    video.onclick = playOnUserGesture;

    const view = query('[data-view]', root);

    if (view) {
      video._crusherPlayHandler = playOnUserGesture;

      view.addEventListener(
        'click',
        playOnUserGesture
      );
    }

    setMessage(root, 'Creating WebRTC offer…');

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    await waitForIceGathering(pc, 10000);

    if (
      activeRoot !== root ||
      generation !== streamGeneration
    ) {
      pc.close();
      return;
    }

    if (!pc.localDescription?.sdp) {
      throw new Error(
        'Browser did not produce a local SDP offer'
      );
    }

    setMessage(root, 'Sending WebRTC offer to backend…');

    const response = await fetch(
      apiUrl('/api/webrtc/offer'),
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sdp: pc.localDescription.sdp,
          type: pc.localDescription.type,
        }),
      }
    );

    const answer = await response.json().catch(() => ({}));

    if (
      !response.ok ||
      !answer.sdp ||
      answer.type !== 'answer'
    ) {
      throw new Error(
        answer.error ||
        `WebRTC offer failed (HTTP ${response.status})`
      );
    }

    await pc.setRemoteDescription(answer);

    setMessage(
      root,
      'WebRTC answer received; establishing media connection…'
    );

    await waitForPeerConnection(pc, 15000);

    if (
      activeRoot !== root ||
      generation !== streamGeneration
    ) {
      pc.close();
      return;
    }

    // ontrack normally switches the elements. Keep this as a defensive state
    // update, but do not claim playback until a track is actually received.
    video.hidden = false;
    image.hidden = true;

    console.info('[Camera WebRTC] Connected successfully.');

    retryDelay = 2000;

  } catch (error) {
    console.warn(
      '[Camera WebRTC] Connection failed; using MJPEG fallback:',
      error
    );

    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;

      try {
        pc.close();
      } catch {}

      if (window._crusherCameraPeer === pc) {
        window._crusherCameraPeer = null;
      }

      if (window.cameraPeerConnection === pc) {
        window.cameraPeerConnection = null;
      }
    }

    if (
      activeRoot === root &&
      generation === streamGeneration
    ) {
      fallbackToMjpeg(
        root,
        generation,
        error.message
      );
    }
  }
}

function waitForIceGathering(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;

      done = true;

      clearTimeout(timer);

      pc.removeEventListener(
        'icegatheringstatechange',
        check
      );

      resolve();
    };

    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        finish();
      }
    };

    const timer = setTimeout(finish, timeoutMs);

    pc.addEventListener(
      'icegatheringstatechange',
      check
    );
  });
}

function waitForPeerConnection(pc, timeoutMs) {
  if (pc.connectionState === 'connected') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => done(
        new Error('WebRTC connection timed out')
      ),
      timeoutMs
    );

    const check = () => {
      if (pc.connectionState === 'connected') {
        done();
      } else if (
        ['failed', 'closed'].includes(pc.connectionState)
      ) {
        done(
          new Error(
            `WebRTC ${pc.connectionState}`
          )
        );
      }
    };

    const done = (error) => {
      clearTimeout(timer);

      pc.removeEventListener(
        'connectionstatechange',
        check
      );

      error ? reject(error) : resolve();
    };

    pc.addEventListener(
      'connectionstatechange',
      check
    );

    check();
  });
}

function fallbackToMjpeg(root, generation, reason) {
  if (
    activeRoot !== root ||
    generation !== streamGeneration
  ) {
    return;
  }

  const imageAlreadyStreaming =
    query('[data-stream-image]', root);

  if (
    imageAlreadyStreaming &&
    !imageAlreadyStreaming.hidden &&
    imageAlreadyStreaming.src.includes('/stream/mjpeg')
  ) {
    return;
  }

  const video = query('[data-stream-video]', root);
  const image = query('[data-stream-image]', root);

  if (video) {
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    video.onclick = null;
  }

  if (window._crusherCameraPeer) {
    try {
      window._crusherCameraPeer.close();
    } catch {}

    window._crusherCameraPeer = null;
    window.cameraPeerConnection = null;
  }

  if (!image) return;

  setMessage(
    root,
    `Using MJPEG fallback (${reason || 'WebRTC unavailable'}).`
  );

  image.hidden = false;

  image.onload = () => {
    if (
      activeRoot !== root ||
      generation !== streamGeneration
    ) {
      return;
    }

    query('[data-view]', root)?.classList.add('stream-ready');

    setMessage(
      root,
      'Live preview connected through MJPEG fallback.'
    );

    retryDelay = 2000;
  };

  image.onerror = () => {
    if (
      activeRoot !== root ||
      generation !== streamGeneration
    ) {
      return;
    }

    query('[data-view]', root)?.classList.remove('stream-ready');

    setMessage(
      root,
      'WebRTC and MJPEG unavailable. Retrying…'
    );

    clearTimeout(retryTimer);

    retryTimer = setTimeout(
      () => attachStream(root),
      retryDelay
    );

    retryDelay = Math.min(
      Math.round(retryDelay * 1.5),
      15000
    );
  };

  image.src =
    `${apiUrl('/stream/mjpeg')}?t=${Date.now()}`;
}

async function refreshStatus(root) {
  try {
    const state = await requestJSON(
      '/api/camera/status'
    );

    setCameraStatus(
      root,
      state.cam_status,
      Number(state.capture_fps ?? state.camera_fps),
      Number(state.live_frame_count ?? state.frame_count),

      (state.live_frame_age_s ?? state.frame_age_s) == null
        ? null
        : Number(
            state.live_frame_age_s ?? state.frame_age_s
          ),

      state.last_error
    );

  } catch (error) {
    setCameraStatus(
      root,
      'backend unavailable',
      NaN,
      NaN,
      null,
      error.message
    );
  }
}

async function takeSnapshot(root) {
  let objectUrl = null;

  try {
    const response = await fetch(
      apiUrl('/api/snapshot'),
      {
        cache: 'no-store',
        headers: {
          Accept: 'image/jpeg',
        },
      }
    );

    if (!response.ok) {
      let message =
        `Snapshot failed (HTTP ${response.status})`;

      try {
        const body = await response.json();
        message = body.error || message;
      } catch {
        // The successful response is binary JPEG, not JSON.
      }

      throw new Error(message);
    }

    const blob = await response.blob();

    if (
      !blob.size ||
      !blob.type.includes('image/jpeg')
    ) {
      throw new Error(
        'The backend did not return a valid JPEG frame.'
      );
    }

    objectUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = objectUrl;

    link.download =
      `crusher-camera-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.jpg`;

    document.body.appendChild(link);

    link.click();

    link.remove();

    toast('Snapshot saved', 'success');

  } catch (error) {
    toast(
      error.message || 'Unable to capture snapshot',
      'warning'
    );

  } finally {
    if (objectUrl) {
      setTimeout(
        () => URL.revokeObjectURL(objectUrl),
        1000
      );
    }
  }
}

async function restartCamera(root) {
  const button = query(
    '[data-act="restart"]',
    root
  );

  if (button) {
    button.disabled = true;
  }

  try {
    await requestJSON(
      '/api/camera/restart',
      {
        method: 'POST',
      }
    );

    toast(
      'Camera restart requested',
      'success'
    );

    query('[data-view]', root)?.classList.remove(
      'stream-ready'
    );

    setMessage(
      root,
      'Camera restarting. Waiting for the first frame…'
    );

    setCameraStatus(
      root,
      'connecting',
      NaN,
      0,
      null,
      null
    );

    streamGeneration += 1;

    streamAttempt = null;
    streamAttemptRoot = null;

    stopLiveStream();

    clearTimeout(retryTimer);

    retryTimer = setTimeout(() => {
      if (activeRoot === root) {
        attachStream(root);
      }
    }, 1500);

    setTimeout(() => {
      if (activeRoot === root) {
        refreshStatus(root);
      }
    }, 2000);

  } catch (error) {
    toast(
      error.message || 'Camera restart failed',
      'warning'
    );

  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function updateAI(root, state) {
  if (!state) return;

  const ai = state.feeder?.aiState;
  const confidence = state.feeder?.confidence;

  const labels = {
    FULL: 'Jaw filled',
    PARTIAL: 'Jaw partially filled',
    EMPTY: 'Jaw empty',
  };

  const stateEl = query(
    '[data-ai-state]',
    root
  );

  const confidenceEl = query(
    '[data-ai-confidence]',
    root
  );

  const overlay = query(
    '[data-osd-ai]',
    root
  );

  if (stateEl) {
    stateEl.textContent =
      labels[ai] || 'Waiting for detection';
  }

  if (confidenceEl) {
    confidenceEl.textContent =
      Number.isFinite(confidence)
        ? `${confidence}%`
        : '—';
  }

  if (overlay) {
    const text = ai
      ? `AI: ${labels[ai] || ai} · ${Number(confidence) || 0}%`
      : '';

    setHTML(
      overlay,
      text
        ? `<span class="osd-pill">${text}</span>`
        : ''
    );
  }
}

export default {
  id: 'camera',

  head: () => ({
    title: 'Live Camera',
    subtitle: 'Crusher feeder monitoring',
  }),

  render(root) {
    clearInterval(clockTimer);
    clearInterval(statusTimer);
    clearTimeout(retryTimer);

    stopLiveStream();

    streamGeneration += 1;

    streamAttempt = null;
    streamAttemptRoot = null;

    activeRoot = root;

    root.innerHTML = `
      <div class="two-col">

        <div class="stack-y">

          <!-- LIVE CAMERA PLAYER -->

          <div class="cam-view" data-view>

            <video
              data-stream-video
              autoplay
              playsinline
              muted
              hidden
            ></video>

            <img
              data-stream-image
              alt="Live crusher feeder camera (MJPEG fallback)"
              decoding="async"
              fetchpriority="high"
              hidden
            />

            <div
              class="cam-stream-placeholder"
              data-stream-placeholder
            >
              <span class="camera-spinner"></span>

              <strong>
                Connecting to crusher camera…
              </strong>

              <small>
                Negotiating low-latency WebRTC video
              </small>
            </div>

            <div class="cam-osd-tl">
              <span
                class="osd-pill camera-not-live"
                data-live-pill
              >
                <i class="dot"></i>CONNECTING
              </span>
            </div>

            <div
              class="cam-osd-tr"
              data-osd-time
            ></div>

            <div class="cam-osd-bl">
              <strong>
                ${CAMERA_LOCATION} — ${CAMERA_NAME}
              </strong>

              <span>
                RTSP via backend · WebRTC preferred, MJPEG fallback
              </span>
            </div>

            <div
              class="cam-osd-br"
              data-osd-ai
            ></div>

          </div>

          <!-- CAMERA CONTROLS -->

          <div class="cam-actions">

            <button
              class="cam-action"
              data-act="snapshot"
            >
              ${icon('snapshot', { size: 22 })}
              Snapshot
            </button>

            <button
              class="cam-action"
              data-act="restart"
            >
              ${icon('refresh', { size: 22 })}
              Reconnect
            </button>

            <button
              class="cam-action"
              data-act="fullscreen"
            >
              ${icon('fullscreen', { size: 22 })}
              Fullscreen
            </button>

          </div>

        </div>

        <!-- CAMERA INFORMATION -->

        <div class="stack-y">

          <section class="card">

            <div class="card-head">
              <div class="card-title">
                ${icon('camera', { size: 16 })}
                Camera status
              </div>
            </div>

            <div class="kv">
              <span>Camera</span>
              <strong>${CAMERA_NAME}</strong>
            </div>

            <div class="kv">
              <span>Location</span>
              <strong>${CAMERA_LOCATION}</strong>
            </div>

            <div class="kv">
              <span>Connection</span>
              <strong
                data-camera-status
                class="subtle"
              >
                CONNECTING
              </strong>
            </div>

            <div class="kv">
              <span>Frame rate</span>
              <strong data-camera-fps>—</strong>
            </div>

            <div class="kv">
              <span>Frames processed</span>
              <strong data-camera-frames>—</strong>
            </div>

            <div class="kv">
              <span>AI state</span>
              <strong data-ai-state>
                Waiting for detection
              </strong>
            </div>

            <div class="kv">
              <span>Confidence</span>
              <strong data-ai-confidence>—</strong>
            </div>

            <p
              class="subtle"
              data-camera-message
              style="font-size:12px;margin-top:10px"
            >
              Stream transport: WebRTC preferred · MJPEG fallback
            </p>

          </section>

          <!-- CONNECTION INFORMATION -->

          <section class="card camera-connection-card">

            <div class="card-head">
              <div class="card-title">
                ${icon('activity', { size: 16 })}
                Stream connection
              </div>
            </div>

            <p
              class="subtle"
              data-stream-message
            >
              Connecting to the live camera stream…
            </p>

            <small class="subtle">
              RTSP is received by the backend and delivered
              through WebRTC when available, with MJPEG fallback.
              YOLO inference runs separately.
              Camera credentials remain server-side.
            </small>

          </section>

        </div>

      </div>

      <style>

        .cam-view {
          position: relative;
          overflow: hidden;
          background: #05080d;
          min-height: 360px;
          aspect-ratio: 16 / 9;
          width: 100%;
          border-radius: 12px;
        }

        .cam-view [data-stream-image],
        .cam-view [data-stream-video] {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 360px;
          object-fit: contain;
          background: #05080d;
        }

        .cam-view [hidden] {
          display: none !important;
        }

        .cam-view [data-stream-video] {
          cursor: pointer;
        }

        .camera-connection-card {
          min-width: 0;
        }

        .cam-stream-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 9px;
          color: #dbe4f0;
          background: #080d16;
          text-align: center;
          padding: 20px;
          pointer-events: none;
        }

        .cam-stream-placeholder small {
          color: #94a3b8;
        }

        .cam-view.stream-ready
        .cam-stream-placeholder {
          display: none;
        }

        .camera-spinner {
          width: 28px;
          height: 28px;
          border: 3px solid #475569;
          border-top-color: #38bdf8;
          border-radius: 50%;
          animation: camera-spin .8s linear infinite;
        }

        @keyframes camera-spin {
          to {
            transform: rotate(360deg);
          }
        }

        .camera-live {
          background: rgba(22, 163, 74, .9);
        }

        .camera-not-live {
          background: rgba(71, 85, 105, .9);
        }

        .cam-view:fullscreen {
          width: 100vw;
          height: 100vh;
          max-height: none;
          aspect-ratio: auto;
          border-radius: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .cam-view:fullscreen
        [data-stream-image] {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

      </style>
    `;

    // CAMERA BUTTON EVENTS

    root.querySelectorAll('[data-act]').forEach((button) => {

      button.addEventListener('click', () => {

        const action = button.dataset.act;

        if (action === 'snapshot') {
          takeSnapshot(root);
        }

        if (action === 'restart') {
          restartCamera(root);
        }

        if (action === 'fullscreen') {

          const view = query('[data-view]', root);

          if (document.fullscreenElement) {
            document.exitFullscreen?.();
          } else {
            view?.requestFullscreen?.().catch(() =>
              toast(
                'Fullscreen is not available',
                'warning'
              )
            );
          }

        }

      });

    });

    // LIVE CLOCK

    const tick = () => {
      const now = new Date();

      setHTML(
        query('[data-osd-time]', root),
        `${fmtDate(now)} ${fmtTimeSec(now)}`
      );
    };

    tick();

    clockTimer = setInterval(tick, 1000);

    // Prefer WebRTC; automatically fall back to independent MJPEG preview

    attachStream(root);

    // REFRESH CAMERA STATUS

    refreshStatus(root);

    statusTimer = setInterval(() => {
      if (activeRoot === root) {
        refreshStatus(root);
      }
    }, 2000);
  },

  update(st = this._st, path) {
    if (st) {
      this._st = st;
    }

    st = this._st;

    if (
      !activeRoot ||
      !st ||
      (path && path !== 'live' && path !== '*')
    ) {
      return;
    }

    updateAI(activeRoot, st);
  },

  destroy() {
    clearInterval(clockTimer);
    clearInterval(statusTimer);
    clearTimeout(retryTimer);

    clockTimer = null;
    statusTimer = null;
    retryTimer = null;

    streamGeneration += 1;

    streamAttempt = null;
    streamAttemptRoot = null;

    stopLiveStream();

    activeRoot = null;
  },
};