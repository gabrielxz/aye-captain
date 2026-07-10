// ws handling + client state store
import { startRenderLoop, bigBoomAt } from "./render.js";
import { initUI, addTranscript, updateHUD, showLobbyStatus, enterGame, showBanner, hideBanner } from "./ui.js";
import * as audio from "./audio.js";

export const state = {
  config: null, // {zoneRadius, hardLimitRadius} from server hello
  terrain: null, // {seed, rocks[], dust[]} — arrives with each match start
  role: null, // "A" | "B"
  practice: false,
  prevSnap: null, // previous snapshot (for interpolation)
  lastSnap: null, // latest snapshot
  lastSnapAt: 0, // performance.now() when lastSnap arrived
  snapIntervalMs: 250, // measured gap between snapshots (server sends at 4 Hz)
  fxBuffer: [], // transient effects: {fx, at: performance.now()}
  gameOver: false,
  ws: null,
};

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  state.ws = ws;

  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleMessage(msg);
  });

  ws.addEventListener("close", () => {
    showLobbyStatus("connection lost — refresh to reconnect");
    addTranscript("sys", "Connection to ship lost.", true);
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case "hello":
      state.config = msg.config;
      break;
    case "start":
      state.role = msg.role;
      state.practice = !!msg.practice;
      state.terrain = msg.terrain ?? null;
      state.prevSnap = null;
      state.lastSnap = null;
      state.fxBuffer = [];
      state.gameOver = false;
      hideBanner();
      enterGame();
      addTranscript("sys", msg.practice ? "practice mode — drone contact inbound" : `you are ship ${msg.role}`);
      break;
    case "snapshot": {
      const now = performance.now();
      if (state.lastSnap) {
        state.snapIntervalMs = Math.min(2000, Math.max(100, now - state.lastSnapAt));
      }
      state.prevSnap = state.lastSnap;
      state.lastSnap = msg;
      state.lastSnapAt = now;
      for (const fx of msg.fx ?? []) {
        state.fxBuffer.push({ fx, at: now });
      }
      soundFromSnapshot(msg);
      updateHUDFromSnapshot(msg);
      break;
    }
    case "gameover": {
      state.gameOver = true;
      audio.stopContinuous();
      audio.sfxBoom(true, !msg.youWin);
      // terminal explosion on the losing ship
      const snap = state.lastSnap;
      if (snap) {
        if (!msg.youWin && snap.you) bigBoomAt(snap.you.x, snap.you.y);
        else if (msg.youWin && snap.enemy?.visible) bigBoomAt(snap.enemy.x, snap.enemy.y);
      }
      const mins = Math.floor(msg.durationS / 60);
      const secs = Math.round(msg.durationS % 60);
      showBanner(
        msg.youWin ? "VICTORY" : "SHIP LOST",
        msg.forfeit
          ? "opponent never came back — win by forfeit"
          : `match time ${mins}:${String(secs).padStart(2, "0")}`
      );
      addTranscript("sys", msg.youWin ? "Enemy ship destroyed. Well fought, Captain." : "Hull breach — we're done. Abandon ship.", !msg.youWin);
      break;
    }
    case "created":
      showLobbyStatus(`ROOM CODE: ${msg.code} — waiting for opponent...`);
      break;
    case "error":
      showLobbyStatus(msg.message);
      addTranscript("sys", msg.message, true);
      break;
    case "transcript":
      addTranscript(msg.who, msg.text, msg.alert);
      if (msg.speech) audio.enqueueSpeech(msg.speech, !!msg.alert);
      break;
    default:
      console.log("unhandled message", msg);
  }
}

