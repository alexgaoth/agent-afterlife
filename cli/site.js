// Serve the site, or build a static copy of it, with a data document in place of the demo.
// No dependencies: node:http and node:fs only.
import { createServer } from "node:http";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** What a site needs. Everything else in the repo (cli/, test/, ...) stays out of a build. */
export const SITE = ["index.html", "graveyard", "temple", "text", "shared", "schema"];
export const PAGES = { home: "", temple: "temple/", graveyard: "graveyard/", text: "text/" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };

/**
 * Serve the site on 127.0.0.1. `data` is a function that returns (or resolves to) the current document;
 * it runs on every request, so an edited file shows on reload. Null: the demo.
 */
export function serve({ data, port = 8123, page = "home", open = true, log = console.log }) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/data.json" && data) {
      try { return send(res, 200, TYPES[".json"], JSON.stringify(await data())); }
      catch (e) { return send(res, 500, "text/plain", `Could not read the data: ${e.message}`); }
    }
    const top = path.split("/")[1] || "index.html";
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || !SITE.includes(top)) return send(res, 404, "text/plain", "Not found");
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return send(res, 404, "text/plain", "Not found");
    // Site files may be loaded from other origins (shared/embed.js in someone's dashboard). /data.json never:
    // a page on another website must not read the data this local server serves.
    send(res, 200, TYPES[extname(file)] || "application/octet-stream", readFileSync(file), { "access-control-allow-origin": "*" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      // 127.0.0.1, the address the server listens on: "localhost" can resolve to ::1 first (Node 18 does).
      const url = `http://127.0.0.1:${server.address().port}/${PAGES[page] ?? ""}${data ? "?data=data.json" : ""}`;
      log(`Serving at ${url}  (Ctrl-C to stop)`);
      if (open) openBrowser(url);
      resolve({ server, url });
    });
  });
}

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(body);
}

export function openBrowser(url) {
  if (process.env.BROWSER === "none") return;                       // the usual way to say "print the URL only"
  const cmd = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* no browser: the URL is printed */ }
}

/**
 * Write a static copy of the site to `out`. `doc` (a document) is written to out/data.json; `url` (a
 * live data URL) is linked instead, so the site always shows the newest data. With neither, the demo.
 */
export function build({ out, doc, url }) {
  mkdirSync(out, { recursive: true });
  for (const f of SITE) cpSync(join(ROOT, f), join(out, f), { recursive: true });
  const src = doc ? "data.json" : url;
  if (doc) writeFileSync(join(out, "data.json"), JSON.stringify(doc));
  for (const page of ["temple", "graveyard", "text", "."]) {
    const html = join(out, page, "index.html");
    if (existsSync(html)) writeFileSync(html, setDataMeta(readFileSync(html, "utf8"), src));
  }
  writeFileSync(join(out, ".nojekyll"), "");
  return out.split(sep).join("/");
}

/** Put (or remove, when src is empty) the <meta name="afterlife-data"> tag that names the page's data. */
export function setDataMeta(html, src) {
  const tag = src ? `<meta name="afterlife-data" content="${src.replace(/"/g, "&quot;")}">` : "";
  if (/<meta name="afterlife-data"[^>]*>/.test(html)) return html.replace(/<meta name="afterlife-data"[^>]*>/, tag);
  return tag ? html.replace(/<head>/i, `<head>\n${tag}`) : html;
}
