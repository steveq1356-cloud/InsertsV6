/* InsertPress Planner — browser storage.
 *   IP.store.ls     small JSON values in localStorage (settings, profiles, tray, session, recents)
 *   IP.store.files  binary STLs in IndexedDB (session restore, recent jobs)
 * Every call fails quietly: private windows and some file:// setups have no storage.
 */
(function () {
  'use strict';
  const IP = window.IP;
  const ls = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage off */ } },
  };
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        if (!window.indexedDB) { rej(new Error('No IndexedDB')); return; }
        const r = indexedDB.open('insertpress', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      dbp.catch(() => {});
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction('files', mode);
      const req = fn(t.objectStore('files'));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const files = {
    get: (k) => tx('readonly', (s) => s.get(k)).catch(() => null),
    put: (k, v) => tx('readwrite', (s) => s.put(v, k)).then(() => true).catch(() => false),
    del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => null),
  };
  IP.store = { ls, files };
})();
