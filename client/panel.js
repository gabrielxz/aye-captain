// panel.js — paints the side panel from each snapshot. All derivation
// lives in panel-model.js (pure, fog-tested); this file only touches DOM.
// The lamp grid is FIXED — ten lamps, one address each, built once: states
// light in place and nothing ever reflows (the design's law).
import { buildPanel } from "./panel-model.js";
import { send, state } from "./main.js";

const $ = (id) => document.getElementById(id);
const CLS_COLOR = { good: "var(--accent)", warn: "var(--warn)", alert: "var(--danger)", "": "var(--dim)" };

let lampEls = null; // built on first update
let ordersKey = ""; // rebuild the orders list only when it changes

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
function setCls(el, base, cls) {
  const want = cls ? `${base} pv-${cls}` : base;
  if (el.className !== want) el.className = want;
}

function buildLampGrid(lamps) {
  const grid = $("p-lamps");
  grid.innerHTML = "";
  lampEls = new Map();
  for (const l of lamps) {
    const div = document.createElement("div");
    div.className = "lamp";
    const name = document.createElement("span");
    name.textContent = l.label;
    const val = document.createElement("span");
    div.appendChild(name);
    div.appendChild(val);
    grid.appendChild(div);
    lampEls.set(l.key, { div, val });
  }
}

function paintLamps(lamps) {
  if (!lampEls) buildLampGrid(lamps);
  for (const l of lamps) {
    const el = lampEls.get(l.key);
    if (!el) continue;
    setText(el.val, l.value);
    const want = `lamp${l.state !== "off" ? ` ${l.state}` : ""}${l.blink ? " blink" : ""}`;
    if (el.div.className !== want) el.div.className = want;
  }
}

// standing-order × — the one panel control that issues a command. It rides
// the existing raw-JSON utterance path (same validated pipeline as typed
// commands; the ack/reject event is the ground truth, invariant 4).
function cancelOrder(label) {
  send({
    type: "utterance",
    text: JSON.stringify([
      {
        verb: "set_standing_order",
        params: { cancel_label: label },
        acknowledgement: `Standing order "${label}" belayed.`,
      },
    ]),
    source: "typed",
  });
}

function paintOrders(orders) {
  const box = $("p-orders");
  const key = orders.map((o) => `${o.label}|${o.repeat}|${o.armed}`).join("§");
  if (key === ordersKey) return;
  ordersKey = key;
  box.innerHTML = "";
  if (orders.length === 0) {
    const none = document.createElement("span");
    none.className = "none";
    none.textContent = "none";
    box.appendChild(none);
    return;
  }
  orders.forEach((o, i) => {
    const row = document.createElement("div");
    row.className = "order";
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(i + 1);
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = `${o.label}${o.repeat ? " *" : ""}`;
    row.appendChild(idx);
    row.appendChild(lbl);
    if (!o.armed) {
      const st = document.createElement("span");
      st.className = "state";
      st.textContent = "cooling";
      row.appendChild(st);
    }
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = `belay "${o.label}"`;
    x.addEventListener("click", () => cancelOrder(o.label));
    row.appendChild(x);
    box.appendChild(row);
  });
}

