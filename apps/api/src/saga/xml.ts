/**
 * Reads the XML SAGA answers with, and nothing more general than that.
 *
 * The payload earns a hand-written reader rather than a dependency: it is
 * machine-generated, flat, thirty tag names, no attributes, no namespaces, no
 * CDATA. Of the five XML entities only `&amp;` appears — nine times in 22 MB —
 * and a full DOM parse of that much text to reach six fields per row would cost
 * far more than it returns.
 *
 * Two properties of the real payload drive the code:
 *
 * 1. The declaration says `encoding="utf-16"` while the bytes are UTF-8 and the
 *    HTTP header says so too. `XmlSerializer` on the other end serialises to a
 *    UTF-16 string and the response is then sent as UTF-8; the declaration is a
 *    leftover. A strict parser handed the raw bytes would garble every
 *    character. Decoding follows the HTTP header, and the declaration is
 *    ignored on purpose.
 * 2. Empty values arrive as self-closing tags — `<GRUPA />`, 56.464 of them in
 *    one response. A reader looking only for `<GRUPA>…</GRUPA>` skips them
 *    silently, so absence has to mean empty string, never a missing row.
 */

/** The five predefined entities. `&amp;` must be undone last, or `&amp;lt;` becomes `<`. */
function decodeaza(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, cod: string) => String.fromCodePoint(Number(cod)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, cod: string) => String.fromCodePoint(Number.parseInt(cod, 16)))
    .replace(/&amp;/g, '&')
}

/** `<TAG>value</TAG>` or `<TAG />`. Uppercase only, which is every field SAGA sends. */
const CAMP = /<([A-Z_]+)(?:\s*\/>|>([\s\S]*?)<\/\1>)/g

/**
 * One row per `<LinieSituatieXML>`, each a plain map of tag to text.
 *
 * Blocks are matched before fields so the container tags cannot be mistaken for
 * fields, and unknown tags are kept rather than dropped: SAGA adding a column
 * should not need a code change here to stop losing data.
 */
export function citesteSituatie(xml: string): Record<string, string>[] {
  const randuri: Record<string, string>[] = []

  for (const bloc of xml.matchAll(/<LinieSituatieXML>([\s\S]*?)<\/LinieSituatieXML>/g)) {
    const rand: Record<string, string> = {}
    for (const camp of (bloc[1] ?? '').matchAll(CAMP)) {
      rand[camp[1] ?? ''] = decodeaza((camp[2] ?? '').trim())
    }
    randuri.push(rand)
  }

  return randuri
}
