/* Kérések (Bibliai történetek) és Kérdezz élő jóstól (belépéssel). A háttér a kerdesek.gs. */
(function () {
  "use strict";
  var MAXLEN_R = 300, MINLEN_R = 5, MAXLEN_Q = 600, MINLEN_Q = 30, MIN_FILL = 4200, COOLDOWN = 60000;
  var POLL_FAST = window.__KER_POLL_MS || 20000, POLL_SLOW = window.__KER_POLL_MS || 60000;
  var POLL_FAST_FOR = window.__KER_POLL_MS ? 1500 : 600000, POLL_MAX = window.__KER_POLL_MS ? 6000 : 3 * 3600000;
  var DAY = 24 * 3600000;
  var SESS_KEY = "lf_ker_s", DRAW_KEY = "lf_ker_draw";

  var RE_BAD, RE_BAD_CARD;
  try { RE_BAD = new RegExp("[^\\p{L} ]", "gu"); RE_BAD_CARD = new RegExp("[^\\p{L} ()-]", "gu"); }
  catch (e) { RE_BAD = /[^A-Za-zÀ-ɏ ]/g; RE_BAD_CARD = /[^A-Za-zÀ-ɏ ()-]/g; }
  var RE_EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

  function readNum(k) { try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; } }
  function writeNum(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function readObj(k, store) { try { var v = JSON.parse((store || localStorage).getItem(k) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
  function writeObj(k, v, store) { try { (store || localStorage).setItem(k, JSON.stringify(v)); } catch (e) {} }
  function dropKey(k, store) { try { (store || localStorage).removeItem(k); } catch (e) {} }

  function hex(bytes) {
    var a = new Uint8Array(bytes), out = "", i;
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) { c.getRandomValues(a); } else { for (i = 0; i < bytes; i++) { a[i] = Math.floor(Math.random() * 256); } }
    for (i = 0; i < bytes; i++) { out += ("0" + a[i].toString(16)).slice(-2); }
    return out;
  }
  function rnd(n) {
    try { if (window.crypto && crypto.getRandomValues) { var a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n, x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim); return x % n; } } catch (e) {}
    return Math.floor(Math.random() * n);
  }

  // csak a megengedett karakterek maradnak, a sortörés és a tabulátor szóközzé válik
  function clean(s, re) {
    s = String(s == null ? "" : s);
    try { s = s.normalize("NFC"); } catch (e) {}
    return s.replace(/\s/g, " ").replace(re || RE_BAD, "");
  }
  function tidy(s, re) { return clean(s, re).replace(/ +/g, " ").trim(); }
  function hasBad(s, re) { re = re || RE_BAD; re.lastIndex = 0; var r = re.test(String(s).replace(/\s/g, " ")); re.lastIndex = 0; return r; }

  function post(api, obj) {
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) { ctl.abort(); } }, 15000);
    return fetch(api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(obj), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .catch(function (e) { clearTimeout(to); throw e; });
  }

  // szövegmező: élő szűrés, számláló, figyelmeztetés
  function bindArea(area, left, note, max, re) {
    var noteTimer = 0, composing = false;
    function upd() { left.textContent = "Még " + Math.max(0, max - area.value.length) + " karakter írható."; }
    function showNote() {
      note.textContent = "Csak betűt és szóközt lehet írni, a többit nem vettem át.";
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { note.textContent = ""; }, 5000);
    }
    function filter() {
      var v = area.value, c = clean(v, re).replace(/^ +/, "");
      if (c !== v) {
        var caret = typeof area.selectionStart === "number" ? area.selectionStart : v.length;
        var before = clean(v.slice(0, caret), re).replace(/^ +/, "");
        var bad = hasBad(v, re);
        area.value = c;
        try { area.setSelectionRange(before.length, before.length); } catch (e) {}
        if (bad) { showNote(); }
      }
      upd();
    }
    area.setAttribute("maxlength", String(max));
    area.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); } });
    area.addEventListener("compositionstart", function () { composing = true; });
    area.addEventListener("compositionend", function () { composing = false; filter(); });
    area.addEventListener("input", function (ev) { if (composing || (ev && ev.isComposing)) { upd(); return; } filter(); });
    area.addEventListener("blur", filter);
    upd();
    return { filter: filter, update: upd };
  }

  /* ---------------------------------------------------------------- névtelen kérések */
  function initReq(root, api) {
    var q = function (sel) { return root.querySelector(sel); };
    var form = q(".ker-form"), area = q(".ker-area"), hp = q('input[name="hp"]'), ok = q(".ker-ok");
    var msg = q(".ker-msg"), note = q(".ker-note"), left = q(".ker-left"), btn = q(".ker-send"), done = q(".ker-done");
    var t0 = Date.now(), pendingId = "", busy = false;
    var bind = bindArea(area, left, note, MAXLEN_R);
    function fail(text, el) { msg.textContent = text; if (el) { el.focus(); } }
    function errText(code) {
      if (code === "short") { return "Írj legalább öt betűt."; }
      if (code === "long") { return "Legfeljebb 300 karakter fér bele."; }
      if (code === "forbidden") { return "Csak betűt és szóközt írhatsz, számot és írásjelet nem."; }
      if (code === "rate" || code === "busy") { return "Most sokan írnak. Próbáld újra egy perc múlva."; }
      if (code === "full") { return "Most nem tudok újabb kérést fogadni. Nézz vissza később."; }
      if (code === "bot") { return "Nem sikerült elküldeni. Töltsd újra az oldalt, és próbáld újra."; }
      return "Most nem sikerült elküldeni. Próbáld újra egy kicsit később.";
    }
    function reset() { busy = false; btn.disabled = false; btn.textContent = btn.getAttribute("data-label"); }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) { return; }
      msg.textContent = "";
      if (hp && hp.value) { return; }
      bind.filter();
      var text = tidy(area.value);
      if (text.length < MINLEN_R) { return fail("Írj legalább öt betűt.", area); }
      if (text.length > MAXLEN_R) { return fail("Legfeljebb 300 karakter fér bele.", area); }
      if (!ok.checked) { return fail("Jelöld be a hozzájárulást, különben nem tudom elküldeni.", ok); }
      if (Date.now() - readNum("lf_ker_last_r") < COOLDOWN) { return fail("Az előbb már küldtél egyet. Kérlek, várj egy percet.", null); }
      busy = true; btn.disabled = true; btn.textContent = "Küldés…";
      if (!pendingId) { pendingId = "k" + hex(4).slice(0, 7); }
      var id = pendingId, wait = Math.max(0, MIN_FILL - (Date.now() - t0));
      setTimeout(function () {
        post(api, { a: "req", id: id, text: text, hp: "", t: Date.now() - t0 }).then(function (res) {
          if (res && res.ok === true) {
            writeNum("lf_ker_last_r", Date.now()); pendingId = "";
            area.value = ""; ok.checked = false; bind.update(); reset();
            form.hidden = true; done.hidden = false; var h = done.querySelector("h2"); if (h) { h.focus(); }
            return;
          }
          var code = res && res.err;
          if (code === "short" || code === "long" || code === "forbidden" || code === "full" || code === "bot") { pendingId = ""; }
          fail(errText(code), null); reset();
        }).catch(function () { fail(errText("error"), null); reset(); });
      }, wait);
    });
    var again = q(".ker-again");
    if (again) { again.addEventListener("click", function () { done.hidden = true; form.hidden = false; t0 = Date.now(); msg.textContent = ""; area.focus(); }); }
  }

  /* ---------------------------------------------------------------- Kérdezz élő jóstól */
  function initLive(root, api) {
    var q = function (sel) { return root.querySelector(sel); };
    var P = {};
    ["auth", "code", "ask", "card", "wait", "done", "msg"].forEach(function (s) { P[s] = root.querySelector('[data-state="' + s + '"]'); });
    var acct = q(".ker-account"), acctMail = q(".ker-account-mail");
    var cards = [];
    try { cards = JSON.parse(q(".ker-cards-json").textContent); } catch (e) { cards = []; }
    var sess = readObj(SESS_KEY);
    if (sess && !(Number(sess.exp) > Date.now() && typeof sess.token === "string")) { dropKey(SESS_KEY); sess = null; }
    var state = "", me = null, pollT = 0, pollStart = 0, inflight = false, tickT = 0, pendingAsk = "", tAsk = Date.now(), pendingEmail = "", resendT = 0;

    var quiet = true;      // az első megjelenítés nem görget és nem vesz el fókuszt
    function show(s, text) {
      state = s;
      Object.keys(P).forEach(function (k) { P[k].hidden = k !== s; });
      acct.hidden = !(sess && s !== "auth" && s !== "code" && s !== "msg");
      if (sess) { acctMail.textContent = sess.email || ""; }
      if (s === "msg") { q(".ker-msg-text").textContent = text || ""; }
      var h = P[s].querySelector("h2");
      if (h && !quiet) { h.setAttribute("tabindex", "-1"); h.focus(); }
      if (!(s === "msg" && text === "Betöltés…")) { quiet = false; }
    }
    function call(obj) { if (sess) { obj.token = sess.token; } return post(api, obj); }
    function logout(silent) {
      sess = null; me = null; dropKey(SESS_KEY); stopPoll(); clearInterval(tickT);
      if (!silent) { show("auth"); }
    }
    function authFail(res) {
      if (res && res.err === "auth") { logout(true); show("auth"); q(".ker-auth-msg").textContent = "A belépésed lejárt vagy megszűnt. Lépj be újra."; return true; }
      if (res && res.err === "banned") { stopPoll(); show("msg", "Ezzel a tagsággal most nem tudsz kérdezni."); return true; }
      return false;
    }
    function fmtLeft(ms) {
      var m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60), r = m % 60, parts = [];
      if (h) { parts.push(h + " óra"); }
      if (r || !h) { parts.push(r + " perc"); }
      return parts.join(" ");
    }

    /* ---- belépés */
    var email = q(".ker-email"), consent = q(".ker-consent"), hpA = q('input[name="hp"]'), authMsg = q(".ker-auth-msg"), getBtn = q(".ker-getcode");
    function codeErr(code, res) {
      if (code === "bad") { return "Ez az e-mail-cím nem tűnik jónak. Ellenőrizd, kérlek."; }
      if (code === "soon") { return "Az előbb már küldtem kódot. Várj még " + ((res && res.after) || 60) + " másodpercet."; }
      if (code === "rate") { return "Ma erre a címre vagy összesen túl sok kód ment ki. Próbáld újra később."; }
      if (code === "banned") { return "Ezzel a címmel most nem tudsz belépni."; }
      if (code === "full") { return "Most nem tudok új tagot fogadni."; }
      if (code === "bot") { return "Nem sikerült. Töltsd újra az oldalt, és próbáld újra."; }
      return "Most nem sikerült elküldeni a kódot. Próbáld újra egy kicsit később.";
    }
    function sendCode() {
      authMsg.textContent = ""; q(".ker-code-msg").textContent = "";
      if (hpA && hpA.value) { return; }
      var e = String(email.value || "").trim().toLowerCase();
      if (!RE_EMAIL.test(e) || e.length > 100) { authMsg.textContent = codeErr("bad"); email.focus(); return; }
      if (!consent.checked) { authMsg.textContent = "Jelöld be a hozzájárulást, különben nem tudok belépést adni."; consent.focus(); return; }
      getBtn.disabled = true; getBtn.textContent = "Küldés…";
      post(api, { a: "code", email: e, hp: "" }).then(function (res) {
        getBtn.disabled = false; getBtn.textContent = getBtn.getAttribute("data-label");
        if (res && res.ok === true) { pendingEmail = e; startResend(60); q(".ker-sentto").textContent = e; q(".ker-code").value = ""; show("code"); return; }
        if (res && res.err === "soon" && pendingEmail === e) { q(".ker-sentto").textContent = e; startResend(res.after || 60); show("code"); return; }
        authMsg.textContent = codeErr(res && res.err, res);
      }).catch(function () { getBtn.disabled = false; getBtn.textContent = getBtn.getAttribute("data-label"); authMsg.textContent = codeErr("error"); });
    }
    getBtn.addEventListener("click", sendCode);
    email.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); sendCode(); } });

    var resend = q(".ker-resend");
    function startResend(sec) {
      clearInterval(resendT); var left = sec;
      function upd() { resend.disabled = left > 0; resend.textContent = left > 0 ? "Új kódot kérhetsz " + left + " másodperc múlva" : "Új kódot kérek"; }
      upd(); resendT = setInterval(function () { left--; upd(); if (left <= 0) { clearInterval(resendT); } }, 1000);
    }
    resend.addEventListener("click", function () {
      if (resend.disabled) { return; }
      resend.disabled = true;
      post(api, { a: "code", email: pendingEmail, hp: "" }).then(function (res) {
        if (res && res.ok === true) { q(".ker-code-msg").textContent = "Újabb kódot küldtem."; startResend(60); return; }
        q(".ker-code-msg").textContent = codeErr(res && res.err, res); if (res && res.err === "soon") { startResend(res.after || 60); } else { resend.disabled = false; }
      }).catch(function () { q(".ker-code-msg").textContent = codeErr("error"); resend.disabled = false; });
    });
    q(".ker-back").addEventListener("click", function () { clearInterval(resendT); show("auth"); });

    var codeIn = q(".ker-code"), loginBtn = q(".ker-login");
    codeIn.addEventListener("input", function () { codeIn.value = codeIn.value.replace(/\D/g, "").slice(0, 6); });
    function loginErr(code, res) {
      if (code === "badcode") { return "Nem ez a kód. Még " + ((res && res.left) || 0) + " próbálkozásod van."; }
      if (code === "expired") { return "A kód lejárt, vagy elfogytak a próbálkozások. Kérj új kódot."; }
      if (code === "banned") { return "Ezzel a címmel most nem tudsz belépni."; }
      if (code === "full") { return "Most nem tudok új tagot fogadni."; }
      if (code === "rate") { return "Most sokan lépnek be. Próbáld újra egy perc múlva."; }
      return "Most nem sikerült a belépés. Próbáld újra egy kicsit később.";
    }
    function doLogin() {
      var msgEl = q(".ker-code-msg"); msgEl.textContent = "";
      var c = codeIn.value.replace(/\D/g, "");
      if (c.length !== 6) { msgEl.textContent = "A kód 6 számjegyű."; codeIn.focus(); return; }
      loginBtn.disabled = true; loginBtn.textContent = "Belépés…";
      post(api, { a: "login", email: pendingEmail, code: c }).then(function (res) {
        loginBtn.disabled = false; loginBtn.textContent = loginBtn.getAttribute("data-label");
        if (res && res.ok === true) {
          sess = { token: res.token, exp: res.exp, email: pendingEmail }; writeObj(SESS_KEY, sess);
          clearInterval(resendT); codeIn.value = ""; email.value = ""; consent.checked = false; enter();
          return;
        }
        msgEl.textContent = loginErr(res && res.err, res);
        if (res && res.err === "expired") { codeIn.value = ""; }
      }).catch(function () { loginBtn.disabled = false; loginBtn.textContent = loginBtn.getAttribute("data-label"); msgEl.textContent = loginErr("error"); });
    }
    loginBtn.addEventListener("click", doLogin);
    codeIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doLogin(); } });

    /* ---- belépés után, az állapot a szerveren van */
    function enter() {
      call({ a: "me" }).then(function (res) {
        if (authFail(res)) { return; }
        if (!res || res.ok !== true) { show("msg", "Most nem érem el a szervert. Töltsd újra az oldalt egy kicsit később."); return; }
        route(res);
      }).catch(function () { show("msg", "Most nem érem el a szervert. Töltsd újra az oldalt egy kicsit később."); });
    }
    function route(res) {
      me = res;
      if (res.status === "vár") { show("msg", "A tagságod megvan, de még nem hagytam jóvá. Amint jóváhagytam, kérdezhetsz."); return; }
      var qq = res.q;
      if (!qq) { showAsk(); return; }
      if (qq.answer) { showDone(); return; }
      if (!qq.card) { showCard(); return; }
      showWait();
    }

    /* ---- kérdés */
    var area = q(".ker-area"), askMsg = q(".ker-ask-msg"), askBtn = q(".ker-send"), askLeft = q(".ker-left"), askNote = q(".ker-note");
    var askBind = bindArea(area, askLeft, askNote, MAXLEN_Q);
    function showAsk() {
      var next = me && me.next ? me.next : 0;
      if (next > Date.now()) {
        if (me.q) { showDone(); } else { show("msg", "24 óránként csak egy kérdést tehetsz fel. Legközelebb " + fmtLeft(next - Date.now()) + " múlva kérdezhetsz."); }
        return;
      }
      pendingAsk = ""; tAsk = Date.now(); askMsg.textContent = ""; show("ask"); area.focus();
    }
    function askErr(code, res) {
      if (code === "short") { return "Írj legalább 30 karaktert, hogy tudjak mire válaszolni."; }
      if (code === "long") { return "Legfeljebb 600 karakter fér bele."; }
      if (code === "forbidden") { return "Csak betűt és szóközt írhatsz, számot és írásjelet nem."; }
      if (code === "wait") { return "24 óránként csak egy kérdést tehetsz fel. Legközelebb " + fmtLeft((res && res.next || 0) - Date.now()) + " múlva kérdezhetsz."; }
      if (code === "pending") { return "A tagságodat még nem hagytam jóvá."; }
      if (code === "rate" || code === "busy") { return "Most sokan kérdeznek. Próbáld újra egy perc múlva."; }
      if (code === "full") { return "Most sok kérdés vár sorban, ezért újat nem tudok fogadni. Nézz vissza később."; }
      if (code === "bot") { return "Nem sikerült elküldeni. Töltsd újra az oldalt, és próbáld újra."; }
      return "Most nem sikerült elküldeni. Próbáld újra egy kicsit később.";
    }
    var askBusy = false;
    function resetAsk() { askBusy = false; askBtn.disabled = false; askBtn.textContent = askBtn.getAttribute("data-label"); }
    q('[data-state="ask"] form').addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (askBusy) { return; }
      askMsg.textContent = "";
      askBind.filter();
      var text = tidy(area.value);
      if (text.length < MINLEN_Q) { askMsg.textContent = askErr("short"); area.focus(); return; }
      if (text.length > MAXLEN_Q) { askMsg.textContent = askErr("long"); area.focus(); return; }
      askBusy = true; askBtn.disabled = true; askBtn.textContent = "Küldés…";
      if (!pendingAsk) { pendingAsk = "q" + hex(12); }
      var id = pendingAsk, wait = Math.max(0, MIN_FILL - (Date.now() - tAsk));
      setTimeout(function () {
        call({ a: "ask", id: id, text: text, hp: "", t: Date.now() - tAsk }).then(function (res) {
          resetAsk();
          if (res && res.ok === true) {
            pendingAsk = ""; area.value = ""; askBind.update();
            me = { ok: true, status: "aktív", next: res.next || (Date.now() + DAY), q: { id: id, ts: Date.now(), text: text, card: "" } };
            showCard(); return;
          }
          if (authFail(res)) { return; }
          var code = res && res.err;
          if (code === "short" || code === "long" || code === "forbidden" || code === "full" || code === "bot") { pendingAsk = ""; }
          if (code === "wait") { enter(); }
          askMsg.textContent = askErr(code, res);
        }).catch(function () { resetAsk(); askMsg.textContent = askErr("error"); });
      }, wait);
    });

    /* ---- laphúzás: lefordított lapok, a látogató választ */
    var deck = q(".ker-deck"), cardBox = q(".ker-card"), cardImg = q(".ker-card img"), cardNameP = q(".ker-cardname");
    var cardIn = q(".ker-cardin"), cardLeft = q(".ker-cardleft"), cardNote = q(".ker-cardnote"), cardSend = q(".ker-cardsend"), cardMsg = q(".ker-card-msg");
    var cardBind = bindArea(cardIn, cardLeft, cardNote, 60, RE_BAD_CARD);
    cardLeft.textContent = "";
    function byKey(k) { for (var i = 0; i < cards.length; i++) { if (cards[i].k === k) { return cards[i]; } } return null; }
    function loadDraw(id) {
      var d = readObj(DRAW_KEY, sessionStorage);
      if (d && d.id === id && d.order && d.order.length === cards.length) { return d; }
      var order = [], j, r, t;
      for (j = 0; j < cards.length; j++) { order.push(cards[j].k); }
      for (j = order.length - 1; j > 0; j--) { r = rnd(j + 1); t = order[j]; order[j] = order[r]; order[r] = t; }
      d = { id: id, order: order, k: "" };
      writeObj(DRAW_KEY, d, sessionStorage);
      return d;
    }
    function reveal(c, animate) {
      deck.hidden = true; q(".ker-pickhelp").hidden = true;
      cardImg.src = "/" + c.k + ".webp"; cardImg.alt = c.name; cardNameP.textContent = c.name; cardBox.hidden = false;
      cardIn.value = c.name; cardBind.update(); cardLeft.textContent = ""; cardSend.disabled = false;
    }
    function showCard() {
      cardMsg.textContent = ""; q(".ker-card-q").textContent = me.q.text;
      var d = loadDraw(me.q.id), picked = d.k ? byKey(d.k) : null;
      deck.innerHTML = "";
      cardBox.hidden = true; cardIn.value = ""; q(".ker-pickhelp").hidden = false;
      if (picked) { reveal(picked); show("card"); return; }
      deck.hidden = false; cardSend.disabled = true;
      d.order.forEach(function (k, i) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "ker-lap"; b.setAttribute("data-i", String(i));
        b.setAttribute("aria-label", "Lefordított lap, " + (i + 1) + ". a " + d.order.length + " közül");
        b.addEventListener("click", function () {
          var c = byKey(k); if (!c) { return; }
          d.k = k; writeObj(DRAW_KEY, d, sessionStorage); reveal(c);
          cardIn.scrollIntoView({ block: "nearest" });
        });
        deck.appendChild(b);
      });
      show("card");
    }
    q('[data-state="card"] form').addEventListener("submit", function (ev) {
      ev.preventDefault(); cardMsg.textContent = "";
      cardBind.filter();
      var name = tidy(cardIn.value, RE_BAD_CARD);
      if (name.length < 2) { cardMsg.textContent = "Válassz egy lapot a lefordított lapok közül."; return; }
      cardSend.disabled = true; cardSend.textContent = "Küldés…";
      call({ a: "card", id: me.q.id, card: name }).then(function (res) {
        cardSend.disabled = false; cardSend.textContent = cardSend.getAttribute("data-label");
        if (res && (res.ok === true || res.err === "done")) { me.q.card = name; showWait(); return; }
        if (authFail(res)) { return; }
        cardMsg.textContent = res && res.err === "forbidden" ? "A lap neve csak betűt, szóközt és zárójelet tartalmazhat." : "Most nem sikerült elküldeni. Próbáld újra egy kicsit később.";
      }).catch(function () { cardSend.disabled = false; cardSend.textContent = cardSend.getAttribute("data-label"); cardMsg.textContent = "Most nem sikerült elküldeni. Próbáld újra egy kicsit később."; });
    });

    /* ---- várakozás és válasz */
    var waitStatus = q(".ker-status"), checkBtn = q(".ker-check-now"), newBtn = q(".ker-new-wait");
    function showWait() {
      q(".ker-wait-q").textContent = me.q.text; q(".ker-wait-card").textContent = me.q.card || "";
      checkBtn.hidden = true; newBtn.hidden = !(me.next && me.next <= Date.now());
      waitStatus.textContent = "Hamarosan megnézem a kérdésedet, addig kérlek, ne zárd be a böngészőt.";
      show("wait"); startPoll();
    }
    function stopPoll() { clearTimeout(pollT); pollT = 0; }
    function startPoll() { stopPoll(); pollStart = Date.now(); schedule(); }
    function schedule() {
      var el = Date.now() - pollStart;
      if (el > POLL_MAX) { waitStatus.textContent = "Még nem válaszoltam. Az oldal már nem nézi magától, a Megnézem most gombbal bármikor megnézheted. A kérdésed itt marad, amíg be vagy lépve."; checkBtn.hidden = false; return; }
      pollT = setTimeout(poll, el < POLL_FAST_FOR ? POLL_FAST : POLL_SLOW);
    }
    function poll() {
      if (state !== "wait" || inflight) { return; }
      inflight = true;
      call({ a: "me" }).then(function (res) {
        inflight = false;
        if (authFail(res)) { return; }
        if (res && res.ok === true) {
          me = res;
          if (res.q && res.q.answer) { showDone(); return; }
          newBtn.hidden = !(res.next && res.next <= Date.now());
        }
        schedule();
      }).catch(function () { inflight = false; schedule(); });
    }
    checkBtn.addEventListener("click", function () { checkBtn.hidden = true; waitStatus.textContent = "Megnézem, megjött-e a válasz."; pollStart = Date.now(); poll(); });
    newBtn.addEventListener("click", function () { stopPoll(); me.q = null; me.next = 0; showAsk(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && state === "wait" && !inflight) { stopPoll(); poll(); } });

    var doneNext = q(".ker-next"), newBtn2 = q(".ker-new-done");
    function updNext() {
      var next = me && me.next ? me.next : 0, left = next - Date.now();
      if (left > 0) { doneNext.textContent = "Új kérdést " + fmtLeft(left) + " múlva tehetsz fel, mert 24 óránként csak egy kérdés fér bele."; newBtn2.hidden = true; }
      else { doneNext.textContent = ""; newBtn2.hidden = false; }
    }
    function showDone() {
      stopPoll();
      var qq = me.q;
      q(".ker-answer-text").textContent = qq.answer || "";
      q(".ker-done-q").textContent = qq.text; q(".ker-done-card").textContent = qq.card || "";
      q(".ker-done-answer").hidden = !qq.answer; q(".ker-done-noanswer").hidden = !!qq.answer;
      updNext(); clearInterval(tickT); tickT = setInterval(updNext, 30000);
      show("done");
    }
    newBtn2.addEventListener("click", function () { clearInterval(tickT); me.q = null; me.next = 0; showAsk(); });

    /* ---- fiók */
    q(".ker-logout").addEventListener("click", function () { logout(false); q(".ker-auth-msg").textContent = ""; });
    var delAsk = q(".ker-del-ask"), delBtn = q(".ker-delete"), delYes = q(".ker-del-yes"), delNo = q(".ker-del-no");
    delBtn.addEventListener("click", function () { delAsk.hidden = false; delBtn.hidden = true; delYes.focus(); });
    delNo.addEventListener("click", function () { delAsk.hidden = true; delBtn.hidden = false; });
    delYes.addEventListener("click", function () {
      delYes.disabled = true;
      call({ a: "del" }).then(function (res) {
        delYes.disabled = false; delAsk.hidden = true; delBtn.hidden = false;
        if (res && res.ok === true) { dropKey(DRAW_KEY, sessionStorage); logout(true); show("msg", "A tagságodat és minden hozzá tartozó adatot töröltem."); return; }
        if (authFail(res)) { return; }
        show("msg", "Most nem sikerült a törlés. Próbáld újra egy kicsit később, vagy írj nekem a Kapcsolat oldalon.");
      }).catch(function () { delYes.disabled = false; delAsk.hidden = true; delBtn.hidden = false; show("msg", "Most nem sikerült a törlés. Próbáld újra egy kicsit később."); });
    });
    q(".ker-msg-back") && q(".ker-msg-back").addEventListener("click", function () { if (sess) { enter(); } else { show("auth"); } });

    // indulás
    if (sess) { show("msg", "Betöltés…"); enter(); } else { show("auth"); }
  }

  function boot() {
    var roots = document.querySelectorAll(".ker[data-api]");
    for (var i = 0; i < roots.length; i++) {
      var api = roots[i].getAttribute("data-api") || "";
      if (!/^https?:\/\//.test(api)) { continue; }
      if (roots[i].getAttribute("data-mode") === "live") { initLive(roots[i], api); } else { initReq(roots[i], api); }
    }
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
