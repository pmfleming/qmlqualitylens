import type { AnalysisContext } from "../analyzer.js";
import type { Config } from "../types.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureResolution(config: Config, command: string, context: AnalysisContext): unknown {
  const resolution = context.resolution;
  const artifact = {
    ...baseArtifact(context, "map.resolution", command),
    summary: {
      components: resolution.componentsByName.size,
      public_files: resolution.publicFiles.size,
      qmldir_modules: resolution.qmldirModules.length,
      imports: resolution.imports.length,
      component_uses: resolution.componentUses.length,
      unresolved_imports: resolution.unresolvedImports.length,
      unresolved_types: resolution.unresolvedTypes.length,
    },
    components: [...resolution.componentsByName.entries()].map(([name, file]) => ({ name, file, public: resolution.publicFiles.has(file), referenced: resolution.referencedFiles.has(file) })),
    qmldir_modules: resolution.qmldirModules,
    imports: resolution.imports,
    component_uses: resolution.componentUses,
    unresolved_imports: resolution.unresolvedImports,
    unresolved_types: resolution.unresolvedTypes,
  };
  writeArtifact(config, "resolution.json", artifact);
  return artifact;
}
