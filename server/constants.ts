// EVERY tunable number lives here. No magic numbers in sim code.

export const TICK_RATE_HZ = 1; // command tick: queued commands, standing orders, LLM interaction
// Physics runs PHYSICS_SUBSTEPS times per command tick (10 Hz at 1 Hz ticks).
// At v4 speeds objects move km per command tick; substeps + swept-segment
// collision keep fast movers from tunneling through fuses and terrain.
export const PHYSICS_SUBSTEPS = 10;
// Snapshots broadcast faster than the command tick so client interpolation
// stays smooth at high speeds. Commands still process at TICK_RATE_HZ.
export const SNAPSHOT_RATE_HZ = 4;

// Region ("the shroud" — visible ring on map). No hard wall: outside the
// region there is no propellant regen, ships read signature-max (tier ID at
// any range), and a restoring current pulls back toward center. Fiction:
// the shroud's mass. No ship can be stranded — the pull always eventually
// returns a derelict.
export const REGION_RADIUS_M = 250000; // 250 km; crossing time ~2.8 min at flank. LINKED: SPAWN_DIST_FROM_CENTER_M sits at 60% of it
// LINKED to MAX_SPEED_MPS: tuned so a full-speed (3 km/s) exit turns
// around in ~24s with ~42 km max excursion, not minutes (the old 5/50
// values dated from 600 m/s ships and were never revisited when speeds
// quintupled; the v4.5 handoff's 15/150 was measured at 91 s and retuned
// with sign-off to meet its own ~20-25 s intent). Retune if MAX_SPEED
// changes again.
export const EDGE_PULL_MPS2_PER_50KM = 300; // grows linearly with distance beyond the edge
export const EDGE_PULL_CAP_MPS2 = 150;

// Ship. Full tank = 100 s of hard burn = 6000 m/s of delta-v: propellant is
// a delta-v budget — enough to reach flank speed and kill it once.
export const MAX_SPEED_MPS = 3000; // LINKED to region size + EDGE_PULL tuning (the missile-speed link was broken deliberately in v4.5); SHARED across archetypes (identity lives in accel/turn/sig)
export const ACCEL_FULL_THRUST_MPS2 = 60; // ~6g hard burn; top speed in ~50 s. LINKED: == ARCHETYPES.frigate.accel (the baseline; drone + static prompt use this)
export const TURN_RATE_DEG_PER_SEC = 20; // LINKED: == ARCHETYPES.frigate.turn
export const HULL_POINTS = 100; // LINKED: == ARCHETYPES.frigate.hull

// v5 §4: ship archetypes — NUMBERS ONLY for v5 (design policy: stat
// blocks, no special abilities; the railgun loadout row is the first
// sanctioned asymmetry). The FRIGATE row IS the v4 baseline — its values
// are LINKED to the legacy globals below and must never drift from them.
// Corvette: the ghost — dim, fast-cycling, deception-rich, best eyes, and no
// rail in its STARTING loadout. (It used to say the keel can't take a spinal
// mount. The Loadout patch made that false and never came back here: nothing
// gates modules on hull — landModule checks slots and reactor headroom only,
// and loadout.test.ts pins a corvette mounting a looted rail on purpose.
// Archetypes are starting hulls, not classes.)
// Cruiser: the thunderstorm — audible at map scale perpetually (sig 45
// cannot hide; intended), deep magazines, wins by making you come to it.
// railguns/railSlugs (§5) and probes (§6) are declared here so a loadout
// is one row; the weapons land in their own build-order steps.
export type ArchetypeName = "corvette" | "frigate" | "cruiser";
export interface ArchetypeStats {
  hull: number;
  accel: number; // m/s² at full thrust
  turn: number; // deg/s
  sigBase: number; // signature of a drifting dark hull
  sensorBase: number; // m; detection = sensorBase x target sig / 100
  tubes: number;
  magazine: number; // missiles aboard total (tubes start loaded from it)
  tubeReload: number; // s
  decoys: number;
  pdcAmmoS: number;
  railguns: 0 | 1;
  railSlugs: number;
  probes: number;
}
export const ARCHETYPES: Record<ArchetypeName, ArchetypeStats> = {
  corvette: { hull: 60, accel: 85, turn: 39.2, sigBase: 20, sensorBase: 210000, tubes: 1, magazine: 4, tubeReload: 20, decoys: 6, pdcAmmoS: 40, railguns: 0, railSlugs: 0, probes: 4 }, // turn 28 → 39.2: Anvil §5, +40% exactly (the wanted turn-rate pass, corvette leg)
  frigate:  { hull: 100, accel: 60, turn: 20, sigBase: 30, sensorBase: 180000, tubes: 2, magazine: 6, tubeReload: 30, decoys: 4, pdcAmmoS: 60, railguns: 1, railSlugs: 20, probes: 2 },
  cruiser:  { hull: 160, accel: 40, turn: 14, sigBase: 45, sensorBase: 160000, tubes: 3, magazine: 9, tubeReload: 30, decoys: 4, pdcAmmoS: 90, railguns: 1, railSlugs: 30, probes: 1 },
};

// ===== Patches 4+5 "The Loadout" (HANDOFF-PATCH-4-5-LOADOUT.md, as amended
// by AMENDMENT-THE-UNIFICATION.md — the amendment WINS) =====================
//
// THE LAW: everything you run makes noise. Power draw IS signature (§0).
// THE CALIBRATION (amendment §3): the ARCHETYPES table above is THE BOOK —
// the observable stats of an archetype CARRYING ITS STARTING LOADOUT with
// an empty hold. It does not change. The internals below (thrustForce,
// turnTorque, base hull/probes) are DERIVED from the book so that a
// starting-loadout ship is bit-identical to today at every throttle.
// Looting degrades from there: getting stronger costs speed and silence,
// in every mode. NO rubber-banding on top — the economy self-corrects
// (amendment §2; the lever, if 1v1 snowballs, is POWER_TO_SIG).

export type ModuleId =
  | "baffles"
  | "deep_array"
  | "railgun"
  | "mine_layer"
  | "armor_plate"
  | "probe_rack"
  | "drive_tune";
