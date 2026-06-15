import * as cheerio from "cheerio";

import type { MutopiaSearchResult } from "./types.js";

const mutopiaBaseUrl = "https://www.mutopiaproject.org";
const searchUrl = `${mutopiaBaseUrl}/cgibin/make-table.cgi`;

export interface SearchPublicDomainMidiInput {
  query: string;
  limit?: number;
  instrument?: string;
}

export async function searchPublicDomainMidi(input: SearchPublicDomainMidiInput): Promise<MutopiaSearchResult[]> {
  const params = new URLSearchParams();
  params.set("searchingfor", input.query);
  if (input.instrument) {
    params.set("Instrument", input.instrument);
  }

  const response = await fetch(`${searchUrl}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Mutopia search failed (${response.status} ${response.statusText}).`);
  }

  const html = await response.text();
  return parseMutopiaSearchResults(html).slice(0, input.limit ?? 8);
}

export function parseMutopiaSearchResults(html: string): MutopiaSearchResult[] {
  const $ = cheerio.load(html);
  const results: MutopiaSearchResult[] = [];

  $("table.result-table").each((_, table) => {
    const rows = $(table).find("tr");
    const firstRowCells = rows.eq(0).find("td");
    const secondRowCells = rows.eq(1).find("td");
    const thirdRowCells = rows.eq(2).find("td");
    const title = cleanText(firstRowCells.eq(0).text());
    if (!title) {
      return;
    }

    const moreInformationHref = thirdRowCells.find("a").filter((__, link) =>
      cleanText($(link).text()).toLowerCase().includes("more information")
    ).attr("href");
    const license = cleanText(thirdRowCells.eq(1).text());

    const result: MutopiaSearchResult = {
      provider: "Mutopia Project",
      title,
      composer: cleanComposer(firstRowCells.eq(1).text()),
      catalog: cleanText(firstRowCells.eq(2).text()) || undefined,
      instruments: cleanText(secondRowCells.eq(0).text().replace(/^for\s+/i, "")) || undefined,
      style: cleanText(secondRowCells.eq(2).text()) || undefined,
      license: license || undefined,
      sourcePageUrl: moreInformationHref ? absolutize(moreInformationHref) : undefined
    };

    if (result.sourcePageUrl) {
      const idMatch = /id=(\d+)/.exec(result.sourcePageUrl);
      result.id = idMatch?.[1];
    }

    $(table)
      .find("a")
      .each((__, link) => {
        const href = $(link).attr("href");
        const text = cleanText($(link).text()).toLowerCase();
        if (!href) {
          return;
        }

        const absolute = absolutize(href);
        if (absolute.endsWith(".mid")) {
          result.midiUrl = absolute;
        } else if (absolute.endsWith(".ly")) {
          result.lilypondUrl = absolute;
        } else if (absolute.endsWith(".pdf")) {
          result.pdfUrl ??= absolute;
        } else if (absolute.endsWith("-preview.png") || text.includes("preview image")) {
          result.previewImageUrl = absolute;
        } else if (text.includes("appropriate ftp area")) {
          result.ftpAreaUrl = absolute;
        }
      });

    if (result.midiUrl) {
      results.push(result);
    }
  });

  return results;
}

function cleanComposer(text: string): string | undefined {
  const cleaned = cleanText(text).replace(/^by\s+/i, "");
  return cleaned || undefined;
}

function cleanText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absolutize(href: string): string {
  return new URL(href, `${mutopiaBaseUrl}/cgibin/`).toString();
}
