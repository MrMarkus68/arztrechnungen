// Liest aus dem erkannten Rechnungstext die wichtigsten Felder heraus.
// Arbeitet mit Schlüsselwörtern, wie sie auf deutschen Arzt-/GOÄ-Rechnungen üblich sind.
const InvoiceParser = (() => {
  const MONTHS = {
    januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, mrz: 3, april: 4, apr: 4, mai: 5,
    juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
    oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
  };

  const AMOUNT_RE = /(?<![\d,.])(\d{1,3}(?:[.\s]\d{3})+|\d+)\s?,\s?(\d{2})(?!\d)/g;
  const DATE_NUM_RE = /(?<!\d)(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4}|\d{2})(?!\d)/g;
  const DATE_TXT_RE = /(?<!\d)(\d{1,2})\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|mrz|apr|jun|jul|aug|sept?|okt|nov|dez)\.?\s+(\d{4})/gi;

  const BIRTH_RE = /geb(\.|urts|oren)|geburtsdatum|\*\s?\d/i;

  function pad(n) { return String(n).padStart(2, '0'); }

  function toIso(d, m, y) {
    d = +d; m = +m; y = +y;
    if (y < 100) y += y > 70 ? 1900 : 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function datesIn(line) {
    const out = [];
    for (const m of line.matchAll(DATE_NUM_RE)) {
      const iso = toIso(m[1], m[2], m[3]);
      if (iso) out.push({ iso, index: m.index });
    }
    for (const m of line.matchAll(DATE_TXT_RE)) {
      const iso = toIso(m[1], MONTHS[m[2].toLowerCase()], m[3]);
      if (iso) out.push({ iso, index: m.index });
    }
    return out.sort((a, b) => a.index - b.index);
  }

  function parseAmount(str) {
    if (str == null) return null;
    const s = String(str).trim().replace(/[€\s]/g, '');
    if (!s) return null;
    let n;
    if (/,\d{1,2}$/.test(s)) n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    else if (/\.\d{1,2}$/.test(s) && !/,/.test(s)) n = parseFloat(s);
    else n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function amountsIn(line) {
    const out = [];
    for (const m of line.matchAll(AMOUNT_RE)) {
      const v = parseFloat(m[1].replace(/[.\s]/g, '') + '.' + m[2]);
      if (isFinite(v)) out.push(v);
    }
    return out;
  }

  function addDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }

  // Sucht ein Schlüsselwort und liefert Treffer in derselben oder der folgenden Zeile.
  function findNear(lines, keywords, extractor, lookahead = 1) {
    for (const kw of keywords) {
      for (let i = 0; i < lines.length; i++) {
        const low = lines[i].toLowerCase();
        const pos = low.search(kw);
        if (pos < 0) continue;
        const sameLine = extractor(lines[i].slice(pos));
        if (sameLine.length) return { values: sameLine, line: i };
        for (let k = 1; k <= lookahead && i + k < lines.length; k++) {
          const next = extractor(lines[i + k]);
          if (next.length) return { values: next, line: i + k };
        }
      }
    }
    return null;
  }

  function findAmount(lines) {
    const keywords = [
      /rechnungsbetrag/, /gesamtbetrag/, /endbetrag/, /zu zahlende[rn]? betrag/, /zahlbetrag/,
      /bitte überweisen sie/, /offener betrag/, /gesamtsumme/, /rechnungssumme/,
      /(?<!zwischen)summe/, /gesamt/, /betrag/,
    ];
    const hit = findNear(lines, keywords, amountsIn);
    if (hit) return hit.values[hit.values.length - 1];
    const all = lines.flatMap(amountsIn).filter(v => v < 100000);
    return all.length ? Math.max(...all) : null;
  }

  function cleanName(s) {
    return s
      .split(/\s[·•|]\s|\s{3,}|\s[-–]\s(?=\D*\d{5})/)[0]
      .replace(/^(absender|rechnungssteller|leistungserbringer|behandelnde[rn]? arzt|behandler|arzt|ärztin)\s*:?\s*/i, '')
      .replace(/[,;:]+$/, '')
      .trim();
  }

  function findDoctor(lines) {
    const explicit = [/behandelnde[rn]? (arzt|ärztin)/, /leistungserbringer/, /rechnungssteller/, /behandler/];
    for (const kw of explicit) {
      for (let i = 0; i < lines.length; i++) {
        const low = lines[i].toLowerCase();
        if (!kw.test(low)) continue;
        const rest = cleanName(lines[i].replace(/^.*?(arzt|ärztin|leistungserbringer|rechnungssteller|behandler)\s*:?/i, ''));
        if (rest.length > 3) return rest;
        if (lines[i + 1] && lines[i + 1].length > 3) return cleanName(lines[i + 1]);
      }
    }
    const docRe = /\b(dr\.|prof\.|praxis|zahnarzt|zahnärzt|fachärzt|facharzt|klinik|klinikum|krankenhaus|mvz|labor|physiotherap|ärztin|arzt\b|radiolog|orthopäd|kinderarzt|kieferorthop|heilpraktiker|apotheke)/i;
    const skip = /^(herrn?|frau|an\s|patient|versichert|für\s)/i;
    const head = lines.slice(0, 25);
    for (const l of head) {
      if (skip.test(l) || BIRTH_RE.test(l)) continue;
      if (docRe.test(l)) return cleanName(l);
    }
    // Fallback: erste "sinnvolle" Zeile im Kopf (häufig der Praxisname)
    for (const l of head) {
      if (l.length >= 4 && /[a-zäöü]{3}/i.test(l) && !skip.test(l) && !/rechnung|seite|datum|\d{5}/i.test(l)) return cleanName(l);
    }
    return '';
  }

  function findReason(lines) {
    const kws = [/diagnosen?\b/, /behandlungsgrund/, /indikation/, /befund/, /anlass/];
    for (const kw of kws) {
      for (let i = 0; i < lines.length; i++) {
        const low = lines[i].toLowerCase();
        const pos = low.search(kw);
        if (pos < 0) continue;
        let rest = lines[i].slice(pos).replace(/^[^:]*?(diagnosen?|behandlungsgrund|indikation|befund|anlass)\s*[:.\-]?\s*/i, '').trim();
        const parts = rest ? [rest] : [];
        // Folgezeilen mitnehmen, solange sie nach Diagnosen aussehen (z. B. ICD-Codes)
        for (let k = 1; k <= 3 && i + k < lines.length; k++) {
          const n = lines[i + k];
          if (/^\s*([A-TV-Z]\d{2}(\.\d+)?|[-•*])/.test(n) || (!parts.length && n.length > 3)) parts.push(n.trim());
          else break;
        }
        const txt = parts.join('; ').replace(/\s+/g, ' ').trim();
        if (txt.length > 2) return txt.slice(0, 300);
      }
    }
    return '';
  }

  function findInvoiceNo(lines) {
    const re = /(rechnungs?[\s-]?(nr|nummer|no)|re[\s.-]?nr|beleg[\s-]?nr|rg[\s.-]?nr)\.?\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{2,})/i;
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[3].replace(/[.]$/, '');
    }
    return '';
  }

  function parse(text, opts = {}) {
    const zahlungsziel = opts.zahlungszielTage ?? 30;
    const notes = [];
    const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

    // Alle Daten (ohne Geburtsdatum) einsammeln
    const allDates = [];
    lines.forEach((l, i) => {
      if (BIRTH_RE.test(l)) return;
      datesIn(l).forEach(d => allDates.push({ ...d, line: i, text: l }));
    });

    // Rechnungsdatum
    let rechnungsdatum = null;
    const rd = findNear(lines, [/rechnungsdatum/, /datum der rechnung/, /rechnung vom/, /ausstellungsdatum/, /rechnung\b.*\bdatum/, /\bdatum\b/],
      l => datesIn(l).map(d => d.iso));
    if (rd) rechnungsdatum = rd.values[0];
    if (!rechnungsdatum) {
      const head = allDates.filter(d => d.line < 25 && !/fällig|zahlbar|bis zum|behandl|leistung/i.test(d.text));
      if (head.length) rechnungsdatum = head[0].iso;
      else if (allDates.length) rechnungsdatum = allDates.map(d => d.iso).sort().pop();
    }

    // Fälligkeit
    let faelligkeit = null;
    const fd = findNear(lines, [/fällig/, /faellig/, /zahlbar bis/, /zahlungsziel/, /bitte (überweisen|zahlen).{0,40}bis/, /spätestens/, /bis zum/],
      l => datesIn(l).map(d => d.iso), 0);
    if (fd) faelligkeit = fd.values[0];
    if (!faelligkeit && rechnungsdatum) {
      const m = text.match(/(?:innerhalb|binnen|zahlbar in)\s+(?:von\s+)?(\d{1,3})\s+tag/i) || text.match(/(\d{1,3})\s+tage\s+(?:netto|nach rechnungs)/i);
      if (m) faelligkeit = addDays(rechnungsdatum, +m[1]);
      else {
        faelligkeit = addDays(rechnungsdatum, zahlungsziel);
        notes.push(`Fälligkeit nicht gefunden – ${zahlungsziel} Tage nach Rechnungsdatum angenommen.`);
      }
    }

    // Behandlungsdatum
    let behandlungsdatum = null;
    const bd = findNear(lines, [/behandlungsdatum/, /behandlung(en)? (am|vom)/, /behandlungstag/, /behandlungszeitraum/, /leistungsdatum/, /leistungszeitraum/, /untersuchung (am|vom)/, /datum der behandlung/],
      l => datesIn(l).map(d => d.iso));
    if (bd) behandlungsdatum = bd.values[0];
    if (!behandlungsdatum) {
      // GOÄ-Tabellen: Zeilen, die mit einem Datum beginnen
      const rows = allDates.filter(d => d.index <= 2 && d.iso !== rechnungsdatum && d.iso !== faelligkeit).map(d => d.iso).sort();
      if (rows.length) behandlungsdatum = rows[0];
    }
    if (!behandlungsdatum) {
      const rest = allDates.map(d => d.iso).filter(d => d !== rechnungsdatum && d !== faelligkeit && (!rechnungsdatum || d <= rechnungsdatum)).sort();
      if (rest.length) behandlungsdatum = rest[0];
    }

    const betrag = findAmount(lines);
    const arzt = findDoctor(lines);
    const behandlungsgrund = findReason(lines);
    const rechnungsnummer = findInvoiceNo(lines);

    if (betrag == null) notes.push('Rechnungsbetrag nicht erkannt – bitte eintragen.');
    if (!rechnungsdatum) notes.push('Rechnungsdatum nicht erkannt.');
    if (!behandlungsdatum) notes.push('Behandlungsdatum nicht erkannt.');
    if (!behandlungsgrund) notes.push('Behandlungsgrund/Diagnose nicht erkannt.');
    if (!arzt) notes.push('Rechnungssteller nicht erkannt.');

    return { betrag, rechnungsdatum, faelligkeit, behandlungsdatum, arzt, behandlungsgrund, rechnungsnummer, notes };
  }

  return { parse, parseAmount };
})();
