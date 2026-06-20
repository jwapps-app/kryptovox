// Diagnostic: non-consuming read of the service worker's click log, to confirm
// whether notificationclick fired at all.
export async function peekClickLog(): Promise<{ url: string; ts: number }[]> {
  return new Promise((resolve) => {
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open("kryptovox-push", 1);
    } catch {
      resolve([]);
      return;
    }
    open.onupgradeneeded = () => open.result.createObjectStore("nav");
    open.onsuccess = () => {
      const db = open.result;
      let res: { url: string; ts: number }[] = [];
      const tx = db.transaction("nav", "readonly");
      const get = tx.objectStore("nav").get("clicklog");
      get.onsuccess = () => {
        if (Array.isArray(get.result)) res = get.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(res);
      };
      tx.onerror = () => {
        db.close();
        resolve([]);
      };
    };
    open.onerror = () => resolve([]);
  });
}

function takeKey(key: string, maxAgeMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open("kryptovox-push", 1);
    } catch {
      resolve(null);
      return;
    }
    open.onupgradeneeded = () => open.result.createObjectStore("nav");
    open.onsuccess = () => {
      const db = open.result;
      let result: string | null = null;
      const tx = db.transaction("nav", "readwrite");
      const store = tx.objectStore("nav");
      const get = store.get(key);
      get.onsuccess = () => {
        const rec = get.result as { url: string; ts: number } | undefined;
        if (rec && Date.now() - rec.ts < maxAgeMs) result = rec.url;
        store.delete(key);
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    };
    open.onerror = () => resolve(null);
  });
}

// Target stashed by notificationclick (cold launch). Read once on sign-in.
export function takePendingNav(maxAgeMs = 120_000): Promise<string | null> {
  return takeKey("pending", maxAgeMs);
}

// Target stashed by the push event (covers the iOS background-resume case where
// notificationclick never fires). Short window so a normal app open won't jump.
export function takeRecentPush(maxAgeMs = 30_000): Promise<string | null> {
  return takeKey("lastpush", maxAgeMs);
}
