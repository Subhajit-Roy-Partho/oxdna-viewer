/**
 * ncsync_ox.js -- oxView-side sync engine, written against an ABSTRACT scene so that the very same
 * logic runs (a) in the browser on top of oxView's globals (ts/sync/ox_sync.ts provides the scene
 * adapter) and (b) in node on a mock scene for the fuzz/convergence harness.
 *
 * Abstract scene (all ids are oxView element ids, numbers; -1 = none):
 *   forEachNt(cb)                 cb(id, n3Id, base, colour|-1, clusterId)  (read every nucleotide)
 *   n3Of(id) n5Of(id) has(id)     topology queries
 *   poseOf(id) -> [p3,a1_3,a3_3]  (9 floats)           clusterOf(id), clusterSize(g)
 *   createNts(specs) -> ids[]     specs [{b,c,g,pose:[9]}], each a free 1-nt strand
 *   link(a,b) unlink(a)           a.n3 = b  /  cut between a and a.n3   (silent, no history)
 *   remove(ids)  setBase(id,ch)  setColor(id,int)  setPoses(ids, Float32Array)  applyRigid(g, R, t)
 *   loadBulk(chunk) -> ids[]      chain-ordered chunk {n, chainStart:Uint8Array(1=start,2=circular start), f, b, c, g}
 *   clearAll()  setPair(a,b)  finishLoad()
 * The scene calls engine.markDirty() / engine.onRigid(g, X) / engine.onMoved(ids) from its edit hooks
 * (never while engine.applying is true).
 */
