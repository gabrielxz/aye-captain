// Runs every suite sequentially. Each suite logs "ok: ..." per assertion and
// sets process.exitCode = 1 on any failure. Run with: npm test
import "./physics.test.js";
import "./fog.test.js";
import "./translator.test.js";
import "./weapons.test.js";
import "./lock.test.js";
import "./propellant.test.js";
import "./orders.test.js";
import "./zone.test.js";
