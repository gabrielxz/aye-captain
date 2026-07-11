# HOW TO PLAY — Page copy & figure specs for /how-to-play

## Implementation notes (Claude Code — read first, do not render this section)

- One static HTML page at `/how-to-play`, linked prominently from the lobby ("HOW TO PLAY" button) and from the match banner. Same ops-console aesthetic as the game: dark, monospace headers, thin rules, teal accents. No framework.
- All figures are authored SVGs (you author them, same as the ship sprites), inline in the page so they inherit the theme. Figure specs are at the bottom of this document (FIG-1 through FIG-6). Two cheap CSS animations are specified; nothing else moves. No interactive demos — practice mode is the interactive demo.
- Numbers in the copy are deliberately rounded gameplay values, not constants.ts precision. When constants change, update the copy in the same commit. ADD TO CLAUDE.md INVARIANTS: "Any behavior change updates /how-to-play in the same commit."
- Keep the section IDs as anchors (#first-five-minutes etc.) so the Discord can deep-link.
- Sections below in order. Headings verbatim. Body copy verbatim or lightly adapted to fit layout.

---

# AYE, CAPTAIN — CAPTAIN'S HANDBOOK

You command a warship with your voice. Your ship's AI — your XO — translates your orders, runs your systems, and tells you what it sees. It is capable, literal, and unfailingly calm. It does exactly what you say, which is not always what you meant.

This handbook teaches you doctrine. The XO handles the rest. When in doubt about anything — ranges, fuel, what that contact is doing — just ask it.

---

## YOUR FIRST FIVE MINUTES  {#first-five-minutes}

Start a Practice match and say these, in order. Hold SPACE to talk (or press Enter and type).

1. **"Flank speed."** — You start accelerating. Note the propellant gauge draining.
2. **"Show me my vector."** — A line appears: where you're actually going. Watch it NOT change when you turn. That's space.
3. **"Come to a full stop."** — The XO flips the ship and burns until you're still. This is how braking works here. It costs fuel and time.
4. **"Throttle to twenty percent."** — Your propellant starts regenerating (only inside the zone, only at low throttle). This is how you refuel: by being patient.
5. **"Any contacts?"** — The XO reports what the sensors hold. Somewhere out there is a practice drone.
6. **"Point us at the contact."** — The helm answers. Now go hunting — the rest of this handbook is how.

---

## DOCTRINE I: SEE WITHOUT BEING SEEN  {#seeing}

**Detection is the game.** Battles are usually decided before the first shot: by who sees whom, first, and how well.

Your ship glows. Not with light — with *signature*: drive plume, heat, emissions. **Your throttle is your signature.** At full burn you can be seen from most of the map away. Cruising, from perhaps a hundred kilometers. Engines cold, drifting silent — you're a hole in the sky until someone gets close. Firing weapons spikes your signature: a torpedo launch is a flashbulb; even your defensive guns give you away.

[FIG-1: THE THROTTLE IS THE SIGNATURE]

What you see of the enemy comes in three grades:

- **FAINT** — something's out there. Approximate position, updated occasionally. No vector. You cannot shoot at a faint.
- **TRACK** — position and velocity, live. **You can get missile lock on a track.**
- **ID** — close enough to resolve everything, including whether that "ship" was ever a ship at all.

[FIG-2: FAINT → TRACK → ID]

Contacts harden as you close in — or as *they* burn harder. A patient captain closes dark and quiet; an impatient one lights the sky and hands the enemy a track for free.

**Terrain is sensor cover.** Rocks block line of sight completely — sensors, locks, missile seekers, everything. Dust clouds blind everyone inside and everything looking through them. The dark behind a rock is the best armor in the game.

**One more thing about decoys** (fully covered in Doctrine IV): a drifting decoy looks exactly like a distant cruising ship. That faint contact you've been stalking for three minutes may be a lie.

---

## DOCTRINE II: MOVE LIKE A NEWTONIAN  {#moving}

Your ship is not an airplane. **Turning does not change where you're going** — it changes where you're pointing. Velocity only changes when you burn.

Consequences you must internalize:

- To stop, you must **flip and burn**: face backwards along your vector and thrust. "Come to a full stop" makes the XO do the math.
- Speed is a purchase you must also pay to return. Every m/s you gain, you'll spend fuel to shed.
- At high speed your turn radius is enormous and rocks are lethal. A gentle bump scratches paint. Hitting rock at speed is a funeral.

[FIG-3: FLIP AND BURN]

**Propellant is a budget, not a fuel gauge.** A full tank is roughly: accelerate to flank speed once, and kill that speed once. That's it. The tank refills only inside the zone, only while your throttle is at 20% or less — refueling is a posture, and a quiet one (low throttle = low signature; the thrifty ship is also the hidden ship).

Run the tank dry and you drift — you can still turn and shoot, but your vector is no longer yours to choose until the scoop trickles something back.

**The edge.** Outside the zone ring: everyone can see you, nothing refuels you, and a current pushes you back toward the middle. You can't get stranded out there. You also can't hide, can't stay, and can't win.

Ask the XO anytime: *"show me my vector"*, *"how's our fuel?"*, *"what's our speed?"*

---

## DOCTRINE III: KILL WITH TORPEDOES  {#killing}

You carry six torpedoes and two launch tubes (they auto-reload; about twenty seconds). Torpedoes **burn hard, then coast**: a short, violent engine phase — faster than any ship, agile, hungry — then the tank runs dry and it's a ballistic round: still deadly on its exact line, blind to your maneuvers, and nearly invisible.

[FIG-4: LIFE OF A TORPEDO]

**The lock.** To fire properly you need missile lock: hold the target near your nose, in range, with a TRACK-grade contact, for about five seconds. **The enemy feels your lock** — their XO warns them the moment you start painting. The five seconds between "acquiring" and "lock" is the most honest tension in the game: they know it's coming.

**Why lock matters — the uplink.** A locked torpedo stays wired to your ship: you feed it live tracking as long as you hold the lock, it steers to an intercept point, and it **ignores decoys completely** — your sensors know a decoy from a hull, and the bird trusts you. Keep the lock, keep the kill.

Lose the lock (they break line of sight, go dark, or you die) and the bird goes **autonomous**: it hunts with its own small seeker, grabs the brightest thing it can see, and is fully spoofable. It does not re-uplink. Hold your locks.

**Blind fire.** You can launch without a lock — *"put a torpedo down bearing 220"* — and the bird rides that bearing hunting for anything bright. Against a dark target it will usually find nothing, or find a decoy. It's not a sniper rifle; it's a flashlight that explodes: flush a hider out of a dust cloud, force their defensive guns to reveal them, deny an escape vector. Six birds total. Spend like it.

(Hover your mouse anywhere on the map: the HUD reads out bearing and range to that spot. That's your plotting table.)

---

## DOCTRINE IV: DON'T DIE  {#surviving}

An enemy torpedo is beatable at every stage of its life — with a different tool at each stage.

**While they're acquiring:** break the geometry. Their lock needs you near their nose, in range, on their sensors as a track. Deny any one of those — turn the engagement, dive behind a rock, go dark before the track hardens.

**Against an uplinked bird:** decoys are useless — the enemy's sensors see through them. **You must break the lock first.** Rocks. Dust. Going cold. The instant their lock dies, the bird is orphaned.

**Against an autonomous bird:** now the decoy works — with one discipline: **throttle down first.** A decoy is bright, but a full burn is brighter; at high throttle the seeker keeps choosing *you*. The complete ritual, speakable in one breath:

> *"Break their lock — throttle down — decoy!"*

[FIG-5: BREAK, THROTTLE, SPOOF — three-panel sequence]

**Against a ballistic bird:** it cannot turn. It kills only along its line. Any lateral burn beats it — but you may not see it coming, because a coasting torpedo is nearly dark. Sometimes the first you'll hear is the XO: *"Ballistic inbound, close!"* — and then the guns.

**The PDCs.** Your point-defense cannons are automatic. Posture **FREE** (the default), they engage any inbound they can *see* within their bubble — a wall of probability, not a guarantee; salvos leak. Posture **HOLD** silences them. Why would you ever hold? Because firing PDCs lights you up. A hidden ship whose guns swat a stray torpedo has just told everyone exactly where it is. When you're dark and a bird is passing by that isn't tracking you — do you trust the dark, or trust the guns? That decision is yours, Captain, and it's never comfortable. (They also have limited ammunition, and they will happily waste it defending your decoy.)

**Last resorts:** outrun the burn phase and let the tank die chasing you — expensive, sometimes correct. And at knife range, everyone's PDCs chew everyone's hull. Closing to point blank is a murder-suicide pact; occasionally that's the right play too.

---

## DOCTRINE V: COMMAND, DON'T PILOT  {#commanding}

You have one voice and a ship full of systems. The XO closes the gap two ways.

**Ask questions.** *"How far out is he?" "Status of my birds?" "Full report."* The XO answers from the ship's actual sensor picture — it will not pretend to know what the sensors don't.

**Issue standing orders.** Conditional doctrine, stated once, executed the instant it triggers — faster than you ever could:

- *"If a missile comes at us, deploy a decoy and turn hard away."*
- *"When you get a track on him, tell me immediately."*
- *"If our fuel drops below twenty-five, warn me."*
- *"The moment he's in range and on our nose, fire tube one — and keep firing."*

Up to six at once. Cancel by name: *"belay missile defense."* Cancel everything: *"belay all."* A good captain's standing orders are half the battle fought in advance.

**The XO is literal.** It interprets ambiguity and tells you what it decided — it will not stop to ask. If it misheard you, that's part of command too. Speak like you mean it.

---

## THE PHRASEBOOK  {#phrasebook}

You can phrase things your own way — the XO is flexible. These are known-good patterns.

| You want to... | Say something like... |
|---|---|
| Go fast | "Flank speed" · "All ahead full" · "Throttle to sixty" |
| Go quiet | "Go dark" · "Cut engines" · "Throttle to fifteen and drift" |
| Turn | "Come left forty" · "Hard starboard" · "Steer 090" · "Point us at the contact" |
| Stop | "Come to a full stop" · "Kill our velocity" |
| Understand motion | "Show me my vector" · "What's our speed?" |
| Fuel | "How's our propellant?" · "Warn me at twenty-five percent" |
| Sensors | "Any contacts?" · "What's the range to him?" · "Is that contact real?" |
| Attack | "Fire tube one" · "Fire everything" · "Fire when he's on our nose and in range" |
| Blind fire | "Put a torpedo down bearing 220" · "Fire blind into that dust cloud" |
| Defend | "PDCs free" · "PDCs hold" · "Deploy a decoy" · "If we're painted, decoy and evade" |
| Manage doctrine | "What are my standing orders?" · "Belay missile defense" · "Belay all" |
| Everything else | "Damage report" · "Full report" · "Weapons status" |

---

## WHEN IN DOUBT  {#when-in-doubt}

Ask your XO. It knows the ship, it knows the sky, and it never gets tired of questions. The captains who win aren't the ones who memorized this page — they're the ones in constant conversation with their ship.

*Good hunting, Captain.*

---
---

## FIGURE SPECS (author as inline SVGs, ops-console palette)

**FIG-1 — "The Throttle Is the Signature."** One ship drawn three times in a horizontal row against dark space: (a) engines cold, tiny dim detection circle around it, caption "DARK — seen only up close"; (b) mid throttle, medium circle, caption "CRUISE — seen at range"; (c) full burn with bright plume, huge circle bleeding off the panel edge, caption "FLANK — seen across the map". Circles to relative scale (roughly 1 : 6 : 11). CSS animation: the full-burn plume gently flickers.

**FIG-2 — "Faint → Track → ID."** Three small panels. Panel 1: a fuzzy pulsing blob with a "?" and a stale timestamp — caption "FAINT: something's there. Can't shoot it." (CSS animation: slow pulse.) Panel 2: crisp contact icon with a velocity arrow — caption "TRACK: position + vector. Lock is possible." Panel 3: full ship icon with detail readout — caption "ID: everything — including whether it's really a ship."

**FIG-3 — "Flip and Burn."** A ship's curved journey in four beats along one path: burning forward (plume behind); coasting (no plume, velocity arrow persists); flipped 180° (nose backwards, still moving along the same arrow); burning against the arrow, arrow shrinking to a dot. Caption: "Turning changes your nose. Only burning changes your path."

**FIG-4 — "Life of a Torpedo."** A left-to-right timeline of one torpedo's flight: LAUNCH (flash icon, "everyone sees this"); BURN phase (bright plume, curving hard toward a target, labeled "fast, agile, hungry — ~25 seconds"); COAST phase (plume gone, dead-straight dashed line, labeled "ballistic: deadly on its line, blind, nearly invisible"); ends at either a detonation starburst or a small "self-destruct" fizzle. Below the timeline, three small counterplay markers pinned to phases: "outlast it" (burn), "break LOS / spoof" (mid), "sidestep it" (coast).

**FIG-5 — "Break, Throttle, Spoof."** Three-panel comic strip. Panel 1: enemy ship with a lock-line to the player's ship; player's ship dives behind a rock; lock-line severed with an X — caption "BREAK THE LOCK." Panel 2: player's plume shrinks to nothing — caption "THROTTLE DOWN (your burn out-shines your decoy)." Panel 3: decoy drifting bright, orphaned missile curving toward it, player's dark ship slipping away — caption "SPOOF THE ORPHAN."

**FIG-6 — "The Zone."** (Place in Doctrine II.) Top-down map schematic: zone ring, scattered rocks, one dust blotch, a ship outside the ring with three small annotations — "visible to everyone", "no refueling", "current pushes you home" — and a gentle arrow toward center. Caption: "You can't get stuck out there. You also can't stay."
