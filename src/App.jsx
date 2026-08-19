import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Chart from 'chart.js/auto';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

import {
  CURRENCIES,
  DEFAULT_BASE_PRICES,
  DEFAULT_TRIP_TAGS,
  FUEL_LABELS,
  FUEL_TYPES,
  MAINT_TYPES,
  VEHICLE_COLORS,
} from './lib/constants.js';
import {
  computeRefuelWarnings,
  computeStats,
  fmt,
  formatDate,
  getCurrentOdometer,
  getVehicleRefuels,
  num,
  parseLocalDate,
  todayIso,
  uid,
} from './lib/stats.js';
import { getDueDate, getMaintenanceStatus, getNextDueItem } from './lib/maintenance.js';
import { parseFuelioCSV, toCSV } from './lib/csv.js';
import { estimateUsedBytes, onStorageError, readJSON, removeKey, writeJSON } from './lib/storage.js';
import { compressImage, formatBytes } from './lib/image.js';
import { buildBackup, sanitizeBackup } from './lib/backup.js';
import { UPDATE_EVENT, applyServiceWorkerUpdate } from './registerSW.js';

const DARK_COLORS = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceElevated: '#1C1C1E',
  accent: '#3B82F6',
  accentLight: '#60A5FA',
  success: '#30D158',
  danger: '#FF453A',
  dangerBg: '#FF453A1a',
  warning: '#E8A838',
  textPrimary: '#F5F5F3',
  textSecondary: '#8E8E93',
  textMuted: '#555558',
  border: '#2C2C2E',
  borderLight: '#1C1C1E',
  overlay: 'rgba(0,0,0,0.65)',
};

const LIGHT_COLORS = {
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceElevated: '#F2F2F7',
  accent: '#3B82F6',
  accentLight: '#60A5FA',
  success: '#34C759',
  danger: '#FF3B30',
  dangerBg: '#FF3B301a',
  warning: '#FF9500',
  textPrimary: '#1C1C1E',
  textSecondary: '#6C6C70',
  textMuted: '#AEAEB2',
  border: '#C6C6C8',
  borderLight: '#E5E5EA',
  overlay: 'rgba(0,0,0,0.4)',
};

// Mutable palette — mutated before each render via Object.assign inside App
let COLORS = { ...DARK_COLORS };

const SWIPE_CANCEL_THRESHOLD = 5; // px; rightward movement that cancels a swipe
const SKELETON_DURATION_MS = 200; // ms; how long to show skeleton on first render
const UNDO_TIMEOUT_MS = 6000;     // ms; how long a delete stays undoable
/**
 * Two-column layout that collapses to one when the columns would be too narrow.
 * Native date inputs have a ~170px intrinsic minimum and cannot shrink below it,
 * so a fixed `1fr 1fr` pair pushed the page sideways on small phones.
 */
const DATE_PAIR_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 };
const DRAFT_REFUEL_KEY = 'fuelpilot_draft_refuel';
/** Browsers allow roughly 5 MB of localStorage per origin. */
const STORAGE_BUDGET_BYTES = 5 * 1024 * 1024;
const APP_VERSION = __APP_VERSION__;

const TAB_ITEMS = [
  { key: 'refuel', icon: '⛽', label: 'Refuel' },
  { key: 'stats', icon: '📊', label: 'Stats' },
  { key: 'maintenance', icon: '🔧', label: 'Maint' },
  { key: 'settings', icon: '⚙', label: 'Settings' },
];

const TAB_KEYS = TAB_ITEMS.map((t) => t.key);
/** Tab position, used to pick the slide direction when switching. */
const TAB_INDEX = Object.fromEntries(TAB_ITEMS.map((t, i) => [t.key, i]));

const STATUS_COLOR_KEYS = { due: 'danger', upcoming: 'warning', ok: 'success' };

/** Maps a maintenance status key to the current palette colour. */
function statusColor(key) {
  return COLORS[STATUS_COLOR_KEYS[key] || 'success'];
}

/**
 * State mirrored into localStorage.
 *
 * Writes go through `writeJSON`, which reports a full quota instead of throwing
 * out of the effect and tearing down the tree.
 */
function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => readJSON(key, initialValue));

  useEffect(() => {
    writeJSON(key, state);
  }, [key, state]);

  return [state, setState];
}

/* ─── Reusable UI components ─── */

function Card({ children, style, glow }) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.borderLight}`,
        borderRadius: 16,
        padding: 16,
        transition: 'box-shadow 0.2s',
        boxShadow: glow ? `0 0 20px ${glow}33` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ icon, children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 700,
        fontSize: 15,
        marginBottom: 12,
      }}
    >
      {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: 0.8,
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
        marginBottom: 5,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

const inputClassName = 'fp-input';
const buttonClassName = 'fp-button';

function ensureGlobalStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('fp-global-styles')) return;
  const style = document.createElement('style');
  style.id = 'fp-global-styles';
  style.textContent = `
    .${inputClassName}:focus { border-color: ${COLORS.accent} !important; }
    /* Date and number inputs carry an intrinsic minimum width. As grid items
       their default min-width:auto refuses to shrink below it, which pushed the
       Stats tab into horizontal overflow on 320-360px phones. */
    .${inputClassName}, .fp-select { min-width: 0; }
    /* A grid/flex item will not shrink below its content unless told to. */
    div:has(> .${inputClassName}), div:has(> .fp-select) { min-width: 0; }
    .${buttonClassName}:active { transform: scale(0.97); }
    @keyframes fp-fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes fp-slide-up {
      from { opacity: 0; transform: translate(-50%, 8px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
    @keyframes fp-slide-right {
      from { opacity: 0; transform: translateX(24px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes fp-slide-left {
      from { opacity: 0; transform: translateX(-24px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes fp-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .fp-tab-content      { animation: fp-fadeIn    0.18s ease-out; }
    .fp-tab-enter-right  { animation: fp-slide-right 0.2s ease-out; }
    .fp-tab-enter-left   { animation: fp-slide-left  0.2s ease-out; }
  `;
  document.head.appendChild(style);
}

function Input({ style: extraStyle, ...props }) {
  ensureGlobalStyles();
  return (
    <input
      {...props}
      className={inputClassName}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${COLORS.border}`,
        background: COLORS.surfaceElevated,
        color: COLORS.textPrimary,
        borderRadius: 10,
        fontSize: 15,
        padding: '10px 12px',
        outline: 'none',
        transition: 'border-color 0.2s',
        ...extraStyle,
      }}
    />
  );
}

function Select({ children, style: extraStyle, ...props }) {
  ensureGlobalStyles();
  return (
    <select
      {...props}
      className="fp-select"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
        border: `1px solid ${COLORS.border}`,
        background: COLORS.surfaceElevated,
        color: COLORS.textPrimary,
        borderRadius: 10,
        fontSize: 15,
        padding: '10px 12px',
        outline: 'none',
        transition: 'border-color 0.2s',
        ...extraStyle,
      }}
    >
      {children}
    </select>
  );
}

function Button({ children, variant = 'primary', size = 'normal', style, ...props }) {
  ensureGlobalStyles();
  const palettes = {
    primary: { background: COLORS.accent, color: '#fff', border: COLORS.accent },
    secondary: { background: COLORS.surfaceElevated, color: COLORS.textPrimary, border: COLORS.border },
    danger: { background: COLORS.dangerBg, color: COLORS.danger, border: `${COLORS.danger}44` },
    success: { background: `${COLORS.success}1a`, color: COLORS.success, border: `${COLORS.success}44` },
    ghost: { background: 'transparent', color: COLORS.textSecondary, border: 'transparent' },
  };
  const palette = palettes[variant] || palettes.primary;
  const sizeStyles = size === 'small' ? { padding: '6px 10px', fontSize: 12 } : { padding: '10px 14px', fontSize: 14 };

  return (
    <button
      {...props}
      className={buttonClassName}
      style={{
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        borderRadius: 10,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'opacity 0.15s, transform 0.1s',
        ...sizeStyles,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function IconButton({ children, onClick, title, variant = 'ghost', style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: variant === 'danger' ? COLORS.dangerBg : 'transparent',
        border: 'none',
        color: variant === 'danger' ? COLORS.danger : COLORS.textSecondary,
        cursor: 'pointer',
        borderRadius: 8,
        padding: '6px 8px',
        fontSize: 16,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ color, label }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.3,
        color,
        background: `${color}22`,
        border: `1px solid ${color}55`,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

function FuelBadge({ fuelType }) {
  const fuelColors = { diesel: '#F59E0B', petrol: '#3B82F6', lpg: '#8B5CF6', ev: '#10B981' };
  const c = fuelColors[fuelType] || COLORS.textSecondary;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: c,
        background: `${c}22`,
        border: `1px solid ${c}44`,
        borderRadius: 6,
        padding: '2px 6px',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {FUEL_LABELS[fuelType] || fuelType}
    </span>
  );
}

function StatBox({ label, value, icon, accent, trend, sub }) {
  const c = accent || COLORS.accent;
  return (
    <div
      style={{
        background: `${c}0d`,
        border: `1px solid ${c}22`,
        borderRadius: 12,
        padding: '12px 10px',
        textAlign: 'center',
        // A grid item defaults to min-width:auto and refuses to shrink below its
        // content, which pushed the third summary tile off a 360px screen.
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {icon && <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>}
      <div style={{ fontSize: 17, fontWeight: 800, color: c, lineHeight: 1.25 }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 3 }}>{sub}</div>}
      {trend && (
        <div style={{ fontSize: 11, color: trend.color, marginTop: 5, fontWeight: 700, letterSpacing: 0.3 }}>
          {trend.arrow} {fmt(trend.diff, 1)}% last fill
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, message }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 16px' }}>
      <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.5 }}>{icon}</div>
      <div style={{ color: COLORS.textSecondary, fontSize: 14 }}>{message}</div>
    </div>
  );
}

function Modal({ open, title, onClose, children }) {
  // Escape closes any modal, which is the only exit on a desktop browser once
  // the dialog covers the screen.
  useEffect(() => {
    if (!open) return undefined;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: COLORS.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 20,
          padding: 20,
          width: '100%',
          maxWidth: 420,
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{title}</div>
          <IconButton onClick={onClose} title="Close">✕</IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ open, title, message, confirmLabel, confirmVariant, onConfirm, onCancel }) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div style={{ color: COLORS.textSecondary, marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>{message}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={confirmVariant || 'danger'} onClick={onConfirm}>{confirmLabel || 'Confirm'}</Button>
      </div>
    </Modal>
  );
}

function ChartCard({ title, labels, values, type = 'line', color = COLORS.accent, unit, goalLine, pointColors }) {
  const ref = useRef(null);

  // `labels`, `values`, `pointColors` and `goalLine` are rebuilt by the parent on
  // every render. Depending on the identities directly tore the canvas down and
  // rebuilt it each time — visible as a flicker on every keystroke. Depend on
  // the serialised content instead, so the chart is rebuilt only when it changes.
  const dataKey = JSON.stringify({ labels, values, pointColors, goalLine });

  useEffect(() => {
    if (!ref.current) return undefined;

    const mainDataset = {
      label: title,
      data: values,
      borderColor: color,
      backgroundColor: type === 'bar' ? `${color}88` : `${color}33`,
      tension: 0.35,
      fill: type === 'line',
      borderWidth: 2,
      borderRadius: type === 'bar' ? 6 : 0,
      ...(pointColors ? {
        pointBackgroundColor: pointColors.map((c) => c ?? color),
        pointBorderColor: pointColors.map((c) => c ?? color),
        pointRadius: pointColors.map((c) => (c !== null ? 7 : 3)),
        pointHoverRadius: 9,
      } : {}),
    };

    const datasets = [mainDataset];

    if (goalLine && goalLine.value > 0) {
      datasets.push({
        label: goalLine.label || 'Target',
        data: values.map(() => goalLine.value),
        borderColor: goalLine.color || COLORS.warning,
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [6, 3],
        tension: 0,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 0,
      });
    }

    const chart = new Chart(ref.current, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: goalLine ? {
            display: true,
            labels: { color: COLORS.textSecondary, font: { size: 11 }, boxWidth: 24, padding: 10 },
          } : { display: false },
          tooltip: {
            backgroundColor: COLORS.surface,
            titleColor: COLORS.textPrimary,
            bodyColor: COLORS.textSecondary,
            borderColor: COLORS.border,
            borderWidth: 1,
            cornerRadius: 10,
            padding: 10,
            callbacks: unit ? { label: (ctx) => `${ctx.formattedValue} ${unit}` } : undefined,
          },
        },
        scales: {
          x: {
            ticks: { color: COLORS.textSecondary, font: { size: 11 } },
            grid: { color: `${COLORS.border}44` },
          },
          y: {
            ticks: { color: COLORS.textSecondary, font: { size: 11 } },
            grid: { color: `${COLORS.border}44` },
          },
        },
      },
    });

    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, type, color, unit, dataKey]);

  const isEmpty = !values || values.length === 0;

  return (
    <Card style={{ minWidth: 0 }}>
      <SectionTitle>{title}</SectionTitle>
      {/* A canvas defaults to 300px wide. Without these constraints the card
          grows to fit it and pushes the whole page past a 320px screen. */}
      <div style={{ height: 220, position: 'relative', minWidth: 0, width: '100%' }}>
        <canvas
          ref={ref}
          role="img"
          aria-label={`${title} chart`}
          style={{ display: 'block', width: '100%', maxWidth: '100%' }}
        />
        {isEmpty && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.textMuted,
              fontSize: 13,
              textAlign: 'center',
              padding: 12,
            }}
          >
            Not enough data yet
          </div>
        )}
      </div>
    </Card>
  );
}

function UndoToast({ toast, onUndo }) {
  if (!toast) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(80px + env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        background: COLORS.surfaceElevated,
        color: COLORS.textPrimary,
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        border: `1px solid ${COLORS.border}`,
        zIndex: 99999,
        minWidth: 220,
        maxWidth: 'calc(100vw - 32px)',
        animation: 'fp-slide-up 0.2s ease-out',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ flex: 1, fontSize: 14 }}>{toast.message}</span>
      {toast.restore && (
        <button
          type="button"
          onClick={onUndo}
          style={{
            background: COLORS.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {toast.actionLabel || 'Undo'}
        </button>
      )}
    </div>
  );
}

/* ─── Skeleton loading ─── */

function SkeletonCard({ rows = 3 }) {
  const shimmerBg = `linear-gradient(90deg, ${COLORS.surfaceElevated} 25%, ${COLORS.border} 50%, ${COLORS.surfaceElevated} 75%)`;
  return (
    <Card>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            height: i === 0 ? 20 : 14,
            width: i === 0 ? '55%' : `${75 + (i % 3) * 10}%`,
            background: shimmerBg,
            backgroundSize: '200% 100%',
            borderRadius: 8,
            marginBottom: 10,
            animation: 'fp-shimmer 1.4s ease-in-out infinite',
          }}
        />
      ))}
    </Card>
  );
}

/* ─── Long-press hook ─── */

function useLongPress(callback, delay = 500) {
  const timerRef = useRef(null);

  function start(e) {
    // Don't trigger if user is scrolling
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      callback(e);
    }, delay);
  }

  function cancel() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  return { onTouchStart: start, onTouchEnd: cancel, onTouchMove: cancel, onContextMenu: (e) => e.preventDefault() };
}

/* ─── Long-press context menu (bottom sheet style) ─── */

