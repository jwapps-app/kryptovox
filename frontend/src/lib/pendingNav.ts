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

// Reads (and clears) the deep-link target the push service worker stashed on a
// notification tap, so a cold-started app can navigate to the right chat.
export async function takePendingNav(maxAgeMs = 120_000): Promise<string | null> {
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
      const get = store.get("pending");
      get.onsuccess = () => {
        const rec = get.result as { url: string; ts: number } | undefined;
        if (rec && Date.now() - rec.ts < maxAgeMs) result = rec.url;
        store.delete("pending");
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
