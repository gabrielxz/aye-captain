// v5.1 §6: the archetype select screen. v5 policy makes archetypes differ
// in NUMBERS ONLY — there is no ability to learn by flying, so the stat
// line IS the identity and this screen is the only place it is ever
// communicated. Stats arrive in the hello config (server constants are the
// source of truth); this module only draws them.
//
// Used by BOTH flows: the room lobby's archetype pick and the practice
// setup (own ship + sparring drone).

const ARCH_META = {
  corvette: {
    design: "interceptor",
    size: 54,
    doctrine:
      "The knife. Quickest hull, dimmest drive, the best sensors in the game, six decoys to spend. Light armor, and no railgun off the rack — you can take a hit, not a beating. Pick the moment, strike, be gone.",
  },
  frigate: {
    design: "saucer",
    size: 66,
    doctrine: "Railgun and torpedoes. The only ship that can trade and mean it.",
  },
  cruiser: {
    design: "gunship",
    size: 82,
    doctrine:
      "You are loud and you are slow and they will hear you coming. Make them regret arriving.",
  },
};

// Signature first and visually weighted (§6.2): detection is the whole
// game, and a player who doesn't understand that a Cruiser is LOUD does
// not understand the Cruiser.
const STAT_ROWS = [
  { key: "sigBase", label: "SIGNATURE", fmt: (v) => `${v}`, sig: true },
  { key: "hull", label: "HULL", fmt: (v) => `${v}` },
  { key: "accel", label: "ACCEL", fmt: (v) => `${v}` },
  { key: "turn", label: "TURN", fmt: (v) => `${v}°/s` },
  { key: "sensorBase", label: "SENSORS", fmt: (v) => `${Math.round(v / 1000)} km` },
];

// own-ship tint, matching the map (render.js TINTS.own)
const TINT = { HULL: "#0e3f3a", ACCENT: "#2dd4bf" };
const spriteUrls = new Map(); // design -> Promise<objectURL>

function spriteUrl(design) {
  if (!spriteUrls.has(design)) {
    spriteUrls.set(
      design,
      fetch(`assets/${design}.svg`)
        .then((r) => r.text())
        .then((svg) =>
          URL.createObjectURL(
            new Blob([svg.replaceAll("HULL", TINT.HULL).replaceAll("ACCENT", TINT.ACCENT)], {
              type: "image/svg+xml",
            })
          )
        )
        .catch(() => null)
    );
  }
  return spriteUrls.get(design);
}

// Render the three cards into `container`. `selected` marks the active
// card; `onPick(arch)` fires on click. Re-callable: rebuilds cheaply.
export function buildShipSelect(container, { archetypes, selected, onPick }) {
  container.innerHTML = "";
  if (!archetypes) return;
  const maxOf = {};
  for (const row of STAT_ROWS) {
    maxOf[row.key] = Math.max(...Object.values(archetypes).map((a) => a[row.key] ?? 0));
  }
  for (const [arch, meta] of Object.entries(ARCH_META)) {
    const stats = archetypes[arch];
    if (!stats) continue;
    const card = document.createElement("div");
    card.className = `arch-card${selected === arch ? " active" : ""}`;
    card.dataset.arch = arch;

    const stage = document.createElement("div");
    stage.className = "hull"; // fixed-height stage keeps the three cards aligned
    const img = document.createElement("img");
    img.alt = arch;
    img.style.height = `${meta.size}px`; // mass hierarchy: cruiser draws biggest
    void spriteUrl(meta.design).then((url) => {
      if (url) img.src = url;
    });
    stage.appendChild(img);
    card.appendChild(stage);

    const h = document.createElement("h3");
    h.textContent = arch.toUpperCase();
    card.appendChild(h);

    const doc = document.createElement("div");
    doc.className = "doctrine";
    doc.textContent = meta.doctrine;
    card.appendChild(doc);

    for (const row of STAT_ROWS) {
      const div = document.createElement("div");
      div.className = `stat${row.sig ? " sig" : ""}`;
      const label = document.createElement("span");
      label.textContent = row.label;
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("i");
      fill.style.width = `${Math.round(((stats[row.key] ?? 0) / maxOf[row.key]) * 100)}%`;
      bar.appendChild(fill);
      const val = document.createElement("span");
      val.textContent = row.fmt(stats[row.key]);
      div.append(label, bar, val);
      card.appendChild(div);
    }

    // §6.2 armament. This is the STARTING loadout, and the note says so: an
    // archetype is a starting HULL, not a permanent class. Any hull can mount
    // a salvaged rail — tests/loadout.test.ts pins a corvette doing exactly
    // that ("that is a build; let it hurt"), and RAIL_SLUGS_LOOTED exists only
    // to serve it. "NO RAILGUN" as a bare identity claim was a lie from the
    // day the Loadout patch shipped.
    const arm = document.createElement("div");
    arm.className = "armament";
    const rail = document.createElement("div");
    if (stats.railguns === 0) {
      rail.className = "headline";
      rail.textContent = "NO RAILGUN";
    } else {
      rail.textContent = `RAILGUN · ${stats.railSlugs} slugs`;
    }
    const rest = document.createElement("div");
    rest.textContent = `${stats.tubes}× tube · ${stats.magazine} missiles · PDC ${stats.pdcAmmoS}s · ${stats.decoys} decoys · ${stats.probes} probes`;
    const note = document.createElement("div");
    note.className = "starting";
    note.textContent = "Starting loadout — any hull can mount what it salvages.";
    arm.append(rail, rest, note);
    card.appendChild(arm);

    card.addEventListener("click", () => onPick(arch));
    container.appendChild(card);
  }
}