export interface ModuleSpec {
  name: string; // display + XO vocabulary
  mass: number;
  power: number; // reactor draw while powered; 0 = PASSIVE (works installed)
}
// §4: the FIVE first (plus probe_rack — it's in the frigate's starting
// loadout per the amendment table). The rest of the catalog ships only
// after these prove out in the playtest. Do not add them early.
export const MODULES: Record<ModuleId, ModuleSpec> = {
  baffles: { name: "engine baffles", mass: 2, power: 1 }, // −25% total sig while powered
  deep_array: { name: "deep array", mass: 1, power: 4 }, // +60% sensor range while powered — seeing costs being seen
  railgun: { name: "railgun", mass: 4, power: 2 }, // must be POWERED to fire (fire auto-lights it)
  mine_layer: { name: "mine layer", mass: 3, power: 1 }, // drop mines while powered — the chase becomes the trap
  armor_plate: { name: "armor plate", mass: 5, power: 0 }, // +hull, pure mass — proves the cost
  probe_rack: { name: "probe rack", mass: 2, power: 0 }, // +probes, passive
  // cc ruling 1: the accel stat-bump's priced replacement (the migration
  // table pulls Drive Tune forward from the full catalog)
  drive_tune: { name: "drive tune", mass: 1, power: 2 }, // +15% thrust force while lit
};
// Amendment §3: hardcoded archetype capabilities become starting loadouts.
// Corvette: no railgun — exactly as today. Frigate/Cruiser: railgun aboard.
export const STARTING_LOADOUT: Record<ArchetypeName, ModuleId[]> = {
  corvette: ["baffles"],
  frigate: ["railgun", "probe_rack"],
  cruiser: ["railgun", "armor_plate"],
};
// §2 archetype table: slots + reactor (the reactor is the archetype's
// soul: the corvette is a tight deck, the cruiser a greedy one), plus
// baseMass (the bare hull — LOW/MID/HIGH; units are module-masses).
export const ARCH_SLOTS: Record<ArchetypeName, number> = { corvette: 4, frigate: 6, cruiser: 8 };
export const ARCH_REACTOR: Record<ArchetypeName, number> = { corvette: 6, frigate: 9, cruiser: 12 };
export const ARCH_BASE_MASS: Record<ArchetypeName, number> = { corvette: 30, frigate: 60, cruiser: 100 };
// §2: one number, two consequences — a powered module spends the reactor
// AND makes you loud. TUNE: a fully-lit cruiser (12 draw = +96) should be
// roughly as loud as a corvette at full burn (120).
export const POWER_TO_SIG = 8;
// §4 module effects (the five)
export const BAFFLES_SIG_MULT = 0.75; // −25% TOTAL signature while powered
export const DEEP_ARRAY_SENSOR_MULT = 1.6; // +60% sensor range while powered
export const ARMOR_PLATE_HULL = 40; // +hull per installed plate (passive)
export const DRIVE_TUNE_THRUST_MULT = 1.15; // per lit drive tune
// ⚠️ DEVIATION from the base doc's "+4 probes": the frigate STARTS with a
// rack, and the amendment's non-regression law pins its spawn probes at
// the book's 2 — base-minus-effect derivation forces the rack's grant to
// 2 (book 2 − rack 4 would need −2 base probes). Flagged in the check-in.
export const PROBE_RACK_PROBES = 2;
export const RAIL_SLUGS_LOOTED = 20; // magazine granted by a looted railgun (frigate book: 20)
// §3b THE WORKSHOP RULE: anything that modifies the ship requires a full
// stop (same threshold as salvage) and takes real time; any thrust
// command aborts and loses that module's progress.
export const MODULE_INSTALL_S = 60;
// §6 ore: feedstock, not currency — no shop, ever. One unit = one mass.
export const ORE_UNIT_MASS = 1;
// §4 mines (mine layer): a dropped mine station-keeps where it's laid
// (cold-gas trim — a drifting mine would just follow its layer). Sensor
// rules apply to it like all ordnance (invariant 9); prox fuse carries
// the layer's team stamp (invariant 16: fuses are GUIDED systems).
export const MINE_SUPPLY = 6; // per mine layer module, no reloads
export const MINE_SIGNATURE = 8; // near-silent: seen only up close
export const MINE_PROX_RADIUS_M = 800;
export const MINE_DAMAGE = 35;
export const MINE_ARM_S = 5; // won't fuse on the layer sailing away
export const MINE_DROP_COOLDOWN_S = 3;

// Derived calibration internals — never hand-edit these.
const startingMass = (a: ArchetypeName) =>
  STARTING_LOADOUT[a].reduce((s, m) => s + MODULES[m].mass, 0);
// calibMass = what the book's stats were measured with (amendment §3)
export const ARCH_CALIB_MASS: Record<ArchetypeName, number> = {
  corvette: ARCH_BASE_MASS.corvette + startingMass("corvette"),
  frigate: ARCH_BASE_MASS.frigate + startingMass("frigate"),
  cruiser: ARCH_BASE_MASS.cruiser + startingMass("cruiser"),
};
// thrustForce = accel_book × calibMass; turnTorque = turn_book × calibMass
// (§1: accel = force/mass, turn = torque/mass — braking distance follows)
export const ARCH_THRUST_FORCE: Record<ArchetypeName, number> = {
  corvette: ARCHETYPES.corvette.accel * ARCH_CALIB_MASS.corvette,
  frigate: ARCHETYPES.frigate.accel * ARCH_CALIB_MASS.frigate,
  cruiser: ARCHETYPES.cruiser.accel * ARCH_CALIB_MASS.cruiser,
};
export const ARCH_TURN_TORQUE: Record<ArchetypeName, number> = {
  corvette: ARCHETYPES.corvette.turn * ARCH_CALIB_MASS.corvette,
  frigate: ARCHETYPES.frigate.turn * ARCH_CALIB_MASS.frigate,
  cruiser: ARCHETYPES.cruiser.turn * ARCH_CALIB_MASS.cruiser,
};
// base hull/probes = book minus the starting loadout's passive grants
// (the cruiser's 160 already includes its plate; the frigate's 2 probes
// already include its rack)
const startingCount = (a: ArchetypeName, m: ModuleId) =>
  STARTING_LOADOUT[a].filter((x) => x === m).length;
export const ARCH_BASE_HULL: Record<ArchetypeName, number> = {
  corvette: ARCHETYPES.corvette.hull - startingCount("corvette", "armor_plate") * ARMOR_PLATE_HULL,
  frigate: ARCHETYPES.frigate.hull - startingCount("frigate", "armor_plate") * ARMOR_PLATE_HULL,
  cruiser: ARCHETYPES.cruiser.hull - startingCount("cruiser", "armor_plate") * ARMOR_PLATE_HULL,
};
export const ARCH_BASE_PROBES: Record<ArchetypeName, number> = {
  corvette: ARCHETYPES.corvette.probes - startingCount("corvette", "probe_rack") * PROBE_RACK_PROBES,
  frigate: ARCHETYPES.frigate.probes - startingCount("frigate", "probe_rack") * PROBE_RACK_PROBES,
  cruiser: ARCHETYPES.cruiser.probes - startingCount("cruiser", "probe_rack") * PROBE_RACK_PROBES,
};

// Signature & detection: DETECTION IS THE GAME. Drive plumes are visible
// across enormous distances; going dark is the only stealth.
// ship signature = SIG_BASE + EFFECTIVE thrust% (30..130), plus spikes.
// v4.3 rebase: SIG_BASE 10 -> 30, SENSOR_BASE_M 165 -> 180 km — playtest
// showed stealth was FREE (dark = off-switch); dark is now an edge: a
// drifter is still contact-visible at ~54 km, just not lockable until ~32.
export const SIG_BASE = 30; // a drifting dark ship. LINKED: == ARCHETYPES.frigate.sigBase
// Patch 3.5 crossover deadband. The predicate reduces to `sig > SIG_BASE`,
// and the FRIGATE's sigBase IS SIG_BASE — so at idle it sits exactly on the
// boundary and 1% of thrust flipped it, re-speaking the line once a second
// forever (playtest 2026-07-14: "so annoying"). A crossing must now clear
// the book by this factor in the direction of travel. Consequence worth
// knowing: a frigate can never get back UNDER (its floor is the book), so
// it says the line once and means it.
export const RINGS_CROSSOVER_HYSTERESIS = 1.15;
export const SIG_SPIKE_LAUNCH = 150; // missile launch flash (replaces the flat reveal)
export const SIG_SPIKE_LAUNCH_S = 5;
export const SIG_SPIKE_PDC = 50; // PDC firing (used by v4 §6)
export const SIG_SPIKE_PDC_S = 3;
export const MISSILE_SIG_BURNING = 80;
export const MISSILE_SIG_COASTING = 8; // a ballistic torpedo is nearly invisible. Intended. Terrifying.
// detection_range = SENSOR_BASE_M x (signature / 100), LOS permitting
// -> full burn (130) seen at ~234 km; 50% cruise (80) at ~144 km; dark drift (30) at ~54 km
export const SENSOR_BASE_M = 180000; // LINKED: == ARCHETYPES.frigate.sensorBase
// v4.5 hearing channel: a second, concentric information ring driven by the
// SAME signature. Beyond detection but within hearing, an emitter produces a
// RUMBLE: bearing only — no range, no vector, no tier. Rocks/dust do NOT
// block hearing (the shroud carries drive rumble like water carries sound);
// only distance vs signature matters. DESIGN LAW: this system is continuous
// end to end — NO thresholds anywhere (a threshold instantly becomes a
// throttle policy). Stealth is a speed tax, not an off-switch: silent, or
// going somewhere — not both.
export const HEARING_RANGE_MULT = 2.5; // hearing = detection x 2.5: dark ~135 km, cruise ~360 km, flank map-wide
export const RUMBLE_SHIFT_ANNOUNCE_DEG = 15; // XO re-announces a rumble when its bearing drifts this far
// v5.1 §3.1: GLOBAL rumble-announcement budget, one line per window — the
// old 10 s PER-EMITTER limit meant N=6 entitled five emitters to a line
// every 2 s for the whole match (a constant tuned at N=2, run at N=8).
// When the budget fires, changes AGGREGATE into one line naming at most
// MAX_BEARINGS bearings, loudest first ("Three drives out there, Captain —
// bearings zero-four-zero, one-eighty, and two-nine-five").
export const RUMBLE_ANNOUNCE_COOLDOWN_S = 15;
export const RUMBLE_ANNOUNCE_MAX_BEARINGS = 3;