// State-diff sound triggers: compare consecutive snapshots so the server
// protocol stays unchanged (fx events cover the rest).
let prevAudio = null;
function soundFromSnapshot(snap) {
  const you = snap.you;
  if (!you || state.gameOver) return;

  audio.setThrust(you.thrustOut ?? you.thrust);
  audio.setWarning(you.painted ?? "none");

  // nearest visible inbound missile drives the proximity ticker
  let nearest = null;
  for (const m of snap.missiles ?? []) {
    if (m.own) continue;
    const d = Math.hypot(m.x - you.x, m.y - you.y);
    if (nearest === null || d < nearest) nearest = d;
  }
  audio.setMissileProximity(nearest);

  if (prevAudio) {
    // tube transitions: ready -> reloading/empty = our launch; -> ready = reload done
    const pt = prevAudio.tubes ?? [];
    (you.tubes ?? []).forEach((t, i) => {
      const was = pt[i]?.state;
      if (was === "ready" && t.state !== "ready") audio.sfxLaunch(true);
      if (was === "reloading" && t.state === "ready") audio.sfxReload();
    });
    // a new enemy missile on scope
    const prevIds = prevAudio.enemyMissiles;
    for (const m of snap.missiles ?? []) {
      if (!m.own && !prevIds.has(m.id)) audio.sfxLaunch(false);
    }
    // decoy deployed (ours)
    if ((you.decoys ?? 0) < prevAudio.decoys) audio.sfxDecoy();
    // any hull drop we can see: crunch (ours = received)
    if (you.hull < prevAudio.hull) audio.sfxBoom(false, true);
  }
  prevAudio = {
    tubes: (you.tubes ?? []).map((t) => ({ state: t.state })),
    enemyMissiles: new Set((snap.missiles ?? []).filter((m) => !m.own).map((m) => m.id)),
    decoys: you.decoys ?? 0,
    hull: you.hull,
  };
}

const TUBE_LABEL = { ready: "RDY", reloading: null, empty: "—" };
function updateHUDFromSnapshot(snap) {
  const you = snap.you;
  if (!you) return;
  const laser = you.laserCooldown > 0 ? `${you.laserCooldown.toFixed(0)}s` : "READY";
  const tanksDry = (you.propellant ?? 0) <= 0;
  const tubes = (you.tubes ?? [])
    .map((t, i) => `${i + 1}:${TUBE_LABEL[t.state] ?? `${t.t}s`}`)
    .join(" ");
  const lock = you.lock?.has
    ? "LOCKED"
    : you.lock?.progress > 0
      ? `ACQ ${Math.round(you.lock.progress * 100)}%`
      : "no lock";
  const painted = you.painted ?? "none";
  const prop = Math.round(you.propellant ?? 0);
  const en = snap.enemy;
  const enemyHull = en?.visible && en.hull !== undefined ? `${en.hull}/${en.hullMax ?? 100}` : "—";
  updateHUD([
    { label: "HULL", value: `${you.hull}`, cls: you.hull <= 35 ? "alert" : you.hull <= 65 ? "warn" : "" },
    { label: "EN HULL", value: enemyHull, cls: en?.visible && en.hull <= (en.hullMax ?? 100) / 2 ? "good" : "" },
    { label: "THRUST", value: `${Math.round(you.thrust)}%${tanksDry && you.thrust > 0 ? " (DRY)" : ""}`, cls: tanksDry && you.thrust > 0 ? "alert" : "" },
    { label: "SPD", value: `${you.speed} m/s` },
    { label: "HDG", value: `${String(Math.round(you.facing) % 360).padStart(3, "0")}` },
    { label: "PROP", value: prop, bar: true, cls: prop <= 10 ? "alert" : prop <= 25 ? "warn" : "" },
    { label: "TUBES", value: tubes || "—" },
    { label: "MSL", value: `${you.missiles}` },
    { label: "DECOY", value: `${you.decoys}` },
    { label: "LASER", value: laser },
    { label: "ZONE", value: you.insideZone ? "inside" : "OUTSIDE", cls: you.insideZone ? "" : "warn" },
    {
      label: "COLL",
      value: you.collisionWarning !== null && you.collisionWarning !== undefined ? `impact ${you.collisionWarning}s` : "—",
      cls: you.collisionWarning === null || you.collisionWarning === undefined ? "" : you.collisionWarning <= 10 ? "alert" : "warn",
    },
    { label: "LOCK", value: lock, cls: you.lock?.has ? "good" : "" },
    {
      label: "WARN",
      value: painted === "locked" ? "◤ ENEMY LOCK ◥" : painted === "acquiring" ? "being painted" : "—",
      cls: painted === "locked" ? "alert" : painted === "acquiring" ? "warn" : "",
    },
    {
      label: "ORDERS",
      value:
        (you.standingOrders ?? []).length > 0
          ? you.standingOrders
              .map((o) => `${o.label}${o.repeat ? "*" : ""}${o.armed ? "" : " (cooling)"}`)
              .join(", ")
          : "none",
      full: true,
    },
  ]);
}

export function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

connect();
initUI();
startRenderLoop();
