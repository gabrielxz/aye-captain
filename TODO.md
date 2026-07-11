# TODO — next steps

## v4.4 fix patch — three playtest reports, all reproduced live then fixed

- **"Stop engines" flipped the ship** (translator read it as full_stop):
  schema rule — naming the ENGINES is thrust 0; only stopping the SHIP is
  full_stop. Verified: "stop engines" → thrust 0, "all stop" → full_stop.
- **"Spin in a clockwise circle" affirmed but did nothing**: two layers.
  Sim: relative turns collapsed to an absolute goal + shortest-arc — 360°
  normalized to "already there" (silent no-op) and >180° turns went the
  WRONG way ("starboard 270" turned port 90). Fixed with a real `turn`
  goal mode carrying signed remaining degrees (physics.test.ts §7).
  Translator: spin = one relative turn, executed for real now; continuous
  rotation stays a stated non-capability.
- **"Lock missiles then fire both" never fired**: translator emitted an
  IMMEDIATE fire (ack even said "when ready") → rejected at t=0 (no lock
  yet), lock landed at t=3 with nothing armed. Schema rule + example:
  sequenced lock-then-fire = standing order on have_lock. Verified live:
  lock t=3 → salvo t=4 → two strikes.
- Side fix: stale pre-rebase detection numbers (181/16 km) inside
  ship_command_schema.json's set_thrust description → 234/54 km.
- New guard: every schema example must pass the validator
  (translator.test.ts).

## v4.3 playtest patch (HANDOFF-v4.3.md) — DEPLOYED 2026-07-11 with v4.2

- §1 standing-order bug: CONFIRMED as the translator emitting `lte` for
  "cut thrusters at 300" while below threshold (evaluator was clean —
  regression-pinned in orders.test.ts §8/§9). Fixed with schema rules +
  verbatim example; XO readbacks now state trigger direction ("when we
  REACH" vs "if we DROP BELOW"). Verified live against the API in both
  directions (below-threshold → gte, above-threshold → lte).
- §2 XO welcomes (practice line new, both pre-generated at boot), §3
  bearing-only cursor readout, §4 single labeled 50 km ring, §5 sensor
  rebase (SENSOR_BASE 180 km, SIG_BASE 30, decoy 100), §6 handbook
  (Reading the Map box, softened stealth copy, FIG-1 rescale). 328
  assertions green.

## Deferred by v4.3 (designed, NOT built — burn-hot incentives)

- [ ] **Speed-scaled ramscoop regen** — propellant regeneration scales with
  velocity, rewarding hot running. Positive incentive to burn; pairs with
  the v4.3 stealth-tax rebase.
- [ ] **Active sensor ping** — a loud, deliberate emission that lights up
  the pinger and paints everyone else. Burn-hot counterpart to passive
  stealth; gives a dark ship a reason to speak.

## v4.2 delta — spectator presence — DEPLOYED 2026-07-11 with v4.3

Lobby WATCH + room code joins as a spectator: omniscient referee view,
cosmetic callsign from a fixed pool (Ghost, Watcher, Echo, ... , -2 on
reuse), SPECTATOR badge with own callsign, silent WATCHING readout in the
players' top-left map corner (collapses to a count past 3, absent at 0).
No persistence, no commands, no rematch rights, no transcript/XO noise.
21 new assertions in `tests/spectator.test.ts`; handbook §SPECTATING added.

- [x] Deploy v4.2 + v4.3 together — commit d331c95, CI green, verified live

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

- **Opening hunt** (numbers re-based by v4.3 §5): spawns 300 km apart, dark
  ships see each other at ~54 km, cruise at ~144 km. Is finding each other
  fun or a slog? Knobs: SENSOR_BASE_M, spawn distance, drone signature.
- **Stealth tax (v4.3)**: dark is now an edge, not an off-switch — does
  play still collapse into slinking, or do throttles come up?
- **Faint-fix noise** (2 km, 5 s refresh): enough texture, or annoying?
- **Lock range 80 km vs detection**: a quiet ship can only be locked inside
  ~32 km (track band of sig 30) — provoking a burn matters. Working?
- **PDC kill prob 0.25/s**: spec says saturation salvos are SUPPOSED to
  leak — resist tuning up (there's a leak-rate test pinning the intent).
- **"Break lock, then spoof" two-step escape** (v4.1 §3 design
  consequence, flagged for playtest): does breaking the uplink via
  rocks/dust/going-dark and THEN decoying the orphaned bird actually land
  as a learnable doctrine?
- **Blind fire usefulness**: seeker base 40 km — does firing into dust
  clouds/shadows ever pay off, or is it pure ammo waste?
- **Decoy-as-fake-contact**: does dropping a decoy at range actually fool
  anyone into a chase? (It reads as an ordinary faint contact to ~180 km.)
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
