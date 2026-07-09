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

## v2 next

- [ ] **Refine STT keyword boosting** from accumulated
  `data/utterances.jsonl` (pull from Fly:
  `fly ssh console -C "cat /data/utterances.jsonl"`). Feed real phrasings
  into `STT_BIAS_PROMPT`.
- [ ] **Voice output for XO lines** — separate, later decision.

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
