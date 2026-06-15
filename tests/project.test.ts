import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import midiPackage from "@tonejs/midi";
import { parseMidi } from "midi-file";

import { createPracticeProject, importUserMidi } from "../src/core/project.js";

const { Midi } = midiPackage;

test("createPracticeProject creates the expected song layout and metadata", async () => {
  process.env.GARAGEBAND_PRACTICE_ROOT = await mkdtemp(join(tmpdir(), "garageband-practice-"));

  const project = await createPracticeProject({
    title: "Invention No. 1",
    composer: "J. S. Bach"
  });

  assert.equal(project.slug, "invention-no-1");
  assert.match(project.paths.source, /source$/);
  assert.match(project.paths.midi, /midi$/);
  assert.match(project.paths.charts, /charts$/);

  const projectJson = JSON.parse(await readFile(join(process.env.GARAGEBAND_PRACTICE_ROOT, project.slug, "project.json"), "utf8"));
  assert.equal(projectJson.title, "Invention No. 1");
  assert.equal(projectJson.contentPolicy.searches.length > 0, true);
});

test("importUserMidi copies, normalizes, and analyzes a MIDI file", async () => {
  process.env.GARAGEBAND_PRACTICE_ROOT = await mkdtemp(join(tmpdir(), "garageband-practice-"));
  const project = await createPracticeProject({ title: "Two Hand Study" });
  const midiPath = join(process.env.GARAGEBAND_PRACTICE_ROOT, "source.mid");
  const midi = new Midi();
  midi.header.setTempo(96);
  midi.addTrack().addNote({ midi: 60, time: 0, duration: 1 });
  midi.addTrack().addNote({ midi: 48, time: 1, duration: 1 });
  await writeFile(midiPath, Buffer.from(midi.toArray()));

  const result = await importUserMidi({
    projectSlug: project.slug,
    midiFilePath: midiPath
  });

  assert.equal(result.midi.analysis.tempos[0]?.bpm, 96);
  assert.equal(result.midi.analysis.tracks.length, 2);
  assert.equal(result.midi.analysis.tracks[0]?.name, "Two Hand Study - MIDI");
  assert.equal(result.midi.analysis.tracks[0]?.noteCount, 2);
  assert.equal(result.midi.analysis.tracks[1]?.name, "Your Piano - Play Along");
  assert.equal(result.midi.analysis.tracks[1]?.noteCount, 0);
  assert.equal(result.midi.analysis.overallRange?.minName, "C3");
  assert.equal(result.midi.analysis.overallRange?.maxName, "C4");
  assert.match(result.midiPath, /two-hand-study\.mid$/);

  const projectJson = JSON.parse(await readFile(join(process.env.GARAGEBAND_PRACTICE_ROOT, project.slug, "project.json"), "utf8"));
  assert.equal(projectJson.sources[0].path, "source/source.mid");
  assert.equal(projectJson.midiFiles[0].path, "midi/two-hand-study.mid");
  assert.equal(projectJson.midiFiles[0].analysis.filePath, "midi/two-hand-study.mid");
  assert.equal(projectJson.activeMidiPath, "midi/two-hand-study.mid");

  const rawMidi = parseMidi(await readFile(result.midiPath));
  assert.equal(rawMidi.header.format, 1);
  assert.equal(rawMidi.header.numTracks, 2);
  assert.equal(rawMidi.tracks.length, 2);
});
