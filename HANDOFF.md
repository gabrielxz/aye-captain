# PROJECT HANDOFF: Voice-Commanded Space Combat — v1 "Text Captain"

You are building v1 of a networked 1v1 space combat game where players command their ship in natural language. The player types orders in plain English ("flank speed, come left forty"); an LLM translates each utterance into structured JSON commands; an authoritative server executes them on a 1Hz tick. The fun is the translation of intent into well-communicated orders, and dealing with (occasional) misinterpretation.

v1 is **text input only** (voice comes later), **1v1 online multiplayer** via room codes, plus a **solo practice mode** against a dumb drone.

A companion file, `ship_command_schema.json`, is the source of truth for the command protocol, the standing-order condition grammar, the LLM translator rules, and example translations. Place it in the repo root and treat it as the contract between the LLM translator and the sim. Where this document and the schema disagree on constants, THIS DOCUMENT WINS (it is newer).

---

## 1\. Architecture

- **One Node.js process** (TypeScript preferred, plain JS acceptable) serving:  
  - Static client at `/` (vanilla JS \+ Canvas 2D — no React, no Pixi, no Phaser, no bundler unless truly necessary)  
  - WebSocket endpoint at `/ws`  
  - Internal calls to the Anthropic API (key server-side only, from env var `ANTHROPIC_API_KEY`)  
- **Authoritative server sim**: all game state lives in memory on the server. Clients are dumb terminals: they render snapshots and send utterance strings. Clients never compute game logic.  
- **Tick rate: 1 Hz.** Each tick: evaluate standing orders → execute queued commands → step physics → resolve weapons → broadcast per-player snapshots.  
- **No database.** Matches are ephemeral. If the process dies, the match dies. Fine.  
- **Deployment target**: Fly.io, single app, region `iad`. Include a Dockerfile. Bind to `0.0.0.0:8080`. The human will run `fly launch` / `fly deploy` themselves; your job is to make the repo deploy-ready. Build and test everything locally first with a `.env` file (use dotenv), `.env` in `.gitignore`, and include a `.env.example`.

### Suggested file layout

/server

  index.ts          \# express \+ ws \+ static hosting

  match.ts          \# match/room lifecycle, lobby codes

  sim.ts            \# tick loop, physics, weapons, standing orders

  translator.ts     \# Anthropic API call, prompt assembly, JSON validation

  constants.ts      \# EVERY tunable number lives here. No magic numbers in sim code.

/client

  index.html

  main.js           \# ws handling, state store

  render.js         \# canvas draw loop w/ interpolation

  ui.js             \# command box, transcript pane, HUD panels

/ship\_command\_schema.json

---

## 2\. Constants (put ALL of these in `constants.ts`)

TICK\_RATE\_HZ            \= 1

// Zone / bounding

ZONE\_RADIUS\_M           \= 20000     // "the shroud" — visible ring on map

HARD\_LIMIT\_RADIUS\_M     \= 30000     // absolute outer boundary, faint ring

OUTSIDE\_ZONE\_SENSOR\_MULT= 0.5       // own sensor range halved outside zone

// Ship

MAX\_SPEED\_MPS           \= 300

ACCEL\_FULL\_THRUST\_MPS2  \= 15

TURN\_RATE\_DEG\_PER\_SEC   \= 20

HULL\_POINTS             \= 100

SENSOR\_RANGE\_M          \= 12000

SHIP\_BASE\_SIGNATURE     \= 40        // signature \= 40 \+ thrust%  (range 40–140)

// Laser

LASER\_RANGE\_M           \= 5000

LASER\_BEAM\_WIDTH\_DEG    \= 4         // half-angle tolerance off boresight

LASER\_COOLDOWN\_S        \= 4

LASER\_DAMAGE            \= 10        // vs ships; instantly destroys missiles/decoys

// Missiles

MISSILE\_MAGAZINE        \= 6

MISSILE\_SPEED\_MPS       \= 450

MISSILE\_TURN\_RATE\_DPS   \= 45

