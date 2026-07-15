// Anthropic API call, prompt assembly, JSON validation
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as C from "./constants.js";
import { PERSONA } from "./persona.js";
import type { Command } from "./sim.js";

const schema = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, "..", "ship_command_schema.json"),
    "utf8"
  )
);

let client: Anthropic | null = null;

export function llmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// ---------- system prompt ----------

function buildSystemPrompt(): string {
  const rules: string[] = schema.llm_translator_rules.rules;
  const examples: Array<{ captain: string; commands: unknown[] }> =
    schema.example_translations.examples;

  return [
    `You are the first mate (XO) of a small warship in a 2D space combat game. The captain gives orders in natural language; you translate each utterance into JSON commands for the ship's systems, per the command schema below.`,

    `## Command schema (source of truth)\n${JSON.stringify(schema.definitions, null, 1)}`,

    PERSONA,

    `## World constants
- Max speed ${C.MAX_SPEED_MPS} m/s (all hulls). Baseline FRIGATE: acceleration ${C.ACCEL_FULL_THRUST_MPS2} m/s^2, turn ${C.TURN_RATE_DEG_PER_SEC} deg/s. v5 archetypes differ in numbers only — CORVETTE (fast, dim, 1 tube), FRIGATE (baseline), CRUISER (heavy hull, 3 tubes, loud). An archetype is a STARTING HULL, not a fixed class: only the frigate and cruiser ship with a railgun, but ANY hull can install a salvaged one and fire it. CURRENT SHIP STATE names this hull's archetype and lists what is actually installed, lit, and in the hold — it is authoritative over everything in this section.
- Ships drift (Newtonian): rotating does not change velocity. Braking = flip 180 and burn. Turning is free (reaction wheels).
- Propellant: tank ${C.PROPELLANT_MAX}, burns ${C.PROPELLANT_BURN_AT_FULL}/s at 100% thrust (linear). Regenerates ${C.PROPELLANT_REGEN_PER_S}/s ONLY inside the zone with throttle set <= ${C.REGEN_MAX_THRUST_PCT}%. Run the tank dry and the engines AUTO-SAFE: the throttle setting drops to zero (belaying any timed burn) so harvesting starts at once, and the ship coasts; turning and weapons still work. With fuel aboard, the setting stands.
- Detection: contact tiers. FAINT = approximate position only, no vector, cannot lock. TRACK = true position + velocity, lockable. ID = full detail. Detection range = ${C.SENSOR_BASE_M / 1000} km x (target signature / 100), line of sight permitting: a hard-burning ship shows ~${Math.round((C.SENSOR_BASE_M * (C.SIG_BASE + 100)) / 100 / 1000)} km out, a dark drifter ~${Math.round((C.SENSOR_BASE_M * C.SIG_BASE) / 100 / 1000)} km. Rocks and dust clouds block sensors, locks, and seekers. Region radius ${C.REGION_RADIUS_M / 1000} km.
- THERMAL MEMORY: signature does NOT drop the moment you cut the drive — the hull holds its heat and sheds it at ${C.THERMAL_DECAY_PER_S}/s, so a ship at full burn needs ~${Math.round(100 / C.THERMAL_DECAY_PER_S)}s to go cold. Going dark is a commitment you make early, not a switch you flip when you see something. Never promise the captain we vanish the instant the engines stop; the signature in CURRENT SHIP STATE is the live number and it is authoritative.
- PDCs (point defense): AUTOMATED, commanded by posture via set_pdc. While FREE they engage inbound missiles within ${C.PDC_RANGE_M / 1000} km (${Math.round(C.PDC_KILL_PROB_PER_S * 100)}%/s kill chance) and enemy ships within ${C.PDC_SHIP_RANGE_M / 1000} km (${C.PDC_SHIP_DPS} hull/s), line of sight permitting. The mounts have FINITE THROUGHPUT: they hold a few targets at full rate (this hull's number is in CURRENT SHIP STATE) and time-slice past that, so the per-target rate divides — a salvo saturates point defense and that is a real tactic, incoming and outgoing. They shoot what kills you soonest: missiles first, then mines, then probes. HOLD silences them (ammo conservation / staying dark). Ammo: ${C.PDC_AMMO_S}s of cumulative fire, NO regeneration. Firing spikes our signature. There is NO laser on this ship — it was traded for the PDC mounts; if the captain calls for the laser, say so in character and offer the PDCs.
- Missiles: ${C.MISSILE_MAGAZINE} aboard total, ${C.TUBE_COUNT} launch tubes (auto-reload ${C.TUBE_RELOAD_S}s each from reserves). A LOCKED shot (default) requires a TRACK-or-better contact within ${C.LOCK_RANGE_M / 1000} km and ${C.LOCK_CONE_HALF_ANGLE_DEG} deg of our nose held ${C.LOCK_TIME_S}s; the bird then flies UPLINKED — intercept guidance off our track, immune to decoys while we hold the lock. Lose the lock and it goes autonomous (one-way): its own weak seeker (${C.MISSILE_SEEKER_BASE_M / 1000} km base, scales with target signature), decoy-susceptible. BLIND FIRE (guidance "bearing") needs no lock — autonomous from birth, a flushing tool. Missiles accelerate at ${C.MISSILE_ACCEL_MPS2} m/s^2 to ${C.MISSILE_MAX_SPEED_MPS} m/s with ${C.MISSILE_PROPELLANT_S}s of engine, ${C.MISSILE_DAMAGE} damage, proximity fuse ${C.MISSILE_PROX_FUSE_M} m. Firing spikes our signature hugely for ${C.SIG_SPIKE_LAUNCH_S}s — the enemy will likely see the launch flash.
- Being painted: when the ENEMY is acquiring/holding a lock on us, we know (and can react via the being_painted metric).
- Decoys: ${C.DECOY_SUPPLY} carried, hot signature for ${C.DECOY_LIFETIME_S}s, attracts missile seekers.
- Compass headings: 0 = north, 90 = east, clockwise. port = left = counterclockwise, starboard = right = clockwise.
- Max ${C.STANDING_ORDER_MAX} standing orders.
- THE LOADOUT: the ship carries MODULES — installed ones are the deck (mass, always), POWERED ones are the hand (reactor draw, and DRAW IS SIGNATURE: +${C.POWER_TO_SIG} noise per point). Reactor capacity is hard: over it, something must go cold first (the server rejects, never sheds). power on/off is instant and free at any speed; install/uninstall need a FULL STOP and ~${C.MODULE_INSTALL_S}s of helplessness (any thrust aborts, progress lost). Modules: baffles (−25% total signature while lit), deep_array (+60% sensor range while lit), railgun (must be lit to fire — firing a cold one lights it automatically), mine_layer (lit to drop mines), armor_plate (+hull, passive), probe_rack (+probes, passive), drive_tune (+15% thrust while lit). Modules and ore come off wrecks — salvage them like any site. CURRENT SHIP STATE lists what's installed, lit, and in the hold — trust it.`,

    `## Rules\n${rules.map((r) => `- ${r}`).join("\n")}`,

    `## Examples\n${examples
      .map(
        (ex) =>
          `CAPTAIN: ${ex.captain}\n${JSON.stringify(ex.commands)}`
      )
      .join("\n\n")}`,

    `## Live state
The user message includes a CURRENT SHIP STATE block. Use it to resolve context-dependent orders ("ease off" = reduce from current thrust, "point at him" = target the contact, "same again") and to write informed acknowledgements.`,

    `## Voice input
Utterances may arrive via speech-to-text and can contain mishearings: homophones (to/two/too, for/four), numbers split or joined oddly ("zero four five" = 045, "two seventy" = 270), and garbled jargon ("hard aport" = hard to port, "star bird" = starboard, "de coy" = decoy, "pieces"/"PCs"/"pity seas" = PDCs — "hold pieces" is set_pdc hold). Interpret charitably by sound and context. When you corrected an apparent mishearing, state your interpretation in the acknowledgement.`,

    `## Output format
Reply with ONLY a JSON array of at most 4 command objects — no prose, no code fences, no explanation. Every command carries a short "acknowledgement" in the XO's voice (crisp naval brevity; state your interpretation when you had to guess).
If the captain's words map to no command at all (a question you cannot answer from state, an impossible request, small talk), return a single reply-only element: [{"acknowledgement": "<one XO line explaining what the ship can and cannot do>"}].
For query commands, leave the acknowledgement empty — the answer is written after the server returns data.`,
  ].join("\n\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ~15k tokens, and 100% static: the per-utterance state summary and the
// captain's words ride in `messages`, never in here. That makes it a textbook
// cache prefix, and until 2026-07-15 we re-billed every token of it on every
// utterance of every captain. Anything dynamic added to this array silently
// un-caches the whole prompt — put it in the user message instead.
// TTL: the 5-minute default. In-match utterances land far closer together than
// that, so live traffic keeps the entry warm on its own; `ttl: "1h"` doubles
// the write cost (2x vs 1.25x) and needs 3+ reads to pay for itself.
const SYSTEM_BLOCKS: Anthropic.TextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

// A cache entry is only readable once the first response starts streaming, so
// a fresh room where eight captains all open their mouths at once would have
// every one of them miss and pay full price — and a cold prefill of this thing
// eats a real slice of LLM_TIMEOUT_MS. Pay the write once, at boot, off the
// same hook as the TTS stock-line pregeneration. max_tokens 1 (not 0) is
// deliberate: it is accepted by every API version, and one output token is
// cheaper than finding out the hard way.
export async function prewarmPromptCache(): Promise<void> {
  if (!llmAvailable()) return;
  try {
    const resp = await getClient().messages.create(
      {
        model: C.LLM_MODEL,
        max_tokens: 1,
        system: SYSTEM_BLOCKS,
        messages: [{ role: "user", content: "warmup" }],
      },
      { timeout: C.LLM_PREWARM_TIMEOUT_MS, maxRetries: 0 }
    );
    const u = resp.usage;
    console.log(
      `translator: prompt cache warm (${u.cache_creation_input_tokens ?? 0} written, ` +
        `${u.cache_read_input_tokens ?? 0} read)`
    );
  } catch (err) {
    // Never fatal: a cold cache costs money and latency, not correctness.
    console.error(
      "translator: prompt cache prewarm failed (harmless, first utterance pays full price):",
      err instanceof Error ? err.message : err
    );
  }
}

// ---------- validation ----------

const TARGETS = ["enemy_ship", "nearest_missile", "nearest_decoy", "nearest_contact", "nearest_rumble"];
// The Loadout: the module vocabulary (LINKED: == keys of C.MODULES)
const MODULE_IDS = Object.keys(C.MODULES);
// v5 §3: free-form contact refs — a designation letter or callsign as it
// appears in the contact table ("Bravo", "Contact Alpha", "Kestrel").
// Resolution (and rejection of unknown names) happens in the sim.
const CONTACT_REF = /^[A-Za-z][A-Za-z0-9' -]{0,30}$/;
const METRICS = [
  "enemy_contact_tier",
  "enemy_range",
  "enemy_bearing_off_nose",
  "missile_inbound",
  "nearest_missile_range",
  "own_hull_percent",
  "own_speed",
  "own_missiles_remaining",
  "own_decoys_remaining",
  "distance_from_zone_center",
  "time_elapsed_seconds",
  "have_lock",
  "being_painted",
  "propellant_percent",
  "pdc_ammo_seconds",
  "tubes_ready",
  "in_dust",
  "collision_warning",
  "rumble_present",
];
const OPS = ["lt", "lte", "gt", "gte", "eq"];
const TOPICS = [
  "enemy",
  "contacts",
  "own_ship",
  "weapons",
  "pdc",
  "terrain",
  "propellant",
  "tubes",
  "damage_report",
  "missiles_inbound",
  "standing_orders",
  "zone",
  "full_report",
  "mission", // campaign: gate bearing/range, the clock, wrecks on the board
];

function validTubesParam(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const tubes = v.map(Number);
  // v5 §4: archetypes carry 1-3 tubes (the sim rejects per-ship overs);
  // 4 leaves headroom for TUBE_NAMES
  if (tubes.some((n) => !Number.isInteger(n) || n < 1 || n > 4)) return null;
  return [...new Set(tubes)];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validComparison(v: unknown): boolean {
  if (!isObj(v)) return false;
  return (
    typeof v.metric === "string" &&
    METRICS.includes(v.metric) &&
    typeof v.op === "string" &&
    OPS.includes(v.op) &&
    (typeof v.value === "number" || typeof v.value === "boolean")
  );
}

function validCondition(v: unknown): boolean {
  if (!isObj(v)) return false;
  const group = (v.all ?? v.any) as unknown;
  if (group !== undefined) {
    return (
      Array.isArray(group) &&
      group.length >= 2 &&
      group.length <= 3 &&
      group.every(validComparison)
    );
  }
  return validComparison(v);
}

// Validate one raw command object against the schema. Returns a clean
// Command (unknown fields stripped) or null if invalid.
export function validateCommand(raw: unknown, nested = false): Command | null {
  if (!isObj(raw) || typeof raw.verb !== "string") return null;
  const p = isObj(raw.params) ? raw.params : {};
  const ack =
    typeof raw.acknowledgement === "string" ? raw.acknowledgement : undefined;
  const out = (params: Record<string, unknown>): Command => ({
    verb: raw.verb as Command["verb"],
    params,
    ...(ack ? { acknowledgement: ack } : {}),
  });

  switch (raw.verb) {
    case "set_thrust": {
      const pct = p.percent;
      if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100)
        return null;
      return out({ percent: pct });
    }
    case "set_heading": {
      if (p.mode === "relative") {
        if (
          (p.direction !== "port" && p.direction !== "starboard") ||
          typeof p.degrees !== "number" ||
          !(p.degrees > 0)
        )
          return null;
        return out({ mode: "relative", direction: p.direction, degrees: p.degrees });
      }
      if (p.mode === "absolute") {
        if (typeof p.degrees !== "number" || !Number.isFinite(p.degrees)) return null;
        return out({ mode: "absolute", degrees: p.degrees });
      }
      if (p.mode === "target") {
        if (typeof p.target !== "string") return null;
        if (!TARGETS.includes(p.target) && !CONTACT_REF.test(p.target)) return null;
        return out({ mode: "target", target: p.target });
      }
      return null;
    }
    case "set_lock_target": {
      if (typeof p.contact !== "string" || !CONTACT_REF.test(p.contact)) return null;
      return out({ contact: p.contact });
    }
    case "transmit": {
      if (p.channel !== "broadcast" && p.channel !== "tightbeam") return null;
      if (typeof p.message !== "string" || p.message.trim().length === 0) return null;
      const clean: Record<string, unknown> = {
        channel: p.channel,
        message: p.message.trim().slice(0, 140),
      };
      if (p.channel === "tightbeam") {
        if (typeof p.recipient !== "string" || !CONTACT_REF.test(p.recipient)) return null;
        clean.recipient = p.recipient;
      }
      return out(clean);
    }
    case "launch_probe": {
      const clean: Record<string, unknown> = {};
      if (p.bearing_degrees !== undefined) {
        if (typeof p.bearing_degrees !== "number" || !Number.isFinite(p.bearing_degrees)) return null;
        clean.bearing_degrees = p.bearing_degrees;
      }
      return out(clean);
    }
    case "fire_railgun": {
      const mode = p.mode === "bearing" ? "bearing" : "solution";
      const clean: Record<string, unknown> = { mode };
      if (mode === "bearing") {
        if (p.bearing_degrees !== undefined) {
          if (typeof p.bearing_degrees !== "number" || !Number.isFinite(p.bearing_degrees)) return null;
          clean.bearing_degrees = p.bearing_degrees;
        }
      } else if (p.target !== undefined) {
        if (typeof p.target !== "string" || !CONTACT_REF.test(p.target)) return null;
        clean.target = p.target;
      }
      return out(clean);
    }
    case "deploy_decoy":
      return out({});
    case "set_pdc": {
      if (p.posture !== "free" && p.posture !== "hold") return null;
      return out({ posture: p.posture });
    }
    case "maneuver": {
      // 1.1 §2b: optional per-command discipline override on the macros
      const hasDisc = p.discipline !== undefined;
      if (hasDisc && p.discipline !== "silent" && p.discipline !== "standard" && p.discipline !== "flank") return null;
      const disc = hasDisc ? { discipline: p.discipline } : {};
      if (p.type === "full_stop") return out({ type: p.type, ...disc });
      if (p.type === "gate_run") return out({ type: p.type, ...disc });
      if (p.type === "burn") {
        const secs = p.seconds;
        const pct = p.percent;
        if (typeof secs !== "number" || !Number.isFinite(secs) || secs < 1 || secs > 600) return null;
        if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
        return out({ type: "burn", seconds: secs, percent: pct });
      }
      return null;
    }
    case "salvage": {
      // campaign: resolution is by proximity server-side; a named target
      // rides along as flavor but is never required
      const clean: Record<string, unknown> = {};
      if (p.target !== undefined) {
        if (typeof p.target !== "string") return null;
        clean.target = p.target;
      }
      if (p.discipline !== undefined) {
        if (p.discipline !== "silent" && p.discipline !== "standard" && p.discipline !== "flank") return null;
        clean.discipline = p.discipline;
      }
      return out(clean);
    }
    case "come_alongside": {
      // Patch 2 §6: crew rendezvous + stores manifest
      const clean: Record<string, unknown> = {};
      if (p.target !== undefined) {
        if (typeof p.target !== "string") return null;
        clean.target = p.target;
      }
      if (p.discipline !== undefined) {
        if (p.discipline !== "silent" && p.discipline !== "standard" && p.discipline !== "flank") return null;
        clean.discipline = p.discipline;
      }
      if (p.give !== undefined) {
        if (typeof p.give !== "object" || p.give === null || Array.isArray(p.give)) return null;
        const give: Record<string, number> = {};
        for (const [k, v] of Object.entries(p.give as Record<string, unknown>)) {
          if (!["propellant", "pdc_ammo", "decoys", "probes", "missiles"].includes(k)) return null;
          if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return null;
          give[k] = Math.round(v);
        }
        clean.give = give;
      }
      return out(clean);
    }
    case "power": {
      // The Loadout §3a: instant, free, capacity-checked server-side
      if (!MODULE_IDS.includes(p.module as string)) return null;
      if (p.state !== "on" && p.state !== "off") return null;
      return out({ module: p.module, state: p.state });
    }
    case "install":
    case "uninstall": {
      // §3b the workshop rule — stop checks live in the sim
      if (!MODULE_IDS.includes(p.module as string)) return null;
      return out({ module: p.module });
    }
    case "drop_mine": {
      return out({});
    }
    case "set_maneuver_discipline": {
      // 1.1 §2a: the standing autopilot-throttle posture
      if (p.level !== "silent" && p.level !== "standard" && p.level !== "flank") return null;
      return out({ level: p.level });
    }
    case "show_vector":
      return out({});
    case "set_overlay": {
      if (p.element !== "drift") return null;
      if (p.state !== "on" && p.state !== "off") return null;
      return out({ element: p.element, state: p.state });
    }
    case "sensor_ping":
      return out({});
    case "fire_missile": {
      const clean: Record<string, unknown> = {};
      if (p.tubes !== undefined) {
        const tubes = validTubesParam(p.tubes);
        if (!tubes) return null;
        clean.tubes = tubes;
      }
      if (p.guidance !== undefined) {
        if (p.guidance !== "locked" && p.guidance !== "bearing") return null;
        clean.guidance = p.guidance;
      }
      if (p.bearing_degrees !== undefined) {
        // a bearing only means something on a blind shot
        if (clean.guidance !== "bearing") return null;
        if (typeof p.bearing_degrees !== "number" || !Number.isFinite(p.bearing_degrees)) return null;
        clean.bearing_degrees = p.bearing_degrees;
      }
      return out(clean);
    }
    case "reload_tubes": {
      if (p.tubes === undefined) return out({});
      const tubes = validTubesParam(p.tubes);
      return tubes ? out({ tubes }) : null;
    }
    case "set_standing_order": {
      if (nested) return null; // no recursive standing orders
      if (typeof p.cancel_label === "string" && !p.condition && !p.actions) {
        return out({ cancel_label: p.cancel_label });
      }
      if (!validCondition(p.condition)) return null;
      if (!Array.isArray(p.actions) || p.actions.length < 1 || p.actions.length > 3)
        return null;
      const actions = p.actions.map((a) => validateCommand(a, true));
      if (actions.some((a) => a === null || a.verb === "query")) return null;
      const clean: Record<string, unknown> = {
        condition: p.condition,
        actions,
      };
      if (typeof p.label === "string") clean.label = p.label;
      if (typeof p.repeat === "boolean") clean.repeat = p.repeat;
      return out(clean);
    }
    case "query": {
      if (typeof p.topic !== "string" || !TOPICS.includes(p.topic)) return null;
      return out({ topic: p.topic });
    }
    default:
      return null;
  }
}

// ---------- response parsing ----------

export interface TranslationResult {
  commands: Command[]; // validated commands, in order (queries included)
  replies: string[]; // reply-only acknowledgements (no command)
  dropped: number; // invalid elements discarded
  failed: boolean; // total failure -> "Say again, Captain?"
}

// Rebalance braces/brackets in almost-JSON: the LLM occasionally emits one
// extra (or one missing) closer. String-aware scan: unmatched closers are
// dropped, unclosed openers are closed at the end.
export function repairJson(text: string): string {
  const stack: string[] = [];
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
      out += ch;
    } else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) {
        stack.pop();
        out += ch;
      }
      // unmatched closer: drop it
    } else {
      out += ch;
    }
  }
  if (inString) out += '"';
  while (stack.length > 0) out += stack.pop();
  return out;
}

