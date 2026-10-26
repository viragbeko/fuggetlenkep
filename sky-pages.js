/* Lélekfény – az Égbolt és a Ma oldal kijelzése. A számolás a sky-core.js-ben van, a szövegek az oldalba ágyazott JSON-ból jönnek. */
(function () {
  'use strict';
  var dataEl = document.getElementById('sky-data');
  var live = document.getElementById('sky-live');      // Égbolt oldal
  var maSky = document.getElementById('ma-sky');       // Ma oldal
  if (!dataEl || (!live && !maSky)) return;
  var D = JSON.parse(dataEl.textContent);
  var S = window.LFSky;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fail(el) {
    el.innerHTML = '<p class="meta">Az égbolt számolása most nem indult el, ezért csak az előre megírt szövegek olvashatók lent. Frissítsd az oldalt, vagy próbáld meg egy másik böngészővel.</p>';
  }

  function moonSvg(p, pct) {
    var r = 40, rx = Math.abs(Math.cos(p * Math.PI / 180)) * r, d = '';
    if (p > 1 && p < 179) d = 'M50 10 A40 40 0 0 1 50 90 A' + rx.toFixed(2) + ' 40 0 0 ' + (p < 90 ? 0 : 1) + ' 50 10 Z';
    else if (p >= 179 && p <= 181) d = 'M50 10 A40 40 0 0 1 50 90 A40 40 0 0 1 50 10 Z';
    else if (p > 181 && p < 359) d = 'M50 10 A40 40 0 0 0 50 90 A' + rx.toFixed(2) + ' 40 0 0 ' + (p > 270 ? 1 : 0) + ' 50 10 Z';
    return '<svg class="moon" viewBox="0 0 100 100" role="img" aria-label="A Hold mostani fázisa, ' + pct + '% megvilágítva">' +
      '<circle cx="50" cy="50" r="40" fill="#0D1424" stroke="#FFE2A8" stroke-opacity=".35" stroke-width="1.5"/>' +
      (d ? '<path d="' + d + '" fill="#FFE2A8"/>' : '') + '</svg>';
  }

  function partOf(date) { var h = S.parts(date).h; return h >= 12 ? 'este' : (h < 5 ? 'éjjel' : 'hajnalban'); }
  function whenPhrase(v) {
    var a = partOf(v.from), b = partOf(v.to);
    return a === b ? a : a + ' és ' + b;
  }
  function visLine(pl) {
    var v = pl.vis;
    if (!v) return '';
    if (!v.visible) return 'Ma este és éjjel nem látszik Budapestről.';
    return 'Látszik ' + whenPhrase(v) + ', nagyjából ' + S.fmtTime(v.from) + ' és ' + S.fmtTime(v.to) + ' között, legmagasabban ' + S.fmtTime(v.peakTime) + ' körül, ' + v.dir + ', ' + v.peak + ' fokkal a horizont fölött.';
  }

  function retroBlocks(r) {
    var keys = [], i, out = '';
    for (i = 0; i < r.planets.length; i++) if (r.planets[i].retro && keys.indexOf(r.planets[i].retroKey) < 0) keys.push(r.planets[i].retroKey);
    for (i = 0; i < keys.length; i++) out += '<p>' + D.retro[keys[i]] + '</p>';
    return out;
  }
  function retroNames(r) {
    var n = [], i;
    for (i = 0; i < r.planets.length; i++) if (r.planets[i].retro) n.push(r.planets[i].hu);
    return n;
  }
  function joinHu(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' és ' + a[a.length - 1]; }

  setTimeout(run, 0);
  function run() {
  var r;
  try {
    if (!S || !window.Astronomy) throw new Error('nincs számoló');
    r = S.report(new Date());
  } catch (e) {
    if (live) fail(live);
    if (maSky) fail(maSky);
    return;
  }
  var m = r.moon, pct = Math.round(m.illum * 100);

  // ---------- Égbolt oldal
  if (live) {
    var cards = '<h2>Ma, ' + esc(S.fmtDate(r.now)) + '</h2>' +
      '<div class="cards3">' +
      '<div class="icard icard--moon">' + moonSvg(m.phase, pct) + '<p class="big">' + esc(S.PHASE_NAME[m.phaseIndex]) + '</p><p>A Hold ' + pct + '%-a világít.</p></div>' +
      '<div class="icard"><h3>A Hold jegye</h3><p class="big">' + esc(S.SIGN[m.sign]) + '</p><p>A Hold ' + esc(S.SIGN_IN[m.sign]) + ' jár, és ' + esc(S.relDay(m.ingress, r.now)) + ' ' + esc(S.fmtTime(m.ingress)) + '-kor lép ' + esc(S.SIGN_INTO[m.ingressSign]) + '.</p></div>' +
      '<div class="icard"><h3>A következő fázisok</h3><p><strong>Telihold</strong> ' + esc(S.fmtShort(m.nextFull)) + ', ' + esc(S.fmtTime(m.nextFull)) + ' (' + esc(S.relDay(m.nextFull, r.now)) + ')</p><p><strong>Újhold</strong> ' + esc(S.fmtShort(m.nextNew)) + ', ' + esc(S.fmtTime(m.nextNew)) + ' (' + esc(S.relDay(m.nextNew, r.now)) + ')</p></div>' +
      '</div>' +
      '<div class="prose"><p>' + D.moonSign[m.sign].x + '</p><p>' + D.phase[m.phaseIndex].x + '</p></div>' +
      '<p class="meta">Az időpontok budapesti idő szerint értendők, a látható fények is Budapestről nézve.</p>';
    live.innerHTML = cards;

    var pl = document.getElementById('sky-planets');
    if (pl) {
      var rows = '<li><strong>Nap</strong> ' + esc(S.SIGN_IN[r.sun.sign]) + ' jár.</li>' +
        '<li><strong>Hold</strong> ' + esc(S.SIGN_IN[m.sign]) + ' jár.</li>';
      r.planets.forEach(function (p) {
        rows += '<li><strong>' + esc(p.hu) + '</strong> ' + esc(S.SIGN_IN[p.sign]) + ' jár, ' + (p.retro ? '<span class="retro">visszafelé halad</span>' : 'előre halad') + '.' +
          (p.vis ? '<span class="vis">' + esc(visLine(p)) + '</span>' : '') + '</li>';
      });
      pl.innerHTML = rows;
    }
    var rt = document.getElementById('sky-retro');
    if (rt) {
      var names = retroNames(r);
      rt.innerHTML = names.length
        ? '<p><strong>Ma visszafelé jár ' + esc(joinHu(names)) + '.</strong> <a href="#visszafele">Mit jelent ez?</a></p>'
        : '<p><strong>A Merkúr, a Vénusz és a Mars ma előre jár, és a külső bolygók közül sem jár egyik sem visszafelé.</strong></p>';
    }
    // a mai jegy és a mai fázis kiemelése a hosszú listákban
    var a = document.getElementById('holdjegy-' + m.sign), b = document.getElementById('fazis-' + m.phaseIndex);
    [a, b].forEach(function (el) { if (el) { el.classList.add('now'); el.insertAdjacentHTML('afterbegin', '<span class="badge">Ma</span> '); } });
  }

  // ---------- Ma oldal
  if (maSky) {
    var lead = document.getElementById('ma-date');
    if (lead) lead.textContent = S.fmtDate(r.now) + ', a Hold ' + S.SIGN_IN[m.sign] + ' jár.';
    var names2 = retroNames(r), seen = [], vis = [];
    r.planets.forEach(function (p) { if (p.vis && p.vis.visible) vis.push(p.hu + ' (' + whenPhrase(p.vis) + ', ' + S.fmtTime(p.vis.from) + ' és ' + S.fmtTime(p.vis.to) + ' között, ' + p.vis.dir + ')'); });
    maSky.innerHTML =
      '<div class="skyrow"><div class="icard icard--moon">' + moonSvg(m.phase, pct) + '<p class="big">' + esc(S.PHASE_NAME[m.phaseIndex]) + '</p><p>A Hold ' + pct + '%-a világít.</p></div>' +
      '<div class="prose"><p>' + D.moonSign[m.sign].x + '</p><p>' + D.phase[m.phaseIndex].x + '</p></div></div>' +
      '<div class="prose">' +
      (names2.length ? '<p><strong>Ma visszafelé jár ' + esc(joinHu(names2)) + '.</strong></p>' + retroBlocks(r) : '') +
      '<p><strong>' + (vis.length ? 'Ma este és éjjel látszik Budapestről ' + esc(joinHu(vis)) + '.' : 'Ma este és éjjel a szabad szemmel látható bolygók közül egyik sem látszik jól Budapestről.') + '</strong></p>' +
      '<p><a href="/egbolt">Az egész mai égbolt</a></p></div>';

    // a mai tarot lap (mindenkinek ugyanaz aznap)
    var card = D.cards[r.cardIndex], box = document.getElementById('ma-lap');
    if (box && card) {
      var q = (card.l ? '<span class="lbl">' + esc(card.l) + '</span>' : '') + esc(card.q);
      box.innerHTML = '<img src="/' + esc(card.k) + '.webp" width="330" height="554" alt="' + esc(card.name) + ' tarot lap" loading="lazy">' +
        '<div><p class="meta">' + esc(card.num) + '. lap</p><h3>' + esc(card.name) + '</h3>' +
        '<h4>Mit jelent valójában?</h4><p>' + esc(card.a) + '</p><h4>Hogyan segít dönteni?</h4><p>' + esc(card.b) + '</p><blockquote class="verse"><p>' + q + '</p></blockquote></div>';
      box.hidden = false;
    }
    // heti gondolat
    var wk = document.getElementById('ma-heti');
    if (wk && D.weekly.length) wk.textContent = D.weekly[((r.weekIndex % D.weekly.length) + D.weekly.length) % D.weekly.length];
  }
  }
})();
