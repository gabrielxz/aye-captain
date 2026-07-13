# AYE CAPTAIN

Networked multiplayer space combat (up to 8 captains, FFA or teams) where
you command your ship in plain English —
typed or spoken. Hold Space and say "flank speed, come left forty"; the
ship's AI translates your words into structured commands; an authoritative
server executes them. The fun is turning intent into well-communicated
orders — and living with the occasional misinterpretation.

v4 "The Big Dark" through v4.5 "Tempo": **detection is the game**. A
250 km region, 3 km/s ships, and sensors that see drive plumes — who sees
whom first, at what quality, decides engagements. Information comes on a
ladder: you HEAR ships (bearing only, huge range), you SEE ships (tiered
contacts, closer), you LOCK ships (closest). You can be silent, or you can
be going somewhere — not both.

- **Multiplayer**: up to 8 captains via 4-letter room codes — FFA or two
  teams; the room creator picks the mode and hits LAUNCH; everyone picks a
  hull. No accounts, no persistence. Dead captains flow into the spectator
  view; disconnected ships drift as silent ghosts until their captain
  returns (or 120 s pass). Friends can WATCH with the same code —
  spectators get an omniscient referee view and a callsign (Ghost,
  Echo, ...); players see who's watching.
- **Practice**: solo mode against a drone that patrols the rocks — and
  shoots back.
- **Campaign — Deep Black**: a solo, run-based roguelike. Eight systems;
  get out of each one through a gate on the rim; your score is how far
  you got. Each system gives you a fixed clock's worth of greed — burn
  loud, chase salvage, strip wrecks (a full stop is the price; the haul
  lands one item at a time, worst first) — and when the clock hits zero a
  Hunter wakes up and comes looking by ear. It perceives through the same
  fog of war you do: decoys fool it, dust blinds it, going dark works.
  Kill it and it drops the best wreck in the system; the gate is flown
  through, not commanded — thread a 3 km aperture on your drift, or
  overshoot into the naked dark outside the shroud. Salvaged modules and
  your remaining propellant/missiles/hull carry across systems; each
  system's hunter is a new named problem ("system five is when they start
  coming in pairs"), and an adaptive procedural score follows what YOU
  know — never what the sim knows. Runs save to your browser; death ends
  them.
- **Input**: voice push-to-talk (hold Space — or the on-screen HOLD
  button on phones/tablets) or typed text.
- **Output**: the ship AI talks back (ElevenLabs voice) and the ship itself
  sounds alive (procedurally synthesized SFX, no audio assets).

## How to play

