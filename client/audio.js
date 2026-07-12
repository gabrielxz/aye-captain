// Procedural SFX (Web Audio, no assets) + ship-AI speech queue.
// Mix (v5.1 §4): SFX and VOICE buses ride separate sliders; the four
// continuous beds share a group bus with a summed ceiling that ducks
// under speech; master carries only the push-to-talk duck.
import { createSpeechScheduler } from "./speech-scheduler.js";

let ctx = null;
let master = null;
let sfxBus = null;
let speechBus = null;
let bedBus = null; // v5.1 §4.1: every continuous bed routes through here

// v5.1 §4.2: SFX and VOICE ride separate sliders (the buses always
// existed; they were just slaved to one knob). Legacy "vol" seeds both.
const legacyVol = Number(localStorage.getItem("vol") ?? 0.7);
const mixVol = {
  sfx: Number(localStorage.getItem("vol_sfx") ?? legacyVol),
  voice: Number(localStorage.getItem("vol_voice") ?? legacyVol),
};

// v5.1 §4.3: XO verbosity — FULL (everything), TERSE (critical + news),
// SILENT (critical only). Filters speech only; the transcript always logs.
let verbosity = localStorage.getItem("xo_verbosity") ?? "full";
export function setVerbosity(v) {
  verbosity = v;
  localStorage.setItem("xo_verbosity", v);
}
export function getVerbosity() {
  return verbosity;
}

// AudioContext needs a user gesture; call from any click/keydown.
export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9 * mixVol.sfx;
  sfxBus.connect(master);
  speechBus = ctx.createGain();
  speechBus.gain.value = mixVol.voice;
  speechBus.connect(master);
  bedBus = ctx.createGain();
  bedBus.gain.value = 1;
  bedBus.connect(sfxBus);
  startHum();
}

// ---------- the bed group (v5.1 §4.1) ----------
// Four continuous beds run at once — thrust rumble, hearing rumble, hull
// hum, dust hiss — and each was justified alone; nobody summed them. The
// group gain scales ALL of them down proportionally whenever their summed
// targets exceed the ceiling, and ducks under XO speech so he never
// competes with room tone.
const BED_GAIN_CEILING = 0.22;
const bedTargets = { hum: 0, thrust: 0, rumble: 0, dust: 0 };
let speechPlaying = false;

function updateBeds() {
  if (!bedBus) return;
  const sum = bedTargets.hum + bedTargets.thrust + bedTargets.rumble + bedTargets.dust;
  const ceiling = sum > BED_GAIN_CEILING ? BED_GAIN_CEILING / sum : 1;
  const target = ceiling * (speechPlaying ? 0.35 : 1);
  bedBus.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.25);
}

function setBedTarget(name, gain) {
  bedTargets[name] = gain;
  updateBeds();
}

function speechBedDuck(on) {
  speechPlaying = on;
  updateBeds();
}

// v4.7 §4.6: hull hum — one filtered noise loop at very low gain, always on
// once audio is unlocked. True digital silence reads as "audio broke"; the
// hum is the floor that the absence of the thrust rumble lands against, so
// going dark becomes a felt state instead of a bug report.
function startHum() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 64;
  const g = ctx.createGain();
  g.gain.value = 0.028;
  src.connect(f).connect(g).connect(bedBus);
  src.start();
  setBedTarget("hum", 0.028);
}

let ducked = false;
export function setMixVolume(kind, v) {
  mixVol[kind] = v;
  localStorage.setItem(kind === "sfx" ? "vol_sfx" : "vol_voice", String(v));
  if (!ctx) return;
  if (kind === "sfx") sfxBus.gain.value = 0.9 * v;
  else speechBus.gain.value = v;
}

export function getMixVolume(kind) {
  return mixVol[kind];
}

// Duck game audio while the captain is talking (push-to-talk held): they
// hear themselves think, and the mic picks up far less game noise.
export function duck(on) {
  ducked = on;
  if (!ctx) return;
  master.gain.linearRampToValueAtTime(on ? 0.15 : 1, ctx.currentTime + 0.15);
}

// ---------- tiny synth helpers ----------

function env(gainNode, t0, peak, attack, decay) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function osc(type, freq, t0, dur, peak, freqEnd = null, dest = null) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
  env(g, t0, peak, 0.005, dur);
  o.connect(g).connect(dest ?? sfxBus);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

