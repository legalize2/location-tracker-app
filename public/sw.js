// Service Worker - Arka plan konum takibi
const CACHE_NAME = 'location-tracker-v1';
const LOCATION_CACHE = 'location-data';

// Service Worker kurulumu
self.addEventListener('install', (event) => {
    console.log('Service Worker kuruluyor...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll([
                '/',
                '/track.html',
                '/admin.html'
            ]);
        })
    );
});

// Service Worker aktifleştirme
self.addEventListener('activate', (event) => {
    console.log('Service Worker aktifleştirildi');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Background Sync olayını dinle
self.addEventListener('sync', (event) => {
    console.log('Background Sync tetiklendi:', event.tag);
    
    if (event.tag === 'location-sync') {
        event.waitUntil(handleLocationSync());
    }
});

// Konum senkronizasyonu
async function handleLocationSync() {
    try {
        // IndexedDB'den kaydedilen konumları al
        const locations = await getStoredLocations();
        
        if (locations.length > 0) {
            console.log(`${locations.length} konum verisi gönderiliyor...`);
            
            // Her konumu sunucuya gönder
            for (const location of locations) {
                await sendLocationToServer(location);
            }
            
            // Gönderilen konumları temizle
            await clearStoredLocations();
            console.log('Konum verileri başarıyla gönderildi');
        }
    } catch (error) {
        console.error('Background Sync hatası:', error);
    }
}

// Konum verilerini IndexedDB'ye kaydet
async function storeLocation(locationData) {
    try {
        const db = await openDB();
        const tx = db.transaction([LOCATION_CACHE], 'readwrite');
        const store = tx.objectStore(LOCATION_CACHE);
        
        await store.add({
            ...locationData,
            timestamp: Date.now()
        });
        
        console.log('Konum verisi kaydedildi:', locationData);
    } catch (error) {
        console.error('Konum kaydetme hatası:', error);
    }
}

// IndexedDB'den konum verilerini al
async function getStoredLocations() {
    try {
        const db = await openDB();
        const tx = db.transaction([LOCATION_CACHE], 'readonly');
        const store = tx.objectStore(LOCATION_CACHE);
        
        return await store.getAll();
    } catch (error) {
        console.error('Konum verileri alınamadı:', error);
        return [];
    }
}

// IndexedDB'den konum verilerini temizle
async function clearStoredLocations() {
    try {
        const db = await openDB();
        const tx = db.transaction([LOCATION_CACHE], 'readwrite');
        const store = tx.objectStore(LOCATION_CACHE);
        
        await store.clear();
        console.log('Konum verileri temizlendi');
    } catch (error) {
        console.error('Konum verileri temizleme hatası:', error);
    }
}

// IndexedDB bağlantısını aç
async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LocationTrackerDB', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains(LOCATION_CACHE)) {
                const store = db.createObjectStore(LOCATION_CACHE, { 
                    keyPath: 'timestamp',
                    autoIncrement: true 
                });
                store.createIndex('trackingId', 'trackingId', { unique: false });
            }
        };
    });
}

// Konum verilerini sunucuya gönder
async function sendLocationToServer(locationData) {
    try {
        const response = await fetch('/api/save-location', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(locationData)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Sunucuya gönderme hatası:', error);
        throw error;
    }
}

// Push notification desteği
self.addEventListener('push', (event) => {
    console.log('Push notification alındı:', event);
    
    const options = {
        body: 'Konum takibi devam ediyor...',
        icon: '/icon.png',
        badge: '/badge.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Detayları Gör',
                icon: '/images/checkmark.png'
            },
            {
                action: 'close',
                title: 'Kapat',
                icon: '/images/xmark.png'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('Konum Takibi', options)
    );
});

// Notification tıklama olayı
self.addEventListener('notificationclick', (event) => {
    console.log('Notification tıklandı:', event);
    
    event.notification.close();
    
    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/admin.html')
        );
    }
});

// Mesaj dinleme (ana sayfadan gelen mesajlar)
self.addEventListener('message', (event) => {
    console.log('Service Worker mesajı alındı:', event.data);
    
    if (event.data.type === 'STORE_LOCATION') {
        event.waitUntil(storeLocation(event.data.location));
    } else if (event.data.type === 'TRIGGER_SYNC') {
        event.waitUntil(handleLocationSync());
    }
});

// Fetch olaylarını yakala
self.addEventListener('fetch', (event) => {
    // API isteklerini cache'leme
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // Offline durumda cache'den döndür
                return caches.match(event.request);
            })
        );
    } else {
        // Normal sayfa istekleri için cache-first stratejisi
        event.respondWith(
            caches.match(event.request).then((response) => {
                return response || fetch(event.request);
            })
        );
    }
});

// Periyodik arka plan senkronizasyonu
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'location-sync') {
        event.waitUntil(handleLocationSync());
    }
});

// Konum takibi için özel API endpoint'i
self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/background-location')) {
        event.respondWith(handleBackgroundLocation(event.request));
    }
});

async function handleBackgroundLocation(request) {
    try {
        const locationData = await request.json();
        await storeLocation(locationData);
        
        // Background Sync'i tetikle
        if ('sync' in self.registration) {
            await self.registration.sync.register('location-sync');
        }
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
} 