// canvas draw loop w/ interpolation
import { state } from "./main.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const COLORS = {
  bg: "#06090d",
  grid: "#0d1520",
  zone: "#2a4a5a",
  hardLimit: "#16222e",
  own: "#4fd1c5",
  ownFlare: "#f6ad55",
  enemy: "#fc8181",
  ghost: "#4a5a6a",
};

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);

// ---------- interpolation helpers ----------

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// shortest-arc angle interpolation
function lerpAngle(a, b, t) {
  const diff = ((b - a + 540) % 360) - 180;
  return a + diff * t;
}

// Interpolation factor between the last two snapshots at this frame.
function interpAlpha() {
  if (!state.prevSnap || !state.lastSnap) return 1;
  const elapsed = performance.now() - state.lastSnapAt;
  return Math.min(1, elapsed / state.snapIntervalMs);
}

// Interpolated {x, y, facing} for an entity present in both snapshots.
// pick(snap) must return the entity or null.
function interpolate(pick) {
  const last = state.lastSnap && pick(state.lastSnap);
  if (!last) return null;
  const prev = state.prevSnap && pick(state.prevSnap);
  if (!prev) return { ...last };
  const t = interpAlpha();
  return {
    ...last,
    x: lerp(prev.x, last.x, t),
    y: lerp(prev.y, last.y, t),
    facing: lerpAngle(prev.facing ?? 0, last.facing ?? 0, t),
  };
}

// ---------- world/screen ----------

// World: origin at zone center, +y = north (up on screen), meters.
// Camera: fixed at origin, scaled so the hard-limit ring fits with margin.
function worldToScreen(x, y, view) {
  return [view.cx + x * view.scale, view.cy - y * view.scale];
}

function makeView() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const worldRadius = (state.config?.hardLimitRadius ?? 30000) * 1.08;
  return {
    cx: w / 2,
    cy: h / 2,
    scale: Math.min(w, h) / 2 / worldRadius,
  };
}

// ---------- draw primitives ----------

