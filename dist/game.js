'use strict';

const canvas = document.querySelector('#world');
const ctx = canvas.getContext('2d');
const width = canvas.width;
const height = canvas.height;
const floor = 232;
const gravity = 0.32;
const jumpSpeed = 7.6;
const runnerWidth = 14;
const runnerHeight = 19;
const speed = 3.6;
const pixelsPerMeter = 2;
const ticksPerSecond = 60;
const crumbleDelay = ticksPerSecond;
const respawnDelay = 3 * ticksPerSecond;
const fadeInDuration = ticksPerSecond;
const maxHearts = 3;
const powerUps = {
  boots: { label: 'Spring boots', seconds: 7, color: '#92f3c0' },
  double: { label: '2× score', seconds: 10, color: '#d5aaff' },
  heart: { label: 'Extra heart', color: '#ff8eac' },
  jet: { label: 'Jetpack', seconds: 7, color: '#8edbff' }
};
const powerOrder = Object.keys(powerUps);
const heightReadout = document.querySelector('#height');
const scoreReadout = document.querySelector('#score');
const livesReadout = document.querySelector('#lives');
const heartIcons = [...livesReadout.children];
const effectBadges = [...document.querySelectorAll('[data-effect]')];
const biome = document.querySelector('#biome');
const intro = document.querySelector('#intro');
const gameOver = document.querySelector('#game-over');
const result = document.querySelector('#result');
const replay = document.querySelector('#replay');
const meadow = [
  [0, floor, 480], [146, 182, 90], [253, 134, 83], [342, 88, 82],
  [244, 42, 82], [134, -8, 84, true], [55, -54, 77], [151, -104, 75]
];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (from, to, amount) => from + (to - from) * amount;
const noise = (seed) => {
  const value = Math.sin(seed * 91.7 + 17.3) * 43758.5453;
  return value - Math.floor(value);
};

const keys = new Set();
const aim = { x: 0, y: 0, visible: false };
const crumbleTimers = new Map();
let route, landings, nextPowerUp, powerIndex;
let player, camera, peak, finished, queued, particles, tick, hearts, score, effects, flightTarget;

function platform(x, y, size, index, crumbles) {
  let item = index > 0 ? 'coin' : null;
  if (index === nextPowerUp) {
    item = powerOrder[powerIndex++ % powerOrder.length];
    nextPowerUp += 9 + Math.floor(noise(index * 4.47) * 5);
  }
  return { x, y, size, index, crumbles, item };
}

function extendRoute(top) {
  while (route.at(-1).y > top) {
    const previous = route.at(-1);
    const index = previous.index + 1;
    const altitude = (floor - previous.y) / pixelsPerMeter;
    const difficulty = altitude / (altitude + 900);
    const size = Math.round(mix(78, 33, difficulty) + noise(index * 3.37) * 6);
    const gap = Math.round(mix(46, 64, difficulty) + noise(index * 5.21) * 5);
    const shift = mix(66, 100, difficulty) + noise(index * 7.19) * 12;
    const previousCenter = previous.x + previous.size / 2;
    const direction = noise(index * 8.63) < .5 ? -1 : 1;
    const edge = size / 2 + 16;
    let center = previousCenter + direction * shift;
    if (center < edge || center > width - edge) center = previousCenter - direction * shift;
    const crumbles = !previous.crumbles && noise(index * 2.83) < mix(.22, .72, difficulty);
    route.push(platform(Math.round(center - size / 2), previous.y - gap, size, index, crumbles));
  }
}

function reset() {
  player = { x: 114, y: floor, vx: 0, vy: 0, grounded: true, facing: 1, guided: false };
  nextPowerUp = 6;
  powerIndex = 0;
  route = meadow.map(([x, y, size, crumbles = false], index) => platform(index ? x + 4 : x, y, index ? size - 8 : size, index, crumbles));
  landings = [route[0]];
  camera = 0;
  peak = floor;
  finished = false;
  queued = null;
  particles = [];
  tick = 0;
  hearts = maxHearts;
  score = 0;
  effects = { boots: 0, double: 0, jet: 0 };
  flightTarget = null;
  crumbleTimers.clear();
  keys.clear();
  aim.visible = false;
  intro.classList.remove('dismissed');
  gameOver.hidden = true;
  updateHud();
  updateEffects();
}

