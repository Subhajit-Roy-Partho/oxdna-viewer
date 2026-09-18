# rigidDNA (vendored source)

These three files are vendored, unmodified, from the private
[rigidDNA](https://github.com/Subhajit-Roy-Partho/rigidDNA) repository
(`rigid_body_sim/RigidBodySim.cpp`, `helix_cluster/HelixCluster.cpp`,
`helix_cluster/HelixClustering.hpp`), licensed GPL-3.0-or-later (see
`LICENSE` in this directory) — compatible with oxView's own
GPL-3.0-or-later license.

They're vendored here (rather than checked out from that repo at build
time) because it's private, and GitHub Actions' default `GITHUB_TOKEN` for
this repo has no access to it. This is the same "copy, not reference"
pattern already used elsewhere for this project's cross-repo dependencies
(e.g. NanoCanvas vendors a full copy of oxView itself).

`.github/workflows/deploy-pages.yml` compiles these to WebAssembly
(`wasm/rigid_body_sim.{js,wasm}`, `wasm/helix_cluster.{js,wasm}`) on every
deploy — no source changes needed, since the C++ already guards its only
OpenMP/threading usage behind `#ifdef _OPENMP`.

**To update after a change in the real rigidDNA repo**, copy the same
three files here again:

```bash
cp ../rigidDNA/rigid_body_sim/RigidBodySim.cpp wasm/rigiddna-src/rigid_body_sim/
cp ../rigidDNA/helix_cluster/HelixCluster.cpp wasm/rigiddna-src/helix_cluster/
cp ../rigidDNA/helix_cluster/HelixClustering.hpp wasm/rigiddna-src/helix_cluster/
```
