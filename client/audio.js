// Procedural SFX (Web Audio, no assets) + ship-AI speech queue.
// Everything routes through one master gain: the VOL slider.

let ctx = null;
let master = null;
let sfxBus = null;
let speechBus = null;

let volume = Number(localStorage.getItem("vol") ?? 0.7);

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
  master.gain.value = volume;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  sfxBus.connect(master);
  speechBus = ctx.createGain();
  speechBus.gain.value = 1.0;
  speechBus.connect(master);
}

let ducked = false;
export function setVolume(v) {
  volume = v;
  localStorage.setItem("vol", String(v));
  if (master && !ducked) master.gain.value = v;
}

// Duck game audio while the captain is talking (push-to-talk held): they
// hear themselves think, and the mic picks up far less game noise.
export function duck(on) {
  ducked = on;
  if (!ctx) return;
  master.gain.linearRampToValueAtTime(on ? volume * 0.15 : volume, ctx.currentTime + 0.15);
}

export function getVolume() {
  return volume;
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

// Collision-warning klaxon: two-tone whoop, repeated by the caller's state.
let klaxonTimer = null;
export function setCollisionKlaxon(on) {
  if (!!klaxonTimer === !!on) return;
  if (!on) {
    clearInterval(klaxonTimer);
    klaxonTimer = null;
    return;
  }
  if (!ctx) return;
  const whoop = () => {
    const t = ctx.currentTime;
    osc("sawtooth", 400, t, 0.28, 0.2, 800);
    osc("sawtooth", 400, t + 0.34, 0.28, 0.2, 800);
  };
  whoop();
  klaxonTimer = setInterval(whoop, 1400);
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
    src.connect(f).connect(g).connect(sfxBus);
    src.start();
    thrustNodes = { f, g };
  }
  const lvl = Math.max(0, Math.min(100, pct)) / 100;
  const t = ctx.currentTime;
  thrustNodes.g.gain.linearRampToValueAtTime(lvl * 0.16, t + 0.3);
  thrustNodes.f.frequency.linearRampToValueAtTime(90 + lvl * 220, t + 0.3);
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
    src.connect(f).connect(g).connect(sfxBus);
    src.start();
    rumbleNodes = { f, g };
  }
  const lvl = Math.max(0, Math.min(1, level));
  rumbleNodes.g.gain.linearRampToValueAtTime(lvl * 0.11, ctx.currentTime + 0.6);
}

// Lock warning (RWR): "acquiring" = rising two-tone; "locked" = continuous
// urgent pulse. The single most important sound in the game.
let warnState = "none";
let warnTimer = null;
export function setWarning(state) {
  if (state === warnState) return;
  warnState = state;
  if (warnTimer) {
    clearInterval(warnTimer);
    warnTimer = null;
  }
  if (!ctx || state === "none") return;
  if (state === "acquiring") {
    const beep = () => {
      const t = ctx.currentTime;
      osc("square", 620, t, 0.11, 0.16);
      osc("square", 840, t + 0.25, 0.11, 0.16);
    };
    beep();
    warnTimer = setInterval(beep, 1100);
  } else if (state === "locked") {
    const blare = () => {
      const t = ctx.currentTime;
      osc("square", 950, t, 0.085, 0.22);
      osc("square", 950, t + 0.13, 0.085, 0.22);
    };
    blare();
    warnTimer = setInterval(blare, 300);
  }
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

// Silence continuous layers (game over / disconnect).
export function stopContinuous() {
  setWarning("none");
  proxDist = null;
  if (thrustNodes && ctx) thrustNodes.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  if (rumbleNodes && ctx) rumbleNodes.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
}

// ---------- ship-AI speech queue ----------
// One line at a time, never overlapping. Warnings (alert) jump the queue;
// stale non-alert acknowledgements are dropped rather than played late.

const speechQueue = [];
let speaking = false;
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

// Battle-tempo throttle: the ear is a scarcer resource than the transcript.
// - warnings (alert) always speak: they jump ahead of chatter, identical
//   lines already waiting are deduped, and only the 2 freshest warnings
//   stay queued (older ones are superseded news)
// - everything else speaks ONLY when the voice channel is idle — during a
//   furball the chatter goes text-only instead of piling up
export function enqueueSpeech(id, alert = false) {
  if (!ctx) return;
  if (!alert && (speaking || speechQueue.length > 0)) return;
  const entry = { id, alert, at: performance.now(), buf: fetchSpeech(id) };
  if (alert) {
    if (speechQueue.some((e) => e.alert && e.id === id)) return; // dedupe
    const firstNonAlert = speechQueue.findIndex((e) => !e.alert);
    if (firstNonAlert === -1) speechQueue.push(entry);
    else speechQueue.splice(firstNonAlert, 0, entry);
    // keep only the freshest 2 warnings
    let alerts = speechQueue.filter((e) => e.alert);
    while (alerts.length > 2) {
      speechQueue.splice(speechQueue.indexOf(alerts[0]), 1);
      alerts = speechQueue.filter((e) => e.alert);
    }
  } else {
    speechQueue.push(entry);
  }
  void playNext();
}

async function playNext() {
  if (speaking || speechQueue.length === 0) return;
  speaking = true;
  const entry = speechQueue.shift();
  // anything that sat queued too long is stale news — skip it
  if (performance.now() - entry.at > (entry.alert ? 6000 : 8000)) {
    speaking = false;
    void playNext();
    return;
  }
  const buf = await entry.buf;
  if (!buf) {
    speaking = false;
    void playNext();
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(speechBus);
  src.onended = () => {
    speaking = false;
    void playNext();
  };
  src.start();
}
