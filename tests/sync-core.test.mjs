// Gate for the NanoCanvas live-sync modules that ship with oxView (ts/sync/*.js are classic scripts that publish
// globalThis.NCSyncCore / NCSyncOx).  Loads them the way index.html does (one shared global scope), then drives an
// OxEngine over a tiny in-memory scene through snapshot -> remote delta -> local edit -> id-map checks.
// The full two-sided fuzz lives in the NanoCanvas repo (cadnano-app/scripts/diagnostics/sync-idmap-harness.mjs).
//   node tests/sync-core.test.mjs
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = vm.createContext({ console, setTimeout, clearTimeout, queueMicrotask, structuredClone });
ctx.globalThis = ctx;
for (const f of ["ts/sync/ncsync_core.js", "ts/sync/ncsync_ox.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const core = ctx.NCSyncCore, ox = ctx.NCSyncOx;
let failed = 0;
const ok = (name, c) => { console.log((c ? "ok   - " : "FAIL - ") + name); if (!c) failed++; };

ok("modules publish their globals", !!core && !!ox && typeof ox.OxEngine === "function");

// minimal scene
const el = new Map(); let counter = 0;
const scene = {
  forEachNt(cb) { for (const e of el.values()) cb(e.id, e.n3, e.b, e.c, e.g); }, has: (id) => el.has(id), n3Of: (id) => (el.get(id) ? el.get(id).n3 : -1), n5Of: (id) => (el.get(id) ? el.get(id).n5 : -1),
  poseOf: () => [0, 0, 0, 1, 0, 0, 0, 0, 1], clusterOf: (id) => el.get(id).g,
  createNts(specs, links) { const ids = specs.map((s) => { const id = counter++; el.set(id, { id, n3: -1, n5: -1, b: s.b, c: s.c, g: s.g }); return id; }); if (links) links.forEach((t, i) => { if (t >= 0) { el.get(ids[i]).n3 = ids[t]; el.get(ids[t]).n5 = ids[i]; } }); return ids; },
  link(a, b) { el.get(a).n3 = b; el.get(b).n5 = a; }, unlink(a) { const e = el.get(a); if (e.n3 >= 0) { el.get(e.n3).n5 = -1; e.n3 = -1; } },
  remove(ids) { for (const id of ids) { const e = el.get(id); if (e.n3 >= 0) el.get(e.n3).n5 = -1; if (e.n5 >= 0) el.get(e.n5).n3 = -1; el.delete(id); if (counter === id + 1) counter = id; } },
  setBase(id, ch) { el.get(id).b = ch; }, setColor(id, c) { el.get(id).c = c; }, setPoses() {}, applyRigid() {}, clearAll() { el.clear(); counter = 0; }, setPair() {}, finishLoad() {},
  loadBulk(ch) { const ids = []; for (let i = 0; i < ch.n; i++) ids.push(scene.createNts([{ b: String.fromCharCode(ch.b[i]), c: ch.c[i], g: ch.g[i] }])[0]); for (let i = 0; i + 1 < ch.n; i++) if (ch.chainStart[i + 1] === 0) scene.link(ids[i], ids[i + 1]); return ids; },
};
const [a, b] = core.loopbackPair({ sync: true });
const engine = new ox.OxEngine(scene, { syncSched: true });
const peer = new core.Peer({ role: "secondary", transport: b, handlers: engine.handlers() });
engine.attach(peer);
const prim = new core.Peer({ role: "primary", transport: a, handlers: { applyRemote: () => ({ ok: true }), snapshotFor: () => ({}) } });

// snapshot of one 4-nt oligo
a.send({ t: "snap-begin", id: 1, total: 4, rev: 0, meta: { registry: null } });
a.send({ t: "snap-chunk", id: 1, nids: ["0:0:scaf", "0:1:scaf", "0:2:scaf", "0:3:scaf"], cs: Uint8Array.of(1, 0, 0, 0), f: new Float32Array(36), b: Uint8Array.from("ACGT", (c) => c.charCodeAt(0)), c: Int32Array.of(-1, -1, -1, -1), g: Int32Array.of(1, 1, 1, 1) });
a.send({ t: "snap-end", id: 1, rev: 0 });
ok("snapshot loads 4 nts, id map bijective", el.size === 4 && engine.idmap.size === 4 && engine.verify().length === 0);
ok("chain is one oligo head->tail", core.chainsFromRecs(engine.css()).length === 1);

// local nick -> delta to the primary with one n3 clear
let got = null; prim.h.applyRemote = (d) => { got = d; return { ok: true }; };
const id1 = engine.idmap.idOf("0:1:scaf"); scene.unlink(id1); engine.markDirty();
ok("local nick becomes n3.clr of that NID", !!got && got.n3.clr.length === 1 && got.n3.clr[0] === "0:1:scaf");

// remote delta: delete + undo-style re-creation keeps the NID
prim.sendDelta({ del: ["0:3:scaf"], n3: { clr: ["0:2:scaf"], set: [] } });
ok("remote delete removes the element and unmaps the NID", el.size === 3 && engine.idmap.idOf("0:3:scaf") === undefined && engine.verify().length === 0);
const recycled = scene.createNts([{ b: "A", c: -1, g: 1 }])[0]; engine.markDirty();
ok("a recycled element id is a NEW overlay NID, never the old one", engine.idmap.nidOf(recycled) !== "0:3:scaf" && engine.idmap.nidOf(recycled) !== undefined);
ok("id map still bijective", engine.verify().length === 0);
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