function updateHud() {
  const meters = Math.round((floor - peak) / pixelsPerMeter);
  heightReadout.textContent = String(meters).padStart(3, '0');
  biome.textContent = meters < 200 ? 'THE MEADOW' : meters < 1050 ? 'THE HIGHLANDS' : 'THE CLOUDS';
  scoreReadout.textContent = score.toLocaleString('en-US');
  livesReadout.setAttribute('aria-label', `${hearts} of ${maxHearts} hearts`);
  heartIcons.forEach((icon, index) => icon.classList.toggle('empty', index >= hearts));
}

function updateEffects() {
  for (const badge of effectBadges) {
    const type = badge.dataset.effect;
    const seconds = Math.ceil((effects[type] - tick) / ticksPerSecond);
    badge.hidden = seconds <= 0;
    if (seconds <= 0) continue;
    const label = `${powerUps[type].label} · ${seconds}s`;
    if (badge.textContent !== label) badge.textContent = label;
  }
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles.push({ x, y, vx: (noise(tick + i * 5) - .5) * 2.8, vy: -noise(tick + i * 7) * 1.6, life: 15 + i, color });
  }
}

function addScore(points) {
  score += tick < effects.double ? points * 2 : points;
}

function collectItems() {
  for (const surface of route) {
    if (!surface.item) continue;
    const x = surface.x + surface.size / 2;
    const y = surface.y - 13;
    if (Math.abs(player.x - x) > runnerWidth / 2 + 7 || player.y < y - 7 || player.y - runnerHeight > y + 7) continue;
    const item = surface.item;
    surface.item = null;
    if (item === 'coin') {
      addScore(10);
    } else if (item === 'heart') {
      if (hearts < maxHearts) hearts++;
      else addScore(50);
    } else {
      effects[item] = tick + powerUps[item].seconds * ticksPerSecond;
      if (item === 'jet') {
        flightTarget = null;
        queued = null;
        player.guided = false;
      }
    }
    burst(x, y, powerUps[item]?.color ?? '#ffdf91', 10);
    updateHud();
  }
}

function loseHeart() {
  hearts--;
  updateHud();
  queued = null;
  effects.jet = 0;
  flightTarget = null;
  if (hearts === 0) {
    finished = true;
    result.textContent = `${scoreReadout.textContent} points · ${heightReadout.textContent} m`;
    gameOver.hidden = false;
    replay.focus();
    return;
  }

  const landingIndex = landings.findLastIndex((surface) => (crumbleTimers.get(surface) ?? Infinity) > tick);
  const surface = landings[landingIndex];
  landings.length = landingIndex + 1;
  if (surface.crumbles) crumbleTimers.set(surface, tick + crumbleDelay);
  player.x = surface.index ? surface.x + surface.size / 2 : 114;
  player.y = surface.y;
  player.vx = player.vy = 0;
  player.grounded = true;
  player.guided = false;
  camera = Math.min(0, surface.y - 154);
  particles = [];
  burst(player.x, player.y - 8, '#ff9bb6', 16);
}

function activeJumpSpeed() {
  return tick < effects.boots ? 9.5 : jumpSpeed;
}

function aimVelocity(target) {
  const delta = target.x - player.x;
  const lift = activeJumpSpeed();
  const elevation = clamp(player.y - target.y, 0, lift ** 2 / (2 * gravity) - 10);
  const flightTime = (lift + Math.sqrt(lift ** 2 - 2 * gravity * elevation)) / gravity;
  return clamp(delta / (flightTime - 1), -5.0, 5.0);
}

