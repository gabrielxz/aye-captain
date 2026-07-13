// v5.1 §1: speech discipline. The scheduler rules (gap, three tiers,
// barge-in, TTL) run against the pure client module with a fake clock; the
// ack rule (§1.3) runs against a real Match with fake sockets.
import {
  createSpeechScheduler,
  SPEECH_MIN_GAP_MS,
  SPEECH_TTL_MS,
  BARGE_FADE_MS,
} from "../client/speech-scheduler.js";
import { Match } from "../server/match.js";
import { speechId } from "../server/tts.js";
import { ACK_SPEAK_LINES, QUERY_ANSWER_SPEAK } from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

function harness() {
  let t = 0;
  const started: { id: string; priority: string }[] = [];
  const stopped: number[] = [];
  const laters: number[] = [];
  const s = createSpeechScheduler({
    now: () => t,
    start: (id: string, priority: string) => started.push({ id, priority }),
    stop: (fadeMs: number) => stopped.push(fadeMs),
    later: (ms: number) => laters.push(ms),
  });
  return { s, started, stopped, laters, tick: (v: number) => { t = v; } };
}

// 1. the gap: a second NEWS line may not start until SPEECH_MIN_GAP_MS
//    after the first ENDED
{
  const h = harness();
  h.s.enqueue("n1", "news");
  assert(h.started.length === 1, "first news line starts immediately");
  h.tick(1000);
  h.s.onEnded();
  h.tick(1100);
  h.s.enqueue("n2", "news");
  assert(h.started.length === 1, "second news line is gap-blocked");
  assert(h.laters.length > 0, "a re-poll is requested for when the gap opens");
  h.tick(1000 + SPEECH_MIN_GAP_MS - 100);
  h.s.poll();
  assert(h.started.length === 1, "still blocked just before the gap elapses");
  h.tick(1000 + SPEECH_MIN_GAP_MS + 50);
  h.s.poll();
  assert(h.started.length === 2 && h.started[1].id === "n2", "news starts once the gap has elapsed");
}

// 2. CRITICAL ignores the gap and preempts a playing non-critical line
{
  const h = harness();
  h.s.enqueue("n1", "news");
  h.tick(500);
  h.s.enqueue("c1", "critical");
  assert(h.stopped.length === 1 && h.stopped[0] === BARGE_FADE_MS, "critical fades the playing news line out");
  assert(h.started[1]?.id === "c1", "critical starts immediately");
  h.tick(1500);
  h.s.onEnded(); // c1 done
  h.tick(1600);
  h.s.enqueue("c2", "critical");
  assert(h.started[2]?.id === "c2", "critical ignores the inter-line gap");
}

// 3. NEWS preempts nothing; CHATTER never plays while anything is queued
{
  const h = harness();
  h.s.enqueue("c1", "chatter");
  assert(h.started.length === 1, "chatter plays into silence");
  h.s.enqueue("n1", "news");
  assert(h.stopped.length === 0, "news does not interrupt the playing line");
  h.tick(1000);
  h.s.onEnded();
  h.tick(1000 + SPEECH_MIN_GAP_MS + 50);
  h.s.enqueue("c2", "chatter");
  h.s.poll();
  assert(h.started[1]?.id === "n1", "queued news outranks fresh chatter");
  // c2 must never play while n1's gap window still holds anything queued;
  // by the time the channel is clear again its TTL has thinned it
  h.tick(h.started.length && 2000 + SPEECH_MIN_GAP_MS);
  h.s.onEnded();
  h.tick(2000 + SPEECH_MIN_GAP_MS * 2 + 100);
  h.s.poll();
  assert(!h.started.some((e) => e.id === "c2"), "battle-tempo chatter dies of TTL instead of playing late");
}

// 4. fresh chatter at idle plays; stale news is TTL-dropped
{
  const h = harness();
  h.tick(10_000);
  h.s.enqueue("c1", "chatter");
  assert(h.started[0]?.id === "c1", "fresh chatter plays when idle and gap-clear");
  h.tick(11_000);
  h.s.onEnded();
  h.s.enqueue("n1", "news"); // gap-blocked now
  h.tick(11_000 + SPEECH_TTL_MS.news + 200); // older than its TTL by the time the gap opens
  h.s.poll();
  assert(!h.started.some((e) => e.id === "n1"), "news that outlived its TTL is dropped, not played late");
}

// 5. critical dedupe + freshest-2 cap
{
  const h = harness();
  h.s.enqueue("c1", "critical"); // playing
  h.s.enqueue("c1", "critical"); // dupe of queued? (playing) — ignored
  h.s.enqueue("c2", "critical");
  h.s.enqueue("c2", "critical"); // dupe — ignored
  h.s.enqueue("c3", "critical");
  h.s.enqueue("c4", "critical"); // c2 falls off (freshest 2 = c3, c4)
  h.tick(100); h.s.onEnded();
  h.tick(200); h.s.onEnded();
  h.tick(300); h.s.onEnded();
  h.tick(400); h.s.onEnded();
  const ids = h.started.map((e) => e.id).join(",");
  assert(ids === "c1,c3,c4", `only the freshest 2 queued criticals survive (got ${ids})`);
}

