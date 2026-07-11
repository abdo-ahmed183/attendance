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
 *   POST {API_URL}    body wrapped in an action object with a protection token:
 *        { token: API_TOKEN, action: "syncAttendance", data: [ { id, name, center, timestamp, homework, assistant }, ... ] }
 *      -> { status: "success", inserted: <n> }
 *
 * POST uses Content-Type: text/plain to dodge CORS preflight (Apps Script
 * doesn't respond to OPTIONS), which is the standard workaround for calling
 * Apps Script web apps from a browser.
 */
(function () {
  // توكن الحماية السري للمزامنة الآمنة المرفوعة على Google Apps Script
  const API_TOKEN = "MySecretAttendanceToken2026";

  const Sync = {
    async getApiUrl() {
      return "https://script.google.com/macros/s/AKfycbxCgPtSoyPA3c04agllpCmpYKPbeI7eYDoR2jaYbY9hpLJI4s9gvAf3MvZmSOVoEg/exec";
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

    /** Pushes a batch of local attendance records up to the sheet in one call with retries. */
    async pushAttendance(records) {
      const apiUrl = await this.getApiUrl();
      if (!apiUrl) throw new Error('لم يتم ضبط رابط الـ API بعد.');
      if (!this.isOnline()) throw new Error('لا يوجد اتصال بالإنترنت.');
      if (!records.length) return { status: 'success', inserted: 0 };

      // إعداد البيانات وتضمين حقل اسم المساعد لكل سجل حضور تم مسحه
      const mappedRecords = records.map((r) => ({
        id: r.id,
        name: r.name,
        center: r.center,
        timestamp: r.timestamp,
        homework: r.homework,
        assistant: r.assistant || 'غير محدد', 
      }));

      // تغليف طلب الـ POST بتوكن الأمان ونوع العملية للحماية
      const payload = {
        token: API_TOKEN,
        action: 'syncAttendance',
        data: mappedRecords
      };

      let lastError = null;
      const maxRetries = 3;

      // آلية إعادة المحاولة لتفادي انقطاع الإنترنت المؤقت
      for (let i = 0; i < maxRetries; i++) {
        try {
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
            body: JSON.stringify(payload),
          });
          
          if (!res.ok) throw new Error(`فشل رفع السجلات وتجاوب السيرفر بـ (${res.status})`);
          
          const data = await res.json();
          if (data.status !== 'success') throw new Error(data.message || 'فشل رفع السجلات إلى الشيت.');
          
          return data; // نجاح العملية، ارجع بالنتيجة فوراً
        } catch (err) {
          lastError = err;
          console.warn(`⚠️ محاولة مزامنة فاشلة رقم ${i + 1}. جاري المحاولة مجدداً خلال ثانيتين...`);
          if (i < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      // إذا فشلت كل المحاولات، ارمي آخر خطأ حدث للتعامل معه في الواجهة
      throw lastError;
    },
  };

  window.Sync = Sync;
})();