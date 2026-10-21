// Lélekfény gyertyafal — háttér (Google Apps Script)
//
// Mit csinál:
//  - a /gyertya oldal ide küldi a beküldött gyertyákat (doPost, "add"), és a "Én is gyújtok" kattintásokat ("light")
//  - a fal innen kéri le a JÓVÁHAGYOTT gyertyákat (doGet, "list")
//  - a bejegyzéseket a táblázatban jóváhagyod: az E oszlop jelölőnégyzete = megjelenhet a falon
//
// Beállítás: egyszer futtasd a setup() függvényt, aztán Üzembe helyezés > Új üzembe helyezés > Webalkalmazás
// (Futtatás: én, Hozzáférés: bárki). Az így kapott /exec végű URL kell az oldalnak.

var SHEET_ENTRIES = 'Beküldések';
var SHEET_LIGHTS = 'Fények';
var TZ = 'Europe/Budapest';

var MIN_TEXT = 5;
var MAX_TEXT = 300;
var MAX_ALIAS = 30;
var LIST_LIMIT = 100;        // ennyi (legfrissebb) jóváhagyott gyertya jelenik meg a falon
var ADD_PER_MINUTE = 6;      // összesen ennyi új beküldést fogadunk el percenként (spam ellen)
var LIGHT_PER_MINUTE = 60;   // és ennyi "Én is gyújtok" kattintást
var DEL_PER_MINUTE = 30;     // és ennyi törlést
var PENDING_CAP = 400;       // ennyi jóváhagyásra váró bejegyzés fölött nem fogadunk újat
var MIN_FILL_MS = 3000;      // ennél gyorsabban kitöltött űrlap robot

// Ugyanezek a szabályok vannak az oldalon is (a látogató így azonnal visszajelzést kap).
var RE_LINK = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|hu|net|org|ru|info|biz)\b)/i;
var RE_MAIL = /\S+@\S+/;
var RE_PHONE = /(\d[\s.\/-]*){9,}/;

// ---------------------------------------------------------------- tiszta (tesztelhető) függvények

function cleanText(s, max) {
  s = String(s == null ? '' : s);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '');
  s = s.replace(/[<>]/g, '');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  s = s.replace(/^[=+\-@\s]+/, '');   // a táblázat ne értelmezze képletnek
  s = s.trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

function forbiddenReason(text) {
  if (RE_LINK.test(text)) return 'link';
  if (RE_MAIL.test(text)) return 'mail';
  if (RE_PHONE.test(text)) return 'phone';
  return '';
}

function validateAdd(body) {
  if (!body || typeof body !== 'object') return { ok: false, err: 'bad' };
  if (body.hp) return { ok: false, err: 'bot' };
  if (!(Number(body.t) >= MIN_FILL_MS)) return { ok: false, err: 'bot' };
  var text = cleanText(body.text, MAX_TEXT);
  var alias = cleanText(body.alias, MAX_ALIAS);
  if (text.length < MIN_TEXT) return { ok: false, err: 'short' };
  if (forbiddenReason(text) || forbiddenReason(alias)) return { ok: false, err: 'forbidden' };
  var id = String(body.id || '');
  var tok = String(body.tok || '');
  if (id && !/^g[a-f0-9]{7}$/.test(id)) return { ok: false, err: 'bad' };
  if (tok && !/^t[a-f0-9]{16}$/.test(tok)) return { ok: false, err: 'bad' };
  return { ok: true, text: text, alias: alias, id: id, tok: tok };
}

// entries: [[id, időpont(Date), becenév, szöveg, jóváhagyva(true/false)], ...]
// lights:  [[id, ...], ...]
// fmt:     Date -> "2026. 10." szöveg
function buildList(entries, lights, limit, fmt) {
  var counts = {};
  for (var i = 0; i < lights.length; i++) {
    var lid = String(lights[i][0] || '');
    if (lid) counts[lid] = (counts[lid] || 0) + 1;
  }
  var approved = [];
  for (var j = 0; j < entries.length; j++) {
    var r = entries[j];
    if (r[4] === true && r[0] && r[3]) approved.push(r);
  }
  approved.sort(function (a, b) { return new Date(b[1]).getTime() - new Date(a[1]).getTime(); });
  return approved.slice(0, limit).map(function (r) {
    return { id: String(r[0]), alias: String(r[2] || ''), text: String(r[3]), ts: fmt(new Date(r[1])), n: 1 + (counts[String(r[0])] || 0) };
  });
}

function bumpCounter(cache, key, limit) {
  var n = Number(cache.get(key) || 0);
  if (n >= limit) return false;
  cache.put(key, String(n + 1), 90);
  return true;
}

// ---------------------------------------------------------------- Apps Script réteg

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var entries = ss.getSheetByName(SHEET_ENTRIES) || ss.insertSheet(SHEET_ENTRIES);
  entries.getRange(1, 1, 1, 7).setValues([['azonosító', 'időpont', 'becenév', 'szöveg', 'jóváhagyva', 'megjegyzés (nem látszik)', 'törlőkulcs (ne módosítsd)']]).setFontWeight('bold');
  entries.getRange('A2:A5000').setNumberFormat('@');
  entries.getRange('G2:G5000').setNumberFormat('@');
  entries.getRange('C2:D5000').setNumberFormat('@');
  entries.getRange('B2:B5000').setNumberFormat('yyyy.mm.dd hh:mm');
  entries.getRange('E2:E5000').insertCheckboxes();
  entries.setFrozenRows(1);
  entries.setColumnWidth(1, 90); entries.setColumnWidth(2, 130); entries.setColumnWidth(3, 130);
  entries.setColumnWidth(4, 520); entries.setColumnWidth(5, 90); entries.setColumnWidth(6, 220); entries.setColumnWidth(7, 180);
  entries.getRange('D2:D5000').setWrap(true).setVerticalAlignment('top');

  var lights = ss.getSheetByName(SHEET_LIGHTS) || ss.insertSheet(SHEET_LIGHTS);
  lights.getRange(1, 1, 1, 2).setValues([['azonosító', 'időpont']]).setFontWeight('bold');
  lights.getRange('A2:A100000').setNumberFormat('@');
  lights.getRange('B2:B100000').setNumberFormat('yyyy.mm.dd hh:mm');
  lights.setFrozenRows(1);

  var extra = ss.getSheetByName('Munkalap1') || ss.getSheetByName('Sheet1');
  if (extra && extra.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(extra);
  SpreadsheetApp.flush();
}