let noiseBuf = null;
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noise(t0, dur, peak, filterFreq, filterEnd = null, type = "lowpass") {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(filterFreq, t0);
  if (filterEnd !== null) f.frequency.exponentialRampToValueAtTime(Math.max(filterEnd, 10), t0 + dur);
  const g = ctx.createGain();
  env(g, t0, peak, 0.01, dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// ---------- one-shot SFX ----------

// PDC burst: rapid staccato brrrt — the signature sound of the boat.
// Rate-limited internally so per-substep tracer fx don't stack bursts.
let lastPdc = { own: 0, enemy: 0 };
export function sfxPdc(own) {
  if (!ctx) return;
  const key = own ? "own" : "enemy";
  const now = performance.now();
  if (now - lastPdc[key] < 450) return;
  lastPdc[key] = now;
  const t = ctx.currentTime;
  const rounds = 7;
  for (let i = 0; i < rounds; i++) {
    const rt = t + i * 0.055;
    if (own) {
      noise(rt, 0.035, 0.3, 2400, 700, "bandpass");
      osc("square", 190, rt, 0.03, 0.22, 120);
    } else {
      noise(rt, 0.03, 0.13, 1500, 500, "bandpass");
      osc("square", 140, rt, 0.025, 0.1, 90);
    }
  }
}

// Rock impact: low grinding crunch.
export function sfxCrunch() {
  if (!ctx) return;
  const t = ctx.currentTime;
  noise(t, 0.5, 0.6, 300, 60);
  osc("triangle", 70, t, 0.35, 0.5, 30);
  osc("square", 45, t + 0.08, 0.25, 0.3, 25);
}

// Collision-warning klaxon — v5.1 §2.3: the whoop rate is tied to the
// countdown, accelerating into impact (it BECOMES the prox tick, which is
// the correct answer). Pass seconds-to-impact, or null/false to stop.
let klaxonSecs = null;
let klaxonTimer = null;
export function setCollisionKlaxon(secs) {
  const off = secs === null || secs === undefined || secs === false;
  const wasOn = klaxonSecs !== null;
  klaxonSecs = off ? null : Number(secs);
  if (off) {
    clearTimeout(klaxonTimer);
    klaxonTimer = null;
    return;
  }
  if (!wasOn && ctx) whoopChain();
}

function whoopChain() {
  if (klaxonSecs === null || !ctx) return;
  const t = ctx.currentTime;
  osc("sawtooth", 400, t, 0.28, 0.2, 800);
  osc("sawtooth", 400, t + 0.34, 0.28, 0.2, 800);
  // 10 s out: leisurely 1.4 s spacing; on top of the rock: 300 ms
  const iv = Math.max(300, Math.min(1400, klaxonSecs * 130));
  klaxonTimer = setTimeout(whoopChain, iv);
}

export function sfxLaunch(own) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const amp = own ? 0.5 : 0.22;
  osc("triangle", 90, t, 0.12, amp * 0.9, 55); // thunk
  noise(t + 0.06, 0.7, amp * 0.5, 400, 2600, "bandpass"); // whoosh
}

export function sfxReload() {
  if (!ctx) return;
  const t = ctx.currentTime;
  osc("square", 220, t, 0.03, 0.18);
  osc("square", 160, t + 0.09, 0.04, 0.2);
  osc("triangle", 70, t + 0.16, 0.12, 0.3, 45); // clunk home
}

export function sfxBoom(big, received) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const amp = big ? 0.85 : 0.5;
  noise(t, big ? 1.1 : 0.55, amp, 900, 60);
  osc("sine", 110, t, big ? 0.9 : 0.45, amp * 0.8, 35);
  if (received) osc("sine", 55, t, 0.5, 0.6, 30); // sub thump: that was OUR hull
}

export function sfxDecoy() {
  if (!ctx) return;
  noise(ctx.currentTime, 0.16, 0.3, 1200, 300); // pneumatic pop
}

export function sfxClick() {
  if (!ctx) return;
  osc("square", 1800, ctx.currentTime, 0.015, 0.08);
}

// v4.7 ping. own = we screamed: bright ~1.2 kHz sine, fast pitch drop,
// long exponential tail — the "one ping only" sound. Enemy pings arrive
// through the hull: lowpassed hard, quieter, stretched. You should be able
// to tell whose ping it was with your eyes shut.
export const PING_RETURN_MS_AT_MAX_RANGE = 900;
export function sfxPing(own) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (own) {
    osc("sine", 1250, t, 1.5, 0.4, 850);
    osc("sine", 2500, t, 0.2, 0.1, 1700); // glassy transient on top
  } else {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(650, t + 2.4);
    f.type = "lowpass";
    f.frequency.value = 480;
    env(g, t, 0.15, 0.04, 2.4);
    o.connect(f).connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + 2.5);
  }
}

