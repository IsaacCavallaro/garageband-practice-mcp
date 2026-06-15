import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function resolveSongsRoot(): string {
  return resolve(process.env.GARAGEBAND_PRACTICE_ROOT ?? join(packageRoot, "songs"));
}

export function projectDir(slug: string): string {
  return join(resolveSongsRoot(), slug);
}

export function projectJsonPath(slug: string): string {
  return join(projectDir(slug), "project.json");
}

export function projectSubdir(slug: string, name: "source" | "midi" | "charts" | "garageband" | "practice"): string {
  return join(projectDir(slug), name);
}

export function resolveProjectPath(slug: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir(slug), path);
}

export function toProjectRelativePath(slug: string, path: string): string {
  const root = projectDir(slug);
  const resolved = isAbsolute(path) ? path : resolve(root, path);
  const relativePath = relative(root, resolved);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return path;
  }

  return relativePath.split(sep).join("/");
}
