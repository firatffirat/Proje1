
import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_SERVER_URL || '', {
  autoConnect: false
});

export default function App() {
  const [data, setData] = useState({ champs: {}, items: [] });
  const [room, setRoom] = useState(null);
  const [ownId, setOwnId] = useState(localStorage.user ? JSON.parse(localStorage.user).id : null);
  const [code, setCode] = useState('');
  const [champ, setChamp] = useState('veyra');
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState('');
  const [token, setToken] = useState(localStorage.token || '');
  const [form, setForm] = useState({ name: '', password: '' });
  const [user, setUser] = useState(JSON.parse(localStorage.user || 'null'));
  const [history, setHistory] = useState([]);
  const [friend, setFriend] = useState('');
  const [positions, setPositions] = useState({});
  const [emote, setEmote] = useState('');

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(setData)
      .catch(() => setMsg('Oyun verileri yüklenemedi.'));

    socket.auth = { token: localStorage.token || '' };
    socket.connect();

    const onRoom = value => setRoom(value);
    const onPosition = value =>
      setPositions(p => ({ ...p, [value.id]: value.position }));
    const onExpression = value => {
      setEmote(value.expression);
      setTimeout(() => setEmote(''), 1800);
    };
    const onDisconnect = () =>
      setMsg('Rakibin bağlantısı kesildi. Geri dönmesi için 30 saniyesi var.');

    socket.on('room:update', onRoom);
    socket.on('battle:position', onPosition);
    socket.on('expression:show', onExpression);
    socket.on('player:disconnected', onDisconnect);

    return () => {
      socket.off('room:update', onRoom);
      socket.off('battle:position', onPosition);
      socket.off('expression:show', onExpression);
      socket.off('player:disconnected', onDisconnect);
      socket.disconnect();
    };
  }, []);

  const me = room?.players.find(p => p.id === ownId);
  const enemy = room?.players.find(p => p.id !== ownId);

  const send = (event, value = {}) =>
    new Promise(resolve => {
      if (!socket.connected) return resolve({ error: 'Sunucu bağlantısı yok.' });
      socket.emit(event, value, resolve);
    });

  async function account(path) {
    try {
      const response = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });

      const result = await response.json();
      if (!response.ok) throw Error(result.error);

      localStorage.token = result.token;
      localStorage.user = JSON.stringify(result.user);

      setToken(result.token);
      setUser(result.user);
      setOwnId(result.user.id);

      socket.auth = { token: result.token };
      if (socket.connected) socket.disconnect();
      socket.connect();

      setMsg('Hesap hazır. Sunucuya bağlandın.');
    } catch (error) {
      setMsg(error.message);
    }
  }

  async function loadHistory() {
    const response = await fetch('/api/history', {
      headers: { Authorization: 'Bearer ' + token }
    });

    if (response.ok) setHistory(await response.json());
  }

  async function friendAdd() {
    const response = await fetch('/api/friends', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ name: friend })
    });

    const result = await response.json();
    setMsg(result.error || 'Arkadaş eklendi.');
  }

  async function create() {
    const result = await send('room:create');
    if (result.error) return setMsg(result.error);
    setRoom(result.room);
    setOwnId(user?.id || result.playerId);
  }

  async function join() {
    const result = await send('room:join', { code });
    if (result.error) return setMsg(result.error);
    setRoom(result.room);
    setOwnId(user?.id || result.playerId);
  }

  async function loadout() {
    const result = await send('loadout:set', {
      champId: champ,
      items
    });
    setMsg(result.error || 'Şampiyon ve eşyalar kaydedildi.');
  }

  async function readyUp() {
    const result = await send('player:ready', {
      ready: !me?.ready
    });
    if (result.error) setMsg(result.error);
  }

  async function cast(key) {
    const result = await send('battle:cast', { key });
    setMsg(result.error || result.result?.name || 'Yetenek kullanıldı.');
  }

  function move(event) {
    if (room?.status !== 'battle' || !ownId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 100;
    const y = (event.clientY - rect.top) / rect.height * 100;

    send('battle:move', { x, y }).then(result => {
      if (result?.position) {
        setPositions(p => ({ ...p, [ownId]: result.position }));
      }
    });
  }

  async function rematch() {
    const result = await send('match:rematch');
    if (result.error) setMsg(result.error);
  }

  async function leaveRoom() {
    await send('room:leave');
    setRoom(null);
    setPositions({});
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setOwnId(null);
    socket.disconnect();
    socket.auth = {};
    setMsg('Oturum kapatıldı.');
  }

  return (
    <main>
      <header>
        <div>
          <small>ONLINE DUEL ARENA</small>
          <h1>PROJE<span>1</span></h1>
        </div>
        <b>{user?.name || 'MİSAFİR'} {room && ' · ' + room.code}</b>
      </header>

      {!user && (
        <section>
          <h2>Hesap</h2>
          <input
            placeholder="Kullanıcı adı"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
          <input
            type="password"
            placeholder="Parola"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
          />
          <button onClick={() => account('register')}>Kayıt ol</button>
          <button className="alt" onClick={() => account('login')}>Giriş yap</button>
        </section>
      )}

      {!room && (
        <section>
          <h2>Arena lobisi</h2>
          <button onClick={create}>Oda oluştur</button>
          <input
            placeholder="Oda kodu"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
          />
          <button onClick={join}>Katıl</button>

          <hr />
          <h3>Arkadaşlar</h3>
          <input
            placeholder="Kullanıcı adı"
            value={friend}
            onChange={e => setFriend(e.target.value)}
          />
          <button disabled={!token} onClick={friendAdd}>Arkadaş ekle</button>

          <h3>Maç geçmişi</h3>
          <button disabled={!token} onClick={loadHistory}>Geçmişi yükle</button>
          {history.map(match => (
            <p key={match.id}>
              {new Date(match.ended).toLocaleString()} · {match.room}
            </p>
          ))}
        </section>
      )}

      {room && (
        <section>
          <h2>Oda {room.code}</h2>

          <div className="players">
            {room.players.map(player => (
              <article key={player.id}>
                <b>{player.name}</b>
                <span>{player.role} · {player.champId}</span>
                <strong>{player.ready ? 'HAZIR' : 'BEKLİYOR'}</strong>
              </article>
            ))}
          </div>

          {room.status === 'lobby' && (
            <>
              <h3>Şampiyon seç</h3>
              <div className="choices">
                {Object.entries(data.champs).map(([id, champData]) => (
                  <button
                    className={champ === id ? 'selected' : ''}
                    key={id}
                    onClick={() => setChamp(id)}
                  >
                    {champData.name}
                    <small>{champData.role}</small>
                  </button>
                ))}
              </div>

              <h3>4 farklı tamamlanmış eşya</h3>
              <div className="choices">
                {data.items.map(item => (
                  <button
                    className={items.includes(item.id) ? 'selected' : ''}
                    key={item.id}
                    onClick={() => setItems(old =>
                      old.includes(item.id)
                        ? old.filter(id => id !== item.id)
                        : old.length < 4 ? [...old, item.id] : old
                    )}
                  >
                    {item.name}
                    <small>
                      {Object.entries(item.stats)
                        .map(([key, value]) => key + ' +' + value)
                        .join(' / ')}
                    </small>
                  </button>
                ))}
              </div>

              <button onClick={loadout}>Seçimleri kaydet</button>
              <button className="alt" onClick={readyUp}>
                {me?.ready ? 'Hazır değilim' : 'Hazırım'}
              </button>

              {room.host === ownId && (
                <button
                  disabled={room.players.length !== 2 || !room.players.every(p => p.ready)}
                  onClick={() => send('match:start').then(v => v.error && setMsg(v.error))}
                >
                  SAVAŞI BAŞLAT
                </button>
              )}
            </>
          )}

          {room.status === 'battle' && (
            <>
              <h2 className="timer">{Math.ceil(room.remaining)} SANİYE</h2>

              <div className="bars">
                {room.players.map(player => (
                  <div key={player.id}>
                    <b>{player.name}</b>
                    <div className="bar">
                      <i style={{ width: 100 * player.hp / player.maxHp + '%' }} />
                    </div>
                    <small>
                      Can {Math.ceil(player.hp)}/{player.maxHp}
                      {' · '}Mana {Math.floor(player.mana)}/{player.maxMana}
                      {' · '}Kalkan {Math.floor(player.shield)}
                    </small>
                  </div>
                ))}
              </div>

              <div className="arena" onClick={move}>
                {room.players.map(player => (
                  <span
                    key={player.id}
                    className={'dot ' + (player.id === ownId ? 'mine' : 'foe')}
                    style={{
                      left: (positions[player.id]?.x ?? player.position?.x ?? 50) + '%',
                      top: (positions[player.id]?.y ?? player.position?.y ?? 50) + '%'
                    }}
                  >●</span>
                ))}
                {emote && <b className="emote">{emote}</b>}
                <small>Hareket etmek için arenaya dokun</small>
              </div>

              <div className="choices">
                {['Q', 'W', 'E', 'R'].map(key => (
                  <button onClick={() => cast(key)} key={key}>
                    {key}
                    <small>{data.champs[me?.champId]?.skills?.[key]?.[0]}</small>
                  </button>
                ))}
              </div>

              <div className="choices">
                {['😂', '😭', '😡'].map(expression => (
                  <button
                    onClick={() => send('expression:send', { expression })}
                    key={expression}
                  >
                    {expression}
                  </button>
                ))}
              </div>
            </>
          )}

          {room.status === 'finished' && (
            <div className="result">
              <h2>
                {room.winner === ownId
                  ? 'ZAFER'
                  : room.winner ? 'MAĞLUBİYET' : 'BERABERE'}
              </h2>
              <button onClick={rematch}>Rövanş</button>
            </div>
          )}

          <button className="alt" onClick={leaveRoom}>Odadan ayrıl</button>
        </section>
      )}

      {msg && <aside onClick={() => setMsg('')}>{msg} ×</aside>}

      {user && <button className="alt" onClick={logout}>Çıkış yap</button>}

      <footer>Proje1 · Sunucu kontrollü online arena</footer>
    </main>
  );
}
