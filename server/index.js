
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { CHAMPS, ITEMS, makeBuild, cast, update } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const db = new Database(process.env.DB_FILE || 'proje1.sqlite');
const secret = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_BEFORE_DEPLOYMENT';

app.use(cors());
app.use(express.json());

// Web arayüzünü yayınla
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

app.get('/api/data', (_, r) =>
 r.json({ champs: CHAMPS, items: ITEMS })
);

app.get('/api/health', (_, r) =>
 r.json({ ok: true })
);

app.post('/api/register', async (q, r) => {
 try {
  let name = String(q.body.name || '').trim().slice(0, 18);
  let pass = String(q.body.password || '');

  if (name.length < 3 || pass.length < 8)
   return r.status(400).json({
    error: 'İsim 3, parola 8 karakterden uzun olmalı'
   });

  let id = randomUUID();

  db.prepare('INSERT INTO users VALUES(?,?,?)')
   .run(id, name, await bcrypt.hash(pass, 12));

  r.json({
   token: jwt.sign({ id, name }, secret, { expiresIn: '30d' }),
   user: { id, name }
  });
 } catch {
  r.status(409).json({ error: 'Bu kullanıcı adı kullanılıyor' });
 }
});

app.post('/api/login', async (q, r) => {
 let u = db.prepare('SELECT * FROM users WHERE name=?')
  .get(q.body.name);

 if (!u || !await bcrypt.compare(q.body.password || '', u.hash))
  return r.status(401).json({ error: 'Giriş bilgileri hatalı' });

 r.json({
  token: jwt.sign({ id: u.id, name: u.name }, secret, { expiresIn: '30d' }),
  user: { id: u.id, name: u.name }
 });
});

app.get('/api/friends', auth, (q, r) => {
 r.json(
  db.prepare(
   'SELECT u.id,u.name FROM friends f JOIN users u ON u.id=f.friend WHERE f.owner=?'
  ).all(q.user.id)
 );
});

app.post('/api/friends', auth, (q, r) => {
 let u = db.prepare('SELECT id FROM users WHERE name=?')
  .get(q.body.name);

 if (!u || u.id === q.user.id)
  return r.status(404).json({ error: 'Oyuncu bulunamadı' });

 db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)')
  .run(q.user.id, u.id);

 db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)')
  .run(u.id, q.user.id);

 r.json({ ok: true });
});

app.get('/api/history', auth, (q, r) => {
 r.json(
  db.prepare(
   'SELECT * FROM matches WHERE a=? OR b=? ORDER BY ended DESC LIMIT 50'
  ).all(q.user.id, q.user.id)
 );
});

const roomCode = () => randomBytes(3).toString('hex').toUpperCase();

const view = r => ({
 code: r.code,
 host: r.host,
 status: r.status,
 remaining: r.remaining,
 winner: r.winner,
 players: Object.values(r.players).map(p => ({
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
  position: p.position
 }))
});

function broadcast(r) {
 io.to(r.code).emit('room:update', view(r));
}

io.use((s, n) => {
 try {
  s.user = s.handshake.auth?.token
   ? jwt.verify(s.handshake.auth.token, secret)
   : null;
  n();
 } catch {
  n(new Error('Oturum geçersiz'));
 }
});

