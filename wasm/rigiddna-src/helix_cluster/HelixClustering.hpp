// HelixClustering.hpp
//
// Shared implementation of the base-pairing + helix-bundle clustering
// algorithm, used by both the standalone `HelixCluster` CLI tool and
// `rigid_body_sim/RigidBodySim.cpp` (which needs it to auto-cluster a
// plain oxDNA topology, or to recompute clusters when asked to via the
// `recluster` input parameter). Keeping one implementation means a fix
// to the algorithm (like the merge-threshold fix below) automatically
// applies everywhere it's used.
//
// See helix_cluster/README.md for the full algorithm writeup. Summary:
//   1. Find Watson-Crick base pairs from geometry (position + orientation),
//      using the same criteria as oxDNA-viewer's Nucleotide.findPair()
//      (ts/model/nucleotide.ts) and findBasepairs() (ts/main.ts).
//   2. Walk the base-pair "ladder" (each rung's neighbor pairs with the
//      other strand's neighbor) to group paired nucleotides into maximal
//      double-helix segments ("duplexes").
//   3. Merge duplexes directly connected by a backbone bond (a nick
//      continuing coaxially, or a crossover in a multi-helix bundle) AND
//      running in the same direction (helix axes aligned within
//      angle_deg, default 10 -- see README for why) into one rigid
//      cluster.
//   4. Assign leftover single-stranded nucleotides to a backbone-adjacent
//      cluster if one exists; group any that have none, per-strand, as
//      "noise" clusters.
//
// This header is included into exactly one translation unit by each of
// its two callers, so functions are plain (non-inline) in an anonymous
// namespace to avoid ODR surprises if that ever changes.
#pragma once

#include <algorithm>
#include <cmath>
#include <numeric>
#include <unordered_map>
#include <vector>

namespace helixcluster {

struct Vec3 {
  double x = 0, y = 0, z = 0;
  Vec3() = default;
  Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}
  Vec3 operator+(const Vec3 &o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3 &o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
  Vec3 &operator+=(const Vec3 &o) { x += o.x; y += o.y; z += o.z; return *this; }
  double dot(const Vec3 &o) const { return x * o.x + y * o.y + z * o.z; }
  double normSq() const { return x * x + y * y + z * z; }
  double norm() const { return std::sqrt(normSq()); }
  Vec3 normalized() const {
    double n = norm();
    return n > 1e-12 ? (*this) * (1.0 / n) : Vec3(0, 0, 0);
  }
};

// One nucleotide's worth of input this algorithm needs. Callers fill this
// from whatever their own topology/config structures look like.
struct NucleotideView {
  int strand = 0;
  char type = 'A';
  int n3 = -1, n5 = -1;  // topology backbone neighbors (particle index, -1 = none)
  Vec3 pos, a1, a3;
};

struct HelixInfo {
  int size = 0;
  Vec3 centroid, axis;
  int finalCluster = -1;

