import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

import { assertAllowedMutopiaMidiUrl, contentPolicy } from "./policy.js";
import { projectDir, projectJsonPath, projectSubdir, resolveProjectPath, toProjectRelativePath } from "./paths.js";
import { analyzeMidiFile, readMidiFile, sliceMidiByMeasure, writeGarageBandPlayalongMidiFile } from "./midi.js";
import { assertValidSlug, safeFileStem, slugify } from "./slug.js";
import type { MidiAnalysis, PracticeProject, ProjectMidiFile, ProjectSource } from "./types.js";

export interface CreatePracticeProjectInput {
  title: string;
  composer?: string;
  slug?: string;
  notes?: string;
  reuseExisting?: boolean;
}

export interface ImportUserMidiInput {
  projectSlug: string;
  midiFilePath: string;
  copyName?: string;
}

export interface ImportPublicDomainMidiInput {
  projectSlug: string;
  midiUrl: string;
  title?: string;
  license?: string;
  provider?: string;
  sourcePageUrl?: string;
}

export interface GenerateBarPracticeAssetsInput {
  projectSlug: string;
  midiFilePath?: string;
}

export async function generateBarPracticeAssets(input: GenerateBarPracticeAssetsInput): Promise<{
  directory: string;
  bars: Array<{ number: number; midiPath: string; startTick: number; endTick: number }>;
  loopInstructions: string;
}> {
  const project = await loadProject(input.projectSlug);
  const midiPath = await getActiveMidiPath(project.slug, input.midiFilePath);
  const source = await readMidiFile(midiPath);
  const signature = source.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const measureTicks = Math.max(1, Math.round(source.header.ppq * 4 * (signature[0] / signature[1])));
  const directory = join(projectSubdir(project.slug, "midi"), "bars");
  const slices = sliceMidiByMeasure(source);
  await mkdir(directory, { recursive: true });

  const bars = await Promise.all(slices.map(async (slice, index) => {
    const number = index + 1;
    const midiPath = join(directory, `${safeFileStem(project.slug)}-bar-${String(number).padStart(2, "0")}.mid`);
    await writeGarageBandPlayalongMidiFile(slice, midiPath, `${project.title} – Bar ${String(number).padStart(2, "0")}`);
    return { number, midiPath, startTick: index * measureTicks, endTick: (index + 1) * measureTicks };
  }));

  const manifestPath = join(directory, "practice-bars.json");
  await writeFile(manifestPath, `${JSON.stringify({ projectSlug: project.slug, timeSignature: signature, bars }, null, 2)}\n`, "utf8");
  return {
    directory,
    bars,
    loopInstructions: "Each file contains exactly one bar of backing piano plus an empty play-along track. Import a selected bar into GarageBand and enable Cycle for that one-bar region."
  };
}

export async function createPracticeProject(input: CreatePracticeProjectInput): Promise<PracticeProject> {
  const now = new Date().toISOString();
  const slug = assertValidSlug(input.slug ? slugify(input.slug) : slugify(input.title));
  const root = projectDir(slug);
  const jsonPath = projectJsonPath(slug);

  if (!input.reuseExisting && (await exists(jsonPath))) {
    throw new Error(`Practice project already exists for slug "${slug}".`);
  }

  if (input.reuseExisting && (await exists(jsonPath))) {
    return loadProject(slug);
  }

  await mkdir(projectSubdir(slug, "source"), { recursive: true });
  await mkdir(projectSubdir(slug, "midi"), { recursive: true });
  await mkdir(projectSubdir(slug, "charts"), { recursive: true });
  await mkdir(projectSubdir(slug, "practice"), { recursive: true });
  await mkdir(projectSubdir(slug, "garageband"), { recursive: true });

  const project: PracticeProject = {
    schemaVersion: 1,
    title: input.title,
    composer: input.composer,
    slug,
    createdAt: now,
    updatedAt: now,
    notes: input.notes,
    contentPolicy,
    paths: {
      source: "source/",
      midi: "midi/",
      charts: "charts/",
      practice: "practice/",
      garagebandNotes: "garageband/README.md",
      projectJson: "project.json"
    },
    sources: [],
    midiFiles: [],
    chartFiles: []
  };

  await writeProject(project);
  await writeGarageBandReadme(project);

  return {
    ...project,
    paths: {
      ...project.paths,
      source: join(root, "source"),
      midi: join(root, "midi"),
      charts: join(root, "charts"),
      garagebandNotes: join(root, "garageband", "README.md"),
      projectJson: jsonPath
    }
  };
}

export async function loadProject(slug: string): Promise<PracticeProject> {
  const safeSlug = assertValidSlug(slugify(slug));
  const text = await readFile(projectJsonPath(safeSlug), "utf8");
  return JSON.parse(text) as PracticeProject;
}

export async function writeProject(project: PracticeProject): Promise<void> {
  const nextProject = {
    ...project,
    updatedAt: new Date().toISOString()
  };
  await writeFile(projectJsonPath(project.slug), `${JSON.stringify(nextProject, null, 2)}\n`, "utf8");
}