function jump(target, direction) {
  const guided = target !== null;
  player.grounded = false;
  player.guided = guided;
  player.vx = guided ? aimVelocity(target) : direction * speed;
  player.vy = -activeJumpSpeed();
  if (player.vx) player.facing = Math.sign(player.vx);
  intro.classList.add('dismissed');
  burst(player.x, player.y - 1, '#f9e1b2', 8);
}

function step() {
  if (finished) return;
  tick++;
  extendRoute(Math.min(player.y, camera) - height);
  for (const [platform, vanishesAt] of crumbleTimers) {
    if (tick === vanishesAt && player.grounded && player.y === platform.y) player.grounded = false;
    if (tick === vanishesAt + respawnDelay) crumbleTimers.delete(platform);
  }
  const direction = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  const flying = tick < effects.jet;
  if (queued && player.grounded && !flying) {
    jump(queued.target, direction);
    queued = null;
  } else if (queued && queued.expires < tick) {
    queued = null;
  }

  if (direction) {
    flightTarget = null;
    player.guided = false;
    player.vx = direction * speed;
    player.facing = direction;
  } else if (flying && flightTarget !== null) {
    player.vx = clamp(flightTarget - player.x, -speed, speed);
    if (player.vx) player.facing = Math.sign(player.vx);
  } else if (!player.guided) {
    player.vx = 0;
  }

  const oldX = player.x;
  const oldFeet = player.y;
  player.x = clamp(player.x + player.vx, runnerWidth / 2, width - runnerWidth / 2);
  if (flying) {
    player.vy = -3.2;
    player.grounded = false;
  } else {
    player.vy += gravity;
  }
  player.y += player.vy;
  const wasGrounded = player.grounded;
  player.grounded = false;

  if (player.vy >= 0) {
    // Check the top surface at the instant the player's feet cross it.
    for (let i = route.length - 1; i >= 0; i--) {
      const platform = route[i];
      if (oldFeet > platform.y || player.y < platform.y || tick >= (crumbleTimers.get(platform) ?? Infinity)) continue;
      const crossing = (platform.y - oldFeet) / player.vy;
      const x = mix(oldX, player.x, crossing);
      if (x + runnerWidth / 2 <= platform.x || x - runnerWidth / 2 >= platform.x + platform.size) continue;
      if (player.x + runnerWidth / 2 <= platform.x || player.x - runnerWidth / 2 >= platform.x + platform.size) continue;
      player.y = platform.y;
      player.vy = 0;
      player.grounded = true;
      player.guided = false;
      if (!wasGrounded) {
        burst(player.x, player.y - 1, '#fff0d1', 7);
        // Only landings since the last permanent platform can take priority over it.
        landings = platform.crumbles ? [...landings.filter((surface) => surface !== platform), platform] : [platform];
      }
      if (platform.crumbles && !crumbleTimers.has(platform)) crumbleTimers.set(platform, tick + crumbleDelay);
      break;
    }
  }

  if (player.y < peak) {
    peak = player.y;
    updateHud();
  }
  collectItems();
  const target = Math.min(0, player.y - 142);
  if (target < camera) camera = Math.max(target, camera - Math.max(.55, (camera - target) * .11));
  if (player.y > camera + height + 35) loseHeart();
  updateEffects();

  // Keep the visible course and the route surrounding every eligible respawn.
  const routeBottom = Math.max(camera + height + 75, ...landings.map((surface) => surface.y + 200));
  while (route[0].y > routeBottom) crumbleTimers.delete(route.shift());

  particles = particles.filter((particle) => particle.life-- > 0);
  for (const particle of particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += .10;
  }
}

function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function colorBetween(a, b, amount) {
  return `rgb(${a.map((value, i) => Math.round(mix(value, b[i], amount))).join(',')})`;
}

function sun(x, y) {
  for (let row = -30; row <= 30; row += 2) {
    const span = Math.floor(Math.sqrt(32 ** 2 - row ** 2) / 2) * 2;
    rect(x - span, y + row, span * 2, 2, colorBetween([255, 238, 165], [255, 171, 147], (row + 30) / 60));
  }
}

