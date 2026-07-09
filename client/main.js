// ws handling + client state store
import { startRenderLoop } from "./render.js";
import { initUI, addTranscript, updateHUD, showLobbyStatus, enterGame, showBanner, hideBanner } from "./ui.js";

export const state = {
  config: null, // {zoneRadius, hardLimitRadius} from server hello
  role: null, // "A" | "B"
  practice: false,
  prevSnap: null, // previous snapshot (for interpolation)
  lastSnap: null, // latest snapshot
  lastSnapAt: 0, // performance.now() when lastSnap arrived
  snapIntervalMs: 1000, // measured gap between snapshots
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
        state.snapIntervalMs = Math.min(2000, Math.max(250, now - state.lastSnapAt));
      }
      state.prevSnap = state.lastSnap;
      state.lastSnap = msg;
      state.lastSnapAt = now;
      for (const fx of msg.fx ?? []) {
        state.fxBuffer.push({ fx, at: now });
      }
      updateHUDFromSnapshot(msg);
      break;
    }
    case "gameover": {
      state.gameOver = true;
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
      break;
    default:
      console.log("unhandled message", msg);
  }
}

function updateHUDFromSnapshot(snap) {
  const you = snap.you;
  if (!you) return;
  const laser = you.laserCooldown > 0 ? `${you.laserCooldown.toFixed(0)}s` : "READY";
  updateHUD([
    { label: "HULL", value: `${you.hull}` },
    { label: "THRUST", value: `${Math.round(you.thrust)}%` },
    { label: "SPD", value: `${you.speed} m/s` },
    { label: "HDG", value: `${String(Math.round(you.facing) % 360).padStart(3, "0")}` },
    { label: "MSL", value: `${you.missiles}` },
    { label: "DECOY", value: `${you.decoys}` },
    { label: "LASER", value: laser },
    { label: "ZONE", value: you.insideZone ? "inside" : "OUTSIDE" },
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
