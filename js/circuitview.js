// Ohm Lab · dibujo de circuitos y de su «gemelo» hidráulico con la MISMA forma.
// Pila ↔ bomba · cables ↔ tuberías · resistencia/bombilla ↔ estrechamiento (con turbina)
// amperímetro ↔ caudalímetro · voltímetro ↔ manómetro diferencial
//
// createCircuitView(svg, { style: 'elec' | 'water', topology: 'single' | 'series' | 'parallel',
//                          load: 'resistor' | 'bulb', reducedMotion })
//   .update(state)  state = { V, I, items: [{ R, I, V, P }], labels: { ... } }
//   .tick(dt)       anima partículas, turbinas y bomba

const NS = 'http://www.w3.org/2000/svg';

// Geometría común (viewBox 0 0 320 220)
const X0 = 40;
const X1 = 280;
const Y0 = 40;
const Y1 = 180;
const NODE_A = 96;
const NODE_B = 224;
const Y_BRANCH = 112;

const POSITIONS = {
  single: [{ cx: 160, cy: Y0 }],
  series: [{ cx: 116, cy: Y0 }, { cx: 204, cy: Y0 }],
  parallel: [{ cx: 160, cy: Y0 }, { cx: 160, cy: Y_BRANCH }]
};

// Recorridos de las partículas (sentido convencional: del + de la pila hacia fuera)
const LOOP = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1], [X0, Y0]];
const PATHS = {
  single: [{ points: LOOP, item: -1, n: 14 }],
  series: [{ points: LOOP, item: -1, n: 14 }],
  parallel: [
    { points: [[NODE_B, Y0], [X1, Y0], [X1, Y1], [X0, Y1], [X0, Y0], [NODE_A, Y0]], item: -1, n: 12 },
    { points: [[NODE_A, Y0], [NODE_B, Y0]], item: 0, n: 5 },
    { points: [[NODE_A, Y0], [NODE_A, Y_BRANCH], [NODE_B, Y_BRANCH], [NODE_B, Y0]], item: 1, n: 8 }
  ]
};

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}

function pathLength(points) {
  let len = 0;
  for (let k = 1; k < points.length; k++) len += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  return len;
}

function pointAt(points, d) {
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= len) return [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
    d -= len;
  }
  return points[points.length - 1];
}

/** Velocidad de las partículas (px/s) proporcional a la intensidad, con límites para que se vea. */
export function particleSpeed(i) {
  return Math.min(230, 6 + 70 * Math.max(0, i));
}

/** Anchura del paso de agua en un estrechamiento: más resistencia, más estrecho. */
export function channelWidth(r) {
  const t = Math.max(0, Math.min(1, Math.log10(Math.max(1, r)) / 2)); // 1 Ω → 0 · 100 Ω → 1
  return 10 - t * 8; // de 10 px (tubería normal) a 2 px
}

