import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlaskConical,
  LayoutGrid,
  ClipboardList,
  History as HistoryIcon,
  MessageCircle,
  Building2,
  AlertTriangle,
  LogOut,
  Plus,
  Pencil,
  Send,
  X,
  Menu,
  ChevronDown,
  Beaker,
  UserCheck,
  Trash2,
  PackageOpen,
  RotateCcw,
  Download,
  Search,
  TrendingUp,
  CalendarClock,
  CalendarDays,
  Bell,
  Truck,
  ShieldCheck,
  DollarSign,
  ArrowRightLeft,
  FileSpreadsheet,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const DEPARTMENTS = [
  "BMO Laboratory",
  "Soils Laboratory",
  "Variety Improvement and Pest Management (VIPM)",
];

const VIPM_DEPARTMENT = "Variety Improvement and Pest Management (VIPM)";
const USER_TAB_KEYS = ["inventory", "requests", "maintenance", "history", "cultureLogs", "support"];
const ADMIN_TAB_KEYS = [
  "overview", "approvals", "accounts", "departments", "cultureLogs", "forecast",
  "restockOrders", "suppliers", "alerts", "userActivity", "overdue",
  "maintenance", "reports", "logs", "support",
];

const MATERIAL_CATEGORIES = [
  "Chemical",
  "Glassware",
  "Equipment",
  "Consumable",
  "Hazardous",
  "Cleaning material",
  "Uncategorized",
];

const HAZARD_LEVELS = ["Low", "Moderate", "High", "Critical"];
const MATERIAL_TYPES = [
  { value: "consumable", label: "Consumable" },
  { value: "non_consumable", label: "Non-consumable" },
];
const EXPORT_FORMAT_OPTIONS = [
  { value: "csv", label: "CSV" },
  { value: "xls", label: "Excel (.xls)" },
];

const LOGS_PAGE_SIZE = 10;
const MATERIALS_PAGE_SIZE = 20;
const REQUESTS_PAGE_SIZE = 10;
const ACCOUNTS_PAGE_SIZE = 10;
const CHAT_FETCH_LIMIT = 60;
const CHAT_INBOX_LIMIT = 100;
const OVERVIEW_ATTENTION_LIMIT = 60;
const EXPIRING_SOON_DAYS = 30;
const FORECAST_HISTORY_DAYS = 84;
const MAINTENANCE_SOON_DAYS = 30;
const MAINTENANCE_REQUEST_FETCH_LIMIT = 120;

function emptyMaterialForm(dept = "") {
  return {
    dept,
    name: "",
    category: "Chemical",
    material_type: "consumable",
    qty: "",
    unit: "",
    threshold: "",
    expires_at: "",
    purpose: "",
    price_per_unit: "",
    supplier_name: "",
    hazard_level: "Low",
    storage_instruction: "",
    handling_instruction: "",
    disposal_instruction: "",
    ppe_required: "",
    incompatible_with: "",
    compatibility_notes: "",
    condition: "Good",
    last_maintenance_at: "",
    maintenance_due_at: "",
    maintenance_note: "",
    material_responsible: "",
  };
}

