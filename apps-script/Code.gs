/**
 * Block Draw → Google Sheets bridge (Google Apps Script web app).
 *
 * The Obsidian plugin sends Google Sheets API requests here; this script runs them in your
 * Google account through the "Google Sheets API" advanced service. Nothing is stored here.
 *
 * Setup (once):
 *  1. Go to https://script.google.com → New project, and paste this file over Code.gs.
 *  2. Change SECRET below to a long random string. Paste the same value into
 *     Obsidian → Settings → Block Draw → "Apps Script secret".
 *  3. In the editor sidebar: Services (+) → "Google Sheets API" → Add.
 *  4. Deploy → New deployment → type "Web app".
 *       Execute as: Me
 *       Who has access: Anyone
 *     Deploy, authorize, and copy the web app URL (ends in /exec) into the plugin settings.
 *
 * "Anyone" is needed because Obsidian cannot sign in to your Google account; requests
 * without the right SECRET are rejected. After editing this file, use
 * Deploy → Manage deployments → Edit → Version: New version, so the URL stays the same.
 */

var SECRET = 'change-me-to-a-long-random-string';

var BRIDGE_VERSION = 1;

function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var req = JSON.parse(body);
    if (!SECRET || SECRET === 'change-me-to-a-long-random-string') {
      return reply_({ ok: false, error: 'Set SECRET in the Apps Script (Code.gs) first, then deploy a new version.' });
    }
    if (req.secret !== SECRET) {
      return reply_({ ok: false, error: 'The Apps Script secret does not match the one in Block Draw settings.' });
    }
    if (typeof Sheets === 'undefined') {
      return reply_({
        ok: false,
        error: 'Add the "Google Sheets API" advanced service to the Apps Script project (Services → +), then deploy a new version.'
      });
    }
    switch (req.action) {
      case 'ping':
        return reply_({ ok: true, result: { version: BRIDGE_VERSION, user: Session.getEffectiveUser().getEmail() } });
      case 'create':
        return reply_({ ok: true, result: info_(Sheets.Spreadsheets.create({ properties: { title: String(req.title || 'Block Draw export') } })) });
      case 'get':
        return reply_({
          ok: true,
          result: info_(Sheets.Spreadsheets.get(String(req.spreadsheetId), { fields: 'spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)' }))
        });
      case 'batchUpdate':
        if (!req.requests || !req.requests.length) return reply_({ ok: true, result: {} });
        Sheets.Spreadsheets.batchUpdate({ requests: req.requests }, String(req.spreadsheetId));
        return reply_({ ok: true, result: {} });
      default:
        return reply_({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    var message = String((err && err.message) || err);
    return reply_({ ok: false, error: message, notFound: /not found/i.test(message) });
  }
}

/** Visiting the URL in a browser shows that the bridge is deployed. */
function doGet() {
  return reply_({ ok: true, result: 'Block Draw bridge v' + BRIDGE_VERSION + ' is running. The plugin talks to it with POST requests.' });
}

function info_(ss) {
  return {
    spreadsheetId: ss.spreadsheetId,
    spreadsheetUrl: ss.spreadsheetUrl,
    sheets: (ss.sheets || []).map(function (s) {
      return { properties: { sheetId: s.properties.sheetId, title: s.properties.title } };
    })
  };
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