// JSON forbids leading zeros, and the model writes bearings verbatim
// ("degrees": 051) often enough to matter. String-aware: digits inside
// strings are untouched; 0.5 and 10 survive.
export function stripLeadingZeros(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    // a 0 starting a multi-digit integer (not following a digit or a
    // decimal point) is a leading zero — drop it
    if (ch === "0" && /\d/.test(text[i + 1] ?? "") && !/[\d.]/.test(out[out.length - 1] ?? "")) {
      continue;
    }
    out += ch;
  }
  return out;
}

function evaluateElements(parsed: unknown): TranslationResult {
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const commands: Command[] = [];
  const replies: string[] = [];
  let dropped = 0;

  for (const el of arr) {
    if (commands.length >= C.UTTERANCE_MAX_COMMANDS) {
      dropped++;
      continue;
    }
    // reply-only element: acknowledgement with no verb
    if (isObj(el) && el.verb === undefined && typeof el.acknowledgement === "string") {
      replies.push(el.acknowledgement);
      continue;
    }
    const cmd = validateCommand(el);
    if (cmd) commands.push(cmd);
    else dropped++;
  }

  const failed = commands.length === 0 && replies.length === 0;
  return { commands, replies, dropped, failed };
}

export function parseResponse(text: string): TranslationResult {
  const fixed = stripLeadingZeros(text);
  const cleaned = fixed.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const candidates = [cleaned];
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  if (start >= 0) candidates.push(repairJson(cleaned.slice(start)));
  // Self-corrected multi-block responses — an ack-only draft, prose
  // ("Wait — I need to emit the command:"), then a second fenced block with
  // the real command (playtest 2026-07-12 dropped four of these as
  // unusable). Each fenced block is its own candidate, LAST first: the
  // model's final answer supersedes its draft. An unterminated final fence
  // (response cut at max_tokens) still matches through to end-of-text, and
  // repairJson closes what the cutoff left open.
  const blocks = [...fixed.matchAll(/```(?:json)?\s*([\s\S]*?)(?:```|$)/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .reverse();
  for (const block of blocks) {
    candidates.push(block);
    candidates.push(repairJson(block));
  }

  // A candidate that yields real commands beats any reply-only candidate:
  // acks execute nothing (v4.6), and the dropped-command case is the one
  // that reads as "the XO ignored me".
  let replyOnly: TranslationResult | null = null;
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue; // try the next repair stage
    }
    const result = evaluateElements(parsed);
    if (result.commands.length > 0) return result;
    if (!result.failed && replyOnly === null) replyOnly = result;
  }
  return replyOnly ?? { commands: [], replies: [], dropped: 0, failed: true };
}

