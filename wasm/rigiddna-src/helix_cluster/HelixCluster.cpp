// HelixCluster.cpp
//
// CLI wrapper around HelixClustering.hpp: reads an oxDNA topology +
// config, runs the base-pairing/helix-bundle clustering algorithm (see
// HelixClustering.hpp for the full writeup), and writes out the results
// for inspection (CSVs) and reuse (a topology file with a recomputed
// cluster_id column).
//
// Input:  an oxDNA topology file (.top) and configuration file (.dat/.conf),
//         in the same format used by rigid_body_sim/RigidBodySim.cpp,
//         except the existing cluster_id column in the topology (if any)
//         is read but IGNORED -- this program recomputes it from scratch.
// Output: a CSV of per-particle positions + assigned cluster id (for
//         plotting), a CSV of backbone bonds (for drawing), a topology
//         file with the recomputed cluster_id column, per-duplex and
//         per-merge diagnostics, and a text summary.
//
// Usage:
//   ./HelixCluster <topology.top> <config.dat> [output_prefix] [angle_deg]
//                  [max_merge_dist] [cluster_mode] [bundle_size]
//
//   cluster_mode (default "auto") selects how raw per-duplex helices become
//   final rigid clusters: "auto" (the coaxial/crossover-bond heuristic
//   below), "helix" (one cluster per individual helix, no merging at all --
//   use this for e.g. a flat sheet whose helices are all coaxial by design,
//   which "auto" would otherwise collapse into a single rigid slab), or
//   "bundle" (group every bundle_size spatially-nearest helices together,
//   ignoring axis alignment -- a direct granularity knob between those two
//   extremes). See HelixClustering.hpp's computeClusters() doc comment.
//
//   angle_deg (default 10) is the maximum angle between two duplexes'
//   helix axes for them to be considered "the same direction" and merged
//   when directly bonded. In practice a designed (non-thermalized)
//   structure's angle distribution between directly-bonded duplexes is
//   sharply bimodal: genuine same-direction connections sit under ~3
//   degrees, and every real junction/kink sits at ~18 degrees or more --
//   there is an empty gap in between. Any threshold inside that gap gives
//   identical results; 10 was chosen for margin on both sides. A
//   threshold in the 25-35 range (an earlier default) let at least one
//   genuine ~18 degree junction through, incorrectly fusing two separate
//   rigid bundles into one.

#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "HelixClustering.hpp"

using helixcluster::NucleotideView;
using helixcluster::Vec3;

static std::vector<NucleotideView> readTopology(const std::string &path, int &nStrandsOut) {
  std::ifstream f(path);
  if (!f) {
    std::cerr << "Error: cannot open topology file " << path << "\n";
    std::exit(1);
  }
  std::string line;
  std::getline(f, line);
  std::istringstream hs(line);
  int nParticles = 0, nStrands = 0, nClustersIgnored = 0;
  hs >> nParticles >> nStrands >> nClustersIgnored;
  nStrandsOut = nStrands;

  std::vector<NucleotideView> nt(nParticles);
  int idx = 0;
  while (std::getline(f, line) && idx < nParticles) {
    if (line.empty()) continue;
    std::istringstream ss(line);
    std::string typeStr;
    NucleotideView n;
    ss >> n.strand >> typeStr >> n.n3 >> n.n5;
    n.type = typeStr.empty() ? 'A' : typeStr[0];
    nt[idx++] = n;
  }
  if (idx != nParticles) {
    std::cerr << "Warning: topology header says " << nParticles
              << " particles, but read " << idx << "\n";
  }
  return nt;
}

static void readConfig(const std::string &path, std::vector<NucleotideView> &nt) {
  std::ifstream f(path);
  if (!f) {
    std::cerr << "Error: cannot open config file " << path << "\n";
    std::exit(1);
  }
  std::string line;
  std::getline(f, line);  // t = ...
  std::getline(f, line);  // b = ...
  std::getline(f, line);  // E = ...

  size_t idx = 0;
  while (std::getline(f, line) && idx < nt.size()) {
    if (line.empty()) continue;
    std::istringstream ss(line);
    Vec3 p, a1, a3;
    ss >> p.x >> p.y >> p.z >> a1.x >> a1.y >> a1.z >> a3.x >> a3.y >> a3.z;
    nt[idx].pos = p;
    nt[idx].a1 = a1;
    nt[idx].a3 = a3;
    idx++;
  }
  if (idx != nt.size()) {
    std::cerr << "Warning: config has " << idx << " particle lines, topology expects "
              << nt.size() << "\n";
  }
}

