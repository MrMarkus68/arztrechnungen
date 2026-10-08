// Hauptlogik: Liste, Suche, Filter, Erfassen/Bearbeiten, Status-Häkchen, Export.
(() => {
  const STATUS = [
    { key: 'debekaGesendet', label: 'An DeBeKa geschickt', short: 'DeBeKa geschickt' },
    { key: 'beihilfeGesendet', label: 'An Beihilfe geschickt', short: 'Beihilfe geschickt' },
    { key: 'debekaErstattet', label: 'Erstattung DeBeKa erhalten', short: 'DeBeKa erstattet' },
    { key: 'beihilfeErstattet', label: 'Erstattung Beihilfe erhalten', short: 'Beihilfe erstattet' },
    { key: 'bezahlt', label: 'Rechnung überwiesen', short: 'Überwiesen' },
  ];
  const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const SETTINGS_KEY = 'arztrechnungen.settings';
  const DEFAULT_SETTINGS = { debekaProzent: 20, zahlungszielTage: 30, warnTage: 7 };

  const $ = sel => document.querySelector(sel);
  const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const num = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let invoices = [];
  let settings = loadSettings();
  let editing = null; // { id, files: [{id,name,type,blob}], status: {...} }

  // ---------- Hilfsfunktionen ----------
  function loadSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignorieren */ }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtDate(iso) {
    if (!iso) return '–';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg, ms = 2500) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms);
  }
  function shares(inv) {
    const p = Number(inv.debekaProzent ?? settings.debekaProzent) || 0;
    const betrag = Number(inv.betrag) || 0;
    const debeka = Math.round(betrag * p) / 100;
    return { p, debeka, beihilfe: Math.round((betrag - debeka) * 100) / 100 };
  }
  function openItems(inv) { return STATUS.filter(s => !inv.status?.[s.key]); }
  function isOverdue(inv) { return !inv.status?.bezahlt && inv.faelligkeit && inv.faelligkeit < todayIso(); }
  function isDueSoon(inv) {
    if (inv.status?.bezahlt || !inv.faelligkeit || isOverdue(inv)) return false;
    return daysBetween(todayIso(), inv.faelligkeit) <= settings.warnTage;
  }

  // ---------- Suche & Filter ----------
  function haystack(inv) {
    const s = shares(inv);
    const dates = ['rechnungsdatum', 'faelligkeit', 'behandlungsdatum'].map(k => inv[k]).filter(Boolean);
    const parts = [
      inv.arzt, inv.behandlungsgrund, inv.rechnungsnummer, inv.notiz, inv.ocrText,
      num.format(inv.betrag || 0), String(inv.betrag ?? '').replace('.', ','), num.format(s.debeka), num.format(s.beihilfe),
      ...dates.map(fmtDate), ...dates,
      ...dates.map(d => MONTH_NAMES[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4)),
      ...STATUS.filter(st => inv.status?.[st.key]).map(st => st.label),
      ...openItems(inv).map(st => 'offen ' + st.short),
      isOverdue(inv) ? 'überfällig' : '',
    ];
    return parts.filter(Boolean).join(' \n ').toLowerCase();
  }

  function filtered() {
    const q = $('#search').value.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const basis = $('#fBasis').value;
    const year = $('#fYear').value;
    const month = $('#fMonth').value;
    const arzt = $('#fArzt').value;
    const status = $('#fStatus').value;
    const [sortKey, sortDir] = $('#fSort').value.split(':');

    const res = invoices.filter(inv => {
      const d = inv[basis] || '';
      if (year && d.slice(0, 4) !== year) return false;
      if (month && +d.slice(5, 7) !== +month) return false;
      if (arzt && (inv.arzt || '') !== arzt) return false;
      if (status === 'open' && !openItems(inv).length) return false;
      if (status === 'done' && openItems(inv).length) return false;
      if (status === 'overdue' && !isOverdue(inv)) return false;
      if (status.startsWith('not:') && inv.status?.[status.slice(4)]) return false;
      if (terms.length) {
        const h = haystack(inv);
        if (!terms.every(t => h.includes(t))) return false;
      }
      return true;
    });

    res.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'betrag') { va = +va || 0; vb = +vb || 0; }
      else { va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase(); }
      if (!va && va !== 0) return 1;
      if (!vb && vb !== 0) return -1;
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'desc' ? -c : c;
    });
    return res;
  }

  function highlight(text) {
    const q = $('#search').value.trim();
    let html = esc(text);
    if (!q) return html;
    for (const t of q.split(/\s+/)) {
      if (t.length < 2) continue;
      const re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      html = html.replace(/(<[^>]*>)|([^<]+)/g, (m, tag, txt) => tag || txt.replace(re, '<mark>$1</mark>'));
    }
    return html;
  }

  function refreshFilterOptions() {
    const basis = $('#fBasis').value;
    const years = [...new Set(invoices.map(i => (i[basis] || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const ySel = $('#fYear');
    const yCur = ySel.value;
    ySel.innerHTML = '<option value="">Alle</option>' + years.map(y => `<option${y === yCur ? ' selected' : ''}>${y}</option>`).join('');

    const docs = [...new Set(invoices.map(i => i.arzt).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    const aSel = $('#fArzt');
    const aCur = aSel.value;
    aSel.innerHTML = '<option value="">Alle</option>' + docs.map(d => `<option value="${esc(d)}"${d === aCur ? ' selected' : ''}>${esc(d)}</option>`).join('');
    $('#arztList').innerHTML = docs.map(d => `<option value="${esc(d)}">`).join('');
  }

  // ---------- Darstellung ----------
  function renderSummary(list) {
    let total = 0, unpaid = 0, debeka = 0, beihilfe = 0, overdue = 0, openCount = 0;
    for (const inv of list) {
      const s = shares(inv);
      total += +inv.betrag || 0;
      if (!inv.status?.bezahlt) unpaid += +inv.betrag || 0;
      if (!inv.status?.debekaErstattet) debeka += s.debeka;
      if (!inv.status?.beihilfeErstattet) beihilfe += s.beihilfe;
      if (isOverdue(inv)) overdue++;
      if (openItems(inv).length) openCount++;
    }
    $('#summary').innerHTML = `
      <div class="tile"><div class="lbl">Rechnungen (Auswahl)</div><div class="val">${list.length}</div></div>
      <div class="tile"><div class="lbl">Summe Rechnungen</div><div class="val">${eur.format(total)}</div></div>
      <div class="tile ${unpaid ? 'open' : ''}"><div class="lbl">Noch zu überweisen</div><div class="val">${eur.format(unpaid)}</div></div>
      <div class="tile ${debeka ? 'warn' : ''}"><div class="lbl">Ausstehend DeBeKa</div><div class="val">${eur.format(debeka)}</div></div>
      <div class="tile ${beihilfe ? 'warn' : ''}"><div class="lbl">Ausstehend Beihilfe</div><div class="val">${eur.format(beihilfe)}</div></div>
      <div class="tile ${overdue ? 'open' : ''}"><div class="lbl">Überfällig / mit offenen Punkten</div><div class="val">${overdue} / ${openCount}</div></div>`;
  }

  function renderList() {
    refreshFilterOptions();
    const list = filtered();
    renderSummary(list);
    const el = $('#list');
    if (!invoices.length) {
      el.innerHTML = '<div class="empty">Noch keine Rechnungen erfasst.<br>Klicke auf <b>＋ Rechnung scannen</b>, um die erste Rechnung einzulesen.</div>';
      return;
    }
    if (!list.length) {
      el.innerHTML = '<div class="empty">Keine Rechnung passt zu Suche/Filter.</div>';
      return;
    }
    el.innerHTML = list.map(inv => {
      const s = shares(inv);
      const open = openItems(inv);
      const cls = isOverdue(inv) ? 'st-overdue' : open.length ? 'st-open' : 'st-done';
      let badge = '';
      if (isOverdue(inv)) badge = `<span class="badge overdue">Zahlung überfällig seit ${daysBetween(inv.faelligkeit, todayIso())} Tg.</span>`;
      else if (isDueSoon(inv)) badge = `<span class="badge soon">fällig in ${daysBetween(todayIso(), inv.faelligkeit)} Tg.</span>`;
      else if (!open.length) badge = '<span class="badge done">erledigt</span>';
      const chips = STATUS.map(st => {
        const done = inv.status?.[st.key];
        return `<label class="chip ${done ? 'done' : ''}" title="${esc(st.label)}">
          <input type="checkbox" data-id="${inv.id}" data-key="${st.key}" ${done ? 'checked' : ''}>
          ${esc(st.short)}${done ? ` <small>${fmtDate(done)}</small>` : ''}</label>`;
      }).join('');
      const erst = [];
      if (inv.erstattetDebeka != null) erst.push(`DeBeKa tatsächlich ${eur.format(inv.erstattetDebeka)}`);
      if (inv.erstattetBeihilfe != null) erst.push(`Beihilfe tatsächlich ${eur.format(inv.erstattetBeihilfe)}`);
      return `<article class="card ${cls}">
        <div>
          <div class="title" data-edit="${inv.id}">${highlight(inv.arzt || 'Unbekannter Rechnungssteller')}${badge}</div>
          <div class="reason">${highlight(inv.behandlungsgrund || '')}</div>
          <div class="meta">
            <span>Behandlung: ${highlight(fmtDate(inv.behandlungsdatum))}</span>
            <span>Rechnung: ${highlight(fmtDate(inv.rechnungsdatum))}</span>
            <span>Fällig: ${highlight(fmtDate(inv.faelligkeit))}</span>
            ${inv.rechnungsnummer ? `<span>Nr. ${highlight(inv.rechnungsnummer)}</span>` : ''}
            ${inv.files?.length ? `<span>📎 ${inv.files.length}</span>` : ''}
            ${inv.notiz ? `<span>📝 ${highlight(inv.notiz)}</span>` : ''}
          </div>
        </div>
        <div class="amount">
          <div class="total">${highlight(eur.format(inv.betrag || 0))}</div>
          <div class="parts">DeBeKa ${s.p} %: ${eur.format(s.debeka)} · Beihilfe ${Math.round((100 - s.p) * 10) / 10} %: ${eur.format(s.beihilfe)}</div>
          ${erst.length ? `<div class="parts">${erst.join(' · ')}</div>` : ''}
        </div>
        <div class="chips">${chips}</div>
      </article>`;
    }).join('');
  }

  async function reload() {
    invoices = await DB.all();
    renderList();
  }

  // ---------- Erfassen / Bearbeiten ----------
  const form = $('#formEdit');

  function renderStatusEdit() {
    $('#statusEdit').innerHTML = STATUS.map(st => {
      const v = editing.status[st.key];
      return `<div class="status-line ${v ? 'done' : 'open'}">
        <label><input type="checkbox" data-skey="${st.key}" ${v ? 'checked' : ''}> ${esc(st.label)}</label>
        <input type="date" data-sdate="${st.key}" value="${v || ''}" ${v ? '' : 'disabled'} aria-label="Datum ${esc(st.label)}">
      </div>`;
    }).join('');
  }

  function renderSplit() {
    const betrag = InvoiceParser.parseAmount(form.betrag.value) || 0;
    const p = Number(form.debekaProzent.value);
    const s = shares({ betrag, debekaProzent: isFinite(p) ? p : settings.debekaProzent });
    $('#splitPreview').innerHTML = `
      <div>Rechnung<b>${eur.format(betrag)}</b></div>
      <div>DeBeKa (${s.p} %)<b>${eur.format(s.debeka)}</b></div>
      <div>Beihilfe (${Math.round((100 - s.p) * 10) / 10} %)<b>${eur.format(s.beihilfe)}</b></div>`;
  }

  function renderThumbs() {
    $('#thumbs').innerHTML = editing.files.map(f => {
      const url = f.url || (f.url = URL.createObjectURL(f.blob));
      const inner = f.type.startsWith('image/')
        ? `<img src="${url}" alt="${esc(f.name)}" data-open="${f.id}">`
        : `<div class="pdf" data-open="${f.id}">📄 ${esc(f.name)}</div>`;
      return `<div class="thumb">${inner}<button type="button" class="rm" data-rm="${f.id}" title="Entfernen">✕</button></div>`;
    }).join('');
  }

  function openEditor(inv, { scan = false } = {}) {
    editing = {
      id: inv?.id || null,
      files: (inv?.files || []).map(f => ({ ...f })),
      status: { ...(inv?.status || {}) },
    };
    form.reset();
    $('#editTitle').textContent = inv ? 'Rechnung bearbeiten' : 'Rechnung erfassen';
    $('#btnDelete').hidden = !inv;
    $('#ocrStatus').hidden = true;
    $('#ocrNotes').hidden = true;
    const v = inv || {};
    form.arzt.value = v.arzt || '';
    form.behandlungsgrund.value = v.behandlungsgrund || '';
    form.betrag.value = v.betrag != null ? num.format(v.betrag) : '';
    form.rechnungsnummer.value = v.rechnungsnummer || '';
    form.rechnungsdatum.value = v.rechnungsdatum || '';
    form.faelligkeit.value = v.faelligkeit || '';
    form.behandlungsdatum.value = v.behandlungsdatum || '';
    form.debekaProzent.value = v.debekaProzent ?? settings.debekaProzent;
    form.erstattetDebeka.value = v.erstattetDebeka != null ? num.format(v.erstattetDebeka) : '';
    form.erstattetBeihilfe.value = v.erstattetBeihilfe != null ? num.format(v.erstattetBeihilfe) : '';
    form.notiz.value = v.notiz || '';
    form.ocrText.value = v.ocrText || '';
    renderStatusEdit();
    renderThumbs();
    renderSplit();
    $('#dlgEdit').showModal();
    if (scan) $('#fileInput').click();
  }

  function closeEditor() {
    editing?.files.forEach(f => f.url && URL.revokeObjectURL(f.url));
    editing = null;
    $('#dlgEdit').close();
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!files.length) return;
    const btn = $('#btnSave');
    btn.disabled = true;
    $('#ocrStatus').hidden = false;
    $('#ocrNotes').hidden = true;
    const bar = $('#ocrBar');
    const label = $('#ocrText');
    try {
      for (const f of files) {
        const stored = f.type.startsWith('image/') ? await OCR.compressImage(f) : f;
        editing.files.push({ id: uid(), name: stored.name, type: stored.type || 'application/pdf', blob: stored });
      }
      renderThumbs();
      const text = await OCR.read(files, (p, msg) => {
        if (p != null) bar.style.width = Math.round(p * 100) + '%';
        if (msg) label.textContent = msg;
      });
      form.ocrText.value = (form.ocrText.value ? form.ocrText.value + '\n\n' : '') + text;
      applyParsed(InvoiceParser.parse(form.ocrText.value, settings));
      label.textContent = 'Texterkennung abgeschlossen – bitte Werte prüfen.';
    } catch (e) {
      console.error(e);
      label.textContent = 'Fehler bei der Texterkennung: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  function applyParsed(r) {
    // Nur leere Felder befüllen, damit manuelle Korrekturen erhalten bleiben
    const setIf = (name, val) => { if (val != null && val !== '' && !form[name].value) form[name].value = val; };
    setIf('arzt', r.arzt);
    setIf('behandlungsgrund', r.behandlungsgrund);
    setIf('betrag', r.betrag != null ? num.format(r.betrag) : null);
    setIf('rechnungsnummer', r.rechnungsnummer);
    setIf('rechnungsdatum', r.rechnungsdatum);
    setIf('faelligkeit', r.faelligkeit);
    setIf('behandlungsdatum', r.behandlungsdatum);
    renderSplit();
    const notes = $('#ocrNotes');
    if (r.notes.length) {
      notes.innerHTML = '<ul>' + r.notes.map(n => `<li>${esc(n)}</li>`).join('') + '</ul>';
      notes.hidden = false;
    }
  }

  async function saveEditor(e) {
    e.preventDefault();
    const betrag = InvoiceParser.parseAmount(form.betrag.value);
    if (betrag == null) { toast('Bitte einen gültigen Rechnungsbetrag eingeben.'); form.betrag.focus(); return; }
    const p = Number(form.debekaProzent.value);
    if (!isFinite(p) || p < 0 || p > 100) { toast('Anteil DeBeKa muss zwischen 0 und 100 % liegen.'); return; }
    const existing = editing.id ? invoices.find(i => i.id === editing.id) : null;
    const rec = {
      id: editing.id || uid(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      arzt: form.arzt.value.trim(),
      behandlungsgrund: form.behandlungsgrund.value.trim(),
      betrag,
      rechnungsnummer: form.rechnungsnummer.value.trim(),
      rechnungsdatum: form.rechnungsdatum.value || null,
      faelligkeit: form.faelligkeit.value || null,
      behandlungsdatum: form.behandlungsdatum.value || null,
      debekaProzent: p,
      erstattetDebeka: InvoiceParser.parseAmount(form.erstattetDebeka.value),
      erstattetBeihilfe: InvoiceParser.parseAmount(form.erstattetBeihilfe.value),
      notiz: form.notiz.value.trim(),
      ocrText: form.ocrText.value,
      status: editing.status,
      files: editing.files.map(({ id, name, type, blob }) => ({ id, name, type, blob })),
    };
    await DB.put(rec);
    closeEditor();
    await reload();
    toast('Rechnung gespeichert.');
  }

  // ---------- Export / Sicherung ----------
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportCsv() {
    const list = filtered();
    const head = ['Rechnungssteller', 'Behandlungsgrund', 'Rechnungsnummer', 'Behandlungsdatum', 'Rechnungsdatum', 'Fällig am',
      'Betrag', 'DeBeKa %', 'Anteil DeBeKa', 'Anteil Beihilfe', 'Erstattet DeBeKa (tatsächlich)', 'Erstattet Beihilfe (tatsächlich)',
      ...STATUS.map(s => s.label), 'Notiz'];
    const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = list.map(inv => {
      const s = shares(inv);
      return [inv.arzt, inv.behandlungsgrund, inv.rechnungsnummer, fmtDate(inv.behandlungsdatum), fmtDate(inv.rechnungsdatum),
        fmtDate(inv.faelligkeit), num.format(inv.betrag || 0), s.p, num.format(s.debeka), num.format(s.beihilfe),
        inv.erstattetDebeka != null ? num.format(inv.erstattetDebeka) : '', inv.erstattetBeihilfe != null ? num.format(inv.erstattetBeihilfe) : '',
        ...STATUS.map(st => inv.status?.[st.key] ? fmtDate(inv.status[st.key]) : 'offen'), inv.notiz].map(cell).join(';');
    });
    download(`Arztrechnungen_${todayIso()}.csv`, '﻿' + [head.map(cell).join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  }

  const blobToDataUrl = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

  async function backup() {
    const out = [];
    for (const inv of invoices) {
      const files = [];
      for (const f of inv.files || []) files.push({ id: f.id, name: f.name, type: f.type, data: await blobToDataUrl(f.blob) });
      out.push({ ...inv, files });
    }
    download(`Arztrechnungen_Sicherung_${todayIso()}.json`, JSON.stringify({ app: 'arztrechnungen', version: 1, exportedAt: new Date().toISOString(), settings, invoices: out }), 'application/json');
    toast('Datensicherung gespeichert.');
  }

  async function restore(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'arztrechnungen' || !Array.isArray(data.invoices)) throw new Error('Keine gültige Sicherungsdatei.');
      if (!confirm(`${data.invoices.length} Rechnungen aus der Sicherung laden? Vorhandene Rechnungen mit gleicher Kennung werden überschrieben.`)) return;
      for (const inv of data.invoices) {
        const files = [];
        for (const f of inv.files || []) files.push({ id: f.id, name: f.name, type: f.type, blob: await (await fetch(f.data)).blob() });
        await DB.put({ ...inv, files });
      }
      if (data.settings) { settings = { ...DEFAULT_SETTINGS, ...data.settings }; saveSettings(); }
      await reload();
      toast('Sicherung geladen.');
    } catch (e) {
      alert('Sicherung konnte nicht geladen werden: ' + e.message);
    }
  }

  // ---------- Ereignisse ----------
  $('#btnNew').addEventListener('click', () => openEditor(null, { scan: true }));
  $('#btnManual').addEventListener('click', () => openEditor(null));

  $('#list').addEventListener('click', e => {
    const t = e.target.closest('[data-edit]');
    if (t) openEditor(invoices.find(i => i.id === t.dataset.edit));
  });
  $('#list').addEventListener('change', async e => {
    const cb = e.target.closest('input[data-key]');
    if (!cb) return;
    const inv = invoices.find(i => i.id === cb.dataset.id);
    inv.status = { ...(inv.status || {}), [cb.dataset.key]: cb.checked ? todayIso() : null };
    inv.updatedAt = new Date().toISOString();
    await DB.put(inv);
    renderList();
  });

  ['#search', '#fBasis', '#fYear', '#fMonth', '#fArzt', '#fStatus', '#fSort'].forEach(sel =>
    $(sel).addEventListener(sel === '#search' ? 'input' : 'change', renderList));
  $('#btnReset').addEventListener('click', () => {
    $('#search').value = '';
    ['#fYear', '#fMonth', '#fArzt', '#fStatus'].forEach(s => { $(s).value = ''; });
    $('#fBasis').value = 'rechnungsdatum';
    $('#fSort').value = 'rechnungsdatum:desc';
    renderList();
  });

  // Dialog-Steuerung
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    const dlg = b.closest('dialog');
    if (dlg.id === 'dlgEdit') closeEditor(); else dlg.close();
  }));
  $('#dlgEdit').addEventListener('cancel', e => { e.preventDefault(); closeEditor(); });
  form.addEventListener('submit', saveEditor);
  form.betrag.addEventListener('input', renderSplit);
  form.debekaProzent.addEventListener('input', renderSplit);

  $('#statusEdit').addEventListener('change', e => {
    const key = e.target.dataset.skey || e.target.dataset.sdate;
    if (!key) return;
    if (e.target.dataset.skey) editing.status[key] = e.target.checked ? todayIso() : null;
    else editing.status[key] = e.target.value || null;
    renderStatusEdit();
  });

  $('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  $('#camInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  const dz = $('#dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); addFiles(e.dataTransfer.files); });

  $('#thumbs').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const f = editing.files.find(x => x.id === rm.dataset.rm);
      if (f?.url) URL.revokeObjectURL(f.url);
      editing.files = editing.files.filter(x => x.id !== rm.dataset.rm);
      renderThumbs();
      return;
    }
    const op = e.target.closest('[data-open]');
    if (op) {
      const f = editing.files.find(x => x.id === op.dataset.open);
      if (f) window.open(f.url, '_blank');
    }
  });

  $('#btnDelete').addEventListener('click', async () => {
    if (!editing?.id || !confirm('Diese Rechnung wirklich löschen?')) return;
    await DB.remove(editing.id);
    closeEditor();
    await reload();
    toast('Rechnung gelöscht.');
  });

  // Menü
  $('#btnMenu').addEventListener('click', e => { e.stopPropagation(); $('#menuList').hidden = !$('#menuList').hidden; });
  document.addEventListener('click', () => { $('#menuList').hidden = true; });
  $('#menuList').addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (act === 'csv') exportCsv();
    if (act === 'backup') backup();
    if (act === 'restore') $('#restoreInput').click();
    if (act === 'settings') {
      const f = $('#formSettings');
      f.debekaProzent.value = settings.debekaProzent;
      f.zahlungszielTage.value = settings.zahlungszielTage;
      f.warnTage.value = settings.warnTage;
      $('#dlgSettings').showModal();
    }
  });
  $('#restoreInput').addEventListener('change', e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; });
  $('#formSettings').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    settings = {
      debekaProzent: Math.min(100, Math.max(0, Number(f.debekaProzent.value) || 0)),
      zahlungszielTage: Math.max(0, Number(f.zahlungszielTage.value) || 0),
      warnTage: Math.max(0, Number(f.warnTage.value) || 0),
    };
    saveSettings();
    $('#dlgSettings').close();
    renderList();
    toast('Einstellungen gespeichert.');
  });

  // Daten dauerhaft speichern lassen (Browser soll nichts automatisch löschen)
  navigator.storage?.persist?.().catch(() => {});
  reload();
})();
