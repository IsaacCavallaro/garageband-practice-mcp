import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export async function renderNotationIfAvailable(
  musicXmlPath: string,
  outputDir: string,
  outputBasename: string
): Promise<{ artifacts: string[]; warnings: string[] }> {
  const renderer = await findMuseScoreCommand();
  if (!renderer) {
    return {
      artifacts: [],
      warnings: ["MuseScore/mscore was not found, so PDF/PNG chart export was skipped. MusicXML was generated."]
    };
  }

  const artifacts: string[] = [];
  const warnings: string[] = [];
  const pdfPath = join(outputDir, `${outputBasename}.pdf`);
  const pngPath = join(outputDir, `${outputBasename}.png`);

  for (const outputPath of [pdfPath, pngPath]) {
    const result = spawnSync(renderer, [musicXmlPath, "-o", outputPath], {
      encoding: "utf8",
      timeout: 30_000
    });

    if (result.status === 0) {
      artifacts.push(outputPath);
    } else {
      warnings.push(`MuseScore failed to write ${outputPath}: ${result.stderr || result.stdout || "unknown error"}`);
    }
  }

  return { artifacts, warnings };
}

async function findMuseScoreCommand(): Promise<string | undefined> {
  const absoluteCandidates = [
    "/Applications/MuseScore 4.app/Contents/MacOS/mscore",
    "/Applications/MuseScore 4.app/Contents/MacOS/MuseScore 4",
    "/Applications/MuseScore 3.app/Contents/MacOS/mscore"
  ];

  for (const candidate of absoluteCandidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  for (const candidate of ["mscore", "musescore", "musescore4"]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }

  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