// ---------- API calls ----------

export async function translateUtterance(
  utterance: string,
  stateSummary: string
): Promise<TranslationResult> {
  if (!llmAvailable()) {
    return { commands: [], replies: [], dropped: 0, failed: true };
  }
  try {
    const resp = await getClient().messages.create(
      {
        model: C.LLM_MODEL,
        max_tokens: C.LLM_MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_BLOCKS,
        messages: [
          {
            role: "user",
            content: `CURRENT SHIP STATE:\n${stateSummary}\n\nCAPTAIN SAYS: ${utterance}`,
          },
        ],
      },
      { timeout: C.LLM_TIMEOUT_MS, maxRetries: 0 }
    );
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    const result = parseResponse(text);
    if (result.failed || result.dropped > 0) {
      console.error(
        `translator: ${result.failed ? "unusable" : `${result.dropped} dropped from`} response for "${utterance.slice(0, 80)}":`,
        JSON.stringify(text.slice(0, 500))
      );
    }
    return result;
  } catch (err) {
    console.error("translator error:", err instanceof Error ? err.message : err);
    return { commands: [], replies: [], dropped: 0, failed: true };
  }
}

// Second short call: phrase a query answer in the first mate's voice.
// Returns null on any failure (caller falls back to a template).
export async function phraseQueryAnswer(
  question: string,
  topic: string,
  data: Record<string, unknown>
): Promise<string | null> {
  if (!llmAvailable()) return null;
  try {
    const resp = await getClient().messages.create(
      {
        model: C.LLM_MODEL,
        max_tokens: 200,
        temperature: 0,
        system:
          "You are the first mate (XO) of a warship. The captain asked a question; the ship's computer returned the data below. Answer the captain in ONE short line, in character (crisp naval brevity), using ONLY the provided data. Never invent facts. If the data says something is unknown, say so plainly.",
        messages: [
          {
            role: "user",
            content: `CAPTAIN ASKED: ${question}\nTOPIC: ${topic}\nDATA:\n${JSON.stringify(data, null, 1)}`,
          },
        ],
      },
      { timeout: C.LLM_TIMEOUT_MS, maxRetries: 0 }
    );
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    console.error("query phrasing error:", err instanceof Error ? err.message : err);
    return null;
  }
}
