// Runs on the page that shows a shared HTML page in a frame under the top bar. Bundled to /_assets/frame.js.
import { wireBar } from "./bar";

const frame = document.getElementById("frame") as HTMLIFrameElement;

/** Mirrors the framed page's address and title, so reloading or copying the link keeps the reader's place. */
function sync() {
  let inner: Location;
  try {
    inner = frame.contentWindow!.location;
    if (inner.origin !== location.origin) return;
  } catch {
    return; // The reader followed a link to another site inside the frame.
  }
  const path = inner.pathname + inner.search + inner.hash;
  if (path !== location.pathname + location.search + location.hash) history.replaceState(null, "", path);
  const title = frame.contentDocument?.title;
  if (title) document.title = title;
}

/** Matches the bar to the page under it: dark over a dark page, light over anything else. */
function matchTheme() {
  const inner = frame.contentDocument;
  if (!inner?.documentElement) return;
  const opaque = [inner.documentElement, inner.body]
    .filter(Boolean)
    .map((el) => getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [])
    .find((c) => c.length >= 3 && (c[3] ?? 1) > 0.5);
  const [r, g, b] = opaque ?? [255, 255, 255];
  document.documentElement.dataset.theme = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
}

frame.addEventListener("load", () => {
  sync();
  try {
    matchTheme();
  } catch {}
  try {
    frame.contentWindow!.addEventListener("hashchange", sync);
    frame.contentWindow!.addEventListener("popstate", sync);
  } catch {}
});

wireBar(() => location.origin + location.pathname + location.hash);
