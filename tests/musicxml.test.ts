import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import midiPackage from "@tonejs/midi";

import { createPracticeProject, importUserMidi } from "../src/core/project.js";
import { generatePianoGrandStaffChart, midiToGrandStaffMusicXml } from "../src/core/musicxml.js";
import { generateBrowserPracticeView } from "../src/core/practice-view.js";

const { Midi } = midiPackage;

test("midiToGrandStaffMusicXml emits a two-staff piano MusicXML document", () => {
  const midi = new Midi();
  midi.header.setTempo(120);
  const right = midi.addTrack();
  right.addNote({ midi: 64, time: 0, duration: 1 });
  const left = midi.addTrack();
  left.addNote({ midi: 40, time: 0, duration: 2 });

  const xml = midiToGrandStaffMusicXml(midi, { title: "Grand Staff Smoke" });

  assert.match(xml, /<score-partwise version="3.1">/);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<staff>1<\/staff>/);
  assert.match(xml, /<staff>2<\/staff>/);
  assert.match(xml, /<sign>G<\/sign>/);
  assert.match(xml, /<sign>F<\/sign>/);
});

test("generatePianoGrandStaffChart writes MusicXML and can skip renderer export", async () => {
  process.env.GARAGEBAND_PRACTICE_ROOT = await mkdtemp(join(tmpdir(), "garageband-practice-"));
  const project = await createPracticeProject({ title: "Chart Study" });
  const midiPath = join(process.env.GARAGEBAND_PRACTICE_ROOT, "chart-source.mid");
  const midi = new Midi();
  midi.addTrack().addNote({ midi: 60, time: 0, duration: 1 });
  midi.addTrack().addNote({ midi: 43, time: 0, duration: 1 });
  await writeFile(midiPath, Buffer.from(midi.toArray()));
  await importUserMidi({ projectSlug: project.slug, midiFilePath: midiPath });

  const result = await generatePianoGrandStaffChart({
    projectSlug: project.slug,
    renderPdfPng: false
  });

  const xml = await readFile(result.musicXmlPath, "utf8");
  assert.match(xml, /<work-title>Chart Study<\/work-title>/);
  assert.deepEqual(result.renderedArtifacts, []);
  assert.equal(result.warnings.length, 1);

  const projectJson = JSON.parse(await readFile(join(process.env.GARAGEBAND_PRACTICE_ROOT, project.slug, "project.json"), "utf8"));
  assert.equal(projectJson.chartFiles[0].path, "charts/chart-study-grand-staff.musicxml");
  assert.equal(projectJson.chartFiles[0].sourceMidiPath, "midi/chart-study.mid");
});

test("generateBrowserPracticeView writes a self-contained HTML playalong view", async () => {
  process.env.GARAGEBAND_PRACTICE_ROOT = await mkdtemp(join(tmpdir(), "garageband-practice-"));
  const project = await createPracticeProject({ title: "Browser View Study" });
  const midiPath = join(process.env.GARAGEBAND_PRACTICE_ROOT, "browser-source.mid");
  const midi = new Midi();
  midi.addTrack().addNote({ midi: 60, time: 0, duration: 1 });
  await writeFile(midiPath, Buffer.from(midi.toArray()));
  await importUserMidi({ projectSlug: project.slug, midiFilePath: midiPath });

  const result = await generateBrowserPracticeView({ projectSlug: project.slug });
  const html = await readFile(result.htmlPath, "utf8");

  assert.equal(result.noteCount, 1);
  assert.match(html, /Browser View Study/);
  assert.match(html, /AudioContext/);
  assert.match(html, /browser-view-study\.mid/);

  const projectJson = JSON.parse(await readFile(join(process.env.GARAGEBAND_PRACTICE_ROOT, project.slug, "project.json"), "utf8"));
  assert.equal(projectJson.practiceFiles[0].path, "practice/index.html");
  assert.equal(projectJson.practiceFiles[0].sourceMidiPath, "midi/browser-view-study.mid");
});
