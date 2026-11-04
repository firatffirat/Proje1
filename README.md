# Proje1 — Online Duel Arena

Özgün şampiyonlar ve eşya verileriyle 1v1 oda kodlu online arena. React/Vite istemci, Express/Socket.IO gerçek zamanlı sunucu, SQLite hesap/arkadaş/maç geçmişi.

## Kurulum
Node.js 20+ gerekir.

```bash
npm install
```
`.env` oluşturun:

```env
PORT=3000
JWT_SECRET=uzun-rastgele-bir-gizli-deger
DB_FILE=proje1.sqlite
```

Geliştirme:

```bash
npm run dev
```

İstemci `http://localhost:5173`, sunucu `http://localhost:3000`.

Üretim:

```bash
npm run build
npm start
```

Canlı internette yayınlamak için Node sunucusunu HTTPS destekli bir hostta çalıştırın; `JWT_SECRET` mutlaka değiştirin ve SQLite dosyası için kalıcı disk kullanın. İki farklı ağdan oyuncular aynı sunucu adresine bağlanır ve oda kodunu paylaşır.

## Dahil edilen sistemler
- Oda oluşturma/katılma, iki oyuncu, hazır olma ve ev sahibi başlatma.
- 4 özgün şampiyon; her birinde pasif tasarımına uygun rol kimliği ve Q/W/E/R yetenek seti.
- 4 farklı tamamlanmış eşya yuvası; mana, mana yenilenmesi, saldırı, büyü gücü, zırh ve direnç istatistikleri.
- Tüm şampiyonlarda mana maliyeti ve şampiyona özgü doğal mana yenilenmesi.
- 120 saniyelik tek savaş; sunucu zamanına göre sonuç, can yüzdesiyle süre sonu kararı.
- Kritik vuruş, zırh/büyü direnci, nüfuz, kalkan, can çalma, kombo ve CC etkileri.
- 😂 😭 😡 ifadeleri, tıklayarak hareket, rövanş.
- Hesap/kayıt, arkadaş ekleme ve maç geçmişi.
- Bağlantı kopunca 30 saniyelik geri dönüş anahtarı altyapısı.

## Not
Bu kaynak paketi istenildiği üzere test çalıştırılmadan teslim edilmiştir. Canlı yayına çıkmadan önce uçtan uca oyun, güvenlik, yeniden bağlanma, eşzamanlılık ve mobil tarayıcı testleri yapılmalıdır. Mevcut hareket sistemi tıklama tabanlıdır; çarpışma/menzil/konum doğrulaması ve tam animasyonlu 2D istemci sonraki geliştirme aşamasıdır.