function cloud(x, y, scale, light, shade) {
  const layers = [[0, 10, 40, 5], [5, 7, 31, 5], [12, 3, 20, 8], [16, 0, 10, 8], [26, 5, 11, 6], [37, 12, 7, 3]];
  for (const [dx, dy, w, h] of layers) rect(x + dx * scale, y + dy * scale, w * scale, h * scale, light);
  rect(x + 3 * scale, y + 14 * scale, 38 * scale, 2 * scale, shade);
  rect(x + 13 * scale, y + 16 * scale, 20 * scale, scale, shade);
}

function mountains(base, color, seed, amplitude) {
  for (let x = 0; x < width; x += 3) {
    const ridge = Math.abs(Math.sin(x * .023 + seed)) * .52 + Math.abs(Math.sin(x * .041 + seed)) * .28 + noise(x + seed) * .045;
    const top = base - Math.floor(ridge * amplitude / 3) * 3;
    rect(x, top, 3, Math.max(0, height - top), color);
  }
}

function pine(x, y, size, color) {
  rect(x - 1, y - size, 2, size, color);
  for (let offset = 2; offset <= size * .82; offset += 2) {
    const radius = Math.floor(offset * .30 - (offset % 8) * .21);
    rect(x - radius, y - size + offset, radius * 2 + 1, 2, color);
  }
}

function backdrop() {
  const altitude = clamp(-camera / 2300, 0, 1);
  const top = [43, 49, 99].map((v, i) => mix(v, [19, 26, 70][i], altitude));
  const bottom = [249, 164, 147].map((v, i) => mix(v, [127, 139, 213][i], altitude));
  for (let y = 0; y < height; y += 3) rect(0, y, width, 3, colorBetween(top, bottom, (y / height) ** 1.1));

  for (let i = 0; i < 78; i++) {
    const x = noise(i * 2.14) * width;
    const y = (noise(i * 8.27 + 10) * height - camera * .115) % height;
    if (y < 155 + altitude * 90) {
      const bright = i % 13 === 0;
      rect(x, y, bright ? 2 : 1, bright ? 2 : 1, bright ? '#fff0c8' : '#cab9dc');
      if (bright) {
        rect(x - 2, y + .5, 6, 1, '#e3caee');
        rect(x + .5, y - 2, 1, 6, '#e3caee');
      }
    }
  }

  sun(295, 129 - camera * .25);
  for (let i = 0; i < 13; i++) {
    const x = noise(i * 6.8 + 1) * (width + 75) - 45;
    const y = (70 + noise(i * 9.5 + 4) * 172 - camera * .38) % 320 - 16;
    const scale = i % 4 === 0 ? 2 : 1;
    cloud(x, y, scale, altitude > .65 ? '#abb6f2' : '#edb7bd', altitude > .65 ? '#8594d7' : '#ca91b1');
  }

  const shift = -camera * .4;
  if (shift < 165) {
    mountains(216 + shift, '#99759e', 1, 86);
    mountains(238 + shift, '#695c91', 4, 72);
    mountains(253 + shift, '#4d507e', 8, 52);
    for (let i = 0; i < 68; i++) {
      const x = i * 7.2;
      const y = 240 + shift + Math.sin(i * .39) * 5;
      pine(x, y, 11 + noise(i * 3) * 23, i % 4 === 0 ? '#40476d' : '#383e64');
    }
  }
}

