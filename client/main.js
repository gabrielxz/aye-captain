// ws handling + client state store
import { startRenderLoop, bigBoomAt, showVector, setOverlay, resetOverlays, kickShake, camera } from "./render.js";
import { initUI, addTranscript, updateHUD, showLobbyStatus, enterGame, showBanner, hideBanner, updateWatching, setSpectator, showRoomLobby, hideRoomLobby } from "./ui.js";
import * as audio from "./audio.js";

export const state = {
  config: null, // {zoneRadius, stt} from server hello
  terrain: null, // {seed, rocks[], dust[]} — arrives with each match start
  role: null, // seat id ("A".."H") | "spectator"
  team: null, // "red" | "blue" | null (v5 teams mode)
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
      state.team = msg.team ?? null;
      state.callsign = msg.callsign ?? null;
      hideRoomLobby();
      state.practice = !!msg.practice;
      state.terrain = msg.terrain ?? null;
      state.prevSnap = null;
      state.lastSnap = null;
      state.fxBuffer = [];
      state.gameOver = false;
      resetOverlays();
      prevTiers = null;
      pingListen = null;
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
        else if (fx.type === "ping") {
          // whose ping? it rings out from a hull — ours if it's ours
          const own = !!msg.you && Math.hypot(fx.x - msg.you.x, fx.y - msg.you.y) < 1000;
          audio.sfxPing(own);
          // open the return-listen window (grant lasts ~5 s server-side);
          // the first new-or-promoted contact schedules the echo blip
          if (own) pingListen = { until: now + 5000, rangeM: fx.r, done: false };
        }
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
      // v5 §2: banner lists the placements ("A · C · B", winner first)
      const standings =
        (msg.placements ?? []).length > 2 ? ` — standings: ${msg.placements.join(" · ")}` : "";
      const isTeamWin = msg.winner === "red" || msg.winner === "blue";
      const winnerName = msg.winnerName ?? msg.winner;
      const winnerLabel = isTeamWin
        ? `${String(winnerName).toUpperCase()} TEAM WINS`
        : `${String(winnerName).toUpperCase()} WINS`;
      if (state.role === "spectator") {
        audio.sfxBoom(true, false);
        showBanner(winnerLabel, (msg.forfeit ? "win by forfeit — " : "") + timeLine + standings);
        addTranscript("sys", `${isTeamWin ? `team ${winnerName}` : winnerName} wins — match over`);
        break;
      }
      audio.sfxBoom(true, !msg.youWin);
      if (!msg.youWin) kickShake(true);
      // terminal explosion on the losing ship
      if (snap) {
        const contact = (snap.contacts ?? [])[0];
        if (!msg.youWin && snap.you) bigBoomAt(snap.you.x, snap.you.y);
        else if (msg.youWin && contact) bigBoomAt(contact.x, contact.y);
      }
      showBanner(
        msg.youWin ? "VICTORY" : "SHIP LOST",
        (msg.forfeit ? "win by forfeit — " : "") + timeLine + standings
      );
      addTranscript("sys", msg.youWin ? "Enemy ship destroyed. Well fought, Captain." : "Hull breach — we're done. Abandon ship.", !msg.youWin);
      break;
    }
    case "created":
      showLobbyStatus(`ROOM CODE: ${msg.code}`);
      break;
    case "lobby":
      // v5 §2: roster/config while the room fills; creator launches
      showRoomLobby(msg);
      break;
    case "error":
      showLobbyStatus(msg.message);
      addTranscript("sys", msg.message, true);
      break;
    case "ui":
      if (msg.what === "show_vector") showVector(5000);
      else if (msg.what === "overlay") setOverlay(msg.element, msg.state === "on");
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
let prevTiers = null; // cid -> tier from the previous snapshot
let pingListen = null; // {until, rangeM, done} — set when OUR ping fires
function soundFromSnapshot(snap) {
  const you = snap.you;
  if (!you || state.gameOver) return;

  // v4.7 §3b: sonar return. During the grant window after our own ping,
  // the nearest NEW or PROMOTED contact schedules a range-delayed blip.
  // No new contact = the outgoing ping, a long silence, and nothing.
  const tiers = new Map((snap.contacts ?? []).map((c) => [c.cid, c.tier]));
  if (pingListen && !pingListen.done && performance.now() < pingListen.until && prevTiers) {
    let nearest = null;
    for (const c of snap.contacts ?? []) {
      if (c.tier > (prevTiers.get(c.cid) ?? 0)) {
        const d = Math.hypot(c.x - you.x, c.y - you.y);
        if (nearest === null || d < nearest) nearest = d;
      }
    }
    if (nearest !== null) {
      pingListen.done = true;
      audio.sfxPingReturn(audio.PING_RETURN_MS_AT_MAX_RANGE * Math.min(1, nearest / pingListen.rangeM));
    }
  }

  // v4.7 §4.2: tier ceremony. One sting per snapshot (the loudest change
  // wins) so simultaneous shifts don't chord. Suppressed through the ping
  // grant window and its expiry edge — a ping mass-promotes and then
  // mass-drops, and the return blip is that event's sound.
  const pingQuiet = pingListen && performance.now() < pingListen.until + 1500;
  if (prevTiers && !pingQuiet) {
    let best = null; // {tier, up}; promotions outrank demotions
    for (const cid of new Set([...tiers.keys(), ...prevTiers.keys()])) {
      const now2 = tiers.get(cid) ?? 0;
      const was = prevTiers.get(cid) ?? 0;
      if (now2 > was) {
        if (!best || !best.up || now2 > best.tier) best = { tier: now2, up: true };
      } else if (now2 < was) {
        if (!best) best = { tier: was, up: false };
        else if (!best.up && was > best.tier) best = { tier: was, up: false };
      }
    }
    if (best) audio.sfxTierShift(best.tier, best.up);
  }
  prevTiers = tiers;

  audio.setThrust(you.thrustOut ?? you.thrust);
  audio.setWarning(you.painted ?? "none");
  audio.setDustHiss(!!you.inDust);
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
    // any hull drop we take: rock hits crunch, weapons fire booms — and
    // either way the camera feels it (v4.7 §4.5)
    if (you.hull < prevAudio.hull) {
      if (prevAudio.collisionWarning !== null) audio.sfxCrunch();
      else audio.sfxBoom(false, true);
      kickShake(prevAudio.hull - you.hull >= 20);
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
        label: `${(s.callsign ?? s.id).toUpperCase()} HULL`,
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
  // v5 §3: contacts carry designation labels; each tier names what it buys
  // (the tier vocabulary anchor, playtest 2026-07-11)
  const TIER_WORD = { 1: "FAINT", 2: "TRACK", 3: "ID" };
  const contacts = snap.contacts ?? [];
  const ghosts = snap.ghosts ?? (snap.ghost ? [snap.ghost] : []);
  const contactsLine =
    contacts.length === 0 && ghosts.length === 0
      ? "—"
      : [
          ...contacts.map((c) => `${c.label ?? "?"}·${TIER_WORD[c.tier] ?? "?"}`),
          ...ghosts.map((g) => `${g.label ?? "ghost"}·lost`),
        ].join("  ");
  const idContact = contacts.find((c) => c.tier === 3 && c.hull !== undefined) ?? null;
  const enemyHull = idContact ? `${idContact.hull}/${idContact.hullMax ?? 100}` : "—";
  updateHUD([
    { label: "SHIP", value: you.callsign ?? state.role ?? "—", cls: "good" },
    { label: "HULL", value: `${you.hull}`, cls: you.hull <= 35 ? "alert" : you.hull <= 65 ? "warn" : "" },
    { label: "EN HULL", value: enemyHull, cls: idContact && idContact.hull <= (idContact.hullMax ?? 100) / 2 ? "good" : "" },
    { label: "CONTACTS", value: contactsLine, cls: contacts.some((c) => c.tier >= 2) ? "good" : contacts.length ? "warn" : "", full: true },
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
      // LIT = the reveal window: everyone on the map reads us at ID tier.
      // A countdown, not a voice line — dread for exactly as long as earned.
      value:
        (you.ping?.revealS ?? 0) > 0
          ? `◤ LIT ${you.ping.revealS}s ◥`
          : you.ping?.ready
            ? "READY"
            : `${you.ping?.cooldownS ?? 0}s`,
      cls: (you.ping?.revealS ?? 0) > 0 ? "alert" : you.ping?.ready ? "good" : "",
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