// 6. barge-in: playing non-critical dropped, chatter flushed, news kept,
//    playing critical survives
{
  const h = harness();
  h.s.enqueue("n1", "news"); // playing
  h.s.enqueue("ch1", "chatter");
  h.s.enqueue("n2", "news");
  h.s.bargeIn();
  assert(h.stopped.length === 1, "barge-in fades the playing news line");
  assert(h.s.queued === 1, "chatter flushed, news kept");
  h.tick(SPEECH_MIN_GAP_MS + 100);
  h.s.poll();
  assert(h.started[1]?.id === "n2", "kept news plays after the gap");

  const h2 = harness();
  h2.s.enqueue("c1", "critical"); // playing
  h2.s.bargeIn();
  assert(h2.stopped.length === 0, "a playing CRITICAL line survives barge-in");
}

// 7. §1.3 ack rule, end to end: HUD-visible acks carry no speech id;
//    rejections of the same verbs do; other acks still speak
{
  process.env.ELEVENLABS_API_KEY ||= "test-key-so-speech-ids-generate";
  const fakeWs = () => {
    const ws = { sent: [] as any[], readyState: 1, OPEN: 1, send(s: string) { ws.sent.push(JSON.parse(s)); } };
    return ws;
  };
  const ws = fakeWs();
  const match = Match.createPractice(ws as any);
  match.stop(); // drive ticks by hand
  const drive = () => {
    for (const ev of match.sim.tick()) (match as any).routeEvent(ev);
  };

  match.handleUtterance(ws as any, '{"verb":"set_thrust","params":{"percent":50},"acknowledgement":"Half thrust, aye."}');
  drive();
  const ack = ws.sent.find((m) => m.type === "transcript" && m.text === "Half thrust, aye.");
  assert(!!ack && ack.speech === undefined, "set_thrust ack carries no speech id (HUD shows the throttle)");
  assert(ack?.priority === "chatter", "acks are CHATTER");

  match.handleUtterance(ws as any, '{"verb":"set_thrust","params":{"percent":"garble"},"acknowledgement":"Half thrust, aye."}');
  drive();
  const rej = ws.sent.find((m) => m.type === "transcript" && /didn't copy/.test(m.text));
  assert(!!rej && typeof rej.speech === "string", "a set_thrust REJECTION speaks");
  assert(rej?.priority === "news", "rejections are NEWS");

  match.handleUtterance(ws as any, '{"verb":"deploy_decoy","params":{},"acknowledgement":"Decoy away."}');
  drive();
  const decoyAck = ws.sent.find((m) => m.type === "transcript" && m.text === "Decoy away.");
  assert(!!decoyAck && typeof decoyAck.speech === "string", "non-HUD-visible acks still speak");

  match.handleUtterance(ws as any, '{"verb":"set_overlay","params":{"element":"drift","state":"on"}}');
  drive();
  const overlay = ws.sent.find((m) => m.type === "transcript" && /Drift marker|not drifting/.test(m.text));
  assert(!!overlay && overlay.speech === undefined, "set_overlay confirmation is transcript-only");

  // 8. TTS economy: dynamic ack/answer text stays written; the VOICE draws
  //    from the bounded phrasebook. Standing-order readbacks are exempt
  //    (v4.3: the voice states the trigger direction).
  const phrasebookIds = new Set(ACK_SPEAK_LINES.map(speechId));
  assert(
    !!decoyAck && phrasebookIds.has(decoyAck.speech) && !phrasebookIds.has(speechId("Decoy away.")),
    "dynamic ack speaks a phrasebook line, not its freeform text"
  );

  const soAck = "Engines cut when we REACH four hundred, aye.";
  match.handleUtterance(
    ws as any,
    JSON.stringify({
      verb: "set_standing_order",
      params: {
        label: "cut at 400",
        condition: { metric: "own_speed", op: "gte", value: 400 },
        actions: [{ verb: "set_thrust", params: { percent: 0 } }],
        repeat: false,
      },
      acknowledgement: soAck,
    })
  );
  drive();
  const soMsg = ws.sent.find((m) => m.type === "transcript" && m.text === soAck);
  assert(
    !!soMsg && soMsg.speech === speechId(soAck),
    "standing-order readback still speaks verbatim (trigger direction, v4.3)"
  );

  await (match as any).answerQuery((match as any).seats[0].id, "damage report", "damage_report");
  const dmg = ws.sent.find((m) => m.type === "transcript" && /^Hull \d/.test(m.text));
  assert(
    !!dmg && dmg.speech === speechId(QUERY_ANSWER_SPEAK),
    "query answer keeps numbers written and voices the stock pointer line"
  );
}
console.log("done");
