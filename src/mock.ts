// Dev-only fake backend so the UI can be designed in a regular browser (`npm run dev`).
// Never bundled into the app: loadBackend() only imports it outside Tauri in dev mode.
import type { Backend, CycleState, Settings, Status, TrackedUrl } from "./api";

const ago = (secs: number) => new Date(Date.now() - secs * 1000).toISOString();

function url(code: string, status: Status, extra: Partial<TrackedUrl> = {}): TrackedUrl {
  return {
    code,
    addedAt: ago(86400 * 3),
    status,
    lastChecked: ago(4),
    lastError: null,
    guild: null,
    note: "",
    userBlocked: false,
    muted: false,
    alert: false,
    history: [],
    ...extra,
  };
}

const urls: TrackedUrl[] = [
  url("discord-developers", "in_use", {
    guild: { id: "613425648685547541", name: "Discord Developers", icon: "a_1d18823294be0ccfbcdec090c8ffcc0d", memberCount: 241_000 },
    history: [{ at: ago(86400 * 3), from: "unknown", to: "in_use" }],
  }),
  url("nightcore", "released_guild_exists", {
    guild: { id: "1", name: "Nightcore Lounge", icon: null, memberCount: 1840 },
    history: [
      { at: ago(86400 * 2), from: "unknown", to: "in_use" },
      { at: ago(540), from: "in_use", to: "released_guild_exists" },
    ],
    note: "Sunucu sahibine yazdım, cevap bekliyorum.",
    alert: true,
  }),
  url("oyun-gecesi", "in_use", {
    guild: { id: "2", name: "Oyun Gecesi", icon: null, memberCount: 58_300 },
    history: [{ at: ago(86400), from: "unknown", to: "in_use" }],
    muted: true,
  }),
  url("kahve", "appears_free", { history: [{ at: ago(7200), from: "unknown", to: "appears_free" }] }),
  url("pixelart", "released_guild_gone", {
    guild: { id: "3", name: "Pixel Art Club", icon: null, memberCount: 920 },
    history: [
      { at: ago(86400 * 2), from: "unknown", to: "in_use" },
      { at: ago(3600 * 5), from: "in_use", to: "released_guild_gone" },
    ],
  }),
  url("kral", "blocked", { userBlocked: true, history: [{ at: ago(86400), from: "unknown", to: "blocked" }] }),
  url("lofi-cafe", "in_use", {
    guild: { id: "4", name: "Lofi Cafe", icon: null, memberCount: 12_400 },
    lastError: "Zaman aşımı",
    history: [{ at: ago(3600 * 20), from: "unknown", to: "in_use" }],
  }),
];

let settings: Settings = { autoCheck: true, intervalSecs: 20, notifyOnRelease: true, notifyOnTaken: false, autostart: false };

type Cb<T> = (payload: T) => void;
const subs = { updated: [] as Cb<TrackedUrl>[], checking: [] as Cb<string>[], cycle: [] as Cb<CycleState>[] };
let cycleState: CycleState = { cycling: true, nextCheckAt: null };
const sub = <T>(list: Cb<T>[]) => async (cb: Cb<T>) => {
  list.push(cb);
  return () => void list.splice(list.indexOf(cb), 1);
};
const emit = <T>(list: Cb<T>[], payload: T) => list.forEach((cb) => cb(payload));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check(code: string) {
  const u = urls.find((x) => x.code === code);
  if (!u) return;
  emit(subs.checking, code);
  await wait(500 + Math.random() * 500);
  if (u.status === "unknown") {
    u.history.push({ at: new Date().toISOString(), from: "unknown", to: "appears_free" });
    u.status = "appears_free";
  }
  u.lastChecked = new Date().toISOString();
  emit(subs.updated, structuredClone(u));
}

let timer: number | undefined;
async function cycle() {
  window.clearTimeout(timer);
  cycleState = { cycling: true, nextCheckAt: null };
  emit(subs.cycle, cycleState);
  for (const u of urls) await check(u.code);
  const next = settings.autoCheck ? new Date(Date.now() + settings.intervalSecs * 1000).toISOString() : null;
  cycleState = { cycling: false, nextCheckAt: next };
  emit(subs.cycle, cycleState);
  if (settings.autoCheck) timer = window.setTimeout(cycle, settings.intervalSecs * 1000);
}
setTimeout(cycle, 800);

export const mockBackend: Backend = {
  getState: async () => ({ settings, urls: structuredClone(urls), cycle: cycleState, recovered: false }),
  addUrl: async (input) => {
    const code = input.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?(discord\.gg\/|discord\.com\/invite\/)?/, "");
    if (urls.some((u) => u.code === code)) throw `discord.gg/${code} zaten listede`;
    const u = url(code, "unknown", { addedAt: new Date().toISOString(), lastChecked: null });
    urls.push(u);
    void check(code);
    return structuredClone(u);
  },
  removeUrl: async (code) => void urls.splice(urls.findIndex((u) => u.code === code), 1),
  dismissAlert: async (code) => void (urls.find((u) => u.code === code)!.alert = false),
  refreshUrl: async (code) => void check(code),
  refreshAll: async () => void cycle(),
  setNote: async (code, note) => void (urls.find((u) => u.code === code)!.note = note),
  setUserBlocked: async (code, blocked) => {
    const u = urls.find((x) => x.code === code)!;
    u.userBlocked = blocked;
    void check(code);
  },
  setMuted: async (code, muted) => void (urls.find((u) => u.code === code)!.muted = muted),
  updateSettings: async (s) => {
    settings = s;
    void cycle();
    return settings;
  },
  onUrlUpdated: sub(subs.updated),
  onChecking: sub(subs.checking),
  onCycle: sub(subs.cycle),
};