// v4.7 §4.2: contact tier ceremony. Promotion = ascending motif, one note
// per tier reached (faint 1, track 2, id 3); demotion = the same motif
// descending from the lost tier. Suppressed by the caller during a ping
// grant window — the return blip is that event's sound.
const TIER_NOTES = [523, 659, 784]; // C5 E5 G5
export function sfxTierShift(tier, up) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = Math.max(1, Math.min(3, tier));
  const notes = TIER_NOTES.slice(0, n);
  if (!up) notes.reverse();
  notes.forEach((f, i) => {
    osc("sine", f, t + i * 0.11, 0.14, up ? 0.16 : 0.12);
    osc("triangle", f / 2, t + i * 0.11, 0.14, 0.05);
  });
}

// The diegetic return after OUR ping, scheduled by contact range. An empty
// ping is the outgoing ping, a long silence, and nothing — that silence is
// the feedback. Never fired for the enemy's ping.
export function sfxPingReturn(delayMs) {
  if (!ctx) return;
  const t = ctx.currentTime + Math.max(0, delayMs) / 1000;
  osc("sine", 1180, t, 0.25, 0.22, 1100);
  osc("sine", 1770, t, 0.07, 0.05);
}

// ---------- continuous states ----------

// Thrust rumble: filtered noise loop, level/pitch follow effective thrust %.
let thrustNodes = null;
export function setThrust(pct) {
  if (!ctx) return;
  if (!thrustNodes) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 120;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(bedBus);
    src.start();
    thrustNodes = { f, g };
  }
  const lvl = Math.max(0, Math.min(100, pct)) / 100;
  const t = ctx.currentTime;
  thrustNodes.g.gain.linearRampToValueAtTime(lvl * 0.16, t + 0.3);
  thrustNodes.f.frequency.linearRampToValueAtTime(90 + lvl * 220, t + 0.3);
  setBedTarget("thrust", lvl * 0.16);
}

// v4.5 hearing: a distant drive rumble — deeper and softer than own
// thrust; level follows the loudest rumble's signature-derived loudness.
let rumbleNodes = null;
export function setRumble(level) {
  if (!ctx) return;
  if (!rumbleNodes) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 46; // sub-rumble: felt more than heard
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(bedBus);
    src.start();
    rumbleNodes = { f, g };
  }
  const lvl = Math.max(0, Math.min(1, level));
  rumbleNodes.g.gain.linearRampToValueAtTime(lvl * 0.11, ctx.currentTime + 0.6);
  setBedTarget("rumble", lvl * 0.11);
}

// v4.7 §4.3: dust immersion — a soft filtered-noise wash while inside a
// cloud. Low on the SFX bus; the state speaks, not the XO.
let dustNodes = null;
export function setDustHiss(on) {
  if (!ctx) return;
  if (!dustNodes) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(bedBus);
    src.start();
    dustNodes = { g };
  }
  dustNodes.g.gain.linearRampToValueAtTime(on ? 0.045 : 0, ctx.currentTime + 0.8);
  setBedTarget("dust", on ? 0.045 : 0);
}

// Lock warning (RWR) — v5.1 §2, the alarm law: information lives in the
// ONSET and the CHANGE, never in persistence. "locked" fires the full
// blare for LOCK_ONSET_MS (the oh-shit moment — deliberately awful), then
// decays to a soft heartbeat whose only job is "still true" — one thump
// PER LOCKER (§2.2: a triple-thump means run). Any change (reacquire, new
// attacker, launch while locked) snaps back to full onset.
const LOCK_ONSET_MS = 4000;
const LOCK_HEARTBEAT_MS = 2500;
const ACQUIRING_MAX_BEEPS = 8; // inherently short-lived (locks take ~5 s) — just capped

let warnState = "none";
let warnLockers = 0;
let warnTimer = null; // repeating pulse of the current phase
let warnPhaseTimer = null; // onset -> sustain hand-off

function clearWarnTimers() {
  clearInterval(warnTimer);
  warnTimer = null;
  clearTimeout(warnPhaseTimer);
  warnPhaseTimer = null;
}

function lockOnset() {
  clearWarnTimers();
  const blare = () => {
    const t = ctx.currentTime;
    osc("square", 950, t, 0.085, 0.22);
    osc("square", 950, t + 0.13, 0.085, 0.22);
  };
  blare();
  warnTimer = setInterval(blare, 300);
  warnPhaseTimer = setTimeout(() => {
    clearInterval(warnTimer);
    // sustain: sine, ~500 Hz, a quarter the level — never the onset's
    // timbre. One thump per locker, capped at 4 (past that, just run).
    const beat = () => {
      const t = ctx.currentTime;
      for (let i = 0; i < Math.min(Math.max(1, warnLockers), 4); i++) {
        osc("sine", 500, t + i * 0.17, 0.09, 0.055);
      }
    };
    beat();
    warnTimer = setInterval(beat, LOCK_HEARTBEAT_MS);
  }, LOCK_ONSET_MS);
}