  HelixInfo() = default;
  HelixInfo(int size_, Vec3 centroid_, Vec3 axis_, int finalCluster_)
      : size(size_), centroid(centroid_), axis(axis_), finalCluster(finalCluster_) {}
};

struct MergeEdge {
  int h1, h2, size1, size2;
  double align, angleDeg, dist;
  bool accepted;
};

struct ClusterResult {
  std::vector<int> clusterOf;    // per-nucleotide final cluster id, compacted 0..K-1
  std::vector<HelixInfo> helices;  // per-raw-duplex diagnostics (pre-merge)
  std::vector<MergeEdge> merges;   // every candidate merge edge considered
  int basePairs = 0;
  int nucleotidesPaired = 0;
  int nHelices = 0;
  int mergeCount = 0;
  int nRealClusters = 0;
  int nNoiseClusters = 0;
  int nTotalClusters() const { return nRealClusters + nNoiseClusters; }
};

namespace detail {

inline int typeNumber(char type) {
  switch (type) {
    case 'A': return 0;
    case 'G': return 1;
    case 'C': return 2;
    case 'T': case 'U': return 3;
    default: return -1;
  }
}

struct UnionFind {
  std::vector<int> parent, rnk;
  explicit UnionFind(int n) : parent(n), rnk(n, 0) {
    std::iota(parent.begin(), parent.end(), 0);
  }
  int find(int x) {
    while (parent[x] != x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  void unite(int a, int b) {
    a = find(a);
    b = find(b);
    if (a == b) return;
    if (rnk[a] < rnk[b]) std::swap(a, b);
    parent[b] = a;
    if (rnk[a] == rnk[b]) rnk[a]++;
  }
};

// Ported from oxDNA-viewer ts/model/nucleotide.ts: Nucleotide.findPair()
constexpr double PAIR_DIST_CUTOFF = 0.6;      // initial "bestDist" in findPair()
constexpr double PAIR_ORIENT_CUTOFF = -0.85;  // a1_i . a1_j must be below this

inline int findPair(int i, const std::vector<NucleotideView> &nt) {
  const NucleotideView &ni = nt[i];
  int tni = typeNumber(ni.type);
  if (tni < 0) return -1;

  int best = -1;
  double bestDist = PAIR_DIST_CUTOFF;
  Vec3 nsI = ni.pos + ni.a1 * 0.4;
  for (size_t j = 0; j < nt.size(); ++j) {
    if ((int)j == i) continue;
    if (ni.n3 == (int)j || ni.n5 == (int)j) continue;  // not a covalent neighbor
    const NucleotideView &nj = nt[j];
    int tnj = typeNumber(nj.type);
    if (tnj < 0 || tnj == tni) continue;
    if ((tni + tnj) % 3 != 0) continue;  // A-T (0+3) or G-C (1+2) only

    Vec3 nsJ = nj.pos + nj.a1 * 0.4;
    double dist = (nsJ - nsI).norm();
    if (dist < bestDist) {
      double orient = ni.a1.dot(nj.a1);
      if (orient < PAIR_ORIENT_CUTOFF) {
        best = (int)j;
        bestDist = dist;
      }
    }
  }
  return best;
}

// findBasepairs(): one pass, mirrors ts/main.ts::findBasepairs()
inline std::vector<int> findAllBasepairs(const std::vector<NucleotideView> &nt) {
  std::vector<int> pair(nt.size(), -1);
  for (size_t i = 0; i < nt.size(); ++i) {
    if (pair[i] != -1) continue;
    int j = findPair((int)i, nt);
    if (j != -1) {
      pair[i] = j;
      pair[j] = (int)i;
    }
  }
  return pair;
}

}  // namespace detail

// Controls how the raw per-duplex helix segments (step 2 below) become
// final rigid clusters (step 3):
//   "auto"   - the original coaxial/crossover-bond heuristic: merge two
//              helices when a direct backbone bond connects them, their
//              axes align within angleDeg, and their centroids are within
//              maxMergeDist. Can merge many helices into one cluster (e.g.
//              a whole flat honeycomb sheet, where every helix is coaxial
//              with its neighbors by design) or few, depending on the
//              structure's geometry -- not directly controllable.
//   "helix"  - one rigid cluster per raw duplex segment, unconditionally.
//              No merging at all, regardless of angle/distance. This is
//              the finest possible granularity and the right choice when
//              a structure needs every individual helix free to move
//              relative to its neighbors (e.g. relaxing a flat sheet that
//              "auto" would otherwise collapse into one rigid slab).
//   "bundle" - group every `bundleSize` spatially-nearest helices (by
//              centroid distance, greedy nearest-neighbor chaining) into
//              one cluster, ignoring axis alignment entirely. A direct,
//              explicit knob for "larger cluster vs. smaller helix" when
//              neither one whole-structure cluster nor one-per-helix is
//              the right size for a given structure.
inline ClusterResult computeClusters(const std::vector<NucleotideView> &nt,
                                      double angleDeg = 10.0,
                                      double maxMergeDist = 10.0,
                                      const std::string &clusterMode = "auto",
                                      int bundleSize = 1) {
  using namespace detail;
  int N = (int)nt.size();
  double angleCos = std::cos(angleDeg * M_PI / 180.0);
  ClusterResult result;

  // --- 1. Base pairing ---------------------------------------------------
  std::vector<int> pair = findAllBasepairs(nt);
  int nPaired = 0;
  for (int p : pair) if (p != -1) nPaired++;
  result.basePairs = nPaired / 2;
  result.nucleotidesPaired = nPaired;

  // --- 2. Group paired nucleotides into duplexes via ladder adjacency ---
  UnionFind duplexUF(N);
  for (int i = 0; i < N; ++i) {
    int j = pair[i];
    if (j < 0) continue;
    duplexUF.unite(i, j);
    int i3 = nt[i].n3;
    if (i3 >= 0 && pair[i3] >= 0) {
      int j5 = nt[j].n5;
      if (j5 >= 0 && pair[i3] == j5) {
        duplexUF.unite(i, i3);
      }
    }
  }

  std::unordered_map<int, int> rootToHelix;
  std::vector<std::vector<int>> members;
  for (int i = 0; i < N; ++i) {
    if (pair[i] < 0) continue;
    int r = duplexUF.find(i);
    auto it = rootToHelix.find(r);
    int h;
    if (it == rootToHelix.end()) {
      h = (int)members.size();
      rootToHelix[r] = h;
      members.push_back({});
    } else {
      h = it->second;
    }
    members[h].push_back(i);
  }
  int nHelices = (int)members.size();
  result.nHelices = nHelices;

  // Axis direction per duplex: dominant principal axis of its nucleotides'
  // 3D positions (power iteration on the covariance matrix) -- not a3,
  // since the two antiparallel strands' a3 vectors point roughly opposite
  // ways and cancel out when averaged.
  std::vector<Vec3> axis(nHelices), centroidOf(nHelices);
  for (int h = 0; h < nHelices; ++h) {
    const auto &m = members[h];
    Vec3 centroid;
    for (int i : m) centroid += nt[i].pos;
    centroid = centroid * (1.0 / m.size());
    centroidOf[h] = centroid;

    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (int i : m) {
      Vec3 d = nt[i].pos - centroid;
      double dv[3] = {d.x, d.y, d.z};
      for (int a = 0; a < 3; ++a)
        for (int b = 0; b < 3; ++b) cov[a][b] += dv[a] * dv[b];
    }

    Vec3 v(1, 1, 1);
    for (int it = 0; it < 60; ++it) {
      double vv[3] = {v.x, v.y, v.z};
      Vec3 nv(cov[0][0] * vv[0] + cov[0][1] * vv[1] + cov[0][2] * vv[2],
              cov[1][0] * vv[0] + cov[1][1] * vv[1] + cov[1][2] * vv[2],
              cov[2][0] * vv[0] + cov[2][1] * vv[1] + cov[2][2] * vv[2]);
      Vec3 nvn = nv.normalized();
      if (nvn.normSq() < 1e-20) break;
      v = nvn;
    }
    axis[h] = v;
  }

  // --- 3. Decide final clusters from the raw per-duplex helices, per
  //        clusterMode (see the doc comment above computeClusters()).
  UnionFind clusterUF(nHelices);
  int mergeCount = 0;

  if (clusterMode == "auto") {
    // Merge duplexes connected by a direct backbone bond, if their axes run
    // in the same direction (|dot|, since antiparallel strands can have
    // opposite-signed conventions).
    for (int i = 0; i < N; ++i) {
      if (pair[i] < 0) continue;
      int k = nt[i].n3;
      if (k < 0 || pair[k] < 0) continue;
      int rh = rootToHelix[duplexUF.find(i)];
      int rk = rootToHelix[duplexUF.find(k)];
      if (rh == rk) continue;
      bool alreadySameCluster = clusterUF.find(rh) == clusterUF.find(rk);
      double align = std::fabs(axis[rh].dot(axis[rk]));
      double dist = (centroidOf[rh] - centroidOf[rk]).norm();
      // Same-direction axes alone aren't enough: a backbone bond that jumps a
      // large real-space gap to another duplex is a deliberate bridge/linker
      // between separately-designed rigid domains, not a continuation of the
      // same helix -- even when that bridge happens to preserve axis direction
      // (e.g. a straight-through nick into a parallel neighboring bundle).
      // Genuine same-helix continuations and adjacent-bundle crossovers are
      // local (single-digit su); a real inter-domain bridge stands out as a
      // clear outlier well beyond that. See helix_cluster/README.md.
      bool accepted = !alreadySameCluster && align > angleCos && dist <= maxMergeDist;
      result.merges.push_back({rh, rk, (int)members[rh].size(), (int)members[rk].size(),
                                align, std::acos(std::min(1.0, align)) * 180.0 / M_PI,
                                dist, accepted});
      if (accepted) {
        clusterUF.unite(rh, rk);
        mergeCount++;
      }
    }
  } else if (clusterMode == "helix") {
    // Finest granularity: every raw duplex segment stays its own cluster.
    // clusterUF is left as all-singletons; nothing to do. Still record the
    // candidate coaxial/crossover edges (all rejected) so the diagnostic
    // CSV output stays informative about what "auto" would have done here.
    for (int i = 0; i < N; ++i) {
      if (pair[i] < 0) continue;
      int k = nt[i].n3;
      if (k < 0 || pair[k] < 0) continue;
      int rh = rootToHelix[duplexUF.find(i)];
      int rk = rootToHelix[duplexUF.find(k)];
      if (rh == rk) continue;
      double align = std::fabs(axis[rh].dot(axis[rk]));
      double dist = (centroidOf[rh] - centroidOf[rk]).norm();
      result.merges.push_back({rh, rk, (int)members[rh].size(), (int)members[rk].size(),
                                align, std::acos(std::min(1.0, align)) * 180.0 / M_PI,
                                dist, false});
    }
  } else if (clusterMode == "bundle" && bundleSize > 1) {
    // Explicit granularity knob: group every `bundleSize` spatially-nearest
    // helices together, ignoring axis alignment. Greedy nearest-neighbor
    // chaining over helix centroids, processed in index order for a
    // reproducible result -- not globally optimal, but a direct, simple
    // way to dial between one-per-helix (bundleSize=1, same as "helix")
    // and few-large-clusters (large bundleSize) without depending on
    // whether the structure happens to be geometrically coaxial.
    std::vector<char> grouped(nHelices, 0);
    for (int h = 0; h < nHelices; ++h) {
      if (grouped[h]) continue;
      grouped[h] = 1;
      std::vector<std::pair<double, int>> neighbours;
      neighbours.reserve(nHelices);
      for (int k = 0; k < nHelices; ++k) {
        if (k == h || grouped[k]) continue;
        neighbours.emplace_back((centroidOf[h] - centroidOf[k]).norm(), k);
      }
      std::sort(neighbours.begin(), neighbours.end(),
                [](const auto &a, const auto &b) { return a.first < b.first; });
      int need = bundleSize - 1;
      for (const auto &nb : neighbours) {
        if (need <= 0) break;
        int k = nb.second;
        if (grouped[k]) continue; // claimed by an earlier anchor's bundle already
        clusterUF.unite(h, k);
        grouped[k] = 1;
        --need;
        mergeCount++;
      }
    }
  }
  // clusterMode == "bundle" with bundleSize <= 1 falls through with no
  // merging, equivalent to "helix".
  result.mergeCount = mergeCount;

  // --- 4. Assign per-nucleotide cluster ids; propagate into unpaired
  //        (single-stranded) neighbors; group leftover unpaired runs
  //        per-strand as noise clusters.
  std::vector<int> clusterOf(N, -1);
  for (int i = 0; i < N; ++i) {
    if (pair[i] < 0) continue;
    int h = rootToHelix[duplexUF.find(i)];
    clusterOf[i] = clusterUF.find(h);
  }
  bool changed = true;
  int guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (int i = 0; i < N; ++i) {
      if (clusterOf[i] != -1) continue;
      int n3 = nt[i].n3, n5 = nt[i].n5;
      if (n3 >= 0 && clusterOf[n3] != -1) { clusterOf[i] = clusterOf[n3]; changed = true; }
      else if (n5 >= 0 && clusterOf[n5] != -1) { clusterOf[i] = clusterOf[n5]; changed = true; }
    }
  }

