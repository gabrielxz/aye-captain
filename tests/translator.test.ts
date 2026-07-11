import { parseResponse, repairJson, validateCommand } from "../server/translator.js";

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
// 16. heading validation
{
  assert(validateCommand({verb:"set_heading",params:{mode:"relative",direction:"port",degrees:40}}) !== null, "relative heading valid");
  assert(validateCommand({verb:"set_heading",params:{mode:"relative",degrees:40}}) === null, "relative without direction rejected");
  assert(validateCommand({verb:"set_heading",params:{mode:"target",target:"mothership"}}) === null, "unknown target rejected");
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
