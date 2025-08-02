const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Rate limiting - Tamamen devre dışı (geliştirme için)
// if (NODE_ENV === 'production') {
//   const limiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15 dakika
//     max: 10000, // IP başına maksimum istek (çok yüksek)
//     message: 'Çok fazla istek gönderildi, lütfen daha sonra tekrar deneyin.',
//     standardHeaders: true,
//     legacyHeaders: false,
//     skipSuccessfulRequests: true, // Başarılı istekleri sayma
//     skipFailedRequests: false
//   });
//   app.use(limiter);
// }

// Production güvenlik middleware'leri
if (NODE_ENV === 'production') {
  // HTTPS yönlendirmesi - Render için devre dışı
  // app.use((req, res, next) => {
  //   if (req.header('x-forwarded-proto') !== 'https') {
  //     res.redirect(`https://${req.header('host')}${req.url}`);
  //   } else {
  //     next();
  //   }
  // });
  
  // Güvenlik header'ları - Render için optimize edildi
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Content Security Policy - QR kod için img-src eklendi
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https://api.qrserver.com data:;");
    next();
  });
}

// Input validation middleware
const validateLocationData = (req, res, next) => {
  const { latitude, longitude, accuracy } = req.body;
  
  if (!latitude || !longitude || !accuracy) {
    return res.status(400).json({ error: 'Eksik konum verileri' });
  }
  
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Geçersiz koordinatlar' });
  }
  
  if (accuracy < 0 || accuracy > 10000) {
    return res.status(400).json({ error: 'Geçersiz hassasiyet değeri' });
  }
  
  next();
};

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('locations.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tracking_links (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1,
    tracking_interval INTEGER DEFAULT 30,
    max_duration INTEGER DEFAULT 1440,
    description TEXT,
    owner_email TEXT,
    settings TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS location_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_id TEXT,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    speed REAL,
    heading REAL,
    altitude REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    consent_given BOOLEAN DEFAULT 1,
    session_id TEXT,
    battery_level REAL,
    network_type TEXT,
    FOREIGN KEY (tracking_id) REFERENCES tracking_links (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tracking_sessions (
    id TEXT PRIMARY KEY,
    tracking_id TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    total_locations INTEGER DEFAULT 0,
    device_info TEXT,
    FOREIGN KEY (tracking_id) REFERENCES tracking_links (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS geofences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_id TEXT,
    latitude REAL,
    longitude REAL,
    radius REAL,
    action TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1,
    FOREIGN KEY (tracking_id) REFERENCES tracking_links (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS alarms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_id TEXT,
    type TEXT,
    message TEXT,
    conditions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1,
    FOREIGN KEY (tracking_id) REFERENCES tracking_links (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_id TEXT,
    type TEXT,
    title TEXT,
    message TEXT,
    recipients TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (tracking_id) REFERENCES tracking_links (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_admin BOOLEAN DEFAULT 0
  )`);
});

// Socket.IO connections
const activeConnections = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Yeni Socket.IO bağlantısı:', socket.id);

  socket.on('join-tracking', (trackingId) => {
    socket.join(trackingId);
    activeConnections.set(socket.id, trackingId);
    console.log(`✅ Socket ${socket.id} tracking ${trackingId} için katıldı`);
    
    // Bağlantı onayı gönder
    socket.emit('tracking-joined', { trackingId, message: 'Tracking room\'a katıldınız' });
    
    // Room'daki client sayısını kontrol et
    io.in(trackingId).fetchSockets().then(sockets => {
      console.log(`📊 Room ${trackingId} içindeki client sayısı: ${sockets.length}`);
    }).catch(err => {
      console.error('Room client listesi alınamadı:', err);
    });
  });

  socket.on('leave-tracking', (trackingId) => {
    socket.leave(trackingId);
    activeConnections.delete(socket.id);
    console.log(`❌ Socket ${socket.id} tracking ${trackingId} için ayrıldı`);
    
    // Ayrılma onayı gönder
    socket.emit('tracking-left', { trackingId, message: 'Tracking room\'dan ayrıldınız' });
  });

  socket.on('disconnect', () => {
    const trackingId = activeConnections.get(socket.id);
    if (trackingId) {
      activeConnections.delete(socket.id);
      console.log(`❌ Socket ${socket.id} tracking ${trackingId} için ayrıldı (disconnect)`);
    }
    console.log(`❌ Socket ${socket.id} bağlantısı kesildi`);
  });

  // Hata yakalama
  socket.on('error', (error) => {
    console.error('Socket.IO hatası:', error);
  });
});

// Routes

// Ana sayfa - Admin paneli
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Yeni tracking link oluştur
app.post('/api/create-link', (req, res) => {
  const { name, trackingInterval = 30, maxDuration = 1440 } = req.body;
  const trackingId = uuidv4();
  
  db.run('INSERT INTO tracking_links (id, name, tracking_interval, max_duration) VALUES (?, ?, ?, ?)', 
    [trackingId, name, trackingInterval, maxDuration], 
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const baseUrl = NODE_ENV === 'production' 
        ? `https://${req.get('host')}` 
        : `http://localhost:${PORT}`;
      
      res.json({ 
        trackingId, 
        trackingUrl: `${baseUrl}/track/${trackingId}`,
        qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${baseUrl}/track/${trackingId}`
      });
    }
  );
});

// Tracking link sayfası
app.get('/track/:id', (req, res) => {
  const trackingId = req.params.id;
  
  db.get('SELECT * FROM tracking_links WHERE id = ? AND active = 1', 
    [trackingId], 
    (err, row) => {
      if (err || !row) {
        res.status(404).send('Link bulunamadı');
        return;
      }
      res.sendFile(path.join(__dirname, 'public', 'track.html'));
    }
  );
});

// Konum verisi kaydet
app.post('/api/save-location', validateLocationData, (req, res) => {
  const { 
    trackingId, 
    latitude, 
    longitude, 
    accuracy, 
    speed = 0,
    heading = 0,
    altitude = 0,
    userAgent, 
    ipAddress,
    sessionId 
  } = req.body;
  
  // Session kontrolü
  if (!sessionId) {
    res.status(400).json({ error: 'Session ID gerekli' });
    return;
  }

  db.run(`INSERT INTO location_data 
    (tracking_id, latitude, longitude, accuracy, speed, heading, altitude, user_agent, ip_address, session_id) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [trackingId, latitude, longitude, accuracy, speed, heading, altitude, userAgent, ipAddress, sessionId],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      // Session güncelle
      db.run(`UPDATE tracking_sessions 
        SET last_update = CURRENT_TIMESTAMP, total_locations = total_locations + 1 
        WHERE id = ?`, [sessionId]);

      // Gerçek zamanlı güncelleme gönder
      console.log(`🔍 Socket.IO emit: trackingId=${trackingId}, room=${trackingId}`);
      console.log(`📡 Emitting location-update to room: ${trackingId}`);
      
      const locationData = {
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        altitude,
        timestamp: new Date().toISOString()
      };
      
      // Room'daki tüm client'lara gönder
      io.to(trackingId).emit('location-update', locationData);
      
      // Debug: Room'daki client sayısını kontrol et
      io.in(trackingId).fetchSockets().then(sockets => {
        console.log(`📊 Room ${trackingId} içindeki client sayısı: ${sockets.length}`);
        if (sockets.length === 0) {
          console.log(`⚠️ Room ${trackingId} boş, veri gönderilemedi`);
        } else {
          console.log(`✅ Room ${trackingId} içindeki ${sockets.length} client'a veri gönderildi`);
        }
      }).catch(err => {
        console.error('Room client listesi alınamadı:', err);
      });

      res.json({ success: true, message: 'Konum kaydedildi' });
    }
  );
});

// Yeni tracking session başlat
app.post('/api/start-session', (req, res) => {
  const { trackingId } = req.body;
  const sessionId = uuidv4();
  
  db.run('INSERT INTO tracking_sessions (id, tracking_id) VALUES (?, ?)', 
    [sessionId, trackingId], 
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ sessionId });
    }
  );
});

// Session durdur
app.post('/api/stop-session', (req, res) => {
  const { sessionId } = req.body;
  
  db.run('UPDATE tracking_sessions SET is_active = 0 WHERE id = ?', 
    [sessionId], 
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true, message: 'Session durduruldu' });
    }
  );
});