export function updatePanel(snap) {
  const model = buildPanel(snap, {
    practice: state.practice,
    team: state.team,
    salvageRangeM: state.config?.salvageApproachRangeM,
  });
  if (!model) return;

  // referee spectator: hull list instead of the captain panel
  const specEl = $("p-spec");
  const captEl = $("p-captain");
  if (model.spectator) {
    captEl.style.display = "none";
    specEl.style.display = "";
    specEl.innerHTML = "";
    for (const s of model.spectator) {
      const row = document.createElement("div");
      row.className = "srow";
      const name = document.createElement("span");
      name.textContent = s.label;
      const hull = document.createElement("span");
      hull.textContent = s.text;
      hull.style.color = CLS_COLOR[s.cls];
      row.appendChild(name);
      row.appendChild(hull);
      specEl.appendChild(row);
    }
    return;
  }
  captEl.style.display = "";
  specEl.style.display = "none";

  // identity
  setText($("p-callsign"), model.identity.callsign);
  setText($("p-arch"), model.identity.archetype ? ` · ${model.identity.archetype}` : "");
  setText($("p-context"), model.identity.context);

  // teammate strip (transponder data only)
  const alliesEl = $("p-allies");
  alliesEl.innerHTML = "";
  for (const a of model.allies) {
    const row = document.createElement("div");
    row.className = "ally";
    const cs = document.createElement("span");
    cs.className = "cs";
    cs.textContent = `◈ ${a.callsign}`;
    const hull = document.createElement("span");
    hull.textContent = `hull ${a.hullPct}%`;
    hull.style.color = CLS_COLOR[a.hullCls === "good" ? "" : a.hullCls];
    const sig = document.createElement("span");
    sig.textContent = `SIG ${a.sig}${a.louder ? " ▲" : ""}`;
    sig.style.color = a.louder ? "var(--warn)" : "#7ab0e0";
    if (a.louder) sig.style.fontWeight = "600";
    const range = document.createElement("span");
    range.className = "range";
    range.textContent = `prop ${a.prop} · ${a.km} km brg ${a.brg}`;
    row.appendChild(cs);
    row.appendChild(hull);
    row.appendChild(sig);
    row.appendChild(range);
    alliesEl.appendChild(row);
  }

  // hero
  setText($("p-speed"), model.hero.speed);
  setCls($("p-herosub"), "psub", model.hero.subCls);
  setText($("p-herosub"), model.hero.sub);
  const hullEl = $("p-hull");
  setText(hullEl, String(model.hero.hull));
  hullEl.style.color = CLS_COLOR[model.hero.hullCls];
  const hb = $("p-hullbar");
  hb.style.width = `${model.hero.hullPct}%`;
  setCls(hb, "", model.hero.hullCls === "good" ? "" : model.hero.hullCls);

  // vitals: propellant dial + signature + mission
  const deg = Math.round(3.6 * Math.max(0, Math.min(100, model.prop.pct)));
  $("p-dial").style.background =
    `conic-gradient(${CLS_COLOR[model.prop.cls]} 0deg ${deg}deg, var(--sub-line) 0)`;
  const propEl = $("p-prop");
  setText(propEl, String(model.prop.value));
  propEl.style.color = CLS_COLOR[model.prop.cls];
  const modeEl = $("p-prop-mode");
  setText(modeEl, `PROP${model.prop.mode ? ` ${model.prop.mode}` : ""}`);
  modeEl.style.color = model.prop.mode === "⟳" ? "var(--accent)" : "var(--dim)";
  const sigEl = $("p-sig");
  setText(sigEl, `${model.sig.value} · ${model.sig.word}`);
  sigEl.style.color = CLS_COLOR[model.sig.cls];

  const mw = $("p-mission-wrap");
  if (model.mission) {
    mw.style.display = "";
    const m = $("p-mission");
    setText(m, model.mission.text);
    m.className = `${model.mission.cls === "alert" ? "alert " : ""}pv-${model.mission.cls}${model.mission.blink ? " blink" : ""}`;
    const sub = $("p-mission-sub");
    sub.innerHTML = "";
    for (const line of model.mission.sub) {
      const d = document.createElement("div");
      d.textContent = line.text;
      if (line.cls) d.style.color = CLS_COLOR[line.cls];
      if (line.blink) d.className = "blink";
      sub.appendChild(d);
    }
  } else {
    mw.style.display = "none";
  }

  paintLamps(model.lamps);

  // contacts (v4.7.2: the tier vocabulary anchor)
  const cEl = $("p-contacts");
  cEl.innerHTML = "";
  for (const c of model.contacts) {
    const span = document.createElement("span");
    span.textContent = c.text;
    if (c.cls) span.style.color = CLS_COLOR[c.cls];
    cEl.appendChild(span);
  }

  // posture (display of the ship's actual state — orders still go by voice)
  for (const seg of $("p-discipline").children) {
    const on = seg.dataset.d === model.posture.discipline;
    seg.className = on ? `on${model.posture.cls === "alert" ? " pv-alert" : ""}` : "";
  }
  const pdcEl = $("p-pdc-posture");
  setText(pdcEl, model.posture.pdc);
  pdcEl.style.color = CLS_COLOR[model.posture.pdcCls];

  // armament
  setText($("p-msl"), String(model.arm.missiles));
  const tubesEl = $("p-tubes");
  tubesEl.innerHTML = "";
  for (const t of model.arm.tubes) {
    const chip = document.createElement("span");
    setCls(chip, "p-chip", t.cls);
    chip.textContent = t.text;
    if (t.cls) chip.style.color = CLS_COLOR[t.cls];
    tubesEl.appendChild(chip);
  }
  const railN = $("p-rail-n");
  const railChip = $("p-rail");
  if (model.arm.rail) {
    setText(railN, String(model.arm.rail.n));
    setCls(railChip, "p-chip", model.arm.rail.cls);
    railChip.textContent = model.arm.rail.text;
    railChip.style.color = CLS_COLOR[model.arm.rail.cls];
  } else {
    setText(railN, "—");
    setCls(railChip, "p-chip", "");
    railChip.textContent = "not fitted";
    railChip.style.color = "";
  }
  const miscEl = $("p-arm-misc");
  miscEl.innerHTML = "";
  for (const m of model.arm.misc) {
    const span = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = m.value;
    if (m.cls) b.style.color = CLS_COLOR[m.cls];
    span.appendChild(document.createTextNode(`${m.label} `));
    span.appendChild(b);
    miscEl.appendChild(span);
  }

  // campaign-only sections
  $("p-reactor").style.display = model.mission ? "" : "none";
  const holdSec = $("p-hold-sec");
  if (model.hold !== null) {
    holdSec.style.display = "";
    const holdEl = $("p-hold");
    const text = model.hold.length > 0 ? model.hold.join(" · ") : "";
    holdEl.innerHTML = "";
    if (text) {
      holdEl.textContent = text;
    } else {
      const none = document.createElement("span");
      none.className = "none";
      none.textContent = "nothing yet";
      holdEl.appendChild(none);
    }
  } else {
    holdSec.style.display = "none";
  }

  paintOrders(model.orders);
}
