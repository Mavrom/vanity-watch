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

export const api = {
  getState: () => invoke<AppSnapshot>("get_state"),
  addUrl: (input: string) => invoke<TrackedUrl>("add_url", { input }),
  removeUrl: (code: string) => invoke<void>("remove_url", { code }),
  refreshUrl: (code: string) => invoke<void>("refresh_url", { code }),
  refreshAll: () => invoke<void>("refresh_all"),
  setNote: (code: string, note: string) => invoke<void>("set_note", { code, note }),
  setUserBlocked: (code: string, blocked: boolean) =>
    invoke<void>("set_user_blocked", { code, blocked }),
  setMuted: (code: string, muted: boolean) => invoke<void>("set_muted", { code, muted }),
  updateSettings: (settings: Settings) => invoke<Settings>("update_settings", { settings }),
};

export function onUrlUpdated(cb: (url: TrackedUrl) => void): Promise<UnlistenFn> {
  return listen<TrackedUrl>("url-updated", (e) => cb(e.payload));
}

export function onChecking(cb: (code: string) => void): Promise<UnlistenFn> {
  return listen<string>("checking", (e) => cb(e.payload));
}