// Tracking linkleri listele
app.get('/api/links', (req, res) => {
  db.all('SELECT * FROM tracking_links ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Konum verilerini getir
app.get('/api/locations/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  const { limit = 100, sessionId } = req.query;
  
  let query = 'SELECT * FROM location_data WHERE tracking_id = ?';
  let params = [trackingId];
  
  if (sessionId) {
    query += ' AND session_id = ?';
    params.push(sessionId);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Session'ları getir
app.get('/api/sessions/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  
  db.all('SELECT * FROM tracking_sessions WHERE tracking_id = ? ORDER BY started_at DESC', 
    [trackingId], 
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// İstatistikleri getir
app.get('/api/stats/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  
  db.get(`SELECT 
    COUNT(*) as total_locations,
    COUNT(DISTINCT session_id) as total_sessions,
    MAX(timestamp) as last_location,
    AVG(accuracy) as avg_accuracy
    FROM location_data WHERE tracking_id = ?`, 
    [trackingId], 
    (err, stats) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(stats);
    }
  );
});

// Tracking link sil
app.delete('/api/links/:id', (req, res) => {
  const trackingId = req.params.id;
  
  // Önce link'in var olup olmadığını kontrol et
  db.get('SELECT * FROM tracking_links WHERE id = ?', [trackingId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (!row) {
      res.status(404).json({ error: 'Link bulunamadı' });
      return;
    }
    
    // Link'i deaktif et
    db.run('UPDATE tracking_links SET active = 0 WHERE id = ?', 
      [trackingId], 
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        
        // İlgili konum verilerini de sil (opsiyonel)
        db.run('DELETE FROM location_data WHERE tracking_id = ?', [trackingId], (err) => {
          if (err) {
            console.error('Konum verileri silinirken hata:', err);
          }
          
          res.json({ 
            success: true, 
            message: 'Link başarıyla silindi ve tüm veriler temizlendi',
            deletedLocations: this.changes
          });
        });
      }
    );
  });
});

// QR kod endpoint
app.get('/api/qr/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  const baseUrl = NODE_ENV === 'production' 
    ? `https://${req.get('host')}` 
    : `http://localhost:${PORT}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${baseUrl}/track/${trackingId}`;
  res.json({ qrUrl });
});

// Geofencing endpoint
app.post('/api/geofence', (req, res) => {
  const { trackingId, latitude, longitude, radius, action } = req.body;
  
  db.run('INSERT INTO geofences (tracking_id, latitude, longitude, radius, action) VALUES (?, ?, ?, ?, ?)',
    [trackingId, latitude, longitude, radius, action],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true, message: 'Geofence oluşturuldu' });
    }
  );
});