// v5.1 §3.3-3.4: the XO announces change in THREAT, not change in
// information — a tier transition speaks only when the contact is within
// contactAnnounceRange(boardCount) = clamp(BASE / max(1, n), MIN, BASE),
// or holds a lock on us, or is the only contact on the board. Everything
// below the bar is transcript-only. 1 contact -> 60 km (tell me
// everything); 3+ -> floored at 20 km (only what can hurt me).
export const CONTACT_ANNOUNCE_RANGE_BASE_M = 60000;
export const CONTACT_ANNOUNCE_RANGE_MIN_M = 20000;

// v4.5 active ping — the information ladder's second rung (HEARING bearing
// -> aimed PING -> passive TIERS -> LOCK). A ping FINDS ships; it does not
// shoot them: PING_TRACK_S deliberately cannot complete a LOCK_TIME_S lock
// on a target passive sensors can't sustain. Do not extend without design
// signoff.
export const PING_RANGE_M = 150000; // everything within, LOS permitting (rocks/dust block)
export const PING_TRACK_S = 5; // granted TRACK tier duration, then decay to passive
export const PING_REVEAL_S = 10; // the pinger reads ID tier to ALL ships, map-wide, no LOS — you screamed
export const PING_COOLDOWN_S = 30;
// v4.7: the ping fx ships a precomputed occlusion mask so the client ring
// can tear open behind rocks/dust without a client-side raycast port.
export const PING_SHADOW_SAMPLES = 180; // 2 deg resolution

// THERMAL SIGNATURE MEMORY. Cutting the drive used to make you dim on the very
// next tick, which made going dark a SWITCH rather than a commitment and
// invited strobing: light the array, take a snapshot, power down, burn for one
// second, vanish. The hull remembers now — signature floors at a decaying
// high-water mark of the SUSTAINED emission (sigBase + effective thrust +
// reactor draw). You can still become hard to detect; you can no longer erase
// the last ten seconds of your own behaviour.
//
// What it deliberately does NOT remember: the transient weapon spikes
// (SIG_SPIKE_LAUNCH / _PDC / RAIL_SIG_SPIKE). Those already carry their own
// timers and are the "you flashed" mechanic; feeding them in would turn a 5 s
// launch flash into ~20 s of glow — a balance change nobody asked for. The
// strobing problem was always about THRUST and POWER, so that is what this
// fixes. Spikes still add on top.
//
// A RATE, not a window: a bigger flare glows longer, which is the honest
// relationship and it prices a hard burn above a module. At 10/s a frigate at
// full burn (emission 130) needs ~10 s to reach its cold floor of 30 — the
// 10 s the audit suggested starting from. Tune BY EAR/EYE against the voice
// disc, which renders this for free (voiceRangeM reads signatureOf).
//
// Continuous end to end — a decaying float plus a max(), no thresholds
// anywhere, so invariant 13 (the hearing channel) holds. Invariant 8 still
// holds literally (the emission uses EFFECTIVE thrust, so a dry ship's
// emission does collapse) — what changes is that its GLOW now outlives the
// fuel, which is the intended lesson.
export const THERMAL_DECAY_PER_S = 10;

// v5 §5: the railgun. Frigate & Cruiser ship with one; a corvette can loot
// and mount one (see STARTING_LOADOUT above — hull is not a gate).
// SOLUTION mode computes constant-velocity lead against a
// TRACK-or-better contact and fires immediately (no lock timer — the slug
// can't be guided, so there's nothing to hold): deadly against ballistic
// targets, and ANY thrust during flight breaks the assumption. This is the
// designed anti-drifter — every posture now has a predator (missiles
// punish burners, rails punish coasters, PDCs punish missiles). BEARING
// mode is a manual skill shot. Slugs are physical: rocks stop them, they
// can hit missiles/decoys/probes en route, they check NO IFF (the game's
// only friendly-fire vector), and PDCs cannot engage them.
// Dodge math for the tuning pair (speed, hit radius): at 60 m/s² a
// reacting target displaces ~190 m over a 20 km shot (flight ~3.3 s) —
// dodgeable when alert; a drifter displaces 0.
export const RAIL_SLUG_SPEED_MPS = 6000; // LINKED: 2x MAX_SPEED_MPS, 2.5x MISSILE_MAX_SPEED_MPS — must far exceed ship speed or the weapon has no envelope
export const RAIL_HIT_RADIUS_M = 100; // swept-segment collision, MANDATORY (invariant 6)
export const RAIL_DAMAGE = 25;
export const RAIL_COOLDOWN_S = 6;
// Anvil 1.1 §4: the firing solution is gated on CONTACT TIER — a reward
// for winning the sensor game. ID (3) = pinpoint, current behavior.
// TRACK (2) = a CONE: uniform angular dispersion, so the miss grows
// linearly with range. FAINT can't lock (unchanged — bearing fire only).
// The Hunter defeats the rail by maneuvering; the player by earning ID.
export const RAIL_TRACK_DISPERSION_DEG = 1.2; // ± at TRACK tier
export const RAIL_SIG_SPIKE = 80; // rail fire is HEARD; "if you hear rail fire, burn"
export const RAIL_SIG_SPIKE_S = 3;
// Not in the handoff: slugs need an end. 60 s covers a full map crossing
// at worst-case closing speeds (6 km/s + inherited 3 km/s = 540 km).
export const RAIL_SLUG_LIFETIME_S = 60;
// A slug has no drive — it is nearly invisible in flight (the FIRING is
// what you hear). Same near-nothing signature as a coasting torpedo.
export const RAIL_SLUG_SIG = 8;

// v5 §6: sensor probes — remote ears (and reduced eyes). A probe is
// implementation-wise a decoy with sensors: burn-and-drift ballistics,
// findable if hunted (PDCs engage it, slugs hit it, seekers can grab it),
// and it RELAYS its picture to the owning captain live, merged into their
// map with "via probe" provenance. All fog rules apply FROM THE PROBE'S
// POSITION (it can be LOS-blocked; it hears through terrain). The design
// payoff: a rumble heard by your ship AND your probe = two bearing
// chevrons = a human-triangulated fix — the XO still never triangulates
// (deliberately human skill, v4.5 law). Probe-relayed tiers deliberately
// do NOT feed missile locks (the information ladder: probes FIND ships;
// locks need your own sensors). Counts per archetype; no reloads.
export const PROBE_ACCEL_MPS2 = 150; // along the launch bearing, then drifts
export const PROBE_BURN_S = 20;
export const PROBE_LIFETIME_S = 180;
export const PROBE_SENSOR_BASE_M = 60000; // reduced eyes; FULL hearing (same multiplier)
export const PROBE_SIGNATURE = 25; // findable if hunted

// v5 §7: ship-to-ship comms. BROADCAST reaches every captain and costs a
// COMMS SPIKE on the hearing channel — a bearing chevron for everyone,
// with the sender's CALLSIGN attached (voiceprint): talking is a tactical
// act. TIGHTBEAM is private and needs a current TRACK on the recipient
// (you must know where to point the dish) — except teammates, always
// reachable (fleet encryption): no spike, no reveal. Delivery is
// VERBATIM: the receiving XO reads the message aloud. Relayed messages
// are the game's only unbounded dynamic TTS — the char cap is the cost
// control.
export const COMMS_SPIKE_S = 5;
export const COMMS_COOLDOWN_S = 10; // per channel per ship
export const MESSAGE_MAX_CHARS = 140;

