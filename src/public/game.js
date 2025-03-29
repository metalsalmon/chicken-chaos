const socket = io();
let myId = null;
let players = {};
let corn = [];
let obstacles = [];
let spits = [];

let mouseX = 0;
let mouseY = 0;

const startBtn = document.getElementById('start-button');
const nameInput = document.getElementById('name-input');
const gameUI = document.getElementById('game-ui');
const leaderboard = document.getElementById('leaderboard');
const timerDisplay = document.getElementById('timer');
const ammoDisplay = document.getElementById('ammo');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const endScreen = document.getElementById('end-screen');
const winnerMsg = document.getElementById('winner-msg');
const countdownEl = document.getElementById('countdown');

const chatInput = document.getElementById('chat-input');
const chatBox = document.getElementById('chat-messages');

const chickenImg = new Image();
chickenImg.src = 'chicken-icon.png';

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

canvas.addEventListener('click', () => {
  const p = players[myId];
  if (p && p.spitAmmo > 0) {
    socket.emit('spit', { x: mouseX, y: mouseY });
  }
});

startBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return;

  const music = document.getElementById('bg-music');
  if (music && music.dataset.started !== 'true') {
    music.muted = false;
    music.play().catch(() => {});
    music.dataset.started = 'true';
  }

  socket.emit('setName', name);
  document.getElementById('start-screen').style.display = 'none';
  gameUI.style.display = 'block';
};

setInterval(() => {
  const p = players[myId];
  if (p) {
    const dx = mouseX - p.x;
    const dy = mouseY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = 2.5;
    let vx = 0, vy = 0;
    if (dist > 10) {
      vx = (dx / dist) * speed;
      vy = (dy / dist) * speed;
    }
    socket.emit('mouseMove', { vx, vy });
  }
}, 1000 / 60);

socket.on('connect', () => {
  myId = socket.id;
});

socket.on('state', (data) => {
  players = data.players;
  corn = data.corn;
  obstacles = data.obstacles;
  spits = data.spits;

  const secs = Math.floor(data.timeRemaining / 1000);
  timerDisplay.textContent = `Time Remaining: ${secs}`;
  if (players[myId]) {
    ammoDisplay.textContent = `Spits Left: ${players[myId].spitAmmo}`;
  }

  if (secs <= 5) {
    timerDisplay.classList.add('blink');
  } else {
    timerDisplay.classList.remove('blink');
  }

  render();
});

socket.on('gameReset', () => {
  endScreen.style.display = 'none';
});

socket.on('endRound', (data) => {
  if (data && data.winner) {
    winnerMsg.textContent = `🏆 ${data.winner.name} wins with ${data.winner.score} points!`;
  } else {
    winnerMsg.textContent = 'No winner this round.';
  }
  endScreen.style.display = 'flex';
  let countdown = data.countdown;
  countdownEl.textContent = countdown;
  const interval = setInterval(() => {
    countdown--;
    countdownEl.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(interval);
      endScreen.style.display = 'none';
    }
  }, 1000);
});

function render() {
  ctx.fillStyle = '#98ff98';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const o of obstacles) {
    ctx.fillStyle = '#8d6e63';
    if (o.type === 'L') {
      ctx.fillRect(o.x, o.y, o.w / 3, o.h);
      ctx.fillRect(o.x, o.y + o.h * 2 / 3, o.w, o.h / 3);
    } else {
      ctx.fillRect(o.x, o.y, o.w, o.h);
    }
  }

  for (const s of spits) {
    ctx.fillStyle = 'lime';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const c of corn) {
    ctx.fillStyle = c.ammo ? 'blue' : c.power ? 'deeppink' : 'gold';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  const now = Date.now();
  Object.entries(players).forEach(([id, p]) => {
    const size = 24;
    ctx.save();
    ctx.translate(p.x, p.y);

    let tint = null;
    if (id === myId) tint = 'yellow';
    else if (p.stunnedUntil && now < p.stunnedUntil) tint = 'blue';
    else if (p.invincibleUntil && now < p.invincibleUntil) tint = 'cyan';

    if (tint) {
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(0, 0, size / 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.drawImage(chickenImg, -size / 2, -size / 2, size, size);
    ctx.restore();

    ctx.fillStyle = 'black';
    ctx.fillText(p.name, p.x - 15, p.y - 20);
  });

  const sorted = Object.entries(players).sort((a, b) => b[1].score - a[1].score);
  leaderboard.innerHTML = sorted.map(([id, p], i) =>
    `<li><strong>${i + 1}.</strong> ${p.name}: ${p.score}</li>`
  ).join('');
}

// CHAT HANDLING
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const msg = chatInput.value.trim();
    if (msg) {
      socket.emit('chatMessage', msg);
      chatInput.value = '';
    }
  }
});

socket.on('chatMessage', ({ id, name, message }) => {
  const el = document.createElement('div');
  const isMine = id === myId;
  const displayName = isMine ? 'me' : name;
  const nameClass = isMine ? 'chat-name me-name' : 'chat-name';

  el.innerHTML = `<span class="${nameClass}">${displayName}:</span> ${message}`;
  chatBox.appendChild(el);

  while (chatBox.children.length > 6) {
    chatBox.removeChild(chatBox.firstChild);
  }
});

const muteToggle = document.getElementById('mute-toggle');
const bgMusic = document.getElementById('bg-music');

muteToggle.addEventListener('click', () => {
  if (!bgMusic.dataset.started || bgMusic.dataset.started === "false") {
    // music hasn't started yet
    bgMusic.play().catch(() => {});
    bgMusic.dataset.started = "true";
  }

  bgMusic.muted = !bgMusic.muted;
  muteToggle.textContent = bgMusic.muted ? '🔇 Unmute' : '🔊 Mute';
});