io.on('connection', s => {
 const ident = s.user || {
  id: 'guest:' + randomUUID(),
  name: 'Misafir'
 };

 function attach(r) {
  let p = r.players[ident.id];

  if (!p) {
   if (Object.keys(r.players).length >= 2)
    throw Error('Oda dolu');

   p = {
    ...makeBuild('veyra'),
    id: ident.id,
    name: ident.name,
    ready: false,
    position: {
     x: 25 + Object.keys(r.players).length * 50,
     y: 50
    },
    socket: s.id
   };

   r.players[ident.id] = p;
  }

  p.socket = s.id;
  s.data.room = r.code;
  s.data.pid = ident.id;
  s.join(r.code);

  broadcast(r);
  return p;
 }

 s.on('room:create', (_, ack = () => {}) => {
  let r = {
   code: roomCode(),
   host: ident.id,
   status: 'lobby',
   players: {},
   remaining: 120,
   rematches: new Set()
  };

  rooms.set(r.code, r);

  try {
   attach(r);
   ack({ ok: true, room: view(r) });
  } catch (e) {
   ack({ error: e.message });
  }
 });

 s.on('room:join', ({ code } = {}, ack = () => {}) => {
  let r = rooms.get(String(code || '').toUpperCase());

  if (!r || r.status !== 'lobby')
   return ack({ error: 'Oda bulunamadı' });

  try {
   attach(r);
   ack({ ok: true, room: view(r) });
  } catch (e) {
   ack({ error: e.message });
  }
 });

 s.on('loadout:set', ({ champId, items = [] } = {}, ack = () => {}) => {
  let r = rooms.get(s.data.room);
  let p = r?.players[s.data.pid];

  try {
   if (!p || r.status !== 'lobby')
    throw Error('Lobi kapalı');

   let f = makeBuild(champId, items);

   Object.assign(p, f, {
    id: p.id,
    name: p.name,
    socket: s.id,
    ready: false,
    position: p.position
   });

   ack({ ok: true });
   broadcast(r);
  } catch (e) {
   ack({ error: e.message });
  }
 });

 s.on('player:ready', ({ ready } = {}, ack = () => {}) => {
  let r = rooms.get(s.data.room);
  let p = r?.players[s.data.pid];

  if (!p || r.status !== 'lobby')
   return ack({ error: 'Hazır olunamadı' });

  p.ready = !!ready;
  ack({ ok: true });
  broadcast(r);
 });

 s.on('match:start', (_, ack = () => {}) => {
  let r = rooms.get(s.data.room);

  if (
   !r ||
   r.host !== ident.id ||
   Object.keys(r.players).length !== 2 ||
   !Object.values(r.players).every(p => p.ready)
  ) {
   return ack({
    error: 'İki oyuncu hazır olmalı; başlatma yetkisi oda sahibinde'
   });
  }

  r.status = 'battle';
  r.startedAt = r.lastTick = Date.now();
  r.remaining = 120;
  r.matchId = randomUUID();

  broadcast(r);
  ack({ ok: true });
 });

 s.on('battle:cast', ({ key } = {}, ack = () => {}) => {
  let r = rooms.get(s.data.room);

  try {
   let result = cast(r, s.data.pid, key);
   broadcast(r);
   ack({ ok: true, result });
  } catch (e) {
   ack({ error: e.message });
  }
 });

 s.on('battle:move', ({ x, y } = {}, ack = () => {}) => {
  let r = rooms.get(s.data.room);
  let p = r?.players[s.data.pid];

  if (!p || r.status !== 'battle')
   return ack({ error: 'Savaş aktif değil' });

  p.position = {
   x: Math.max(0, Math.min(100, +x || 0)),
   y: Math.max(0, Math.min(100, +y || 0))
  };

  s.to(r.code).emit('battle:position', {
   id: p.id,
   position: p.position
  });

  ack({ ok: true });
 });

 s.on('expression:send', ({ expression } = {}, ack = () => {}) => {
  if (!['😂', '😭', '😡'].includes(expression))
   return ack({ error: 'Geçersiz ifade' });

  let r = rooms.get(s.data.room);

  if (!r || r.status !== 'battle')
   return ack({ error: 'Savaş aktif değil' });

  s.to(r.code).emit('expression:show', {
   id: s.data.pid,
   expression
  });

  ack({ ok: true });
 });

 s.on('match:rematch', (_, ack = () => {}) => {
  let r = rooms.get(s.data.room);

  if (!r || r.status !== 'finished')
   return ack({ error: 'Maç bitmedi' });

  r.rematches.add(s.data.pid);

  if (r.rematches.size === 2) {
   r.status = 'lobby';
   r.winner = null;
   r.rematches.clear();

   for (let p of Object.values(r.players)) {
    Object.assign(p, makeBuild(p.champId, p.items), {
     id: p.id,
     name: p.name,
     ready: false,
     position: p.position
    });
   }

   broadcast(r);
  }

  ack({ ok: true });
 });

 s.on('room:leave', (_, ack = () => {}) => {
  leave();
  ack({ ok: true });
 });

 function leave() {
  let r = rooms.get(s.data.room);
  let id = s.data.pid;

  if (!r || !id) return;

  delete r.players[id];
  s.leave(r.code);

  if (!Object.keys(r.players).length) {
   rooms.delete(r.code);
  } else {
   r.host = Object.keys(r.players)[0];
   broadcast(r);
  }

  s.data.room = null;
  s.data.pid = null;
 }

 s.on('disconnect', () => {
  let r = rooms.get(s.data.room);
  let p = r?.players[s.data.pid];

  if (p) {
   let token = randomBytes(32).toString('hex');
   p.disconnected = true;
   p.disconnectedAt = Date.now();

   resumes.set(token, {
    room: r.code,
    id: p.id,
    expires: Date.now() + 30000
   });

   io.to(r.code).emit('player:disconnected', {
    id: p.id,
    resumeToken: token,
    graceMs: 30000
   });
  }
 });

 s.on('session:resume', ({ resumeToken } = {}, ack = () => {}) => {
  let v = resumes.get(resumeToken);
  let r = v && rooms.get(v.room);
  let p = r?.players[v.id];

  if (!v || v.expires < Date.now() || !p)
   return ack({ error: 'Geri dönüş süresi doldu' });

  resumes.delete(resumeToken);
  p.socket = s.id;
  delete p.disconnected;
  delete p.disconnectedAt;

  s.data.room = r.code;
  s.data.pid = p.id;
  s.join(r.code);

  ack({ ok: true, room: view(r) });
  broadcast(r);
 });
});

setInterval(() => {
 for (let r of rooms.values()) {
  if (r.status === 'battle') {
   update(r);

   if (r.status === 'finished' && !r.saved) {
    r.saved = true;

    db.prepare('INSERT OR IGNORE INTO matches VALUES(?,?,?,?,?,?,?,?)')
     .run(
      r.matchId,
      r.code,
      ...Object.values(r.players).map(p => p.id),
      r.winner,
      r.startedAt,
      r.finishedAt || Date.now(),
      JSON.stringify(
       Object.values(r.players).map(p => ({
        champId: p.champId,
        hp: p.hp,
        maxHp: p.maxHp,
        items: p.items
       }))
      )
     );
   }

   broadcast(r);
  }

  for (let [id, p] of Object.entries(r.players)) {
   if (p.disconnected && Date.now() - (p.disconnectedAt || 0) > 30000) {
    delete r.players[id];

    if (Object.keys(r.players).length)
     r.host = Object.keys(r.players)[0];
    else
     rooms.delete(r.code);

    broadcast(r);
   }
  }
 }
}, 200);

// SPA ana sayfa ve React yönlendirmeleri
app.get('*', (req, res, next) => {
 if (req.path.startsWith('/api/')) return next();

 res.sendFile(path.join(distPath, 'index.html'), err => {
  if (err) next(err);
 });
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
 console.log('Proje1 server ' + port);
});
