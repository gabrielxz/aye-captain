import { parseResponse, repairJson, stripLeadingZeros, validateCommand } from "../server/translator.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. clean array parses
{
  const r = parseResponse('[{"verb":"set_thrust","params":{"percent":100},"acknowledgement":"Flank speed, aye."}]');
  assert(!r.failed && r.commands.length === 1 && r.commands[0].verb === "set_thrust", "clean array");
}
// 2. code fences stripped
{
  const r = parseResponse('```json\n[{"verb":"set_pdc","params":{"posture":"free"}}]\n```');
  assert(!r.failed && r.commands[0]?.verb === "set_pdc", "code fences stripped");
}
// 3. prose around the array
{
  const r = parseResponse('Here are the commands:\n[{"verb":"deploy_decoy","params":{}}]\nDone.');
  assert(!r.failed && r.commands[0]?.verb === "deploy_decoy", "prose-wrapped array recovered");
}
// 4. single object (not array) accepted
{
  const r = parseResponse('{"verb":"set_thrust","params":{"percent":0}}');
  assert(!r.failed && r.commands.length === 1, "bare object wrapped");
}
// 5. invalid commands dropped, valid kept
{
  const r = parseResponse('[{"verb":"warp_drive","params":{}},{"verb":"set_thrust","params":{"percent":50}},{"verb":"set_thrust","params":{"percent":150}}]');
  assert(r.commands.length === 1 && r.dropped === 2, `invalid dropped (kept ${r.commands.length}, dropped ${r.dropped})`);
}
// 6. total garbage -> failed
{
  const r = parseResponse("Aye captain, turning now!");
  assert(r.failed, "prose only -> failed");
}
// 7. reply-only element
{
  const r = parseResponse('[{"acknowledgement":"We have no tractor beam, Captain."}]');
  assert(!r.failed && r.replies.length === 1 && r.commands.length === 0, "reply-only element");
}
// 8. max 4 commands enforced
{
  const cmds = Array(6).fill('{"verb":"set_pdc","params":{"posture":"free"}}').join(",");
  const r = parseResponse(`[${cmds}]`);
  assert(r.commands.length === 4 && r.dropped === 2, "capped at 4 commands");
}
// 9. standing order valid
{
  const so = {verb:"set_standing_order", params:{label:"missile defense",
    condition:{metric:"missile_inbound",op:"eq",value:true},
    actions:[{verb:"set_heading",params:{mode:"target",target:"nearest_missile"}},{verb:"set_pdc",params:{posture:"free"}}],
    repeat:true}};
  assert(validateCommand(so) !== null, "valid standing order");
}
// 10. nested standing order rejected
{
  const so = {verb:"set_standing_order", params:{
    condition:{metric:"enemy_range",op:"lt",value:3000},
    actions:[{verb:"set_standing_order",params:{condition:{metric:"own_speed",op:"gt",value:0},actions:[{verb:"set_pdc",params:{posture:"free"}}]}}]}};
  assert(validateCommand(so) === null, "nested standing order rejected");
}
// 11. cancel form
{
  const so = {verb:"set_standing_order", params:{cancel_label:"missile defense"}};
  assert(validateCommand(so) !== null, "cancel_label form valid");
}
// 12. condition groups: all/any 2-3, bad metric rejected
{
  const good = {verb:"set_standing_order",params:{condition:{all:[{metric:"enemy_range",op:"lt",value:5000},{metric:"enemy_bearing_off_nose",op:"lt",value:4}]},actions:[{verb:"set_pdc",params:{posture:"free"}}]}};
  assert(validateCommand(good) !== null, "all-group condition valid");
  const bad = {verb:"set_standing_order",params:{condition:{metric:"enemy_mood",op:"lt",value:5},actions:[{verb:"set_pdc",params:{posture:"free"}}]}};
  assert(validateCommand(bad) === null, "unknown metric rejected");
  const single = {verb:"set_standing_order",params:{condition:{all:[{metric:"enemy_range",op:"lt",value:5000}]},actions:[{verb:"set_pdc",params:{posture:"free"}}]}};
  assert(validateCommand(single) === null, "all-group with 1 comparison rejected");
}
// 13. bracket repair: the exact malformed response from the 2026-07-10
// playtest (extra closing brace before the ]) must parse
{
  const raw = '```json\n[{"verb":"set_standing_order","params":{"label":"throttle at 400","condition":{"metric":"own_speed","op":"gte","value":400},"actions":[{"verb":"set_thrust","params":{"percent":0}}],"repeat":false},"acknowledgement":"Engines cut at four hundred, Captain."}}]\n```';
  const r = parseResponse(raw);
  assert(!r.failed && r.commands[0]?.verb === "set_standing_order", "extra closing brace repaired (playtest specimen)");
}
// 14. bracket repair: truncated response (missing closers) recovers
{
  const r = parseResponse('[{"verb":"set_thrust","params":{"percent":25},"acknowledgement":"Quarter thrust."');
  assert(!r.failed && r.commands[0]?.verb === "set_thrust", "missing closers appended");
}
// 15. repairJson never touches balanced JSON or braces inside strings
{
  const s = '[{"verb":"set_thrust","params":{"percent":1},"acknowledgement":"brace } in { string"}]';
  assert(repairJson(s) === s, "balanced JSON untouched, string braces ignored");
}
// 15b. multi-block self-corrections + leading zeros: the four verbatim
// "unusable response" drops from the 2026-07-12 multiplayer playtest
{
  // "100." — ack-only draft, prose, then the real command in a second fence
  const r1 = parseResponse('```json\n[{"acknowledgement": "Thrust to one hundred percent, aye."}]\n```\n\nWait—I need to emit the command:\n\n```json\n[{"verb":"set_thrust","params":{"percent":100},"acknowledgement":"Flank speed, aye."}]\n```');
  assert(r1.commands.length === 1 && r1.commands[0].verb === "set_thrust", "self-corrected second block wins (set_thrust 100)");

  // "Fire missile towards Bering 18201." — unfenced ack line, then the command fenced
  const r2 = parseResponse('[{"acknowledgement":"Bearing one-eight-two, blind fire — bird away."}]\n\n```json\n[{"verb":"fire_missile","params":{"guidance":"bearing","bearing_degrees":182}}]\n```');
  assert(r2.commands.length === 1 && r2.commands[0].verb === "fire_missile", "fenced command block beats unfenced ack line");

  // "all stop" on dry tanks — two ack-only blocks, the second is the model's correction
  const r3 = parseResponse('```json\n[{"acknowledgement":"All stop, aye. Flipping to retrograde."}]\n```\n\nWait — tanks are dry.\n\n```json\n[{"acknowledgement":"Tanks empty, Captain. No thrust to brake with."}]\n```');
  assert(r3.commands.length === 0 && r3.replies.length === 1 && /Tanks empty/.test(r3.replies[0]), "reply-only: the LAST block's correction is kept");

  // leading-zero bearing ("degrees": 051) is invalid JSON — repaired, not dropped
  const r4 = parseResponse('```json\n[{"verb": "set_heading", "params": {"mode": "absolute", "degrees": 051}, "acknowledgement": "Coming to zero five one."}]\n```');
  assert(r4.commands.length === 1 && (r4.commands[0].params as any).degrees === 51, "leading-zero degrees repaired to 51");

  // leading-zero repair never touches digits inside strings, decimals, or plain 10
  const s = '[{"a":"call 051 back","b":10,"c":0.5,"d":051}]';
  assert(stripLeadingZeros(s) === '[{"a":"call 051 back","b":10,"c":0.5,"d":51}]', "zero-stripping is string-aware and spares 10 / 0.5");
}

