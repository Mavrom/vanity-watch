import "@fontsource-variable/inter";
import "./styles.css";
import { loadBackend, type Backend, type CycleState, type Settings, type Status, type TrackedUrl } from "./api";
import { createCard, type Card } from "./card";
import { h, svgIcon } from "./dom";
import { FILTERS, STATUS_META, matchesFilter, relativeTime, type Filter } from "./format";
import { ICONS, type IconName } from "./icons";
import { setupTitlebar } from "./titlebar";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const nav = byId<HTMLElement>("nav");
const stats = byId<HTMLElement>("stats");
const alerts = byId<HTMLElement>("alerts");
const list = byId<HTMLElement>("list");
const listHeader = byId<HTMLElement>("list-header");
const listTitle = byId<HTMLElement>("list-title");
const listCount = byId<HTMLElement>("list-count");
const emptyEl = byId<HTMLElement>("empty");
const emptyTitle = byId<HTMLElement>("empty-title");
const emptyText = byId<HTMLElement>("empty-text");
const activity = byId<HTMLOListElement>("activity");
const addForm = byId<HTMLFormElement>("add-form");
const addInput = byId<HTMLInputElement>("add-input");
const addError = byId<HTMLParagraphElement>("add-error");
const autoToggle = byId<HTMLInputElement>("auto-toggle");
const intervalSelect = byId<HTMLSelectElement>("interval-select");
const refreshAllBtn = byId<HTMLButtonElement>("refresh-all");
const settingsBtn = byId<HTMLButtonElement>("open-settings");
const settingsDialog = byId<HTMLDialogElement>("settings");
const setRelease = byId<HTMLInputElement>("set-release");
const setTaken = byId<HTMLInputElement>("set-taken");
const setAutostart = byId<HTMLInputElement>("set-autostart");
const monitorEl = byId<HTMLElement>("monitor");
const ringProgress = byId<HTMLElement>("ring-progress");
const countdown = byId<HTMLElement>("countdown");
const monitorTitle = byId<HTMLElement>("monitor-title");
const monitorSub = byId<HTMLElement>("monitor-sub");
const toast = byId<HTMLDivElement>("toast");

const RING_LENGTH = 2 * Math.PI * 17;
const EMPTY_TEXT = emptyText.innerHTML;

const urls = new Map<string, TrackedUrl>();
const cards = new Map<string, Card>();
let backend: Backend;
let settings: Settings;
let filter: Filter = "all";
let cycling = false;
let nextCheckAt: number | null = null;
let toastTimer: number | undefined;

setupTitlebar();
byId("settings-icon").append(svgIcon(ICONS.settings));
byId("refresh-icon").append(svgIcon(ICONS.refresh));
byId("add-icon").append(svgIcon(ICONS.link));

function showToast(message: string) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4000);
}

function upsert(url: TrackedUrl, prepend = false) {
  urls.set(url.code, url);
  const existing = cards.get(url.code);
  if (existing) {
    existing.update(url);
  } else {
    const card = createCard(url, backend, { onError: showToast, onRemoved: remove });
    cards.set(url.code, card);
    if (prepend) list.prepend(card.el);
    else list.append(card.el);
  }
  refreshView();
}

function remove(code: string) {
  urls.delete(code);
  cards.get(code)?.el.remove();
  cards.delete(code);
  refreshView();
}

function setFilter(next: Filter) {
  filter = next;
  refreshView();
}

const count = (pred: (s: Status) => boolean) => [...urls.values()].filter((u) => pred(u.status)).length;

function renderNav() {
  nav.replaceChildren(
    ...FILTERS.map((f) =>
      h(
        "button",
        { class: f.id === filter ? "nav-item active" : "nav-item", onclick: () => setFilter(f.id) },
        h("span", { class: `nav-icon f-${f.id}` }, svgIcon(ICONS[f.icon])),
        h("span", { class: "nav-text" }, f.label),
        h("span", { class: "nav-count" }, String(count((s) => matchesFilter(s, f.id)))),
      ),
    ),
  );
}