function emptyMaintenanceRequestForm(material = null) {
  return {
    material_id: material?.id || "",
    condition: material?.condition || "Good",
    maintenance_date: new Date().toISOString().slice(0, 10),
    next_due_at: material?.maintenance_due_at || "",
    maintenance_type: "Preventive maintenance",
    service_provider: "",
    technician: "",
    cost: "",
    notes: "",
  };
}
const CULTURE_FETCH_LIMIT = 100;
const CULTURE_TYPES = [
  { value: "fungi", label: "Fungi" },
  { value: "bacteria", label: "Bacteria" },
];
const CULTURE_STATUS_OPTIONS = [
  { value: "incubating", label: "Incubating" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Completed" },
  { value: "contaminated", label: "Contaminated" },
];

const CLEAR_TARGET_OPTIONS = [
  { value: "logs", label: "Logs only" },
  { value: "chats", label: "Chats only" },
  { value: "approval_logs", label: "Material approval history and logs" },
  { value: "both", label: "Logs and chats" },
];

const CLEAR_PERIOD_OPTIONS = [
  { value: "week", label: "Last week", hint: "Deletes records from the last 7 days" },
  { value: "month", label: "Last month", hint: "Deletes records from the last 30 days" },
  { value: "year", label: "Last year", hint: "Deletes records from the last 365 days" },
  { value: "all", label: "All records", hint: "Deletes all matching records in the selected category" },
];

function displayQty(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0";
}

function statusOf(material) {
  const qty = Number(material.qty ?? 0);
  const threshold = Number(material.threshold ?? 0);
  if (threshold > 0 && qty <= threshold * 0.5) return "crit";
  if (threshold > 0 && qty <= threshold) return "warn";
  return "ok";
}

function expiryStatusOf(material) {
  if (!material?.expires_at) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(material.expires_at);
  expiry.setHours(0, 0, 0, 0);
  const days = Math.ceil((expiry - today) / 86400000);
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring";
  return "good";
}

function daysUntil(value) {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${value}T00:00:00`);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function maintenanceStatusOf(material) {
  const days = daysUntil(material?.maintenance_due_at);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days <= MAINTENANCE_SOON_DAYS) return "due";
  return "good";
}

function isBorrowOverdue(item) {
  const days = daysUntil(item?.due_at);
  return days !== null && days < 0 && item?.status === "active";
}

function cultureStatusOf(culture) {
  const savedStatus = String(culture?.status || "incubating").toLowerCase();
  if (["completed", "contaminated", "ready"].includes(savedStatus)) return savedStatus;
  const days = daysUntil(culture?.ready_at);
  return days !== null && days <= 0 ? "ready" : "incubating";
}

function cultureTimingLabel(culture) {
  const status = cultureStatusOf(culture);
  if (status === "completed") return "Growth cycle completed";
  if (status === "contaminated") return "Marked as contaminated";
  const days = daysUntil(culture?.ready_at);
  if (days === null) return "No readiness date";
  if (days < 0) return `Ready for ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Ready today";
  return `${days} day${days === 1 ? "" : "s"} until ready`;
}

function fmtDate(value) {
  if (!value) return "No expiry";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtWeeks(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "No usage trend";
  if (n <= 0) return "0 weeks";
  if (n > 99) return "99+ weeks";
  return `${n.toFixed(1)} weeks`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function cleanSearchTerm(value) {
  return String(value || "").trim().replaceAll(",", " ").replaceAll("%", "");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function downloadRows(filenameBase, rows, format = "csv") {
  if (!rows.length) {
    window.alert("No records to export on this page.");
    return;
  }

  const headers = Object.keys(rows[0]);
  let blob;
  let filename;

  if (format === "xls") {
    const headerRow = headers.map((h) => `<th>${htmlEscape(h)}</th>`).join("");
    const bodyRows = rows.map((row) => `<tr>${headers.map((key) => `<td>${htmlEscape(row[key])}</td>`).join("")}</tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
    blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    filename = `${filenameBase}.xls`;
  } else {
    const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n");
    blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    filename = `${filenameBase}.csv`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const statusLabel = { ok: "In stock", warn: "Low stock", crit: "Critical" };
const expiryLabel = { none: "No expiry date", good: "Expiry good", expiring: "Expiring soon", expired: "Expired" };
const maintenanceLabel = { none: "No maintenance date", good: "Maintenance good", due: "Maintenance due soon", overdue: "Maintenance overdue" };

function materialTypeLabel(value) {
  return value === "non_consumable" ? "Non-consumable" : "Consumable";
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusDot({ status }) {
  return <span className={`lt-dot lt-dot-${status}`} />;
}

function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="lt-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`lt-modal ${wide ? "lt-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="lt-modal-head">
          <span className="lt-modal-title">{title}</span>
          <button className="lt-modal-close" type="button" onClick={onClose} aria-label="Close dialog" title="Close">
            <X size={18} />
            <span>Close</span>
          </button>
        </div>
        <div className="lt-modal-body">{children}</div>
      </div>
    </div>
  );
}

function DateInput({ value, onChange, min, max, ariaLabel = "Choose date" }) {
  const inputRef = useRef(null);

  function openCalendar() {
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else input.focus();
  }

  return (
    <div className="lt-date-input-wrap">
      <input
        ref={inputRef}
        className="lt-input lt-date-input"
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={onChange}
      />
      <button type="button" className="lt-date-icon" onClick={openCalendar} aria-label={ariaLabel} title={ariaLabel}>
        <CalendarDays size={17} />
      </button>
    </div>
  );
}

function MaterialCard({
  material,
  onView,
  onUse,
  onBorrow,
  onCorrect,
  onDelete,
  onTransfer,
  onMaintenance,
  showDept = false,
}) {
  const status = statusOf(material);
  const expiryStatus = expiryStatusOf(material);
  const maintenanceStatus = maintenanceStatusOf(material);
  const hasActions = Boolean(onView || onUse || onBorrow || onCorrect || onDelete || onTransfer || onMaintenance);

  function stopAndRun(event, callback) {
    event.stopPropagation();
    callback?.(material);
  }

  return (
    <div
      className={`lt-card ${onView ? "lt-card-clickable" : ""}`}
      onClick={() => onView?.(material)}
      role={onView ? "button" : undefined}
      tabIndex={onView ? 0 : undefined}
      aria-label={onView ? `View details for ${material.name}` : undefined}
      onKeyDown={(event) => {
        if (!onView || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        onView(material);
      }}
    >
      <div className={`lt-card-bar lt-card-bar-${expiryStatus === "expired" ? "crit" : status}`} />
      <div className="lt-card-body">
        <div className="lt-perforation" />
        <div className="lt-card-eyebrow">
          {material.category || "Uncategorized"}{showDept ? ` · ${material.dept}` : ""}
        </div>
        <div className={`lt-designation lt-designation-${material.material_type === "non_consumable" ? "durable" : "consumable"}`}>
          {materialTypeLabel(material.material_type)}
        </div>
        <div className="lt-card-name">{material.name}</div>
        <div className="lt-card-qty">
          {displayQty(material.qty)} <span className="lt-card-unit">{material.unit}</span>
        </div>
        <div className="lt-card-meta">
          <span className="lt-status-pill">
            <StatusDot status={status} /> {statusLabel[status]}
          </span>
          <span className="lt-card-updated">Updated {fmtTime(material.updated)}</span>
        </div>
        <div className={`lt-expiry lt-expiry-${expiryStatus}`}>
          <CalendarClock size={12} /> {expiryLabel[expiryStatus]}{material.expires_at ? ` · ${fmtDate(material.expires_at)}` : ""}
        </div>
        <div className="lt-card-approval">
          <strong>Supplier:</strong> {material.supplier_name || "Not set"} · <strong>Price:</strong> ₱{displayQty(material.price_per_unit || 0)}/{material.unit}
        </div>
        <div className="lt-card-approval lt-mr-line">
          <UserCheck size={12} /> <strong>MR:</strong> {material.material_responsible || "Not assigned"}
        </div>
        <div className="lt-safety-box">
          <div><ShieldCheck size={12} /> <strong>{material.hazard_level || "Low"} hazard</strong></div>
          <div><strong>PPE:</strong> {material.ppe_required || "Standard lab PPE"}</div>
          <div><strong>Storage:</strong> {material.storage_instruction || "Not specified"}</div>
          <div><strong>Compatibility:</strong> {material.compatibility_notes || material.incompatible_with || "No compatibility warning added"}</div>
        </div>
        {(material.material_type === "non_consumable" || material.maintenance_due_at || material.last_maintenance_at || material.maintenance_note) && (
          <div className={`lt-maintenance lt-maintenance-${maintenanceStatus}`}>
            <strong>Maintenance:</strong> {maintenanceLabel[maintenanceStatus]}{material.maintenance_due_at ? ` · due ${fmtDate(material.maintenance_due_at)}` : ""}
            <br /><strong>Condition:</strong> {material.condition || "Good"}{material.maintenance_note ? ` · ${material.maintenance_note}` : ""}
          </div>
        )}
        {material.approved_by_name && (
          <div className="lt-card-approval">
            Approved by {material.approved_by_name}{material.approved_at ? ` · ${fmtTime(material.approved_at)}` : ""}
          </div>
        )}
        {hasActions && (
          <div className="lt-card-actions">
            {onView && (
              <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={(event) => stopAndRun(event, onView)}>
                <Search size={13} /> Details
              </button>
            )}
            {onUse && (
              <button className="lt-btn lt-btn-accent lt-btn-sm" onClick={(event) => stopAndRun(event, onUse)}>
                Log usage
              </button>
            )}
            {onBorrow && (
              <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={(event) => stopAndRun(event, onBorrow)}>
                <PackageOpen size={13} /> Borrow
              </button>
            )}
            {onCorrect && (
              <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={(event) => stopAndRun(event, onCorrect)}>
                <Pencil size={13} /> Correct
              </button>
            )}
            {onTransfer && (
              <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={(event) => stopAndRun(event, onTransfer)}>
                <ArrowRightLeft size={13} /> Transfer
              </button>
            )}
            {onMaintenance && material.material_type === "non_consumable" && (
              <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={(event) => stopAndRun(event, onMaintenance)}>
                <CalendarClock size={13} /> Maintenance
              </button>
            )}
            {onDelete && (
              <button className="lt-btn lt-btn-danger lt-btn-sm" onClick={(event) => stopAndRun(event, onDelete)}>
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialDetails({ material }) {
  const stockStatus = statusOf(material);
  const expiryStatus = expiryStatusOf(material);
  const maintenanceStatus = maintenanceStatusOf(material);

  const detailRows = [
    ["Department", material.dept || "Not specified"],
    ["MR — Material Responsibility", material.material_responsible || "Not assigned"],
    ["Category", material.category || "Uncategorized"],
    ["Material type", materialTypeLabel(material.material_type)],
    ["Current quantity", `${displayQty(material.qty)} ${material.unit || ""}`.trim()],
    ["Reorder threshold", `${displayQty(material.threshold)} ${material.unit || ""}`.trim()],
    ["Stock status", statusLabel[stockStatus]],
    ["Expiry", material.expires_at ? `${fmtDate(material.expires_at)} · ${expiryLabel[expiryStatus]}` : "No expiry date"],
    ["Supplier", material.supplier_name || "Not set"],
    ["Price per unit", `₱${displayQty(material.price_per_unit || 0)} / ${material.unit || "unit"}`],
    ["Hazard level", material.hazard_level || "Low"],
    ["Required PPE", material.ppe_required || "Standard lab PPE"],
    ["Storage instruction", material.storage_instruction || "Not specified"],
    ["Handling instruction", material.handling_instruction || "Not specified"],
    ["Disposal instruction", material.disposal_instruction || "Not specified"],
    ["Incompatible with", material.incompatible_with || "No incompatibility listed"],
    ["Compatibility notes", material.compatibility_notes || "No compatibility notes"],
    ["Condition", material.condition || "Good"],
    ["Last maintenance", material.last_maintenance_at ? fmtDate(material.last_maintenance_at) : "Not set"],
    ["Next maintenance", material.maintenance_due_at ? `${fmtDate(material.maintenance_due_at)} · ${maintenanceLabel[maintenanceStatus]}` : "Not set"],
    ["Maintenance note", material.maintenance_note || "No maintenance note"],
    ["Approved by", material.approved_by_name || "Not recorded"],
    ["Approved at", material.approved_at ? fmtTime(material.approved_at) : "Not recorded"],
    ["Last updated", fmtTime(material.updated)],
  ];

  return (
    <div className="lt-material-details">
      <div className="lt-material-details-hero">
        <div>
          <div className="lt-card-eyebrow">{material.category || "Uncategorized"} · {material.dept || "No department"}</div>
          <div className="lt-material-details-name">{material.name}</div>
          <div className="lt-material-details-sub">{materialTypeLabel(material.material_type)} material record</div>
        </div>
        <div className="lt-material-details-stock">
          <span>{displayQty(material.qty)}</span>
          <small>{material.unit || "units"}</small>
        </div>
      </div>
      <div className="lt-material-details-grid">
        {detailRows.map(([label, value]) => (
          <div className="lt-material-detail-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}


function ActivityTable({ logs, includeDept = false, onDelete = null }) {
  const columns = (includeDept ? 7 : 6) + (onDelete ? 1 : 0);
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            {includeDept && <th>Department</th>}
            <th>Material</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Purpose / note</th>
            <th>Logged by</th>
            {onDelete && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 && (
            <tr>
              <td colSpan={columns}>
                <div className="lt-empty">No activity yet.</div>
              </td>
            </tr>
          )}
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="lt-mono" style={{ fontSize: 12 }}>{fmtTime(log.timestamp)}</td>
              {includeDept && <td>{log.dept}</td>}
              <td>{log.material_name}</td>
              <td><span className={`lt-tag lt-tag-${log.type}`}>{log.type}</span></td>
              <td className="lt-mono">
                {log.type === "correction" && Number(log.qty) > 0 ? "+" : ""}{displayQty(log.qty)}
              </td>
              <td>{log.detail}</td>
              <td>{log.user_name}</td>
              {onDelete && (
                <td>
                  <button className="lt-btn lt-btn-danger lt-btn-sm" onClick={() => onDelete(log)}>
                    <Trash2 size={13} /> Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaginationControls({ page, pageSize, total, onPage, label = "items" }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="lt-pagination">
      <span>Showing {start}-{end} of {total} {label}</span>
      <div className="lt-pagination-actions">
        <button className="lt-btn lt-btn-ghost lt-btn-sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="lt-page-count">Page {page + 1} of {totalPages}</span>
        <button className="lt-btn lt-btn-ghost lt-btn-sm" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function ChatPanel({ messages, currentRole, input, setInput, onSend, emptyText, placeholder }) {
  return (
    <div className="lt-chat-wrap">
      <div className="lt-chat-scroll">
        {messages.length === 0 && <div className="lt-empty">{emptyText}</div>}
        {messages.map((message) => {
          const mine = message.sender_role === currentRole;
          return (
            <div key={message.id} className={`lt-chat-row ${mine ? "mine" : "theirs"}`}>
              <div className={`lt-bubble ${mine ? "lt-bubble-user" : "lt-bubble-admin"}`}>{message.text}</div>
              <div className="lt-bubble-meta">{message.sender_name} · {fmtTime(message.timestamp)}</div>
            </div>
          );
        })}
      </div>
      <div className="lt-chat-input-bar">
        <input
          className="lt-input"
          placeholder={placeholder}
          maxLength={5000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
        />
        <button className="lt-btn lt-btn-accent" onClick={onSend}><Send size={14} /></button>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder, deptLabel }) {
  return (
    <div className="lt-search-wrap">
      <div className="lt-search-line">
        <Search size={14} />
        <input
          className="lt-search-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
      {deptLabel && <div className="lt-search-dept">Department scope: <strong>{deptLabel}</strong></div>}
    </div>
  );
}

function ExportControl({ format, setFormat, onExport, label = "Export" }) {
  return (
    <div className="lt-export-control">
      <select className="lt-select lt-export-select" value={format} onChange={(e) => setFormat(e.target.value)} title="Export file type">
        {EXPORT_FORMAT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <button className="lt-btn lt-btn-ghost" onClick={onExport}>
        {format === "xls" ? <FileSpreadsheet size={14} /> : <Download size={14} />} {label}
      </button>
    </div>
  );
}

function NotificationList({ rows }) {
  return (
    <div className="lt-request-list">
      {rows.length === 0 && <div className="lt-table-wrap"><div className="lt-empty">No alerts right now.</div></div>}
      {rows.map((n, index) => (
        <div className={`lt-request-card lt-alert-card lt-alert-${n.severity || "info"}`} key={`${n.kind}-${n.dept}-${n.title}-${index}`}>
          <div className="lt-request-head">
            <div>
              <div className="lt-request-title">{n.title}</div>
              <div className="lt-request-meta">{n.dept || "All departments"} · {n.detail}</div>
            </div>
            <span className={`lt-tag lt-tag-${String(n.severity || "info").toLowerCase()}`}>{n.severity || "info"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function BorrowList({ borrows, onReturn }) {
  return (
    <div className="lt-table-wrap" style={{ marginTop: 18 }}>
      <div className="lt-section-title" style={{ margin: 0, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        Active borrowed materials
      </div>
      {borrows.length === 0 ? (
        <div className="lt-empty">No active borrowed materials.</div>
      ) : (
        <table className="lt-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Borrowed</th>
              <th>Returned</th>
              <th>Purpose</th>
              <th>Borrowed</th>
              <th>Due date</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {borrows.map((item) => (
              <tr key={item.id}>
                <td>{item.material_name}</td>
                <td className="lt-mono">{displayQty(item.qty_borrowed)} {item.unit}</td>
                <td className="lt-mono">{displayQty(item.qty_returned)} {item.unit}</td>
                <td>{item.purpose}</td>
                <td className="lt-mono" style={{ fontSize: 12 }}>{fmtTime(item.borrowed_at)}</td>
                <td className="lt-mono" style={{ fontSize: 12 }}>{item.due_at ? fmtDate(item.due_at) : "No due date"}</td>
                <td><span className={`lt-tag lt-tag-${isBorrowOverdue(item) ? "critical" : "borrow"}`}>{isBorrowOverdue(item) ? "overdue" : "active"}</span></td>
                <td>
                  <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => onReturn(item)}>
                    <RotateCcw size={13} /> Return
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ForecastTable({ rows, onCreateRestock }) {
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Department</th>
            <th>Material</th>
            <th>Current</th>
            <th>Avg weekly use</th>
            <th>Runout estimate</th>
            <th>Suggested buy</th>
            <th>Cost</th>
            <th>Supplier</th>
            <th>Reason</th>
            {onCreateRestock && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={onCreateRestock ? 11 : 10}><div className="lt-empty">No forecast data yet. Start logging usage to build predictions.</div></td></tr>
          )}
          {rows.map((row) => (
            <tr key={`${row.material_id}-${row.dept}`}>
              <td><span className={`lt-tag lt-tag-${String(row.priority || "ok").toLowerCase()}`}>{row.priority || "ok"}</span></td>
              <td>{row.dept}</td>
              <td>{row.material_name}<div className="lt-request-meta">{row.category || "Uncategorized"} · {row.hazard_level || "Low"} hazard</div></td>
              <td className="lt-mono">{displayQty(row.current_qty)} {row.unit}</td>
              <td className="lt-mono">{displayQty(row.weekly_usage_avg)} {row.unit}/week</td>
              <td>{fmtWeeks(row.weeks_until_empty)}</td>
              <td className="lt-mono">{displayQty(row.suggested_restock_qty)} {row.unit}</td>
              <td className="lt-mono">₱{displayQty(row.estimated_restock_cost || 0)}</td>
              <td>{row.supplier_name || "Not set"}</td>
              <td>{row.reason}</td>
              {onCreateRestock && (
                <td><button className="lt-btn lt-btn-accent lt-btn-sm" onClick={() => onCreateRestock(row)}><Truck size={13} /> Request</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RestockRequestsTable({ rows, onStatus }) {
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Status</th><th>Department</th><th>Material</th><th>Qty</th><th>Estimated cost</th><th>Supplier</th><th>Reason</th><th>Updated</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan="9"><div className="lt-empty">No restock requests yet.</div></td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td><span className={`lt-tag lt-tag-${r.status}`}>{r.status}</span></td>
              <td>{r.dept}</td>
              <td>{r.material_name}</td>
              <td className="lt-mono">{displayQty(r.qty)} {r.unit}</td>
              <td className="lt-mono">₱{displayQty(r.estimated_cost || 0)}</td>
              <td>{r.supplier_name || "Not set"}</td>
              <td>{r.reason}</td>
              <td className="lt-mono" style={{ fontSize: 12 }}>{fmtTime(r.updated_at || r.created_at)}</td>
              <td>
                <div className="lt-request-actions">
                  {r.status === "pending" && <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => onStatus(r, "ordered")}>Mark ordered</button>}
                  {(r.status === "pending" || r.status === "ordered") && <button className="lt-btn lt-btn-accent lt-btn-sm" onClick={() => onStatus(r, "received")}>Received</button>}
                  {r.status !== "received" && r.status !== "cancelled" && <button className="lt-btn lt-btn-danger lt-btn-sm" onClick={() => onStatus(r, "cancelled")}>Cancel</button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SuppliersTable({ rows, onDelete, onReview }) {
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Status</th><th>Department</th><th>Supplier</th><th>Material / category</th><th>Price</th><th>Contact</th><th>Submitted / reviewed</th><th>Notes</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan="9"><div className="lt-empty">No supplier records found for this filter.</div></td></tr>}
          {rows.map((s) => (
            <tr key={s.id}>
              <td><span className={`lt-tag lt-tag-${s.status || "pending"}`}>{s.status || "pending"}</span></td>
              <td>{s.dept || "All departments"}</td>
              <td><strong>{s.name}</strong><div className="lt-request-meta">{s.contact_person || "No contact person"}</div></td>
              <td>{s.material_name || "Any material"}<div className="lt-request-meta">{s.material_category || "Any category"}</div></td>
              <td className="lt-mono">₱{displayQty(s.price_per_unit || 0)} / {s.unit || "unit"}</td>
              <td>{s.email || "—"}<div className="lt-request-meta">{s.phone || "—"}</div></td>
              <td>
                <div>{s.submitted_by_name || "Unknown user"}</div>
                <div className="lt-request-meta">{s.created_at ? new Date(s.created_at).toLocaleString() : "—"}</div>
                {s.reviewer_name && <div className="lt-request-meta">Reviewed by {s.reviewer_name}</div>}
                {s.review_note && <div className="lt-request-meta">Note: {s.review_note}</div>}
              </td>
              <td>{s.notes || "—"}</td>
              <td>
                <div className="lt-action-stack">
                  {s.status === "pending" && <button className="lt-btn lt-btn-accent lt-btn-sm" onClick={() => onReview(s, "approved")}><UserCheck size={13} /> Approve</button>}
                  {s.status === "pending" && <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => onReview(s, "rejected")}><X size={13} /> Reject</button>}
                  <button className="lt-btn lt-btn-danger lt-btn-sm" onClick={() => onDelete(s)}><Trash2 size={13} /> Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserActivityTable({ rows }) {
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>User</th><th>Department</th><th>Requests</th><th>Usage</th><th>Borrowed</th><th>Returned</th><th>Active</th><th>Overdue</th><th>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan="9"><div className="lt-empty">No user activity found.</div></td></tr>}
          {rows.map((row) => (
            <tr key={row.user_id}>
              <td><strong>{row.full_name || "Unnamed user"}</strong><div className="lt-request-meta">{row.email || "No email"}</div></td>
              <td>{row.dept || "—"}</td>
              <td className="lt-mono">{row.request_count || 0}</td>
              <td className="lt-mono">{row.usage_count || 0}</td>
              <td className="lt-mono">{row.borrow_count || 0}</td>
              <td className="lt-mono">{row.return_count || 0}</td>
              <td className="lt-mono">{row.active_borrows || 0}</td>
              <td className="lt-mono" style={{ color: Number(row.overdue_borrows || 0) > 0 ? "var(--crit)" : undefined }}>{row.overdue_borrows || 0}</td>
              <td className="lt-mono" style={{ fontSize: 12 }}>{fmtTime(row.last_activity_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverdueBorrowsTable({ rows, onReturn }) {
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Status</th><th>Department</th><th>Material</th><th>Borrower</th><th>Qty</th><th>Purpose</th><th>Borrowed</th><th>Due date</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan="9"><div className="lt-empty">No overdue borrowed materials.</div></td></tr>}
          {rows.map((row) => (
            <tr key={row.id}>
              <td><span className={`lt-tag lt-tag-${isBorrowOverdue(row) ? "critical" : "warning"}`}>{isBorrowOverdue(row) ? "overdue" : "active"}</span></td>
              <td>{row.dept}</td>
              <td>{row.material_name}</td>
              <td>{row.borrower_name}</td>
              <td className="lt-mono">{displayQty(Number(row.qty_borrowed || 0) - Number(row.qty_returned || 0))} {row.unit}</td>
              <td>{row.purpose || "—"}</td>
              <td className="lt-mono" style={{ fontSize: 12 }}>{fmtTime(row.borrowed_at)}</td>
              <td className="lt-mono" style={{ fontSize: 12 }}>{row.due_at ? fmtDate(row.due_at) : "No due date"}</td>
              <td><button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => onReturn(row)}><RotateCcw size={13} /> Return</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MaintenanceTable({ rows, onMaintenance = null, actionLabel = "Update" }) {
  const columnCount = onMaintenance ? 9 : 8;
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Status</th><th>Department</th><th>Equipment / Material</th><th>Category</th><th>Condition</th><th>Last maintenance</th><th>Next due</th><th>Note</th>
            {onMaintenance && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columnCount}><div className="lt-empty">No maintainable equipment found.</div></td></tr>}
          {rows.map((row) => {
            const status = maintenanceStatusOf(row);
            return (
              <tr key={row.id}>
                <td><span className={`lt-tag lt-tag-${status === "overdue" ? "critical" : status === "due" ? "warning" : "ok"}`}>{maintenanceLabel[status]}</span></td>
                <td>{row.dept}</td>
                <td><strong>{row.name}</strong></td>
                <td>{row.category || "Equipment"}</td>
                <td>{row.condition || "Good"}</td>
                <td className="lt-mono" style={{ fontSize: 12 }}>{row.last_maintenance_at ? fmtDate(row.last_maintenance_at) : "Not set"}</td>
                <td className="lt-mono" style={{ fontSize: 12 }}>{row.maintenance_due_at ? fmtDate(row.maintenance_due_at) : "Not set"}</td>
                <td>{row.maintenance_note || "—"}</td>
                {onMaintenance && (
                  <td><button className="lt-btn lt-btn-accent lt-btn-sm" onClick={() => onMaintenance(row)}><CalendarClock size={13} /> {actionLabel}</button></td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MaintenanceRequestsTable({ rows, isAdmin = false, onApprove = null, onReject = null }) {
  const columns = isAdmin ? 11 : 9;
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Status</th>
            {isAdmin && <th>Department</th>}
            <th>Equipment</th><th>Maintenance type</th><th>Requested / maintenance date</th><th>Next due</th><th>Condition</th><th>Provider / technician</th><th>Cost</th><th>Notes / admin review</th>
            {isAdmin && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns}><div className="lt-empty">No equipment maintenance requests yet.</div></td></tr>}
          {rows.map((request) => (
            <tr key={request.id}>
              <td><span className={`lt-tag lt-tag-${request.status || "pending"}`}>{request.status || "pending"}</span></td>
              {isAdmin && <td>{request.dept}</td>}
              <td><strong>{request.material_name}</strong><div className="lt-request-meta">Requested by {request.requester_name || "Unknown user"}</div></td>
              <td>{request.maintenance_type || "Maintenance"}</td>
              <td className="lt-mono" style={{ fontSize: 12 }}>{request.created_at ? fmtTime(request.created_at) : "—"}<div className="lt-request-meta">Service: {request.maintenance_date ? fmtDate(request.maintenance_date) : "Not set"}</div></td>
              <td className="lt-mono" style={{ fontSize: 12 }}>{request.next_due_at ? fmtDate(request.next_due_at) : "Not set"}</td>
              <td>{request.condition || "Needs inspection"}</td>
              <td>{request.service_provider || "Not set"}<div className="lt-request-meta">{request.technician || "No technician assigned"}</div></td>
              <td className="lt-mono">₱{displayQty(request.cost || 0)}</td>
              <td>{request.notes || "—"}{request.admin_note && <div className="lt-request-meta"><strong>Admin:</strong> {request.admin_note}{request.reviewer_name ? ` · ${request.reviewer_name}` : ""}</div>}</td>
              {isAdmin && (
                <td>
                  {request.status === "pending" ? (
                    <div className="lt-action-stack">
                      <button className="lt-btn lt-btn-accent lt-btn-sm" onClick={() => onApprove?.(request)}><UserCheck size={13} /> Approve</button>
                      <button className="lt-btn lt-btn-danger lt-btn-sm" onClick={() => onReject?.(request)}><X size={13} /> Reject</button>
                    </div>
                  ) : <span className="lt-request-meta">Reviewed {request.reviewed_at ? fmtTime(request.reviewed_at) : ""}</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function CultureLogGrid({ rows, onStatus, onDelete }) {
  if (!rows.length) {
    return (
      <div className="lt-table-wrap">
        <div className="lt-empty">No fungi or bacteria growth logs match this filter.</div>
      </div>
    );
  }

  return (
    <div className="lt-culture-grid">
      {rows.map((culture) => {
        const status = cultureStatusOf(culture);
        const progressDays = daysUntil(culture.ready_at);
        return (
          <article className={`lt-culture-card lt-culture-${status}`} key={culture.id}>
            <div className="lt-culture-card-head">
              <div>
                <div className="lt-card-eyebrow">{culture.organism_type === "bacteria" ? "Bacteria culture" : "Fungi culture"}</div>
                <div className="lt-culture-name">{culture.culture_name}</div>
                <div className="lt-request-meta">{culture.strain || "Strain / isolate not specified"}</div>
              </div>
              <span className={`lt-tag lt-tag-${status === "incubating" ? "warning" : status === "contaminated" ? "critical" : status === "completed" ? "ok" : "approved"}`}>
                {status}
              </span>
            </div>

            <div className="lt-culture-timeline">
              <div>
                <span>Stored</span>
                <strong>{culture.stored_at ? fmtDate(culture.stored_at) : "Not set"}</strong>
              </div>
              <div className="lt-culture-line" aria-hidden="true">
                <i style={{ width: progressDays === null ? "0%" : progressDays <= 0 ? "100%" : "46%" }} />
              </div>
              <div>
                <span>Expected ready</span>
                <strong>{culture.ready_at ? fmtDate(culture.ready_at) : "Not set"}</strong>
              </div>
            </div>

            <div className="lt-culture-ready">
              <CalendarClock size={14} />
              <strong>{cultureTimingLabel(culture)}</strong>
            </div>

            <div className="lt-culture-details">
              <div><strong>Storage:</strong> {culture.storage_location || "Not specified"}</div>
              <div><strong>Recorded by:</strong> {culture.recorded_by_name || "Unknown user"}</div>
              {culture.notes && <div><strong>Notes:</strong> {culture.notes}</div>}
            </div>

            <div className="lt-culture-actions">
              {status === "incubating" && (
                <button className="lt-btn lt-btn-accent lt-btn-sm" onClick={() => onStatus(culture, "ready")}>
                  Mark ready
                </button>
              )}
              {status !== "completed" && status !== "contaminated" && (
                <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => onStatus(culture, "completed")}>
                  Complete
                </button>
              )}
              {status !== "contaminated" && status !== "completed" && (
                <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => onStatus(culture, "contaminated")}>
                  Contaminated
                </button>
              )}
              <button className="lt-btn lt-btn-danger lt-btn-sm" onClick={() => onDelete(culture)}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="lt-login-wrap">
      <div className="lt-login-card lt-setup-card">
        <div className="lt-brand">
          <div className="lt-brand-mark"><FlaskConical size={18} /></div>
          <div>
            <div className="lt-brand-name">LabTrack backend needed</div>
            <div className="lt-brand-sub">This version uses Appwrite Cloud for accounts and database sync.</div>
          </div>
        </div>
        <div className="lt-note">
          Add these Vercel environment variables, then redeploy:
          <pre>VITE_APPWRITE_ENDPOINT
VITE_APPWRITE_PROJECT_ID
VITE_APPWRITE_DATABASE_ID</pre>
          Run <strong>npm run setup:appwrite</strong> once after creating your Appwrite API key.
        </div>
      </div>
    </div>
  );
}

function AccountGate({ profile, onLogout }) {
  const isRejected = profile?.status === "rejected";
  return (
    <div className="lt-login-wrap">
      <div className="lt-login-card">
        <div className="lt-brand">
          <div className="lt-brand-mark"><UserCheck size={18} /></div>
          <div>
            <div className="lt-brand-name">{isRejected ? "Account not approved" : "Waiting for admin approval"}</div>
            <div className="lt-brand-sub">{profile?.full_name || "Your account"} · {profile?.dept || "No department selected"}</div>
          </div>
        </div>
        <div className={isRejected ? "lt-error-box" : "lt-note"}>
          {isRejected
            ? "An admin rejected this account. Please contact the laboratory administrator if this was a mistake."
            : "Your account was created, but an admin must approve it before you can enter LabTrack."}
          {profile?.admin_note && (
            <div style={{ marginTop: 10 }}><strong>Admin note:</strong> {profile.admin_note}</div>
          )}
          {profile?.reviewer_name && (
            <div style={{ marginTop: 6 }}><strong>Reviewed by:</strong> {profile.reviewer_name} · {fmtTime(profile.reviewed_at)}</div>
          )}
        </div>
        <button className="lt-btn lt-btn-primary" style={{ marginTop: 16 }} onClick={onLogout}>Back to login</button>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [registerDept, setRegisterDept] = useState(DEPARTMENTS[0]);

  const [materials, setMaterials] = useState([]);
  const [logs, setLogs] = useState([]);
  const [chats, setChats] = useState([]);
  const [requests, setRequests] = useState([]);
  const [accountApprovals, setAccountApprovals] = useState([]);
  const [borrowRecords, setBorrowRecords] = useState([]);
  const [forecastRows, setForecastRows] = useState([]);
  const [restockRequests, setRestockRequests] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [userActivityRows, setUserActivityRows] = useState([]);
  const [overdueBorrows, setOverdueBorrows] = useState([]);
  const [maintenanceRows, setMaintenanceRows] = useState([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState([]);
  const [cultureLogs, setCultureLogs] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState(null);

  const [tab, setTab] = useState("inventory");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [deptTab, setDeptTab] = useState(DEPARTMENTS[0]);
  const [logsFilter, setLogsFilter] = useState("All");
  const [logsPage, setLogsPage] = useState(0);
  const [logsTotal, setLogsTotal] = useState(0);
  const [materialsPage, setMaterialsPage] = useState(0);
  const [materialsTotal, setMaterialsTotal] = useState(0);
  const [requestsPage, setRequestsPage] = useState(0);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [accountsPage, setAccountsPage] = useState(0);
  const [accountsTotal, setAccountsTotal] = useState(0);
  const [pendingRequestsTotal, setPendingRequestsTotal] = useState(0);
  const [pendingAccountsTotal, setPendingAccountsTotal] = useState(0);
  const [pendingSuppliersTotal, setPendingSuppliersTotal] = useState(0);
  const [pendingMaintenanceRequestsTotal, setPendingMaintenanceRequestsTotal] = useState(0);
  const [adminActiveDept, setAdminActiveDept] = useState(DEPARTMENTS[0]);
  const [searchMaterials, setSearchMaterials] = useState("");
  const [searchRequests, setSearchRequests] = useState("");
  const [searchLogs, setSearchLogs] = useState("");
  const [searchAccounts, setSearchAccounts] = useState("");
  const [accountDeptFilter, setAccountDeptFilter] = useState("All");
  const [requestDeptFilter, setRequestDeptFilter] = useState("All");
  const [forecastDeptFilter, setForecastDeptFilter] = useState("All");
  const [forecastSearch, setForecastSearch] = useState("");
  const [restockDeptFilter, setRestockDeptFilter] = useState("All");
  const [restockSearch, setRestockSearch] = useState("");
  const [supplierDeptFilter, setSupplierDeptFilter] = useState("All");
  const [supplierStatusFilter, setSupplierStatusFilter] = useState("pending");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [notificationDeptFilter, setNotificationDeptFilter] = useState("All");
  const [userActivityDeptFilter, setUserActivityDeptFilter] = useState("All");
  const [userActivitySearch, setUserActivitySearch] = useState("");
  const [overdueDeptFilter, setOverdueDeptFilter] = useState("All");
  const [maintenanceDeptFilter, setMaintenanceDeptFilter] = useState("All");
  const [maintenanceSearch, setMaintenanceSearch] = useState("");
  const [cultureSearch, setCultureSearch] = useState("");
  const [cultureTypeFilter, setCultureTypeFilter] = useState("All");
  const [cultureStatusFilter, setCultureStatusFilter] = useState("All");
  const [reportType, setReportType] = useState("inventory");
  const [reportDeptFilter, setReportDeptFilter] = useState("All");
  const [exportFormat, setExportFormat] = useState("csv");

  const [modalMode, setModalMode] = useState(null);
  const [activeMaterial, setActiveMaterial] = useState(null);
  const [activeRequest, setActiveRequest] = useState(null);
  const [activeAccount, setActiveAccount] = useState(null);
  const [activeBorrow, setActiveBorrow] = useState(null);
  const [activeLog, setActiveLog] = useState(null);
  const [activeCulture, setActiveCulture] = useState(null);
  const [activeMaintenanceRequest, setActiveMaintenanceRequest] = useState(null);
  const [requestForm, setRequestForm] = useState(() => emptyMaterialForm());
  const [supplierForm, setSupplierForm] = useState({ dept: "All", name: "", contact_person: "", phone: "", email: "", material_category: "", material_name: "", price_per_unit: "", unit: "", notes: "" });
  const [transferForm, setTransferForm] = useState({ target_dept: DEPARTMENTS[1], qty: "", reason: "" });
  const [useForm, setUseForm] = useState({ qty: "", purpose: "" });
  const [borrowForm, setBorrowForm] = useState({ qty: "", purpose: "", due_at: "" });
  const [returnForm, setReturnForm] = useState({ qty: "", note: "" });
  const [correctForm, setCorrectForm] = useState({ qty: "", reason: "" });
  const [maintenanceForm, setMaintenanceForm] = useState({ condition: "Good", last_maintenance_at: "", maintenance_due_at: "", maintenance_note: "" });
  const [maintenanceRequestForm, setMaintenanceRequestForm] = useState(() => emptyMaintenanceRequestForm());
  const [cultureForm, setCultureForm] = useState({
    organism_type: "fungi",
    culture_name: "",
    strain: "",
    stored_at: new Date().toISOString().slice(0, 10),
    ready_at: "",
    storage_location: "",
    notes: "",
  });
  const [reviewNote, setReviewNote] = useState("");
  const [materialResponsible, setMaterialResponsible] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatReadAt, setChatReadAt] = useState({});
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [clearForm, setClearForm] = useState({ target: "both", period: "week" });

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [appMessage, setAppMessage] = useState("");

  const isAdmin = profile?.role === "admin" && profile?.status === "approved";
  const accountApproved = profile?.status === "approved";
  const userDept = profile?.dept || DEPARTMENTS[0];
  const displayName = profile?.full_name || session?.user?.email || "User";

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    const selector = [
      ".lt-header",
      ".lt-stat-card",
      ".lt-card",
      ".lt-add-card",
      ".lt-request-card",
      ".lt-table-wrap",
      ".lt-chat-wrap",
      ".lt-conv-layout",
      ".lt-section-title",
      ".lt-pagination",
      ".lt-maintenance-form",
      ".lt-culture-card",
      ".lt-culture-summary",
    ].join(", ");

    const seen = new WeakSet();
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("lt-reveal-visible");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });

    const register = (root = document) => {
      const nodes = [];
      if (root?.matches?.(selector)) nodes.push(root);
      root?.querySelectorAll?.(selector).forEach((node) => nodes.push(node));
      nodes.forEach((node, index) => {
        if (seen.has(node)) return;
        seen.add(node);
        node.classList.add("lt-scroll-reveal");
        node.style.setProperty("--lt-reveal-delay", `${Math.min(index % 8, 7) * 32}ms`);
        revealObserver.observe(node);
      });
    };

    register(document);
    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) register(node);
        });
      });
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      revealObserver.disconnect();
    };
  }, []);

  const loadProfile = useCallback(async (user) => {
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, dept, role, status, admin_note, reviewer_name, reviewed_at")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      setFormError(error.message);
      setProfile(null);
      return;
    }

    if (!data) {
      setFormError("Account profile was not created yet. Make sure the Appwrite setup script was run.");
      setProfile(null);
      return;
    }

    setProfile(data);
    setTab((currentTab) => {
      const allowedTabs = data.role === "admin" ? ADMIN_TAB_KEYS : USER_TAB_KEYS;
      return allowedTabs.includes(currentTab)
        ? currentTab
        : data.role === "admin" ? "overview" : "inventory";
    });
  }, []);

  const loadChats = useCallback(async () => {
    if (!supabase || !profile || profile.status !== "approved") return;

    let query = supabase
      .from("chats")
      .select("id, dept, sender_id, sender_name, sender_role, text, timestamp")
      .order("timestamp", { ascending: false })
      .limit(isAdmin ? CHAT_INBOX_LIMIT : CHAT_FETCH_LIMIT);

    if (!isAdmin) query = query.eq("dept", userDept);

    const { data, error } = await query;
    if (error) {
      setFormError(error.message);
      return;
    }

    setChats([...(data || [])].reverse());
  }, [profile, isAdmin, userDept]);

  const loadData = useCallback(async () => {
    if (!supabase || !profile || profile.status !== "approved") return;

    const jobs = [];
    const run = (promise, handler) => jobs.push(promise.then(handler));

    const pendingReqCountQuery = isAdmin
      ? supabase.from("item_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : supabase.from("item_requests").select("id", { count: "exact", head: true }).eq("requested_by", session.user.id).eq("status", "pending");
    run(pendingReqCountQuery, (res) => {
      if (res.error) throw res.error;
      setPendingRequestsTotal(res.count || 0);
    });

    const pendingMaintenanceCountQuery = isAdmin
      ? supabase.from("maintenance_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : supabase.from("maintenance_requests").select("id", { count: "exact", head: true }).eq("requested_by", session.user.id).eq("status", "pending");
    run(pendingMaintenanceCountQuery, (res) => {
      if (res.error) throw res.error;
      setPendingMaintenanceRequestsTotal(res.count || 0);
    });

    if (isAdmin) {
      run(
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
        (res) => {
          if (res.error) throw res.error;
          setPendingAccountsTotal(res.count || 0);
        }
      );
      run(
        supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("status", "pending"),
        (res) => {
          if (res.error) throw res.error;
          setPendingSuppliersTotal(res.count || 0);
        }
      );
    }

    const shouldLoadMaterials = (!isAdmin && tab === "inventory") || (isAdmin && (tab === "overview" || tab === "departments" || (tab === "reports" && reportType === "inventory")));
    const shouldLoadRequests = (!isAdmin && tab === "requests") || (isAdmin && tab === "approvals");
    const shouldLoadLogs = (!isAdmin && tab === "history") || (isAdmin && (tab === "logs" || (tab === "reports" && reportType === "usage")));
    const shouldLoadAccounts = isAdmin && tab === "accounts";
    const shouldLoadBorrows = (!isAdmin && tab === "inventory") || (isAdmin && tab === "departments");
    const shouldLoadForecast = isAdmin && (tab === "overview" || tab === "forecast");
    const shouldLoadSummary = isAdmin && tab === "overview";
    const shouldLoadNotifications = isAdmin && (tab === "overview" || tab === "alerts" || (tab === "reports" && reportType === "alerts"));
    const shouldLoadSuppliers = isAdmin && ["suppliers", "forecast", "restockOrders"].includes(tab);
    const shouldLoadRestockRequests = isAdmin && (["overview", "restockOrders"].includes(tab) || (tab === "reports" && reportType === "restock"));
    const shouldLoadUserActivity = isAdmin && ["overview", "userActivity", "reports"].includes(tab);
    const shouldLoadOverdueBorrows = isAdmin && ["overview", "overdue", "reports"].includes(tab);
    const shouldLoadMaintenance = tab === "maintenance" || (isAdmin && ["overview", "reports"].includes(tab));
    const shouldLoadMaintenanceRequests = tab === "maintenance" || (isAdmin && tab === "overview");
    const shouldLoadCultures = tab === "cultureLogs" && (isAdmin || userDept === VIPM_DEPARTMENT);

    if (shouldLoadSummary) {
      run(supabase.rpc("get_dashboard_summary"), (res) => {
        if (res.error) throw res.error;
        const row = Array.isArray(res.data) ? res.data[0] : res.data;
        setDashboardSummary(row || null);
      });
    }

    if (shouldLoadNotifications) {
      const alertDept = notificationDeptFilter === "All" ? null : notificationDeptFilter;
      run(supabase.rpc("get_notification_center", { dept_param: alertDept }), (res) => {
        if (res.error) throw res.error;
        setNotifications(res.data || []);
      });
    }

    if (shouldLoadSuppliers) {
      const term = cleanSearchTerm(supplierSearch);
      let suppliersQuery = supabase
        .from("suppliers")
        .select("id, dept, name, contact_person, phone, email, material_category, material_name, price_per_unit, unit, notes, status, submitted_by, submitted_by_name, reviewed_by, reviewer_name, reviewed_at, review_note, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (tab === "suppliers") {
        if (supplierStatusFilter !== "All") suppliersQuery = suppliersQuery.eq("status", supplierStatusFilter);
        if (supplierDeptFilter !== "All") suppliersQuery = suppliersQuery.eq("dept", supplierDeptFilter);
      } else {
        suppliersQuery = suppliersQuery.eq("status", "approved");
        if (supplierDeptFilter !== "All") suppliersQuery = suppliersQuery.eq("dept", supplierDeptFilter);
      }
      if (term) suppliersQuery = suppliersQuery.or(`name.ilike.%${term}%,contact_person.ilike.%${term}%,material_name.ilike.%${term}%,material_category.ilike.%${term}%,email.ilike.%${term}%,status.ilike.%${term}%`);
      run(suppliersQuery, (res) => {
        if (res.error) throw res.error;
        setSuppliers(res.data || []);
      });
    }

    if (shouldLoadRestockRequests) {
      const term = cleanSearchTerm(restockSearch);
      let restockQuery = supabase
        .from("restock_requests")
        .select("id, dept, material_id, material_name, qty, unit, estimated_cost, supplier_name, status, reason, created_by_name, updated_by_name, admin_note, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(80);
      if (restockDeptFilter !== "All") restockQuery = restockQuery.eq("dept", restockDeptFilter);
      if (term) restockQuery = restockQuery.or(`material_name.ilike.%${term}%,supplier_name.ilike.%${term}%,reason.ilike.%${term}%,status.ilike.%${term}%`);
      run(restockQuery, (res) => {
        if (res.error) throw res.error;
        setRestockRequests(res.data || []);
      });
    }

    if (shouldLoadMaterials) {
      const materialStart = tab === "overview" ? 0 : materialsPage * MATERIALS_PAGE_SIZE;
      const materialEnd = tab === "overview" ? OVERVIEW_ATTENTION_LIMIT - 1 : materialStart + MATERIALS_PAGE_SIZE - 1;
      const term = tab === "overview" ? "" : cleanSearchTerm(searchMaterials);
      let materialsQuery = supabase
        .from("materials")
        .select("id, dept, name, category, material_type, qty, unit, threshold, expires_at, price_per_unit, supplier_name, hazard_level, storage_instruction, handling_instruction, disposal_instruction, ppe_required, incompatible_with, compatibility_notes, condition, last_maintenance_at, maintenance_due_at, maintenance_note, material_responsible, updated, approved_by_name, approved_at", { count: "exact" })
        .order("updated", { ascending: false })
        .range(materialStart, materialEnd);

      if (!isAdmin) {
        materialsQuery = materialsQuery.eq("dept", userDept);
      }
      if (isAdmin && tab === "departments") {
        materialsQuery = materialsQuery.eq("dept", deptTab);
      }
      if (isAdmin && tab === "reports" && reportType === "inventory" && reportDeptFilter !== "All") {
        materialsQuery = materialsQuery.eq("dept", reportDeptFilter);
      }
      if (term) {
        materialsQuery = materialsQuery.or(`name.ilike.%${term}%,category.ilike.%${term}%,unit.ilike.%${term}%`);
      }

      run(materialsQuery, (res) => {
        if (res.error) throw res.error;
        setMaterials(res.data || []);
        setMaterialsTotal(res.count ?? (res.data || []).length);
      });
    }

    if (shouldLoadRequests) {
      const requestStart = requestsPage * REQUESTS_PAGE_SIZE;
      const term = cleanSearchTerm(searchRequests);
      let requestsQuery = supabase
        .from("item_requests")
        .select("id, dept, name, category, material_type, qty, unit, threshold, expires_at, purpose, price_per_unit, supplier_name, hazard_level, storage_instruction, handling_instruction, disposal_instruction, ppe_required, incompatible_with, compatibility_notes, condition, last_maintenance_at, maintenance_due_at, maintenance_note, material_responsible, requested_by, requester_name, status, admin_note, reviewed_by, reviewer_name, reviewed_at, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(requestStart, requestStart + REQUESTS_PAGE_SIZE - 1);

      if (!isAdmin) {
        requestsQuery = requestsQuery.eq("requested_by", session.user.id);
      }
      if (isAdmin && requestDeptFilter !== "All") {
        requestsQuery = requestsQuery.eq("dept", requestDeptFilter);
      }
      if (term) {
        requestsQuery = requestsQuery.or(`name.ilike.%${term}%,category.ilike.%${term}%,requester_name.ilike.%${term}%,purpose.ilike.%${term}%,admin_note.ilike.%${term}%`);
      }

      run(requestsQuery, (res) => {
        if (res.error) throw res.error;
        setRequests(res.data || []);
        setRequestsTotal(res.count ?? (res.data || []).length);
      });
    }

    if (shouldLoadLogs) {
      const logsStart = logsPage * LOGS_PAGE_SIZE;
      const term = cleanSearchTerm(searchLogs);
      let logsQuery = supabase
        .from("logs")
        .select("id, dept, material_id, material_name, type, qty, detail, user_id, user_name, timestamp", { count: "exact" })
        .order("timestamp", { ascending: false })
        .range(logsStart, logsStart + LOGS_PAGE_SIZE - 1);

      if (isAdmin && logsFilter !== "All") {
        logsQuery = logsQuery.eq("dept", logsFilter);
      }
      if (!isAdmin) {
        logsQuery = logsQuery.eq("dept", userDept);
      }
      if (term) {
        logsQuery = logsQuery.or(`material_name.ilike.%${term}%,detail.ilike.%${term}%,user_name.ilike.%${term}%,type.ilike.%${term}%`);
      }

      run(logsQuery, (res) => {
        if (res.error) throw res.error;
        setLogs(res.data || []);
        setLogsTotal(res.count ?? (res.data || []).length);
      });
    }

    if (shouldLoadAccounts) {
      const accountStart = accountsPage * ACCOUNTS_PAGE_SIZE;
      const term = cleanSearchTerm(searchAccounts);
      let accountsQuery = supabase
        .from("profiles")
        .select("id, email, full_name, dept, role, status, created_at, admin_note, reviewer_name, reviewed_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(accountStart, accountStart + ACCOUNTS_PAGE_SIZE - 1);
      if (accountDeptFilter !== "All") {
        accountsQuery = accountsQuery.eq("dept", accountDeptFilter);
      }
      if (term) {
        accountsQuery = accountsQuery.or(`email.ilike.%${term}%,full_name.ilike.%${term}%,dept.ilike.%${term}%,role.ilike.%${term}%,status.ilike.%${term}%`);
      }
      run(accountsQuery, (res) => {
        if (res.error) throw res.error;
        setAccountApprovals(res.data || []);
        setAccountsTotal(res.count ?? (res.data || []).length);
      });
    }

    if (shouldLoadBorrows) {
      run(
        supabase
          .from("material_borrows")
          .select("id, dept, material_id, material_name, borrower_id, borrower_name, qty_borrowed, qty_returned, unit, purpose, status, borrowed_at, due_at")
          .eq("borrower_id", session.user.id)
          .eq("status", "active")
          .order("borrowed_at", { ascending: false })
          .limit(20),
        (res) => {
          if (res.error) throw res.error;
          setBorrowRecords(res.data || []);
        }
      );
    }

    if (shouldLoadForecast) {
      const targetDept = forecastDeptFilter === "All" ? null : forecastDeptFilter;
      run(
        supabase.rpc("get_usage_forecast", { dept_param: targetDept, days_history_param: FORECAST_HISTORY_DAYS }),
        (res) => {
          if (res.error) throw res.error;
          setForecastRows(res.data || []);
        }
      );
    }

    if (shouldLoadUserActivity) {
      run(
        supabase.rpc("get_user_activity_report", {
          dept_param: userActivityDeptFilter === "All" ? null : userActivityDeptFilter,
          search_param: cleanSearchTerm(userActivitySearch) || null,
        }),
        (res) => {
          if (res.error) throw res.error;
          setUserActivityRows(res.data || []);
        }
      );
    }

    if (shouldLoadOverdueBorrows) {
      run(
        supabase.rpc("get_overdue_borrows", { dept_param: overdueDeptFilter === "All" ? null : overdueDeptFilter }),
        (res) => {
          if (res.error) throw res.error;
          setOverdueBorrows(res.data || []);
        }
      );
    }

    if (shouldLoadMaintenance) {
      const term = cleanSearchTerm(maintenanceSearch);
      let maintenanceQuery = supabase
        .from("materials")
        .select("id, dept, name, category, material_type, condition, last_maintenance_at, maintenance_due_at, maintenance_note, updated")
        .eq("material_type", "non_consumable")
        .order("maintenance_due_at", { ascending: true, nullsFirst: false })
        .limit(120);
      if (!isAdmin) maintenanceQuery = maintenanceQuery.eq("dept", userDept);
      if (isAdmin && maintenanceDeptFilter !== "All") maintenanceQuery = maintenanceQuery.eq("dept", maintenanceDeptFilter);
      if (term) maintenanceQuery = maintenanceQuery.or(`name.ilike.%${term}%,category.ilike.%${term}%,condition.ilike.%${term}%,maintenance_note.ilike.%${term}%`);
      run(maintenanceQuery, (res) => {
        if (res.error) throw res.error;
        setMaintenanceRows(res.data || []);
      });
    }

    if (shouldLoadMaintenanceRequests) {
      let maintenanceRequestsQuery = supabase
        .from("maintenance_requests")
        .select("id, dept, material_id, material_name, requested_by, requester_name, condition, maintenance_date, next_due_at, maintenance_type, service_provider, technician, cost, notes, status, admin_note, reviewed_by, reviewer_name, reviewed_at, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(MAINTENANCE_REQUEST_FETCH_LIMIT);
      if (!isAdmin) maintenanceRequestsQuery = maintenanceRequestsQuery.eq("requested_by", session.user.id);
      if (isAdmin && maintenanceDeptFilter !== "All") maintenanceRequestsQuery = maintenanceRequestsQuery.eq("dept", maintenanceDeptFilter);
      run(maintenanceRequestsQuery, (res) => {
        if (res.error) throw res.error;
        setMaintenanceRequests(res.data || []);
      });
    }

    if (shouldLoadCultures) {
      run(
        supabase
          .from("culture_logs")
          .select("id, dept, organism_type, culture_name, strain, stored_at, ready_at, status, storage_location, notes, recorded_by, recorded_by_name, created_at, updated_at")
          .eq("dept", VIPM_DEPARTMENT)
          .order("ready_at", { ascending: true })
          .limit(CULTURE_FETCH_LIMIT),
        (res) => {
          if (res.error) throw res.error;
          setCultureLogs(res.data || []);
        }
      );
    }


    try {
      await Promise.all(jobs);
    } catch (error) {
      setFormError(error.message || "Could not load data.");
    }
  }, [
    profile,
    isAdmin,
    tab,
    logsFilter,
    logsPage,
    materialsPage,
    requestsPage,
    accountsPage,
    deptTab,
    adminActiveDept,
    searchMaterials,
    searchRequests,
    searchLogs,
    searchAccounts,
    accountDeptFilter,
    requestDeptFilter,
    forecastDeptFilter,
    restockDeptFilter,
    restockSearch,
    supplierDeptFilter,
    supplierStatusFilter,
    supplierSearch,
    notificationDeptFilter,
    userActivityDeptFilter,
    userActivitySearch,
    overdueDeptFilter,
    maintenanceDeptFilter,
    maintenanceSearch,
    reportType,
    reportDeptFilter,
    session?.user?.id,
    userDept,
  ]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      setMaterials([]);
      setLogs([]);
      setChats([]);
      setRequests([]);
      setAccountApprovals([]);
      setBorrowRecords([]);
      setForecastRows([]);
      setRestockRequests([]);
      setSuppliers([]);
      setNotifications([]);
      setUserActivityRows([]);
      setOverdueBorrows([]);
      setMaintenanceRows([]);
      setCultureLogs([]);
      setDashboardSummary(null);
      setLogsTotal(0);
      setMaterialsTotal(0);
      setRequestsTotal(0);
      setAccountsTotal(0);
      setPendingRequestsTotal(0);
      setPendingAccountsTotal(0);
      return;
    }
    loadProfile(session.user);
  }, [session, loadProfile]);

  useEffect(() => {
    if (!profile || profile.status !== "approved") return;
    loadData();
  }, [profile, loadData]);


  useEffect(() => {
    if (!profile || profile.status !== "approved") return;
    loadChats();
  }, [profile, loadChats]);

  useEffect(() => {
    if (!session?.user?.id || typeof window === "undefined") {
      setChatReadAt({});
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(`labtrack-chat-read:${session.user.id}`) || "{}");
      setChatReadAt(saved && typeof saved === "object" ? saved : {});
    } catch {
      setChatReadAt({});
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!supabase || !profile || profile.status !== "approved") return;

    const chatFilter = isAdmin ? undefined : `dept=eq.${userDept}`;
    const channel = supabase
      .channel(`labtrack-chat-notifications-${session?.user?.id || "guest"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chats", filter: chatFilter },
        (event) => {
          const message = event?.new || event?.payload || null;
          if (!message) {
            loadChats();
            return;
          }

          setChats((current) => {
            const next = [...current.filter((item) => item.id !== message.id), message]
              .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            return next.slice(-(isAdmin ? CHAT_INBOX_LIMIT : CHAT_FETCH_LIMIT));
          });

          const incomingRole = isAdmin ? "user" : "admin";
          const relevant = isAdmin || message.dept === userDept;
          const conversationOpen = tab === "support" && (!isAdmin || adminActiveDept === message.dept);
          if (!relevant || message.sender_role !== incomingRole || conversationOpen) return;

          const source = isAdmin ? message.dept : "LabTrack admin";
          setAppMessage(`New support message from ${source}: ${String(message.text || "").slice(0, 90)}`);

          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const notice = new Notification(`LabTrack support · ${source}`, {
              body: String(message.text || "New support message"),
              tag: `labtrack-chat-${message.dept}`,
            });
            notice.onclick = () => {
              window.focus();
              if (isAdmin) setAdminActiveDept(message.dept);
              setTab("support");
              notice.close();
            };
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, isAdmin, userDept, session?.user?.id, tab, adminActiveDept, loadChats]);

  const markChatRead = useCallback((department) => {
    if (!department || !session?.user?.id) return;
    const nextTimestamp = new Date().toISOString();
    setChatReadAt((current) => {
      const next = { ...current, [department]: nextTimestamp };
      try {
        localStorage.setItem(`labtrack-chat-read:${session.user.id}`, JSON.stringify(next));
      } catch {
        // Local storage may be unavailable in private browsing.
      }
      return next;
    });
  }, [session?.user?.id]);

  useEffect(() => {
    if (tab !== "support") return;
    markChatRead(isAdmin ? adminActiveDept : userDept);
  }, [tab, isAdmin, adminActiveDept, userDept, chats, markChatRead]);

  async function enableChatNotifications() {
    if (typeof Notification === "undefined") {
      setAppMessage("Browser notifications are not supported on this device.");
      return;
    }
    const permission = await Notification.requestPermission();
    setBrowserNotificationPermission(permission);
    setAppMessage(permission === "granted" ? "Support notifications enabled." : "Browser notifications were not enabled. In-app badges will still work.");
  }

  const unreadChatByDept = useMemo(() => {
    const counts = Object.fromEntries(DEPARTMENTS.map((department) => [department, 0]));
    const incomingRole = isAdmin ? "user" : "admin";
    chats.forEach((message) => {
      if (message.sender_role !== incomingRole) return;
      if (!isAdmin && message.dept !== userDept) return;
      const readAt = chatReadAt[message.dept];
      if (!readAt || new Date(message.timestamp) > new Date(readAt)) {
        counts[message.dept] = (counts[message.dept] || 0) + 1;
      }
    });
    return counts;
  }, [chats, chatReadAt, isAdmin, userDept]);

  const totalUnreadChats = Object.values(unreadChatByDept).reduce((sum, count) => sum + count, 0);

  useEffect(() => {
    document.title = totalUnreadChats > 0 ? `(${totalUnreadChats}) LabTrack` : "LabTrack";
  }, [totalUnreadChats]);

  const deptMaterials = useMemo(
    () => materials.filter((material) => material.dept === userDept),
    [materials, userDept]
  );
  const deptChats = useMemo(
    () => chats.filter((chat) => chat.dept === userDept),
    [chats, userDept]
  );
  const userRequests = useMemo(
    () => requests.filter((request) => request.requested_by === session?.user?.id),
    [requests, session?.user?.id]
  );
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests]
  );
  const pendingAccounts = useMemo(
    () => accountApprovals.filter((account) => account.status === "pending"),
    [accountApprovals]
  );
  const allAttention = useMemo(
    () => materials
      .filter((material) => statusOf(material) !== "ok" || ["expired", "expiring"].includes(expiryStatusOf(material)))
      .sort((a, b) => {
        const score = (m) => expiryStatusOf(m) === "expired" ? 0 : statusOf(m) === "crit" ? 1 : expiryStatusOf(m) === "expiring" ? 2 : statusOf(m) === "warn" ? 3 : 4;
        return score(a) - score(b);
      }),
    [materials]
  );
  const adminDeptMaterials = useMemo(
    () => materials.filter((material) => material.dept === deptTab),
    [materials, deptTab]
  );
  const adminChatDept = useMemo(
    () => chats.filter((chat) => chat.dept === adminActiveDept),
    [chats, adminActiveDept]
  );
  const filteredCultureLogs = useMemo(() => {
    const term = cleanSearchTerm(cultureSearch).toLowerCase();
    return cultureLogs
      .filter((culture) => {
        const matchesType = cultureTypeFilter === "All" || culture.organism_type === cultureTypeFilter;
        const status = cultureStatusOf(culture);
        const matchesStatus = cultureStatusFilter === "All" || status === cultureStatusFilter;
        const haystack = `${culture.culture_name || ""} ${culture.strain || ""} ${culture.storage_location || ""} ${culture.notes || ""}`.toLowerCase();
        return matchesType && matchesStatus && (!term || haystack.includes(term));
      })
      .sort((a, b) => {
        const statusOrder = { ready: 0, incubating: 1, contaminated: 2, completed: 3 };
        const statusDelta = (statusOrder[cultureStatusOf(a)] ?? 9) - (statusOrder[cultureStatusOf(b)] ?? 9);
        if (statusDelta !== 0) return statusDelta;
        return String(a.ready_at || "").localeCompare(String(b.ready_at || ""));
      });
  }, [cultureLogs, cultureSearch, cultureTypeFilter, cultureStatusFilter]);
  const cultureSummary = useMemo(() => ({
    total: cultureLogs.length,
    fungi: cultureLogs.filter((culture) => culture.organism_type === "fungi").length,
    bacteria: cultureLogs.filter((culture) => culture.organism_type === "bacteria").length,
    ready: cultureLogs.filter((culture) => cultureStatusOf(culture) === "ready").length,
  }), [cultureLogs]);
  const lowInDept = deptMaterials.filter((material) => statusOf(material) !== "ok" || ["expired", "expiring"].includes(expiryStatusOf(material))).length;
  const filteredForecastRows = useMemo(() => {
    const term = cleanSearchTerm(forecastSearch).toLowerCase();
    return forecastRows.filter((row) => {
      const matchesTerm = !term || `${row.material_name} ${row.dept} ${row.reason} ${row.priority}`.toLowerCase().includes(term);
      return matchesTerm;
    });
  }, [forecastRows, forecastSearch]);
  const topForecastRows = useMemo(() => {
    const priorityOrder = { expired: 0, critical: 1, low: 2, high_usage: 3, expiring: 4, ok: 5 };
    return [...forecastRows].sort((a, b) => (priorityOrder[String(a.priority).toLowerCase()] ?? 9) - (priorityOrder[String(b.priority).toLowerCase()] ?? 9)).slice(0, 6);
  }, [forecastRows]);

  const openRestockCount = useMemo(() => restockRequests.filter((r) => ["pending", "ordered"].includes(r.status)).length, [restockRequests]);
  const unreadAlertCount = notifications.filter((n) => ["critical", "warning"].includes(String(n.severity).toLowerCase())).length;
  const overdueBorrowCount = dashboardSummary?.overdue_borrows ?? overdueBorrows.length;
  const maintenanceDueCount = dashboardSummary?.maintenance_due ?? maintenanceRows.filter((m) => ["overdue", "due"].includes(maintenanceStatusOf(m))).length;

  const lastMsgByDept = (department) => {
    return [...chats].filter((chat) => chat.dept === department).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  };

  const accent = isAdmin ? "var(--admin-accent)" : "var(--user-accent)";
  const accentSoft = isAdmin ? "var(--admin-accent-soft)" : "var(--user-accent-soft)";

  const userTabs = [
    { key: "inventory", label: "Inventory", icon: LayoutGrid, badge: lowInDept },
    { key: "requests", label: "Requests", icon: AlertTriangle, badge: pendingRequestsTotal },
    { key: "maintenance", label: "Maintenance", icon: CalendarClock, badge: pendingMaintenanceRequestsTotal },
    { key: "history", label: "History", icon: HistoryIcon },
    ...(userDept === VIPM_DEPARTMENT
      ? [{ key: "cultureLogs", label: "Fungi & Bacteria", icon: Beaker, badge: cultureSummary.ready }]
      : []),
    { key: "support", label: "Support", icon: MessageCircle, badge: totalUnreadChats },
  ];

  const adminTabs = [
    { key: "overview", label: "Overview", icon: LayoutGrid, badge: allAttention.length },
    { key: "approvals", label: "Materials", icon: AlertTriangle, badge: pendingRequestsTotal },
    { key: "accounts", label: "Accounts", icon: UserCheck, badge: pendingAccountsTotal },
    { key: "departments", label: "Inventory", icon: Building2 },
    { key: "cultureLogs", label: "Fungi & Bacteria", icon: Beaker, badge: cultureSummary.ready },
    { key: "forecast", label: "Forecast", icon: TrendingUp, badge: forecastRows.filter((row) => ["expired", "critical", "low", "high_usage", "expiring"].includes(String(row.priority).toLowerCase())).length },
    { key: "restockOrders", label: "Restock", icon: Truck, badge: openRestockCount },
    { key: "suppliers", label: "Suppliers", icon: DollarSign, badge: pendingSuppliersTotal },
    { key: "alerts", label: "Alerts", icon: Bell, badge: unreadAlertCount },
    { key: "userActivity", label: "User Activity", icon: UserCheck },
    { key: "overdue", label: "Overdue", icon: AlertTriangle, badge: overdueBorrowCount },
    { key: "maintenance", label: "Maintenance", icon: CalendarClock, badge: maintenanceDueCount + pendingMaintenanceRequestsTotal },
    { key: "reports", label: "Reports", icon: FileSpreadsheet },
    { key: "logs", label: "Logs", icon: ClipboardList },
    { key: "support", label: "Support", icon: MessageCircle, badge: totalUnreadChats },
  ];
  const navigationItems = isAdmin ? adminTabs : userTabs;
  const activeNavigationItem = navigationItems.find((item) => item.key === tab) || navigationItems[0];

  function switchTab(nextTab) {
    setTab(nextTab);
    setMobileNavOpen(false);
    setFormError("");
    setAppMessage("");
    setLogsPage(0);
    setMaterialsPage(0);
    setRequestsPage(0);
    setAccountsPage(0);
    if (nextTab !== "forecast") setForecastSearch("");
    if (nextTab !== "restockOrders") setRestockSearch("");
    if (nextTab !== "suppliers") setSupplierSearch("");
    if (nextTab !== "cultureLogs") setCultureSearch("");
  }

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  useEffect(() => {
    setMaterialsPage(0);
  }, [deptTab]);

  useEffect(() => {
    setLogsPage(0);
  }, [logsFilter]);

  async function handleSignIn(e) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    setAppMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (error) {
      setBusy(false);
      setFormError(error.message);
      return;
    }

    const { data: signedInProfile, error: profileError } = await supabase
      .from("profiles")
      .select("status, admin_note")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      await supabase.auth.signOut();
      setBusy(false);
      setFormError(profileError.message);
      return;
    }

    if (!signedInProfile || signedInProfile.status !== "approved") {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setBusy(false);
      setFormError(
        signedInProfile?.status === "rejected"
          ? `Your account was rejected by an admin.${signedInProfile?.admin_note ? ` Note: ${signedInProfile.admin_note}` : ""}`
          : "Your account is still waiting for admin approval. Please try again after an admin approves it."
      );
      return;
    }

    setBusy(false);
  }

  async function handleSignUp(e) {
    e.preventDefault();
    if (!fullName.trim()) {
      setFormError("Enter your full name.");
      return;
    }
    if (password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setFormError("");
    setAppMessage("");
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          dept: registerDept,
        },
      },
    });

    if (error) {
      setBusy(false);
      setFormError(error.message);
      return;
    }

    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setBusy(false);
    setAppMessage("Account request submitted. An admin must approve it before you can log in.");
    setAuthMode("login");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setEmail("");
    setPassword("");
    setFullName("");
    setAuthMode("login");
    setTab("inventory");
    setLogsFilter("All");
    setLogsPage(0);
    setMaterialsPage(0);
    setRequestsPage(0);
    setAccountsPage(0);
    setFormError("");
    setAppMessage("");
  }

  function openModal(mode, material = null, request = null, account = null, borrow = null, log = null, maintenanceRequest = null) {
    setModalMode(mode);
    setActiveMaterial(material);
    setActiveRequest(request);
    setActiveAccount(account);
    setActiveBorrow(borrow);
    setActiveLog(log);
    setActiveMaintenanceRequest(maintenanceRequest);
    setFormError("");
    setReviewNote("");
    setMaterialResponsible(mode === "approve" ? (request?.material_responsible || request?.requester_name || "") : "");
    if (mode === "request") {
      setRequestForm({ ...emptyMaterialForm(userDept), material_responsible: displayName });
    }
    if (mode === "adminAddMaterial") {
      setRequestForm(emptyMaterialForm(deptTab));
    }
    if (mode === "supplier") setSupplierForm({ dept: "All", name: "", contact_person: "", phone: "", email: "", material_category: "", material_name: "", price_per_unit: "", unit: "", notes: "" });
    if (mode === "transfer") setTransferForm({ target_dept: DEPARTMENTS.find((d) => d !== material?.dept) || DEPARTMENTS[0], qty: "", reason: "" });
    if (mode === "use") setUseForm({ qty: "", purpose: "" });
    if (mode === "borrow") setBorrowForm({ qty: "", purpose: "", due_at: "" });
    if (mode === "return") setReturnForm({ qty: borrow ? String(Number(borrow.qty_borrowed || 0) - Number(borrow.qty_returned || 0)) : "", note: "" });
    if (mode === "correct") setCorrectForm({ qty: material ? String(material.qty) : "", reason: "" });
    if (mode === "maintenance") setMaintenanceForm({ condition: material?.condition || "Good", last_maintenance_at: material?.last_maintenance_at || "", maintenance_due_at: material?.maintenance_due_at || "", maintenance_note: material?.maintenance_note || "" });
    if (mode === "maintenanceRequest" || mode === "maintenanceAdmin") {
      const target = material || maintenanceRows[0] || null;
      setMaintenanceRequestForm(emptyMaintenanceRequestForm(target));
    }
    if (mode === "culture") setCultureForm({
      organism_type: "fungi",
      culture_name: "",
      strain: "",
      stored_at: new Date().toISOString().slice(0, 10),
      ready_at: "",
      storage_location: "",
      notes: "",
    });
    if (mode === "cleanup") setClearForm({ target: "both", period: "week" });
  }

  function closeModal() {
    setModalMode(null);
    setActiveMaterial(null);
    setActiveRequest(null);
    setActiveAccount(null);
    setActiveBorrow(null);
    setActiveLog(null);
    setActiveCulture(null);
    setActiveMaintenanceRequest(null);
    setFormError("");
    setReviewNote("");
    setMaterialResponsible("");
  }

  async function submitItemRequest() {
    const { name, category, material_type, qty, unit, threshold, expires_at, purpose, price_per_unit, supplier_name, hazard_level, storage_instruction, handling_instruction, disposal_instruction, ppe_required, incompatible_with, compatibility_notes, condition, last_maintenance_at, maintenance_due_at, maintenance_note, material_responsible } = requestForm;
    if (!name.trim() || !unit.trim() || qty === "" || threshold === "" || !purpose.trim() || !material_responsible.trim()) {
      setFormError("Fill in name, quantity, unit, threshold, request purpose, and MR (Material Responsibility).");
      return;
    }
    if (material_type === "non_consumable" && (!condition.trim() || !maintenance_due_at)) {
      setFormError("For non-consumable materials, enter the current condition and next maintenance due date.");
      return;
    }

    setBusy(true);
    setFormError("");
    const { error } = await supabase.from("item_requests").insert({
      dept: userDept,
      name: name.trim(),
      category: category.trim() || "Uncategorized",
      material_type: material_type === "non_consumable" ? "non_consumable" : "consumable",
      qty: Number(qty),
      unit: unit.trim(),
      threshold: Number(threshold),
      expires_at: expires_at || null,
      purpose: purpose.trim(),
      price_per_unit: Number(price_per_unit || 0),
      supplier_name: supplier_name.trim() || null,
      hazard_level: hazard_level || "Low",
      storage_instruction: storage_instruction.trim() || null,
      handling_instruction: handling_instruction.trim() || null,
      disposal_instruction: disposal_instruction.trim() || null,
      ppe_required: ppe_required.trim() || null,
      incompatible_with: incompatible_with.trim() || null,
      compatibility_notes: compatibility_notes.trim() || null,
      condition: material_type === "non_consumable" ? (condition.trim() || "Good") : "Not applicable",
      last_maintenance_at: material_type === "non_consumable" ? (last_maintenance_at || null) : null,
      maintenance_due_at: material_type === "non_consumable" ? (maintenance_due_at || null) : null,
      maintenance_note: material_type === "non_consumable" ? (maintenance_note.trim() || null) : null,
      material_responsible: material_responsible.trim(),
      requested_by: session.user.id,
      requester_name: displayName,
      status: "pending",
    });
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    setTab("requests");
  }

  async function submitAdminMaterial() {
    const { dept, name, category, material_type, qty, unit, threshold, expires_at, purpose, price_per_unit, supplier_name, hazard_level, storage_instruction, handling_instruction, disposal_instruction, ppe_required, incompatible_with, compatibility_notes, condition, last_maintenance_at, maintenance_due_at, maintenance_note, material_responsible } = requestForm;

    if (!isAdmin) {
      setFormError("Only an approved administrator can add materials directly.");
      return;
    }
    if (!dept || !DEPARTMENTS.includes(dept)) {
      setFormError("Choose the department that will own this material.");
      return;
    }
    if (!name.trim() || !unit.trim() || qty === "" || threshold === "" || !material_responsible.trim()) {
      setFormError("Fill in department, name, quantity, unit, threshold, and MR (Material Responsibility).");
      return;
    }
    if (Number(qty) < 0 || Number(threshold) < 0) {
      setFormError("Quantity and low-stock threshold cannot be negative.");
      return;
    }
    if (material_type === "non_consumable" && (!condition.trim() || !maintenance_due_at)) {
      setFormError("For non-consumable materials, enter the condition and next maintenance due date.");
      return;
    }

    const now = new Date().toISOString();
    setBusy(true);
    setFormError("");

    const { data: created, error: createError } = await supabase.from("materials").insert({
      dept,
      name: name.trim(),
      category: category.trim() || "Uncategorized",
      material_type: material_type === "non_consumable" ? "non_consumable" : "consumable",
      qty: Number(qty),
      unit: unit.trim(),
      threshold: Number(threshold),
      expires_at: expires_at || null,
      price_per_unit: Number(price_per_unit || 0),
      supplier_name: supplier_name.trim() || null,
      hazard_level: hazard_level || "Low",
      storage_instruction: storage_instruction.trim() || null,
      handling_instruction: handling_instruction.trim() || null,
      disposal_instruction: disposal_instruction.trim() || null,
      ppe_required: ppe_required.trim() || null,
      incompatible_with: incompatible_with.trim() || null,
      compatibility_notes: compatibility_notes.trim() || null,
      condition: material_type === "non_consumable" ? (condition.trim() || "Good") : "Not applicable",
      last_maintenance_at: material_type === "non_consumable" ? (last_maintenance_at || null) : null,
      maintenance_due_at: material_type === "non_consumable" ? (maintenance_due_at || null) : null,
      maintenance_note: material_type === "non_consumable" ? (maintenance_note.trim() || null) : null,
      material_responsible: material_responsible.trim(),
      created_by: session.user.id,
      approved_by: session.user.id,
      approved_by_name: displayName,
      approved_at: now,
      updated: now,
      created_at: now,
    });

    if (createError) {
      setBusy(false);
      setFormError(createError.message);
      return;
    }

    const material = Array.isArray(created) ? created[0] : created;
    const { error: logError } = await supabase.from("logs").insert({
      dept,
      material_id: material?.id || null,
      material_name: name.trim(),
      type: "admin_add",
      qty: Number(qty),
      detail: `${purpose.trim() || "Added directly by administrator"} · MR: ${material_responsible.trim()}`,
      user_id: session.user.id,
      user_name: displayName,
      timestamp: now,
    });
    setBusy(false);

    if (logError) {
      setFormError(`Material was added, but the activity log could not be saved: ${logError.message}`);
      return;
    }

    closeModal();
    setDeptTab(dept);
    setTab("departments");
    setAppMessage(`${name.trim()} was added to ${dept} and assigned to ${material_responsible.trim()} as MR.`);
    loadData();
  }

  async function submitUse() {
    const qtyUsed = Number(useForm.qty);
    const currentQty = Number(activeMaterial.qty ?? 0);
    if (!qtyUsed || qtyUsed <= 0) {
      setFormError("Enter a quantity greater than zero.");
      return;
    }
    if (qtyUsed > currentQty) {
      setFormError(`Only ${displayQty(currentQty)} ${activeMaterial.unit} available.`);
      return;
    }
    if (!useForm.purpose.trim()) {
      setFormError("Add a short purpose so admins can track why it was used.");
      return;
    }

    const now = new Date().toISOString();
    setBusy(true);
    setFormError("");
    const { error: updateError } = await supabase
      .from("materials")
      .update({ qty: currentQty - qtyUsed, updated: now })
      .eq("id", activeMaterial.id);

    if (updateError) {
      setBusy(false);
      setFormError(updateError.message);
      return;
    }

    const { error: logError } = await supabase.from("logs").insert({
      dept: activeMaterial.dept,
      material_id: activeMaterial.id,
      material_name: activeMaterial.name,
      type: "usage",
      qty: qtyUsed,
      detail: useForm.purpose.trim(),
      user_id: session.user.id,
      user_name: displayName,
      timestamp: now,
    });
    setBusy(false);

    if (logError) {
      setFormError(logError.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function submitBorrow() {
    const qtyBorrowed = Number(borrowForm.qty);
    const currentQty = Number(activeMaterial.qty ?? 0);
    if (!qtyBorrowed || qtyBorrowed <= 0) {
      setFormError("Enter a quantity greater than zero.");
      return;
    }
    if (qtyBorrowed > currentQty) {
      setFormError(`Only ${displayQty(currentQty)} ${activeMaterial.unit} available.`);
      return;
    }
    if (!borrowForm.purpose.trim()) {
      setFormError("Add a purpose for borrowing this material.");
      return;
    }

    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("borrow_material", {
      material_id_param: activeMaterial.id,
      qty_param: qtyBorrowed,
      purpose_param: borrowForm.purpose.trim(),
      due_at_param: borrowForm.due_at || null,
    });
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function submitReturn() {
    const qtyReturned = Number(returnForm.qty);
    const remaining = Number(activeBorrow.qty_borrowed || 0) - Number(activeBorrow.qty_returned || 0);
    if (!qtyReturned || qtyReturned <= 0) {
      setFormError("Enter a quantity greater than zero.");
      return;
    }
    if (qtyReturned > remaining) {
      setFormError(`Only ${displayQty(remaining)} ${activeBorrow.unit} can be returned for this borrow record.`);
      return;
    }

    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("return_borrowed_material", {
      borrow_id_param: activeBorrow.id,
      returned_qty_param: qtyReturned,
      note_param: returnForm.note.trim() || "Returned borrowed material",
    });
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function submitCorrect() {
    const newQty = Number(correctForm.qty);
    const currentQty = Number(activeMaterial.qty ?? 0);
    if (correctForm.qty === "" || newQty < 0) {
      setFormError("Enter a valid corrected quantity.");
      return;
    }
    if (!correctForm.reason.trim()) {
      setFormError("Add a short reason for the correction.");
      return;
    }

    const now = new Date().toISOString();
    const delta = newQty - currentQty;
    setBusy(true);
    setFormError("");
    const { error: updateError } = await supabase
      .from("materials")
      .update({ qty: newQty, updated: now })
      .eq("id", activeMaterial.id);

    if (updateError) {
      setBusy(false);
      setFormError(updateError.message);
      return;
    }

    const { error: logError } = await supabase.from("logs").insert({
      dept: activeMaterial.dept,
      material_id: activeMaterial.id,
      material_name: activeMaterial.name,
      type: "correction",
      qty: delta,
      detail: correctForm.reason.trim(),
      user_id: session.user.id,
      user_name: displayName,
      timestamp: now,
    });
    setBusy(false);

    if (logError) {
      setFormError(logError.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function approveRequest(request) {
    if (!materialResponsible.trim()) {
      setFormError("Assign an MR (Material Responsibility) before approving this material.");
      return;
    }
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("approve_item_request", {
      request_id_param: request.id,
      admin_note_param: reviewNote.trim() || "Approved by admin",
      material_responsible_param: materialResponsible.trim(),
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function rejectRequest(request) {
    if (!reviewNote.trim()) {
      setFormError("Add a rejection reason before rejecting the request.");
      return;
    }
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("reject_item_request", {
      request_id_param: request.id,
      admin_note_param: reviewNote.trim(),
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function approveAccount(account) {
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("approve_user_account", {
      profile_id_param: account.id,
      admin_note_param: "Approved by admin",
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    loadData();
  }

  async function rejectAccount(account) {
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("reject_user_account", {
      profile_id_param: account.id,
      admin_note_param: "Rejected by admin",
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    loadData();
  }

  async function deleteMaterial(material) {
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("delete_material_admin", {
      material_id_param: material.id,
      admin_note_param: reviewNote.trim() || "Deleted by admin",
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function deleteLog(log) {
    if (!log) return;
    setBusy(true);
    setFormError("");
    const { error } = await supabase
      .from("logs")
      .delete()
      .eq("id", log.id);
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    const shouldGoBack = logsPage > 0 && logs.length === 1;
    closeModal();
    if (shouldGoBack) {
      setLogsPage((page) => Math.max(0, page - 1));
    } else {
      loadData();
    }
  }

  async function deleteAccount(account) {
    if (account.id === session.user.id) {
      setFormError("You cannot delete your own admin account while logged in.");
      return;
    }
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("delete_user_account", {
      profile_id_param: account.id,
      admin_note_param: reviewNote.trim() || "Deleted by admin",
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function sendChat() {
    const targetDept = isAdmin ? adminActiveDept : userDept;
    if (!chatInput.trim()) return;

    const text = chatInput.trim();
    setChatInput("");
    const { error } = await supabase.from("chats").insert({
      dept: targetDept,
      sender_id: session.user.id,
      sender_name: isAdmin ? "Admin" : displayName,
      sender_role: isAdmin ? "admin" : "user",
      text,
      timestamp: new Date().toISOString(),
    });
    if (error) {
      setFormError(error.message);
      return;
    }
    loadChats();
  }

  async function clearSelectedActivity() {
    const targetLabel = CLEAR_TARGET_OPTIONS.find((item) => item.value === clearForm.target)?.label || "selected records";
    const periodLabel = CLEAR_PERIOD_OPTIONS.find((item) => item.value === clearForm.period)?.label || "selected period";
    const ok = window.confirm(`Clear ${targetLabel.toLowerCase()} for ${periodLabel.toLowerCase()}? This cannot be undone.`);
    if (!ok) return;

    setBusy(true);
    setFormError("");
    setAppMessage("");
    const { data, error } = await supabase.rpc("clear_activity_range", {
      target_param: clearForm.target,
      period_param: clearForm.period,
    });
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    closeModal();
    setAppMessage(`Clear finished. Deleted ${result?.deleted_logs || 0} general logs, ${result?.deleted_approval_logs || 0} material approval activity logs, ${result?.deleted_approval_requests || 0} reviewed approval records, and ${result?.deleted_chats || 0} chat messages.`);
    setLogsPage(0);
    loadData();
  }

  async function submitSupplier() {
    if (!supplierForm.name.trim()) {
      setFormError("Supplier name is required.");
      return;
    }
    setBusy(true);
    setFormError("");
    setAppMessage("");
    const { error } = await supabase.from("suppliers").insert({
      dept: supplierForm.dept === "All" ? null : supplierForm.dept,
      name: supplierForm.name.trim(),
      contact_person: supplierForm.contact_person.trim() || null,
      phone: supplierForm.phone.trim() || null,
      email: supplierForm.email.trim() || null,
      material_category: supplierForm.material_category || null,
      material_name: supplierForm.material_name.trim() || null,
      price_per_unit: Number(supplierForm.price_per_unit || 0),
      unit: supplierForm.unit.trim() || null,
      notes: supplierForm.notes.trim() || null,
      created_by: session.user.id,
      submitted_by: session.user.id,
      submitted_by_name: displayName,
      status: "pending",
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    setAppMessage(isAdmin ? "Supplier entry submitted. Approve it from the Pending supplier list before it becomes active." : "Supplier suggestion sent. It will appear in the supplier list after admin approval.");
    if (isAdmin) setSupplierStatusFilter("pending");
    loadData();
  }

  async function reviewSupplier(supplier, status) {
    const review_note = status === "rejected" ? window.prompt(`Reason for rejecting ${supplier.name}:`, "") : "Approved supplier suggestion";
    if (status === "rejected" && review_note === null) return;
    const ok = window.confirm(`${status === "approved" ? "Approve" : "Reject"} supplier ${supplier.name}?`);
    if (!ok) return;

    setBusy(true);
    setFormError("");
    setAppMessage("");

    const { error } = await supabase
      .from("suppliers")
      .update({
        status,
        reviewed_by: session.user.id,
        reviewer_name: displayName,
        reviewed_at: new Date().toISOString(),
        review_note: review_note || null,
      })
      .eq("id", supplier.id);

    if (!error) {
      await supabase.from("logs").insert({
        dept: supplier.dept || userDept,
        material_id: null,
        material_name: supplier.material_name || supplier.material_category || supplier.name,
        type: "supplier",
        qty: 0,
        detail: `${status === "approved" ? "Approved" : "Rejected"} supplier ${supplier.name}${review_note ? ` · ${review_note}` : ""}`,
        user_id: session.user.id,
        user_name: displayName,
      });
    }

    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }

    setAppMessage(`Supplier ${status}.`);
    loadData();
  }

  async function deleteSupplier(supplier) {
    const ok = window.confirm(`Delete supplier ${supplier.name}?`);
    if (!ok) return;
    setBusy(true);
    setFormError("");
    const { error } = await supabase.from("suppliers").delete().eq("id", supplier.id);
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    loadData();
  }

  async function createRestockFromForecast(row) {
    const qty = Number(row.suggested_restock_qty || 0);
    if (!qty || qty <= 0) {
      setFormError("This material has no suggested restock quantity yet.");
      return;
    }
    const ok = window.confirm(`Create restock request for ${displayQty(qty)} ${row.unit} of ${row.material_name}?`);
    if (!ok) return;
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("create_restock_request", {
      material_id_param: row.material_id,
      qty_param: qty,
      reason_param: row.reason || "Forecast suggested restock",
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setAppMessage("Restock request created.");
    setTab("restockOrders");
    loadData();
  }

  async function updateRestockStatus(request, status) {
    let note = "";
    if (status === "cancelled") {
      note = window.prompt("Reason for cancelling this restock request:") || "Cancelled by admin";
    } else if (status === "received") {
      note = window.prompt("Receiving note:") || "Received and added to inventory";
    } else {
      note = "Marked as ordered";
    }
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("update_restock_request_status", {
      restock_id_param: request.id,
      status_param: status,
      admin_note_param: note,
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    loadData();
  }

  async function submitTransfer() {
    const qty = Number(transferForm.qty);
    if (!qty || qty <= 0) {
      setFormError("Enter a transfer quantity greater than zero.");
      return;
    }
    if (!transferForm.target_dept || transferForm.target_dept === activeMaterial.dept) {
      setFormError("Choose a different receiving department.");
      return;
    }
    if (!transferForm.reason.trim()) {
      setFormError("Add a reason for the transfer.");
      return;
    }
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("transfer_material_stock", {
      material_id_param: activeMaterial.id,
      target_dept_param: transferForm.target_dept,
      qty_param: qty,
      reason_param: transferForm.reason.trim(),
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function submitMaintenance() {
    if (!activeMaterial) return;
    if (activeMaterial.material_type !== "non_consumable") {
      setFormError("Maintenance applies only to non-consumable materials.");
      return;
    }
    if (!maintenanceForm.condition.trim()) {
      setFormError("Enter the current condition.");
      return;
    }
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("update_material_maintenance", {
      material_id_param: activeMaterial.id,
      condition_param: maintenanceForm.condition.trim(),
      last_maintenance_param: maintenanceForm.last_maintenance_at || null,
      maintenance_due_param: maintenanceForm.maintenance_due_at || null,
      note_param: maintenanceForm.maintenance_note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    loadData();
  }

  async function submitMaintenanceRequest(directAdmin = false) {
    const target = maintenanceRows.find((row) => row.id === maintenanceRequestForm.material_id) || activeMaterial;
    if (!target) {
      setFormError("Choose the equipment that needs maintenance.");
      return;
    }
    if (target.material_type !== "non_consumable") {
      setFormError("Maintenance applies only to equipment and other non-consumable materials.");
      return;
    }
    if (!maintenanceRequestForm.condition.trim() || !maintenanceRequestForm.maintenance_date || !maintenanceRequestForm.maintenance_type.trim()) {
      setFormError("Enter the equipment condition, maintenance date, and maintenance type.");
      return;
    }
    if (maintenanceRequestForm.next_due_at && maintenanceRequestForm.next_due_at < maintenanceRequestForm.maintenance_date) {
      setFormError("The next maintenance due date cannot be earlier than the maintenance date.");
      return;
    }
    if (Number(maintenanceRequestForm.cost || 0) < 0) {
      setFormError("Maintenance cost cannot be negative.");
      return;
    }

    setBusy(true);
    setFormError("");
    const rpcName = directAdmin ? "create_maintenance_record_admin" : "submit_maintenance_request";
    const { error } = await supabase.rpc(rpcName, {
      material_id_param: target.id,
      condition_param: maintenanceRequestForm.condition.trim(),
      maintenance_date_param: maintenanceRequestForm.maintenance_date,
      next_due_param: maintenanceRequestForm.next_due_at || null,
      maintenance_type_param: maintenanceRequestForm.maintenance_type.trim(),
      service_provider_param: maintenanceRequestForm.service_provider.trim() || null,
      technician_param: maintenanceRequestForm.technician.trim() || null,
      cost_param: Number(maintenanceRequestForm.cost || 0),
      notes_param: maintenanceRequestForm.notes.trim() || null,
      admin_note_param: directAdmin ? "Added directly by administrator" : null,
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    setAppMessage(directAdmin ? "Maintenance record added and the equipment schedule was updated." : "Maintenance request submitted for administrator approval.");
    setTab("maintenance");
    loadData();
  }

  async function approveMaintenanceRequest(request) {
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("approve_maintenance_request", {
      request_id_param: request.id,
      admin_note_param: reviewNote.trim() || "Approved by admin",
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    setAppMessage("Maintenance request approved and the equipment schedule was updated.");
    loadData();
  }

  async function rejectMaintenanceRequest(request) {
    if (!reviewNote.trim()) {
      setFormError("Enter a reason before rejecting the maintenance request.");
      return;
    }
    setBusy(true);
    setFormError("");
    const { error } = await supabase.rpc("reject_maintenance_request", {
      request_id_param: request.id,
      admin_note_param: reviewNote.trim(),
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    setAppMessage("Maintenance request rejected.");
    loadData();
  }

  async function submitCultureLog() {
    const cultureName = cultureForm.culture_name.trim();
    if (!cultureName) {
      setFormError("Enter the fungi or bacteria culture name.");
      return;
    }
    if (!cultureForm.stored_at || !cultureForm.ready_at) {
      setFormError("Choose both the storage date and expected ready date.");
      return;
    }
    if (cultureForm.ready_at < cultureForm.stored_at) {
      setFormError("The expected ready date cannot be earlier than the storage date.");
      return;
    }

    setBusy(true);
    setFormError("");
    const now = new Date().toISOString();
    const { error } = await supabase.from("culture_logs").insert({
      dept: VIPM_DEPARTMENT,
      organism_type: cultureForm.organism_type === "bacteria" ? "bacteria" : "fungi",
      culture_name: cultureName,
      strain: cultureForm.strain.trim() || null,
      stored_at: cultureForm.stored_at,
      ready_at: cultureForm.ready_at,
      status: "incubating",
      storage_location: cultureForm.storage_location.trim() || null,
      notes: cultureForm.notes.trim() || null,
      recorded_by: session.user.id,
      recorded_by_name: displayName,
      created_at: now,
      updated_at: now,
    });
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    closeModal();
    setAppMessage(`${cultureForm.organism_type === "bacteria" ? "Bacteria" : "Fungi"} growth log added.`);
    loadData();
  }

  async function updateCultureStatus(culture, status) {
    setBusy(true);
    setFormError("");
    const { error } = await supabase
      .from("culture_logs")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", culture.id);
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    setAppMessage(`${culture.culture_name} marked as ${status}.`);
    loadData();
  }

  async function deleteCultureLog(culture) {
    if (!window.confirm(`Delete the culture log for "${culture.culture_name}"?`)) return;
    setBusy(true);
    setFormError("");
    const { error } = await supabase
      .from("culture_logs")
      .delete()
      .eq("id", culture.id);
    setBusy(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    setAppMessage("Culture log deleted.");
    loadData();
  }

  function printReport(title, rows) {
    if (!rows.length) {
      window.alert("No records loaded for this report. Try changing the department/filter or click Refresh current page.");
      return;
    }
    const headers = Object.keys(rows[0]);
    const tableHead = headers.map((h) => `<th>${htmlEscape(h)}</th>`).join("");
    const tableRows = rows.map((row) => `<tr>${headers.map((key) => `<td>${htmlEscape(row[key])}</td>`).join("")}</tr>`).join("");
    const win = window.open("", "_blank", "width=1100,height=750");
    if (!win) {
      window.alert("Popup blocked. Please allow popups for LabTrack to print reports.");
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${htmlEscape(title)}</title><style>
      body{font-family:Arial,sans-serif;margin:28px;color:#1E2A28;}
      h1{font-size:22px;margin:0 0 4px;} .meta{color:#5B6B66;font-size:12px;margin-bottom:18px;}
      table{border-collapse:collapse;width:100%;font-size:12px;} th,td{border:1px solid #D9DED4;padding:7px;text-align:left;vertical-align:top;} th{background:#F6F7F3;text-transform:uppercase;font-size:10px;}
      @media print{button{display:none;} body{margin:12mm;}}
    </style></head><body><button onclick="window.print()" style="margin-bottom:12px;padding:8px 12px">Print / Save PDF</button><h1>${htmlEscape(title)}</h1><div class="meta">Generated ${new Date().toLocaleString()} · Department: ${htmlEscape(reportDeptFilter)}</div><table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`);
    win.document.close();
    win.focus();
  }

  function reportRowsForType() {
    switch (reportType) {
      case "usage": return logsExportRows();
      case "borrowed": return overdueBorrows.map((b) => ({ department: b.dept, material: b.material_name, borrower: b.borrower_name, qty_remaining: Number(b.qty_borrowed || 0) - Number(b.qty_returned || 0), unit: b.unit, purpose: b.purpose || "", borrowed_at: b.borrowed_at, due_at: b.due_at || "", status: isBorrowOverdue(b) ? "overdue" : "active" }));
      case "maintenance": return maintenanceRows.map((m) => ({ department: m.dept, material: m.name, category: m.category, condition: m.condition || "Good", status: maintenanceLabel[maintenanceStatusOf(m)], last_maintenance_at: m.last_maintenance_at || "", maintenance_due_at: m.maintenance_due_at || "", note: m.maintenance_note || "" }));
      case "alerts": return notificationExportRows();
      case "restock": return restockExportRows();
      case "users": return userActivityExportRows();
      case "inventory":
      default: return materialExportRows();
    }
  }

  function printSelectedReport() {
    const label = { inventory: "Inventory Report", usage: "Usage Log Report", borrowed: "Overdue Borrowed Materials Report", maintenance: "Maintenance Report", alerts: "Alerts Report", restock: "Restock Report", users: "User Activity Report" }[reportType] || "LabTrack Report";
    printReport(`LabTrack ${label}`, reportRowsForType());
  }

  const materialExportRows = () => materials.map((m) => ({
    department: m.dept,
    name: m.name,
    category: m.category,
    designation: materialTypeLabel(m.material_type),
    quantity: m.qty,
    unit: m.unit,
    threshold: m.threshold,
    expires_at: m.expires_at || "",
    status: statusLabel[statusOf(m)],
    expiry_status: expiryLabel[expiryStatusOf(m)],
    supplier: m.supplier_name || "",
    price_per_unit: m.price_per_unit || 0,
    inventory_value: Number(m.qty || 0) * Number(m.price_per_unit || 0),
    hazard_level: m.hazard_level || "",
    ppe_required: m.ppe_required || "",
    storage_instruction: m.storage_instruction || "",
    handling_instruction: m.handling_instruction || "",
    disposal_instruction: m.disposal_instruction || "",
    incompatible_with: m.incompatible_with || "",
    compatibility_notes: m.compatibility_notes || "",
    condition: m.condition || "",
    last_maintenance_at: m.last_maintenance_at || "",
    maintenance_due_at: m.maintenance_due_at || "",
    maintenance_note: m.maintenance_note || "",
    updated: m.updated,
    material_responsible: m.material_responsible || "",
    approved_by: m.approved_by_name || ""
  }));

  const requestExportRows = () => requests.map((r) => ({
    department: r.dept,
    material: r.name,
    category: r.category,
    designation: materialTypeLabel(r.material_type),
    quantity: r.qty,
    unit: r.unit,
    threshold: r.threshold,
    expires_at: r.expires_at || "",
    purpose: r.purpose || "",
    supplier: r.supplier_name || "",
    price_per_unit: r.price_per_unit || 0,
    hazard_level: r.hazard_level || "",
    ppe_required: r.ppe_required || "",
    incompatible_with: r.incompatible_with || "",
    compatibility_notes: r.compatibility_notes || "",
    condition: r.condition || "",
    last_maintenance_at: r.last_maintenance_at || "",
    maintenance_due_at: r.maintenance_due_at || "",
    maintenance_note: r.maintenance_note || "",
    requested_by: r.requester_name,
    material_responsible: r.material_responsible || "",
    status: r.status,
    admin_note: r.admin_note || "",
    reviewer: r.reviewer_name || "",
    created_at: r.created_at
  }));

  const logsExportRows = () => logs.map((l) => ({
    timestamp: l.timestamp,
    department: l.dept,
    material: l.material_name,
    type: l.type,
    quantity: l.qty,
    detail: l.detail,
    user: l.user_name
  }));

  const accountsExportRows = () => accountApprovals.map((a) => ({
    email: a.email || "",
    full_name: a.full_name || "",
    department: a.dept || "",
    role: a.role,
    status: a.status,
    created_at: a.created_at,
    reviewer: a.reviewer_name || "",
    admin_note: a.admin_note || ""
  }));

  const forecastExportRows = () => filteredForecastRows.map((row) => ({
    priority: row.priority,
    department: row.dept,
    material: row.material_name,
    category: row.category || "",
    current_qty: row.current_qty,
    unit: row.unit,
    threshold: row.threshold,
    expires_at: row.expires_at || "",
    weekly_usage_avg: row.weekly_usage_avg,
    weeks_until_empty: row.weeks_until_empty,
    suggested_restock_qty: row.suggested_restock_qty,
    estimated_restock_cost: row.estimated_restock_cost || 0,
    supplier: row.supplier_name || "",
    hazard_level: row.hazard_level || "",
    reason: row.reason
  }));

  const restockExportRows = () => restockRequests.map((r) => ({
    status: r.status,
    department: r.dept,
    material: r.material_name,
    quantity: r.qty,
    unit: r.unit,
    estimated_cost: r.estimated_cost || 0,
    supplier: r.supplier_name || "",
    reason: r.reason,
    created_by: r.created_by_name || "",
    updated_by: r.updated_by_name || "",
    admin_note: r.admin_note || "",
    created_at: r.created_at,
    updated_at: r.updated_at
  }));

  const supplierExportRows = () => suppliers.map((s) => ({
    status: s.status || "pending",
    department: s.dept || "All departments",
    supplier: s.name,
    contact_person: s.contact_person || "",
    phone: s.phone || "",
    email: s.email || "",
    material_category: s.material_category || "",
    material_name: s.material_name || "",
    price_per_unit: s.price_per_unit || 0,
    unit: s.unit || "",
    submitted_by: s.submitted_by_name || "",
    reviewer: s.reviewer_name || "",
    review_note: s.review_note || "",
    notes: s.notes || ""
  }));

  const notificationExportRows = () => notifications.map((n) => ({
    severity: n.severity,
    department: n.dept || "All departments",
    title: n.title,
    detail: n.detail,
    kind: n.kind
  }));

  const userActivityExportRows = () => userActivityRows.map((u) => ({
    user: u.full_name || "",
    email: u.email || "",
    department: u.dept || "",
    requests: u.request_count || 0,
    usage_logs: u.usage_count || 0,
    borrowed: u.borrow_count || 0,
    returned: u.return_count || 0,
    active_borrows: u.active_borrows || 0,
    overdue_borrows: u.overdue_borrows || 0,
    last_activity_at: u.last_activity_at || ""
  }));

  const overdueExportRows = () => overdueBorrows.map((b) => ({
    department: b.dept,
    material: b.material_name,
    borrower: b.borrower_name,
    remaining_qty: Number(b.qty_borrowed || 0) - Number(b.qty_returned || 0),
    unit: b.unit,
    purpose: b.purpose || "",
    borrowed_at: b.borrowed_at,
    due_at: b.due_at || "",
    status: isBorrowOverdue(b) ? "overdue" : "active"
  }));

  const maintenanceExportRows = () => maintenanceRows.map((m) => ({
    department: m.dept,
    material: m.name,
    category: m.category || "",
    condition: m.condition || "Good",
    maintenance_status: maintenanceLabel[maintenanceStatusOf(m)],
    last_maintenance_at: m.last_maintenance_at || "",
    maintenance_due_at: m.maintenance_due_at || "",
    note: m.maintenance_note || ""
  }));

  function exportMaterialsCsv() { downloadRows(`labtrack-materials-${isAdmin ? deptTab : userDept}`, materialExportRows(), exportFormat); }
  function exportRequestsCsv() { downloadRows("labtrack-requests-current-page", requestExportRows(), exportFormat); }
  function exportLogsCsv() { downloadRows("labtrack-logs-current-page", logsExportRows(), exportFormat); }
  function exportAccountsCsv() { downloadRows("labtrack-accounts-current-page", accountsExportRows(), exportFormat); }
  function exportForecastCsv() { downloadRows("labtrack-restock-forecast", forecastExportRows(), exportFormat); }
  function exportRestockCsv() { downloadRows("labtrack-restock-requests", restockExportRows(), exportFormat); }
  function exportSuppliersCsv() { downloadRows("labtrack-suppliers", supplierExportRows(), exportFormat); }
  function exportNotificationsCsv() { downloadRows("labtrack-notifications", notificationExportRows(), exportFormat); }
  function exportUserActivityCsv() { downloadRows("labtrack-user-activity", userActivityExportRows(), exportFormat); }
  function exportOverdueCsv() { downloadRows("labtrack-overdue-borrows", overdueExportRows(), exportFormat); }
  function exportMaintenanceCsv() { downloadRows("labtrack-maintenance", maintenanceExportRows(), exportFormat); }

  return (
    <div className="lt-root" style={{ "--accent": accent, "--accent-soft": accentSoft }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');

        html, body, #root { width:100%; min-height:100%; scroll-behavior:smooth; }
        body { margin:0; overflow-x:hidden; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
        .lt-root {
          --paper:#F6F7F3; --paper-line:#E2E7DF; --ink:#1E2A28; --ink-soft:#5B6B66;
          --user-accent:#1F6F78; --user-accent-soft:#DCEEEF; --admin-accent:#6B3FA0; --admin-accent-soft:#EDE3F5;
          --ok:#3A8347; --warn:#C4762A; --crit:#B23A34; --card-bg:#FFFFFF; --border:#D9DED4;
          font-family:'Inter',sans-serif; color:var(--ink);
          background:linear-gradient(var(--paper-line) 1px, transparent 1px) 0 0 / 100% 28px, var(--paper);
          min-height:100dvh; width:100%; box-sizing:border-box;
        }
        .lt-root * { box-sizing:border-box; }
        .lt-mono { font-family:'JetBrains Mono',monospace; }
        .lt-note { font-size:13px; line-height:1.55; color:var(--ink-soft); background:var(--paper); border:1px solid var(--border); padding:14px; border-radius:4px; }
        .lt-note pre { white-space:pre-wrap; background:#fff; border:1px solid var(--border); padding:10px; border-radius:3px; color:var(--ink); }

        .lt-login-wrap { display:flex; align-items:center; justify-content:center; min-height:100dvh; padding:32px 16px; }
        .lt-login-card { width:100%; max-width:420px; background:var(--card-bg); border:1px solid var(--border); border-radius:6px; padding:32px; position:relative; box-shadow:0 18px 70px rgba(30,42,40,.08); }
        .lt-login-card::before { content:""; position:absolute; top:0; left:24px; right:24px; border-top:1px dashed var(--border); }
        .lt-brand { display:flex; align-items:center; gap:10px; margin-bottom:24px; }
        .lt-brand-mark { width:36px; height:36px; border-radius:50%; background:#1F6F78; display:flex; align-items:center; justify-content:center; color:#fff; flex:0 0 auto; }
        .lt-brand-name { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:20px; letter-spacing:-.02em; }
        .lt-brand-sub { font-size:12px; color:var(--ink-soft); margin-top:1px; }
        .lt-auth-switch { display:flex; border:1px solid var(--border); border-radius:4px; overflow:hidden; margin-bottom:16px; }
        .lt-auth-switch button { flex:1; padding:9px; background:#fff; border:none; font-size:13px; font-weight:700; color:var(--ink-soft); cursor:pointer; }
        .lt-auth-switch button.active { background:#1F6F78; color:#fff; }
        .lt-link-btn { width:100%; margin-top:10px; background:none; border:none; color:#1F6F78; font-weight:700; cursor:pointer; font-size:13px; }
        .lt-toolbar { display:flex; justify-content:flex-end; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
        .lt-field { margin-bottom:16px; }
        .lt-label { display:block; font-size:12px; font-weight:700; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
        .lt-input, .lt-select, .lt-textarea { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; font-family:'Inter',sans-serif; font-size:14px; color:var(--ink); background:rgba(255,255,255,.96); transition:border-color .25s ease, box-shadow .25s ease, transform .25s ease; }
        .lt-textarea { resize:vertical; min-height:72px; }
        .lt-field-help { margin-top:6px; color:var(--ink-soft); font-size:11.5px; line-height:1.45; }
        .lt-input:focus, .lt-select:focus, .lt-textarea:focus { outline:2px solid var(--accent, #1F6F78); outline-offset:1px; border-color:transparent; }
        .lt-error { font-size:12px; color:var(--crit); margin:-6px 0 12px; line-height:1.45; }
        .lt-success { font-size:12px; color:var(--ok); background:#EAF4E8; border:1px solid #C9DFC5; padding:9px 10px; border-radius:4px; margin-bottom:12px; line-height:1.45; }
        .lt-btn { border:none; border-radius:8px; font-family:'Inter',sans-serif; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; justify-content:center; transition:transform .32s cubic-bezier(.22,1,.36,1), box-shadow .32s cubic-bezier(.22,1,.36,1), filter .2s ease; will-change:transform; }
        .lt-btn:disabled { opacity:.6; cursor:not-allowed; }
        .lt-btn-primary { background:#1F6F78; color:#fff; padding:11px 16px; font-size:14px; width:100%; }
        .lt-btn-accent { background:var(--accent); color:#fff; padding:8px 12px; font-size:13px; }
        .lt-btn-danger { background:var(--crit); color:#fff; padding:8px 12px; font-size:13px; }
        .lt-btn-ghost { background:transparent; color:var(--ink-soft); border:1px solid var(--border); padding:8px 12px; font-size:13px; }
        .lt-btn-sm { padding:6px 10px; font-size:12px; }
        .lt-btn:hover { filter:brightness(.98); transform:translateY(-2px) scale(1.01); box-shadow:0 8px 22px rgba(30,42,40,.10); }
        .lt-btn:active { transform:translateY(0) scale(.98); box-shadow:none; }

        .lt-shell { display:flex; min-height:100dvh; width:100%; }
        .lt-mobile-nav-toggle, .lt-mobile-nav-scrim { display:none; }
        .lt-sidebar { width:220px; flex-shrink:0; border-right:1px solid var(--border); padding:20px 0 0; display:flex; flex-direction:column; position:sticky; top:0; height:100dvh; overflow:hidden; z-index:10; background:rgba(246,247,243,.96); backdrop-filter:blur(8px); }
        .lt-sidebar-brand { display:flex; align-items:center; gap:8px; padding:0 20px 20px; flex:0 0 auto; }
        .lt-sidebar-nav { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding-bottom:10px; overscroll-behavior:contain; scrollbar-width:thin; }
        .lt-sidebar-tab { display:flex; align-items:center; gap:10px; padding:10px 20px; font-size:13px; font-weight:700; color:var(--ink-soft); background:none; border:none; cursor:pointer; text-align:left; position:relative; width:100%; transition:background .28s ease, color .28s ease, transform .28s cubic-bezier(.22,1,.36,1); }
        .lt-sidebar-tab:hover { transform:translateX(3px); color:var(--ink); }
        .lt-sidebar-tab.active { color:var(--ink); background:var(--accent-soft); }
        .lt-sidebar-tab.active::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--accent); }
        .lt-badge { margin-left:auto; background:var(--crit); color:#fff; font-size:10px; font-weight:800; border-radius:8px; padding:1px 6px; }
        .lt-sidebar-foot { flex:0 0 auto; margin-top:0; padding:14px 20px max(14px, env(safe-area-inset-bottom)); border-top:1px solid var(--border); background:rgba(246,247,243,.98); box-shadow:0 -8px 18px rgba(30,42,40,.04); position:relative; z-index:2; }
        .lt-user-chip { font-size:12px; color:var(--ink-soft); margin-bottom:8px; line-height:1.4; overflow-wrap:anywhere; }
        .lt-user-chip strong { color:var(--ink); display:block; font-size:13px; }
        .lt-logout { width:100%; display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-soft); background:none; border:none; cursor:pointer; padding:7px 0; }
        .lt-main { flex:1; padding:24px 32px; min-width:0; overflow-x:hidden; scroll-behavior:smooth; scrollbar-gutter:stable; }
        .lt-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px; }
        .lt-h1 { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:clamp(20px, 2.5vw, 28px); letter-spacing:-.01em; }
        .lt-h1-sub { font-size:13px; color:var(--ink-soft); margin-top:2px; }

        .lt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr)); gap:14px; }
        .lt-card { background:rgba(255,255,255,.94); border:1px solid var(--border); border-radius:12px; display:flex; overflow:hidden; min-width:0; transition:transform .55s cubic-bezier(.22,1,.36,1), box-shadow .55s cubic-bezier(.22,1,.36,1), border-color .3s ease; }
        .lt-card:hover { transform:translateY(-4px); box-shadow:0 18px 44px rgba(30,42,40,.10); border-color:rgba(91,107,102,.32); }
        .lt-designation { width:max-content; margin-top:8px; padding:3px 8px; border-radius:999px; font-size:10px; font-weight:800; letter-spacing:.03em; text-transform:uppercase; }
        .lt-designation-consumable { background:#E7F4EA; color:#2F6F3A; border:1px solid #C8E2CD; }
        .lt-designation-durable { background:#E9EEF8; color:#3C568A; border:1px solid #CCD7EC; }
        .lt-card-bar { width:5px; flex-shrink:0; }
        .lt-card-bar-ok { background:var(--ok); }
        .lt-card-bar-warn { background:var(--warn); }
        .lt-card-bar-crit { background:repeating-linear-gradient(45deg,var(--crit),var(--crit) 4px,#1E2A28 4px,#1E2A28 8px); }
        .lt-card-body { padding:14px 14px 12px; flex:1; position:relative; min-width:0; }
        .lt-perforation { position:absolute; top:34px; left:14px; right:14px; border-top:1px dashed var(--border); }
        .lt-card-eyebrow { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-soft); font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .lt-card-name { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:14.5px; margin:14px 0 8px; line-height:1.25; min-height:36px; overflow-wrap:anywhere; }
        .lt-card-qty { font-family:'JetBrains Mono',monospace; font-weight:700; font-size:24px; overflow-wrap:anywhere; }
        .lt-card-unit { font-size:12px; font-weight:500; color:var(--ink-soft); }
        .lt-card-meta { display:flex; align-items:center; justify-content:space-between; margin-top:8px; font-size:11px; color:var(--ink-soft); flex-wrap:wrap; gap:4px; }
        .lt-status-pill { display:flex; align-items:center; gap:5px; font-weight:700; }
        .lt-dot { width:7px; height:7px; border-radius:50%; display:inline-block; flex:0 0 auto; }
        .lt-dot-ok { background:var(--ok); } .lt-dot-warn { background:var(--warn); } .lt-dot-crit { background:var(--crit); }
        .lt-card-approval { font-size:11px; color:var(--ink-soft); margin-top:8px; line-height:1.35; }
        .lt-mr-line { display:flex; align-items:center; gap:5px; color:var(--ink); padding:7px 8px; border:1px solid var(--paper-line); background:var(--paper); border-radius:4px; }
        .lt-card-actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
        .lt-add-card { border:1px dashed var(--border); border-radius:4px; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:6px; color:var(--ink-soft); background:rgba(255,255,255,.35); cursor:pointer; min-height:170px; font-size:13px; font-weight:700; }
        .lt-add-card:hover { border-color:var(--accent); color:var(--accent); background:#fff; }

        .lt-table-wrap { border:1px solid var(--border); border-radius:4px; overflow:auto; background:#fff; width:100%; }
        table.lt-table { width:100%; border-collapse:collapse; font-size:13px; min-width:760px; }
        .lt-table th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); background:var(--paper); padding:10px 14px; border-bottom:1px solid var(--border); }
        .lt-table td { padding:10px 14px; border-bottom:1px solid var(--paper-line); vertical-align:top; }
        .lt-table tr:last-child td { border-bottom:none; }
        .lt-tag { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; padding:2px 6px; border-radius:2px; white-space:nowrap; }
        .lt-tag-usage { background:var(--user-accent-soft); color:var(--user-accent); }
        .lt-tag-correction { background:#FBEBD9; color:var(--warn); }
        .lt-tag-add, .lt-tag-approved, .lt-tag-return, .lt-tag-ok, .lt-tag-received, .lt-tag-info { background:#E3EFE0; color:var(--ok); }
        .lt-tag-rejected, .lt-tag-deleted, .lt-tag-expired, .lt-tag-critical, .lt-tag-cancelled { background:#F8DFDD; color:var(--crit); }
        .lt-tag-pending, .lt-tag-borrow, .lt-tag-low, .lt-tag-high_usage, .lt-tag-expiring, .lt-tag-warning, .lt-tag-ordered, .lt-tag-restock, .lt-tag-transfer, .lt-tag-supplier { background:#FBEBD9; color:var(--warn); }
        .lt-tag-user { background:var(--user-accent-soft); color:var(--user-accent); }
        .lt-tag-admin { background:var(--admin-accent-soft); color:var(--admin-accent); }

        .lt-expiry { display:flex; align-items:center; gap:5px; margin-top:8px; font-size:11px; line-height:1.35; color:var(--ink-soft); }
        .lt-expiry-expiring { color:var(--warn); font-weight:700; }
        .lt-expiry-expired { color:var(--crit); font-weight:800; }
        .lt-search-wrap { flex:1; min-width:min(100%, 260px); margin-bottom:12px; }
        .lt-search-line { display:flex; align-items:center; gap:8px; background:#fff; border:1px solid var(--border); border-radius:4px; padding:0 10px; }
        .lt-search-input { width:100%; border:none; outline:none; padding:10px 0; font-family:'Inter',sans-serif; font-size:14px; color:var(--ink); background:transparent; }
        .lt-search-dept { margin-top:5px; font-size:11px; color:var(--ink-soft); }
        .lt-safety-box { margin-top:8px; padding:8px; background:var(--paper); border:1px solid var(--paper-line); border-radius:4px; font-size:11px; color:var(--ink-soft); line-height:1.35; display:grid; gap:3px; }
        .lt-safety-box div:first-child { display:flex; align-items:center; gap:5px; color:var(--ink); }
        .lt-maintenance { margin-top:8px; padding:8px; border:1px solid var(--paper-line); border-radius:4px; font-size:11px; line-height:1.35; color:var(--ink-soft); background:#fff; }
        .lt-maintenance-overdue { border-color:#F1B7B2; background:#FFF2F1; color:var(--crit); }
        .lt-maintenance-due { border-color:#EAC99D; background:#FFF7E8; color:var(--warn); }
        .lt-export-control { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .lt-export-select { width:auto; min-width:125px; padding:8px 10px; }
        .lt-alert-card { border-left:5px solid var(--border); }
        .lt-alert-critical { border-left-color:var(--crit); }
        .lt-alert-warning { border-left-color:var(--warn); }
        .lt-alert-info { border-left-color:var(--accent); }
        .lt-filter-row { display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; margin-bottom:12px; }
        .lt-filter-row > .lt-select { width:auto; min-width:220px; }

        .lt-chat-wrap { display:flex; flex-direction:column; height:min(560px, calc(100dvh - 160px)); min-height:380px; border:1px solid var(--border); border-radius:4px; background:#fff; min-width:0; }
        .lt-chat-scroll { flex:1; overflow-y:auto; padding:18px; display:flex; flex-direction:column; gap:10px; }
        .lt-bubble { max-width:min(70%, 560px); padding:9px 13px; border-radius:10px; font-size:13px; line-height:1.45; overflow-wrap:anywhere; }
        .lt-bubble-meta { font-size:10px; color:var(--ink-soft); margin-top:4px; }
        .lt-bubble-user { align-self:flex-end; background:var(--accent); color:#fff; border-bottom-right-radius:2px; }
        .lt-bubble-admin { align-self:flex-start; background:var(--paper); border:1px solid var(--border); border-bottom-left-radius:2px; }
        .lt-chat-row { display:flex; flex-direction:column; } .lt-chat-row.mine { align-items:flex-end; } .lt-chat-row.theirs { align-items:flex-start; }
        .lt-chat-input-bar { display:flex; gap:8px; padding:12px; border-top:1px solid var(--border); }
        .lt-chat-input-bar input { flex:1; min-width:0; }
        .lt-date-input-wrap { position:relative; width:100%; }
        .lt-date-input { padding-right:44px; }
        .lt-date-input::-webkit-calendar-picker-indicator { opacity:0; width:42px; height:100%; cursor:pointer; }
        .lt-date-icon { position:absolute; right:4px; top:50%; transform:translateY(-50%); width:36px; height:34px; display:grid; place-items:center; border:0; border-left:1px solid var(--paper-line); background:transparent; color:var(--accent); cursor:pointer; border-radius:0 4px 4px 0; }
        .lt-date-icon:hover { background:var(--accent-soft); }
        .lt-empty { color:var(--ink-soft); font-size:13px; padding:24px; text-align:center; }
        .lt-pagination { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:10px; font-size:12px; color:var(--ink-soft); }
        .lt-pagination-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .lt-page-count { font-weight:700; color:var(--ink); }
        .lt-error-box { font-size:13px; line-height:1.55; color:var(--crit); background:#F8DFDD; border:1px solid #E9B8B4; padding:14px; border-radius:4px; }

        .lt-stat-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:24px; }
        .lt-stat-card { background:rgba(255,255,255,.92); border:1px solid var(--border); border-radius:12px; padding:16px; transition:transform .45s cubic-bezier(.22,1,.36,1), box-shadow .45s cubic-bezier(.22,1,.36,1); }
        .lt-stat-card:hover { transform:translateY(-3px); box-shadow:0 14px 36px rgba(30,42,40,.09); }
        .lt-stat-num { font-family:'JetBrains Mono',monospace; font-size:26px; font-weight:700; }
        .lt-stat-label { font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin-top:4px; }
        .lt-section-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:15px; margin:24px 0 12px; }
        .lt-attn-row { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--paper-line); font-size:13px; gap:14px; flex-wrap:wrap; }
        .lt-attn-row:last-child { border-bottom:none; }
        .lt-subtabs { display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap; }
        .lt-subtab { padding:7px 12px; border-radius:18px; border:1px solid var(--border); background:#fff; font-size:12px; font-weight:700; color:var(--ink-soft); cursor:pointer; }
        .lt-subtab.active { background:var(--accent); border-color:var(--accent); color:#fff; }
        .lt-conv-layout { display:flex; gap:16px; min-width:0; }
        .lt-conv-list { border:1px solid var(--border); border-radius:4px; overflow:hidden; background:#fff; width:240px; flex-shrink:0; align-self:flex-start; }
        .lt-conv-item { width:100%; text-align:left; padding:12px 14px; border:none; background:#fff; border-bottom:1px solid var(--paper-line); cursor:pointer; }
        .lt-conv-item:last-child { border-bottom:none; }
        .lt-conv-item.active { background:var(--accent-soft); }
        .lt-conv-dept { font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .lt-conv-unread { min-width:20px; height:20px; padding:0 6px; display:inline-grid; place-items:center; border-radius:999px; background:var(--crit); color:#fff; font-size:10px; font-weight:800; }
        .lt-conv-preview { font-size:12px; color:var(--ink-soft); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .lt-request-list { display:grid; gap:12px; }
        .lt-request-card { background:rgba(255,255,255,.94); border:1px solid var(--border); border-radius:12px; padding:14px; display:grid; gap:8px; transition:transform .45s cubic-bezier(.22,1,.36,1), box-shadow .45s cubic-bezier(.22,1,.36,1); }
        .lt-request-card:hover { transform:translateY(-2px); box-shadow:0 12px 32px rgba(30,42,40,.08); }
        .lt-request-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .lt-request-title { font-family:'Space Grotesk',sans-serif; font-weight:700; }
        .lt-request-meta { font-size:12px; color:var(--ink-soft); line-height:1.45; }
        .lt-request-actions { display:flex; gap:8px; flex-wrap:wrap; }

        .lt-table-wrap, .lt-chat-wrap, .lt-conv-list, .lt-maintenance-form, .lt-note {
          transition:transform .48s cubic-bezier(.22,1,.36,1), box-shadow .48s cubic-bezier(.22,1,.36,1), border-color .28s ease;
          transform-origin:center;
        }
        .lt-table-wrap:hover, .lt-chat-wrap:hover, .lt-conv-list:hover, .lt-maintenance-form:hover, .lt-note:hover {
          transform:translateY(-2px) scale(1.003);
          box-shadow:0 16px 38px rgba(30,42,40,.075);
          border-color:rgba(91,107,102,.32);
        }

        .lt-culture-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr)); gap:14px; }
        .lt-culture-card {
          position:relative; overflow:hidden; background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(246,249,245,.94));
          border:1px solid var(--border); border-radius:16px; padding:16px; display:grid; gap:13px;
          transition:transform .5s cubic-bezier(.22,1,.36,1), box-shadow .5s cubic-bezier(.22,1,.36,1), border-color .3s ease;
        }
        .lt-culture-card::before { content:""; position:absolute; inset:0 auto 0 0; width:5px; background:var(--warn); }
        .lt-culture-ready::before { background:var(--ok); }
        .lt-culture-contaminated::before { background:var(--crit); }
        .lt-culture-completed::before { background:var(--accent); }
        .lt-culture-card:hover { transform:translateY(-5px) scale(1.008); box-shadow:0 20px 48px rgba(30,42,40,.11); border-color:rgba(91,107,102,.34); }
        .lt-culture-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .lt-culture-name { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:700; margin-top:4px; overflow-wrap:anywhere; }
        .lt-culture-timeline { display:grid; grid-template-columns:auto minmax(54px,1fr) auto; align-items:center; gap:10px; padding:11px; border-radius:10px; background:rgba(255,255,255,.78); border:1px solid var(--paper-line); }
        .lt-culture-timeline > div:not(.lt-culture-line) { display:grid; gap:2px; }
        .lt-culture-timeline span { font-size:9px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:var(--ink-soft); }
        .lt-culture-timeline strong { font-size:11px; white-space:nowrap; }
        .lt-culture-line { height:5px; border-radius:999px; background:var(--paper-line); overflow:hidden; }
        .lt-culture-line i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--accent),var(--ok)); transition:width .6s cubic-bezier(.22,1,.36,1); }
        .lt-culture-ready { display:flex; align-items:center; gap:7px; color:var(--ink); font-size:12px; }
        .lt-culture-details { display:grid; gap:5px; color:var(--ink-soft); font-size:12px; line-height:1.45; }
        .lt-culture-actions { display:flex; flex-wrap:wrap; gap:7px; padding-top:3px; border-top:1px dashed var(--border); }
        .lt-culture-filters { padding:12px; border:1px solid var(--border); border-radius:12px; background:rgba(255,255,255,.72); }
        .lt-culture-filters .lt-select { min-width:170px; }
        .lt-optional { text-transform:none; letter-spacing:0; font-weight:500; opacity:.8; }

        .lt-icon-btn { background:none; border:none; cursor:pointer; color:var(--ink-soft); display:flex; }
        .lt-modal-overlay {
          position:fixed; inset:0; z-index:50; padding:clamp(10px,2.2vw,24px);
          display:flex; align-items:center; justify-content:center; overflow:hidden;
          background:rgba(30,42,40,.52); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);
        }
        .lt-modal {
          box-sizing:border-box; width:min(100%,430px); max-height:calc(100dvh - clamp(20px,4.4vw,48px));
          display:flex; flex-direction:column; overflow:hidden;
          background:rgba(255,255,255,.985); border:1px solid rgba(91,107,102,.24); border-radius:18px;
          box-shadow:0 32px 90px rgba(30,42,40,.26); animation:lt-modal-in .38s cubic-bezier(.22,1,.36,1) both;
        }
        .lt-modal-wide { width:min(940px,100%); }
        .lt-modal * { box-sizing:border-box; min-width:0; }
        .lt-maintenance-form { border:1px solid var(--border); border-radius:12px; padding:14px 14px 0; margin:2px 0 16px; background:linear-gradient(180deg, rgba(237,243,251,.72), rgba(255,255,255,.95)); }
        .lt-maintenance-form-title { display:flex; align-items:center; gap:7px; font-family:'Space Grotesk',sans-serif; font-size:13px; font-weight:700; margin-bottom:6px; }
        @keyframes lt-modal-in { from { opacity:0; transform:translateY(18px) scale(.97); } to { opacity:1; transform:translateY(0) scale(1); } }
        .lt-modal-head {
          flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:14px;
          padding:14px 16px 14px 18px; border-bottom:1px solid var(--border);
          background:rgba(255,255,255,.96); font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:15px;
        }
        .lt-modal-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .lt-modal-close {
          flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; gap:7px;
          min-height:38px; padding:8px 12px; border:1px solid var(--border); border-radius:10px;
          background:#fff; color:var(--ink); font:700 12px 'Space Grotesk',sans-serif; cursor:pointer;
          transition:transform .25s cubic-bezier(.22,1,.36,1), box-shadow .25s ease, border-color .25s ease;
        }
        .lt-modal-close:hover { transform:translateY(-2px) scale(1.025); border-color:var(--accent); box-shadow:0 8px 20px rgba(30,42,40,.10); }
        .lt-modal-close:focus-visible { outline:3px solid var(--accent-soft); outline-offset:2px; }
        .lt-modal-body {
          flex:1 1 auto; min-height:0; width:100%; padding:18px;
          overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; scrollbar-gutter:stable;
        }
        .lt-modal-hint { font-size:12px; color:var(--ink-soft); margin:-8px 0 14px; line-height:1.45; }
        .lt-form-row { display:flex; gap:10px; }
        .lt-form-row > .lt-field { flex:1; min-width:0; }

        @media (prefers-reduced-motion: no-preference) {
          .lt-scroll-reveal {
            opacity:0;
            transform:translate3d(0, 20px, 0) scale(.992);
            filter:blur(5px);
            transition:
              opacity .7s cubic-bezier(.22,1,.36,1) var(--lt-reveal-delay, 0ms),
              transform .8s cubic-bezier(.22,1,.36,1) var(--lt-reveal-delay, 0ms),
              filter .65s ease var(--lt-reveal-delay, 0ms);
            will-change:opacity, transform, filter;
          }
          .lt-scroll-reveal.lt-reveal-visible {
            opacity:1;
            transform:translate3d(0, 0, 0) scale(1);
            filter:blur(0);
          }
          .lt-table tbody tr {
            transition:background .22s ease, transform .28s cubic-bezier(.22,1,.36,1);
          }
          .lt-table tbody tr:hover {
            background:rgba(31,111,120,.045);
            transform:translateX(2px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          html, body, #root { scroll-behavior:auto; }
          .lt-btn, .lt-card, .lt-stat-card, .lt-request-card, .lt-culture-card, .lt-table-wrap, .lt-chat-wrap, .lt-conv-list, .lt-maintenance-form, .lt-note, .lt-sidebar-tab { transition:none !important; }
        }

        .lt-card-clickable { cursor:pointer; outline:none; }
        .lt-card-clickable:hover,
        .lt-card-clickable:focus-visible { transform:translateY(-7px) scale(1.015); box-shadow:0 24px 58px rgba(30,42,40,.14); border-color:var(--accent); }
        .lt-card-clickable:focus-visible { box-shadow:0 0 0 3px var(--accent-soft), 0 24px 58px rgba(30,42,40,.14); }

        .lt-material-details { display:grid; gap:16px; width:100%; max-width:100%; overflow:hidden; }
        .lt-material-details-hero { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px; border:1px solid var(--border); border-radius:14px; background:linear-gradient(135deg,rgba(255,255,255,.98),var(--paper)); }
        .lt-material-details-name { font-family:'Space Grotesk',sans-serif; font-size:clamp(20px,4vw,28px); font-weight:800; line-height:1.15; margin-top:6px; overflow-wrap:anywhere; }
        .lt-material-details-sub { color:var(--ink-soft); font-size:12px; margin-top:5px; }
        .lt-material-details-stock { min-width:110px; padding:13px 15px; border-radius:12px; background:var(--accent); color:#fff; text-align:center; box-shadow:0 12px 28px rgba(30,42,40,.13); }
        .lt-material-details-stock span { display:block; font-family:'JetBrains Mono',monospace; font-size:25px; font-weight:800; }
        .lt-material-details-stock small { display:block; margin-top:3px; opacity:.88; }
        .lt-material-details-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; width:100%; max-width:100%; }
        .lt-material-detail-row { min-width:0; padding:11px 12px; border:1px solid var(--paper-line); border-radius:9px; background:rgba(255,255,255,.88); transition:transform .3s cubic-bezier(.22,1,.36,1), box-shadow .3s ease, border-color .3s ease; }
        .lt-material-detail-row:hover { transform:translateY(-2px) scale(1.008); border-color:var(--border); box-shadow:0 8px 20px rgba(30,42,40,.06); }
        .lt-material-detail-row span { display:block; color:var(--ink-soft); font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; margin-bottom:4px; }
        .lt-material-detail-row strong { display:block; font-size:12.5px; line-height:1.45; overflow-wrap:anywhere; }
        .lt-material-details-actions {
          position:sticky; bottom:-18px; z-index:3; display:flex; gap:8px; flex-wrap:wrap;
          margin:0 -18px -18px; padding:14px 18px 18px; border-top:1px solid var(--border);
          background:linear-gradient(180deg,rgba(255,255,255,.92),#fff 26%); box-shadow:0 -10px 24px rgba(30,42,40,.04);
        }
        .lt-details-close-btn { margin-left:auto; }

        .lt-table-wrap,
        .lt-chat-wrap,
        .lt-conv-list,
        .lt-maintenance-form,
        .lt-note,
        .lt-filter-row {
          transition:transform .45s cubic-bezier(.22,1,.36,1), box-shadow .45s cubic-bezier(.22,1,.36,1), border-color .3s ease;
          transform-origin:center top;
        }
        .lt-table-wrap:hover,
        .lt-chat-wrap:hover,
        .lt-conv-list:hover,
        .lt-maintenance-form:hover,
        .lt-note:hover {
          transform:translateY(-3px) scale(1.004);
          box-shadow:0 17px 40px rgba(30,42,40,.09);
          border-color:rgba(91,107,102,.34);
        }
        .lt-stat-card:hover { transform:translateY(-5px) scale(1.018); box-shadow:0 20px 46px rgba(30,42,40,.12); }
        .lt-request-card:hover { transform:translateY(-4px) scale(1.007); box-shadow:0 17px 40px rgba(30,42,40,.10); }
        .lt-add-card { transition:transform .42s cubic-bezier(.22,1,.36,1), box-shadow .42s ease, background .3s ease, border-color .3s ease; }
        .lt-add-card:hover { transform:translateY(-5px) scale(1.012); box-shadow:0 16px 38px rgba(30,42,40,.09); }
        .lt-subtab { transition:transform .3s cubic-bezier(.22,1,.36,1), box-shadow .3s ease, background .25s ease; }
        .lt-subtab:hover { transform:translateY(-2px) scale(1.025); box-shadow:0 8px 20px rgba(30,42,40,.08); }
        .lt-table tbody tr { transition:background .22s ease, transform .22s ease; }
        .lt-table tbody tr:hover { background:var(--paper); }
        .lt-date-icon { transition:transform .25s cubic-bezier(.22,1,.36,1), background .25s ease; }
        .lt-date-icon:hover { transform:translateY(-50%) scale(1.07); }

        /* Performance-focused motion: short, GPU-friendly transitions without blur jank. */
        .lt-btn, .lt-sidebar-tab, .lt-card, .lt-stat-card, .lt-request-card, .lt-culture-card,
        .lt-table-wrap, .lt-chat-wrap, .lt-conv-list, .lt-maintenance-form, .lt-note,
        .lt-add-card, .lt-subtab, .lt-material-detail-row, .lt-modal-close, .lt-date-icon {
          backface-visibility:hidden;
          -webkit-font-smoothing:antialiased;
        }
        .lt-card, .lt-stat-card, .lt-request-card, .lt-culture-card, .lt-table-wrap,
        .lt-chat-wrap, .lt-conv-list, .lt-maintenance-form, .lt-note, .lt-add-card {
          transition-duration:.26s;
          transition-timing-function:cubic-bezier(.2,.8,.2,1);
        }
        .lt-card:hover { transform:translate3d(0,-4px,0) scale(1.008); }
        .lt-card-clickable:hover, .lt-card-clickable:focus-visible { transform:translate3d(0,-5px,0) scale(1.01); }
        .lt-stat-card:hover { transform:translate3d(0,-4px,0) scale(1.01); }
        .lt-request-card:hover, .lt-culture-card:hover { transform:translate3d(0,-3px,0) scale(1.004); }
        .lt-table-wrap:hover, .lt-chat-wrap:hover, .lt-conv-list:hover, .lt-maintenance-form:hover, .lt-note:hover {
          transform:translate3d(0,-2px,0) scale(1.002);
        }
        @media (prefers-reduced-motion: no-preference) {
          .lt-scroll-reveal {
            filter:none;
            transform:translate3d(0,12px,0) scale(.996);
            transition:opacity .42s cubic-bezier(.2,.8,.2,1) var(--lt-reveal-delay,0ms), transform .46s cubic-bezier(.2,.8,.2,1) var(--lt-reveal-delay,0ms);
          }
          .lt-scroll-reveal.lt-reveal-visible { filter:none; will-change:auto; }
        }

        @media (max-width: 860px) {
          .lt-shell { flex-direction:column; }
          .lt-sidebar {
            width:100%; height:auto; max-height:none; position:sticky; top:0; z-index:30;
            display:flex; flex-direction:column; align-items:stretch; padding:8px 12px;
            overflow:hidden; border-right:none; border-bottom:1px solid var(--border);
            box-shadow:0 8px 24px rgba(30,42,40,.06);
          }
          .lt-sidebar.mobile-open { max-height:min(78dvh, 640px); box-shadow:0 18px 46px rgba(30,42,40,.16); }
          .lt-sidebar-brand { display:none; }
          .lt-mobile-nav-toggle {
            width:100%; min-height:48px; display:flex; align-items:center; justify-content:space-between; gap:12px;
            border:1px solid var(--border); border-radius:12px; padding:8px 11px; background:rgba(255,255,255,.96);
            color:var(--ink); cursor:pointer; font:inherit; text-align:left;
            box-shadow:0 5px 16px rgba(30,42,40,.06);
          }
          .lt-mobile-nav-toggle-main { min-width:0; display:flex; align-items:center; gap:10px; }
          .lt-mobile-nav-toggle-copy { min-width:0; display:flex; flex-direction:column; line-height:1.15; }
          .lt-mobile-nav-toggle-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
          .lt-mobile-nav-toggle-copy span { color:var(--ink-soft); font-size:10px; margin-top:3px; }
          .lt-mobile-nav-chevron { flex:0 0 auto; transition:transform .24s cubic-bezier(.2,.8,.2,1); }
          .lt-sidebar.mobile-open .lt-mobile-nav-chevron { transform:rotate(180deg); }
          .lt-sidebar-nav { display:none; min-width:0; padding:8px 0 4px; }
          .lt-sidebar.mobile-open .lt-sidebar-nav {
            display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px;
            max-height:calc(min(78dvh, 640px) - 126px); overflow-y:auto; overflow-x:hidden;
            overscroll-behavior:contain; scrollbar-width:thin;
          }
          .lt-sidebar-tab {
            min-width:0; min-height:44px; width:100%; padding:9px 10px; border:1px solid transparent;
            border-radius:10px; white-space:normal; line-height:1.2; background:rgba(255,255,255,.62);
          }
          .lt-sidebar-tab:hover { transform:translateY(-1px); border-color:var(--border); }
          .lt-sidebar-tab.active { border-color:color-mix(in srgb, var(--accent) 35%, var(--border)); box-shadow:0 6px 16px rgba(30,42,40,.08); }
          .lt-sidebar-tab.active::before { display:none; }
          .lt-sidebar-foot { display:none; }
          .lt-sidebar.mobile-open .lt-sidebar-foot {
            display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;
            padding:10px 2px 2px; border-top:1px solid var(--border); background:transparent; box-shadow:none;
          }
          .lt-sidebar.mobile-open .lt-user-chip { min-width:0; padding:0; }
          .lt-sidebar.mobile-open .lt-user-chip strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .lt-sidebar.mobile-open .lt-logout { flex:0 0 auto; margin:0; }
          .lt-mobile-nav-scrim {
            display:block; position:fixed; inset:0; z-index:19; border:0; padding:0;
            background:rgba(30,42,40,.24); backdrop-filter:blur(1px); cursor:pointer;
          }
          .lt-main { padding:18px; }
          .lt-conv-layout { flex-direction:column; }
          .lt-conv-list { width:100%; display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); }
          .lt-chat-wrap { height:calc(100dvh - 220px); min-height:360px; }
        }
        @media (max-width: 520px) {
          .lt-sidebar.mobile-open .lt-sidebar-nav { gap:5px; }
          .lt-sidebar-tab { padding:9px 8px; font-size:12px; }
          .lt-sidebar-tab .lt-badge { margin-left:auto; }
          .lt-login-card { padding:22px; }
          .lt-main { padding:14px; }
          .lt-form-row { flex-direction:column; gap:0; }
          .lt-card-actions, .lt-chat-input-bar { flex-direction:column; }
          .lt-chat-input-bar .lt-btn { width:100%; }
          .lt-bubble { max-width:92%; }
          .lt-modal-overlay { padding:8px; align-items:flex-end; }
          .lt-modal, .lt-modal-wide { width:100%; max-height:94dvh; border-radius:16px 16px 10px 10px; }
          .lt-modal-head { padding:12px 12px 12px 14px; }
          .lt-modal-close span { display:none; }
          .lt-modal-close { width:40px; min-height:40px; padding:0; }
          .lt-modal-body { padding:14px; }
          .lt-culture-timeline { grid-template-columns:1fr; }
          .lt-culture-line { width:100%; }
          .lt-culture-actions .lt-btn { flex:1 1 120px; }
          .lt-material-details-hero { align-items:flex-start; flex-direction:column; }
          .lt-material-details-stock { width:100%; }
          .lt-material-details-grid { grid-template-columns:1fr; }
          .lt-material-details-actions { bottom:-14px; margin:0 -14px -14px; padding:12px 14px 14px; }
          .lt-material-details-actions .lt-btn { flex:1 1 140px; }
          .lt-details-close-btn { margin-left:0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lt-card-clickable, .lt-material-detail-row, .lt-add-card, .lt-subtab, .lt-date-icon { transition:none !important; }
          .lt-card-clickable:hover, .lt-card-clickable:focus-visible, .lt-material-detail-row:hover, .lt-add-card:hover, .lt-subtab:hover { transform:none !important; }
        }
      `}</style>

      {!isSupabaseConfigured && <SetupNotice />}

      {isSupabaseConfigured && loading && (
        <div className="lt-login-wrap"><div className="lt-login-card"><div className="lt-empty">Loading LabTrack…</div></div></div>
      )}

      {isSupabaseConfigured && !loading && !session && (
        <div className="lt-login-wrap">
          <form
            className="lt-login-card"
            onSubmit={authMode === "signup" ? handleSignUp : handleSignIn}
          >
            <div className="lt-brand">
              <div className="lt-brand-mark"><FlaskConical size={18} /></div>
              <div>
                <div className="lt-brand-name">LabTrack</div>
                <div className="lt-brand-sub">Low-egress lab material monitoring</div>
              </div>
            </div>

            {(authMode === "login" || authMode === "signup") && (
              <div className="lt-auth-switch">
                <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setFormError(""); setAppMessage(""); }}>Log in</button>
                <button type="button" className={authMode === "signup" ? "active" : ""} onClick={() => { setAuthMode("signup"); setFormError(""); setAppMessage(""); }}>Create user</button>
              </div>
            )}

            {authMode === "signup" && (
              <>
                <div className="lt-field">
                  <label className="lt-label">Full name</label>
                  <input className="lt-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. J. Reyes" />
                </div>
                <div className="lt-field">
                  <label className="lt-label">Department</label>
                  <select className="lt-select" value={registerDept} onChange={(e) => setRegisterDept(e.target.value)}>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
              </>
            )}

            {(authMode === "login" || authMode === "signup") && (
              <div className="lt-field">
                <label className="lt-label">Email</label>
                <input className="lt-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />
              </div>
            )}

            {(authMode === "login" || authMode === "signup") && (
              <div className="lt-field">
                <label className="lt-label">Password</label>
                <input className="lt-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
              </div>
            )}

            {appMessage && <div className="lt-success">{appMessage}</div>}
            {formError && <div className="lt-error">{formError}</div>}
            <button className="lt-btn lt-btn-primary" disabled={busy}>
              {busy ? "Please wait…" : authMode === "signup" ? "Create account" : "Log in"}
            </button>


            <div className="lt-modal-hint" style={{ margin: "14px 0 0" }}>
              New accounts require admin approval. Admin accounts are assigned in Appwrite by changing the profile role to <strong>admin</strong> and status to <strong>approved</strong>.
            </div>
          </form>
        </div>
      )}

      {isSupabaseConfigured && !loading && session && profile && !accountApproved && (
        <AccountGate profile={profile} onLogout={handleLogout} />
      )}

      {isSupabaseConfigured && !loading && session && profile && accountApproved && (
        <div className="lt-shell">
          <div className={`lt-sidebar ${mobileNavOpen ? "mobile-open" : ""}`}>
            <button
              type="button"
              className="lt-mobile-nav-toggle"
              aria-expanded={mobileNavOpen}
              aria-controls="labtrack-section-navigation"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <span className="lt-mobile-nav-toggle-main">
                <Menu size={18} />
                <span className="lt-mobile-nav-toggle-copy">
                  <strong>{activeNavigationItem?.label || "Sections"}</strong>
                  <span>{mobileNavOpen ? "Tap to collapse navigation" : "Tap to open all sections"}</span>
                </span>
              </span>
              <ChevronDown className="lt-mobile-nav-chevron" size={18} />
            </button>
            <div className="lt-sidebar-brand">
              <FlaskConical size={16} color={isAdmin ? "var(--admin-accent)" : "var(--user-accent)"} />
              <span className="lt-brand-name" style={{ fontSize: 15 }}>LabTrack</span>
            </div>
            <nav id="labtrack-section-navigation" className="lt-sidebar-nav" aria-label="LabTrack sections">
              {navigationItems.map((item) => (
                <button key={item.key} className={`lt-sidebar-tab ${tab === item.key ? "active" : ""}`} onClick={() => switchTab(item.key)}>
                  <item.icon size={15} /> {item.label}
                  {item.badge > 0 && <span className="lt-badge">{item.badge}</span>}
                </button>
              ))}
            </nav>
            <div className="lt-sidebar-foot">
              <div className="lt-user-chip">
                <strong>{displayName}</strong>
                {isAdmin ? "Administrator · all departments" : userDept}
              </div>
              <button className="lt-logout" onClick={handleLogout}><LogOut size={13} /> Log out</button>
            </div>
          </div>
          {mobileNavOpen && <button type="button" className="lt-mobile-nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

          <div className="lt-main">
            {formError && <div className="lt-error" style={{ marginBottom: 12 }}>{formError}</div>}
            {appMessage && <div className="lt-success" style={{ marginBottom: 12 }}>{appMessage}</div>}
            <div className="lt-toolbar">
              <div className="lt-export-control">
                <span className="lt-request-meta">Export as</span>
                <select className="lt-select lt-export-select" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                  {EXPORT_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              {isAdmin && <button className="lt-btn lt-btn-ghost" disabled={busy} onClick={() => openModal("cleanup")}>Clear activity records</button>}
              <button className="lt-btn lt-btn-ghost" disabled={busy} onClick={loadData}>Refresh current page</button>
            </div>

            {!isAdmin && tab === "inventory" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">{userDept}</div>
                    <div className="lt-h1-sub">{deptMaterials.length} approved materials · {lowInDept} need attention</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="lt-btn lt-btn-ghost" onClick={exportMaterialsCsv}><Download size={14} /> Export</button>
                    <button className="lt-btn lt-btn-accent" onClick={() => openModal("supplier")}><Plus size={14} /> Suggest supplier</button>
                  </div>
                </div>
                <SearchBox
                  value={searchMaterials}
                  onChange={(value) => { setSearchMaterials(value); setMaterialsPage(0); }}
                  placeholder={`Search materials in ${userDept}...`}
                  deptLabel={userDept}
                />
                <div className="lt-grid">
                  {deptMaterials.map((material) => (
                    <MaterialCard
                      key={material.id}
                      material={material}
                      onView={(m) => openModal("materialDetails", m)}
                      onUse={(m) => openModal("use", m)}
                      onBorrow={(m) => openModal("borrow", m)}
                      onCorrect={(m) => openModal("correct", m)}
                    />
                  ))}
                  <button className="lt-add-card" onClick={() => openModal("request")}>
                    <Plus size={20} /> Request new material
                    <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 500 }}>Admin approval required</span>
                  </button>
                </div>
                <PaginationControls page={materialsPage} pageSize={MATERIALS_PAGE_SIZE} total={materialsTotal} onPage={setMaterialsPage} label="materials" />
                <BorrowList borrows={borrowRecords} onReturn={(borrow) => openModal("return", null, null, null, borrow)} />
              </>
            )}

            {!isAdmin && tab === "requests" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">My item requests</div>
                    <div className="lt-h1-sub">New materials appear in stock only after admin approval</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="lt-btn lt-btn-ghost" onClick={exportRequestsCsv}><Download size={14} /> Export</button>
                    <button className="lt-btn lt-btn-accent" onClick={() => openModal("request")}><Plus size={14} /> New request</button>
                  </div>
                </div>
                <SearchBox
                  value={searchRequests}
                  onChange={(value) => { setSearchRequests(value); setRequestsPage(0); }}
                  placeholder={`Search your ${userDept} requests...`}
                  deptLabel={userDept}
                />
                <div className="lt-request-list">
                  {userRequests.length === 0 && <div className="lt-table-wrap"><div className="lt-empty">No item requests yet.</div></div>}
                  {userRequests.map((request) => (
                    <div className="lt-request-card" key={request.id}>
                      <div className="lt-request-head">
                        <div>
                          <div className="lt-request-title">{request.name}</div>
                          <div className="lt-request-meta">{request.category} · {materialTypeLabel(request.material_type)} · {displayQty(request.qty)} {request.unit} · threshold {displayQty(request.threshold)} · expires {request.expires_at ? fmtDate(request.expires_at) : "not set"} · {fmtTime(request.created_at)}<br /><strong>Purpose:</strong> {request.purpose || "—"}</div>
                        </div>
                        <span className={`lt-tag lt-tag-${request.status}`}>{request.status}</span>
                      </div>
                      {request.status !== "pending" && (
                        <div className="lt-request-meta">
                          <strong>{request.status === "approved" ? "Approved" : "Rejected"} by:</strong> {request.reviewer_name || "Admin"}{request.reviewed_at ? ` · ${fmtTime(request.reviewed_at)}` : ""}
                        </div>
                      )}
                      {request.material_responsible && <div className="lt-request-meta"><strong>MR (Material Responsibility):</strong> {request.material_responsible}</div>}
                      {request.admin_note && <div className="lt-request-meta"><strong>Admin note:</strong> {request.admin_note}</div>}
                    </div>
                  ))}
                </div>
                <PaginationControls page={requestsPage} pageSize={REQUESTS_PAGE_SIZE} total={requestsTotal} onPage={setRequestsPage} label="requests" />
              </>
            )}

            {!isAdmin && tab === "maintenance" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Equipment maintenance</div>
                    <div className="lt-h1-sub">Request cleaning, calibration, inspection, or repair. An administrator must approve every submitted maintenance entry.</div>
                  </div>
                  <button className="lt-btn lt-btn-accent" disabled={!maintenanceRows.length} onClick={() => openModal("maintenanceRequest")}>
                    <Plus size={14} /> Request maintenance
                  </button>
                </div>
                <div className="lt-section-title">Maintainable equipment in {userDept}</div>
                <MaintenanceTable rows={maintenanceRows} onMaintenance={(material) => openModal("maintenanceRequest", material)} actionLabel="Request" />
                <div className="lt-section-title" style={{ marginTop: 22 }}>My maintenance requests</div>
                <MaintenanceRequestsTable rows={maintenanceRequests} />
              </>
            )}

            {!isAdmin && tab === "history" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Usage &amp; correction history</div>
                    <div className="lt-h1-sub">Every entry logged for {userDept}</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportLogsCsv}><Download size={14} /> Export</button>
                </div>
                <SearchBox
                  value={searchLogs}
                  onChange={(value) => { setSearchLogs(value); setLogsPage(0); }}
                  placeholder={`Search logs in ${userDept}...`}
                  deptLabel={userDept}
                />
                <ActivityTable logs={logs} />
                <PaginationControls page={logsPage} pageSize={LOGS_PAGE_SIZE} total={logsTotal} onPage={setLogsPage} label="logs" />
              </>
            )}

            {!isAdmin && tab === "support" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Support chat</div>
                    <div className="lt-h1-sub">Talk to the admin team about {userDept} · unread messages appear as a badge</div>
                  </div>
                  {browserNotificationPermission !== "granted" && browserNotificationPermission !== "unsupported" && (
                    <button className="lt-btn lt-btn-ghost" onClick={enableChatNotifications}><Bell size={14} /> Enable notifications</button>
                  )}
                </div>
                <ChatPanel
                  messages={deptChats}
                  currentRole="user"
                  input={chatInput}
                  setInput={setChatInput}
                  onSend={sendChat}
                  emptyText="No messages yet — send a note about supplies, delays, or safety concerns."
                  placeholder="Write a message to admin…"
                />
              </>
            )}

            {isAdmin && tab === "overview" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Overview</div>
                    <div className="lt-h1-sub">Loads only the data needed for this page</div>
                  </div>
                </div>
                <div className="lt-stat-row">
                  <div className="lt-stat-card"><div className="lt-stat-num">{dashboardSummary?.total_materials ?? materialsTotal}</div><div className="lt-stat-label">Approved materials</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num" style={{ color: "var(--warn)" }}>{dashboardSummary?.low_stock ?? 0}</div><div className="lt-stat-label">Low stock</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num" style={{ color: "var(--crit)" }}>{dashboardSummary?.expired_materials ?? 0}</div><div className="lt-stat-label">Expired</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num" style={{ color: "var(--warn)" }}>{dashboardSummary?.expiring_soon ?? 0}</div><div className="lt-stat-label">Expiring soon</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num" style={{ color: "var(--crit)" }}>{pendingRequestsTotal}</div><div className="lt-stat-label">Pending material requests</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num" style={{ color: "var(--crit)" }}>{pendingAccountsTotal}</div><div className="lt-stat-label">Pending accounts</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">{dashboardSummary?.active_borrows ?? 0}</div><div className="lt-stat-label">Active borrows</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num" style={{ color: "var(--crit)" }}>{overdueBorrowCount}</div><div className="lt-stat-label">Overdue borrows</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num" style={{ color: maintenanceDueCount > 0 ? "var(--warn)" : undefined }}>{maintenanceDueCount}</div><div className="lt-stat-label">Maintenance due</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">₱{displayQty(dashboardSummary?.total_inventory_value ?? 0)}</div><div className="lt-stat-label">Inventory value</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">₱{displayQty(dashboardSummary?.monthly_usage_cost ?? 0)}</div><div className="lt-stat-label">Est. monthly usage cost</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">{dashboardSummary?.open_restock_requests ?? 0}</div><div className="lt-stat-label">Open restock requests</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">{dashboardSummary?.supplier_count ?? 0}</div><div className="lt-stat-label">Suppliers</div></div>
                </div>

                <div className="lt-section-title">Notification center</div>
                <NotificationList rows={notifications.slice(0, 6)} />
                <div style={{ marginTop: 12 }}>
                  <button className="lt-btn lt-btn-ghost" onClick={() => switchTab("alerts")}><Bell size={14} /> Open all alerts</button>
                </div>

                <div className="lt-section-title">Needs attention</div>
                <div className="lt-table-wrap">
                  {allAttention.length === 0 && <div className="lt-empty">Everything is above threshold.</div>}
                  {allAttention.map((material) => (
                    <div className="lt-attn-row" key={material.id}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StatusDot status={statusOf(material)} /> <strong>{material.name}</strong>
                        <span style={{ color: "var(--ink-soft)" }}>· {material.dept} · {expiryLabel[expiryStatusOf(material)]}</span>
                      </span>
                      <span className="lt-mono">{displayQty(material.qty)} {material.unit} <span style={{ color: "var(--ink-soft)" }}>/ {displayQty(material.threshold)} threshold · expires {material.expires_at ? fmtDate(material.expires_at) : "not set"}</span></span>
                    </div>
                  ))}
                </div>

                <div className="lt-section-title">Predictive restocking suggestions</div>
                <ForecastTable rows={topForecastRows} onCreateRestock={createRestockFromForecast} />
                <div style={{ marginTop: 12 }}>
                  <button className="lt-btn lt-btn-accent" onClick={() => switchTab("forecast")}><TrendingUp size={14} /> Open full forecast</button>
                </div>
              </>
            )}

            {isAdmin && tab === "approvals" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Material approvals</div>
                    <div className="lt-h1-sub">Approve before an item becomes part of the official stock list</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportRequestsCsv}><Download size={14} /> Export</button>
                </div>
                <div className="lt-filter-row">
                  <SearchBox
                    value={searchRequests}
                    onChange={(value) => { setSearchRequests(value); setRequestsPage(0); }}
                    placeholder="Search requests by material, requester, purpose, or note..."
                    deptLabel={requestDeptFilter === "All" ? "All departments" : requestDeptFilter}
                  />
                  <select className="lt-select" value={requestDeptFilter} onChange={(e) => { setRequestDeptFilter(e.target.value); setRequestsPage(0); }}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <div className="lt-request-list">
                  {requests.length === 0 && <div className="lt-table-wrap"><div className="lt-empty">No item requests yet.</div></div>}
                  {requests.map((request) => (
                    <div className="lt-request-card" key={request.id}>
                      <div className="lt-request-head">
                        <div>
                          <div className="lt-request-title">{request.name}</div>
                          <div className="lt-request-meta">
                            {request.dept} · {request.category} · {materialTypeLabel(request.material_type)} · {displayQty(request.qty)} {request.unit} · threshold {displayQty(request.threshold)} · expires {request.expires_at ? fmtDate(request.expires_at) : "not set"}
                            <br />Requested by {request.requester_name} · {fmtTime(request.created_at)}
                            <br /><strong>Purpose:</strong> {request.purpose || "—"}
                          </div>
                        </div>
                        <span className={`lt-tag lt-tag-${request.status}`}>{request.status}</span>
                      </div>
                      {request.status !== "pending" && (
                        <div className="lt-request-meta">
                          <strong>{request.status === "approved" ? "Approved" : "Rejected"} by:</strong> {request.reviewer_name || "Admin"}{request.reviewed_at ? ` · ${fmtTime(request.reviewed_at)}` : ""}
                        </div>
                      )}
                      {request.material_responsible && <div className="lt-request-meta"><strong>MR (Material Responsibility):</strong> {request.material_responsible}</div>}
                      {request.admin_note && <div className="lt-request-meta"><strong>Admin note:</strong> {request.admin_note}</div>}
                      {request.status === "pending" && (
                        <div className="lt-request-actions">
                          <button className="lt-btn lt-btn-accent" onClick={() => openModal("approve", null, request)}>Approve</button>
                          <button className="lt-btn lt-btn-danger" onClick={() => openModal("reject", null, request)}>Reject</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <PaginationControls page={requestsPage} pageSize={REQUESTS_PAGE_SIZE} total={requestsTotal} onPage={setRequestsPage} label="requests" />
              </>
            )}

            {isAdmin && tab === "accounts" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Account approvals</div>
                    <div className="lt-h1-sub">Approve, reject, or permanently delete user accounts</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportAccountsCsv}><Download size={14} /> Export</button>
                </div>
                <div className="lt-filter-row">
                  <SearchBox
                    value={searchAccounts}
                    onChange={(value) => { setSearchAccounts(value); setAccountsPage(0); }}
                    placeholder="Search accounts by name, email, role, status..."
                    deptLabel={accountDeptFilter === "All" ? "All departments" : accountDeptFilter}
                  />
                  <select className="lt-select" value={accountDeptFilter} onChange={(e) => { setAccountDeptFilter(e.target.value); setAccountsPage(0); }}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <div className="lt-request-list">
                  {accountApprovals.length === 0 && <div className="lt-table-wrap"><div className="lt-empty">No account requests yet.</div></div>}
                  {accountApprovals.map((account) => (
                    <div className="lt-request-card" key={account.id}>
                      <div className="lt-request-head">
                        <div>
                          <div className="lt-request-title">{account.full_name || "Unnamed account"}</div>
                          <div className="lt-request-meta">
                            {account.email ? `${account.email} · ` : ""}{account.dept || "No department"} · created {fmtTime(account.created_at)}
                            {account.reviewer_name && <><br />Reviewed by {account.reviewer_name} · {fmtTime(account.reviewed_at)}</>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <span className={`lt-tag lt-tag-${account.status}`}>{account.status}</span>
                          <span className={`lt-tag lt-tag-${account.role}`}>{account.role}</span>
                        </div>
                      </div>
                      {account.admin_note && <div className="lt-request-meta"><strong>Admin note:</strong> {account.admin_note}</div>}
                      {account.status === "pending" && (
                        <div className="lt-request-actions">
                          <button className="lt-btn lt-btn-accent" disabled={busy} onClick={() => approveAccount(account)}>Approve login</button>
                          <button className="lt-btn lt-btn-danger" disabled={busy} onClick={() => rejectAccount(account)}>Reject</button>
                        </div>
                      )}
                      {account.id !== session.user.id && (
                        <div className="lt-request-actions">
                          <button className="lt-btn lt-btn-danger" disabled={busy} onClick={() => openModal("deleteAccount", null, null, account)}>
                            <Trash2 size={13} /> Delete account
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <PaginationControls page={accountsPage} pageSize={ACCOUNTS_PAGE_SIZE} total={accountsTotal} onPage={setAccountsPage} label="accounts" />
              </>
            )}

            {isAdmin && tab === "departments" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Inventory management</div>
                    <div className="lt-h1-sub">View full records, log usage, borrow, correct, transfer, maintain, or remove approved materials</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="lt-btn lt-btn-accent" onClick={() => openModal("adminAddMaterial")}><Plus size={14} /> Add material</button>
                    <button className="lt-btn lt-btn-ghost" onClick={exportMaterialsCsv}><Download size={14} /> Export</button>
                  </div>
                </div>
                <div className="lt-subtabs">
                  {DEPARTMENTS.map((department) => (
                    <button key={department} className={`lt-subtab ${deptTab === department ? "active" : ""}`} onClick={() => setDeptTab(department)}>{department}</button>
                  ))}
                </div>
                <SearchBox
                  value={searchMaterials}
                  onChange={(value) => { setSearchMaterials(value); setMaterialsPage(0); }}
                  placeholder={`Search materials in ${deptTab}...`}
                  deptLabel={deptTab}
                />
                <div className="lt-grid">
                  {adminDeptMaterials.map((material) => (
                    <MaterialCard
                      key={material.id}
                      material={material}
                      showDept
                      onView={(m) => openModal("materialDetails", m)}
                      onUse={(m) => openModal("use", m)}
                      onBorrow={(m) => openModal("borrow", m)}
                      onCorrect={(m) => openModal("correct", m)}
                      onTransfer={(m) => openModal("transfer", m)}
                      onMaintenance={(m) => openModal("maintenance", m)}
                      onDelete={(m) => openModal("deleteMaterial", m)}
                    />
                  ))}
                  <button className="lt-add-card" onClick={() => openModal("adminAddMaterial")}>
                    <Plus size={20} /> Add approved material
                    <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 500 }}>Assign department and MR immediately</span>
                  </button>
                </div>
                <PaginationControls page={materialsPage} pageSize={MATERIALS_PAGE_SIZE} total={materialsTotal} onPage={setMaterialsPage} label="materials" />
                <BorrowList borrows={borrowRecords} onReturn={(borrow) => openModal("return", null, null, null, borrow)} />
              </>
            )}

            {isAdmin && tab === "forecast" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Weekly usage forecast</div>
                    <div className="lt-h1-sub">Predicts restocking based on the last {FORECAST_HISTORY_DAYS / 7} weeks of usage and borrowed materials</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportForecastCsv}><Download size={14} /> Export</button>
                </div>
                <div className="lt-filter-row">
                  <SearchBox
                    value={forecastSearch}
                    onChange={setForecastSearch}
                    placeholder="Search predictions by material, department, or reason..."
                    deptLabel={forecastDeptFilter === "All" ? "All departments" : forecastDeptFilter}
                  />
                  <select className="lt-select" value={forecastDeptFilter} onChange={(e) => setForecastDeptFilter(e.target.value)}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <div className="lt-note" style={{ marginBottom: 12 }}>
                  Suggested buy quantity uses average weekly usage from logs, current stock, reorder threshold, and expiry status.
                  It is a guide only — still verify lab schedules before purchasing.
                </div>
                <ForecastTable rows={filteredForecastRows} onCreateRestock={createRestockFromForecast} />
              </>
            )}

            {isAdmin && tab === "restockOrders" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Restock requests</div>
                    <div className="lt-h1-sub">Track predicted items from request to ordered to received</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportRestockCsv}><Download size={14} /> Export</button>
                </div>
                <div className="lt-filter-row">
                  <SearchBox
                    value={restockSearch}
                    onChange={setRestockSearch}
                    placeholder="Search restock requests by material, supplier, status, or reason..."
                    deptLabel={restockDeptFilter === "All" ? "All departments" : restockDeptFilter}
                  />
                  <select className="lt-select" value={restockDeptFilter} onChange={(e) => setRestockDeptFilter(e.target.value)}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <RestockRequestsTable rows={restockRequests} onStatus={updateRestockStatus} />
              </>
            )}

            {isAdmin && tab === "suppliers" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Supplier approvals and cost list</div>
                    <div className="lt-h1-sub">Supplier suggestions stay pending until an admin approves them</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="lt-btn lt-btn-ghost" onClick={exportSuppliersCsv}><Download size={14} /> Export</button>
                    <button className="lt-btn lt-btn-accent" onClick={() => openModal("supplier")}><Plus size={14} /> Add supplier</button>
                  </div>
                </div>
                <div className="lt-filter-row">
                  <SearchBox
                    value={supplierSearch}
                    onChange={setSupplierSearch}
                    placeholder="Search supplier, contact, material, category, or email..."
                    deptLabel={supplierDeptFilter === "All" ? "All departments" : supplierDeptFilter}
                  />
                  <select className="lt-select" value={supplierDeptFilter} onChange={(e) => setSupplierDeptFilter(e.target.value)}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                  <select className="lt-select" value={supplierStatusFilter} onChange={(e) => setSupplierStatusFilter(e.target.value)}>
                    <option value="pending">Pending approval</option>
                    <option value="approved">Approved suppliers</option>
                    <option value="rejected">Rejected suppliers</option>
                    <option value="All">All statuses</option>
                  </select>
                </div>
                <SuppliersTable rows={suppliers} onDelete={deleteSupplier} onReview={reviewSupplier} />
              </>
            )}

            {isAdmin && tab === "alerts" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Notification center</div>
                    <div className="lt-h1-sub">Low stock, expired materials, pending approvals, restock actions, and safety alerts</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportNotificationsCsv}><Download size={14} /> Export</button>
                </div>
                <div className="lt-filter-row">
                  <select className="lt-select" value={notificationDeptFilter} onChange={(e) => setNotificationDeptFilter(e.target.value)}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <NotificationList rows={notifications} />
              </>
            )}

            {isAdmin && tab === "userActivity" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">User activity report</div>
                    <div className="lt-h1-sub">Requests, usage, borrows, returns, active items, and overdue items per user</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportUserActivityCsv}><Download size={14} /> Export</button>
                </div>
                <div className="lt-filter-row">
                  <SearchBox
                    value={userActivitySearch}
                    onChange={setUserActivitySearch}
                    placeholder="Search by user, email, or department..."
                    deptLabel={userActivityDeptFilter === "All" ? "All departments" : userActivityDeptFilter}
                  />
                  <select className="lt-select" value={userActivityDeptFilter} onChange={(e) => setUserActivityDeptFilter(e.target.value)}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <UserActivityTable rows={userActivityRows} />
              </>
            )}

            {isAdmin && tab === "overdue" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Overdue borrowed materials</div>
                    <div className="lt-h1-sub">Borrowed materials that passed their due date and still need to be returned</div>
                  </div>
                  <button className="lt-btn lt-btn-ghost" onClick={exportOverdueCsv}><Download size={14} /> Export</button>
                </div>
                <div className="lt-filter-row">
                  <select className="lt-select" value={overdueDeptFilter} onChange={(e) => setOverdueDeptFilter(e.target.value)}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <OverdueBorrowsTable rows={overdueBorrows} onReturn={(borrow) => openModal("return", null, null, null, borrow)} />
              </>
            )}

            {isAdmin && tab === "maintenance" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Equipment maintenance</div>
                    <div className="lt-h1-sub">Add maintenance records directly or approve department maintenance requests</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="lt-btn lt-btn-ghost" onClick={exportMaintenanceCsv}><Download size={14} /> Export equipment</button>
                    <button className="lt-btn lt-btn-accent" disabled={!maintenanceRows.length} onClick={() => openModal("maintenanceAdmin")}>
                      <Plus size={14} /> Add maintenance record
                    </button>
                  </div>
                </div>
                <div className="lt-filter-row">
                  <SearchBox
                    value={maintenanceSearch}
                    onChange={setMaintenanceSearch}
                    placeholder="Search equipment/material, category, condition, or note..."
                    deptLabel={maintenanceDeptFilter === "All" ? "All departments" : maintenanceDeptFilter}
                  />
                  <select className="lt-select" value={maintenanceDeptFilter} onChange={(e) => setMaintenanceDeptFilter(e.target.value)}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <div className="lt-section-title">Pending and reviewed maintenance requests</div>
                <MaintenanceRequestsTable
                  rows={maintenanceRequests}
                  isAdmin
                  onApprove={(request) => openModal("approveMaintenance", null, null, null, null, null, request)}
                  onReject={(request) => openModal("rejectMaintenance", null, null, null, null, null, request)}
                />
                <div className="lt-section-title" style={{ marginTop: 22 }}>Current equipment maintenance schedule</div>
                <MaintenanceTable rows={maintenanceRows} onMaintenance={(m) => openModal("maintenance", m)} />
              </>
            )}

            {(isAdmin || userDept === VIPM_DEPARTMENT) && tab === "cultureLogs" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">VIPM fungi &amp; bacteria growth monitor</div>
                    <div className="lt-h1-sub">Track stored cultures, expected readiness, location, progress, and contamination status</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="lt-btn lt-btn-ghost"
                      onClick={() => downloadRows(
                        "vipm-culture-logs",
                        filteredCultureLogs.map((culture) => ({
                          Type: culture.organism_type,
                          Culture: culture.culture_name,
                          Strain: culture.strain || "",
                          Stored: culture.stored_at || "",
                          Ready: culture.ready_at || "",
                          Status: cultureStatusOf(culture),
                          Location: culture.storage_location || "",
                          Notes: culture.notes || "",
                          "Recorded by": culture.recorded_by_name || "",
                        })),
                        exportFormat
                      )}
                    >
                      <Download size={14} /> Export
                    </button>
                    <button className="lt-btn lt-btn-accent" onClick={() => openModal("culture")}>
                      <Plus size={14} /> Add growth log
                    </button>
                  </div>
                </div>

                <div className="lt-note lt-culture-summary" style={{ marginBottom: 12 }}>
                  This monitor uses one compact Appwrite collection for both fungi and bacteria. Readiness is calculated from the expected ready date, while completed and contaminated records keep their manually assigned status.
                </div>

                <div className="lt-stat-row">
                  <div className="lt-stat-card"><div className="lt-stat-num">{cultureSummary.total}</div><div className="lt-stat-label">Total cultures</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">{cultureSummary.fungi}</div><div className="lt-stat-label">Fungi logs</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">{cultureSummary.bacteria}</div><div className="lt-stat-label">Bacteria logs</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">{cultureSummary.ready}</div><div className="lt-stat-label">Ready now</div></div>
                </div>

                <div className="lt-filter-row lt-culture-filters">
                  <div className="lt-search-line" style={{ flex: 1, minWidth: 220 }}>
                    <Search size={14} />
                    <input
                      className="lt-search-input"
                      value={cultureSearch}
                      onChange={(e) => setCultureSearch(e.target.value)}
                      placeholder="Search culture, strain, location, or notes..."
                    />
                  </div>
                  <select className="lt-select" value={cultureTypeFilter} onChange={(e) => setCultureTypeFilter(e.target.value)}>
                    <option value="All">All culture types</option>
                    {CULTURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select className="lt-select" value={cultureStatusFilter} onChange={(e) => setCultureStatusFilter(e.target.value)}>
                    <option value="All">All statuses</option>
                    {CULTURE_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>

                <CultureLogGrid
                  rows={filteredCultureLogs}
                  onStatus={updateCultureStatus}
                  onDelete={deleteCultureLog}
                />
              </>
            )}

            {isAdmin && tab === "reports" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Print-ready reports</div>
                    <div className="lt-h1-sub">Generate clean reports that can be printed or saved as PDF from your browser</div>
                  </div>
                  <button className="lt-btn lt-btn-accent" onClick={printSelectedReport}><FileSpreadsheet size={14} /> Print / Save PDF</button>
                </div>
                <div className="lt-note" style={{ marginBottom: 12 }}>
                  Reports use the records currently loaded for the selected report type. Choose a department, refresh the page, then print. This keeps Appwrite reads low.
                </div>
                <div className="lt-filter-row">
                  <select className="lt-select" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                    <option value="inventory">Inventory report</option>
                    <option value="usage">Usage log report</option>
                    <option value="borrowed">Overdue borrowed materials report</option>
                    <option value="maintenance">Maintenance report</option>
                    <option value="alerts">Alerts report</option>
                    <option value="restock">Restock report</option>
                    <option value="users">User activity report</option>
                  </select>
                  <select className="lt-select" value={reportDeptFilter} onChange={(e) => { const v = e.target.value; setReportDeptFilter(v); setDeptTab(v === "All" ? deptTab : v); setLogsFilter(v); setOverdueDeptFilter(v); setMaintenanceDeptFilter(v); setUserActivityDeptFilter(v); setNotificationDeptFilter(v); }}>
                    <option value="All">All departments</option>
                    {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                </div>
                <div className="lt-stat-row">
                  <div className="lt-stat-card"><div className="lt-stat-num">{reportRowsForType().length}</div><div className="lt-stat-label">Rows ready to print</div></div>
                  <div className="lt-stat-card"><div className="lt-stat-num">{reportDeptFilter}</div><div className="lt-stat-label">Department filter</div></div>
                </div>
              </>
            )}

            {isAdmin && tab === "logs" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Activity log</div>
                    <div className="lt-h1-sub">Audit trail paginated at 10 logs per page to reduce Supabase egress</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button className="lt-btn lt-btn-ghost" onClick={exportLogsCsv}><Download size={14} /> Export</button>
                    <select className="lt-select" style={{ width: "auto" }} value={logsFilter} onChange={(e) => { setLogsFilter(e.target.value); setLogsPage(0); }}>
                      <option value="All">All departments</option>
                      {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
                    </select>
                  </div>
                </div>
                <SearchBox
                  value={searchLogs}
                  onChange={(value) => { setSearchLogs(value); setLogsPage(0); }}
                  placeholder="Search logs by material, user, type, or note..."
                  deptLabel={logsFilter === "All" ? "All departments" : logsFilter}
                />
                <ActivityTable
                  logs={logs}
                  includeDept
                  onDelete={(log) => openModal("deleteLog", null, null, null, null, log)}
                />
                <PaginationControls page={logsPage} pageSize={LOGS_PAGE_SIZE} total={logsTotal} onPage={setLogsPage} label="logs" />
              </>
            )}

            {isAdmin && tab === "support" && (
              <>
                <div className="lt-header">
                  <div>
                    <div className="lt-h1">Support inbox</div>
                    <div className="lt-h1-sub">Conversations from every department · {totalUnreadChats} unread</div>
                  </div>
                  {browserNotificationPermission !== "granted" && browserNotificationPermission !== "unsupported" && (
                    <button className="lt-btn lt-btn-ghost" onClick={enableChatNotifications}><Bell size={14} /> Enable notifications</button>
                  )}
                </div>
                <div className="lt-conv-layout">
                  <div className="lt-conv-list">
                    {DEPARTMENTS.map((department) => {
                      const last = lastMsgByDept(department);
                      return (
                        <button key={department} className={`lt-conv-item ${adminActiveDept === department ? "active" : ""}`} onClick={() => setAdminActiveDept(department)}>
                          <div className="lt-conv-dept">
                            <span>{department}</span>
                            {unreadChatByDept[department] > 0 && <span className="lt-conv-unread">{unreadChatByDept[department]}</span>}
                          </div>
                          <div className="lt-conv-preview">{last ? last.text : "No messages yet"}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ChatPanel
                      messages={adminChatDept}
                      currentRole="admin"
                      input={chatInput}
                      setInput={setChatInput}
                      onSend={sendChat}
                      emptyText="No messages from this department yet."
                      placeholder={`Reply to ${adminActiveDept}…`}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modalMode === "materialDetails" && activeMaterial && (
        <Modal title={`Material details — ${activeMaterial.name}`} onClose={closeModal} wide>
          <MaterialDetails material={activeMaterial} />
          <div className="lt-material-details-actions">
            <button className="lt-btn lt-btn-accent" onClick={() => openModal("use", activeMaterial)}>
              Log usage
            </button>
            <button className="lt-btn lt-btn-ghost" onClick={() => openModal("borrow", activeMaterial)}>
              <PackageOpen size={14} /> Borrow
            </button>
            <button className="lt-btn lt-btn-ghost" onClick={() => openModal("correct", activeMaterial)}>
              <Pencil size={14} /> Correct count
            </button>
            {isAdmin && (
              <button className="lt-btn lt-btn-ghost" onClick={() => openModal("transfer", activeMaterial)}>
                <ArrowRightLeft size={14} /> Transfer
              </button>
            )}
            {isAdmin && activeMaterial.material_type === "non_consumable" && (
              <button className="lt-btn lt-btn-ghost" onClick={() => openModal("maintenance", activeMaterial)}>
                <CalendarClock size={14} /> Maintenance
              </button>
            )}
            <button className="lt-btn lt-btn-ghost lt-details-close-btn" type="button" onClick={closeModal}>
              <X size={14} /> Exit details
            </button>
          </div>
        </Modal>
      )}

      {modalMode === "culture" && (
        <Modal title="Add fungi or bacteria growth log" onClose={closeModal}>
          <div className="lt-note" style={{ marginBottom: 14 }}>
            VIPM monitoring record. Use the expected ready date to track incubation progress and update the status when the culture is ready, completed, or contaminated.
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Culture type</label>
              <select className="lt-select" value={cultureForm.organism_type} onChange={(e) => setCultureForm({ ...cultureForm, organism_type: e.target.value })}>
                {CULTURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="lt-field">
              <label className="lt-label">Culture name</label>
              <input
                className="lt-input"
                maxLength={255}
                value={cultureForm.culture_name}
                onChange={(e) => setCultureForm({ ...cultureForm, culture_name: e.target.value })}
                placeholder={cultureForm.organism_type === "bacteria" ? "e.g. Bacillus isolate" : "e.g. Trichoderma culture"}
              />
            </div>
          </div>
          <div className="lt-field">
            <label className="lt-label">Strain / isolate code <span className="lt-optional">(optional)</span></label>
            <input className="lt-input" maxLength={255} value={cultureForm.strain} onChange={(e) => setCultureForm({ ...cultureForm, strain: e.target.value })} placeholder="Batch, strain, or isolate identifier" />
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Date stored</label>
              <DateInput value={cultureForm.stored_at} onChange={(e) => setCultureForm({ ...cultureForm, stored_at: e.target.value })} ariaLabel="Choose date stored" />
            </div>
            <div className="lt-field">
              <label className="lt-label">Expected ready date</label>
              <DateInput value={cultureForm.ready_at} min={cultureForm.stored_at || undefined} onChange={(e) => setCultureForm({ ...cultureForm, ready_at: e.target.value })} ariaLabel="Choose expected ready date" />
            </div>
          </div>
          <div className="lt-field">
            <label className="lt-label">Storage / incubation location</label>
            <input className="lt-input" maxLength={255} value={cultureForm.storage_location} onChange={(e) => setCultureForm({ ...cultureForm, storage_location: e.target.value })} placeholder="e.g. Incubator A, Shelf 2" />
          </div>
          <div className="lt-field">
            <label className="lt-label">Growth notes <span className="lt-optional">(optional)</span></label>
            <textarea className="lt-textarea" maxLength={750} value={cultureForm.notes} onChange={(e) => setCultureForm({ ...cultureForm, notes: e.target.value })} placeholder="Medium, temperature, appearance, handling notes, or observations" />
            <div className="lt-modal-hint">{cultureForm.notes.length}/750 characters</div>
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-accent" style={{ width: "100%", padding: "11px 16px" }} disabled={busy} onClick={submitCultureLog}>
            {busy ? "Saving…" : "Save growth log"}
          </button>
        </Modal>
      )}

      {modalMode === "cleanup" && (
        <Modal title="Clear activity records" onClose={closeModal}>
          <div className="lt-error-box">
            This permanently deletes the selected activity records. Material approval cleanup removes approved/rejected request history and its matching activity logs. Pending requests and approved inventory materials are never deleted.
          </div>
          <div className="lt-field" style={{ marginTop: 14 }}>
            <label className="lt-label">What do you want to clear?</label>
            <select className="lt-select" value={clearForm.target} onChange={(e) => setClearForm({ ...clearForm, target: e.target.value })}>
              {CLEAR_TARGET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {clearForm.target === "approval_logs" && (
              <div className="lt-modal-hint" style={{ margin: "8px 0 0" }}>
                Deletes the approved/rejected cards from Material approvals together with their matching activity logs. Pending requests and approved inventory materials are preserved.
              </div>
            )}
          </div>
          <div className="lt-field">
            <label className="lt-label">Date range</label>
            <select className="lt-select" value={clearForm.period} onChange={(e) => setClearForm({ ...clearForm, period: e.target.value })}>
              {CLEAR_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="lt-modal-hint" style={{ margin: "8px 0 0" }}>
              {CLEAR_PERIOD_OPTIONS.find((option) => option.value === clearForm.period)?.hint}
            </div>
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-danger" style={{ width: "100%", padding: "11px 16px" }} disabled={busy} onClick={clearSelectedActivity}>
            {busy ? "Clearing…" : "Clear selected records"}
          </button>
        </Modal>
      )}

      {modalMode === "supplier" && (
        <Modal title={isAdmin ? "Add supplier for approval" : "Suggest supplier"} onClose={closeModal}>
          <div className="lt-field">
            <label className="lt-label">Department scope</label>
            <select className="lt-select" value={supplierForm.dept} onChange={(e) => setSupplierForm({ ...supplierForm, dept: e.target.value })}>
              <option value="All">All departments</option>
              {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </div>
          <div className="lt-field"><label className="lt-label">Supplier name</label><input className="lt-input" maxLength={255} value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} /></div>
          <div className="lt-form-row">
            <div className="lt-field"><label className="lt-label">Contact person</label><input className="lt-input" maxLength={255} value={supplierForm.contact_person} onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })} /></div>
            <div className="lt-field"><label className="lt-label">Phone</label><input className="lt-input" maxLength={80} value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} /></div>
          </div>
          <div className="lt-field"><label className="lt-label">Email</label><input className="lt-input" type="email" maxLength={320} value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} /></div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Category</label>
              <select className="lt-select" value={supplierForm.material_category} onChange={(e) => setSupplierForm({ ...supplierForm, material_category: e.target.value })}>
                <option value="">Any category</option>
                {MATERIAL_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div className="lt-field"><label className="lt-label">Material name</label><input className="lt-input" maxLength={255} value={supplierForm.material_name} onChange={(e) => setSupplierForm({ ...supplierForm, material_name: e.target.value })} placeholder="Optional" /></div>
          </div>
          <div className="lt-form-row">
            <div className="lt-field"><label className="lt-label">Price per unit</label><input className="lt-input" type="number" min="0" step="0.01" value={supplierForm.price_per_unit} onChange={(e) => setSupplierForm({ ...supplierForm, price_per_unit: e.target.value })} /></div>
            <div className="lt-field"><label className="lt-label">Unit</label><input className="lt-input" maxLength={80} value={supplierForm.unit} onChange={(e) => setSupplierForm({ ...supplierForm, unit: e.target.value })} placeholder="mL, g, pcs" /></div>
          </div>
          <div className="lt-field"><label className="lt-label">Notes</label><textarea className="lt-textarea" maxLength={5000} value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} /></div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={submitSupplier}>{busy ? "Sending…" : "Submit for admin approval"}</button>
        </Modal>
      )}

      {modalMode === "transfer" && activeMaterial && (
        <Modal title={`Transfer stock — ${activeMaterial.name}`} onClose={closeModal}>
          <div className="lt-modal-hint">From {activeMaterial.dept}. Current stock: {displayQty(activeMaterial.qty)} {activeMaterial.unit}.</div>
          <div className="lt-field">
            <label className="lt-label">Receiving department</label>
            <select className="lt-select" value={transferForm.target_dept} onChange={(e) => setTransferForm({ ...transferForm, target_dept: e.target.value })}>
              {DEPARTMENTS.filter((department) => department !== activeMaterial.dept).map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </div>
          <div className="lt-field">
            <label className="lt-label">Quantity to transfer ({activeMaterial.unit})</label>
            <input className="lt-input" type="number" min="0" max={Number(activeMaterial.qty)} value={transferForm.qty} onChange={(e) => setTransferForm({ ...transferForm, qty: e.target.value })} />
          </div>
          <div className="lt-field">
            <label className="lt-label">Reason</label>
            <textarea className="lt-textarea" maxLength={5000} value={transferForm.reason} onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })} placeholder="Why is this stock being transferred?" />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={submitTransfer}>{busy ? "Transferring…" : "Transfer material"}</button>
        </Modal>
      )}

      {(modalMode === "request" || modalMode === "adminAddMaterial") && (
        <Modal title={modalMode === "adminAddMaterial" ? "Add approved material" : "Request a new material"} onClose={closeModal}>
          <div className="lt-modal-hint">
            {modalMode === "adminAddMaterial"
              ? "This administrator action adds the material directly to the selected department inventory. An MR assignment is required."
              : "This will go to the admin approval queue first. Assign the proposed MR now; the admin can confirm or change it during approval."}
          </div>
          {modalMode === "adminAddMaterial" && (
            <div className="lt-field">
              <label className="lt-label">Owning department</label>
              <select className="lt-select" value={requestForm.dept} onChange={(e) => setRequestForm({ ...requestForm, dept: e.target.value })}>
                {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </div>
          )}
          <div className="lt-field">
            <label className="lt-label">Material name</label>
            <input className="lt-input" maxLength={255} value={requestForm.name} onChange={(e) => setRequestForm({ ...requestForm, name: e.target.value })} placeholder="e.g. Acetone" />
          </div>
          <div className="lt-field">
            <label className="lt-label">MR — Material Responsibility</label>
            <input
              className="lt-input"
              maxLength={255}
              value={requestForm.material_responsible}
              onChange={(e) => setRequestForm({ ...requestForm, material_responsible: e.target.value })}
              placeholder="Full name of the person assigned responsibility for this material"
            />
            <div className="lt-field-help">Required for both user requests and direct admin additions. The approving admin may still confirm or change this assignment.</div>
          </div>
          <div className="lt-field">
            <label className="lt-label">Category</label>
            <select className="lt-select" value={requestForm.category} onChange={(e) => setRequestForm({ ...requestForm, category: e.target.value })}>
              {MATERIAL_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div className="lt-field">
            <label className="lt-label">Material designation</label>
            <select
              className="lt-select"
              value={requestForm.material_type}
              onChange={(e) => {
                const materialType = e.target.value;
                setRequestForm({
                  ...requestForm,
                  material_type: materialType,
                  condition: materialType === "non_consumable" ? (requestForm.condition || "Good") : "Good",
                  last_maintenance_at: materialType === "non_consumable" ? requestForm.last_maintenance_at : "",
                  maintenance_due_at: materialType === "non_consumable" ? requestForm.maintenance_due_at : "",
                  maintenance_note: materialType === "non_consumable" ? requestForm.maintenance_note : "",
                });
              }}
            >
              {MATERIAL_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <div className="lt-field-help">
              Consumables are depleted through use. Non-consumables are reusable assets that require condition and maintenance tracking.
            </div>
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Current quantity</label>
              <input className="lt-input" type="number" min="0" value={requestForm.qty} onChange={(e) => setRequestForm({ ...requestForm, qty: e.target.value })} />
            </div>
            <div className="lt-field">
              <label className="lt-label">Unit</label>
              <input className="lt-input" maxLength={80} value={requestForm.unit} onChange={(e) => setRequestForm({ ...requestForm, unit: e.target.value })} placeholder="mL, g, units…" />
            </div>
          </div>
          <div className="lt-field">
            <label className="lt-label">Reorder threshold</label>
            <input className="lt-input" type="number" min="0" value={requestForm.threshold} onChange={(e) => setRequestForm({ ...requestForm, threshold: e.target.value })} placeholder="Flag as low stock below this amount" />
          </div>
          <div className="lt-field">
            <label className="lt-label">Expiration date</label>
            <DateInput value={requestForm.expires_at} onChange={(e) => setRequestForm({ ...requestForm, expires_at: e.target.value })} ariaLabel="Choose expiry date" />
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Estimated price per unit</label>
              <input className="lt-input" type="number" min="0" step="0.01" value={requestForm.price_per_unit} onChange={(e) => setRequestForm({ ...requestForm, price_per_unit: e.target.value })} placeholder="₱0.00" />
            </div>
            <div className="lt-field">
              <label className="lt-label">Supplier name</label>
              <input className="lt-input" maxLength={255} value={requestForm.supplier_name} onChange={(e) => setRequestForm({ ...requestForm, supplier_name: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Hazard level</label>
              <select className="lt-select" value={requestForm.hazard_level} onChange={(e) => setRequestForm({ ...requestForm, hazard_level: e.target.value })}>
                {HAZARD_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </div>
            <div className="lt-field">
              <label className="lt-label">PPE required</label>
              <input className="lt-input" maxLength={500} value={requestForm.ppe_required} onChange={(e) => setRequestForm({ ...requestForm, ppe_required: e.target.value })} placeholder="Gloves, goggles, lab coat..." />
            </div>
          </div>
          <div className="lt-field">
            <label className="lt-label">Storage instruction</label>
            <input className="lt-input" maxLength={1000} value={requestForm.storage_instruction} onChange={(e) => setRequestForm({ ...requestForm, storage_instruction: e.target.value })} placeholder="e.g. Store in flammable cabinet" />
          </div>
          <div className="lt-field">
            <label className="lt-label">Handling instruction</label>
            <input className="lt-input" maxLength={1000} value={requestForm.handling_instruction} onChange={(e) => setRequestForm({ ...requestForm, handling_instruction: e.target.value })} placeholder="Optional safety handling note" />
          </div>
          <div className="lt-field">
            <label className="lt-label">Disposal instruction</label>
            <input className="lt-input" maxLength={1000} value={requestForm.disposal_instruction} onChange={(e) => setRequestForm({ ...requestForm, disposal_instruction: e.target.value })} placeholder="Optional disposal note" />
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Incompatible with</label>
              <input className="lt-input" maxLength={500} value={requestForm.incompatible_with} onChange={(e) => setRequestForm({ ...requestForm, incompatible_with: e.target.value })} placeholder="Acids, oxidizers, heat..." />
            </div>
            <div className="lt-field">
              <label className="lt-label">Compatibility warning</label>
              <input className="lt-input" maxLength={1000} value={requestForm.compatibility_notes} onChange={(e) => setRequestForm({ ...requestForm, compatibility_notes: e.target.value })} placeholder="Keep away from strong oxidizers..." />
            </div>
          </div>
          {requestForm.material_type === "non_consumable" && (
            <div className="lt-maintenance-form">
              <div className="lt-maintenance-form-title"><CalendarClock size={15} /> Maintenance details</div>
              <div className="lt-field-help" style={{ marginBottom: 12 }}>
                Required for reusable equipment and durable materials. Set the current condition and the next maintenance date.
              </div>
              <div className="lt-form-row">
                <div className="lt-field">
                  <label className="lt-label">Condition / status</label>
                  <input className="lt-input" maxLength={255} value={requestForm.condition} onChange={(e) => setRequestForm({ ...requestForm, condition: e.target.value })} placeholder="Good, needs inspection..." />
                </div>
                <div className="lt-field">
                  <label className="lt-label">Next maintenance due</label>
                  <DateInput value={requestForm.maintenance_due_at} onChange={(e) => setRequestForm({ ...requestForm, maintenance_due_at: e.target.value })} ariaLabel="Choose next maintenance date" />
                </div>
              </div>
              <div className="lt-form-row">
                <div className="lt-field">
                  <label className="lt-label">Last maintenance date</label>
                  <DateInput value={requestForm.last_maintenance_at} onChange={(e) => setRequestForm({ ...requestForm, last_maintenance_at: e.target.value })} ariaLabel="Choose last maintenance date" />
                </div>
                <div className="lt-field">
                  <label className="lt-label">Maintenance note</label>
                  <input className="lt-input" maxLength={1000} value={requestForm.maintenance_note} onChange={(e) => setRequestForm({ ...requestForm, maintenance_note: e.target.value })} placeholder="Calibration, cleaning, repair..." />
                </div>
              </div>
            </div>
          )}
          <div className="lt-field">
            <label className="lt-label">{modalMode === "adminAddMaterial" ? "Receiving / audit note" : "Purpose / reason for request"}</label>
            <textarea
              className="lt-textarea"
              maxLength={1000}
              value={requestForm.purpose}
              onChange={(e) => setRequestForm({ ...requestForm, purpose: e.target.value })}
              placeholder={modalMode === "adminAddMaterial" ? "Optional receiving note, source, or reason for direct addition" : "Why is this material needed?"}
            />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button
            className="lt-btn lt-btn-primary"
            disabled={busy}
            onClick={modalMode === "adminAddMaterial" ? submitAdminMaterial : submitItemRequest}
          >
            {busy
              ? (modalMode === "adminAddMaterial" ? "Adding…" : "Sending…")
              : (modalMode === "adminAddMaterial" ? "Add directly to inventory" : "Submit for approval")}
          </button>
        </Modal>
      )}

      {modalMode === "use" && activeMaterial && (
        <Modal title={`Log usage — ${activeMaterial.name}`} onClose={closeModal}>
          <div className="lt-modal-hint">Currently {displayQty(activeMaterial.qty)} {activeMaterial.unit} in stock.</div>
          <div className="lt-field">
            <label className="lt-label">Quantity used ({activeMaterial.unit})</label>
            <input className="lt-input" type="number" min="1" max={Number(activeMaterial.qty)} value={useForm.qty} onChange={(e) => setUseForm({ ...useForm, qty: e.target.value })} />
          </div>
          <div className="lt-field">
            <label className="lt-label">Purpose</label>
            <textarea className="lt-textarea" maxLength={5000} value={useForm.purpose} onChange={(e) => setUseForm({ ...useForm, purpose: e.target.value })} placeholder="What was it used for?" />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={submitUse}>{busy ? "Saving…" : "Log usage"}</button>
        </Modal>
      )}

      {modalMode === "borrow" && activeMaterial && (
        <Modal title={`Borrow — ${activeMaterial.name}`} onClose={closeModal}>
          <div className="lt-modal-hint">Currently {displayQty(activeMaterial.qty)} {activeMaterial.unit} in stock.</div>
          <div className="lt-field">
            <label className="lt-label">Quantity to borrow ({activeMaterial.unit})</label>
            <input className="lt-input" type="number" min="1" max={Number(activeMaterial.qty)} value={borrowForm.qty} onChange={(e) => setBorrowForm({ ...borrowForm, qty: e.target.value })} />
          </div>
          <div className="lt-field">
            <label className="lt-label">Due date for return</label>
            <DateInput value={borrowForm.due_at} onChange={(e) => setBorrowForm({ ...borrowForm, due_at: e.target.value })} ariaLabel="Choose return due date" />
          </div>
          <div className="lt-field">
            <label className="lt-label">Borrowing purpose</label>
            <textarea className="lt-textarea" maxLength={5000} value={borrowForm.purpose} onChange={(e) => setBorrowForm({ ...borrowForm, purpose: e.target.value })} placeholder="What experiment or activity needs this borrowed material?" />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={submitBorrow}>{busy ? "Saving…" : "Borrow material"}</button>
        </Modal>
      )}

      {modalMode === "return" && activeBorrow && (
        <Modal title={`Return — ${activeBorrow.material_name}`} onClose={closeModal}>
          <div className="lt-modal-hint">Remaining borrowed quantity: {displayQty(Number(activeBorrow.qty_borrowed || 0) - Number(activeBorrow.qty_returned || 0))} {activeBorrow.unit}</div>
          <div className="lt-field">
            <label className="lt-label">Quantity returned ({activeBorrow.unit})</label>
            <input className="lt-input" type="number" min="1" max={Number(activeBorrow.qty_borrowed || 0) - Number(activeBorrow.qty_returned || 0)} value={returnForm.qty} onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })} />
          </div>
          <div className="lt-field">
            <label className="lt-label">Return note</label>
            <textarea className="lt-textarea" maxLength={5000} value={returnForm.note} onChange={(e) => setReturnForm({ ...returnForm, note: e.target.value })} placeholder="Optional condition or note" />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={submitReturn}>{busy ? "Saving…" : "Return material"}</button>
        </Modal>
      )}

      {modalMode === "correct" && activeMaterial && (
        <Modal title={`Correct count — ${activeMaterial.name}`} onClose={closeModal}>
          <div className="lt-modal-hint">Recorded quantity is {displayQty(activeMaterial.qty)} {activeMaterial.unit}.</div>
          <div className="lt-field">
            <label className="lt-label">Actual quantity ({activeMaterial.unit})</label>
            <input className="lt-input" type="number" min="0" value={correctForm.qty} onChange={(e) => setCorrectForm({ ...correctForm, qty: e.target.value })} />
          </div>
          <div className="lt-field">
            <label className="lt-label">Reason for correction</label>
            <textarea className="lt-textarea" maxLength={5000} value={correctForm.reason} onChange={(e) => setCorrectForm({ ...correctForm, reason: e.target.value })} placeholder="e.g. Recount after audit, mislabeled box…" />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={submitCorrect}>{busy ? "Saving…" : "Save correction"}</button>
        </Modal>
      )}

      {(modalMode === "approve" || modalMode === "reject") && activeRequest && (
        <Modal title={`${modalMode === "approve" ? "Approve" : "Reject"} item request`} onClose={closeModal}>
          <div className="lt-modal-hint">
            <strong>{activeRequest.name}</strong><br />
            {activeRequest.dept} · {displayQty(activeRequest.qty)} {activeRequest.unit} · requested by {activeRequest.requester_name}
          </div>
          {modalMode === "approve" && (
            <div className="lt-field">
              <label className="lt-label">MR — Material Responsibility</label>
              <input className="lt-input" maxLength={255} value={materialResponsible} onChange={(e) => setMaterialResponsible(e.target.value)} placeholder="Full name of the person assigned material responsibility" />
              <div className="lt-field-help">Assign the person who holds responsibility for receiving, safekeeping, monitoring, and coordinating this material.</div>
            </div>
          )}
          <div className="lt-field">
            <label className="lt-label">{modalMode === "reject" ? "Rejection reason" : "Admin note"}</label>
            <textarea className="lt-textarea" maxLength={1000} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder={modalMode === "reject" ? "Required reason shown to the requester" : "Optional note shown to the requester"} />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          {modalMode === "approve" ? (
            <button className="lt-btn lt-btn-primary" disabled={busy} onClick={() => approveRequest(activeRequest)}>{busy ? "Approving…" : "Approve and add to stocks"}</button>
          ) : (
            <button className="lt-btn lt-btn-danger" style={{ width: "100%", padding: "11px 16px" }} disabled={busy} onClick={() => rejectRequest(activeRequest)}>{busy ? "Rejecting…" : "Reject request"}</button>
          )}
        </Modal>
      )}

      {(modalMode === "maintenanceRequest" || modalMode === "maintenanceAdmin") && (
        <Modal title={modalMode === "maintenanceAdmin" ? "Add equipment maintenance record" : "Request equipment maintenance"} onClose={closeModal}>
          <div className="lt-modal-hint">
            {modalMode === "maintenanceAdmin"
              ? "This administrator entry is applied immediately and does not require approval."
              : "Your department request stays pending until an administrator approves it."}
          </div>
          <div className="lt-field">
            <label className="lt-label">Equipment / non-consumable material</label>
            <select
              className="lt-select"
              value={maintenanceRequestForm.material_id}
              onChange={(e) => {
                const selected = maintenanceRows.find((row) => row.id === e.target.value);
                setMaintenanceRequestForm({
                  ...maintenanceRequestForm,
                  material_id: e.target.value,
                  condition: selected?.condition || maintenanceRequestForm.condition || "Good",
                  next_due_at: selected?.maintenance_due_at || maintenanceRequestForm.next_due_at,
                });
              }}
            >
              <option value="">Select equipment</option>
              {maintenanceRows.map((row) => <option key={row.id} value={row.id}>{row.name} — {row.dept}</option>)}
            </select>
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Maintenance type</label>
              <input className="lt-input" maxLength={255} value={maintenanceRequestForm.maintenance_type} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, maintenance_type: e.target.value })} placeholder="Preventive maintenance, calibration, repair..." />
            </div>
            <div className="lt-field">
              <label className="lt-label">Condition after / expected condition</label>
              <input className="lt-input" maxLength={255} value={maintenanceRequestForm.condition} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, condition: e.target.value })} placeholder="Good, repaired, needs inspection..." />
            </div>
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Maintenance date</label>
              <DateInput value={maintenanceRequestForm.maintenance_date} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, maintenance_date: e.target.value })} ariaLabel="Choose maintenance date" />
            </div>
            <div className="lt-field">
              <label className="lt-label">Next maintenance due <span className="lt-optional">(optional)</span></label>
              <DateInput value={maintenanceRequestForm.next_due_at} min={maintenanceRequestForm.maintenance_date || undefined} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, next_due_at: e.target.value })} ariaLabel="Choose next maintenance due date" />
            </div>
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Service provider <span className="lt-optional">(optional)</span></label>
              <input className="lt-input" maxLength={255} value={maintenanceRequestForm.service_provider} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, service_provider: e.target.value })} placeholder="Internal lab, service company..." />
            </div>
            <div className="lt-field">
              <label className="lt-label">Technician / person assigned <span className="lt-optional">(optional)</span></label>
              <input className="lt-input" maxLength={255} value={maintenanceRequestForm.technician} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, technician: e.target.value })} placeholder="Technician name" />
            </div>
          </div>
          <div className="lt-field">
            <label className="lt-label">Estimated / actual cost <span className="lt-optional">(optional)</span></label>
            <input className="lt-input" type="number" min="0" step="0.01" value={maintenanceRequestForm.cost} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, cost: e.target.value })} placeholder="₱0.00" />
          </div>
          <div className="lt-field">
            <label className="lt-label">Maintenance notes <span className="lt-optional">(optional)</span></label>
            <textarea className="lt-textarea" maxLength={1000} value={maintenanceRequestForm.notes} onChange={(e) => setMaintenanceRequestForm({ ...maintenanceRequestForm, notes: e.target.value })} placeholder="Problem observed, work required, parts replaced, calibration result..." />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={() => submitMaintenanceRequest(modalMode === "maintenanceAdmin")}>
            {busy ? "Saving…" : modalMode === "maintenanceAdmin" ? "Add maintenance record" : "Submit for admin approval"}
          </button>
        </Modal>
      )}

      {(modalMode === "approveMaintenance" || modalMode === "rejectMaintenance") && activeMaintenanceRequest && (
        <Modal title={`${modalMode === "approveMaintenance" ? "Approve" : "Reject"} maintenance request`} onClose={closeModal}>
          <div className="lt-modal-hint">
            <strong>{activeMaintenanceRequest.material_name}</strong><br />
            {activeMaintenanceRequest.dept} · {activeMaintenanceRequest.maintenance_type || "Maintenance"} · requested by {activeMaintenanceRequest.requester_name || "Unknown user"}
            <br />Maintenance date: {activeMaintenanceRequest.maintenance_date ? fmtDate(activeMaintenanceRequest.maintenance_date) : "Not set"}
          </div>
          <div className="lt-field">
            <label className="lt-label">{modalMode === "rejectMaintenance" ? "Rejection reason" : "Admin approval note"}</label>
            <textarea className="lt-textarea" maxLength={1000} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder={modalMode === "rejectMaintenance" ? "Required reason shown to the requester" : "Optional approval instruction or note"} />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          {modalMode === "approveMaintenance" ? (
            <button className="lt-btn lt-btn-primary" disabled={busy} onClick={() => approveMaintenanceRequest(activeMaintenanceRequest)}>{busy ? "Approving…" : "Approve and update equipment"}</button>
          ) : (
            <button className="lt-btn lt-btn-danger" style={{ width: "100%", padding: "11px 16px" }} disabled={busy} onClick={() => rejectMaintenanceRequest(activeMaintenanceRequest)}>{busy ? "Rejecting…" : "Reject maintenance request"}</button>
          )}
        </Modal>
      )}

      {modalMode === "maintenance" && activeMaterial && (
        <Modal title={`Maintenance — ${activeMaterial.name}`} onClose={closeModal}>
          <div className="lt-modal-hint">Update equipment/material condition and maintenance schedule.</div>
          <div className="lt-field">
            <label className="lt-label">Condition</label>
            <input className="lt-input" maxLength={255} value={maintenanceForm.condition} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, condition: e.target.value })} placeholder="Good, needs repair, for calibration..." />
          </div>
          <div className="lt-form-row">
            <div className="lt-field">
              <label className="lt-label">Last maintenance date</label>
              <DateInput value={maintenanceForm.last_maintenance_at} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, last_maintenance_at: e.target.value })} ariaLabel="Choose last maintenance date" />
            </div>
            <div className="lt-field">
              <label className="lt-label">Next maintenance due</label>
              <DateInput value={maintenanceForm.maintenance_due_at} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, maintenance_due_at: e.target.value })} ariaLabel="Choose next maintenance date" />
            </div>
          </div>
          <div className="lt-field">
            <label className="lt-label">Maintenance note</label>
            <textarea className="lt-textarea" maxLength={1000} value={maintenanceForm.maintenance_note} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, maintenance_note: e.target.value })} placeholder="Cleaning, calibration, repair notes..." />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-primary" disabled={busy} onClick={submitMaintenance}>{busy ? "Saving…" : "Save maintenance"}</button>
        </Modal>
      )}

      {modalMode === "deleteMaterial" && activeMaterial && (
        <Modal title="Delete material" onClose={closeModal}>
          <div className="lt-error-box">
            This will permanently remove <strong>{activeMaterial.name}</strong> from the materials list. The existing usage history will stay in Logs.
          </div>
          <div className="lt-field" style={{ marginTop: 14 }}>
            <label className="lt-label">Reason / note</label>
            <textarea className="lt-textarea" maxLength={1000} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Optional reason for deletion" />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-danger" style={{ width: "100%", padding: "11px 16px" }} disabled={busy} onClick={() => deleteMaterial(activeMaterial)}>
            {busy ? "Deleting…" : "Delete material"}
          </button>
        </Modal>
      )}

      {modalMode === "deleteLog" && activeLog && (
        <Modal title="Delete material log" onClose={closeModal}>
          <div className="lt-error-box">
            This will permanently delete the log for <strong>{activeLog.material_name}</strong> recorded on {fmtTime(activeLog.timestamp)}.
            This action cannot be undone.
          </div>
          <div className="lt-modal-hint" style={{ margin: "14px 0" }}>
            {activeLog.type} · {displayQty(activeLog.qty)} · {activeLog.detail || "No note"}
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-danger" style={{ width: "100%", padding: "11px 16px" }} disabled={busy} onClick={() => deleteLog(activeLog)}>
            {busy ? "Deleting…" : "Delete log permanently"}
          </button>
        </Modal>
      )}

      {modalMode === "deleteAccount" && activeAccount && (
        <Modal title="Delete account" onClose={closeModal}>
          <div className="lt-error-box">
            This will permanently delete <strong>{activeAccount.full_name || activeAccount.email || "this account"}</strong> from LabTrack. The old logs will remain for audit history.
          </div>
          <div className="lt-field" style={{ marginTop: 14 }}>
            <label className="lt-label">Reason / note</label>
            <textarea className="lt-textarea" maxLength={1000} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Optional reason for account deletion" />
          </div>
          {formError && <div className="lt-error">{formError}</div>}
          <button className="lt-btn lt-btn-danger" style={{ width: "100%", padding: "11px 16px" }} disabled={busy} onClick={() => deleteAccount(activeAccount)}>
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </Modal>
      )}
    </div>
  );
}
