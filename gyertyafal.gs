// Lélekfény gyertyafal — háttér (Google Apps Script)
//
// Mit csinál:
//  - a /gyertya oldal ide küldi a beküldött gyertyákat (doPost, "add"), és a "Én is gyújtok" kattintásokat ("light")
//  - a fal innen kéri le a JÓVÁHAGYOTT gyertyákat (doGet, "list")
//  - a bejegyzéseket a táblázatban jóváhagyod: az F oszlop jelölőnégyzete = megjelenhet a falon
//  - ha valaki a "Gyertyám törlése" gombbal törli a gyertyáját, az A oszlopba "igen" kerül, a sor pirosra színeződik,
//    és a gyertya azonnal eltűnik a faláról. A sort te törölheted a táblázatból, amikor ráérsz.
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

// Beküldések lap oszlopai (1-től): törlendő | azonosító | időpont | becenév | szöveg | jóváhagyva | megjegyzés | törlőkulcs
var C_DEL = 1, C_ID = 2, C_TS = 3, C_ALIAS = 4, C_TEXT = 5, C_OK = 6, C_NOTE = 7, C_TOK = 8, NCOLS = 8;
var MAXR = 5000;

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

// entries: [[törlendő, id, időpont(Date), becenév, szöveg, jóváhagyva(true/false)], ...]
// lights:  [[id, ...], ...]
// fmt:     Date -> "2026. 10." szöveg
function isDeleted(v) { return String(v == null ? '' : v).trim().toLowerCase() === 'igen'; }

