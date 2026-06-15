import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import midiPackage from "@tonejs/midi";
import type { Midi as MidiType } from "@tonejs/midi";
import { writeMidi } from "midi-file";
import type { MidiEvent } from "midi-file";

import type {
  MidiAnalysis,
  MidiNoteRange,
  MidiTempo,
  MidiTimeSignature,
  MidiTrackAnalysis
} from "./types.js";

const { Midi } = midiPackage;

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

export async function readMidiFile(filePath: string): Promise<MidiType> {
  const bytes = await readFile(filePath);
  if (bytes.length < 14 || bytes.subarray(0, 4).toString("ascii") !== "MThd") {
    throw new Error(`File does not look like a Standard MIDI file: ${filePath}`);
  }

  return new Midi(bufferToArrayBuffer(bytes));
}

export async function writeMidiFile(midi: MidiType, filePath: string): Promise<void> {
  await writeFile(filePath, Buffer.from(midi.toArray()));
}

export async function writeGarageBandPlayalongMidiFile(
  source: MidiType,
  filePath: string,
  title: string,
  options: {
    playbackTrackName?: string;
    playalongTrackName?: string;
  } = {}
): Promise<void> {
  await writeFile(
    filePath,
    Buffer.from(createGarageBandPlayalongMidiBytes(source, title, options))
  );
}

export function createGarageBandPlayalongMidiBytes(
  source: MidiType,
  title: string,
  options: {
    playbackTrackName?: string;
    playalongTrackName?: string;
  } = {}
): Uint8Array {
  const playbackTrackName = options.playbackTrackName ?? `${title} - MIDI`;
  const playalongTrackName = options.playalongTrackName ?? "Your Piano - Play Along";
  const playbackTrack = toDeltaEvents([
    { absoluteTime: 0, order: 0, event: { deltaTime: 0, meta: true, type: "trackName", text: playbackTrackName } },
    { absoluteTime: 0, order: 1, event: { deltaTime: 0, channel: 0, type: "programChange", programNumber: 0 } },
    ...source.header.tempos.map((tempo) => ({
      absoluteTime: tempo.ticks,
      order: 2,
      event: {
        deltaTime: 0,
        meta: true as const,
        type: "setTempo" as const,
        microsecondsPerBeat: Math.round(60_000_000 / tempo.bpm)
      }
    })),
    ...source.header.timeSignatures.map((signature) => ({
      absoluteTime: signature.ticks,
      order: 3,
      event: {
        deltaTime: 0,
        meta: true as const,
        type: "timeSignature" as const,
        numerator: signature.timeSignature[0] ?? 4,
        denominator: signature.timeSignature[1] ?? 4,
        metronome: 24,
        thirtyseconds: 8
      }
    })),
    ...source.tracks.flatMap((track) =>
      track.notes.flatMap((note) => {
        const startTick = Math.max(0, Math.round(note.ticks));
        const endTick = Math.max(startTick + 1, Math.round(note.ticks + note.durationTicks));
        return [
          {
            absoluteTime: startTick,
            order: 30,
            event: {
              deltaTime: 0,
              channel: 0,
              type: "noteOn" as const,
              noteNumber: note.midi,
              velocity: toMidiVelocity(note.velocity, 1)
            }
          },
          {
            absoluteTime: endTick,
            order: 20,
            event: {
              deltaTime: 0,
              channel: 0,
              type: "noteOff" as const,
              noteNumber: note.midi,
              velocity: toMidiVelocity(note.noteOffVelocity, 0)
            }
          }
        ];
      })
    )
  ]);
  const playalongTrack = toDeltaEvents([
    { absoluteTime: 0, order: 0, event: { deltaTime: 0, meta: true, type: "trackName", text: playalongTrackName } },
    { absoluteTime: 0, order: 1, event: { deltaTime: 0, channel: 1, type: "programChange", programNumber: 0 } }
  ]);

  return new Uint8Array(writeMidi({
    header: {
      format: 1,
      numTracks: 2,
      ticksPerBeat: source.header.ppq
    },
    tracks: [playbackTrack, playalongTrack]
  }));
}

