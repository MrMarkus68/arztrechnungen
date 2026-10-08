// Texterkennung: PDFs mit Textebene werden direkt gelesen, Bilder/gescannte PDFs per Tesseract (deutsch).
const OCR = (() => {
  let workerPromise = null;
  let progressCb = () => {};

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  function getWorker() {
    if (!window.Tesseract) return Promise.reject(new Error('Texterkennung nicht geladen (Internetverbindung prüfen).'));
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('deu', 1, {
        logger: m => {
          if (m.status === 'recognizing text') progressCb(m.progress, 'Text wird erkannt …');
          else if (m.status && m.status.includes('load')) progressCb(null, 'Sprachdaten werden geladen …');
        },
      }).catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
      img.src = src;
    });
  }

  // Verkleinert große Fotos und erhöht den Kontrast – schneller und genauer für die Texterkennung.
  function prepareCanvas(source, maxSide = 2400) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 140));
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  async function recognizeCanvas(canvas) {
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    return data.text;
  }

  // Speichert Fotos platzsparend als JPEG (max. 2000 px).
  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const max = 2000;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale === 1 && file.size < 1.5e6) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function readImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return await recognizeCanvas(prepareCanvas(img));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function readPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF-Bibliothek nicht geladen (Internetverbindung prüfen).');
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const texts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      // 1. Versuch: eingebettete Textebene (digitale PDF-Rechnungen)
      const content = await page.getTextContent();
      let lastY = null, txt = '';
      for (const it of content.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) txt += '\n';
        else if (txt && !txt.endsWith(' ')) txt += ' ';
        txt += it.str;
        lastY = y;
      }
      if (txt.replace(/\s/g, '').length > 80) { texts.push(txt); continue; }
      // 2. Versuch: Seite rendern und per OCR lesen (gescannte PDFs)
      progressCb(null, `PDF-Seite ${p}/${pdf.numPages} wird gelesen …`);
      const viewport = page.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      texts.push(await recognizeCanvas(prepareCanvas(canvas, 2800)));
    }
    return texts.join('\n');
  }

  async function read(files, onProgress) {
    progressCb = onProgress || (() => {});
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      progressCb(i / files.length, `Datei ${i + 1}/${files.length}: ${f.name}`);
      parts.push(f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? await readPdf(f) : await readImage(f));
    }
    progressCb(1, 'Fertig');
    return parts.join('\n\n');
  }

  return { read, compressImage };
})();
