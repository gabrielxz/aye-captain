# HANDOFF — CAMPAIGN PATCH 2: "Two Ships"

**Baseline: `campaign-anvil-1.1` (a2ae5c6).** Where this conflicts with
`HANDOFF-CAMPAIGN-v1.md` or the Anvil docs, **THIS DOCUMENT WINS.**

---

## 0. Intent

Two captains, one system, one Hunter. **A shared run.**

The design rests on one asymmetry:

> **You always know where your friend is. You never know what they can see.**

Transponders already give teammates permanent mutual ID, so position and status are
free. **Contacts are not.** There is **no datalink**, and there will never be one.
Every piece of sensor intelligence has to be *spoken out loud*.

**Do not build an in-game comms feature for this.** Players will be in a room together
or on voice chat regardless. The game's job is not to give them a channel — it is to
give them **different information worth talking about.**

---

## 1. The core play, and the one rule that makes it work

> **The Hunter pursues the loudest signature he can currently detect.**

That single rule creates the play the whole patch exists for:

- One captain **burns hard as bait.** The Hunter comes for him.
- The other **goes dark and loots** in the silence his friend bought.

It is a real sacrifice, it is an act of trust, and it produces a story every time.

### 1a. Targeting rules

- He targets the **loudest contact he currently holds.** He cannot target what he
  cannot detect.
- If he holds contact on only one ship, that is his target regardless of the other's
  signature.
- **Re-evaluate on a cadence** (not every tick), with **hysteresis**: only switch
  targets if the new one is meaningfully louder or meaningfully closer. He must not
  oscillate between two ships.

### 1b. This is already partly built

Anvil §9 required `mission.playerId` to become a list and the Hunter's target
selection to become a **query over player ships** rather than a stored reference.
That groundwork is the foundation of this patch — verify it landed and build on it.

---

## 2. The Hunter's difficulty: change nothing yet

Two players cut both ways, and the effects roughly cancel:

- **Harder:** two ships means twice the noise on the map. His job of *finding someone*
  gets easier.
- **Easier:** two ships means twice the guns, and he can only chase one.

**Ship the existing ladder unmodified and playtest it.** Do not pre-scale.

If it proves too easy, **the lever is Hunter count, not Hunter stats** — a second
Hunter forces the team to split, which is the interesting failure mode. Adding hull or
sensors to a single Hunter just makes him a bullet sponge who can still only chase one
person.

---

## 3. Teammate readouts ★

The bait play is only playable if you can see **who is louder.** This is the single
most important new readout in the patch.

**Teammate strip** (fog-legal in full — transponders already grant permanent mutual ID):

```
KESTREL   hull 78%  ·  sig 112  ·  84 km
```

- **Signature is the critical field.** It tells you who the Hunter is coming for.
- Hull, propellant, distance, bearing.
- Teammate rendered on the map and in the inset at all times, at ID tier.

**But NOT their contacts.** Never their contacts. That is the whole design.

### 3a. The XO calls it

The XO should surface the tactical read in voice, because it drives the core decision:

- *"Kestrel's the loudest thing on the board, Captain. He'll go for her."*
- *"We're louder than Kestrel now."* ← **this is the moment the bait play flips**, and
  the player needs to hear it.
- NEWS tier. Rate-limited hard — this is not a place to be chatty.

### 3b. HUD placement is temporary

The teammate strip lands in whatever space exists today. **Do not redesign the panel
for it.** Patch 3 is the panel redesign and it will absorb this properly.

---

## 4. Death is a role change, not a bench

**A downed captain is not out of the run.**

- They **spectate through the survivor's sensor picture only.** Not omniscient. **The
  fog holds** — they see exactly what their friend sees, nothing more.
- **They can still talk.** They become the second brain: reading the board, watching
  the gate clock, doing the arithmetic while their friend flies.
- **They return at the next system**, in a fresh base ship, **with an empty hold.**
  Losing your cargo is the cost.

### 4a. A dead captain's ship becomes a hulk ★

The wreck carries **their entire hold**, at their death velocity, under all the Hulk
rules from Patch 1.1 (0.4 momentum retention, rock collision, shroud entrainment).

**Your friend's cargo is floating out there and you can go get it.** That is one of the
best moments available in this design and it costs nothing — it is the existing hulk
system pointed at a different ship.

### 4b. Both dead = run over

Standard run-summary screen.

