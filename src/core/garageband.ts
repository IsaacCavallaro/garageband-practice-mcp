import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { getActiveMidiPath } from "./project.js";
import { projectSubdir } from "./paths.js";

const garageBandAppPath = "/Applications/GarageBand.app";

export interface OpenInGarageBandInput {
  projectSlug: string;
  midiFilePath?: string;
  preferSavedProject?: boolean;
}

export async function openInGarageBand(input: OpenInGarageBandInput): Promise<{
  garageBandInstalled: boolean;
  openedPath: string;
  openedKind: "garageband-project" | "midi-handoff";
  opened: boolean;
  message: string;
  scoreEditorSetup: string[];
}> {
  const target = await resolveGarageBandOpenTarget(input);
  const garageBandInstalled = await pathExists(garageBandAppPath);

  if (!garageBandInstalled) {
    return {
      garageBandInstalled,
      ...target,
      opened: false,
      message: "GarageBand was not found at /Applications/GarageBand.app.",
      scoreEditorSetup: scoreEditorSetup(target.openedKind)
    };
  }

  const result = spawnSync("open", ["-a", "GarageBand", target.openedPath], {
    encoding: "utf8",
    timeout: 15_000
  });

  if (result.status !== 0) {
    return {
      garageBandInstalled,
      ...target,
      opened: false,
      message: result.stderr || result.stdout || "GarageBand open command failed.",
      scoreEditorSetup: scoreEditorSetup(target.openedKind)
    };
  }

  return {
    garageBandInstalled,
    ...target,
    opened: true,
    message:
      target.openedKind === "garageband-project"
        ? "Saved GarageBand project opened. Its native Score Editor and playback configuration are preserved."
        : "MIDI handoff opened in GarageBand. Complete the one-time native Score Editor setup, then save the .band project in this song's garageband folder.",
    scoreEditorSetup: scoreEditorSetup(target.openedKind)
  };
}

export async function resolveGarageBandOpenTarget(input: OpenInGarageBandInput): Promise<{
  openedPath: string;
  openedKind: "garageband-project" | "midi-handoff";
}> {
  if (input.preferSavedProject !== false && !input.midiFilePath) {
    const savedProject = await findSavedGarageBandProject(input.projectSlug);
    if (savedProject) {
      return { openedPath: savedProject, openedKind: "garageband-project" };
    }
  }

  return {
    openedPath: await getActiveMidiPath(input.projectSlug, input.midiFilePath),
    openedKind: "midi-handoff"
  };
}

export async function findSavedGarageBandProject(projectSlug: string): Promise<string | undefined> {
  const handoffDirectory = projectSubdir(projectSlug, "garageband");
  let entries: string[];

  try {
    entries = await readdir(handoffDirectory);
  } catch {
    return undefined;
  }

  const candidates = entries
    .filter((entry) => entry.toLowerCase().endsWith(".band"))
    .sort((left, right) => left.localeCompare(right));

  for (const candidate of candidates) {
    const candidatePath = join(handoffDirectory, candidate);
    if ((await stat(candidatePath)).isDirectory()) {
      return candidatePath;
    }
  }

  return undefined;
}

function scoreEditorSetup(openedKind: "garageband-project" | "midi-handoff"): string[] {
  if (openedKind === "garageband-project") {
    return ["Select the notation track and open its editor if the Score Editor is not already visible."];
  }

  return [
    "Import the MIDI as tracks.",
    "Select the '<song title> - MIDI' software-instrument track, double-click its MIDI region, then choose Score in the editor.",
    "Play from the GarageBand transport and play your MIDI keyboard through the selected notation track.",
    "Save the project as garageband/<song-slug>.band so future open_in_garageband calls reopen the native session."
  ];
}

export async function diagnoseSetup(): Promise<{
  garageBand: {
    expectedPath: string;
    installed: boolean;
  };
  midiDeviceHints: string[];
  audioDeviceHints: string[];
  expectedDevices: {
    midi: ExpectedDeviceStatus[];
    audio: ExpectedDeviceStatus[];
  };
  audioMidiSetup: {
    expectedPaths: string[];
    installed: boolean;
  };
  notationRenderers: {
    musescoreOnPath: boolean;
  };
  warnings: string[];
}> {
  const usbProfile = runSystemProfiler("SPUSBDataType");
  const audioProfile = runSystemProfiler("SPAudioDataType");
  const midiProfile = runSystemProfiler("SPMIDIDataType");
  const midiDeviceHints = extractDeviceHints(
    `${usbProfile.stdout}\n${midiProfile.stdout}`,
    /midi|keylab|arturia|keyboard|controller|novation|akai|native instruments|komplete|roland|yamaha|korg/i
  );
  const audioDeviceHints = extractDeviceHints(
    audioProfile.stdout,
    /audio|interface|focusrite|scarlett|apollo|universal audio|presonus|steinberg|motu|komplete|ssl|yamaha|behringer|rode|zoom/i
  );
  const expectedMidiDevices = parseExpectedDevices(process.env.GARAGEBAND_EXPECTED_MIDI_DEVICES);
  const expectedAudioDevices = parseExpectedDevices(process.env.GARAGEBAND_EXPECTED_AUDIO_INTERFACES);
  const audioMidiSetupPaths = [
    "/System/Applications/Utilities/Audio MIDI Setup.app",
    "/Applications/Utilities/Audio MIDI Setup.app"
  ];
  const warnings = [
    ...profileWarnings("USB device scan", usbProfile),
    ...profileWarnings("MIDI device scan", midiProfile),
    ...profileWarnings("audio device scan", audioProfile)
  ];
  const musescore = spawnSync("which", ["mscore"], { encoding: "utf8" });

  return {
    garageBand: {
      expectedPath: garageBandAppPath,
      installed: await pathExists(garageBandAppPath)
    },
    midiDeviceHints,
    audioDeviceHints,
    expectedDevices: {
      midi: matchExpectedDevices(expectedMidiDevices, midiDeviceHints),
      audio: matchExpectedDevices(expectedAudioDevices, audioDeviceHints)
    },
    audioMidiSetup: {
      expectedPaths: audioMidiSetupPaths,
      installed: (await Promise.all(audioMidiSetupPaths.map((path) => pathExists(path)))).some(Boolean)
    },
    notationRenderers: {
      musescoreOnPath: musescore.status === 0
    },
    warnings
  };
}

interface ExpectedDeviceStatus {
  name: string;
  detected: boolean;
}

interface ProfileResult {
  stdout: string;
  status: number | null;
  error?: Error;
}

function runSystemProfiler(dataType: string): ProfileResult {
  const result = spawnSync("system_profiler", [dataType], {
    encoding: "utf8",
    timeout: 8_000
  });

  return {
    stdout: result.stdout || "",
    status: result.status,
    error: result.error
  };
}

function extractDeviceHints(profileOutput: string, pattern: RegExp): string[] {
  const hints = profileOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && pattern.test(line));

  return [...new Set(hints)];
}

function parseExpectedDevices(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((device) => device.trim())
    .filter(Boolean);
}

function matchExpectedDevices(expected: string[], detectedHints: string[]): ExpectedDeviceStatus[] {
  return expected.map((name) => ({
    name,
    detected: detectedHints.some((hint) => hint.toLowerCase().includes(name.toLowerCase()))
  }));
}

function profileWarnings(label: string, result: ProfileResult): string[] {
  if (result.status === 0) {
    return [];
  }

  if (result.error) {
    return [`${label} failed: ${result.error.message}`];
  }

  return [`${label} exited with status ${result.status ?? "unknown"}.`];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
