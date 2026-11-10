/**
 * Real backend adapter — connects to the FastAPI server on the Raspberry Pi.
 *
 * REST endpoints:
 *   GET  /api/v1/live
 *   GET  /api/v1/vfd/trend?minutes=
 *   GET  /api/v1/alerts?limit=
 *   GET  /api/v1/analytics?from=&to=&label=
 *   POST /api/vfd/set/{rpm}
 *   POST /api/vfd/stop
 *   POST /api/vfd/reset-fault
 *
 * WebSocket:
 *   WS   /ws/camera
 *
 * The Pi WebSocket sends the raw crusher_camera state dictionary.
 * This adapter transforms it into the live-snapshot shape expected by
 * the frontend views.
 *
 * Video is handled independently through WebRTC/MJPEG.
 */

import { APP } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION STATE
// ─────────────────────────────────────────────────────────────────────────

let ws = null;
let handlers = {};

let retry = 0;
let retryTimer = null;
let connectionTimer = null;

let started = false;
let startPromise = null;

// Incremented whenever the service starts/stops.
// Prevents callbacks from an older connection affecting a newer session.
let generation = 0;

const REQUEST_TIMEOUT = 8000;
const WS_CONNECTION_TIMEOUT = 10000;

const MAX_RETRY_DELAY = 30000;
const BASE_RETRY_DELAY = 1000;

// ─────────────────────────────────────────────────────────────────────────
// RPM → Hz CONVERSION
// ─────────────────────────────────────────────────────────────────────────

function rpmToHz(rpm) {
  return parseFloat(((Number(rpm) || 0) * 50 / 1500).toFixed(1));
}

// ─────────────────────────────────────────────────────────────────────────
// PI STATE → FRONTEND SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────

const MACHINE_TO_CRUSHER = {
  NORMAL: 'RUNNING',
  'STONE STUCK': 'WARNING',
  'NO RAW MATERIAL': 'RUNNING',
  STOPPED: 'STOPPED',
  FAULT: 'FAULT',
};

const JAW_TO_AI = {
  'jaw filled': 'FULL',
  'jaw partially filled': 'PARTIAL',
  'jaw empty': 'EMPTY',
};