MISSILE\_LIFETIME\_S      \= 45        // self-destructs after

MISSILE\_LAUNCH\_DELAY\_TICKS \= 2      // flies straight, no seeking, during delay

MISSILE\_ACQ\_CONE\_DEG    \= 60        // half-angle of seeker cone

MISSILE\_REACQUIRE\_S     \= 2         // grace period after losing lock

MISSILE\_PROX\_FUSE\_M     \= 150

MISSILE\_DAMAGE          \= 35

// Decoys

DECOY\_SUPPLY            \= 4

DECOY\_LIFETIME\_S        \= 20

DECOY\_SIGNATURE         \= 120

// Standing orders

STANDING\_ORDER\_MAX      \= 6

STANDING\_ORDER\_RETRIGGER\_COOLDOWN\_S \= 5   // for repeat:true orders

// Fog of war

ORDNANCE\_DETECT\_RANGE\_M \= 6000      // missiles & decoys visible at half sensor range

// Spawn

SPAWN\_DIST\_FROM\_CENTER\_M= 14000     // opposite sides, facing each other, v=0

// LLM

LLM\_MODEL               \= "claude-haiku-4-5-20251001"

LLM\_TIMEOUT\_MS          \= 5000

LLM\_MAX\_TOKENS          \= 1000

---

## 3\. Simulation rules

### Physics (Newtonian-lite, 2D)

- Ship state: position (x,y), velocity vector, facing (deg, 0 \= north/up, clockwise positive), thrust % (0–100), goal heading (or tracked target), hull, ammo counts.  
- Each tick: rotate facing toward goal heading at TURN\_RATE (clamp, don't overshoot). Acceleration \= (thrust/100) × ACCEL, applied along facing, added to velocity. Clamp speed to MAX\_SPEED (scale the velocity vector; fiction: "drive saturation"). Position \+= velocity × dt.  
- Rotation does NOT change velocity — ships drift. Braking \= flip 180 and burn.  
- No collisions. Ships pass through everything. Only weapons deal damage.

### Heading orders

Three modes per schema: `relative` (port \= CCW, starboard \= CW), `absolute` (compass degrees), `target` (server re-resolves bearing to the target every tick until the order is replaced — the ship *tracks*). `target: enemy_ship` uses last-known position when the enemy is off sensors.

### Laser

On fire: if cooldown ready, cast a ray along facing. Hit the FIRST object (enemy ship, enemy missile, enemy decoy) whose bearing is within LASER\_BEAM\_WIDTH\_DEG of boresight and within LASER\_RANGE. Friendly objects are transparent to your laser (never hit your own missiles/decoys). Ships take LASER\_DAMAGE; missiles and decoys are destroyed outright. If nothing is hit, the shot fires anyway (visible miss, cooldown still spent). Firing during cooldown: command rejected, first mate reports "recharging."

### Missiles

- Launch: spawns at ship position, inherits ship velocity \+ MISSILE\_SPEED along ship facing, flies straight (no seeking) for LAUNCH\_DELAY\_TICKS.  
- Lock: after delay, lock the highest-signature enemy object (ship or decoy — never friendly) inside the seeker cone (ACQ\_CONE half-angle around missile facing). Signature: ship \= SHIP\_BASE\_SIGNATURE \+ thrust%; decoy \= DECOY\_SIGNATURE.  
- Tracking: each tick, turn toward locked target at MISSILE\_TURN\_RATE. If target leaves the cone or dies: fly straight for MISSILE\_REACQUIRE\_S attempting re-lock (same rule), then go ballistic (straight) for remaining lifetime.  
- Re-evaluate lock each tick: if a higher-signature object enters the cone (e.g., a fresh decoy), the seeker switches to it. This makes "cut engines \+ decoy" a genuine escape maneuver and makes decoying a full-burn ship unreliable. Intended behavior.  
- Detonation: within PROX\_FUSE of any enemy object → MISSILE\_DAMAGE to ships; decoys destroyed. Missiles die on detonation, laser hit, or lifetime expiry.

### Decoys

Eject at ship position, inherit ship velocity plus small random drift (\~10 m/s random direction). No thrust. Emit DECOY\_SIGNATURE for DECOY\_LIFETIME\_S, then vanish.

### Zone / bounding ("the shroud")

- Zone: circle radius ZONE\_RADIUS at origin. Visible ring on map.  
- Outside the zone: (a) that ship is fully visible to the enemy regardless of sensor range; (b) that ship's own sensor range is multiplied by OUTSIDE\_ZONE\_SENSOR\_MULT. Both effects are binary and instant on crossing; both end on re-entry.  
- Hard limit: at HARD\_LIMIT\_RADIUS the server clamps position to the ring and zeroes the outward radial velocity component (tangential component survives). Faint ring on map. Fiction: drive failure at the shroud's absolute edge.  
- Server-generated transcript events (no LLM call) on transitions: leaving zone ("Captain, we've left the shroud — we're visible"), re-entering, and hitting the hard limit.

### Fog of war (v1: binary)

Per-player snapshots. You always see: your own full state, your own missiles/decoys, both zone rings. You see the enemy ship iff (distance ≤ your current sensor range) OR (enemy is outside the zone). When the enemy is not visible, the client renders a "last known position" ghost (server includes lastKnown {x, y, facing, timestamp} in the snapshot). Enemy missiles and decoys visible within ORDNANCE\_DETECT\_RANGE. Never send the client information its sensors don't have — fog of war is enforced server-side, not by the renderer.

### Standing orders

- Stored per player, max STANDING\_ORDER\_MAX. Evaluated at the start of each tick against that player's *sensor-visible* state (conditions can't see through fog: `enemy_range` is unknowable when the enemy is off sensors — treat comparisons on unknowable metrics as false).  
- Condition grammar per schema: single comparison, or flat all/any of 2–3 comparisons. Metrics enumerated in the schema.  
- On fire: execute the order's actions in sequence as if the captain issued them; log to transcript ("Standing order 'missile defense' triggered — coming about"). One-shot unless repeat:true; repeat orders re-arm after RETRIGGER\_COOLDOWN.  
- Cancellation by label, or "all". Nested standing orders are forbidden (translator rule \+ server validation).

