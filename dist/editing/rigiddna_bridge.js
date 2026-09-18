/**
 * rigiddna_bridge.ts
 *
 * Thin JS wrapper around the two WASM modules compiled from the rigidDNA
 * project (https://github.com/Subhajit-Roy-Partho/rigidDNA -- vendored
 * build artifacts live in wasm/rigid_body_sim.{js,wasm} and
 * wasm/helix_cluster.{js,wasm}, built via Emscripten from
 * rigid_body_sim/RigidBodySim.cpp and helix_cluster/HelixCluster.cpp with
 * no source changes -- both compile and run unmodified once OpenMP is left
 * off, which the C++ already handles gracefully via #ifdef _OPENMP guards).
 *
 * Both underlying programs are ordinary argv/file-I/O CLI tools; instead of
 * reworking their internals for a "real" JS API, we drive them exactly as
 * the CLI does but against Emscripten's in-memory MEMFS: write the input
 * text to virtual files, call the compiled main() via callMain(), then read
 * the output files back out as strings. This keeps the wrapper a thin,
 * low-risk shim over an unmodified, independently-tested physics core.
 */
/**
 * Lazily loads a WASM module's glue script (a plain global-scope factory
 * function, e.g. createRigidBodySimModule) by injecting a <script> tag once,
 * matching the rest of this codebase's no-bundler, global-script loading
 * convention. Safe to call repeatedly -- only injects the tag once.
 */
