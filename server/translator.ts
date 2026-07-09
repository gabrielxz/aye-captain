// Anthropic API call, prompt assembly, JSON validation
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as C from "./constants.js";
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

    `## World constants
- Max speed ${C.MAX_SPEED_MPS} m/s, full-thrust acceleration ${C.ACCEL_FULL_THRUST_MPS2} m/s^2, turn rate ${C.TURN_RATE_DEG_PER_SEC} deg/s.
- Ships drift (Newtonian): rotating does not change velocity. Braking = flip 180 and burn.
- Sensor range ${C.SENSOR_RANGE_M / 1000} km (halved outside the zone). Zone radius ${C.ZONE_RADIUS_M / 1000} km, hard limit ${C.HARD_LIMIT_RADIUS_M / 1000} km.
- Laser: range ${C.LASER_RANGE_M / 1000} km, ${C.LASER_BEAM_WIDTH_DEG} deg half-angle off boresight, ${C.LASER_COOLDOWN_S}s cooldown, ${C.LASER_DAMAGE} damage; instantly kills missiles/decoys. Fires along current facing.
- Missiles: ${C.MISSILE_MAGAZINE} carried, ${C.MISSILE_SPEED_MPS} m/s, seeker locks strongest signature in a ${C.MISSILE_ACQ_CONE_DEG} deg cone after ${C.MISSILE_LAUNCH_DELAY_TICKS}s, ${C.MISSILE_DAMAGE} damage, proximity fuse ${C.MISSILE_PROX_FUSE_M} m.
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
];
const OPS = ["lt", "lte", "gt", "gte", "eq"];
const TOPICS = [
  "enemy",
  "own_ship",
  "weapons",
  "missiles_inbound",
  "standing_orders",
  "zone",
  "full_report",
];

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
    case "fire_laser":
    case "fire_missile":
    case "deploy_decoy":
      return out({});
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

export function parseResponse(text: string): TranslationResult {
  let cleaned = text.replace(/```(?:json)?/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return { commands: [], replies: [], dropped: 0, failed: true };
      }
    } else {
      return { commands: [], replies: [], dropped: 0, failed: true };
    }
  }

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
    return parseResponse(text);
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
