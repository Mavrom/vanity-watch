import { describe, expect, it } from "vitest";
import { formatMembers, guildIconUrl, matchesFilter, relativeTime } from "./format";

describe("relativeTime", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  it("handles missing and invalid input", () => {
    expect(relativeTime(null, now)).toBe("hiç");
    expect(relativeTime("nope", now)).toBe("hiç");
  });
  it("formats ranges", () => {
    expect(relativeTime("2026-10-08T11:59:58Z", now)).toBe("az önce");
    expect(relativeTime("2026-10-08T11:59:30Z", now)).toBe("30 sn önce");
    expect(relativeTime("2026-10-08T11:55:00Z", now)).toBe("5 dk önce");
    expect(relativeTime("2026-10-08T09:00:00Z", now)).toBe("3 sa önce");
    expect(relativeTime("2026-10-06T12:00:00Z", now)).toBe("2 gün önce");
  });
  it("clamps future timestamps", () => {
    expect(relativeTime("2026-10-08T12:00:10Z", now)).toBe("az önce");
  });
});

describe("matchesFilter", () => {
  it("groups statuses", () => {
    expect(matchesFilter("in_use", "all")).toBe(true);
    expect(matchesFilter("in_use", "in_use")).toBe(true);
    expect(matchesFilter("appears_free", "free")).toBe(true);
    expect(matchesFilter("released_guild_gone", "released")).toBe(true);
    expect(matchesFilter("released_guild_exists", "released")).toBe(true);
    expect(matchesFilter("released_guild_exists", "free")).toBe(false);
    expect(matchesFilter("blocked", "blocked")).toBe(true);
    expect(matchesFilter("unknown", "in_use")).toBe(false);
  });
});

describe("formatMembers", () => {
  it("formats counts", () => {
    expect(formatMembers(null)).toBe("");
    expect(formatMembers(950)).toBe("950 üye");
    expect(formatMembers(12400)).toMatch(/^12,4\s?B üye$/);
  });
});

describe("guildIconUrl", () => {
  it("builds CDN url only when possible", () => {
    expect(guildIconUrl({ id: "1", name: "x", icon: "abc", memberCount: null })).toBe(
      "https://cdn.discordapp.com/icons/1/abc.png?size=64",
    );
    expect(guildIconUrl({ id: "1", name: "x", icon: null, memberCount: null })).toBeNull();
    expect(guildIconUrl({ id: "", name: "x", icon: "abc", memberCount: null })).toBeNull();
  });
});
