// Ohm Lab · física y utilidades numéricas (sin DOM: se prueban con node --test)

/** Intensidad de corriente I = V / R (A). */
export function current(voltage, resistance) {
  if (!(resistance > 0)) throw new RangeError('La resistencia debe ser mayor que 0');
  return voltage / resistance;
}

/** Tensión V = I · R (V). */
export function voltage(intensity, resistance) {
  return intensity * resistance;
}

/** Resistencia R = V / I (Ω). */
export function resistance(voltageValue, intensity) {
  if (!(intensity > 0)) throw new RangeError('La intensidad debe ser mayor que 0');
  return voltageValue / intensity;
}

/** Intensidad que circula por un LED en serie con una resistencia: I = (Vpila − VLED) / R. */
export function ledCurrent(vBattery, vLed, r) {
  return Math.max(0, vBattery - vLed) / r;
}

/** Resistencia mínima que protege el LED: Rmin = (Vpila − VLED) / Imax. */
export function minLedResistance(vBattery, vLed, iMax) {
  return (vBattery - vLed) / iMax;
}

/** ¿El valor está dentro de la tolerancia relativa (por defecto ±2 %)? */
export function withinTolerance(answer, expected, tolerance = 0.02) {
  if (!Number.isFinite(answer) || !Number.isFinite(expected)) return false;
  if (expected === 0) return Math.abs(answer) < 1e-9;
  return Math.abs(answer - expected) <= Math.abs(expected) * tolerance + 1e-12;
}

/** Igualdad numérica robusta frente a errores de coma flotante. */
export function nearlyEqual(a, b, rel = 1e-9) {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * rel + 1e-12;
}

/**
 * Convierte el texto que escribe el alumno en número.
 * Acepta coma o punto decimal y espacios: «0,5», «0.5», « 12 ».
 * Devuelve NaN si no es un número.
 */
export function parseUserNumber(text) {
  if (typeof text !== 'string') return Number.NaN;
  let s = text.trim().replace(/\s+/g, '');
  if (!s) return Number.NaN;
  // Si hay coma y punto, el último es el separador decimal
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else {
    s = s.replace(',', '.');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Formatea un número con la coma decimal del idioma (máximo `digits` decimales). */
export function formatNumber(value, lang = 'es', digits = 2) {
  const locale = lang === 'ca' ? 'ca-ES' : 'es-ES';
  // Redondeo explícito para evitar 0,30000000000000004
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
    useGrouping: false
  }).format(rounded);
}

/** Formatea una resistencia: 470 Ω, 1 kΩ, 2,2 kΩ. */
export function formatOhms(r, lang = 'es') {
  if (r >= 1000) return `${formatNumber(r / 1000, lang, 2)} kΩ`;
  return `${formatNumber(r, lang, 2)} Ω`;
}

/** Serie E12 de resistencias comerciales (una década). */
export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** ¿Es un valor comercial de la serie E12 (de 1 Ω a 10 MΩ)? */
export function isE12(value) {
  if (!(value > 0)) return false;
  for (let decade = 1; decade <= 1e6; decade *= 10) {
    if (E12.some(base => nearlyEqual(base * decade, value))) return true;
  }
  return false;
}

/** Generador pseudoaleatorio reproducible (mulberry32), útil para tests. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Baraja una copia de la lista (Fisher–Yates). */
export function shuffle(list, rand = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Calculadora segura: evalúa expresiones con números, + − × ÷, paréntesis y coma decimal.
 * No usa eval(). Devuelve NaN si la expresión no es válida.
 */
export function evaluateExpression(text) {
  const src = String(text ?? '')
    .replace(/[×xX·*]/g, '*')
    .replace(/[÷:/]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
  if (!src || src.length > 80) return Number.NaN;
  let pos = 0;
  const peek = () => src[pos];
  function number() {
    const m = src.slice(pos).match(/^(\d+\.?\d*|\.\d+)/);
    if (!m) throw new Error('número');
    pos += m[0].length;
    return Number(m[0]);
  }
  function factor() {
    if (peek() === '-') { pos++; return -factor(); }
    if (peek() === '+') { pos++; return factor(); }
    if (peek() === '(') {
      pos++;
      const v = expr();
      if (peek() !== ')') throw new Error('paréntesis');
      pos++;
      return v;
    }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[pos++];
      const w = factor();
      v = op === '*' ? v * w : v / w;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++];
      const w = term();
      v = op === '+' ? v + w : v - w;
    }
    return v;
  }
  try {
    const v = expr();
    if (pos !== src.length || !Number.isFinite(v)) return Number.NaN;
    return v;
  } catch {
    return Number.NaN;
  }
}
