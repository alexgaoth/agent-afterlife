// Show the temple or the graveyard inside your own page or dashboard.
//
//   <div id="afterlife" style="height: 70vh"></div>
//   <script type="module">
//     import { mount } from "https://intro.alexgaoth.com/agent-afterlife/shared/embed.js";
//     const view = mount(document.getElementById("afterlife"), {
//       setting: "temple",          // or "graveyard"
//       data: myDocument,           // a document object, a URL to one, or nothing for the demo
//       onSelect: (id) => console.log("opened", id),
//     });
//     view.open("Marlow #3");       // open an agent's scroll or headstone
//   </script>
//
// The view is an <iframe> to the site this file is served from (or `base`), with ?embed=1.
// A document object is sent by postMessage when the page is ready; nothing is uploaded anywhere.

/** The address of an embedded view. */
export function embedUrl({ setting = "temple", data, base = new URL("../", import.meta.url).href, params = {} } = {}) {
  if (!["temple", "graveyard"].includes(setting)) throw new Error(`setting must be "temple" or "graveyard", not "${setting}"`);
  const url = new URL(`${setting}/`, base);
  url.searchParams.set("embed", "1");
  if (typeof data === "string") url.searchParams.set("data", new URL(data, typeof location !== "undefined" ? location.href : base).href);
  else if (!data) url.searchParams.set("demo", "");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url;
}

/** Put a view in `el`. Returns { frame, open(id), destroy() }. */
export function mount(el, { setting = "temple", data, base, params, title, onSelect, onLoad } = {}) {
  const url = embedUrl({ setting, data, base, params });
  const frame = document.createElement("iframe");
  frame.src = url.href;
  frame.title = title || (setting === "temple" ? "The temple of agents" : "The graveyard of agents");
  frame.allow = "fullscreen";
  frame.style.cssText = "border: 0; width: 100%; height: 100%; display: block;";
  const listener = (e) => {
    if (e.source !== frame.contentWindow || typeof e.data?.type !== "string") return;
    const type = e.data.type.replace(/^agent-afterlife:/, "");
    if (type === "ready" && data && typeof data === "object") frame.contentWindow.postMessage({ type: "agent-afterlife:data", doc: data }, url.origin);
    else if (type === "loaded" && onLoad) onLoad(e.data);
    else if (type === "select" && onSelect) onSelect(e.data.id);
  };
  window.addEventListener("message", listener);
  el.appendChild(frame);
  return {
    frame,
    open(id) { frame.contentWindow?.postMessage({ type: "agent-afterlife:open", id }, url.origin); },
    destroy() { window.removeEventListener("message", listener); frame.remove(); },
  };
}