// Contact tiers, as fractions of the computed detection range:
export const TIER_FAINT_FRAC = 1.0; // approximate position only, no vector
export const TIER_TRACK_FRAC = 0.6; // true position + velocity, continuous
export const TIER_ID_FRAC = 0.3; // + ship status detail
export const FAINT_POS_NOISE_M = 2000;
export const FAINT_UPDATE_INTERVAL_S = 5;

// Propellant
export const PROPELLANT_MAX = 100;
export const PROPELLANT_BURN_AT_FULL = 1.0; // units/sec at 100% thrust, linear with thrust %
export const PROPELLANT_REGEN_PER_S = 0.33; // only inside zone AND throttle SETTING <= REGEN_MAX_THRUST_PCT
export const REGEN_MAX_THRUST_PCT = 20;

// Missile lock (required to fire). MISSILE LOCK REQUIRES TIER_TRACK OR
// BETTER — close in, or provoke a burn, before you can shoot.
export const LOCK_CONE_HALF_ANGLE_DEG = 30;
export const LOCK_RANGE_M = 80000;
export const LOCK_TIME_S = 5; // continuous seconds in cone+range+tracked to acquire
export const LOCK_GRACE_S = 2; // integer: honest at 1 Hz tick; favors lock stability

// Launch tubes
export const TUBE_COUNT = 2; // LINKED: == ARCHETYPES.frigate.tubes
export const TUBE_RELOAD_S = 30; // LINKED: == ARCHETYPES.frigate.tubeReload. Per tube, tubes reload in parallel (v4.5: a full salvo is FELT — staggered fire is doctrine)
export const AUTO_RELOAD = true; // reload_tubes verb is a no-op while true

// PDCs (point-defense cannons; replaced the laser in v4 §6). Automated,
// commanded by POSTURE (free|hold). Mutual PDC range is a mutual mauling —
// closing to knife range is a deterrent by design. Saturation salvos are
// SUPPOSED to leak: don't tune the kill probability up.
export const PDC_RANGE_M = 8000; // vs inbound missiles, LOS required
export const PDC_KILL_PROB_PER_S = 0.25; // per engaged missile, substep-scaled
export const PDC_SHIP_RANGE_M = 3000; // vs enemy ships, LOS required
export const PDC_SHIP_DPS = 5; // continuous hull damage
export const PDC_AMMO_S = 60; // seconds of cumulative fire; no regeneration. LINKED: == ARCHETYPES.frigate.pdcAmmoS

// Missiles: burn-and-coast torpedoes. MAGAZINE is everything aboard:
// TUBE_COUNT start loaded, the rest are reserves (6 total shots per match).
// Engine is ON whenever (below max speed) OR (turning to track); engine-on
// drains propellant at 1/s. Dry = BALLISTIC: no accel, no turning, flies its
// line until lifetime, impact, or PDC kill — still detonates on prox.
export const MISSILE_MAGAZINE = 6; // LINKED: == ARCHETYPES.frigate.magazine
// v4.5 retune: engagements actually start 20-50 km (post sensor rebase),
// which was inside the old 6 km/s missile's no-counterplay zone. 2400 m/s
// is deliberately BELOW MAX_SPEED_MPS (0.8x): outrunning the burn is a
// real play, PDC bubble transit ~triples, cover inside ~10 km is reachable.
// (The old value was the 2x-ship-max link; that link is intentionally
// broken — flag any future retune against actual engagement ranges.)
export const MISSILE_MAX_SPEED_MPS = 2400;
export const MISSILE_ACCEL_MPS2 = 150; // top speed in ~16 s
export const MISSILE_PROPELLANT_S = 25; // engine-on seconds
export const MISSILE_TURN_RATE_DPS = 45; // ONLY while the engine is on
// false = guidance steers the velocity vector directly, speed ramps from
// inherited launch speed to max. true = future experiment: missile facing
// decouples from velocity and thrust burns along facing (Newtonian, much
// floatier). NOT implemented — stub for a later milestone.
export const NEWTONIAN_MISSILES = false;
export const MISSILE_LIFETIME_S = 120; // absolute self-destruct
export const MISSILE_LAUNCH_DELAY_TICKS = 2; // flies straight, no seeking, during delay
export const MISSILE_ACQ_CONE_DEG = 30; // half-angle of the AUTONOMOUS seeker cone (v4.5: blind fire needs a good bearing, not a gesture; uplinked steering unaffected)
// Seekers use the standard detection formula with their own (weak) base:
// seeker detection = MISSILE_SEEKER_BASE_M x target signature / 100, LOS
// required -> full-burn ship (130) at ~52 km; dark drifter (30) at ~12 km.
// Blind fire is a flushing tool, not a sniper rifle.
export const MISSILE_SEEKER_BASE_M = 40000;
export const MISSILE_PROX_FUSE_M = 200;
export const MISSILE_ARMING_DIST_M = 3000; // fuse inert until the bird is this far from its launch point — point-blank launches dud past the target
export const MISSILE_DAMAGE = 35;

// Decoys. Signature sits BETWEEN cruise and full burn (LINKED to SIG_BASE:
// must stay above SIG_BASE + ~50 and below SIG_BASE + 100): a ship at
// effective thrust <~70% is out-shone by its decoy (spoof works); hotter
// out-shines it (spoof fails). Doctrine: "break the lock, throttle down,
// decoy." Side effect to preserve: a drifting decoy reads as an ordinary
// faint/track contact to enemy SHIP sensors (~180 km) — strategic deception;
// it resolves as a decoy only at ID tier. (v4.3 retune 90 -> 100 with the
// SIG_BASE rebase.)
export const DECOY_SUPPLY = 4; // LINKED: == ARCHETYPES.frigate.decoys
export const DECOY_LIFETIME_S = 60; // v4.5: matches longer missile flights; a decoy drifts convincingly for a full minute as a fake contact
export const DECOY_SIGNATURE = 100;
export const DECOY_DRIFT_MPS = 10; // small random drift added on ejection

// Standing orders
export const STANDING_ORDER_MAX = 6;
export const STANDING_ORDER_RETRIGGER_COOLDOWN_S = 5; // for repeat:true orders

// Terrain (generated per match from a seed; see terrain.ts)
export const ROCK_COUNT = 30; // field rocks, plus ONE centerpiece body
export const ROCK_RADIUS_MIN_M = 1000;
export const ROCK_RADIUS_MAX_M = 8000;
export const CENTERPIECE_RADIUS_M = 15000; // cracked moonlet in the middle third
export const ROCK_MIN_GAP_M = 8000; // edge-to-edge; keeps fields navigable
export const ROCK_SPAWN_CLEAR_M = 20000; // no rock this close to a spawn point
export const DUST_COUNT = 3;
export const DUST_SIZE_MIN_M = 30000; // full width of a dust ellipse
export const DUST_SIZE_MAX_M = 60000;
// Ship-vs-rock impacts: damage = 100 x ((v_impact - HARMLESS) / (LETHAL - HARMLESS))^2
export const COLLISION_HARMLESS_BELOW_MPS = 50; // gentle bump
export const COLLISION_LETHAL_AT_MPS = 1500;
export const COLLISION_RESTITUTION = 0.5; // bounce: reflect + dampen normal component
export const COLLISION_WARNING_S = 20; // project own velocity this far ahead

// Spawn (v5 §2): captains spawn evenly spaced on a ring, facing center,
// v=0 — two players land on opposite sides, 300 km apart (the v4 geometry).
// Teams spawn on opposite arcs, teammates spaced along theirs.
export const SPAWN_RING_RADIUS_M = 150000; // LINKED to REGION_RADIUS_M (60%)
export const TEAM_SPAWN_SPACING_M = 40000; // teammate spacing along the team arc

