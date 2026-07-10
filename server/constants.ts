// EVERY tunable number lives here. No magic numbers in sim code.

export const TICK_RATE_HZ = 1; // command tick: queued commands, standing orders, LLM interaction
// Physics runs PHYSICS_SUBSTEPS times per command tick (10 Hz at 1 Hz ticks).
// At v4 speeds objects move km per command tick; substeps + swept-segment
// collision keep fast movers from tunneling through fuses and terrain.
export const PHYSICS_SUBSTEPS = 10;
// Snapshots broadcast faster than the command tick so client interpolation
// stays smooth at high speeds. Commands still process at TICK_RATE_HZ.
export const SNAPSHOT_RATE_HZ = 4;

// Zone / bounding
export const ZONE_RADIUS_M = 30000; // "the shroud" — visible ring on map
export const HARD_LIMIT_RADIUS_M = 45000; // absolute outer boundary, faint ring
export const OUTSIDE_ZONE_SENSOR_MULT = 0.5; // own sensor range halved outside zone

// Ship
export const MAX_SPEED_MPS = 600; // LINKED: == MISSILE_MAX_SPEED_MPS by design
export const ACCEL_FULL_THRUST_MPS2 = 25;
export const TURN_RATE_DEG_PER_SEC = 20;
export const HULL_POINTS = 100;
export const SENSOR_RANGE_M = 12000; // deliberately NOT scaled with the bigger zone: longer hunt phase
export const SHIP_BASE_SIGNATURE = 40; // signature = 40 + EFFECTIVE thrust% (0 when tanks dry) (range 40–140)

// Propellant
export const PROPELLANT_MAX = 100;
export const PROPELLANT_BURN_AT_FULL = 1.0; // units/sec at 100% thrust, linear with thrust %
export const PROPELLANT_REGEN_PER_S = 0.33; // only inside zone AND throttle SETTING <= REGEN_MAX_THRUST_PCT
export const REGEN_MAX_THRUST_PCT = 20;

// Missile lock (required to fire)
export const LOCK_CONE_HALF_ANGLE_DEG = 30;
export const LOCK_RANGE_M = 10000;
export const LOCK_TIME_S = 5; // continuous seconds in cone+range+visible to acquire
export const LOCK_GRACE_S = 2; // integer: honest at 1 Hz tick; favors lock stability
export const LAUNCH_FLASH_REVEAL_S = 5; // firing reveals you to the enemy, sensors or not

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
export const MISSILE_MAX_SPEED_MPS = 600; // LINKED: == MAX_SPEED_MPS — a missile never out-SPEEDs a ship; it wins by geometry, acceleration, turn rate
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
export const DECOY_SIGNATURE = 120;
export const DECOY_DRIFT_MPS = 10; // small random drift added on ejection

// Standing orders
export const STANDING_ORDER_MAX = 6;
export const STANDING_ORDER_RETRIGGER_COOLDOWN_S = 5; // for repeat:true orders

// Fog of war
export const ORDNANCE_DETECT_RANGE_M = 6000; // missiles & decoys visible at half sensor range

// Spawn
export const SPAWN_DIST_FROM_CENTER_M = 20000; // LINKED to ZONE_RADIUS_M: opposite sides (2/3 of zone radius), facing each other, v=0

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
