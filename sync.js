/**
 * sync.js — All communication with the Google Sheets backend.
 *
 * The backend is a Google Apps Script Web App (see backend/Code.gs) deployed
 * with "Anyone" access. Contract:
 *
 *   GET  {API_URL}                 -> raw JSON array of students:
 *        [ { "الرقم التعريفى": "1001", "اسم": "...", "الهاتف المحمول": "..." }, ... ]
 *
 *   GET  {API_URL}?action=centers  -> raw JSON array of center names:
 *        [ "Center A", "Center B", ... ]
 *
 *   POST {API_URL}   body: a single record OR an array of records:
 *        { id, name, center, timestamp, homework }
 *      -> { status: "success", inserted: <n> }
 *
 * POST uses Content-Type: text/plain to dodge CORS preflight (Apps Script
 * doesn't respond to OPTIONS), which is the standard workaround for calling
 * Apps Script web apps from a browser.
 */
(function () {
  const Sync = {
    async getApiUrl() {
      return AppDB.getMeta('apiUrl');
    },
    async setApiUrl(url) {
      return AppDB.setMeta('apiUrl', url.trim());
    },

    isOnline() {
      return navigator.onLine;
    },

    /** Pulls the full student roster + center list from the sheet. */
    async fetchBootstrap() {
      const apiUrl = await this.getApiUrl();
      if (!apiUrl) throw new Error('لم يتم ضبط رابط الـ API بعد. افتح الإعدادات أولاً.');
      if (!this.isOnline()) throw new Error('لا يوجد اتصال بالإنترنت.');

      const [studentsRes, centersRes] = await Promise.all([
        fetch(`${apiUrl}?_=${Date.now()}`, { method: 'GET' }),
        fetch(`${apiUrl}?action=centers&_=${Date.now()}`, { method: 'GET' }),
      ]);

      if (!studentsRes.ok) throw new Error(`فشل جلب بيانات الطلاب (${studentsRes.status})`);
      if (!centersRes.ok) throw new Error(`فشل جلب قائمة السناتر (${centersRes.status})`);

      const studentsRaw = await studentsRes.json();
      const centersRaw = await centersRes.json();

      if (studentsRaw && studentsRaw.status === 'error') throw new Error(studentsRaw.message || 'فشل جلب بيانات الطلاب.');
      if (centersRaw && centersRaw.status === 'error') throw new Error(centersRaw.message || 'فشل جلب قائمة السناتر.');

      // Normalize the Arabic-keyed rows into the {id,name,phone} shape the
      // rest of the app (db.js, app.js) works with.
      const students = (studentsRaw || []).map((s) => ({
        id: String(s['الرقم التعريفى']).trim(),
        name: String(s['اسم'] || '').trim(),
        phone: String(s['الهاتف المحمول'] || '').trim(),
      }));
      const centers = (centersRaw || []).map((c) => String(c).trim()).filter(Boolean);
      return { students, centers };
    },

    /** Pushes a batch of local attendance records up to the sheet in one call. */
    async pushAttendance(records) {
      const apiUrl = await this.getApiUrl();
      if (!apiUrl) throw new Error('لم يتم ضبط رابط الـ API بعد.');
      if (!this.isOnline()) throw new Error('لا يوجد اتصال بالإنترنت.');
      if (!records.length) return { status: 'success', inserted: 0 };

      const body = records.map((r) => ({
        id: r.id,
        name: r.name,
        center: r.center,
        timestamp: r.timestamp,
        homework: r.homework,
      }));

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`فشل رفع السجلات (${res.status})`);
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.message || 'فشل رفع السجلات إلى الشيت.');
      return data;
    },
  };

  window.Sync = Sync;
})();
