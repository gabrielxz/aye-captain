// command box, transcript pane, HUD panels, lobby
import { send, state } from "./main.js";
import { createVoice } from "./voice.js";

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
  history.push(text);
  historyIdx = history.length;
}

export function initUI() {
  document.getElementById("btn-create").addEventListener("click", () => {
    send({ type: "create" });
  });
  document.getElementById("btn-join").addEventListener("click", joinMatch);
  document.getElementById("join-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinMatch();
  });
  document.getElementById("btn-practice").addEventListener("click", () => {
    send({ type: "practice" });
  });
  document.getElementById("btn-rematch").addEventListener("click", () => {
    send({ type: "rematch" });
  });

  cmdEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = cmdEl.value.trim();
      if (!text) return;
      submitUtterance(text);
      cmdEl.value = "";
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

  // Keep focus in the command box by default.
  document.addEventListener("keydown", (e) => {
    if (
      gameEl.classList.contains("active") &&
      document.activeElement !== cmdEl &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      e.key.length === 1
    ) {
      cmdEl.focus();
    }
  });

  initVoice();
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
  cmdEl.focus();
}

export function showLobbyStatus(text) {
  document.getElementById("lobby-status").textContent = text;
}

function joinMatch() {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (code.length !== 4) {
    showLobbyStatus("room code is 4 letters");
    return;
  }
  send({ type: "join", code });
}

const WHO_LABEL = { capt: "CAPT", xo: "XO", sys: "*" };

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

export function updateHUD(fields) {
  // fields: array of {label, value, full?} rendered as a grid
  hudEl.innerHTML = "";
  for (const f of fields) {
    const div = document.createElement("div");
    if (f.full) div.className = "full";
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = f.value;
    div.appendChild(document.createTextNode(`${f.label} `));
    div.appendChild(v);
    hudEl.appendChild(div);
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
