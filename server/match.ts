// match/room lifecycle, lobby codes
import type { WebSocket } from "ws";
import * as C from "./constants.js";
import {
  Sim,
  headingVec,
  norm360,
  type Command,
  type ShipId,
  type SimEvent,
} from "./sim.js";
import { llmAvailable, translateUtterance, phraseQueryAnswer } from "./translator.js";
import { logUtterance } from "./datalog.js";
import { ensureSpeech } from "./tts.js";

export type RoomMode = "ffa" | "teams";
export type Team = "red" | "blue";

// v5.1 §1.2: three speech tiers replace the old alert boolean. CRITICAL
// interrupts and ignores the inter-line gap; NEWS queues and respects it;
// CHATTER plays only into silence. The client scheduler enforces this —
// the server's job is honest classification.
export type SpeechPriority = "critical" | "news" | "chatter";

// v5.1 §1.3: acks of commands whose effect is instantly visible on the HUD
// carry no voice — the throttle moved, the captain watched it move.
// Rejections of the same verbs DO speak (you can't see a refusal).
const HUD_VISIBLE_ACK_VERBS = new Set(["set_thrust", "set_heading", "set_pdc", "set_overlay"]);

const SEAT_IDS = ["A", "B", "C", "D", "E", "F", "G", "H"];

// One captain's chair (v5 §2: up to MAX_PLAYERS of these per room).
// `dead` marks a captain whose ship is gone — their socket lives on in the
// spectator pipeline until a rematch seats them again.
interface Seat {
  id: ShipId;
  ws: WebSocket | null;
  team: Team | null;
  archetype: C.ArchetypeName; // v5 §4: lobby pick, mirrors allowed
  dead: boolean;
}

export class Match {
  sim: Sim;
  readonly code: string | null;
  readonly practice: boolean;
  private seats: Seat[] = [];
  private mode: RoomMode = "ffa";
  private launched = false;
  // Spectators (v4.2): cosmetic callsigns, no persistence, no seat. They
  // receive omniscient snapshots and never appear in the transcript. Dead
  // captains join this map (keyed by their own socket) keeping their seat.
  private spectators = new Map<WebSocket, string>();
  private timer: ReturnType<typeof setInterval> | null = null; // physics substeps
  private snapTimer: ReturnType<typeof setInterval> | null = null; // snapshot broadcast

  constructor(practice: boolean, code: string | null = null, seed: string = Match.randomSeed()) {
    this.practice = practice;
    this.code = code;
    // pre-launch rooms hold an empty sim on the room's terrain seed; launch
    // replaces it with the spawned field (rematch keeps the seed unless
    // newField)
    this.sim = practice ? Match.buildPracticeSim(seed) : new Sim(seed);
  }

