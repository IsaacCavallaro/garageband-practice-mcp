import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPracticeProject } from "../src/core/project.js";
import { findSavedGarageBandProject } from "../src/core/garageband.js";

test("findSavedGarageBandProject finds a saved native project in the GarageBand handoff folder", async () => {
  process.env.GARAGEBAND_PRACTICE_ROOT = await mkdtemp(join(tmpdir(), "garageband-practice-"));
  const project = await createPracticeProject({ title: "Native Score Study" });
  const savedProject = join(process.env.GARAGEBAND_PRACTICE_ROOT, project.slug, "garageband", "native-score-study.band");

  await mkdir(savedProject);

  assert.equal(await findSavedGarageBandProject(project.slug), savedProject);
});
