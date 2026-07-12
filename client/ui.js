// command box, transcript pane, HUD panels, lobby
import { send, state } from "./main.js";
import { createVoice } from "./voice.js";
import { buildShipSelect } from "./ship-select.js";
import {
  initAudio,
  setMixVolume,
  getMixVolume,
  setVerbosity,
  getVerbosity,
  sfxClick,
  duck,
  bargeIn,
} from "./audio.js";

const lobbyEl = document.getElementById("lobby");
const gameEl = document.getElementById("game");
const hudEl = document.getElementById("hud");
const transcriptEl = document.getElementById("transcript");
const cmdEl = document.getElementById("cmd");
const micEl = document.getElementById("mic");
const bannerEl = document.getElementById("banner");

const history = [];
let historyIdx = -1;
let voice = null;

function submitUtterance(text, source = "typed") {
  send({ type: "utterance", text, source });
  addTranscript("capt", text);
  sfxClick();
  history.push(text);
  historyIdx = history.length;
}

// v5.1 §5: display-only player name, remembered locally. Rides create/join.
function playerName() {
  const el = document.getElementById("player-name");
  const v = el.value.trim();
  localStorage.setItem("playerName", v);
  return v || undefined;
}

export function initUI() {
  const nameEl = document.getElementById("player-name");
  nameEl.value = localStorage.getItem("playerName") ?? "";
  nameEl.addEventListener("input", () => localStorage.setItem("playerName", nameEl.value.trim()));
  document.getElementById("btn-create").addEventListener("click", () => {
    send({ type: "create", name: playerName() });
  });
  document.getElementById("btn-join").addEventListener("click", () => joinMatch(false));
  document.getElementById("btn-watch").addEventListener("click", () => joinMatch(true));
  document.getElementById("join-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinMatch(false);
  });
  // v5.1 §7.1: PRACTICE opens the select screen — your hull and the
  // drone's — instead of launching blind
  const practicePick = {
    ship: localStorage.getItem("practiceArch") ?? "frigate",
    drone: localStorage.getItem("practiceDrone") ?? "frigate", // the generalist
  };
  const practicePanel = document.getElementById("practice-panel");
  const buildPracticeCards = () => {
    buildShipSelect(document.getElementById("practice-arch-row"), {
      archetypes: state.config?.archetypes,
      selected: practicePick.ship,
      onPick: (arch) => {
        practicePick.ship = arch;
        localStorage.setItem("practiceArch", arch);
        buildPracticeCards();
      },
    });
    buildShipSelect(document.getElementById("practice-drone-row"), {
      archetypes: state.config?.archetypes,
      selected: practicePick.drone,
      onPick: (arch) => {
        practicePick.drone = arch;
        localStorage.setItem("practiceDrone", arch);
        buildPracticeCards();
      },
    });
  };
  document.getElementById("btn-practice").addEventListener("click", () => {
    buildPracticeCards();
    practicePanel.style.display = "flex";
  });
  document.getElementById("btn-practice-back").addEventListener("click", () => {
    practicePanel.style.display = "none";
  });
  document.getElementById("btn-practice-start").addEventListener("click", () => {
    practicePanel.style.display = "none";
    send({ type: "practice", archetype: practicePick.ship, droneArchetype: practicePick.drone });
  });

  // campaign "Deep Black": same select-screen flow as practice, one hull
  // row (the Hunter's is the mission's business). A saved run (the
  // localStorage save file — single-player suspends server authority)
  // offers CONTINUE; NEW RUN wipes it.
  const campaignPick = { ship: localStorage.getItem("campaignArch") ?? "frigate" };
  const campaignPanel = document.getElementById("campaign-panel");
  const savedRun = () => {
    try {
      const r = JSON.parse(localStorage.getItem("campaignRun") ?? "null");
      return r && typeof r.system === "number" ? r : null;
    } catch {
      return null;
    }
  };
  const buildCampaignCards = () => {
    buildShipSelect(document.getElementById("campaign-arch-row"), {
      archetypes: state.config?.archetypes,
      selected: campaignPick.ship,
      onPick: (arch) => {
        campaignPick.ship = arch;
        localStorage.setItem("campaignArch", arch);
        buildCampaignCards();
      },
    });
    const run = savedRun();
    const cont = document.getElementById("btn-campaign-continue");
    cont.style.display = run ? "" : "none";
    if (run) cont.textContent = `CONTINUE RUN — SYSTEM ${run.system}`;
    const best = Number(localStorage.getItem("campaignBest") ?? 0);
    document.getElementById("campaign-best").textContent =
      best > 0 ? `best run: ${best} system${best === 1 ? "" : "s"} cleared` : "";
  };
  document.getElementById("btn-campaign").addEventListener("click", () => {
    buildCampaignCards();
    campaignPanel.style.display = "flex";
  });
  document.getElementById("btn-campaign-back").addEventListener("click", () => {
    campaignPanel.style.display = "none";
  });
  document.getElementById("btn-campaign-start").addEventListener("click", () => {
    campaignPanel.style.display = "none";
    localStorage.removeItem("campaignRun"); // a new run buries the old save
    send({ type: "campaign", archetype: campaignPick.ship });
  });
  document.getElementById("btn-campaign-continue").addEventListener("click", () => {
    const run = savedRun();
    if (!run) return;
    campaignPanel.style.display = "none";
    send({ type: "campaign", archetype: campaignPick.ship, runState: run });
  });
  // run map: NEXT SYSTEM hands the save back to the same match
  document.getElementById("btn-next-system").addEventListener("click", () => {
    const run = savedRun();
    if (!run) return;
    hideBanner();
    send({ type: "campaign_next", runState: run });
  });

  // v5.1 §7.2: a way OUT that isn't closing the tab. Reloading drops the
  // socket; the server's close handler detaches us and tears down empty
  // rooms — the one already-tested leave path.
  const toMainMenu = () => location.reload();
  // gameover MAIN MENU: the match is over, nothing to lose — one click
  document.getElementById("btn-mainmenu").addEventListener("click", toMainMenu);
  // in-match EXIT (practice/spectator): confirm first — one stray click
  // must not dump a session (v5.1.1 playtest)
  const confirmLeave = document.getElementById("confirm-leave");
  document.getElementById("btn-menu").addEventListener("click", () => {
    confirmLeave.classList.add("active");
  });
  document.getElementById("btn-leave-yes").addEventListener("click", toMainMenu);
  document.getElementById("btn-leave-no").addEventListener("click", () => {
    confirmLeave.classList.remove("active");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirmLeave.classList.contains("active")) {
      confirmLeave.classList.remove("active");
      e.stopPropagation();
    }
  }, true);
  document.getElementById("btn-howto").addEventListener("click", () => {
    location.href = "/how-to-play";
  });
  document.getElementById("btn-rematch").addEventListener("click", () => {
    send({ type: "rematch" });
  });
  document.getElementById("btn-rematch-new").addEventListener("click", () => {
    send({ type: "rematch", newField: true });
  });

  // v5 §2 room lobby controls
  document.getElementById("btn-mode-ffa").addEventListener("click", () => send({ type: "config", mode: "ffa" }));
  document.getElementById("btn-mode-teams").addEventListener("click", () => send({ type: "config", mode: "teams" }));
  document.getElementById("btn-team-red").addEventListener("click", () => send({ type: "team", team: "red" }));
  document.getElementById("btn-team-blue").addEventListener("click", () => send({ type: "team", team: "blue" }));
  document.getElementById("btn-launch").addEventListener("click", () => send({ type: "launch" }));
  // v5.1 §6: archetype cards render on demand in showRoomLobby (they need
  // the hello config's stat blocks, which may not have arrived yet here)

  cmdEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = cmdEl.value.trim();
      if (!text) return;
      submitUtterance(text);
      cmdEl.value = "";
    } else if (e.key === "Escape") {
      cmdEl.blur(); // hand the keys back to the map
    } else if (e.key === "ArrowUp") {
      if (historyIdx > 0) {
        historyIdx--;
        cmdEl.value = history[historyIdx];
        e.preventDefault();
      }
    } else if (e.key === "ArrowDown") {
      if (historyIdx < history.length - 1) {
        historyIdx++;
        cmdEl.value = history[historyIdx];
      } else {
        historyIdx = history.length;
        cmdEl.value = "";
      }
      e.preventDefault();
    }
  });

  // Focus management: the map owns keys by default (WASD pan, F/M/V
  // toggles live in render.js); Enter or backtick hands them to the command
  // box, Esc hands them back (handled on cmdEl above). Push-to-talk (Space)
  // is global either way — see initVoice.
  document.addEventListener("keydown", (e) => {
    if (!gameEl.classList.contains("active")) return;
    if (state.role === "spectator") return; // no command box to focus
    if (document.activeElement === cmdEl) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter" || e.key === "`") {
      e.preventDefault(); // don't type the backtick / submit on arrival
      cmdEl.focus();
    }
  });

  initVoice();

  // Web Audio needs a user gesture before it may play; arm on the first one.
  document.addEventListener("pointerdown", initAudio);
  document.addEventListener("keydown", initAudio);
  // v5.1 §4.2: SFX and VOICE ride separate sliders
  for (const [id, kind] of [["vol-sfx", "sfx"], ["vol-voice", "voice"], ["vol-music", "music"]]) {
    const el = document.getElementById(id);
    el.value = String(getMixVolume(kind));
    el.addEventListener("input", () => setMixVolume(kind, Number(el.value)));
  }
  // v5.1 §4.3: XO verbosity — the in-match topbar cycle button (the
  // lobby duplicate confused playtesters; mid-match is where it matters:
  // six people at one table need to shut their XOs up live)
  const VERBOSITY_CYCLE = ["full", "terse", "silent"];
  const verbosityBtn = document.getElementById("verbosity");
  const paintVerbosity = () => {
    verbosityBtn.textContent = `XO: ${getVerbosity().toUpperCase()}`;
  };
  verbosityBtn.addEventListener("click", () => {
    const next =
      VERBOSITY_CYCLE[(VERBOSITY_CYCLE.indexOf(getVerbosity()) + 1) % VERBOSITY_CYCLE.length];
    setVerbosity(next);
    paintVerbosity();
  });
  paintVerbosity();
}

// Push-to-talk: hold Space while the command box is empty. With text in the
// box, Space types a normal space. Uses server-side STT when the server
// reports a key (hello config), else the browser's Web Speech API.
function initVoice() {
  voice = createVoice({
    useServerStt: () => !!(state.config && state.config.stt),
    onInterim: (text) => {
      cmdEl.value = text;
    },
    onStateChange: (mode) => {
      micEl.classList.toggle("listening", mode === "listening");
      micEl.classList.toggle("transcribing", mode === "transcribing");
      micEl.textContent = mode === "transcribing" ? "···" : "● REC";
      duck(mode === "listening"); // quiet the ship while the captain talks
      // v5.1 §1.4: he doesn't just get quieter — he stops. The playing
      // non-critical line is dropped and chatter flushed; CRITICAL finishes.
      if (mode === "listening") bargeIn();
      if (mode === "idle") cmdEl.value = "";
    },
    onFinal: (text) => {
      submitUtterance(text, "voice");
    },
    onError: (err) => {
      addTranscript("sys", `voice: ${err}`, true);
    },
  });

  document.addEventListener("keydown", (e) => {
    if (!gameEl.classList.contains("active")) return;
    if (state.role === "spectator") return; // spectators don't talk to the XO
    if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (voice.listening) {
      e.preventDefault(); // swallow key-repeat so it doesn't type over interim text
      return;
    }
    if (e.repeat || cmdEl.value !== "") return;
    e.preventDefault();
    voice.start();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") voice.stop();
  });

  // Mobile push-to-talk (visible on coarse pointers only, via CSS): hold
  // the button = hold Space. Pointer capture keeps the release working
  // even when the thumb slides off; cancel/leave stop cleanly too.
  const ptt = document.getElementById("ptt");
  ptt.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // no focus steal, no long-press menu
    ptt.setPointerCapture(e.pointerId);
    ptt.classList.add("listening");
    voice.start();
  });
  const pttStop = () => {
    ptt.classList.remove("listening");
    voice.stop();
  };
  ptt.addEventListener("pointerup", pttStop);
  ptt.addEventListener("pointercancel", pttStop);
  ptt.addEventListener("contextmenu", (e) => e.preventDefault());
}

export function enterGame() {
  lobbyEl.style.display = "none";
  gameEl.classList.add("active");
  window.dispatchEvent(new Event("resize")); // let the canvas size itself
  cmdEl.blur(); // map owns the keys until the captain hits Enter/backtick
}

export function showLobbyStatus(text) {
  document.getElementById("lobby-status").textContent = text;
}

// v5 §2: room lobby panel — roster, mode toggle (creator), team picks
// (teams mode), launch (creator, min 2 captains).
export function showRoomLobby(msg) {
  const panel = document.getElementById("room-panel");
  panel.style.display = "flex";
  document.getElementById("room-code").textContent = `ROOM ${msg.code}`;

  const roster = document.getElementById("room-roster");
  roster.innerHTML = "";
  for (const p of msg.players ?? []) {
    const row = document.createElement("div");
    row.className = "seat";
    const name = document.createElement("span");
    if (p.id === msg.you) name.className = "you";
    name.textContent = `SHIP ${p.id} · ${(p.archetype ?? "frigate").toUpperCase()}${p.name ? ` · ${p.name}` : ""}${p.creator ? " ★" : ""}${p.id === msg.you ? " (you)" : ""}`;
    const tag = document.createElement("span");
    if (msg.mode === "teams" && p.team) {
      tag.className = `team-${p.team}`;
      tag.textContent = p.team.toUpperCase();
    } else {
      tag.textContent = p.connected ? "" : "(lost)";
    }
    row.appendChild(name);
    row.appendChild(tag);
    roster.appendChild(row);
  }

  const modeRow = document.getElementById("mode-row");
  modeRow.style.display = msg.creator ? "flex" : "none";
  document.getElementById("btn-mode-ffa").classList.toggle("active", msg.mode === "ffa");
  document.getElementById("btn-mode-teams").classList.toggle("active", msg.mode === "teams");

  const teamRow = document.getElementById("team-row");
  teamRow.style.display = msg.mode === "teams" ? "flex" : "none";
  const me = (msg.players ?? []).find((p) => p.id === msg.you);
  document.getElementById("btn-team-red").classList.toggle("active", me?.team === "red");
  document.getElementById("btn-team-blue").classList.toggle("active", me?.team === "blue");

  const mine = (msg.players ?? []).find((p) => p.id === msg.you);
  // §6: full stat-card select. Rebuilt per lobby broadcast — cheap, and it
  // keeps the active ring in sync with the server's view of our pick.
  buildShipSelect(document.getElementById("arch-row"), {
    archetypes: state.config?.archetypes,
    selected: mine?.archetype ?? "frigate",
    onPick: (archetype) => send({ type: "archetype", archetype }),
  });

  const launch = document.getElementById("btn-launch");
  launch.style.display = msg.creator ? "block" : "none";
  launch.disabled = (msg.players ?? []).length < 2;

  document.getElementById("room-hint").textContent = msg.creator
    ? (msg.players ?? []).length < 2
      ? `share the code — captains join with it (up to ${msg.maxPlayers})`
      : `${msg.mode === "teams" ? "teams set? " : ""}launch when ready`
    : "waiting for the room creator to launch...";
  showLobbyStatus("");
}

export function hideRoomLobby() {
  document.getElementById("room-panel").style.display = "none";
}

function joinMatch(spectate) {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (code.length !== 4) {
    showLobbyStatus("room code is 4 letters");
    return;
  }
  send({ type: spectate ? "spectate" : "join", code, name: playerName() });
}

// ---------- spectator presence (v4.2) ----------

// Player-side roster, quiet by design: collapses to a count past
// SPECTATOR_NAMES_SHOWN_MAX (3), gone entirely when nobody is watching.
export function updateWatching(names) {
  const el = document.getElementById("watching");
  if (!names || names.length === 0) {
    el.style.display = "none";
    return;
  }
  el.textContent = names.length > 3 ? `WATCHING: ${names.length}` : `WATCHING: ${names.join(", ")}`;
  el.style.display = "block";
}

// Own-callsign badge on the spectator's screen; also flips the body class
// that hides the command row and rematch buttons.
export function setSpectator(callsign) {
  const badge = document.getElementById("spec-badge");
  if (callsign) {
    badge.textContent = `SPECTATOR — ${callsign}`;
    badge.style.display = "block";
    document.body.classList.add("spectating");
  } else {
    badge.style.display = "none";
    document.body.classList.remove("spectating");
  }
}

// xo-note = a reply-only line: the XO talking, NOT confirming an executed
// command — rendered distinct so conversation can't masquerade as action
const WHO_LABEL = { capt: "CAPT", xo: "XO", "xo-note": "XO (note)", sys: "*", comms: "COMMS" };

export function addTranscript(who, text, alert = false) {
  const div = document.createElement("div");
  div.className = `entry ${who}${alert ? " alert" : ""}`;
  if (who === "sys") {
    div.classList.add("sys");
    div.textContent = `* ${text}`;
  } else {
    const whoSpan = document.createElement("span");
    whoSpan.className = "who";
    whoSpan.textContent = `${WHO_LABEL[who] ?? who}: `;
    div.appendChild(whoSpan);
    div.appendChild(document.createTextNode(text));
  }
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// HUD elements persist across updates (keyed by label) so CSS transitions —
// like the propellant bar's animated fill — survive the 1 Hz refresh.
let hudLayoutKey = "";
const hudSlots = new Map();

export function updateHUD(fields) {
  // fields: array of {label, value, full?, cls?, bar?} rendered as a grid;
  // bar:true renders an animated 0-100 fill bar plus the number
  const layoutKey = fields.map((f) => `${f.label}${f.bar ? "#" : ""}${f.full ? "!" : ""}`).join("|");
  if (layoutKey !== hudLayoutKey) {
    hudLayoutKey = layoutKey;
    hudEl.innerHTML = "";
    hudSlots.clear();
    for (const f of fields) {
      const div = document.createElement("div");
      if (f.full) div.className = "full";
      div.appendChild(document.createTextNode(`${f.label} `));
      if (f.bar) {
        const bar = document.createElement("span");
        bar.className = "bar";
        const fill = document.createElement("i");
        bar.appendChild(fill);
        const num = document.createElement("span");
        num.className = "v";
        div.appendChild(bar);
        div.appendChild(document.createTextNode(" "));
        div.appendChild(num);
        hudSlots.set(f.label, { fill, num });
      } else {
        const v = document.createElement("span");
        v.className = "v";
        div.appendChild(v);
        hudSlots.set(f.label, { v });
      }
      hudEl.appendChild(div);
    }
  }
  for (const f of fields) {
    const slot = hudSlots.get(f.label);
    if (!slot) continue;
    if (f.bar) {
      slot.fill.style.width = `${Math.max(0, Math.min(100, Number(f.value)))}%`;
      slot.fill.className = f.cls || "";
      slot.num.textContent = `${Math.round(Number(f.value))}`;
      slot.num.className = f.cls ? `v ${f.cls}` : "v";
    } else {
      slot.v.textContent = f.value;
      slot.v.className = f.cls ? `v ${f.cls}` : "v";
    }
  }
}

export function showBanner(title, detail) {
  document.getElementById("banner-title").textContent = title;
  document.getElementById("banner-detail").textContent = detail ?? "";
  document.getElementById("banner-reveal").innerHTML = ""; // stale reveal never survives
  bannerEl.classList.add("active");
}

// v5.1 §5.4: the post-match reveal — in a fog-of-war game the reveal at
// the end is the payoff. Kill ledger first, then the full roster mapping.
export function showReveal(reveal) {
  const el = document.getElementById("banner-reveal");
  el.innerHTML = "";
  if (!reveal) return;
  const nameOf = (callsign) => {
    const r = (reveal.roster ?? []).find((x) => x.callsign === callsign);
    return r?.name ? `${callsign} (${r.name})` : callsign;
  };
  for (const k of reveal.kills ?? []) {
    const row = document.createElement("div");
    row.className = "kill";
    row.textContent = `${k.killer ? nameOf(k.killer) : "misadventure"} → ${nameOf(k.victim)}`;
    el.appendChild(row);
  }
  const named = (reveal.roster ?? []).filter((r) => r.name);
  if (named.length > 0) {
    const row = document.createElement("div");
    row.textContent = named.map((r) => `${r.callsign} = ${r.name}`).join(" · ");
    el.appendChild(row);
  }
}

// Campaign run map: the haul manifest — plain lines in the reveal slot,
// loot first and large-ish (the counters live in the detail line). Call
// AFTER showBanner (which clears the slot).
export function showBannerLines(heading, lines) {
  const el = document.getElementById("banner-reveal");
  el.textContent = "";
  if (!lines || lines.length === 0) return;
  const h = document.createElement("div");
  h.textContent = heading;
  h.style.cssText = "opacity:0.6; letter-spacing:3px; font-size:11px; margin-bottom:6px";
  el.appendChild(h);
  for (const line of lines) {
    const d = document.createElement("div");
    d.textContent = line;
    d.style.cssText = "font-size:14px; color: var(--accent); margin: 2px 0";
    el.appendChild(d);
  }
}

export function hideBanner() {
  bannerEl.classList.remove("active");
}

// v5.1 §7.3: the rematch ready-up tally ("REMATCH 3/6 — waiting")
export function showRematchTally(ready, total) {
  document.getElementById("rematch-status").textContent =
    ready > 0 ? `REMATCH ${ready}/${total} — waiting for the room` : "";
}

// Campaign banner-button modes. "next" = the run map (ENTER SYSTEM n);
// "over"/"reset" = campaign defaults (one NEW RUN button — a dead run
// restarts, it doesn't rematch); "off" = multiplayer defaults.
export function setCampaignBanner(mode, nextSystem = 0) {
  const same = document.getElementById("btn-rematch");
  const nw = document.getElementById("btn-rematch-new");
  const next = document.getElementById("btn-next-system");
  if (mode === "next") {
    same.style.display = "none";
    nw.style.display = "none";
    next.style.display = "";
    next.textContent = `ENTER SYSTEM ${nextSystem}`;
  } else if (mode === "over" || mode === "reset") {
    same.style.display = "none";
    nw.style.display = "";
    nw.textContent = "NEW RUN";
    next.style.display = "none";
  } else {
    same.style.display = "";
    same.textContent = "REMATCH — SAME FIELD";
    nw.style.display = "";
    nw.textContent = "REMATCH — NEW FIELD";
    next.style.display = "none";
  }
}

// v5.1 §7.2: the in-match MENU control (practice + spectators — captains
// mid-match leave by dying or winning, not by button)
export function setMenuVisible(on) {
  document.getElementById("btn-menu").style.display = on ? "" : "none";
}