  static randomSeed(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  // Practice: the captain plus the drone, on the classic two-point spawn.
  private static buildPracticeSim(seed: string): Sim {
    const sim = new Sim(seed);
    sim.addShip("A", 0, -C.SPAWN_RING_RADIUS_M, 0, false, null, C.CALLSIGN_POOL[0]);
    sim.addShip("B", 0, C.SPAWN_RING_RADIUS_M, 180, true, null, "Drone"); // practice target
    return sim;
  }

  static createPractice(ws: WebSocket): Match {
    const match = new Match(true);
    match.seats.push({ id: "A", ws, team: null, archetype: "frigate", dead: false });
    match.launched = true;
    match.sendStart(match.seats[0]);
    match.start();
    // v4.3 welcome: client is connected (start just went out) and audio is
    // already unlocked — clicking PRACTICE was the user gesture.
    match.sendTranscript("A", "xo", "Practice range is hot, Captain. Drone's out there somewhere.", {
      priority: "chatter",
    });
    if (!llmAvailable()) {
      match.sendTranscript(
        "A",
        "sys",
        "translator offline: ANTHROPIC_API_KEY not set — only raw JSON commands will work",
        { priority: "critical" }
      );
    }
    return match;
  }

  // Room lobby (v5 §2): the creator takes the first seat and configures the
  // room; captains join until the creator hits LAUNCH.
  static createRoom(code: string, ws: WebSocket): Match {
    const match = new Match(false, code);
    match.seats.push({ id: "A", ws, team: null, archetype: "frigate", dead: false });
    ws.send(JSON.stringify({ type: "created", code }));
    match.broadcastLobby();
    return match;
  }

  private nextSeatId(): ShipId {
    const used = new Set(this.seats.map((s) => s.id));
    return SEAT_IDS.find((id) => !used.has(id)) ?? `P${this.seats.length + 1}`;
  }

  // Pre-launch: take a new seat. Post-launch: reconnect to your ghosted
  // ship (seat-based, no accounts — first vacant living seat wins).
  joinOrReconnect(ws: WebSocket): string | null {
    if (this.launched) {
      const seat = this.seats.find((s) => !s.dead && s.ws === null && this.sim.ships.has(s.id));
      if (!seat) return "match underway — WATCH to spectate";
      seat.ws = ws;
      this.sim.setGhost(seat.id, false);
      this.sendStart(seat);
      this.sendTranscript(seat.id, "sys", "Reconnected. Resuming command.", { priority: "chatter" });
      if (!this.sim.winner && !this.running) this.start();
      if (this.spectators.size > 0) this.broadcastSpectators();
      return null;
    }
    if (this.seats.length >= C.MAX_PLAYERS) return "room is full — WATCH to spectate";
    const seat: Seat = { id: this.nextSeatId(), ws, team: null, archetype: "frigate", dead: false };
    if (this.mode === "teams") seat.team = this.smallerTeam();
    this.seats.push(seat);
    this.broadcastLobby();
    return null;
  }

  private smallerTeam(): Team {
    const red = this.seats.filter((s) => s.team === "red").length;
    const blue = this.seats.filter((s) => s.team === "blue").length;
    return red <= blue ? "red" : "blue";
  }

  // Room creator toggles FFA | Teams before launch.
  setMode(ws: WebSocket, mode: RoomMode): void {
    if (this.launched || this.seats[0]?.ws !== ws) return;
    if (mode !== "ffa" && mode !== "teams") return;
    this.mode = mode;
    if (mode === "teams") {
      for (const seat of this.seats) {
        if (!seat.team) seat.team = this.smallerTeam();
      }
    } else {
      for (const seat of this.seats) seat.team = null;
    }
    this.broadcastLobby();
  }

  // A captain picks their team (Teams mode, pre-launch).
  setTeam(ws: WebSocket, team: Team): void {
    if (this.launched || this.mode !== "teams") return;
    if (team !== "red" && team !== "blue") return;
    const seat = this.seats.find((s) => s.ws === ws);
    if (!seat) return;
    seat.team = team;
    this.broadcastLobby();
  }

  // A captain picks their archetype (pre-launch; mirrors allowed).
  setArchetype(ws: WebSocket, archetype: C.ArchetypeName): void {
    if (this.launched) return;
    if (!(archetype in C.ARCHETYPES)) return;
    const seat = this.seats.find((s) => s.ws === ws);
    if (!seat) return;
    seat.archetype = archetype;
    this.broadcastLobby();
  }

  // The creator starts the match (min 2 captains; Teams needs both sides
  // manned).
  launch(ws: WebSocket): string | null {
    if (this.launched) return null;
    if (this.seats[0]?.ws !== ws) return "only the room creator can launch";
    if (this.seats.length < 2) return "need at least 2 captains to launch";
    if (this.mode === "teams") {
      for (const seat of this.seats) {
        if (!seat.team) seat.team = this.smallerTeam();
      }
      const red = this.seats.some((s) => s.team === "red");
      const blue = this.seats.some((s) => s.team === "blue");
      if (!red || !blue) return "both teams need at least one captain";
    }
    this.beginMatch(this.sim.terrain.seed);
    return null;
  }

  // Build the spawned sim and send everyone in. Shared by launch and
  // rematch.
  private beginMatch(seed: string): void {
    this.stop();
    this.sim = new Sim(seed);
    this.spawnShips();
    this.launched = true;
    for (const seat of this.seats) {
      seat.dead = false;
      if (seat.ws) this.spectators.delete(seat.ws); // dead captains re-seat on rematch
      this.sendStart(seat);
      if (seat.ws === null) this.sim.setGhost(seat.id, true); // absent captain starts as a ghost
    }
    for (const [ws, callsign] of this.spectators) {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "start",
            role: "spectator",
            callsign,
            practice: this.practice,
            terrain: this.sim.terrain,
          })
        );
      }
    }
    if (this.spectators.size > 0) this.broadcastSpectators();
    this.start();
    const welcome =
      this.seats.length > 2
        ? "Enemy ships are out there somewhere. Good hunting, Captain."
        : "Enemy ship is out there somewhere. Good hunting, Captain.";
    for (const seat of this.seats) {
      this.sendTranscript(seat.id, "sys", welcome, { priority: "chatter" });
    }
  }

  // v5 §2 spawns: evenly spaced on the spawn ring, facing center, v=0.
  // Teams take opposite arcs, teammates spaced ~TEAM_SPAWN_SPACING_M along
  // theirs.
  private spawnShips(): void {
    const ring = C.SPAWN_RING_RADIUS_M;
    // v5 §3: permanent callsigns from the themed pool, shuffled per match
    // (suffixes only if a room somehow outgrows the pool)
    const pool = [...C.CALLSIGN_POOL].sort(() => Math.random() - 0.5);
    const callsignFor = (i: number) =>
      i < pool.length ? pool[i] : `${pool[i % pool.length]}-${Math.floor(i / pool.length) + 1}`;
    const place = (seat: Seat, angleDeg: number, i: number) => {
      const [dx, dy] = headingVec(angleDeg);
      this.sim.addShip(
        seat.id,
        dx * ring,
        dy * ring,
        norm360(angleDeg + 180), // face the center
        false,
        this.mode === "teams" ? seat.team : null,
        callsignFor(i),
        seat.archetype
      );
    };
    if (this.mode === "teams") {
      const spacingDeg = (C.TEAM_SPAWN_SPACING_M / ring) * (180 / Math.PI);
      let n = 0;
      for (const team of ["red", "blue"] as Team[]) {
        const members = this.seats.filter((s) => s.team === team);
        const base = team === "red" ? 0 : 180; // opposite arcs
        members.forEach((seat, i) => {
          place(seat, base + (i - (members.length - 1) / 2) * spacingDeg, n++);
        });
      }
    } else {
      this.seats.forEach((seat, i) => {
        place(seat, (360 / this.seats.length) * i, i);
      });
    }
  }

  // First unused name from the pool wins; a freed callsign is reusable
  // immediately. Exhausting the pool restarts it with -2, -3, ... suffixes.
  private nextCallsign(): string {
    const taken = new Set(this.spectators.values());
    for (let round = 1; ; round++) {
      for (const base of C.SPECTATOR_CALLSIGNS) {
        const name = round === 1 ? base : `${base}-${round}`;
        if (!taken.has(name)) return name;
      }
    }
  }

  addSpectator(ws: WebSocket): string {
    const callsign = this.nextCallsign();
    this.spectators.set(ws, callsign);
    ws.send(
      JSON.stringify({
        type: "start",
        role: "spectator",
        callsign,
        practice: this.practice,
        terrain: this.sim.terrain,
      })
    );
    this.broadcastSpectators();
    return callsign;
  }

  isSpectator(ws: WebSocket): boolean {
    return this.spectators.has(ws);
  }

  hasSeat(ws: WebSocket): boolean {
    return this.seats.some((s) => s.ws === ws);
  }

  // Presence roster to everyone in the room. Deliberately silent: no
  // transcript entry, no sound, no XO line — the HUD element is the telling.
  private broadcastSpectators(): void {
    const payload = JSON.stringify({
      type: "spectators",
      names: [...this.spectators.values()],
    });
    for (const seat of this.seats) {
      if (seat.ws && seat.ws.readyState === seat.ws.OPEN && !seat.dead) seat.ws.send(payload);
    }
    for (const ws of this.spectators.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  // Roster + config to everyone still in the lobby (pre-launch only).
  private broadcastLobby(): void {
    if (this.launched || this.practice) return;
    const players = this.seats.map((s, i) => ({
      id: s.id,
      team: s.team,
      archetype: s.archetype,
      connected: s.ws !== null,
      creator: i === 0,
    }));
    for (const [i, seat] of this.seats.entries()) {
      if (seat.ws && seat.ws.readyState === seat.ws.OPEN) {
        seat.ws.send(
          JSON.stringify({
            type: "lobby",
            code: this.code,
            mode: this.mode,
            you: seat.id,
            creator: i === 0,
            maxPlayers: C.MAX_PLAYERS,
            players,
          })
        );
      }
    }
  }

  private sendStart(seat: Seat): void {
    if (seat.ws && seat.ws.readyState === seat.ws.OPEN) {
      // terrain travels with start (per-match, static, known to all)
      seat.ws.send(
        JSON.stringify({
          type: "start",
          role: seat.id,
          team: seat.team,
          practice: this.practice,
          terrain: this.sim.terrain,
        })
      );
    }
  }

  detach(ws: WebSocket): void {
    if (this.spectators.has(ws)) {
      this.spectators.delete(ws);
      // a dead captain leaving also frees their seat's socket
      for (const seat of this.seats) {
        if (seat.ws === ws) seat.ws = null;
      }
      this.broadcastSpectators();
      return; // spectators never pause or forfeit anything
    }
    const seat = this.seats.find((s) => s.ws === ws);
    if (!seat) return;
    seat.ws = null;

    if (!this.launched) {
      // lobby: the seat is simply given up (the creator role passes down)
      this.seats = this.seats.filter((s) => s !== seat);
      this.broadcastLobby();
      return;
    }
    if (this.practice || this.sim.winner) {
      if (this.isEmpty()) this.stop();
      return;
    }

    // v5 §2: the match does NOT pause — the ship becomes a silent ghost
    // (thrust 0, standing orders suspended) and quietly scuttles if the
    // captain doesn't return. Nobody is told: a ghost that stops being a
    // ghost is information nobody earned.
    this.sim.setGhost(seat.id, true);
  }

  isEmpty(): boolean {
    return this.seats.every((s) => s.ws === null);
  }

  destroy(): void {
    this.stop();
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
    for (const seat of this.seats) {
      if (!seat.dead && seat.ws && seat.ws.readyState === seat.ws.OPEN) {
        seat.ws.send(JSON.stringify({ type: "snapshot", ...this.sim.snapshotFor(seat.id) }));
      }
    }
    if (this.spectators.size > 0) {
      const snap = JSON.stringify({ type: "snapshot", ...this.sim.snapshotSpectator() });
      for (const ws of this.spectators.keys()) {
        if (ws.readyState === ws.OPEN) ws.send(snap);
      }
    }
    this.sim.clearFx();
  }

  canRematch(): boolean {
    if (!this.sim.winner) return false;
    if (this.practice) return true;
    // every captain still connected (dead ones live on as spectators)
    return this.seats.every((s) => s.ws !== null);
  }

  // Fresh sim in the same room ("Rematch" button): same field by default,
  // or a fresh seed when the players want a new one. Same seats and picks.
  reset(newField = false): void {
    this.beginMatch(newField ? Match.randomSeed() : this.sim.terrain.seed);
  }

  // DEATH -> SPECTATOR (v5 §2): the XO signs off, then the captain's client
  // flows into the existing spectator pipeline, keeping their seat for the
  // rematch. Their spectator name is their ship's name (§3 upgrades it to
  // the callsign).
  private captainDown(shipId: ShipId, shipCallsign: string): void {
    const seat = this.seats.find((s) => s.id === shipId);
    if (!seat) return;
    this.sendTranscript(seat.id, "sys", "Hull breach — we're done. Abandon ship.", {
      priority: "critical",
    });
    this.sendTranscript(seat.id, "xo", "It's been an honor, Captain.", { priority: "news" });
    seat.dead = true;
    if (seat.ws && seat.ws.readyState === seat.ws.OPEN) {
      const callsign = shipCallsign; // "SPECTATOR — Kestrel" (v5 §3)
      this.spectators.set(seat.ws, callsign);
      seat.ws.send(
        JSON.stringify({
          type: "start",
          role: "spectator",
          callsign,
          practice: this.practice,
          terrain: this.sim.terrain,
        })
      );
      this.broadcastSpectators();
    }
  }

  private routeEvent(ev: SimEvent): void {
    if (ev.kind === "reject") {
      // §1.3: you can't see a refusal — rejections always speak
      this.sendTranscript(ev.ship, "xo", ev.reason, { priority: "news" });
    } else if (ev.kind === "ack") {
      this.sendTranscript(ev.ship, "xo", ev.text, {
        priority: "chatter",
        noSpeech: HUD_VISIBLE_ACK_VERBS.has(ev.verb),
      });
    } else if (ev.kind === "death") {
      this.captainDown(ev.ship, ev.callsign);
    } else if (ev.kind === "transmission") {
      // v5 §7: verbatim delivery, attributed to the sender's callsign.
      // The XO reads it aloud — relayed messages are the game's only
      // unbounded dynamic TTS (MESSAGE_MAX_CHARS is the cost control).
      const targets =
        ev.to === "all"
          ? this.seats.filter((s) => !s.dead && s.id !== ev.from).map((s) => s.id)
          : [ev.to];
      for (const id of targets) {
        this.sendTranscript(id, "comms", `${ev.fromName}: “${ev.text}”`, {
          priority: "news", // v5 §7 spec: above acks, below combat warnings
          speak: `Transmission from ${ev.fromName}: ${ev.text}`,
        });
      }
    } else if (ev.kind === "scuttle") {
      // quiet by design: free the seat, tell no one
      const seat = this.seats.find((s) => s.id === ev.ship);
      if (seat) seat.dead = true;
    } else if (ev.kind === "gameover") {
      const durationS = this.sim.tickCount / C.TICK_RATE_HZ;
      for (const seat of this.seats) {
        if (seat.ws && seat.ws.readyState === seat.ws.OPEN) {
          const youWin =
            this.mode === "teams" ? seat.team === ev.winner : seat.id === ev.winner;
          seat.ws.send(
            JSON.stringify({
              type: "gameover",
              youWin,
              winner: ev.winner,
              winnerName: ev.winnerName,
              placements: ev.placementNames,
              durationS,
            })
          );
        }
      }
      this.sendGameoverToSpectators(ev.winnerName, ev.placementNames, durationS, false);
    } else if (ev.kind === "ui") {
      const seat = this.seats.find((s) => s.id === ev.ship);
      if (seat?.ws && seat.ws.readyState === seat.ws.OPEN) {
        const { kind, ship, ...payload } = ev; // what (+ overlay element/state)
        seat.ws.send(JSON.stringify({ type: "ui", ...payload }));
      }
    } else if (ev.kind === "notice") {
      const targets =
        ev.ship === "all" ? this.seats.filter((s) => !s.dead).map((s) => s.id) : [ev.ship];
      for (const id of targets) {
        this.sendTranscript(id, "sys", ev.text, {
          priority: ev.alert ? "critical" : "news",
          speak: ev.speak,
          noSpeech: ev.silent,
        });
      }
    }
  }

  private sendGameoverToSpectators(
    winnerName: string,
    placements: string[],
    durationS: number,
    forfeit: boolean
  ): void {
    // no youWin: the spectator client banners the winner by name
    const payload = JSON.stringify({
      type: "gameover",
      winner: winnerName,
      winnerName,
      placements,
      durationS,
      forfeit,
    });
    for (const ws of this.spectators.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  // speakText (v4.7.1): optional TTS-safe variant of `text` — quantized
  // digit-word bearings, no "km" — so the voice never garbles numerals and
  // the synthesis cache stays bounded. The transcript always shows `text`.
  sendTranscript(
    id: ShipId,
    who: string,
    text: string,
    opts: { priority?: SpeechPriority; speak?: string; noSpeech?: boolean } = {}
  ): void {
    const seat = this.seats.find((s) => s.id === id);
    const ws = seat?.ws;
    if (ws && ws.readyState === ws.OPEN) {
      const priority = opts.priority ?? "news";
      // Ship-AI lines get a voice; skip bookkeeping noise (standing-order
      // trigger logs, dev-harness echoes) and v5.1 §1.3 silent lines
      // (confirmations of instantly HUD-visible effects).
      const speak =
        !opts.noSpeech &&
        (who === "xo" || who === "xo-note" || who === "sys" || who === "comms") &&
        !text.startsWith("Standing order '") &&
        !text.startsWith("direct");
      const speech = speak ? ensureSpeech(opts.speak ?? text) : null;
      ws.send(
        JSON.stringify({ type: "transcript", who, text, priority, ...(speech ? { speech } : {}) })
      );
    }
  }

  handleUtterance(ws: WebSocket, text: string, source: "voice" | "typed" = "typed"): void {
    const seat = this.seats.find((s) => s.ws === ws);
    if (!seat || seat.dead) return; // the dead watch; they don't command

    logUtterance({ room: this.code ?? "practice", ship: seat.id, source, text });

    // Dev harness: raw JSON commands bypass the translator. A single command
    // object or an array of them, exactly as the schema defines.
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        const commands: Command[] = Array.isArray(parsed) ? parsed : [parsed];
        this.sim.enqueue(seat.id, commands);
        this.sendTranscript(seat.id, "sys", `direct: ${commands.map((c) => c.verb).join(", ")}`, {
          priority: "chatter",
        });
      } catch {
        this.sendTranscript(seat.id, "sys", "direct command parse error", { priority: "news" });
      }
      return;
    }

    void this.translate(seat.id, text);
  }

  private async translate(id: ShipId, text: string): Promise<void> {
    const result = await translateUtterance(text, this.sim.stateSummaryFor(id));

    if (result.failed) {
      this.sendTranscript(id, "xo", "Say again, Captain?", { priority: "news" });
      return;
    }
    // reply-only elements are CONVERSATION, not executed commands — the
    // client renders them visibly distinct so a phantom "PDCs holding"
    // can never masquerade as an action acknowledgement (invariant 4)
    for (const reply of result.replies) {
      this.sendTranscript(id, "xo-note", reply, { priority: "chatter" });
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
          `${data.missiles_aboard} missiles aboard, ${data.decoys} decoys, PDC ${data.pdc_posture} with ${data.pdc_ammo_s}s of fire.`,
        { priority: "news" } // an answer is information the captain asked for
      );
      return;
    }
    const line = await phraseQueryAnswer(question, topic, data);
    // Fallback: template the raw data if the phrasing call fails.
    this.sendTranscript(id, "xo", line ?? `${topic}: ${JSON.stringify(data)}`, { priority: "news" });
  }

  roleOf(ws: WebSocket): ShipId | null {
    const seat = this.seats.find((s) => s.ws === ws);
    return seat ? seat.id : null;
  }
}
