const CACHE_NAME = 'app-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/home.html',
  '/map.html',
  '/chat.html',
  '/activity.html',
  '/leaderboard.html',
  '/profile.html',
  '/css/style.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/home.js',
  '/js/map.js',
  '/js/chat.js',
  '/js/activity.js',
  '/js/leaderboard.js',
  '/js/profile.js',
  '/js/notifications.js'
];

// Install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});