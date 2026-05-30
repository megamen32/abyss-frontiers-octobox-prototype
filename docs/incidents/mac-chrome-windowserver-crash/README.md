# macOS WindowServer panic triggered while profiling the site in Chrome

## Summary

While profiling this project in Google Chrome on macOS, the browser session escalated into a `WindowServer` hang and then a full system reboot via watchdog-triggered kernel panic.

This is not acceptable behavior for a website workload. The site can be heavy, but it must not wedge the graphics stack badly enough to force a reboot.

This folder captures the reproducible context and the relevant log excerpts needed for an external bug report.

## Repository state

- Branch: `codex/mac-chrome-crash-report`
- Project: `abyss-frontiers-octobox-prototype`
- Relevant mitigation already applied in this branch:
  - Playwright render tests default to WebKit instead of Chromium
  - Chromium remains available as an explicit opt-in path via `npm run test:render:chromium`

## Environment

- Hardware: `MacBookPro18,2`
- CPU/GPU family from panic logs: Apple Silicon `T6000` / `AGXG13X`
- RAM: `32 GB`
- OS: `macOS 26.4 (25E5233c)`
- Browser involved in the failing run: `Google Chrome`

## What happened

Observed sequence:

1. The site was running locally from Vite on `127.0.0.1:4173`.
2. A Chrome profiling session was used against the game while the ship moved continuously downward through the world.
3. Chrome became unresponsive.
4. `WindowServer` stopped checking in and was reported as hung.
5. The machine rebooted after a watchdog-triggered kernel panic.

The key point is that the failure was not limited to a browser tab crash. The system graphics path stalled:

- `WindowServer` watchdog timeout
- `Metal -> IOGPU -> AGXG13X` stack in the hung submission path
- final kernel panic: `userspace watchdog timeout: no successful checkins from WindowServer`

## Reproduction

The exact trigger appears to be Chrome-based profiling under sustained rendering load.

### Local app setup

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

### Browser path that triggered the issue

Use Google Chrome, not Safari/WebKit.

Candidate reproduction flow:

1. Open `http://127.0.0.1:4173` in Google Chrome.
2. Start a Chrome DevTools Performance recording.
3. Keep the ship moving downward for about 30 seconds so chunk generation and rendering stay active.
4. Optionally keep input activity going while profiling.
5. Watch for UI freeze, Chrome unresponsiveness, `WindowServer` timeout, and in the worst case a reboot.

### Closest scripted approximation in this repo

For automated browser driving, this repo now includes:

```bash
npm run profile:deep-dive
```

That script now runs on WebKit by default as a safety measure. The pre-mitigation Chrome path can still be exercised manually or through:

```bash
npm run test:render:chromium
```

I do not recommend using Chromium as the default test path on this machine until the underlying issue is understood.

## Why this looks like a graphics stack failure, not just a tab crash

The supporting evidence is consistent across three system artifacts:

1. `Google Chrome ... .spin`
   - `Affected Process: Google Chrome (Chrome)`
   - `Reason: Slow response to HID event`
2. `WindowServer ... userspace_watchdog_timeout.spin`
   - `Reason: ... WindowServer ... returned not alive`
   - `WindowServer` blocked in `Metal -> IOGPU -> AGXG13X`
3. `panic-full ... .panic`
   - `panicString: userspace watchdog timeout: no successful checkins from WindowServer`

That is materially different from a normal browser crash.

## Source system logs

Original system files referenced by this report:

- `/Library/Logs/DiagnosticReports/Google Chrome_2026-05-30-150134_MacBook-Pro-User.spin`
- `/Library/Logs/DiagnosticReports/WindowServer_2026-05-30-150741_MacBook-Pro-User.userspace_watchdog_timeout.spin`
- `/Library/Logs/DiagnosticReports/panic-full-2026-05-30-150940.0002.panic`

Compact excerpts are committed in `logs/`.

## Included excerpts

- [logs/chrome-spin-excerpt.txt](/Users/user/Documents/Abyss3/docs/incidents/mac-chrome-windowserver-crash/logs/chrome-spin-excerpt.txt)
- [logs/windowserver-watchdog-excerpt.txt](/Users/user/Documents/Abyss3/docs/incidents/mac-chrome-windowserver-crash/logs/windowserver-watchdog-excerpt.txt)
- [logs/kernel-panic-excerpt.txt](/Users/user/Documents/Abyss3/docs/incidents/mac-chrome-windowserver-crash/logs/kernel-panic-excerpt.txt)

## Current mitigation in repo

The test harness now defaults render and profiling e2e to WebKit:

```bash
npm run test:render
npm run profile:render
npm run profile:deep-dive
```

Chromium is still available explicitly:

```bash
npm run test:render:chromium
```

## Expected outcome

Even if the site is too heavy, the expected failure mode is one of:

- frame drops
- browser tab slowdown
- browser process crash
- GPU process restart

The site should not be able to drive the machine into a `WindowServer` watchdog timeout and system reboot.
