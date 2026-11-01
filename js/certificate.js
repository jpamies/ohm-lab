// Ohm Lab · diploma verificable y badges
// La firma y la codificación no usan el DOM (se prueban con node --test).

/* ───────────────────────── Normalización y cadena canónica ───────────────────────── */

/** Recorta, une espacios, quita «|» y pasa a mayúsculas. */
export function normalizeField(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('es-ES');
}

/** Fecha ISO sin milisegundos: 2026-11-05T10:23:45Z */
export function isoSeconds(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** v1|NOMBRE|GRUPO|CENTRO|fechaISO|n1:pts|n2:pts|n3:pts */
export function canonicalString(data) {
  const [p1, p2, p3] = data.points.map(p => Math.round(Number(p)) || 0);
  return [
    'v1',
    normalizeField(data.name),
    normalizeField(data.group),
    normalizeField(data.school),
    data.date,
    `n1:${p1}`,
    `n2:${p2}`,
    `n3:${p3}`
  ].join('|');
}

/* ───────────────────────── Firma ───────────────────────── */

// Base32 sin caracteres ambiguos (sin I, O, 0 ni 1): 24 letras + 8 dígitos = 32 símbolos
export const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function toBase32(bytes, length) {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
      if (out.length === length) return out;
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

export async function sha256(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto no disponible (hace falta HTTPS)');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(buf);
}

/** Código de verificación: SHA-256(CLAVE + "|" + cadena) → 12 caracteres base32 → OHM-XXXX-XXXX-XXXX */
export async function signCertificate(data, secret) {
  const digest = await sha256(`${secret}|${canonicalString(data)}`);
  const raw = toBase32(digest, 12);
  return `OHM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Limpia lo que escribe el profesor: «ohm 7k2q-9xpa m4td» → «OHM-7K2Q-9XPA-M4TD». */
export function normalizeCode(code) {
  let s = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('OHM')) s = s.slice(3);
  if (s.length !== 12) return null;
  return `OHM-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export async function verifyCertificate(data, code, secret) {
  const expected = await signCertificate(data, secret);
  const given = normalizeCode(code);
  return { valid: given !== null && given === expected, expected, given };
}

/* ───────────────────────── Datos en el fragmento (#) del QR ───────────────────────── */

function bytesToBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

/** Empaqueta los datos firmados y el código para ponerlos tras el «#». */
export function encodePayload(data, code) {
  const compact = {
    v: 1,
    n: data.name,
    g: data.group,
    c: data.school,
    t: data.date,
    p: data.points.map(Number),
    s: code
  };
  return 'd=' + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(compact)));
}

/** Lee el fragmento («#d=...», «d=...» o un enlace completo). Devuelve null si no es válido. */
export function decodePayload(text) {
  try {
    const s = String(text ?? '').trim();
    const match = s.match(/(?:^|[#&?])d=([A-Za-z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]{20,})$/);
    if (!match) return null;
    const obj = JSON.parse(new TextDecoder().decode(base64UrlToBytes(match[1])));
    if (obj.v !== 1 || !Array.isArray(obj.p) || obj.p.length !== 3) return null;
    return {
      data: {
        name: String(obj.n ?? ''),
        group: String(obj.g ?? ''),
        school: String(obj.c ?? ''),
        date: String(obj.t ?? ''),
        points: obj.p.map(x => Math.round(Number(x)) || 0)
      },
      code: String(obj.s ?? '')
    };
  } catch {
    return null;
  }
}

export function verifyUrl(baseHref, data, code) {
  const url = new URL('verificar.html', baseHref);
  url.hash = encodePayload(data, code);
  return url.href;
}

/* ───────────────────────── Diploma en PDF (jsPDF) ───────────────────────── */

const C = {
  ink: [29, 27, 47],
  sky: [110, 195, 255],
  grass: [76, 175, 42],
  grassDk: [47, 122, 23],
  dirt: [139, 90, 43],
  dirtDk: [94, 58, 25],
  gold: [255, 204, 51],
  volt: [214, 51, 108],
  amp: [28, 126, 214],
  ohm: [43, 138, 62],
  paper: [255, 248, 231],
  grey: [80, 78, 100]
};

function star(doc, cx, cy, r, filled) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  const lines = pts.slice(1).map((p, k) => [p[0] - pts[k][0], p[1] - pts[k][1]]);
  doc.setDrawColor(...C.ink);
  doc.setLineWidth(0.4);
  doc.setFillColor(...(filled ? C.gold : [255, 255, 255]));
  doc.lines(lines, pts[0][0], pts[0][1], [1, 1], filled ? 'FD' : 'S', true);
}

function drawQr(doc, qrFactory, text, x, y, size) {
  const qr = qrFactory(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / n;
  doc.setFillColor(255, 255, 255);
  doc.rect(x - 2, y - 2, size + 4, size + 4, 'F');
  doc.setFillColor(...C.ink);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.02, cell + 0.02, 'F');
    }
  }
}

/**
 * Genera el diploma (A4 horizontal). Devuelve el documento jsPDF.
 * opts: { jsPDF, qrcode, data, code, results:[{hits,total,points,stars}], texts, url, shortUrl, dateText }
 */
export function buildDiplomaPdf(opts) {
  const { jsPDF, qrcode, data, code, results, texts, url, dateText } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const H = 210;

  // Fondo: cielo, papel, hierba y tierra (estilo bloques)
  doc.setFillColor(...C.paper);
  doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...C.sky);
  doc.rect(0, 0, W, 14, 'F');
  doc.setFillColor(255, 255, 255);
  [[30, 4, 18, 4], [36, 1.5, 8, 3], [220, 6, 22, 4], [228, 3, 10, 3], [140, 3, 12, 3]].forEach(([x, y, w, h]) => doc.rect(x, y, w, h, 'F'));
  doc.setFillColor(...C.grass);
  doc.rect(0, H - 16, W, 4, 'F');
  doc.setFillColor(...C.grassDk);
  for (let x = 0; x < W; x += 8) doc.rect(x, H - 12, 4, 1.5, 'F');
  doc.setFillColor(...C.dirt);
  doc.rect(0, H - 12, W, 12, 'F');
  doc.setFillColor(...C.dirtDk);
  for (let x = 3; x < W; x += 11) doc.rect(x, H - 9 + (x % 3), 2, 2, 'F');

  // Marco de bloque
  doc.setDrawColor(...C.ink);
  doc.setLineWidth(1.4);
  doc.rect(10, 20, W - 20, H - 42, 'S');
  doc.setDrawColor(...C.gold);
  doc.setLineWidth(0.8);
  doc.rect(12.5, 22.5, W - 25, H - 47, 'S');

  // Bloques V · I · R a los lados
  const blocks = (x0) => [['V', C.volt], ['I', C.amp], ['R', C.ohm]].forEach(([letter, color], k) => {
    const x = x0 + k * 12;
    doc.setFillColor(...color);
    doc.setDrawColor(...C.ink);
    doc.setLineWidth(0.6);
    doc.rect(x, 28, 10, 10, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(letter, x + 5, 35.3, { align: 'center' });
  });
  blocks(22);
  blocks(W - 22 - 34);

  doc.setTextColor(...C.grassDk);
  doc.setFont('courier', 'bold');
  doc.setFontSize(14);
  doc.text('OHM LAB', W / 2, 32, { align: 'center' });

  doc.setTextColor(...C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  doc.text(texts.title, W / 2, 47, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...C.grey);
  doc.text(texts.awardedTo, W / 2, 58, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...C.grassDk);
  doc.text(normalizeField(data.name), W / 2, 71, { align: 'center', maxWidth: W - 60 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12.5);
  doc.setTextColor(...C.ink);
  const who = [texts.groupLabel + ' ' + data.group, data.school ? data.school : null].filter(Boolean).join('  ·  ');
  doc.text(who, W / 2, 80, { align: 'center', maxWidth: W - 60 });
  doc.text(texts.reason, W / 2, 88, { align: 'center', maxWidth: W - 70 });

  // Tabla de resultados
  const tx = 30;
  const ty = 101;
  const colW = [80, 26, 28, 34];
  doc.setFillColor(...C.grass);
  doc.setDrawColor(...C.ink);
  doc.setLineWidth(0.5);
  doc.rect(tx, ty, colW.reduce((a, b) => a + b), 9, 'FD');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  let cx = tx + 4;
  texts.cols.forEach((label, k) => {
    doc.text(label, cx, ty + 6);
    cx += colW[k];
  });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.ink);
  results.forEach((res, k) => {
    const y = ty + 9 + k * 11;
    if (k % 2 === 0) {
      doc.setFillColor(255, 255, 255);
      doc.rect(tx, y, colW.reduce((a, b) => a + b), 11, 'F');
    }
    let x = tx + 4;
    doc.text(texts.levels[k], x, y + 7);
    x += colW[0];
    doc.text(`${res.hits}/${res.total}`, x, y + 7);
    x += colW[1];
    doc.text(String(res.points), x, y + 7);
    x += colW[2];
    for (let s = 0; s < 3; s++) star(doc, x + 3 + s * 7.5, y + 5.5, 3, s < res.stars);
  });
  const totalY = ty + 9 + results.length * 11 + 7;
  doc.setFont('helvetica', 'bold');
  doc.text(`${texts.total}: ${results.reduce((a, r) => a + r.points, 0)}`, tx + 4, totalY);

  // Fecha
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`${texts.dateLabel}: ${dateText}`, tx + 4, totalY + 8);

  // QR y código
  const qrSize = 46;
  const qx = W - 30 - qrSize;
  const qy = 97;
  drawQr(doc, qrcode, url, qx, qy, qrSize);
  doc.setFontSize(9);
  doc.setTextColor(...C.grey);
  doc.text(texts.scan, qx + qrSize / 2, qy + qrSize + 6, { align: 'center' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...C.ink);
  doc.text(code, qx + qrSize / 2, qy + qrSize + 13, { align: 'center' });
  if (opts.shortUrl) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.grey);
    doc.text(`${texts.verifyAt}:`, qx + qrSize / 2, qy + qrSize + 19, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.ink);
    doc.text(opts.shortUrl, qx + qrSize / 2, qy + qrSize + 23.5, { align: 'center', maxWidth: 80 });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.grey);
  doc.text(texts.codeLabel, qx + qrSize / 2, qy - 5, { align: 'center' });

  // Pie (sobre la tierra)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text(texts.footer, W / 2, H - 4.5, { align: 'center', maxWidth: W - 30 });
  return doc;
}