int main(int argc, char **argv) {
  if (argc < 3) {
    std::cerr << "Usage: " << argv[0]
              << " <topology.top> <config.dat> [output_prefix] [angle_deg] [max_merge_dist]"
                 " [cluster_mode: auto|helix|bundle] [bundle_size] [break_length]\n";
    return 1;
  }
  std::string topPath = argv[1];
  std::string confPath = argv[2];
  std::string prefix = argc > 3 ? argv[3] : "helix_cluster_out";
  double angleDeg = argc > 4 ? std::atof(argv[4]) : 10.0;
  double maxMergeDist = argc > 5 ? std::atof(argv[5]) : 10.0;
  std::string clusterMode = argc > 6 ? argv[6] : "auto";
  int bundleSize = argc > 7 ? std::atoi(argv[7]) : 1;
  double breakLength = argc > 8 ? std::atof(argv[8]) : 0.0;

  int nStrands = 0;
  std::vector<NucleotideView> nt = readTopology(topPath, nStrands);
  readConfig(confPath, nt);
  int N = (int)nt.size();
  std::cout << "Loaded " << N << " particles, " << nStrands << " strands from "
            << topPath << " / " << confPath << "\n";

  helixcluster::ClusterResult r =
      helixcluster::computeClusters(nt, angleDeg, maxMergeDist, clusterMode, bundleSize);
  if (breakLength > 0.0) {
    helixcluster::applyBreakLength(nt, r, breakLength);
    std::cout << "After break_length=" << breakLength << ": " << r.nRealClusters
              << " rigid clusters + " << r.nNoiseClusters << " noise cluster(s) = "
              << r.nTotalClusters() << " total\n";
  }

  std::cout << "Base pairs found: " << r.basePairs << " (" << r.nucleotidesPaired << "/" << N
            << " nucleotides paired)\n";
  std::cout << "Duplex (double-helix) segments found: " << r.nHelices << "\n";
  std::cout << "Cluster mode: " << clusterMode
            << (clusterMode == "bundle" ? (" (bundle_size=" + std::to_string(bundleSize) + ")") : "")
            << " -- " << r.mergeCount << " helix-group merges performed"
            << (clusterMode == "auto" ? (" (angle threshold " + std::to_string(angleDeg) +
                                          " deg, max merge distance " + std::to_string(maxMergeDist) + " su)")
                                       : "") << "\n";

  std::vector<int> clusterSizes(r.nTotalClusters(), 0);
  for (int c : r.clusterOf) clusterSizes[c]++;
  std::cout << "Final rigid clusters: " << r.nRealClusters
            << " (from duplex merging) + " << r.nNoiseClusters
            << " single-stranded/noise cluster(s) = " << r.nTotalClusters() << " total\n";
  for (int c = 0; c < r.nTotalClusters(); ++c) {
    std::cout << "  cluster " << c << ": " << clusterSizes[c] << " particles"
              << (c >= r.nRealClusters ? "  [single-stranded / noise]" : "") << "\n";
  }

  // --- Output files ------------------------------------------------------
  {
    std::ofstream out(prefix + "_particles.csv");
    out << "id,strand,x,y,z,cluster_id,noise\n";
    for (int i = 0; i < N; ++i) {
      out << i << "," << nt[i].strand << "," << nt[i].pos.x << "," << nt[i].pos.y << ","
          << nt[i].pos.z << "," << r.clusterOf[i] << ","
          << (r.clusterOf[i] >= r.nRealClusters ? 1 : 0) << "\n";
    }
  }
  {
    std::ofstream out(prefix + "_bonds.csv");
    out << "i,j\n";
    for (int i = 0; i < N; ++i) {
      if (nt[i].n3 >= 0) out << i << "," << nt[i].n3 << "\n";
    }
  }
  {
    // Topology file with the recomputed cluster_id column, same format
    // RigidBodySim.cpp reads (strand type n3 n5 cluster_id).
    std::ofstream out(prefix + ".top");
    out << N << " " << nStrands << " " << r.nTotalClusters() << "\n";
    for (int i = 0; i < N; ++i) {
      out << nt[i].strand << " " << nt[i].type << " " << nt[i].n3 << " " << nt[i].n5
          << " " << r.clusterOf[i] << "\n";
    }
  }
  {
    std::ofstream out(prefix + "_helices.csv");
    out << "helix_id,size,cx,cy,cz,ax,ay,az,final_cluster\n";
    for (size_t h = 0; h < r.helices.size(); ++h) {
      const auto &hi = r.helices[h];
      out << h << "," << hi.size << "," << hi.centroid.x << "," << hi.centroid.y << ","
          << hi.centroid.z << "," << hi.axis.x << "," << hi.axis.y << "," << hi.axis.z << ","
          << hi.finalCluster << "\n";
    }
  }
  {
    std::ofstream out(prefix + "_merges.csv");
    out << "h1,h2,size1,size2,align,angle_deg,dist,accepted\n";
    for (const auto &m : r.merges) {
      out << m.h1 << "," << m.h2 << "," << m.size1 << "," << m.size2 << "," << m.align << ","
          << m.angleDeg << "," << m.dist << "," << (m.accepted ? 1 : 0) << "\n";
    }
  }

  std::cout << "Wrote " << prefix << "_particles.csv, " << prefix << "_bonds.csv, "
            << prefix << ".top, " << prefix << "_helices.csv, " << prefix << "_merges.csv\n";
  return 0;
}
