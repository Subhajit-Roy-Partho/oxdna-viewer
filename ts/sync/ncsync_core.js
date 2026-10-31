/**
 * ncsync_core.js -- shared, dependency-free core of the oxView <-> NanoCanvas live sync.
 *
 * This exact file lives in BOTH repositories (oxdna-viewer: ts/sync/, NanoCanvas:
 * cadnano-app/src/editor/sync/ + the vendored public/oxview/ts/sync/ copy) and is
 * loaded either as a classic <script> (-> window.NCSyncCore) or via a side-effect `import` in
 * ESM/node harnesses (-> globalThis.NCSyncCore).  It must stay free of DOM / THREE / React so it can be fuzzed in node.
 *
 * Contents
 *   - NID: the shared nucleotide id ("helix:index:strandType[:loopExtra]" or "o:<actor>:<n>")
 *   - CSS records + delta algebra (the wire format of one edit)
 *   - OligoRegistry (stable strand/oligo ids across split / merge / extend)
 *   - IdMap (bijective NID <-> native-id table used on the oxView side)
 *   - TouchLog (conflict detection), rigid-body math, frame scheduler
 *   - Transports (MessagePort, BroadcastChannel, in-process loopback) and Peer (rev / seq / ack)
 *
 * See docs/oxview-nanocanvas-sync.md (NanoCanvas repo) for the design and id-stability rules.
 */
