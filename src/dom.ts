type Attrs = Record<string, string | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Creates an element. Keys starting with "on" become event listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/** Wraps static markup from icons.ts. Never pass external data here. */
export function svgIcon(markup: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = markup;
  return span;
}