// 16. heading validation
{
  assert(validateCommand({verb:"set_heading",params:{mode:"relative",direction:"port",degrees:40}}) !== null, "relative heading valid");
  assert(validateCommand({verb:"set_heading",params:{mode:"relative",degrees:40}}) === null, "relative without direction rejected");
  // v5 §3: free-form contact refs pass the validator (the sim rejects
  // unknown names at execution); structurally invalid refs still die here
  assert(validateCommand({verb:"set_heading",params:{mode:"target",target:"Bravo"}}) !== null, "contact-ref target accepted");
  assert(validateCommand({verb:"set_heading",params:{mode:"target",target:"9%bogus\n"}}) === null, "malformed target rejected");
  assert(validateCommand({verb:"set_lock_target",params:{contact:"Kestrel"}}) !== null, "set_lock_target accepted");
  assert(validateCommand({verb:"set_lock_target",params:{}}) === null, "set_lock_target needs a contact");
  assert(validateCommand({verb:"query",params:{topic:"enemy"}}) !== null, "query valid");
  assert(validateCommand({verb:"query",params:{topic:"weather"}}) === null, "unknown topic rejected");
}

// every example the schema teaches the model must itself pass the validator
// (guards the prompt's few-shot set against schema drift)
{
  const { readFileSync } = await import("node:fs");
  const schema = JSON.parse(readFileSync(new URL("../ship_command_schema.json", import.meta.url), "utf8"));
  for (const ex of schema.example_translations.examples) {
    const bad = ex.commands.filter((c: any) => c.verb !== undefined && validateCommand(c) === null);
    assert(bad.length === 0, `schema example valid: "${ex.captain}"`);
  }
}

// v4.4 mappings pinned: the two fix-anchoring examples encode the right verbs
{
  const { readFileSync } = await import("node:fs");
  const schema = JSON.parse(readFileSync(new URL("../ship_command_schema.json", import.meta.url), "utf8"));
  const byCapt = (t: string) => schema.example_translations.examples.find((e: any) => e.captain === t);
  const stop = byCapt("Stop engines");
  assert(stop?.commands[0].verb === "set_thrust" && stop.commands[0].params.percent === 0, "'Stop engines' example is thrust 0, not full_stop");
  const spin = byCapt("Spin in a clockwise circle");
  assert(spin?.commands[0].params.degrees === 360 && spin.commands[0].params.direction === "starboard", "spin example is a real 360 starboard turn");
  const lockFire = byCapt("Lock missiles then fire both");
  assert(lockFire?.commands.some((c: any) => c.verb === "set_standing_order" && c.params.condition.metric === "have_lock"), "lock-then-fire example arms a have_lock standing order");
  assert(!lockFire?.commands.some((c: any) => c.verb === "fire_missile"), "lock-then-fire example never fires immediately");
}
console.log("done");