function platformArt(platform) {
  const { x, y, size, index, crumbles } = platform;
  const screenY = Math.round(y - camera);
  if (screenY < -32 || screenY > height) return;

  if (crumbles) {
    const vanishesAt = crumbleTimers.get(platform);
    let opacity = 1;
    if (vanishesAt !== undefined) {
      const ticksUntilVanish = vanishesAt - tick;
      opacity = ticksUntilVanish > 0
        ? ticksUntilVanish / crumbleDelay
        : clamp(1 - (ticksUntilVanish + respawnDelay) / fadeInDuration, 0, 1);
    }
    if (opacity === 0) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    rect(x + 3, screenY + 3, size - 6, 9, '#694760');
    rect(x + 8, screenY + 11, size - 16, 4, '#513a59');
    rect(x, screenY, size, 4, '#ffc778');
    for (let offset = 6; offset < size - 7; offset += 11) {
      rect(x + offset, screenY + 4, 2, 4, '#d78e62');
      rect(x + offset + 2, screenY + 7, 3, 2, '#d78e62');
    }
    ctx.restore();
    return;
  }

  if ((floor - y) / pixelsPerMeter >= 1050) {
    rect(x + 2, screenY + 2, size - 4, 8, '#afbced');
    rect(x + 7, screenY + 9, size - 14, 5, '#7b8bcb');
    rect(x + 13, screenY + 14, size - 26, 2, '#606caf');
    rect(x, screenY, size, 5, '#fcf5ff');
    for (let i = 0; i < size - 10; i += 12) {
      const rise = 2 + Math.floor(noise(index + i) * 5);
      rect(x + i + 4, screenY - rise, 9, rise + 2, '#fcf5ff');
    }
    return;
  }

  const ground = index === 0;
  const rock = (floor - y) / pixelsPerMeter >= 200;
  const dark = rock ? '#393751' : '#4e304e';
  const middle = rock ? '#635675' : '#81475a';
  const turf = rock ? '#73c3ab' : '#55a67d';
  const edge = rock ? '#a7ead2' : '#a6e4a4';
  rect(x, screenY + 2, size, ground ? 76 : 10, dark);
  rect(x + 3, screenY + 4, size - 6, ground ? 35 : 6, middle);
  if (!ground) {
    rect(x + 4, screenY + 12, size - 8, 4, dark);
    rect(x + 10, screenY + 16, size - 20, 3, dark);
  }
  rect(x, screenY + 2, size, 4, turf);
  rect(x, screenY, size, 2, edge);

  for (let i = 4; i < size - 5; i += 6) {
    const seed = index * 107 + i;
    rect(x + i, screenY + 5, 2, 1 + Math.floor(noise(seed) * 4), turf);
    rect(x + i + 2, screenY + 9 + Math.floor(noise(seed + 2) * (ground ? 26 : 3)), 2, 2, dark);
    if (noise(seed + 3) > .48) {
      rect(x + i, screenY - 3, 1, 3, turf);
      rect(x + i + 1, screenY - 2, 1, 2, edge);
    }
    if (noise(seed + 5) > .84) {
      rect(x + i + 2, screenY - 5, 1, 5, turf);
      rect(x + i + 1, screenY - 6, 3, 2, seed % 2 ? '#fbbfae' : '#ffe19b');
    }
  }
}

function character() {
  const stride = player.grounded && player.vx ? Math.floor(tick / 5) % 2 : 0;
  const rising = !player.grounded && player.vy < 0;
  ctx.save();
  ctx.translate(Math.round(player.x), Math.round(player.y - camera - runnerHeight));
  ctx.scale(player.facing, 1);
  if (tick < effects.jet) {
    rect(-10, 9, 5, 8, '#56b8df');
    rect(-10, 10, 2, 5, '#c2edff');
    rect(-9, 17, 3, player.vy < 0 ? 6 + tick % 3 : 3, '#ffad73');
  }
  rect(-8, -1, 14, 12, '#2b2544');
  rect(-9, 7, 15, 7, '#2b2544');
  rect(-5, 13, 11, 3, '#2b2544');
  rect(-7, 0, 12, 8, '#e18c4b');
  rect(-5, 0, 9, 3, '#ffd785');
  rect(-8, 5, 13, 3, '#f7b365');
  rect(0, 4, 6, 7, '#ffe0a1');
  rect(4, 5, 2, 2, '#3a2c47');
  rect(-7, 8, 11, 4, '#df5272');
  rect(rising ? -14 : -12, 10, rising ? 8 : 6, 3, '#df5272');
  rect(-4, 12, 9, 4, '#83d7c7');
  rect(-4, 14, 2, 2, '#48918e');
  const shoeColor = tick < effects.boots ? powerUps.boots.color : '#403050';
  rect(-5, 16 - stride, 4, 3, shoeColor);
  rect(2, 16 + stride - Number(rising), 4, 3, shoeColor);
  ctx.restore();
}

