import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { CJK_CHARS } from "../temple/fonts.js";

// Canvases are drawn once, after loadCjk() has fetched the glyphs for CJK_CHARS. A character the code writes but
// CJK_CHARS lacks would be drawn in a fallback font, with other strokes. This keeps the list complete.
test("every Chinese character in the temple's code is in CJK_CHARS", () => {
  const here = (p) => new URL(p, import.meta.url);
  const files = [...readdirSync(here("../temple/")).filter((f) => f.endsWith(".js") && f !== "fonts.js").map((f) => `../temple/${f}`),
    ...readdirSync(here("../shared/")).filter((f) => f.endsWith(".js")).map((f) => `../shared/${f}`), "../temple/index.html"];
  const have = new Set(CJK_CHARS);
  const missing = new Set();
  for (const f of files) for (const c of readFileSync(here(f), "utf8")) {
    const n = c.codePointAt(0);
    if ((n >= 0x2e80 && n <= 0x9fff) || (n >= 0x3000 && n <= 0x303f) || (n >= 0xff00 && n <= 0xffef)) if (!have.has(c)) missing.add(c);
  }
  assert.deepEqual([...missing], [], `add these to CJK_CHARS in temple/fonts.js: ${[...missing].join("")}`);
});
