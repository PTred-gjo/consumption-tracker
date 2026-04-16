import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Chart from 'chart.js/auto';

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

const TAB_ITEMS = [
  { key: 'refuel', icon: '⛽', label: 'Refuel' },
  { key: 'stats', icon: '📊', label: 'Stats' },
  { key: 'maintenance', icon: '🔧', label: 'Maint' },
  { key: 'settings', icon: '⚙', label: 'Settings' },
];

const CURRENCIES = ['Kč', '€', '$', '£', 'zł', 'kr'];

const MAINT_TYPES = [
  { value: 'oil_change', label: 'Oil Change' },
  { value: 'tires', label: 'Tires' },
  { value: 'stk', label: 'STK' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'custom', label: 'Custom' },
];

const FUEL_LABELS = { diesel: 'Diesel', petrol: 'Petrol', lpg: 'LPG', ev: 'EV' };

const todayIso = () => new Date().toISOString().slice(0, 10);

function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  return value.toFixed(digits);
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString();
}

function getVehicleRefuels(refuels, vehicleId) {
  return refuels
    .filter((x) => x.vehicleId === vehicleId)
    .slice()
    .sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

function computeConsumptionSeries(refuels) {
  let accumulatedLiters = 0;
  let lastFullOdometer = null;
  const points = [];

  for (const entry of refuels) {
    accumulatedLiters += entry.liters;

    if (entry.isFullTank) {
      if (lastFullOdometer !== null) {
        const distance = entry.odometer - lastFullOdometer;
        if (distance > 0) {
          points.push({
            date: entry.date,
            odometer: entry.odometer,
            value: (accumulatedLiters / distance) * 100,
          });
        }
      }

      accumulatedLiters = 0;
      lastFullOdometer = entry.odometer;
    }
  }

  return points;
}

function computeStats(refuels) {
  if (!refuels.length) {
    return {
      consumptionSeries: [],
      avgConsumption: 0,
      monthlyCost: [],
      priceSeries: [],
      monthlyDistance: [],
      totalCost: 0,
      avgCostPerKm: 0,
      lastCostPerKm: 0,
      totalDistance: 0,
      lastEntry: null,
      firstEntry: null,
      totalLiters: 0,
      refuelCount: 0,
    };
  }

  const firstEntry = refuels[0];
  const lastEntry = refuels[refuels.length - 1];

  const consumptionSeries = computeConsumptionSeries(refuels);
  const avgConsumption = consumptionSeries.length
    ? consumptionSeries.reduce((sum, item) => sum + item.value, 0) / consumptionSeries.length
    : 0;
  const lastConsumption = consumptionSeries.length
    ? consumptionSeries[consumptionSeries.length - 1].value
    : 0;

  const totalCost = refuels.reduce((sum, entry) => sum + entry.totalCost, 0);
  const totalLiters = refuels.reduce((sum, entry) => sum + entry.liters, 0);
  const totalDistance = Math.max(0, lastEntry.odometer - firstEntry.odometer);
  const avgCostPerKm = totalDistance > 0 ? totalCost / totalDistance : 0;

  let lastCostPerKm = 0;
  if (refuels.length > 1) {
    const prev = refuels[refuels.length - 2];
    const distance = lastEntry.odometer - prev.odometer;
    if (distance > 0) {
      lastCostPerKm = lastEntry.totalCost / distance;
    }
  }

  const monthlyCostMap = new Map();
  const priceSeries = refuels.map((entry) => ({ date: entry.date, value: entry.pricePerLiter }));

  for (const entry of refuels) {
    const key = monthKey(entry.date);
    monthlyCostMap.set(key, (monthlyCostMap.get(key) || 0) + entry.totalCost);
  }

  const monthlyDistanceMap = new Map();
  for (let i = 1; i < refuels.length; i += 1) {
    const current = refuels[i];
    const previous = refuels[i - 1];
    const distance = current.odometer - previous.odometer;
    if (distance > 0) {
      const key = monthKey(current.date);
      monthlyDistanceMap.set(key, (monthlyDistanceMap.get(key) || 0) + distance);
    }
  }

  const monthlyCost = Array.from(monthlyCostMap.entries()).map(([month, value]) => ({ month, value }));
  const monthlyDistance = Array.from(monthlyDistanceMap.entries()).map(([month, value]) => ({ month, value }));

  return {
    consumptionSeries,
    avgConsumption,
    lastConsumption,
    monthlyCost,
    priceSeries,
    monthlyDistance,
    totalCost,
    avgCostPerKm,
    lastCostPerKm,
    totalDistance,
    lastEntry,
    firstEntry,
    totalLiters,
    refuelCount: refuels.length,
  };
}

function getCurrentOdometer(refuels) {
  if (!refuels.length) return 0;
  return Math.max(...refuels.map((x) => x.odometer));
}

function getMaintenanceStatus(item, currentOdometer) {
  const now = new Date();
  const lastDoneDate = item.lastDoneAt ? new Date(`${item.lastDoneAt}T00:00:00`) : null;

  const dueDate = item.intervalDays > 0 && lastDoneDate
    ? new Date(lastDoneDate.getTime() + item.intervalDays * 24 * 60 * 60 * 1000)
    : null;
  const dueOdometer = item.intervalKm > 0 ? item.lastDoneOdometer + item.intervalKm : null;

  const dateDue = Boolean(dueDate && now >= dueDate);
  const kmDue = Boolean(dueOdometer && currentOdometer >= dueOdometer);

  if (dateDue || kmDue) {
    return { key: 'due', label: 'Overdue', color: COLORS.danger };
  }

  const upcomingDate = Boolean(dueDate && dueDate.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000);
  const upcomingKm = Boolean(dueOdometer && dueOdometer - currentOdometer <= 1000);

  if (upcomingDate || upcomingKm) {
    return { key: 'upcoming', label: 'Upcoming', color: COLORS.warning };
  }

  return { key: 'ok', label: 'OK', color: COLORS.success };
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

function Select({ children, ...props }) {
  return (
    <select
      {...props}
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

function StatBox({ label, value, icon, accent, trend }) {
  const c = accent || COLORS.accent;
  return (
    <div
      style={{
        background: `${c}0d`,
        border: `1px solid ${c}22`,
        borderRadius: 12,
        padding: '12px 14px',
        textAlign: 'center',
      }}
    >
      {icon && <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>}
      <div style={{ fontSize: 18, fontWeight: 800, color: c, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
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
  if (!open) return null;
  return (
    <div
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
  }, [title, labels, values, type, color, unit, goalLine, pointColors]);

  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ height: 220 }}>
        <canvas ref={ref} />
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
        Undo
      </button>
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

function RefuelRow({ entry, currency, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const lp = useLongPress(() => setMenuOpen(true));

  return (
    <>
      <SwipeableRow onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry.id)}>
        <div
          {...lp}
          style={{
            border: `1px solid ${COLORS.borderLight}`,
            borderRadius: 12,
            padding: '10px 12px',
            background: COLORS.surfaceElevated,
            transition: 'border-color 0.2s',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>{formatDate(entry.date)}</strong>
              {entry.isFullTank ? (
                <span style={{ fontSize: 10, color: COLORS.success, background: `${COLORS.success}22`, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>FULL</span>
              ) : (
                <span style={{ fontSize: 10, color: COLORS.warning, background: `${COLORS.warning}22`, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>PARTIAL</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton onClick={() => onEdit(entry)} title="Edit">✏️</IconButton>
              <IconButton onClick={() => onDelete(entry.id)} title="Delete" variant="danger">🗑️</IconButton>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textSecondary, fontSize: 13 }}>
            <span>{fmt(entry.liters, 2)} L · {fmt(entry.pricePerLiter, 2)} {currency}/L</span>
            <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{fmt(entry.totalCost, 2)} {currency}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>
            <span>{entry.odometer.toLocaleString()} km</span>
            {entry.station && <span>📍 {entry.station}</span>}
          </div>
          {entry.note && <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 3, fontStyle: 'italic' }}>💬 {entry.note}</div>}
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
  const [consumptionTarget, setConsumptionTarget] = usePersistentState('fuelpilot_consumptionTarget', 0);
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
  // Pagination state (feature 11)
  const [historyPage, setHistoryPage] = useState(1);
  const [vehicles, setVehicles] = usePersistentState('fuelpilot_vehicles', []);
  const [refuels, setRefuels] = usePersistentState('fuelpilot_refuels', []);
  const [maintenance, setMaintenance] = usePersistentState('fuelpilot_maintenance', []);
  const [selectedVehicleId, setSelectedVehicleId] = usePersistentState('fuelpilot_selectedVehicleId', '');
  const [importError, setImportError] = useState('');

  // Apply theme palette before render so all child components see correct colors
  useMemo(() => {
    Object.assign(COLORS, theme === 'light' ? LIGHT_COLORS : DARK_COLORS);
  }, [theme]);

  // Brief hydration delay to show skeleton placeholders on first render
  useEffect(() => {
    const t = setTimeout(() => setIsHydrated(true), SKELETON_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  /* Edit / delete modal state */
  const [editRefuelId, setEditRefuelId] = useState(null);
  const [editRefuelForm, setEditRefuelForm] = useState(null);
  const [editMaintId, setEditMaintId] = useState(null);
  const [editMaintForm, setEditMaintForm] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
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
    tankSize: '',
    currency: 'Kč',
  });

  const [refuelForm, setRefuelForm] = useState({
    date: todayIso(),
    odometer: '',
    liters: '',
    pricePerLiter: '',
    isFullTank: true,
    station: '',
    note: '',
    photo: null,
  });

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

  useEffect(() => {
    setMaintForm((prev) => ({ ...prev, lastDoneOdometer: currentOdometer || 0 }));
  }, [selectedVehicleId]);

  /* ─── CRUD handlers ─── */

  function addVehicle(e) {
    e.preventDefault();
    if (!vehicleForm.name.trim()) return;

    const entry = {
      id: uid('v'),
      name: vehicleForm.name.trim(),
      make: vehicleForm.make.trim(),
      model: vehicleForm.model.trim(),
      year: num(vehicleForm.year),
      fuelType: vehicleForm.fuelType,
      tankSize: num(vehicleForm.tankSize),
      currency: vehicleForm.currency,
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
      tankSize: '',
      currency: entry.currency,
    });
  }

  const deleteVehicle = useCallback((id) => {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    setRefuels((prev) => prev.filter((r) => r.vehicleId !== id));
    setMaintenance((prev) => prev.filter((m) => m.vehicleId !== id));
    setSelectedVehicleId((prevId) => (prevId === id ? '' : prevId));
    setDeleteVehicleId(null);
  }, []);

  function addRefuel(e) {
    e.preventDefault();
    if (!selectedVehicle) return;

    const odometer = num(refuelForm.odometer);
    const liters = num(refuelForm.liters);
    const pricePerLiter = num(refuelForm.pricePerLiter);

    if (!odometer || !liters || !pricePerLiter) return;

    const entry = {
      id: uid('r'),
      vehicleId: selectedVehicle.id,
      date: refuelForm.date,
      odometer,
      liters,
      pricePerLiter,
      totalCost: liters * pricePerLiter,
      fuelType: selectedVehicle.fuelType,
      isFullTank: refuelForm.isFullTank,
      station: refuelForm.station.trim(),
      note: refuelForm.note.trim(),
      photo: refuelForm.photo || null,
      createdAt: Date.now(),
    };

    setRefuels((prev) => [...prev, entry]);
    setRefuelForm({
      date: todayIso(),
      odometer: odometer,
      liters: '',
      pricePerLiter: pricePerLiter,
      isFullTank: true,
      station: '',
      note: '',
      photo: null,
    });
  }

  function saveEditRefuel() {
    if (!editRefuelForm) return;
    const odometer = num(editRefuelForm.odometer);
    const liters = num(editRefuelForm.liters);
    const pricePerLiter = num(editRefuelForm.pricePerLiter);
    if (!odometer || !liters || !pricePerLiter) return;

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
              isFullTank: editRefuelForm.isFullTank,
              station: editRefuelForm.station.trim(),
              note: editRefuelForm.note.trim(),
              photo: editRefuelForm.photo || null,
            }
          : entry
      )
    );
    setEditRefuelId(null);
    setEditRefuelForm(null);
  }

  function showUndoToast(message, restore) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 3000);
    setUndoToast({ message, restore });
  }

  function handleUndo() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    if (undoToast) undoToast.restore();
    setUndoToast(null);
  }

  function handleDeleteRefuel(id) {
    const entry = refuels.find((r) => r.id === id);
    if (!entry) return;
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
    setMaintenance((prev) => prev.filter((m) => m.id !== id));
    showUndoToast('Reminder deleted', () => setMaintenance((prev) => [...prev, item]));
  }

  function markMaintenanceDone(item) {
    setMaintenance((prev) =>
      prev.map((m) =>
        m.id === item.id
          ? { ...m, lastDoneAt: todayIso(), lastDoneOdometer: currentOdometer || m.lastDoneOdometer }
          : m
      )
    );
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

  // Sorted newest-first history for the Refuel tab
  const sortedHistory = useMemo(() => vehicleRefuels.slice().reverse(), [vehicleRefuels]);

  // Filtered history (feature 10)
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
      return true;
    });
  }, [sortedHistory, historySearch, historyDateFrom, historyDateTo, historyCostMin, historyCostMax]);

  // Paginated slice (feature 11) — reset page when filters change
  useEffect(() => { setHistoryPage(1); }, [filteredHistory]);

  const pagedHistory = useMemo(
    () => filteredHistory.slice(0, historyPage * HISTORY_PAGE_SIZE),
    [filteredHistory, historyPage]
  );

  const hasMoreHistory = pagedHistory.length < filteredHistory.length;

  const historyFiltersActive = Boolean(historySearch || historyDateFrom || historyDateTo || historyCostMin || historyCostMax);

  function clearHistoryFilters() {
    setHistorySearch('');
    setHistoryDateFrom('');
    setHistoryDateTo('');
    setHistoryCostMin('');
    setHistoryCostMax('');
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

  // Read a file input as base64 data URL (feature 14)
  function readPhotoFile(file, onDone) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onDone(ev.target.result);
    reader.readAsDataURL(file);
  }

  function exportCSV() {
    if (!vehicleRefuels.length) return;
    const headers = ['Date', 'Odometer (km)', 'Liters', `Price/L (${currency})`, `Total (${currency})`, 'Full Tank', 'Station', 'Note'];
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
        e.station || '',
        e.note || '',
      ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fuelpilot-refuels-${todayIso()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      vehicles,
      refuels,
      maintenance,
      selectedVehicleId,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fuelpilot-backup-${todayIso()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result || '{}');
        const parsed = JSON.parse(raw);

        if (!Array.isArray(parsed.vehicles) || !Array.isArray(parsed.refuels) || !Array.isArray(parsed.maintenance)) {
          throw new Error('Invalid backup shape');
        }

        setVehicles(parsed.vehicles);
        setRefuels(parsed.refuels);
        setMaintenance(parsed.maintenance);

        if (parsed.selectedVehicleId) {
          setSelectedVehicleId(parsed.selectedVehicleId);
        } else if (parsed.vehicles.length) {
          setSelectedVehicleId(parsed.vehicles[0].id);
        }

        setImportError('');
      } catch {
        setImportError('Invalid JSON backup file.');
      }
    };

    reader.readAsText(file);
  }

  const currency = selectedVehicle?.currency || 'Kč';
  const quickTablePrices = [25, 30, 35, 40, 45, 50, 55, 60];
  const TAB_ORDER = { refuel: 0, stats: 1, maintenance: 2, settings: 3 };

  function handleTabChange(newTab) {
    setTabAnimDir((TAB_ORDER[newTab] || 0) > (TAB_ORDER[activeTab] || 0) ? 'right' : 'left');
    setActiveTab(newTab);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: COLORS.bg,
        color: COLORS.textPrimary,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '20px 16px calc(90px + env(safe-area-inset-bottom))',
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

        {/* Vehicle selector */}
        {vehicles.length > 0 && (
          <Card style={{ marginBottom: 14, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  <Label>Fuel</Label>
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
              <div>
                <Label>Tank size (L)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={vehicleForm.tankSize}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, tankSize: e.target.value }))}
                />
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
                <StatBox label="Last Fill" value={stats.lastEntry ? `${fmt(stats.lastEntry.liters, 1)} L` : '-'} accent={COLORS.accent} />
                <StatBox
                  label="Avg Consumption"
                  value={`${fmt(stats.avgConsumption)} l/100`}
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
                <StatBox label="Avg Cost / km" value={`${fmt(stats.avgCostPerKm)} ${currency}`} accent={COLORS.success} />
                <StatBox label="Total Distance" value={`${fmt(stats.totalDistance, 0)} km`} accent={COLORS.accentLight} />
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
                      onChange={(e) => readPhotoFile(e.target.files?.[0], (data) => setRefuelForm((prev) => ({ ...prev, photo: data })))}
                    />
                  )}
                </div>
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

            {/* Refuel history (feature 10 filter + feature 11 pagination) */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: historyFilterOpen ? 12 : 0 }}>
                <SectionTitle icon="📋" style={{ margin: 0 }}>Refuel history</SectionTitle>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {historyFiltersActive && (
                    <Button type="button" variant="ghost" size="small" onClick={clearHistoryFilters}>✕ Clear</Button>
                  )}
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
                      onEdit={openEditRefuel}
                      onDelete={handleDeleteRefuel}
                    />
                  ))}
              </div>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
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
          </div>
        )}

        {/* ═══ MAINTENANCE TAB ═══ */}
        {selectedVehicle && activeTab === 'maintenance' && (
          <div className={`fp-tab-enter-${tabAnimDir}`} style={{ display: 'grid', gap: 14 }}>
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
                          <StatusPill color={status.color} label={status.label} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <IconButton onClick={() => openEditMaint(item)} title="Edit">✏️</IconButton>
                          <IconButton onClick={() => handleDeleteMaint(item.id)} title="Delete" variant="danger">🗑️</IconButton>
                        </div>
                      </div>
                      <div style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 1.6 }}>
                        <div>Last: {formatDate(item.lastDoneAt)} · {item.lastDoneOdometer.toLocaleString()} km</div>
                        <div>Due: {item.intervalDays ? `${item.intervalDays} days` : '-'} · {dueAtKm ? `${dueAtKm.toLocaleString()} km` : '-'}</div>
                        {item.cost > 0 && <div>Cost: {fmt(item.cost)} {currency}</div>}
                      </div>
                      {item.note && <div style={{ color: COLORS.textMuted, marginTop: 4, fontSize: 12, fontStyle: 'italic' }}>💬 {item.note}</div>}
                      {status.key === 'due' && (
                        <Button
                          variant="success"
                          size="small"
                          style={{ marginTop: 8, width: '100%' }}
                          onClick={() => markMaintenanceDone(item)}
                        >
                          ✓ Mark as done today
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

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
                    <Label>Fuel Type</Label>
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
                <Button type="submit" style={{ width: '100%', marginTop: 2 }}>Add vehicle</Button>
              </form>
            </Card>

            <Card>
              <SectionTitle icon="⚙">Current vehicle settings</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ color: COLORS.textSecondary }}>{selectedVehicle.name}</span>
                <FuelBadge fuelType={selectedVehicle.fuelType} />
              </div>
              <Label>Currency</Label>
              <Select value={currency} onChange={(e) => updateVehicleCurrency(e.target.value)}>
                {CURRENCIES.map((cur) => (
                  <option key={cur} value={cur}>{cur}</option>
                ))}
              </Select>
            </Card>

            <Card>
              <SectionTitle icon="🎯">Consumption target</SectionTitle>
              <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Set a target L/100 km — a dashed reference line will appear on the consumption chart.
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
                    setConsumptionTarget(v > 0 ? v : 0);
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
                    onClick={() => setConsumptionTarget(0)}
                  >
                    ✕ Remove
                  </Button>
                </div>
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
              <Label>Import backup</Label>
              <Input
                type="file"
                accept="application/json"
                onChange={(e) => importData(e.target.files?.[0])}
              />
              {importError && <div style={{ color: COLORS.danger, marginTop: 6, fontSize: 13 }}>{importError}</div>}
            </Card>

            <Card>
              <SectionTitle icon="📊">Price → cost/km reference</SectionTitle>
              <div style={{ color: COLORS.textSecondary, marginBottom: 10, fontSize: 13 }}>
                Based on avg consumption <strong style={{ color: COLORS.textPrimary }}>{fmt(stats.avgConsumption)} l/100 km</strong>
              </div>
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
          background: `${COLORS.surface}f0`,
          borderTop: `1px solid ${COLORS.border}`,
          padding: `6px 10px calc(6px + env(safe-area-inset-bottom))`,
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
                  onChange={(e) => readPhotoFile(e.target.files?.[0], (data) => setEditRefuelForm((prev) => ({ ...prev, photo: data })))}
                />
              )}
            </div>
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

      {/* Clear All Confirm */}
      <ConfirmDialog
        open={confirmClearAll}
        title="Clear All Data"
        message="This will permanently delete ALL vehicles, refuels, and maintenance data. This action cannot be undone."
        confirmLabel="Clear everything"
        confirmVariant="danger"
        onConfirm={() => {
          setVehicles([]);
          setRefuels([]);
          setMaintenance([]);
          setSelectedVehicleId('');
          setConfirmClearAll(false);
        }}
        onCancel={() => setConfirmClearAll(false)}
      />

      <UndoToast toast={undoToast} onUndo={handleUndo} />
    </div>
  );
}
