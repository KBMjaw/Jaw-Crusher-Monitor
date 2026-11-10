# Backend contract (FastAPI on Raspberry Pi 5)

The PWA consumes these endpoints when `APP.dataSource = 'api'`. Shapes match the mock layer
(`js/services/mockService.js`, `js/services/mockData.js`).

```
Hikvision camera ─RTSP→ Raspberry Pi 5 (YOLO) → feeder state → FastAPI ─REST/WebSocket→ PWA
FastAPI → VFD controller ─RS485 / Modbus RTU→ ABB ACS580
```

## GET /api/v1/live
```json
{
  "timestamp": "2026-10-08T10:42:00Z",
  "connection": { "source": "api", "online": true },
  "crusher": { "status": "RUNNING|STOPPED|WARNING|FAULT", "motorCurrentA": 68.2 },
  "feeder":  { "aiState": "EMPTY|PARTIAL|FULL", "confidence": 92, "detectedAt": "…", "detecting": true },
  "vfd": {
    "requestedMode": "AUTO|MANUAL", "mode": "AUTO|MANUAL",
    "manualHz": 47, "commandHz": 47, "outputHz": 46.8, "autoHz": 43,
    "manualAllowed": true, "atMax": false, "interlock": false, "driveStatus": "Running"
  }
}
```

## WebSocket /ws/live
Messages: `{ "type": "live", "data": <same as /live> }` and `{ "type": "alert", "data": <alert> }`.

## GET /api/v1/vfd/trend?minutes=10
`[{ "t": 1696760000000, "hz": 43.0 }, …]`

## POST /api/v1/feeder/control
Body: `{ "mode": "AUTO" | "MANUAL", "manualHz": 47 }` (either field optional).
Must reject MANUAL unless the current AI state is EMPTY, and reject `manualHz` outside the
configured manual range. Returns 200 on success, 409/422 with `{ "detail": "…" }` otherwise.

## GET /api/v1/alerts?limit=100
`[{ "id", "severity": "fault|warning|info|normal", "type", "title", "description", "time", "read", "source" }]`

## GET /api/v1/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&label=…
See the object returned by `mockAnalytics()` in `js/services/mockData.js`
(runtime/downtime, `states`, `detections`, `vfd` {avgHz,minHz,maxHz,trend,manualPeriods},
`stopEvents`, `alerts`, `oee`, `days`).

## Settings (future)
`GET/PUT /api/v1/settings` — frequencies (full/partial/empty, manual min/max), company, plant, support.

## Push
`POST /api/v1/push/subscribe` — body is the browser `PushSubscription` JSON.

## Audit (authoritative on the server)
```
User → PWA → FastAPI → Authentication → Audit Service → Database
```
- `POST /api/v1/audit` — body `{ "action", "details", "prev", "next" }`. The server adds
  `username`, `role`, `sessionId`, client `ip` (from the request / proxy header) and `ts`.
  Security-relevant actions (login, logout, control changes, setting changes) should be written by
  the backend itself when it handles those requests, not trusted from the client.
- `GET /api/v1/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&user=&role=&action=&ip=&limit=`
  → `[{ "id", "ts", "username", "role", "ip", "sessionId", "action", "details", "prev", "next" }]`

Action keys: `LOGIN, LOGIN_FAILED, LOGOUT, MANUAL_OVERRIDE_ENABLED, MANUAL_OVERRIDE_DISABLED,
EMPTY_SPEED_CHANGED, FREQUENCY_SETTING_CHANGED, MANUAL_RANGE_CHANGED, PIN_VERIFIED, PIN_FAILED,
PROFILE_UPDATED, PROFILE_PHOTO_CHANGED, PASSWORD_CHANGED, COMPANY_DETAILS_UPDATED,
COMPANY_LOGO_CHANGED, NOTIFICATION_SETTING_CHANGED, SETTINGS_CHANGED`.

## Settings PIN
`POST /api/v1/settings/verify-pin` `{ "pin": "…" }` → `{ "ok": true, "token": "…" }` (short-lived
token required by `PUT /api/v1/settings` for Empty frequency / manual range changes). Rate-limit and
audit failures server-side.
