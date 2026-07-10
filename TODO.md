# TODO — next steps after v1

Agreed at the end of the v1 build session (2026-07-09), roughly in priority
order. Items marked (suggested) were proposed by Claude and not yet
explicitly requested by Gabriel.

## Done since v1 (2026-07-09 evening session)

- [x] **Voice input.** Push-to-talk (hold Space with empty command box).
  Server-side STT via Groq-hosted `whisper-large-v3-turbo` (`server/stt.ts`,
  `POST /stt`, OpenAI-compatible — env-swappable provider); Web Speech API
  fallback when no STT key. Client capture in `client/voice.js`.
- [x] **Utterance dataset.** Every utterance (voice + typed) appends to
  `data/utterances.jsonl` (`server/datalog.ts`; `UTTERANCE_LOG` overrides
  the path). Purpose: mine real player phrasing to refine the STT
  vocabulary-bias prompt in `stt.ts`.
- [x] **Deployed to Fly.io** as `aye-captain` (https://aye-captain.fly.dev),
  single machine (`fly deploy --ha=false` — matches live in memory), 1 GB
  volume `data` mounted at `/data` for the utterance log.
- [x] **`git init` + initial commit / GitHub.**

## Done in the v3 "Combat & Soul" session (2026-07-09, late)

- [x] Missile rework: 2 tubes + auto-reload, lock-before-launch (5s/30°/10km,
  2s grace), painted/RWR warnings, launch flash, accel-ramp flight model
  (velocity-steering; `NEWTONIAN_MISSILES=false` stub for the floaty version).
- [x] Speed/map: 600 m/s, accel 25, zone 30km, hard limit 45km, spawn 20km.
- [x] Propellant: burn 1/s@100%, regen 0.33/s inside zone at ≤20% throttle
  SETTING, dry = adrift + dim signature; warnings 50/25/10/0.
- [x] Target headings are snapshots (no continuous tracking).
- [x] Procedural SFX + ElevenLabs ship voice (persona in `server/persona.ts`,
  stock-line cache, speech queue with warning priority).
- [x] SVG ship sprites (3 designs in client/assets, interceptor default),
  hull bars, particles, explosion tiers, new HUD (PROP/TUBES/LOCK/WARN).
- [x] Drone fires back (one missile per 90s while locked).
- [x] Tests 91 → 147 assertions (new lock + propellant suites).

## v3 playtest watch-list (from the build session)

- Point defense is intentionally harder (snapshot headings + 600 m/s
  missiles). Reserved balance knobs, do NOT pre-tune: standing-order
  retrigger 5→3s, laser cooldown 4→3s, beam width 4→6°.
- Propellant economy is punishing at top speed (one 600 m/s dash + brake ≈
  half tank). Watch whether matches stall.
- Softlock possibility: tanks dry OUTSIDE the zone (no regen there, ever) =
  adrift until the enemy comes hunting; in practice mode only rematch saves
  you. Acceptable? Watch.
- Practice-mode opening is a long cruise now (drone spawns 40 km out).

## v2 next

- [ ] **ElevenLabs**: Gabriel creates the account/key, sets
  `ELEVENLABS_API_KEY` locally + `fly secrets set`; browse the voice library
  and swap `VOICE_ID` in constants.ts if George doesn't fit.
- [ ] **Ship design pick**: interceptor is default; gunship + saucer ship in
  client/assets — swap `SHIP_DESIGN` in render.js.
- [ ] **Refine STT keyword boosting** from accumulated
  `data/utterances.jsonl` (pull from Fly:
  `fly ssh console -C "cat /data/utterances.jsonl"`). Feed real phrasings
  into `STT_BIAS_PROMPT`.

## Housekeeping

- [ ] **Real PvP acceptance test in English.** The two-browser fight used the
  raw-JSON dev harness for maneuvers; nobody has yet fought a full PvP duel
  to a kill purely by typed English. Same plumbing as practice mode (which
  was verified in English), but do it once for real — voice makes this easy
  now.

## Improvements (suggested)

- [ ] **Prompt caching** on the translator's system prompt (it's large and
  static) to cut per-utterance cost/latency on the Anthropic API.
- [ ] **Transcript replay on reconnect** — keep a per-ship transcript buffer
  server-side and replay it when a player reoccupies their seat; currently
  they rejoin with an empty log.
- [ ] **Quieter repeat standing orders** — a repeating tracker (e.g. "face
  contact") logs "triggered" every 5 s and floods the transcript. Log first
  trigger, then suppress or batch repeats.
- [ ] **Map zoom control** — laser range (5 km) is ~70 px at full-map zoom;
  close fights would benefit from a zoom toggle or auto-zoom when the enemy
  is on sensors.

## Known quirks (fine for v1, documented here so nobody re-debugs them)

- Rendered ship icons are ~560 m wide at map scale; a laser beam can visually
  cross an icon while genuinely missing the 4° hit wedge. Mitigated with
  "clean miss" transcript lines + impact flashes.
- Rootless Docker on the dev machine doesn't route `-p` published ports;
  test containers with `--network host`. Irrelevant to Fly deploys.
- Missiles fired with the target outside the seeker cone go ballistic after
  ~2 s and never re-seek (symmetric reacquire window; intended reading of an
  ambiguous spec).