function buildList(entries, lights, limit, fmt) {
  var counts = {};
  for (var i = 0; i < lights.length; i++) {
    var lid = String(lights[i][0] || '');
    if (lid) counts[lid] = (counts[lid] || 0) + 1;
  }
  var approved = [];
  for (var j = 0; j < entries.length; j++) {
    var r = entries[j];
    if (r[5] === true && r[1] && r[4] && !isDeleted(r[0])) approved.push(r);
  }
  approved.sort(function (a, b) { return new Date(b[2]).getTime() - new Date(a[2]).getTime(); });
  return approved.slice(0, limit).map(function (r) {
    return { id: String(r[1]), alias: String(r[3] || ''), text: String(r[4]), ts: fmt(new Date(r[2])), n: 1 + (counts[String(r[1])] || 0) };
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

// Az utolsó ténylegesen kitöltött sor az azonosító oszlop alapján. A getLastRow() nem jó erre:
// az előre kitett jelölőnégyzetek is "tartalomnak" számítanak, és ezért a végére (5000. sor) mutatna.
function lastDataRow(sh) {
  var top = sh.getLastRow();
  if (top < 2) return 1;
  var ids = sh.getRange(2, C_ID, top - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] !== '' && ids[i][0] != null) return i + 2;
  }
  return 1;
}

function readEntries(sh, n) {
  return n > 1 ? sh.getRange(2, 1, n - 1, NCOLS).getValues() : [];
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var entries = ss.getSheetByName(SHEET_ENTRIES) || ss.insertSheet(SHEET_ENTRIES);
  // régi elrendezés (az A oszlopban az azonosító van): beszúrjuk elé a "törlendő" oszlopot
  if (String(entries.getRange(1, 1).getValue()) === 'azonosító') entries.insertColumnBefore(1);
  if (entries.getMaxRows() < MAXR) entries.insertRowsAfter(entries.getMaxRows(), MAXR - entries.getMaxRows());
  var n = lastDataRow(entries);

  entries.getRange(1, 1, 1, NCOLS).setValues([['törlendő', 'azonosító', 'időpont', 'becenév', 'szöveg', 'jóváhagyva', 'megjegyzés (nem látszik)', 'törlőkulcs (ne módosítsd)']]).setFontWeight('bold');
  entries.getRange(2, C_DEL, MAXR - 1, 2).setNumberFormat('@');          // A:B szöveg
  entries.getRange(2, C_TS, MAXR - 1, 1).setNumberFormat('yyyy.mm.dd hh:mm');
  entries.getRange(2, C_ALIAS, MAXR - 1, 2).setNumberFormat('@');       // D:E szöveg
  entries.getRange(2, C_TOK, MAXR - 1, 1).setNumberFormat('@');
  // az üres sorokból kitakarítjuk a korábbi, előre kitett jelölőnégyzetek FALSE értékét, majd a jelölőnégyzet-szabályt
  // úgy tesszük fel, hogy a meglévő jóváhagyások megmaradjanak
  if (n < MAXR) entries.getRange(n + 1, C_OK, MAXR - n, 1).clearContent();
  entries.getRange(2, C_OK, MAXR - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  entries.setFrozenRows(1);
  entries.setColumnWidth(C_DEL, 80); entries.setColumnWidth(C_ID, 90); entries.setColumnWidth(C_TS, 130); entries.setColumnWidth(C_ALIAS, 130);
  entries.setColumnWidth(C_TEXT, 520); entries.setColumnWidth(C_OK, 90); entries.setColumnWidth(C_NOTE, 220); entries.setColumnWidth(C_TOK, 180);
  entries.getRange(2, C_TEXT, MAXR - 1, 1).setWrap(true).setVerticalAlignment('top');
  // a törlésre kijelölt sor piros
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=LOWER($A2)="igen"').setBackground('#F4C7C3')
    .setRanges([entries.getRange(2, 1, MAXR - 1, NCOLS)]).build();
  entries.setConditionalFormatRules([rule]);

  var lights = ss.getSheetByName(SHEET_LIGHTS) || ss.insertSheet(SHEET_LIGHTS);
  lights.getRange(1, 1, 1, 2).setValues([['azonosító', 'időpont']]).setFontWeight('bold');
  lights.getRange('A2:A100000').setNumberFormat('@');
  lights.getRange('B2:B100000').setNumberFormat('yyyy.mm.dd hh:mm');
  lights.setFrozenRows(1);

  var extra = ss.getSheetByName('Munkalap1') || ss.getSheetByName('Sheet1');
  if (extra && extra.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(extra);
  SpreadsheetApp.flush();
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
      var n = lastDataRow(sh);
      var existing = readEntries(sh, n);
      var pending = 0;
      for (var i = 0; i < existing.length; i++) {
        if (existing[i][C_OK - 1] !== true && !isDeleted(existing[i][C_DEL - 1])) pending++;
        if (v.id && String(existing[i][C_ID - 1]) === v.id) {
          // ugyanaz a beküldés újra (pl. megszakadt kapcsolat után): nem hozunk létre másodikat
          return String(existing[i][C_TOK - 1]) === v.tok ? out({ ok: true, dup: true }) : out({ ok: false, err: 'bad' });
        }
      }
      if (pending >= PENDING_CAP) return out({ ok: false, err: 'full' });
      var id = v.id || ('g' + Utilities.getUuid().replace(/-/g, '').slice(0, 7));
      if (n + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
      sh.getRange(n + 1, 1, 1, NCOLS).setValues([['', id, new Date(), v.alias, v.text, false, '', v.tok]]);
      sh.getRange(n + 1, C_OK).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      cache.remove('list');
      return out({ ok: true });
    }

    if (body.a === 'light') {
      var lid = String(body.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
      if (!lid) return out({ ok: false, err: 'bad' });
      if (!bumpCounter(cache, 'light_' + minute, LIGHT_PER_MINUTE)) return out({ ok: false, err: 'rate' });
      var es = ss.getSheetByName(SHEET_ENTRIES);
      var rows = readEntries(es, lastDataRow(es));
      var found = false;
      for (var k = 0; k < rows.length; k++) {
        if (String(rows[k][C_ID - 1]) === lid && rows[k][C_OK - 1] === true && !isDeleted(rows[k][C_DEL - 1])) { found = true; break; }
      }
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
      var drows = readEntries(ds, lastDataRow(ds));
      for (var r = 0; r < drows.length; r++) {
        if (String(drows[r][C_ID - 1]) === did) {
          if (String(drows[r][C_TOK - 1]) !== dtok) return out({ ok: false, err: 'bad' });
          if (!isDeleted(drows[r][C_DEL - 1])) ds.getRange(r + 2, C_DEL).setValue('igen');   // a sort te törlöd, ha ráérsz
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
  var entries = readEntries(es, lastDataRow(es));
  var lights = ls.getLastRow() > 1 ? ls.getRange(2, 1, ls.getLastRow() - 1, 1).getValues() : [];
  var items = buildList(entries, lights, LIST_LIMIT, function (d) { return Utilities.formatDate(d, TZ, 'yyyy. MM.'); });
  var json = JSON.stringify({ ok: true, items: items });
  cache.put('list', json, 60);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
