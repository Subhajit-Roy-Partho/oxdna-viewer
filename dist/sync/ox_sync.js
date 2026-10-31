/// <reference path="../typescript_definitions/index.d.ts" />
var oxSync;
(function (oxSync) {
    let core = null;
    let engine = null;
    let peer = null;
    let scene = null;
    let uninstall = [];
    let pill = null;
    const nowMs = () => performance.timeOrigin + performance.now();
    oxSync.stats = { visible: [], applyMs: [], snapshotMs: 0, snapshotMaxSliceMs: 0, snapshotNts: 0, remote: 0, local: 0, rejected: 0, resync: 0, lastReject: "" };
    // ------------------------------------------------------------- scene adapter ---
    let clusterSizeCache = null;
    const invalidate = () => { clusterSizeCache = null; };
    function clusterSize(g) {
        if (!clusterSizeCache) {
            clusterSizeCache = new Map();
            elements.forEach((e) => { if (e && e.isNucleotide())
                clusterSizeCache.set(e.clusterId || 0, (clusterSizeCache.get(e.clusterId || 0) || 0) + 1); });
        }
        return clusterSizeCache.get(g) || 0;
    }
    const baseOf = (e) => (e.type || "A").toString().charAt(0);
    const colorOf = (e) => (e.color ? e.color.getHex() : -1);
    class OxScene {
        forEachNt(cb) {
            elements.forEach((e, id) => {
                if (!e || !e.isNucleotide())
                    return;
                cb(id, e.n3 ? e.n3.id : -1, baseOf(e), colorOf(e), e.clusterId || 0);
            });
        }
        has(id) { return !!elements.get(id); }
        n3Of(id) { const e = elements.get(id); return e && e.n3 ? e.n3.id : -1; }
        n5Of(id) { const e = elements.get(id); return e && e.n5 ? e.n5.id : -1; }
        poseOf(id) {
            const e = elements.get(id);
            return [...e.getPos().toArray(), ...e.getA1().toArray(), ...e.getA3().toArray()];
        }
        clusterOf(id) { const e = elements.get(id); return e ? e.clusterId || 0 : 0; }
        /** each spec becomes a free 1-nt strand in its own tmp system (exactly what oxView's own 'create' does) */
        createNts(specs) {
            invalidate();
            const n = specs.length;
            const tmpSys = new System(tmpSystems.length, 0);
            tmpSys.initInstances(n);
            tmpSystems.push(tmpSys);
            let realSys;
            if (systems.length > 0)
                realSys = systems[systems.length - 1];
            else {
                realSys = new System(systems.length, elements.getNextId());
                realSys.initInstances(0);
                systems.push(realSys);
                addSystemToScene(realSys);
                if (box.x === 0)
                    box = new THREE.Vector3(1000, 1000, 1000);
            }
            const ids = [];
            specs.forEach((s, i) => {
                const strand = realSys.addNewNucleicAcidStrand("DNA");
                const e = new DNANucleotide(undefined, strand);
                elements.push(e);
                e.dummySys = tmpSys;
                e.sid = i;
                e.setType(s.b);
                e.n3 = null;
                e.n5 = null;
                e.strand = strand;
                strand.setFrom(e);
                e.clusterId = s.g || 0;
                if (s.c >= 0)
                    e.color = new THREE.Color(s.c);
                const p = s.pose;
                e.calcPositions(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(p[3], p[4], p[5]), new THREE.Vector3(p[6], p[7], p[8]));
                e.dummySys = tmpSys;
                ids.push(e.id);
            });
            addSystemToScene(tmpSys);
            tmpSys.callAllUpdates();
            this.recolor(ids);
            return ids;
        }
        /** a.n3 = b.  edit.ligate(x, y) with x lacking n5 and y lacking n3 links y.n3 = x, so call it as (b, a). */
        link(a, b) { invalidate(); const ea = elements.get(a), eb = elements.get(b); if (ea.n3 || eb.n5)
            return; edit.ligate(eb, ea); }
        /** cut between a and a.n3 (a becomes the 3' end) */
        unlink(a) { invalidate(); const e = elements.get(a); if (e && e.n3)
            edit.nick(e); }
        remove(ids) { invalidate(); const victims = ids.map((i) => elements.get(i)).filter((e) => !!e); if (victims.length)
            edit.deleteElements(victims); }
        setBase(id, ch) { const e = elements.get(id); if (e && baseOf(e) !== ch) {
            e.changeType(ch);
            this._dirtySys.add(e.dummySys || e.getSystem());
        } }
        setColor(id, c) { const e = elements.get(id); if (!e)
            return; e.color = new THREE.Color(c); this._colored.add(e); }
        setPoses(ids, f) {
            const touched = new Set();
            ids.forEach((id, i) => {
                const e = elements.get(id);
                if (!e)
                    return;
                const o = i * 9;
                e.calcPositions(new THREE.Vector3(f[o], f[o + 1], f[o + 2]), new THREE.Vector3(f[o + 3], f[o + 4], f[o + 5]), new THREE.Vector3(f[o + 6], f[o + 7], f[o + 8]));
                touched.add(e.dummySys || e.getSystem());
            });
            ids.forEach((id) => { const e = elements.get(id); if (!e)
                return; if (e.n3)
                calcsp(e); if (e.n5)
                calcsp(e.n5); });
            touched.forEach((s) => s.callUpdates(["instanceOffset", "instanceRotation", "instanceScale"]));
        }
        applyRigid(g, X) {
            const set = new Set();
            elements.forEach((e) => { if (e && e.isNucleotide() && (e.clusterId || 0) === g)
                set.add(e); });
            if (!set.size)
                return;
            const R = X.R;
            const m = new THREE.Matrix4().set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
            const q = new THREE.Quaternion().setFromRotationMatrix(m);
            rotateElementsByQuaternion(set, q, new THREE.Vector3(0, 0, 0), false);
            translateElements(set, new THREE.Vector3(X.t[0], X.t[1], X.t[2]));
        }
        setPair(a, b) { const ea = elements.get(a), eb = elements.get(b); if (ea && eb) {
            ea.pair = eb;
            eb.pair = ea;
        } }
        // bulk (snapshot) -------------------------------------------------------------------
        clearAll() { invalidate(); resetScene(false); }
        /** one chunk = whole strands = one System; n3 links exist only inside a chunk, so positions are computed 3'->5' like the file reader */
        loadBulk(ch) {
            invalidate();
            const n = ch.n;
            const sys = new System(systems.length, elements.getNextId());
            sys.initInstances(n);
            const ids = [];
            const els = [];
            let strand = null;
            let first = null;
            const chains = [];
            let start = 0;
            for (let i = 0; i < n; i++) {
                if (ch.chainStart[i] !== 0) {
                    if (i > 0)
                        chains.push([start, i - 1, ch.chainStart[start] === 2]);
                    start = i;
                    strand = sys.addNewNucleicAcidStrand("DNA");
                }
                const e = new DNANucleotide(undefined, strand);
                elements.push(e);
                e.strand = strand;
                e.sid = i;
                e.type = String.fromCharCode(ch.b[i]);
                e.clusterId = ch.g[i];
                if (ch.c[i] >= 0)
                    e.color = new THREE.Color(ch.c[i]);
                els.push(e);
                ids.push(e.id);
            }
            if (n > 0)
                chains.push([start, n - 1, ch.chainStart[start] === 2]);
            for (const [a, b, circ] of chains) {
                for (let i = a; i < b; i++) {
                    els[i].n3 = els[i + 1];
                    els[i + 1].n5 = els[i];
                }
                if (circ && b > a) {
                    els[b].n3 = els[a];
                    els[a].n5 = els[b];
                }
                const s = els[a].strand;
                s.end5 = els[a];
                s.end3 = els[b];
            }
            for (const [a, b] of chains) {
                for (let i = b; i >= a; i--) {
                    const o = i * 9;
                    const f = ch.f;
                    els[i].calcPositions(new THREE.Vector3(f[o], f[o + 1], f[o + 2]), new THREE.Vector3(f[o + 3], f[o + 4], f[o + 5]), new THREE.Vector3(f[o + 6], f[o + 7], f[o + 8]));
                }
            }
            systems.push(sys);
            sys.fillDefaultColors();
            addSystemToScene(sys);
            els.forEach((e) => e.updateColor());
            sys.callAllUpdates();
            for (let i = 0; i < n; i++) {
                const g = ch.g[i];
                if (g > clusterCounter)
                    clusterCounter = g;
                this._bb(ch.f, i);
            }
            return ids;
        }
        _min = [1e9, 1e9, 1e9];
        _max = [-1e9, -1e9, -1e9];
        _bb(f, i) { for (let k = 0; k < 3; k++) {
            const v = f[i * 9 + k];
            if (v < this._min[k])
                this._min[k] = v;
            if (v > this._max[k])
                this._max[k] = v;
        } }
        finishLoad() {
            view.coloringMode.set("Custom");
            const sz = this._max.map((v, k) => Math.max(50, v + 20));
            box = new THREE.Vector3(Math.max(box.x, sz[0]), Math.max(box.y, sz[1]), Math.max(box.z, sz[2]));
            const c = this._min.map((v, k) => (v + this._max[k]) / 2);
            const r = Math.max(...this._max.map((v, k) => v - this._min[k]), 30);
            try {
                controls.target.set(c[0], c[1], c[2]);
                camera.position.set(c[0], c[1], c[2] + r * 1.4);
                controls.update && controls.update();
            }
            catch (_) { /* camera is cosmetic */ }
            this._min = [1e9, 1e9, 1e9];
            this._max = [-1e9, -1e9, -1e9];
            systems.forEach((s) => s.callAllUpdates());
            render();
        }
        // end of a remote delta: push dirty buffers to the GPU once
        _colored = new Set();
        _dirtySys = new Set();
        recolor(ids) { ids.forEach((id) => { const e = elements.get(id); if (e && e.color)
            this._colored.add(e); }); }
        afterApply() {
            if (this._colored.size) {
                if (view.coloringMode.get() !== "Custom")
                    view.coloringMode.set("Custom");
                this._colored.forEach((e) => { e.updateColor(); this._dirtySys.add(e.dummySys || e.getSystem()); });
                this._colored.clear();
            }
            this._dirtySys.forEach((s) => s.callUpdates(["instanceColor"]));
            this._dirtySys.clear();
            systems.concat(tmpSystems).forEach((s) => { try {
                s.nucleoside.geometry["attributes"].instanceColor.needsUpdate = true;
            }
            catch (_) { /* not in scene yet */ } });
            render();
        }
    }
    // ------------------------------------------------------------------- hooks ---
    const EDIT_FNS = ["nick", "ligate", "deleteElements", "addElements", "addElementsAt", "extendStrand", "extendDuplex", "setSequence", "createStrand", "skip", "insert", "createBP", "move_to", "interconnectDuplex3p", "interconnectDuplex5p"];
    function wrap(obj, name, around) {
        const orig = obj[name];
        if (typeof orig !== "function")
            return;
        obj[name] = around(orig);
        uninstall.push(() => { obj[name] = orig; });
    }
    function noteTransform(elems, X) {
        if (!engine || engine.applying || !engine.attached)
            return;
        const count = new Map();
        const members = new Map();
        for (const e of elems) {
            if (!e || !e.isNucleotide())
                continue;
            const g = e.clusterId || 0;
            count.set(g, (count.get(g) || 0) + 1);
            (members.get(g) || members.set(g, []).get(g)).push(e.id);
        }
        for (const [g, n] of count) {
            if (g > 0 && n === clusterSize(g))
                engine.onRigid(g, X);
            else
                engine.onMoved(members.get(g));
        }
    }
    function install() {
        const dirty = () => { invalidate(); engine.markDirty(); };
        for (const name of EDIT_FNS)
            wrap(edit, name, (orig) => function (...a) { const r = orig.apply(this, a); dirty(); return r; });
        const g = window;
        for (const name of ["colorElements"]) {
            const o = g[name];
            if (typeof o === "function") {
                g[name] = function (...a) { const r = o.apply(this, a); dirty(); return r; };
                uninstall.push(() => { g[name] = o; });
            }
        }
        const oT = g.translateElements;
        g.translateElements = function (els, v, ...rest) { const r = oT.call(this, els, v, ...rest); noteTransform(els, { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [v.x, v.y, v.z] }); return r; };
        uninstall.push(() => { g.translateElements = oT; });
        const oR = g.rotateElementsByQuaternion;
        g.rotateElementsByQuaternion = function (els, q, about, ...rest) {
            if (about === undefined) {
                about = new THREE.Vector3();
                els.forEach((e) => about.add(e.getPos()));
                about.divideScalar(els.size);
            }
            const r = oR.call(this, els, q, about, ...rest);
            const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
            const e = m.elements; // column-major
            const R = [[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]];
            const Rc = [R[0][0] * about.x + R[0][1] * about.y + R[0][2] * about.z, R[1][0] * about.x + R[1][1] * about.y + R[1][2] * about.z, R[2][0] * about.x + R[2][1] * about.y + R[2][2] * about.z];
            noteTransform(els, { R, t: [about.x - Rc[0], about.y - Rc[1], about.z - Rc[2]] });
            return r;
        };
        uninstall.push(() => { g.rotateElementsByQuaternion = oR; });
        // the user replacing the scene while synced ends the session (we never silently overwrite their file)
        const oReset = g.resetScene;
        g.resetScene = function (...a) { if (engine && !engine.applying && engine.attached) {
            detach("scene replaced in oxView");
        } return oReset.apply(this, a); };
        uninstall.push(() => { g.resetScene = oReset; });
    }
    // ------------------------------------------------------------------- UI ---
    function setPill(text, state) {
        if (!pill) {
            pill = document.createElement("div");
            pill.id = "nc-sync-pill";
            pill.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:9999;font:11px/1.2 system-ui,sans-serif;padding:4px 9px;border-radius:12px;background:#1e1f2b;color:#e2e4f0;border:1px solid #30324a;opacity:.92;pointer-events:none";
            document.body.appendChild(pill);
        }
        const col = { ok: "#23d18b", busy: "#f0a500", warn: "#f55353", off: "#8890b0" }[state];
        pill.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>NanoCanvas sync: ${text}`;
    }
    // --------------------------------------------------------------- lifecycle ---
    function attach(port, info) {
        if (!core) {
            core = NCSyncCore;
        }
        if (engine)
            detach("re-attach");
        scene = new OxScene();
        engine = new NCSyncOx.OxEngine(scene, {
            now: nowMs,
            onStatus: (s) => {
                if (s.loaded !== undefined) {
                    oxSync.stats.snapshotNts = s.loaded;
                    oxSync.stats.snapshotMs = s.ms;
                    oxSync.stats.snapshotMaxSliceMs = s.maxSliceMs;
                    setPill(`live (${s.loaded} nt)`, "ok");
                    notifyReady();
                }
                if (s.rejected) {
                    oxSync.stats.rejected++;
                    oxSync.stats.lastReject = (s.rejected.reason || "") + (s.rejected.detail ? ": " + s.rejected.detail : "");
                    setPill("edit rejected by NanoCanvas (" + oxSync.stats.lastReject.slice(0, 60) + ")", "warn");
                    try {
                        notify("NanoCanvas refused that edit: " + oxSync.stats.lastReject, "warning");
                    }
                    catch (_) { /* notify is cosmetic */ }
                }
                if (s.resync) {
                    oxSync.stats.resync++;
                    setPill("resyncing (" + s.resync + ")", "busy");
                }
            },
        });
        const transport = new core.PortTransport(port);
        peer = new core.Peer({
            role: "secondary", transport, now: nowMs,
            handlers: engine.handlers({
                onEvent(ev) { if (ev.ev === "remote") {
                    oxSync.stats.remote++;
                    const t = nowMs();
                    requestAnimationFrame(() => { if (ev.ts)
                        oxSync.stats.visible.push(nowMs() - ev.ts); oxSync.stats.applyMs.push(nowMs() - t); if (oxSync.stats.visible.length > 3000) {
                        oxSync.stats.visible.shift();
                        oxSync.stats.applyMs.shift();
                    } });
                } },
            }),
        });
        engine.attach(peer);
        install();
        setPill("connecting…", "busy");
        if (pendingMeta && restored)
            engine.restore(pendingMeta, Array.from(restored).filter(([id]) => !!elements.get(id)));
        const hadMap = engine.idmap.size > 0;
        peer.send({ t: "hello", p: 1, count: elements.size, hasMap: hadMap });
        const origSend = peer.sendDelta.bind(peer);
        peer.sendDelta = (d, tr, e) => { oxSync.stats.local++; return origSend(d, tr, e); };
        void info;
    }
    oxSync.attach = attach;
    function detach(why) {
        if (!engine)
            return;
        try {
            peer.send({ t: "bye", why });
        }
        catch (_) { /* port may be closed */ }
        engine.attached = false;
        try {
            peer.close();
        }
        catch (_) { /* ignore */ }
        uninstall.forEach((u) => u());
        uninstall = [];
        engine = null;
        peer = null;
        scene = null;
        setPill("detached (" + why + ")", "off");
    }
    oxSync.detach = detach;
    function notifyReady() { try {
        window.parent.postMessage({ type: "oxview_sync_ready" }, "*");
    }
    catch (_) { /* not embedded */ } }
    // ----------------------------------------------------------- persistence ---
    function nidOfElement(id) { return engine ? engine.idmap.nidOf(id) : (restored ? restored.get(id) : undefined); }
    oxSync.nidOfElement = nidOfElement;
    let restored = null;
    let pendingMeta = null;
    /** called by parseOxViewString for every monomer / once at the end */
    function noteLoaded(pairs, meta) {
        restored = new Map(pairs);
        pendingMeta = meta;
        if (engine)
            engine.restore(meta, pairs);
    }
    oxSync.noteLoaded = noteLoaded;
    /** consumed when the next hello is sent: lets a file that carries ids re-attach without a re-snapshot */
    function restoreIntoEngine() { if (engine && pendingMeta)
        engine.restore(pendingMeta, Array.from(restored || [])); }
    oxSync.restoreIntoEngine = restoreIntoEngine;
    function exportMeta() { return engine ? engine.exportMeta() : null; }
    oxSync.exportMeta = exportMeta;
    function oidOfStrand(strand) {
        if (!engine || !strand || !strand.end5)
            return undefined;
        const n = engine.idmap.nidOf(strand.end5.id);
        return n === undefined ? undefined : engine.registry.oidOfHead(n);
    }
    oxSync.oidOfStrand = oidOfStrand;
    // ----------------------------------------------------- debugging / tests ---
    function status() {
        const pct = (a, q) => { if (!a.length)
            return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
        return {
            attached: !!engine && engine.attached, rev: peer ? peer.rev : 0, nts: engine ? engine.idmap.size : 0, oligos: engine ? engine.registry.live.size : 0,
            visibleP50: pct(oxSync.stats.visible, 0.5), visibleP95: pct(oxSync.stats.visible, 0.95), applyP50: pct(oxSync.stats.applyMs, 0.5), peerStats: peer ? { sent: peer.stats.sent, recv: peer.stats.recv, rejected: peer.stats.rejected, rtt50: pct(peer.stats.rtt, 0.5), rtt95: pct(peer.stats.rtt, 0.95) } : null,
            snapshot: { nts: oxSync.stats.snapshotNts, ms: oxSync.stats.snapshotMs, maxSliceMs: oxSync.stats.snapshotMaxSliceMs }, remote: oxSync.stats.remote, local: oxSync.stats.local, rejected: oxSync.stats.rejected, lastReject: oxSync.stats.lastReject, resync: oxSync.stats.resync,
        };
    }
    oxSync.status = status;
    function verify() { return engine ? engine.verify() : ["not attached"]; }
    oxSync.verify = verify;
    function engineRef() { return engine; }
    oxSync.engineRef = engineRef;
    function flush() { return engine ? engine.flushNow() : null; }
    oxSync.flush = flush;
    /** CSS of the live scene (id-map projection) for tests */
    function css() { return engine ? engine.css() : null; }
    oxSync.css = css;
    function clearStats() { oxSync.stats.visible.length = 0; oxSync.stats.applyMs.length = 0; if (peer) {
        peer.stats.rtt.length = 0;
        peer.stats.transit.length = 0;
        peer.stats.apply.length = 0;
    } }
    oxSync.clearStats = clearStats;
    window.addEventListener("message", (ev) => {
        const d = ev.data;
        if (d && d.type === "nc-sync-port" && ev.ports && ev.ports[0])
            attach(ev.ports[0], d);
        else if (d && d.type === "nc-sync-detach")
            detach("detached by NanoCanvas");
    });
    window.oxSync = oxSync;
})(oxSync || (oxSync = {}));
