
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { CHAMPS, ITEMS, makeBuild, cast, update } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const db = new Database(process.env.DB_FILE || 'proje1.sqlite');
const secret = process.env.JWT_SECRET;

if (!secret) throw new Error('JWT_SECRET ortam değişkeni tanımlanmalı');

app.use(cors());
app.use(express.json());
app.use(express.static(distPath));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY,
 name TEXT UNIQUE,
 hash TEXT
);
CREATE TABLE IF NOT EXISTS friends(
 owner TEXT,
 friend TEXT,
 PRIMARY KEY(owner,friend)
);
CREATE TABLE IF NOT EXISTS matches(
 id TEXT PRIMARY KEY,
 room TEXT,
 a TEXT,
 b TEXT,
 winner TEXT,
 started INTEGER,
 ended INTEGER,
 stats TEXT
);
`);

const rooms = new Map();
const resumes = new Map();

const auth = (req, res, next) => {
 try {
  req.user = jwt.verify(
   (req.headers.authorization || '').replace('Bearer ', ''),
   secret
  );
  next();
 } catch {
  res.status(401).json({ error: 'Oturum gerekli' });
 }
};

app.get('/api/data', (_, res) =>
 res.json({ champs: CHAMPS, items: ITEMS })
);

app.get('/api/health', (_, res) =>
 res.json({ ok: true })
);

app.post('/api/register', async (req, res) => {
 try {
  const name = String(req.body.name || '').trim().slice(0, 18);
  const pass = String(req.body.password || '');

  if (name.length < 3 || pass.length < 8) {
   return res.status(400).json({
    error: 'İsim en az 3, parola en az 8 karakter olmalı'
   });
  }

  const id = randomUUID();

  db.prepare('INSERT INTO users VALUES(?,?,?)')
   .run(id, name, await bcrypt.hash(pass, 12));

  res.json({
   token: jwt.sign({ id, name }, secret, { expiresIn: '30d' }),
   user: { id, name }
  });
 } catch {
  res.status(409).json({ error: 'Bu kullanıcı adı kullanılıyor' });
 }
});

app.post('/api/login', async (req, res) => {
 const u = db.prepare('SELECT * FROM users WHERE name=?')
  .get(req.body.name);

 if (!u || !await bcrypt.compare(req.body.password || '', u.hash)) {
  return res.status(401).json({ error: 'Giriş bilgileri hatalı' });
 }

 res.json({
  token: jwt.sign({ id: u.id, name: u.name }, secret, { expiresIn: '30d' }),
  user: { id: u.id, name: u.name }
 });
});

app.get('/api/friends', auth, (req, res) => {
 res.json(
  db.prepare(
   'SELECT u.id,u.name FROM friends f JOIN users u ON u.id=f.friend WHERE f.owner=?'
  ).all(req.user.id)
 );
});

app.post('/api/friends', auth, (req, res) => {
 const u = db.prepare('SELECT id FROM users WHERE name=?')
  .get(req.body.name);

 if (!u || u.id === req.user.id) {
  return res.status(404).json({ error: 'Oyuncu bulunamadı' });
 }

 db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)')
  .run(req.user.id, u.id);

 db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)')
  .run(u.id, req.user.id);

 res.json({ ok: true });
});

app.get('/api/history', auth, (req, res) => {
 res.json(
  db.prepare(
   'SELECT * FROM matches WHERE a=? OR b=? ORDER BY ended DESC LIMIT 50'
  ).all(req.user.id, req.user.id)
 );
});

const roomCode = () => randomBytes(3).toString('hex').toUpperCase();

const view = room => ({
 code: room.code,
 host: room.host,
 status: room.status,
 remaining: room.remaining,
 winner: room.winner,
 players: Object.values(room.players).map(p => ({
  id: p.id,
  name: p.name,
  champId: p.champId,
  role: p.role,
  hp: p.hp,
  maxHp: p.maxHp,
  mana: p.mana,
  maxMana: p.maxMana,
  shield: p.shield,
  items: p.items,
  ready: p.ready,
  cc: p.cc,
  position: p.position,
  disconnected: !!p.disconnected
 }))
});

function broadcast(room) {
 io.to(room.code).emit('room:update', view(room));
}

function removePlayer(room, id) {
 delete room.players[id];

 if (Object.keys(room.players).length) {
  room.host = Object.keys(room.players)[0];
 } else {
  rooms.delete(room.code);
 }
}

io.use((socket, next) => {
 try {
  socket.user = socket.handshake.auth?.token
   ? jwt.verify(socket.handshake.auth.token, secret)
   : null;
  next();
 } catch {
  next(new Error('Oturum geçersiz'));
 }
});

io.on('connection', socket => {
 const ident = socket.user || {
  id: 'guest:' + randomUUID(),
  name: 'Misafir'
 };

 function attach(room) {
  let p = room.players[ident.id];

  if (!p) {
   if (Object.keys(room.players).length >= 2) {
    throw Error('Oda dolu');
   }

   p = {
    ...makeBuild('veyra'),
    id: ident.id,
    name: ident.name,
    ready: false,
    position: {
     x: 25 + Object.keys(room.players).length * 50,
     y: 50
    },
    lastMove: Date.now(),
    socket: socket.id
   };

   room.players[ident.id] = p;
  }

  p.socket = socket.id;
  p.disconnected = false;
  delete p.disconnectedAt;

  socket.data.room = room.code;
  socket.data.pid = ident.id;
  socket.join(room.code);

  broadcast(room);
  return p;
 }

 socket.on('room:create', (_, ack = () => {}) => {
  const room = {
   code: roomCode(),
   host: ident.id,
   status: 'lobby',
   players: {},
   remaining: 120,
   rematches: new Set()
  };

  rooms.set(room.code, room);

  try {
   attach(room);
   ack({ ok: true, room: view(room), playerId: ident.id });
  } catch (error) {
   rooms.delete(room.code);
   ack({ error: error.message });
  }
 });

 socket.on('room:join', ({ code } = {}, ack = () => {}) => {
  const room = rooms.get(String(code || '').toUpperCase());

  if (!room || room.status !== 'lobby') {
   return ack({ error: 'Oda bulunamadı' });
  }

  try {
   attach(room);
   ack({ ok: true, room: view(room), playerId: ident.id });
  } catch (error) {
   ack({ error: error.message });
  }
 });

 socket.on('loadout:set', ({ champId, items = [] } = {}, ack = () => {}) => {
  const room = rooms.get(socket.data.room);
  const p = room?.players[socket.data.pid];

  try {
   if (!p || room.status !== 'lobby') throw Error('Lobi kapalı');

   const build = makeBuild(champId, items);

   Object.assign(p, build, {
    id: p.id,
    name: p.name,
    socket: socket.id,
    ready: false,
    position: p.position,
    lastMove: Date.now()
   });

   ack({ ok: true });
   broadcast(room);
  } catch (error) {
   ack({ error: error.message });
  }
 });

 socket.on('player:ready', ({ ready } = {}, ack = () => {}) => {
  const room = rooms.get(socket.data.room);
  const p = room?.players[socket.data.pid];

  if (!p || room.status !== 'lobby') {
   return ack({ error: 'Hazır olunamadı' });
  }

  p.ready = !!ready;
  ack({ ok: true });
  broadcast(room);
 });

 socket.on('match:start', (_, ack = () => {}) => {
  const room = rooms.get(socket.data.room);

  if (
   !room ||
   room.host !== ident.id ||
   Object.keys(room.players).length !== 2 ||
   !Object.values(room.players).every(p => p.ready)
  ) {
   return ack({
    error: 'İki oyuncu hazır olmalı; başlatma yetkisi oda sahibinde'
   });
  }

  room.status = 'battle';
  room.startedAt = room.lastTick = Date.now();
  room.remaining = 120;
  room.matchId = randomUUID();
  room.saved = false;

  broadcast(room);
  ack({ ok: true });
 });

 socket.on('battle:cast', ({ key } = {}, ack = () => {}) => {
  const room = rooms.get(socket.data.room);

  try {
   const result = cast(room, socket.data.pid, key);
   broadcast(room);
   ack({ ok: true, result });
  } catch (error) {
   ack({ error: error.message });
  }
 });

 socket.on('battle:move', ({ x, y } = {}, ack = () => {}) => {
  const room = rooms.get(socket.data.room);
  const p = room?.players[socket.data.pid];

  if (!p || room.status !== 'battle') {
   return ack({ error: 'Savaş aktif değil' });
  }

  const now = Date.now();
  const elapsed = Math.min(1000, Math.max(0, now - (p.lastMove || now)));
  p.lastMove = now;

  const slow = p.slowUntil > now ? 0.5 : 1;
  const maxDistance = elapsed * 0.025 * slow;

  const targetX = Math.max(0, Math.min(100, Number(x) || 0));
  const targetY = Math.max(0, Math.min(100, Number(y) || 0));

  const dx = targetX - p.position.x;
  const dy = targetY - p.position.y;
  const distance = Math.hypot(dx, dy);

  if (distance > maxDistance && distance > 0) {
   p.position = {
    x: p.position.x + dx / distance * maxDistance,
    y: p.position.y + dy / distance * maxDistance
   };
  } else {
   p.position = { x: targetX, y: targetY };
  }

  socket.to(room.code).emit('battle:position', {
   id: p.id,
   position: p.position
  });

  ack({ ok: true, position: p.position });
 });

 socket.on('expression:send', ({ expression } = {}, ack = () => {}) => {
  if (!['😂', '😭', '😡'].includes(expression)) {
   return ack({ error: 'Geçersiz ifade' });
  }

  const room = rooms.get(socket.data.room);

  if (!room || room.status !== 'battle') {
   return ack({ error: 'Savaş aktif değil' });
  }

  socket.to(room.code).emit('expression:show', {
   id: socket.data.pid,
   expression
  });

  ack({ ok: true });
 });

 socket.on('match:rematch', (_, ack = () => {}) => {
  const room = rooms.get(socket.data.room);

  if (!room || room.status !== 'finished') {
   return ack({ error: 'Maç bitmedi' });
  }

  room.rematches.add(socket.data.pid);

  if (room.rematches.size === 2) {
   room.status = 'lobby';
   room.winner = null;
   room.rematches.clear();
   room.startedAt = null;
   room.finishedAt = null;
   room.saved = false;

   for (const p of Object.values(room.players)) {
    Object.assign(p, makeBuild(p.champId, p.items), {
     id: p.id,
     name: p.name,
     ready: false,
     position: p.position,
     socket: p.socket,
     lastMove: Date.now()
    });
   }

   broadcast(room);
  }

  ack({ ok: true });
 });

 socket.on('room:leave', (_, ack = () => {}) => {
  leave();
  ack({ ok: true });
 });

 function leave() {
  const room = rooms.get(socket.data.room);
  const id = socket.data.pid;

  if (!room || !id) return;

  removePlayer(room, id);
  socket.leave(room.code);

  if (rooms.has(room.code)) broadcast(room);

  socket.data.room = null;
  socket.data.pid = null;
 }

 socket.on('disconnect', () => {
  const room = rooms.get(socket.data.room);
  const p = room?.players[socket.data.pid];

  if (!p) return;

  p.disconnected = true;
  p.disconnectedAt = Date.now();

  const resumeToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(resumeToken).digest('hex');

  resumes.set(tokenHash, {
   room: room.code,
   id: p.id,
   expires: Date.now() + 30000
  });

  // Token yalnızca kopan oyuncunun tarayıcısına önceden
  // güvenli şekilde kaydedilmişse kullanılabilir.
  // Bu sürümde istemci entegrasyonu henüz tamamlanmadı.
  p.resumeTokenHash = tokenHash;

  io.to(room.code).emit('player:disconnected', {
   id: p.id,
   graceMs: 30000
  });
 });

 socket.on('session:resume', ({ resumeToken } = {}, ack = () => {}) => {
  const tokenHash = typeof resumeToken === 'string'
   ? createHash('sha256').update(resumeToken).digest('hex')
   : '';

  const v = resumes.get(tokenHash);
  const room = v && rooms.get(v.room);
  const p = room?.players[v.id];

  if (
   !v ||
   v.expires < Date.now() ||
   !p ||
   !p.disconnected ||
   p.resumeTokenHash !== tokenHash
  ) {
   return ack({ error: 'Geri dönüş süresi doldu' });
  }

  resumes.delete(tokenHash);
  delete p.resumeTokenHash;
  p.socket = socket.id;
  p.disconnected = false;
  delete p.disconnectedAt;

  socket.data.room = room.code;
  socket.data.pid = p.id;
  socket.join(room.code);

  ack({ ok: true, room: view(room) });
  broadcast(room);
 });
});

setInterval(() => {
 const now = Date.now();

 for (const room of [...rooms.values()]) {
  if (room.status === 'battle') {
   update(room, now);

   if (room.status === 'finished' && !room.saved) {
    room.saved = true;

    const players = Object.values(room.players);

    if (players.length === 2) {
     db.prepare('INSERT OR IGNORE INTO matches VALUES(?,?,?,?,?,?,?,?)')
      .run(
       room.matchId,
       room.code,
       players[0].id,
       players[1].id,
       room.winner,
       room.startedAt,
       room.finishedAt || now,
       JSON.stringify(players.map(p => ({
        champId: p.champId,
        hp: p.hp,
        maxHp: p.maxHp,
        items: p.items
       })))
      );
    }
   }

   broadcast(room);
  }

  for (const [id, p] of Object.entries(room.players)) {
   if (p.disconnected && now - (p.disconnectedAt || now) > 30000) {
    removePlayer(room, id);

    if (rooms.has(room.code)) broadcast(room);
    break;
   }
  }
 }

 for (const [token, value] of resumes) {
  if (value.expires < now) resumes.delete(token);
 }
}, 200);

app.get('*', (req, res, next) => {
 if (req.path.startsWith('/api/')) return next();

 res.sendFile(path.join(distPath, 'index.html'), error => {
  if (error) next(error);
 });
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
 console.log('Proje1 server ' + port);
});
