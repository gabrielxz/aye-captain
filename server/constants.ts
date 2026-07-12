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
// Corvette: the ghost — dim, fast-cycling, deception-rich, best eyes, no
// rail (a railgun is a spinal mount; the corvette's keel can't take one).
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
  corvette: { hull: 60, accel: 85, turn: 28, sigBase: 20, sensorBase: 210000, tubes: 1, magazine: 4, tubeReload: 20, decoys: 6, pdcAmmoS: 40, railguns: 0, railSlugs: 0, probes: 4 },
  frigate:  { hull: 100, accel: 60, turn: 20, sigBase: 30, sensorBase: 180000, tubes: 2, magazine: 6, tubeReload: 30, decoys: 4, pdcAmmoS: 60, railguns: 1, railSlugs: 20, probes: 2 },
  cruiser:  { hull: 160, accel: 40, turn: 14, sigBase: 45, sensorBase: 160000, tubes: 3, magazine: 9, tubeReload: 30, decoys: 4, pdcAmmoS: 90, railguns: 1, railSlugs: 30, probes: 1 },
};

// Signature & detection: DETECTION IS THE GAME. Drive plumes are visible
// across enormous distances; going dark is the only stealth.
// ship signature = SIG_BASE + EFFECTIVE thrust% (30..130), plus spikes.
// v4.3 rebase: SIG_BASE 10 -> 30, SENSOR_BASE_M 165 -> 180 km — playtest
// showed stealth was FREE (dark = off-switch); dark is now an edge: a
// drifter is still contact-visible at ~54 km, just not lockable until ~32.
export const SIG_BASE = 30; // a drifting dark ship. LINKED: == ARCHETYPES.frigate.sigBase
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

// v5 §5: the railgun (Frigate & Cruiser; the corvette's keel can't take a
// spinal mount). SOLUTION mode computes constant-velocity lead against a
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

// LLM
export const LLM_MODEL = "claude-haiku-4-5-20251001";
export const LLM_TIMEOUT_MS = 5000;
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
