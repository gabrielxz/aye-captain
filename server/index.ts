import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  REGION_RADIUS_M,
  ACCEL_FULL_THRUST_MPS2,
  TURN_RATE_DEG_PER_SEC,
  STT_MAX_AUDIO_BYTES,
  ARCHETYPES,
  SALVAGE_DOCK_RANGE_M,
  RUMOR_RESOLVE_RANGE_M,
  SALVAGE_APPROACH_RANGE_M,
  GATE_PYLON_RADIUS_M,
} from "./constants.js";
import { Match, sanitizeName } from "./match.js";
import { sttAvailable, transcribe, SttBusyError } from "./stt.js";
import { getSpeech, pregenStockLines, ttsAvailable } from "./tts.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = "0.0.0.0";

const clientDir = path.join(import.meta.dirname, "..", "client");

const app = express();
app.use(express.static(clientDir));

// clean URL for the captain's handbook (deep-linkable anchors inside)
app.get("/how-to-play", (_req, res) => {
  res.sendFile(path.join(clientDir, "how-to-play.html"));
});

// Push-to-talk audio comes here as a raw body; reply is {text}.
app.post(
  "/stt",
  express.raw({ type: () => true, limit: STT_MAX_AUDIO_BYTES }),
  async (req, res) => {
    if (!sttAvailable()) {
      res.status(503).json({ error: "no STT key configured" });
      return;
    }
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length < 100) {
      res.status(400).json({ error: "empty audio" });
      return;
    }
    try {
      const text = await transcribe(audio, req.headers["content-type"] ?? "audio/webm");
      res.json({ text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("stt error:", msg);
      // saturation (every provider budget spent / rate-limited) is the
      // captain's cue to re-key the mic, not a server fault
      if (err instanceof SttBusyError || msg.includes("STT 429")) {
        res.status(503).json({ error: "voice channel busy — try again in a few seconds" });
      } else {
        res.status(502).json({ error: "transcription failed" });
      }
    }
  }
);

// Ship-AI voice lines, cached server-side; ids are handed out in transcript
// messages. 404 = line unavailable (no key / synth failed) — client stays text-only.
app.get("/speech/:id", async (req, res) => {
  const buf = await getSpeech(req.params.id);
  if (!buf) {
    res.status(404).end();
    return;
  }
  res.type("audio/mpeg").setHeader("Cache-Control", "public, max-age=31536000, immutable").send(buf);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const matchByWs = new Map<WebSocket, Match>();
const rooms = new Map<string, Match>();

function genRoomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O (read ambiguity)
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

wss.on("connection", (ws: WebSocket) => {
  ws.send(
    JSON.stringify({
      type: "hello",
      config: {
        zoneRadius: REGION_RADIUS_M,
        accel: ACCEL_FULL_THRUST_MPS2, // for the client-side stop-point projection
        turnRate: TURN_RATE_DEG_PER_SEC,
        stt: sttAvailable(),
        // campaign client affordances: dock/resolve rings + in-range hints
        salvageDockRangeM: SALVAGE_DOCK_RANGE_M,
        rumorResolveRangeM: RUMOR_RESOLVE_RANGE_M,
        salvageApproachRangeM: SALVAGE_APPROACH_RANGE_M,
        gatePylonRadiusM: GATE_PYLON_RADIUS_M, // Anvil §4: client re-derives the creeping pylons
        // v5.1 §6: the select screen renders stat bars straight from the
        // runtime source of truth — the client never hardcodes a number
        archetypes: ARCHETYPES,
      },
    })
  );

  ws.on("message", (data) => {
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "practice": {
        if (matchByWs.has(ws)) return;
        // v5.1 §7.1: pick your ship AND your sparring partner
        matchByWs.set(
          ws,
          Match.createPractice(ws, String(msg.archetype ?? ""), String(msg.droneArchetype ?? ""))
        );
        break;
      }
      case "campaign": {
        // Deep Black: solo run, practice-shaped lifecycle. `runState`
        // resumes a saved run from the client's localStorage (single-
        // player deliberately suspends server authority — see match.ts).
        if (matchByWs.has(ws)) return;
        matchByWs.set(ws, Match.createCampaign(ws, String(msg.archetype ?? ""), msg.runState));
        break;
      }
      case "campaign_next": {
        // through the gate, onto the next system (same match, same socket)
        matchByWs.get(ws)?.nextSystem(ws, msg.runState);
        break;
      }
      case "create": {
        if (matchByWs.has(ws)) return;
        const code = genRoomCode();
        const match = Match.createRoom(code, ws, sanitizeName(msg.name));
        rooms.set(code, match);
        matchByWs.set(ws, match);
        break;
      }
      case "join": {
        if (matchByWs.has(ws)) return;
        const code = String(msg.code ?? "").toUpperCase();
        const match = rooms.get(code);
        if (!match) {
          ws.send(JSON.stringify({ type: "error", message: `no room '${code}'` }));
          return;
        }
        const err = match.joinOrReconnect(ws, sanitizeName(msg.name));
        if (err) {
          ws.send(JSON.stringify({ type: "error", message: err }));
          return;
        }
        matchByWs.set(ws, match);
        break;
      }
      case "spectate": {
        if (matchByWs.has(ws)) return;
        const code = String(msg.code ?? "").toUpperCase();
        const match = rooms.get(code);
        if (!match) {
          ws.send(JSON.stringify({ type: "error", message: `no room '${code}'` }));
          return;
        }
        match.addSpectator(ws);
        matchByWs.set(ws, match);
        break;
      }
      case "config": {
        // v5 §2: room creator toggles FFA | Teams pre-launch
        const match = matchByWs.get(ws);
        if (match && (msg.mode === "ffa" || msg.mode === "teams")) {
          match.setMode(ws, msg.mode);
        }
        break;
      }
      case "team": {
        const match = matchByWs.get(ws);
        if (match && (msg.team === "red" || msg.team === "blue")) {
          match.setTeam(ws, msg.team);
        }
        break;
      }
      case "archetype": {
        // v5 §4: lobby pick (corvette | frigate | cruiser)
        const match = matchByWs.get(ws);
        if (match && typeof msg.archetype === "string") {
          match.setArchetype(ws, msg.archetype as never);
        }
        break;
      }
      case "launch": {
        const match = matchByWs.get(ws);
        if (!match) break;
        const err = match.launch(ws);
        if (err) ws.send(JSON.stringify({ type: "error", message: err }));
        break;
      }
      case "utterance": {
        const match = matchByWs.get(ws);
        if (match && typeof msg.text === "string") {
          match.handleUtterance(ws, msg.text, msg.source === "voice" ? "voice" : "typed");
        }
        break;
      }
      case "rematch": {
        const match = matchByWs.get(ws);
        if (!match || !match.sim.winner) break;
        // seated captains only (dead ones kept their seats); pure
        // spectators never call rematch. v5.1 §7.3: a click is a VOTE
        // (ready-up + field preference) — the room relaunches when every
        // still-connected captain is ready; leavers don't block.
        if (!match.hasSeat(ws)) break;
        match.voteRematch(ws, msg.newField === true);
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", () => {
    const match = matchByWs.get(ws);
    if (match) {
      match.detach(ws);
      matchByWs.delete(ws);
      if (match.isEmpty()) {
        match.destroy();
        if (match.code) rooms.delete(match.code);
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`aye-captain listening on http://${HOST}:${PORT}`);
  if (ttsAvailable()) void pregenStockLines();
  else console.log("tts offline: ELEVENLABS_API_KEY not set — ship AI is text-only");
});
