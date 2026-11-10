# Kannan Blue Metals — Crusher Monitor (PWA)

Installable Progressive Web App for monitoring the jaw crusher and controlling the
feeder VFD through the (future) AI + VFD automation system.

**Status:** frontend prototype running on demo/mock data. No hardware is connected.

Demo login: `admin` / `12345`

## Run locally

No build step — it is plain HTML/CSS/ES modules.

```bash
python3 -m http.server 8080      # or: npx serve .
# open http://localhost:8080
```

Service worker and install need `http://localhost` or HTTPS.

## Prototype security (read before production use)

Everything below is checked **in the browser** and can be bypassed by anyone with access to the
device or its developer tools. It exists to finalise the UI and workflow, not to protect equipment:

- Login (`admin` / `12345`) and password change — stored per device.
- Settings PIN — only a hash is in the code and it is never shown, but it is verified client-side.
- Audit log — device-local, IPs simulated, editable via browser storage.

When FastAPI is connected, login, PIN verification, setting changes and auditing must be enforced
by the backend (see `docs/API.md`).

## App updates

A new deployment installs in the background. The app then shows **"New version available —
Reload"**; it never reloads on its own. If there is unsaved work (an open dialog or a manual speed
not yet applied) the user is asked to confirm before reloading. Pages still running v1.0/v1.1 are
moved to the new service worker without a reload; their next normal reload shows the new version. If the update is accepted in one
window, other open windows keep running and their banner says "The app was updated in another window. Reload to continue."

## Tests

```bash
python3 -m http.server 8080 &
node tests/e2e.cjs                 # end-to-end feature checks (Playwright)
node tests/update.cjs              # new-version banner + upgrade clean-up
node tests/upgrade-from-live.cjs   # upgrade from the live v1.1.1 build (git commit 9e66e12)
node tests/release-check.cjs       # version bumped + all files precached (run before every release)
node tests/rollback.cjs            # installed app returns to v1.1.1 after a rollback
node tests/layout.cjs              # clipped/overflowing text at 320–1920 px
node tests/a11y.cjs path/to/axe.min.js   # axe-core WCAG 2 A/AA, light + dark
```

## Deploy

Static site, no build step. `vercel.json` sets the service-worker headers; `.vercelignore` keeps
`tests/` out of deployments. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the current setup,
the move to the GitHub → Vercel workflow, and rollback.

## Screens

| Screen | Highlights |
|---|---|
| Login | Company logo, show/hide password, remember me, Install App |
| Dashboard | Crusher status, Feeder AI state, VFD command card (AI state vs VFD command), today's KPIs, camera thumb, recent alerts |
| Machine | Separate **AI DETECTION** and **VFD COMMAND** panels, AUTO/MANUAL (manual only when EMPTY), manual Empty speed with −/+ and slider (40–50 Hz, Apply to send), auto-frequency table, live drive trend, demo simulator |
| Live Camera | Camera 01/02/03, placeholder scene with AI overlay (RTSP via backend later), fullscreen |
| Alerts | Severity filters, unread state, mark all read |
| Analytics & Reports | Tabs **Analytics · Reports · Audit Log**. Today / Yesterday / Custom Date / Daily (month to date) / Weekly / Custom Range; runtime, downtime, AI state duration, VFD trend & stats, manual periods, alerts, OEE; **Download Report** → report type (Operational / Audit Log / Complete) + PDF / Excel / CSV. Audit Log: filter by date, user, role, action, IP; table on desktop, cards on mobile |
| Profile & Settings | Edit name/photo/role, company name, plant, **company logo**, feeder frequencies, support contact, theme, notifications, install, change password, Help & Support, logout with confirmation |

## Control rules (`js/core/control.js`)

- AI state (EMPTY / PARTIAL / FULL) is always detected and shown — manual never hides it.
- AUTO → command = configured frequency for the AI state (default 30 / 37 / 43 Hz).
- MANUAL → only while AI = EMPTY; setpoint clamped to the manual range (default 40–50 Hz).
- AI leaves EMPTY while in MANUAL → control falls back to AUTO (alert raised).
- Crusher not running → feeder command 0 Hz (interlock).
- FULL / PARTIALLY FULL → MANUAL is locked and the manual speed controls are hidden.
- Changing the **Empty** automatic frequency or the manual min/max requires the settings PIN
  (Profile › Feeder frequency settings › Unlock). Applying a new **Manual Empty Speed** on the
  Machine screen also asks for the PIN. One correct PIN opens a **shared 5-minute window**
  (`APP.pinGraceSec`) for both screens; the window is checked again when saving, and logout
  clears it. Switching AUTO/MANUAL itself needs no PIN. 5 wrong PINs → 60 s lockout. Only a hash is in the code.

## Audit log (`js/services/auditService.js`)

Records date/time, user, role, IP, action, details, previous and new value for: login, failed login,
logout, manual override enabled/disabled (incl. automatic return to AUTO by `system`), manual Empty
speed changes, frequency and manual-range changes, PIN verified/incorrect, profile, photo,
password (values never stored), company details, logo, notification and theme/support settings.

**Prototype:** a fresh installation starts with an **empty** log — only actions performed in the app
create records (older builds' example entries are removed on upgrade). Every record is stored in this
browser, marked **Unverified**, and IP addresses are marked **Simulated** in the UI and in exports.
It is not a secure or authoritative audit record. With `APP.dataSource = 'api'` the PWA posts actions to the FastAPI audit service, which
takes user, session, client IP and timestamp from the authenticated request and stores them; the PWA
only displays `GET /api/v1/audit`.

The backend must enforce the same rules; the browser never talks to the VFD.

## Project structure

```
index.html, manifest.webmanifest, sw.js, vercel.json
css/app.css                 design tokens (light/dark), layout, components
assets/                     Kannan Blue Metals logo (SVG/PNG)
icons/                      PWA icons
vendor/                     jsPDF, jsPDF-AutoTable, SheetJS (lazy-loaded for reports)
js/config.js                app constants + default settings (frequencies, support, branding)
js/core/                    store, settings, auth (demo), control rules, formatting, storage
js/services/dataService.js  facade used by all views
js/services/mockData.js     mockCrusherData / mockFeederData / mockVfdData / mockAlerts / mockAnalytics
js/services/mockService.js  live simulation (demo)
js/services/apiService.js   FastAPI REST + WebSocket implementation (inactive)
js/services/reportService.js PDF / Excel / CSV export
js/pwa/                     install prompt, notifications / push-ready
js/ui/                      icons, components (modal/toast/forms), charts, shell, widgets
js/views/                   login, dashboard, machine, camera, alerts, analytics, profile, help
docs/API.md                 expected backend contract
```

## Connecting the backend later

Set `APP.dataSource = 'api'` and `APP.apiBase` in `js/config.js`. Implement the endpoints in
[docs/API.md](docs/API.md). Push notifications need a VAPID key (`APP.vapidPublicKey`) and a
`/api/v1/push/subscribe` endpoint; the service worker already handles `push` events.

## Prototype limitations

- Login and password change are checked in the browser and stored on the device — not secure.
- Settings, logo and profile photo are stored in this browser's localStorage.
- Camera is a placeholder; Snapshot/Record activate once the stream exists.
- The installed app icon comes from `manifest.webmanifest` (Kannan logo); an uploaded logo
  replaces branding inside the app, browser tab icon and reports, but browsers do not allow
  changing an installed app's icon at runtime.
