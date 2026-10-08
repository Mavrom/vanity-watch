import { getCurrentWindow } from "@tauri-apps/api/window";

// Windows-style caption glyphs, drawn thin to match the native controls.
const glyph = (body: string) =>
  `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const MINIMIZE = glyph('<path d="M0.5 5h9"/>');
const MAXIMIZE = glyph('<rect x="0.5" y="0.5" width="9" height="9" rx="1.5"/>');
const RESTORE = glyph(
  '<rect x="0.5" y="2.5" width="7" height="7" rx="1.2"/><path d="M2.5 2.5v-0.7A1.3 1.3 0 0 1 3.8 0.5h4.4a1.3 1.3 0 0 1 1.3 1.3v4.4a1.3 1.3 0 0 1-1.3 1.3h-0.7"/>',
);
const CLOSE = glyph('<path d="M0.8 0.8l8.4 8.4M9.2 0.8l-8.4 8.4"/>');

/** The window has no native frame; this draws the caption buttons in the app's own style. */
export function setupTitlebar() {
  const min = document.getElementById("win-min")!;
  const max = document.getElementById("win-max")!;
  const close = document.getElementById("win-close")!;
  min.innerHTML = MINIMIZE;
  max.innerHTML = MAXIMIZE;
  close.innerHTML = CLOSE;

  if (!("__TAURI_INTERNALS__" in window)) return;
  const win = getCurrentWindow();
  min.addEventListener("click", () => void win.minimize());
  max.addEventListener("click", () => void win.toggleMaximize());
  // Closing destroys the window; the app keeps running in the tray.
  close.addEventListener("click", () => void win.close());

  const sync = async () => {
    const maximized = await win.isMaximized();
    max.innerHTML = maximized ? RESTORE : MAXIMIZE;
    max.title = maximized ? "Önceki boyut" : "Büyüt";
  };
  void sync();
  void win.onResized(() => void sync());
}