/* ───────────────────────── Badges (PNG pixel art con canvas) ───────────────────────── */

export const BADGES = {
  n1: { colors: ['#3fa9f5', '#1c6fd1', '#0d3f80'], ribbon: ['#3fa9f5', '#1c6fd1'], icon: 'drop' },
  n2: { colors: ['#ff6b6b', '#d93a3a', '#7a1414'], ribbon: ['#ff9b3d', '#d9631a'], icon: 'led' },
  n3: { colors: ['#a07bff', '#6c3bff', '#38198f'], ribbon: ['#b84dff', '#7a22c9'], icon: 'omega' }
};

// Sprites de 12×12 («X» = blanco, «h» = brillo, «y» = amarillo)
const SPRITES = {
  drop: [
    '.....XX.....',
    '....XXXX....',
    '....XXXX....',
    '...XXXXXX...',
    '..XhXXXXXX..',
    '..XhXXXXXX..',
    '.XhXXXXXXXX.',
    '.XhXXXXXXXX.',
    '.XXXXXXXXXX.',
    '..XXXXXXXX..',
    '...XXXXXX...',
    '....XXXX....'
  ],
  led: [
    'y...XXXX...y',
    '.y.XXXXXX.y.',
    '..XhXXXXXX..',
    '..XhXXXXXX..',
    '..XhXXXXXX..',
    '..XXXXXXXX..',
    '.XXXXXXXXXX.',
    '.XXXXXXXXXX.',
    '...X....X...',
    '...X....X...',
    '...X....X...',
    '...X........'
  ],
  omega: [
    '...XXXXXX...',
    '..XX....XX..',
    '.XX......XX.',
    '.X........X.',
    '.X........X.',
    '.X........X.',
    '.XX......XX.',
    '..XX....XX..',
    '...X....X...',
    '...X....X...',
    'XXXX....XXXX',
    'XXXX....XXXX'
  ]
};

