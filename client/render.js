// canvas draw loop w/ interpolation, SVG ship sprites, particles
import { state } from "./main.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const COLORS = {
  bg: "#06090d",
  grid: "#0d1520",
  zone: "#2a4a5a",
  hardLimit: "#16222e",
  own: "#2dd4bf",
  enemy: "#fc8181",
  ghost: "#4a5a6a",
};

// Which authored design to fly (candidates in client/assets/):
// "interceptor" | "gunship" | "saucer"
const SHIP_DESIGN = "interceptor";
const SHIP_LEN_M = 60; // true hull length; far below one pixel at map scale
const MIN_SHIP_PX = 22; // legibility clamp: never render smaller than this

// ---------- sprite loading (SVG text -> tinted blob -> Image) ----------

const TINTS = {
  own: { HULL: "#0e3f3a", ACCENT: "#2dd4bf" },
  enemy: { HULL: "#3f1518", ACCENT: "#fc8181" },
  ghost: { HULL: "#141c26", ACCENT: "#4a5a6a" },
};
const sprites = {}; // tint -> Image

fetch(`assets/${SHIP_DESIGN}.svg`)
  .then((r) => r.text())
  .then((svg) => {
    for (const [name, tint] of Object.entries(TINTS)) {
      const tinted = svg.replaceAll("HULL", tint.HULL).replaceAll("ACCENT", tint.ACCENT);
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([tinted], { type: "image/svg+xml" }));
      img.onload = () => (sprites[name] = img);
    }
  })
  .catch(() => {}); // sprite-less fallback triangles still draw

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
  const worldRadius = (state.config?.hardLimitRadius ?? 45000) * 1.05;
  return {
    cx: w / 2,
    cy: h / 2,
    scale: Math.min(w, h) / 2 / worldRadius,
  };
}

// ---------- particles (smoke, explosion debris) ----------

const particles = []; // {x, y, vx, vy, born, life, r0, color}
function spawnParticle(p) {
  if (particles.length > 400) particles.shift();
  particles.push({ born: performance.now(), ...p });
}

function drawParticles(view) {
  const now = performance.now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const t = (now - p.born) / p.life;
    if (t >= 1) {
      particles.splice(i, 1);
      continue;
    }
    const [sx, sy] = worldToScreen(p.x + (p.vx * (now - p.born)) / 1000, p.y + (p.vy * (now - p.born)) / 1000, view);
    ctx.beginPath();
    ctx.arc(sx, sy, p.r0 * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
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
  const maxM = state.config?.hardLimitRadius ?? 45000;
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

// Thrust flare color runs cold amber -> hot blue-white with throttle.
function flareColor(pct) {
  if (pct > 80) return "#cfe8ff";
  if (pct > 45) return "#f6ad55";
  return "#b7791f";
}

function drawShip(view, ent, kind, { ghost = false, thrust = 0, hull = null, hullMax = 100 } = {}) {
  const [sx, sy] = worldToScreen(ent.x, ent.y, view);
  const sizePx = Math.max(MIN_SHIP_PX, SHIP_LEN_M * view.scale);
  const r = sizePx / 2;
  const rad = ((ent.facing ?? 0) * Math.PI) / 180;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(rad); // canvas rotate is clockwise, matching compass headings

  // thrust flare scaled to output %, behind the ship
  if (!ghost && thrust > 0) {
    const flare = r * (0.5 + (thrust / 100) * 1.6);
    const grad = ctx.createLinearGradient(0, r * 0.8, 0, r * 0.8 + flare);
    grad.addColorStop(0, flareColor(thrust));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.moveTo(-r * 0.28, r * 0.8);
    ctx.lineTo(0, r * 0.8 + flare);
    ctx.lineTo(r * 0.28, r * 0.8);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const img = sprites[ghost ? "ghost" : kind];
  if (img) {
    if (ghost) ctx.globalAlpha = 0.55;
    ctx.drawImage(img, -r, -r, sizePx, sizePx);
    ctx.globalAlpha = 1;
  } else {
    // fallback triangle while the sprite loads
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.7, r);
    ctx.lineTo(-r * 0.7, r);
    ctx.closePath();
    ctx.strokeStyle = ghost ? COLORS.ghost : COLORS[kind];
    ctx.lineWidth = ghost ? 1 : 1.5;
    if (ghost) ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // battle damage: smoke trail below 50% hull, heavier below 25%
  // (hull numbers live in the HUD panel, not floating on the map)
  if (!ghost && hull !== null && hull / hullMax < 0.5) {
    const heavy = hull / hullMax < 0.25;
    if (Math.random() < (heavy ? 0.5 : 0.2)) {
      spawnParticle({
        x: ent.x + (Math.random() - 0.5) * 300,
        y: ent.y + (Math.random() - 0.5) * 300,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 120,
        life: 1600,
        r0: heavy ? 4 : 2.5,
        color: heavy ? "#6b5747" : "#556270",
      });
    }
  }
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

  drawParticles(view);
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

    drawShip(view, you, "own", {
      thrust: state.lastSnap.you.thrustOut ?? state.lastSnap.you.thrust,
      hull: state.lastSnap.you.hull,
      hullMax: 100,
    });
  }

  drawEnemy(view);
}

function drawEnemy(view) {
  const last = state.lastSnap?.enemy;
  if (!last) return;

  if (last.visible) {
    // Interpolate only across consecutive visible snapshots.
    const ent = interpolate((s) => (s.enemy?.visible ? s.enemy : null));
    if (ent) {
      drawShip(view, ent, "enemy", {
        hull: last.hull ?? null,
        hullMax: last.hullMax ?? 100,
      });
    }
    return;
  }

  if (last.lastKnown) {
    const ghost = last.lastKnown;
    drawShip(view, ghost, "enemy", { ghost: true });
    const [sx, sy] = worldToScreen(ghost.x, ghost.y, view);
    const age = Math.max(0, state.lastSnap.tick - ghost.t);
    ctx.fillStyle = COLORS.ghost;
    ctx.font = "10px monospace";
    ctx.fillText(`last seen ${age}s ago`, sx + 14, sy + 4);
  }
}

// Interpolate an entity out of a per-snapshot array, matched by id.
function interpolateById(listKey, id) {
  return interpolate((s) => (s[listKey] ?? []).find((e) => e.id === id) ?? null);
}

function drawOrdnance(view) {
  if (!state.lastSnap) return;

  // missiles: small but loud — glow, hot dot, engine trail
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
    const grad = ctx.createLinearGradient(tx, ty, sx, sy);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, color);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.stroke();
    // glow halo
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    // hot core
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // decoys: pulsing hollow diamonds
  const pulse = 4.2 + Math.sin(performance.now() / 180) * 1.6;
  for (const d of state.lastSnap.decoys ?? []) {
    const ent = interpolateById("decoys", d.id);
    if (!ent) continue;
    const [sx, sy] = worldToScreen(ent.x, ent.y, view);
    const r = pulse;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx, sy + r);
    ctx.lineTo(sx - r, sy);
    ctx.closePath();
    ctx.strokeStyle = d.own ? COLORS.own : COLORS.enemy;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 180));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const LASER_FX_MS = 300;
