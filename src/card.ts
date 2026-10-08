import type { Backend, TrackedUrl } from "./api";
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

export function createCard(initial: TrackedUrl, backend: Backend, handlers: CardHandlers): Card {
  let url = initial;
  const fail = (e: unknown) => handlers.onError(String(e));

  const avatar = h("div", { class: "avatar" });
  const identText = h("div", { class: "ident-text" });
  const pill = h("span", { class: "pill" });
  const members = h("div", { class: "meta members" });
  const time = h("div", { class: "meta time" });
  const bellBtn = h("button", { class: "icon-btn bell" });
  const refreshBtn = h("button", { class: "icon-btn refresh", title: "Şimdi kontrol et" }, svgIcon(ICONS.refresh));
  const deleteBtn = h("button", { class: "icon-btn danger", title: "Sil" }, svgIcon(ICONS.trash));
  const chevron = h("span", { class: "chevron" }, svgIcon(ICONS.chevron));
  const main = h(
    "div",
    { class: "row-main" },
    h("div", { class: "ident" }, avatar, identText),
    pill,
    members,
    time,
    h("div", { class: "actions" }, bellBtn, refreshBtn, deleteBtn),
    chevron,
  );

  const hint = h("p", { class: "hint" });
  const blockedInput = h("input", { type: "checkbox" });
  const note = h("textarea", { class: "note", placeholder: "Bu URL hakkında not ekle…", maxlength: "500", rows: "3" });
  const timeline = h("ol", { class: "timeline" });
  const details = h(
    "div",
    { class: "details" },
    h(
      "div",
      { class: "details-inner" },
      h(
        "div",
        { class: "details-col" },
        h("h4", {}, "Durum"),
        hint,
        h(
          "label",
          { class: "toggle-row" },
          blockedInput,
          h("span", { class: "mini-switch" }),
          h("span", {}, "Denedim, bu URL alınamıyor"),
        ),
        h("h4", {}, "Not"),
        note,
      ),
      h("div", { class: "details-col" }, h("h4", {}, "Geçmiş"), timeline),
    ),
  );
  const el = h("article", { class: "row" }, main, details);

  main.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".actions")) return;
    el.classList.toggle("open");
  });

  bellBtn.addEventListener("click", () => {
    const muted = !url.muted;
    backend.setMuted(url.code, muted).then(() => {
      url = { ...url, muted };
      render();
    }, fail);
  });

  refreshBtn.addEventListener("click", () => {
    setChecking(true);
    backend.refreshUrl(url.code).catch(fail);
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
    el.classList.add("leaving");
    backend.removeUrl(url.code).then(() => window.setTimeout(() => handlers.onRemoved(url.code), 180), fail);
  });

  blockedInput.addEventListener("change", () => {
    setChecking(true);
    backend.setUserBlocked(url.code, blockedInput.checked).catch(fail);
  });

  let noteTimer: number | undefined;
  const saveNote = () => {
    window.clearTimeout(noteTimer);
    if (note.value === url.note) return;
    url = { ...url, note: note.value };
    backend.setNote(url.code, note.value).catch(fail);
    renderIdent();
  };
  note.addEventListener("input", () => {
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(saveNote, 600);
  });
  note.addEventListener("blur", saveNote);

  function renderIdent() {
    const inUse = url.status === "in_use";
    let sub: string;
    if (url.guild && inUse) sub = url.guild.name;
    else if (url.guild) sub = `Son sahibi: ${url.guild.name}`;
    else if (url.status === "unknown") sub = "İlk kontrol bekleniyor";
    else sub = "Hiçbir sunucuda görülmedi";
    identText.replaceChildren(
      h(
        "div",
        { class: "code", title: `discord.gg/${url.code}` },
        url.code,
        url.muted ? h("span", { class: "muted-flag", title: "Bildirimler kapalı" }, svgIcon(ICONS.bellOff)) : null,
      ),
      h("div", { class: "sub" }, h("span", { class: "sub-main" }, sub), url.note ? h("span", { class: "sub-note" }, url.note) : null),
    );
  }

  function render() {
    const meta = STATUS_META[url.status];
    el.dataset.tone = meta.tone;

    const iconUrl = url.guild ? guildIconUrl(url.guild) : null;
    const letter = (url.guild?.name || url.code).charAt(0).toUpperCase();
    avatar.replaceChildren(iconUrl ? h("img", { src: iconUrl, alt: "" }) : h("span", {}, letter));

    renderIdent();

    pill.className = `pill tone-${meta.tone}`;
    pill.replaceChildren(h("i", { class: "dot" }), meta.label);

    const count = url.status === "in_use" && url.guild ? formatMembers(url.guild.memberCount) : "";
    members.replaceChildren(...(count ? [svgIcon(ICONS.users), h("span", {}, count.replace(" üye", ""))] : [h("span", { class: "faint" }, "—")]));
    members.title = count;

    time.replaceChildren(
      url.lastError ? h("span", { class: "err", title: url.lastError }, svgIcon(ICONS.alert)) : svgIcon(ICONS.clock),
      h("span", { "data-time": url.lastChecked ?? "" }, relativeTime(url.lastChecked)),
    );
    time.classList.toggle("has-error", !!url.lastError);
    time.title = url.lastError ? `Son kontrol başarısız: ${url.lastError}` : "Son kontrol";

    bellBtn.replaceChildren(svgIcon(url.muted ? ICONS.bellOff : ICONS.bell));
    bellBtn.title = url.muted ? "Bildirimler kapalı (aç)" : "Bildirimler açık (kapat)";
    bellBtn.classList.toggle("muted", url.muted);

    hint.textContent = meta.hint;
    blockedInput.checked = url.userBlocked;
    if (document.activeElement !== note) note.value = url.note;

    const entries = [...url.history].reverse();
    timeline.replaceChildren(
      ...(entries.length
        ? entries.map((e) =>
            h(
              "li",
              { class: `tone-${STATUS_META[e.to].tone}` },
              h("i", { class: "dot" }),
              h("div", {}, h("b", {}, STATUS_META[e.to].label), h(
                  "small",
                  {},
                  e.from === "unknown" ? `İlk kontrol · ${formatDate(e.at)}` : `${STATUS_META[e.from].label} durumundan · ${formatDate(e.at)}`,
                )),
            ),
          )
        : [h("li", { class: "empty-history" }, "Henüz durum değişikliği yok")]),
    );
  }

  function setChecking(on: boolean) {
    el.classList.toggle("checking", on);
  }

  render();
  return {
    el,
    update(next) {
      const changed = next.status !== url.status;
      url = next;
      setChecking(false);
      render();
      if (changed) {
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
      }
    },
    setChecking,
  };
}