// Alarm sistemi
app.post('/api/alarm', (req, res) => {
  const { trackingId, type, message, conditions } = req.body;
  
  db.run('INSERT INTO alarms (tracking_id, type, message, conditions) VALUES (?, ?, ?, ?)',
    [trackingId, type, message, JSON.stringify(conditions)],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true, message: 'Alarm oluşturuldu' });
    }
  );
});

// Rota analizi
app.get('/api/route/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  const { startDate, endDate } = req.query;
  
  let query = 'SELECT * FROM location_data WHERE tracking_id = ?';
  let params = [trackingId];
  
  if (startDate && endDate) {
    query += ' AND timestamp BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }
  
  query += ' ORDER BY timestamp ASC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    // Rota analizi
    const route = analyzeRoute(rows);
    res.json(route);
  });
});

// Bildirim sistemi
app.post('/api/notifications', (req, res) => {
  const { trackingId, type, title, message, recipients } = req.body;
  
  db.run('INSERT INTO notifications (tracking_id, type, title, message, recipients) VALUES (?, ?, ?, ?, ?)',
    [trackingId, type, title, message, JSON.stringify(recipients)],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      // WebSocket ile bildirim gönder
      io.to(trackingId).emit('notification', { type, title, message });
      res.json({ success: true, message: 'Bildirim gönderildi' });
    }
  );
});

// Rota analizi fonksiyonu
function analyzeRoute(locations) {
  if (locations.length < 2) {
    return { totalDistance: 0, avgSpeed: 0, stops: [] };
  }
  
  let totalDistance = 0;
  let totalSpeed = 0;
  let speedCount = 0;
  const stops = [];
  
  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i-1];
    const curr = locations[i];
    
    // Mesafe hesapla
    const distance = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    totalDistance += distance;
    
    // Hız hesapla
    if (curr.speed) {
      totalSpeed += curr.speed;
      speedCount++;
    }
    
    // Durak tespiti (5 dakikadan uzun durma)
    const timeDiff = new Date(curr.timestamp) - new Date(prev.timestamp);
    if (timeDiff > 5 * 60 * 1000) { // 5 dakika
      stops.push({
        latitude: curr.latitude,
        longitude: curr.longitude,
        duration: timeDiff / (1000 * 60), // dakika
        timestamp: curr.timestamp
      });
    }
  }
  
  return {
    totalDistance: Math.round(totalDistance * 100) / 100, // km
    avgSpeed: speedCount > 0 ? Math.round((totalSpeed / speedCount) * 3.6) : 0, // km/h
    stops: stops,
    totalLocations: locations.length,
    duration: (new Date(locations[locations.length-1].timestamp) - new Date(locations[0].timestamp)) / (1000 * 60 * 60) // saat
  };
}

