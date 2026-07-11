// match/room lifecycle, lobby codes
import type { WebSocket } from "ws";
import * as C from "./constants.js";
import { Sim, type Command, type ShipId, type SimEvent } from "./sim.js";
import { llmAvailable, translateUtterance, phraseQueryAnswer } from "./translator.js";
import { logUtterance } from "./datalog.js";
import { ensureSpeech } from "./tts.js";

export class Match {
  sim: Sim;
  readonly code: string | null;
  readonly practice: boolean;
  private sockets = new Map<ShipId, WebSocket | null>();
  private timer: ReturnType<typeof setInterval> | null = null; // physics substeps
  private snapTimer: ReturnType<typeof setInterval> | null = null; // snapshot broadcast
  private forfeitTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false; // both players have been present at least once

  constructor(practice: boolean, code: string | null = null, seed: string = Match.randomSeed()) {
    this.practice = practice;
    this.code = code;
    this.sim = Match.buildSim(practice, seed);
    this.sockets.set("A", null);
    this.sockets.set("B", null);
  }

  static randomSeed(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  // Fresh sim on a terrain seed with the standard spawn: opposite sides of
  // center, facing each other, v = 0.
  private static buildSim(practice: boolean, seed: string): Sim {
    const sim = new Sim(seed);
    sim.addShip("A", 0, -C.SPAWN_DIST_FROM_CENTER_M, 0);
    sim.addShip("B", 0, C.SPAWN_DIST_FROM_CENTER_M, 180, practice); // drone in practice
    return sim;
  }

  static createPractice(ws: WebSocket): Match {
    const match = new Match(true);
    match.attach("A", ws);
    match.sendStart("A");
    match.start();
    if (!llmAvailable()) {
      match.sendTranscript(
        "A",
        "sys",
        "translator offline: ANTHROPIC_API_KEY not set — only raw JSON commands will work",
        true
      );
    }
    return match;
  }

  // Two-player room: creator becomes ship A and waits for a join.
  static createRoom(code: string, ws: WebSocket): Match {
    const match = new Match(false, code);
    match.attach("A", ws);
    ws.send(JSON.stringify({ type: "created", code }));
    return match;
  }

  // Fill the open slot: first join becomes ship B and starts the match;
  // later joins with the same code re-occupy a disconnected seat.
  joinOrReconnect(ws: WebSocket): string | null {
    const openSlot = (["B", "A"] as ShipId[]).find((id) => !this.sockets.get(id));
    if (!openSlot) return "room is full";

    this.attach(openSlot, ws);
    if (!this.started) {
      this.started = true;
      this.sendStart("A");
      this.sendStart("B");
      this.start();
      for (const id of ["A", "B"] as ShipId[]) {
        this.sendTranscript(id, "sys", "Enemy ship is out there somewhere. Good hunting, Captain.");
      }
    } else {
      // reconnect: resume the paused match
      if (this.forfeitTimer) {
        clearTimeout(this.forfeitTimer);
        this.forfeitTimer = null;
      }
      this.sendStart(openSlot);
      this.sendTranscript(openSlot, "sys", "Reconnected. Resuming command.");
      const other: ShipId = openSlot === "A" ? "B" : "A";
      this.sendTranscript(other, "sys", "Opponent reconnected — fight's back on.");
      if (!this.sim.winner) this.start();
    }
    return null;
  }

  private attach(id: ShipId, ws: WebSocket): void {
    this.sockets.set(id, ws);
  }

  private sendStart(id: ShipId): void {
    const ws = this.sockets.get(id);
    if (ws && ws.readyState === ws.OPEN) {
      // terrain travels with start (per-match, static, known to both sides)
      ws.send(
        JSON.stringify({
          type: "start",
          role: id,
          practice: this.practice,
          terrain: this.sim.terrain,
        })
      );
    }
  }

  detach(ws: WebSocket): void {
    let left: ShipId | null = null;
    for (const [id, sock] of this.sockets) {
      if (sock === ws) {
        this.sockets.set(id, null);
        left = id;
      }
    }
    if (!left) return;

    if (this.practice || !this.started || this.sim.winner) {
      // practice, pre-start room, or finished match: nothing to pause
      if (this.isEmpty()) this.stop();
      return;
    }

    // live 2-player match: pause and give them DISCONNECT_GRACE_S to return
    this.stop();
    const remaining: ShipId = left === "A" ? "B" : "A";
    this.sendTranscript(
      remaining,
      "sys",
      `Opponent lost comms — holding position. They have ${C.DISCONNECT_GRACE_S}s to reconnect.`,
      true
    );
    this.forfeitTimer = setTimeout(() => {
      this.forfeitTimer = null;
      if (this.sim.winner) return;
      this.sim.winner = remaining;
      const ws2 = this.sockets.get(remaining);
      if (ws2 && ws2.readyState === ws2.OPEN) {
        ws2.send(
          JSON.stringify({
            type: "gameover",
            youWin: true,
            winner: remaining,
            durationS: this.sim.tickCount / C.TICK_RATE_HZ,
            forfeit: true,
          })
        );
      }
    }, C.DISCONNECT_GRACE_S * 1000);
  }

  isEmpty(): boolean {
    return [...this.sockets.values()].every((s) => s === null);
  }

  destroy(): void {
    this.stop();
    if (this.forfeitTimer) {
      clearTimeout(this.forfeitTimer);
      this.forfeitTimer = null;
    }
  }

  // Physics advances at substep rate; snapshots broadcast at SNAPSHOT_RATE_HZ
  // on their own timer (they sample the latest state — no need to align with
  // substep boundaries). Commands still process at TICK_RATE_HZ inside the sim.
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.physicsStep(),
      1000 / (C.TICK_RATE_HZ * C.PHYSICS_SUBSTEPS)
    );
    this.snapTimer = setInterval(() => this.broadcast(), 1000 / C.SNAPSHOT_RATE_HZ);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.snapTimer) clearInterval(this.snapTimer);
    this.snapTimer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  private physicsStep(): void {
    const events: SimEvent[] = [];
    this.sim.step(events);
    for (const ev of events) this.routeEvent(ev);
    if (this.sim.winner) {
      this.broadcast(); // final positions + terminal fx go out immediately
      this.stop();
    }
  }

  private broadcast(): void {
    for (const [id, ws] of this.sockets) {
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "snapshot", ...this.sim.snapshotFor(id) }));
      }
    }
    this.sim.clearFx();
  }

  canRematch(): boolean {
    if (!this.sim.winner) return false;
    if (this.practice) return true;
    return [...this.sockets.values()].every((s) => s !== null);
  }

  // Fresh sim in the same room ("Rematch" button): same field by default,
  // or a fresh seed when the players want a new one.
  reset(newField = false): void {
    this.stop();
    const seed = newField ? Match.randomSeed() : this.sim.terrain.seed;
    this.sim = Match.buildSim(this.practice, seed);
    for (const id of this.sockets.keys()) {
      this.sendStart(id);
    }
    this.start();
  }

  private routeEvent(ev: SimEvent): void {
    if (ev.kind === "reject") {
      this.sendTranscript(ev.ship, "xo", ev.reason);
    } else if (ev.kind === "ack") {
      this.sendTranscript(ev.ship, "xo", ev.text);
    } else if (ev.kind === "gameover") {
      const durationS = this.sim.tickCount / C.TICK_RATE_HZ;
      for (const [id, ws] of this.sockets) {
        if (ws && ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: "gameover",
              youWin: id === ev.winner,
              winner: ev.winner,
              durationS,
            })
          );
        }
      }
    } else if (ev.kind === "ui") {
      const ws = this.sockets.get(ev.ship);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "ui", what: ev.what }));
      }
    } else if (ev.kind === "notice") {
      const targets: ShipId[] = ev.ship === "all" ? ["A", "B"] : [ev.ship];
      for (const id of targets) {
        this.sendTranscript(id, "sys", ev.text, ev.alert);
      }
    }
  }

  sendTranscript(id: ShipId, who: string, text: string, alert = false): void {
    const ws = this.sockets.get(id);
    if (ws && ws.readyState === ws.OPEN) {
      // Ship-AI lines get a voice; skip bookkeeping noise (standing-order
      // trigger logs, dev-harness echoes).
      const speak =
        (who === "xo" || who === "sys") &&
        !text.startsWith("Standing order '") &&
        !text.startsWith("direct");
      const speech = speak ? ensureSpeech(text) : null;
      ws.send(JSON.stringify({ type: "transcript", who, text, alert, ...(speech ? { speech } : {}) }));
    }
  }

  handleUtterance(ws: WebSocket, text: string, source: "voice" | "typed" = "typed"): void {
    const id = this.roleOf(ws);
    if (!id) return;

    logUtterance({ room: this.code ?? "practice", ship: id, source, text });

    // Dev harness: raw JSON commands bypass the translator. A single command
    // object or an array of them, exactly as the schema defines.
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        const commands: Command[] = Array.isArray(parsed) ? parsed : [parsed];
        this.sim.enqueue(id, commands);
        this.sendTranscript(id, "sys", `direct: ${commands.map((c) => c.verb).join(", ")}`);
      } catch {
        this.sendTranscript(id, "sys", "direct command parse error");
      }
      return;
    }

    void this.translate(id, text);
  }

  private async translate(id: ShipId, text: string): Promise<void> {
    const result = await translateUtterance(text, this.sim.stateSummaryFor(id));

    if (result.failed) {
      this.sendTranscript(id, "xo", "Say again, Captain?");
      return;
    }
    for (const reply of result.replies) {
      this.sendTranscript(id, "xo", reply);
    }

    // Queries execute immediately against sensor-visible state (read-only);
    // everything else is queued for the next tick.
    const executable = result.commands.filter((c) => c.verb !== "query");
    const queries = result.commands.filter((c) => c.verb === "query");
    if (executable.length > 0) this.sim.enqueue(id, executable);
    for (const q of queries) {
      void this.answerQuery(id, text, String(q.params.topic));
    }
  }

  private async answerQuery(id: ShipId, question: string, topic: string): Promise<void> {
    const data = this.sim.queryData(id, topic);
    // damage_report is a fixed template — no LLM call, instant answer
    if (topic === "damage_report") {
      this.sendTranscript(
        id,
        "xo",
        `Hull ${data.hull} of ${data.hull_max}. Propellant ${data.propellant}. ` +
          `${String(data.tube_summary).charAt(0).toUpperCase()}${String(data.tube_summary).slice(1)}. ` +
          `${data.missiles_aboard} missiles aboard, ${data.decoys} decoys, PDC ${data.pdc_posture} with ${data.pdc_ammo_s}s of fire.`
      );
      return;
    }
    const line = await phraseQueryAnswer(question, topic, data);
    // Fallback: template the raw data if the phrasing call fails.
    this.sendTranscript(id, "xo", line ?? `${topic}: ${JSON.stringify(data)}`);
  }

  roleOf(ws: WebSocket): ShipId | null {
    for (const [id, sock] of this.sockets) {
      if (sock === ws) return id;
    }
    return null;
  }
}
