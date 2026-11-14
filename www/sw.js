const CACHE='printfair-shell-v7';
const FILES=['./','./index.html','./styles.css','./app.js','./backend-config.js','./backend.js','./domain.js','./storage.js','./assets/xu-100-logo.png','./assets/app-icon.png','./assets/Sample_Research_Paper.pdf','./kiosk.html','./kiosk.css','./kiosk.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)))});
