/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("message", (ev) => {
    if (ev.data && ev.data.type === "deregister") {
      self.registration
        .unregister()
        .then(() => {
          return self.clients.matchAll();
        })
        .then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        });
    }
  });
  self.addEventListener("fetch", function (event) {
    if (
      event.request.cache === "only-if-cached" &&
      event.request.mode !== "same-origin"
    ) {
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 0) {
            return response;
          }
          const newHeaders = new Headers(response.headers);
          newHeaders.set(
            "Cross-Origin-Embedder-Policy",
            coepCredentialless ? "credentialless" : "require-corp"
          );
          newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => console.error(e))
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
    window.sessionStorage.removeItem("coiReloadedBySelf");
    const coepDegrading = reloadedBySelf === "coepdegrade";
    if (window.crossOriginIsolated !== false || reloadedBySelf) {
      return;
    }
    if (
      window.isSecureContext &&
      navigator.serviceWorker &&
      window.caches
    ) {
      navigator.serviceWorker
        .register(window.document.currentScript.src)
        .then(
          (registration) => {
            registration.addEventListener("updatefound", () => {
              if (
                !navigator.serviceWorker.controller ||
                registration.installing
              ) {
                window.sessionStorage.setItem("coiReloadedBySelf", "true");
                window.location.reload();
              }
            });
            if (registration.active && !navigator.serviceWorker.controller) {
              window.sessionStorage.setItem("coiReloadedBySelf", "true");
              window.location.reload();
            }
          },
          (err) => {
            console.error("COOP/COEP Service Worker failed to register:", err);
          }
        );
    } else {
      if (coepDegrading) {
        return;
      }
      window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
      window.location.reload();
    }
  })();
}