function piStateToSnap(d = {}) {
  const machineStatus = d.machine_status || 'STOPPED';
  const jawLabel = d.jaw_label || 'unknown';

  const targetRpm = Number(d.target_vfd_rpm) || 0;
  const targetHz = rpmToHz(targetRpm);

  const aiState = JAW_TO_AI[jawLabel] || 'EMPTY';

  let driveStatus = 'Stopped';

  if (machineStatus === 'FAULT') {
    driveStatus = 'Fault';
  } else if (
    machineStatus === 'NORMAL' ||
    machineStatus === 'STONE STUCK' ||
    machineStatus === 'NO RAW MATERIAL'
  ) {
    driveStatus = 'Running';
  }

  return {
    timestamp: new Date().toISOString(),

    connection: {
      source: 'api',
      online: d.cam_status === 'live',
    },

    crusher: {
      status: MACHINE_TO_CRUSHER[machineStatus] || 'STOPPED',
      motorCurrentA: null,
    },

    feeder: {
      aiState,
      confidence: Math.round((Number(d.jaw_conf) || 0) * 100),
      detectedAt: new Date().toISOString(),
      detecting: d.cam_status === 'live',
    },

    vfd: {
      requestedMode: 'AUTO',
      mode: 'AUTO',

      // These are target-derived values, not measured output frequency.
      manualHz: targetHz,
      commandHz: targetHz,
      outputHz: targetHz,
      autoHz: targetHz,

      manualAllowed: aiState === 'EMPTY',
      atMax: targetRpm >= 1290,
      interlock: machineStatus === 'FAULT',
      driveStatus,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP REQUEST HELPER
// ─────────────────────────────────────────────────────────────────────────

async function request(path, opts = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(`${APP.apiBase}${path}`, {
      ...opts,

      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },

      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';

      try {
        const errorBody = await response.json();
        detail = errorBody.detail || errorBody.message || '';
      } catch {
        // Response was not JSON.
      }

      throw new Error(
        `HTTP ${response.status}${detail ? `: ${detail}` : ''}`
      );
    }

    // Handle endpoints that return an empty response.
    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      return await response.text();
    }

    return await response.json();

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${REQUEST_TIMEOUT} ms`);
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION STATUS
// ─────────────────────────────────────────────────────────────────────────

function notifyConnection(online) {
  handlers.onConnection?.({ online });
}

// ─────────────────────────────────────────────────────────────────────────
// TIMER CLEANUP
// ─────────────────────────────────────────────────────────────────────────

function clearConnectionTimer() {
  if (connectionTimer !== null) {
    clearTimeout(connectionTimer);
    connectionTimer = null;
  }
}

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// WEBSOCKET URL
// ─────────────────────────────────────────────────────────────────────────

function getWebSocketUrl() {
  let wsBase;

  if (APP.apiBase) {
    wsBase = APP.apiBase.replace(/^http/, 'ws').replace(/\/$/, '');
  } else {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsBase = `${protocol}//${location.host}`;
  }

  const path = APP.wsPath.startsWith('/')
    ? APP.wsPath
    : `/${APP.wsPath}`;

  return `${wsBase}${path}`;
}

// ─────────────────────────────────────────────────────────────────────────
// REMOVE LARGE IMAGE PAYLOADS FROM TELEMETRY
// ─────────────────────────────────────────────────────────────────────────

function sanitizePiState(data) {
  const {
    frame,
    frame_b64,
    image,
    image_b64,
    jpeg,
    jpeg_b64,
    ...state
  } = data;

  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// WEBSOCKET MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────

function handleMessage(event, socketGeneration) {
  if (socketGeneration !== generation || !started) {
    return;
  }

  let data;

  try {
    data = JSON.parse(event.data);
  } catch (error) {
    console.warn('apiService: Invalid WebSocket JSON:', error);
    return;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return;
  }

  const state = sanitizePiState(data);
  const snapshot = piStateToSnap(state);

  handlers.onLive?.(snapshot, {
    trendSample: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// RECONNECTION
// ─────────────────────────────────────────────────────────────────────────

function scheduleReconnect(socketGeneration) {
  if (!started || socketGeneration !== generation) {
    return;
  }

  clearRetryTimer();

  // Exponential backoff with a maximum delay and random jitter.
  const exponentialDelay = Math.min(
    MAX_RETRY_DELAY,
    BASE_RETRY_DELAY * (2 ** Math.min(retry, 10))
  );

  const jitter = Math.random() * 500;

  const delay = Math.round(exponentialDelay + jitter);

  retry++;

  console.warn(
    `apiService: WebSocket reconnecting in ${delay} ms (attempt ${retry})`
  );

  retryTimer = setTimeout(() => {
    retryTimer = null;

    if (started && socketGeneration === generation) {
      connect(socketGeneration);
    }
  }, delay);
}

// ─────────────────────────────────────────────────────────────────────────
// WEBSOCKET CONNECTION
// ─────────────────────────────────────────────────────────────────────────

function connect(socketGeneration = generation) {
  if (!started || socketGeneration !== generation) {
    return;
  }

  // Prevent duplicate OPEN or CONNECTING sockets.
  if (
    ws &&
    (
      ws.readyState === WebSocket.CONNECTING ||
      ws.readyState === WebSocket.OPEN
    )
  ) {
    return;
  }

  clearRetryTimer();
  clearConnectionTimer();

  let socket;

  try {
    const url = getWebSocketUrl();

    console.info('apiService: Connecting WebSocket:', url);

    socket = new WebSocket(url);
    ws = socket;

  } catch (error) {
    console.error('apiService: WebSocket creation failed:', error);

    notifyConnection(false);
    scheduleReconnect(socketGeneration);

    return;
  }

  // Detect a connection attempt that remains stuck in CONNECTING.
  connectionTimer = setTimeout(() => {
    if (
      socketGeneration !== generation ||
      !started ||
      ws !== socket ||
      socket.readyState !== WebSocket.CONNECTING
    ) {
      return;
    }

    console.warn('apiService: WebSocket connection timeout');

    socket.close();
  }, WS_CONNECTION_TIMEOUT);

  socket.onopen = () => {
    if (socketGeneration !== generation || !started || ws !== socket) {
      socket.close();
      return;
    }

    clearConnectionTimer();

    retry = 0;

    console.info('apiService: WebSocket connected');

    notifyConnection(true);
  };

  socket.onmessage = (event) => {
    handleMessage(event, socketGeneration);
  };

  socket.onerror = (event) => {
    if (socketGeneration !== generation || ws !== socket) {
      return;
    }

    console.warn('apiService: WebSocket error', event);

    notifyConnection(false);
  };

  socket.onclose = (event) => {
    if (socketGeneration !== generation || ws !== socket) {
      return;
    }

    clearConnectionTimer();

    ws = null;

    console.warn(
      `apiService: WebSocket closed (code=${event.code}, reason=${event.reason || 'none'})`
    );

    notifyConnection(false);

    scheduleReconnect(socketGeneration);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// INITIAL REST DATA
// ─────────────────────────────────────────────────────────────────────────

async function loadInitialData(startGeneration) {
  // Initial live snapshot.
  try {
    const live = await request('/api/v1/live');

    if (!started || startGeneration !== generation) {
      return;
    }

    // The REST endpoint may already return the frontend snapshot shape.
    // Preserve it rather than transforming it as a raw WebSocket payload.
    handlers.onLive?.(live, {
      trendSample: false,
    });

  } catch (error) {
    if (started && startGeneration === generation) {
      console.warn(
        'apiService: /api/v1/live failed:',
        error.message
      );

      notifyConnection(false);
    }
  }

  if (!started || startGeneration !== generation) {
    return;
  }

  // VFD trend seed.
  try {
    const trend = await request('/api/v1/vfd/trend?minutes=60');

    if (!started || startGeneration !== generation) {
      return;
    }

    handlers.onTrendSeed?.(
      Array.isArray(trend) ? trend : []
    );

  } catch (error) {
    if (started && startGeneration === generation) {
      console.warn(
        'apiService: /api/v1/vfd/trend failed:',
        error.message
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API SERVICE
// ─────────────────────────────────────────────────────────────────────────

export const apiService = {
  name: 'api',

  async start(newHandlers = {}) {
    handlers = newHandlers;

    // Prevent duplicate startup and duplicate WebSocket connections.
    if (started) {
      console.info('apiService: Already started');
      return startPromise;
    }

    started = true;

    const startGeneration = ++generation;

    retry = 0;

    clearRetryTimer();
    clearConnectionTimer();

    console.info('apiService: Starting backend adapter');

    // Connect immediately instead of waiting for REST requests.
    connect(startGeneration);

    // Load the initial REST data independently.
    startPromise = loadInitialData(startGeneration);

    try {
      await startPromise;
    } finally {
      if (startGeneration === generation) {
        startPromise = null;
      }
    }
  },

  stop() {
    console.info('apiService: Stopping backend adapter');

    started = false;

    // Invalidate callbacks from all previous connections.
    generation++;

    clearRetryTimer();
    clearConnectionTimer();

    const socket = ws;

    ws = null;

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, 'Frontend service stopped');
      }
    }

    notifyConnection(false);

    handlers = {};
    startPromise = null;

    retry = 0;
  },

  // ───────────────────────────────────────────────────────────────────────
  // ALERTS
  // ───────────────────────────────────────────────────────────────────────

  getAlerts() {
    return request('/api/v1/alerts?limit=100');
  },

  // ───────────────────────────────────────────────────────────────────────
  // ANALYTICS
  // ───────────────────────────────────────────────────────────────────────

  getAnalytics({ from, to, label } = {}) {
    const params = new URLSearchParams();

    if (from != null) params.set('from', from);
    if (to != null) params.set('to', to);
    if (label) params.set('label', label);

    return request(`/api/v1/analytics?${params.toString()}`);
  },

  // ───────────────────────────────────────────────────────────────────────
  // VFD CONTROL
  // ───────────────────────────────────────────────────────────────────────

  async setControl(body = {}) {
    try {
      if (body.mode === 'MANUAL' && body.manualHz != null) {
        const rpm = Math.round(
          Number(body.manualHz) * 1500 / 50
        );

        if (!Number.isFinite(rpm) || rpm <= 0) {
          throw new Error('Invalid manual frequency');
        }

        await request(`/api/vfd/set/${rpm}`, {
          method: 'POST',
        });

      } else if (body.mode === 'AUTO') {
        // The Pi background task resumes AI-based control.
        // No explicit command is required.
      } else {
        throw new Error('Unsupported VFD control mode');
      }

      return { ok: true };

    } catch (error) {
      console.error('apiService: VFD command failed:', error);

      return {
        ok: false,
        error: `Command not accepted: ${error.message}`,
      };
    }
  },

  // ───────────────────────────────────────────────────────────────────────
  // VFD STOP
  // ───────────────────────────────────────────────────────────────────────

  async stopVfd() {
    try {
      await request('/api/vfd/stop', {
        method: 'POST',
      });

      return { ok: true };

    } catch (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  },

  // ───────────────────────────────────────────────────────────────────────
  // VFD FAULT RESET
  // ───────────────────────────────────────────────────────────────────────

  async resetVfdFault() {
    try {
      await request('/api/vfd/reset-fault', {
        method: 'POST',
      });

      return { ok: true };

    } catch (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  },

  refresh() {
    if (!started) {
      return;
    }

    // Re-establish the socket if it is not connected.
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connect(generation);
    }
  },

  demo: null,
};