import type { ContentPolicySnapshot } from "./types.js";

export const contentPolicy: ContentPolicySnapshot = {
  accepts: [
    "User-supplied MIDI files that the user is authorized to use.",
    "User-supplied MusicXML files that the user is authorized to use.",
    "Public-domain or open-license catalogue results whose license is visible."
  ],
  searches: [
    "Search only public-domain/open-license catalogues.",
    "Mutopia Project is the first supported source because it publishes PDF, MIDI, and LilyPond files under public-domain or Creative Commons terms."
  ],
  rejects: [
    "Do not search for or download copyrighted MIDI from unauthorized sources.",
    "Do not represent generated practice material as a transcription of a copyrighted recording."
  ],
  later: [
    "AI approximation may be added later only from user-provided chords/structure and must be labeled as an arrangement, not a transcription."
  ]
};

export function assertAllowedMutopiaMidiUrl(urlText: string): URL {
  let url: URL;

  try {
    url = new URL(urlText);
  } catch {
    throw new Error("Expected a valid absolute Mutopia MIDI URL.");
  }

  const allowedHosts = new Set(["www.mutopiaproject.org", "mutopiaproject.org"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    throw new Error("Only HTTPS MIDI URLs from mutopiaproject.org are accepted for public-domain imports.");
  }

  if (!url.pathname.startsWith("/ftp/") || !url.pathname.toLowerCase().endsWith(".mid")) {
    throw new Error("Mutopia import URLs must point to a .mid file under the Mutopia /ftp/ catalogue.");
  }

  return url;
}
