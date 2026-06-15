export type SourceKind =
  | "user_supplied_midi"
  | "mutopia_open_license"
  | "generated_chart";

export interface PracticeProject {
  schemaVersion: 1;
  title: string;
  composer?: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  contentPolicy: ContentPolicySnapshot;
  paths: ProjectRelativePaths;
  sources: ProjectSource[];
  midiFiles: ProjectMidiFile[];
  chartFiles: ProjectChartFile[];
  practiceFiles?: ProjectPracticeFile[];
  activeMidiPath?: string;
}

export interface ContentPolicySnapshot {
  accepts: string[];
  searches: string[];
  rejects: string[];
  later: string[];
}

export interface ProjectRelativePaths {
  source: string;
  midi: string;
  charts: string;
  practice?: string;
  garagebandNotes: string;
  projectJson: string;
}

export interface ProjectSource {
  kind: SourceKind;
  path?: string;
  url?: string;
  provider?: string;
  title?: string;
  license?: string;
  importedAt: string;
}

export interface ProjectMidiFile {
  path: string;
  role: "source-copy" | "garageband-handoff";
  analysis: MidiAnalysis;
  createdAt: string;
}

export interface ProjectChartFile {
  path: string;
  format: "musicxml" | "pdf" | "png";
  sourceMidiPath: string;
  createdAt: string;
}

export interface ProjectPracticeFile {
  path: string;
  format: "html";
  sourceMidiPath: string;
  scorePath?: string;
  createdAt: string;
}

export interface MidiTempo {
  ticks: number;
  bpm: number;
}

export interface MidiTimeSignature {
  ticks: number;
  numerator: number;
  denominator: number;
}

export interface MidiNoteRange {
  min: number;
  max: number;
  minName: string;
  maxName: string;
}

export interface MidiTrackAnalysis {
  index: number;
  name?: string;
  channel?: number;
  instrument?: {
    number?: number;
    name?: string;
    family?: string;
  };
  noteCount: number;
  range?: MidiNoteRange;
}

export interface MidiAnalysis {
  filePath: string;
  fileName: string;
  ppq: number;
  durationSeconds: number;
  totalTicks: number;
  tempos: MidiTempo[];
  timeSignatures: MidiTimeSignature[];
  measures: number;
  tracks: MidiTrackAnalysis[];
  overallRange?: MidiNoteRange;
}

export interface MutopiaSearchResult {
  id?: string;
  provider: "Mutopia Project";
  title: string;
  composer?: string;
  catalog?: string;
  instruments?: string;
  style?: string;
  license?: string;
  sourcePageUrl?: string;
  midiUrl?: string;
  lilypondUrl?: string;
  pdfUrl?: string;
  previewImageUrl?: string;
  ftpAreaUrl?: string;
}

export interface ToolJsonResult {
  ok: boolean;
  [key: string]: unknown;
}
