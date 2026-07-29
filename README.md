# GarageBand Practice MCP

Local TypeScript MCP server for creating authorized song-practice projects for GarageBand.

Creates local GarageBand practice workspaces from authorised MIDI, including native-score handoff files and one-bar loop practice assets. No cloud service or paid tooling is required.

## Daily Workflow

The intended Codex workflow is:

1. Run `diagnose_setup` to confirm GarageBand, MIDI keyboard hints, audio interface hints, Audio MIDI Setup, and optional MuseScore rendering support.
2. Run `create_practice_project` for the song, or reuse an existing project slug.
3. Import authorized MIDI with `import_user_midi`, or use `search_public_domain_midi` and `import_public_domain_midi` for Mutopia Project material.
4. Run `generate_bar_practice_assets` to produce a named, one-bar MIDI file for each measure.
5. Run `open_in_garageband` to open the saved native GarageBand project, or import the active MIDI on the first session.
6. In GarageBand, use the native Score Editor for notation, Cycle for a selected bar, and the empty piano track for live keyboard input.
7. Save the session as `garageband/<song-slug>.band`.

Example Codex request:

```text
Use garageband-practice to open bach-prelude-c-major-bwv-846 in GarageBand, then save a session snapshot and push it.
```

Expected device names can be configured before starting Codex:

```bash
export GARAGEBAND_EXPECTED_MIDI_DEVICES="KeyLab,Arturia"
export GARAGEBAND_EXPECTED_AUDIO_INTERFACES="Scarlett,Focusrite"
```

## Content Policy

- Accept user-supplied MIDI/MusicXML files when the user is authorized to use them.
- Search public-domain/open-license catalogues only.
- Mutopia Project is the first supported catalogue because it publishes PDF, MIDI, and LilyPond downloads under public-domain or Creative Commons terms.
- Do not search for or download copyrighted MIDI from unauthorized sources.
- Later AI approximation work must start from user-provided chords/structure and be labeled as an arrangement, not a transcription.

## Project Layout

```text
songs/<slug>/
  source/
  midi/
  charts/
  garageband/README.md
  project.json
```

Project metadata stores artifact paths relative to each song folder, for example `midi/song.mid` or `charts/song.musicxml`. Runtime tools resolve those paths locally when opening GarageBand or rendering practice files.

Tracked session artifacts:

- `songs/**/project.json`
- `songs/**/source/*.mid` and `songs/**/source/*.midi`
- `songs/**/midi/*.mid` and `songs/**/midi/*.midi`
- `songs/**/charts/*.musicxml`
- selected `songs/**/charts/*.pdf` score files
- `songs/**/practice/index.html`
- `songs/**/garageband/README.md`

Ignored session outputs:

- GarageBand `.band` project packages
- audio bounces such as `.wav`, `.aif`, `.m4a`, and `.mp3`
- dependency, build, cache, and log files

## Tools

- `create_practice_project`
- `import_user_midi`
- `search_public_domain_midi`
- `import_public_domain_midi`
- `generate_piano_grand_staff_chart`
- `generate_bar_practice_assets`
- `open_in_garageband`
- `save_session_snapshot`
- `diagnose_setup`

## Local Development

```bash
npm install
npm run check
npm test
npm run audit:prod
npm run mcp
```

## GarageBand Flow

1. Create a practice project.
2. Import a user-supplied MIDI file, or search Mutopia and import a selected Mutopia MIDI result.
3. Generate the piano grand-staff chart.
4. Generate bar practice assets for targeted looping.
5. Open the active MIDI in GarageBand on the first session, then use GarageBand's native Score Editor for notation.
6. Save the `.band` project in the song's `garageband/` folder. Future opens prefer this native session automatically.
7. Run `save_session_snapshot` to summarize trackable song artifacts, then optionally commit and push them.

MusicXML is the durable notation interchange format. GarageBand project files are intentionally treated as a manual handoff target because `.band` automation is not stable enough for V1.