const BOOM_FX_MS = 700;
const BIG_BOOM_FX_MS = 1600;

function drawFx(view) {
  const now = performance.now();
  state.fxBuffer = state.fxBuffer.filter(({ fx, at }) => {
    const ttl = fx.type === "laser" ? LASER_FX_MS : fx.big ? BIG_BOOM_FX_MS : BOOM_FX_MS;
    return now - at < ttl;
  });
  for (const entry of state.fxBuffer) {
    const { fx, at } = entry;
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
      const ttl = fx.big ? BIG_BOOM_FX_MS : BOOM_FX_MS;
      const t = age / ttl;
      const [sx, sy] = worldToScreen(fx.x, fx.y, view);
      const maxR = fx.big ? 46 : 18;
      // flash core
      if (t < 0.25) {
        ctx.beginPath();
        ctx.arc(sx, sy, (fx.big ? 14 : 6) * (1 - t * 3), 0, Math.PI * 2);
        ctx.fillStyle = "#fff7e0";
        ctx.globalAlpha = 1 - t * 3.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // expanding rings
      ctx.beginPath();
      ctx.arc(sx, sy, 3 + t * maxR, 0, Math.PI * 2);
      ctx.strokeStyle = "#f6ad55";
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = fx.big ? 2.5 : 1.5;
      ctx.stroke();
      if (fx.big) {
        ctx.beginPath();
        ctx.arc(sx, sy, 2 + t * maxR * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = "#fc8181";
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // debris sparks, once at birth
      if (!entry.sparked) {
        entry.sparked = true;
        const n = fx.big ? 14 : 5;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 150 + Math.random() * (fx.big ? 700 : 350);
          spawnParticle({
            x: fx.x,
            y: fx.y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            life: 500 + Math.random() * (fx.big ? 900 : 400),
            r0: fx.big ? 2.4 : 1.6,
            color: Math.random() < 0.5 ? "#f6ad55" : "#fc8181",
          });
        }
      }
    }
  }
}

// Big terminal explosion at a world position (used on game over).
export function bigBoomAt(x, y) {
  state.fxBuffer.push({ fx: { type: "boom", big: true, x, y }, at: performance.now() });
}

export function startRenderLoop() {
  resize();
  function frame() {
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
