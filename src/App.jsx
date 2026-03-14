import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';

const COLORS = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceElevated: '#1C1C1E',
  accent: '#3B82F6',
  success: '#30D158',
  danger: '#FF453A',
  warning: '#E8A838',
  textPrimary: '#F5F5F3',
  textSecondary: '#8E8E93',
  textMuted: '#555558',
  border: '#2C2C2E',
  borderLight: '#1C1C1E',
};

const TAB_ITEMS = [
  { key: 'refuel', label: '⛽ Refuel' },
  { key: 'stats', label: '📊 Stats' },
  { key: 'maintenance', label: '🔧 Maint' },
  { key: 'settings', label: '⚙ Settings' },
];

const CURRENCIES = ['Kč', '€', '$', '£', 'zł', 'kr'];

const MAINT_TYPES = [
  { value: 'oil_change', label: 'Oil Change' },
  { value: 'tires', label: 'Tires' },
  { value: 'stk', label: 'STK' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'custom', label: 'Custom' },
];

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
    };
  }

  const firstEntry = refuels[0];
  const lastEntry = refuels[refuels.length - 1];

  const consumptionSeries = computeConsumptionSeries(refuels);
  const avgConsumption = consumptionSeries.length
    ? consumptionSeries.reduce((sum, item) => sum + item.value, 0) / consumptionSeries.length
    : 0;

  const totalCost = refuels.reduce((sum, entry) => sum + entry.totalCost, 0);
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
    monthlyCost,
    priceSeries,
    monthlyDistance,
    totalCost,
    avgCostPerKm,
    lastCostPerKm,
    totalDistance,
    lastEntry,
    firstEntry,
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