(function (root, factory) {
  // Publishes globalThis.NCSyncCore (classic <script>, or a side-effect `import` under Vite/esbuild/node-ESM).
  root.NCSyncCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PROTOCOL = 1;
  const NS = "nanocanvasSync"; // namespaced key persisted in .oxview / session JSON

  // ---------------------------------------------------------------- NID ----
  // A NID names a *position in the design*, not an object lifetime: the base on
  // helix h, lattice index i, strand type t ("scaf" | "stap"), optionally the k-th
  // loop-insertion extra (k >= 1) after it.  Cells created by oxView that have no
  // lattice site get an overlay NID "o:<actor>:<n>" (actor-scoped counter, never reused).
  const nid = {
    cell(h, i, t, k) { return k ? h + ":" + i + ":" + t + ":" + k : h + ":" + i + ":" + t; },
    overlay(actor, n) { return "o:" + actor + ":" + n; },
    isOverlay(s) { return s.charCodeAt(0) === 111 && s.charCodeAt(1) === 58; },
    parse(s) {
      if (nid.isOverlay(s)) { const p = s.split(":"); return { kind: "overlay", actor: p[1], n: +p[2] }; }
      const p = s.split(":");
      return { kind: "cell", h: +p[0], i: +p[1], t: p[2], k: p[3] ? +p[3] : 0 };
    },
  };

  // ------------------------------------------------------- CSS records ----
  // Canonical Shared State: Map<NID, {n3, b, c}>  n3 = NID of the 3' neighbour ('' = strand end),
  // b = base letter ('' = unassigned), c = colour 0xRRGGBB (-1 = none).
  const rec = (n3, b, c) => ({ n3: n3 || "", b: b || "", c: c == null ? -1 : c });
  const recEq = (a, b) => a.n3 === b.n3 && a.b === b.b && a.c === b.c;

  function emptyDelta() { return {}; }
  function deltaIsEmpty(d) {
    if (!d) return true;
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (v == null) continue;
      if (Array.isArray(v) ? v.length : typeof v === "object" ? deltaFieldNonEmpty(k, v) : true) return false;
    }
    return true;
  }
  function deltaFieldNonEmpty(k, v) {
    if (k === "add" || k === "b" || k === "pose") return v.n && v.n.length > 0;
    if (k === "c") return v.n && v.n.length > 0;
    if (k === "n3") return (v.clr && v.clr.length) || (v.set && v.set.length);
    if (k === "oid") return (v.set && v.set.length) || (v.gone && v.gone.length) || (v.alias && v.alias.length);
    return Object.keys(v).length > 0;
  }

  /** Accumulates per-NID changes into one delta.  Order of application on the receiver:
   *  del -> add -> n3.clr -> n3.set -> b -> c -> pose -> rigid -> oid. */
  class DeltaBuilder {
    constructor() { this.d = {}; this.g = new Map(); }
    del(n) { (this.d.del || (this.d.del = [])).push(n); }
    add(n, r, g, pose9, poseArr) {
      const a = this.d.add || (this.d.add = { n: [], b: "", c: [], g: [] });
      a.n.push(n); a.b += r.b || "?"; a.c.push(r.c); a.g.push(g | 0);
      if (r.n3) this.set(n, r.n3);
      if (pose9) (poseArr || (this._pose || (this._pose = []))).push(pose9);
    }
    set(a, b) { const t = this.d.n3 || (this.d.n3 = { clr: [], set: [] }); t.set.push([a, b]); }
    clr(a) { const t = this.d.n3 || (this.d.n3 = { clr: [], set: [] }); t.clr.push(a); }
    /** change of a surviving cell */
    change(n, o, w) {
      if (o.n3 !== w.n3) { this.clr(n); if (w.n3) this.set(n, w.n3); }
      if (o.b !== w.b && w.b) { const t = this.d.b || (this.d.b = { n: [], v: "" }); t.n.push(n); t.v += w.b; }
      if (o.c !== w.c) { const t = this.d.c || (this.d.c = { n: [], v: [] }); t.n.push(n); t.v.push(w.c); }
    }
    build() {
      if (this._pose && this.d.add) {
        const f = new Float32Array(this._pose.length * 9);
        for (let i = 0; i < this._pose.length; i++) f.set(this._pose[i], i * 9);
        this.d.add.f = f;
      }
      return this.d;
    }
  }

  /** CSS store: Map<NID, rec> plus a predecessor index (needed to find the oligo around an edit in O(len)). */
  class Css {
    constructor() { this.m = new Map(); this.pred = new Map(); }
    get size() { return this.m.size; }
    get(n) { return this.m.get(n); }
    has(n) { return this.m.has(n); }
    [Symbol.iterator]() { return this.m[Symbol.iterator](); }
    set(n, r) {
      const old = this.m.get(n);
      if (old && old.n3 && this.pred.get(old.n3) === n) this.pred.delete(old.n3);
      if (r.n3) this.pred.set(r.n3, n);
      this.m.set(n, r);
    }
    delete(n) {
      const old = this.m.get(n);
      if (old && old.n3 && this.pred.get(old.n3) === n) this.pred.delete(old.n3);
      this.m.delete(n);
    }
    predOf(n) { const p = this.pred.get(n); if (p === undefined) return ""; const r = this.m.get(p); return r && r.n3 === n ? p : ""; }
    /** {head, tail, len, circular} of the oligo containing n (null if n is unknown) */
    chainOf(n) {
      if (!this.m.has(n)) return null;
      let head = n, guard = this.m.size + 1, circular = false;
      for (let p = this.predOf(head); p && guard--; p = this.predOf(head)) { head = p; if (head === n) { circular = true; break; } }
      if (circular) { let min = n; for (let c = this.m.get(n).n3, g = this.m.size + 1; c && c !== n && g--; c = this.m.get(c).n3) if (c < min) min = c; head = min; }
      let cur = head, tail = head, len = 0; guard = this.m.size + 1;
      while (cur && this.m.has(cur) && guard--) { tail = cur; len++; cur = this.m.get(cur).n3; if (cur === head) break; }
      return { head, tail, len, circular };
    }
  }

  /** Apply a delta to a Css shadow (both peers keep one; it is the last agreed state). */
  function applyDeltaToShadow(shadow, d) {
    if (d.del) for (const n of d.del) shadow.delete(n);
    if (d.add) d.add.n.forEach((n, i) => { const o = shadow.get(n); shadow.set(n, rec(o ? o.n3 : "", d.add.b[i] === "?" ? "" : d.add.b[i], d.add.c[i])); });
    if (d.n3) {
      if (d.n3.clr) for (const n of d.n3.clr) { const r = shadow.get(n); if (r && r.n3) shadow.set(n, rec("", r.b, r.c)); }
      if (d.n3.set) for (const [a, b] of d.n3.set) { const r = shadow.get(a); if (r) shadow.set(a, rec(b, r.b, r.c)); }
    }
    if (d.b) d.b.n.forEach((n, i) => { const r = shadow.get(n); if (r) shadow.set(n, rec(r.n3, d.b.v[i], r.c)); });
    if (d.c) d.c.n.forEach((n, i) => { const r = shadow.get(n); if (r) shadow.set(n, rec(r.n3, r.b, d.c.v[i])); });
  }

  /** Every NID a delta mentions (used for conflict detection and repair patches). */
  function deltaNids(d) {
    const s = new Set();
    if (d.del) for (const n of d.del) s.add(n);
    if (d.add) for (const n of d.add.n) s.add(n);
    if (d.n3) { for (const n of d.n3.clr || []) s.add(n); for (const [a, b] of d.n3.set || []) { s.add(a); s.add(b); } }
    if (d.b) for (const n of d.b.n) s.add(n);
    if (d.c) for (const n of d.c.n) s.add(n);
    if (d.pose) for (const n of d.pose.n) s.add(n);
    return s;
  }

  /** Delta that makes a peer's native state equal `shadow` on exactly `nids` (repair patch). */
  function repairDelta(shadow, nids, groupOf) {
    const b = new DeltaBuilder();
    const live = [];
    const dead = [];
    for (const n of nids) (shadow.has(n) ? live : dead).push(n);
    for (const n of dead) b.del(n);
    // `add` for already-existing cells is idempotent on the receiver (it re-asserts the record).
    const a = { n: [], b: "", c: [], g: [] };
    for (const n of live) { const r = shadow.get(n); a.n.push(n); a.b += r.b || "?"; a.c.push(r.c); a.g.push(groupOf ? groupOf(n) : 0); }
    const d = b.d;
    if (a.n.length) d.add = a;
    const t = { clr: [], set: [] };
    for (const n of live) { const r = shadow.get(n); t.clr.push(n); if (r.n3) t.set.push([n, r.n3]); }
    // cells that point INTO the repaired set from outside are repaired by the caller (they are in nids too)
    d.n3 = t; d.repair = true;
    return d;
  }

  // ------------------------------------------------------ chains / oligos ----
  /** Walk n3 links in a CSS Map -> chains [{head, tail, len, circular}] (5'->3'). */
  function chainsFromRecs(recs) {
    if (recs instanceof Css) recs = recs.m;
    const hasPred = new Set();
    for (const [, r] of recs) if (r.n3) hasPred.add(r.n3);
    const seen = new Set();
    const chains = [];
    for (const [n, r] of recs) {
      if (hasPred.has(n) || seen.has(n)) continue;
      let cur = n, len = 0, tail = n;
      while (cur && recs.has(cur) && !seen.has(cur)) { seen.add(cur); tail = cur; len++; cur = recs.get(cur).n3; }
      chains.push({ head: n, tail, len, circular: false });
    }
    for (const [n] of recs) { // circular strands: no head -> canonical head = smallest NID, tail = its predecessor
      if (seen.has(n)) continue;
      let cur = n, len = 0, min = n;
      while (cur && recs.has(cur) && !seen.has(cur)) { seen.add(cur); if (cur < min) min = cur; len++; cur = recs.get(cur).n3; }
      let tail = min; for (let c = min, g = len + 1; c && g-- > 0;) { const nx = recs.get(c).n3; if (nx === min) { tail = c; break; } c = nx; }
      chains.push({ head: min, tail, len, circular: true });
    }
    return chains;
  }

  /**
   * Stable oligo (strand) ids.  A strand is identified by an `oid` that is NOT derived from any
   * native id.  Rules (id-stability, see docs section 4):
   *   1. an oligo whose 5' end cell equals a registered oid's head keeps that oid
   *      (nick keeps the 5' piece, ligation keeps the 5'-most piece, 3' extension/trim keeps);
   *   2. else, an oligo whose 3' end equals an unclaimed oid's tail inherits it
   *      (5' extension/trim, the 3' half of a deleted-middle...);
   *   3. else, an oligo that still CONTAINS an unclaimed oid's old head or tail inherits it (circularisation);
   *   4. else it gets a fresh oid "s<counter>" (the 3' piece of a nick, brand-new strands);
   *   Oids that nobody claims are retired (tombstoned, never reused); on a merge the absorbed
   *   oid is retired with alias -> surviving oid so stale references resolve.
   * Only the primary (NanoCanvas) runs reconcile(); the secondary replicates via apply().
   */
  class OligoRegistry {
    constructor() { this.counter = 0; this.live = new Map(); this.byHead = new Map(); this.byTail = new Map(); this.retired = new Map(); }
    _put(o, head, tail, circ) { const old = this.live.get(o); if (old) { if (this.byHead.get(old.head) === o) this.byHead.delete(old.head); if (this.byTail.get(old.tail) === o) this.byTail.delete(old.tail); } this.live.set(o, { head, tail, circ: !!circ }); this.byHead.set(head, o); this.byTail.set(tail, o); }
    _drop(o) { const old = this.live.get(o); if (!old) return; if (this.byHead.get(old.head) === o) this.byHead.delete(old.head); if (this.byTail.get(old.tail) === o) this.byTail.delete(old.tail); this.live.delete(o); }
    /**
     * `chains` = the CURRENT chains of every oligo touched by the edit; `touched` = NIDs whose oligo may
     * have changed (changed/added/deleted cells and the old/new link targets).  With touched === null the
     * chains must be ALL chains (full reconcile).  `locate(nid) -> chain|null` resolves an absorbed oid's head
     * to the chain that now contains it (alias on merge).  Only candidate oids (anchored at a chain end or a
     * touched NID) take part, so the cost is O(edit), not O(design).
     */
    reconcile(chains, touched, locate) {
      const cand = new Set();
      if (touched === null || touched === undefined) for (const o of this.live.keys()) cand.add(o);
      else {
        // a circular oligo has no ends near an edit: it takes part only when it is no longer the same intact circle
        if (locate) for (const [o, v] of this.live) if (v.circ) { const ch = locate(v.head); if (!(ch && ch.circular && ch.head === v.head && ch.tail === v.tail)) cand.add(o); }
        for (const c of chains) { const h = this.byHead.get(c.head), t = this.byTail.get(c.tail); if (h !== undefined) cand.add(h); if (t !== undefined) cand.add(t); }
        for (const n of touched) { const h = this.byHead.get(n), t = this.byTail.get(n); if (h !== undefined) cand.add(h); if (t !== undefined) cand.add(t); }
      }
      const claimed = new Set(); const assign = new Array(chains.length).fill(null);
      chains.forEach((c, i) => { const o = this.byHead.get(c.head); if (o !== undefined && cand.has(o) && !claimed.has(o)) { claimed.add(o); assign[i] = o; } });
      chains.forEach((c, i) => { if (assign[i] !== null) return; const o = this.byTail.get(c.tail); if (o !== undefined && cand.has(o) && !claimed.has(o)) { claimed.add(o); assign[i] = o; } });
      if (locate) chains.forEach((c, i) => { // rule 3: the oligo still CONTAINS an old end cell (circularisation, double trim)
        if (assign[i] !== null) return;
        for (const o of cand) { if (claimed.has(o)) continue; const v = this.live.get(o); const a = locate(v.head), b = locate(v.tail); if ((a && a.head === c.head) || (b && b.head === c.head)) { claimed.add(o); assign[i] = o; break; } }
      });
      const fresh = chains.map((c, i) => i).filter((i) => assign[i] === null).sort((x, y) => (chains[x].head < chains[y].head ? -1 : 1));
      for (const i of fresh) assign[i] = "s" + (++this.counter);
      const set = [], gone = [], alias = [];
      const headToOid = new Map(chains.map((c, i) => [c.head, assign[i]]));
      for (const o of cand) {
        if (claimed.has(o)) continue;
        const v = this.live.get(o); gone.push(o);
        let target = headToOid.get(v.head);
        if (target === undefined && locate) { const ch = locate(v.head); if (ch) target = headToOid.get(ch.head); }
        this.retired.set(o, target === undefined ? null : target);
        if (target !== undefined) alias.push([o, target]);
      }
      for (const o of gone) this._drop(o);
      chains.forEach((c, i) => { const o = assign[i], old = this.live.get(o); if (!old || old.head !== c.head || old.tail !== c.tail || old.circ !== c.circular) { this._put(o, c.head, c.tail, c.circular); set.push([o, c.head, c.tail, c.circular ? 1 : 0]); } });
      return { set, gone, alias, counter: this.counter };
    }
    apply(delta) {
      if (!delta) return;
      for (const o of delta.gone || []) { this._drop(o); this.retired.set(o, null); }
      for (const [o, t] of delta.alias || []) this.retired.set(o, t);
      for (const [o, head, tail, circ] of delta.set || []) this._put(o, head, tail, !!circ);
      if (delta.counter != null) this.counter = Math.max(this.counter, delta.counter);
    }
    resolve(o) { let guard = 8; while (this.retired.has(o) && guard--) { const t = this.retired.get(o); if (t == null) return null; o = t; } return this.live.has(o) ? o : null; }
    oidOfHead(n) { return this.byHead.get(n); }
    toJSON() { return { counter: this.counter, live: [...this.live].map(([o, v]) => [o, v.head, v.tail, v.circ ? 1 : 0]), retired: [...this.retired] }; }
    static fromJSON(j) {
      const r = new OligoRegistry();
      if (!j) return r;
      r.counter = j.counter || 0;
      for (const [o, head, tail, circ] of j.live || []) r._put(o, head, tail, !!circ);
      for (const [o, t] of j.retired || []) r.retired.set(o, t);
      return r;
    }
  }

  // ------------------------------------------------------------- IdMap ----
  /** Bijective NID <-> native id (oxView element id).  link() refuses to break bijectivity. */
  class IdMap {
    constructor() { this.nidToId = new Map(); this.idToNid = new Map(); this.overlayCounter = 0; this.groups = []; }
    link(n, id) {
      const a = this.nidToId.get(n), b = this.idToNid.get(id);
      if ((a !== undefined && a !== id) || (b !== undefined && b !== n)) throw new Error("IdMap: bijectivity violation linking " + n + " <-> " + id + " (existing " + a + ", " + b + ")");
      this.nidToId.set(n, id); this.idToNid.set(id, n);
    }
    unlinkId(id) { const n = this.idToNid.get(id); if (n === undefined) return; this.idToNid.delete(id); this.nidToId.delete(n); }
    unlinkNid(n) { const id = this.nidToId.get(n); if (id === undefined) return; this.nidToId.delete(n); this.idToNid.delete(id); }
    idOf(n) { return this.nidToId.get(n); }
    nidOf(id) { return this.idToNid.get(id); }
    get size() { return this.nidToId.size; }
    newOverlay(actor) { return nid.overlay(actor, ++this.overlayCounter); }
    /** Returns [] when bijective, otherwise a list of violations. */
    check() {
      const bad = [];
      if (this.nidToId.size !== this.idToNid.size) bad.push("size mismatch " + this.nidToId.size + " vs " + this.idToNid.size);
      for (const [n, id] of this.nidToId) if (this.idToNid.get(id) !== n) { bad.push("forward/back mismatch at " + n); if (bad.length > 5) break; }
      return bad;
    }
    toJSON() { return { overlayCounter: this.overlayCounter, groups: this.groups }; }
    loadJSON(j) { if (!j) return; this.overlayCounter = j.overlayCounter || 0; this.groups = j.groups || []; }
  }

  // ---------------------------------------------------------- TouchLog ----
  /** Ring of the NID sets touched by the last N authoritative revisions (conflict detection). */
  class TouchLog {
    constructor(max) { this.max = max || 256; this.items = []; }
    push(rev, nids) { this.items.push({ rev, nids }); if (this.items.length > this.max) this.items.shift(); }
    /** NIDs of `nids` touched by any revision > base.  Returns null if the log no longer reaches back to base. */
    conflicts(base, nids) {
      if (this.items.length && this.items[0].rev > base + 1) return null;
      const out = [];
      for (const it of this.items) { if (it.rev <= base) continue; for (const n of nids) if (it.nids.has(n)) out.push(n); }
      return out;
    }
  }

  // -------------------------------------------------------- rigid math ----
  const D2R = Math.PI / 180;
  const mat = {
    I: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    mul(A, B) { const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]; return C; },
    T(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; },
    apply(A, v) { return [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]]; },
    /** R = Rx*Ry*Rz (three.js Euler 'XYZ'), degrees -- identical to cadnanoOxDnaJs.createRotationMatrix */
    fromEuler(rx, ry, rz) {
      const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R), cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
      return [[cy * cz, -cy * sz, sy], [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy], [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy]];
    },
    toEuler(R) {
      const y = Math.asin(Math.max(-1, Math.min(1, R[0][2])));
      let x, z;
      if (Math.abs(R[0][2]) < 0.9999999) { x = Math.atan2(-R[1][2], R[2][2]); z = Math.atan2(-R[0][1], R[0][0]); }
      else { x = Math.atan2(R[2][1], R[1][1]); z = 0; }
      return [x / D2R, y / D2R, z / D2R];
    },
    fromAxisAngle(axis, ang) {
      const l = Math.hypot(axis[0], axis[1], axis[2]) || 1, x = axis[0] / l, y = axis[1] / l, z = axis[2] / l, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
      return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
    },
    fromQuat(q) { // q = [x,y,z,w]
      const [x, y, z, w] = q;
      return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
    },
  };
  /** Rigid transform p' = R p + t.  compose(A,B) = A after B. */
  const rigid = {
    identity: () => ({ R: mat.I(), t: [0, 0, 0] }),
    apply: (X, p) => { const r = mat.apply(X.R, p); return [r[0] + X.t[0], r[1] + X.t[1], r[2] + X.t[2]]; },
    compose: (A, B) => { const R = mat.mul(A.R, B.R), r = mat.apply(A.R, B.t); return { R, t: [r[0] + A.t[0], r[1] + A.t[1], r[2] + A.t[2]] }; },
    inverse: (A) => { const Rt = mat.T(A.R), r = mat.apply(Rt, A.t); return { R: Rt, t: [-r[0], -r[1], -r[2]] }; },
    /** rotation by R about point c followed by translation v */
    about: (R, c, v) => { const rc = mat.apply(R, c); return { R, t: [c[0] - rc[0] + (v ? v[0] : 0), c[1] - rc[1] + (v ? v[1] : 0), c[2] - rc[2] + (v ? v[2] : 0)] }; },
    isIdentity: (A, eps) => { eps = eps || 1e-9; for (let i = 0; i < 3; i++) { if (Math.abs(A.t[i]) > eps) return false; for (let j = 0; j < 3; j++) if (Math.abs(A.R[i][j] - (i === j ? 1 : 0)) > eps) return false; } return true; },
  };

  // ---------------------------------------------------------- scheduler ----
  /** Coalesces any number of schedule() calls into ONE flush per animation frame.  A timer races
   *  rAF so a hidden tab / background iframe (where rAF is paused) still syncs. */
  function frameScheduler(fn, opts) {
    opts = opts || {};
    let pending = false, raf = 0, tm = 0;
    const run = () => { if (!pending) return; pending = false; if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf); clearTimeout(tm); raf = 0; tm = 0; fn(); };
    return {
      schedule() {
        if (pending) return; pending = true;
        if (opts.sync) return run();
        if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(run);
        tm = setTimeout(run, opts.fallbackMs || 40);
      },
      flushNow() { run(); },
      get pending() { return pending; },
    };
  }

  // --------------------------------------------------------- transports ----
  class PortTransport {
    constructor(port) { this.port = port; this.onmessage = null; port.onmessage = (e) => this.onmessage && this.onmessage(e.data); if (port.start) port.start(); }
    send(m, transfer) { this.port.postMessage(m, transfer || []); }
    close() { try { this.port.close(); } catch (e) { /* ignore */ } }
  }
  /** Same-origin windows without a shared iframe relationship (separate tabs).  No transfer list. */
  class BroadcastTransport {
    constructor(name, self) {
      this.self = self || Math.random().toString(36).slice(2); this.onmessage = null;
      this.bc = new BroadcastChannel(name);
      this.bc.onmessage = (e) => { const m = e.data; if (m && m._from !== this.self && this.onmessage) this.onmessage(m.m); };
    }
    send(m) { this.bc.postMessage({ _from: this.self, m }); }
    close() { this.bc.close(); }
  }
  /** In-process pair for tests; structuredClone mimics the copy semantics of postMessage. */
  function loopbackPair(opts) {
    opts = opts || {};
    const mk = () => ({ onmessage: null, peer: null, send(m, transfer) { const c = opts.noClone ? m : structuredClone(m, { transfer: transfer || [] }); const p = this.peer; const go = () => p.onmessage && p.onmessage(c); if (opts.sync) go(); else queueMicrotask(go); }, close() {} });
    const a = mk(), b = mk(); a.peer = b; b.peer = a; return [a, b];
  }

  // --------------------------------------------------------------- Peer ----
  /**
   * Protocol engine for one end of the link.  Authoritative ordering lives in the PRIMARY
   * (NanoCanvas): it assigns monotonically increasing `rev`s to every accepted delta, its own
   * and the secondary's.  The SECONDARY (oxView) applies its edits optimistically and tags them
   * with (seq, base-rev); the primary acks (accept) or rejects with a repair patch (conflict /
   * unrepresentable).  Echo cannot loop: a peer never re-projects an applied remote delta,
   * because it advances its own shadow in the same step (see session code).
   *
   * handlers (all synchronous):
   *   beforeRemote()                       primary/secondary: flush local pending edits first
   *   applyRemote(delta, meta) -> {ok, reason?}   apply an incoming delta to the native model
   *   snapshotFor(nids) -> delta           primary: authoritative repair patch
   *   onRepair(delta, meta)                secondary: apply repair patch (after a reject)
   *   onResync(reason)                     either: the stream is unusable -> full resync
   *   onEvent(ev)                          stats / UI
   */
  class Peer {
    constructor(o) {
      this.role = o.role; this.t = o.transport; this.h = o.handlers; this.now = o.now || (() => (typeof performance !== "undefined" ? performance.timeOrigin + performance.now() : Date.now()));
      this.rev = 0; this.seq = 0; this.pending = new Map(); this.touch = new TouchLog(o.touchMax || 512);
      this.stats = { sent: 0, recv: 0, rejected: 0, conflicts: 0, transit: [], apply: [], rtt: [] };
      this.t.onmessage = (m) => this._on(m);
    }
    /** Send a local delta.  `edited` = time of the originating edit (for latency stats). */
    sendDelta(d, transfer, edited) {
      if (deltaIsEmpty(d)) return 0;
      const ts = edited || this.now(); const nids = deltaNids(d);
      this.stats.sent++;
      if (this.role === "primary") {
        const rev = ++this.rev; this.touch.push(rev, nids);
        this.t.send({ t: "delta", p: PROTOCOL, from: "primary", rev, d, ts, ts2: this.now() }, transfer);
        return rev;
      }
      const seq = ++this.seq;
      this.pending.set(seq, { ts, nids, sentAt: this.now() });
      this.t.send({ t: "delta", p: PROTOCOL, from: "secondary", seq, base: this.rev, d, ts, ts2: this.now() }, transfer);
      return seq;
    }
    send(msg, transfer) { this.t.send(msg, transfer); }
    _on(m) {
      if (!m || typeof m !== "object") return;
      if (m.t === "delta") return this.role === "primary" ? this._onSecondaryDelta(m) : this._onPrimaryDelta(m);
      if (m.t === "ack" && this.role === "secondary") return this._onAck(m);
      if (m.t === "resync-req") return this.h.onResync && this.h.onResync("peer-request");
      if (this.h.onMessage) this.h.onMessage(m);
    }
    _record(m, t0) { const t1 = this.now(); this.stats.recv++; this.stats.transit.push(t0 - m.ts2); this.stats.apply.push(t1 - t0); if (this.stats.transit.length > 2000) { this.stats.transit.shift(); this.stats.apply.shift(); } }
    _onSecondaryDelta(m) {
      const t0 = this.now();
      if (this.h.beforeRemote) this.h.beforeRemote();
      const nids = deltaNids(m.d);
      const conf = this.touch.conflicts(m.base, nids);
      let ack;
      if (conf === null) { this.stats.conflicts++; ack = { t: "ack", seq: m.seq, ok: false, reason: "stale-base", repair: this.h.snapshotFor(nids), rev: this.rev }; }
      else if (conf.length) { this.stats.conflicts++; ack = { t: "ack", seq: m.seq, ok: false, reason: "conflict", detail: conf.slice(0, 5), repair: this.h.snapshotFor(nids), rev: this.rev }; }
      else {
        const res = this.h.applyRemote(m.d, { rev: this.rev + 1, ts: m.ts }) || { ok: true };
        if (res.ok) { const rev = ++this.rev; this.touch.push(rev, nids); ack = { t: "ack", seq: m.seq, ok: true, rev, corr: res.corr || null }; }
        else { this.stats.rejected++; ack = { t: "ack", seq: m.seq, ok: false, reason: res.reason || "rejected", repair: this.h.snapshotFor(nids), rev: this.rev }; }
      }
      this._record(m, t0);
      this.t.send(ack);
      if (this.h.onEvent) this.h.onEvent({ ev: "remote", ok: ack.ok, reason: ack.reason, ts: m.ts, applied: this.now() });
    }
    _onPrimaryDelta(m) {
      const t0 = this.now();
      if (m.rev !== this.rev + 1) { if (this.h.onResync) this.h.onResync("rev-gap " + this.rev + "->" + m.rev); return; }
      if (this.h.beforeRemote) this.h.beforeRemote();
      const res = this.h.applyRemote(m.d, { rev: m.rev, ts: m.ts }) || { ok: true };
      this.rev = m.rev;
      this._record(m, t0);
      if (!res.ok && this.h.onResync) this.h.onResync("apply-failed: " + res.reason);
      if (this.h.onEvent) this.h.onEvent({ ev: "remote", ok: res.ok, ts: m.ts, applied: this.now() });
    }
    _onAck(m) {
      const p = this.pending.get(m.seq); this.pending.delete(m.seq);
      if (p) { this.stats.rtt.push(this.now() - p.sentAt); if (this.stats.rtt.length > 2000) this.stats.rtt.shift(); }
      if (m.rev !== this.rev + 1 && m.ok) { if (this.h.onResync) this.h.onResync("ack-gap " + this.rev + "->" + m.rev); return; }
      if (m.ok) this.rev = m.rev;
      else { this.stats.rejected++; if (m.repair && this.h.onRepair) this.h.onRepair(m.repair, { reason: m.reason, detail: m.detail }); }
      if (this.h.onEvent) this.h.onEvent({ ev: "ack", ok: m.ok, reason: m.reason, detail: m.detail, ts: p && p.ts, applied: this.now() });
    }
    close() { this.t.close(); }
  }

  const pct = (arr, q) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

  return { PROTOCOL, NS, nid, rec, recEq, emptyDelta, deltaIsEmpty, DeltaBuilder, Css, applyDeltaToShadow, deltaNids, repairDelta, chainsFromRecs,
    OligoRegistry, IdMap, TouchLog, mat, rigid, frameScheduler, PortTransport, BroadcastTransport, loopbackPair, Peer, pct };
});