function renderStats() {
  const dayAgo = Date.now() - 86_400_000;
  const releasedToday = [...urls.values()]
    .flatMap((u) => u.history)
    .filter((e) => (e.to === "released_guild_exists" || e.to === "released_guild_gone") && Date.parse(e.at) > dayAgo).length;
  const mutedCount = [...urls.values()].filter((u) => u.muted).length;

  const tiles: { filter: Filter; label: string; value: number; caption: string; icon: IconName; tone: string }[] = [
    {
      filter: "all",
      label: "Takip edilen",
      value: urls.size,
      caption: mutedCount ? `${mutedCount} tanesi sessizde` : "tüm bildirimler açık",
      icon: "link",
      tone: "accent",
    },
    { filter: "in_use", label: "Kullanımda", value: count((s) => s === "in_use"), caption: "aktif bir sunucuda", icon: "check", tone: "green" },
    { filter: "free", label: "Boşta", value: count((s) => s === "appears_free"), caption: "hiç kullanımda görülmedi", icon: "dashed", tone: "yellow" },
    {
      filter: "released",
      label: "Boşaldı",
      value: count((s) => matchesFilter(s, "released")),
      caption: releasedToday ? `son 24 saatte ${releasedToday} yeni` : "son 24 saatte yeni yok",
      icon: "unlink",
      tone: "orange",
    },
  ];

  stats.replaceChildren(
    ...tiles.map((t) =>
      h(
        "button",
        { class: `stat tone-${t.tone}${filter === t.filter && t.filter !== "all" ? " active" : ""}`, onclick: () => setFilter(t.filter) },
        h("span", { class: "stat-icon" }, svgIcon(ICONS[t.icon])),
        h("span", { class: "stat-label" }, t.label),
        h("span", { class: "stat-value" }, String(t.value)),
        h("span", { class: "stat-caption" }, t.caption),
      ),
    ),
  );
}

function renderActivity() {
  const events = [...urls.values()]
    .flatMap((u) => u.history.map((e) => ({ ...e, code: u.code })))
    .filter((e) => e.from !== "unknown")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 14);
  activity.replaceChildren(
    ...(events.length
      ? events.map((e) => {
          const meta = STATUS_META[e.to];
          return h(
            "li",
            { class: `tone-${meta.tone}` },
            h("i", { class: "dot" }),
            h(
              "div",
              {},
              h("p", {}, h("b", {}, e.code), " ", meta.label.toLocaleLowerCase("tr-TR")),
              h("small", { "data-time": e.at }, relativeTime(e.at)),
            ),
          );
        })
      : [h("li", { class: "activity-empty" }, "Takip ettiğin URL'lerde bir durum değişikliği olunca burada görünecek.")]),
  );
}

function renderAlerts() {
  const pending = [...urls.values()].filter((u) => u.alert);
  alerts.replaceChildren(
    ...pending.map((u) => {
      const meta = STATUS_META[u.status];
      const releasedAt = [...u.history].reverse().find((e) => e.from === "in_use")?.at ?? u.lastChecked;
      return h(
        "div",
        { class: `alert tone-${meta.tone}` },
        h("span", { class: "alert-icon" }, svgIcon(ICONS.unlink)),
        h(
          "div",
          { class: "alert-text" },
          h("b", {}, `discord.gg/${u.code} boşaldı!`),
          h("span", {}, meta.hint),
        ),
        h("small", { class: "alert-time", "data-time": releasedAt ?? "" }, relativeTime(releasedAt)),
        h(
          "button",
          {
            class: "btn ghost",
            onclick: () => {
              setFilter("all");
              const card = cards.get(u.code);
              card?.el.classList.add("open");
              card?.el.scrollIntoView({ behavior: "smooth", block: "center" });
            },
          },
          "Göster",
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: () =>
              backend.dismissAlert(u.code).then(() => upsert({ ...urls.get(u.code)!, alert: false }), (e) => showToast(String(e))),
          },
          "Gördüm",
        ),
      );
    }),
  );
}

function refreshView() {
  let visible = 0;
  for (const [code, card] of cards) {
    const show = matchesFilter(urls.get(code)!.status, filter);
    card.el.hidden = !show;
    if (show) visible++;
  }
  const current = FILTERS.find((f) => f.id === filter)!;
  listTitle.textContent = current.title;
  listCount.textContent = String(visible);

  const none = urls.size === 0;
  emptyEl.hidden = visible > 0;
  listHeader.hidden = visible === 0;
  emptyTitle.textContent = none ? "Henüz takip ettiğin bir URL yok" : "Bu görünümde URL yok";
  if (none) emptyText.innerHTML = EMPTY_TEXT;
  else emptyText.textContent = "Başka bir filtre seç ya da yeni bir URL ekle.";

  renderNav();
  renderAlerts();
  renderStats();
  renderActivity();
}

