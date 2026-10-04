/* PickEatGo — service worker : notifications push + installation PWA.
   Édition Marque Blanche : le titre, l'icône et le nom de l'application sont portés par la charge utile. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || data.app || "PickEatGo";
  const icon = data.icon || "/icons/icon-192.png";
  const options = {
    body: data.body || "",
    icon,
    badge: icon,
    tag: data.tag || "pickeatgo",
    renotify: true,
    vibrate: [100, 50, 100],
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const same = list.find((c) => c.url && new URL(c.url).pathname === new URL(url, self.location.origin).pathname) || list[0];
      if (same && "focus" in same) {
        return Promise.resolve(same.navigate ? same.navigate(url) : null).catch(() => self.clients.openWindow(url)).then(() => same.focus());
      }
      return self.clients.openWindow(url);
    })
  );
});
