self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "BackEvent",
    body: "Ny besked fra BackEvent",
    messageId: null,
    url: "/notifikationer",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "BackEvent", {
      body: payload.body || "Ny besked fra BackEvent",
      icon: "/icons/backevent-icon.svg",
      badge: "/icons/backevent-icon.svg",
      data: {
        messageId: payload.messageId || null,
        url: payload.url || (payload.messageId ? `/notifikationer/${payload.messageId}` : "/notifikationer"),
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || (event.notification.data?.messageId ? `/notifikationer/${event.notification.data.messageId}` : "/notifikationer");

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          const clientUrl = new URL(client.url);
          if (clientUrl.pathname === targetUrl) {
            return client.focus();
          }
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