  std::unordered_map<int, int> compact;
  for (int i = 0; i < N; ++i) {
    if (clusterOf[i] == -1) continue;
    if (!compact.count(clusterOf[i])) compact[clusterOf[i]] = (int)compact.size();
  }
  int nRealClusters = (int)compact.size();

  std::unordered_map<int, int> strandNoiseCluster;
  int nNoiseClusters = 0;
  for (int i = 0; i < N; ++i) {
    if (clusterOf[i] != -1) {
      clusterOf[i] = compact[clusterOf[i]];
    } else {
      int s = nt[i].strand;
      if (!strandNoiseCluster.count(s)) {
        strandNoiseCluster[s] = nRealClusters + nNoiseClusters;
        nNoiseClusters++;
      }
      clusterOf[i] = strandNoiseCluster[s];
    }
  }
  result.nRealClusters = nRealClusters;
  result.nNoiseClusters = nNoiseClusters;
  result.clusterOf = std::move(clusterOf);

  result.helices.resize(nHelices);
  for (int h = 0; h < nHelices; ++h) {
    int finalRoot = clusterUF.find(h);
    int finalCluster = compact.count(finalRoot) ? compact[finalRoot] : -1;
    result.helices[h] = {(int)members[h].size(), centroidOf[h], axis[h], finalCluster};
  }

