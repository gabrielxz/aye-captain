---
name: verify
description: Runtime-verify aye-captain changes by driving the real game in Chrome — dev server + multi-tab browser session (players + spectators)
---

# Verifying aye-captain changes at runtime

## Launch

```sh
npm run dev          # background; tsx watch on http://localhost:8080
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/   # 200 = up
```

Kill with `kill $(pgrep -f "tsx watch")` when done. `.env` keys are
optional — translator/voice degrade gracefully; the dev harness works
without any keys.

## Drive

Multi-role flows need one Chrome tab per seat (claude-in-chrome):
CREATE MATCH on tab 1, read the code from `#lobby-status`, JOIN/WATCH
from the others.

**Gotchas that cost time:**

- The first click after page load can race the websocket — `send()`
  drops silently before OPEN. Click again if `#lobby-status` stays empty.
- **Background tabs do not receive synthetic `computer` input** (clicks
  and typing only land on the selected tab). Drive non-selected tabs
  with `javascript_tool`: set input `.value`, call `button.click()`, or
  dispatch `new KeyboardEvent("keydown", {key:"Enter", bubbles:true})`
  on `#cmd` — all real handler paths.
- Fast commands: type raw JSON into `#cmd` (dev harness bypasses the
  LLM), e.g. `{"verb":"set_thrust","params":{"percent":100}}`,
  `{"verb":"deploy_decoy","params":{}}`. Verb list: `case "` labels in
  `server/sim.ts` (~line 380).
- Extra seats/protocol probes without more tabs: open raw sockets from
  any tab's console — `new WebSocket('ws://localhost:8080/ws')`, then
  `send(JSON.stringify({type:'join'|'spectate', code}))` and inspect
  `onmessage` payloads directly. Best way to assert on snapshot JSON
  (client module state is not reachable from the console).
- Decoys expire in 20 s (`DECOY_LIFETIME_S`) — capture evidence fast.
- Time-of-flight matters: ships spawn 300 km apart; anything
  cross-map takes minutes at ship speeds. Prefer probes near a spawn.

## Observe

- Player HUD fields: `#hud` textContent. Transcript: `#transcript`.
- Map is canvas — screenshot/zoom for visual evidence; UI overlays
  (`#watching`, `#spec-badge`, `#banner`) are DOM and JS-readable.
