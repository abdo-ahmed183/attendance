# حضور — Student Attendance PWA

Offline-first attendance scanner for classroom assistants. Built as a
installable Progressive Web App (PWA) with plain HTML/CSS/JS — no build
step, no framework, works on any phone or laptop browser.

## How it works

```
┌─────────────┐   bootstrap (GET)    ┌──────────────────────┐
│   Browser    │ ───────────────────▶│ Google Apps Script    │
│   (PWA)      │◀─────────────────── │  Web App (Code.gs)    │
│              │   students+centers   └──────────┬────────────┘
│  IndexedDB   │                                  │
│  (offline    │   attendance logs (POST)         ▼
│   cache +    │ ───────────────────────▶  Google Sheet
│   log queue) │   (only when online)      (Students / Centers /
└─────────────┘                             Attendance Logs tabs)
```

* **Students Master Table** and **Centers list** live in a Google Sheet.
  The app pulls a full copy into the browser's IndexedDB once ("Sync Now"
  in Settings) and looks students up from that local copy from then on —
  scanning and manual search work with zero network calls.
* **Attendance Logs** are written to IndexedDB immediately on save, then
  pushed to the sheet in the background whenever the device is online
  (auto-push on save, on reconnect, or manually from the sync button/pill).
* A **service worker** caches the app shell (HTML/CSS/JS + the QR and
  Excel libraries) so the app itself still *opens* with no connection at
  all, not just keeps scanning after the first load.

## 1. Set up the Google Sheet backend

1. Create a new Google Sheet with two tabs (names must match exactly):

   | Tab | Columns (row 1 = header) |
   |---|---|
   | `Students` | `الرقم التعريفى` \| `اسم` \| `الهاتف المحمول` |
   | `Centers` | `السنتر` (one center name per row) |

   Fill both with your data. You do **not** need to create the
   `Attendance Logs` tab yourself — `Code.gs` creates it automatically
   (with the right headers) the first time an attendance record is posted.

2. In the sheet, open **Extensions → Apps Script**, delete the placeholder
   code, and paste in the full contents of `backend/Code.gs` from this
   project.

3. **Deploy → New deployment**, click the gear icon and choose type
   **Web app**, then:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then **Authorize access** and approve the
     permissions Google asks for (it needs to read/write this sheet).
   - Copy the **Web app URL** (it ends in `/exec`) — this is what goes into
     the app's Settings screen.

   Whenever you edit `Code.gs` later, you must create a **new version**
   under *Deploy → Manage deployments → ✏️ → New version* for changes to
   go live on that same URL — saving the script alone isn't enough.

   **API contract** (for reference — the app already speaks this):
   - `GET {url}` → raw JSON array of students, keyed exactly
     `الرقم التعريفى` / `اسم` / `الهاتف المحمول`.
   - `GET {url}?action=centers` → raw JSON array of center name strings.
   - `POST {url}` with a single attendance object or an array of them →
     appended as rows into `Attendance Logs`, response
     `{ "status": "success", "inserted": <n> }`.
   - Optional: set `API_KEY` at the top of `Code.gs` to require a matching
     `key` param/field on every request — a light deterrent, not real auth
     (see the comment block in the script for details).

## 2. Deploy the app itself

The app is fully static (`index.html`, `style.css`, `app.js`, `db.js`,
`sync.js`, `sw.js`, `manifest.json`, `icons/`). Host it anywhere that
serves static files over **HTTPS** (required for camera access + service
workers):

- GitHub Pages, Netlify, Vercel, Firebase Hosting, Cloudflare Pages — drag
  the `attendance-app` folder in, done.
- Or serve it locally for testing: `python3 -m http.server 8080` from
  inside the folder, then open `http://localhost:8080` (camera access also
  works on `localhost` without HTTPS).

## 3. First run (per device)

1. Open the app → tap **الإعدادات ومزامنة البيانات** on the start screen.
2. Paste the Apps Script Web App URL and tap **حفظ الرابط**.
3. Tap **تحديث قاعدة بيانات الطلاب الآن** — this downloads the full
   student roster and center list into the device's local storage.
4. Go back, pick the center from the dropdown, tap **ابدأ جلسة المسح**.
5. Optionally: **Add to Home Screen** from the browser menu to install it
   like a native app (uses the `manifest.json` + icons already included).

From here the assistant can scan QR codes or search manually, fully
offline. Re-run step 3 at the start of each day (or whenever the roster
changes) while online.

## Everyday use

- **Scan tab**: camera view for QR codes (which encode `الرقم التعريفى`),
  plus a manual search box right below it for ID or phone number.
  - Typing an exact ID or a phone number and pressing **Enter** jumps
    straight to the confirmation sheet.
  - If a phone number is shared by siblings, a picker shows every student
    tied to that number so the assistant taps the right one — the app
    never auto-confirms an ambiguous phone match.
  - Every successful scan/selection opens a bottom sheet with the
    student's name and a Yes/No toggle for homework completion; **تأكيد
    وحفظ الحضور** logs it locally and (if online) syncs it right away.
- **السجل (History) tab**: every locally logged entry, a sync-status dot
  per row, a manual **مزامنة الآن** button, and **تصدير Excel** to save an
  `.xlsx` of everything logged on the device.
- **الإعدادات (Settings) tab**: API URL, roster re-sync, manual log push,
  change center, and a "danger zone" to wipe local data from the device
  (does not touch the Google Sheet).
- The pill in the top bar shows connection/sync state at a glance and can
  be tapped to force a sync.

## Data model (IndexedDB, per device)

- `students` — mirrored from the `Students` sheet tab, keyed by
  `الرقم التعريفى`.
- `attendance` — every scan logged on this device, each row flagged
  `synced: 0/1` until it's been pushed to the sheet.
- `meta` — API URL, cached center list, last sync timestamp.

## Notes & assumptions

- IDs (`الرقم التعريفى`) are assumed unique per student; phone numbers are
  allowed to repeat (siblings).
- The center chosen at the start of a session is kept in `sessionStorage`
  ("سنتر" chip in the top bar) so it silently applies to every scan until
  changed from Settings — matching the "sticky center" requirement.
- The Apps Script POST endpoint is called with
  `Content-Type: text/plain` on purpose — this is the standard trick to
  avoid a CORS preflight request, which Apps Script web apps don't answer.
- For very large rosters (tens of thousands of students), consider
  swapping the linear in-memory search in `db.js` (`searchStudents`) for
  an indexed prefix search — it's a drop-in change isolated to that one
  function.