// Mesafe hesaplama fonksiyonu (Haversine formülü)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Dünya yarıçapı (km)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Mobil uygulama için API endpoint'leri
app.get('/api/mobile/locations/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  const { limit = 50, since } = req.query;
  
  let query = 'SELECT * FROM location_data WHERE tracking_id = ?';
  let params = [trackingId];
  
  if (since) {
    query += ' AND timestamp > ?';
    params.push(since);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ locations: rows, count: rows.length });
  });
});

// Mobil uygulama için session başlat
app.post('/api/mobile/start-session', (req, res) => {
  const { trackingId, deviceInfo } = req.body;
  const sessionId = uuidv4();
  
  db.run('INSERT INTO tracking_sessions (id, tracking_id, device_info) VALUES (?, ?, ?)', 
    [sessionId, trackingId, JSON.stringify(deviceInfo)], 
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ sessionId, status: 'started' });
    }
  );
});

// Mobil uygulama için konum gönder
app.post('/api/mobile/location', validateLocationData, (req, res) => {
  const { 
    trackingId, 
    latitude, 
    longitude, 
    accuracy, 
    speed = 0,
    heading = 0,
    altitude = 0,
    batteryLevel,
    networkType,
    sessionId 
  } = req.body;
  
  db.run(`INSERT INTO location_data 
    (tracking_id, latitude, longitude, accuracy, speed, heading, altitude, battery_level, network_type, session_id) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [trackingId, latitude, longitude, accuracy, speed, heading, altitude, batteryLevel, networkType, sessionId],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      // Session güncelle
      db.run(`UPDATE tracking_sessions 
        SET last_update = CURRENT_TIMESTAMP, total_locations = total_locations + 1 
        WHERE id = ?`, [sessionId]);

      // Gerçek zamanlı güncelleme gönder
      io.to(trackingId).emit('location-update', {
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        altitude,
        batteryLevel,
        networkType,
        timestamp: new Date().toISOString()
      });

      res.json({ success: true, message: 'Konum kaydedildi' });
    }
  );
});

// Mobil uygulama için geofence kontrolü
app.post('/api/mobile/check-geofence', (req, res) => {
  const { trackingId, latitude, longitude } = req.body;
  
  db.all('SELECT * FROM geofences WHERE tracking_id = ? AND active = 1', 
    [trackingId], 
    (err, geofences) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      const triggeredGeofences = [];
      
      geofences.forEach(geofence => {
        const distance = calculateDistance(latitude, longitude, geofence.latitude, geofence.longitude);
        if (distance <= geofence.radius) {
          triggeredGeofences.push({
            id: geofence.id,
            action: geofence.action,
            distance: Math.round(distance * 1000) // metre
          });
        }
      });
      
      res.json({ triggeredGeofences });
    }
  );
});

// Arka plan konum takibi için endpoint
app.post('/api/background-location', validateLocationData, (req, res) => {
  const { 
    trackingId, 
    latitude, 
    longitude, 
    accuracy, 
    speed = 0,
    heading = 0,
    altitude = 0,
    userAgent, 
    ipAddress,
    sessionId 
  } = req.body;
  
  // Session kontrolü
  if (!sessionId) {
    res.status(400).json({ error: 'Session ID gerekli' });
    return;
  }

  db.run(`INSERT INTO location_data 
    (tracking_id, latitude, longitude, accuracy, speed, heading, altitude, user_agent, ip_address, session_id) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [trackingId, latitude, longitude, accuracy, speed, heading, altitude, userAgent, ipAddress, sessionId],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      // Session güncelle
      db.run(`UPDATE tracking_sessions 
        SET last_update = CURRENT_TIMESTAMP, total_locations = total_locations + 1 
        WHERE id = ?`, [sessionId]);

      // Gerçek zamanlı güncelleme gönder
      console.log(`🔍 Background Socket.IO emit: trackingId=${trackingId}, room=${trackingId}`);
      console.log(`📡 Emitting background location-update to room: ${trackingId}`);
      io.to(trackingId).emit('location-update', {
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        altitude,
        timestamp: new Date().toISOString()
      });

      res.json({ success: true, message: 'Arka plan konumu kaydedildi' });
    }
  );
});

// Service Worker için manifest endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Location Tracker',
    short_name: 'Tracker',
    description: 'Konum takip uygulaması',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1976d2',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png'
      }
    ]
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda çalışıyor`);
  console.log(`📱 Admin paneli: http://localhost:${PORT}`);
  console.log(`🔗 WebSocket aktif`);
}); 