// Callsigns & contact designations (v5 §3)
// Permanent per-ship callsigns, assigned at match start (never typed).
// Known to an observer only at/after ID tier (or via a §7 broadcast
// voiceprint) — leaking one earlier is a fog bug.
export const CALLSIGN_POOL = [
  "Kestrel", "Vagrant", "Mako", "Aurora", "Bastion", "Wraith", "Halcyon", "Sable",
];
// Per-observer track labels in acquisition order ("Contact Alpha", ...).
// Wraps with -2 suffixes if a long match burns the alphabet.
export const DESIGNATION_LETTERS = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
  "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa",
  "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey",
  "X-ray", "Yankee", "Zulu",
];
// A lost track reacquired within this window (and physically plausibly —
// within max-speed reach of its last known fix) keeps its letter;
// otherwise the XO can't correlate and opens a NEW letter (identification
// resets with it).
export const CONTACT_CORRELATE_S = 60;
// How long a last-known fix stays ON THE MAP. Nothing aged these out: the
// tombstone array was push-only and an unobserved-death ghost was
// structurally unclearable (the ship leaves the board, so its record is
// never revisited), and every match silently accreted dashed outlines
// (playtest 2026-07-14: "my screen is filled with last seen X seconds").
// 🔴 This is safe ONLY because it is AGE-driven. The v5 §3 tombstone exists
// so that deleting a letter's ghost AT THE INSTANT a new letter opens can't
// leak that both are one hull — a fixed age-out fires on the ghost's own
// clock and therefore correlates with nothing. Never make this
// event-driven. Both correlation-failure branches stay covered: an
// out-of-reach failure tombstones a YOUNG fix that still draws, and a
// timeout failure can only happen after CONTACT_CORRELATE_S, by which time
// the ghost is long gone on its own. Pinned in tests/designation.test.ts.
export const GHOST_TTL_S = 30;
// The steering fallback (v5 §1: a `track` goal holds last-known when the
// contact drops) reads the RECORD, not the wire, and is deliberately
// untouched by this — the map declutters; the autopilot does not change.

// Match lifecycle (v5 §2)
export const MAX_PLAYERS = 8; // captains per room; spectators unlimited
// A disconnected captain's ship becomes a drifting GHOST (thrust 0,
// standing orders suspended, PDCs on last posture) until reconnect or this
// timer scuttles it quietly. Replaces the v4 pause-and-forfeit.
export const DISCONNECT_FORFEIT_S = 120;

// Practice drone (exempt from propellant; thrust exists only as signature).
// With terrain it patrols waypoints among the rocks and dust (so solo
// players experience LOS play); with no terrain it flies the old circle.
export const DRONE_SPEED_MPS = 800; // cruise
export const DRONE_TURN_RATE_DPS = 3; // used only for the no-terrain circle
export const DRONE_PATROL_TURN_DPS = 12; // waypoint steering agility
export const DRONE_WAYPOINT_RADIUS_M = 12000; // arrival radius at dust/center waypoints
export const DRONE_ROCK_SKIM_M = 4000; // rocks are reached at surface + this: the patrol WEAVES the field so pursuers lose LOS (v4.1 §7 verification)
export const DRONE_AVOID_LOOKAHEAD_S = 10; // rock-dodge projection (short: graze, don't orbit)
export const DRONE_HULL_POINTS = 60;
export const DRONE_THRUST_PERCENT = 50; // signature as a ship at 50% thrust
export const DRONE_FIRES_BACK = true; // reduced aggression: locks + one missile at a time
export const DRONE_MISSILE_COOLDOWN_S = 90; // long pause between drone shots

// Spectators (v4.2): cosmetic identity only — no persistence, first-come.
// When the pool is exhausted, names repeat with -2, -3, ... suffixes.
export const SPECTATOR_CALLSIGNS = [
  "Ghost", "Watcher", "Echo", "Specter", "Shade", "Drifter", "Raven", "Static",
];
export const SPECTATOR_NAMES_SHOWN_MAX = 3; // player HUD lists names up to this, then collapses to a count

// v5.1 §5: player names — display-only strings. They ride the transponder
// (teammates + spectators + the post-match reveal), NEVER the LLM prompt
// (injection surface), NEVER the TTS (unbounded synth vocabulary).
export const PLAYER_NAME_MAX_CHARS = 16;

// LLM
export const LLM_MODEL = "claude-haiku-4-5-20251001";
export const LLM_TIMEOUT_MS = 5000;
// Boot-time cache prewarm (translator.ts): not on any captain's clock, so it
// gets a real timeout rather than the 5 s gameplay budget.
export const LLM_PREWARM_TIMEOUT_MS = 30000;
export const LLM_MAX_TOKENS = 1000;
export const UTTERANCE_MAX_COMMANDS = 4;

// Speech-to-text (server-side, see stt.ts; provider/key come from env)
export const STT_TIMEOUT_MS = 15000;
export const STT_MAX_AUDIO_BYTES = 15 * 1024 * 1024; // /stt upload cap
// Groq on_demand tier caps whisper-large-v3-turbo at 20 requests/min PER ORG
// — one 8-captain room shares it (playtest 2026-07-12 peaked ~30/min and
// 429-stormed). Requests over the budget wait briefly, then spill to the
// STT_FALLBACK_* provider, then fail as "busy". Env STT_RPM overrides
// without a deploy (raise it when the Groq tier upgrade lands).
export const STT_RPM_LIMIT = 20;
export const STT_MAX_QUEUE_DELAY_MS = 5000; // longest a clip may wait for a primary slot
export const STT_429_PENALTY_MS = 20000; // sit out after a 429 with no retry-after header

// Ship AI voice (ElevenLabs, see tts.ts; key from ELEVENLABS_API_KEY)
// Starter tier also caps CONCURRENT syntheses — dynamic acks in an 8-player
// room tripped concurrent_limit_exceeded (2026-07-12); synth calls queue
// through a semaphore this wide.
export const TTS_MAX_CONCURRENT = 2;

// Ship AI voice (ElevenLabs, see tts.ts; key from ELEVENLABS_API_KEY)
export const TTS_MODEL = "eleven_flash_v2_5"; // low latency
export const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // "George" — calm, dry. Browse elevenlabs.io/voice-library and swap.
export const TTS_TIMEOUT_MS = 10000;

// TTS quota economy (2026-07-13 audit: ~900 unique dynamic syntheses in one
// play day — freeform ack text never re-hits the disk cache). Dynamic acks
// and query answers keep their full text in the transcript but the VOICE
// draws from this bounded phrasebook. Exemption: standing-order readbacks
// still speak verbatim (v4.3 doctrine — the voice must state the trigger
// direction; they're rare enough to pay for).
export const ACK_SPEAK_LINES = ["Aye, Captain.", "Aye aye.", "Copy that, Captain."];
export const QUERY_ANSWER_SPEAK = "On the board, Captain.";

// ---------------------------------------------------------------------------
// Campaign "Deep Black" — Stage 0 (HANDOFF-CAMPAIGN-v1.md). Single-player.
// None of these touch multiplayer balance; the mission block on a Sim is the
// only gate to any of this code running.

// The clock is a BUDGET, not a threat (spec §1). FIXED per system — the
// difficulty ladder (Stage 2) escalates the Hunter, never the clock.
export const CAMPAIGN_HUNTER_SPAWN_S = 240;

