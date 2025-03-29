const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const SPEED = 2.5;
const GAME_DURATION = 120000; // 2 minutes
const ROUND_DELAY = 10000;    // 10 seconds

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let corn = [];
let obstacles = [];
let spits = [];
let gameStartTime = Date.now();
let gameInterval;

function isCollidingWithObstacle(x, y, buffer = 12) {
  return obstacles.some(o =>
    x > o.x - buffer && x < o.x + o.w + buffer &&
    y > o.y - buffer && y < o.y + o.h + buffer
  );
}

function generateMap() {
  corn = [];
  obstacles = [];
  spits = [];

  const types = ['box', 'vwall', 'hwall', 'L'];
  for (let i = 0; i < 12; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const w = type === 'vwall' ? 20 : type === 'hwall' ? 80 : 40;
    const h = type === 'vwall' ? 80 : type === 'hwall' ? 20 : 40;
    obstacles.push({
      type,
      x: Math.random() * (GAME_WIDTH - w),
      y: Math.random() * (GAME_HEIGHT - h),
      w,
      h
    });
  }

  let tries = 0;
  while (corn.length < 30 && tries < 1000) {
    const x = Math.random() * GAME_WIDTH;
    const y = Math.random() * GAME_HEIGHT;
    if (!isCollidingWithObstacle(x, y, 10)) {
      corn.push({ x, y });
    }
    tries++;
  }
}

function resetGame() {
  generateMap();
  gameStartTime = Date.now();
  for (const id in players) {
    let x, y;
    do {
      x = Math.random() * GAME_WIDTH;
      y = Math.random() * GAME_HEIGHT;
    } while (isCollidingWithObstacle(x, y, 15));

    players[id].x = x;
    players[id].y = y;
    players[id].score = 0;
    players[id].vx = 0;
    players[id].vy = 0;
    players[id].stunnedUntil = 0;
    players[id].invincibleUntil = 0;
    players[id].spitAmmo = 10;
  }
  gameInterval = setInterval(updateGame, 1000 / 60);
}

function updateGame() {
  const now = Date.now();
  const timeRemaining = Math.max(0, GAME_DURATION - (now - gameStartTime));

  if (Math.random() < 0.02) { // 🔼 increased spawn rate (was 0.002)
    const x = Math.random() * GAME_WIDTH;
    const y = Math.random() * GAME_HEIGHT;
  
    if (!isCollidingWithObstacle(x, y, 10)) {
      const roll = Math.random();
      let newCorn = { x, y };
  
      if (roll < 0.1) {
        newCorn.power = true; // 🌸 Pink corn (10% chance)
      } else if (roll < 0.3) {
        newCorn.ammo = true;  // 🔵 Blue corn (20% chance)
      }
      // Otherwise, yellow corn by default
  
      corn.push(newCorn);
    }
  }

  for (let i = spits.length - 1; i >= 0; i--) {
    const s = spits[i];
    s.x += s.vx;
    s.y += s.vy;

    if (isCollidingWithObstacle(s.x, s.y, 6)) {
      spits.splice(i, 1);
      continue;
    }

    for (const id in players) {
      const p = players[id];
      if (
        id !== s.owner &&
        (!p.invincibleUntil || now > p.invincibleUntil) &&
        (!p.stunnedUntil || now > p.stunnedUntil)
      ) {
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        if (dx * dx + dy * dy < 20 * 20) {
          p.stunnedUntil = now + 2000;
          p.invincibleUntil = now + 3000;
          spits.splice(i, 1);
          break;
        }
      }
    }

    if (s.x < 0 || s.x > GAME_WIDTH || s.y < 0 || s.y > GAME_HEIGHT) {
      spits.splice(i, 1);
    }
  }

  for (const id in players) {
    const p = players[id];
    if (!p.stunnedUntil || now > p.stunnedUntil) {
      const nextX = p.x + p.vx;
      const nextY = p.y + p.vy;
      if (!isCollidingWithObstacle(nextX, p.y)) p.x = nextX;
      if (!isCollidingWithObstacle(p.x, nextY)) p.y = nextY;
    }
    p.x = Math.max(0, Math.min(GAME_WIDTH, p.x));
    p.y = Math.max(0, Math.min(GAME_HEIGHT, p.y));
  }

  for (const id in players) {
    const p = players[id];
    for (let i = corn.length - 1; i >= 0; i--) {
      const c = corn[i];
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (dx * dx + dy * dy < 20 * 20) {
        if (c.power) p.score += 5;
        else if (c.ammo) p.spitAmmo = Math.min(20, p.spitAmmo + 3);
        else p.score += 1;
        corn.splice(i, 1);
      }
    }
  }

  if (timeRemaining === 0 || corn.length === 0) {
    clearInterval(gameInterval);
    const sorted = Object.entries(players)
      .map(([id, p]) => ({ id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
    const winner = sorted[0] || null;

    io.emit('endRound', { winner, countdown: 10 });

    setTimeout(() => {
      resetGame();
    }, ROUND_DELAY);

    return;
  }

  io.emit('state', {
    players,
    corn,
    obstacles,
    spits,
    timeRemaining
  });
}

io.on('connection', (socket) => {
  players[socket.id] = {
    id: socket.id,
    name: 'Chicken',
    x: 0, y: 0, vx: 0, vy: 0, score: 0,
    stunnedUntil: 0,
    invincibleUntil: 0,
    spitAmmo: 10
  };

  socket.on('setName', (name) => {
    if (players[socket.id]) players[socket.id].name = name;
  });

  socket.on('mouseMove', ({ vx, vy }) => {
    const p = players[socket.id];
    if (p && (!p.stunnedUntil || Date.now() > p.stunnedUntil)) {
      p.vx = vx;
      p.vy = vy;
    }
  });

  socket.on('spit', ({ x, y }) => {
    const p = players[socket.id];
    if (!p || p.spitAmmo <= 0) return;
    p.spitAmmo--;

    const dx = x - p.x;
    const dy = y - p.y;
    const dist = Math.hypot(dx, dy);
    const speed = 6;

    spits.push({
      owner: socket.id,
      x: p.x,
      y: p.y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed
    });
  });

  socket.on('chatMessage', (message) => {
    const player = players[socket.id];
    if (!player) return;
  
    const safeMessage = message.substring(0, 40); // ✅ now it's defined
  
    io.emit('chatMessage', {
      id: socket.id,
      name: player.name,
      message: safeMessage
    });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Chicken Chaos server running at http://localhost:${PORT}`);
  resetGame();
});
