import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { ZONE_RADIUS_M, HARD_LIMIT_RADIUS_M, STT_MAX_AUDIO_BYTES } from "./constants.js";
import { Match } from "./match.js";
import { sttAvailable, transcribe } from "./stt.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = "0.0.0.0";

const clientDir = path.join(import.meta.dirname, "..", "client");

const app = express();
app.use(express.static(clientDir));

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
      console.error("stt error:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "transcription failed" });
    }
  }
);

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
        zoneRadius: ZONE_RADIUS_M,
        hardLimitRadius: HARD_LIMIT_RADIUS_M,
        stt: sttAvailable(),
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
        matchByWs.set(ws, Match.createPractice(ws));
        break;
      }
      case "create": {
        if (matchByWs.has(ws)) return;
        const code = genRoomCode();
        const match = Match.createRoom(code, ws);
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
        const err = match.joinOrReconnect(ws);
        if (err) {
          ws.send(JSON.stringify({ type: "error", message: err }));
          return;
        }
        matchByWs.set(ws, match);
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
        if (!match.canRematch()) {
          ws.send(JSON.stringify({ type: "error", message: "opponent is gone — no rematch" }));
          break;
        }
        match.reset();
        break;
      }
      // stage 8: create / join
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
});