- **Thrust & helm**: "flank speed", "come left forty", "steer 090", "point
  us at him", "go dark and drift", "all stop" (an autopilot flip-and-burn).
  Pointing at a target TRACKS it: the helm keeps the nose on the contact
  (or down a rumble's bearing — "steer for that rumble") until you give a
  new heading; lose the contact and the helm holds its last known position
  and says so. Ships drift (Newtonian): turning doesn't change your
  velocity. "Show me our vector" (or V) draws where you're going and where
  you could stop.
- **Pick a hull**: three archetypes, numbers only. **Corvette** — the
  ghost: fastest, dimmest, best sensors, 6 decoys, 1 tube, no railgun.
  **Frigate** — the baseline all-rounder. **Cruiser** — the thunderstorm:
  160 hull, 3 tubes, deep magazines, and a signature that cannot hide.
  Enemy archetypes are ID-tier information: below ID every contact is a
  neutral wedge on the map.
- **Contacts have names**: your XO designates hostile tracks in acquisition
  order — "Contact Alpha", "Contact Bravo" (decoys get letters too; you
  can't tell). At ID range a track resolves to the ship's permanent
  **callsign** ("Contact Bravo identified: it's Kestrel"). Letters and
  callsigns are valid targets: "point at Bravo", "lock up Kestrel". A track
  lost for over a minute can't be correlated — it comes back as a new
  letter.
- **Detection**: your drive plume is your signature. A hard-burning ship is
  visible ~234 km out; a dark drifter ~54 km (and unlockable until ~32).
  Contacts have **tiers**: FAINT (a smudge — approximate position, no
  vector), TRACK (true position + velocity, **lockable**), ID (full
  readout). The HUD's CONTACT row names what the current tier buys
  ("TRACK · lockable") — it's the same vocabulary the XO's tier calls use.
  Rocks and dust block line of sight — inside a dust cloud you're blind
  and unseen.
- **Hearing**: beyond sensor range every drive **rumbles** — a bearing-only
  chevron and a low ambience, out to 2.5× detection range (a cruising ship
  is heard across most of the map). Terrain doesn't block it. Bearings
  only: cross-referencing them over time is captain's work.
- **Active ping**: "give me a ping" snaps everything within 150 km (LOS
  permitting) to TRACK for 5 s — dark ships, decoys, coasting torpedoes.
  The price: you're revealed at ID to everyone, map-wide, for 10 s (a red
  **LIT** countdown in your HUD while you pay it). 30 s cooldown. A ping
  finds ships; it can't hold a lock by itself. The ping is a circle, not a
  beam: the expanding ring on the map is the true area of effect, and the
  gaps torn in it are where rocks and dust ate your ping. After your own
  ping, a return blip = a contact (sooner = closer); silence = nothing in
  the open.
- **Weapons**: 6 torpedoes in 2 auto-reloading tubes. A locked shot needs
  a **lock**: a TRACK-or-better contact within 30° of your nose, inside
  80 km, held 5 s. The target FEELS your lock ("we're being painted!") and
  launching spikes your signature hugely. **A lock buys guidance**: while
  you hold it, your bird flies UPLINKED — intercept geometry off your
  track, immune to decoys. Lose the lock and it goes autonomous on its own
  weak seeker (30° cone — blind fire needs a good bearing, not a gesture).
  You can also **fire blind** down a bearing with no lock at all ("put a
  torpedo down bearing 220") — a flushing tool for dust clouds and rock
  shadows. Autonomous birds are fire-and-forget in the honest sense: no
  telemetry — you only learn a bird's fate (splashed by PDCs, ate a decoy,
  struck home) if your own sensors could watch it happen. Torpedoes accelerate to 2.4 km/s over ~16 s (25 s of fuel) then
  coast ballistic — nearly invisible, blind to maneuver, still lethal on
  their line. The fuse arms 3 km from the launch point: inside that,
  standoff is part of the weapon and your bird duds past. Tubes reload in
  30 s — a full salvo is FELT; staggered fire is doctrine.
- **The railgun** (Frigate & Cruiser — a Corvette mounts none): 6 km/s
  slugs, 25 damage, 6 s recharge, no resupply. **Solution mode** computes a
  lead against a TRACK-or-better contact and fires instantly — lethal to
  anything coasting; *any thrust during the slug's flight is a miss*.
  **Bearing mode** is a manual skill shot. Slugs are pure physics: rocks
  stop them, PDCs can't, they check no IFF (they WILL hit a teammate in the
  line of fire), and firing is heard across the map — if you hear rail
  fire, burn.
- **Point defense**: automated PDCs engage inbound missiles (8 km) and
  enemy ships at knife range (3 km) while "guns free"; "hold fire" keeps
  you dark. 60 s of ammo, no resupply. Mutual PDC range is a mutual
  mauling. The mounts are **sensor-slaved** — they can't shoot what your
  sensors can't see, so a ballistic torpedo out of a dust shadow may
  arrive with almost no warning.
- **Probes**: fire-and-drift remote sensors ("probe out, bearing 090") —
  a 20 s burn, then ~3 minutes of relay: contacts it earns (reduced eyes)
  and rumbles it hears merge into your map marked "via probe", with the
  chevron anchored at the probe. Two bearings on one rumble — yours and
  the probe's — cross into a fix; plotting it is your job, not the XO's.
  A relayed track can steer the helm and answer questions but never feeds
  a missile lock. Probes are killable (PDCs, slugs, seekers) and don't
  reload: corvettes carry 4, frigates 2, cruisers 1.
