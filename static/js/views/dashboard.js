
/** Dashboard — immediate overview of crusher, feeder AI state and VFD. */

import { settings } from '../core/settings.js';
import { DataService } from '../services/dataService.js';
import { icon } from '../ui/icons.js';
import { $, toneChip } from '../ui/components.js';
import {
  setHTML, vfdCardHTML, crusherCardHTML, feederCardHTML, alertRowHTML, feederTone,
} from '../ui/widgets.js';
import { CRUSHER_STATES, FEEDER_STATES } from '../config.js';
import { fmtDuration, fmtDate, fmtTimeSec, toISODate, relTime } from '../core/format.js';

let todayTimer = null;
let clockTimer = null;

let cameraStatusTimer = null;
let cameraRetryTimer = null;
let dashboardRoot = null;
let cameraGeneration = 0;
let cameraRetryDelay = 2000;

const API_BASE = (window.CRUSHER_API_BASE || '').replace(/\/$/, '');
const apiUrl = (path) => `${API_BASE}${path}`;

async function requestCameraJSON(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    ...options,
    headers: { ...(options.headers || {}) },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Backend returned HTTP ${response.status}`);
  }

  return body;
}

function cameraElement(selector, root = dashboardRoot) {
  return root ? $(selector, root) : null;
}

function setCameraMessage(message) {
  const el = cameraElement('[data-dashboard-camera-message]');
  if (el) el.textContent = message;
}

function setDashboardCameraStatus(state = {}) {
  const status = String(state.cam_status || 'unknown').toLowerCase();
  const frameCount = Number(state.frame_count);
  const frameAge = state.frame_age_s == null ? null : Number(state.frame_age_s);
  const fps = Number(state.camera_fps);

  const hasFrames = Number.isFinite(frameCount) && frameCount > 0;

  const live = status === 'live' &&
    hasFrames &&
    (frameAge == null || frameAge < 10);

  const pill = cameraElement('[data-dashboard-camera-pill]');

  if (pill) {
    pill.className = `chip ${
      live ? 'chip-green' :
      status === 'error' ? 'chip-red' : 'chip-gray'
    }`;

    pill.innerHTML = `<i class="dot"></i>${live ? 'LIVE' : status.toUpperCase()}`;
  }

  const fpsEl = cameraElement('[data-dashboard-camera-fps]');

  if (fpsEl) {
    fpsEl.textContent = Number.isFinite(fps) && fps > 0
      ? `${fps.toFixed(1)} FPS`
      : '—';
  }

  const framesEl = cameraElement('[data-dashboard-camera-frames]');

  if (framesEl) {
    framesEl.textContent = Number.isFinite(frameCount)
      ? frameCount.toLocaleString()
      : '—';
  }

  if (live) {
    setCameraMessage('Receiving live frames from /stream/mjpeg');
  } else if (state.last_error) {
    setCameraMessage(state.last_error);
  } else if (status === 'connecting' || status === 'reconnecting') {
    setCameraMessage('Connecting to camera and waiting for the first frame…');
  } else if (status === 'error') {
    setCameraMessage('Camera error. Check the backend RTSP connection.');
  } else if (!hasFrames) {
    setCameraMessage('Backend is reachable, but no camera frame has arrived yet.');
  }
}

function scheduleCameraRetry(root, generation) {
  clearTimeout(cameraRetryTimer);

  cameraRetryTimer = setTimeout(() => {
    if (dashboardRoot !== root || generation !== cameraGeneration) return;

    attachDashboardCamera(root);
  }, cameraRetryDelay);

  cameraRetryDelay = Math.min(
    Math.round(cameraRetryDelay * 1.5),
    15000
  );
}

function attachDashboardCamera(root) {
  const image = cameraElement('[data-dashboard-camera-image]', root);

  if (!image) return;

  clearTimeout(cameraRetryTimer);

  const generation = ++cameraGeneration;

  image.onload = () => {
    if (dashboardRoot !== root || generation !== cameraGeneration) return;

    cameraElement('[data-dashboard-camera-view]', root)
      ?.classList.add('stream-ready');

    cameraRetryDelay = 2000;
  };

  image.onerror = () => {
    if (dashboardRoot !== root || generation !== cameraGeneration) return;

    cameraElement('[data-dashboard-camera-view]', root)
      ?.classList.remove('stream-ready');

    setCameraMessage('MJPEG connection interrupted. Reconnecting…');

    scheduleCameraRetry(root, generation);
  };

  image.src = `${apiUrl('/stream/mjpeg')}?_=${Date.now()}`;
}

async function refreshDashboardCameraStatus(root) {
  try {
    const state = await requestCameraJSON('/api/camera/status');

    if (dashboardRoot === root) {
      setDashboardCameraStatus(state);
    }
  } catch (error) {
    console.error('Dashboard camera status error:', error);

    if (dashboardRoot === root) {
      setDashboardCameraStatus({
        cam_status: 'backend unavailable',
        last_error: error.message,
      });
    }
  }
}

async function loadToday(root) {
  try {
    const today = toISODate(new Date());

    const a = await DataService.getAnalytics({
      from: today,
      to: today,
      label: 'Today'
    });

    const el = $('[data-today]', root);

    if (!el) return;

    setHTML(el, `
      <div class="grid-4">
        <div class="metric">
          <div class="eyebrow">${icon('clock', { size: 14 })}Runtime</div>
          <div class="metric-val">${fmtDuration(a.runtimeSec)}</div>
          <div class="metric-sub">Crusher running</div>
        </div>

        <div class="metric">
          <div class="eyebrow">${icon('power', { size: 14 })}Downtime</div>
          <div class="metric-val">${fmtDuration(a.downtimeSec)}</div>
          <div class="metric-sub">${a.stopEvents.length} stop${a.stopEvents.length === 1 ? '' : 's'}</div>
        </div>

        <div class="metric">
          <div class="eyebrow">${icon('truck', { size: 14 })}Production</div>
          <div class="metric-val">${Math.round(a.outputT)}<small>t</small></div>
          <div class="metric-sub">${a.avgTph.toFixed(0)} t/h average</div>
        </div>

        <div class="metric">
          <div class="eyebrow">${icon('gauge', { size: 14 })}OEE</div>
          <div class="metric-val">${a.oee.overall.toFixed(1)}<small>%</small></div>
          <div class="metric-sub">
            A ${a.oee.availability.toFixed(0)} ·
            P ${a.oee.performance.toFixed(0)} ·
            Q ${a.oee.quality.toFixed(0)}
          </div>
        </div>
      </div>
    `);

  } catch (error) {
    console.error('Dashboard analytics error:', error);
  }
}

export default {
  id: 'dashboard',

  head: () => ({
    brand: true,
    title: 'Dashboard'
  }),

  render(root) {
    clearInterval(todayTimer);
    clearInterval(clockTimer);
    clearInterval(cameraStatusTimer);
    clearTimeout(cameraRetryTimer);

    cameraGeneration += 1;

    dashboardRoot = root;
    cameraRetryDelay = 2000;

    root.innerHTML = `
      <div class="status-strip">
        <span data-sys></span>

        ${DataService.source === 'mock'
          ? toneChip('gray', 'Demo data', { dot: false })
          : ''}

        <span class="time">
          <span data-date></span> ·
          <span data-clock class="mono"></span>
        </span>
      </div>

      <div class="dash-grid stack-y">

        <div class="grid-2 keep d-6 t-full l-half">
          <a class="card status-card"
             data-crusher
             href="#/machine"
             style="color:inherit;text-decoration:none">
          </a>

          <a class="card status-card"
             data-feeder
             href="#/camera"
             style="color:inherit;text-decoration:none">
          </a>
        </div>

        <section class="card d-6 t-full l-half" aria-label="VFD">
          <div class="card-head">
            <div class="card-title">
              ${icon('pulse', { size: 16 })}
              Feeder VFD
            </div>

            <a class="card-link" href="#/machine">
              Control ${icon('chevron', { size: 16 })}
            </a>
          </div>

          <div data-vfd></div>
        </section>

        <section class="card d-7 t-full l-full" aria-label="Today">
          <div class="card-head">
            <div class="card-title">
              ${icon('calendar', { size: 16 })}
              Today
            </div>

            <a class="card-link" href="#/analytics">
              Reports ${icon('chevron', { size: 16 })}
            </a>
          </div>

          <div data-today>
            <div class="subtle">Loading…</div>
          </div>
        </section>

        <!-- LIVE CAMERA SECTION -->

        <section class="card d-5 l-full" aria-label="AI feeder detection">

          <div class="card-head">

            <div class="card-title">
              ${icon('camera', { size: 16 })}
              AI Feeder Detection
            </div>

            <div style="display:flex;align-items:center;gap:10px">

              <span data-dashboard-camera-pill class="chip chip-gray">
                <i class="dot"></i>CONNECTING
              </span>

              <a class="card-link" href="#/camera">
                Live ${icon('chevron', { size: 16 })}
              </a>

            </div>
          </div>

          <div class="dashboard-camera-layout">

            <div class="dashboard-camera-view"
                 data-dashboard-camera-view>

              <img
                data-dashboard-camera-image
                alt="Live crusher feeder camera"
              />

              <div class="dashboard-camera-placeholder"
                   data-dashboard-camera-placeholder>

                <span class="camera-spinner"></span>

                <strong>Connecting to crusher camera…</strong>

                <small>Waiting for backend MJPEG stream</small>

              </div>

              <div class="dashboard-camera-osd">
                CAMERA 01 · LIVE FEED
              </div>

            </div>

            <div class="dashboard-camera-info">

              <div data-ai>
                <div class="subtle">
                  Waiting for AI detection…
                </div>
              </div>

              <div class="dashboard-camera-meta">

                <span>
                  Frame rate
                  <strong data-dashboard-camera-fps>—</strong>
                </span>

                <span>
                  Frames
                  <strong data-dashboard-camera-frames>—</strong>
                </span>

              </div>

              <p class="subtle"
                 data-dashboard-camera-message
                 style="font-size:11px;margin:8px 0 0">

                Connecting to /stream/mjpeg

              </p>

            </div>

          </div>

        </section>

        <section class="card span-2" aria-label="Recent alerts">

          <div class="card-head">

            <div class="card-title">
              ${icon('bell', { size: 16 })}
              Recent Alerts
            </div>

            <a class="card-link" href="#/alerts">
              View all ${icon('chevron', { size: 16 })}
            </a>

          </div>

          <div data-alerts></div>

        </section>

      </div>

      <style>

        .dashboard-camera-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(150px, 1fr);
          gap: 14px;
          align-items: center;
        }

        .dashboard-camera-view {
          position: relative;
          overflow: hidden;
          min-width: 0;
          aspect-ratio: 16 / 9;
          min-height: 130px;
          border-radius: 9px;
          background: #080d16;
        }

        .dashboard-camera-view [data-dashboard-camera-image] {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 130px;
          object-fit: contain;
          background: #080d16;
        }

        .dashboard-camera-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 12px;
          color: #dbe4f0;
          background: #080d16;
          text-align: center;
          pointer-events: none;
        }

        .dashboard-camera-placeholder small {
          color: #94a3b8;
        }

        .dashboard-camera-view.stream-ready
        .dashboard-camera-placeholder {
          display: none;
        }

        .dashboard-camera-osd {
          position: absolute;
          left: 8px;
          bottom: 8px;
          padding: 4px 7px;
          border-radius: 5px;
          color: #fff;
          background: rgba(0, 0, 0, .58);
          font-size: 9px;
          letter-spacing: .05em;
          pointer-events: none;
        }

        .dashboard-camera-meta {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-top: 12px;
          font-size: 11px;
          color: var(--muted, #94a3b8);
        }

        .dashboard-camera-meta strong {
          margin-left: 5px;
          color: var(--text, inherit);
        }

        .camera-spinner {
          width: 22px;
          height: 22px;
          border: 3px solid #475569;
          border-top-color: #38bdf8;
          border-radius: 50%;
          animation: dashboard-camera-spin .8s linear infinite;
        }

        @keyframes dashboard-camera-spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 700px) {
          .dashboard-camera-layout {
            grid-template-columns: 1fr;
          }

          .dashboard-camera-info {
            min-width: 0;
          }

          .dashboard-camera-meta {
            flex-direction: row;
            flex-wrap: wrap;
          }
        }

      </style>
    `;

    const tick = () => {
      setHTML($('[data-clock]', root), fmtTimeSec(new Date()));
      setHTML($('[data-date]', root), fmtDate(new Date()));
    };

    tick();

    clockTimer = setInterval(tick, 1000);

    loadToday(root);

    todayTimer = setInterval(() => loadToday(root), 60000);

    // Start live camera stream and poll status every 2 seconds.
    attachDashboardCamera(root);

    refreshDashboardCameraStatus(root);

    cameraStatusTimer = setInterval(() => {
      if (dashboardRoot === root) {
        refreshDashboardCameraStatus(root);
      }
    }, 2000);
  },

  update(st, path) {
    const root = dashboardRoot || document.getElementById('view');

    if (!root || !st) return;

    const s = settings.all;

    if (path === 'live' || path === '*' || path === 'trend') {

      const c = CRUSHER_STATES[st.crusher.status];

      const crusherCard = $('[data-crusher]', root);

      if (crusherCard && c) {
        crusherCard.className = `card status-card tone-${c.tone}`;
        setHTML(crusherCard, crusherCardHTML(st));
      }

      const feederCard = $('[data-feeder]', root);

      if (feederCard) {
        feederCard.className =
          `card status-card tone-${feederTone(st.feeder.aiState)}`;

        setHTML(feederCard, feederCardHTML(st));
      }

      setHTML($('[data-vfd]', root), vfdCardHTML(st, s));

      const sysTone = {
        RUNNING: 'green',
        WARNING: 'amber',
        FAULT: 'red',
        STOPPED: 'gray'
      }[st.crusher.status];

      const sysLabel = {
        RUNNING: 'System running',
        WARNING: 'System warning',
        FAULT: 'System fault',
        STOPPED: 'System stopped'
      }[st.crusher.status];

      setHTML(
        $('[data-sys]', root),
        `<span class="chip chip-${sysTone} chip-live">
          <i class="dot"></i>${sysLabel}
        </span>`
      );

      // Update AI information without replacing the live camera image.
      const f = FEEDER_STATES[st.feeder.aiState];

      setHTML($('[data-ai]', root), `
        <div class="eyebrow">AI decision</div>

        <div class="big-value t-${f.tone}"
             style="font-size:22px;margin:4px 0 10px">
          ${f.long}
        </div>

        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
          <span class="muted">Confidence</span>
          <strong>${st.feeder.confidence}%</strong>
        </div>

        <div class="meter">
          <span style="width:${st.feeder.confidence}%"></span>
        </div>

        <div class="subtle" style="font-size:12px;margin-top:8px">
          Detected ${relTime(st.feeder.detectedAt)}
        </div>
      `);
    }

    if (path === 'alerts' || path === '*') {
      const list = st.alerts.slice(0, 4);

      setHTML(
        $('[data-alerts]', root),
        list.length
          ? list.map((a) => alertRowHTML(a, { compact: true })).join('')
          : '<p class="subtle">No alerts.</p>'
      );
    }
  },

  destroy() {
    clearInterval(todayTimer);
    clearInterval(clockTimer);
    clearInterval(cameraStatusTimer);
    clearTimeout(cameraRetryTimer);

    todayTimer = null;
    clockTimer = null;
    cameraStatusTimer = null;
    cameraRetryTimer = null;

    cameraGeneration += 1;

    const image = cameraElement('[data-dashboard-camera-image]');

    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }

    dashboardRoot = null;
  },
};