function Card({ children, style }) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.borderLight}`,
        borderRadius: 16,
        padding: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div
      style={{
        fontSize: 12,
        letterSpacing: 0.8,
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Input({ ...props }) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        border: `1px solid ${COLORS.border}`,
        background: COLORS.surfaceElevated,
        color: COLORS.textPrimary,
        borderRadius: 10,
        fontSize: 16,
        padding: '11px 12px',
        outline: 'none',
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
        border: `1px solid ${COLORS.border}`,
        background: COLORS.surfaceElevated,
        color: COLORS.textPrimary,
        borderRadius: 10,
        fontSize: 16,
        padding: '11px 12px',
        outline: 'none',
      }}
    >
      {children}
    </select>
  );
}

function Button({ children, variant = 'primary', style, ...props }) {
  const palette = variant === 'secondary'
    ? { background: COLORS.surfaceElevated, color: COLORS.textPrimary, border: COLORS.border }
    : { background: COLORS.accent, color: '#fff', border: COLORS.accent };

  return (
    <button
      {...props}
      style={{
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        borderRadius: 10,
        fontWeight: 600,
        padding: '10px 14px',
        cursor: 'pointer',
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
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        color,
        background: `${color}22`,
        border: `1px solid ${color}66`,
      }}
    >
      {label}
    </span>
  );
}

function ChartCard({ title, labels, values, type = 'line', color = COLORS.accent }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;

    const chart = new Chart(ref.current, {
      type,
      data: {
        labels,
        datasets: [
          {
            label: title,
            data: values,
            borderColor: color,
            backgroundColor: `${color}66`,
            tension: 0.35,
            fill: type === 'line',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: COLORS.textSecondary },
            grid: { color: `${COLORS.border}66` },
          },
          y: {
            ticks: { color: COLORS.textSecondary },
            grid: { color: `${COLORS.border}66` },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [title, labels, values, type, color]);

  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ height: 210 }}>
        <canvas ref={ref} />
      </div>
    </Card>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('refuel');
  const [vehicles, setVehicles] = usePersistentState('fuelpilot_vehicles', []);
  const [refuels, setRefuels] = usePersistentState('fuelpilot_refuels', []);
  const [maintenance, setMaintenance] = usePersistentState('fuelpilot_maintenance', []);
  const [selectedVehicleId, setSelectedVehicleId] = usePersistentState('fuelpilot_selectedVehicleId', '');
  const [importError, setImportError] = useState('');

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

  const vehicleMaintenance = useMemo(
    () => (selectedVehicle ? maintenance.filter((x) => x.vehicleId === selectedVehicle.id) : []),
    [maintenance, selectedVehicle]
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

  function updateVehicleCurrency(currency) {
    if (!selectedVehicle) return;
    setVehicles((prev) => prev.map((item) => (item.id === selectedVehicle.id ? { ...item, currency } : item)));
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
          padding: '16px 14px calc(90px + env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 2 }}>FuelPilot</div>
        <div style={{ color: COLORS.textSecondary, marginBottom: 16 }}>Smart fuel tracker for real costs per kilometer</div>

        {vehicles.length > 0 && (
          <Card style={{ marginBottom: 12 }}>
            <Label>Vehicle Selector</Label>
            <Select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} {v.year ? `(${v.year})` : ''}
                </option>
              ))}
            </Select>
          </Card>
        )}

        {!selectedVehicle && (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Add your first vehicle</div>
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
              <Button type="submit">Save vehicle</Button>
            </form>
          </Card>
        )}

        {selectedVehicle && activeTab === 'refuel' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Card style={{ background: `${COLORS.accent}1f`, border: `1px solid ${COLORS.accent}66` }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Dashboard</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Last Fill</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {stats.lastEntry ? `${fmt(stats.lastEntry.liters, 1)} L` : '-'}
                  </div>
                </div>
                <div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Avg Consumption</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(stats.avgConsumption)} l/100 km</div>
                </div>
                <div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Avg Cost / km</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {fmt(stats.avgCostPerKm)} {currency}
                  </div>
                </div>
                <div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Distance</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(stats.totalDistance, 0)} km</div>
                </div>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Quick refuel log</div>
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
                    <Input value={refuelForm.station} onChange={(e) => setRefuelForm((prev) => ({ ...prev, station: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Note</Label>
                  <Input value={refuelForm.note} onChange={(e) => setRefuelForm((prev) => ({ ...prev, note: e.target.value }))} />
                </div>
                <Button type="submit">Save refuel</Button>
              </form>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Refuel history</div>
              {!vehicleRefuels.length && <div style={{ color: COLORS.textSecondary }}>No entries yet.</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {vehicleRefuels
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        border: `1px solid ${COLORS.borderLight}`,
                        borderRadius: 12,
                        padding: 10,
                        background: COLORS.surfaceElevated,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <strong>{formatDate(entry.date)}</strong>
                        <span style={{ color: COLORS.textSecondary }}>{entry.odometer} km</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textSecondary }}>
                        <span>
                          {fmt(entry.liters, 2)} L · {fmt(entry.pricePerLiter, 2)} {currency}/L
                        </span>
                        <span>
                          {fmt(entry.totalCost, 2)} {currency}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        )}

        {selectedVehicle && activeTab === 'stats' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <ChartCard
              title="Consumption trend (l/100 km)"
              labels={stats.consumptionSeries.map((x) => x.date.slice(5))}
              values={stats.consumptionSeries.map((x) => Number(fmt(x.value, 2)))}
              type="line"
              color={COLORS.accent}
            />
            <ChartCard
              title="Monthly fuel cost"
              labels={stats.monthlyCost.map((x) => x.month.slice(2))}
              values={stats.monthlyCost.map((x) => Number(fmt(x.value, 2)))}
              type="bar"
              color={COLORS.warning}
            />
            <ChartCard
              title="Fuel price history"
              labels={stats.priceSeries.map((x) => x.date.slice(5))}
              values={stats.priceSeries.map((x) => Number(fmt(x.value, 2)))}
              type="line"
              color={COLORS.success}
            />
            <ChartCard
              title="Distance per month"
              labels={stats.monthlyDistance.map((x) => x.month.slice(2))}
              values={stats.monthlyDistance.map((x) => Number(fmt(x.value, 0)))}
              type="bar"
              color={COLORS.accent}
            />
          </div>
        )}

        {selectedVehicle && activeTab === 'maintenance' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Maintenance reminders</div>
              {!vehicleMaintenance.length && <div style={{ color: COLORS.textSecondary }}>No reminders yet.</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {vehicleMaintenance.map((item) => {
                  const status = getMaintenanceStatus(item, currentOdometer);
                  const dueAtKm = item.intervalKm > 0 ? item.lastDoneOdometer + item.intervalKm : null;
                  return (
                    <div key={item.id} style={{ background: COLORS.surfaceElevated, borderRadius: 12, padding: 10, border: `1px solid ${COLORS.borderLight}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                        <strong>{item.label}</strong>
                        <StatusPill color={status.color} label={status.label} />
                      </div>
                      <div style={{ color: COLORS.textSecondary, fontSize: 14 }}>
                        Last: {formatDate(item.lastDoneAt)} · {item.lastDoneOdometer} km
                      </div>
                      <div style={{ color: COLORS.textSecondary, fontSize: 14 }}>
                        Due: {item.intervalDays ? `${item.intervalDays} days` : '-'} · {dueAtKm ? `${dueAtKm} km` : '-'}
                      </div>
                      {item.note && <div style={{ color: COLORS.textSecondary, marginTop: 4 }}>{item.note}</div>}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Add maintenance</div>
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
                <Button type="submit">Save reminder</Button>
              </form>
            </Card>
          </div>
        )}

        {selectedVehicle && activeTab === 'settings' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Add vehicle</div>
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
                <Button type="submit">Add vehicle</Button>
              </form>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Current vehicle settings</div>
              <div style={{ marginBottom: 8, color: COLORS.textSecondary }}>{selectedVehicle.name}</div>
              <Label>Currency</Label>
              <Select value={currency} onChange={(e) => updateVehicleCurrency(e.target.value)}>
                {CURRENCIES.map((cur) => (
                  <option key={cur} value={cur}>{cur}</option>
                ))}
              </Select>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Export / Import JSON</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Button type="button" onClick={exportData}>Export data</Button>
                <Button type="button" variant="secondary" onClick={() => {
                  setVehicles([]);
                  setRefuels([]);
                  setMaintenance([]);
                  setSelectedVehicleId('');
                }}>
                  Clear all
                </Button>
              </div>
              <Input
                type="file"
                accept="application/json"
                onChange={(e) => importData(e.target.files?.[0])}
              />
              {importError && <div style={{ color: COLORS.danger, marginTop: 6 }}>{importError}</div>}
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Price → cost/km reference</div>
              <div style={{ color: COLORS.textSecondary, marginBottom: 8 }}>
                Based on avg consumption {fmt(stats.avgConsumption)} l/100 km
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {quickTablePrices.map((price) => {
                  const costPerKm = (stats.avgConsumption * price) / 100;
                  return (
                    <div key={price} style={{ display: 'flex', justifyContent: 'space-between', background: COLORS.surfaceElevated, padding: '8px 10px', borderRadius: 10 }}>
                      <span>{price} {currency}/L</span>
                      <strong>{fmt(costPerKm)} {currency}/km</strong>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: `${COLORS.surface}ee`,
          borderTop: `1px solid ${COLORS.border}`,
          padding: `8px 10px calc(8px + env(safe-area-inset-bottom))`,
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, maxWidth: 720, margin: '0 auto' }}>
          {TAB_ITEMS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  border: `1px solid ${isActive ? COLORS.accent : 'transparent'}`,
                  background: isActive ? `${COLORS.accent}1f` : 'transparent',
                  color: isActive ? COLORS.accent : COLORS.textSecondary,
                  borderRadius: 10,
                  padding: '10px 6px',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
