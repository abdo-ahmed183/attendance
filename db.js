/**
 * db.js — IndexedDB wrapper.
 * Stores:
 *   students   : keyPath 'id'      -> { id, name, phone }
 *   attendance : keyPath 'localId' (autoIncrement) -> { localId, id, name, center, timestamp, homework, assistant, synced }
 *   meta       : keyPath 'key'     -> { key, value }
 *
 * All students are also cached in memory (window.AppDB.studentCache) after
 * init/replace so manual search + duplicate-phone lookups are instant and
 * work fully offline without a full table scan on every keystroke.
 */
(function () {
  const DB_NAME = 'attendance_db';
  const DB_VERSION = 2; // تحديث الإصدار لتفعيل تمليك الفهارس السريعة (Phone Index) بأمان
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // تفعيل الـ Index السريع للبحث عن الأخوة برقم الهاتف
        if (!db.objectStoreNames.contains('students')) {
          const store = db.createObjectStore('students', { keyPath: 'id' });
          store.createIndex('phone', 'phone', { unique: false });
        } else {
          const store = e.target.transaction.objectStore('students');
          if (!store.indexNames.contains('phone')) {
            store.createIndex('phone', 'phone', { unique: false });
          }
        }

        if (!db.objectStoreNames.contains('attendance')) {
          const store = db.createObjectStore('attendance', { keyPath: 'localId', autoIncrement: true });
          store.createIndex('synced', 'synced', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const AppDB = {
    studentCache: [], // in-memory mirror of the students store

    async init() {
      await openDB();
      this.studentCache = await this.getAllStudents();
    },

    // ---------- students ----------
    async replaceStudents(students) {
      const store = await tx('students', 'readwrite');
      await reqToPromise(store.clear());
      for (const s of students) {
        store.put(s);
      }
      await new Promise((resolve, reject) => {
        store.transaction.oncomplete = resolve;
        store.transaction.onerror = reject;
      });
      this.studentCache = students;
    },

    async getAllStudents() {
      const store = await tx('students', 'readonly');
      return reqToPromise(store.getAll());
    },

    getStudentById(id) {
      const norm = String(id).trim();
      return this.studentCache.find((s) => String(s.id).trim() === norm) || null;
    },

    getStudentsByPhone(phone) {
      const norm = String(phone).trim().replace(/\s+/g, '');
      return this.studentCache.filter((s) => String(s.phone).trim().replace(/\s+/g, '') === norm);
    },

    searchStudents(query, limit = 20) {
      const q = String(query).trim().toLowerCase();
      if (!q) return [];
      const results = this.studentCache.filter((s) => {
        return (
          String(s.id).toLowerCase().includes(q) ||
          String(s.phone).toLowerCase().includes(q) ||
          String(s.name).toLowerCase().includes(q)
        );
      });
      return results.slice(0, limit);
    },

    // ---------- attendance ----------
    async addAttendance(record) {
      const store = await tx('attendance', 'readwrite');
      const toStore = Object.assign({ synced: 0 }, record);
      const id = await reqToPromise(store.add(toStore));
      return id;
    },

    async getAllAttendance() {
      const store = await tx('attendance', 'readonly');
      const all = await reqToPromise(store.getAll());
      return all.sort((a, b) => b.localId - a.localId);
    },

    async getUnsyncedAttendance() {
      const all = await this.getAllAttendance();
      return all.filter((r) => !r.synced);
    },

    async markSynced(localIds) {
      const store = await tx('attendance', 'readwrite');
      for (const id of localIds) {
        const record = await reqToPromise(store.get(id));
        if (record) {
          record.synced = 1;
          store.put(record);
        }
      }
      return new Promise((resolve, reject) => {
        store.transaction.oncomplete = resolve;
        store.transaction.onerror = reject;
      });
    },

    // ---------- meta ----------
    async getMeta(key) {
      const store = await tx('meta', 'readonly');
      const row = await reqToPromise(store.get(key));
      return row ? row.value : null;
    },

    async setMeta(key, value) {
      const store = await tx('meta', 'readwrite');
      store.put({ key, value });
      return new Promise((resolve, reject) => {
        store.transaction.oncomplete = resolve;
        store.transaction.onerror = reject;
      });
    },

    // ---------- danger zone ----------
    async clearAll() {
      const db = await openDB();
      await Promise.all(
        ['students', 'attendance', 'meta'].map(
          (name) =>
            new Promise((resolve, reject) => {
              const store = db.transaction(name, 'readwrite').objectStore(name);
              const r = store.clear();
              r.onsuccess = resolve;
              r.onerror = reject;
            })
        )
      );
      this.studentCache = [];
    },
  };

  window.AppDB = AppDB;
})();