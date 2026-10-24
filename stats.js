/* Névtelen oldalstatisztika – süti, azonosító és IP-cím nélkül.
   Beállítás: az alábbi STATS_URL helyére illeszd be a Google Apps Script webalkalmazás /exec végű címét.
   Használat másik oldalon: tedd be a </body> elé:  <script src="stats.js"></script>
   Eseményt így küldhetsz:  track('esemeny_neve', 'opcionális érték'); */
(function () {
  var STATS_URL = "https://script.google.com/macros/s/AKfycbwtmDVQHBGySneXFUEaU7zeyRJZn2wl1vypRQQzaSU2UuiuJY6DcdAAwChNFsc5xu7f/exec";

  function clean(s, n) {
    return String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").slice(0, n);
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

  function send(ev, val) {
    if (!STATS_URL || STATS_URL.indexOf("http") !== 0) return;
    if (!location.hostname || location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    if (navigator.doNotTrack === "1") return;
    var data = JSON.stringify({
      p: clean(location.pathname.replace(/\.html$/, "") || "/", 80),
      ev: clean(ev, 40),
      s: source(),
      r: (function () { try { return document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) { return ""; } })(),
      dv: Math.min(screen.width || 9999, window.innerWidth || 9999) < 700 ? "mobil" : "gép",
      l: clean((navigator.language || "").slice(0, 5), 5),
      v: clean(val, 80)
    });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(STATS_URL, data)) return;
    } catch (e) {}
    try {
      fetch(STATS_URL, { method: "POST", body: data, mode: "no-cors", keepalive: true });
    } catch (e) {}
  }

  window.track = send;
  send("oldal");
})();
