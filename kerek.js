/* Lélekfény – szerelmi kerék. Öt másodpercig pörög, a szám véletlenszerű, az üzenet lejjebb van a hosszú oldalon. */
(function () {
  'use strict';
  var rot = document.getElementById('wheel-rot'), btn = document.getElementById('spin');
  if (!rot || !btn) return;
  var res = document.getElementById('wheel-result'), num = document.getElementById('wheel-n'), say = document.getElementById('wheel-say'),
      hint = document.getElementById('wheel-hint'), msgs = document.querySelectorAll('.msg');
  var CX = 160, CY = 176, SEG = 12;
  var ARTICLE = ['az 1.', 'a 2.', 'a 3.', 'a 4.', 'az 5.', 'a 6.', 'a 7.', 'a 8.', 'a 9.', 'a 10.', 'a 11.', 'a 12.'];
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var angle = 0, spinning = false, mine = 0, io = null, seenMine = false, hintT = 0;

  // egyenletes véletlen 0..n-1 (crypto, elutasításos mintavétel)
  function randInt(n) {
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) {
      var max = Math.floor(4294967296 / n) * n, a = new Uint32Array(1);
      do { c.getRandomValues(a); } while (a[0] >= max);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function setAngle(a) { rot.setAttribute('transform', 'rotate(' + a.toFixed(3) + ' ' + CX + ' ' + CY + ')'); }

  // a pörgés lefutása, összesen 5 mp: 0,4 mp gyorsulás, 3,1 mp egyenletes forgás, az utolsó 1,5 mp erős lassulás
  var T1 = 0.4, T2 = 3.5, T3 = 5.0, DEC = T3 - T2;
  function pos(t, V) {
    if (t <= 0) return 0;
    if (t < T1) return V * t * t / (2 * T1);
    if (t < T2) return V * T1 / 2 + V * (t - T1);
    if (t < T3) { var u = (t - T2) / DEC; return V * T1 / 2 + V * (T2 - T1) + V * DEC / 3 * (1 - Math.pow(1 - u, 3)); }
    return V * T1 / 2 + V * (T2 - T1) + V * DEC / 3;
  }

  function mark(n) {
    var i, el;
    for (i = 0; i < msgs.length; i++) {
      msgs[i].classList.remove('is-mine');
      var f = msgs[i].querySelector('.msg-flag'); if (f) f.hidden = true;
    }
    el = document.getElementById('uzenet-' + n);
    if (el) {
      el.classList.add('is-mine');
      var fl = el.querySelector('.msg-flag'); if (fl) fl.hidden = false;
    }
    mine = n; seenMine = false;
    if (io) io.disconnect();
    if ('IntersectionObserver' in window && el) {
      io = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) {
          if (e.isIntersecting && e.intersectionRatio >= 0.3) {
            seenMine = true;
            if (hint) hint.classList.remove('on');
            res.classList.add('seen');
            io.disconnect();
          }
        });
      }, { threshold: [0.3] });
      io.observe(el);
    }
  }

  function finish(n) {
    spinning = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = 'Pörgesd meg újra';
    num.textContent = n;
    say.textContent = 'Görgess le ' + ARTICLE[n - 1] + ' üzenetig.';
    res.hidden = false;
    res.style.visibility = '';
    res.classList.remove('seen');
    mark(n);
    if (hint) {
      hint.querySelector('span').textContent = 'Görgess lejjebb, ' + ARTICLE[n - 1] + ' üzenet vár';
      clearTimeout(hintT);
      hintT = setTimeout(function () { if (!seenMine) hint.classList.add('on'); }, 2500);
    }
    try { if (window.track) window.track('huzas', 'Szerelmi kerék | ' + n); } catch (e) { }
  }

  function spin() {
    if (spinning) return;
    var n = 1 + randInt(SEG), jitter = randInt(17) - 8;                      // a szám a szelet közepétől legfeljebb 8 fokkal tér el
    var want = -(((n - 0.5) * 30) + jitter);
    var delta = (((want - angle) % 360) + 360) % 360, A = delta + 360 * (5 + randInt(3));
    var V = A / (T1 / 2 + (T2 - T1) + DEC / 3);
    spinning = true;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    res.style.visibility = 'hidden';
    if (hint) { clearTimeout(hintT); hint.classList.remove('on'); }
    if (reduce) { angle += A; setAngle(angle); finish(n); return; }
    var start = null, from = angle;
    function frame(ts) {
      if (start === null) start = ts;
      var t = (ts - start) / 1000;
      setAngle(from + pos(t, V));
      if (t < T3) { requestAnimationFrame(frame); }
      else { angle = from + A; setAngle(angle); finish(n); }
    }
    requestAnimationFrame(frame);
  }
  btn.addEventListener('click', spin);
})();
