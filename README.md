# AYE CAPTAIN

Networked 1v1 space combat where you command your ship in plain English —
typed or spoken. Hold Space and say "flank speed, come left forty"; the
ship's AI translates your words into structured commands; an authoritative
server executes them on a 1 Hz tick. The fun is turning intent into
well-communicated orders — and living with the occasional misinterpretation.

- **Multiplayer**: 1v1 via 4-letter room codes. No accounts, no persistence.
- **Practice**: solo mode against a drone that circles — and shoots back.
- **Input**: voice push-to-talk (hold Space) or typed text.
- **Output**: the ship AI talks back (ElevenLabs voice) and the ship itself
  sounds alive (procedurally synthesized SFX, no audio assets).

## How to play

- **Thrust & helm**: "flank speed", "all stop", "come left forty",
  "steer 090", "point us at him", "go dark and drift".
- **Weapons**: laser (5 km, fires along your nose, 4 s cooldown); 6 missiles
  in 2 launch tubes (auto-reload, 20 s) — but you need a **lock**: hold the
  enemy within 30° of your nose, inside 10 km, on sensors, for 5 s. The
  target FEELS your lock ("we're being painted!") and firing lights you up
  with a launch flash. 4 decoys (hotter than a quiet ship; cold ship + decoy
  is a real escape).
- **Propellant**: thrust burns it (1/s at full); it regenerates only inside
  the zone with throttle ≤ 20%. Dry tanks = you drift. Turning is free.
- **Standing orders**: conditional doctrine — "if a missile comes at us, turn
  into it and shoot it down", "fire when he's in range and on our nose, keep
  firing". Max 6; cancel by name ("belay missile defense") or "belay all".
- **Questions**: "how far out is he?", "weapons status?", "full report".
- **The shroud**: outside the 30 km zone ring you're visible to the enemy at
  any range, your own sensors are halved, and your propellant never
  regenerates. The faint 45 km ring is a hard wall — your drive fails there.
- Ships drift (Newtonian): turning doesn't change your velocity. To brake,
  flip 180 and burn.
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
npm test            # headless sim/translator test suites (~147 assertions)
npm run typecheck   # tsc --noEmit
npm run build       # compile server to dist/
npm start           # run the compiled server
```

For contributors/AI agents: `CLAUDE.md` has architecture invariants and
conventions; `TODO.md` tracks next steps; `HANDOFF.md` is the original spec.

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

```
server/
  index.ts        express + ws + static hosting, room registry, /stt, /speech
  match.ts        match/room lifecycle, lobby codes, disconnect grace
  sim.ts          1 Hz tick: standing orders -> commands -> physics ->
                  weapons (tubes/locks/propellant) -> sensors; fog of war
                  enforced in snapshots
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
  render.js       canvas draw loop w/ interpolation, SVG sprites, particles
  ui.js           command box, transcript, HUD, banner
  voice.js        push-to-talk capture (MediaRecorder -> /stt, Web Speech fallback)
  audio.js        procedural SFX synthesis + ship-AI speech queue
  assets/         authored SVG ship designs (interceptor / gunship / saucer)
ship_command_schema.json   the LLM<->server command contract (source of truth)
```

Key invariants:

- The server is authoritative; clients only render snapshots and send
  utterance strings.
- Fog of war is enforced server-side: a snapshot never contains information
  that player's sensors don't have.
- Standing-order conditions are evaluated against the owner's sensor picture;
  comparisons on unknowable metrics (e.g. `enemy_range` with the enemy off
  sensors) are false.
- All tunables live in `server/constants.ts`; `HANDOFF.md` wins over the
  schema's suggested constants where they disagree.
