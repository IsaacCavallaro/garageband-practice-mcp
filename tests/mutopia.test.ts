import test from "node:test";
import assert from "node:assert/strict";

import { parseMutopiaSearchResults } from "../src/core/mutopia.js";

test("parseMutopiaSearchResults normalizes open catalogue result rows", () => {
  const html = `
    <table class="table-bordered result-table">
      <tr><td>Invention 1</td><td>by J. S. Bach (1685-1750)</td><td>BWV 772</td><td>&nbsp;</td></tr>
      <tr><td>for Harpsichord, Piano</td><td>&nbsp;</td><td>Baroque</td><td></td></tr>
      <tr><td>Bach-Gesellschaft</td><td><a href="../legal.html#ccasa">Creative Commons Attribution-ShareAlike 3.0</a></td><td><a href="piece-info.cgi?id=40">More Information</a></td><td>2008/06/15</td></tr>
      <tr>
        <td>Download: <a href="https://www.mutopiaproject.org/ftp/BachJS/BWV772/bach-invention-01/bach-invention-01.ly">.ly file</a></td>
        <td><a href="https://www.mutopiaproject.org/ftp/BachJS/BWV772/bach-invention-01/bach-invention-01.mid">.mid file</a></td>
        <td><a href="https://www.mutopiaproject.org/ftp/BachJS/BWV772/bach-invention-01/bach-invention-01-preview.png">Preview image</a></td>
        <td><a href="https://www.mutopiaproject.org/ftp/BachJS/BWV772/bach-invention-01/">Appropriate FTP area</a></td>
      </tr>
      <tr>
        <td><a href="https://www.mutopiaproject.org/ftp/BachJS/BWV772/bach-invention-01/bach-invention-01-a4.pdf">A4 .pdf file</a></td>
      </tr>
    </table>
  `;

  const results = parseMutopiaSearchResults(html);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, "40");
  assert.equal(results[0]?.provider, "Mutopia Project");
  assert.equal(results[0]?.title, "Invention 1");
  assert.equal(results[0]?.composer, "J. S. Bach (1685-1750)");
  assert.equal(results[0]?.license, "Creative Commons Attribution-ShareAlike 3.0");
  assert.equal(results[0]?.midiUrl?.endsWith(".mid"), true);
  assert.equal(results[0]?.pdfUrl?.endsWith(".pdf"), true);
});
