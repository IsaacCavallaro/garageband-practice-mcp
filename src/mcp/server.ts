import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { contentPolicy } from "../core/policy.js";
import {
  createPracticeProject,
  generateBarPracticeAssets,
  importPublicDomainMidi,
  importUserMidi
} from "../core/project.js";
import { searchPublicDomainMidi } from "../core/mutopia.js";
import { generatePianoGrandStaffChart } from "../core/musicxml.js";
import { diagnoseSetup, openInGarageBand } from "../core/garageband.js";
import { saveSessionSnapshot } from "../core/session.js";

const server = new McpServer({
  name: "garageband-practice-mcp",
  version: "0.1.0"
});

server.registerTool(
  "create_practice_project",
  {
    title: "Create a song practice project",
    description: "Create the per-song folder layout, project metadata, and GarageBand handoff notes.",
    inputSchema: {
      title: z.string().min(1),
      composer: z.string().optional(),
      slug: z.string().optional(),
      notes: z.string().optional(),
      reuseExisting: z.boolean().optional()
    }
  },
  async (input) => asToolResult(await createPracticeProject(input))
);

server.registerTool(
  "generate_bar_practice_assets",
  {
    title: "Generate GarageBand-ready one-bar practice MIDI files",
    description: "Split the active MIDI into one named backing/play-along MIDI handoff per bar and write a loop manifest locally.",
    inputSchema: {
      projectSlug: z.string().min(1),
      midiFilePath: z.string().optional()
    }
  },
  async (input) => asToolResult(await generateBarPracticeAssets(input))
);

server.registerTool(
  "import_user_midi",
  {
    title: "Import an authorized user MIDI file",
    description: "Copy a user-supplied .mid/.midi file into a practice project, normalize it for GarageBand handoff, and analyze tracks, tempo, measures, and note ranges.",
    inputSchema: {
      projectSlug: z.string().min(1),
      midiFilePath: z.string().min(1),
      copyName: z.string().optional()
    }
  },
  async (input) => asToolResult(await importUserMidi(input))
);

server.registerTool(
  "search_public_domain_midi",
  {
    title: "Search public-domain/open-license MIDI",
    description: "Search Mutopia Project only and return direct MIDI, PDF, LilyPond, license, and source links for public-domain/open-license results.",
    inputSchema: {
      query: z.string().min(2),
      limit: z.number().int().min(1).max(20).optional(),
      instrument: z.string().optional()
    }
  },
  async (input) => asToolResult({
    providerPolicy: "Mutopia Project results only; do not use this tool for copyrighted commercial MIDI searches.",
    results: await searchPublicDomainMidi(input)
  })
);

server.registerTool(
  "import_public_domain_midi",
  {
    title: "Import a selected Mutopia MIDI result",
    description: "Download a selected Mutopia .mid URL, validate that it is from the open/public Mutopia catalogue, copy it into the project, and analyze it.",
    inputSchema: {
      projectSlug: z.string().min(1),
      midiUrl: z.string().url(),
      title: z.string().optional(),
      license: z.string().optional(),
      provider: z.string().optional(),
      sourcePageUrl: z.string().url().optional()
    }
  },
  async (input) => asToolResult(await importPublicDomainMidi(input))
);

server.registerTool(
  "generate_piano_grand_staff_chart",
  {
    title: "Generate a piano grand-staff chart",
    description: "Convert the active/imported MIDI into a piano grand-staff MusicXML chart, with optional PDF/PNG export if MuseScore is available locally.",
    inputSchema: {
      projectSlug: z.string().min(1),
      midiFilePath: z.string().optional(),
      outputBasename: z.string().optional(),
      splitPointMidi: z.number().int().min(0).max(127).optional(),
      renderPdfPng: z.boolean().optional()
    }
  },
  async (input) => asToolResult(await generatePianoGrandStaffChart(input))
);

server.registerTool(
  "open_in_garageband",
  {
    title: "Open the native GarageBand practice session",
    description: "Open a saved .band session from the song's garageband folder when one exists; otherwise open the active MIDI for one-time import and native Score Editor setup.",
    inputSchema: {
      projectSlug: z.string().min(1),
      midiFilePath: z.string().optional(),
      preferSavedProject: z.boolean().optional()
    }
  },
  async (input) => asToolResult(await openInGarageBand(input))
);

server.registerTool(
  "diagnose_setup",
  {
    title: "Diagnose GarageBand practice setup",
    description: "Report GarageBand install status, visible USB MIDI device hints, and notation renderer availability.",
    inputSchema: {}
  },
  async () => asToolResult(await diagnoseSetup())
);

server.registerTool(
  "save_session_snapshot",
  {
    title: "Save a GarageBand practice session snapshot",
    description: "Scan trackable song artifacts, summarize changed files, and optionally commit and push the session artifacts to Git.",
    inputSchema: {
      projectSlug: z.string().min(1).optional(),
      message: z.string().min(1).optional(),
      commit: z.boolean().optional(),
      push: z.boolean().optional()
    }
  },
  async (input) => asToolResult(await saveSessionSnapshot(input))
);

server.registerResource(
  "garageband-practice-content-policy",
  "garageband-practice://content-policy",
  {
    title: "GarageBand practice content policy",
    description: "Local source and download policy for song practice material."
  },
  async () => ({
    contents: [
      {
        uri: "garageband-practice://content-policy",
        mimeType: "application/json",
        text: JSON.stringify(contentPolicy, null, 2)
      }
    ]
  })
);

function asToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ok: true, ...coerceObject(data) }, null, 2)
      }
    ]
  };
}

function coerceObject(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  return { result: data };
}

const transport = new StdioServerTransport();
await server.connect(transport);