function itemArt(surface) {
  const { item } = surface;
  if (!item) return;
  const x = Math.round(surface.x + surface.size / 2);
  const y = Math.round(surface.y - camera - 13 + Math.sin(tick / 14 + surface.index) * 2);
  if (y < -10 || y > height + 10) return;
  if (item === 'coin') {
    rect(x - 3, y - 5, 6, 10, '#9d5e45');
    rect(x - 4, y - 3, 8, 6, '#9d5e45');
    rect(x - 3, y - 4, 6, 7, '#ffd37c');
    rect(x - 1, y - 3, 2, 5, '#fff0b3');
    return;
  }
  const { color } = powerUps[item];
  rect(x - 7, y - 7, 14, 14, '#232541');
  rect(x - 5, y - 8, 10, 1, color);
  rect(x - 5, y + 7, 10, 1, color);
  if (item === 'boots') {
    rect(x - 4, y - 4, 4, 6, color);
    rect(x - 4, y, 9, 3, color);
    rect(x - 3, y + 4, 7, 1, '#f0ffb6');
  } else if (item === 'double') {
    ctx.fillStyle = color;
    ctx.font = 'bold 9px monospace';
    ctx.fillText('2×', x - 5, y + 3);
  } else if (item === 'heart') {
    rect(x - 4, y - 4, 3, 2, color);
    rect(x + 1, y - 4, 3, 2, color);
    rect(x - 5, y - 2, 10, 3, color);
    rect(x - 3, y + 1, 6, 2, color);
    rect(x - 1, y + 3, 2, 2, color);
  } else {
    rect(x - 4, y - 4, 3, 7, color);
    rect(x + 1, y - 4, 3, 7, color);
    rect(x - 4, y + 3, 2, 2, '#ffad73');
    rect(x + 2, y + 3, 2, 2, '#ffad73');
  }
}

function draw() {
  backdrop();
  route.forEach(platformArt);
  route.forEach(itemArt);
  for (const p of particles) rect(p.x, p.y - camera, 2, 2, p.color);
  character();

  if (aim.visible && player.grounded && !finished && tick >= effects.jet) {
    const vx = aimVelocity({ x: aim.x, y: aim.y + camera });
    const lift = activeJumpSpeed();
    for (let time = 4; time < 33; time += 4) {
      const x = player.x + vx * time;
      const y = player.y - camera - lift * time + gravity * time * (time + 1) / 2;
      if (x > 2 && x < width - 2 && y > 2) rect(x, y - 3, 2, 2, '#fff0c3');
    }
  }
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) * width / bounds.width, y: (event.clientY - bounds.top) * height / bounds.height };
}

canvas.addEventListener('pointermove', (event) => Object.assign(aim, pointerPosition(event), { visible: true }));
canvas.addEventListener('pointerleave', () => { aim.visible = false; });
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || finished) return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  const target = pointerPosition(event);
  if (tick < effects.jet) {
    flightTarget = target.x;
    return;
  }
  target.y += camera;
  queued = { target, expires: tick + 8 };
});
window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'KeyR' && !event.repeat) {
    reset();
    canvas.focus({ preventScroll: true });
  }
  if (event.target instanceof HTMLButtonElement) return;
  if (event.code === 'KeyA' || event.code === 'KeyD') keys.add(event.code);
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat && !finished) queued = { target: null, expires: tick + 8 };
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); queued = null; });
for (const button of [document.querySelector('#restart'), replay]) {
  button.addEventListener('click', () => { reset(); canvas.focus({ preventScroll: true }); });
}

reset();
draw();
let previousTime;
let accumulator = 0;
function frame(time) {
  previousTime ??= time;
  accumulator += Math.min(time - previousTime, 83);
  previousTime = time;
  while (accumulator >= 1000 / ticksPerSecond) {
    step();
    accumulator -= 1000 / ticksPerSecond;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
