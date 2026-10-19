// chat.js — محادثات عمر ⇄ إسراء (يُحمَّل بعد السكربت الرئيسي في index.html)
(function () {
  const CHAT_MAX_PER_SIDE = 5;      // الحد لكل واحد (الرسالة الأولى لعمر محسوبة منها)
  const CHAT_STRICT_TURNS = true;   // true = الرد بالدور، false = أي حد يبعت لحد الحد
  let threadOff = null;

  /* ---------- CSS ---------- */
  const style = document.createElement("style");
  style.textContent = `
    .bubble{max-width:85%;padding:.7rem .9rem;border-radius:1rem;line-height:1.9;text-align:right;white-space:pre-wrap;word-break:break-word}
    .bubble.me{align-self:flex-start;background:var(--acc);color:var(--bg)}
    .bubble.them{align-self:flex-end;background:var(--line);color:var(--fg)}
    .bubble small{display:block;opacity:.7;font-size:.75rem}
    .chat-box{font:inherit;width:100%;padding:.75rem;border:1px solid var(--line);border-radius:.6rem;background:transparent;color:var(--fg);text-align:right;resize:vertical}
  `;
  document.head.append(style);

  /* ---------- منطق المحادثة ---------- */
  function chatState(msg, me) {
    const repliesObj = (msg && msg.replies) || {};
    const replies = Object.keys(repliesObj).sort().map(k => repliesObj[k]); // مفاتيح push مرتبة زمنيًا
    const omarCount = 1 + replies.filter(r => r.from === "omar").length;    // الرسالة الأولى لعمر
    const esraCount = replies.filter(r => r.from === "esra").length;
    const last = replies.length ? replies[replies.length - 1] : { from: "omar", at: 0 };
    const closed = omarCount >= CHAT_MAX_PER_SIDE && esraCount >= CHAT_MAX_PER_SIDE;
    const myCount = me === "omar" ? omarCount : esraCount;
    const myTurn = !CHAT_STRICT_TURNS || last.from !== me;
    const canSend = !!(msg && msg.viewed) && !closed && myCount < CHAT_MAX_PER_SIDE && myTurn;
    return { replies, last, closed, myCount, left: CHAT_MAX_PER_SIDE - myCount, canSend };
  }

  function chatUnread(msg, me) {
    if (!msg || !msg.viewed) return false;
    const st = chatState(msg, me);
    if (!st.replies.length || st.last.from === me) return false;
    return st.last.at > ((msg.seen && msg.seen[me]) || 0);
  }

  async function sendChatReply(slot, text) {
    const me = UID;
    const repliesRef = ref(db, messagePath(slot) + "/replies");
    const key = repliesRef.push().key;
    const res = await runTransaction(repliesRef, current => {
      const replies = current || {};
      if (!chatState({ viewed: true, replies }, me).canSend) return; // الحد خلص أو مش دورك: إلغاء
      replies[key] = { from: me, text, at: serverNow() };
      return replies;
    });
    return res.committed;
  }

  /* ---------- شاشة المحادثة ---------- */
  function viewThread(slot) {
    currentView = "thread";
    const me = UID;
    const other = me === "omar" ? "Esra" : "Omar";
    let msg = null;

    const listEl = h("div", { style: "width:100%;display:flex;flex-direction:column;gap:.6rem" });
    const noteEl = h("div", { cls: "mute" });
    const counterEl = h("div", { cls: "mute" });
    const input = h("textarea", { cls: "chat-box", rows: 3, maxlength: 500, placeholder: "اكتب رسالتك…" });
    const sendBtn = h("button", { cls: "btn big" }, "إرسال");
    const composer = h("div", { style: "width:100%;display:flex;flex-direction:column;gap:.6rem", hidden: "" },
      counterEl, input, sendBtn);

    function bubble(from, text, title) {
      const mine = from === me;
      const name = (ALLOWED_USERS[from] || {}).displayName || from;
      return h("div", { cls: "bubble " + (mine ? "me" : "them") },
        h("small", {}, mine ? "أنت" : name),
        title ? h("b", {}, title + "\n") : null,
        text);
    }

    function render() {
      const st = chatState(msg, me);
      put(listEl, bubble("omar", msg.text || "", msg.title), ...st.replies.map(r => bubble(r.from, r.text, null)));
      composer.hidden = !st.canSend;
      counterEl.textContent = "متبقي لك " + ar(st.left) + " من " + ar(CHAT_MAX_PER_SIDE) + " رسائل";
      noteEl.textContent = st.closed
        ? "🔒 انتهى حد هذه المحادثة. انتظرا الرسالة القادمة لإكمال المحادثة."
        : st.canSend ? ""
        : st.left <= 0 ? "أرسلت كل رسائلك — بانتظار ردّ " + other
        : "بانتظار ردّ " + other;

      if (st.replies.length && st.last.from !== me && st.last.at > ((msg.seen && msg.seen[me]) || 0)) {
        update(ref(db, messagePath(slot) + "/seen"), { [me]: serverNow() }).catch(() => {});
      }
    }

    sendBtn.onclick = async () => {
      const text = input.value.trim();
      if (!text || sendBtn.disabled) return;
      sendBtn.disabled = true;
      try {
        const ok = await sendChatReply(slot, text);
        if (ok) input.value = ""; else toast("لا يمكن الإرسال الآن");
      } catch (err) {
        toast(friendlyError(err));
      }
      sendBtn.disabled = false;
    };

    mount(h("div", { cls: "screen", style: "justify-content:flex-start" },
      h("h1", {}, "💬 المحادثة"),
      listEl, noteEl, composer,
      h("button", { cls: "link", on: { click: () => viewChats() } }, "رجوع")
    ));

    // الاشتراك بعد mount (لأن mount بيقفل الاشتراك القديم)
    threadOff = onValue(ref(db, messagePath(slot)), snap => {
      const v = snap.val();
      if (!v) return;
      msg = v;
      render();
    }, () => toast(CONNECT_ERROR_MSG));
  }

  async function viewChats() {
    currentView = "chats";
    const listEl = h("div", { style: "width:100%" }, h("div", { cls: "mute" }, "جارٍ التحميل…"));
    mount(h("div", { cls: "screen", style: "justify-content:flex-start" },
      h("h1", {}, "💬 المحادثات"),
      listEl,
      h("button", { cls: "link", on: { click: () => viewHome() } }, "رجوع")
    ));
    try {
      const data = (await get(ref(db, "adminMessages/esra"))).val() || {};
      const rows = MESSAGE_SLOTS.map(slot => ({ slot, msg: data[slot] })).filter(x => x.msg && x.msg.viewed);
      if (!rows.length) { put(listEl, h("div", { cls: "mute" }, "لا توجد محادثات بعد.")); return; }
      put(listEl, ...rows.reverse().map(({ slot, msg }) => {
        const st = chatState(msg, UID);
        const status = st.closed ? "🔒 انتهت" : st.canSend ? "دورك في الرد" : "بانتظار الرد";
        return h("div", { cls: "row" },
          h("div", {}, h("b", {}, (chatUnread(msg, UID) ? "🔴 " : "") + (msg.title || "رسالة")), h("span", { cls: "mute" }, status)),
          h("button", { cls: "btn ghost", on: { click: () => viewThread(slot) } }, "فتح"));
      }));
    } catch (err) {
      put(listEl, h("div", { cls: "mute" }, CONNECT_ERROR_MSG));
    }
  }

  function chatsButton() {
    const btn = h("button", { cls: "btn ghost", on: { click: () => viewChats() } }, "💬 المحادثات");
    get(ref(db, "adminMessages/esra")).then(snap => {
      const data = snap.val() || {};
      const n = MESSAGE_SLOTS.filter(s => chatUnread(data[s], UID)).length;
      if (n) btn.textContent = "💬 المحادثات (" + ar(n) + " جديد)";
    }).catch(() => {});
    return btn;
  }

  /* ---------- نافذة وصول الرسالة (رد / تم) ---------- */
  function showMessagePopupWithReply(slot, msg) {
    return new Promise(resolve => {
      const close = async openChat => {
        if (messagingBusy) return;
        messagingBusy = true;
        try {
          await update(ref(db, messagePath(slot)), { viewed: true, viewedAt: serverNow() });
        } catch (err) {
          console.error("mark viewed failed:", err);
        }
        messagingBusy = false;
        overlay.remove();
        resolve();
        if (openChat) viewThread(slot);
      };

      const overlay = h("div", {
        role: "presentation",
        style: "position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:1rem"
      },
        h("div", {
          role: "dialog",
          "aria-modal": "true",
          style: "width:100%;max-width:22rem;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:1rem;padding:1.4rem;display:flex;flex-direction:column;gap:.9rem;text-align:center"
        },
          h("div", { style: "font-weight:700;font-size:1.15rem;color:var(--acc)" }, msg.title || "رسالة"),
          h("div", { cls: "qf", style: "font-size:1.15rem;line-height:2;white-space:pre-wrap" }, msg.text || ""),
          h("div", { style: "display:flex;gap:.6rem" },
            h("button", { cls: "btn big", style: "flex:1", on: { click: () => close(true) } }, "↩ رد"),
            h("button", { cls: "btn ghost", style: "flex:1", on: { click: () => close(false) } }, "تم")
          )
        )
      );

      document.body.append(overlay);
    });
  }

  /* ---------- ربط الكود الجديد بالتطبيق ---------- */
  const origMount = window.mount;
  window.mount = function (node) {
    if (threadOff) { threadOff(); threadOff = null; }
    return origMount(node);
  };

  const origRenderHome = window.renderHome;
  window.renderHome = function () {
    origRenderHome();
    if (currentView !== "home") return;
    const screen = document.querySelector("#app .screen");
    if (!screen) return;
    const btn = chatsButton();
    const streakEl = screen.querySelector('[aria-label="الستريك"]');
    if (streakEl) streakEl.after(btn); else screen.append(btn);
  };

  window.showMessagePopup = showMessagePopupWithReply;

  // لو التطبيق عرض الرئيسية قبل تحميل الملف ده
  if (currentView === "home") window.renderHome();
})();
