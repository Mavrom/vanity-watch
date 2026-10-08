import "@fontsource-variable/inter";
import "./notifier.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { GuildInfo, Status } from "./api";
import { h, svgIcon } from "./dom";
import { STATUS_META, guildIconUrl, relativeTime } from "./format";
import { ICONS } from "./icons";
import logoUrl from "./assets/logo.svg";

interface Popup {
  id: number;
  kind: "released" | "taken";
  code: string;
  title: string;
  body: string;
  status: Status;
  guild: GuildInfo | null;
  at: string;
}

/** "Taken" popups are informational and hide themselves; releases wait for the user. */
const TAKEN_TIMEOUT_MS = 15_000;
const MAX_VISIBLE = 3;

const inTauri = "__TAURI_INTERNALS__" in window;
const stack = document.getElementById("stack")!;
const shown = new Map<number, HTMLElement>();
const order: number[] = [];

const call = (cmd: string, args?: Record<string, unknown>) => (inTauri ? invoke(cmd, args) : Promise.resolve());

function close(id: number, action: "dismiss" | "open" = "dismiss") {
  const el = shown.get(id);
  if (!el || el.classList.contains("leaving")) return;
  el.classList.add("leaving");
  window.setTimeout(() => {
    el.remove();
    shown.delete(id);
    order.splice(order.indexOf(id), 1);
    render();
    void call(action === "open" ? "notifier_open" : "notifier_dismiss", { id });
  }, 260);
}

function card(p: Popup): HTMLElement {
  const meta = STATUS_META[p.status];
  const released = p.kind === "released";
  const iconUrl = p.guild ? guildIconUrl(p.guild) : null;
  const letter = (p.guild?.name || p.code).charAt(0).toUpperCase();

  const el = h(
    "article",
    { class: `toast tone-${meta.tone} ${p.kind}` },
    h("div", { class: "border" }),
    h(
      "div",
      { class: "surface" },
      h(
        "header",
        {},
        h("span", { class: "brand" }, h("img", { class: "mark", src: logoUrl, alt: "", width: "16", height: "16" }), "Vanity Watch"),
        h("span", { class: "time", "data-time": p.at }, relativeTime(p.at)),
        h("button", { class: "x", title: "Kapat", onclick: () => close(p.id) }, "✕"),
      ),
      h(
        "div",
        { class: "content" },
        h(
          "div",
          { class: "avatar" },
          iconUrl ? h("img", { src: iconUrl, alt: "" }) : h("span", {}, letter),
          h("span", { class: "badge-icon" }, svgIcon(released ? ICONS.unlink : ICONS.check)),
        ),
        h(
          "div",
          { class: "text" },
          h("p", { class: "eyebrow" }, released ? "URL boşa düştü" : "URL alındı"),
          h("h3", {}, h("span", { class: "prefix" }, "discord.gg/"), p.code),
          h("span", { class: "pill" }, h("i", { class: "dot" }), meta.label),
        ),
      ),
      h("p", { class: "body" }, p.body),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn primary", onclick: () => close(p.id, "open") }, "Paneli aç"),
        h("button", { class: "btn", onclick: () => close(p.id) }, released ? "Kapat" : "Tamam"),
      ),
      released ? null : h("div", { class: "timer", style: `animation-duration:${TAKEN_TIMEOUT_MS}ms` }),
    ),
  );
  if (!released) window.setTimeout(() => close(p.id), TAKEN_TIMEOUT_MS);
  return el;
}

function add(p: Popup) {
  if (shown.has(p.id)) return;
  const el = card(p);
  shown.set(p.id, el);
  order.push(p.id);
  stack.prepend(el);
  render();
}

function render() {
  // Newest first; older ones beyond MAX_VISIBLE collapse into a counter.
  const newestFirst = [...order].reverse();
  newestFirst.forEach((id, i) => shown.get(id)!.classList.toggle("collapsed", i >= MAX_VISIBLE));
  const hidden = Math.max(0, order.length - MAX_VISIBLE);
  let more = stack.querySelector<HTMLElement>(".more");
  if (hidden > 0) {
    if (!more) {
      more = h("div", { class: "more" });
      stack.append(more);
    }
    more.textContent = `+${hidden} bildirim daha`;
  } else {
    more?.remove();
  }
  void layout();
}

async function layout() {
  await new Promise(requestAnimationFrame);
  if (order.length === 0) return;
  await call("notifier_layout", { height: Math.ceil(stack.getBoundingClientRect().height) + 28 });
}

new ResizeObserver(() => void layout()).observe(stack);

// Minutes are all that matters for "x min ago" on a popup that can stay for hours.
window.setInterval(() => {
  document.querySelectorAll<HTMLElement>("[data-time]").forEach((el) => {
    el.textContent = relativeTime(el.dataset.time || null);
  });
}, 15_000);

async function init() {
  if (!inTauri) {
    // Design preview in a plain browser (npm run dev → /notifier.html).
    document.body.classList.add("preview");
    const now = new Date().toISOString();
    add({ id: 1, kind: "taken", code: "kahve", title: "", body: "Sunucu: Kahve Severler", status: "in_use", guild: { id: "9", name: "Kahve Severler", icon: null, memberCount: 320 }, at: now });
    add({ id: 2, kind: "released", code: "nightcore", title: "", body: "Sunucu kapatılmış veya silinmiş. URL bir süre kilitli kalabilir.", status: "released_guild_gone", guild: { id: "1", name: "Nightcore Lounge", icon: null, memberCount: 1840 }, at: now });
    return;
  }
  await listen<Popup>("popup", (e) => add(e.payload));
  const existing = await invoke<Popup[]>("notifier_popups");
  existing.forEach(add);
}

void init();
