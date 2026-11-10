# Deployment

## Current setup (verified 9 Oct 2026 via the Vercel API)

| Item | Value |
|---|---|
| Vercel project | `kbm-crusher-monitor` (team `kmb-jaw`, **Hobby** plan) |
| Production URL | https://kbm-crusher-monitor.vercel.app |
| Git connection | **None.** The project is not linked to GitHub; all deployments were created through the Vercel API from branch `claude/great-sagan-lr6qih`. Pushing to GitHub does **not** deploy. |
| Live production deployment | `dpl_G91abh1sfaH9LHbJdM1GnQutWzZp` — commit `9e66e12`, app v1.1.1 |
| Earlier production deployment | `dpl_2rmAnN2NCr9yxNAFAdm9vn31gbrV` — commit `6761ba1`, app v1.1.0 |
| Repository `main` | Only the initial README. All app code is in PR #1. |
| Build settings | Framework *Other*, no build step; the repository root is served as-is. |
| Deployment protection | Vercel Authentication on all deployment URLs except the project's domains; the production domain is public. |

## Rollback

**Hobby plan limits:** Instant Rollback can only return to the **previous** production deployment.
Rolling back to a *specific older* deployment is a Pro/Enterprise feature.

1. **Instant Rollback (right after a bad release):** Vercel → `kbm-crusher-monitor` → Deployments →
   the previous production deployment → **⋯ → Instant Rollback**. Nothing is rebuilt. After the first
   v1.2.x release from `main`, the previous production deployment is `dpl_G91abh1sfaH9LHbJdM1GnQutWzZp`
   (v1.1.1).
2. **If v1.1.1 is no longer the previous deployment** (more deployments happened since): open
   `dpl_G91abh1sfaH9LHbJdM1GnQutWzZp` → **⋯ → Redeploy** (target Production). This builds commit `9e66e12`
   again; it stays reachable in git history after the merge (`git checkout 9e66e12`).

**What users see after a rollback (tested with `tests/rollback.cjs`):** an open or installed app shows
"New version available — Reload" within about 30 minutes, or as soon as the app is brought to the front
again. One reload then shows v1.1.1.

## Moving to GitHub → Vercel (owner approval required; do the steps in this order)

1. **Merge PR #1 into `main`** (GitHub → PR #1 → *Ready for review* → *Merge*).
   `main` then contains v1.2.x. No deployment happens, because Vercel is not linked yet.
2. **Only after step 1, connect the repository in Vercel** (Project → Settings → Git → *Connect Git
   Repository* → `KBMjaw/Crusher-KBM-AI-Dashboard`). Check that **Production Branch = `main`**, and that the
   build settings stay as listed above: Build Command empty, Output Directory `.`, Install Command empty.
   - ⚠️ Do **not** connect before merging. If connecting starts a production build from `main` (not
     verified either way), a README-only `main` would replace the live app.
3. **Deploy v1.2.x:** if connecting did not start a build, use Deployments → *Create Deployment* (branch
   `main`), or push any commit to `main`. Wait for *Ready*, then run the checks below. Keep the rollback
   steps above at hand.
4. **From then on:** feature branch → PR (Vercel creates a preview URL for each PR) → merge to `main` →
   production.

## Release checklist

- Bump the version in **both** `sw.js` (`VERSION`) and `js/config.js` (`APP.version`), otherwise installed
  apps never receive the release. `node tests/release-check.cjs` fails if this is missed or if a file is
  not precached.
- Run all test suites (see README).

## Post-deployment checks

- Open the production URL and log in. Check the Dashboard, the Machine screen (Empty-only manual control
  and PIN), Analytics → Audit Log, and download one report.
- With an older version still open: within about 30 minutes, or when the app is brought to the front
  again, the **"New version available — Reload"** banner appears.
- Installed PWA on Android and Windows: open it, then confirm it updates through the banner.
  This has **not yet been verified on real devices**.
