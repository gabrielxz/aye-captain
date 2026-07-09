// EVERY tunable number lives here. No magic numbers in sim code.

export const TICK_RATE_HZ = 1;

// Zone / bounding
export const ZONE_RADIUS_M = 20000; // "the shroud" — visible ring on map
export const HARD_LIMIT_RADIUS_M = 30000; // absolute outer boundary, faint ring
export const OUTSIDE_ZONE_SENSOR_MULT = 0.5; // own sensor range halved outside zone

// Ship
export const MAX_SPEED_MPS = 300;
export const ACCEL_FULL_THRUST_MPS2 = 15;
export const TURN_RATE_DEG_PER_SEC = 20;
export const HULL_POINTS = 100;
export const SENSOR_RANGE_M = 12000;
export const SHIP_BASE_SIGNATURE = 40; // signature = 40 + thrust%  (range 40–140)

// Laser
export const LASER_RANGE_M = 5000;
export const LASER_BEAM_WIDTH_DEG = 4; // half-angle tolerance off boresight
export const LASER_COOLDOWN_S = 4;
export const LASER_DAMAGE = 10; // vs ships; instantly destroys missiles/decoys

// Missiles
export const MISSILE_MAGAZINE = 6;
export const MISSILE_SPEED_MPS = 450;
export const MISSILE_TURN_RATE_DPS = 45;
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
export const SPAWN_DIST_FROM_CENTER_M = 14000; // opposite sides, facing each other, v=0

// Match lifecycle
export const DISCONNECT_GRACE_S = 60; // pause sim awaiting reconnect, then forfeit

// Practice drone
export const DRONE_SPEED_MPS = 100; // slow circle
export const DRONE_TURN_RATE_DPS = 3; // gentle constant turn
export const DRONE_HULL_POINTS = 60;
export const DRONE_THRUST_PERCENT = 50; // signature as a ship at 50% thrust
export const DRONE_FIRES_BACK = false; // v1: no weapons

// LLM
export const LLM_MODEL = "claude-haiku-4-5-20251001";
export const LLM_TIMEOUT_MS = 5000;
export const LLM_MAX_TOKENS = 1000;
export const UTTERANCE_MAX_COMMANDS = 4;

// Speech-to-text (server-side, see stt.ts; provider/key come from env)
export const STT_TIMEOUT_MS = 15000;
export const STT_MAX_AUDIO_BYTES = 15 * 1024 * 1024; // /stt upload cap
