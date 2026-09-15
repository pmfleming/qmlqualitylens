import fs from "node:fs";
import path from "node:path";
import { isExcluded } from "./file-walk.js";
import type { Config } from "./types.js";

export type CmakeFile = { absolute: string; relative: string };

// Local build definitions are discovered independently of QML source_roots:
// the top-level CMakeLists.txt often lives above the analyzed QML directory.
export function discoverCmakeFiles(config: Config): CmakeFile[] {
  const files = new Map<string, CmakeFile>();
  const visited = new Set<string>();
  const visit = (directory: string): void => {
    if (isExcluded(directory, config) || !fs.existsSync(directory)) return;
    const real = fs.realpathSync(directory);
    if (visited.has(real)) return;
    visited.add(real);
    if (!fs.statSync(directory).isDirectory()) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (isExcluded(absolute, config) || entry.name === ".git" || entry.name === "CMakeFiles") continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && (entry.name === "CMakeLists.txt" || entry.name.endsWith(".cmake") || ["CMakePresets.json", "CMakeUserPresets.json"].includes(entry.name))) {
        files.set(fs.realpathSync(absolute), { absolute, relative: path.relative(config.projectRoot, absolute).split(path.sep).join("/") });
      }
    }
  };
  for (const root of [config.projectRoot, config.tools.cmakeSourceDir, ...config.sourceRoots]) visit(root);
  return [...files.values()].sort((a, b) => a.relative.localeCompare(b.relative));
}

export function discoverQmlModules(files: CmakeFile[]) {
  return files.filter((file) => !file.absolute.endsWith(".json")).flatMap((file) => {
    const tokens = cmakeTokens(fs.readFileSync(file.absolute, "utf8"));
    const modules = [];
    for (let index = 0; index < tokens.length - 1; index += 1) {
      if (!/^(?:qt(?:6)?_add_qml_module|ecm_add_qml_module)$/i.test(tokens[index]) || tokens[index + 1] !== "(") continue;
      let depth = 1;
      const args: string[] = [];
      for (index += 2; index < tokens.length && depth; index += 1) {
        const token = tokens[index];
        if (token === "(") depth += 1;
        else if (token === ")") depth -= 1;
        if (depth) args.push(token);
      }
      index -= 1;
      const uri = args.indexOf("URI");
      modules.push({ file: file.relative, target: args[0] ?? "unknown", uri: uri >= 0 ? args[uri + 1] ?? null : null, no_lint: args.includes("NO_LINT"), has_qmllint_reference: !args.includes("NO_LINT"), evaluated: false });
    }
    return modules;
  });
}

// Tokenize only enough CMake syntax for static module discovery. Quoted/bracket
// arguments and comments cannot introduce fake declarations or NO_LINT flags.
function cmakeTokens(text: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) { index += 1; continue; }
    const comment = text[index] === "#";
    if (comment) index += 1;
    const bracket = text.slice(index).match(/^\[(=*)\[/);
    if (bracket) {
      const start = index + bracket[0].length;
      const end = text.indexOf(`]${bracket[1]}]`, start);
      if (!comment) tokens.push(text.slice(start, end < 0 ? text.length : end));
      index = end < 0 ? text.length : end + bracket[1].length + 2;
    } else if (comment) {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end + 1;
    } else if (text[index] === "(") { tokens.push("("); index += 1; }
    else if (text[index] === ")") { tokens.push(")"); index += 1; }
    else {
      let token = "";
      const quoted = text[index] === '"';
      if (quoted) index += 1;
      while (index < text.length && (quoted ? text[index] !== '"' : !/[\s()#]/.test(text[index]))) {
        if (text[index] === "\\" && index + 1 < text.length) index += 1;
        token += text[index++];
      }
      if (quoted && text[index] === '"') index += 1;
      tokens.push(token);
    }
  }
  return tokens;
}
