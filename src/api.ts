import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status =
  | "unknown"
  | "in_use"
  | "appears_free"
  | "released_guild_exists"
  | "released_guild_gone"
  | "blocked";

export interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number | null;
}

export interface HistoryEntry {
  at: string;
  from: Status;
  to: Status;
}

export interface TrackedUrl {
  code: string;
  addedAt: string;
  status: Status;
  lastChecked: string | null;
  lastError: string | null;
  guild: GuildInfo | null;
  note: string;
  userBlocked: boolean;
  muted: boolean;
  history: HistoryEntry[];
}

export interface Settings {
  autoCheck: boolean;
  intervalSecs: number;
  notifyOnRelease: boolean;
  notifyOnTaken: boolean;
  autostart: boolean;
}

export interface AppSnapshot {
  settings: Settings;
  urls: TrackedUrl[];
  recovered: boolean;
}

export interface CycleInfo {
  /** ISO time of the next automatic check; null when auto-check is paused. */
  nextCheckAt: string | null;
}

type Listen<T> = (cb: (payload: T) => void) => Promise<UnlistenFn>;

export interface Backend {
  getState(): Promise<AppSnapshot>;
  addUrl(input: string): Promise<TrackedUrl>;
  removeUrl(code: string): Promise<void>;
  refreshUrl(code: string): Promise<void>;
  refreshAll(): Promise<void>;
  setNote(code: string, note: string): Promise<void>;
  setUserBlocked(code: string, blocked: boolean): Promise<void>;
  setMuted(code: string, muted: boolean): Promise<void>;
  updateSettings(settings: Settings): Promise<Settings>;
  onUrlUpdated: Listen<TrackedUrl>;
  onChecking: Listen<string>;
  onCycleStarted: Listen<void>;
  onCycleFinished: Listen<CycleInfo>;
}

const on =
  <T>(event: string): Listen<T> =>
  (cb) =>
    listen<T>(event, (e) => cb(e.payload));

const tauriBackend: Backend = {
  getState: () => invoke("get_state"),
  addUrl: (input) => invoke("add_url", { input }),
  removeUrl: (code) => invoke("remove_url", { code }),
  refreshUrl: (code) => invoke("refresh_url", { code }),
  refreshAll: () => invoke("refresh_all"),
  setNote: (code, note) => invoke("set_note", { code, note }),
  setUserBlocked: (code, blocked) => invoke("set_user_blocked", { code, blocked }),
  setMuted: (code, muted) => invoke("set_muted", { code, muted }),
  updateSettings: (settings) => invoke("update_settings", { settings }),
  onUrlUpdated: on("url-updated"),
  onChecking: on("checking"),
  onCycleStarted: on("cycle-started"),
  onCycleFinished: on("cycle-finished"),
};

/** Real backend inside Tauri; sample data when the UI is opened in a plain browser during development. */
export async function loadBackend(): Promise<Backend> {
  if ("__TAURI_INTERNALS__" in window || !import.meta.env.DEV) return tauriBackend;
  const { mockBackend } = await import("./mock");
  return mockBackend;
}
