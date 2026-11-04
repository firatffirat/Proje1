
export const CHAMPS = {
  veyra: {
    name: 'Veyra', role: 'Büyücü',
    hp: 920, mana: 760, regen: 15,
    ad: 48, ap: 0, armor: 28, mr: 34, crit: .05,
    skills: {
      Q: ['Astral Mızrak', 60, 5, 145, 'magic', 'slow', 1.2],
      W: ['Yıldız Kalkanı', 90, 11, 0, 'shield', null, 0, 210],
      E: ['Boşluk Dalgası', 110, 13, 120, 'magic', 'silence', .8],
      R: ['Kozmik Çöküş', 190, 42, 330, 'magic', 'stun', 1]
    }
  },
  brakk: {
    name: 'Brakk', role: 'Tank',
    hp: 1480, mana: 570, regen: 11,
    ad: 72, ap: 0, armor: 62, mr: 50, crit: .02,
    skills: {
      Q: ['Sarsıcı Darbe', 55, 6, 130, 'physical', 'stun', .7],
      W: ['Demir Deri', 80, 12, 0, 'shield', null, 0, 270],
      E: ['Yer Yarığı', 90, 12, 115, 'physical', 'slow', 1.7],
      R: ['Dağ Öfkesi', 170, 40, 285, 'physical', 'knockup', 1]
    }
  },
  nyx: {
    name: 'Nyx', role: 'Suikastçı',
    hp: 1000, mana: 650, regen: 12,
    ad: 95, ap: 0, armor: 30, mr: 30, crit: .2,
    skills: {
      Q: ['Gölge Kesiti', 48, 4, 155, 'physical', null, 0],
      W: ['Sis Adımı', 75, 10, 0, 'shield', null, 0, 140],
      E: ['Üçlü Bıçak', 95, 9, 185, 'physical', 'slow', .8],
      R: ['Gece İnfazı', 180, 38, 380, 'physical', null, 0]
    }
  },
  sol: {
    name: 'Sol', role: 'Destek',
    hp: 1150, mana: 900, regen: 19,
    ad: 54, ap: 0, armor: 38, mr: 44, crit: .04,
    skills: {
      Q: ['Şifa Işığı', 75, 7, 0, 'heal', null, 0, 190],
      W: ['Arındırıcı Bariyer', 100, 12, 0, 'shield', null, 0, 240],
      E: ['Işık Zinciri', 115, 14, 105, 'magic', 'silence', .8],
      R: ['Gün Doğumu', 210, 45, 175, 'magic', 'heal', 0, 330]
    }
  }
};

export const ITEMS = [
  ['void', 'Hiçlik Tacı', { ap: 80, mana: 260, regen: 5, mrPen: 14 }],
  ['arch', 'Arşmelek Asası', { ap: 60, mana: 430, regen: 8 }],
  ['storm', 'Fırtına Kenarı', { ad: 65, crit: .18, armorPen: 14 }],
  ['blood', 'Kan Yemini', { ad: 52, hp: 280, vamp: .08 }],
  ['iron', 'Demir Yürek', { hp: 520, armor: 48, mr: 28 }],
  ['frost', 'Ayaz Aegisi', { hp: 320, armor: 35, mana: 200, regen: 4 }],
  ['rune', 'Rün Odağı', { ap: 72, mana: 320, regen: 6, haste: 10 }],
  ['hunter', 'Avcı Bıçağı', { ad: 74, crit: .13, haste: 8 }],
  ['sun', 'Güneş Muhafızı', { hp: 420, armor: 32, mr: 42 }],
  ['oracle', 'Kâhin Merceği', { ap: 48, mana: 240, regen: 7, hp: 160 }]
].map(([id, name, stats]) => ({ id, name, stats }));

export const makeBuild = (champId, ids = []) => {
  const c = CHAMPS[champId];

  if (!c || !Array.isArray(ids) || ids.length > 4 ||
      new Set(ids).size !== ids.length) {
    throw Error('Şampiyon/eşya seçimi geçersiz');
  }

  const chosen = ids.map(id => ITEMS.find(i => i.id === id));
  if (chosen.some(x => !x)) throw Error('Bilinmeyen eşya');

  const s = {};
  for (const item of chosen) {
    for (const [key, value] of Object.entries(item.stats)) {
      s[key] = (s[key] || 0) + value;
    }
  }

  return {
    champId,
    name: c.name,
    role: c.role,
    maxHp: c.hp + (s.hp || 0),
    hp: c.hp + (s.hp || 0),
    maxMana: c.mana + (s.mana || 0),
    mana: c.mana + (s.mana || 0),
    regen: c.regen + (s.regen || 0),
    ad: c.ad + (s.ad || 0),
    ap: s.ap || 0,
    armor: c.armor + (s.armor || 0),
    mr: c.mr + (s.mr || 0),
    crit: Math.min(.75, c.crit + (s.crit || 0)),
    armorPen: s.armorPen || 0,
    mrPen: s.mrPen || 0,
    haste: s.haste || 0,
    vamp: s.vamp || 0,
    shield: 0,
    items: [...ids],
    cooldowns: {},
    combo: [],
    cc: null,
    slowUntil: 0
  };
};

