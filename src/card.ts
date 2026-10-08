import { api, type TrackedUrl } from "./api";
import { h, svgIcon } from "./dom";
import { STATUS_META, formatDate, formatMembers, guildIconUrl, relativeTime } from "./format";
import { ICONS } from "./icons";

export interface Card {
  el: HTMLElement;
  update(url: TrackedUrl): void;
  setChecking(on: boolean): void;
}

export interface CardHandlers {
  onError(message: string): void;
  onRemoved(code: string): void;
}

export function createCard(initial: TrackedUrl, handlers: CardHandlers): Card {
  let url = initial;
  const fail = (e: unknown) => handlers.onError(String(e));

  const avatar = h("div", { class: "avatar" });
  const info = h("div", { class: "info" });
  const bellBtn = h("button", { class: "btn icon ghost bell" });
  const refreshBtn = h("button", { class: "btn icon ghost refresh", title: "Şimdi kontrol et" }, svgIcon(ICONS.refresh));
  const deleteBtn = h("button", { class: "btn icon ghost danger", title: "Sil" }, svgIcon(ICONS.trash));
  const main = h("div", { class: "card-main" }, avatar, info, h("div", { class: "actions" }, bellBtn, refreshBtn, deleteBtn));

  const hint = h("p", { class: "hint" });
  const blockedInput = h("input", { type: "checkbox" });
  const note = h("textarea", { class: "note", placeholder: "Not ekle…", maxlength: "500", rows: "2" });
  const history = h("ul", { class: "history" });
  const details = h(
    "div",
    { class: "details", hidden: true },
    hint,
    h("label", { class: "check" }, blockedInput, h("span", {}, "Denedim, bu URL alınamıyor")),
    note,
    h("h4", {}, "Geçmiş"),
    history,
  );
  const el = h("article", { class: "card" }, main, details);

  main.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".actions")) return;
    details.hidden = !details.hidden;
    el.classList.toggle("open", !details.hidden);
  });

  bellBtn.addEventListener("click", () => {
    const muted = !url.muted;
    api.setMuted(url.code, muted).then(() => {
      url = { ...url, muted };
      render();
    }, fail);
  });

  refreshBtn.addEventListener("click", () => {
    setChecking(true);
    api.refreshUrl(url.code).catch(fail);
  });

  let confirmTimer: number | undefined;
  deleteBtn.addEventListener("click", () => {
    if (!deleteBtn.classList.contains("confirm")) {
      deleteBtn.classList.add("confirm");
      deleteBtn.title = "Silmek için tekrar tıkla";
      confirmTimer = window.setTimeout(() => {
        deleteBtn.classList.remove("confirm");
        deleteBtn.title = "Sil";
      }, 3000);
      return;
    }
    window.clearTimeout(confirmTimer);
    api.removeUrl(url.code).then(() => handlers.onRemoved(url.code), fail);
  });

  blockedInput.addEventListener("change", () => {
    setChecking(true);
    api.setUserBlocked(url.code, blockedInput.checked).catch(fail);
  });

  let noteTimer: number | undefined;
  const saveNote = () => {
    window.clearTimeout(noteTimer);
    if (note.value === url.note) return;
    url = { ...url, note: note.value };
    api.setNote(url.code, note.value).catch(fail);
  };
  note.addEventListener("input", () => {
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(saveNote, 600);
  });
  note.addEventListener("blur", saveNote);

  function render() {
    const meta = STATUS_META[url.status];
    el.dataset.tone = meta.tone;

    const iconUrl = url.guild ? guildIconUrl(url.guild) : null;
    const initial = (url.guild?.name || url.code).charAt(0).toUpperCase();
    avatar.replaceChildren(iconUrl ? h("img", { src: iconUrl, alt: "" }) : h("span", {}, initial));

    const secondary: Node[] = [];
    if (url.guild) {
      const inUse = url.status === "in_use";
      secondary.push(h("span", { class: "guild" }, inUse ? url.guild.name : `Son sahibi: ${url.guild.name}`));
      const members = formatMembers(url.guild.memberCount);
      if (inUse && members) secondary.push(h("span", {}, members));
    }
    secondary.push(h("span", { class: "time", "data-time": url.lastChecked ?? "" }, relativeTime(url.lastChecked)));

    info.replaceChildren(
      h(
        "div",
        { class: "line1" },
        h("span", { class: "code" }, h("span", { class: "prefix" }, "discord.gg/"), url.code),
        h("span", { class: `badge tone-${meta.tone}` }, meta.label),
        url.lastError ? h("span", { class: "warn", title: url.lastError }, "⚠ Kontrol edilemedi") : null,
      ),
      h("div", { class: "line2" }, ...secondary),
    );

    bellBtn.replaceChildren(svgIcon(url.muted ? ICONS.bellOff : ICONS.bell));
    bellBtn.title = url.muted ? "Bildirimler kapalı (aç)" : "Bildirimler açık (kapat)";
    bellBtn.classList.toggle("muted", url.muted);

    hint.textContent = meta.hint;
    blockedInput.checked = url.userBlocked;
    if (document.activeElement !== note) note.value = url.note;

    const entries = [...url.history].reverse();
    history.replaceChildren(
      ...(entries.length
        ? entries.map((e) =>
            h("li", {}, h("time", {}, formatDate(e.at)), `${STATUS_META[e.from].label} → ${STATUS_META[e.to].label}`),
          )
        : [h("li", { class: "empty-history" }, "Henüz değişiklik yok")]),
    );
  }

  function setChecking(on: boolean) {
    el.classList.toggle("checking", on);
  }

  render();
  return {
    el,
    update(next) {
      url = next;
      setChecking(false);
      render();
    },
    setChecking,
  };
}
