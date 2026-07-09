# AYE CAPTAIN — v1 "Text Captain"

Networked 1v1 space combat where you command your ship in plain English.
You type orders ("flank speed, come left forty"); an LLM first mate translates
them into structured commands; an authoritative server executes them on a 1 Hz
tick. The fun is turning intent into well-communicated orders — and living
with the occasional misinterpretation.

- **Multiplayer**: 1v1 via 4-letter room codes. No accounts, no persistence.
- **Practice**: solo mode against a drone that flies a slow circle.
- **Input**: text only in v1 (voice later).

## How to play

- **Thrust & helm**: "flank speed", "all stop", "come left forty",
  "steer 090", "point us at him", "go dark and drift".
- **Weapons**: laser (5 km, fires along your nose, 4 s cooldown), 6 missiles
  (heat-seeking — they chase the hottest signature in their cone), 4 decoys
  (hotter than a quiet ship; cold ship + decoy is a real escape).
- **Standing orders**: conditional doctrine — "if a missile comes at us, turn
  into it and shoot it down", "fire when he's in range and on our nose, keep
  firing". Max 6; cancel by name ("belay missile defense") or "belay all".
- **Questions**: "how far out is he?", "weapons status?", "full report".
- **The shroud**: outside the 20 km zone ring you're visible to the enemy at
  any range and your own sensors are halved. The faint 30 km ring is a hard
  wall — your drive fails there.
- Ships drift (Newtonian): turning doesn't change your velocity. To brake,
  flip 180 and burn.
- Win by reducing the enemy hull to zero. Rematch from the banner.

Debug/dev harness: any input starting with `{` or `[` is parsed as raw
schema-JSON commands and bypasses the LLM.

## Run locally

```sh
npm install
cp .env.example .env    # put your real ANTHROPIC_API_KEY in .env
npm run dev             # http://localhost:8080
```

Without an API key the game still runs, but the translator is offline — only
raw JSON commands work.

Two-player on a LAN: both browsers hit `http://<your-ip>:8080`, one creates a
match, the other joins with the room code.

```sh
npm test            # headless sim/translator test suites (~91 assertions)
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
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

Matches are ephemeral and live in memory: if the process dies, the match dies.

## Architecture

One Node process (TypeScript). Static vanilla-JS client + WebSocket endpoint
(`/ws`) + server-side Anthropic API calls (key never reaches the client).

```
server/
  index.ts        express + ws + static hosting, room registry
  match.ts        match/room lifecycle, lobby codes, disconnect grace
  sim.ts          1 Hz tick: standing orders -> commands -> physics ->
                  weapons -> sensors; fog of war enforced in snapshots
  translator.ts   LLM prompt assembly (from ship_command_schema.json),
                  defensive JSON parsing, schema validation
  constants.ts    every tunable number
client/
  index.html      lobby + ops-console layout
  main.js         ws handling, state store
  render.js       canvas draw loop w/ snapshot interpolation
  ui.js           command box, transcript, HUD, banner
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
