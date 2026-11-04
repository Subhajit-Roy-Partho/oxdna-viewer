# Dietz et al. 2009 beachball (database 446, 13,848 nt)

- `beachball.json` : the caDNAno v2 design (three 6-helix-bundle rings joined at six places).
- `beachball_reviewed.top` / `.dat` : the reviewed structure of run 3262 (the fork's Python route, then `rd2_repair`; oxDNA2 backbone maximum 0.795, zero bonds outside FENE).
  Its rings are compressed (radius about 17 nm, Rg 18.2 nm). It is a reference, not what the in-browser engine computes.
- The in-browser engine (rigidDNA2 WebAssembly, engine branch ring-beachball) computes three round interlocking rings (radii 22.5 / 21.4 / 23.3 nm, Rg 22.9 nm),
  Chamfer distance 4.4-4.6 nm to the reference; the two are not identical.