### Match lifecycle

- Lobby: landing page offers "Create match" (returns a 4-letter room code, player becomes Ship A) and "Join match" (enter code, become Ship B). Plus "Practice" (see below). No accounts, no persistence.  
- Spawn: opposite sides of center at SPAWN\_DIST\_FROM\_CENTER (28 km apart — just outside mutual sensor range so matches open with a hunt), facing each other, zero velocity, full hull/ammo.  
- Win: enemy hull ≤ 0\. Banner declares winner, shows match duration. "Rematch" button resets the same room. If a player disconnects, pause the sim for up to 60s awaiting reconnect, then declare the remaining player the winner.

### Practice drone (solo mode)

Spawns a drone instead of a second player: flies a slow circle (\~100 m/s, gentle constant turn), signature as a ship at 50% thrust, 60 hull, no weapons in v1 (constant `DRONE_FIRES_BACK = false` for later). Full LLM pipeline works identically. This mode is the primary dev-test harness — build it early, not last.

---

## 4\. LLM translator (`translator.ts`)

- Model: LLM\_MODEL via the Anthropic Messages API. Non-streaming, single-shot, temperature 0, MAX\_TOKENS cap.  
- System prompt: assembled from `ship_command_schema.json` — embed the verb definitions, condition grammar, translator rules (`llm_translator_rules` in the schema), and example translations (`example_translations`). Also inject a compact live-state summary (own thrust/heading/speed/hull/ammo, enemy visibility & bearing/range if visible, active standing order labels) so the mate can resolve context-dependent orders like "ease off" or "point at him."  
- Response contract: the LLM returns a JSON array of command objects per the schema (max 4). Parse defensively: strip code fences, validate every command against the schema, drop invalid ones. If ALL parsing/validation fails or the call times out (LLM\_TIMEOUT\_MS): no commands, transcript shows the mate saying "Say again, Captain?"  
- `query` verb flow: server executes the query against sensor-visible state, then makes a SECOND short LLM call to phrase the answer in the first mate's voice. (Acceptable simplification if this is painful: template-based answers, no second call — flag which you chose.)  
- Acknowledgements: every executed command's `acknowledgement` string goes to the transcript attributed to "XO" (the first mate). Commands the server rejects (empty magazine, cooldown, standing-order cap) generate server-templated XO lines ("Magazine's empty, Captain").  
- Ambiguity policy (critical, from schema): the mate INTERPRETS and states the interpretation; it never asks clarifying questions. Misinterpretation is gameplay.

