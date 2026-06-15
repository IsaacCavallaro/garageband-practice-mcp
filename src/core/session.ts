import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { packageRoot, projectDir, resolveSongsRoot } from "./paths.js";
import { assertValidSlug, slugify } from "./slug.js";

export interface SaveSessionSnapshotInput {
  projectSlug?: string;
  message?: string;
  commit?: boolean;
  push?: boolean;
}

export interface SessionArtifactSummary {
  path: string;
  kind: SessionArtifactKind;
  bytes: number;
}

export type SessionArtifactKind =
  | "project-metadata"
  | "source-midi"
  | "garageband-midi"
  | "musicxml-chart"
  | "score-pdf"
  | "practice-html"
  | "garageband-notes"
  | "songs-placeholder";

export interface SaveSessionSnapshotResult {
  repoRoot: string;
  songsRoot: string;
  projectSlug?: string;
  artifacts: SessionArtifactSummary[];
  git: {
    isRepository: boolean;
    changedFiles: GitChangedFile[];
    stagedFiles: string[];
    committed: boolean;
    pushed: boolean;
    commitSha?: string;
  };
  warnings: string[];
}

export interface GitChangedFile {
  status: string;
  path: string;
}

export async function saveSessionSnapshot(input: SaveSessionSnapshotInput = {}): Promise<SaveSessionSnapshotResult> {
  const repoRoot = resolve(process.env.GARAGEBAND_PRACTICE_REPO_ROOT ?? packageRoot);
  const songsRoot = resolveSongsRoot();
  const projectSlug = input.projectSlug ? assertValidSlug(slugify(input.projectSlug)) : undefined;
  const scanRoot = projectSlug ? projectDir(projectSlug) : songsRoot;
  const warnings: string[] = [];
  const artifacts = (await listSessionArtifacts(scanRoot, songsRoot, repoRoot)).sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  const isRepository = isGitRepository(repoRoot);
  let changedFiles = isRepository ? getGitChangedFiles(repoRoot, ["songs"]) : [];
  let stagedFiles: string[] = [];
  let committed = false;
  let pushed = false;
  let commitSha: string | undefined;

  if (!isRepository) {
    warnings.push(`No Git repository was found at ${repoRoot}. Run git init before committing session artifacts.`);
  }

  if ((input.commit || input.push) && !isRepository) {
    warnings.push("Skipped commit/push because the project is not a Git repository.");
  }

  if (input.commit && isRepository) {
    const stageablePaths = artifacts.map((artifact) => artifact.path);
    if (stageablePaths.length === 0) {
      warnings.push("No trackable session artifacts were found to stage.");
    } else {
      runGit(repoRoot, ["add", "--", ...stageablePaths]);
      stagedFiles = getGitDiffNames(repoRoot, ["--cached", "--name-only", "--", "songs"]);

      if (hasStagedChanges(repoRoot)) {
        runGit(repoRoot, ["commit", "-m", input.message ?? "Save GarageBand practice session artifacts"]);
        committed = true;
        commitSha = runGit(repoRoot, ["rev-parse", "--short", "HEAD"]).stdout.trim();
      } else {
        warnings.push("No staged session artifact changes were available to commit.");
      }
    }

    changedFiles = getGitChangedFiles(repoRoot, ["songs"]);
  }

  if (input.push && isRepository) {
    runGit(repoRoot, ["push", "-u", "origin", "HEAD"]);
    pushed = true;
  }

  return {
    repoRoot,
    songsRoot,
    projectSlug,
    artifacts,
    git: {
      isRepository,
      changedFiles,
      stagedFiles,
      committed,
      pushed,
      commitSha
    },
    warnings
  };
}

async function listSessionArtifacts(scanRoot: string, songsRoot: string, repoRoot: string): Promise<SessionArtifactSummary[]> {
  if (!(await exists(scanRoot))) {
    return [];
  }

  const files = await walkFiles(scanRoot);
  const placeholderPath = resolve(songsRoot, ".gitkeep");
  if (await exists(placeholderPath)) {
    files.push(placeholderPath);
  }

  const artifacts: SessionArtifactSummary[] = [];
  for (const filePath of files) {
    const kind = classifySessionArtifact(filePath, songsRoot);
    if (!kind) {
      continue;
    }

    const repoRelativePath = toRepoRelativePath(repoRoot, filePath);
    if (!repoRelativePath) {
      continue;
    }

    artifacts.push({
      path: repoRelativePath,
      kind,
      bytes: (await stat(filePath)).size
    });
  }

  return artifacts;
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".band") || entry.name === "bounces" || entry.name === "audio") {
        continue;
      }
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function classifySessionArtifact(filePath: string, songsRoot: string): SessionArtifactKind | undefined {
  const songRelativePath = relative(songsRoot, filePath).split(sep).join("/");

  if (songRelativePath === ".gitkeep") {
    return "songs-placeholder";
  }

  if (/^[^/]+\/project\.json$/.test(songRelativePath)) {
    return "project-metadata";
  }

  if (/^[^/]+\/source\/[^/]+\.midi?$/i.test(songRelativePath)) {
    return "source-midi";
  }

  if (/^[^/]+\/midi\/[^/]+\.midi?$/i.test(songRelativePath)) {
    return "garageband-midi";
  }

  if (/^[^/]+\/charts\/[^/]+\.musicxml$/i.test(songRelativePath)) {
    return "musicxml-chart";
  }

  if (/^[^/]+\/charts\/[^/]+\.pdf$/i.test(songRelativePath)) {
    return "score-pdf";
  }

  if (/^[^/]+\/practice\/index\.html$/i.test(songRelativePath)) {
    return "practice-html";
  }

  if (/^[^/]+\/garageband\/README\.md$/.test(songRelativePath)) {
    return "garageband-notes";
  }

  return undefined;
}

function toRepoRelativePath(repoRoot: string, filePath: string): string | undefined {
  const relativePath = relative(repoRoot, filePath);
  if (relativePath.startsWith("..") || relativePath === "") {
    return undefined;
  }

  return relativePath.split(sep).join("/");
}

function isGitRepository(repoRoot: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  return result.status === 0 && result.stdout.trim() === "true";
}

function getGitChangedFiles(repoRoot: string, pathspecs: string[]): GitChangedFile[] {
  const result = runGit(repoRoot, ["status", "--short", "--", ...pathspecs]);
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3)
    }));
}

function hasStagedChanges(repoRoot: string): boolean {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  return result.status === 1;
}

function getGitDiffNames(repoRoot: string, args: string[]): string[] {
  const result = runGit(repoRoot, ["diff", ...args]);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function runGit(repoRoot: string, args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout || "unknown error"}`);
  }

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
