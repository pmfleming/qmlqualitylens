import { analyzeClones } from "../dist/src/clone-detector.js";

// Synthetic aligned clones stress the overlapping-window expansion path.
// Unit tests assert operation counts; timings here are for local profiling.
for (const size of [1000, 2000, 4000, 8000]) {
  const lines = Array.from({ length: size }, (_, index) => {
    let name = "";
    do { name += String.fromCharCode(97 + index % 26); index = Math.floor(index / 26); } while (index);
    return `property int member${name}: root.width`;
  });
  const sources = ["A.qml", "B.qml"].map((file) => ({ path: file, relativePath: file, kind: "qml", text: lines.join("\n"), lines }));
  for (const run of ["first", "repeat"]) {
    const start = performance.now();
    const result = analyzeClones(sources, 6);
    const memory = process.memoryUsage();
    console.log(JSON.stringify({ lines_per_file: size, run, node: process.version, platform: process.platform,
      duration_ms: Math.round(performance.now() - start), rss_bytes: memory.rss, heap_used_bytes: memory.heapUsed,
      process_peak_rss_kib: process.resourceUsage().maxRSS, scope: "same process; peak RSS cumulative; no analysis-context cache",
      groups: result.groups.length, ...result.coverage }));
  }
}
