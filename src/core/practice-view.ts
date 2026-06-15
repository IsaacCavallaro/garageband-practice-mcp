import { mkdir, writeFile } from "node:fs/promises";
import { relative, sep, join } from "node:path";

import { analyzeMidiFile, midiNoteName, readMidiFile } from "./midi.js";
import { projectSubdir, resolveProjectPath, toProjectRelativePath } from "./paths.js";
import { getActiveMidiPath, loadProject, writeProject } from "./project.js";
import { safeFileStem } from "./slug.js";

export interface GenerateBrowserPracticeViewInput {
  projectSlug: string;
  midiFilePath?: string;
  scorePath?: string;
  outputBasename?: string;
}

interface BrowserNoteEvent {
  midi: number;
  name: string;
  time: number;
  duration: number;
  velocity: number;
  track: string;
  measure: number;
}

export async function generateBrowserPracticeView(input: GenerateBrowserPracticeViewInput): Promise<{
  htmlPath: string;
  midiPath: string;
  scorePath?: string;
  noteCount: number;
}> {
  const project = await loadProject(input.projectSlug);
  const midiPath = await getActiveMidiPath(input.projectSlug, input.midiFilePath);

  const analysis = await analyzeMidiFile(midiPath);
  const midi = await readMidiFile(midiPath);
  const practiceDir = projectSubdir(project.slug, "practice");
  await mkdir(practiceDir, { recursive: true });

  const scorePath = input.scorePath
    ? resolveProjectPath(project.slug, input.scorePath)
    : findBestScorePath(project.chartFiles.map((file) => resolveProjectPath(project.slug, file.path)));
  const outputBasename = safeFileStem(input.outputBasename ?? "index");
  const htmlPath = join(practiceDir, `${outputBasename}.html`);
  const notes = midi.tracks
    .flatMap<BrowserNoteEvent>((track, trackIndex) =>
      track.notes.map((note) => ({
        midi: note.midi,
        name: note.name || midiNoteName(note.midi),
        time: round(note.time, 4),
        duration: round(note.duration, 4),
        velocity: round(note.velocity, 3),
        track: track.name || `Track ${trackIndex + 1}`,
        measure: Math.max(1, Math.floor(midi.header.ticksToMeasures(note.ticks)) + 1)
      }))
    )
    .sort((a, b) => a.time - b.time || a.midi - b.midi);

  await writeFile(
    htmlPath,
    buildPracticeHtml({
      title: project.title,
      composer: project.composer,
      midiPath,
      scorePath,
      htmlPath,
      notes,
      measures: analysis.measures,
      durationSeconds: analysis.durationSeconds,
      tempoBpm: analysis.tempos[0]?.bpm ?? 120,
      range: analysis.overallRange
        ? `${analysis.overallRange.minName}-${analysis.overallRange.maxName}`
        : "No notes"
    }),
    "utf8"
  );

  project.practiceFiles ??= [];
  project.practiceFiles.push({
    path: toProjectRelativePath(project.slug, htmlPath),
    format: "html",
    sourceMidiPath: toProjectRelativePath(project.slug, midiPath),
    scorePath: scorePath ? toProjectRelativePath(project.slug, scorePath) : undefined,
    createdAt: new Date().toISOString()
  });
  await writeProject(project);

  return {
    htmlPath,
    midiPath,
    scorePath,
    noteCount: notes.length
  };
}

function findBestScorePath(paths: string[]): string | undefined {
  return paths.find((path) => path.toLowerCase().endsWith(".pdf"))
    ?? paths.find((path) => path.toLowerCase().endsWith(".musicxml"));
}

