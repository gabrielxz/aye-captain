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
- Max speed ${C.MAX_SPEED_MPS} m/s, full-thrust acceleration ${C.ACCEL_FULL_THRUST_MPS2} m/s^2, turn rate ${C.TURN_RATE_DEG_PER_SEC} deg/s.
- Ships drift (Newtonian): rotating does not change velocity. Braking = flip 180 and burn. Turning is free (reaction wheels).
- Propellant: tank ${C.PROPELLANT_MAX}, burns ${C.PROPELLANT_BURN_AT_FULL}/s at 100% thrust (linear). Regenerates ${C.PROPELLANT_REGEN_PER_S}/s ONLY inside the zone with throttle set <= ${C.REGEN_MAX_THRUST_PCT}%. At zero: no thrust output (setting remembered), ship coasts; turning and weapons still work.
- Detection: contact tiers. FAINT = approximate position only, no vector, cannot lock. TRACK = true position + velocity, lockable. ID = full detail. Detection range = ${C.SENSOR_BASE_M / 1000} km x (target signature / 100), line of sight permitting: a hard-burning ship shows ~181 km out, a dark drifter ~16 km. Rocks and dust clouds block sensors, locks, and seekers. Region radius ${C.REGION_RADIUS_M / 1000} km.
- PDCs (point defense): AUTOMATED, commanded by posture via set_pdc. While FREE they engage inbound missiles within ${C.PDC_RANGE_M / 1000} km (${Math.round(C.PDC_KILL_PROB_PER_S * 100)}%/s kill chance each) and enemy ships within ${C.PDC_SHIP_RANGE_M / 1000} km (${C.PDC_SHIP_DPS} hull/s), line of sight permitting. HOLD silences them (ammo conservation / staying dark). Ammo: ${C.PDC_AMMO_S}s of cumulative fire, NO regeneration. Firing spikes our signature. There is NO laser on this ship — it was traded for the PDC mounts; if the captain calls for the laser, say so in character and offer the PDCs.
- Missiles: ${C.MISSILE_MAGAZINE} aboard total, ${C.TUBE_COUNT} launch tubes (auto-reload ${C.TUBE_RELOAD_S}s each from reserves). FIRING REQUIRES A LOCK: automatic when we hold a TRACK-or-better contact within ${C.LOCK_RANGE_M / 1000} km and ${C.LOCK_CONE_HALF_ANGLE_DEG} deg of our nose for ${C.LOCK_TIME_S}s continuous (a faint contact cannot be locked). Missiles accelerate at ${C.MISSILE_ACCEL_MPS2} m/s^2 to ${C.MISSILE_MAX_SPEED_MPS} m/s, seeker locks strongest signature in a ${C.MISSILE_ACQ_CONE_DEG} deg cone after ${C.MISSILE_LAUNCH_DELAY_TICKS}s, ${C.MISSILE_DAMAGE} damage, proximity fuse ${C.MISSILE_PROX_FUSE_M} m. Firing spikes our signature hugely for ${C.SIG_SPIKE_LAUNCH_S}s — the enemy will likely see the launch flash.
- Being painted: when the ENEMY is acquiring/holding a lock on us, we know (and can react via the being_painted metric).
- Decoys: ${C.DECOY_SUPPLY} carried, hot signature for ${C.DECOY_LIFETIME_S}s, attracts missile seekers.
- Compass headings: 0 = north, 90 = east, clockwise. port = left = counterclockwise, starboard = right = clockwise.
- Max ${C.STANDING_ORDER_MAX} standing orders.`,

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
Utterances may arrive via speech-to-text and can contain mishearings: homophones (to/two/too, for/four), numbers split or joined oddly ("zero four five" = 045, "two seventy" = 270), and garbled jargon ("hard aport" = hard to port, "star bird" = starboard, "de coy" = decoy). Interpret charitably by sound and context. When you corrected an apparent mishearing, state your interpretation in the acknowledgement.`,

    `## Output format
Reply with ONLY a JSON array of at most 4 command objects — no prose, no code fences, no explanation. Every command carries a short "acknowledgement" in the XO's voice (crisp naval brevity; state your interpretation when you had to guess).
If the captain's words map to no command at all (a question you cannot answer from state, an impossible request, small talk), return a single reply-only element: [{"acknowledgement": "<one XO line explaining what the ship can and cannot do>"}].
For query commands, leave the acknowledgement empty — the answer is written after the server returns data.`,
  ].join("\n\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ---------- validation ----------

const TARGETS = ["enemy_ship", "nearest_missile", "nearest_decoy", "nearest_contact"];
const METRICS = [
  "enemy_range",
  "enemy_on_sensors",
  "missile_inbound",
  "nearest_missile_range",
  "own_hull_percent",
  "own_speed",
  "own_missiles_remaining",
  "own_decoys_remaining",
  "enemy_bearing_off_nose",
  "distance_from_zone_center",
  "time_elapsed_seconds",
  "have_lock",
  "being_painted",
  "propellant_percent",
  "tubes_ready",
];
const OPS = ["lt", "lte", "gt", "gte", "eq"];
const TOPICS = [
  "enemy",
  "own_ship",
  "weapons",
  "pdc",
  "propellant",
  "tubes",
  "damage_report",
  "missiles_inbound",
  "standing_orders",
  "zone",
  "full_report",
];

function validTubesParam(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const tubes = v.map(Number);
  if (tubes.some((n) => !Number.isInteger(n) || n < 1 || n > 2)) return null;
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
        if (typeof p.target !== "string" || !TARGETS.includes(p.target)) return null;
        return out({ mode: "target", target: p.target });
      }
      return null;
    }
    case "deploy_decoy":
      return out({});
    case "set_pdc": {
      if (p.posture !== "free" && p.posture !== "hold") return null;
      return out({ posture: p.posture });
    }
    case "fire_missile": {
      if (p.tubes === undefined) return out({});
      const tubes = validTubesParam(p.tubes);
      return tubes ? out({ tubes }) : null;
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

export function parseResponse(text: string): TranslationResult {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const candidates = [cleaned];
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  if (start >= 0) candidates.push(repairJson(cleaned.slice(start)));

  let parsed: unknown;
  let ok = false;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      ok = true;
      break;
    } catch {
      /* try the next repair stage */
    }
  }
  if (!ok) return { commands: [], replies: [], dropped: 0, failed: true };

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
        system: SYSTEM_PROMPT,
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
