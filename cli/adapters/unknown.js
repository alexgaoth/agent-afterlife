// Shared by the harness adapters: count the files (or sessions) an adapter could not read because their format is
// unknown, say so once per run, and fail when nothing at all could be read.
//
//   const unknown = unknownFormats("gemini", "file");
//   unknown.add(version);            // for each unreadable file; version may be undefined
//   unknown.recognized();            // for each file that was read
//   unknown.finish(ctx);             // logs once; throws if something was unknown and nothing was recognized
//
// The text asks for line types, not content, so that nobody pastes private chat text into an issue.
export function unknownFormats(tool, unit = "file") {
  let count = 0, ok = 0;
  const versions = new Set();
  const message = () => `${tool}: ${count} ${unit}${count === 1 ? "" : "s"} in an unknown format${versions.size ? ` (version ${[...versions].join(", ")})` : ""}, skipped; please open an issue with the line types, not the content`;
  return {
    add(version) { count++; if (version !== undefined && version !== null && version !== "") versions.add(String(version)); },
    recognized() { ok++; },
    get count() { return count; },
    message,
    finish(ctx) {
      if (!count) return;
      if (!ok) throw new Error(message());
      ctx.log(message().slice(tool.length + 2));   // ctx.log adds the adapter's name itself
    },
  };
}

/** The version a record states about itself, if any (the field names the supported tools use). */
export function versionOf(o) {
  if (!o || typeof o !== "object") return undefined;
  for (const k of ["_v", "version", "schema_version", "schemaVersion", "composerDataVersion"]) {
    if (typeof o[k] === "number" || (typeof o[k] === "string" && o[k])) return o[k];
  }
  return undefined;
}