  return result;
}

// Post-processing step, independent of clusterMode: slices any cluster
// whose extent along its own dominant axis exceeds breakLength into
// several shorter contiguous sub-clusters. No-op if breakLength <= 0.
//
// Motivation: a chain of coaxial/end-to-end helices -- whether merged by
// "auto"'s coaxial-crossover heuristic or "bundle"'s nearest-neighbor
// grouping -- naturally produces one long, thin rigid cluster (a rod),
// even when the actual designed structure is compact/globular (e.g. a
// folded nanobase.org structure that measures ~16,000 nt but is meant to
// occupy a roughly spherical footprint, not stay a straight cylinder
// through relaxation). A rigid rod that long can't locally curl the way
// the real structure needs to. Breaking it into shorter segments along
// its own length restores that local flexibility -- each segment moves as
// its own rigid body, connected to its neighbors by the same
// boundary-bond spring mechanism as any other cluster boundary, so no
// other code needs to know this happened.
//
// Only real (non-noise) clusters are considered -- single-stranded/noise
// clusters are typically small stray fragments, not the kind of long
// coaxial run this is meant to catch.
inline void applyBreakLength(const std::vector<NucleotideView> &nt, ClusterResult &result,
                              double breakLength) {
  if (breakLength <= 0.0) return;
  int N = (int)nt.size();
  int oldRealClusters = result.nRealClusters;

  // Gather each real cluster's members.
  std::vector<std::vector<int>> members(oldRealClusters);
  for (int i = 0; i < N; ++i) {
    int c = result.clusterOf[i];
    if (c >= 0 && c < oldRealClusters) members[c].push_back(i);
  }

  // New cluster id for every nucleotide; starts as a copy, real clusters
  // that get split are overwritten below. Noise clusters (id >=
  // oldRealClusters) are shifted up front, right after, once the final
  // split-cluster count is known.
  std::vector<int> newClusterOf = result.clusterOf;
  int nextId = 0;
  int splitCount = 0;

  for (int c = 0; c < oldRealClusters; ++c) {
    const auto &m = members[c];
    if (m.empty()) continue;
    Vec3 centroid;
    for (int i : m) centroid += nt[i].pos;
    centroid = centroid * (1.0 / (double)m.size());

    // Dominant axis via power iteration on the covariance matrix -- same
    // technique used for helix axes above, just per-cluster here.
    double cov[3][3] = {{0,0,0},{0,0,0},{0,0,0}};
    for (int i : m) {
      Vec3 d = nt[i].pos - centroid;
      double dv[3] = {d.x, d.y, d.z};
      for (int a = 0; a < 3; ++a) for (int b = 0; b < 3; ++b) cov[a][b] += dv[a] * dv[b];
    }
    Vec3 v(1, 1, 1);
    for (int it = 0; it < 60; ++it) {
      double vv[3] = {v.x, v.y, v.z};
      Vec3 nv(cov[0][0]*vv[0]+cov[0][1]*vv[1]+cov[0][2]*vv[2],
              cov[1][0]*vv[0]+cov[1][1]*vv[1]+cov[1][2]*vv[2],
              cov[2][0]*vv[0]+cov[2][1]*vv[1]+cov[2][2]*vv[2]);
      Vec3 nvn = nv.normalized();
      if (nvn.normSq() < 1e-20) break;
      v = nvn;
    }

    double tmin = 1e300, tmax = -1e300;
    std::vector<double> t(m.size());
    for (size_t k = 0; k < m.size(); ++k) {
      t[k] = (nt[m[k]].pos - centroid).dot(v);
      tmin = std::min(tmin, t[k]);
      tmax = std::max(tmax, t[k]);
    }
    double extent = tmax - tmin;

    if (extent <= breakLength) {
      for (int i : m) newClusterOf[i] = nextId;
      ++nextId;
      continue;
    }

    int nseg = (int)std::ceil(extent / breakLength);
    double binWidth = extent / nseg;
    int base = nextId;
    for (size_t k = 0; k < m.size(); ++k) {
      int bin = (int)((t[k] - tmin) / binWidth);
      if (bin >= nseg) bin = nseg - 1; // guard the tmax boundary case
      if (bin < 0) bin = 0;
      newClusterOf[m[k]] = base + bin;
    }
    nextId += nseg;
    ++splitCount;
  }

  int newRealClusters = nextId;
  // Shift noise cluster ids up to sit after the (possibly larger) new
  // real-cluster block.
  for (int i = 0; i < N; ++i) {
    if (result.clusterOf[i] >= oldRealClusters) {
      newClusterOf[i] = newRealClusters + (result.clusterOf[i] - oldRealClusters);
    }
  }

  result.clusterOf = std::move(newClusterOf);
  result.nRealClusters = newRealClusters;
  // nNoiseClusters unchanged; nHelices/helices/merges/basePairs stay as
  // diagnostics of the pre-break clustering decision, since break_length
  // is a distinct, later step.
  if (splitCount > 0) {
    std::cerr << "break_length=" << breakLength << "su: split " << splitCount
              << " over-length cluster(s) into " << (newRealClusters - (oldRealClusters - splitCount))
              << " pieces (was " << oldRealClusters << " real clusters, now " << newRealClusters << ")"
              << std::endl;
  }
}

}  // namespace helixcluster