function buildPracticeHtml(input: {
  title: string;
  composer?: string;
  midiPath: string;
  scorePath?: string;
  htmlPath: string;
  notes: BrowserNoteEvent[];
  measures: number;
  durationSeconds: number;
  tempoBpm: number;
  range: string;
}): string {
  const practiceDir = projectSubdirFromHtmlPath(input.htmlPath);
  const scoreHref = input.scorePath ? toRelativeUrl(practiceDir, input.scorePath) : undefined;
  const midiHref = toRelativeUrl(practiceDir, input.midiPath);
  const data = JSON.stringify({
    title: input.title,
    composer: input.composer,
    midiHref,
    scoreHref,
    notes: input.notes,
    measures: input.measures,
    durationSeconds: input.durationSeconds,
    tempoBpm: input.tempoBpm,
    range: input.range
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)} Practice</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #202124;
      --muted: #5f6368;
      --line: #d8dce3;
      --paper: #fbfbf8;
      --panel: #ffffff;
      --accent: #1f7a5c;
      --accent-strong: #155b44;
      --warm: #b45f06;
      --shadow: 0 10px 30px rgba(32, 33, 36, 0.10);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: var(--ink);
      background: var(--paper);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .app {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    header {
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      padding: 14px 18px;
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto;
      gap: 16px;
      align-items: center;
    }

    h1 {
      font-size: 19px;
      line-height: 1.2;
      margin: 0;
      font-weight: 720;
      letter-spacing: 0;
    }

    .subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }

    .transport {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    button, .file-link {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      border-radius: 7px;
      min-height: 36px;
      padding: 0 12px;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }

    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }

    button.primary:hover { background: var(--accent-strong); }
    button:hover, .file-link:hover { border-color: var(--accent); }

    main {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) 310px;
      gap: 0;
      min-height: 0;
    }

    .score {
      min-height: 0;
      border-right: 1px solid var(--line);
      background: #e9ecef;
    }

    .score iframe {
      width: 100%;
      height: 100%;
      min-height: calc(100vh - 73px);
      border: 0;
      background: #fff;
    }

    .empty-score {
      height: 100%;
      min-height: calc(100vh - 73px);
      display: grid;
      place-items: center;
      color: var(--muted);
      padding: 24px;
      text-align: center;
    }

    aside {
      background: var(--panel);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      min-width: 0;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .metric {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      min-width: 0;
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 3px;
    }

    .metric strong {
      display: block;
      font-size: 16px;
      overflow-wrap: anywhere;
    }

    label {
      display: grid;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    input[type="range"] { width: 100%; accent-color: var(--accent); }

    .progress {
      height: 11px;
      border-radius: 999px;
      background: #e6e8eb;
      overflow: hidden;
      border: 1px solid var(--line);
    }

    .progress div {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--warm));
    }

    .now {
      display: grid;
      gap: 5px;
    }

    .now strong {
      font-size: 24px;
      line-height: 1;
      letter-spacing: 0;
    }

    .now span {
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .files {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .note-lane {
      border-top: 1px solid var(--line);
      padding-top: 14px;
      display: grid;
      gap: 8px;
      max-height: 240px;
      overflow: auto;
    }

    .note-row {
      display: grid;
      grid-template-columns: 48px 1fr 56px;
      gap: 8px;
      align-items: center;
      font-size: 13px;
      color: var(--muted);
    }

    .note-row.active {
      color: var(--accent-strong);
      font-weight: 750;
    }

    @media (max-width: 900px) {
      header {
        grid-template-columns: 1fr;
      }

      .transport {
        justify-content: flex-start;
      }

      main {
        grid-template-columns: 1fr;
      }

      .score {
        border-right: 0;
        border-bottom: 1px solid var(--line);
        height: 68vh;
      }

      .score iframe,
      .empty-score {
        min-height: 68vh;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div>
        <h1>${escapeHtml(input.title)}</h1>
        <div class="subtitle">${escapeHtml(input.composer ?? "Piano practice")} | ${escapeHtml(input.measures.toString())} measures | ${escapeHtml(Math.round(input.tempoBpm).toString())} BPM</div>
      </div>
      <div class="transport">
        <button class="primary" id="play">Play</button>
        <button id="pause">Pause</button>
        <button id="stop">Stop</button>
      </div>
    </header>
    <main>
      <section class="score" aria-label="Practice score">
        ${scoreHref
          ? `<iframe title="Score" src="${scoreHref}#toolbar=1&navpanes=0&view=FitH"></iframe>`
          : `<div class="empty-score">No score PDF was generated for this project.</div>`}
      </section>
      <aside>
        <div class="metric-grid">
          <div class="metric"><span>Range</span><strong>${escapeHtml(input.range)}</strong></div>
          <div class="metric"><span>Notes</span><strong>${input.notes.length}</strong></div>
          <div class="metric"><span>Tempo</span><strong><span id="tempoValue">100</span>%</strong></div>
          <div class="metric"><span>Measure</span><strong id="measure">1/${input.measures}</strong></div>
        </div>

        <label>
          Playback tempo
          <input id="tempo" type="range" min="40" max="130" value="100" step="5">
        </label>

        <div>
          <div class="progress"><div id="bar"></div></div>
        </div>

        <div class="now">
          <strong id="clock">0:00</strong>
          <span id="currentNote">Ready</span>
        </div>

        <div class="files">
          ${scoreHref ? `<a class="file-link" href="${scoreHref}" target="_blank" rel="noreferrer">Score PDF</a>` : ""}
          <a class="file-link" href="${midiHref}" target="_blank" rel="noreferrer">MIDI</a>
        </div>

        <div class="note-lane" id="noteLane"></div>
      </aside>
    </main>
  </div>
  <script>
    const PRACTICE = ${data};
    const notes = PRACTICE.notes;
    const audioState = {
      context: null,
      startedAt: 0,
      offset: 0,
      playing: false,
      scheduled: [],
      raf: 0
    };

    const playButton = document.getElementById("play");
    const pauseButton = document.getElementById("pause");
    const stopButton = document.getElementById("stop");
    const tempo = document.getElementById("tempo");
    const tempoValue = document.getElementById("tempoValue");
    const bar = document.getElementById("bar");
    const clock = document.getElementById("clock");
    const measure = document.getElementById("measure");
    const currentNote = document.getElementById("currentNote");
    const noteLane = document.getElementById("noteLane");

    tempo.addEventListener("input", () => {
      tempoValue.textContent = tempo.value;
      if (audioState.playing) {
        const position = getPosition();
        stopAudio(false);
        audioState.offset = position;
        startAudio();
      }
    });
    playButton.addEventListener("click", startAudio);
    pauseButton.addEventListener("click", () => {
      audioState.offset = getPosition();
      stopAudio(false);
    });
    stopButton.addEventListener("click", () => stopAudio(true));

    renderNoteLane();
    updateUi(0);

    async function startAudio() {
      if (audioState.playing) return;
      if (!audioState.context) {
        audioState.context = new AudioContext();
      }
      if (audioState.context.state === "suspended") {
        await audioState.context.resume();
      }

      const speed = Number(tempo.value) / 100;
      const context = audioState.context;
      const now = context.currentTime + 0.06;
      audioState.startedAt = context.currentTime - audioState.offset / speed;
      audioState.playing = true;

      for (const note of notes) {
        if (note.time + note.duration < audioState.offset) continue;
        const start = now + Math.max(0, (note.time - audioState.offset) / speed);
        const duration = Math.max(0.05, note.duration / speed);
        audioState.scheduled.push(playNote(context, note, start, duration));
      }

      tick();
    }

    function playNote(context, note, start, duration) {
      const frequency = 440 * Math.pow(2, (note.midi - 69) / 12);
      const gain = context.createGain();
      const osc = context.createOscillator();
      const overtone = context.createOscillator();
      const filter = context.createBiquadFilter();
      const peak = Math.min(0.22, 0.08 + note.velocity * 0.16);

      osc.type = "triangle";
      overtone.type = "sine";
      osc.frequency.value = frequency;
      overtone.frequency.value = frequency * 2;
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.8;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(filter);
      overtone.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      osc.start(start);
      overtone.start(start);
      osc.stop(start + duration + 0.08);
      overtone.stop(start + duration + 0.08);
      return [osc, overtone, gain];
    }

    function stopAudio(reset) {
      for (const scheduled of audioState.scheduled) {
        for (const node of scheduled) {
          try {
            if (typeof node.stop === "function") node.stop(0);
            node.disconnect();
          } catch {}
        }
      }
      audioState.scheduled = [];
      audioState.playing = false;
      cancelAnimationFrame(audioState.raf);
      if (reset) {
        audioState.offset = 0;
        updateUi(0);
      }
    }

    function getPosition() {
      if (!audioState.playing || !audioState.context) return audioState.offset;
      return Math.min(PRACTICE.durationSeconds, (audioState.context.currentTime - audioState.startedAt) * (Number(tempo.value) / 100));
    }

    function tick() {
      const position = getPosition();
      updateUi(position);
      if (position >= PRACTICE.durationSeconds) {
        stopAudio(true);
        return;
      }
      audioState.raf = requestAnimationFrame(tick);
    }

    function updateUi(position) {
      const percent = PRACTICE.durationSeconds > 0 ? Math.min(100, (position / PRACTICE.durationSeconds) * 100) : 0;
      const active = findActiveNote(position);
      bar.style.width = percent.toFixed(2) + "%";
      clock.textContent = formatTime(position);
      measure.textContent = (active?.measure ?? 1) + "/" + PRACTICE.measures;
      currentNote.textContent = active ? active.name + " | " + active.track : "Ready";
      for (const row of noteLane.querySelectorAll(".note-row")) {
        row.classList.toggle("active", Number(row.dataset.index) === active?.index);
      }
    }

    function findActiveNote(position) {
      let best = null;
      for (let index = 0; index < notes.length; index += 1) {
        const note = notes[index];
        if (note.time <= position && note.time + Math.max(0.08, note.duration) >= position) {
          best = { ...note, index };
          break;
        }
        if (note.time > position) break;
      }
      return best;
    }

    function renderNoteLane() {
      const sample = notes.filter((_, index) => index % Math.max(1, Math.floor(notes.length / 80)) === 0).slice(0, 80);
      noteLane.innerHTML = sample.map((note) => {
        const index = notes.indexOf(note);
        return '<div class="note-row" data-index="' + index + '"><strong>' + note.name + '</strong><span>' + escapeText(note.track) + '</span><span>M' + note.measure + '</span></div>';
      }).join("");
    }

    function formatTime(seconds) {
      const whole = Math.max(0, Math.floor(seconds));
      return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
    }

    function escapeText(text) {
      return String(text).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]);
    }
  </script>
</body>
</html>
`;
}

function projectSubdirFromHtmlPath(htmlPath: string): string {
  return htmlPath.slice(0, htmlPath.lastIndexOf(sep));
}

function toRelativeUrl(fromDir: string, targetPath: string): string {
  return encodeURI(relative(fromDir, targetPath).split(sep).join("/"));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char] ?? char);
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
