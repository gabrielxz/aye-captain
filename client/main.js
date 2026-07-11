// ws handling + client state store
import { startRenderLoop, bigBoomAt, showVector, camera } from "./render.js";
import { initUI, addTranscript, updateHUD, showLobbyStatus, enterGame, showBanner, hideBanner, updateWatching, setSpectator } from "./ui.js";
import * as audio from "./audio.js";

export const state = {
  config: null, // {zoneRadius, stt} from server hello
  terrain: null, // {seed, rocks[], dust[]} — arrives with each match start
  role: null, // "A" | "B" | "spectator"
  callsign: null, // spectator callsign (cosmetic, server-assigned)
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
      state.callsign = msg.callsign ?? null;
      state.practice = !!msg.practice;
      state.terrain = msg.terrain ?? null;
      state.prevSnap = null;
      state.lastSnap = null;
      state.fxBuffer = [];
      state.gameOver = false;
      updateWatching([]); // fresh roster arrives right behind the start
      setSpectator(msg.role === "spectator" ? msg.callsign : null);
      if (msg.role === "spectator") {
        // referee framing: whole region, nothing to follow
        camera.follow = false;
        camera.x = 0;
        camera.y = 0;
        camera.zoom = 0; // recomputed to the full-region view on the next frame
      }
      hideBanner();
      enterGame();
      addTranscript(
        "sys",
        msg.role === "spectator"
          ? `spectating as ${msg.callsign} — the room sees your callsign`
          : msg.practice
            ? "practice mode — drone contact inbound"
            : `you are ship ${msg.role}`
      );
      break;
    case "spectators":
      // silent by design: no sound, no transcript line, no XO mention
      updateWatching(msg.names ?? []);
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
        if (fx.type === "pdc") audio.sfxPdc(fx.owner === state.role); // internally rate-limited
      }
      soundFromSnapshot(msg);
      updateHUDFromSnapshot(msg);
      break;
    }
    case "gameover": {
      state.gameOver = true;
      audio.stopContinuous();
      const snap = state.lastSnap;
      const mins = Math.floor(msg.durationS / 60);
      const secs = Math.round(msg.durationS % 60);
      const timeLine = `match time ${mins}:${String(secs).padStart(2, "0")}`;
      if (state.role === "spectator") {
        audio.sfxBoom(true, false);
        const loser = (snap?.ships ?? []).find((s) => s.id !== msg.winner);
        if (loser) bigBoomAt(loser.x, loser.y);
        showBanner(
          `SHIP ${msg.winner} WINS`,
          msg.forfeit ? "opponent never came back — win by forfeit" : timeLine
        );
        addTranscript("sys", `ship ${msg.winner} wins — match over`);
        break;
      }
      audio.sfxBoom(true, !msg.youWin);
      // terminal explosion on the losing ship
      if (snap) {
        const contact = (snap.contacts ?? [])[0];
        if (!msg.youWin && snap.you) bigBoomAt(snap.you.x, snap.you.y);
        else if (msg.youWin && contact) bigBoomAt(contact.x, contact.y);
      }
      showBanner(
        msg.youWin ? "VICTORY" : "SHIP LOST",
        msg.forfeit
          ? "opponent never came back — win by forfeit"
          : timeLine
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
    case "ui":
      if (msg.what === "show_vector") showVector(5000);
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
  // hearing: the loudest rumble drives the low ambience (0 = silence)
  audio.setRumble(Math.max(0, ...(snap.rumbles ?? []).map((r) => r.loud ?? 0)));

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
    // any hull drop we take: rock hits crunch, weapons fire booms
    if (you.hull < prevAudio.hull) {
      if (prevAudio.collisionWarning !== null) audio.sfxCrunch();
      else audio.sfxBoom(false, true);
    }
  }
  // collision klaxon while an impact is projected inside 10 s
  audio.setCollisionKlaxon(
    you.collisionWarning !== null && you.collisionWarning !== undefined && you.collisionWarning <= 10
  );
  prevAudio = {
    tubes: (you.tubes ?? []).map((t) => ({ state: t.state })),
    enemyMissiles: new Set((snap.missiles ?? []).filter((m) => !m.own).map((m) => m.id)),
    decoys: you.decoys ?? 0,
    hull: you.hull,
    collisionWarning: you.collisionWarning ?? null,
  };
}

const TUBE_LABEL = { ready: "RDY", reloading: null, empty: "—" };
function updateHUDFromSnapshot(snap) {
  if (snap.spectator) {
    // referee panel: just the two hulls (everything else is on the map)
    updateHUD(
      (snap.ships ?? []).map((s) => ({
        label: `SHIP ${s.id} HULL`,
        value: `${s.hull}/${s.hullMax}${s.drone ? " (drone)" : ""}`,
        cls: s.hull <= s.hullMax * 0.35 ? "alert" : s.hull <= s.hullMax * 0.65 ? "warn" : "",
      }))
    );
    return;
  }
  const you = snap.you;
  if (!you) return;
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
  const contact = (snap.contacts ?? [])[0] ?? null;
  const TIER_LABEL = { 1: "FAINT", 2: "TRACK", 3: "ID" };
  const contactLabel = contact ? TIER_LABEL[contact.tier] ?? "?" : snap.ghost ? "ghost" : "—";
  const enemyHull = contact?.tier === 3 && contact.hull !== undefined ? `${contact.hull}/${contact.hullMax ?? 100}` : "—";
  updateHUD([
    { label: "HULL", value: `${you.hull}`, cls: you.hull <= 35 ? "alert" : you.hull <= 65 ? "warn" : "" },
    { label: "EN HULL", value: enemyHull, cls: contact?.tier === 3 && contact.hull <= (contact.hullMax ?? 100) / 2 ? "good" : "" },
    { label: "CONTACT", value: contactLabel, cls: contact ? (contact.tier >= 2 ? "good" : "warn") : "" },
    { label: "SIG", value: `${Math.round(you.signature ?? 0)}`, cls: (you.signature ?? 0) > 100 ? "alert" : (you.signature ?? 0) > 50 ? "warn" : "good" },
    { label: "THRUST", value: `${Math.round(you.thrust)}%${tanksDry && you.thrust > 0 ? " (DRY)" : ""}`, cls: tanksDry && you.thrust > 0 ? "alert" : "" },
    { label: "SPD", value: `${you.speed} m/s` },
    { label: "HDG", value: `${String(Math.round(you.facing) % 360).padStart(3, "0")}` },
    { label: "PROP", value: prop, bar: true, cls: prop <= 10 ? "alert" : prop <= 25 ? "warn" : "" },
    { label: "TUBES", value: tubes || "—" },
    { label: "MSL", value: `${you.missiles}` },
    { label: "DECOY", value: `${you.decoys}` },
    {
      label: "PDC",
      value: `${(you.pdc?.posture ?? "free").toUpperCase()} ${you.pdc?.ammoS ?? 0}s`,
      cls: (you.pdc?.ammoS ?? 0) <= 6 ? "alert" : (you.pdc?.ammoS ?? 0) <= 15 ? "warn" : you.pdc?.posture === "free" ? "good" : "",
    },
    {
      label: "PING",
      value: you.ping?.ready ? "READY" : `${you.ping?.cooldownS ?? 0}s`,
      cls: you.ping?.ready ? "good" : "",
    },
    {
      label: "ZONE",
      value: you.inDust ? "IN DUST (blind)" : you.insideZone ? "inside" : "OUTSIDE",
      cls: you.inDust ? "warn" : you.insideZone ? "" : "warn",
    },
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
