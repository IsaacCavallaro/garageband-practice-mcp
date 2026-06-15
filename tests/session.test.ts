import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import midiPackage from "@tonejs/midi";

import { createPracticeProject, importUserMidi } from "../src/core/project.js";
import { saveSessionSnapshot } from "../src/core/session.js";

const { Midi } = midiPackage;

test("saveSessionSnapshot summarizes and commits trackable song artifacts", async () => {
  const previousPracticeRoot = process.env.GARAGEBAND_PRACTICE_ROOT;
  const previousRepoRoot = process.env.GARAGEBAND_PRACTICE_REPO_ROOT;
  const repoRoot = await mkdtemp(join(tmpdir(), "garageband-practice-repo-"));

  try {
    process.env.GARAGEBAND_PRACTICE_REPO_ROOT = repoRoot;
    process.env.GARAGEBAND_PRACTICE_ROOT = join(repoRoot, "songs");
    runGit(repoRoot, ["init"]);
    runGit(repoRoot, ["config", "user.name", "Test User"]);
    runGit(repoRoot, ["config", "user.email", "test@example.com"]);

    const project = await createPracticeProject({ title: "Snapshot Study" });
    const midiPath = join(repoRoot, "snapshot-source.mid");
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 1 });
    await writeFile(midiPath, Buffer.from(midi.toArray()));
    await importUserMidi({ projectSlug: project.slug, midiFilePath: midiPath });

    const snapshot = await saveSessionSnapshot({
      projectSlug: project.slug,
      commit: true,
      message: "Save snapshot study artifacts"
    });

    assert.equal(snapshot.git.isRepository, true);
    assert.equal(snapshot.git.committed, true);
    assert.match(snapshot.git.commitSha ?? "", /^[a-f0-9]+$/);
    assert.deepEqual(snapshot.warnings, []);
    assert.equal(snapshot.artifacts.some((artifact) => artifact.path === "songs/snapshot-study/project.json"), true);
    assert.equal(snapshot.artifacts.some((artifact) => artifact.kind === "source-midi"), true);
    assert.equal(snapshot.artifacts.some((artifact) => artifact.kind === "garageband-midi"), true);
    assert.deepEqual(snapshot.git.changedFiles, []);
  } finally {
    restoreEnv("GARAGEBAND_PRACTICE_ROOT", previousPracticeRoot);
    restoreEnv("GARAGEBAND_PRACTICE_REPO_ROOT", previousRepoRoot);
  }
});

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout || "unknown error"}`);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
