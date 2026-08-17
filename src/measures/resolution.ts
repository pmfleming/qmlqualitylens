import type { MeasureConfig as Config, MeasureContext as AnalysisContext } from "./foundation.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureResolution(config: Config, command: string, context: AnalysisContext) {
  const resolution = context.resolution;
  const artifact = {
    ...baseArtifact(context, "map.resolution", command),
    summary: {
      components: context.components.length,
      ambiguous_component_names: resolution.ambiguousComponentNames.size,
      public_files: resolution.publicFiles.size,
      qmldir_modules: resolution.qmldirModules.length,
      imports: resolution.imports.length,
      component_uses: resolution.componentUses.length,
      reachability_status: resolution.reachabilityStatus,
      entrypoints: resolution.entrypoints.size,
      reachable_components: resolution.reachableFiles.size,
      unreachable_components: resolution.unreachableFiles.size,
      dynamic_edges: resolution.reachabilityEdges.filter((edge) => edge.kind !== "component_use").length,
      unresolved_imports: resolution.unresolvedImports.length,
      unresolved_types: resolution.unresolvedTypes.length,
    },
    components: context.components.map(({ name, file }) => ({ name, file, public: resolution.publicFiles.has(file), referenced: resolution.referencedFiles.has(file), entrypoint: resolution.entrypoints.has(file), reachable: resolution.reachabilityStatus === "available" ? resolution.reachableFiles.has(file) : null, usage_path: resolution.usagePaths.get(file) ?? null })),
    ambiguous_component_names: [...resolution.ambiguousComponentNames.entries()].map(([name, files]) => ({ name, files })),
    qmldir_modules: resolution.qmldirModules,
    imports: resolution.imports,
    component_uses: resolution.componentUses,
    reachability_edges: resolution.reachabilityEdges,
    unresolved_imports: resolution.unresolvedImports,
    unresolved_types: resolution.unresolvedTypes,
  };
  writeArtifact(config, "resolution.json", artifact);
  return artifact;
}