function LongPressMenu({ open, onClose, onEdit, onDelete }) {
  if (!open) return null;
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'transparent' }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(96px + env(safe-area-inset-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
          background: COLORS.surfaceElevated,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          overflow: 'hidden',
          zIndex: 9991,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          minWidth: 200,
          animation: 'fp-slide-up 0.2s ease-out',
        }}
      >
        <button
          type="button"
          onClick={() => { onEdit(); onClose(); }}
          style={{
            width: '100%',
            padding: '14px 20px',
            background: 'none',
            border: 'none',
            borderBottom: `1px solid ${COLORS.border}`,
            color: COLORS.textPrimary,
            fontSize: 15,
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>✏️</span> Edit
        </button>
        <button
          type="button"
          onClick={() => { onDelete(); onClose(); }}
          style={{
            width: '100%',
            padding: '14px 20px',
            background: 'none',
            border: 'none',
            color: COLORS.danger,
            fontSize: 15,
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>🗑️</span> Delete
        </button>
      </div>
    </>
  );
}

/* ─── Swipeable row (swipe left to reveal Edit / Delete) ─── */

function SwipeableRow({ onEdit, onDelete, children }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(null);
  const ACTION_WIDTH = 80;

  function handleTouchStart(e) {
    startX.current = e.touches[0].clientX;
    setDragging(true);
  }

  function handleTouchMove(e) {
    if (startX.current === null) return;
    const dx = startX.current - e.touches[0].clientX;
    if (dx > 0) setOffset(Math.min(dx, ACTION_WIDTH));
    else if (dx < -SWIPE_CANCEL_THRESHOLD) setOffset(0);
  }

  function handleTouchEnd() {
    setDragging(false);
    startX.current = null;
    setOffset((prev) => (prev >= ACTION_WIDTH / 2 ? ACTION_WIDTH : 0));
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
      {/* Hidden action buttons revealed on swipe */}
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, display: 'flex', width: ACTION_WIDTH }}>
        <button
          type="button"
          onClick={() => { setOffset(0); onEdit(); }}
          style={{ flex: 1, background: COLORS.accent, border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}
        >
          ✏️
        </button>
        <button
          type="button"
          onClick={() => { setOffset(0); onDelete(); }}
          style={{ flex: 1, background: COLORS.danger, border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}
        >
          🗑️
        </button>
      </div>

      {/* Swipeable content layer */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: dragging ? 'none' : 'transform 0.25s ease',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── Refuel history row (swipe + long-press) ─── */

function RefuelRow({ entry, currency, consumption, onEdit, onDelete, warnings, bulkSelectMode, isSelected, onToggleSelect }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const lp = useLongPress(() => {
    if (!bulkSelectMode) setMenuOpen(true);
  });

  return (
    <>
      <SwipeableRow onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry.id)}>
        <div
          {...lp}
          onClick={bulkSelectMode ? () => onToggleSelect(entry.id) : undefined}
          style={{
            border: `1px solid ${isSelected ? COLORS.accent + '88' : (warnings?.length ? COLORS.warning + '55' : COLORS.borderLight)}`,
            borderRadius: 12,
            padding: '10px 12px',
            background: isSelected ? `${COLORS.accent}0d` : COLORS.surfaceElevated,
            transition: 'border-color 0.2s, background 0.2s',
            userSelect: 'none',
            cursor: bulkSelectMode ? 'pointer' : undefined,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {bulkSelectMode && (
                <span style={{ fontSize: 18, lineHeight: 1 }}>{isSelected ? '✅' : '⬜'}</span>
              )}
              <strong>{formatDate(entry.date)}</strong>
              {entry.isFullTank ? (
                <span style={{ fontSize: 10, color: COLORS.success, background: `${COLORS.success}22`, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>FULL</span>
              ) : (
                <span style={{ fontSize: 10, color: COLORS.warning, background: `${COLORS.warning}22`, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>PARTIAL</span>
              )}
              {/* Feature 16: integrity warning badge */}
              {warnings?.length > 0 && (
                <span
                  title={warnings.join('\n')}
                  style={{ fontSize: 10, color: COLORS.warning, background: `${COLORS.warning}22`, padding: '1px 6px', borderRadius: 6, fontWeight: 700, cursor: 'help' }}
                >
                  ⚠️
                </span>
              )}
            </div>
            {!bulkSelectMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconButton onClick={() => onEdit(entry)} title="Edit">✏️</IconButton>
                <IconButton onClick={() => onDelete(entry.id)} title="Delete" variant="danger">🗑️</IconButton>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textSecondary, fontSize: 13 }}>
            <span>{fmt(entry.liters, 2)} L · {fmt(entry.pricePerLiter, 2)} {currency}/L</span>
            <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{fmt(entry.totalCost, 2)} {currency}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>
            <span>{entry.odometer.toLocaleString()} km</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {consumption != null && (
                <span style={{ color: COLORS.accent, fontWeight: 600 }}>⛽ {fmt(consumption)} l/100km</span>
              )}
              {entry.station && <span>📍 {entry.station}</span>}
            </span>
          </div>
          {entry.note && <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 3, fontStyle: 'italic' }}>💬 {entry.note}</div>}
          {/* Feature 8: trip tag badge */}
          {entry.tripTag && (
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 10, color: COLORS.accentLight, background: `${COLORS.accentLight}22`, border: `1px solid ${COLORS.accentLight}44`, borderRadius: 6, padding: '2px 7px', fontWeight: 700, letterSpacing: 0.3 }}>
                🏷 {entry.tripTag}
              </span>
            </div>
          )}
          {entry.photo && (
            <img
              src={entry.photo}
              alt="Receipt"
              style={{ marginTop: 8, width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.borderLight}` }}
            />
          )}
        </div>
      </SwipeableRow>
      <LongPressMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onEdit={() => onEdit(entry)}
        onDelete={() => onDelete(entry.id)}
      />
    </>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('refuel');
  const [tabAnimDir, setTabAnimDir] = useState('right');
  const [theme, setTheme] = usePersistentState('fuelpilot_theme', 'dark');
  const [isHydrated, setIsHydrated] = useState(false);
  // Feature 4: per-vehicle consumption targets (map of vehicleId → target value)
  const [vehicleConsumptionTargets, setVehicleConsumptionTargets] = usePersistentState('fuelpilot_vehicle_targets', {});
  const [consumptionTargetInput, setConsumptionTargetInput] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  // History filter state (feature 10)
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historyCostMin, setHistoryCostMin] = useState('');
  const [historyCostMax, setHistoryCostMax] = useState('');
  const [historyFilterOpen, setHistoryFilterOpen] = useState(false);
  // Feature 1: sort history
  const [historySortBy, setHistorySortBy] = useState('newest');
  // Pagination state (feature 11)
  const [historyPage, setHistoryPage] = useState(1);
  const [vehicles, setVehicles] = usePersistentState('fuelpilot_vehicles', []);
  const [refuels, setRefuels] = usePersistentState('fuelpilot_refuels', []);
  const [maintenance, setMaintenance] = usePersistentState('fuelpilot_maintenance', []);
  const [odometerReadings, setOdometerReadings] = usePersistentState('fuelpilot_odometer_readings', []);
  const [selectedVehicleId, setSelectedVehicleId] = usePersistentState('fuelpilot_selectedVehicleId', '');
  const [onboarded, setOnboarded] = usePersistentState('fuelpilot_onboarded', false);
  const [onboardStep, setOnboardStep] = useState(0);
  const [importError, setImportError] = useState('');
  const [notifDaysBefore, setNotifDaysBefore] = usePersistentState('fuelpilot_notif_days', 7);
  const [notifDaysInput, setNotifDaysInput] = useState('');
  const [notifStatus, setNotifStatus] = useState(null);

  // Raised when a localStorage write fails (usually a full quota). Shown as a
  // persistent banner because silently losing edits is worse than an alert.
  const [storageError, setStorageError] = useState(null);
  const [photoError, setPhotoError] = useState('');

  // Feature 24: refuel interval reminder
  const [refuelIntervalDays, setRefuelIntervalDays] = usePersistentState('fuelpilot_refuel_interval_days', 14);
  const [refuelIntervalInput, setRefuelIntervalInput] = useState('');

  // Feature 25: low-fuel / range warning
  const [lowFuelThresholdKm, setLowFuelThresholdKm] = usePersistentState('fuelpilot_low_fuel_km', 80);
  const [lowFuelThresholdInput, setLowFuelThresholdInput] = useState('');

  // Feature 26: monthly fuel budget
  const [monthlyBudget, setMonthlyBudget] = usePersistentState('fuelpilot_monthly_budget', 0);
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState('');

  // Feature 5 (editable trip tags): custom tag list
  const [customTripTags, setCustomTripTags] = usePersistentState('fuelpilot_trip_tags', DEFAULT_TRIP_TAGS);
  const [newTagInput, setNewTagInput] = useState('');

  // Feature 28: history tag filter
  const [historyTagFilter, setHistoryTagFilter] = useState('');

  // Feature 5 (CSV import) error state
  const [importCSVError, setImportCSVError] = useState('');

  // Feature 3: "Mark as done" confirmation modal with custom fields
  const [markDoneItem, setMarkDoneItem] = useState(null);
  const [markDoneForm, setMarkDoneForm] = useState({ date: todayIso(), odometer: '', cost: '' });

  // Inline validation message for the refuel form. Previously an invalid submit
  // returned silently and looked like the button had stopped working.
  const [formError, setFormError] = useState('');

  // Feature 17: bulk delete
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState(new Set());

  // Feature 18: import merge strategy modal
  const [pendingImportFile, setPendingImportFile] = useState(null);

  // Apply theme palette before render so all child components see correct colors
  useMemo(() => {
    Object.assign(COLORS, theme === 'light' ? LIGHT_COLORS : DARK_COLORS);
  }, [theme]);

  // Keep the browser/Android chrome in step with the in-app theme.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? LIGHT_COLORS.bg : DARK_COLORS.bg);
    document.documentElement.style.colorScheme = theme;
    document.body.style.background = theme === 'light' ? LIGHT_COLORS.bg : DARK_COLORS.bg;
  }, [theme]);

  useEffect(() => onStorageError(setStorageError), []);

  // Brief hydration delay to show skeleton placeholders on first render
  useEffect(() => {
    const t = setTimeout(() => setIsHydrated(true), SKELETON_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  // Feature 6: PWA shortcut — read ?tab= URL parameter once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && ['refuel', 'stats', 'maintenance', 'settings'].includes(tab)) {
      setActiveTab(tab);
    }
  }, []);

  /* Edit / delete modal state */
  const [editRefuelId, setEditRefuelId] = useState(null);
  const [editRefuelForm, setEditRefuelForm] = useState(null);
  const [editRefuelError, setEditRefuelError] = useState('');
  const [editMaintId, setEditMaintId] = useState(null);
  const [editMaintForm, setEditMaintForm] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmClearPhotos, setConfirmClearPhotos] = useState(false);
  const [deleteVehicleId, setDeleteVehicleId] = useState(null);
  const [undoToast, setUndoToast] = useState(null);
  const undoTimerRef = useRef(null);

  const selectedVehicle = vehicles.find((x) => x.id === selectedVehicleId) || null;

  useEffect(() => {
    if (!selectedVehicleId && vehicles.length) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [selectedVehicleId, vehicles, setSelectedVehicleId]);

  const vehicleRefuels = useMemo(
    () => (selectedVehicle ? getVehicleRefuels(refuels, selectedVehicle.id) : []),
    [refuels, selectedVehicle]
  );

  const stats = useMemo(() => computeStats(vehicleRefuels), [vehicleRefuels]);
  const currentOdometer = getCurrentOdometer(vehicleRefuels);

  // Date-filtered slice used exclusively on the Stats tab
  const filteredRefuels = useMemo(() => {
    if (!rangeFrom && !rangeTo) return vehicleRefuels;
    return vehicleRefuels.filter((r) => {
      if (rangeFrom && r.date < rangeFrom) return false;
      if (rangeTo && r.date > rangeTo) return false;
      return true;
    });
  }, [vehicleRefuels, rangeFrom, rangeTo]);

  const filteredStats = useMemo(() => computeStats(filteredRefuels), [filteredRefuels]);

  const vehicleMaintenance = useMemo(
    () => (selectedVehicle ? maintenance.filter((x) => x.vehicleId === selectedVehicle.id) : []),
    [maintenance, selectedVehicle]
  );

  const overdueCount = useMemo(
    () => vehicleMaintenance.filter((item) => getMaintenanceStatus(item, currentOdometer).key === 'due').length,
    [vehicleMaintenance, currentOdometer]
  );

  const [vehicleForm, setVehicleForm] = useState({
    name: '',
    make: '',
    model: '',
    year: '',
    fuelType: 'diesel',
    secondaryFuelType: '',
    tankSize: '',
    currency: 'Kč',
    color: VEHICLE_COLORS[0],
  });

  // Feature 15: auto-save draft refuel form (photo excluded to avoid storage bloat)
  const [refuelForm, setRefuelForm] = useState(() => {
    const blank = {
      date: todayIso(),
      odometer: '',
      liters: '',
      pricePerLiter: '',
      isFullTank: true,
      station: '',
      note: '',
      photo: null,
      fuelType: '',
      tripTag: '',
    };
    const saved = readJSON(DRAFT_REFUEL_KEY, null);
    if (!saved || typeof saved !== 'object') return blank;
    // A draft left open overnight would otherwise reopen dated yesterday and
    // quietly log the fill against the wrong day.
    return { ...blank, ...saved, date: todayIso(), photo: null };
  });
  useEffect(() => {
    const { photo, ...rest } = refuelForm;
    void photo; // never persisted: a base64 image would fill the storage quota
    writeJSON(DRAFT_REFUEL_KEY, rest);
  }, [refuelForm]);

  const [maintForm, setMaintForm] = useState({
    type: 'oil_change',
    label: 'Oil Change',
    lastDoneAt: todayIso(),
    lastDoneOdometer: currentOdometer || 0,
    intervalKm: 15000,
    intervalDays: 365,
    cost: '',
    note: '',
  });

  const [odometerForm, setOdometerForm] = useState({ date: todayIso(), odometer: '' });

  // Seeds the form when the vehicle changes. Deliberately not reacting to
  // `currentOdometer`: it moves on every new refuel and would overwrite what the
  // user is typing.
  useEffect(() => {
    setMaintForm((prev) => ({ ...prev, lastDoneOdometer: currentOdometer || 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId]);

  // Feature 12: pre-populate odometer with last known value when vehicle changes
  useEffect(() => {
    if (currentOdometer > 0) {
      setRefuelForm((prev) => ({
        ...prev,
        odometer: prev.odometer || String(currentOdometer),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId]);

  const handleTabChange = useCallback((newTab) => {
    setActiveTab((current) => {
      setTabAnimDir(TAB_INDEX[newTab] > TAB_INDEX[current] ? 'right' : 'left');
      return newTab;
    });
  }, []);

  // Feature 14: keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'r') handleTabChange('refuel');
      else if (key === 's') handleTabChange('stats');
      else if (key === 'm') handleTabChange('maintenance');
      else if (key === ',') handleTabChange('settings');
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTabChange]);

  // Feature 11: swipe-to-switch tabs
  const swipeStartRef = useRef(null);
  function handleContentTouchStart(e) {
    swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function handleContentTouchEnd(e) {
    if (!swipeStartRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeStartRef.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - swipeStartRef.current.y);
    swipeStartRef.current = null;
    if (Math.abs(dx) > 60 && dy < 40) {
      const currentIdx = TAB_KEYS.indexOf(activeTab);
      if (dx < 0 && currentIdx < TAB_KEYS.length - 1) handleTabChange(TAB_KEYS[currentIdx + 1]);
      else if (dx > 0 && currentIdx > 0) handleTabChange(TAB_KEYS[currentIdx - 1]);
    }
  }

  /* ─── CRUD handlers ─── */

  function addVehicle(e) {
    e.preventDefault();
    if (!vehicleForm.name.trim()) return;

    const fuelTypes = [vehicleForm.fuelType];
    if (vehicleForm.secondaryFuelType && vehicleForm.secondaryFuelType !== vehicleForm.fuelType) {
      fuelTypes.push(vehicleForm.secondaryFuelType);
    }

    const entry = {
      id: uid('v'),
      name: vehicleForm.name.trim(),
      make: vehicleForm.make.trim(),
      model: vehicleForm.model.trim(),
      year: num(vehicleForm.year),
      fuelType: vehicleForm.fuelType,
      fuelTypes,
      tankSize: num(vehicleForm.tankSize),
      currency: vehicleForm.currency,
      color: vehicleForm.color || VEHICLE_COLORS[0],
      createdAt: Date.now(),
    };

    setVehicles((prev) => [...prev, entry]);
    setSelectedVehicleId(entry.id);
    setVehicleForm({
      name: '',
      make: '',
      model: '',
      year: '',
      fuelType: 'diesel',
      secondaryFuelType: '',
      tankSize: '',
      currency: entry.currency,
      color: VEHICLE_COLORS[0],
    });
  }

  const deleteVehicle = useCallback((id) => {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    setRefuels((prev) => prev.filter((r) => r.vehicleId !== id));
    setMaintenance((prev) => prev.filter((m) => m.vehicleId !== id));
    setOdometerReadings((prev) => prev.filter((r) => r.vehicleId !== id));
    // Without this the target lingers and would be reapplied to a future
    // vehicle that happened to reuse the id.
    setVehicleConsumptionTargets((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedVehicleId((prevId) => (prevId === id ? '' : prevId));
    setDeleteVehicleId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addRefuel(e) {
    e.preventDefault();
    if (!selectedVehicle) return;

    const odometer = num(refuelForm.odometer);
    const liters = num(refuelForm.liters);
    const pricePerLiter = num(refuelForm.pricePerLiter);

    if (!(odometer > 0) || !(liters > 0) || !(pricePerLiter > 0)) {
      setFormError('Enter an odometer reading, a fuel quantity and a price per litre.');
      return;
    }
    setFormError('');

    const entry = {
      id: uid('r'),
      vehicleId: selectedVehicle.id,
      date: refuelForm.date,
      odometer,
      liters,
      pricePerLiter,
      totalCost: liters * pricePerLiter,
      fuelType: refuelForm.fuelType || selectedVehicle.fuelType,
      isFullTank: refuelForm.isFullTank,
      station: refuelForm.station.trim(),
      note: refuelForm.note.trim(),
      photo: refuelForm.photo || null,
      tripTag: refuelForm.tripTag,
      createdAt: Date.now(),
    };

    setRefuels((prev) => [...prev, entry]);
    // Feature 10: haptic feedback on save
    navigator.vibrate?.(50);
    // Feature 15: clear draft on successful save
    removeKey(DRAFT_REFUEL_KEY);
    setPhotoError('');
    showUndoToast('Refuel saved', () => setRefuels((prev) => prev.filter((r) => r.id !== entry.id)));
    setRefuelForm({
      date: todayIso(),
      odometer: String(odometer),
      liters: '',
      pricePerLiter: String(pricePerLiter),
      isFullTank: true,
      station: '',
      note: '',
      photo: null,
      fuelType: '',
      tripTag: '',
    });
  }

  function saveEditRefuel() {
    if (!editRefuelForm) return;
    const odometer = num(editRefuelForm.odometer);
    const liters = num(editRefuelForm.liters);
    const pricePerLiter = num(editRefuelForm.pricePerLiter);
    if (!(odometer > 0) || !(liters > 0) || !(pricePerLiter > 0)) {
      setEditRefuelError('Odometer, litres and price per litre must all be greater than zero.');
      return;
    }
    setEditRefuelError('');

    setRefuels((prev) =>
      prev.map((entry) =>
        entry.id === editRefuelId
          ? {
              ...entry,
              date: editRefuelForm.date,
              odometer,
              liters,
              pricePerLiter,
              totalCost: liters * pricePerLiter,
              fuelType: editRefuelForm.fuelType || entry.fuelType,
              isFullTank: editRefuelForm.isFullTank,
              station: editRefuelForm.station.trim(),
              note: editRefuelForm.note.trim(),
              photo: editRefuelForm.photo || null,
              tripTag: editRefuelForm.tripTag,
            }
          : entry
      )
    );
    setEditRefuelId(null);
    setEditRefuelForm(null);
  }

  const showUndoToast = useCallback((message, restore, options = {}) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    // A prompt that needs a decision must not disappear on its own.
    if (options.persist) {
      undoTimerRef.current = null;
    } else {
      undoTimerRef.current = setTimeout(() => setUndoToast(null), UNDO_TIMEOUT_MS);
    }
    setUndoToast({ message, restore: restore || null, actionLabel: options.actionLabel });
  }, []);

  function handleUndo() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    if (undoToast?.restore) undoToast.restore();
    setUndoToast(null);
  }

  // A pending toast timer would otherwise fire into an unmounted tree.
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  // A newly deployed PWA build only takes effect once the user accepts it.
  // Declared after showUndoToast, which it captures.
  useEffect(() => {
    function handleUpdate() {
      showUndoToast('A new version is available', applyServiceWorkerUpdate, {
        actionLabel: 'Reload',
        persist: true,
      });
    }
    window.addEventListener(UPDATE_EVENT, handleUpdate);
    return () => window.removeEventListener(UPDATE_EVENT, handleUpdate);
  }, [showUndoToast]);

  function handleDeleteRefuel(id) {
    const entry = refuels.find((r) => r.id === id);
    if (!entry) return;
    // Feature 10: haptic on delete
    navigator.vibrate?.([40, 30, 40]);
    setRefuels((prev) => prev.filter((r) => r.id !== id));
    showUndoToast('Refuel deleted', () => setRefuels((prev) => [...prev, entry]));
  }

  function openEditRefuel(entry) {
    setEditRefuelId(entry.id);
    setEditRefuelForm({
      date: entry.date,
      odometer: entry.odometer,
      liters: entry.liters,
      pricePerLiter: entry.pricePerLiter,
      isFullTank: entry.isFullTank,
      station: entry.station || '',
      note: entry.note || '',
      photo: entry.photo || null,
      fuelType: entry.fuelType || '',
      tripTag: entry.tripTag || '',
    });
  }

  function addMaintenance(e) {
    e.preventDefault();
    if (!selectedVehicle) return;

    const item = {
      id: uid('m'),
      vehicleId: selectedVehicle.id,
      type: maintForm.type,
      label: maintForm.label.trim() || MAINT_TYPES.find((x) => x.value === maintForm.type)?.label || 'Custom',
      lastDoneAt: maintForm.lastDoneAt,
      lastDoneOdometer: num(maintForm.lastDoneOdometer),
      intervalKm: num(maintForm.intervalKm),
      intervalDays: num(maintForm.intervalDays),
      cost: num(maintForm.cost),
      note: maintForm.note.trim(),
    };

    setMaintenance((prev) => [...prev, item]);
    setMaintForm((prev) => ({
      ...prev,
      cost: '',
      note: '',
      lastDoneAt: todayIso(),
      lastDoneOdometer: currentOdometer || 0,
    }));
  }

  function openEditMaint(item) {
    setEditMaintId(item.id);
    setEditMaintForm({
      type: item.type,
      label: item.label,
      lastDoneAt: item.lastDoneAt,
      lastDoneOdometer: item.lastDoneOdometer,
      intervalKm: item.intervalKm,
      intervalDays: item.intervalDays,
      cost: item.cost || 0,
      note: item.note || '',
    });
  }

  function saveEditMaint() {
    if (!editMaintForm) return;
    setMaintenance((prev) =>
      prev.map((item) =>
        item.id === editMaintId
          ? {
              ...item,
              type: editMaintForm.type,
              label: editMaintForm.label.trim() || MAINT_TYPES.find((x) => x.value === editMaintForm.type)?.label || 'Custom',
              lastDoneAt: editMaintForm.lastDoneAt,
              lastDoneOdometer: num(editMaintForm.lastDoneOdometer),
              intervalKm: num(editMaintForm.intervalKm),
              intervalDays: num(editMaintForm.intervalDays),
              cost: num(editMaintForm.cost),
              note: editMaintForm.note.trim(),
            }
          : item
      )
    );
    setEditMaintId(null);
    setEditMaintForm(null);
  }

  function handleDeleteMaint(id) {
    const item = maintenance.find((m) => m.id === id);
    if (!item) return;
    navigator.vibrate?.([40, 30, 40]);
    setMaintenance((prev) => prev.filter((m) => m.id !== id));
    showUndoToast('Reminder deleted', () => setMaintenance((prev) => [...prev, item]));
  }

  // Feature 3: open "mark as done" modal with pre-filled values
  function openMarkDone(item) {
    setMarkDoneItem(item);
    setMarkDoneForm({
      date: todayIso(),
      odometer: String(currentOdometer || item.lastDoneOdometer || ''),
      cost: String(item.cost || ''),
    });
  }

  function confirmMarkDone() {
    if (!markDoneItem) return;
    const doneDate = markDoneForm.date || todayIso();
    const doneOdometer = num(markDoneForm.odometer) || currentOdometer || markDoneItem.lastDoneOdometer;
    const doneCost = num(markDoneForm.cost);
    const historyEntry = { date: doneDate, odometer: doneOdometer, cost: doneCost };
    setMaintenance((prev) =>
      prev.map((m) =>
        m.id === markDoneItem.id
          ? {
              ...m,
              lastDoneAt: doneDate,
              lastDoneOdometer: doneOdometer,
              cost: doneCost || m.cost,
              history: [...(m.history || []), historyEntry],
            }
          : m
      )
    );
    navigator.vibrate?.(50);
    setMarkDoneItem(null);
  }

  // Feature 18: odometer tracker
  function addOdometerReading(e) {
    e.preventDefault();
    if (!selectedVehicle || !odometerForm.odometer) return;
    const entry = {
      id: uid('o'),
      vehicleId: selectedVehicle.id,
      date: odometerForm.date,
      odometer: num(odometerForm.odometer),
      createdAt: Date.now(),
    };
    setOdometerReadings((prev) => [...prev, entry]);
    setOdometerForm({ date: todayIso(), odometer: '' });
  }

  function handleDeleteOdometerReading(id) {
    const entry = odometerReadings.find((r) => r.id === id);
    if (!entry) return;
    setOdometerReadings((prev) => prev.filter((r) => r.id !== id));
    showUndoToast('Odometer reading deleted', () => setOdometerReadings((prev) => [...prev, entry]));
  }

  // Feature 19: update vehicle color
  function updateVehicleColor(color) {
    if (!selectedVehicle) return;
    setVehicles((prev) => prev.map((v) => (v.id === selectedVehicle.id ? { ...v, color } : v)));
  }

  // Feature 16: schedule local notifications for due maintenance items
  // Stable numeric ID for a string (same algorithm used for both schedule and cancel)
  function maintNotifId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return Math.abs(h) || 1;
  }

  async function scheduleMaintenanceNotifications() {
    setNotifStatus({ tone: 'info', message: 'Requesting permission…' });
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') {
        setNotifStatus({
          tone: 'error',
          message: 'Notification permission was denied. Enable notifications for FuelPilot in your device settings.',
        });
        return;
      }

      await LocalNotifications.cancel({
        notifications: vehicleMaintenance.map((m) => ({ id: maintNotifId(m.id) })),
      });

      const notifications = [];
      for (const item of vehicleMaintenance) {
        // `getDueDate` parses the stored date as local midnight; `new Date(str)`
        // treated it as UTC and drifted the reminder by a day.
        const dueDate = getDueDate(item);
        if (!dueDate) continue;
        const notifyAt = new Date(dueDate.getTime());
        notifyAt.setDate(notifyAt.getDate() - notifDaysBefore);
        notifyAt.setHours(9, 0, 0, 0);
        if (notifyAt <= new Date()) continue;

        notifications.push({
          id: maintNotifId(item.id),
          title: `🔧 ${item.label} due soon`,
          body: `${selectedVehicle?.name || 'Your vehicle'}: ${item.label} is due on ${dueDate.toLocaleDateString()}`,
          schedule: { at: notifyAt },
        });
      }

      if (notifications.length) {
        await LocalNotifications.schedule({ notifications });
        setNotifStatus({ tone: 'success', message: `Scheduled ${notifications.length} reminder(s).` });
      } else {
        setNotifStatus({
          tone: 'info',
          message: 'Nothing to schedule — no reminder has a future due date with a day-based interval.',
        });
      }
    } catch (err) {
      setNotifStatus({
        tone: 'error',
        message: `Notifications are unavailable here: ${err?.message || 'not supported in this browser'}. They work in the installed Android app.`,
      });
    }
  }

  function currentBackupPayload() {
    return buildBackup({
      vehicles,
      refuels,
      maintenance,
      odometerReadings,
      selectedVehicleId,
      settings: {
        theme,
        notifDaysBefore,
        refuelIntervalDays,
        lowFuelThresholdKm,
        monthlyBudget,
        customTripTags,
        vehicleConsumptionTargets,
      },
    });
  }

  function downloadBlob(contents, filename, mime) {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Feature 20: auto-backup to device storage
  async function autoBackupToDevice() {
    const payload = JSON.stringify(currentBackupPayload(), null, 2);
    const filename = `fuelpilot-backup-${todayIso()}.json`;
    try {
      await Filesystem.writeFile({
        path: filename,
        data: payload,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      showUndoToast('Backup saved to Documents', null);
    } catch {
      // Not running inside the native shell — fall back to a browser download.
      downloadBlob(payload, filename, 'application/json');
      showUndoToast('Backup downloaded', null);
    }
  }

  function updateVehicleCurrency(currency) {
    if (!selectedVehicle) return;
    setVehicles((prev) => prev.map((item) => (item.id === selectedVehicle.id ? { ...item, currency } : item)));
  }

  const stationSuggestions = useMemo(
    () => [...new Set(vehicleRefuels.map((r) => r.station).filter(Boolean))],
    [vehicleRefuels]
  );

  const HISTORY_PAGE_SIZE = 10;

  // Feature 4: per-vehicle consumption target (falls back to 0)
  const consumptionTarget = vehicleConsumptionTargets[selectedVehicleId] || 0;

  // Feature 1: sorted history — apply sort after filters
  const sortedHistory = useMemo(() => {
    const base = vehicleRefuels.slice().reverse(); // newest-first baseline
    if (historySortBy === 'newest') return base;
    if (historySortBy === 'oldest') return vehicleRefuels.slice(); // oldest-first
    if (historySortBy === 'cost_desc') return base.slice().sort((a, b) => b.totalCost - a.totalCost);
    if (historySortBy === 'cost_asc') return base.slice().sort((a, b) => a.totalCost - b.totalCost);
    if (historySortBy === 'liters_desc') return base.slice().sort((a, b) => b.liters - a.liters);
    if (historySortBy === 'liters_asc') return base.slice().sort((a, b) => a.liters - b.liters);
    return base;
  }, [vehicleRefuels, historySortBy]);

  // Map from "odometer_date" → consumption value for full-tank entries (used in history rows)
  const consumptionByKey = useMemo(() => {
    const map = new Map();
    for (const point of stats.consumptionSeries) {
      map.set(`${point.odometer}_${point.date}`, point.value);
    }
    return map;
  }, [stats.consumptionSeries]);

  // Filtered history (feature 10 + feature 28 tag filter)
  const filteredHistory = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    const costMin = num(historyCostMin);
    const costMax = num(historyCostMax);
    return sortedHistory.filter((r) => {
      if (search) {
        const stationMatch = (r.station || '').toLowerCase().includes(search);
        const noteMatch = (r.note || '').toLowerCase().includes(search);
        if (!stationMatch && !noteMatch) return false;
      }
      if (historyDateFrom && r.date < historyDateFrom) return false;
      if (historyDateTo && r.date > historyDateTo) return false;
      if (costMin > 0 && r.totalCost < costMin) return false;
      if (costMax > 0 && r.totalCost > costMax) return false;
      if (historyTagFilter && (r.tripTag || '') !== historyTagFilter) return false;
      return true;
    });
  }, [sortedHistory, historySearch, historyDateFrom, historyDateTo, historyCostMin, historyCostMax, historyTagFilter]);

  // Paginated slice (feature 11) — reset page when filters change
  useEffect(() => { setHistoryPage(1); }, [filteredHistory]);

  const pagedHistory = useMemo(
    () => filteredHistory.slice(0, historyPage * HISTORY_PAGE_SIZE),
    [filteredHistory, historyPage]
  );

  const hasMoreHistory = pagedHistory.length < filteredHistory.length;

  const historyFiltersActive = Boolean(historySearch || historyDateFrom || historyDateTo || historyCostMin || historyCostMax || historyTagFilter);

  // Feature 17: cost totals per maintenance type
  const maintCostByType = useMemo(() => {
    const totals = {};
    for (const item of vehicleMaintenance) {
      const label = MAINT_TYPES.find((t) => t.value === item.type)?.label || item.label || item.type;
      // Sum: last recorded cost + historical costs
      const histTotal = (item.history || []).reduce((sum, h) => sum + (h.cost || 0), 0);
      const lastCost = item.cost || 0;
      totals[label] = (totals[label] || 0) + lastCost + histTotal;
    }
    return Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }, [vehicleMaintenance]);

  // Feature 18: odometer readings for selected vehicle
  const vehicleOdometerReadings = useMemo(
    () => (selectedVehicle ? odometerReadings.filter((r) => r.vehicleId === selectedVehicle.id).sort((a, b) => a.date.localeCompare(b.date)) : []),
    [odometerReadings, selectedVehicle]
  );

  // Feature 7: effective fuel types for the selected vehicle
  const vehicleFuelTypes = useMemo(
    () => selectedVehicle?.fuelTypes || (selectedVehicle?.fuelType ? [selectedVehicle.fuelType] : []),
    [selectedVehicle]
  );

  // Feature 24: days since last refuel
  const daysSinceLastRefuel = useMemo(() => {
    if (!stats.lastEntry) return null;
    const last = parseLocalDate(stats.lastEntry.date);
    if (!last) return null;
    return Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24));
  }, [stats.lastEntry]);

  // Feature 25: estimated remaining range (avg dist/fill minus distance since last refuel)
  const estimatedRemainingRange = useMemo(() => {
    if (!stats.lastEntry || stats.avgDistancePerFill <= 0) return null;
    const distSinceLast = currentOdometer - stats.lastEntry.odometer;
    return Math.max(0, Math.round(stats.avgDistancePerFill - distSinceLast));
  }, [stats.lastEntry, stats.avgDistancePerFill, currentOdometer]);

  // Feature 26: current-month fuel cost
  const thisMonthCost = useMemo(() => {
    const thisMonth = todayIso().slice(0, 7);
    return vehicleRefuels.filter((r) => r.date.startsWith(thisMonth)).reduce((sum, r) => sum + r.totalCost, 0);
  }, [vehicleRefuels]);

  // Feature 28: cost by trip tag
  const costByTag = useMemo(() => {
    const map = {};
    for (const r of vehicleRefuels) {
      if (r.tripTag) map[r.tripTag] = (map[r.tripTag] || 0) + r.totalCost;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [vehicleRefuels]);

  // Feature 9: yearly comparison data
  const yearlyData = useMemo(() => {
    const map = new Map();
    for (const r of vehicleRefuels) {
      const year = r.date.slice(0, 4);
      if (!map.has(year)) map.set(year, { cost: 0, liters: 0 });
      const y = map.get(year);
      y.cost += r.totalCost;
      y.liters += r.liters;
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, data]) => ({ year, ...data }));
  }, [vehicleRefuels]);

  // Feature 8: cost-per-km trend (needs consumption series + matching price)
  const costPerKmSeries = useMemo(() => {
    return filteredStats.consumptionSeries.map((point) => {
      const matchingEntry = filteredRefuels.find(
        (r) => r.isFullTank && r.odometer === point.odometer && r.date === point.date
      );
      return matchingEntry ? { date: point.date, value: (point.value * matchingEntry.pricePerLiter) / 100 } : null;
    }).filter(Boolean);
  }, [filteredStats.consumptionSeries, filteredRefuels]);

  // Feature 16: data integrity warnings per refuel entry
  const refuelWarnings = useMemo(
    () => computeRefuelWarnings(vehicleRefuels, selectedVehicle?.tankSize || 0),
    [vehicleRefuels, selectedVehicle]
  );

  function clearHistoryFilters() {
    setHistorySearch('');
    setHistoryDateFrom('');
    setHistoryDateTo('');
    setHistoryCostMin('');
    setHistoryCostMax('');
    setHistoryTagFilter('');
  }

  // Feature 13: share stats as text
  function shareStats() {
    if (!selectedVehicle) return;
    const lines = [
      `🚗 ${selectedVehicle.name} — FuelPilot Stats`,
      `📊 Avg consumption: ${fmt(stats.avgConsumption)} l/100 km`,
      `💰 Total cost: ${fmt(stats.totalCost, 0)} ${currency}`,
      `🛣️ Total distance: ${fmt(stats.totalDistance, 0)} km`,
      `⛽ Total fuel: ${fmt(stats.totalLiters, 0)} L`,
      `📈 Avg cost/km: ${fmt(stats.avgCostPerKm, 3)} ${currency}/km`,
    ];
    if (stats.totalCo2 > 0) {
      lines.push(`🌱 Est. CO₂: ${fmt(stats.totalCo2, 0)} kg`);
    }
    const text = lines.join('\n');
    if (navigator.share) {
      navigator.share({ title: 'FuelPilot Stats', text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).then(() =>
        showUndoToast('Stats copied to clipboard', null)
      );
    }
  }

  // Feature 17: bulk delete handler
  function handleBulkDelete() {
    const ids = new Set(bulkSelectedIds);
    const deleted = vehicleRefuels.filter((r) => ids.has(r.id));
    setRefuels((prev) => prev.filter((r) => !ids.has(r.id)));
    setBulkSelectedIds(new Set());
    setBulkSelectMode(false);
    navigator.vibrate?.([40, 30, 40]);
    showUndoToast(
      `Deleted ${deleted.length} refuel(s)`,
      () => setRefuels((prev) => [...prev, ...deleted])
    );
  }

  // Duplicate last refuel (feature 12)
  function duplicateLastRefuel() {
    if (!sortedHistory.length) return;
    const last = sortedHistory[0];
    setRefuelForm((prev) => ({
      ...prev,
      station: last.station || '',
      pricePerLiter: String(last.pricePerLiter),
    }));
  }

  /**
   * Read a receipt photo, downscaled and re-encoded as JPEG.
   * A raw phone photo is several megabytes, which alone exceeds the whole
   * localStorage budget.
   */
  async function readPhotoFile(file, onDone) {
    if (!file) return;
    setPhotoError('');
    try {
      onDone(await compressImage(file));
    } catch (err) {
      setPhotoError(err?.message || 'The photo could not be attached.');
    }
  }

  function exportCSV() {
    if (!vehicleRefuels.length) return;
    const headers = [
      'Date', 'Odometer (km)', 'Liters', `Price/L (${currency})`, `Total (${currency})`,
      'Full Tank', 'Fuel Type', 'Trip Tag', 'Station', 'Note',
    ];
    const rows = vehicleRefuels
      .slice()
      .reverse()
      .map((e) => [
        e.date,
        e.odometer,
        e.liters,
        e.pricePerLiter,
        fmt(e.totalCost, 2),
        e.isFullTank ? 'Yes' : 'No',
        FUEL_LABELS[e.fuelType] || e.fuelType || '',
        e.tripTag || '',
        e.station || '',
        e.note || '',
      ]);
    // The BOM makes Excel read the file as UTF-8 rather than the system codepage,
    // which otherwise mangles the currency symbols and accented station names.
    downloadBlob(`\ufeff${toCSV([headers, ...rows])}`, `fuelpilot-refuels-${todayIso()}.csv`, 'text/csv;charset=utf-8');
  }

  function exportData() {
    downloadBlob(
      JSON.stringify(currentBackupPayload(), null, 2),
      `fuelpilot-backup-${todayIso()}.json`,
      'application/json'
    );
  }

  // Feature 18: import JSON with strategy selection
  function importData(file) {
    if (!file) return;
    // Show strategy modal instead of importing directly
    setPendingImportFile(file);
  }

  function executeImport(file, strategy) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setImportError('The file could not be read.');
    reader.onload = () => {
      try {
        // `sanitizeBackup` coerces every record to a complete shape. Storing a
        // record with a missing odometer or date would throw later, during render.
        const backup = sanitizeBackup(JSON.parse(String(reader.result || 'null')));
        const { dropped } = backup;
        const droppedTotal = Object.values(dropped).reduce((s, v) => s + v, 0);

        if (strategy === 'merge') {
          const mergeById = (prev, incoming) => {
            const existingIds = new Set(prev.map((x) => x.id));
            return [...prev, ...incoming.filter((x) => !existingIds.has(x.id))];
          };
          setVehicles((prev) => mergeById(prev, backup.vehicles));
          setRefuels((prev) => mergeById(prev, backup.refuels));
          setMaintenance((prev) => mergeById(prev, backup.maintenance));
          setOdometerReadings((prev) => mergeById(prev, backup.odometerReadings));
          showUndoToast(`Merged ${backup.refuels.length} refuel(s)`, null);
        } else {
          // Replacing is destructive, so snapshot enough state to undo it.
          const previous = { vehicles, refuels, maintenance, odometerReadings, selectedVehicleId };
          setVehicles(backup.vehicles);
          setRefuels(backup.refuels);
          setMaintenance(backup.maintenance);
          setOdometerReadings(backup.odometerReadings);
          setSelectedVehicleId(backup.selectedVehicleId);
          showUndoToast(`Imported ${backup.refuels.length} refuel(s)`, () => {
            setVehicles(previous.vehicles);
            setRefuels(previous.refuels);
            setMaintenance(previous.maintenance);
            setOdometerReadings(previous.odometerReadings);
            setSelectedVehicleId(previous.selectedVehicleId);
          });
        }

        setImportError(
          droppedTotal > 0
            ? `Imported successfully. ${droppedTotal} incomplete record(s) were skipped.`
            : ''
        );
      } catch (err) {
        setImportError(err?.message || 'This file is not a valid FuelPilot backup.');
      }
    };
    reader.readAsText(file);
  }

  // Feature 5: Fuelio CSV import
  function importCSVFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setImportCSVError('The file could not be read.');
    reader.onload = () => {
      try {
        const { vehicles: csvVehicles, refuels: csvRefuels, skipped } = parseFuelioCSV(String(reader.result || ''));

        // Snapshot current vehicles to build name → final-ID mapping synchronously
        const currentVehicles = vehicles;
        const csvIdToFinalId = {};
        const newVehicles = [];

        for (const csvVeh of csvVehicles) {
          const existing = currentVehicles.find((v) => v.name.toLowerCase() === csvVeh.name.toLowerCase());
          if (existing) {
            csvIdToFinalId[csvVeh.id] = existing.id;
          } else {
            csvIdToFinalId[csvVeh.id] = csvVeh.id;
            newVehicles.push(csvVeh);
          }
        }

        // Remap vehicleIds in refuel entries and assign fresh unique IDs
        const remappedRefuels = csvRefuels.map((r) => ({
          ...r,
          id: uid('r'),
          vehicleId: csvIdToFinalId[r.vehicleId] || r.vehicleId,
        }));

        setVehicles((prev) => [...prev, ...newVehicles]);
        setRefuels((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          return [...prev, ...remappedRefuels.filter((r) => !existingIds.has(r.id))];
        });

        if (csvVehicles.length > 0) {
          setSelectedVehicleId(csvIdToFinalId[csvVehicles[0].id] || csvVehicles[0].id);
        }

        const importedIds = new Set(remappedRefuels.map((r) => r.id));
        const newVehicleIds = new Set(newVehicles.map((v) => v.id));
        showUndoToast(`Imported ${remappedRefuels.length} refuel(s)`, () => {
          setRefuels((prev) => prev.filter((r) => !importedIds.has(r.id)));
          setVehicles((prev) => prev.filter((v) => !newVehicleIds.has(v.id)));
        });

        setImportCSVError(skipped > 0 ? `${skipped} row(s) without an odometer or quantity were skipped.` : '');
      } catch (err) {
        setImportCSVError(err?.message || 'The CSV could not be imported.');
      }
    };
    reader.readAsText(file);
  }

  const photoCount = useMemo(() => refuels.filter((r) => r.photo).length, [refuels]);

  // localStorage exposes no size event, so the collections that get written are
  // used as the recompute trigger even though the reader takes no arguments.
  const storageUsedBytes = useMemo(
    () => estimateUsedBytes(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refuels, vehicles, maintenance, odometerReadings]
  );
  const storageUsedRatio = storageUsedBytes / STORAGE_BUDGET_BYTES;

  function removeAllPhotos() {
    const withPhotos = refuels.filter((r) => r.photo);
    setRefuels((prev) => prev.map((r) => (r.photo ? { ...r, photo: null } : r)));
    setConfirmClearPhotos(false);
    const restore = new Map(withPhotos.map((r) => [r.id, r.photo]));
    showUndoToast(`Removed ${withPhotos.length} photo(s)`, () =>
      setRefuels((prev) => prev.map((r) => (restore.has(r.id) ? { ...r, photo: restore.get(r.id) } : r)))
    );
  }

  const currency = selectedVehicle?.currency || 'Kč';
  // Generate a price table dynamically around the user's last recorded fuel price.
  // The step size scales with the price magnitude so it looks natural for any currency.
  const PRICE_TABLE_ROWS = 8;
  const PRICE_TABLE_CENTER_OFFSET = 2; // rows below the base price
  const PRICE_TABLE_STEP_PCT = 0.05;   // 5% of base price per row
  const lastKnownPrice = stats.priceSeries.length > 0
    ? stats.priceSeries[stats.priceSeries.length - 1].value
    : 0;
  const tablePriceBase = lastKnownPrice > 0 ? lastKnownPrice : (DEFAULT_BASE_PRICES[currency] ?? 36);
  const rawStep = tablePriceBase * PRICE_TABLE_STEP_PCT;
  const tableStep = rawStep >= 1 ? Math.round(rawStep) : Math.round(rawStep * 10) / 10;
  const quickTablePrices = Array.from({ length: PRICE_TABLE_ROWS }, (_, i) =>
    Math.round((tablePriceBase - PRICE_TABLE_CENTER_OFFSET * tableStep + i * tableStep) * 100) / 100
  ).filter((p) => p > 0);
  return (
    <div
      style={{
        minHeight: '100vh',
        background: COLORS.bg,
        color: COLORS.textPrimary,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Feature 23: Onboarding overlay */}
      {!onboarded && (
        <div style={{ position: 'fixed', inset: 0, background: COLORS.overlay, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: COLORS.surface, borderRadius: 20, padding: 28, maxWidth: 360, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            {onboardStep === 0 && (
              <>
                <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>⛽</div>
                <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>Welcome to FuelPilot!</div>
                <div style={{ color: COLORS.textSecondary, textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
                  Track your fuel costs, maintenance, and driving stats in one place.
                </div>
              </>
            )}
            {onboardStep === 1 && (
              <>
                <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>Refuel Tab</div>
                <div style={{ color: COLORS.textSecondary, textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
                  Log every fill-up with date, odometer, liters, price, and station. Filter and search your history anytime.
                </div>
              </>
            )}
            {onboardStep === 2 && (
              <>
                <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>📊</div>
                <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>Stats Tab</div>
                <div style={{ color: COLORS.textSecondary, textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
                  See consumption charts, cost trends, and compare your last fill-up vs your average.
                </div>
              </>
            )}
            {onboardStep === 3 && (
              <>
                <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>🔧</div>
                <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>Maintenance Tab</div>
                <div style={{ color: COLORS.textSecondary, textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
                  Set reminders for oil changes, tires, and more. Track service history and get notified before things are due.
                </div>
              </>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ width: 8, height: 8, borderRadius: 999, background: i === onboardStep ? COLORS.accent : COLORS.border }} />
                ))}
              </div>
              {onboardStep < 3 ? (
                <Button type="button" onClick={() => setOnboardStep((s) => s + 1)}>Next →</Button>
              ) : (
                <Button type="button" onClick={() => setOnboarded(true)}>Get started 🚀</Button>
              )}
            </div>
          </div>
        </div>
      )}
      <div
        onTouchStart={handleContentTouchStart}
        onTouchEnd={handleContentTouchEnd}
        style={{
          maxWidth: 720,
          margin: '0 auto',
          // The Android activity runs edge-to-edge, so content would otherwise
          // sit under the status bar and the display cutout.
          paddingTop: 'calc(20px + env(safe-area-inset-top))',
          paddingRight: 'calc(16px + env(safe-area-inset-right))',
          paddingBottom: 'calc(90px + env(safe-area-inset-bottom))',
          paddingLeft: 'calc(16px + env(safe-area-inset-left))',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 32 }}>⛽</span>
          <div style={{ flex: 1, fontSize: 28, fontWeight: 800, color: COLORS.accent, background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentLight})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>FuelPilot</div>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              background: COLORS.surfaceElevated,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              padding: '6px 10px',
              fontSize: 18,
              cursor: 'pointer',
              color: COLORS.textSecondary,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div style={{ color: COLORS.textSecondary, marginBottom: 18, fontSize: 13, paddingLeft: 2 }}>
          Smart fuel tracker · real costs per kilometer
        </div>

        {/* A failed write means edits are being silently dropped, so this stays
            on screen until the user acts on it. */}
        {storageError && (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              background: `${COLORS.danger}1a`,
              border: `1px solid ${COLORS.danger}55`,
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.danger, marginBottom: 2 }}>
                Changes are not being saved
              </div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                {storageError.message}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button type="button" size="small" onClick={exportData}>💾 Export backup</Button>
                <Button type="button" size="small" variant="ghost" onClick={() => setStorageError(null)}>Dismiss</Button>
              </div>
            </div>
          </div>
        )}

        {/* Vehicle selector */}
        {vehicles.length > 0 && (
          <Card style={{ marginBottom: 14, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {selectedVehicle?.color && (
                <div style={{ width: 14, height: 14, borderRadius: 999, background: selectedVehicle.color, flexShrink: 0, border: `2px solid ${selectedVehicle.color}66` }} />
              )}
              <div style={{ flex: 1 }}>
                <Label>Active Vehicle</Label>
                <Select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)}>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.year ? `(${v.year})` : ''} — {FUEL_LABELS[v.fuelType] || v.fuelType}
                    </option>
                  ))}
                </Select>
              </div>
              {selectedVehicle && <FuelBadge fuelType={selectedVehicle.fuelType} />}
            </div>
            {currentOdometer > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: COLORS.textSecondary, paddingLeft: 2 }}>
                🛣️ Current odometer: <strong style={{ color: COLORS.textPrimary }}>{currentOdometer.toLocaleString()} km</strong>
              </div>
            )}
          </Card>
        )}

        {/* First vehicle form */}
        {!selectedVehicle && (
          <Card style={{ marginBottom: 14 }} glow={COLORS.accent}>
            <SectionTitle icon="🚗">Add your first vehicle</SectionTitle>
            <form onSubmit={addVehicle} style={{ display: 'grid', gap: 10 }}>
              <div>
                <Label>Name</Label>
                <Input
                  value={vehicleForm.name}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Škoda Octavia"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <Label>Make</Label>
                  <Input value={vehicleForm.make} onChange={(e) => setVehicleForm((prev) => ({ ...prev, make: e.target.value }))} />
                </div>
                <div>
                  <Label>Model</Label>
                  <Input value={vehicleForm.model} onChange={(e) => setVehicleForm((prev) => ({ ...prev, model: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <Label>Year</Label>
                  <Input type="number" value={vehicleForm.year} onChange={(e) => setVehicleForm((prev) => ({ ...prev, year: e.target.value }))} />
                </div>
                <div>
                  <Label>Primary fuel</Label>
                  <Select
                    value={vehicleForm.fuelType}
                    onChange={(e) => setVehicleForm((prev) => ({ ...prev, fuelType: e.target.value }))}
                  >
                    <option value="diesel">Diesel</option>
                    <option value="petrol">Petrol</option>
                    <option value="lpg">LPG</option>
                    <option value="ev">EV</option>
                  </Select>
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select
                    value={vehicleForm.currency}
                    onChange={(e) => setVehicleForm((prev) => ({ ...prev, currency: e.target.value }))}
                  >
                    {CURRENCIES.map((cur) => (
                      <option key={cur} value={cur}>{cur}</option>
                    ))}
                  </Select>
                </div>
              </div>
              {/* Feature 7: secondary fuel type for dual-fuel vehicles */}
              <div>
                <Label>Secondary fuel (optional)</Label>
                <Select
                  value={vehicleForm.secondaryFuelType}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, secondaryFuelType: e.target.value }))}
                >
                  <option value="">None</option>
                  {FUEL_TYPES.filter((f) => f !== vehicleForm.fuelType).map((f) => (
                    <option key={f} value={f}>{FUEL_LABELS[f]}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Tank size (L)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={vehicleForm.tankSize}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, tankSize: e.target.value }))}
                />
              </div>
              <div>
                <Label>Vehicle color</Label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {VEHICLE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setVehicleForm((prev) => ({ ...prev, color: c }))}
                      style={{ width: 28, height: 28, borderRadius: 999, background: c, border: vehicleForm.color === c ? `3px solid ${COLORS.textPrimary}` : `2px solid transparent`, cursor: 'pointer', padding: 0 }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <Button type="submit" style={{ width: '100%', marginTop: 4 }}>Save vehicle</Button>
            </form>
          </Card>
        )}

        {/* ═══ REFUEL TAB ═══ */}
        {selectedVehicle && activeTab === 'refuel' && (
          <div className={`fp-tab-enter-${tabAnimDir}`} style={{ display: 'grid', gap: 14 }}>
            {!isHydrated ? (
              <>
                <SkeletonCard rows={5} />
                <SkeletonCard rows={7} />
                <SkeletonCard rows={4} />
              </>
            ) : (
              <>
            {/* Dashboard */}
            <Card style={{ background: `linear-gradient(135deg, ${COLORS.accent}18, ${COLORS.accent}08)`, border: `1px solid ${COLORS.accent}33` }}>
              <SectionTitle icon="📈">Dashboard</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <StatBox
                  label="Last Fill"
                  value={stats.lastEntry ? `${fmt(stats.lastEntry.liters, 1)} L` : '-'}
                  icon="⛽"
                  accent={COLORS.accent}
                  sub={stats.lastEntry ? `${formatDate(stats.lastEntry.date)} · ${fmt(stats.lastEntry.totalCost, 0)} ${currency}` : null}
                />
                <StatBox
                  label="Avg Consumption"
                  value={stats.avgConsumption > 0 ? `${fmt(stats.avgConsumption)} l/100km${stats.isEstimatedConsumption ? '*' : ''}` : '-'}
                  icon="📊"
                  accent={COLORS.warning}
                  trend={
                    stats.avgConsumption > 0 && stats.lastConsumption > 0 && stats.consumptionSeries.length > 1
                      ? {
                          arrow: stats.lastConsumption > stats.avgConsumption ? '▲' : '▼',
                          diff: Math.abs(((stats.lastConsumption - stats.avgConsumption) / stats.avgConsumption) * 100),
                          color: stats.lastConsumption > stats.avgConsumption ? COLORS.danger : COLORS.success,
                        }
                      : null
                  }
                />
                <StatBox label="Avg Cost / km" value={`${fmt(stats.avgCostPerKm)} ${currency}`} icon="💰" accent={COLORS.success} />
                <StatBox label="Odometer" value={currentOdometer > 0 ? `${currentOdometer.toLocaleString()} km` : '-'} icon="🛣️" accent={COLORS.accentLight} />
              </div>
              {stats.refuelCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 12, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{stats.refuelCount}</div>
                    <div style={{ fontSize: 10, color: COLORS.textSecondary }}>Refuels</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(stats.totalLiters, 0)} L</div>
                    <div style={{ fontSize: 10, color: COLORS.textSecondary }}>Total Fuel</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(stats.totalCost, 0)} {currency}</div>
                    <div style={{ fontSize: 10, color: COLORS.textSecondary }}>Total Spent</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(stats.totalDistance, 0)} km</div>
                    <div style={{ fontSize: 10, color: COLORS.textSecondary }}>Distance</div>
                  </div>
                </div>
              )}
              {stats.isEstimatedConsumption && (
                <div style={{ marginTop: 8, fontSize: 11, color: COLORS.textMuted, paddingLeft: 2 }}>
                  * Estimated from partial fills — log full-tank fills for best accuracy
                </div>
              )}
              {/* Feature 24: refuel interval reminder banner */}
              {daysSinceLastRefuel !== null && daysSinceLastRefuel > refuelIntervalDays && (
                <div style={{ marginTop: 10, background: `${COLORS.warning}1a`, border: `1px solid ${COLORS.warning}44`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⛽</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.warning }}>Refuel reminder</div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                      You haven&apos;t logged a refuel in <strong>{daysSinceLastRefuel} days</strong>. Time to fill up or update your log?
                    </div>
                  </div>
                </div>
              )}
              {/* Feature 25: low-fuel / range warning banner */}
              {estimatedRemainingRange !== null && estimatedRemainingRange < lowFuelThresholdKm && (
                <div style={{ marginTop: 10, background: `${COLORS.danger}1a`, border: `1px solid ${COLORS.danger}44`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🪫</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.danger }}>Low range warning</div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                      Estimated remaining range: <strong style={{ color: COLORS.danger }}>{estimatedRemainingRange} km</strong>
                      {' '}(avg dist/fill {Math.round(stats.avgDistancePerFill)} km)
                    </div>
                  </div>
                </div>
              )}
              {/* Feature 26: monthly budget progress */}
              {monthlyBudget > 0 && (
                <div style={{ marginTop: 10, background: COLORS.surfaceElevated, borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 600 }}>
                      💰 Monthly budget ({todayIso().slice(0, 7)})
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: thisMonthCost >= monthlyBudget ? COLORS.danger : COLORS.textPrimary }}>
                      {fmt(thisMonthCost, 0)} / {fmt(monthlyBudget, 0)} {currency}
                    </span>
                  </div>
                  <div style={{ background: COLORS.border, borderRadius: 999, height: 6, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min((thisMonthCost / monthlyBudget) * 100, 100)}%`,
                      background: thisMonthCost >= monthlyBudget ? COLORS.danger : thisMonthCost / monthlyBudget > 0.8 ? COLORS.warning : COLORS.success,
                      borderRadius: 999,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  {thisMonthCost / monthlyBudget > 0.8 && thisMonthCost < monthlyBudget && (
                    <div style={{ fontSize: 11, color: COLORS.warning, marginTop: 4 }}>
                      ⚠️ Approaching budget limit — {fmt(monthlyBudget - thisMonthCost, 0)} {currency} remaining
                    </div>
                  )}
                  {thisMonthCost >= monthlyBudget && (
                    <div style={{ fontSize: 11, color: COLORS.danger, marginTop: 4 }}>
                      ❌ Budget exceeded by {fmt(thisMonthCost - monthlyBudget, 0)} {currency}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Refuel form */}
            <Card>
              <SectionTitle icon="⛽">Quick refuel log</SectionTitle>
              <form onSubmit={addRefuel} style={{ display: 'grid', gap: 10 }}>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={refuelForm.date} onChange={(e) => setRefuelForm((prev) => ({ ...prev, date: e.target.value }))} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Odometer (km)</Label>
                    <Input
                      type="number"
                      value={refuelForm.odometer}
                      onChange={(e) => setRefuelForm((prev) => ({ ...prev, odometer: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Liters</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={refuelForm.liters}
                      onChange={(e) => setRefuelForm((prev) => ({ ...prev, liters: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Price per liter ({currency})</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={refuelForm.pricePerLiter}
                      onChange={(e) => setRefuelForm((prev) => ({ ...prev, pricePerLiter: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Total cost</Label>
                    <Input
                      value={`${fmt(num(refuelForm.liters) * num(refuelForm.pricePerLiter), 2)} ${currency}`}
                      readOnly
                      style={{ color: COLORS.textPrimary, opacity: 0.7 }}
                    />
                  </div>
                </div>
                {/* Real-time cost/km preview based on avg consumption */}
                {stats.avgConsumption > 0 && num(refuelForm.pricePerLiter) > 0 && (
                  <div style={{ fontSize: 12, color: COLORS.textSecondary, background: COLORS.surfaceElevated, borderRadius: 8, padding: '6px 10px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Est. cost/km at this price</span>
                    <strong style={{ color: COLORS.accent }}>
                      {fmt((stats.avgConsumption * num(refuelForm.pricePerLiter)) / 100, 3)} {currency}/km
                    </strong>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Tank Type</Label>
                    <Select
                      value={String(refuelForm.isFullTank)}
                      onChange={(e) => setRefuelForm((prev) => ({ ...prev, isFullTank: e.target.value === 'true' }))}
                    >
                      <option value="true">Full tank</option>
                      <option value="false">Partial fill</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Station</Label>
                    <Input list="fp-stations" value={refuelForm.station} onChange={(e) => setRefuelForm((prev) => ({ ...prev, station: e.target.value }))} />
                    <datalist id="fp-stations">
                      {stationSuggestions.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                </div>
                <div>
                  <Label>Note</Label>
                  <Input value={refuelForm.note} onChange={(e) => setRefuelForm((prev) => ({ ...prev, note: e.target.value }))} />
                </div>
                {/* Feature 7: fuel type selector for multi-fuel vehicles */}
                {vehicleFuelTypes.length > 1 && (
                  <div>
                    <Label>Fuel type</Label>
                    <Select
                      value={refuelForm.fuelType || vehicleFuelTypes[0]}
                      onChange={(e) => setRefuelForm((prev) => ({ ...prev, fuelType: e.target.value }))}
                    >
                      {vehicleFuelTypes.map((f) => (
                        <option key={f} value={f}>{FUEL_LABELS[f]}</option>
                      ))}
                    </Select>
                  </div>
                )}
                {/* Feature 8: trip / purpose tag */}
                <div>
                  <Label>Trip tag (optional)</Label>
                  <Select
                    value={refuelForm.tripTag}
                    onChange={(e) => setRefuelForm((prev) => ({ ...prev, tripTag: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {customTripTags.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                {/* Receipt photo (feature 14) */}
                <div>
                  <Label>Receipt photo</Label>
                  {refuelForm.photo ? (
                    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                      <img src={refuelForm.photo} alt="Receipt" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.borderLight}` }} />
                      <button
                        type="button"
                        onClick={() => setRefuelForm((prev) => ({ ...prev, photo: null }))}
                        style={{ position: 'absolute', top: 6, right: 6, background: COLORS.danger, border: 'none', borderRadius: 999, color: '#fff', width: 22, height: 22, fontSize: 12, cursor: 'pointer', lineHeight: '22px', padding: 0 }}
                        title="Remove photo"
                      >✕</button>
                    </div>
                  ) : (
                    <Input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        readPhotoFile(e.target.files?.[0], (data) => setRefuelForm((prev) => ({ ...prev, photo: data })));
                        e.target.value = '';
                      }}
                    />
                  )}
                  {photoError && (
                    <div style={{ color: COLORS.danger, fontSize: 12, marginTop: 6 }}>{photoError}</div>
                  )}
                </div>
                {formError && (
                  <div role="alert" style={{ color: COLORS.danger, fontSize: 13, background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}44`, borderRadius: 10, padding: '8px 12px' }}>
                    {formError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <Button type="submit" style={{ flex: 1 }}>Save refuel</Button>
                  {sortedHistory.length > 0 && (
                    <Button type="button" variant="secondary" onClick={duplicateLastRefuel} title="Pre-fill station and price from last entry">
                      ♻️ Duplicate last
                    </Button>
                  )}
                </div>
              </form>
            </Card>

            {/* Refuel history (feature 10 filter + feature 11 pagination + feature 1 sort + feature 17 bulk-delete) */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: historyFilterOpen ? 12 : 6 }}>
                <SectionTitle icon="📋" style={{ margin: 0 }}>Refuel history</SectionTitle>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {historyFiltersActive && (
                    <Button type="button" variant="ghost" size="small" onClick={clearHistoryFilters}>✕ Clear</Button>
                  )}
                  {/* Feature 17: bulk select toggle */}
                  <Button
                    type="button"
                    variant={bulkSelectMode ? 'danger' : 'ghost'}
                    size="small"
                    onClick={() => { setBulkSelectMode((b) => !b); setBulkSelectedIds(new Set()); }}
                    title="Select multiple for bulk delete"
                  >
                    {bulkSelectMode ? '✕ Cancel' : '☑'}
                  </Button>
                  <Button
                    type="button"
                    variant={historyFilterOpen ? 'primary' : 'secondary'}
                    size="small"
                    onClick={() => setHistoryFilterOpen((o) => !o)}
                  >
                    🔍 Filter
                  </Button>
                </div>
              </div>

              {/* Feature 1: sort selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>Sort:</span>
                <select
                  value={historySortBy}
                  onChange={(e) => setHistorySortBy(e.target.value)}
                  style={{ fontSize: 12, background: COLORS.surfaceElevated, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '4px 8px', outline: 'none', cursor: 'pointer' }}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="cost_desc">Highest cost</option>
                  <option value="cost_asc">Lowest cost</option>
                  <option value="liters_desc">Most liters</option>
                  <option value="liters_asc">Fewest liters</option>
                </select>
              </div>

              {historyFilterOpen && (
                <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                  <div>
                    <Label>Search station / note</Label>
                    <Input
                      placeholder="e.g. Shell, highway…"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                  </div>
                  <div style={DATE_PAIR_GRID}>
                    <div>
                      <Label>Date from</Label>
                      <Input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label>Date to</Label>
                      <Input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <Label>Cost min ({currency})</Label>
                      <Input type="number" step="0.01" placeholder="0" value={historyCostMin} onChange={(e) => setHistoryCostMin(e.target.value)} />
                    </div>
                    <div>
                      <Label>Cost max ({currency})</Label>
                      <Input type="number" step="0.01" placeholder="∞" value={historyCostMax} onChange={(e) => setHistoryCostMax(e.target.value)} />
                    </div>
                  </div>
                  {/* Feature 28 / Feature 5: filter by trip tag */}
                  <div>
                    <Label>Trip tag</Label>
                    <Select value={historyTagFilter} onChange={(e) => setHistoryTagFilter(e.target.value)}>
                      <option value="">All tags</option>
                      {customTripTags.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  </div>
                  {historyFiltersActive && (
                    <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                      Showing {filteredHistory.length} of {vehicleRefuels.length} refuels
                    </div>
                  )}
                </div>
              )}

              {!vehicleRefuels.length && <EmptyState icon="⛽" message="No refuel entries yet. Add your first fill-up above!" />}
              {vehicleRefuels.length > 0 && filteredHistory.length === 0 && (
                <EmptyState icon="🔍" message="No refuels match the current filter." />
              )}
              <div style={{ display: 'grid', gap: 8 }}>
                {pagedHistory.map((entry) => (
                    <RefuelRow
                      key={entry.id}
                      entry={entry}
                      currency={currency}
                      consumption={consumptionByKey.get(`${entry.odometer}_${entry.date}`) ?? null}
                      onEdit={openEditRefuel}
                      onDelete={handleDeleteRefuel}
                      warnings={refuelWarnings.get(entry.id)}
                      bulkSelectMode={bulkSelectMode}
                      isSelected={bulkSelectedIds.has(entry.id)}
                      onToggleSelect={(id) => setBulkSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        return next;
                      })}
                    />
                  ))}
              </div>
              {/* Feature 17: bulk delete action bar */}
              {bulkSelectMode && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, padding: '10px 0 4px', borderTop: `1px solid ${COLORS.border}` }}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    onClick={() => setBulkSelectedIds(new Set(pagedHistory.map((r) => r.id)))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="small"
                    disabled={bulkSelectedIds.size === 0}
                    onClick={handleBulkDelete}
                    style={{ flex: 1 }}
                  >
                    🗑️ Delete {bulkSelectedIds.size > 0 ? `${bulkSelectedIds.size} selected` : 'selected'}
                  </Button>
                </div>
              )}
              {hasMoreHistory && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setHistoryPage((p) => p + 1)}
                  style={{ width: '100%', marginTop: 8 }}
                >
                  Load more ({filteredHistory.length - pagedHistory.length} remaining)
                </Button>
              )}
            </Card>

            {/* Feature 18: Odometer tracker */}
            <Card>
              <SectionTitle icon="🛣️">Odometer readings</SectionTitle>
              <form onSubmit={addOdometerReading} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={odometerForm.date} onChange={(e) => setOdometerForm((prev) => ({ ...prev, date: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Odometer (km)</Label>
                    <Input type="number" value={odometerForm.odometer} onChange={(e) => setOdometerForm((prev) => ({ ...prev, odometer: e.target.value }))} />
                  </div>
                </div>
                <Button type="submit" size="small" variant="secondary">+ Log reading</Button>
              </form>
              {!vehicleOdometerReadings.length && <div style={{ color: COLORS.textMuted, fontSize: 12 }}>No manual readings logged yet.</div>}
              <div style={{ display: 'grid', gap: 6 }}>
                {vehicleOdometerReadings.slice().reverse().slice(0, 10).map((r) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: COLORS.surfaceElevated, borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
                    <span>{formatDate(r.date)}</span>
                    <strong>{r.odometer.toLocaleString()} km</strong>
                    <IconButton variant="danger" onClick={() => handleDeleteOdometerReading(r.id)} title="Delete">🗑️</IconButton>
                  </div>
                ))}
              </div>
            </Card>
              </>
            )}
          </div>
        )}

        {/* ═══ STATS TAB ═══ */}
        {selectedVehicle && activeTab === 'stats' && (
          <div className={`fp-tab-enter-${tabAnimDir}`} style={{ display: 'grid', gap: 14 }}>

            {/* ── Date range filter ── */}
            <Card style={{ padding: '12px 14px' }}>
              <SectionTitle icon="📅">Date range filter</SectionTitle>
              <div style={{ ...DATE_PAIR_GRID, marginBottom: 8 }}>
                <div>
                  <Label>From</Label>
                  <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                </div>
                <div>
                  <Label>To</Label>
                  <Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                </div>
              </div>
              {(rangeFrom || rangeTo) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: COLORS.textSecondary }}>
                    Showing {filteredRefuels.length} of {vehicleRefuels.length} refuels
                  </span>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => { setRangeFrom(''); setRangeTo(''); }}
                  >
                    ✕ Clear filter
                  </Button>
                </div>
              )}
            </Card>

            {/* ── Summary row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <StatBox label="Refuels" value={filteredStats.refuelCount} icon="⛽" accent={COLORS.accent} />
              <StatBox label="Total Cost" value={`${fmt(filteredStats.totalCost, 0)} ${currency}`} icon="💰" accent={COLORS.warning} />
              <StatBox label="Distance" value={`${fmt(filteredStats.totalDistance, 0)} km`} icon="🛣️" accent={COLORS.success} />
            </div>

            {/* Feature 13: share stats button */}
            {stats.refuelCount > 0 && (
              <Button type="button" variant="secondary" onClick={shareStats} style={{ width: '100%' }}>
                📤 Share stats
              </Button>
            )}

            {/* Feature 6: all-time lifetime summary panel */}
            {stats.refuelCount > 1 && (
              <Card style={{ background: `linear-gradient(135deg, ${COLORS.accent}12, ${COLORS.success}08)`, border: `1px solid ${COLORS.accent}22` }}>
                <SectionTitle icon="🏁">All-time lifetime stats</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <StatBox label="Total km driven" value={`${fmt(stats.totalDistance, 0)} km`} icon="🛣️" accent={COLORS.accent} />
                  <StatBox label="Total cost" value={`${fmt(stats.totalCost, 0)} ${currency}`} icon="💰" accent={COLORS.warning} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <StatBox label="Total fuel" value={`${fmt(stats.totalLiters, 0)} L`} icon="⛽" accent={COLORS.accentLight} />
                  {/* Feature 7: CO₂ summary */}
                  <StatBox
                    label="Est. CO₂"
                    value={stats.totalCo2 > 0 ? `${fmt(stats.totalCo2, 0)} kg` : '-'}
                    icon="🌱"
                    accent={COLORS.success}
                    sub={stats.totalCo2 > 0 ? `≈ ${fmt(stats.totalCo2 / 1000, 2)} t` : undefined}
                  />
                </div>
                {stats.firstEntry && stats.lastEntry && (
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${COLORS.borderLight}` }}>
                    From {formatDate(stats.firstEntry.date)} to {formatDate(stats.lastEntry.date)}
                    {' '}· {stats.refuelCount} fill-ups
                  </div>
                )}
              </Card>
            )}

            {/* ── Fuel Insights card ── */}
            {filteredStats.consumptionSeries.length > 0 && (
              <Card>
                <SectionTitle icon="💡">Fuel Insights</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <StatBox
                    label="Best Fill"
                    value={`${fmt(filteredStats.bestConsumption)} l/100km`}
                    icon="🏆"
                    accent={COLORS.success}
                  />
                  <StatBox
                    label="Worst Fill"
                    value={`${fmt(filteredStats.worstConsumption)} l/100km`}
                    icon="⚠️"
                    accent={COLORS.danger}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <StatBox
                    label="Avg dist/fill"
                    value={filteredStats.avgDistancePerFill > 0 ? `${fmt(filteredStats.avgDistancePerFill, 0)} km` : '-'}
                    icon="📏"
                    accent={COLORS.accentLight}
                  />
                  <StatBox
                    label="Total Fuel"
                    value={`${fmt(filteredStats.totalLiters, 0)} L`}
                    icon="⛽"
                    accent={COLORS.accent}
                  />
                </div>
                {/* Feature 7: CO₂ per filtered period */}
                {filteredStats.totalCo2 > 0 && (
                  <div style={{ marginTop: 10, background: `${COLORS.success}0d`, border: `1px solid ${COLORS.success}22`, borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🌱</span>
                    <div>
                      <span style={{ fontSize: 13, color: COLORS.success, fontWeight: 700 }}>
                        Est. CO₂: {fmt(filteredStats.totalCo2, 0)} kg
                      </span>
                      <span style={{ fontSize: 12, color: COLORS.textMuted, marginLeft: 8 }}>
                        ({fmt(filteredStats.totalCo2 / Math.max(1, filteredStats.totalLiters), 2)} kg/L avg)
                      </span>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* ── Last fill vs average (feature 6) ── */}
            {filteredStats.consumptionSeries.length >= 2 && (() => {
              const last = filteredStats.lastConsumption;
              const avg = filteredStats.avgConsumption;
              const diffPct = avg > 0 ? ((last - avg) / avg) * 100 : 0;
              const better = last <= avg;
              const arrow = better ? '▼' : '▲';
              const trendColor = better ? COLORS.success : COLORS.danger;
              const lastPrice = filteredStats.priceSeries.length
                ? filteredStats.priceSeries[filteredStats.priceSeries.length - 1].value
                : 0;
              const avgPrice = filteredStats.priceSeries.length
                ? filteredStats.priceSeries.reduce((s, x) => s + x.value, 0) / filteredStats.priceSeries.length
                : 0;
              const priceDiff = avgPrice > 0 ? ((lastPrice - avgPrice) / avgPrice) * 100 : 0;
              const priceBetter = lastPrice <= avgPrice;
              return (
                <Card style={{ background: `${trendColor}0d`, border: `1px solid ${trendColor}33` }}>
                  <SectionTitle icon="📊">Last fill vs average</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: COLORS.surfaceElevated, borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Consumption</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: trendColor }}>{arrow} {fmt(Math.abs(diffPct), 1)}%</div>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 3 }}>
                        Last: <strong style={{ color: COLORS.textPrimary }}>{fmt(last)} l/100</strong>
                      </div>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                        Avg: {fmt(avg)} l/100
                      </div>
                    </div>
                    <div style={{ background: COLORS.surfaceElevated, borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Price / L</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: priceBetter ? COLORS.success : COLORS.danger }}>
                        {priceBetter ? '▼' : '▲'} {fmt(Math.abs(priceDiff), 1)}%
                      </div>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 3 }}>
                        Last: <strong style={{ color: COLORS.textPrimary }}>{fmt(lastPrice, 2)} {currency}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                        Avg: {fmt(avgPrice, 2)} {currency}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })()}

            {/* ── Consumption chart (with optional goal line) ── */}
            <ChartCard
              key={`consumption-${theme}`}
              title="Consumption trend (l/100 km)"
              labels={filteredStats.consumptionSeries.map((x) => x.date.slice(5))}
              values={filteredStats.consumptionSeries.map((x) => Number(fmt(x.value, 2)))}
              type="line"
              color={COLORS.accent}
              unit="l/100km"
              goalLine={consumptionTarget > 0 ? { value: consumptionTarget, label: `Target ${consumptionTarget} l/100`, color: COLORS.danger } : undefined}
            />
            <ChartCard
              key={`monthly-cost-${theme}`}
              title="Monthly fuel cost"
              labels={filteredStats.monthlyCost.map((x) => x.month.slice(2))}
              values={filteredStats.monthlyCost.map((x) => Number(fmt(x.value, 2)))}
              type="bar"
              color={COLORS.warning}
              unit={currency}
            />

            {/* ── Fuel price chart with cheapest/costliest annotations (feature 8) ── */}
            {(() => {
              const prices = filteredStats.priceSeries.map((x) => x.value);
              if (!prices.length) return (
                <ChartCard
                  key={`price-history-${theme}`}
                  title="Fuel price history"
                  labels={[]}
                  values={[]}
                  type="line"
                  color={COLORS.success}
                  unit={`${currency}/L`}
                />
              );
              const minPrice = Math.min(...prices);
              const maxPrice = Math.max(...prices);
              const pointColors = prices.map((v) => {
                if (v === minPrice) return COLORS.success;
                if (v === maxPrice) return COLORS.danger;
                return null; // normal points use the chart's default color
              });
              return (
                <>
                  <ChartCard
                    key={`price-history-${theme}`}
                    title="Fuel price history"
                    labels={filteredStats.priceSeries.map((x) => x.date.slice(5))}
                    values={prices.map((v) => Number(fmt(v, 2)))}
                    type="line"
                    color={COLORS.success}
                    unit={`${currency}/L`}
                    pointColors={pointColors}
                  />
                  {prices.length >= 2 && (
                    <div style={{ display: 'flex', gap: 16, paddingLeft: 4, marginTop: -6 }}>
                      <span style={{ fontSize: 12, color: COLORS.success, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS.success, display: 'inline-block' }} />
                        Cheapest: {fmt(minPrice, 2)} {currency}/L
                      </span>
                      <span style={{ fontSize: 12, color: COLORS.danger, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS.danger, display: 'inline-block' }} />
                        Costliest: {fmt(maxPrice, 2)} {currency}/L
                      </span>
                    </div>
                  )}
                </>
              );
            })()}

            <ChartCard
              key={`monthly-dist-${theme}`}
              title="Distance per month"
              labels={filteredStats.monthlyDistance.map((x) => x.month.slice(2))}
              values={filteredStats.monthlyDistance.map((x) => Number(fmt(x.value, 0)))}
              type="bar"
              color={COLORS.accent}
              unit="km"
            />

            {/* Feature 8: cost-per-km trend chart */}
            {costPerKmSeries.length >= 2 && (
              <ChartCard
                key={`cost-per-km-${theme}`}
                title={`Cost per km (${currency}/km)`}
                labels={costPerKmSeries.map((x) => x.date.slice(5))}
                values={costPerKmSeries.map((x) => Number(fmt(x.value, 3)))}
                type="line"
                color={COLORS.warning}
                unit={`${currency}/km`}
              />
            )}

            {/* Feature 9: yearly comparison bar chart */}
            {yearlyData.length >= 2 && (
              <>
                <ChartCard
                  key={`yearly-cost-${theme}`}
                  title="Cost by year"
                  labels={yearlyData.map((y) => y.year)}
                  values={yearlyData.map((y) => Number(fmt(y.cost, 0)))}
                  type="bar"
                  color={COLORS.accent}
                  unit={currency}
                />
                <ChartCard
                  key={`yearly-liters-${theme}`}
                  title="Fuel by year (L)"
                  labels={yearlyData.map((y) => y.year)}
                  values={yearlyData.map((y) => Number(fmt(y.liters, 0)))}
                  type="bar"
                  color={COLORS.accentLight}
                  unit="L"
                />
              </>
            )}

            {/* Feature 28: cost by trip tag breakdown */}
            {costByTag.length > 0 && (
              <Card>
                <SectionTitle icon="🏷️">Cost by trip tag</SectionTitle>
                <div style={{ display: 'grid', gap: 6 }}>
                  {costByTag.map(([tag, total]) => (
                    <div key={tag} style={{ display: 'flex', justifyContent: 'space-between', background: COLORS.surfaceElevated, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                      <span style={{ color: COLORS.accentLight }}>{tag}</span>
                      <strong style={{ color: COLORS.textPrimary }}>{fmt(total, 2)} {currency}</strong>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ═══ MAINTENANCE TAB ═══ */}
        {selectedVehicle && activeTab === 'maintenance' && (
          <div className={`fp-tab-enter-${tabAnimDir}`} style={{ display: 'grid', gap: 14 }}>

            {/* Feature 2: Quick stats summary banner */}
            {vehicleMaintenance.length > 0 && (() => {
              const allStatuses = vehicleMaintenance.map((item) => getMaintenanceStatus(item, currentOdometer));
              const dueCount = allStatuses.filter((s) => s.key === 'due').length;
              // Counted 'soon' before, a key `getMaintenanceStatus` never returns,
              // so this tile always read zero.
              const soonCount = allStatuses.filter((s) => s.key === 'upcoming').length;
              const upcoming = getNextDueItem(vehicleMaintenance, currentOdometer);
              return (
                <div style={{
                  background: dueCount > 0 ? `${COLORS.danger}18` : `${COLORS.accent}10`,
                  border: `1px solid ${dueCount > 0 ? `${COLORS.danger}44` : `${COLORS.accent}33`}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 10,
                  textAlign: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: dueCount > 0 ? COLORS.danger : COLORS.success }}>
                      {dueCount}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Overdue</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: soonCount > 0 ? COLORS.warning : COLORS.textMuted }}>
                      {soonCount}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Due soon</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: COLORS.accent }}>
                      {upcoming ? `${upcoming.status.daysLeft}d` : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {upcoming ? `Next: ${upcoming.item.label.slice(0, 10)}` : 'All clear'}
                    </div>
                  </div>
                </div>
              );
            })()}

            <Card>
              <SectionTitle icon="🔔">Maintenance reminders</SectionTitle>
              {!vehicleMaintenance.length && <EmptyState icon="🔧" message="No maintenance reminders yet. Add one below!" />}
              <div style={{ display: 'grid', gap: 8 }}>
                {vehicleMaintenance.map((item) => {
                  const status = getMaintenanceStatus(item, currentOdometer);
                  const dueAtKm = item.intervalKm > 0 ? item.lastDoneOdometer + item.intervalKm : null;
                  return (
                    <div key={item.id} style={{ background: COLORS.surfaceElevated, borderRadius: 12, padding: 12, border: `1px solid ${status.key === 'due' ? `${COLORS.danger}44` : COLORS.borderLight}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong>{item.label}</strong>
                          <StatusPill color={statusColor(status.key)} label={status.label} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <IconButton onClick={() => openEditMaint(item)} title="Edit">✏️</IconButton>
                          <IconButton onClick={() => handleDeleteMaint(item.id)} title="Delete" variant="danger">🗑️</IconButton>
                        </div>
                      </div>
                      <div style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 1.6 }}>
                        <div>Last: {formatDate(item.lastDoneAt)} · {num(item.lastDoneOdometer).toLocaleString()} km</div>
                        <div>Due: {item.intervalDays ? `${item.intervalDays} days` : '-'} · {dueAtKm ? `${dueAtKm.toLocaleString()} km` : '-'}</div>
                        {(status.daysLeft !== null || status.kmLeft !== null) && (
                          <div style={{ color: statusColor(status.key) }}>
                            {[
                              status.daysLeft !== null
                                ? status.daysLeft >= 0 ? `${status.daysLeft} days left` : `${Math.abs(status.daysLeft)} days overdue`
                                : null,
                              status.kmLeft !== null
                                ? status.kmLeft >= 0 ? `${status.kmLeft.toLocaleString()} km left` : `${Math.abs(status.kmLeft).toLocaleString()} km overdue`
                                : null,
                            ].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {item.cost > 0 && <div>Cost: {fmt(item.cost)} {currency}</div>}
                      </div>
                      {item.note && <div style={{ color: COLORS.textMuted, marginTop: 4, fontSize: 12, fontStyle: 'italic' }}>💬 {item.note}</div>}
                      {/* Feature 15: service history log */}
                      {(item.history || []).length > 0 && (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ fontSize: 12, color: COLORS.accent, cursor: 'pointer', userSelect: 'none' }}>
                            📜 Service history ({item.history.length} entries)
                          </summary>
                          <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                            {item.history.slice().reverse().map((h, i) => (
                              <div key={`${h.date}-${h.odometer}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: COLORS.textSecondary, background: COLORS.bg, borderRadius: 6, padding: '4px 8px' }}>
                                <span>{formatDate(h.date)}</span>
                                <span>{num(h.odometer).toLocaleString()} km</span>
                                {h.cost > 0 && <span>{fmt(h.cost)} {currency}</span>}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {/* Offered for every item: a service can be logged before it
                          falls due, and the old 'soon' check never matched. */}
                      <Button
                        variant={status.key === 'ok' ? 'secondary' : 'success'}
                        size="small"
                        style={{ marginTop: 8, width: '100%' }}
                        onClick={() => openMarkDone(item)}
                      >
                        ✓ Mark as done…
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Feature 17: cost totals per type */}
            {maintCostByType.length > 0 && (
              <Card>
                <SectionTitle icon="💰">Total cost by type</SectionTitle>
                <div style={{ display: 'grid', gap: 6 }}>
                  {maintCostByType.map(([label, total]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', background: COLORS.surfaceElevated, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                      <span>{label}</span>
                      <strong style={{ color: COLORS.warning }}>{fmt(total, 2)} {currency}</strong>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', fontSize: 13, fontWeight: 700, color: COLORS.textPrimary }}>
                    <span>Total</span>
                    <span style={{ color: COLORS.accent }}>{fmt(maintCostByType.reduce((s, [, v]) => s + v, 0), 2)} {currency}</span>
                  </div>
                </div>
              </Card>
            )}

            <Card>
              <SectionTitle icon="➕">Add maintenance</SectionTitle>
              <form onSubmit={addMaintenance} style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Type</Label>
                    <Select
                      value={maintForm.type}
                      onChange={(e) => {
                        const option = MAINT_TYPES.find((x) => x.value === e.target.value);
                        setMaintForm((prev) => ({ ...prev, type: e.target.value, label: option?.label || prev.label }));
                      }}
                    >
                      {MAINT_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Label</Label>
                    <Input value={maintForm.label} onChange={(e) => setMaintForm((prev) => ({ ...prev, label: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Last done date</Label>
                    <Input type="date" value={maintForm.lastDoneAt} onChange={(e) => setMaintForm((prev) => ({ ...prev, lastDoneAt: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Last done odometer</Label>
                    <Input type="number" value={maintForm.lastDoneOdometer} onChange={(e) => setMaintForm((prev) => ({ ...prev, lastDoneOdometer: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Interval km</Label>
                    <Input type="number" value={maintForm.intervalKm} onChange={(e) => setMaintForm((prev) => ({ ...prev, intervalKm: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Interval days</Label>
                    <Input type="number" value={maintForm.intervalDays} onChange={(e) => setMaintForm((prev) => ({ ...prev, intervalDays: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Cost ({currency})</Label>
                    <Input type="number" value={maintForm.cost} onChange={(e) => setMaintForm((prev) => ({ ...prev, cost: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Note</Label>
                  <Input value={maintForm.note} onChange={(e) => setMaintForm((prev) => ({ ...prev, note: e.target.value }))} />
                </div>
                <Button type="submit" style={{ width: '100%', marginTop: 2 }}>Save reminder</Button>
              </form>
            </Card>
          </div>
        )}

        {/* ═══ SETTINGS TAB ═══ */}
        {selectedVehicle && activeTab === 'settings' && (
          <div className={`fp-tab-enter-${tabAnimDir}`} style={{ display: 'grid', gap: 14 }}>
            <Card>
              <SectionTitle icon="🚗">Add vehicle</SectionTitle>
              <form onSubmit={addVehicle} style={{ display: 'grid', gap: 10 }}>
                <div>
                  <Label>Name</Label>
                  <Input
                    value={vehicleForm.name}
                    onChange={(e) => setVehicleForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="VW Golf"
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Year</Label>
                    <Input type="number" value={vehicleForm.year} onChange={(e) => setVehicleForm((prev) => ({ ...prev, year: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Tank Size</Label>
                    <Input type="number" value={vehicleForm.tankSize} onChange={(e) => setVehicleForm((prev) => ({ ...prev, tankSize: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <Label>Primary fuel</Label>
                    <Select value={vehicleForm.fuelType} onChange={(e) => setVehicleForm((prev) => ({ ...prev, fuelType: e.target.value }))}>
                      <option value="diesel">Diesel</option>
                      <option value="petrol">Petrol</option>
                      <option value="lpg">LPG</option>
                      <option value="ev">EV</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={vehicleForm.currency} onChange={(e) => setVehicleForm((prev) => ({ ...prev, currency: e.target.value }))}>
                      {CURRENCIES.map((cur) => (
                        <option key={cur} value={cur}>{cur}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                {/* Feature 7: secondary fuel type */}
                <div>
                  <Label>Secondary fuel (optional)</Label>
                  <Select
                    value={vehicleForm.secondaryFuelType}
                    onChange={(e) => setVehicleForm((prev) => ({ ...prev, secondaryFuelType: e.target.value }))}
                  >
                    <option value="">None</option>
                    {FUEL_TYPES.filter((f) => f !== vehicleForm.fuelType).map((f) => (
                      <option key={f} value={f}>{FUEL_LABELS[f]}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Vehicle color</Label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    {VEHICLE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setVehicleForm((prev) => ({ ...prev, color: c }))}
                        style={{ width: 28, height: 28, borderRadius: 999, background: c, border: vehicleForm.color === c ? `3px solid ${COLORS.textPrimary}` : `2px solid transparent`, cursor: 'pointer', padding: 0 }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
                <Button type="submit" style={{ width: '100%', marginTop: 2 }}>Add vehicle</Button>
              </form>
            </Card>

            <Card>
              <SectionTitle icon="⚙">Current vehicle settings</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                {selectedVehicle.color && <div style={{ width: 14, height: 14, borderRadius: 999, background: selectedVehicle.color }} />}
                <span style={{ color: COLORS.textSecondary }}>{selectedVehicle.name}</span>
                <FuelBadge fuelType={selectedVehicle.fuelType} />
              </div>
              <Label>Currency</Label>
              <Select value={currency} onChange={(e) => updateVehicleCurrency(e.target.value)} style={{ marginBottom: 10 }}>
                {CURRENCIES.map((cur) => (
                  <option key={cur} value={cur}>{cur}</option>
                ))}
              </Select>
              {/* Feature 19: vehicle color */}
              <Label>Vehicle color</Label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                {VEHICLE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateVehicleColor(c)}
                    style={{ width: 28, height: 28, borderRadius: 999, background: c, border: (selectedVehicle.color || VEHICLE_COLORS[0]) === c ? `3px solid ${COLORS.textPrimary}` : `2px solid transparent`, cursor: 'pointer', padding: 0 }}
                    title={c}
                  />
                ))}
              </div>
            </Card>

            <Card>
              {/* Feature 4: per-vehicle consumption target */}
              <SectionTitle icon="🎯">Consumption target</SectionTitle>
              <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Set a target L/100 km for <strong style={{ color: COLORS.textPrimary }}>{selectedVehicle.name}</strong> — a dashed reference line appears on the chart.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  type="number"
                  step="0.1"
                  placeholder={`Current avg: ${fmt(stats.avgConsumption)} l/100`}
                  value={consumptionTargetInput}
                  onChange={(e) => setConsumptionTargetInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const v = num(consumptionTargetInput);
                    setVehicleConsumptionTargets((prev) => ({
                      ...prev,
                      [selectedVehicleId]: v > 0 ? v : 0,
                    }));
                    setConsumptionTargetInput('');
                  }}
                >
                  Set
                </Button>
              </div>
              {consumptionTarget > 0 && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: COLORS.textSecondary }}>
                    Target: <strong style={{ color: COLORS.danger }}>{consumptionTarget} l/100 km</strong>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    onClick={() => setVehicleConsumptionTargets((prev) => ({ ...prev, [selectedVehicleId]: 0 }))}
                  >
                    ✕ Remove
                  </Button>
                </div>
              )}
            </Card>

            {/* Feature 5: Editable trip tags */}
            <Card>
              <SectionTitle icon="🏷️">Trip tags</SectionTitle>
              <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Manage the trip tag list used when logging refuels.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Input
                  placeholder="New tag name…"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const tag = newTagInput.trim();
                    if (tag && !customTripTags.includes(tag)) {
                      setCustomTripTags((prev) => [...prev, tag]);
                    }
                    setNewTagInput('');
                  }}
                >
                  + Add
                </Button>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {customTripTags.map((tag) => (
                  <div key={tag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: COLORS.surfaceElevated, borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 13, color: COLORS.accentLight }}>🏷 {tag}</span>
                    <IconButton
                      variant="danger"
                      title="Remove tag"
                      onClick={() => setCustomTripTags((prev) => prev.filter((t) => t !== tag))}
                    >
                      🗑️
                    </IconButton>
                  </div>
                ))}
                {customTripTags.length === 0 && (
                  <div style={{ fontSize: 12, color: COLORS.textMuted }}>No tags. Add one above.</div>
                )}
              </div>
              {customTripTags.join(',') !== DEFAULT_TRIP_TAGS.join(',') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  onClick={() => setCustomTripTags(DEFAULT_TRIP_TAGS)}
                  style={{ marginTop: 8 }}
                >
                  ↺ Reset to defaults
                </Button>
              )}
            </Card>

            {/* Manage vehicles */}
            {vehicles.length > 1 && (
              <Card>
                <SectionTitle icon="🗂️">Manage vehicles</SectionTitle>
                <div style={{ display: 'grid', gap: 8 }}>
                  {vehicles.map((v) => (
                    <div
                      key={v.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: COLORS.surfaceElevated,
                        borderRadius: 10,
                        padding: '8px 12px',
                        border: `1px solid ${v.id === selectedVehicleId ? COLORS.accent + '44' : COLORS.borderLight}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{v.name}</span>
                        {v.year > 0 && <span style={{ color: COLORS.textMuted, fontSize: 12 }}>({v.year})</span>}
                        <FuelBadge fuelType={v.fuelType} />
                      </div>
                      <IconButton
                        onClick={() => setDeleteVehicleId(v.id)}
                        title="Delete vehicle"
                        variant="danger"
                      >
                        🗑️
                      </IconButton>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <SectionTitle icon="💾">Export / Import</SectionTitle>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Button type="button" onClick={exportData} style={{ flex: 1 }}>📤 JSON</Button>
                <Button type="button" variant="secondary" onClick={exportCSV} style={{ flex: 1 }} disabled={!vehicleRefuels.length}>📊 CSV</Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setConfirmClearAll(true)}
                  style={{ flex: 1 }}
                >
                  🗑️ Clear
                </Button>
              </div>
              {/* Feature 20: auto-backup */}
              <Button type="button" variant="secondary" onClick={autoBackupToDevice} style={{ width: '100%', marginBottom: 10 }}>
                💾 Save backup to device storage
              </Button>
              <Label>Import backup (JSON)</Label>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>
                You can choose to <strong>replace all</strong> data or <strong>merge</strong> (append new records) after selecting the file.
              </div>
              <Input
                type="file"
                accept="application/json"
                onChange={(e) => { setImportError(''); importData(e.target.files?.[0]); e.target.value = ''; }}
              />
              {importError && <div style={{ color: COLORS.danger, marginTop: 6, fontSize: 13 }}>{importError}</div>}
              {/* Feature 5: Fuelio CSV import */}
              <div style={{ marginTop: 12 }}>
                <Label>Import from Fuelio CSV</Label>
                <div style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 6 }}>
                  Supports standard Fuelio CSV exports. Vehicles are created/matched by name.
                </div>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    setImportCSVError('');
                    importCSVFile(e.target.files?.[0]);
                    // Cleared so re-picking the same file fires change again.
                    e.target.value = '';
                  }}
                />
                {importCSVError && <div style={{ color: COLORS.danger, marginTop: 6, fontSize: 13 }}>{importCSVError}</div>}
              </div>
            </Card>

            {/* Feature 16: notification settings */}
            <Card>
              <SectionTitle icon="🔔">Maintenance notifications</SectionTitle>
              <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Get notified before a maintenance item is due. Requires notification permission.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Input
                  type="number"
                  min="1"
                  max="90"
                  placeholder="Days before due"
                  value={notifDaysInput}
                  onChange={(e) => setNotifDaysInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const v = num(notifDaysInput);
                    if (v > 0) { setNotifDaysBefore(v); setNotifDaysInput(''); }
                  }}
                >
                  Set
                </Button>
              </div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>
                Notify <strong style={{ color: COLORS.textPrimary }}>{notifDaysBefore} days</strong> before due date
              </div>
              <Button type="button" variant="secondary" onClick={scheduleMaintenanceNotifications} style={{ width: '100%' }}>
                📲 Schedule notifications now
              </Button>
              {notifStatus && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: notifStatus.tone === 'error' ? COLORS.danger : notifStatus.tone === 'success' ? COLORS.success : COLORS.textSecondary,
                  }}
                >
                  {notifStatus.message}
                </div>
              )}
            </Card>

            {/* Feature 24: refuel interval reminder settings */}
            <Card>
              <SectionTitle icon="⏱️">Refuel interval reminder</SectionTitle>
              <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Show a reminder banner on the dashboard if you haven&apos;t logged a refuel in this many days.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Input
                  type="number"
                  min="1"
                  placeholder="Days"
                  value={refuelIntervalInput}
                  onChange={(e) => setRefuelIntervalInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const v = num(refuelIntervalInput);
                    if (v > 0) { setRefuelIntervalDays(v); setRefuelIntervalInput(''); }
                  }}
                >
                  Set
                </Button>
              </div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary }}>
                Remind after <strong style={{ color: COLORS.textPrimary }}>{refuelIntervalDays} days</strong> without a refuel
              </div>
            </Card>

            {/* Feature 25: low-fuel / range warning settings */}
            <Card>
              <SectionTitle icon="🪫">Low-range warning</SectionTitle>
              <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Show a warning when your estimated remaining range drops below this threshold (based on average distance per fill-up).
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Input
                  type="number"
                  min="1"
                  placeholder="km threshold"
                  value={lowFuelThresholdInput}
                  onChange={(e) => setLowFuelThresholdInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const v = num(lowFuelThresholdInput);
                    if (v > 0) { setLowFuelThresholdKm(v); setLowFuelThresholdInput(''); }
                  }}
                >
                  Set
                </Button>
              </div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary }}>
                Warn when estimated range {'<'} <strong style={{ color: COLORS.textPrimary }}>{lowFuelThresholdKm} km</strong>
              </div>
              {estimatedRemainingRange !== null && (
                <div style={{ marginTop: 8, fontSize: 12, color: estimatedRemainingRange < lowFuelThresholdKm ? COLORS.danger : COLORS.success }}>
                  Current estimate: ~{estimatedRemainingRange} km remaining
                </div>
              )}
            </Card>

            {/* Feature 26: monthly fuel budget */}
            <Card>
              <SectionTitle icon="💰">Monthly fuel budget</SectionTitle>
              <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Set a monthly spending limit. A progress bar will appear on the dashboard.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Input
                  type="number"
                  min="0"
                  step="10"
                  placeholder={`Budget in ${currency}`}
                  value={monthlyBudgetInput}
                  onChange={(e) => setMonthlyBudgetInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const v = num(monthlyBudgetInput);
                    setMonthlyBudget(v);
                    setMonthlyBudgetInput('');
                  }}
                >
                  Set
                </Button>
              </div>
              {monthlyBudget > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: COLORS.textSecondary }}>
                    Budget: <strong style={{ color: COLORS.accent }}>{fmt(monthlyBudget, 0)} {currency}/month</strong>
                  </span>
                  <Button type="button" variant="ghost" size="small" onClick={() => setMonthlyBudget(0)}>✕ Remove</Button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: COLORS.textMuted }}>No budget set</div>
              )}
            </Card>

            {/* Storage meter — the quota is the practical limit on receipt photos. */}
            <Card>
              <SectionTitle icon="🗄️">Device storage</SectionTitle>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 }}>
                <span>Used by FuelPilot</span>
                <strong style={{ color: storageUsedRatio > 0.8 ? COLORS.danger : COLORS.textPrimary }}>
                  {formatBytes(storageUsedBytes)} / ~{formatBytes(STORAGE_BUDGET_BYTES)}
                </strong>
              </div>
              <div style={{ background: COLORS.border, borderRadius: 999, height: 6, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(storageUsedRatio * 100, 100)}%`,
                    background: storageUsedRatio > 0.8 ? COLORS.danger : storageUsedRatio > 0.6 ? COLORS.warning : COLORS.success,
                    borderRadius: 999,
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8, lineHeight: 1.5 }}>
                {photoCount > 0
                  ? `${photoCount} receipt photo(s) stored. Photos dominate the budget — remove old ones if you run low.`
                  : 'Receipt photos are compressed before saving, but they still use most of this budget.'}
              </div>
              {photoCount > 0 && (
                <Button
                  type="button"
                  variant="danger"
                  size="small"
                  style={{ width: '100%', marginTop: 10 }}
                  onClick={() => setConfirmClearPhotos(true)}
                >
                  🖼️ Remove all receipt photos
                </Button>
              )}
            </Card>

            {/* Re-show onboarding */}
            <Card>
              <SectionTitle icon="ℹ️">Help</SectionTitle>
              <Button type="button" variant="secondary" onClick={() => { setOnboarded(false); setOnboardStep(0); }} style={{ width: '100%' }}>
                📖 Show onboarding again
              </Button>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 10, textAlign: 'center' }}>
                FuelPilot v{APP_VERSION} · all data stays on this device
              </div>
            </Card>

            <Card>
              <SectionTitle icon="📊">Price → cost/km reference</SectionTitle>
              <div style={{ color: COLORS.textSecondary, marginBottom: 10, fontSize: 13 }}>
                Based on avg consumption{' '}
                <strong style={{ color: COLORS.textPrimary }}>{fmt(stats.avgConsumption)} l/100 km</strong>
                {stats.isEstimatedConsumption && (
                  <span style={{ color: COLORS.textMuted, fontSize: 11, marginLeft: 4 }}>(est.)</span>
                )}
              </div>
              {stats.avgConsumption === 0 ? (
                <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                  Add at least 2 refuels to calculate cost/km
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {quickTablePrices.map((price) => {
                    const costPerKm = (stats.avgConsumption * price) / 100;
                    return (
                      <div key={price} style={{ display: 'flex', justifyContent: 'space-between', background: COLORS.surfaceElevated, padding: '8px 12px', borderRadius: 10, fontSize: 13 }}>
                        <span>{price} {currency}/L</span>
                        <strong style={{ color: COLORS.accent }}>{fmt(costPerKm)} {currency}/km</strong>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* ═══ Bottom tab bar ═══ */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          // Without this the swipeable history rows (position: relative,
          // zIndex: 1) paint over the navigation as the list scrolls past it.
          // Stays below the modal (9999) and toast (99999) layers.
          zIndex: 100,
          background: `${COLORS.surface}f0`,
          borderTop: `1px solid ${COLORS.border}`,
          padding: `6px calc(10px + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left))`,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, maxWidth: 720, margin: '0 auto' }}>
          {TAB_ITEMS.map((tab) => {
            const isActive = activeTab === tab.key;
            const showBadge = tab.key === 'maintenance' && overdueCount > 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                style={{
                  position: 'relative',
                  border: 'none',
                  background: isActive ? `${COLORS.accent}1a` : 'transparent',
                  color: isActive ? COLORS.accent : COLORS.textMuted,
                  borderRadius: 12,
                  padding: '8px 4px 6px',
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  transition: 'color 0.2s, background 0.2s',
                }}
              >
                {isActive && (
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 24,
                    height: 3,
                    background: COLORS.accent,
                    borderRadius: '0 0 4px 4px',
                  }} />
                )}
                <span style={{ fontSize: 20 }}>{tab.icon}</span>
                <span>{tab.label}</span>
                {showBadge && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: '50%',
                      transform: 'translateX(14px)',
                      background: COLORS.danger,
                      color: '#fff',
                      borderRadius: 999,
                      minWidth: 16,
                      height: 16,
                      fontSize: 9,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
                    }}
                  >
                    {overdueCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ Modals ═══ */}

      {/* Edit Refuel Modal */}
      <Modal open={Boolean(editRefuelId)} title="Edit Refuel" onClose={() => { setEditRefuelId(null); setEditRefuelForm(null); }}>
        {editRefuelForm && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <Label>Date</Label>
              <Input type="date" value={editRefuelForm.date} onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, date: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <Label>Odometer (km)</Label>
                <Input type="number" value={editRefuelForm.odometer} onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, odometer: e.target.value }))} />
              </div>
              <div>
                <Label>Liters</Label>
                <Input type="number" step="0.01" value={editRefuelForm.liters} onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, liters: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <Label>Price/L ({currency})</Label>
                <Input type="number" step="0.01" value={editRefuelForm.pricePerLiter} onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, pricePerLiter: e.target.value }))} />
              </div>
              <div>
                <Label>Tank Type</Label>
                <Select value={String(editRefuelForm.isFullTank)} onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, isFullTank: e.target.value === 'true' }))}>
                  <option value="true">Full tank</option>
                  <option value="false">Partial</option>
                </Select>
              </div>
            </div>
            <div>
              <Label>Station</Label>
              <Input list="fp-stations" value={editRefuelForm.station} onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, station: e.target.value }))} />
            </div>
            <div>
              <Label>Note</Label>
              <Input value={editRefuelForm.note} onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, note: e.target.value }))} />
            </div>
            {/* Feature 7: fuel type in edit modal */}
            {vehicleFuelTypes.length > 1 && (
              <div>
                <Label>Fuel type</Label>
                <Select
                  value={editRefuelForm.fuelType || vehicleFuelTypes[0]}
                  onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, fuelType: e.target.value }))}
                >
                  {vehicleFuelTypes.map((f) => (
                    <option key={f} value={f}>{FUEL_LABELS[f]}</option>
                  ))}
                </Select>
              </div>
            )}
            {/* Feature 8: trip tag in edit modal */}
            <div>
              <Label>Trip tag</Label>
              <Select
                value={editRefuelForm.tripTag}
                onChange={(e) => setEditRefuelForm((prev) => ({ ...prev, tripTag: e.target.value }))}
              >
                <option value="">— none —</option>
                {customTripTags.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            {/* Receipt photo in edit modal (feature 14) */}
            <div>
              <Label>Receipt photo</Label>
              {editRefuelForm.photo ? (
                <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                  <img src={editRefuelForm.photo} alt="Receipt" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.borderLight}` }} />
                  <button
                    type="button"
                    onClick={() => setEditRefuelForm((prev) => ({ ...prev, photo: null }))}
                    style={{ position: 'absolute', top: 6, right: 6, background: COLORS.danger, border: 'none', borderRadius: 999, color: '#fff', width: 22, height: 22, fontSize: 12, cursor: 'pointer', lineHeight: '22px', padding: 0 }}
                    title="Remove photo"
                  >✕</button>
                </div>
              ) : (
                <Input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    readPhotoFile(e.target.files?.[0], (data) => setEditRefuelForm((prev) => ({ ...prev, photo: data })));
                    e.target.value = '';
                  }}
                />
              )}
              {photoError && <div style={{ color: COLORS.danger, fontSize: 12, marginTop: 6 }}>{photoError}</div>}
            </div>
            {editRefuelError && (
              <div role="alert" style={{ color: COLORS.danger, fontSize: 13, background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}44`, borderRadius: 10, padding: '8px 12px' }}>
                {editRefuelError}
              </div>
            )}
            <Button onClick={saveEditRefuel} style={{ width: '100%', marginTop: 4 }}>Save changes</Button>
          </div>
        )}
      </Modal>

      {/* Edit Maintenance Modal */}
      <Modal open={Boolean(editMaintId)} title="Edit Maintenance" onClose={() => { setEditMaintId(null); setEditMaintForm(null); }}>
        {editMaintForm && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <Label>Type</Label>
                <Select
                  value={editMaintForm.type}
                  onChange={(e) => {
                    const option = MAINT_TYPES.find((x) => x.value === e.target.value);
                    setEditMaintForm((prev) => ({ ...prev, type: e.target.value, label: option?.label || prev.label }));
                  }}
                >
                  {MAINT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Label</Label>
                <Input value={editMaintForm.label} onChange={(e) => setEditMaintForm((prev) => ({ ...prev, label: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <Label>Last done date</Label>
                <Input type="date" value={editMaintForm.lastDoneAt} onChange={(e) => setEditMaintForm((prev) => ({ ...prev, lastDoneAt: e.target.value }))} />
              </div>
              <div>
                <Label>Last done odometer</Label>
                <Input type="number" value={editMaintForm.lastDoneOdometer} onChange={(e) => setEditMaintForm((prev) => ({ ...prev, lastDoneOdometer: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <Label>Interval km</Label>
                <Input type="number" value={editMaintForm.intervalKm} onChange={(e) => setEditMaintForm((prev) => ({ ...prev, intervalKm: e.target.value }))} />
              </div>
              <div>
                <Label>Interval days</Label>
                <Input type="number" value={editMaintForm.intervalDays} onChange={(e) => setEditMaintForm((prev) => ({ ...prev, intervalDays: e.target.value }))} />
              </div>
              <div>
                <Label>Cost ({currency})</Label>
                <Input type="number" value={editMaintForm.cost} onChange={(e) => setEditMaintForm((prev) => ({ ...prev, cost: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Note</Label>
              <Input value={editMaintForm.note} onChange={(e) => setEditMaintForm((prev) => ({ ...prev, note: e.target.value }))} />
            </div>
            <Button onClick={saveEditMaint} style={{ width: '100%', marginTop: 4 }}>Save changes</Button>
          </div>
        )}
      </Modal>

      {/* Feature 3: Mark as Done modal */}
      <Modal
        open={Boolean(markDoneItem)}
        title="Mark as Done"
        onClose={() => setMarkDoneItem(null)}
      >
        {markDoneItem && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 4 }}>
              Recording completion of <strong style={{ color: COLORS.textPrimary }}>{markDoneItem.label}</strong>
            </div>
            <div>
              <Label>Date done</Label>
              <Input
                type="date"
                value={markDoneForm.date}
                onChange={(e) => setMarkDoneForm((prev) => ({ ...prev, date: e.target.value }))}
              />
            </div>
            <div>
              <Label>Odometer (km)</Label>
              <Input
                type="number"
                value={markDoneForm.odometer}
                onChange={(e) => setMarkDoneForm((prev) => ({ ...prev, odometer: e.target.value }))}
                placeholder={String(currentOdometer || markDoneItem.lastDoneOdometer || '')}
              />
            </div>
            <div>
              <Label>Cost ({currency})</Label>
              <Input
                type="number"
                step="0.01"
                value={markDoneForm.cost}
                onChange={(e) => setMarkDoneForm((prev) => ({ ...prev, cost: e.target.value }))}
                placeholder="0"
              />
            </div>
            <Button onClick={confirmMarkDone} style={{ width: '100%', marginTop: 4 }}>✓ Confirm done</Button>
          </div>
        )}
      </Modal>

      {/* Feature 18: Import merge strategy modal */}
      <Modal
        open={Boolean(pendingImportFile)}
        title="Import backup"
        onClose={() => setPendingImportFile(null)}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 14, color: COLORS.textSecondary }}>
            How should the imported data be combined with your existing data?
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button
              type="button"
              onClick={() => { executeImport(pendingImportFile, 'replace'); setPendingImportFile(null); }}
              style={{
                background: `${COLORS.danger}18`,
                border: `1px solid ${COLORS.danger}44`,
                borderRadius: 10,
                padding: '12px 14px',
                cursor: 'pointer',
                textAlign: 'left',
                color: COLORS.textPrimary,
              }}
            >
              <div style={{ fontWeight: 700, color: COLORS.danger, marginBottom: 4 }}>🗑️ Replace all</div>
              <div style={{ fontSize: 12, color: COLORS.textMuted }}>
                Delete all current data and replace with the backup. Cannot be undone.
              </div>
            </button>
            <button
              type="button"
              onClick={() => { executeImport(pendingImportFile, 'merge'); setPendingImportFile(null); }}
              style={{
                background: `${COLORS.success}18`,
                border: `1px solid ${COLORS.success}44`,
                borderRadius: 10,
                padding: '12px 14px',
                cursor: 'pointer',
                textAlign: 'left',
                color: COLORS.textPrimary,
              }}
            >
              <div style={{ fontWeight: 700, color: COLORS.success, marginBottom: 4 }}>🔀 Merge append</div>
              <div style={{ fontSize: 12, color: COLORS.textMuted }}>
                Keep existing data and add new records from the backup (deduplicates by ID).
              </div>
            </button>
          </div>
          <Button type="button" variant="ghost" onClick={() => setPendingImportFile(null)}>Cancel</Button>
        </div>
      </Modal>

      {/* Delete Vehicle Confirm */}
      <ConfirmDialog
        open={Boolean(deleteVehicleId)}
        title="Delete Vehicle"
        message="This will permanently delete the vehicle and ALL associated refuel entries and maintenance reminders. Are you sure?"
        confirmLabel="Delete vehicle"
        confirmVariant="danger"
        onConfirm={() => deleteVehicle(deleteVehicleId)}
        onCancel={() => setDeleteVehicleId(null)}
      />

      {/* Remove receipt photos — the practical way to reclaim storage */}
      <ConfirmDialog
        open={confirmClearPhotos}
        title="Remove receipt photos"
        message={`This removes ${photoCount} receipt photo(s) from every refuel entry. The refuel records themselves are kept.`}
        confirmLabel="Remove photos"
        confirmVariant="danger"
        onConfirm={removeAllPhotos}
        onCancel={() => setConfirmClearPhotos(false)}
      />

      {/* Clear All Confirm */}
      <ConfirmDialog
        open={confirmClearAll}
        title="Clear All Data"
        message="This will permanently delete ALL vehicles, refuels, and maintenance data. This action cannot be undone."
        confirmLabel="Clear everything"
        confirmVariant="danger"
        onConfirm={() => {
          // Odometer readings and per-vehicle targets used to survive a "clear
          // everything", so stale rows reappeared against the next vehicle.
          setVehicles([]);
          setRefuels([]);
          setMaintenance([]);
          setOdometerReadings([]);
          setVehicleConsumptionTargets({});
          setSelectedVehicleId('');
          removeKey(DRAFT_REFUEL_KEY);
          setConfirmClearAll(false);
          showUndoToast('All data cleared', null);
        }}
        onCancel={() => setConfirmClearAll(false)}
      />

      <UndoToast toast={undoToast} onUndo={handleUndo} />
    </div>
  );
}
