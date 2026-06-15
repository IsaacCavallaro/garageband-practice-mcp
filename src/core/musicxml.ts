import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Midi } from "@tonejs/midi";
import type { Note } from "@tonejs/midi/dist/Note.js";

import { analyzeMidiFile, getTotalTicks, readMidiFile } from "./midi.js";
import { projectSubdir, resolveProjectPath, toProjectRelativePath } from "./paths.js";
import { getActiveMidiPath, loadProject, writeProject } from "./project.js";
import { safeFileStem, slugify } from "./slug.js";
import type { ProjectChartFile } from "./types.js";
import { renderNotationIfAvailable } from "./notation-renderer.js";

export interface GenerateGrandStaffChartInput {
  projectSlug: string;
  midiFilePath?: string;
  outputBasename?: string;
  splitPointMidi?: number;
  renderPdfPng?: boolean;
}

interface ChartNote {
  midi: number;
  startTick: number;
  durationTicks: number;
}

interface TimelineItem {
  kind: "rest" | "notes";
  startTick: number;
  durationTicks: number;
  notes?: ChartNote[];
}

interface MeasureItems {
  treble: TimelineItem[];
  bass: TimelineItem[];
}

export async function generatePianoGrandStaffChart(input: GenerateGrandStaffChartInput): Promise<{
  musicXmlPath: string;
  renderedArtifacts: string[];
  warnings: string[];
}> {
  const project = await loadProject(input.projectSlug);
  const midiPath = await getActiveMidiPath(input.projectSlug, input.midiFilePath);

  const midi = await readMidiFile(midiPath);
  const analysis = await analyzeMidiFile(midiPath);
  const chartsDir = projectSubdir(project.slug, "charts");
  await mkdir(chartsDir, { recursive: true });

  const outputBasename = safeFileStem(input.outputBasename ?? `${project.slug}-grand-staff`);
  const musicXmlPath = join(chartsDir, `${outputBasename}.musicxml`);
  const xml = midiToGrandStaffMusicXml(midi, {
    title: project.title,
    composer: project.composer,
    sourceFileName: basename(midiPath),
    splitPointMidi: input.splitPointMidi ?? 60
  });

  await writeFile(musicXmlPath, xml, "utf8");

  const rendered = input.renderPdfPng === false
    ? { artifacts: [], warnings: ["PDF/PNG export skipped by request."] }
    : await renderNotationIfAvailable(musicXmlPath, chartsDir, outputBasename);

  const now = new Date().toISOString();
  const projectMusicXmlPath = toProjectRelativePath(project.slug, musicXmlPath);
  const projectMidiPath = toProjectRelativePath(project.slug, midiPath);
  const chartFiles: ProjectChartFile[] = [
    {
      path: projectMusicXmlPath,
      format: "musicxml",
      sourceMidiPath: projectMidiPath,
      createdAt: now
    },
    ...rendered.artifacts.map<ProjectChartFile>((artifact) => ({
      path: toProjectRelativePath(project.slug, artifact),
      format: artifact.toLowerCase().endsWith(".pdf") ? "pdf" : "png",
      sourceMidiPath: projectMidiPath,
      createdAt: now
    }))
  ];

  project.chartFiles.push(...chartFiles);
  project.midiFiles = project.midiFiles.map((file) =>
    resolveProjectPath(project.slug, file.path) === midiPath
      ? {
          ...file,
          analysis: {
            ...analysis,
            filePath: projectMidiPath
          }
        }
      : file
  );
  await writeProject(project);

  return {
    musicXmlPath,
    renderedArtifacts: rendered.artifacts,
    warnings: rendered.warnings
  };
}

