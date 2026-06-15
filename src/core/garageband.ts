import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { getActiveMidiPath } from "./project.js";

const garageBandAppPath = "/Applications/GarageBand.app";

export interface OpenInGarageBandInput {
  projectSlug: string;
  midiFilePath?: string;
}

export async function openInGarageBand(input: OpenInGarageBandInput): Promise<{
  garageBandInstalled: boolean;
  midiPath: string;
  opened: boolean;
  message: string;
}> {
  const midiPath = await getActiveMidiPath(input.projectSlug, input.midiFilePath);
  const garageBandInstalled = await pathExists(garageBandAppPath);

  if (!garageBandInstalled) {
    return {
      garageBandInstalled,
      midiPath,
      opened: false,
      message: "GarageBand was not found at /Applications/GarageBand.app."
    };
  }

  const result = spawnSync("open", ["-a", "GarageBand", midiPath], {
    encoding: "utf8",
    timeout: 15_000
  });

  if (result.status !== 0) {
    return {
      garageBandInstalled,
      midiPath,
      opened: false,
      message: result.stderr || result.stdout || "GarageBand open command failed."
    };
  }

  return {
    garageBandInstalled,
    midiPath,
    opened: true,
    message: "MIDI handoff opened in GarageBand. Save the .band project manually from GarageBand if desired."
  };
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