// Gate aperture — SOLVED from the §5.3 constraint, not guessed. Constraint:
// committed at 40 km at full speed (3000 m/s), a 3° aim error must be
// correctable with a lateral burn, a 6° error must not. Frigate baseline:
// ttg = 40 km / 3000 = 13.3 s; a 90° flip at 20°/s eats 4.5 s; lateral
// authority in the 8.8 s left = ½·60·8.8² ≈ 2.3 km. 3° = 40 km·tan3° ≈
// 2.1 km (correctable); 6° ≈ 4.2 km → ≥1.9 km of residual miss. Half-width
// must sit inside (0, 1.9 km): 1.5 km.
//
// THE ARCHETYPE SPREAD AT THIS WIDTH IS INTENTIONAL AND LOAD-BEARING — DO
// NOT WIDEN TO "BALANCE" IT. At max speed the gate is forgiving in a
// corvette (~6.2° correctable), exactly-as-specced in a frigate (~3.3°),
// and unthreadable in a cruiser (~1.4°). The cruiser still makes it — at
// ~2400 m/s instead of 3000 — so the heavy ship must come in slow, and slow
// is when the Hunter catches you. The archetype's defining weakness surfaces
// at the climax of every system with zero special-casing. Pinned per
// archetype in tests/campaign.test.ts.
// Anvil 1.1 §3c: 3000 → 3600 AFTER the §3a hull-radius fix (the half-width
// must stay inside the derivation band — re-checked in campaign.test.ts).
export const APERTURE_W_M = 3600;
// Anvil 1.1 §3a: the ship is not a point when threading a gap. SOLUTION
// GOOD must mean the HULL fits: |missM| + SHIP_RADIUS_M < half-aperture.
// (Rock collision remains point-swept; this margin covers hull extent +
// the diagonal clip of a crossing line against the pylon circles — the
// "mystery rock" was the HUD calling a pylon scrape good.)
export const SHIP_RADIUS_M = 150;
export const GATE_SOLUTION_RANGE_M = 80000; // HUD panel + XO solution lines appear inside this
// Pylons are rocks (collide, block LOS, render for free). Small ON PURPOSE:
// the common failure must be the §5.2 shroud overshoot (lit up, current
// against you, long burn back), not an instant crunch — a near miss clips a
// pylon, a blown line sails through the gap's shoulder into the dark.
export const GATE_PYLON_RADIUS_M = 800;
export const GATE_BEARING_SPREAD_DEG = 80; // gate rim bearing seeded within ±this of north (player spawns south — the run is always real)

// Hunter spawn. INSIDE the region (outside = signature-max = free tier-ID
// leak, sim invariant), on this fraction of the region radius. Placement
// law (Stage 0 review): OUT OF THE PLAYER'S DETECTION RANGE IS A HARD
// FLOOR, away-from-the-gate is a soft preference — the first the player
// knows is the clock, the second is a rumble they worked for. Never a
// contact pop-in.
export const HUNTER_SPAWN_RADIUS_FRAC = 0.85;
export const HUNTER_SPAWN_DETECT_MARGIN = 1.3; // spawn at ≥ this × the player's live detection range for the Hunter's hunt-throttle signature

// Stage 0 is "Sharp Ears" (ladder row 2), NOT row 1's near-parity Drifter —
// the experiment is "hunted by something with better ears", and a parity
// Hunter doesn't test that. Both are mission-spec fields (the Stage 2
// ladder table drops in without refactor) and BOTH are runtime-sweepable
// from the dev harness ({"mission":{"sigMult":0.7,"sensorMult":1.5}}) —
// Stage 0's playtest deliverable is WHICH PAIR IS THE GAME, not "was it
// fun".
export const HUNTER_SENSOR_MULT = 1.4;
// sigMult scales TOTAL emitted signature (sigBase + thrust + spikes), NOT
// sigBase alone — "engine baffling", numbers-only. A base-only multiplier
// would save ~8 pts against +55 from hunt throttle, and ladder row 4 "The
// Quiet One" (whose identity is a floored sigMult) would be a dud.
// DELIBERATE COUPLING — DO NOT "FIX": because every detection consumer
// flows through signatureOf(), sigMult also shrinks missile-seeker
// acquisition (seekers key on signatureOf) and delays lock eligibility
// (the tier-2 gate). One physical model per invariant 9; still an
// information advantage, not a hull buff. Ladder note: every sigMult rung
// is therefore ALSO an anti-lock/anti-seeker rung — double-axis.
export const HUNTER_SIG_MULT = 0.75;

// Hunter AI (server/hunter.ts — a pure function of snapshotFor(hunter)).
// 2026-07-14 lethality pass. This was 60 km, which is 19 km BEYOND the range
// at which a missile can still steer: MISSILE_ACCEL_MPS2 150 reaches
// MISSILE_MAX_SPEED_MPS 2400 in 16 s over 19.2 km, then coasts out the
// remaining 9 s of MISSILE_PROPELLANT_S at 2400 = 21.6 km, so powered range
// is ~40.8 km — and MISSILE_TURN_RATE_DPS is "ONLY while the engine is on".
// The Hunter dumped its whole magazine between 60 and 49 km and every bird
// arrived ballistic against a target that only had to change vector. 35 km
// keeps the shot inside powered flight AND inside a realistic seeker
// envelope (MISSILE_SEEKER_BASE_M x sig/100 is ~20 km against a quiet
// player). If the Hunter ever feels too passive, this is NOT the knob —
// it is the one keeping his birds able to turn.
export const HUNTER_ENGAGE_RANGE_M = 35000; // inside this with a track: lock and shoot
// Rail range. At TRACK the solution is a ±RAIL_TRACK_DISPERSION_DEG cone, so
// the miss grows with range: at 25 km a 1.2° cone throws ±524 m against a
// SHIP_RADIUS_M + RAIL_HIT_RADIUS_M = 250 m target, i.e. it lands roughly
// half the time and is deadly at ID. Note the Hunter PAYS for every shot:
// firing auto-lights a cold rail (+2 draw = +16 signature, permanently) and
// RAIL_SIG_SPIKE 80 is heard map-wide. A Hunter that opens up with the rail
// tells you exactly where it is — that trade is the point, not a bug.
export const HUNTER_RAIL_RANGE_M = 25000;
// the engage band is sticky: once fighting, he keeps the nose on you until
// the range clears the band by this factor. Without it the fight and the
// approach trade the nose back and forth at 1 Hz and the lock never builds
// — the same failure the nose-on-target fix exists to kill.
export const HUNTER_ENGAGE_EXIT_FRAC = 1.25;
export const HUNTER_FIRE_COOLDOWN_S = 25; // missile cadence (corvette carries 4 — spent birds stay spent)
export const HUNTER_PURSUE_THROTTLE = 100;
export const HUNTER_HUNT_THROTTLE = 55; // regen band cruise; its own rumble discipline is the player's tell
// Anvil 1.1 §5b: PURSUE is a RENDEZVOUS, not a ram — close to weapons
// range arriving with a manageable closing rate (the same braking-envelope
// idea the salvage approach flies, in the target's frame). Above the
// allowed rate for the remaining distance, he flips and kills closure;
// below it, he leads and burns. No more yo-yo. The floor is the rate he's
// HAPPY to carry through the engagement envelope.
export const HUNTER_CLOSE_RATE_FLOOR_MPS = 150;
// 1.1 §2e doctrine note: the throttles above already encode maneuver
// discipline for the Hunter — HUNT/search at 55 (standard-band stalking,
// his quiet IS the player's tell) and 100 (flank) only when closing for
// the kill or dodging. Do not give him exemptions; fix physics only.
export const HUNTER_FUEL_FLOOR = 20; // % propellant: below this, coast and regen...
export const HUNTER_FUEL_RESUME = 50; // ...until back above this (hysteresis)
export const HUNTER_AVOID_LOOKAHEAD_S = 15; // rock-dodge projection window
export const HUNTER_PATROL_ARRIVE_M = 15000; // waypoint arrival radius while HUNTing
// Soft leash: beyond this fraction of the region radius, an outward HUNT
// heading bends back toward the interior (rumble bearings carry no range —
// a noise pointing outward was marching hunters off the map). PURSUE of a
// real contact and the gate picket are exempt.
export const HUNTER_LEASH_FRAC = 0.9;
// Anvil §1a: the HARD leash. Every waypoint and intercept solution the
// Hunter steers for clamps inside this fraction of the region radius, and
// the region boundary joins AVOID — a projected exit steers home at full
// burn. (The PURSUE exemption above is Anvil-overridden: the chase bends
// at the rim too. tests: hunter never exits REGION_RADIUS_M.)
export const HUNTER_WP_CLAMP_FRAC = 0.9;
// Anvil §1b: the datum search. Losing a contact records a datum; the
// uncertainty circle grows at prey max speed (r = age × MAX_SPEED_MPS) and
// the Hunter sweeps golden-angle spokes of THAT circle instead of falling
// back to the patrol random-walk. The intended consequence: sitting still
// after being seen gets you found; coasting away silently does not — the
// circle outruns the search. Past the give-up radius the trail is cold.
export const HUNTER_DATUM_SPOKE_FRAC = 0.6; // search waypoints sit at this fraction of r
export const HUNTER_DATUM_GIVEUP_R_M = REGION_RADIUS_M; // r covers the region: back to patrol
// Anvil §1c: escalation by UNCERTAINTY, not silence — PASSIVE spiral below
// the probe threshold, remote ears seeded around the circle past it, active
// PINGS past the ping threshold with frequency scaling ∝ r (interval =
// BASE × PING_R / r, floored by the transducer recharge). NEVER ping at low
// uncertainty — pinned. The pre-Anvil dry-spell spending survives for the
// datum-less COLD hunt (spawn, expired trails), where uncertainty is max.
export const HUNTER_DATUM_PROBE_R_M = 60000;
export const HUNTER_DATUM_PROBE_EVERY_S = 30;
export const HUNTER_DATUM_PING_R_M = 120000;
export const HUNTER_DATUM_PING_BASE_S = 75; // ping interval at the threshold radius
// Escalation (playtest ask): every dry spell this long — no contact, no
// rumble, no ghost — the Hunter spends something: an active PING first
// (which reveals IT map-wide: the frustrated scream is the player's gift),
// then probes (gate first — the player must come there eventually — then
// down the last bearing it heard). Numbers-only; ladder rows can retune.
export const HUNTER_DRY_SPELL_S = 75;
// Lethality round (playtest: a dust-parked player was unfindable forever
// and the Hunter read as harmless). BLIND FIRE: a persistent loud rumble
// it cannot convert to a contact (the dust fortress) earns a bearing-
// guided bird down the noise — prox fuses are pure geometry, and torpedoes
// swimming through your cloud is the answer dust deserves. GATE DRIFT: as
// a hunt drags on, the patrol biases toward the gate — it knows where you
// must eventually go (a soft, every-system version of the late-row picket).
export const HUNTER_BLIND_FIRE_S = 25; // continuous rumble-chase without a contact before it shoots the noise
// A PARKED DARK ship's rumble reads ~0.2 loud even close aboard (measured
// — loudness tracks signature, not just distance), and the parked dark
// ship IS the dust-fortress case this exists for. The chase-time gate is
// the real filter; the loudness floor only screens out map-edge whispers.
export const HUNTER_BLIND_FIRE_LOUD = 0.15;
export const HUNTER_GATE_DRIFT_S = 150; // hunt seconds before the gate joins the patrol rotation