function drawRing(view, radiusM, color, width = 1, dash = []) {
  const [sx, sy] = worldToScreen(0, 0, view);
  ctx.beginPath();
  ctx.arc(sx, sy, radiusM * view.scale, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGrid(view) {
  const stepM = 5000;
  const maxM = state.config?.hardLimitRadius ?? 30000;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let m = -maxM; m <= maxM; m += stepM) {
    const [x1, y1] = worldToScreen(m, -maxM, view);
    const [x2, y2] = worldToScreen(m, maxM, view);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    const [x3, y3] = worldToScreen(-maxM, m, view);
    const [x4, y4] = worldToScreen(maxM, m, view);
    ctx.moveTo(x3, y3);
    ctx.lineTo(x4, y4);
  }
  ctx.stroke();
}

// Triangle rotated to facing = the ship's orientation indicator.
function drawShip(view, ent, color, { ghost = false, thrust = 0 } = {}) {
  const [sx, sy] = worldToScreen(ent.x, ent.y, view);
  const r = 8;
  const rad = ((ent.facing ?? 0) * Math.PI) / 180;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(rad); // canvas rotate is clockwise, matching compass headings

  // thrust flare scaled to thrust %, behind the ship
  if (!ghost && thrust > 0) {
    const flare = 6 + (thrust / 100) * 14;
    ctx.beginPath();
    ctx.moveTo(-3, r * 0.9);
    ctx.lineTo(0, r * 0.9 + flare);
    ctx.lineTo(3, r * 0.9);
    ctx.strokeStyle = COLORS.ownFlare;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.moveTo(0, -r); // nose (pointing at facing)
  ctx.lineTo(r * 0.7, r);
  ctx.lineTo(-r * 0.7, r);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = ghost ? 1 : 1.5;
  if (ghost) ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ---------- main draw ----------

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  const view = makeView();
  drawGrid(view);
  if (state.config) {
    drawRing(view, state.config.zoneRadius, COLORS.zone, 1.25);
    drawRing(view, state.config.hardLimitRadius, COLORS.hardLimit, 1, [4, 6]);
  }

  drawFx(view);

  drawOrdnance(view);

  const you = interpolate((s) => s.you);
  if (you) {
    // own sensor bubble
    ctx.save();
    const [sx, sy] = worldToScreen(you.x, you.y, view);
    ctx.beginPath();
    ctx.arc(sx, sy, (state.lastSnap.you.sensorRange ?? 0) * view.scale, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.own;
    ctx.globalAlpha = 0.12;
    ctx.stroke();
    ctx.restore();

    drawShip(view, you, COLORS.own, { thrust: state.lastSnap.you.thrust });
  }

  drawEnemy(view);
}

function drawEnemy(view) {
  const last = state.lastSnap?.enemy;
  if (!last) return;

  if (last.visible) {
    // Interpolate only across consecutive visible snapshots.
    const ent = interpolate((s) => (s.enemy?.visible ? s.enemy : null));
    if (ent) drawShip(view, ent, COLORS.enemy);
    return;
  }

  if (last.lastKnown) {
    const ghost = last.lastKnown;
    drawShip(view, ghost, COLORS.ghost, { ghost: true });
    const [sx, sy] = worldToScreen(ghost.x, ghost.y, view);
    const age = Math.max(0, state.lastSnap.tick - ghost.t);
    ctx.fillStyle = COLORS.ghost;
    ctx.font = "10px monospace";
    ctx.fillText(`last seen ${age}s ago`, sx + 12, sy + 4);
  }
}

// Interpolate an entity out of a per-snapshot array, matched by id.
function interpolateById(listKey, id) {
  return interpolate((s) => (s[listKey] ?? []).find((e) => e.id === id) ?? null);
}

function drawOrdnance(view) {
  if (!state.lastSnap) return;

  // missiles: small dots with short velocity trails
  for (const m of state.lastSnap.missiles ?? []) {
    const ent = interpolateById("missiles", m.id);
    if (!ent) continue;
    const [sx, sy] = worldToScreen(ent.x, ent.y, view);
    const color = m.own ? COLORS.own : COLORS.enemy;
    const speed = Math.hypot(m.vx, m.vy) || 1;
    const trailM = speed * 2.5; // ~2.5s of travel
    const [tx, ty] = worldToScreen(
      ent.x - (m.vx / speed) * trailM,
      ent.y - (m.vy / speed) * trailM,
      view
    );
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // decoys: distinct hollow diamond markers
  for (const d of state.lastSnap.decoys ?? []) {
    const ent = interpolateById("decoys", d.id);
    if (!ent) continue;
    const [sx, sy] = worldToScreen(ent.x, ent.y, view);
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx, sy + r);
    ctx.lineTo(sx - r, sy);
    ctx.closePath();
    ctx.strokeStyle = d.own ? COLORS.own : COLORS.enemy;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const LASER_FX_MS = 300;
const BOOM_FX_MS = 600;

function drawFx(view) {
  const now = performance.now();
  state.fxBuffer = state.fxBuffer.filter(({ fx, at }) => {
    const age = now - at;
    return age < (fx.type === "laser" ? LASER_FX_MS : BOOM_FX_MS);
  });
  for (const { fx, at } of state.fxBuffer) {
    const age = now - at;
    if (fx.type === "laser") {
      const alpha = 1 - age / LASER_FX_MS;
      const [x1, y1] = worldToScreen(fx.x1, fx.y1, view);
      const [x2, y2] = worldToScreen(fx.x2, fx.y2, view);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = fx.hit ? "#ff6666" : "#7a6a55";
      ctx.globalAlpha = alpha * (fx.hit ? 1 : 0.4);
      ctx.lineWidth = fx.hit ? 2.5 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (fx.type === "boom") {
      const t = age / BOOM_FX_MS;
      const [sx, sy] = worldToScreen(fx.x, fx.y, view);
      ctx.beginPath();
      ctx.arc(sx, sy, 3 + t * 14, 0, Math.PI * 2);
      ctx.strokeStyle = "#f6ad55";
      ctx.globalAlpha = 1 - t;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

export function startRenderLoop() {
  resize();
  function frame() {
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
