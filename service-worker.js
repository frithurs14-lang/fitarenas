const CACHE_NAME = 'app-cache-v3';
const urlsToCache = [
  '/',
  '/fitarenas/index.html',
  '/fitarenas/home.html',
  '/fitarenas/map.html',
  '/fitarenas/chat.html',
  '/fitarenas/activity.html',
  '/fitarenas/leaderboard.html',
  '/fitarenas/profile.html',
  '/fitarenas/style.css',
  '/fitarenas/supabase.js',
  '/fitarenas/auth.js',
  '/fitarenas/home.js',
  '/fitarenas/map.js',
  '/fitarenas/chat.js',
  '/fitarenas/activity.js',
  '/fitarenas/leaderboard.js',
  '/fitarenas/profile.js',
  '/fitarenas/notifications.js'
];

// Install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Background location sync
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'START_LOCATION') {
    startBackgroundLocation(e.data.userId, e.data.supabaseUrl, e.data.supabaseKey)
  }
  if (e.data && e.data.type === 'STOP_LOCATION') {
    stopBackgroundLocation()
  }
  if (e.data && e.data.type === 'UPDATE_LOCATION') {
    saveLocationToSupabase(
      e.data.lat,
      e.data.lng,
      e.data.userId,
      e.data.status,
      e.data.supabaseUrl,
      e.data.supabaseKey
    )
  }
});

let locationInterval = null

function stopBackgroundLocation() {
  if (locationInterval) {
    clearInterval(locationInterval)
    locationInterval = null
  }
}

async function saveLocationToSupabase(lat, lng, userId, status, supabaseUrl, supabaseKey) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/live_locations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        user_id: userId,
        latitude: lat,
        longitude: lng,
        is_active: true,
        location_status: status,
        updated_at: new Date().toISOString()
      })
    })
  } catch (err) {
    console.log('SW location save error:', err)
  }
}