export function createCircuitView(svg, opts) {
  const { style, topology, load = 'resistor', reducedMotion = false } = opts;
  const water = style === 'water';
  const positions = POSITIONS[topology];
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 320 220');

  // ── Fondo ──
  if (water) {
    el('rect', { width: 320, height: 220, fill: '#8fd3ff' }, svg);
    const clouds = el('g', { fill: '#fff', 'shape-rendering': 'crispEdges' }, svg);
    [[226, 6, 44, 10], [236, 0, 22, 6], [120, 4, 30, 8]].forEach(([x, y, w, h]) => el('rect', { x, y, width: w, height: h }, clouds));
    el('rect', { x: 0, y: 200, width: 320, height: 6, fill: '#5fbf3a' }, svg);
    el('rect', { x: 0, y: 206, width: 320, height: 14, fill: '#8b5a2b' }, svg);
  } else {
    el('rect', { width: 320, height: 220, fill: '#1f2a44' }, svg);
    const grid = el('g', { fill: '#26324f' }, svg);
    for (let k = 0; k < 40; k++) el('rect', { x: (k % 10) * 32, y: Math.floor(k / 10) * 55, width: 16, height: 16 }, grid);
  }

  // ── Cables / tuberías ──
  let d = `M${X0} ${Y0} H${X1} V${Y1} H${X0} Z`;
  if (topology === 'parallel') d += ` M${NODE_A} ${Y0} V${Y_BRANCH} H${NODE_B} V${Y0}`;
  if (water) {
    el('path', { d, stroke: '#5c5c5c', 'stroke-width': 18, fill: 'none', 'stroke-linejoin': 'miter', 'shape-rendering': 'crispEdges' }, svg);
    el('path', { d, stroke: '#2f80ff', 'stroke-width': 10, fill: 'none', 'stroke-linejoin': 'miter', 'shape-rendering': 'crispEdges' }, svg);
  } else {
    el('path', { d, stroke: '#e07b39', 'stroke-width': 7, fill: 'none', 'shape-rendering': 'crispEdges' }, svg);
    if (topology === 'parallel') {
      el('rect', { x: NODE_A - 6, y: Y0 - 6, width: 12, height: 12, fill: '#ffd34d' }, svg);
      el('rect', { x: NODE_B - 6, y: Y0 - 6, width: 12, height: 12, fill: '#ffd34d' }, svg);
    }
  }

  // ── Fuente: pila ↔ bomba ──
  const src = el('g', { transform: 'translate(16 82)', 'shape-rendering': 'crispEdges' }, svg);
  let pumpRotor = null;
  if (water) {
    el('rect', { width: 48, height: 56, fill: '#7a7a7a', stroke: '#222', 'stroke-width': 3 }, src);
    el('rect', { x: 6, y: 6, width: 36, height: 36, fill: '#2f80ff', stroke: '#222', 'stroke-width': 2 }, src);
    pumpRotor = el('g', { transform: 'translate(24 24)' }, src);
    for (let k = 0; k < 4; k++) el('rect', { x: -2, y: -15, width: 4, height: 15, fill: '#e6f4ff', transform: `rotate(${k * 90})` }, pumpRotor);
    el('rect', { x: -3, y: -3, width: 6, height: 6, fill: '#222' }, pumpRotor);
    el('text', { x: 24, y: 53, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 800, fill: '#fff' }, src).textContent = '▲';
  } else {
    el('rect', { width: 48, height: 56, fill: '#3b3b3b', stroke: '#111', 'stroke-width': 3 }, src);
    el('rect', { width: 48, height: 16, fill: '#ff4d6d' }, src);
    el('rect', { x: 16, y: -8, width: 16, height: 8, fill: '#bbb' }, src);
    el('text', { x: 24, y: 12, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: '#fff' }, src).textContent = '+';
  }
  const srcText = el('text', { x: 24, y: water ? -6 : 44, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: water ? '#1d1b2f' : '#ffd34d' }, src);

  // ── Instrumentos de medida (voltímetros ↔ manómetros) en serie ──
  const meters = [];
  if (topology === 'series') {
    positions.forEach(({ cx }, k) => {
      const g = el('g', {}, svg);
      const color = water ? '#1d1b2f' : '#9fd0ff';
      el('path', { d: `M${cx - 22} ${Y0 + 4} V84 H${cx - 9} M${cx + 22} ${Y0 + 4} V84 H${cx + 9}`, stroke: color, 'stroke-width': 2, fill: 'none', 'stroke-dasharray': water ? '0' : '3 2' }, g);
      el('circle', { cx, cy: 84, r: 10, fill: '#fff', stroke: '#111', 'stroke-width': 2 }, g);
      el('text', { x: cx, y: 88.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 900, fill: '#111' }, g).textContent = water ? 'p' : 'V';
      meters.push(el('text', { x: cx, y: 110, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: water ? '#1d1b2f' : '#9fd0ff' }, g));
    });
  }

  // ── Partículas (electrones ↔ agua) ──
  const dotsLayer = el('g', {}, svg);
  const paths = PATHS[topology].map(p => ({ ...p, length: pathLength(p.points), dots: [], speed: 0 }));
  paths.forEach(p => {
    for (let k = 0; k < p.n; k++) {
      const node = el('rect', { width: water ? 5 : 7, height: water ? 5 : 7, fill: water ? '#e6f4ff' : '#7ee08a' }, dotsLayer);
      p.dots.push({ d: (k / p.n) * p.length, node });
    }
  });

  // ── Componentes: resistencia/bombilla ↔ estrechamiento (+ turbina) ──
  const items = positions.map(({ cx, cy }, k) => {
    const g = el('g', {}, svg);
    const item = { cx, cy, g, k };
    if (water) {
      // Tramo de tubería con paredes que se cierran (estrechamiento)
      el('rect', { x: cx - 28, y: cy - 11, width: 56, height: 22, fill: '#5c5c5c', 'shape-rendering': 'crispEdges' }, g);
      item.channel = el('rect', { x: cx - 28, y: cy - 5, width: 56, height: 10, fill: '#2f80ff', 'shape-rendering': 'crispEdges' }, g);
      item.wallTop = el('rect', { x: cx - 20, y: cy - 11, width: 40, height: 6, fill: '#e07b39', stroke: '#7a3d12', 'stroke-width': 1.5, 'shape-rendering': 'crispEdges' }, g);
      item.wallBot = el('rect', { x: cx - 20, y: cy + 5, width: 40, height: 6, fill: '#e07b39', stroke: '#7a3d12', 'stroke-width': 1.5, 'shape-rendering': 'crispEdges' }, g);
      if (load === 'bulb') {
        // Turbina que gira con el caudal (como la bombilla que brilla con la corriente)
        item.ry = topology === 'parallel' && k === 1 ? cy - 22 : cy + 22;
        item.rotor = el('g', { transform: `translate(${cx} ${item.ry})` }, g);
        el('circle', { r: 9, fill: '#fff6c9', stroke: '#7a4a1f', 'stroke-width': 2 }, item.rotor);
        for (let s = 0; s < 4; s++) el('rect', { x: -1.5, y: -9, width: 3, height: 9, fill: '#a8672e', transform: `rotate(${s * 90})` }, item.rotor);
        const sgn = item.ry > cy ? 1 : -1;
        el('line', { x1: cx, y1: cy + sgn * 5, x2: cx, y2: item.ry - sgn * 9, stroke: '#7a4a1f', 'stroke-width': 2 }, g);
        item.angle = 0;
      }
    } else if (load === 'bulb') {
      item.glow = el('circle', { cx, cy, r: 20, fill: 'url(#bulbglow)', opacity: 0 }, g);
      el('rect', { x: cx - 14, y: cy - 14, width: 28, height: 28, fill: '#1f2a44', 'shape-rendering': 'crispEdges' }, g);
      item.glass = el('rect', { x: cx - 13, y: cy - 13, width: 26, height: 26, fill: '#d8d4c0', stroke: '#111', 'stroke-width': 3, 'shape-rendering': 'crispEdges' }, g);
      el('path', { d: `M${cx - 13} ${cy + 13} L${cx + 13} ${cy - 13} M${cx - 13} ${cy - 13} L${cx + 13} ${cy + 13}`, stroke: '#111', 'stroke-width': 2 }, g);
    } else {
      item.body = el('rect', { x: cx - 30, y: cy - 12, width: 60, height: 24, fill: '#d9b382', stroke: '#111', 'stroke-width': 3, 'shape-rendering': 'crispEdges' }, g);
      [[-20, '#8b4513'], [-8, '#111'], [4, '#ff4d6d'], [18, '#ffd34d']].forEach(([dx, c]) =>
        el('rect', { x: cx + dx, y: cy - 12, width: 6, height: 24, fill: c, 'shape-rendering': 'crispEdges' }, g));
      item.heat = el('rect', { x: cx - 30, y: cy - 12, width: 60, height: 24, fill: '#ff3b1f', opacity: 0, 'shape-rendering': 'crispEdges' }, g);
    }
    // Etiqueta
    const labelY = topology === 'parallel' && k === 1 ? cy + 30 : cy - 20;
    item.label = el('text', { x: cx, y: labelY, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: water ? '#1d1b2f' : '#fff' }, svg);
    return item;
  });

  if (!water && load === 'bulb') {
    const defs = el('defs', {}, svg);
    const grad = el('radialGradient', { id: 'bulbglow' }, defs);
    el('stop', { offset: 0, 'stop-color': '#fff7b0' }, grad);
    el('stop', { offset: 0.5, 'stop-color': '#ffd34d', 'stop-opacity': 0.7 }, grad);
    el('stop', { offset: 1, 'stop-color': '#ffd34d', 'stop-opacity': 0 }, grad);
    svg.prepend(defs);
  }

  // ── Medidor de intensidad total: amperímetro ↔ caudalímetro (turbina) ──
  const meter = el('g', { transform: `translate(${X1} 110)` }, svg);
  let meterRotor = null;
  if (water) {
    el('rect', { x: -14, y: -22, width: 28, height: 44, fill: '#5c5c5c', 'shape-rendering': 'crispEdges' }, meter);
    meterRotor = el('g', {}, meter);
    el('circle', { r: 13, fill: '#2f80ff', stroke: '#7a4a1f', 'stroke-width': 3 }, meterRotor);
    for (let s = 0; s < 6; s++) el('rect', { x: -2, y: -13, width: 4, height: 11, fill: '#a8672e', transform: `rotate(${s * 60})` }, meterRotor);
  } else {
    el('circle', { r: 17, fill: '#fff', stroke: '#111', 'stroke-width': 3 }, meter);
    el('text', { y: 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 900, fill: '#111' }, meter).textContent = 'A';
  }
  const meterText = el('text', { x: X1 - 24, y: 114, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 800, fill: water ? '#1d1b2f' : '#7ee08a' }, svg);
  const bottomText = el('text', { x: 160, y: water ? 216 : 206, 'text-anchor': 'middle', 'font-size': water ? 11 : 13, 'font-weight': 800, fill: water ? '#fff' : '#7ee08a' }, svg);

  let state = null;
  let meterAngle = 0;
  let pumpAngle = 0;

  function placeDots() {
    paths.forEach(p => p.dots.forEach(dot => {
      const [x, y] = pointAt(p.points, dot.d);
      const s = water ? 2.5 : 3.5;
      dot.node.setAttribute('x', (x - s).toFixed(1));
      dot.node.setAttribute('y', (y - s).toFixed(1));
    }));
  }

  function update(next) {
    state = next;
    const { V, I, items: values, labels } = next;
    srcText.textContent = labels.source;
    meterText.textContent = labels.meter;
    bottomText.textContent = labels.bottom || '';
    paths.forEach(p => { p.speed = particleSpeed(p.item < 0 ? I : values[p.item].I); });
    items.forEach((item, k) => {
      const v = values[k];
      item.label.textContent = labels.items[k];
      if (water) {
        const w = channelWidth(v.R);
        const wall = (10 - w) / 2 + 6;
        item.channel.setAttribute('y', (item.cy - w / 2).toFixed(1));
        item.channel.setAttribute('height', w.toFixed(1));
        item.wallTop.setAttribute('height', wall.toFixed(1));
        item.wallBot.setAttribute('y', (item.cy + 11 - wall).toFixed(1));
        item.wallBot.setAttribute('height', wall.toFixed(1));
      } else if (load === 'bulb') {
        const b = Math.max(0, Math.min(1, Math.sqrt(v.P / 4)));
        item.glow.setAttribute('opacity', (b * 0.95).toFixed(2));
        item.glow.setAttribute('r', (16 + b * 34).toFixed(0));
        item.glass.setAttribute('fill', b > 0.08 ? `hsl(52 100% ${55 + b * 40}%)` : '#d8d4c0');
      } else {
        const h = Math.max(0, Math.min(1, v.P / 12));
        item.heat.setAttribute('opacity', (h * 0.85).toFixed(2));
      }
    });
    meters.forEach((m, k) => { m.textContent = labels.meters ? labels.meters[k] : ''; });
    if (reducedMotion) placeDots();
    return V;
  }

  function tick(dt) {
    if (!state) return;
    paths.forEach(p => p.dots.forEach(dot => { dot.d = (dot.d + p.speed * dt) % p.length; }));
    placeDots();
    meterAngle = (meterAngle + particleSpeed(state.I) * dt * 3) % 360;
    pumpAngle = (pumpAngle + (60 + state.V * 40) * dt) % 360;
    if (meterRotor) meterRotor.setAttribute('transform', `rotate(${meterAngle.toFixed(1)})`);
    if (pumpRotor) pumpRotor.setAttribute('transform', `translate(24 24) rotate(${pumpAngle.toFixed(1)})`);
    items.forEach((item, k) => {
      if (!item.rotor) return;
      item.angle = (item.angle + particleSpeed(state.items[k].I) * dt * 4) % 360;
      item.rotor.setAttribute('transform', `translate(${item.cx} ${item.ry}) rotate(${item.angle.toFixed(1)})`);
    });
  }

  placeDots();
  return { update, tick };
}