function renderMonitor() {
  const paused = !settings.autoCheck;
  monitorEl.classList.toggle("paused", paused && !cycling);
  monitorEl.classList.toggle("cycling", cycling);
  if (cycling) {
    monitorTitle.textContent = "Kontrol ediliyor";
    monitorSub.textContent = `${urls.size} URL taranıyor`;
    countdown.textContent = "";
    ringProgress.style.strokeDashoffset = String(RING_LENGTH * 0.7);
    return;
  }
  if (paused || nextCheckAt == null) {
    monitorTitle.textContent = paused ? "Duraklatıldı" : "Canlı izleme";
    monitorSub.textContent = paused ? "Otomatik kontrol kapalı" : `Her ${settings.intervalSecs} sn'de bir`;
    countdown.textContent = paused ? "II" : "";
    ringProgress.style.strokeDashoffset = String(paused ? RING_LENGTH : 0);
    return;
  }
  const remaining = Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000));
  monitorTitle.textContent = "Canlı izleme";
  monitorSub.textContent = `Her ${settings.intervalSecs} sn'de bir`;
  countdown.textContent = String(remaining);
  ringProgress.style.strokeDashoffset = String(RING_LENGTH * (1 - remaining / settings.intervalSecs));
}

function applyCycle(state: CycleState) {
  cycling = state.cycling;
  nextCheckAt = state.nextCheckAt ? Date.parse(state.nextCheckAt) : null;
  renderMonitor();
}

function applySettings() {
  autoToggle.checked = settings.autoCheck;
  intervalSelect.value = String(settings.intervalSecs);
  intervalSelect.disabled = !settings.autoCheck;
  setRelease.checked = settings.notifyOnRelease;
  setTaken.checked = settings.notifyOnTaken;
  setAutostart.checked = settings.autostart;
  renderMonitor();
}

async function saveSettings(patch: Partial<Settings>) {
  try {
    settings = await backend.updateSettings({ ...settings, ...patch });
  } catch (e) {
    showToast(String(e));
  }
  applySettings();
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = addInput.value.trim();
  if (!value) return;
  addError.hidden = true;
  try {
    const url = await backend.addUrl(value);
    filter = "all";
    upsert(url, true);
    cards.get(url.code)?.setChecking(true);
    addInput.value = "";
  } catch (err) {
    addError.textContent = String(err);
    addError.hidden = false;
  }
});
addInput.addEventListener("input", () => (addError.hidden = true));

autoToggle.addEventListener("change", () => saveSettings({ autoCheck: autoToggle.checked }));
intervalSelect.addEventListener("change", () => saveSettings({ intervalSecs: Number(intervalSelect.value) }));
setRelease.addEventListener("change", () => saveSettings({ notifyOnRelease: setRelease.checked }));
setTaken.addEventListener("change", () => saveSettings({ notifyOnTaken: setTaken.checked }));
setAutostart.addEventListener("change", () => saveSettings({ autostart: setAutostart.checked }));
refreshAllBtn.addEventListener("click", () => backend.refreshAll().catch((e) => showToast(String(e))));
settingsBtn.addEventListener("click", () => settingsDialog.showModal());
settingsDialog.addEventListener("click", (e) => {
  if (e.target === settingsDialog) settingsDialog.close();
});

async function init() {
  backend = await loadBackend();
  await backend.onUrlUpdated((url) => {
    // Ignore late events for URLs removed in the meantime.
    if (urls.has(url.code)) upsert(url);
  });
  await backend.onChecking((code) => cards.get(code)?.setChecking(true));
  await backend.onCycle(applyCycle);

  const snapshot = await backend.getState();
  settings = snapshot.settings;
  applySettings();
  applyCycle(snapshot.cycle);
  [...snapshot.urls].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).forEach((u) => upsert(u));
  refreshView();
  requestAnimationFrame(() => document.body.classList.add("ready"));
  if (snapshot.recovered) showToast("Veri dosyası bozuktu: yedeği alındı ve liste sıfırlandı.");

  // Relative times and the countdown tick once a second, but only while someone can see them.
  const tick = () => {
    if (document.hidden) return;
    document.querySelectorAll<HTMLElement>("[data-time]").forEach((el) => {
      el.textContent = relativeTime(el.dataset.time || null);
    });
    renderMonitor();
  };
  window.setInterval(tick, 1000);
  document.addEventListener("visibilitychange", tick);
}

init().catch((e) => {
  document.body.classList.add("ready");
  showToast(`Başlatılamadı: ${e}`);
});
