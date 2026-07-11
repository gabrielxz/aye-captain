# AYE CAPTAIN

Networked 1v1 space combat where you command your ship in plain English —
typed or spoken. Hold Space and say "flank speed, come left forty"; the
ship's AI translates your words into structured commands; an authoritative
server executes them. The fun is turning intent into well-communicated
orders — and living with the occasional misinterpretation.

v4 "The Big Dark": **detection is the game**. A 250 km region, 3 km/s
ships, and sensors that see drive plumes — who sees whom first, at what
quality, decides engagements. Going dark is the only stealth.

- **Multiplayer**: 1v1 via 4-letter room codes. No accounts, no persistence.
- **Practice**: solo mode against a drone that patrols the rocks — and
  shoots back.
- **Input**: voice push-to-talk (hold Space) or typed text.
- **Output**: the ship AI talks back (ElevenLabs voice) and the ship itself
  sounds alive (procedurally synthesized SFX, no audio assets).

## How to play

- **Thrust & helm**: "flank speed", "come left forty", "steer 090", "point
  us at him", "go dark and drift", "all stop" (an autopilot flip-and-burn).
  Ships drift (Newtonian): turning doesn't change your velocity. "Show me
  our vector" (or V) draws where you're going and where you could stop.
- **Detection**: your drive plume is your signature. A hard-burning ship is
  visible ~181 km out; a dark drifter ~16 km. Contacts have **tiers**:
  FAINT (a smudge — approximate position, no vector), TRACK (true position
  + velocity, **lockable**), ID (full readout). Rocks and dust block
  line of sight — inside a dust cloud you're blind and unseen.
- **Weapons**: 6 torpedoes in 2 auto-reloading tubes. A locked shot needs
  a **lock**: a TRACK-or-better contact within 30° of your nose, inside
  80 km, held 5 s. The target FEELS your lock ("we're being painted!") and
  launching spikes your signature hugely. **A lock buys guidance**: while
  you hold it, your bird flies UPLINKED — intercept geometry off your
  track, immune to decoys. Lose the lock and it goes autonomous on its own
  weak seeker. You can also **fire blind** down a bearing with no lock at
  all ("put a torpedo down bearing 220") — a flushing tool for dust clouds
  and rock shadows. Torpedoes burn hard (~40g to 6 km/s, 25 s of fuel)
  then coast ballistic — nearly invisible, blind to maneuver, still lethal
  on their line.
- **Point defense**: automated PDCs engage inbound missiles (8 km) and
  enemy ships at knife range (3 km) while "guns free"; "hold fire" keeps
  you dark. 60 s of ammo, no resupply. Mutual PDC range is a mutual
  mauling. The mounts are **sensor-slaved** — they can't shoot what your
  sensors can't see, so a ballistic torpedo out of a dust shadow may
  arrive with almost no warning.
- **Countermeasures**: 4 decoys — hotter than a cruising ship but not a
  hard burn, so the doctrine is **break the lock, throttle down, decoy**
  (an uplinked bird ignores decoys; you must orphan it first via rocks,
  dust, or going dark). A drifting decoy also reads as an ordinary contact
  on enemy sensors until they close — fake contacts are a strategy. Plus:
  outrun the torpedo's burn, or dodge late to waste its fuel.
- **Propellant is delta-v**: a full tank is 100 s of hard burn — enough to
  reach flank speed and kill it once. It regenerates only inside the region
  with throttle ≤ 20%. Dry tanks = you drift. Turning is free.
- **Terrain**: 30 asteroids plus a centerpiece moonlet (solid — collision
  warnings sound 20 s out, hitting one above ~50 m/s hurts, ~1.5 km/s is
  lethal) and 3 dust clouds (sensor shadows). Same field on rematch, or ask
  for a new one.
- **The shroud edge**: outside the 250 km ring you're lit up (tier ID at
  any range), your tanks never refill, and a current drags you back toward
  center. No walls; no stranding.
- **Standing orders**: conditional doctrine — "if you get a track on him,
  sing out", "if a missile comes at us, turn into it, guns free". Max 6;
  cancel by name ("belay missile defense") or "belay all".
- **Questions**: "how far out is he?", "any rocks nearby we could hide
  behind?", "pdc status?", "full report".
- **Map**: wheel zoom, drag/WASD pan, F follows your ship, M toggles the
  region overview, V toggles your velocity vector. The cursor always shows
  bearing and range from your ship — your plotting table for callouts and
  blind fire.