(function (root, factory) {
  root.NCSyncOx = factory(root.NCSyncCore); // ncsync_core.js must be loaded first
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (core) {
  "use strict";
  const { nid, rec, recEq, Css, DeltaBuilder, applyDeltaToShadow, deltaNids, deltaIsEmpty, IdMap, OligoRegistry, rigid, frameScheduler, repairDelta } = core;
  const ACTOR = "x"; // overlay actor tag for oxView-created cells

  class OxEngine {
    constructor(scene, opts) {
      opts = opts || {};
      this.scene = scene; this.idmap = new IdMap(); this.shadow = new Css(); this.registry = new OligoRegistry();
      this.peer = null; this.applying = false; this.attached = false; this.now = opts.now || (() => Date.now());
      this.pendingRigid = new Map(); this.moved = new Set(); this.firstDirtyAt = 0; this.fullDirty = false; this.touchIds = new Set(); this.flushMs = []; this.flushMs = [];
      this.sched = frameScheduler(() => this.sendLocal(), { sync: !!opts.syncSched, ...(opts.schedOpts || {}) });
      this.events = []; this.onStatus = opts.onStatus || (() => {}); this.rejections = [];
      this.bulk = null;
      // oxView's undo of a delete re-creates the nucleotide under its OLD element id; remember who lived there so that
      // identity (the NID) is restored instead of minting an overlay NID for what is the same nucleotide.
      this.tomb = new Map();
    }
    attach(peer) { this.peer = peer; }
    // ------------------------------------------------------------ hooks ---
    /** topology / base / colour may have changed: next flush re-projects the scene (O(nts), ~1-3 ms at 30k) */
    markDirty(ids) {
      if (this.applying || !this.attached) return;
      // with the ids the hook touched we re-project only those (+ their neighbours, resolved by the caller); without: full scan
      if (ids && ids.length) { for (const i of ids) this.touchIds.add(i); } else this.fullDirty = true;
      this._kick();
    }
    _kick() { if (!this.firstDirtyAt) this.firstDirtyAt = this.now(); this.sched.schedule(); }
    /** pose-only changes (cluster drags) skip the O(nts) scan: at drag rates that would dominate the frame */
    onRigid(g, X) { if (this.applying || !this.attached) return; const o = this.pendingRigid.get(g); this.pendingRigid.set(g, o ? rigid.compose(X, o) : X); this._kick(); }
    onMoved(ids) { if (this.applying || !this.attached) return; for (const i of ids) this.moved.add(i); this._kick(); }

    // ------------------------------------------------ local -> remote ---
    /** Project the scene, diff against the shadow, return {delta, transfer} or null. */
    projectLocal() {
      const sc = this.scene, idm = this.idmap, shadow = this.shadow;
      const db = new DeltaBuilder(); const poseOf = (id) => sc.poseOf(id);
      const scan = this.fullDirty; this.fullDirty = false;
      const touched = this.touchIds; this.touchIds = new Set();
      if (!scan && touched.size && sc.rowOf) { // targeted projection: only what the hooks named
        const odd = []; const gone = []; const queue = [...touched]; const queued = new Set(queue);
        for (let q = 0; q < queue.length; q++) {
          const id = queue[q]; const row = sc.rowOf(id);
          if (!row) { if (idm.nidOf(id) !== undefined) gone.push(id); continue; }
          odd.push(row[0], row[1], row[2], row[3], row[4]);
          const t3 = row[1]; if (t3 >= 0 && idm.nidOf(t3) === undefined && !queued.has(t3)) { queued.add(t3); queue.push(t3); } // brand-new neighbour
        }
        this._applyOdd(odd, gone, db, poseOf);
      }
      if (scan) {
        // pass 1 (allocation-free for unchanged nts): compare each nt with its shadow record in place; collect only the odd ones
        const nid2 = idm.idToNid, nidToId = idm.nidToId; const odd = []; let seen = 0;
        sc.forEachNt((id, n3, b, c, g) => {
          const n = nid2.get(id);
          if (n === undefined) { odd.push(id, n3, b, c, g); return; }
          seen++;
          const old = shadow.get(n);
          const n3n = n3 >= 0 ? nid2.get(n3) : "";
          if (old && n3n !== undefined && old.n3 === n3n && old.b === b && old.c === c) return;
          odd.push(id, n3, b, c, g);
        });
        const sizeBefore = idm.size;
        this._applyOdd(odd, null, db, poseOf);
        if (seen < sizeBefore) { // some mapped nucleotides vanished
          const present = new Set(); sc.forEachNt((id) => { present.add(id); });
          const gone = []; for (const [n, id] of idm.nidToId) if (!present.has(id)) gone.push(id);
          this._applyOdd([], gone, db, poseOf);
        }
      }
      // free-form motion
      const d = db.build(); const transfer = [];
      if (d.add && d.add.f) transfer.push(d.add.f.buffer);
      if (this.pendingRigid.size) { d.rigid = []; for (const [g, X] of this.pendingRigid) if (!rigid.isIdentity(X, 1e-7)) d.rigid.push({ g, R: X.R, t: X.t }); this.pendingRigid.clear(); if (!d.rigid.length) delete d.rigid; }
      if (this.moved.size) {
        const ns = [], ids = [];
        for (const id of this.moved) { const n = idm.nidOf(id); if (n !== undefined && !(d.add && d.add.n.includes(n))) { ns.push(n); ids.push(id); } }
        this.moved.clear();
        if (ns.length) { const f = new Float32Array(ns.length * 9); ids.forEach((id, i) => f.set(sc.poseOf(id), i * 9)); d.pose = { n: ns, f }; transfer.push(f.buffer); }
      }
      return deltaIsEmpty(d) ? null : { d, transfer };
    }
    /** `odd` = flat [id, n3Id, b, c, g]* of nts that may differ from the shadow; `gone` = mapped ids no longer in the scene */
    _applyOdd(odd, gone, db, poseOf) {
      const idm = this.idmap, shadow = this.shadow, nidToId = idm.nidToId; const nOdd = odd.length / 5;
      for (let r = 0; r < nOdd; r++) { // identities for brand-new nts first (a changed nt may point at one)
        const id = odd[r * 5]; if (idm.nidOf(id) !== undefined) continue;
        const t = this.tomb.get(id);
        if (t !== undefined && !nidToId.has(t) && !shadow.has(t)) { idm.link(t, id); this.tomb.delete(id); } // same nucleotide came back (undo/redo)
        else idm.link(idm.newOverlay(ACTOR), id);
      }
      for (let r = 0; r < nOdd; r++) {
        const id = odd[r * 5], n3 = odd[r * 5 + 1], b = odd[r * 5 + 2], c = odd[r * 5 + 3], g = odd[r * 5 + 4];
        const n = idm.nidOf(id); const nr = rec(n3 >= 0 ? idm.nidOf(n3) : "", b, c); const old = shadow.get(n);
        if (!old) { db.add(n, nr, g, poseOf(id)); shadow.set(n, nr); }
        else if (!recEq(old, nr)) { db.change(n, old, nr); shadow.set(n, nr); }
      }
      if (gone) for (const id of gone) { const n = idm.nidOf(id); if (n === undefined) continue; db.del(n); shadow.delete(n); idm.unlinkNid(n); this.tomb.set(id, n); if (this.tomb.size > 5000) this.tomb.delete(this.tomb.keys().next().value); }
    }
    /** Flush callback (frame-coalesced).  Returns the sent delta (or null). */
    sendLocal() {
      const edited = this.firstDirtyAt || this.now(); this.firstDirtyAt = 0;
      if (!this.peer || !this.attached) return null;
      const t0 = this.now();
      const r = this.projectLocal(); if (!r) return null;
      this.peer.sendDelta(r.d, r.transfer, edited);
      this.flushMs.push(this.now() - t0); if (this.flushMs.length > 3000) this.flushMs.shift();
      return r.d;
    }
    flushNow() { this.sched.flushNow(); if (this.sched.pending === false) return this.sendLocal(); }

    // ------------------------------------------------ remote -> local ---
    /** Silently apply a delta to the scene and the id map; shadow follows. */
    applyDelta(d) {
      const sc = this.scene, idm = this.idmap, shadow = this.shadow;
      this.applying = true;
      if (sc.beginApply) sc.beginApply();
      try {
        if (d.del) { const ids = []; for (const n of d.del) { const id = idm.idOf(n); if (id !== undefined) { ids.push(id); idm.unlinkNid(n); } } if (ids.length) sc.remove(ids); }
        if (d.add && d.add.n.length) {
          const specs = [], idxs = [];
          d.add.n.forEach((n, i) => {
            const have = idm.idOf(n);
            if (have !== undefined) { const ch = d.add.b[i]; if (ch !== "?") sc.setBase(have, ch); if (d.add.c[i] >= 0) sc.setColor(have, d.add.c[i]); return; }
            specs.push({ b: d.add.b[i] === "?" ? "A" : d.add.b[i], c: d.add.c[i], g: d.add.g[i], pose: d.add.f ? Array.from(d.add.f.subarray(i * 9, i * 9 + 9)) : [0, 0, 0, 1, 0, 0, 0, 0, 1] }); idxs.push(i);
          });
          if (specs.length) {
            // links among the NEW cells are built into the strands at creation (one pass, no per-link edit/render)
            const at = new Map(); idxs.forEach((i, k) => at.set(d.add.n[i], k));
            const links = new Int32Array(specs.length).fill(-1), hasPred = new Uint8Array(specs.length);
            if (d.n3 && d.n3.set) for (const [a, b] of d.n3.set) { const ka = at.get(a), kb = at.get(b); if (ka !== undefined && kb !== undefined && links[ka] < 0 && !hasPred[kb] && ka !== kb) { links[ka] = kb; hasPred[kb] = 1; } }
            const ids = sc.createNts(specs, links); ids.forEach((id, k) => idm.link(d.add.n[idxs[k]], id));
          }
        }
        if (d.n3) {
          for (const a of d.n3.clr || []) { const id = idm.idOf(a); if (id !== undefined && sc.n3Of(id) >= 0) sc.unlink(id); }
          for (const [a, b] of d.n3.set || []) {
            const ia = idm.idOf(a), ib = idm.idOf(b); if (ia === undefined || ib === undefined) continue;
            if (sc.n3Of(ia) === ib) continue;
            if (sc.n3Of(ia) >= 0) sc.unlink(ia);
            const p = sc.n5Of(ib); if (p >= 0 && p !== ia) sc.unlink(p);
            sc.link(ia, ib);
          }
        }
        if (d.b) d.b.n.forEach((n, i) => { const id = idm.idOf(n); if (id !== undefined) sc.setBase(id, d.b.v[i]); });
        if (d.c) d.c.n.forEach((n, i) => { const id = idm.idOf(n); if (id !== undefined) sc.setColor(id, d.c.v[i]); });
        if (d.pose) { const ids = [], keep = []; d.pose.n.forEach((n, i) => { const id = idm.idOf(n); if (id !== undefined) { ids.push(id); keep.push(i); } }); const f = new Float32Array(ids.length * 9); keep.forEach((i, k) => f.set(d.pose.f.subarray(i * 9, i * 9 + 9), k * 9)); if (ids.length) sc.setPoses(ids, f); }
        if (d.rigid) for (const x of d.rigid) sc.applyRigid(x.g, { R: x.R, t: x.t });
        if (d.oid) this.registry.apply(d.oid);
        if (d.groups) this.idmap.groups = d.groups;
        applyDeltaToShadow(shadow, d);
        sc.afterApply && sc.afterApply();
      } finally { this.applying = false; if (sc.abortApply) sc.abortApply(); }
    }
    // Peer handlers ---------------------------------------------------------
    handlers(extra) {
      const self = this;
      return Object.assign({
        beforeRemote() { self.sched.flushNow(); },
        applyRemote(d) { self.applyDelta(d); return { ok: true }; },
        snapshotFor(nids) { return repairDelta(self.shadow, nids); },
        onRepair(d, why) { self.applyDelta(d); self.rejections.push(why); self.onStatus({ rejected: why }); },
        onResync(reason) { self.onStatus({ resync: reason }); if (self.peer) self.peer.send({ t: "resync-req", reason }); },
        onMessage(m) { self.onMessage(m); },
      }, extra || {});
    }

    // ------------------------------------------------------- bulk load ---
    onMessage(m) {
      if (m.t === "snap-begin") { this.applying = true; this.scene.clearAll(); this.idmap = new IdMap(); this.shadow = new Css(); this.registry = OligoRegistry.fromJSON(m.meta && m.meta.registry); this.idmap.loadJSON(m.meta); this.bulk = { id: m.id, total: m.total, got: 0, pairs: m.pairs || [], rev: m.rev || 0, t0: this.now(), maxSlice: 0 }; this.attached = false; }
      else if (m.t === "snap-chunk" && this.bulk && m.id === this.bulk.id) this.loadChunk(m);
      else if (m.t === "snap-end" && this.bulk && m.id === this.bulk.id) this.endBulk(m);
      else if (m.t === "state-req") this.sendState(m);
    }
    loadChunk(m) {
      const t0 = this.now();
      const ids = this.scene.loadBulk({ n: m.nids.length, chainStart: m.cs, f: m.f, b: m.b, c: m.c, g: m.g });
      m.nids.forEach((n, i) => { this.idmap.link(n, ids[i]); });
      // shadow: chain-ordered, so n3 = next unless next starts a chain
      for (let i = 0; i < m.nids.length; i++) {
        const lastInChain = i + 1 >= m.nids.length || m.cs[i + 1] !== 0;
        let n3 = lastInChain ? "" : m.nids[i + 1];
        if (lastInChain) { // circular chain closes onto its start
          let s = i; while (s > 0 && m.cs[s] === 0) s--; if (m.cs[s] === 2) n3 = m.nids[s];
        }
        this.shadow.set(m.nids[i], rec(n3, String.fromCharCode(m.b[i]), m.c[i]));
      }
      this.bulk.got += m.nids.length; this.bulk.maxSlice = Math.max(this.bulk.maxSlice, this.now() - t0);
    }
    endBulk(m) {
      const b = this.bulk; this.bulk = null;
      for (const [x, y] of b.pairs) { const ix = this.idmap.idOf(x), iy = this.idmap.idOf(y); if (ix !== undefined && iy !== undefined) this.scene.setPair(ix, iy); }
      this.scene.finishLoad();
      if (this.peer) this.peer.rev = b.rev;
      this.applying = false; this.attached = true;
      this.onStatus({ loaded: b.got, ms: this.now() - b.t0, maxSliceMs: b.maxSlice });
    }
    /** adopt path: report our whole CSS so the primary can diff against its own projection */
    sendState(req) {
      const rows = []; this.scene.forEachNt((id, n3, b, c, g) => rows.push([id, n3, b, c, g]));
      const idm = this.idmap;
      rows.forEach(([id]) => { if (idm.nidOf(id) === undefined) idm.link(idm.newOverlay(ACTOR), id); });
      const nids = rows.map(([id]) => idm.nidOf(id));
      const n3 = rows.map(([, n]) => (n >= 0 ? idm.nidOf(n) : ""));
      const b = rows.map((r) => r[2]).join(""); const c = rows.map((r) => r[3]);
      this.shadow = new Css(); nids.forEach((n, i) => this.shadow.set(n, rec(n3[i], b[i], c[i])));
      this.peer.send({ t: "state", id: req.id, nids, n3, b, c });
      this.attached = true;
    }

    // ------------------------------------------------------ persistence ---
    /** block written into the .oxview JSON under the `nanocanvasSync` key; per-monomer NIDs are written by the scene */
    exportMeta() { return { v: core.PROTOCOL, idmap: this.idmap.toJSON(), oids: this.registry.toJSON(), rev: this.peer ? this.peer.rev : 0, overlayCounter: this.idmap.overlayCounter }; }
    /** after a .oxview with sync ids was parsed: `pairs` = [[elementId, nid], ...] */
    restore(meta, pairs) {
      this.idmap = new IdMap(); this.shadow = new Css();
      if (meta) { this.idmap.loadJSON(meta.idmap); this.idmap.overlayCounter = Math.max(this.idmap.overlayCounter, meta.overlayCounter || 0); this.registry = OligoRegistry.fromJSON(meta.oids); }
      for (const [id, n] of pairs) { if (this.scene.has(id)) this.idmap.link(n, id); }
      return this.idmap.size;
    }
    /** invariants used by the harness (and a debug call in the browser) */
    verify() {
      const bad = this.idmap.check();
      let count = 0; this.scene.forEachNt((id) => { count++; if (this.idmap.nidOf(id) === undefined) bad.push("unmapped element " + id); });
      if (count !== this.idmap.size) bad.push("scene has " + count + " nts, idmap " + this.idmap.size);
      return bad;
    }
    /** CSS projection of the live scene (no side effects on the shadow) -- used for convergence checks */
    css() {
      const out = new Map(); const idm = this.idmap;
      this.scene.forEachNt((id, n3, b, c) => { out.set(idm.nidOf(id) || ("?" + id), rec(n3 >= 0 ? (idm.nidOf(n3) || ("?" + n3)) : "", b, c)); });
      return out;
    }
    /** oligos of the live scene with their stable oids */
    oligos() {
      const css = this.css(); const chains = core.chainsFromRecs(css);
      return chains.map((ch) => ({ ...ch, oid: this.registry.oidOfHead(ch.head) }));
    }
  }

  return { OxEngine, ACTOR };
});
