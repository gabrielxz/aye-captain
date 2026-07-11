# TODO — next steps

## v4 "The Big Dark" + v4.1 addendum — DEPLOYED 2026-07-11

All ten build-order steps of `HANDOFF-v4.md` plus the full `HANDOFF-v4.1.md`
addendum (sensor-slaved PDCs, blind fire, uplinked/autonomous guidance,
seeker detection math, decoy retune 90 + fake-contact deception, cursor
bearing readout) plus the Captain's Handbook at `/how-to-play` are LIVE at
https://aye-captain.fly.dev — merged `v4-big-dark` → main, CI deploy green,
lobby + handbook verified answering in production. 280 headless assertions;
English paths verified in the browser (flank speed, vector overlay, full
stop, and "put a torpedo down bearing zero four five, fire blind" → bird
curving onto 045 with no lock). The new v4/v4.1 XO stock lines pre-generate
into the /data speech cache on boot (one-time cost per line).

**Remaining before this milestone is DONE:**

- [ ] Gabriel playtests ONLINE — especially the feel items below. Report
  batched feedback as usual; `fly logs` + `/data/utterances.jsonl` localize
  any "XO misbehaved" report.

## v4 playtest watch-list (reserved knobs, do NOT pre-tune)

- **Opening hunt**: spawns 300 km apart, dark ships see each other only at
  ~16.5 km, drone/ships at cruise ~99 km. Is finding each other fun or a
  slog? Knobs: SENSOR_BASE_M, spawn distance, drone signature.
- **Faint-fix noise** (2 km, 5 s refresh): enough texture, or annoying?
- **Lock range 80 km vs detection**: a quiet ship can only be locked inside
  ~10 km (track band of sig 10) — provoking a burn matters. Working?
- **PDC kill prob 0.25/s**: spec says saturation salvos are SUPPOSED to
  leak — resist tuning up (there's a leak-rate test pinning the intent).
- **"Break lock, then spoof" two-step escape** (v4.1 §3 design
  consequence, flagged for playtest): does breaking the uplink via
  rocks/dust/going-dark and THEN decoying the orphaned bird actually land
  as a learnable doctrine?
- **Blind fire usefulness**: seeker base 40 km — does firing into dust
  clouds/shadows ever pay off, or is it pure ammo waste?
- **Decoy-as-fake-contact**: does dropping a decoy at range actually fool
  anyone into a chase? (It reads as an ordinary faint contact to ~148 km.)
- **Propellant as delta-v** (6000 m/s budget): do matches stall dry?
  EDGE pull returns strays, but a dry drifting duel could be long.
- **Collision damage curve**: 600 m/s hit = 14 hull. Punchy enough?
- **Drone patrol at 800 m/s with 12°/s steering**: does it dodge the rocks
  reliably? (It bounces harmlessly if not — drone takes trivial damage.)
- **Torpedo terminal dodges**: 45°/s turn at 6 km/s = wide arcs. Verify the
  "dodge late to waste its fuel" counterplay actually lands.

## Carried over from v3

- [ ] **Real PvP acceptance test in English** — nobody has fought a full
  PvP duel to a kill purely by typed/spoken English. Voice makes this easy.
- [ ] **Refine STT keyword handling** from accumulated `data/utterances.jsonl`
  (pull from Fly: `fly ssh console -C "cat /data/utterances.jsonl"`).
  NO bias prompt (see CLAUDE.md) — tune via post-processing if needed.
- [ ] **Ship design pick**: interceptor is default; gunship + saucer in
  client/assets — swap `SHIP_DESIGN` in render.js.

## Improvements (suggested)

- [ ] **Prompt caching** on the translator's system prompt (large, static;
  the schema grew again in v4) to cut per-utterance cost/latency.
- [ ] **Transcript replay on reconnect** — currently rejoins with an empty log.
- [ ] **Quieter repeat standing orders** — repeating triggers log every
  firing; batch or suppress repeats after the first.
- [ ] **Contact bearing/range readout in the HUD contact panel** (currently
  tier badge only; the map shows position).
- [ ] **Rock-impact crunch heuristic**: client infers a crunch from hull
  drop while a collision warning was active — could miss unwarned grazes.

## Known quirks (documented so nobody re-debugs them)

- Rendered ship icons are clamped to 22 px for legibility; at map scale that
  is enormously bigger than the 60 m hull — visual overlap ≠ collision.
- Rootless Docker on the dev machine doesn't route `-p` published ports;
  test containers with `--network host`. Irrelevant to Fly deploys.
- Missiles that lose all seeker candidates go permanently ballistic after
  2 s (reacquire window) — intended.
- The automation-driven browser can't synthesize wheel/held-key events the
  same way a human does; camera testing uses JS-dispatched events.