---

## 5\. Client

Vanilla JS, Canvas 2D, one page. Layout: large canvas map; below or beside it, the command input box and a scrolling transcript pane; a slim HUD strip (hull, thrust %, speed, heading, missiles, decoys, laser cooldown, active standing orders with labels).

- **WebSocket**: connect to own origin `/ws`. Receive per-player snapshots each tick; keep the last two snapshots.  
- **Render loop**: `requestAnimationFrame` at display rate, linearly interpolating positions and facings between the last two snapshots so ships glide rather than teleport at 1Hz. This interpolation is REQUIRED — it is the single biggest feel multiplier in the project. (Interpolate angles via shortest arc.)  
- **Draw**: dark background; zone ring (clear) and hard-limit ring (faint); own ship as a triangle rotated to facing (triangle \= orientation indicator); enemy ship triangle when visible; enemy ghost (dimmed/outlined \+ "last seen Xs ago") when not; missiles as small dots with short velocity trails; decoys as distinct markers; a subtle thrust flare scaled to thrust % on own ship; laser shots as brief rays (hit or miss) for \~300ms.  
- **Command box**: text input; Enter sends `{type:"utterance", text}` to server; box clears; local echo appears in transcript immediately attributed to "CAPT". Keep focus in the box by default; up-arrow recalls previous utterances.  
- **Transcript pane**: chronological log of captain utterances, XO acknowledgements, server events (zone transitions, standing-order triggers, hits taken/dealt, XO rejections). This pane is the heart of the game's feel AND the debugging console — do not stub it.  
- Minimal lobby screen preceding the match: Create / Join (code input) / Practice.  
- Aesthetic: functional dark "ops console" look. Do not spend time on art. Monospace fonts, thin lines, high contrast.

---

## 6\. Build order (work in this sequence, verify each stage runs)

1. Repo scaffold, constants.ts, express \+ static \+ ws skeleton. Client connects, renders an empty map.  
2. Sim core: ship physics (thrust, heading modes, drift, speed clamp), hardcoded test commands, snapshot broadcast, client renders own moving ship with interpolation.  
3. Practice mode \+ drone; fog-of-war-scoped snapshots; ghost rendering.  
4. Translator: utterance → LLM → validated commands → queue. Transcript pane with acknowledgements. **Milestone: fly the ship around by typing English.**  
5. Weapons: laser (ray, cooldown, damage), missiles (full seeker logic), decoys, signatures. Kill the drone by voice. Win banner.  
6. Standing orders: storage, per-tick evaluation vs sensor-visible state, trigger logging, cancellation, cap.  
7. Zone effects \+ hard limit \+ server transcript events.  
8. Lobby/rooms: create/join codes, two-player match, disconnect handling, rematch.  
9. Dockerfile, .env.example, README with local-run and fly-deploy instructions.

Definition of done for v1: two browsers on the local network can create/join a match by room code and fight to a win banner entirely through typed English commands; practice mode works solo; `fly deploy` ships it unchanged.

---

## 7\. Explicit non-goals for v1 (do not build)

Voice input/output. Signature-based sensor detection (signature exists ONLY for missile seekers in v1). Station views / multi-screen crew mode. Ship systems (power routing, shields, heat). More than 2 players per match. Accounts, persistence, matchmaking, stats. Sound. Art beyond functional shapes. Mobile support.  