function loadRigidDnaScript(src, globalName) {
    if (window[globalName])
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-rigiddna="${globalName}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.dataset.rigiddna = globalName;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}
function captureLog(onLog) {
    const lines = [];
    const push = (args) => {
        const line = args.map(String).join(' ');
        lines.push(line);
        if (onLog)
            onLog(line);
    };
    return {
        moduleArg: { print: (...a) => push(a), printErr: (...a) => push(a) },
        get text() { return lines.join('\n'); },
    };
}
const RigidDnaBridge = {
    /**
     * Run rigidDNA's geometric auto-clustering (helix_cluster) on a
     * topology + configuration pair, entirely client-side. Does not
     * require a cluster_id column in the input topology (it's ignored if
     * present -- this always recomputes from geometry).
     */
    async computeClusters(topText, datText, opts = {}) {
        try {
            await loadRigidDnaScript('./wasm/helix_cluster.js', 'createHelixClusterModule');
            const { moduleArg, text } = captureLog(opts.onLog);
            const Module = await createHelixClusterModule(moduleArg);
            Module.FS.mkdir('/rd');
            Module.FS.writeFile('/rd/topology.top', topText);
            Module.FS.writeFile('/rd/conf.dat', datText);
            const args = [
                '/rd/topology.top', '/rd/conf.dat', '/rd/out',
                String(opts.angleDeg ?? 10),
                String(opts.maxMergeDist ?? 10),
                opts.clusterMode ?? 'auto',
                String(opts.bundleSize ?? 1),
                String(opts.breakLength ?? 0),
            ];
            const ret = Module.callMain(args);
            if (ret !== 0)
                return { ok: false, log: text, error: `helix_cluster exited with code ${ret}` };
            return {
                ok: true,
                clusteredTop: Module.FS.readFile('/rd/out.top', { encoding: 'utf8' }),
                particlesCsv: Module.FS.readFile('/rd/out_particles.csv', { encoding: 'utf8' }),
                bondsCsv: Module.FS.readFile('/rd/out_bonds.csv', { encoding: 'utf8' }),
                log: text,
            };
        }
        catch (err) {
            return { ok: false, log: '', error: err instanceof Error ? err.message : String(err) };
        }
    },
    /**
     * Run rigidDNA's rigid-body relaxation (rigid_body_sim) on a topology +
     * configuration pair. If the topology has no cluster_id column, or
     * opts.recluster is set, clustering is derived from geometry
     * internally (same algorithm as computeClusters(), run in-process) --
     * pass a topology whose cluster_id column already reflects the
     * clustering you want (e.g. from oxView's own DBSCAN clusterer, or a
     * prior computeClusters() call, or manual per-element selection) to
     * use that instead.
     */
    async relax(topText, datText, opts = {}) {
        try {
            await loadRigidDnaScript('./wasm/rigid_body_sim.js', 'createRigidBodySimModule');
            const { moduleArg, text } = captureLog(opts.onLog);
            const Module = await createRigidBodySimModule(moduleArg);
            Module.FS.mkdir('/rd');
            Module.FS.writeFile('/rd/topology.top', topText);
            Module.FS.writeFile('/rd/conf.dat', datText);
            const lines = [
                `steps=${opts.steps ?? 2000}`,
                `dt=${opts.dt ?? 0.01}`,
                `k=${opts.k ?? 10}`,
                `b=${opts.b ?? 0.2}`,
                `repulsion=${opts.repulsion ?? 1500}`,
                `repulsion_offset=${opts.repulsionOffset ?? 0}`,
                `topology=/rd/topology.top`,
                `conf_file=/rd/conf.dat`,
                `last_conf=/rd/last_conf.dat`,
                `recluster=${opts.recluster ? 'true' : 'false'}`,
                `cluster_mode=${opts.clusterMode ?? 'auto'}`,
                `bundle_size=${opts.bundleSize ?? 1}`,
                `cluster_angle_deg=${opts.clusterAngleDeg ?? 10}`,
                `cluster_max_merge_dist=${opts.clusterMaxMergeDist ?? 10}`,
                `print_conf_interval=0`,
            ];
            // bond_distance: one value (fixed) or "start,end" (ramp) -- see
            // the RigidDnaRelaxOptions doc comment. Omitted entirely unless
            // the caller explicitly set bondDistance, so the C++ side's own
            // cluster_size-dependent default keeps applying untouched.
            if (opts.bondDistance !== undefined) {
                const end = (opts.bondDistanceEnd !== undefined && opts.bondDistanceEnd !== opts.bondDistance)
                    ? `,${opts.bondDistanceEnd}` : '';
                lines.push(`bond_distance=${opts.bondDistance}${end}`);
            }
            if (opts.kStart !== undefined)
                lines.push(`k_start=${opts.kStart}`);
            if (opts.kIncrement !== undefined)
                lines.push(`k_increment=${opts.kIncrement}`);
            if (opts.breakLength !== undefined)
                lines.push(`break_length=${opts.breakLength}`);
            if (opts.planar) {
                lines.push(`planar=true`);
                if (opts.planeNormal)
                    lines.push(`plane_normal=${opts.planeNormal.join(',')}`);
            }
            if (opts.volumeExclusion) {
                lines.push(`volume_exclusion=true`);
                if (opts.volumeExclusionType !== undefined)
                    lines.push(`volume_exclusion_type=${opts.volumeExclusionType}`);
                if (opts.volumeExclusionCutoff !== undefined)
                    lines.push(`volume_exclusion_cutoff=${opts.volumeExclusionCutoff}`);
                if (opts.volumeExclusionK !== undefined)
                    lines.push(`volume_exclusion_k=${opts.volumeExclusionK}`);
                if (opts.volumeExclusionInterval !== undefined)
                    lines.push(`volume_exclusion_interval=${opts.volumeExclusionInterval}`);
                if (opts.volumeExclusionStart !== undefined)
                    lines.push(`volume_exclusion_start=${opts.volumeExclusionStart}`);
            }
            if (opts.energyLogInterval) {
                lines.push(`energy_log_interval=${opts.energyLogInterval}`);
                if (opts.energyLogFile)
                    lines.push(`energy_log_file=${opts.energyLogFile}`);
            }
            Module.FS.writeFile('/rd/input', lines.join('\n') + '\n');
            const ret = Module.callMain(['/rd/input']);
            if (ret !== 0)
                return { ok: false, log: text, error: `rigid_body_sim exited with code ${ret}` };
            const result = {
                ok: true,
                lastConf: Module.FS.readFile('/rd/last_conf.dat', { encoding: 'utf8' }),
                log: text,
            };
            if (Module.FS.analyzePath('/rd/topology.clustered.top').exists) {
                result.clusteredTop = Module.FS.readFile('/rd/topology.clustered.top', { encoding: 'utf8' });
            }
            return result;
        }
        catch (err) {
            return { ok: false, log: '', error: err instanceof Error ? err.message : String(err) };
        }
    },
};
window.RigidDnaBridge = RigidDnaBridge;