function deleteLights(ss, id) {
  var ls = ss.getSheetByName(SHEET_LIGHTS);
  var n = ls.getLastRow();
  if (n < 2) return;
  var rows = ls.getRange(2, 1, n - 1, 2).getValues();
  var keep = rows.filter(function (r) { return String(r[0]) !== id; });
  if (keep.length === rows.length) return;
  ls.getRange(2, 1, n - 1, 2).clearContent();
  if (keep.length) ls.getRange(2, 1, keep.length, 2).setValues(keep);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return out({ ok: false, err: 'busy' }); }
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var cache = CacheService.getScriptCache();
    var minute = Utilities.formatDate(new Date(), TZ, 'yyyyMMddHHmm');
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.a === 'add') {
      var v = validateAdd(body);
      if (!v.ok) return out(v);
      if (!bumpCounter(cache, 'add_' + minute, ADD_PER_MINUTE)) return out({ ok: false, err: 'rate' });
      var sh = ss.getSheetByName(SHEET_ENTRIES);
      var last = sh.getLastRow();
      if (last > 1) {
        var existing = sh.getRange(2, 1, last - 1, 7).getValues();
        var pending = 0;
        for (var i = 0; i < existing.length; i++) {
          if (existing[i][4] !== true) pending++;
          if (v.id && String(existing[i][0]) === v.id) {
            // ugyanaz a beküldés újra (pl. megszakadt kapcsolat után): nem hozunk létre másodikat
            return String(existing[i][6]) === v.tok ? out({ ok: true, dup: true }) : out({ ok: false, err: 'bad' });
          }
        }
        if (pending >= PENDING_CAP) return out({ ok: false, err: 'full' });
      }
      var id = v.id || ('g' + Utilities.getUuid().replace(/-/g, '').slice(0, 7));
      sh.appendRow([id, new Date(), v.alias, v.text, false, '', v.tok]);
      sh.getRange(sh.getLastRow(), 5).insertCheckboxes();
      cache.remove('list');
      return out({ ok: true });
    }

    if (body.a === 'light') {
      var lid = String(body.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
      if (!lid) return out({ ok: false, err: 'bad' });
      if (!bumpCounter(cache, 'light_' + minute, LIGHT_PER_MINUTE)) return out({ ok: false, err: 'rate' });
      var es = ss.getSheetByName(SHEET_ENTRIES);
      var n = es.getLastRow();
      if (n < 2) return out({ ok: false, err: 'bad' });
      var rows = es.getRange(2, 1, n - 1, 5).getValues();
      var found = false;
      for (var k = 0; k < rows.length; k++) if (String(rows[k][0]) === lid && rows[k][4] === true) { found = true; break; }
      if (!found) return out({ ok: false, err: 'bad' });
      ss.getSheetByName(SHEET_LIGHTS).appendRow([lid, new Date()]);
      return out({ ok: true });
    }

    if (body.a === 'del') {
      var did = String(body.id || '');
      var dtok = String(body.tok || '');
      if (!/^g[a-f0-9]{7}$/.test(did) || !/^t[a-f0-9]{16}$/.test(dtok)) return out({ ok: false, err: 'bad' });
      if (!bumpCounter(cache, 'del_' + minute, DEL_PER_MINUTE)) return out({ ok: false, err: 'rate' });
      var ds = ss.getSheetByName(SHEET_ENTRIES);
      var dn = ds.getLastRow();
      if (dn < 2) return out({ ok: false, err: 'bad' });
      var drows = ds.getRange(2, 1, dn - 1, 7).getValues();
      for (var r = 0; r < drows.length; r++) {
        if (String(drows[r][0]) === did) {
          if (String(drows[r][6]) !== dtok) return out({ ok: false, err: 'bad' });
          ds.deleteRow(r + 2);
          deleteLights(ss, did);
          cache.remove('list');
          return out({ ok: true });
        }
      }
      return out({ ok: false, err: 'bad' });
    }

    return out({ ok: false, err: 'bad' });
  } catch (err2) {
    return out({ ok: false, err: 'error' });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var a = e && e.parameter && e.parameter.a;
  if (a !== 'list') return out({ ok: true, service: 'gyertyafal' });
  var cache = CacheService.getScriptCache();
  var hit = cache.get('list');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var es = ss.getSheetByName(SHEET_ENTRIES);
  var ls = ss.getSheetByName(SHEET_LIGHTS);
  var entries = es.getLastRow() > 1 ? es.getRange(2, 1, es.getLastRow() - 1, 5).getValues() : [];
  var lights = ls.getLastRow() > 1 ? ls.getRange(2, 1, ls.getLastRow() - 1, 1).getValues() : [];
  var items = buildList(entries, lights, LIST_LIMIT, function (d) { return Utilities.formatDate(d, TZ, 'yyyy. MM.'); });
  var json = JSON.stringify({ ok: true, items: items });
  cache.put('list', json, 60);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