export function setWarning(state, lockers = state === "locked" ? 1 : 0) {
  const changed = state !== warnState;
  const newAttacker = state === "locked" && !changed && lockers > warnLockers;
  warnLockers = lockers;
  if (!changed && !newAttacker) return;
  warnState = state;
  clearWarnTimers();
  if (!ctx || state === "none") return;
  if (state === "acquiring") {
    let beeps = 0;
    const beep = () => {
      if (++beeps > ACQUIRING_MAX_BEEPS) {
        clearInterval(warnTimer);
        warnTimer = null;
        return;
      }
      const t = ctx.currentTime;
      osc("square", 620, t, 0.11, 0.16);
      osc("square", 840, t + 0.25, 0.11, 0.16);
    };
    beep();
    warnTimer = setInterval(beep, 1100);
  } else if (state === "locked") {
    lockOnset(); // full onset on ANY change — including a new attacker
  }
}

// §2.1: a detected launch while we're locked snaps the alarm back to onset
export function reassertWarning() {
  if (ctx && warnState === "locked") lockOnset();
}

// Missile-proximity ticking: accelerates as the nearest visible inbound
// missile closes. null = no inbound.
let proxDist = null;
let proxTimeout = null;
export function setMissileProximity(distM) {
  proxDist = distM;
  if (distM !== null && !proxTimeout) scheduleProxTick();
}
function scheduleProxTick() {
  if (proxDist === null || !ctx) {
    proxTimeout = null;
    return;
  }
  osc("square", 1300, ctx.currentTime, 0.02, 0.1);
  // 6 km -> ~1.1s between ticks; point blank -> 80 ms
  const delay = 80 + 1050 * Math.min(1, proxDist / 6000);
  proxTimeout = setTimeout(scheduleProxTick, delay);
}

// Silence continuous layers (game over / death→spectator / disconnect).
export function stopContinuous() {
  setWarning("none");
  setCollisionKlaxon(false);
  proxDist = null;
  if (thrustNodes && ctx) thrustNodes.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  if (rumbleNodes && ctx) rumbleNodes.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  if (dustNodes && ctx) dustNodes.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
}

// ---------- ship-AI speech queue ----------
// One line at a time, never overlapping. Scheduling policy (tiers, the
// inter-line gap, TTLs, barge-in) lives in speech-scheduler.js — this side
// is only the WebAudio driver: fetch/decode/play, fade-stop, re-poll timers.

const decoded = new Map(); // speech id -> AudioBuffer promise

function fetchSpeech(id) {
  if (!decoded.has(id)) {
    decoded.set(
      id,
      fetch(`/speech/${id}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`speech ${r.status}`))))
        .then((ab) => ctx.decodeAudioData(ab))
        .catch(() => null)
    );
  }
  return decoded.get(id);
}

let lineSrc = null; // currently-playing {src, gain, gen}
let lineGen = 0; // invalidates onended/decode callbacks after a stop()
let pollTimer = null;

const sched = createSpeechScheduler({
  now: () => performance.now(),
  later: (ms) => {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => sched.poll(), ms);
  },
  start: (id) => {
    const gen = ++lineGen;
    void (async () => {
      const buf = await fetchSpeech(id);
      if (gen !== lineGen) return; // stopped while decoding
      if (!buf) {
        sched.onEnded(); // missing line: over instantly
        return;
      }
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      src.connect(gain);
      gain.connect(speechBus);
      src.onended = () => {
        if (gen !== lineGen) return; // preempted — the scheduler already moved on
        lineSrc = null;
        speechBedDuck(false);
        sched.onEnded();
      };
      lineSrc = { src, gain, gen };
      speechBedDuck(true); // §4.1: room tone drops while the XO talks
      src.start();
    })();
  },
  stop: (fadeMs) => {
    lineGen++; // orphan in-flight decode + onended
    speechBedDuck(false);
    if (lineSrc && ctx) {
      const { src, gain } = lineSrc;
      lineSrc = null;
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeMs / 1000);
      try {
        src.stop(ctx.currentTime + fadeMs / 1000);
      } catch {
        /* already stopped */
      }
    }
  },
});

export function enqueueSpeech(id, priority = "news") {
  if (!ctx) return;
  // §4.3 verbosity: TERSE drops chatter, SILENT drops all but critical.
  // Speech only — the transcript logged the line either way.
  if (verbosity === "terse" && priority === "chatter") return;
  if (verbosity === "silent" && priority !== "critical") return;
  sched.enqueue(id, priority);
}

// PTT down: the captain spoke — drop the playing non-critical line, flush
// chatter. CRITICAL finishes, ducked. See speech-scheduler.js §1.4.
export function bargeIn() {
  sched.bargeIn();
}
