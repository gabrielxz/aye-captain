// command box, transcript pane, HUD panels, lobby
import { send, state } from "./main.js";
import { createVoice } from "./voice.js";
import { initAudio, setVolume, getVolume, sfxClick, duck } from "./audio.js";

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

export function initUI() {
  document.getElementById("btn-create").addEventListener("click", () => {
    send({ type: "create" });
  });
  document.getElementById("btn-join").addEventListener("click", () => joinMatch(false));
  document.getElementById("btn-watch").addEventListener("click", () => joinMatch(true));
  document.getElementById("join-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinMatch(false);
  });
  document.getElementById("btn-practice").addEventListener("click", () => {
    send({ type: "practice" });
  });
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
  const vol = document.getElementById("vol");
  vol.value = String(getVolume());
  vol.addEventListener("input", () => setVolume(Number(vol.value)));
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
    name.textContent = `SHIP ${p.id}${p.creator ? " ★" : ""}${p.id === msg.you ? " (you)" : ""}`;
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
  send({ type: spectate ? "spectate" : "join", code });
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
const WHO_LABEL = { capt: "CAPT", xo: "XO", "xo-note": "XO (note)", sys: "*" };

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
  bannerEl.classList.add("active");
}

export function hideBanner() {
  bannerEl.classList.remove("active");
}