export function midiToGrandStaffMusicXml(
  midi: Midi,
  options: {
    title: string;
    composer?: string;
    sourceFileName?: string;
    splitPointMidi?: number;
  }
): string {
  const splitPointMidi = options.splitPointMidi ?? 60;
  const ppq = midi.header.ppq;
  const totalTicks = Math.max(getTotalTicks(midi), ppq * 4);
  const timeSignature = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const beats = timeSignature[0] ?? 4;
  const beatType = timeSignature[1] ?? 4;
  const measureTicks = Math.max(1, Math.round(ppq * 4 * (beats / beatType)));
  const measureCount = Math.max(1, Math.ceil(totalTicks / measureTicks));
  const tempo = midi.header.tempos[0]?.bpm ?? 120;
  const measures = buildMeasures(midi, splitPointMidi, totalTicks, measureTicks, measureCount);

  const measureXml = measures
    .map((measure, index) => {
      const number = index + 1;
      const attributes = index === 0
        ? `
      <attributes>
        <divisions>${ppq}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(tempo)}</per-minute></metronome>
        </direction-type>
        <sound tempo="${Number(tempo.toFixed(3))}"/>
      </direction>`
        : "";

      const treble = measure.treble.map((item) => timelineItemToXml(item, 1, 1, ppq)).join("");
      const bass = measure.bass.map((item) => timelineItemToXml(item, 2, 2, ppq)).join("");

      return `    <measure number="${number}">${attributes}
${treble}
      <backup><duration>${measureTicks}</duration></backup>
${bass}
    </measure>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${xmlEscape(options.title)}</work-title></work>
  <identification>
    ${options.composer ? `<creator type="composer">${xmlEscape(options.composer)}</creator>` : ""}
    <encoding>
      <software>garageband-practice-mcp</software>
      ${options.sourceFileName ? `<source>${xmlEscape(options.sourceFileName)}</source>` : ""}
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
${measureXml}
  </part>
</score-partwise>
`;
}

function buildMeasures(
  midi: Midi,
  splitPointMidi: number,
  totalTicks: number,
  measureTicks: number,
  measureCount: number
): MeasureItems[] {
  const trebleNotes: ChartNote[] = [];
  const bassNotes: ChartNote[] = [];

  for (const track of midi.tracks) {
    for (const note of track.notes) {
      const target = note.midi >= splitPointMidi ? trebleNotes : bassNotes;
      target.push(toChartNote(note));
    }
  }

  const measures = Array.from({ length: measureCount }, () => ({
    treble: [] as TimelineItem[],
    bass: [] as TimelineItem[]
  }));

  distributeTimeline(buildMonophonicTimeline(trebleNotes, totalTicks), measures, "treble", measureTicks);
  distributeTimeline(buildMonophonicTimeline(bassNotes, totalTicks), measures, "bass", measureTicks);

  return measures;
}

function toChartNote(note: Note): ChartNote {
  return {
    midi: note.midi,
    startTick: Math.max(0, Math.round(note.ticks)),
    durationTicks: Math.max(1, Math.round(note.durationTicks))
  };
}

function buildMonophonicTimeline(notes: ChartNote[], totalTicks: number): TimelineItem[] {
  const byStart = new Map<number, ChartNote[]>();
  for (const note of notes) {
    const group = byStart.get(note.startTick) ?? [];
    group.push(note);
    byStart.set(note.startTick, group);
  }

  const timeline: TimelineItem[] = [];
  let cursor = 0;

  for (const [startTick, group] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
    if (startTick > cursor) {
      timeline.push({
        kind: "rest",
        startTick: cursor,
        durationTicks: startTick - cursor
      });
      cursor = startTick;
    }

    const endTick = Math.max(...group.map((note) => note.startTick + note.durationTicks));
    if (endTick <= cursor) {
      continue;
    }

    const durationTicks = endTick - cursor;
    timeline.push({
      kind: "notes",
      startTick: cursor,
      durationTicks,
      notes: group
        .map((note) => ({ ...note, startTick: cursor, durationTicks }))
        .sort((a, b) => b.midi - a.midi)
    });
    cursor = endTick;
  }

  if (cursor < totalTicks) {
    timeline.push({
      kind: "rest",
      startTick: cursor,
      durationTicks: totalTicks - cursor
    });
  }

  if (timeline.length === 0) {
    timeline.push({
      kind: "rest",
      startTick: 0,
      durationTicks: totalTicks
    });
  }

  return timeline;
}

function distributeTimeline(
  timeline: TimelineItem[],
  measures: MeasureItems[],
  staff: "treble" | "bass",
  measureTicks: number
): void {
  for (const item of timeline) {
    let remaining = item.durationTicks;
    let cursor = item.startTick;

    while (remaining > 0) {
      const measureIndex = Math.min(measures.length - 1, Math.floor(cursor / measureTicks));
      const measureEndTick = (measureIndex + 1) * measureTicks;
      const durationTicks = Math.min(remaining, measureEndTick - cursor);
      measures[measureIndex][staff].push({
        ...item,
        startTick: cursor,
        durationTicks,
        notes: item.notes?.map((note) => ({ ...note, startTick: cursor, durationTicks }))
      });
      remaining -= durationTicks;
      cursor += durationTicks;
    }
  }
}

function timelineItemToXml(item: TimelineItem, voice: number, staff: 1 | 2, ppq: number): string {
  const duration = Math.max(1, Math.round(item.durationTicks));
  const type = durationToType(duration, ppq);

  if (item.kind === "rest") {
    return `      <note>
        <rest/>
        <duration>${duration}</duration>
        <voice>${voice}</voice>
        <type>${type}</type>
        <staff>${staff}</staff>
      </note>
`;
  }

  const notes = item.notes ?? [];
  return notes.map((note, index) => `      <note>
        ${index > 0 ? "<chord/>" : ""}
        ${pitchXml(note.midi)}
        <duration>${duration}</duration>
        <voice>${voice}</voice>
        <type>${type}</type>
        <staff>${staff}</staff>
      </note>
`).join("");
}

function durationToType(durationTicks: number, ppq: number): string {
  const quarterRatio = durationTicks / ppq;
  const types = [
    { ratio: 4, type: "whole" },
    { ratio: 2, type: "half" },
    { ratio: 1, type: "quarter" },
    { ratio: 0.5, type: "eighth" },
    { ratio: 0.25, type: "16th" },
    { ratio: 0.125, type: "32nd" },
    { ratio: 0.0625, type: "64th" }
  ];

  return types.reduce((best, candidate) =>
    Math.abs(candidate.ratio - quarterRatio) < Math.abs(best.ratio - quarterRatio) ? candidate : best
  ).type;
}

function pitchXml(midiNumber: number): string {
  const pitchClasses = [
    { step: "C", alter: 0 },
    { step: "C", alter: 1 },
    { step: "D", alter: 0 },
    { step: "D", alter: 1 },
    { step: "E", alter: 0 },
    { step: "F", alter: 0 },
    { step: "F", alter: 1 },
    { step: "G", alter: 0 },
    { step: "G", alter: 1 },
    { step: "A", alter: 0 },
    { step: "A", alter: 1 },
    { step: "B", alter: 0 }
  ];
  const pitch = pitchClasses[((midiNumber % 12) + 12) % 12];
  const octave = Math.floor(midiNumber / 12) - 1;

  return `<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
