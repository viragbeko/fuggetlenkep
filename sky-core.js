/* Lélekfény – égbolt-számolás (Budapestre). Az astronomy-engine könyvtárra épül (MIT licenc).
   Böngészőben és Node-ban is fut, a tesztek ugyanezt a fájlt használják. */
(function (root) {
  'use strict';
  var A = root.Astronomy;
  if (!A && typeof require === 'function') A = require('astronomy-engine');
  if (!A) return;   // a könyvtár nem töltődött be, az oldalak ilyenkor csak az előre megírt szöveget mutatják

  var TZ = 'Europe/Budapest';
  var OBS = new A.Observer(47.4979, 19.0402, 110);
  var SIGN = ['Kos', 'Bika', 'Ikrek', 'Rák', 'Oroszlán', 'Szűz', 'Mérleg', 'Skorpió', 'Nyilas', 'Bak', 'Vízöntő', 'Halak'];
  var SIGN_IN = ['Kosban', 'Bikában', 'Ikrekben', 'Rákban', 'Oroszlánban', 'Szűzben', 'Mérlegben', 'Skorpióban', 'Nyilasban', 'Bakban', 'Vízöntőben', 'Halakban'];
  var SIGN_INTO = ['Kosba', 'Bikába', 'Ikrekbe', 'Rákba', 'Oroszlánba', 'Szűzbe', 'Mérlegbe', 'Skorpióba', 'Nyilasba', 'Bakba', 'Vízöntőbe', 'Halakba'];
  var SIGN_SLUG = ['kos', 'bika', 'ikrek', 'rak', 'oroszlan', 'szuz', 'merleg', 'skorpio', 'nyilas', 'bak', 'vizonto', 'halak'];
  var MONTH = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  var WDAY = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  var DIRS = ['északon', 'északkeleten', 'keleten', 'délkeleten', 'délen', 'délnyugaton', 'nyugaton', 'északnyugaton'];
  var PHASE_NAME = ['Újhold', 'Növő sarló', 'Első negyed', 'Növő hold', 'Telihold', 'Fogyó hold', 'Utolsó negyed', 'Fogyó sarló'];
  // id az astronomy-engine-ben, magyar név, szabad szemmel látható-e, melyik "visszafelé járó" szöveg tartozik hozzá
  var PLANETS = [
    { id: 'Mercury', hu: 'Merkúr', eye: true, retro: 'Merkúr' },
    { id: 'Venus', hu: 'Vénusz', eye: true, retro: 'Vénusz' },
    { id: 'Mars', hu: 'Mars', eye: true, retro: 'Mars' },
    { id: 'Jupiter', hu: 'Jupiter', eye: true, retro: 'Külső' },
    { id: 'Saturn', hu: 'Szaturnusz', eye: true, retro: 'Külső' },
    { id: 'Uranus', hu: 'Uránusz', eye: false, retro: 'Külső' },
    { id: 'Neptune', hu: 'Neptunusz', eye: false, retro: 'Külső' },
    { id: 'Pluto', hu: 'Plútó', eye: false, retro: 'Külső' }
  ];

  // ---- időzóna: Europe/Budapest, az Intl-ből (a nyári időszámítás váltását is kezeli)
  var fmt = null;
  function parts(date) {
    if (!fmt) fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var o = {}, ps = fmt.formatToParts(date), i;
    for (i = 0; i < ps.length; i++) if (ps[i].type !== 'literal') o[ps[i].type] = parseInt(ps[i].value, 10);
    if (o.hour === 24) o.hour = 0;
    return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
  }
  function offsetMs(date) {
    var p = parts(date);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
  }
  // budapesti fali idő -> Date
  function local(y, m, d, h, mi) {
    var guess = new Date(Date.UTC(y, m - 1, d, h, mi));
    var off = offsetMs(guess), r = new Date(guess.getTime() - off), off2 = offsetMs(r);
    if (off2 !== off) r = new Date(guess.getTime() - off2);
    return r;
  }
  function dayNumber(p) { return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 864e5); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(date) { var p = parts(date); return pad(p.h) + ':' + pad(p.mi); }
  function fmtDate(date) { var p = parts(date), wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); return p.y + '. ' + MONTH[p.m - 1] + ' ' + p.d + '., ' + WDAY[wd]; }
  function fmtShort(date) { var p = parts(date), wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); return MONTH[p.m - 1] + ' ' + p.d + '., ' + WDAY[wd]; }
  function relDay(date, now) {
    var n = dayNumber(parts(date)) - dayNumber(parts(now));
    if (n === 0) return 'ma';
    if (n === 1) return 'holnap';
    if (n === 2) return 'holnapután';
    return n + ' nap múlva';
  }

  // ---- csillagászat
  function norm(x) { return ((x % 360) + 360) % 360; }
  function signIndex(lon) { return Math.floor(norm(lon) / 30); }
  function lonOf(id, date) {
    if (id === 'Moon') return A.EclipticGeoMoon(date).lon;
    if (id === 'Sun') return A.SunPosition(date).elon;
    return A.Ecliptic(A.GeoVector(A.Body[id], date, true)).elon;
  }
  function isRetro(id, date) {
    var a = lonOf(id, new Date(date.getTime() - 432e5)), b = lonOf(id, new Date(date.getTime() + 432e5));
    return ((b - a + 540) % 360) - 180 < 0;
  }
  function phaseIndex(p) {
    if (p < 12 || p >= 348) return 0;
    if (p < 82) return 1;
    if (p < 98) return 2;
    if (p < 168) return 3;
    if (p < 192) return 4;
    if (p < 262) return 5;
    if (p < 278) return 6;
    return 7;
  }
  function moonInfo(date) {
    var phase = A.MoonPhase(date), lon = A.EclipticGeoMoon(date).lon, si = signIndex(lon), ingress = null, h, t, lo, hi, k, mid;
    for (h = 1; h <= 80 && !ingress; h++) {
      t = new Date(date.getTime() + h * 36e5);
      if (signIndex(A.EclipticGeoMoon(t).lon) !== si) {
        lo = new Date(t.getTime() - 36e5); hi = t;
        for (k = 0; k < 14; k++) {
          mid = new Date((lo.getTime() + hi.getTime()) / 2);
          if (signIndex(A.EclipticGeoMoon(mid).lon) === si) lo = mid; else hi = mid;
        }
        ingress = hi;
      }
    }
    var nf = A.SearchMoonPhase(180, date, 40), nn = A.SearchMoonPhase(0, date, 40);
    return {
      phase: phase, phaseIndex: phaseIndex(phase), illum: A.Illumination(A.Body.Moon, date).phase_fraction,
      lon: lon, sign: si, ingress: ingress, ingressSign: (si + 1) % 12,
      nextFull: nf ? nf.date : null, nextNew: nn ? nn.date : null
    };
  }
  function altaz(id, date) {
    var eq = A.Equator(A.Body[id], date, OBS, true, false);
    return A.Horizon(date, OBS, eq.ra, eq.dec, 'normal');
  }
  function dirName(az) { return DIRS[Math.round(norm(az) / 45) % 8]; }

  // melyik bolygó látszik a mai estén és éjjelen (déltől másnap délig), Budapestről
  // látszik = legalább 5 fokkal a horizont fölött, miközben a Nap legalább 6 fokkal alatta van
  function visibility(date) {
    var p = parts(date), start = local(p.y, p.m, p.d, 12, 0), STEP = 900e3, N = 96, i;
    var times = [], dark = [];
    for (i = 0; i <= N; i++) {
      var t = new Date(start.getTime() + i * STEP);
      times.push(t);
      var eqs = A.Equator(A.Body.Sun, t, OBS, true, false);
      dark.push(A.Horizon(t, OBS, eqs.ra, eqs.dec, 'normal').altitude <= -6);
    }
    var out = {};
    PLANETS.forEach(function (pl) {
      if (!pl.eye) return;
      var best = null, cur = null;
      for (i = 0; i <= N; i++) {
        var hz = altaz(pl.id, times[i]), ok = dark[i] && hz.altitude >= 5;
        if (ok) {
          if (!cur) cur = { from: times[i], to: times[i], peak: hz.altitude, az: hz.azimuth, peakTime: times[i], n: 0 };
          cur.to = times[i]; cur.n++;
          if (hz.altitude > cur.peak) { cur.peak = hz.altitude; cur.az = hz.azimuth; cur.peakTime = times[i]; }
        } else if (cur) { if (!best || cur.n > best.n) best = cur; cur = null; }
      }
      if (cur && (!best || cur.n > best.n)) best = cur;
      out[pl.id] = best ? { visible: true, from: best.from, to: best.to, peak: Math.round(best.peak), dir: dirName(best.az), peakTime: best.peakTime } : { visible: false };
    });
    return out;
  }

  function report(now) {
    now = now || new Date();
    var p = parts(now), dn = dayNumber(p), planets = [], vis = visibility(now);
    PLANETS.forEach(function (pl) {
      var lon = lonOf(pl.id, now);
      planets.push({ id: pl.id, hu: pl.hu, eye: pl.eye, retroKey: pl.retro, lon: lon, sign: signIndex(lon), retro: isRetro(pl.id, now), vis: vis[pl.id] || null });
    });
    var sunLon = lonOf('Sun', now);
    return {
      now: now, parts: p, dayNumber: dn,
      weekIndex: Math.floor((dn + 3) / 7),
      cardIndex: ((dn * 4 + 5) % 21 + 21) % 21,
      moon: moonInfo(now),
      sun: { lon: sunLon, sign: signIndex(sunLon) },
      planets: planets
    };
  }

  root.LFSky = {
    SIGN: SIGN, SIGN_IN: SIGN_IN, SIGN_INTO: SIGN_INTO, SIGN_SLUG: SIGN_SLUG, PLANETS: PLANETS, PHASE_NAME: PHASE_NAME,
    report: report, parts: parts, local: local, dayNumber: dayNumber, fmtTime: fmtTime, fmtDate: fmtDate, fmtShort: fmtShort, relDay: relDay,
    signIndex: signIndex, lonOf: lonOf, isRetro: isRetro, phaseIndex: phaseIndex, moonInfo: moonInfo, visibility: visibility
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LFSky;
})(typeof window !== 'undefined' ? window : globalThis);
