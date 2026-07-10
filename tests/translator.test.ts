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
  const r = parseResponse('```json\n[{"verb":"fire_laser","params":{}}]\n```');
  assert(!r.failed && r.commands[0]?.verb === "fire_laser", "code fences stripped");
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
  const cmds = Array(6).fill('{"verb":"fire_laser","params":{}}').join(",");
  const r = parseResponse(`[${cmds}]`);
  assert(r.commands.length === 4 && r.dropped === 2, "capped at 4 commands");
}
// 9. standing order valid
{
  const so = {verb:"set_standing_order", params:{label:"missile defense",
    condition:{metric:"missile_inbound",op:"eq",value:true},
    actions:[{verb:"set_heading",params:{mode:"target",target:"nearest_missile"}},{verb:"fire_laser",params:{}}],
    repeat:true}};
  assert(validateCommand(so) !== null, "valid standing order");
}
// 10. nested standing order rejected
{
  const so = {verb:"set_standing_order", params:{
    condition:{metric:"enemy_range",op:"lt",value:3000},
    actions:[{verb:"set_standing_order",params:{condition:{metric:"own_speed",op:"gt",value:0},actions:[{verb:"fire_laser",params:{}}]}}]}};
  assert(validateCommand(so) === null, "nested standing order rejected");
}
// 11. cancel form
{
  const so = {verb:"set_standing_order", params:{cancel_label:"missile defense"}};
  assert(validateCommand(so) !== null, "cancel_label form valid");
}
// 12. condition groups: all/any 2-3, bad metric rejected
{
  const good = {verb:"set_standing_order",params:{condition:{all:[{metric:"enemy_range",op:"lt",value:5000},{metric:"enemy_bearing_off_nose",op:"lt",value:4}]},actions:[{verb:"fire_laser",params:{}}]}};
  assert(validateCommand(good) !== null, "all-group condition valid");
  const bad = {verb:"set_standing_order",params:{condition:{metric:"enemy_mood",op:"lt",value:5},actions:[{verb:"fire_laser",params:{}}]}};
  assert(validateCommand(bad) === null, "unknown metric rejected");
  const single = {verb:"set_standing_order",params:{condition:{all:[{metric:"enemy_range",op:"lt",value:5000}]},actions:[{verb:"fire_laser",params:{}}]}};
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
console.log("done");