// Patch 2 "Two Ships" §1a: the Hunter pursues the LOUDEST contact he
// currently holds — the rule that makes the bait play work (one captain
// burns, the Hunter comes for him, the other loots dark). Loudness rides
// the wire on every contact as the same signature-derived scalar the
// hearing channel already broadcasts (sig / LOUD_SIG_REF — the sound
// doesn't stop when you can see it). Target re-evaluation runs on a
// CADENCE with HYSTERESIS: a challenger must be meaningfully louder or
// meaningfully closer to steal the chase — he must not oscillate between
// two comparably-loud ships.
export const LOUD_SIG_REF = 150; // loud = min(1, signature / this) — rumbles and contacts alike
export const HUNTER_RETARGET_EVERY_S = 5; // target re-evaluation cadence
export const HUNTER_RETARGET_LOUDER = 1.4; // challenger needs >= this x current loudness...
export const HUNTER_RETARGET_CLOSER = 0.6; // ...or <= this x current range
// §3a: the XO's loudness read ("we're the loudest thing on the board") —
// the flip that turns the bait play on. Edge-triggered with a margin
// (throttle jitter must not flap it), rate-limited HARD.
export const LOUD_CALL_COOLDOWN_S = 20;
export const LOUD_CALL_MARGIN = 1.15; // a new loudest must clear the old by this factor

// Gate-run assist (playtest ask): within this range and below this speed,
// "take us through the gate" hands the aperture to the XO — he stops,
// lines the ballistic through center, and burns straight. The slow-entry
// requirement is the price that keeps the aperture the difficulty: slow
// is when the Hunter catches you.
export const GATE_ASSIST_RANGE_M = 15000;
export const GATE_ASSIST_MAX_SPEED_MPS = 300;
export const GATE_XO_COOLDOWN_S = 10; // min gap between gate-solution XO calls (§5.4: rate-limited HARD)

// Anvil 1.1 §2: maneuver discipline. Every automatic maneuver used to burn
// at 100% — in a game where burning is how you die, the XO was screaming
// on the captain's behalf. The posture caps autopilot throttle; a single
// command can override it for itself only. THE DEFAULT IS STANDARD (60%),
// deliberately down from the old 100 — slower and quieter is the point.
// Timed burns are exempt: the captain named a percent, the captain gets it.
export type Discipline = "silent" | "standard" | "flank";
// 🔴 LINKED: silent == REGEN_MAX_THRUST_PCT. These were set independently
// and did not line up — silent capped at 25 while regen needs the SETTING at
// or under 20, so "silent running", the posture whose entire identity is
// patience, was the one posture that drained the tank to zero and never paid
// a drop back. A captain who set silent and walked away came back dry. Fixed
// 2026-07-14 after the playtest question "what are the fuel rates?" surfaced
// the gap. Silent is now exactly the harvest band: infinite endurance, and
// the only posture that regenerates while it moves.
export const DISCIPLINE_CAP: Record<Discipline, number> = {
  silent: 20, // slow, unheard, and it PAYS — the regen band exactly
  standard: 60, // the new default
  flank: 100, // "I don't care who hears — get me there"
};

// Anvil 1.1 §1a: a hull breach is not a clean handoff — the hulk keeps
// this fraction of the death velocity (the rest is venting, tumbling,
// debris). DIRECTION IS PRESERVED and the fraction is real: how the player
// kills him still decides whether he gets paid (stern chase = nearly
// matched corpse; head-on = gone). Do not clamp, normalize, or zero.
export const HULK_MOMENTUM_RETENTION = 0.4;
// Anvil 1.1 §1c: the shroud CURRENT. Powered things fight the current;
// unpowered things (hulks — and any future wreck that ends up outside) are
// ENTRAINED by it: outside the rim the medium flows inward at
// GAIN × distance-beyond (capped), and an unpowered body is dragged toward
// that flow at up to CURRENT_ACCEL. Consequence: it decelerates, turns
// around, and is walked back inside, arriving near-zero — a hulk at max
// escape velocity returns in ~2-3 minutes (pinned). Ships are UNAFFECTED
// (they keep the EDGE_PULL model above — engines fight currents).
export const SHROUD_CURRENT_ACCEL = 30;
export const SHROUD_CURRENT_FLOW_GAIN = 0.012; // inward flow m/s per meter beyond the rim
export const SHROUD_CURRENT_FLOW_MAX_MPS = 300;
export const SHROUD_CURRENT_FLOW_FLOOR_MPS = 80; // the flow never stalls — the corpse actually crosses the rim

// Anvil §4 as amended by 1.1 §3b: the closing gate, in two LEGIBLE phases.
// When the LAST Hunter dies the gate destabilizes (CRITICAL warning at the
// kill); for GRACE the aperture is UNTOUCHED (HUD: GATE STABLE · closing
// in m:ss); then it narrows linearly to EXACTLY ZERO over DURATION (HUD:
// GATE CLOSING, alarm). Seven minutes total — tune DOWN from here, never
// up from too-short: the window must fit chase-the-hulk (or wait out the
// current), match, loot, flip, kill the momentum, and get home. No minimum
// aperture, ever: if the window is too tight RAISE DURATION — never a
// floor, never APERTURE_W_M. Still in-system at closure: RUN ENDED —
// STRANDED. The pylons ride the aperture inward: closed = wall.
// 2026-07-14: +30 s of window, added to GRACE (240 -> 270), NOT to DURATION.
// The measured budget for a head-on Hunter kill was ~382 s of perfect
// piloting against 420 — 38 s of slack that assumed a lucky chase, no voice
// round-trips, and no rock in the hulk's path. The stern-chase kill (a
// nearly co-moving hulk) was always comfortable at ~260 s; the head-on one
// was arithmetic, not skill. The 15 km salvage gate lifting in the same
// patch gives the captain an instrument for that leg; this gives him the
// seconds to fly it.
//
// ⚠️ WHY GRACE AND NOT DURATION, despite the note above saying "RAISE
// DURATION": the two are not interchangeable. Total window is GRACE +
// DURATION, so either buys the same 30 s of looting time — but DURATION is
// also THE VISE (campaign.test.ts §30): a full-hold cruiser on the far side
// when the narrowing STARTS must not be able to reach the door. It needs
// ~204 s to cross the region, so DURATION 210 would have handed it the
// crossing by 6 s and deleted "jettison or die" as a decision. Measured, not
// guessed — §30 went red on the first try. Put window into GRACE; keep
// DURATION at the vise.
//
// Note "wait out the current" is NOT a real escape hatch: the current only
// acts outside the rim and the Hunter's leash means he usually dies steering
// inward, so the hulk never crosses.
export const GATE_CLOSE_GRACE_S = 270;
export const GATE_CLOSE_DURATION_S = 180;