export async function importUserMidi(input: ImportUserMidiInput): Promise<{
  project: PracticeProject;
  sourcePath: string;
  midiPath: string;
  midi: ProjectMidiFile;
}> {
  const project = await loadProject(input.projectSlug);
  const sourcePath = resolveInputPath(input.midiFilePath);
  await assertReadableMidiPath(sourcePath);

  const sourceName = input.copyName
    ? `${safeFileStem(input.copyName)}${extname(sourcePath).toLowerCase() || ".mid"}`
    : basename(sourcePath);
  const copiedSourcePath = join(projectSubdir(project.slug, "source"), sourceName);
  const handoffPath = join(projectSubdir(project.slug, "midi"), `${safeFileStem(project.slug)}.mid`);
  const copiedSourceProjectPath = toProjectRelativePath(project.slug, copiedSourcePath);
  const handoffProjectPath = toProjectRelativePath(project.slug, handoffPath);

  await copyFile(sourcePath, copiedSourcePath);
  const parsed = await readMidiFile(copiedSourcePath);
  await writeGarageBandPlayalongMidiFile(parsed, handoffPath, project.title);

  const analysis = toStoredMidiAnalysis(project.slug, await analyzeMidiFile(handoffPath));
  const now = new Date().toISOString();
  const source: ProjectSource = {
    kind: "user_supplied_midi",
    path: copiedSourceProjectPath,
    importedAt: now
  };
  const midi: ProjectMidiFile = {
    path: handoffProjectPath,
    role: "garageband-handoff",
    analysis,
    createdAt: now
  };

  project.sources.push(source);
  project.midiFiles.push(midi);
  project.activeMidiPath = handoffProjectPath;
  await writeProject(project);

  return { project: await loadProject(project.slug), sourcePath: copiedSourcePath, midiPath: handoffPath, midi };
}

export async function importPublicDomainMidi(input: ImportPublicDomainMidiInput): Promise<{
  project: PracticeProject;
  sourcePath: string;
  midiPath: string;
  midi: ProjectMidiFile;
}> {
  const project = await loadProject(input.projectSlug);
  const url = assertAllowedMutopiaMidiUrl(input.midiUrl);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download Mutopia MIDI (${response.status} ${response.statusText}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 4).toString("ascii") !== "MThd") {
    throw new Error("Downloaded Mutopia file was not a Standard MIDI file.");
  }

  const sourceName = basename(url.pathname);
  const copiedSourcePath = join(projectSubdir(project.slug, "source"), sourceName);
  const handoffPath = join(projectSubdir(project.slug, "midi"), `${safeFileStem(project.slug)}.mid`);
  const copiedSourceProjectPath = toProjectRelativePath(project.slug, copiedSourcePath);
  const handoffProjectPath = toProjectRelativePath(project.slug, handoffPath);

  await writeFile(copiedSourcePath, bytes);
  const parsed = await readMidiFile(copiedSourcePath);
  await writeGarageBandPlayalongMidiFile(parsed, handoffPath, project.title);

  const analysis = toStoredMidiAnalysis(project.slug, await analyzeMidiFile(handoffPath));
  const now = new Date().toISOString();
  const source: ProjectSource = {
    kind: "mutopia_open_license",
    path: copiedSourceProjectPath,
    url: url.toString(),
    provider: input.provider ?? "Mutopia Project",
    title: input.title,
    license: input.license,
    importedAt: now
  };
  const midi: ProjectMidiFile = {
    path: handoffProjectPath,
    role: "garageband-handoff",
    analysis,
    createdAt: now
  };

  project.sources.push(source);
  project.midiFiles.push(midi);
  project.activeMidiPath = handoffProjectPath;
  await writeProject(project);

  return { project: await loadProject(project.slug), sourcePath: copiedSourcePath, midiPath: handoffPath, midi };
}

export async function getActiveMidiPath(projectSlug: string, midiFilePath?: string): Promise<string> {
  if (midiFilePath) {
    const resolved = resolveInputPath(midiFilePath);
    await assertReadableMidiPath(resolved);
    return resolved;
  }

  const project = await loadProject(projectSlug);
  if (!project.activeMidiPath) {
    throw new Error(`Project "${projectSlug}" does not have an active MIDI file yet.`);
  }

  const midiPath = resolveProjectPath(project.slug, project.activeMidiPath);
  await assertReadableMidiPath(midiPath);
  return midiPath;
}

async function writeGarageBandReadme(project: PracticeProject): Promise<void> {
  const text = `# ${project.title} GarageBand Handoff

This folder contains the native GarageBand practice session. The saved .band project is the primary practice artifact; it should show notation in GarageBand's Score Editor while playback runs.

One-time setup:
1. Run open_in_garageband to import the active MIDI as tracks.
2. Select the '<song title> - MIDI' software-instrument track, double-click its MIDI region, then choose Score in the editor.
3. Play from GarageBand's transport and use your MIDI keyboard through the selected notation track.
4. Save the project here as ${project.slug}.band.

Later sessions:
1. Run open_in_garageband without midiFilePath.
2. The saved .band project in this folder is opened before any MIDI handoff.

Content policy:
- User-supplied MIDI/MusicXML files are accepted when you are authorized to use them.
- Public searches are restricted to public-domain/open-license catalogues.
- Copyrighted MIDI from unauthorized sources is intentionally out of scope.
`;

  await writeFile(join(projectSubdir(project.slug, "garageband"), "README.md"), text, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveInputPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

async function assertReadableMidiPath(filePath: string): Promise<void> {
  const extension = extname(filePath).toLowerCase();
  if (extension !== ".mid" && extension !== ".midi") {
    throw new Error("Expected a .mid or .midi file.");
  }

  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(`Expected a MIDI file, got: ${filePath}`);
  }

  await access(filePath, constants.R_OK);
}

function toStoredMidiAnalysis(slug: string, analysis: MidiAnalysis): MidiAnalysis {
  return {
    ...analysis,
    filePath: toProjectRelativePath(slug, analysis.filePath)
  };
}