- **Countermeasures**: 4 decoys — hotter than a cruising ship but not a
  hard burn, so the doctrine is **break the lock, throttle down, decoy**
  (an uplinked bird ignores decoys; you must orphan it first via rocks,
  dust, or going dark). A drifting decoy also reads as an ordinary contact
  (and rumbles like a real drive) for a full minute — fake contacts are a
  strategy. Plus: burning away at range genuinely outruns a torpedo's tank
  now, or dodge late to waste its fuel.
- **Teams** (room option): teammates share transponders — always on each
  other's maps at full state, in friendly blue. NOTHING else is shared: no
  fused sensor picture, no rumbles, no probe feeds — intel moves by
  tightbeam, on purpose. Guided weapons check IFF (locks, seekers, prox
  fuses, and PDCs all ignore friendlies) — but rail slugs and collisions
  check nothing. Physics doesn't read transponders.
- **Comms**: talk to other captains. "Broadcast: anyone want to team up on
  the cruiser?" reaches everyone — and flares a comms spike: every captain
  gets your bearing AND your callsign for 5 s (voiceprint; a broadcast is
  a flare). "Tightbeam Mako: he's behind the moonlet" is a private whisper
  — but you need a current track to point the dish (teammates are always
  reachable). Delivery is verbatim; the receiving XO reads it aloud.
  10 s per channel between sends, 140 characters.
- **Propellant is delta-v**: a full tank is 100 s of hard burn — enough to
  reach flank speed and kill it once. It regenerates only inside the region
  with throttle ≤ 20% (the HUD's PROP row shows ⟳ while harvesting, ✕ when
  the gate is closed). Dry tanks = you drift. Turning is free.
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
  region overview, V toggles your velocity vector — a labeled line showing
  10 s of travel plus an "all stop" bracket marking where a full stop
  ordered now would bring you to rest (with the distance: your can-I-stop-
  before-that-rock number). The cursor shows the bearing from your ship
  (your plotting table for callouts and blind fire); the single dashed
  ring is a 50 km ruler. Ask for the **drift marker** ("show me our
  drift") and a chevron rides your hull pointing where you're *going* —
  your hull points where you're *aimed*, and the gap between them is what
  kills people. No hotkey; it's asked for, like everything on this boat.
- **The XO's speech discipline** (v5.1): he speaks when he knows something
  you don't — rejections, delayed completions, threats. Acks of things the
  HUD already shows stay text-only; other acks he voices as a short "Aye,
  Captain" with the detailed readback in the transcript (standing-order
  readbacks he still speaks in full — you need to hear the trigger
  direction). Answers to questions land written; the voice points you at
  the board. Rumble calls batch into one line
  ("Three drives out there — bearings 040, 180, and 295"), and far-away
  contact changes log silently once the board gets busy. Keying the mic
  cuts him off (life-or-death warnings finish, ducked). The lock alarm
  blares 4 s then decays to a heartbeat — one thump per ship holding you.
  Topbar: separate SFX/VOX sliders + an XO verbosity cycle
  (FULL/TERSE/SILENT), changeable mid-match.
- **Names** (v5.1): type one in the lobby — teammates and spectators see
  it, enemies never do, the XO never speaks it. The gameover screen
  reveals every callsign→name mapping plus the kill ledger ("Vagrant
  (Marcus) → Kestrel (Gabriel)").
- **Practice** (v5.1) opens a ship-select for your hull AND the sparring
  drone's — stat cards with signature front and center ("no railgun" is a
  corvette headline, not a footnote).
- Win by reducing the enemy hull to zero. Rematch from the banner is a
  ready-up vote (majority picks same/new field; leavers never block), and
  MAIN MENU exits cleanly.

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
npm test            # headless sim/translator test suites (400+ assertions)
npm run typecheck   # tsc --noEmit
npm run build       # compile server to dist/
npm start           # run the compiled server
```

For contributors/AI agents: `CLAUDE.md` has architecture invariants and
conventions; `TODO.md` tracks next steps; `HANDOFF.md` is the original spec
and `HANDOFF-v4.md` the v4 overhaul spec (addenda: v4.1, v4.3, v4.5).

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
fast torpedoes can't tunnel through proximity fuses or rocks; snapshots
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