- Win by reducing the enemy hull to zero. Rematch from the banner.

Debug/dev harness: any input starting with `{` or `[` is parsed as raw
schema-JSON commands and bypasses the LLM.

## Run locally

```sh
npm install
cp .env.example .env    # fill in the keys you have (see below)
npm run dev             # http://localhost:8080
```

Three API keys, all optional-but-recommended, all server-side only:

- `ANTHROPIC_API_KEY` — the command translator. Without it only raw JSON
  commands work.
- `GROQ_API_KEY` — Whisper speech-to-text for push-to-talk. Without it voice
  input falls back to the browser's built-in recognition.
- `ELEVENLABS_API_KEY` — the ship AI's spoken voice. Without it the ship is
  text-only.

Two-player on a LAN: both browsers hit `http://<your-ip>:8080`, one creates a
match, the other joins with the room code.

```sh
npm test            # headless sim/translator test suites (~250 assertions)
npm run typecheck   # tsc --noEmit
npm run build       # compile server to dist/
npm start           # run the compiled server
```

For contributors/AI agents: `CLAUDE.md` has architecture invariants and
conventions; `TODO.md` tracks next steps; `HANDOFF.md` is the original spec
and `HANDOFF-v4.md` the v4 overhaul spec.

## Deploy to Fly.io

The repo is deploy-ready: Dockerfile + `fly.toml` (region `iad`, port 8080).

```sh
fly launch --no-deploy          # creates the app, reuses fly.toml
fly volumes create data --size 1   # utterance log + voice-line cache
fly secrets set ANTHROPIC_API_KEY=sk-ant-... GROQ_API_KEY=gsk_... ELEVENLABS_API_KEY=...
fly deploy --ha=false           # ONE machine: matches live in memory
```

Matches are ephemeral and live in memory: if the process dies, the match dies.

## Architecture

One Node process (TypeScript). Static vanilla-JS client + WebSocket endpoint
(`/ws`) + server-side Anthropic API calls (key never reaches the client).

Timing: commands, standing orders, and LLM interaction run on a 1 Hz tick;
physics runs 10 substeps per tick (10 Hz) with swept-segment collision so
6 km/s torpedoes can't tunnel through proximity fuses or rocks; snapshots
broadcast at 4 Hz and the client interpolates.

```
server/
  index.ts        express + ws + static hosting, room registry, /stt, /speech
  match.ts        match/room lifecycle, lobby codes, disconnect grace,
                  terrain seed per match (rematch: same or new field)
  sim.ts          the game: substep physics, terrain collisions, signature/
                  tier sensors, locks, torpedoes, PDCs, maneuvers, standing
                  orders; fog of war enforced in snapshots
  terrain.ts      seeded rocks + dust generation, LOS raycasts
  translator.ts   LLM prompt assembly (from ship_command_schema.json),
                  defensive JSON parsing, schema validation
  persona.ts      the ship AI's character (voice + acknowledgement style)
  stt.ts          speech-to-text (Groq Whisper, OpenAI-compatible)
  tts.ts          ship voice (ElevenLabs) + disk cache of stock lines
  datalog.ts      utterance JSONL log (STT tuning dataset)
  constants.ts    every tunable number
client/
  index.html      lobby + ops-console layout
  main.js         ws handling, state store, snapshot-diff sound triggers
  render.js       canvas draw loop: camera (zoom/pan/follow/inset),
                  interpolation, terrain, contacts by tier, starfield,
                  vector overlay, SVG sprites, particles
  ui.js           command box, transcript, HUD, banner, focus management
  voice.js        push-to-talk capture (pre-roll ring -> /stt, Web Speech fallback)
  audio.js        procedural SFX synthesis + ship-AI speech queue
  assets/         authored SVG ship designs (interceptor / gunship / saucer)
ship_command_schema.json   the LLM<->server command contract (source of truth)
```

Key invariants:

- The server is authoritative; clients only render snapshots and send
  utterance strings.
- Fog of war is enforced server-side: a snapshot never contains information
  above the contact tier that player's sensors have earned.
- Standing-order conditions are evaluated against the owner's sensor picture;
  comparisons on unknowable metrics (e.g. `enemy_range` below TRACK tier)
  are false.
- All tunables live in `server/constants.ts`; the handoff specs win over the
  schema's suggested constants where they disagree.