export function createGarageBandPlayalongMidi(
  source: MidiType,
  title: string,
  options: {
    playbackTrackName?: string;
    playalongTrackName?: string;
  } = {}
): MidiType {
  const normalized = new Midi();
  normalized.header.fromJSON(source.header.toJSON());
  normalized.header.name = title;

  const playbackTrack = normalized.addTrack();
  playbackTrack.name = options.playbackTrackName ?? `${title} - MIDI`;
  playbackTrack.channel = 0;
  playbackTrack.instrument.number = 0;

  const sourceNotes = source.tracks
    .flatMap((track) => track.notes)
    .sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  for (const note of sourceNotes) {
    playbackTrack.addNote({
      midi: note.midi,
      ticks: Math.max(0, Math.round(note.ticks)),
      durationTicks: Math.max(1, Math.round(note.durationTicks)),
      velocity: note.velocity,
      noteOffVelocity: note.noteOffVelocity
    });
  }

  const playalongTrack = normalized.addTrack();
  playalongTrack.name = options.playalongTrackName ?? "Your Piano - Play Along";
  playalongTrack.channel = 1;
  playalongTrack.instrument.number = 0;

  return normalized;
}

export async function analyzeMidiFile(filePath: string): Promise<MidiAnalysis> {
  const midi = await readMidiFile(filePath);
  return analyzeMidi(midi, filePath);
}

export function analyzeMidi(midi: MidiType, filePath: string): MidiAnalysis {
  const tempos = normalizeTempos(midi);
  const timeSignatures = normalizeTimeSignatures(midi);
  const totalTicks = getTotalTicks(midi);
  const tracks = midi.tracks.map<MidiTrackAnalysis>((track, index) => {
    const noteMidis = track.notes.map((note) => note.midi);

    return {
      index,
      name: track.name || undefined,
      channel: track.channel,
      instrument: {
        number: track.instrument?.number,
        name: track.instrument?.name,
        family: track.instrument?.family
      },
      noteCount: track.notes.length,
      range: noteMidis.length > 0 ? makeRange(noteMidis) : undefined
    };
  });
  const allNotes = midi.tracks.flatMap((track) => track.notes.map((note) => note.midi));
  const firstSignature = timeSignatures[0] ?? { ticks: 0, numerator: 4, denominator: 4 };
  const measureTicks = midi.header.ppq * 4 * (firstSignature.numerator / firstSignature.denominator);

  return {
    filePath,
    fileName: basename(filePath),
    ppq: midi.header.ppq,
    durationSeconds: midi.duration,
    totalTicks,
    tempos,
    timeSignatures,
    measures: measureTicks > 0 ? Math.max(1, Math.ceil(totalTicks / measureTicks)) : 1,
    tracks,
    overallRange: allNotes.length > 0 ? makeRange(allNotes) : undefined
  };
}

export function getTotalTicks(midi: MidiType): number {
  return Math.max(
    0,
    ...midi.tracks.flatMap((track) =>
      track.notes.map((note) => Math.ceil(note.ticks + note.durationTicks))
    )
  );
}

export function midiNoteName(midiNumber: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pitchClass = ((midiNumber % 12) + 12) % 12;
  const octave = Math.floor(midiNumber / 12) - 1;
  return `${names[pitchClass]}${octave}`;
}

function makeRange(notes: number[]): MidiNoteRange {
  const min = Math.min(...notes);
  const max = Math.max(...notes);

  return {
    min,
    max,
    minName: midiNoteName(min),
    maxName: midiNoteName(max)
  };
}

function normalizeTempos(midi: MidiType): MidiTempo[] {
  if (midi.header.tempos.length === 0) {
    return [{ ticks: 0, bpm: 120 }];
  }

  return midi.header.tempos.map((tempo) => ({
    ticks: tempo.ticks,
    bpm: Number(tempo.bpm.toFixed(3))
  }));
}

function normalizeTimeSignatures(midi: MidiType): MidiTimeSignature[] {
  if (midi.header.timeSignatures.length === 0) {
    return [{ ticks: 0, numerator: 4, denominator: 4 }];
  }

  return midi.header.timeSignatures.map((signature) => ({
    ticks: signature.ticks,
    numerator: signature.timeSignature[0] ?? 4,
    denominator: signature.timeSignature[1] ?? 4
  }));
}

interface AbsoluteMidiEvent {
  absoluteTime: number;
  order: number;
  event: MidiEvent;
}

function toDeltaEvents(events: AbsoluteMidiEvent[]): MidiEvent[] {
  const sortedEvents = events.sort((a, b) => a.absoluteTime - b.absoluteTime || a.order - b.order);
  const deltaEvents: MidiEvent[] = [];
  let previousTick = 0;

  for (const { absoluteTime, event } of sortedEvents) {
    deltaEvents.push({
      ...event,
      deltaTime: Math.max(0, absoluteTime - previousTick)
    });
    previousTick = absoluteTime;
  }

  deltaEvents.push({
    deltaTime: 0,
    meta: true,
    type: "endOfTrack"
  });

  return deltaEvents;
}

function toMidiVelocity(value: number, minimum: number): number {
  return Math.max(minimum, Math.min(127, Math.round(value * 127)));
}