---

## 5. The gate

**The system does not advance until both captains are through, or dead.**

The first captain through does **not** sit idle:

> **Once through the gate, you spectate your partner — through *their* sensors — and
> you coach.**

Same mechanic as §4. You are on the other side, you can see what they see, you can talk,
and you can do nothing else. **Watching your friend run a closing gate while you can
only call the numbers is excellent, and it uses code you already have.**

If the gate closes on a captain still in-system: **they die** (`STRANDED`), per Patch 1.
The survivor continues alone, and their partner returns at the next system.

---

## 6. Ship-to-ship transfer

Two holds, two captains, one set of good loot. **They need to be able to hand things
over.**

```json
"come_alongside": { "target": "<teammate callsign>" }
```

- Reuses the **exact** `salvage` rendezvous — the relative-velocity frame from Patch
  1.1 already handles a moving target. **The teammate is just a wreck that shoots
  back.**
- Same gate: `|v_rel| < SALVAGE_STOP_SPEED_MPS` and inside dock range.
- Transfers consumables (propellant, hull repair, ammo, missiles, ore).
- Respects maneuver discipline — a **silent** rendezvous with a friend while something
  hunts you both is exactly the kind of thing this game should be able to do.

**Without this, co-op is two people playing solo in the same room.** The transfer is
what makes them a crew.

*(Module transfer arrives with modules, in Patch 5. Consumables only for now.)*

---

## 7. Lobby and ship select

- Standard create/join, modeled on the existing multiplayer lobby path.
- **Both captains see each other's archetype choice before locking in.** Complementary
  builds are a real pre-game decision — *"you take the Cruiser and tank him, I'll scout
  in the Corvette"* — and it costs nothing to enable.

**The run lives in the Match object, in memory, for one sitting.** No save, no resume,
no persistence. If the host drops, the run ends. Say so plainly in the UI.

---

## 8. Tests

- **Hunter targeting** — pursues the loudest **detected** signature; with contact on
  only one ship, targets that one regardless of the other's signature; **does not
  oscillate** between two comparably-loud targets (hysteresis pinned).
- **🔴 Fog — no datalink.** A teammate's snapshot contains their **position, velocity,
  hull, propellant, and signature** — and **never their contacts, rumbles, or ghost.**
  **This is the patch's central invariant. Pin it hard.**
- **The bait play works end to end** — ship A at 100% throttle and ship B coasting, both
  detected: the Hunter pursues A. B, running dark, completes a salvage transfer
  untouched.
- **Death** — a downed captain's snapshot is derived from the **survivor's** snapshot,
  not from sim truth. Assert it contains nothing the survivor cannot see.
- **Dead captain's hulk** — carries their full hold at their death velocity, and obeys
  every Patch 1.1 hulk rule.
- **Gate** — the system does not advance until both are through or dead; a captain
  through the gate spectates the other's picture; a captain in-system at closure gets
  `STRANDED` and the survivor continues.
- **Transfer** — every existing salvage test passes **unchanged**; a teammate at
  matched velocity can receive consumables; at 800 m/s relative, cannot.
- **Solo campaign is unchanged** — every existing campaign test green, untouched.

---

## 9. Build order

1. `npm test` green on `campaign-anvil-1.1`. Branch `campaign-coop`.
2. **Verify Anvil §9 landed** — `mission.playerId` as a list, Hunter targeting as a
   query. If not, that is step zero.
3. **Two ships in a campaign Sim.** Lobby, join, ship select, spawn. Get two people
   flying in one system with a Hunter before anything else.
4. **§1 Hunter targeting** + **§3 the teammate strip and XO lines.** *Then fly the bait
   play.* **If it doesn't work, stop and report** — it is the patch.
5. **§4 death** and **§5 the gate.**
6. **§6 transfer.**
7. Playtest with two humans. Report.

---

## 10. Non-goals

- **A datalink**, or any shared contact picture. Ever.
- **In-game comms plumbing.** Players talk out of band. §0.
- **The panel redesign.** The teammate strip lands wherever it fits. Patch 3.
- **Modules, mass, power.** Patch 4/5. Transfer is consumables only.
- **Standing-order changes.** Patch 6.
- **Scaling the Hunter for two players.** §2. Playtest first.
- **Save/resume of a co-op run.** One sitting, in memory.
- **More than two captains.** Two. Get two right first.
