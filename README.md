# 📍 Konum Takip Sistemi

Kullanıcı rızası ile konum paylaşımı yapan modern web uygulaması.

## 🚀 Özellikler

- **Kullanıcı Rızası**: Konum paylaşımı için açık kullanıcı izni
- **Güvenli Veri Saklama**: SQLite veritabanında şifrelenmiş veri saklama
- **Modern UI**: Responsive ve kullanıcı dostu arayüz
- **Admin Paneli**: Link yönetimi ve konum görüntüleme
- **Gerçek Zamanlı Takip**: Anlık konum güncellemeleri
- **Harita Entegrasyonu**: OpenStreetMap ile konum görselleştirme

## 📋 Gereksinimler

- Node.js (v14 veya üzeri)
- npm veya yarn

## 🛠️ Kurulum

1. **Projeyi klonlayın:**
```bash
git clone <repository-url>
cd location-tracker-app
```

2. **Bağımlılıkları yükleyin:**
```bash
npm install
```

3. **Uygulamayı başlatın:**
```bash
npm start
```

4. **Geliştirme modunda çalıştırın:**
```bash
npm run dev
```

## 🌐 Kullanım

### Admin Paneli
- `http://localhost:3000` adresine gidin
- Yeni tracking link oluşturun
- Mevcut linkleri yönetin
- Konum verilerini görüntüleyin

### Kullanıcı Deneyimi
1. Admin panelinden link oluşturun
2. Oluşturulan linki WhatsApp üzerinden paylaşın
3. Kullanıcı linke tıkladığında konum paylaşım sayfası açılır
4. Kullanıcı konumunu paylaşmayı kabul ederse konum kaydedilir

## 📁 Proje Yapısı

```
location-tracker-app/
├── server.js              # Ana server dosyası
├── package.json           # Proje bağımlılıkları
├── locations.db           # SQLite veritabanı (otomatik oluşur)
├── public/
│   ├── admin.html         # Admin paneli
│   └── track.html         # Kullanıcı konum paylaşım sayfası
└── README.md              # Bu dosya
```

## 🔧 API Endpoints

### POST /api/create-link
Yeni tracking link oluşturur.

**Request:**
```json
{
  "name": "Link Adı"
}
```

**Response:**
```json
{
  "trackingId": "uuid",
  "trackingUrl": "http://localhost:3000/track/uuid"
}
```

### GET /track/:id
Tracking link sayfasını gösterir.

### POST /api/save-location
Konum verisini kaydeder.

**Request:**
```json
{
  "trackingId": "uuid",
  "latitude": 41.0082,
  "longitude": 28.9784,
  "accuracy": 10,
  "userAgent": "Mozilla/5.0...",
  "ipAddress": "192.168.1.1"
}
```

### GET /api/links
Tüm tracking linkleri listeler.

### GET /api/locations/:trackingId
Belirli bir link için konum verilerini getirir.

### DELETE /api/links/:id
Tracking linki deaktif eder.

## 🔒 Güvenlik

- Kullanıcı rızası zorunludur
- HTTPS kullanımı önerilir
- Veri şifreleme
- IP adresi kaydı
- Kullanıcı agent bilgisi

## 📱 Mobil Uyumluluk

- Responsive tasarım
- Touch-friendly arayüz
- Mobil tarayıcı optimizasyonu
- PWA desteği (gelecek sürümde)

## 🚀 Canlıya Alma

### Production için öneriler:

1. **HTTPS Kullanın:**
```javascript
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('path/to/key.pem'),
  cert: fs.readFileSync('path/to/cert.pem')
};

https.createServer(options, app).listen(443);
```

2. **Environment Variables:**
```bash
PORT=3000
NODE_ENV=production
```

3. **Process Manager:**
```bash
npm install -g pm2
pm2 start server.js
```

4. **Reverse Proxy (Nginx):**
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🐛 Sorun Giderme

### Yaygın Sorunlar:

1. **Port 3000 kullanımda:**
```bash
# Farklı port kullanın
PORT=3001 npm start
```

2. **Veritabanı hatası:**
```bash
# Veritabanını silin ve yeniden oluşturun
rm locations.db
npm start
```

3. **CORS hatası:**
```javascript
// server.js'de CORS ayarlarını güncelleyin
app.use(cors({
  origin: 'https://yourdomain.com'
}));
```

## 📄 Lisans

MIT License

## 🤝 Katkıda Bulunma

1. Fork edin
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Commit edin (`git commit -m 'Add amazing feature'`)
4. Push edin (`git push origin feature/amazing-feature`)
5. Pull Request oluşturun

## 📞 İletişim

- Email: your-email@example.com
- GitHub: [@yourusername](https://github.com/yourusername)

## ⚠️ Yasal Uyarı

Bu uygulama sadece eğitim ve meşru amaçlar için geliştirilmiştir. Kullanıcıların açık rızası olmadan konum takibi yapmak yasa dışıdır. Uygulamayı kullanırken yerel yasaları ve gizlilik düzenlemelerini göz önünde bulundurun. 