// --- Stage 1: the run (§1) + salvage (§4) + progression (§6) ---
export const CAMPAIGN_SYSTEMS = 8;
// The stop is the cost (§4.1): momentum is the most precious thing you own.
export const SALVAGE_STOP_SPEED_MPS = 25; // must be under this for the transfer to run
// The approach hop only flies while the relative velocity points mostly AT
// the dock target (closing rate >= this fraction of relative speed, ~37°
// cone). Crossrange motion falls through to the retro-brake instead —
// thrusting at a target you're sliding past is a circular orbit, and the
// XO flew one (playtest 2026-07-13: "it kept going around and around").
export const SALVAGE_HOP_ALIGN = 0.8;
export const SALVAGE_DOCK_RANGE_M = 2000; // come alongside — the XO won't grapple across the map
export const SALVAGE_ITEM_S = 10; // per item; the haul is sequential, worst -> best (§4.2 — a greed curve, not a progress bar)
// No wreck lands on anyone's doorstep: every site must clear EVERY spawn by
// this much. It used to clear one hardcoded point — (0, -SPAWN_RING_RADIUS_M),
// the solo campaign spawn — which in a multiplayer room protects an arbitrary
// compass bearing that may be nobody's spawn, and nobody else.
export const WRECK_SPAWN_CLEAR_M = 30000;
// The wrecks worth crossing a map for. Used only to MEASURE field fairness;
// the loot pools are the real economy (rollWreckLoot).
export const WRECK_RICH_TYPES = ["military", "derelict"] as const;
// Fairness by best-of-K, not by a threshold. Wreck TYPE is rolled independently
// of position, so a military wreck can land 25 km from one spawn and 200 km
// from another — a visible unfair race, since MP wrecks are public from t=0.
// Measured across 40 seeds before choosing this: at 8 players the median spread
// between the best- and worst-placed spawn was 177 km and the worst seed 286 km.
// A threshold would have been invented, because perfect fairness is impossible
// by geometry — eight spawns on a ring with ~2 rich wrecks can never be
// equidistant (the floor is ~85 km). So: generate K candidate fields, keep the
// fairest. Solo and practice have one spawn, spread is 0 on the first attempt,
// and the loop exits immediately — those fields stay bit-identical.
// If the remaining spread ever reads as unfair in play, the lever is wreck
// COUNT (SALVAGE_* below), not a bigger K.
export const WRECK_FAIRNESS_ATTEMPTS = 8;

export const SALVAGE_MARKED_SITES = 2; // reliable contents. WATCHED by the Hunter (§4.3/§4.4)
export const SALVAGE_RUMORED_SITES = 3; // might be empty, might be the run-maker; the Hunter doesn't know them; the richest sit in dust
// A rumor RESOLVES by going and looking (playtest 2026-07-12: a dust rumor
// read as unresolvable — sensors can't do it, and mustn't: the trip IS the
// price). Inside this range the XO eyeballs the hulk and calls it — loot
// count or dry hole. Dust doesn't matter; you're alongside.
export const RUMOR_RESOLVE_RANGE_M = 5000;
// The XO flies the whole terminal approach: name a site inside this and
// "come alongside wreck B" is one command. THE one ring drawn per site.
export const SALVAGE_APPROACH_RANGE_M = 15000;
// Progression (cc ruling 1, 2026-07-14): THE STAT BUMPS ARE DEAD — a free
// upgrade lane would poison the loadout's one law ("everything you run
// makes noise"). Horizontal progression = MODULES, found on wrecks and
// priced in mass + draw. Vertical progression = refine, Mk I → Mk II,
// bought with ore (§6, next leg). No third, free axis — do not re-add.

// --- Stage 2: the ladder (§3). A TABLE, not a formula — each system adds
// exactly ONE new problem, discrete and learnable ("system five is when
// they start coming in pairs"). ESCALATE THE HUNTER, NEVER THE CLOCK:
// CAMPAIGN_HUNTER_SPAWN_S is identical across all 8 rows (pinned in
// tests/campaign.test.ts — shrinking the clock shrinks the GAME).
// Multi-Hunter valve (§3 ⚠️): if S5/S7 feel unwinnable the knob is their
// SENSOR RANGE, never the count — the count is those systems' identity.
// gateCamp appears LATE ONLY: the sprint-for-the-door fantasy is precious.
export interface HunterSpec {
  archetype: ArchetypeName;
  sensorMult: number;
  sigMult: number;
  gateCamp: boolean;
}
export interface LadderRow {
  name: string; // named in the XO's mouth — the player should learn to fear a word
  hunters: HunterSpec[];
  spawnLine: string; // the clock-zero notice; NEVER carries a bearing
}
export const CAMPAIGN_LADDER: LadderRow[] = [
  { name: "The Drifter", hunters: [{ archetype: "corvette", sensorMult: 1.0, sigMult: 1.0, gateCamp: false }],
    spawnLine: "Clock's run out, Captain — a drive just lit off in-system." },
  { name: "Sharp Ears", hunters: [{ archetype: "corvette", sensorMult: 1.4, sigMult: 0.75, gateCamp: false }],
    spawnLine: "Clock's run out. This one has better ears than we do, Captain." },
  { name: "The Lance", hunters: [{ archetype: "frigate", sensorMult: 1.4, sigMult: 0.75, gateCamp: false }],
    spawnLine: "Clock's run out — heavier drive this time. It'll have a railgun, Captain." },
  { name: "The Quiet One", hunters: [{ archetype: "frigate", sensorMult: 1.4, sigMult: 0.45, gateCamp: false }],
    spawnLine: "Clock's run out. I can barely hear this one, Captain." },
  { name: "The Pair", hunters: [
      { archetype: "corvette", sensorMult: 1.3, sigMult: 0.8, gateCamp: false },
      { archetype: "corvette", sensorMult: 1.3, sigMult: 0.8, gateCamp: false }],
    spawnLine: "Two drives, Captain. They've sent a pair." },
  { name: "The Anvil", hunters: [{ archetype: "cruiser", sensorMult: 1.5, sigMult: 1.0, gateCamp: false }],
    spawnLine: "Clock's run out. That drive is enormous — do not trade with it, Captain." },
  { name: "The Picket", hunters: [
      { archetype: "corvette", sensorMult: 1.4, sigMult: 0.75, gateCamp: false },
      { archetype: "corvette", sensorMult: 1.4, sigMult: 0.75, gateCamp: true }],
    spawnLine: "Two drives — and one of them is making for the gate, Captain." },
  { name: "The Wolfpack", hunters: [
      { archetype: "frigate", sensorMult: 1.4, sigMult: 0.6, gateCamp: false },
      { archetype: "corvette", sensorMult: 1.4, sigMult: 0.6, gateCamp: true }],
    spawnLine: "Multiple drives, quiet ones. It's a wolfpack, Captain." },
];

// --- Stage 3: the adaptive score (client/music-brain.js + audio.js) ---
// 🔴 THE FOG INVARIANT APPLIES TO MUSIC (§7.1): intensity is a function of
// the player's SNAPSHOT, never the sim's truth — pinned in tests/music.test.ts.
export const GATE_RUN_TTG_MAX_S = 90; // gateRun begins ramping here (client mirrors this via the hello config)
