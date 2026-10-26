/* Szerelmi szív jóslás: két fa szívkő feldobása. A szívkőnek van egy világos fa (felfelé néző) és egy piros, domború (lefelé néző) oldala.
   Mindkettő felfelé néz: Igen. Mindkettő lefelé néz: Nem. Egyik fel, másik le: a kérdésre nem sikerült választ találni, tedd fel újra pontosabban.
   A kimenetelt a böngésző véletlenszám-generátora dönti el (crypto), az animáció ehhez a kimeneteleshez igazodik.
   A várakozás számít: az oldal megnyitása vagy az előző dobás óta eltelt idő szerint változik az esély.
   10 mp alatt csak a bizonytalan válasz jön, 10 és 60 mp között igen, nem és bizonytalan egyforma eséllyel, 60 mp fölött csak igen vagy nem. */
(function () {
  var stage = document.getElementById("szivko");
  var btn = document.getElementById("dobas");
  var out = document.getElementById("dobas-eredmeny");
  var dataEl = document.getElementById("szj-szoveg");
  if (!stage || !btn || !out || !dataEl) return;
  var T = JSON.parse(dataEl.textContent);
  var blocks = [stage.querySelector(".szb--l"), stage.querySelector(".szb--r")];
  var G = 12.5;                                   // nehézségi gyorsulás, a szívkő szélességében mérve (W/mp²)
  var cur = null, running = false, raf = 0, t0 = 0, shown = false, since = Date.now();

  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function cryptoRnd() { try { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return Math.random(); } }

  function pick(sec) {                            // a várakozás (mp) szerinti kimenetel
    var r = cryptoRnd();
    if (sec < 10) return "ujra";
    if (sec <= 60) return r < 1 / 3 ? "igen" : (r < 2 / 3 ? "nem" : "ujra");
    return r < 0.5 ? "igen" : "nem";
  }
  function orient(res) {                          // melyik szív néz felfelé; vegyes eredménynél véletlen, melyik
    if (res === "igen") return [true, true];
    if (res === "nem") return [false, false];
    return cryptoRnd() < 0.5 ? [true, false] : [false, true];
  }

  function plan(i, up, rnd) {
    var s = i ? 1 : -1;
    var tL = 0.74 + rnd() * 0.14;                // az első földetérésig
    var h0 = 0.15;
    var v0 = (0.5 * G * tL * tL - h0) / tL;
    var e = 0.33 + rnd() * 0.07;
    var bounces = [], t = tL, v = (G * tL - v0) * e;
    for (var k = 0; k < 3 && v > 0.5; k++) { var d = 2 * v / G; bounces.push([t, d, v * v / (2 * G)]); t += d; v *= e + 0.05; }
    var turns = (rnd() < 0.5 ? 2 : 3) * (rnd() < 0.5 ? 1 : -1);
    var rzL = (rnd() - 0.5) * 120 + s * 10;
    return {
      s: s, up: up, tL: tL, h0: h0, v0: v0, bounces: bounces, tEnd: t + 0.45,
      theta: (up ? 0 : 180) + 360 * turns,
      x0: s * (0.55 + rnd() * 0.1), y0: 1.0, xL: s * (0.66 + rnd() * 0.14), yL: -0.15 + (rnd() - 0.5) * 0.45,
      dx: s * (0.04 + rnd() * 0.05), dy: -0.05 - rnd() * 0.05,
      rz0: (rnd() - 0.5) * 70, rzL: rzL, ryDir: rnd() < 0.5 ? 1 : -1,
      rest: up ? 0.17 : 0.085, tilt: up ? (rnd() < 0.5 ? 1 : -1) * (4 + rnd() * 4) : 0, wob: up ? 13 : 4
    };
  }

  function state(p, t) {
    var h = 0, x, y, rx, ry, rz, q, f, dt;
    if (t < p.tL) {
      q = t / p.tL; f = 1 - Math.pow(1 - q, 1.7);
      h = p.h0 + p.v0 * t - 0.5 * G * t * t;
      x = p.x0 + (p.xL - p.x0) * q; y = p.y0 + (p.yL - p.y0) * q;
      rx = p.theta * f; ry = 38 * Math.sin(2 * Math.PI * q) * (1 - q) * p.ryDir; rz = p.rz0 + (p.rzL - p.rz0) * f;
    } else {
      dt = t - p.tL; f = 1 - Math.exp(-6 * dt);
      for (var k = 0; k < p.bounces.length; k++) { var b = p.bounces[k]; if (t >= b[0] && t < b[0] + b[1]) { var u = (t - b[0]) / b[1]; h = 4 * b[2] * u * (1 - u); } }
      x = p.xL + p.dx * f; y = p.yL + p.dy * f;
      rx = p.theta + p.wob * Math.exp(-7 * dt) * Math.cos(20 * dt);
      ry = p.tilt * (1 - Math.exp(-9 * dt)) + 4 * Math.exp(-6 * dt) * Math.sin(16 * dt) * p.ryDir; rz = p.rzL;
    }
    return { h: Math.max(0, h), x: x, y: y, rx: rx, ry: ry, rz: rz };
  }

  function apply(t) {
    if (!cur) return;
    for (var i = 0; i < 2; i++) {
      var p = cur.p[i], st = state(p, Math.min(t, p.tEnd)), W = cur.W, b = blocks[i];
      var H = p.rest + st.h;
      b.style.transform = "translate3d(" + (st.x * W).toFixed(1) + "px," + (st.y * W).toFixed(1) + "px,0)";
      b.querySelector(".fly").style.transform = "translateZ(" + (H * W).toFixed(1) + "px) rotateZ(" + st.rz.toFixed(1) + "deg) rotateX(" + st.rx.toFixed(1) + "deg) rotateY(" + st.ry.toFixed(1) + "deg)";
      var sh = b.querySelector(".szs");
      sh.style.transform = "translate(" + (H * W * 0.2).toFixed(1) + "px," + (H * W * 0.16).toFixed(1) + "px) scale(" + (1 + H * 0.3).toFixed(3) + ")";
      sh.style.opacity = (0.62 / (1 + H * 2.4)).toFixed(3);
    }
  }

  function start(upL, upR, seed) {
    var rnd = seed == null ? cryptoRnd : mulberry(seed);
    cur = { W: blocks[0].offsetWidth || 90, p: [plan(0, upL, rnd), plan(1, upR, rnd)] };
    cur.tEnd = Math.max(cur.p[0].tEnd, cur.p[1].tEnd);
    cur.tShow = Math.max.apply(null, cur.p.map(function (p) { var b = p.bounces[p.bounces.length - 1]; return (b ? b[0] + b[1] : p.tL) + 0.12; }));
    cur.res = upL && upR ? "igen" : (!upL && !upR ? "nem" : "ujra");
    return cur;
  }

  function show() {
    shown = true; var r = cur.res;
    out.hidden = false; out.classList.remove("szj-var");
    out.querySelector(".szj-cap").textContent = T.cap[r];
    out.querySelector(".szj-valasz").textContent = T.valasz[r];
    out.className = "szj-eredmeny szj-" + r;
    out.style.animation = "none"; void out.offsetWidth; out.style.animation = "";
    btn.textContent = T.ujra;
    try { if (window.track) window.track("huzas", "Szerelmi szív jóslás | " + T.valasz[r]); } catch (e) { }
  }

  function done() { running = false; btn.disabled = false; if (!shown) show(); }

  function toss() {
    if (running) return;
    running = true; shown = false; btn.disabled = true;
    if (!out.hidden) out.classList.add("szj-var");      // az előző eredmény helye megmarad, a gomb nem ugrál
    var o = orient(pick((Date.now() - since) / 1000)); since = Date.now();
    start(o[0], o[1], null);
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { apply(Infinity); done(); return; }
    t0 = 0;
    (function step(ts) {
      if (!t0) t0 = ts;
      var t = (ts - t0) / 1000;
      apply(t);
      if (!shown && t >= cur.tShow) show();
      if (t >= cur.tEnd) { apply(cur.tEnd); done(); return; }
      raf = requestAnimationFrame(step);
    })(performance.now());
  }

  start(true, true, 11); apply(Infinity);          // nyugalmi állapot betöltéskor: két szív, világos oldalukkal felfelé
  window.addEventListener("resize", function () { if (!cur || running) return; cur.W = blocks[0].offsetWidth || cur.W; apply(Infinity); });
  btn.addEventListener("click", toss);
  window.szivko = { pick: pick, start: start, at: function (t) { apply(t); return cur; }, show: function () { if (cur) show(); } };
})();