const PX = 10; // cada «píxel» del badge mide 10×10 en el PNG de 600×600

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  lines.push(line);
  return lines;
}

/** Dibuja un badge pixel art de 600×600 en el canvas. */
export function drawBadge(canvas, { levelId, title, name, dateText, subtitle, font = 'PressStart, monospace' }) {
  const ctx = canvas.getContext('2d');
  canvas.width = 600;
  canvas.height = 600;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 600, 600);
  const { colors, ribbon, icon } = BADGES[levelId];
  const px = (x, y, color, w = 1, h = 1) => { ctx.fillStyle = color; ctx.fillRect(x * PX, y * PX, w * PX, h * PX); };

  // Cintas (en escalera)
  for (let y = 0; y < 16; y++) {
    px(17 - Math.floor(y / 3), 40 + y, '#111', 9, 1);
    px(18 - Math.floor(y / 3), 40 + y, ribbon[0], 7, 1);
    px(34 + Math.floor(y / 3), 40 + y, '#111', 9, 1);
    px(35 + Math.floor(y / 3), 40 + y, ribbon[1], 7, 1);
  }
  // Puntas en V de las cintas
  px(13, 56, ribbon[0], 3, 1); px(19, 56, ribbon[0], 3, 1);
  px(39, 56, ribbon[1], 3, 1); px(45, 56, ribbon[1], 3, 1);

  // Medalla: anillo dorado dentado + disco de color con sombreado
  const cx = 30;
  const cy = 25;
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 60; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const notch = Math.cos(angle * 12) > 0.3 ? 1 : 0;
      if (d < 20 + notch) {
        let c;
        if (d >= 19 + notch) c = '#111';
        else if (d >= 16) c = dy < 0 ? '#ffe680' : '#e0a800';
        else if (d >= 15) c = '#111';
        else c = dy + dx * 0.4 < -6 ? colors[0] : dy + dx * 0.4 > 8 ? colors[2] : colors[1];
        px(x, y, c);
      }
    }
  }
  // Brillos
  px(20, 13, 'rgba(255,255,255,.55)', 2, 1); px(19, 14, 'rgba(255,255,255,.55)', 1, 2);

  // Icono (sprite 12×12 escalado ×1 sobre la rejilla de 60)
  const sprite = SPRITES[icon];
  sprite.forEach((row, sy) => {
    [...row].forEach((ch, sx) => {
      const color = ch === 'X' ? '#ffffff' : ch === 'h' ? '#d6f0ff' : ch === 'y' ? '#ffd34d' : null;
      if (color) {
        px(24 + sx + 0.3, 12 + sy + 0.3, 'rgba(0,0,0,.35)'); // sombra
        px(24 + sx, 12 + sy, color);
      }
    });
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const shadowText = (text, x, y, color = '#fff') => {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillText(text, x + 3, y + 3);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  ctx.font = `14px ${font}`;
  shadowText('OHM LAB', 300, 278, '#ffe680');
  ctx.font = `17px ${font}`;
  const lines = wrapText(ctx, title.toUpperCase(), 300).slice(0, 3);
  lines.forEach((l, k) => shadowText(l, 300, 312 + k * 26));

  // Placa con nombre y fecha
  ctx.fillStyle = '#111';
  ctx.fillRect(90, 420, 420, 90);
  ctx.fillStyle = '#2b2940';
  ctx.fillRect(100, 430, 400, 70);
  ctx.fillStyle = '#4a4766';
  ctx.fillRect(100, 430, 400, 6);
  ctx.font = `16px ${font}`;
  shadowText(name.length > 24 ? name.slice(0, 23) + '…' : name, 300, 464);
  ctx.font = `10px ${font}`;
  ctx.fillStyle = '#ffd34d';
  ctx.fillText(`${subtitle} · ${dateText}`, 300, 488, 380);
  return canvas;
}
