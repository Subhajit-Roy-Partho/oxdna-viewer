#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
#include <array>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <unordered_map>
#ifdef _OPENMP
#include <omp.h>
#endif

#include "../helix_cluster/HelixClustering.hpp"

using namespace std;

// --- AsyncTrajectoryWriter Class ---
class AsyncTrajectoryWriter {
private:
  std::ofstream file;
  std::queue<std::string> buffer_queue;
  std::mutex queue_mutex;
  std::condition_variable queue_cv;
  std::thread writer_thread;
  bool running;
  
public:
  AsyncTrajectoryWriter(const std::string& filename) : running(true) {
    file.open(filename);
    if (!file.is_open()) {
      std::cerr << "Error opening trajectory file: " << filename << std::endl;
      running = false;
      return;
    }
    
    writer_thread = std::thread([this]() {
      while (running) {
        std::unique_lock<std::mutex> lock(queue_mutex);
        queue_cv.wait(lock, [this]() { return !buffer_queue.empty() || !running; });
        
        while (!buffer_queue.empty()) {
          std::string data = std::move(buffer_queue.front());
          buffer_queue.pop();
          lock.unlock();
          
          file.write(data.c_str(), data.size());
          
          lock.lock();
        }
        
        if (!running && buffer_queue.empty()) break;
      }
    });
  }
  
  ~AsyncTrajectoryWriter() {
    {
      std::lock_guard<std::mutex> lock(queue_mutex);
      running = false;
    }
    queue_cv.notify_all();
    if (writer_thread.joinable()) {
      writer_thread.join();
    }
  }
  
  void write(const std::string& data) {
    std::lock_guard<std::mutex> lock(queue_mutex);
    buffer_queue.push(data);
    queue_cv.notify_one();
  }
  
  bool is_open() const { return file.is_open(); }
};

// --- Vector3 Class ---
struct Vector3 {
  double x, y, z;

  Vector3(double x = 0, double y = 0, double z = 0) : x(x), y(y), z(z) {}

  Vector3 operator+(const Vector3 &other) const {
    return Vector3(x + other.x, y + other.y, z + other.z);
  }
  Vector3 operator-(const Vector3 &other) const {
    return Vector3(x - other.x, y - other.y, z - other.z);
  }
  Vector3 operator*(double s) const { return Vector3(x * s, y * s, z * s); }
  Vector3 operator/(double s) const { return Vector3(x / s, y / s, z / s); }
  Vector3 &operator+=(const Vector3 &other) {
    x += other.x;
    y += other.y;
    z += other.z;
    return *this;
  }
  Vector3 &operator-=(const Vector3 &other) {
    x -= other.x;
    y -= other.y;
    z -= other.z;
    return *this;
  }

  double dot(const Vector3 &other) const {
    return x * other.x + y * other.y + z * other.z;
  }
  Vector3 cross(const Vector3 &other) const {
    return Vector3(y * other.z - z * other.y, z * other.x - x * other.z,
                   x * other.y - y * other.x);
  }
  double norm() const { return std::sqrt(x * x + y * y + z * z); }
  double norm2() const { return x * x + y * y + z * z; }
  Vector3 normalized() const {
    double n = norm();
    double inv_n = (n > 1e-10) ? 1.0 / n : 0.0;
    return Vector3(x * inv_n, y * inv_n, z * inv_n);
  }
};

Vector3 operator*(double s, const Vector3 &v) { return v * s; }

// --- Matrix3 Class (for Inertia Tensor) ---
struct Matrix3 {
  double m[3][3];

  Matrix3() {
    for (int i = 0; i < 3; ++i)
      for (int j = 0; j < 3; ++j)
        m[i][j] = 0;
  }

  static Matrix3 identity() {
    Matrix3 res;
    res.m[0][0] = res.m[1][1] = res.m[2][2] = 1;
    return res;
  }

  Vector3 operator*(const Vector3 &v) const {
    return Vector3(m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
                   m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
                   m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z);
  }

  Matrix3 operator+(const Matrix3 &other) const {
    Matrix3 res;
    for (int i = 0; i < 3; ++i)
      for (int j = 0; j < 3; ++j)
        res.m[i][j] = m[i][j] + other.m[i][j];
    return res;
  }



  

