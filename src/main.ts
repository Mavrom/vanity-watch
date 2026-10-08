import "./styles.css";
import { api, onChecking, onUrlUpdated, type Settings, type TrackedUrl } from "./api";
import { createCard, type Card } from "./card";
import { h, svgIcon } from "./dom";
import { FILTERS, matchesFilter, relativeTime, type Filter } from "./format";
import { ICONS } from "./icons";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const list = byId<HTMLElement>("list");
const filtersEl = byId<HTMLElement>("filters");
const emptyEl = byId<HTMLElement>("empty");
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
const toast = byId<HTMLDivElement>("toast");

const urls = new Map<string, TrackedUrl>();
const cards = new Map<string, Card>();
let settings: Settings;
let filter: Filter = "all";
let toastTimer: number | undefined;

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
    const card = createCard(url, { onError: showToast, onRemoved: remove });
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

function refreshView() {
  for (const [code, card] of cards) {
    card.el.hidden = !matchesFilter(urls.get(code)!.status, filter);
  }
  const all = [...urls.values()];
  filtersEl.replaceChildren(
    ...FILTERS.map((f) =>
      h(
        "button",
        {
          class: f.id === filter ? "chip active" : "chip",
          onclick: () => {
            filter = f.id;
            refreshView();
          },
        },
        f.label,
        h("span", { class: "count" }, String(all.filter((u) => matchesFilter(u.status, f.id)).length)),
      ),
    ),
  );
  emptyEl.hidden = urls.size > 0;
  filtersEl.hidden = urls.size === 0;
}

function applySettings() {
  autoToggle.checked = settings.autoCheck;
  intervalSelect.value = String(settings.intervalSecs);
  intervalSelect.disabled = !settings.autoCheck;
  setRelease.checked = settings.notifyOnRelease;
  setTaken.checked = settings.notifyOnTaken;
  setAutostart.checked = settings.autostart;
}

async function saveSettings(patch: Partial<Settings>) {
  try {
    settings = await api.updateSettings({ ...settings, ...patch });
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
    const url = await api.addUrl(value);
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
refreshAllBtn.addEventListener("click", () => api.refreshAll().catch((e) => showToast(String(e))));
settingsBtn.append(svgIcon(ICONS.sliders));
settingsBtn.addEventListener("click", () => settingsDialog.showModal());

async function init() {
  await onUrlUpdated((url) => {
    // Ignore late events for URLs removed in the meantime.
    if (urls.has(url.code)) upsert(url);
  });
  await onChecking((code) => cards.get(code)?.setChecking(true));

  const snapshot = await api.getState();
  settings = snapshot.settings;
  applySettings();
  [...snapshot.urls].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).forEach((u) => upsert(u));
  refreshView();
  if (snapshot.recovered) showToast("Veri dosyası bozuktu: yedeği alındı ve liste sıfırlandı.");

  window.setInterval(() => {
    document.querySelectorAll<HTMLElement>("[data-time]").forEach((el) => {
      el.textContent = relativeTime(el.dataset.time || null);
    });
  }, 1000);
}

init().catch((e) => showToast(`Başlatılamadı: ${e}`));
