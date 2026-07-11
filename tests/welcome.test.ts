// v4.3 §2: XO welcome on match start, both modes — one transcript event,
// spoken (who: xo/sys), and present in the boot-pregenerated stock lines.
import { Match } from "../server/match.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const fakeWs = () => {
  const ws = { sent: [] as any[], readyState: 1, OPEN: 1, send(s: string) { ws.sent.push(JSON.parse(s)); } };
  return ws;
};

// practice: welcome fires immediately on create (the PRACTICE click was the
// audio-unlocking gesture; start goes out first, then the line)
{
  const ws = fakeWs();
  const match = Match.createPractice(ws as any);
  const startIdx = ws.sent.findIndex((m) => m.type === "start");
  const welcomes = ws.sent.filter(
    (m) => m.type === "transcript" && /Practice range is hot/.test(m.text)
  );
  assert(welcomes.length === 1, "practice welcome sent exactly once");
  assert(ws.sent.indexOf(welcomes[0]) > startIdx, "welcome arrives after start");
  assert(welcomes[0].who === "xo", "practice welcome is the XO speaking");
  match.destroy();
}

// 1v1: the existing welcome still fires for both captains when B joins
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const match = Match.createRoom("WLCM", wsA as any);
  assert(!wsA.sent.some((m) => m.type === "transcript" && /out there somewhere/.test(m.text)), "no welcome while waiting for opponent");
  match.joinOrReconnect(wsB as any);
  for (const [name, ws] of [["A", wsA], ["B", wsB]] as const) {
    const welcomes = ws.sent.filter(
      (m) => m.type === "transcript" && /Enemy ship is out there somewhere/.test(m.text)
    );
    assert(welcomes.length === 1, `1v1 welcome sent once to ${name}`);
  }
  match.destroy();
}
console.log("done");
