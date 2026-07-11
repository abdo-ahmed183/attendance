/**
 * app.js — UI wiring and business logic for the attendance app.
 * Depends on: db.js (AppDB), sync.js (Sync), html5-qrcode, SheetJS (XLSX).
 */
(async function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Element refs
  // ---------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const els = {
    topbarCenter: $('#topbarCenter'),
    syncPill: $('#syncPill'),
    syncPillText: $('#syncPillText'),

    centerSelect: $('#centerSelect'),
    btnStartSession: $('#btnStartSession'),
    btnGoSettingsFromGate: $('#btnGoSettingsFromGate'),
    gateSyncInfo: $('#gateSyncInfo'),

    manualSearch: $('#manualSearch'),
    searchResults: $('#searchResults'),
    statPresent: $('#statPresent'),
    statPending: $('#statPending'),
    statStudents: $('#statStudents'),
    scanSeal: $('#scanSeal'),

    historyCount: $('#historyCount'),
    logTable: $('#logTable'),
    btnSyncNow: $('#btnSyncNow'),
    btnExport: $('#btnExport'),
    navHistoryBadge: $('#navHistoryBadge'),

    apiUrlInput: $('#apiUrlInput'),
    btnSaveApiUrl: $('#btnSaveApiUrl'),
    btnSyncStudents: $('#btnSyncStudents'),
    syncStudentsBtnText: $('#syncStudentsBtnText'),
    lastSyncText: $('#lastSyncText'),
    btnPushLogs: $('#btnPushLogs'),
    pendingSyncText: $('#pendingSyncText'),
    settingsCurrentCenter: $('#settingsCurrentCenter'),
    btnChangeCenter: $('#btnChangeCenter'),
    btnWipeLocal: $('#btnWipeLocal'),

    bottomNav: $('#bottomNav'),

    modalDuplicate: $('#modalDuplicate'),
    duplicateList: $('#duplicateList'),
    btnCancelDuplicate: $('#btnCancelDuplicate'),

    modalConfirm: $('#modalConfirm'),
    confirmAvatar: $('#confirmAvatar'),
    confirmName: $('#confirmName'),
    confirmMeta: $('#confirmMeta'),
    hwYes: $('#hwYes'),
    hwNo: $('#hwNo'),
    btnCancelConfirm: $('#btnCancelConfirm'),
    btnSaveConfirm: $('#btnSaveConfirm'),

    toast: $('#toast'),
  };

  // ---------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------
  const state = {
    currentCenter: sessionStorage.getItem('activeCenter') || '',
    pendingStudent: null,
    hwChoice: null,
    scannerRunning: false,
  };

  let html5QrCode = null;

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function showToast(message, kind = '') {
    els.toast.textContent = message;
    els.toast.className = 'toast show ' + kind;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      els.toast.className = 'toast ' + kind;
    }, 2200);
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function todayPrefix() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function initials(name) {
    return (name || '?').trim().charAt(0) || '?';
  }

  // ---------------------------------------------------------------------
  // View switching
  // ---------------------------------------------------------------------
  function switchView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const target = document.getElementById(`view-${name}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-btn[data-view="${name}"]`);
    if (navBtn) navBtn.classList.add('active');

    els.bottomNav.style.display = name === 'gate' ? 'none' : 'flex';

    if (name === 'scan') {
      startScanner();
      refreshStats();
    } else {
      stopScanner();
    }
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
  }

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === 'scan' && !state.currentCenter) {
        switchView('gate');
        return;
      }
      switchView(view);
    });
  });

  // ---------------------------------------------------------------------
  // Center gate
  // ---------------------------------------------------------------------
  async function populateCenters() {
    const centers = (await AppDB.getMeta('centers')) || [];
    els.centerSelect.innerHTML = '<option value="">-- اختر السنتر --</option>';
    centers.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      els.centerSelect.appendChild(opt);
    });
    if (state.currentCenter) els.centerSelect.value = state.currentCenter;

    const lastSync = await AppDB.getMeta('lastSync');
    els.gateSyncInfo.textContent = lastSync
      ? `آخر مزامنة لبيانات الطلاب: ${lastSync}`
      : 'لم تتم أي مزامنة بعد — اذهب إلى الإعدادات لتحميل بيانات الطلاب أولاً.';
  }

  els.btnStartSession.addEventListener('click', () => {
    const center = els.centerSelect.value;
    if (!center) {
      showToast('اختر السنتر أولاً', 'bad');
      return;
    }
    state.currentCenter = center;
    sessionStorage.setItem('activeCenter', center);
    updateCenterChip();
    switchView('scan');
  });

  els.btnGoSettingsFromGate.addEventListener('click', () => switchView('settings'));

  function updateCenterChip() {
    els.topbarCenter.textContent = state.currentCenter
      ? `السنتر: ${state.currentCenter}`
      : 'لم يتم اختيار السنتر';
    els.settingsCurrentCenter.textContent = state.currentCenter || '-';
  }

  // ---------------------------------------------------------------------
  // QR Scanner
  // ---------------------------------------------------------------------
  async function startScanner() {
    if (state.scannerRunning) return;
    if (!window.Html5Qrcode) return;
    try {
      html5QrCode = html5QrCode || new Html5Qrcode('qr-reader', { verbose: false });
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        onScanSuccess,
        () => {} // ignore per-frame decode failures
      );
      state.scannerRunning = true;
    } catch (err) {
      console.warn('Camera unavailable, falling back to manual search only.', err);
      showToast('تعذر تشغيل الكاميرا — يمكنك البحث اليدوي', '');
    }
  }

  async function stopScanner() {
    if (!state.scannerRunning || !html5QrCode) return;
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) { /* no-op */ }
    state.scannerRunning = false;
  }

  let scanLocked = false;
  async function onScanSuccess(decodedText) {
    if (scanLocked) return;
    scanLocked = true;
    setTimeout(() => (scanLocked = false), 1500); // debounce repeat reads of the same code

    flashSeal(true);
    const id = decodedText.trim();
    const student = AppDB.getStudentById(id);
    if (!student) {
      showToast(`لا يوجد طالب بالرقم ${id}`, 'bad');
      flashSeal(false);
      return;
    }
    await openConfirmModal(student);
  }

  function flashSeal(success) {
    els.scanSeal.classList.toggle('success', success);
    if (success) setTimeout(() => els.scanSeal.classList.remove('success'), 900);
  }

  // ---------------------------------------------------------------------
  // Manual search
  // ---------------------------------------------------------------------
  let searchDebounce = null;
  els.manualSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runInlineSearch, 180);
  });
  els.manualSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSearch(els.manualSearch.value.trim());
    }
  });

  function runInlineSearch() {
    const q = els.manualSearch.value.trim();
    if (!q) {
      els.searchResults.style.display = 'none';
      els.searchResults.innerHTML = '';
      return;
    }
    const results = AppDB.searchStudents(q, 15);
    if (!results.length) {
      els.searchResults.style.display = 'block';
      els.searchResults.innerHTML = `<div class="result-item"><span style="color:var(--muted)">لا توجد نتائج</span></div>`;
      return;
    }
    els.searchResults.style.display = 'block';
    els.searchResults.innerHTML = results
      .map(
        (s) => `<div class="result-item" data-id="${s.id}">
          <span>${s.name}</span>
          <span class="mono" style="color:var(--muted);font-size:12px;">#${s.id}</span>
        </div>`
      )
      .join('');
    els.searchResults.querySelectorAll('.result-item[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const s = AppDB.getStudentById(row.dataset.id);
        if (s) {
          clearSearch();
          openConfirmModal(s);
        }
      });
    });
  }

  function clearSearch() {
    els.manualSearch.value = '';
    els.searchResults.style.display = 'none';
    els.searchResults.innerHTML = '';
  }

  /** Enter pressed / explicit search: resolves exact ID or phone matches,
   *  triggering the dedicated duplicate-phone picker when needed. */
  function commitSearch(query) {
    if (!query) return;

    // 1) exact ID match — IDs are unique, go straight to confirm.
    const byId = AppDB.getStudentById(query);
    if (byId) {
      clearSearch();
      openConfirmModal(byId);
      return;
    }

    // 2) phone match — may hit siblings sharing a parent's number.
    const byPhone = AppDB.getStudentsByPhone(query);
    if (byPhone.length === 1) {
      clearSearch();
      openConfirmModal(byPhone[0]);
      return;
    }
    if (byPhone.length > 1) {
      clearSearch();
      openDuplicateModal(byPhone);
      return;
    }

    // 3) fall back to fuzzy inline results (already shown by input listener)
    if (!AppDB.searchStudents(query, 1).length) {
      showToast('لم يتم العثور على أي طالب مطابق', 'bad');
    }
  }

  // ---------------------------------------------------------------------
  // Duplicate-phone modal
  // ---------------------------------------------------------------------
  function openDuplicateModal(students) {
    els.duplicateList.innerHTML = students
      .map(
        (s) => `<div class="result-item" data-id="${s.id}">
          <span>${s.name}</span>
          <span class="mono" style="color:var(--muted);font-size:12px;">#${s.id}</span>
        </div>`
      )
      .join('');
    els.duplicateList.querySelectorAll('.result-item[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const s = AppDB.getStudentById(row.dataset.id);
        closeDuplicateModal();
        if (s) openConfirmModal(s);
      });
    });
    els.modalDuplicate.classList.add('active');
  }
  function closeDuplicateModal() {
    els.modalDuplicate.classList.remove('active');
  }
  els.btnCancelDuplicate.addEventListener('click', closeDuplicateModal);

  // ---------------------------------------------------------------------
  // Confirm (homework) modal
  // ---------------------------------------------------------------------
  async function openConfirmModal(student) {
    state.pendingStudent = student;
    state.hwChoice = null;
    els.confirmAvatar.textContent = initials(student.name);
    els.confirmName.textContent = student.name;
    els.confirmMeta.textContent = `#${student.id} · ${state.currentCenter} · ${nowStamp()}`;
    els.hwYes.classList.remove('selected', 'yes');
    els.hwNo.classList.remove('selected', 'no');
    els.btnSaveConfirm.disabled = true;
    els.modalConfirm.classList.add('active');
  }
  function closeConfirmModal() {
    els.modalConfirm.classList.remove('active');
    state.pendingStudent = null;
    state.hwChoice = null;
  }
  els.btnCancelConfirm.addEventListener('click', closeConfirmModal);

  els.hwYes.addEventListener('click', () => {
    state.hwChoice = 'yes';
    els.hwYes.classList.add('selected', 'yes');
    els.hwNo.classList.remove('selected', 'no');
    els.btnSaveConfirm.disabled = false;
  });
  els.hwNo.addEventListener('click', () => {
    state.hwChoice = 'no';
    els.hwNo.classList.add('selected', 'no');
    els.hwYes.classList.remove('selected', 'yes');
    els.btnSaveConfirm.disabled = false;
  });

  els.btnSaveConfirm.addEventListener('click', async () => {
    if (!state.pendingStudent || !state.hwChoice) return;
    const student = state.pendingStudent;
    const record = {
      id: String(student.id),
      name: student.name,
      center: state.currentCenter,
      timestamp: nowStamp(),
      homework: state.hwChoice === 'yes' ? 'Yes' : 'No',
    };
    await AppDB.addAttendance(record);
    closeConfirmModal();
    showToast(`تم تسجيل حضور: ${student.name}`, 'good');
    refreshStats();
    updateNavBadge();
    // Best-effort silent sync; failures are fine, it stays queued locally.
    if (Sync.isOnline()) pushLogsNow({ silent: true });
  });

  // ---------------------------------------------------------------------
  // Stats / history
  // ---------------------------------------------------------------------
  async function refreshStats() {
    const all = await AppDB.getAllAttendance();
    const todayCount = all.filter((r) => r.timestamp.startsWith(todayPrefix())).length;
    const pending = all.filter((r) => !r.synced).length;
    els.statPresent.textContent = todayCount;
    els.statPending.textContent = pending;
    els.statStudents.textContent = AppDB.studentCache.length;
  }

  async function updateNavBadge() {
    const unsynced = await AppDB.getUnsyncedAttendance();
    if (unsynced.length > 0) {
      els.navHistoryBadge.style.display = 'inline-block';
      els.navHistoryBadge.textContent = unsynced.length;
    } else {
      els.navHistoryBadge.style.display = 'none';
    }
  }

  async function renderHistory() {
    const all = await AppDB.getAllAttendance();
    els.historyCount.textContent = `${all.length} سجل`;
    if (!all.length) {
      els.logTable.innerHTML = `<div class="empty-state">لا توجد سجلات حضور بعد.<br>ابدأ بمسح أول طالب من تبويب المسح.</div>`;
      return;
    }
    els.logTable.innerHTML = all
      .map(
        (r) => `<div class="log-row">
          <span class="id mono">#${r.id}</span>
          <span class="info">
            <div class="n">${r.name}</div>
            <div class="t mono">${r.timestamp} · ${r.center}</div>
          </span>
          <span class="hw-badge ${r.homework === 'Yes' ? 'yes' : 'no'}">${r.homework === 'Yes' ? 'واجب ✓' : 'واجب ✗'}</span>
          <span class="sync-dot ${r.synced ? 'synced' : ''}" title="${r.synced ? 'تمت المزامنة' : 'بانتظار المزامنة'}"></span>
        </div>`
      )
      .join('');
  }

  els.btnSyncNow.addEventListener('click', () => pushLogsNow({ silent: false }));

  els.btnExport.addEventListener('click', async () => {
    const all = await AppDB.getAllAttendance();
    if (!all.length) {
      showToast('لا توجد سجلات لتصديرها', 'bad');
      return;
    }
    const rows = all.map((r) => ({
      'الرقم التعريفى': r.id,
      'اسم الطالب': r.name,
      'السنتر': r.center,
      'تاريخ ووقت الحضور': r.timestamp,
      'حالة الواجب': r.homework,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الحضور');
    const filename = `attendance_${todayPrefix()}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast('تم تصدير الملف بنجاح', 'good');
  });

  // ---------------------------------------------------------------------
  // Settings view
  // ---------------------------------------------------------------------
  async function renderSettings() {
    const apiUrl = await Sync.getApiUrl();
    els.apiUrlInput.value = apiUrl || '';
    const lastSync = await AppDB.getMeta('lastSync');
    els.lastSyncText.textContent = lastSync
      ? `آخر مزامنة: ${lastSync} — ${AppDB.studentCache.length} طالب محفوظ محليًا`
      : 'لم تتم أي مزامنة بعد.';
    const unsynced = await AppDB.getUnsyncedAttendance();
    els.pendingSyncText.textContent = `${unsynced.length} سجل بانتظار الرفع.`;
    els.settingsCurrentCenter.textContent = state.currentCenter || '-';
  }

  els.btnSaveApiUrl.addEventListener('click', async () => {
    const url = els.apiUrlInput.value.trim();
    if (!url) { showToast('أدخل رابطًا صحيحًا', 'bad'); return; }
    await Sync.setApiUrl(url);
    showToast('تم حفظ الرابط', 'good');
  });

  els.btnSyncStudents.addEventListener('click', async () => {
    els.btnSyncStudents.disabled = true;
    els.syncStudentsBtnText.innerHTML = '<span class="spinner"></span> جارِ المزامنة...';
    try {
      const { students, centers } = await Sync.fetchBootstrap();
      await AppDB.replaceStudents(students);
      await AppDB.setMeta('centers', centers);
      await AppDB.setMeta('lastSync', nowStamp());
      showToast(`تم تحديث ${students.length} طالب و ${centers.length} سنتر`, 'good');
      await populateCenters();
      await renderSettings();
      await refreshStats();
    } catch (err) {
      showToast(err.message || 'فشلت المزامنة', 'bad');
    } finally {
      els.btnSyncStudents.disabled = false;
      els.syncStudentsBtnText.textContent = 'تحديث قاعدة بيانات الطلاب الآن';
    }
  });

  els.btnPushLogs.addEventListener('click', () => pushLogsNow({ silent: false }));

  els.btnChangeCenter.addEventListener('click', () => {
    state.currentCenter = '';
    sessionStorage.removeItem('activeCenter');
    updateCenterChip();
    populateCenters();
    switchView('gate');
  });

  els.btnWipeLocal.addEventListener('click', async () => {
    if (!confirm('سيتم مسح جميع بيانات الطلاب وسجلات الحضور المحفوظة على هذا الجهاز. هل أنت متأكد؟')) return;
    await AppDB.clearAll();
    sessionStorage.removeItem('activeCenter');
    showToast('تم مسح البيانات المحلية', 'good');
    setTimeout(() => location.reload(), 800);
  });

  // ---------------------------------------------------------------------
  // Sync orchestration
  // ---------------------------------------------------------------------
  async function pushLogsNow({ silent }) {
    const unsynced = await AppDB.getUnsyncedAttendance();
    if (!unsynced.length) {
      if (!silent) showToast('لا توجد سجلات جديدة للرفع', '');
      return;
    }
    if (!Sync.isOnline()) {
      if (!silent) showToast('لا يوجد اتصال بالإنترنت الآن — سيتم الرفع تلقائيًا عند عودة الاتصال', 'bad');
      return;
    }
    updateSyncPill('pending');
    try {
      await Sync.pushAttendance(unsynced);
      await AppDB.markSynced(unsynced.map((r) => r.localId));
      if (!silent) showToast(`تم رفع ${unsynced.length} سجل بنجاح`, 'good');
      refreshStats();
      updateNavBadge();
      renderHistory();
      renderSettings();
    } catch (err) {
      if (!silent) showToast(err.message || 'فشل رفع السجلات', 'bad');
    } finally {
      updateSyncPill();
    }
  }

  async function updateSyncPill(force) {
    const online = Sync.isOnline();
    els.syncPill.classList.remove('online', 'offline', 'pending');
    if (force === 'pending') {
      els.syncPill.classList.add('pending');
      els.syncPillText.textContent = 'جارِ المزامنة...';
      return;
    }
    if (!online) {
      els.syncPill.classList.add('offline');
      els.syncPillText.textContent = 'غير متصل';
      return;
    }
    const unsynced = await AppDB.getUnsyncedAttendance();
    if (unsynced.length > 0) {
      els.syncPill.classList.add('pending');
      els.syncPillText.textContent = `${unsynced.length} بانتظار المزامنة`;
    } else {
      els.syncPill.classList.add('online');
      els.syncPillText.textContent = 'متصل ومحدث';
    }
  }
  els.syncPill.addEventListener('click', () => pushLogsNow({ silent: false }));

  window.addEventListener('online', () => {
    updateSyncPill();
    showToast('تم استعادة الاتصال — جارِ رفع السجلات...', '');
    pushLogsNow({ silent: true });
  });
  window.addEventListener('offline', () => updateSyncPill());

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function boot() {
    await AppDB.init();
    updateCenterChip();
    await populateCenters();
    await updateSyncPill();
    await updateNavBadge();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    if (state.currentCenter) {
      switchView('scan');
    } else {
      switchView('gate');
    }
  }

  boot();
})();
