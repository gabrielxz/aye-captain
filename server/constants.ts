// EVERY tunable number lives here. No magic numbers in sim code.

export const TICK_RATE_HZ = 1; // command tick: queued commands, standing orders, LLM interaction
// Physics runs PHYSICS_SUBSTEPS times per command tick (10 Hz at 1 Hz ticks).
// At v4 speeds objects move km per command tick; substeps + swept-segment
// collision keep fast movers from tunneling through fuses and terrain.
export const PHYSICS_SUBSTEPS = 10;
// Snapshots broadcast faster than the command tick so client interpolation
// stays smooth at high speeds. Commands still process at TICK_RATE_HZ.
export const SNAPSHOT_RATE_HZ = 4;

// Region / bounding ("the shroud" — visible ring on map)
export const REGION_RADIUS_M = 250000; // 250 km; crossing time ~2.8 min at flank. LINKED: SPAWN_DIST_FROM_CENTER_M sits at 60% of it
export const HARD_LIMIT_RADIUS_M = 375000; // TEMPORARY (deleted in v4 §4 for edge gravity); must stay > SPAWN_DIST_FROM_CENTER_M

// Ship. Full tank = 100 s of hard burn = 6000 m/s of delta-v: propellant is
// a delta-v budget — enough to reach flank speed and kill it once.
export const MAX_SPEED_MPS = 3000; // LINKED to MISSILE_MAX_SPEED_MPS & region size
export const ACCEL_FULL_THRUST_MPS2 = 60; // ~6g hard burn; top speed in ~50 s
export const TURN_RATE_DEG_PER_SEC = 20;
export const HULL_POINTS = 100;

// Signature & detection: DETECTION IS THE GAME. Drive plumes are visible
// across enormous distances; going dark is the only stealth.
// ship signature = SIG_BASE + EFFECTIVE thrust% (10..110), plus spikes.
export const SIG_BASE = 10; // a drifting dark ship
export const SIG_SPIKE_LAUNCH = 150; // missile launch flash (replaces the flat reveal)
export const SIG_SPIKE_LAUNCH_S = 5;
export const SIG_SPIKE_PDC = 50; // PDC firing (used by v4 §6)
export const SIG_SPIKE_PDC_S = 3;
export const MISSILE_SIG_BURNING = 80;
export const MISSILE_SIG_COASTING = 8; // a ballistic torpedo is nearly invisible. Intended. Terrifying.
// detection_range = SENSOR_BASE_M x (signature / 100), LOS permitting
// -> full burn (110) seen at ~181 km; 50% cruise at ~99 km; dark drift (10) at ~16.5 km
export const SENSOR_BASE_M = 165000;
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
export const TUBE_COUNT = 2;
export const TUBE_RELOAD_S = 20; // per tube, tubes reload in parallel
export const AUTO_RELOAD = true; // reload_tubes verb is a no-op while true

// Laser
export const LASER_RANGE_M = 5000;
export const LASER_BEAM_WIDTH_DEG = 6; // half-angle off boresight (4 -> 6 after playtest: visual hits read as misses)
export const LASER_COOLDOWN_S = 4;
export const LASER_DAMAGE = 10; // vs ships; instantly destroys missiles/decoys

// Missiles. MAGAZINE is everything aboard: TUBE_COUNT start loaded, the rest
// are reserves (6 total shots per match).
export const MISSILE_MAGAZINE = 6;
export const MISSILE_MAX_SPEED_MPS = 3000; // LINKED: == MAX_SPEED_MPS — a missile never out-SPEEDs a ship; it wins by geometry, acceleration, turn rate (v4 §5 changes this to 2×)
export const MISSILE_ACCEL_MPS2 = 150;
export const MISSILE_TURN_RATE_DPS = 45;
// false = current model: guidance steers the velocity vector directly, speed
// ramps from inherited launch speed to max. true = future experiment: missile
// facing decouples from velocity and thrust burns along facing (Newtonian,
// much floatier). NOT implemented — stub for a later milestone.
export const NEWTONIAN_MISSILES = false;
export const MISSILE_LIFETIME_S = 45; // self-destructs after
export const MISSILE_LAUNCH_DELAY_TICKS = 2; // flies straight, no seeking, during delay
export const MISSILE_ACQ_CONE_DEG = 60; // half-angle of seeker cone
export const MISSILE_REACQUIRE_S = 2; // grace period after losing lock
export const MISSILE_PROX_FUSE_M = 150;
export const MISSILE_DAMAGE = 35;

// Decoys
export const DECOY_SUPPLY = 4;
export const DECOY_LIFETIME_S = 20;
export const DECOY_SIGNATURE = 150;
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

// Spawn
export const SPAWN_DIST_FROM_CENTER_M = 150000; // LINKED to REGION_RADIUS_M (60%): opposite sides, 300 km apart, facing each other, v=0

// Match lifecycle
export const DISCONNECT_GRACE_S = 60; // pause sim awaiting reconnect, then forfeit

// Practice drone (exempt from propellant; thrust exists only as signature)
export const DRONE_SPEED_MPS = 100; // slow circle
export const DRONE_TURN_RATE_DPS = 3; // gentle constant turn
export const DRONE_HULL_POINTS = 60;
export const DRONE_THRUST_PERCENT = 50; // signature as a ship at 50% thrust
export const DRONE_FIRES_BACK = true; // reduced aggression: locks + one missile at a time
export const DRONE_MISSILE_COOLDOWN_S = 90; // long pause between drone shots

// LLM
export const LLM_MODEL = "claude-haiku-4-5-20251001";
export const LLM_TIMEOUT_MS = 5000;
export const LLM_MAX_TOKENS = 1000;
export const UTTERANCE_MAX_COMMANDS = 4;

// Speech-to-text (server-side, see stt.ts; provider/key come from env)
export const STT_TIMEOUT_MS = 15000;
export const STT_MAX_AUDIO_BYTES = 15 * 1024 * 1024; // /stt upload cap

// Ship AI voice (ElevenLabs, see tts.ts; key from ELEVENLABS_API_KEY)
export const TTS_MODEL = "eleven_flash_v2_5"; // low latency
export const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // "George" — calm, dry. Browse elevenlabs.io/voice-library and swap.
export const TTS_TIMEOUT_MS = 10000;