  // Inverse using determinant (assuming symmetric/invertible)
  Matrix3 inverse() const {
    double det = m[0][0] * (m[1][1] * m[2][2] - m[2][1] * m[1][2]) -
                 m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                 m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

    Matrix3 res;
    if (std::abs(det) < 1e-10)
      return res; // Return zero matrix if singular

    double invDet = 1.0 / det;
    res.m[0][0] = (m[1][1] * m[2][2] - m[2][1] * m[1][2]) * invDet;
    res.m[0][1] = (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet;
    res.m[0][2] = (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet;
    res.m[1][0] = (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet;
    res.m[1][1] = (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet;
    res.m[1][2] = (m[1][0] * m[0][2] - m[0][0] * m[1][2]) * invDet;
    res.m[2][0] = (m[1][0] * m[2][1] - m[2][0] * m[1][1]) * invDet;
    res.m[2][1] = (m[2][0] * m[0][1] - m[0][0] * m[2][1]) * invDet;
    res.m[2][2] = (m[0][0] * m[1][1] - m[1][0] * m[0][1]) * invDet;
    return res;
  }
};

// --- Quaternion Class ---
struct Quaternion {
  double w, x, y, z;

  Quaternion(double w = 1, double x = 0, double y = 0, double z = 0)
      : w(w), x(x), y(y), z(z) {}

  Quaternion normalized() const {
    double n = std::sqrt(w * w + x * x + y * y + z * z);
    return (n > 1e-10) ? Quaternion(w / n, x / n, y / n, z / n)
                       : Quaternion(1, 0, 0, 0);
  }

  Vector3 rotate(const Vector3 &v) const {
    // v' = q * v * q_inv
    // Optimized implementation (reduces operations)
    const double wx2 = 2.0 * w * x;
    const double wy2 = 2.0 * w * y;
    const double wz2 = 2.0 * w * z;
    const double xx2 = 2.0 * x * x;
    const double yy2 = 2.0 * y * y;
    const double zz2 = 2.0 * z * z;
    const double xy2 = 2.0 * x * y;
    const double xz2 = 2.0 * x * z;
    const double yz2 = 2.0 * y * z;
    
    return Vector3(
        (1.0 - yy2 - zz2) * v.x + (xy2 - wz2) * v.y + (xz2 + wy2) * v.z,
        (xy2 + wz2) * v.x + (1.0 - xx2 - zz2) * v.y + (yz2 - wx2) * v.z,
        (xz2 - wy2) * v.x + (yz2 + wx2) * v.y + (1.0 - xx2 - yy2) * v.z);
  }

  // Integration: q_new = q + 0.5 * w_vec * q * dt
  Quaternion integrate(const Vector3 &omega, double dt) const {
    // dq/dt = 0.5 * omega * q
    double half_dt = 0.5 * dt;
    double nw = -half_dt * (omega.x * x + omega.y * y + omega.z * z);
    double nx = half_dt * (omega.x * w + omega.y * z - omega.z * y);
    double ny = half_dt * (omega.y * w + omega.z * x - omega.x * z);
    double nz = half_dt * (omega.z * w + omega.x * y - omega.y * x);

    Quaternion result(w + nw, x + nx, y + ny, z + nz);
    double n = std::sqrt(result.w * result.w + result.x * result.x + 
                         result.y * result.y + result.z * result.z);
    if (n > 1e-10) {
      double inv_n = 1.0 / n;
      result.w *= inv_n;
      result.x *= inv_n;
      result.y *= inv_n;
      result.z *= inv_n;
    }
    return result;
  }
};

// --- Particle Struct ---
struct Particle {
  int id;
  int strand_id;
  std::string base_name;
  int n3, n5; // Neighbors
  int cluster_id;

  Vector3 pos;
  Vector3 a1, a3;
  Vector3 L, v; // Angular momentum, Linear velocity

  // Relative to Cluster
  Vector3 rel_pos;
  Vector3 rel_a1, rel_a3; // In body frame
};

// --- Cluster Struct ---
struct Cluster {
  int id;
  std::vector<int> particle_ids;
  double mass;
  double radius;

  Vector3 com;
  Quaternion orientation; // Orientation of body frame relative to world
  Vector3 P;              // Linear Momentum
  Vector3 L;              // Angular Momentum

  Matrix3 I_body; // Inertia Tensor in body frame
  Matrix3 I_inv_body;

  Vector3 force;
  Vector3 torque;

  // Computed state
  Vector3 v;
  Vector3 omega;
};

// --- Simulation Class ---
class Simulation {
public:
  std::vector<Particle> particles;
  std::vector<Cluster> clusters;

  // A backbone bond (i, n3-neighbor j) whose two ends fall in different
  // rigid clusters, so it needs an actual spring force to hold it together
  // (bonds inside one cluster move together automatically and need no
  // force).
  struct BoundaryBond {
    int i, j;
  };

  // cluster_id and n3 are fixed at load time and never change during run(),
  // so this set is constant for the whole simulation - computed once in
  // initRigidBodies() instead of re-scanned from all particles every step.
  std::vector<BoundaryBond> boundary_bonds;

  // Parameters
  int steps;
  double k_spring;
  double b_damp;
  double repulsion_k;
  double repulsion_offset;
  double dt = 0.005; // Time step

  // bond_distance (r0, the spring's target rest length for every
  // cross-cluster bond): the single most consequential knob for
  // many-cluster relaxation, and easy to get wrong (a honeycomb-sheet run
  // tuned to r0=2 for a single giant cluster held together fine, but the
  // same r0=2 applied per-helix left every crossover stretched 2-10su,
  // because 2su is nothing like a real ~0.75su backbone bond -- see
  // rigidDNA/README.md's bond_distance section for the full writeup and
  // measurements). Two ways to set it in the input file:
  //   bond_distance=<r0>            fixed target for the whole run
  //   bond_distance=<start>,<end>   linear ramp from `start` at step 0 to
  //                                 `end`, reached either at
  //                                 volume_exclusion_start (if volume
  //                                 exclusion is enabled -- the two are
  //                                 designed to be used together: hold
  //                                 bonds loose/far apart while repulsion
  //                                 sorts out gross overlaps, THEN tighten
  //                                 toward the real bond length once
  //                                 per-nucleotide steric checking is
  //                                 active to catch anything the tightening
  //                                 pulls into a clash) or at `steps`
  //                                 otherwise, and held there after.
  // If bond_distance is omitted entirely, the default is chosen from
  // cluster_size: 2.0 for "large" (few big clusters -- a looser bond
  // distance leaves slack that helps avoid inter-cluster clashes and
  // converges fast, and was the original, deliberately-chosen default for
  // that regime) or 0.75 for "helix" (many small clusters, one per
  // individual helix -- must be close to the real backbone bond length,
  // ~0.7564su, or crossover connections between neighboring helices end up
  // permanently overstretched).
  double bond_distance_start = 2.0;
  double bond_distance_end = 2.0;     // == start unless a ramp was requested
  bool bond_distance_is_ramp = false;
  bool bond_distance_explicit = false; // true once bond_distance= (or legacy r0=) is read; false means "apply the cluster_size-based default once cluster_size is known"
  double r0_current = 2.0;             // working value for the current step, set in initRigidBodies() and advanced in stepPhysics()
  int bond_distance_ramp_end_step = 0; // step at which r0_current reaches bond_distance_end; resolved in initRigidBodies()
  long long current_step = 0;          // advanced once per stepPhysics() call; drives the bond_distance ramp and volume_exclusion_start gating

  // Ramped spring constant: lets clusters that start overlapping/misplaced
  // get pushed apart by repulsion first (with springs off or weak), then
  // pulled back into their bonded configuration as k ramps up to k_spring.
  // Defaults reproduce the old fixed-k behavior exactly: k_spring_start
  // < 0 is a sentinel meaning "start at k_spring" and k_spring_increment
  // of 0 means "never change it".
  double k_spring_start = -1.0;
  double k_spring_increment = 0.0;
  double k_spring_current = 0.0; // working value, set in initRigidBodies()

  // Optional periodic log of total system kinetic energy, for judging how
  // quickly a run settles toward equilibrium (0 = disabled).
  int energy_log_interval = 0;
  std::string energy_log_file;

  std::string last_conf_file;
  std::string topology_file;
  std::string conf_file;
  std::string trajectory_file; // Single file for all interval configurations
  Vector3 box;

  // Configuration printing interval (0 = disabled, N = print every N steps)
  int print_conf_interval = 0;

  // Optimization flags
  bool trajectory_print_momenta = true;  // Print velocity and angular momentum
  int trajectory_precision = 8;          // Decimal places for output (0-15)
  int num_threads = 6;

  // Clustering: if the topology has no cluster_id column at all (a plain
  // oxDNA .top file), it is always auto-clustered. If it already has one,
  // it's used as-is unless `recluster=true` is set, in which case the
  // cluster ids are recomputed from geometry and the result is written to
  // a new topology file alongside the original.
  bool recluster = false;
  double cluster_angle_deg = 10.0; // see helix_cluster/README.md
  double cluster_max_merge_dist = 10.0; // reject coaxial merges that jump a large real-space gap (a genuine inter-domain bridge, not a helix continuation)
  // Granularity of auto-clustering/reclustering. Primary input key is
  // `cluster_size`, with two documented values:
  //   cluster_size=large  -- the original coaxial/crossover-alignment
  //                          heuristic (internally cluster_mode="auto"):
  //                          can merge many helices into one cluster if
  //                          they're all geometrically coaxial (e.g. a flat
  //                          sheet, or a normal 3D bundle's straight runs).
  //                          Few, large rigid bodies -> fast convergence,
  //                          more slack against local clashes.
  //   cluster_size=helix  -- one rigid cluster per individual helix, no
  //                          merging (internally cluster_mode="helix").
  //                          Many, small rigid bodies -> every helix free
  //                          to move relative to its neighbors, needed when
  //                          "large" would collapse a structure that should
  //                          be able to fold locally (e.g. a flat sheet)
  //                          into one immovable slab.
  // `cluster_mode` ("auto"|"helix"|"bundle") and `bundle_size` remain
  // available directly for the intermediate "bundle" granularity (group
  // every bundle_size spatially-nearest helices together) -- see
  // HelixClustering.hpp. `cluster_size`, if given, overrides `cluster_mode`.
  std::string cluster_mode = "auto";
  int bundle_size = 1;
  bool needs_clustering = false;   // set once the topology is read
  int n_strands = 0;
  int n_clusters_in_file = 0;

  // break_length (su, 0 = disabled/default): slices any cluster whose
  // extent along its own dominant axis exceeds this into several shorter
  // contiguous pieces, regardless of cluster_size/cluster_mode. For a
  // structure that's compact/globular by design but ends up clustered
  // into one long rod (a chain of coaxial helices merged end-to-end, e.g.
  // a folded nanobase.org structure ~16,000nt that should occupy a
  // roughly spherical footprint), this restores the local flexibility to
  // actually fold instead of staying rigid over its whole length. See
  // HelixClustering.hpp's applyBreakLength().
  double break_length = 0.0;

  // Planar relaxation: constrains every rigid cluster to translate only
  // within a plane and rotate only about that plane's normal (3 DOF instead
  // of 6 per cluster) -- for origami that is designed flat and should stay
  // flat through relaxation instead of folding/curling in 3D. If planar is
  // enabled and no plane_normal is given explicitly, the normal is
  // auto-detected from the whole structure's initial geometry (the
  // least-variance principal axis -- see computePlaneNormal()).
  bool planar = false;
  Vector3 plane_normal = Vector3(0, 0, 1);
  bool plane_normal_set = false;

  // --- Volume exclusion: optional, additional steric-clash checking on
  // top of the always-on cluster-sphere repulsion (see stepPhysics()'s
  // "Repulsion Forces" step). Three algorithms, literature-grounded (full
  // writeup + benchmark in README.md's Volume Exclusion section):
  //   volume_exclusion_type=1  Per-nucleotide (rigorous). A uniform-grid
  //     cell list (Allen & Tildesley, "Computer Simulation of Liquids",
  //     ch.5; the same technique oxDNA's own CellLists/VerletList use)
  //     bins every particle by position, so each particle only checks the
  //     ~27 nearby cells instead of all N others -- O(N) instead of O(N^2).
  //     Any pair under volume_exclusion_cutoff apart, in different
  //     clusters, is pushed apart. Catches everything a coarser check
  //     could miss, at real per-step cost.
  //   volume_exclusion_type=2  Cluster outline. Each cluster's oriented
  //     bounding box (OBB: PCA axes, half-extent = max projection along
  //     each) is tested against every other cluster's via the Separating
  //     Axis Theorem (Gottschalk et al., "OBBTree", SIGGRAPH 1996; Ericson,
  //     "Real-Time Collision Detection", ch.4) -- 15 candidate separating
  //     axes (3+3 face normals, 9 edge-cross-products). Overlapping boxes
  //     are pushed apart along the minimum-penetration axis. O(clusters^2),
  //     as cheap as the existing sphere repulsion but shape-aware, so it
  //     catches long/bent clusters a bounding sphere would miss.
  //   volume_exclusion_type=3  Capsule (fast, approximate). Each cluster is
  //     reduced to a line segment (its two extreme points along its
  //     dominant principal axis) plus a radius (max perpendicular distance
  //     of any of its particles from that segment) -- a capsule. Pairs are
  //     tested via the standard closest-point-between-two-segments
  //     algorithm (Ericson, ch.5.1.9) and pushed apart if closer than the
  //     sum of radii. Cheaper than an OBB test and much better than a
  //     single bounding sphere for long, thin clusters (a helix bundle's
  //     natural shape).
  // volume_exclusion_start delays activation (default: steps/2 if left at
  // -1) -- turning it on from step 0, while repulsion is still pushing
  // freshly-overlapping clusters apart, fights that separation instead of
  // helping; it's meant for the settled, final stage of a run (naturally
  // paired with a bond_distance ramp finishing around the same step).
  bool volume_exclusion = false;
  int volume_exclusion_type = 1;
  double volume_exclusion_cutoff = 0.3;   // su; type 1 only (type 2/3 use each cluster's own real geometry, no separate cutoff needed)
  double volume_exclusion_k = 1500.0;
  int volume_exclusion_interval = 1;      // recheck every N steps (type 1's cell list is rebuilt each time it runs)
  int volume_exclusion_start = -1;        // step index; -1 sentinel = steps/2, resolved once `steps` is known

  void readInput(const std::string &filename) {
    std::ifstream file(filename);
    if (!file.is_open()) {
      std::cerr << "Error opening input file: " << filename << std::endl;
      exit(1);
    }
    std::string line;
    while (std::getline(file, line)) {
      if (line.empty() || line[0] == '#')
        continue;
      std::stringstream ss(line);
      std::string key, val;
      if (std::getline(ss, key, '=') && std::getline(ss, val)) {
        if (key == "steps")
          steps = std::stoi(val);
        else if (key == "k")
          k_spring = std::stod(val);
        else if (key == "b")
          b_damp = std::stod(val);
        else if (key == "repulsion")
          repulsion_k = std::stod(val);
        else if (key == "repulsion_offset")
          repulsion_offset = std::stod(val);
        else if (key == "r0" || key == "bond_distance") {
          // Accept either one value (fixed r0 for the whole run) or two
          // comma-separated values (linear ramp start,end -- see the
          // bond_distance_* member declarations above for the full story).
          std::stringstream bss(val);
          std::string comp;
          std::vector<double> vals;
          while (std::getline(bss, comp, ','))
            vals.push_back(std::stod(comp));
          if (vals.size() == 1) {
            bond_distance_start = bond_distance_end = vals[0];
            bond_distance_is_ramp = false;
          } else if (vals.size() == 2) {
            bond_distance_start = vals[0];
            bond_distance_end = vals[1];
            bond_distance_is_ramp = true;
          } else {
            std::cerr << "Warning: bond_distance expects 1 value (fixed) or 2 "
                         "comma-separated values (ramp start,end), got: " << val << std::endl;
          }
          bond_distance_explicit = true;
        }
        else if (key == "last_conf")
          last_conf_file = val;
        else if (key == "dt")
          dt = std::stod(val);
        else if (key == "topology")
          topology_file = val;
        else if (key == "conf_file")
          conf_file = val;
        else if (key == "trajectory_file")
          trajectory_file = val;
        else if (key == "print_conf_interval")
          print_conf_interval = std::stoi(val);
        else if (key == "trajectory_print_momenta")
          trajectory_print_momenta = (val != "false" && val != "0");
        else if (key == "trajectory_precision")
          trajectory_precision = std::stoi(val);
        else if (key == "num_threads")
          num_threads = std::stoi(val);
        else if (key == "recluster")
          recluster = (val == "true" || val == "True" || val == "TRUE" || val == "1");
        else if (key == "cluster_angle_deg")
          cluster_angle_deg = std::stod(val);
        else if (key == "cluster_max_merge_dist")
          cluster_max_merge_dist = std::stod(val);
        else if (key == "cluster_mode")
          cluster_mode = val;
        else if (key == "bundle_size")
          bundle_size = std::stoi(val);
        else if (key == "break_length")
          break_length = std::stod(val);
        else if (key == "cluster_size") {
          // Primary, documented alias: cluster_size=large|helix.
          if (val == "large") cluster_mode = "auto";
          else if (val == "helix") cluster_mode = "helix";
          else std::cerr << "Warning: cluster_size expects 'large' or 'helix', got: " << val
                          << " -- use cluster_mode=auto|helix|bundle directly for other options." << std::endl;
        }
        else if (key == "volume_exclusion")
          volume_exclusion = (val == "true" || val == "True" || val == "TRUE" || val == "1");
        else if (key == "volume_exclusion_type")
          volume_exclusion_type = std::stoi(val);
        else if (key == "volume_exclusion_cutoff")
          volume_exclusion_cutoff = std::stod(val);
        else if (key == "volume_exclusion_k")
          volume_exclusion_k = std::stod(val);
        else if (key == "volume_exclusion_interval")
          volume_exclusion_interval = std::stoi(val);
        else if (key == "volume_exclusion_start")
          volume_exclusion_start = std::stoi(val);
        else if (key == "planar")
          planar = (val == "true" || val == "True" || val == "TRUE" || val == "1");
        else if (key == "plane_normal") {
          std::stringstream pss(val);
          std::string comp;
          std::vector<double> v3;
          while (std::getline(pss, comp, ','))
            v3.push_back(std::stod(comp));
          if (v3.size() == 3) {
            plane_normal = Vector3(v3[0], v3[1], v3[2]).normalized();
            plane_normal_set = true;
          } else {
            std::cerr << "Warning: plane_normal expects 3 comma-separated values, got: "
                      << val << " -- ignoring, will auto-detect instead." << std::endl;
          }
        }
        else if (key == "k_start")
          k_spring_start = std::stod(val);
        else if (key == "k_increment")
          k_spring_increment = std::stod(val);
        else if (key == "energy_log_interval")
          energy_log_interval = std::stoi(val);
        else if (key == "energy_log_file")
          energy_log_file = val;
      }
    }
  }

  // Reads a topology in either format:
  //   - plain oxDNA: header "N S", body "strand type n3 n5" (4 columns) --
  //     no cluster info at all, so needs_clustering is set and the
  //     simulation will always auto-cluster before running.
  //   - rigidDNA: header "N S C", body "strand type n3 n5 cluster_id" (5
  //     columns) -- used as-is unless `recluster=true`.
  // Cluster construction itself is deferred to finalizeClusters() (called
  // after readConf(), since auto-clustering/reclustering needs the
  // particle positions and orientations from the .dat file too).
  void readTopology(const std::string &filename) {
    std::ifstream file(filename);
    if (!file.is_open()) {
      std::cerr << "Error opening topology file: " << filename << std::endl;
      exit(1);
    }
    std::string headerLine;
    std::getline(file, headerLine);
    std::istringstream hs(headerLine);
    std::vector<int> headerVals;
    int v;
    while (hs >> v) headerVals.push_back(v);

    int n_particles = headerVals.size() > 0 ? headerVals[0] : 0;
    n_strands = headerVals.size() > 1 ? headerVals[1] : 0;
    bool has_cluster_column = headerVals.size() >= 3;
    n_clusters_in_file = has_cluster_column ? headerVals[2] : 0;
    needs_clustering = !has_cluster_column;

    particles.resize(n_particles);
    std::string line;
    int idx = 0;
    while (std::getline(file, line) && idx < n_particles) {
      if (line.empty())
        continue;
      std::istringstream ss(line);
      Particle &p = particles[idx];
      p.id = idx;
      p.cluster_id = -1;
      if (has_cluster_column) {
        ss >> p.strand_id >> p.base_name >> p.n3 >> p.n5 >> p.cluster_id;
      } else {
        ss >> p.strand_id >> p.base_name >> p.n3 >> p.n5;
      }
      idx++;
    }
    if (idx != n_particles) {
      std::cerr << "Warning: topology header says " << n_particles
                << " particles, but read " << idx << std::endl;
    }
    std::cout << "Read topology: " << n_particles << " particles, " << n_strands
              << " strands, " << (has_cluster_column ? "cluster_id column present"
                                                      : "no cluster_id column (plain oxDNA)")
              << std::endl;
  }

  // Builds the `clusters` vector's particle_ids from each particle's
  // (already-decided) cluster_id. Called once cluster ids are final --
  // either read from the file as-is, or just computed by finalizeClusters().
  void buildClustersFromIds(int n_clusters) {
    clusters.assign(n_clusters, Cluster());
    for (int i = 0; i < n_clusters; ++i)
      clusters[i].id = i;
    for (const auto &p : particles) {
      if (p.cluster_id >= 0 && p.cluster_id < n_clusters) {
        clusters[p.cluster_id].particle_ids.push_back(p.id);
      }
    }
  }

  static std::string deriveClusteredTopologyPath(const std::string &orig) {
    size_t dot = orig.rfind('.');
    std::string base = (dot != std::string::npos) ? orig.substr(0, dot) : orig;
    std::string ext = (dot != std::string::npos) ? orig.substr(dot) : ".top";
    return base + ".clustered" + ext;
  }

  void saveClusteredTopology(const std::string &path, int n_clusters) {
    std::ofstream out(path);
    if (!out.is_open()) {
      std::cerr << "Warning: could not write reclustered topology to " << path
                << std::endl;
      return;
    }
    out << particles.size() << " " << n_strands << " " << n_clusters << "\n";
    for (const auto &p : particles) {
      out << p.strand_id << " " << p.base_name << " " << p.n3 << " " << p.n5 << " "
          << p.cluster_id << "\n";
    }
    std::cout << "Saved reclustered topology to " << path << std::endl;
    topology_file = path; // the in-memory state now matches this file
  }

  // Decides, after the topology and initial configuration are both loaded,
  // whether cluster ids need to be (re)computed from geometry -- and if
  // so, does it, saves the result to disk, and builds `clusters` from it.
  // Otherwise just builds `clusters` from the ids already read from the
  // topology file.
  void finalizeClusters() {
    if (needs_clustering || recluster) {
      std::vector<helixcluster::NucleotideView> nt(particles.size());
      for (size_t i = 0; i < particles.size(); ++i) {
        const Particle &p = particles[i];
        nt[i].strand = p.strand_id;
        nt[i].type = p.base_name.empty() ? 'A' : p.base_name[0];
        nt[i].n3 = p.n3;
        nt[i].n5 = p.n5;
        nt[i].pos = helixcluster::Vec3(p.pos.x, p.pos.y, p.pos.z);
        nt[i].a1 = helixcluster::Vec3(p.a1.x, p.a1.y, p.a1.z);
        nt[i].a3 = helixcluster::Vec3(p.a3.x, p.a3.y, p.a3.z);
      }
      helixcluster::ClusterResult result = helixcluster::computeClusters(
          nt, cluster_angle_deg, cluster_max_merge_dist, cluster_mode, bundle_size);

      std::cout << (needs_clustering ? "Auto-clustering" : "Reclustering")
                << " (no cluster_id in topology, or recluster=true), mode=" << cluster_mode
                << (cluster_mode == "bundle" ? (" bundle_size=" + std::to_string(bundle_size)) : "")
                << ": " << result.basePairs << " base pairs, " << result.nHelices
                << " duplex segments, " << result.mergeCount
                << " helix-group merges -> " << result.nRealClusters
                << " rigid clusters + " << result.nNoiseClusters
                << " single-stranded/noise cluster(s) = " << result.nTotalClusters()
                << " total." << std::endl;

      // Post-process: slice any cluster longer than break_length along its
      // own axis into shorter pieces (0 = disabled, the default -- see
      // HelixClustering.hpp's applyBreakLength() for why this exists).
      if (break_length > 0.0) {
        helixcluster::applyBreakLength(nt, result, break_length);
        std::cout << "After break_length: " << result.nRealClusters
                  << " rigid clusters + " << result.nNoiseClusters
                  << " single-stranded/noise cluster(s) = " << result.nTotalClusters()
                  << " total." << std::endl;
      }

      for (size_t i = 0; i < particles.size(); ++i)
        particles[i].cluster_id = result.clusterOf[i];

      buildClustersFromIds(result.nTotalClusters());
      saveClusteredTopology(deriveClusteredTopologyPath(topology_file),
                             result.nTotalClusters());
    } else {
      buildClustersFromIds(n_clusters_in_file);
    }
  }

  void readConf(const std::string &filename) {
    std::ifstream file(filename);
    if (!file.is_open()) {
      std::cerr << "Error opening conf file: " << filename << std::endl;
      exit(1);
    }
    std::string line;
    // Skip metadata lines or parse them
    std::getline(file, line); // t = 0
    std::getline(file, line); // b = ...
    if (line.substr(0, 4) == "b = ") {
      std::stringstream ss(line.substr(4));
      ss >> box.x >> box.y >> box.z;
    }
    std::getline(file, line); // E = ...

    for (int i = 0; i < particles.size(); ++i) {
      if (!std::getline(file, line))
        break;
      std::stringstream ss(line);
      Particle &p = particles[i];
      ss >> p.pos.x >> p.pos.y >> p.pos.z >> p.a1.x >> p.a1.y >> p.a1.z >>
          p.a3.x >> p.a3.y >> p.a3.z >> p.L.x >> p.L.y >> p.L.z >> p.v.x >>
          p.v.y >> p.v.z;
    }
  }

  void initRigidBodies() {
    #pragma omp parallel for
    for (int i = 0; i < clusters.size(); ++i) {
      Cluster& cluster = clusters[i];
      if (cluster.particle_ids.empty())
        continue;

      // 1. Calculate COM
      Vector3 com(0, 0, 0);
      double total_mass = 0;
      for (int pid : cluster.particle_ids) {
        com += particles[pid].pos; // Assuming mass=1
        total_mass += 1.0;
      }
      cluster.com = com / total_mass;
      cluster.mass = total_mass;

      // 2. Calculate Radius and Inertia
      cluster.radius = 0;
      Matrix3 I;
      for (int pid : cluster.particle_ids) {
        Vector3 r = particles[pid].pos - cluster.com;
        double dist = r.norm();
        if (dist > cluster.radius)
          cluster.radius = dist;

        // Inertia: m * (r^2 * Identity - r * r^T)
        double r2 = r.dot(r);
        I.m[0][0] += r2 - r.x * r.x;
        I.m[0][1] += -r.x * r.y;
        I.m[0][2] += -r.x * r.z;
        I.m[1][0] += -r.y * r.x;
        I.m[1][1] += r2 - r.y * r.y;
        I.m[1][2] += -r.y * r.z;
        I.m[2][0] += -r.z * r.x;
        I.m[2][1] += -r.z * r.y;
        I.m[2][2] += r2 - r.z * r.z;
      }
      // Add particle intrinsic inertia? Assuming point particles for now for
      // simplicity, or rather, the cluster inertia dominates.

      // 3. Set Orientation (Identity initially, as we define body frame =
      // current frame)
      cluster.orientation = Quaternion(1, 0, 0, 0);
      cluster.I_body = I; // Since orientation is identity, I_body = I_current
      cluster.I_inv_body = I.inverse();

      // 4. Store relative positions
      for (int pid : cluster.particle_ids) {
        particles[pid].rel_pos = particles[pid].pos - cluster.com;
        particles[pid].rel_a1 = particles[pid].a1; // Since R=I
        particles[pid].rel_a3 = particles[pid].a3;
      }

      // 5. Initialize Momentum (Zero for relaxation, or from particles?)
      // User said "relax DNA strand quickly". Zero velocity is best for
      // minimization/relaxation start.
      cluster.P = Vector3(0, 0, 0);
      cluster.L = Vector3(0, 0, 0);
      cluster.v = Vector3(0, 0, 0);
      cluster.omega = Vector3(0, 0, 0);
    }

    // Resolve bond_distance's cluster_size-dependent default, now that
    // cluster_mode is final (set during readInput()/finalizeClusters(),
    // both of which run before initRigidBodies()). Only kicks in if the
    // input file gave neither bond_distance= nor the legacy r0=.
    if (!bond_distance_explicit) {
      bond_distance_start = bond_distance_end = (cluster_mode == "helix") ? 0.75 : 2.0;
    }
    r0_current = bond_distance_start;

    // Resolve volume_exclusion_start's default (steps/2) now that `steps`
    // is known, and derive where the bond_distance ramp should finish: at
    // volume_exclusion_start if volume exclusion is on (so tightening
    // finishes right as per-nucleotide/cluster-shape checking takes over
    // to catch anything the tightening pulls into a clash), else at the
    // last step.
    if (volume_exclusion && volume_exclusion_start < 0) {
      volume_exclusion_start = steps / 2;
    }
    bond_distance_ramp_end_step = volume_exclusion ? std::max(1, volume_exclusion_start) : steps;

    // Precompute the (typically tiny) set of cross-cluster bonds once, so
    // stepPhysics() doesn't have to scan every particle on every step.
    boundary_bonds.clear();
    for (int i = 0; i < (int)particles.size(); ++i) {
      int j = particles[i].n3;
      if (j >= 0 && j < (int)particles.size() &&
          particles[i].cluster_id != particles[j].cluster_id) {
        boundary_bonds.push_back({i, j});
      }
    }
    std::cout << "Boundary bonds (cross-cluster springs): " << boundary_bonds.size()
              << ", bond_distance="
              << (bond_distance_is_ramp
                      ? (std::to_string(bond_distance_start) + " -> " +
                         std::to_string(bond_distance_end) + "su by step " +
                         std::to_string(bond_distance_ramp_end_step))
                      : (std::to_string(bond_distance_start) + "su fixed"))
              << (volume_exclusion
                      ? (" | volume_exclusion type=" + std::to_string(volume_exclusion_type) +
                         " starting at step " + std::to_string(volume_exclusion_start))
                      : "")
              << std::endl;

    // Starting value for the (optionally ramped) spring constant. With
    // k_spring_start left at its default (-1), this is just k_spring, so
    // behavior is unchanged unless the user opts into ramping.
    k_spring_current = (k_spring_start >= 0.0) ? k_spring_start : k_spring;
  }

  // Auto-detects the best-fit plane's normal from the whole structure's
  // initial geometry: power-iterate for the two dominant (largest-
  // variance, in-plane) axes of the particle-position covariance matrix,
  // then the normal is their cross product -- equivalent to the smallest-
  // eigenvalue eigenvector of a real symmetric 3x3 matrix, without needing
  // a general eigensolver. Only runs when planar=true and no explicit
  // plane_normal was given; called once, before initRigidBodies().
  void computePlaneNormal() {
    if (!planar || plane_normal_set) return;
    Vector3 centroid;
    for (const auto &p : particles) centroid += p.pos;
    centroid = centroid / (double)particles.size();

    Matrix3 cov;
    for (const auto &p : particles) {
      Vector3 d = p.pos - centroid;
      cov.m[0][0] += d.x * d.x; cov.m[0][1] += d.x * d.y; cov.m[0][2] += d.x * d.z;
      cov.m[1][0] += d.y * d.x; cov.m[1][1] += d.y * d.y; cov.m[1][2] += d.y * d.z;
      cov.m[2][0] += d.z * d.x; cov.m[2][1] += d.z * d.y; cov.m[2][2] += d.z * d.z;
    }

    auto powerIterate = [](const Matrix3 &M) {
      Vector3 v(1, 1, 1);
      for (int it = 0; it < 100; ++it) {
        Vector3 nv = M * v;
        double n = nv.norm();
        if (n < 1e-20) break;
        v = nv / n;
      }
      return v;
    };

    Vector3 axis1 = powerIterate(cov);
    // Deflate: cov' = cov - lambda1 * axis1 * axis1^T, so the next power
    // iteration converges to the second-largest-variance axis instead of
    // re-finding axis1.
    double lambda1 = axis1.dot(cov * axis1);
    Matrix3 deflated = cov;
    deflated.m[0][0] -= lambda1 * axis1.x * axis1.x;
    deflated.m[0][1] -= lambda1 * axis1.x * axis1.y;
    deflated.m[0][2] -= lambda1 * axis1.x * axis1.z;
    deflated.m[1][0] -= lambda1 * axis1.y * axis1.x;
    deflated.m[1][1] -= lambda1 * axis1.y * axis1.y;
    deflated.m[1][2] -= lambda1 * axis1.y * axis1.z;
    deflated.m[2][0] -= lambda1 * axis1.z * axis1.x;
    deflated.m[2][1] -= lambda1 * axis1.z * axis1.y;
    deflated.m[2][2] -= lambda1 * axis1.z * axis1.z;
    Vector3 axis2 = powerIterate(deflated);

    plane_normal = axis1.cross(axis2).normalized();
    std::cout << "Planar mode: auto-detected plane normal (" << plane_normal.x << ", "
              << plane_normal.y << ", " << plane_normal.z << ")" << std::endl;
  }

  // --- Volume exclusion -----------------------------------------------

  // Type 1: per-nucleotide, via a uniform-grid cell list. O(N): each
  // particle only checks the ~27 cells around it instead of all N others.
  // Any pair under volume_exclusion_cutoff apart, in different clusters,
  // is pushed apart -- the force is applied to each PARTICLE's cluster
  // (force + torque about that cluster's COM), since particles themselves
  // aren't independently integrated.
  void applyVolumeExclusionPerNucleotide() {
    const double cell = volume_exclusion_cutoff;
    auto cellKey = [cell](double x, double y, double z) {
      long long ix = (long long)std::floor(x / cell);
      long long iy = (long long)std::floor(y / cell);
      long long iz = (long long)std::floor(z / cell);
      // Pack into one 64-bit key; safe for any coordinate magnitude this
      // simulation will ever see (each axis gets 20 bits, +/-500k cells).
      auto wrap = [](long long v) { return (v + (1LL << 19)) & ((1LL << 20) - 1); };
      return (wrap(ix) << 40) | (wrap(iy) << 20) | wrap(iz);
    };

    std::unordered_map<long long, std::vector<int>> grid;
    grid.reserve(particles.size() * 2);
    for (int i = 0; i < (int)particles.size(); ++i) {
      grid[cellKey(particles[i].pos.x, particles[i].pos.y, particles[i].pos.z)].push_back(i);
    }

    for (int i = 0; i < (int)particles.size(); ++i) {
      const Particle &pi = particles[i];
      long long ix = (long long)std::floor(pi.pos.x / cell);
      long long iy = (long long)std::floor(pi.pos.y / cell);
      long long iz = (long long)std::floor(pi.pos.z / cell);
      for (long long dx = -1; dx <= 1; ++dx)
        for (long long dy = -1; dy <= 1; ++dy)
          for (long long dz = -1; dz <= 1; ++dz) {
            auto it = grid.find(cellKey((ix + dx) * cell, (iy + dy) * cell, (iz + dz) * cell));
            if (it == grid.end()) continue;
            for (int j : it->second) {
              if (j <= i) continue; // each unordered pair once
              const Particle &pj = particles[j];
              if (pi.cluster_id == pj.cluster_id) continue; // rigid together already, can't clash with itself
              Vector3 rij = pi.pos - pj.pos;
              double d = rij.norm();
              if (d < 1e-10 || d >= volume_exclusion_cutoff) continue;
              double f_mag = volume_exclusion_k * (1.0 - d / volume_exclusion_cutoff);
              Vector3 f = rij * (f_mag / d);
              Vector3 ri = pi.pos - clusters[pi.cluster_id].com;
              Vector3 rj = pj.pos - clusters[pj.cluster_id].com;
              clusters[pi.cluster_id].force += f;
              clusters[pi.cluster_id].torque += ri.cross(f);
              clusters[pj.cluster_id].force -= f;
              clusters[pj.cluster_id].torque += rj.cross(f * -1.0);
            }
          }
    }
  }

  // Shared by types 2 and 3: this cluster's dominant principal axis (unit
  // vector) via power iteration on its particles' position covariance,
  // same technique as computePlaneNormal() but per-cluster and only the
  // single largest axis (a cluster's own "long direction").
  static Vector3 dominantAxis(const std::vector<Vector3> &pts, const Vector3 &centroid) {
    Matrix3 cov;
    for (const auto &p : pts) {
      Vector3 d = p - centroid;
      cov.m[0][0] += d.x * d.x; cov.m[0][1] += d.x * d.y; cov.m[0][2] += d.x * d.z;
      cov.m[1][0] += d.y * d.x; cov.m[1][1] += d.y * d.y; cov.m[1][2] += d.y * d.z;
      cov.m[2][0] += d.z * d.x; cov.m[2][1] += d.z * d.y; cov.m[2][2] += d.z * d.z;
    }
    Vector3 v(1, 1, 1);
    for (int it = 0; it < 100; ++it) {
      Vector3 nv = cov * v;
      double n = nv.norm();
      if (n < 1e-20) break;
      v = nv / n;
    }
    return v;
  }

  // Type 2: cluster outline via oriented bounding boxes (OBB) and the
  // Separating Axis Theorem (SAT). Each cluster's OBB: center = COM, one
  // axis = its dominant principal axis, the other two completed by
  // Gram-Schmidt from an arbitrary perpendicular start, half-extents = max
  // |projection| of its own particles onto each axis (guaranteed to
  // contain every particle). Two OBBs are tested along 15 candidate
  // separating axes (3+3 face normals, 9 edge-cross-products); if none
  // separates them, they overlap, and are pushed apart along whichever
  // axis had the smallest overlap (the minimum translation vector).
  struct OBB { Vector3 center, axis[3]; double half[3]; };

  std::vector<OBB> buildOBBs() {
    std::vector<OBB> obbs(clusters.size());
    for (int c = 0; c < (int)clusters.size(); ++c) {
      const Cluster &cl = clusters[c];
      OBB &b = obbs[c];
      b.center = cl.com;
      if (cl.particle_ids.empty()) { b.axis[0]=Vector3(1,0,0); b.axis[1]=Vector3(0,1,0); b.axis[2]=Vector3(0,0,1); b.half[0]=b.half[1]=b.half[2]=0; continue; }
      std::vector<Vector3> pts;
      pts.reserve(cl.particle_ids.size());
      for (int pid : cl.particle_ids) pts.push_back(particles[pid].pos);
      Vector3 a0 = dominantAxis(pts, cl.com);
      if (a0.norm2() < 1e-20) a0 = Vector3(1, 0, 0);
      // Any vector not parallel to a0, Gram-Schmidt'd, gives a valid
      // second axis; the third completes a right-handed orthonormal frame.
      Vector3 seed = (std::fabs(a0.x) < 0.9) ? Vector3(1, 0, 0) : Vector3(0, 1, 0);
      Vector3 a1 = (seed - a0 * seed.dot(a0)).normalized();
      Vector3 a2 = a0.cross(a1);
      b.axis[0] = a0; b.axis[1] = a1; b.axis[2] = a2;
      b.half[0] = b.half[1] = b.half[2] = 1e-6; // avoid a degenerate zero-extent box
      for (const auto &p : pts) {
        Vector3 d = p - cl.com;
        for (int k = 0; k < 3; ++k) b.half[k] = std::max(b.half[k], std::fabs(d.dot(b.axis[k])));
      }
    }
    return obbs;
  }

  void applyVolumeExclusionOBB() {
    std::vector<OBB> obbs = buildOBBs();
    for (int i = 0; i < (int)clusters.size(); ++i) {
      if (clusters[i].particle_ids.empty()) continue;
      for (int j = i + 1; j < (int)clusters.size(); ++j) {
        if (clusters[j].particle_ids.empty()) continue;
        const OBB &A = obbs[i];
        const OBB &B = obbs[j];
        Vector3 d = B.center - A.center;

        double bestOverlap = 1e300;
        Vector3 bestAxis;
        bool separated = false;

        // 15 candidate axes: A's 3, B's 3, then the 9 pairwise cross
        // products (edge-edge separating axes for two boxes).
        std::vector<Vector3> axes;
        axes.reserve(15);
        for (int k = 0; k < 3; ++k) axes.push_back(A.axis[k]);
        for (int k = 0; k < 3; ++k) axes.push_back(B.axis[k]);
        for (int p = 0; p < 3; ++p)
          for (int q = 0; q < 3; ++q) {
            Vector3 c = A.axis[p].cross(B.axis[q]);
            if (c.norm2() > 1e-12) axes.push_back(c.normalized());
          }

        for (const auto &axis : axes) {
          double rA = 0, rB = 0;
          for (int k = 0; k < 3; ++k) {
            rA += std::fabs(A.axis[k].dot(axis)) * A.half[k];
            rB += std::fabs(B.axis[k].dot(axis)) * B.half[k];
          }
          double dist = std::fabs(d.dot(axis));
          double overlap = rA + rB - dist;
          if (overlap <= 0) { separated = true; break; } // a separating axis exists -> no overlap at all
          if (overlap < bestOverlap) { bestOverlap = overlap; bestAxis = axis; }
        }

        if (separated) continue;
        // Push apart along the minimum-penetration axis, oriented from A
        // to B, scaled like the existing sphere repulsion (proportional to
        // penetration depth).
        if (bestAxis.dot(d) < 0) bestAxis = bestAxis * -1.0;
        Vector3 f = bestAxis * (volume_exclusion_k * bestOverlap);
        clusters[i].force -= f;
        clusters[j].force += f;
        // Applied at each cluster's COM (no torque contribution) -- OBBs
        // already capture each cluster's real shape/orientation, so a
        // COM-only push is enough to separate them without also fighting
        // the spring network with spurious rotation.
      }
    }
  }

  // Type 3: capsule approximation (fast). Each cluster reduced to a line
  // segment (its two extreme points along its dominant principal axis)
  // plus a radius (max perpendicular distance of its particles from that
  // segment). Cheaper than OBB/SAT and much better than a single bounding
  // sphere for long, thin clusters. Segment-segment closest distance via
  // the standard algorithm (Ericson, "Real-Time Collision Detection",
  // 5.1.9).
  struct Capsule { Vector3 p0, p1; double radius; };

  std::vector<Capsule> buildCapsules() {
    std::vector<Capsule> caps(clusters.size());
    for (int c = 0; c < (int)clusters.size(); ++c) {
      const Cluster &cl = clusters[c];
      Capsule &cap = caps[c];
      if (cl.particle_ids.empty()) { cap.p0 = cap.p1 = cl.com; cap.radius = 0; continue; }
      std::vector<Vector3> pts;
      pts.reserve(cl.particle_ids.size());
      for (int pid : cl.particle_ids) pts.push_back(particles[pid].pos);
      Vector3 axis = dominantAxis(pts, cl.com);
      if (axis.norm2() < 1e-20) axis = Vector3(0, 0, 1);
      double tmin = 1e300, tmax = -1e300, rmax = 1e-6;
      for (const auto &p : pts) {
        Vector3 d = p - cl.com;
        double t = d.dot(axis);
        tmin = std::min(tmin, t);
        tmax = std::max(tmax, t);
        double perp = (d - axis * t).norm();
        rmax = std::max(rmax, perp);
      }
      cap.p0 = cl.com + axis * tmin;
      cap.p1 = cl.com + axis * tmax;
      cap.radius = rmax;
    }
    return caps;
  }

  // Closest points between segments (p0,p1) and (q0,q1); returns the
  // closest points and their distance. Standard clamped-parametric
  // approach (Ericson 5.1.9), specialized to just what's needed here.
  static double segmentSegmentClosest(const Vector3 &p0, const Vector3 &p1,
                                       const Vector3 &q0, const Vector3 &q1,
                                       Vector3 &outP, Vector3 &outQ) {
    Vector3 d1 = p1 - p0, d2 = q1 - q0, r = p0 - q0;
    double a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
    double s, t;
    if (a < 1e-12 && e < 1e-12) { s = t = 0.0; }
    else if (a < 1e-12) { s = 0.0; t = std::clamp(f / e, 0.0, 1.0); }
    else {
      double c = d1.dot(r);
      if (e < 1e-12) { t = 0.0; s = std::clamp(-c / a, 0.0, 1.0); }
      else {
        double b = d1.dot(d2);
        double denom = a * e - b * b;
        s = (denom > 1e-12) ? std::clamp((b * f - c * e) / denom, 0.0, 1.0) : 0.0;
        t = (b * s + f) / e;
        if (t < 0.0) { t = 0.0; s = std::clamp(-c / a, 0.0, 1.0); }
        else if (t > 1.0) { t = 1.0; s = std::clamp((b - c) / a, 0.0, 1.0); }
      }
    }
    outP = p0 + d1 * s;
    outQ = q0 + d2 * t;
    return (outP - outQ).norm();
  }

  void applyVolumeExclusionCapsule() {
    std::vector<Capsule> caps = buildCapsules();
    for (int i = 0; i < (int)clusters.size(); ++i) {
      if (clusters[i].particle_ids.empty()) continue;
      for (int j = i + 1; j < (int)clusters.size(); ++j) {
        if (clusters[j].particle_ids.empty()) continue;
        Vector3 cp, cq;
        double d = segmentSegmentClosest(caps[i].p0, caps[i].p1, caps[j].p0, caps[j].p1, cp, cq);
        double limit = caps[i].radius + caps[j].radius;
        if (d >= limit || d < 1e-10) continue;
        Vector3 dir = (cp - cq) * (1.0 / d);
        Vector3 f = dir * (volume_exclusion_k * (1.0 - d / limit));
        Vector3 ri = cp - clusters[i].com;
        Vector3 rj = cq - clusters[j].com;
        clusters[i].force += f;
        clusters[i].torque += ri.cross(f);
        clusters[j].force -= f;
        clusters[j].torque += rj.cross(f * -1.0);
      }
    }
  }

  void applyVolumeExclusion() {
    switch (volume_exclusion_type) {
      case 1: applyVolumeExclusionPerNucleotide(); break;
      case 2: applyVolumeExclusionOBB(); break;
      case 3: applyVolumeExclusionCapsule(); break;
      default:
        std::cerr << "Warning: unknown volume_exclusion_type=" << volume_exclusion_type
                  << ", expected 1, 2, or 3 -- skipping." << std::endl;
    }
  }

  // Advances the system by one timestep: connection/spring forces,
  // repulsion, damping, integration, and writing the new state back to
  // particles.
  //
  // Threading strategy: there are only ~10 clusters (rigid bodies), and
  // (thanks to boundary_bonds, precomputed once in initRigidBodies())
  // typically only a few dozen cross-cluster bonds - both far too small to
  // be worth parallelizing; the OpenMP fork/join and barrier overhead of a
  // "#pragma omp parallel for" costs more than these loops themselves
  // (verified: parallelizing loops this small made the whole step 2-10x
  // SLOWER, worse as thread count grows). So all of that runs serially,
  // with no atomics needed. The only loop that scales with particle count
  // - applying the new rigid-body state to all particles - is the one
  // parallel region per step, flattened over all particles (not chunked by
  // cluster) so work is spread evenly regardless of cluster sizes.
  void stepPhysics() {
    // Ramp the working spring constant toward its target (k_spring). With
    // k_spring_increment left at 0 (the default), k_spring_current never
    // changes, reproducing the old fixed-k behavior exactly.
    if (k_spring_increment > 0.0) {
      k_spring_current = std::min(k_spring, k_spring_current + k_spring_increment);
    } else if (k_spring_increment < 0.0) {
      k_spring_current = std::max(k_spring, k_spring_current + k_spring_increment);
    }

    // Advance the bond_distance ramp (no-op, r0_current pinned at
    // bond_distance_start == bond_distance_end, unless a ramp was
    // requested via bond_distance=start,end).
    if (bond_distance_is_ramp) {
      double t = std::min(1.0, (double)current_step / (double)bond_distance_ramp_end_step);
      r0_current = bond_distance_start + (bond_distance_end - bond_distance_start) * t;
    } else {
      r0_current = bond_distance_start;
    }

    // Reset forces (serial - trivial cost for a handful of clusters).
    for (auto &c : clusters) {
      c.force = Vector3(0, 0, 0);
      c.torque = Vector3(0, 0, 0);
    }

    // 1. Connection Forces (Damped Harmonic Oscillator), over the
    // precomputed set of bonds that actually cross a cluster boundary -
    // intra-cluster bonds move rigidly together and never exert force.
    for (const auto &bond : boundary_bonds) {
      const Particle &p_i = particles[bond.i];
      const Particle &p_j = particles[bond.j];

      Vector3 r_ij = p_i.pos - p_j.pos;
      double dist = r_ij.norm();
      double inv_dist = (dist > 1e-10) ? 1.0 / dist : 0.0;
      Vector3 dir(r_ij.x * inv_dist, r_ij.y * inv_dist, r_ij.z * inv_dist);

      // Spring Force: F = -k(|r| - r0) * dir. Both k and r0 can ramp over
      // the run (k_spring_current / r0_current); with no ramp requested,
      // both are simply constant.
      Vector3 f_spring = dir * (-k_spring_current * (dist - r0_current));

      // Damping Force: F = -b * (v_i - v_j)
      Vector3 r_i = p_i.pos - clusters[p_i.cluster_id].com;
      Vector3 r_j = p_j.pos - clusters[p_j.cluster_id].com;
      Vector3 v_i = clusters[p_i.cluster_id].v + clusters[p_i.cluster_id].omega.cross(r_i);
      Vector3 v_j = clusters[p_j.cluster_id].v + clusters[p_j.cluster_id].omega.cross(r_j);
      Vector3 v_rel = v_i - v_j;
      Vector3 f_damp(v_rel.x * -b_damp, v_rel.y * -b_damp, v_rel.z * -b_damp);

      Vector3 total_f = f_spring + f_damp;

      // Apply to Cluster i
      clusters[p_i.cluster_id].force += total_f;
      clusters[p_i.cluster_id].torque += r_i.cross(total_f);

      // Apply to Cluster j (Newton's 3rd Law)
      clusters[p_j.cluster_id].force -= total_f;
      clusters[p_j.cluster_id].torque += r_j.cross(total_f * -1.0);
    }

    // 2. Repulsion Forces (O(clusters^2), a few dozen pairs at most).
    for (int i = 0; i < (int)clusters.size(); ++i) {
      for (int j = i + 1; j < (int)clusters.size(); ++j) {
        Cluster &c1 = clusters[i];
        Cluster &c2 = clusters[j];

        Vector3 r_12 = c1.com - c2.com;
        double d = r_12.norm();
        double limit = c1.radius + c2.radius + repulsion_offset;

        if (d < limit && d > 1e-10) {
          double f_mag = repulsion_k * (1.0 - d / limit);
          double inv_d = 1.0 / d;
          Vector3 f_vec(r_12.x * f_mag * inv_d, r_12.y * f_mag * inv_d, r_12.z * f_mag * inv_d);
          c1.force += f_vec;
          c2.force -= f_vec;
        }
      }
    }

    // 2.5. Volume exclusion (optional, off by default): additional steric
    // checking beyond the sphere-sphere repulsion above. Only runs once
    // the run has reached volume_exclusion_start, and even then only every
    // volume_exclusion_interval steps -- see the member declarations above
    // for why (activating from step 0 fights the initial repulsion-driven
    // separation instead of helping).
    if (volume_exclusion && current_step >= volume_exclusion_start &&
        (current_step - volume_exclusion_start) % volume_exclusion_interval == 0) {
      applyVolumeExclusion();
    }

    // 3. Global rotational damping, integration, and precomputing each
    // cluster's rotation matrix for the particle-update pass below.
    std::vector<std::array<double, 9>> rotMat(clusters.size());
    for (int i = 0; i < (int)clusters.size(); ++i) {
      Cluster &c = clusters[i];
      if (c.particle_ids.empty())
        continue;

      // Global Rotational Damping: Torque_damp = -b * omega, scaled by
      // radius^2 for consistent units/magnitude with linear damping.
      double damping_factor =
          b_damp * (c.radius > 1.0 ? c.radius * c.radius : 1.0);
      c.torque -= damping_factor * c.omega;

      // Planar constraint (optional, off by default): remove any
      // out-of-plane force/torque component before it can accumulate into
      // momentum, so a cluster with zero out-of-plane momentum never
      // acquires any -- exact, not a post-hoc correction. Leaves 3 DOF per
      // cluster (2 in-plane translation + 1 rotation about the normal)
      // instead of 6. See plane_normal/computePlaneNormal().
      if (planar) {
        c.force -= plane_normal * c.force.dot(plane_normal);
        c.torque = plane_normal * c.torque.dot(plane_normal);
      }

      // Update Momentum
      c.P += c.force * dt;
      c.L += c.torque * dt;

      if (planar) {
        // Belt-and-suspenders: also strip any out-of-plane momentum
        // directly, so floating-point drift or a nonzero starting
        // momentum can never accumulate an out-of-plane drift over a long
        // run.
        c.P -= plane_normal * c.P.dot(plane_normal);
        c.L = plane_normal * c.L.dot(plane_normal);
      }

      // Update Velocity
      c.v = c.P / c.mass;

      // Update Omega: L_body = R^T * L_world, omega_body = I_inv_body *
      // L_body, omega_world = R * omega_body (via quaternion rotation).
      Quaternion q_conj(c.orientation.w, -c.orientation.x,
                        -c.orientation.y, -c.orientation.z);
      Vector3 L_body = q_conj.rotate(c.L);
      Vector3 omega_body = c.I_inv_body * L_body;
      c.omega = c.orientation.rotate(omega_body);
      if (planar) {
        // A cluster's inertia tensor has no reason to treat plane_normal as
        // a principal axis, so I_inv_body can turn a purely-normal L into
        // an omega with an in-plane (tilting) component even though the
        // torque driving it was already projected above -- reproject the
        // result too, so tilt can never accumulate.
        c.omega = plane_normal * c.omega.dot(plane_normal);
      }

      // Update Position
      c.com += c.v * dt;

      // Update Orientation
      c.orientation = c.orientation.integrate(c.omega, dt);

      // Precompute rotation matrix for the particle-update pass below.
      const Quaternion &q = c.orientation;
      const double wx2 = 2.0 * q.w * q.x, wy2 = 2.0 * q.w * q.y, wz2 = 2.0 * q.w * q.z;
      const double xx2 = 2.0 * q.x * q.x, yy2 = 2.0 * q.y * q.y, zz2 = 2.0 * q.z * q.z;
      const double xy2 = 2.0 * q.x * q.y, xz2 = 2.0 * q.x * q.z, yz2 = 2.0 * q.y * q.z;
      rotMat[i] = {1.0 - yy2 - zz2, xy2 - wz2, xz2 + wy2,
                   xy2 + wz2, 1.0 - xx2 - zz2, yz2 - wx2,
                   xz2 - wy2, yz2 + wx2, 1.0 - xx2 - yy2};
    }

    // 4. Apply new rigid-body state to all particles - the only loop whose
    // cost scales with particle count, so the only one worth parallelizing.
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < (int)particles.size(); ++i) {
      Particle &p = particles[i];
      int cid = p.cluster_id;
      if (cid < 0 || cid >= (int)clusters.size())
        continue;
      const Cluster &c = clusters[cid];
      const std::array<double, 9> &m = rotMat[cid];

      // Position
      const Vector3 &r = p.rel_pos;
      p.pos.x = c.com.x + m[0] * r.x + m[1] * r.y + m[2] * r.z;
      p.pos.y = c.com.y + m[3] * r.x + m[4] * r.y + m[5] * r.z;
      p.pos.z = c.com.z + m[6] * r.x + m[7] * r.y + m[8] * r.z;

      // Orientation vectors
      const Vector3 &a1 = p.rel_a1;
      p.a1.x = m[0] * a1.x + m[1] * a1.y + m[2] * a1.z;
      p.a1.y = m[3] * a1.x + m[4] * a1.y + m[5] * a1.z;
      p.a1.z = m[6] * a1.x + m[7] * a1.y + m[8] * a1.z;

      const Vector3 &a3 = p.rel_a3;
      p.a3.x = m[0] * a3.x + m[1] * a3.y + m[2] * a3.z;
      p.a3.y = m[3] * a3.x + m[4] * a3.y + m[5] * a3.z;
      p.a3.z = m[6] * a3.x + m[7] * a3.y + m[8] * a3.z;

      // Velocity (for output)
      Vector3 rel = p.pos - c.com;
      p.v = c.v + c.omega.cross(rel);

      // Angular momentum
      p.L.x = p.L.y = p.L.z = 0;
    }
  }

  // Write output with specific step for time calculation
  void writeOutput(const std::string &filename, int current_step) {
    std::ofstream file(filename);
    if (!file.is_open()) {
      std::cerr << "Error opening output file: " << filename << std::endl;
      return;
    }

    double t = current_step * dt;
    file << "t = " << t << "\n";
    file << "b = " << box.x << " " << box.y << " " << box.z << "\n";
    file << "E = 0 0 0\n"; // Placeholder

    file << std::fixed << std::setprecision(10);
    for (int i = 0; i < particles.size(); ++i) {
      const Particle &p = particles[i];
      file << p.pos.x << " " << p.pos.y << " " << p.pos.z << " " << p.a1.x
           << " " << p.a1.y << " " << p.a1.z << " " << p.a3.x << " " << p.a3.y
           << " " << p.a3.z << " " << p.L.x << " " << p.L.y << " " << p.L.z
           << " " << p.v.x << " " << p.v.y << " " << p.v.z << "\n";
    }
  }

  // Write final output (backward compatible)
  void writeOutput(const std::string &filename) {
    writeOutput(filename, steps);
  }

  // Fast string formatting for doubles (configurable precision)
  static void formatDoubleFast(double val, char* buf, int precision) {
    if (precision == 0) {
      snprintf(buf, 32, "%.0f", val);
      return;
    }
    
    char format[16];
    snprintf(format, sizeof(format), "%%.%df", precision);
    snprintf(buf, 32, format, val);
    
    // Remove trailing zeros
    int len = strlen(buf);
    while (len > 0 && buf[len-1] == '0') len--;
    if (len > 0 && buf[len-1] == '.') len--;
    buf[len] = '\0';
  }

  // Write a single frame to trajectory file (appends) - optimized version
  void writeTrajectoryFrameFast(std::ofstream &file, int current_step) {
    // Reserve buffer for a line
    const int BUFFER_SIZE = 512;
    char buffer[BUFFER_SIZE];
    char num_buf[32];
    
    // Write header with configurable precision
    double t = current_step * dt;
    formatDoubleFast(t, num_buf, trajectory_precision);
    int len = snprintf(buffer, BUFFER_SIZE, "t = %s\n", num_buf);
    file.write(buffer, len);
    
    formatDoubleFast(box.x, num_buf, trajectory_precision);
    len = snprintf(buffer, BUFFER_SIZE, "b = %s", num_buf);
    formatDoubleFast(box.y, num_buf, trajectory_precision);
    len += snprintf(buffer + len, BUFFER_SIZE - len, " %s", num_buf);
    formatDoubleFast(box.z, num_buf, trajectory_precision);
    len += snprintf(buffer + len, BUFFER_SIZE - len, " %s\n", num_buf);
    file.write(buffer, len);
    
    file.write("E = 0 0 0\n", 10);
    
    // Format each particle line
    for (int i = 0; i < particles.size(); ++i) {
      const Particle &p = particles[i];
      char* ptr = buffer;
      
      // Format position
      formatDoubleFast(p.pos.x, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      formatDoubleFast(p.pos.y, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      formatDoubleFast(p.pos.z, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      // Format a1
      formatDoubleFast(p.a1.x, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      formatDoubleFast(p.a1.y, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      formatDoubleFast(p.a1.z, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      // Format a3
      formatDoubleFast(p.a3.x, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      formatDoubleFast(p.a3.y, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      *ptr++ = ' ';
      
      formatDoubleFast(p.a3.z, num_buf, trajectory_precision);
      ptr += snprintf(ptr, 32, "%s", num_buf);
      
      if (trajectory_print_momenta) {
        *ptr++ = ' ';
        
        // Format L (angular momentum)
        formatDoubleFast(p.L.x, num_buf, trajectory_precision);
        ptr += snprintf(ptr, 32, "%s", num_buf);
        *ptr++ = ' ';
        
        formatDoubleFast(p.L.y, num_buf, trajectory_precision);
        ptr += snprintf(ptr, 32, "%s", num_buf);
        *ptr++ = ' ';
        
        formatDoubleFast(p.L.z, num_buf, trajectory_precision);
        ptr += snprintf(ptr, 32, "%s", num_buf);
        *ptr++ = ' ';
        
        // Format v (velocity)
        formatDoubleFast(p.v.x, num_buf, trajectory_precision);
        ptr += snprintf(ptr, 32, "%s", num_buf);
        *ptr++ = ' ';
        
        formatDoubleFast(p.v.y, num_buf, trajectory_precision);
        ptr += snprintf(ptr, 32, "%s", num_buf);
        *ptr++ = ' ';
        
        formatDoubleFast(p.v.z, num_buf, trajectory_precision);
        ptr += snprintf(ptr, 32, "%s", num_buf);
      }
      
      *ptr++ = '\n';
      *ptr = '\0';
      
      // Write the line
      file.write(buffer, ptr - buffer);
    }
  }

  void run() {
    computePlaneNormal();
    initRigidBodies();

    // Open trajectory file if interval is set
    std::ofstream traj_file;
    if (print_conf_interval > 0) {
      if (trajectory_file.empty()) {
        // Default: derive from last_conf_file by inserting "trajectory_"
        size_t dot_pos = last_conf_file.rfind('.');
        std::string prefix = (dot_pos != std::string::npos) ? 
            last_conf_file.substr(0, dot_pos) : last_conf_file;
        std::string ext = (dot_pos != std::string::npos) ? 
            last_conf_file.substr(dot_pos) : ".dat";
        trajectory_file = prefix + "_trajectory" + ext;
      }
      traj_file.open(trajectory_file);
      if (!traj_file.is_open()) {
        std::cerr << "Error opening trajectory file: " << trajectory_file << std::endl;
        return;
      }
      std::cout << "Writing trajectory to " << trajectory_file << std::endl;
    }

    // Optional periodic kinetic-energy log, for judging how quickly a run
    // settles toward equilibrium (e.g. comparing a fixed spring constant
    // against a ramped one).
    std::ofstream energy_log;
    if (energy_log_interval > 0) {
      if (energy_log_file.empty()) {
        size_t dot_pos = last_conf_file.rfind('.');
        std::string prefix = (dot_pos != std::string::npos) ?
            last_conf_file.substr(0, dot_pos) : last_conf_file;
        energy_log_file = prefix + "_energy.csv";
      }
      energy_log.open(energy_log_file);
      if (energy_log.is_open()) {
        energy_log << "step,time,kinetic_energy,k_spring_current\n";
        std::cout << "Logging kinetic energy to " << energy_log_file << std::endl;
      } else {
        std::cerr << "Error opening energy log file: " << energy_log_file << std::endl;
      }
    }

    for (int step = 0; step < steps; ++step) {
      current_step = step;
      stepPhysics();

      if (energy_log.is_open() && step % energy_log_interval == 0) {
        // Total kinetic energy = sum over clusters of translational
        // (1/2 m v^2) + rotational (1/2 omega . L) energy.
        double ke = 0.0;
        for (const auto &c : clusters) {
          if (c.particle_ids.empty())
            continue;
          ke += 0.5 * c.mass * c.v.norm2() + 0.5 * c.omega.dot(c.L);
        }
        energy_log << step << "," << (step * dt) << "," << ke << ","
                   << k_spring_current << "\n";
      }

      // Print configuration at specified intervals
      if (print_conf_interval > 0 && step > 0 && step % print_conf_interval == 0) {
        writeTrajectoryFrameFast(traj_file, step);
        std::cout << "Printed configuration at step " << step << std::endl;
      }
    }

    if (traj_file.is_open()) {
      traj_file.close();
    }
    if (energy_log.is_open()) {
      energy_log.close();
    }

    writeOutput(last_conf_file);
  }
};

int main(int argc, char **argv) {
  if (argc < 2) {
    std::cerr << "Usage: " << argv[0] << " <input> [topology] [conf] [--threads N] [--print-conf-interval N] [--trajectory-no-momenta] [--trajectory-precision N]"
              << std::endl;
    std::cerr << "  --threads N: Set number of OpenMP threads (default: use all available cores)" << std::endl;
    std::cerr << "  --print-conf-interval N: Print configuration every N steps (0 to disable, default: 0)" << std::endl;
    std::cerr << "  --trajectory-no-momenta: Disable velocity and angular momentum output (~40% smaller)" << std::endl;
    std::cerr << "  --trajectory-precision N: Set decimal places for output (0-15, default: 8)" << std::endl;
    return 1;
  }

  // Parse command line arguments
  int num_threads = 0; // 0 means use default/all
  int print_conf_interval = 0; // Temporary for CLI parsing
  bool trajectory_print_momenta = true; // Temporary for CLI parsing
  int trajectory_precision = 8; // Temporary for CLI parsing
  std::string input_file = argv[1];
  std::string topology_file;
  std::string conf_file;

  for (int i = 2; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--threads" && i + 1 < argc) {
      num_threads = std::stoi(argv[++i]);
    } else if (arg == "-t" && i + 1 < argc) {
      num_threads = std::stoi(argv[++i]);
    } else if (arg == "--print-conf-interval" && i + 1 < argc) {
      print_conf_interval = std::stoi(argv[++i]);
    } else if (arg == "--trajectory-no-momenta") {
      trajectory_print_momenta = false;
    } else if (arg == "--trajectory-precision" && i + 1 < argc) {
      trajectory_precision = std::stoi(argv[++i]);
    } else if (topology_file.empty()) {
      topology_file = arg;
    } else if (conf_file.empty()) {
      conf_file = arg;
    }
  }

  Simulation sim;
  sim.readInput(input_file);

  #ifdef _OPENMP
  if (num_threads > 0) {
    omp_set_num_threads(num_threads);
    std::cout << "Using " << num_threads << " OpenMP threads (from CLI)" << std::endl;
  } else {
    omp_set_num_threads(sim.num_threads);
    std::cout << "Using " << sim.num_threads << " OpenMP threads" << std::endl;
  }
  #else
  std::cout << "OpenMP not available - running single-threaded" << std::endl;
  #endif

  // Apply CLI override for print_conf_interval if specified
  if (print_conf_interval > 0) {
    sim.print_conf_interval = print_conf_interval;
  }

  // Apply CLI overrides for trajectory optimization flags
  sim.trajectory_print_momenta = trajectory_print_momenta;
  if (trajectory_precision >= 0 && trajectory_precision <= 15) {
    sim.trajectory_precision = trajectory_precision;
  }

  if (!topology_file.empty())
    sim.topology_file = topology_file;
  if (!conf_file.empty())
    sim.conf_file = conf_file;

  if (sim.topology_file.empty() || sim.conf_file.empty()) {
    std::cerr << "Error: Topology and configuration files must be specified in "
                 "input file or command line."
              << std::endl;
    return 1;
  }

  sim.readTopology(sim.topology_file);
  sim.readConf(sim.conf_file);
  sim.finalizeClusters();

  sim.run();

  std::cout << "Simulation completed. Output written to " << sim.last_conf_file
            << std::endl;

  return 0;
}
