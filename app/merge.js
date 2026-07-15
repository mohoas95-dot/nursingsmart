const fs = require('fs');
const path = require('path');

// مسیر فایل‌ها (نام‌ها را متناسب با فایل‌های خود تغییر دهید)
const ORIGINAL_FILE_PATH = path.join(__dirname, 'app', 'page_original.tsx'); // فایل سالم ۵۵۰۰ خطی شما
const NEW_FILE_PATH = path.join(__dirname, 'app', 'page_new.tsx'); // فایل ۵۰۰ خطی حاوی ویژگی‌های جدید
const OUTPUT_FILE_PATH = path.join(__dirname, 'app', 'page.tsx'); // فایل نهایی ادغام شده

try {
  console.log('⏳ در حال خواندن فایل‌ها...');
  const originalCode = fs.readFileSync(ORIGINAL_FILE_PATH, 'utf8');
  const newCode = fs.readFileSync(NEW_FILE_PATH, 'utf8');

  let mergedCode = originalCode;

  // ۱. اضافه کردن کامپوننت مودال جدید (EditRequestModal) قبل از کامپوننت اصلی Home
  if (newCode.includes('function EditRequestModal') && !originalCode.includes('function EditRequestModal')) {
    console.log('➕ اضافه کردن مودال ویرایش درخواست...');
    const modalStartIndex = newCode.indexOf('function EditRequestModal');
    const modalEndIndex = newCode.indexOf('export default function Home');
    const modalCode = newCode.substring(modalStartIndex, modalEndIndex);
    
    // جاگذاری قبل از Home
    mergedCode = mergedCode.replace('export default function Home', `${modalCode}\nexport default function Home`);
  }

  // ۲. اضافه کردن استیت‌های جدید به کامپوننت Home
  const newStates = `
  // درخواست ۸: state برای ویرایش درخواست در پنل پرسنل
  const [editingPersonnelRequest, setEditingPersonnelRequest] = useState<ShiftRequest | null>(null);
  
  // درخواست ۵: state برای collapsible هشدارها
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [dismissedAlertWarnings, setDismissedAlertWarnings] = useState<{ [key: string]: boolean }>({});
  `;

  if (!mergedCode.includes('editingPersonnelRequest')) {
    console.log('➕ اضافه کردن استیت‌های جدید...');
    // اضافه کردن استیت‌ها بعد از تعریف selectedDepartmentId در فایل اصلی
    const searchTarget = `const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>(() => {`;
    const targetIdx = mergedCode.indexOf(searchTarget);
    if (targetIdx !== -1) {
      const insertIdx = mergedCode.indexOf(');', targetIdx) + 2;
      mergedCode = mergedCode.slice(0, insertIdx) + newStates + mergedCode.slice(insertIdx);
    }
  }

  // ۳. اضافه کردن توابع مربوط به ویرایش و هشدارها
  const newFunctions = `
  // ====== درخواست ۸: توابع ویرایش درخواست برای پرسنل ======
  const handleEditPersonnelRequest = (request: ShiftRequest) => {
    setEditingPersonnelRequest(request);
  };

  const handleSaveEditedRequest = async (updatedRequest: ShiftRequest) => {
    try {
      const updatedRequests = requests.map(r => r.id === updatedRequest.id ? updatedRequest : r);
      await saveState(personnel, updatedRequests, settings, customHolidays);
      setEditingPersonnelRequest(null);
      alert('درخواست با موفقیت ویرایش شد');
    } catch (error) {
      console.error('Error editing request:', error);
      alert('خطای ویرایش درخواست');
    }
  };

  // ====== درخواست ۵: نمایش Collapsible هشدارهای باقی‌مانده ======
  const handleToggleAlert = (alertId: string) => {
    setExpandedAlertId(expandedAlertId === alertId ? null : alertId);
  };

  const handleDismissAlert = (warningText: string) => {
    setDismissedAlertWarnings(prev => ({
      ...prev,
      [warningText]: true
    }));
  };

  const getVisibleWarnings = () => {
    if (!schedule) return [];
    return filterActiveWarnings ? filterActiveWarnings(schedule.warnings, dismissedWarnings) : schedule.warnings.filter(w => !dismissedWarnings.includes(w));
  };

  // ====== درخواست ۷: UI برای Collapsible هشدارها ======
  const CollapsibleAlerts = () => {
    const activeAlerts = aggregatedAlerts.filter(a => a.warnings.length > 0);
    
    if (activeAlerts.length === 0) {
      return (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-800 text-xs font-bold text-center">
          ✨ تمامی هشدارها رفع شده‌اند
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {activeAlerts.map(alert => (
          <div key={alert.personnelId} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => handleToggleAlert(alert.personnelId)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={\`text-lg \${
                  alert.severity === 'high' ? '🔴' :
                  alert.severity === 'medium' ? '🟡' : '🔵'
                }\`} />
                <div className="text-left font-sans">
                  <div className="font-bold text-slate-800 text-sm">{alert.personnelName}</div>
                  <div className="text-xs text-slate-500">{alert.warningCount} هشدار</div>
                </div>
              </div>
              <ChevronDown className={\`w-4 h-4 text-slate-400 transition-transform \${
                expandedAlertId === alert.personnelId ? 'rotate-180' : ''
              }\`} />
            </button>
            
            {expandedAlertId === alert.personnelId && (
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 space-y-2">
                {alert.warnings.map((warn, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs bg-white p-2 rounded border border-slate-100">
                    <span className="text-amber-600 font-black">•</span>
                    <span className="flex-1 text-slate-700">{warn}</span>
                    <button
                      onClick={() => handleDismissAlert(warn)}
                      className="text-slate-400 hover:text-slate-600 text-[10px] font-bold"
                      title="نادیده گرفتن این هشدار"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };
  `;

  if (!mergedCode.includes('handleEditPersonnelRequest')) {
    console.log('➕ اضافه کردن توابع منطقی جدید...');
    const searchTarget = `const [reports, setReports] = useState<PersonnelReportResult[]>([]);`;
    let targetIdx = mergedCode.indexOf(searchTarget);
    if (targetIdx === -1) {
      // fallback
      targetIdx = mergedCode.indexOf('const [role, setRole]');
    }
    if (targetIdx !== -1) {
      const insertIdx = mergedCode.indexOf('\n', targetIdx);
      mergedCode = mergedCode.slice(0, insertIdx) + newFunctions + mergedCode.slice(insertIdx);
    }
  }

  // ۴. اضافه کردن بخش‌های UI جدید به بدنه JSX اصلی
  const newUiAlertSection = `
      {/* درخواست ۵: نمایش Collapsible هشدارها در داشبورد */}
      {role !== 'personnel' && schedule && getVisibleWarnings().length > 0 && (
        <div className="bg-white border-b border-slate-200 p-4 m-4 rounded-lg shadow-sm print:hidden">
          <div className="mb-3">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              هشدارهای باقی‌مانده
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                {getVisibleWarnings().length} مورد
              </span>
            </h3>
          </div>
          <CollapsibleAlerts />
        </div>
      )}
  `;

  const newUiRequestsSection = `
      {/* درخواست ۸: نمایش درخواست‌های پرسنل با قابلیت ویرایش */}
      {role === 'personnel' && selectedPersonnelUser && (
        <div className="bg-white border-b border-slate-200 p-4 m-4 rounded-lg print:hidden">
          <h3 className="text-sm font-black text-slate-800 mb-3">درخواست‌های ثبت‌شده شما</h3>
          <div className="space-y-2">
            {requests
              .filter(r => r.personnelId === selectedPersonnelUser.id)
              .map(req => (
                <div key={req.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-xs font-bold text-slate-700">{getRequestSummaryText ? getRequestSummaryText(req) : req.requestType}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEditPersonnelRequest(req)}
                      className="text-indigo-600 hover:text-indigo-700 p-1 text-xs font-bold"
                      title="ویرایش"
                    >
                      ✎ ویرایش درخواست
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Modal ویرایش درخواست */}
      {editingPersonnelRequest && (
        <EditRequestModal
          request={editingPersonnelRequest}
          onClose={() => setEditingPersonnelRequest(null)}
          onSave={handleSaveEditedRequest}
        />
      )}
  `;

  if (!mergedCode.includes('CollapsibleAlerts')) {
    console.log('➕ اضافه کردن بخش‌های رابط کاربری (UI)...');
    // پیدا کردن شروع تگ اصلی برگشتی
    const returnIdx = mergedCode.indexOf('return (');
    if (returnIdx !== -1) {
      const divIdx = mergedCode.indexOf('<div', returnIdx);
      if (divIdx !== -1) {
        const insertIdx = mergedCode.indexOf('>', divIdx) + 1;
        mergedCode = mergedCode.slice(0, insertIdx) + newUiAlertSection + newUiRequestsSection + mergedCode.slice(insertIdx);
      }
    }
  }

  // ۵. ذخیره فایل نهایی
  fs.writeFileSync(OUTPUT_FILE_PATH, mergedCode, 'utf8');
  console.log('✅ ادغام با موفقیت انجام شد! فایل سالم page.tsx بازنویسی شد.');

} catch (err) {
  console.error('❌ خطا در عملیات ادغام:', err);
}
