/**
 * Power flow calculator for GivEnergy inverter systems.
 *
 * GivEnergy reports raw power values (solar, battery, grid, load) but not
 * the directional flows between them. This module derives those flows using
 * energy balance equations.
 *
 * Reference: GivTCP/read.py lines 1240-1274 (processInverterInfo)
 */

export interface PowerFlowInput {
  /** Solar panel generation in watts (always >= 0) */
  solarWatts: number;
  /** Load consumption in watts (always >= 0) */
  loadWatts: number;
  /** Battery charge rate in watts (>= 0, 0 when not charging) */
  chargeWatts: number;
  /** Battery discharge rate in watts (>= 0, 0 when not discharging) */
  dischargeWatts: number;
  /** Grid import in watts (>= 0, 0 when not importing) */
  importWatts: number;
  /** Grid export in watts (>= 0, 0 when not exporting) */
  exportWatts: number;
}

export interface PowerFlows {
  solarToHouse: number;
  solarToBattery: number;
  solarToGrid: number;
  batteryToHouse: number;
  batteryToGrid: number;
  gridToHouse: number;
  gridToBattery: number;
}

/**
 * Calculate directional power flows from raw inverter measurements.
 *
 * Algorithm (ported from GivTCP read.py):
 *
 * Solar distribution (priority: house → battery → grid):
 *   S2H = min(solar, load)
 *   S2B = max((solar - S2H) - export, 0)
 *   S2G = max(solar - S2H - S2B, 0)
 *
 * Battery to house (discharge minus export):
 *   B2H = max(discharge - export, 0)
 *
 * Grid flows (when importing):
 *   G2B = charge - max(solar - load, 0)  [charge not covered by excess solar]
 *   G2H = max(import - charge, 0)
 *
 * Battery to grid (discharge not used by house):
 *   B2G = max(discharge - B2H, 0)
 */
export function calculatePowerFlows(input: PowerFlowInput): PowerFlows {
  const { solarWatts, loadWatts, chargeWatts, dischargeWatts, importWatts, exportWatts } = input;

  // Solar distribution
  const solarToHouse = Math.max(0, Math.min(solarWatts, loadWatts));
  const solarToBattery = Math.max(0, (solarWatts - solarToHouse) - exportWatts);
  const solarToGrid = Math.max(0, solarWatts - solarToHouse - solarToBattery);

  // Battery to house (discharge beyond what's being exported)
  const batteryToHouse = Math.max(0, dischargeWatts - exportWatts);

  // Grid flows
  const gridToBattery = importWatts > 0
    ? Math.max(0, chargeWatts - Math.max(0, solarWatts - loadWatts))
    : 0;
  const gridToHouse = importWatts > 0
    ? Math.max(0, importWatts - chargeWatts)
    : 0;

  // Battery to grid (discharge not consumed by house)
  const batteryToGrid = exportWatts > 0
    ? Math.max(0, dischargeWatts - batteryToHouse)
    : 0;

  return {
    solarToHouse,
    solarToBattery,
    solarToGrid,
    batteryToHouse,
    batteryToGrid,
    gridToHouse,
    gridToBattery,
  };
}
