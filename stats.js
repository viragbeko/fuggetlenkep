/* Névtelen látogatásmérés – süti, tárolt azonosító és IP-cím nélkül.
   Egy látogatás = egy sor a táblázatban: érkezés, távozás, aktív idő, oldal, eszköz, forrás, nyelv.
   A tarot oldalakon a kártyahúzások is bekerülnek: track('huzas', 'Kirakás | Csillagjegy | Téma').
   A látogatás adatait egy véletlen, csak a memóriában élő azonosító köti össze (nem kerül se sütibe, se tárolóba,
   a következő oldalbetöltésnél új készül). Do Not Track esetén, botoknál és localhoston a mérés nem fut. */
(function () {
  var STATS_URL = "https://script.google.com/macros/s/AKfycbyC7QQ7GsJMK2zbpcwJ-tuandkbE5iZN35uJNoHITzT8pB_sGAhiWGIITeEix8l0-0/exec";

  function clean(s, n) {
    return String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").slice(0, n);
  }

  function enabled() {
    if (!STATS_URL || STATS_URL.indexOf("http") !== 0) return false;
    if (!location.hostname || location.hostname === "localhost" || location.hostname === "127.0.0.1") return false;
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return false;
    if (navigator.webdriver) return false;
    if (/bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit/i.test(navigator.userAgent || "")) return false;
    return true;
  }
  if (!enabled()) { window.track = function () {}; return; }

  function randomId() {
    var s = "";
    try {
      var a = new Uint8Array(10);
      crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    } catch (e) {
      for (var j = 0; j < 10; j++) s += Math.floor(Math.random() * 36).toString(36);
    }
    return s;
  }

  function source() {
    var q = new URLSearchParams(location.search);
    var s = q.get("src") || q.get("utm_source") || q.get("ref");
    if (s) return clean(s.toLowerCase(), 40);
    if (q.has("fbclid")) return "facebook";
    try {
      if (document.referrer) {
        var h = new URL(document.referrer).hostname.replace(/^www\./, "");
        if (h !== location.hostname.replace(/^www\./, "")) return clean(h, 40);
      }
    } catch (e) {}
    return "direkt";
  }

  var ID = randomId();
  var T0 = Date.now();
  var PAGE = clean(location.pathname.replace(/\.html$/, "") || "/", 80);
  var DEVICE = Math.min(screen.width || 9999, window.innerWidth || 9999) < 700 ? "mobil" : "gép";
  var LANG = clean((navigator.language || "").slice(0, 5), 5);
  var SRC = source();
  var draws = [];                 // [[az érkezés óta eltelt mp, "szöveg"], ...]
  var activeMs = 0;               // az oldal látható (előtérben lévő) ideje
  var shownAt = document.visibilityState === "hidden" ? null : Date.now();
  var left = false;               // a legutóbbi láthatatlanná válás óta ment-e már távozás-üzenet

  function elapsed() { return Math.round((Date.now() - T0) / 1000); }
  function active() { return Math.round((activeMs + (shownAt ? Date.now() - shownAt : 0)) / 1000); }

  function post(ev) {
    var data = JSON.stringify({
      v: 2, id: ID, ev: ev, p: PAGE, dv: DEVICE, s: SRC, l: LANG,
      e: elapsed(), a: active(), d: draws
    });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(STATS_URL, data)) return;
    } catch (e) {}
    try {
      fetch(STATS_URL, { method: "POST", body: data, mode: "no-cors", keepalive: true });
    } catch (e) {}
  }

  function leave() {
    if (left) return;
    left = true;
    if (shownAt) { activeMs += Date.now() - shownAt; shownAt = null; }
    post("tavozas");
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") leave();
    else { left = false; shownAt = Date.now(); }
  });
  window.addEventListener("pagehide", leave);

  window.track = function (ev, val) {
    if (ev !== "huzas" || draws.length >= 30) return;
    draws.push([elapsed(), clean(val, 80)]);
    post("huzas");
  };

  post("oldal");
})();
