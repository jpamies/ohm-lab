// Ohm Lab · persistencia local. Todo se queda en el dispositivo del alumno.
// Si localStorage no está disponible (incógnito, bloqueo), se trabaja en memoria.

export const STORAGE_KEY = 'ohmlab:v1';

export function emptyState() {
  return {
    version: 1,
    lang: null,          // 'es' | 'ca' (null = por defecto)
    profile: null,       // { name, group, school }
    progress: {},        // { n1: { done, hits, total, points, stars, completedAt }, ... }
    finishedAt: null,    // fecha ISO en que se completan los tres niveles
    certificates: []     // diplomas emitidos: { data, code, issuedAt }
  };
}

function getBackend(custom) {
  if (custom) return custom;
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__ohmlab_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Crea un almacén. `backend` permite inyectar un objeto con getItem/setItem/removeItem (tests).
 * `persistent` indica si los datos sobreviven al cerrar la página.
 */
export function createStore(backend) {
  const ls = getBackend(backend);
  let persistent = Boolean(ls);
  let state = emptyState();

  if (ls) {
    try {
      const raw = ls.getItem(STORAGE_KEY);
      if (raw) state = sanitize(JSON.parse(raw));
    } catch {
      state = emptyState();
    }
  }

  function save() {
    if (!ls || !persistent) return false;
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      persistent = false; // cuota llena o bloqueo: seguimos en memoria
      return false;
    }
  }

  return {
    get persistent() { return persistent; },
    get state() { return state; },
    update(mutator) {
      mutator(state);
      save();
      return state;
    },
    clear() {
      const lang = state.lang;
      state = emptyState();
      state.lang = lang;
      if (ls) {
        try { ls.removeItem(STORAGE_KEY); } catch { /* sin acceso: nada que borrar */ }
      }
      save();
    }
  };
}

/** Acepta solo la forma esperada, por si el dato guardado está corrupto o es de otra versión. */
export function sanitize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return s;
  if (raw.lang === 'es' || raw.lang === 'ca') s.lang = raw.lang;
  if (raw.profile && typeof raw.profile.name === 'string') {
    s.profile = {
      name: String(raw.profile.name).slice(0, 80),
      group: String(raw.profile.group ?? '').slice(0, 20),
      school: String(raw.profile.school ?? '').slice(0, 80)
    };
  }
  if (raw.progress && typeof raw.progress === 'object') {
    for (const id of ['n1', 'nc', 'n2', 'n3']) {
      const p = raw.progress[id];
      if (p && typeof p === 'object') {
        s.progress[id] = {
          done: Boolean(p.done),
          hits: Number(p.hits) || 0,
          total: Number(p.total) || 0,
          points: Number(p.points) || 0,
          stars: Number(p.stars) || 0,
          completedAt: typeof p.completedAt === 'string' ? p.completedAt : null
        };
      }
    }
  }
  if (typeof raw.finishedAt === 'string') s.finishedAt = raw.finishedAt;
  if (Array.isArray(raw.certificates)) s.certificates = raw.certificates.slice(-10);
  return s;
}

/** Guarda el resultado de un nivel quedándose con la mejor puntuación. */
export function recordLevel(state, levelId, result, now = new Date()) {
  const prev = state.progress[levelId];
  const better = !prev || !prev.done || result.points > prev.points;
  if (better) {
    state.progress[levelId] = {
      done: true,
      ...result,
      completedAt: prev?.completedAt && prev.done ? prev.completedAt : now.toISOString()
    };
  }
  return better;
}
