import type { GuildInfo, Status } from "./api";

export type Tone = "green" | "yellow" | "orange" | "red" | "gray" | "lock";

export interface StatusMeta {
  label: string;
  tone: Tone;
  hint: string;
}

export const STATUS_META: Record<Status, StatusMeta> = {
  unknown: { label: "Kontrol ediliyor", tone: "gray", hint: "Henüz kontrol edilmedi." },
  in_use: {
    label: "Kullanımda",
    tone: "green",
    hint: "Bu URL şu an bir sunucu tarafından kullanılıyor.",
  },
  appears_free: {
    label: "Boşta görünüyor",
    tone: "yellow",
    hint: "Hiçbir sunucu kullanmıyor ama alınabilir olması garanti değil: Discord bazı kelimeleri rezerve eder.",
  },
  released_guild_exists: {
    label: "Boşaldı · sunucu var",
    tone: "orange",
    hint: "Önceki sunucu hâlâ var, URL'yi bırakmış. Alınabilme ihtimali daha yüksek.",
  },
  released_guild_gone: {
    label: "Boşaldı · sunucu kapalı",
    tone: "red",
    hint: "Önceki sunucu silinmiş veya kapatılmış. URL bir süre kilitli kalabilir.",
  },
  blocked: {
    label: "Engelli",
    tone: "lock",
    hint: "Topluluk listesinde ya da senin tarafından alınamaz olarak işaretlenmiş.",
  },
};

export type Filter = "all" | "in_use" | "free" | "released" | "blocked";

export const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tümü" },
  { id: "in_use", label: "Kullanımda" },
  { id: "free", label: "Boşta" },
  { id: "released", label: "Boşaldı" },
  { id: "blocked", label: "Engelli" },
];

export function matchesFilter(status: Status, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in_use":
      return status === "in_use";
    case "free":
      return status === "appears_free";
    case "released":
      return status === "released_guild_exists" || status === "released_guild_gone";
    case "blocked":
      return status === "blocked";
  }
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  const then = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(then)) return "hiç";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 5) return "az önce";
  if (secs < 60) return `${secs} sn önce`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

export function formatMembers(count: number | null): string {
  return count == null ? "" : `${compact.format(count)} üye`;
}

export function guildIconUrl(guild: GuildInfo): string | null {
  return guild.icon && guild.id
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
    : null;
}
