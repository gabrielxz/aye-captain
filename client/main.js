// ws handling + client state store
import { startRenderLoop, bigBoomAt, showVector, setOverlay, resetOverlays, kickShake, camera, gateExitFx } from "./render.js";
import { initUI, addTranscript, updateHUD, showLobbyStatus, enterGame, showBanner, showReveal, showBannerLines, hideBanner, showRematchTally, setMenuVisible, updateWatching, setSpectator, showRoomLobby, hideRoomLobby, setCampaignBanner } from "./ui.js";
import * as audio from "./audio.js";
import { musicView, computeMusic } from "./music-brain.js";

export const state = {
  config: null, // {zoneRadius, stt} from server hello
  terrain: null, // {seed, rocks[], dust[]} — arrives with each match start
  role: null, // seat id ("A".."H") | "spectator"
  team: null, // "red" | "blue" | null (v5 teams mode)
  callsign: null, // spectator callsign (cosmetic, server-assigned)
  practice: false,
  campaign: false, // Deep Black solo run
  gate: null, // campaign gate geometry {x, y, apertureW} — fixed public landmark
  musicPrev: null, // last music-brain view (edge-triggers the stings)
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
      state.campaign = !!msg.campaign;
      state.coop = !!msg.coop; // Patch 2: server-owned run — no localStorage save
      state.gate = msg.gate ?? null; // campaign: fixed public landmark
      document.body.classList.toggle("campaign", state.campaign);
      state.terrain = msg.terrain ?? null;
      // Anvil §4: find the two pylon rocks by their known start geometry —
      // when the gate closes, the sim walks them inward and we mirror it
      state.pylonIdx = null;
      if (state.gate && state.terrain) {
        const g = state.gate;
        const gl = Math.max(1, Math.hypot(g.x, g.y));
        const off = g.apertureW / 2 + (state.config?.gatePylonRadiusM ?? 800);
        const p1 = { x: g.x - (-g.y / gl) * off, y: g.y - (g.x / gl) * off };
        const p2 = { x: g.x + (-g.y / gl) * off, y: g.y + (g.x / gl) * off };
        const idxNear = (p) => {
          const i = state.terrain.rocks.findIndex((r) => Math.hypot(r.x - p.x, r.y - p.y) < 1);
          return i >= 0 ? i : null;
        };
        const i1 = idxNear(p1);
        const i2 = idxNear(p2);
        if (i1 !== null && i2 !== null) state.pylonIdx = [i1, i2];
      }
      state.prevSnap = null;
      state.lastSnap = null;
      state.fxBuffer = [];
      state.gameOver = false;
      resetOverlays();
      // campaign: the drift marker defaults ON — the gate is the climax
      // and this is the instrument for flying it ("set_overlay off" still
      // works; a Stage 0 playtester may never discover the phrase)
      if (state.campaign) setOverlay("drift", true);
      // campaign: every system starts ON YOUR SHIP — a drag-pan in the
      // last system left follow off, and the camera woke up staring at
      // the old gate (playtest)
      if (state.campaign && msg.role !== "spectator") camera.follow = true;
      prevTiers = null;
      pingListen = null;
      updateWatching([]); // fresh roster arrives right behind the start
      setSpectator(msg.role === "spectator" ? msg.callsign : null);
      showRematchTally(0, 0); // a fresh start clears any ready-up tally
      setCampaignBanner(state.campaign ? "reset" : "off"); // banner buttons to mode default
      // §7.2: practice, campaign, and spectating get a live MENU control
      setMenuVisible(!!msg.practice || state.campaign || msg.role === "spectator");
      if (msg.role === "spectator") {
        // death→spectator arrives as a fresh start: kill the RWR pulse,
        // klaxon, thrust hum — a ghost has no alarms (playtest 2026-07-12:
        // the lock pulse clicked through all of spectator mode)
        audio.stopContinuous();
        if (msg.coop) {
          // Patch 2 §4/§5: coach mode — we ride our partner's sensors, so
          // the camera rides their ship (the snapshot's `you` is them)
          camera.follow = true;
        } else {
          // referee framing: whole region, nothing to follow
          camera.follow = false;
          camera.x = 0;
          camera.y = 0;
          camera.zoom = 0; // recomputed to the full-region view on the next frame
        }
      }
      hideBanner();
      enterGame();
      addTranscript(
        "sys",
        msg.role === "spectator"
          ? msg.coop
            ? "riding your partner's sensors — read the board, call the numbers"
            : `spectating as ${msg.callsign} — the room sees your callsign`
          : msg.campaign
            ? "deep black — reach the gate; the clock is a budget"
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
      // Patch 2 §4/§5: the badge names whose eyes these are
      if (msg.coopEyes && state.role === "spectator") {
        setSpectator(`${state.callsign ?? "DOWN"} — ${msg.coopEyes}'s eyes`);
      }
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
      // Anvil §4: mirror the closing gate — the sim walks the pylon rocks
      // inward; we re-derive their positions from the live aperture so the
      // wall the player sees IS the wall the physics enforces
      const closing = msg.you?.mission?.gateClosing;
      if (closing && state.gate) {
        state.gate.apertureLiveW = closing.apertureW;
        if (state.pylonIdx && state.terrain) {
          const g = state.gate;
          const gl = Math.max(1, Math.hypot(g.x, g.y));
          const off = closing.apertureW / 2 + (state.config?.gatePylonRadiusM ?? 800);
          const [i1, i2] = state.pylonIdx;
          const r1 = state.terrain.rocks[i1];
          const r2 = state.terrain.rocks[i2];
          if (r1) { r1.x = g.x - (-g.y / gl) * off; r1.y = g.y - (g.x / gl) * off; }
          if (r2) { r2.x = g.x + (-g.y / gl) * off; r2.y = g.y + (g.x / gl) * off; }
        }
      }
      soundFromSnapshot(msg);
      updateHUDFromSnapshot(msg);
      // campaign adaptive score: brain (pure, fog-tested) -> driver.
      // 🔴 the ONLY input is this wire snapshot — never sim truth (§7.1)
      if (state.campaign && !state.gameOver) {
        const view = musicView(msg);
        audio.setMusic(computeMusic(view, state.musicPrev ?? null));
        state.musicPrev = view;
      }
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
        showReveal(msg.reveal);
        addTranscript("sys", `${isTeamWin ? `team ${winnerName}` : winnerName} wins — match over`);
        break;
      }
      // campaign gate-clear: no terminal explosion, no boom — you left
      // (the exit spectacle is Stage 4; the XO's "We're through" carries it)
      // Anvil §4b: STRANDED is not an explosion — the ship is fine, the
      // door is gone. No boom, no shake; the silence is the point.
      if (!msg.gateCleared && !msg.stranded) {
        audio.sfxBoom(true, !msg.youWin);
        if (!msg.youWin) kickShake(true);
        // terminal explosion on the losing ship
        if (snap) {
          const contact = (snap.contacts ?? [])[0];
          if (!msg.youWin && snap.you) bigBoomAt(snap.you.x, snap.you.y);
          else if (msg.youWin && contact) bigBoomAt(contact.x, contact.y);
        }
      }
      if (state.campaign && msg.runSummary) {
        // §9: SYSTEMS CLEARED is the headline and the score. The run is
        // over either way — clear the save, keep the best. (Co-op runs are
        // server-owned and never touch the solo save file or best.)
        const s = msg.runSummary;
        if (!state.coop) {
          localStorage.removeItem("campaignRun");
          localStorage.setItem(
            "campaignBest",
            String(Math.max(Number(localStorage.getItem("campaignBest") ?? 0), s.systemsCleared))
          );
        }
        const best = state.coop
          ? s.systemsCleared
          : Number(localStorage.getItem("campaignBest") ?? 0);
        const tm = `${Math.floor(s.timeS / 60)}:${String(s.timeS % 60).padStart(2, "0")}`;
        const cause = msg.runComplete
          ? "eight of eight — the deep black, crossed"
          : msg.stranded
            ? "RUN ENDED — STRANDED: the gate closed with us inside"
            : String(msg.winner ?? "").startsWith("H")
              ? "the Hunter got us"
              : "lost to misadventure";
        if (msg.runComplete) {
          // the final gate gets the full §8 exit before the scoreboard
          audio.musicExit();
          gateExitFx();
        }
        const showSummary = () => {
          showBanner(
            `SYSTEMS CLEARED: ${s.systemsCleared}`,
            `${cause} — hunters killed ${s.huntersKilled} · salvage ${s.salvaged} · upgrades ${s.upgrades} · pings fired ${s.pingsFired} · run time ${tm} · best run ${best}`
          );
          setCampaignBanner("over");
        };
        if (msg.runComplete) setTimeout(showSummary, 1500);
        else showSummary();
        addTranscript(
          "sys",
          msg.runComplete ? "The run is complete, Captain. Eight systems." : `run over — made it to system ${s.systemsCleared + 1}`,
          !msg.runComplete
        );
        break;
      }
      showBanner(
        msg.gateCleared ? "SYSTEM CLEARED" : msg.youWin ? "VICTORY" : "SHIP LOST",
        (msg.forfeit ? "win by forfeit — " : "") + timeLine + standings
      );
      showReveal(msg.reveal); // §5.4: who everyone actually was
      addTranscript(
        "sys",
        msg.gateCleared
          ? "Through the gate. System clear."
          : msg.youWin
            ? "Enemy ship destroyed. Well fought, Captain."
            : "Hull breach — we're done. Abandon ship.",
        !msg.youWin
      );
      break;
    }
    case "system_clear": {
      // campaign transition: the run map — a breath between systems. The
      // run state is OURS to keep (single-player suspends server
      // authority; localStorage is the save file).
      state.gameOver = true; // freeze inputs-to-sim mattering; sim is stopped server-side
      audio.stopContinuous();
      audio.musicExit(); // §8: the beat of silence, the rising tone, the resolve
      gateExitFx(); // …and the flash + streak
      // solo: the run state is OURS to keep; co-op runs carry none (the
      // server owns the run — §7: one sitting, in memory)
      if (msg.runState && !state.coop) {
        localStorage.setItem("campaignRun", JSON.stringify(msg.runState));
      }
      const dots = Array.from({ length: msg.totalSystems }, (_, i) =>
        i < msg.system ? "◆" : "◇"
      ).join(" ");
      const t = msg.runState?.totals ?? {};
      setTimeout(() => {
        // §8.6: the streak lands first, then the fade to the run map
        showBanner(
          `SYSTEM ${msg.system} CLEARED`,
          `${msg.systemName ?? ""} — ${dots} · run totals: hunters ${t.huntersKilled ?? 0} · salvage ${t.salvaged ?? 0} · upgrades ${t.upgrades ?? 0}`
        );
        // the HAUL is the headline (playtest: "the end screen didn't
        // tell me what I got")
        showBannerLines(
          "BROUGHT ABOARD THIS SYSTEM",
          (msg.haul ?? []).length > 0
            ? [...msg.haul, ...(msg.huntersKilledHere > 0 ? [`hunter kills · ${msg.huntersKilledHere}`] : [])]
            : ["nothing — a clean sprint"]
        );
        setCampaignBanner("next", msg.nextSystem);
      }, 1500);
      addTranscript("sys", `system ${msg.system} clear — ${msg.totalSystems - msg.system} to go`);
      break;
    }
    case "created":
      showLobbyStatus(`${msg.coop ? "CO-OP RUN" : "ROOM"} CODE: ${msg.code}`);
      break;
    case "lobby":
      // v5 §2: roster/config while the room fills; creator launches
      showRoomLobby(msg);
      break;
    case "error":
      showLobbyStatus(msg.message);
      addTranscript("sys", msg.message, true);
      break;
    case "rematch_tally":
      showRematchTally(msg.ready, msg.total);
      break;
    case "ui":
      if (msg.what === "show_vector") showVector(5000);
      else if (msg.what === "overlay") setOverlay(msg.element, msg.state === "on");
      break;
    case "transcript":
      addTranscript(msg.who, msg.text, msg.priority === "critical");
      // incoming transmissions queue (above acks, below combat warnings)
      if (msg.speech) audio.enqueueSpeech(msg.speech, msg.priority ?? "news");
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
  if (!you || state.gameOver) {
    // no ship, no alarms — without this, whatever channel was live at the
    // moment of death latches forever (snapshot-diff stops running)
    if (prevAudio) {
      audio.stopContinuous();
      prevAudio = null;
      prevTiers = null;
    }
    return;
  }

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
  audio.setWarning(you.painted ?? "none", you.lockedBy ?? 0);
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
    // a new enemy missile on scope — and if we're locked, that launch is
    // probably AT US: the lock alarm snaps back to full onset (§2.1)
    const prevIds = prevAudio.enemyMissiles;
    for (const m of snap.missiles ?? []) {
      if (!m.own && !prevIds.has(m.id)) {
        audio.sfxLaunch(false);
        if (you.painted === "locked") audio.reassertWarning();
      }
    }
    // decoy deployed (ours)
    if ((you.decoys ?? 0) < prevAudio.decoys) audio.sfxDecoy();
    // rail fired (ours): slug count dropped (v5 §5 — reuse the launch thunk)
    if (you.rail && prevAudio.railSlugs !== null && you.rail.slugs < prevAudio.railSlugs) {
      audio.sfxLaunch(true);
    }
    // any hull drop we take: rock hits crunch, weapons fire booms — and
    // either way the camera feels it (v4.7 §4.5)
    if (you.hull < prevAudio.hull) {
      if (prevAudio.collisionWarning !== null) audio.sfxCrunch();
      else audio.sfxBoom(false, true);
      kickShake(prevAudio.hull - you.hull >= 20);
    }
  }
  // collision klaxon while an impact is projected inside 10 s — it gets
  // the countdown so the whoop rate accelerates into impact (§2.3)
  audio.setCollisionKlaxon(
    you.collisionWarning !== null && you.collisionWarning !== undefined && you.collisionWarning <= 10
      ? you.collisionWarning
      : null
  );
  prevAudio = {
    tubes: (you.tubes ?? []).map((t) => ({ state: t.state })),
    railSlugs: you.rail ? you.rail.slugs : null,
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
        // spectators are omniscient — names ride along (v5.1 §5.1)
        label: `${(s.callsign ?? s.id).toUpperCase()}${snap.names?.[s.id] ? ` (${snap.names[s.id]})` : ""} HULL`,
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
    { label: "SHIP", value: `${you.callsign ?? state.role ?? "—"}${you.archetype ? ` · ${you.archetype}` : ""}`, cls: "good" },
    { label: "HULL", value: `${you.hull}`, cls: you.hull <= 35 ? "alert" : you.hull <= 65 ? "warn" : "" },
    { label: "EN HULL", value: enemyHull, cls: idContact && idContact.hull <= (idContact.hullMax ?? 100) / 2 ? "good" : "" },
    { label: "CONTACTS", value: contactsLine, cls: contacts.some((c) => c.tier >= 2) ? "good" : contacts.length ? "warn" : "", full: true },
    // Patch 2 §3: the teammate strip — SIG is the critical field (it says
    // who the Hunter is coming for; ▲ marks whoever is louder right now).
    // Campaign co-op only; placement is temporary (§3b — Patch 3 is the
    // panel redesign). Never their contacts: the strip is transponder data.
    ...(you.mission
      ? (snap.allies ?? []).map((t) => {
          const km = Math.hypot(t.x - you.x, t.y - you.y) / 1000;
          const brg = Math.round((Math.atan2(t.x - you.x, t.y - you.y) * 180) / Math.PI + 360) % 360;
          const louder = (t.sig ?? 0) > (you.signature ?? 0);
          return {
            label: (t.callsign ?? t.id).toUpperCase(),
            value: `hull ${Math.round((t.hull / (t.hullMax || 100)) * 100)}% · SIG ${t.sig ?? "—"}${louder ? "▲" : ""} · prop ${t.propellant ?? "—"} · ${km.toFixed(0)} km brg ${String(brg).padStart(3, "0")}`,
            cls: t.hull <= (t.hullMax || 100) * 0.35 ? "alert" : louder ? "warn" : "good",
            full: true,
          };
        })
      : []),
    // campaign: the mission clock + the gate approach solution + the
    // transfer. Server-owned numbers, PING-LIT-style rendering — no
    // client timers.
    ...(you.mission
      ? [
          {
            label: "SYS",
            value: `${you.mission.system}/8 · ${you.mission.systemName ?? ""}`,
          },
          {
            label: "HUNTER",
            value: you.mission.hunterActive
              ? "◤ IN SYSTEM ◥"
              : you.mission.spawnInS > 0
                ? `${Math.floor(you.mission.spawnInS / 60)}:${String(you.mission.spawnInS % 60).padStart(2, "0")}`
                : "gone quiet",
            cls: you.mission.hunterActive ? "alert" : you.mission.spawnInS > 0 ? "warn" : "good",
          },
          ...(() => {
            // SALVAGE row: transfer progress while docked; an in-range
            // hint when a lootable wreck's dock ring is around us
            // (playtest: the actable moment must be visible)
            const s = you.mission.salvaging;
            if (s) {
              return [{ label: "SALVAGE", value: `next in ${s.nextInS}s · ${s.itemsLeft} left`, cls: "good" }];
            }
            const rangeM = state.config?.salvageApproachRangeM ?? 15000;
            const near = (snap.wrecks ?? [])
              .filter((w) => w.items !== 0 && Math.hypot(w.x - you.x, w.y - you.y) <= rangeM)
              .sort((a, b) => Math.hypot(a.x - you.x, a.y - you.y) - Math.hypot(b.x - you.x, b.y - you.y))[0];
            return near
              ? [{ label: "SALVAGE", value: `in range — "salvage ${near.letter}"`, cls: "good" }]
              : [];
          })(),
          {
            label: "GATE",
            value: you.gate
              ? you.gate.good
                ? `SOLUTION GOOD · ${Math.floor(you.gate.ttg / 60)}:${String(you.gate.ttg % 60).padStart(2, "0")}`
                : `ttg ${Math.floor(you.gate.ttg / 60)}:${String(you.gate.ttg % 60).padStart(2, "0")} · miss ${(you.gate.missM / 1000).toFixed(1)} km ${you.gate.side.toUpperCase()}`
              : "no solution",
            cls: you.gate ? (you.gate.good ? "good" : "alert") : "",
            full: true,
          },
          // Anvil §4c / 1.1 §3b: the vise, on an instrument — two DISTINCT
          // states so "counting down to closing" and "closing now" never
          // blur: STABLE is calm and says when the narrowing starts;
          // CLOSING is the alarm with the live aperture. The GATE row
          // above shows the solution going bad as it shrinks.
          ...(you.mission.gateClosing
            ? [
                (() => {
                  const gc = you.mission.gateClosing;
                  const mmss = `${Math.floor(gc.leftS / 60)}:${String(gc.leftS % 60).padStart(2, "0")}`;
                  return gc.phase === "stable"
                    ? {
                        label: "GATE STABLE",
                        value: `closing in ${mmss}`,
                        cls: "warn",
                        full: true,
                      }
                    : {
                        label: "GATE CLOSING",
                        value: `${mmss} · aperture ${gc.aperturePct}%`,
                        cls: "alert",
                        full: true,
                      };
                })(),
              ]
            : []),
        ]
      : []),
    { label: "SIG", value: `${Math.round(you.signature ?? 0)}`, cls: (you.signature ?? 0) > 100 ? "alert" : (you.signature ?? 0) > 50 ? "warn" : "good" },
    { label: "THRUST", value: `${Math.round(you.thrust)}%${tanksDry && you.thrust > 0 ? " (DRY)" : ""}`, cls: tanksDry && you.thrust > 0 ? "alert" : "" },
    { label: "SPD", value: `${you.speed} m/s` },
    { label: "HDG", value: `${String(Math.round(you.facing) % 360).padStart(3, "0")}` },
    // ⟳ = propellant regen harvesting, ✕ = regen gated off (outside zone or
    // throttle > 20%) — the at-a-glance answer to "why isn't fuel coming back"
    { label: `PROP${prop >= 100 ? "" : you.regen ? " ⟳" : " ✕"}`, value: prop, bar: true, cls: prop <= 10 ? "alert" : prop <= 25 ? "warn" : "" },
    { label: "TUBES", value: tubes || "—" },
    { label: "MSL", value: `${you.missiles}` },
    { label: "DECOY", value: `${you.decoys}` },
    {
      label: "PDC",
      value: `${(you.pdc?.posture ?? "free").toUpperCase()} ${you.pdc?.ammoS ?? 0}s`,
      cls: (you.pdc?.ammoS ?? 0) <= 6 ? "alert" : (you.pdc?.ammoS ?? 0) <= 15 ? "warn" : you.pdc?.posture === "free" ? "good" : "",
    },
    {
      label: "RAIL",
      // armed classes only (corvettes show a dash)
      value: you.rail
        ? you.rail.slugs <= 0
          ? "OUT"
          : you.rail.cooldownS > 0
            ? `${you.rail.cooldownS}s · ${you.rail.slugs}`
            : `RDY · ${you.rail.slugs}`
        : "—",
      cls: you.rail ? (you.rail.slugs <= 0 ? "alert" : you.rail.cooldownS > 0 ? "warn" : "good") : "",
    },
    {
      label: "PROBES",
      value: `${you.probes ?? 0}${(snap.probes ?? []).some((p) => p.own) ? ` · ${(snap.probes ?? []).filter((p) => p.own).length} out` : ""}`,
      cls: (snap.probes ?? []).some((p) => p.own) ? "good" : "",
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