export function cast(room, id, key, now = Date.now()) {
  const p = room?.players?.[id];
  if (!p || room.status !== 'battle') {
    throw Error('Oyuncu veya savaş bulunamadı');
  }

  const enemy = Object.values(room.players).find(x => x.id !== id);
  if (!enemy) throw Error('Rakip bulunamadı');

  const c = CHAMPS[p.champId];
  const a = c?.skills?.[String(key).toUpperCase()];
  if (!a) throw Error('Yetenek bulunamadı');

  if (p.cc && p.cc.until > now) {
    if (['stun', 'knockup', 'silence'].includes(p.cc.type)) {
      throw Error('Kontrol etkisi altındasın');
    }
  }

  if ((p.cooldowns[key] || 0) > now) {
    throw Error('Bekleme süresi dolmadı');
  }

  if (p.mana < a[1]) throw Error('Yeterli mana yok');

  p.mana -= a[1];
  p.cooldowns[key] = now + a[2] * 1000 / (1 + p.haste / 100);

  let damage = 0;
  let critical = false;
  let healed = 0;

  if (a[4] === 'heal') {
    healed = a[7] || 0;
    p.hp = Math.min(p.maxHp, p.hp + healed);
  } else if (a[4] === 'shield') {
    p.shield += a[7] || 0;
  } else if (a[3] > 0) {
    let raw = a[3] + (a[4] === 'magic' ? p.ap * .65 : p.ad * .45);

    critical = Math.random() < p.crit;
    if (critical) raw *= 1.75;

    const defense = Math.max(
      0,
      (a[4] === 'magic' ? enemy.mr : enemy.armor) -
      (a[4] === 'magic' ? p.mrPen : p.armorPen)
    );

    damage = raw * 100 / (100 + defense);

    const absorbed = Math.min(enemy.shield || 0, damage);
    enemy.shield = Math.max(0, (enemy.shield || 0) - absorbed);
    enemy.hp = Math.max(0, enemy.hp - (damage - absorbed));

    if (p.vamp) {
      p.hp = Math.min(p.maxHp, p.hp + damage * p.vamp);
    }
  }

  // Sol'un R yeteneği hem hasar hem iyileştirme uygular.
  if (a[5] === 'heal') {
    healed = a[7] || 0;
    p.hp = Math.min(p.maxHp, p.hp + healed);
  }

  // Kontrol etkileri
  if (a[5] && a[5] !== 'heal') {
    enemy.cc = {
      type: a[5],
      until: now + a[6] * 1000
    };

    if (a[5] === 'slow') {
      enemy.slowUntil = now + a[6] * 1000;
    }
  }

  // Son 5 saniyedeki üç yetenek kombo oluşturur.
  p.combo = (p.combo || []).filter(t => now - t < 5000);
  p.combo.push(now);

  let combo = false;
  if (p.combo.length >= 3) {
    combo = true;
    const bonus = 35;
    const absorbed = Math.min(enemy.shield || 0, bonus);
    enemy.shield = Math.max(0, (enemy.shield || 0) - absorbed);
    enemy.hp = Math.max(0, enemy.hp - (bonus - absorbed));
    p.combo = [];
  }

  return {
    name: a[0],
    damage: Math.round(damage),
    critical,
    healed: Math.round(healed),
    combo
  };
}

export function update(room, now = Date.now()) {
  if (!room || room.status !== 'battle') return;

  const dt = Math.min(
    .25,
    Math.max(0, (now - room.lastTick) / 1000)
  );

  room.lastTick = now;

  for (const p of Object.values(room.players)) {
    p.mana = Math.min(p.maxMana, p.mana + p.regen * dt);

    if (p.cc && p.cc.until <= now) p.cc = null;
    if (p.slowUntil && p.slowUntil <= now) p.slowUntil = 0;
  }

  room.remaining = Math.max(
    0,
    120 - (now - room.startedAt) / 1000
  );

  const players = Object.values(room.players);
  if (players.length !== 2) return;

  if (players.some(p => p.hp <= 0) || room.remaining <= 0) {
    room.status = 'finished';

    if (players.some(p => p.hp <= 0)) {
      const loser = players.find(p => p.hp <= 0);
      room.winner = players.find(p => p.id !== loser.id)?.id || null;
    } else {
      const [a, b] = players;
      const ar = a.hp / a.maxHp;
      const br = b.hp / b.maxHp;
      room.winner = ar === br ? null : ar > br ? a.id : b.id;
    }

    room.finishedAt = now;
  }
}
