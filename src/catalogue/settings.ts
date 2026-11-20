/**
 * The settings catalogue: every single-register holding setting exposed in the snapshot's `settings` group.
 * App names are copied from section 1 of website/register-map.md; register meanings from
 * docs/plans/2026-11-19-v3-research.md sections B, C and F.
 */
import type { Capabilities } from '../model/capabilities.js';
import type { Layout } from '../model/models.js';
import type { SettingDefinition } from './types.js';

/** Single-phase HR 300–359 settings exist only when that block answers; three-phase twins are always present. */
const inSinglePhaseAcSettingsBlock = (capabilities: Capabilities, layout: Layout): boolean =>
  layout === 'three_phase' || capabilities.acSettingsBlock;

export const SETTINGS = {
  acChargeUpperLimitEnabled: {
    register: 20,
    kind: 'boolean',
    appName: 'Enable AC Charge Upper % Limit',
    description: 'Stops AC charging at `acChargeUpperLimit` when enabled (sometimes called winter mode).',
  },
  ecoMode: {
    register: 27,
    kind: 'boolean',
    appName: 'Enable Eco Mode',
    description: 'Lets the battery charge from surplus solar and discharge to cover the home load.',
  },
  batteryCalibration: {
    register: 29,
    kind: 'enum',
    values: {
      off: 0,
      discharge: 1,
      setLowerLimit: 2,
      charge: 3,
      setUpperLimit: 4,
      balance: 5,
      setFullCapacity: 6,
      finish: 7,
    },
    // Research C: only stop (0), start (1) and charge only (3) may be written; the other stages are reported by the inverter.
    writableValues: ['off', 'discharge', 'charge'],
    appName: 'Battery Calibration',
    description: 'Current battery calibration stage, or the calibration to start or stop.',
  },
  inverterMaxOutputPercent: {
    register: 50,
    kind: 'percent',
    min: 0,
    max: 100,
    appName: 'Inverter Max Output Active Power Percent',
    description: 'Caps the inverter active power output as a percentage of its rating.',
  },
  dcDischarge: {
    register: { single_phase: 59, three_phase: 1122 },
    kind: 'boolean',
    appName: 'Enable DC Discharge',
    description: 'Enables the timed discharge slots (force discharge enable on three-phase).',
  },
  acCharge: {
    register: { single_phase: 96, three_phase: 1112 },
    kind: 'boolean',
    appName: 'AC Charge Enable',
    description: 'Enables the timed AC charge slots.',
  },
  forceCharge: {
    register: { three_phase: 1123 },
    kind: 'boolean',
    description: 'Forces the battery to charge (three-phase only).',
  },
  batteryReserve: {
    register: { single_phase: 110, three_phase: 1109 },
    kind: 'percent',
    min: 4,
    max: 100,
    appName: 'Battery Reserve % Limit',
    description: 'State of charge kept in reserve during normal operation.',
  },
  batteryChargeRate: {
    register: { single_phase: 111 },
    kind: 'integer',
    min: 0,
    max: 50,
    unit: 'C/100',
    appName: 'Battery Charge Rate',
    description: 'Maximum battery charge rate as a fraction of its C rating, also capped by inverter power.',
  },
  batteryDischargeRate: {
    register: { single_phase: 112 },
    kind: 'integer',
    min: 0,
    max: 50,
    unit: 'C/100',
    appName: 'Battery Discharge Rate',
    description: 'Maximum battery discharge rate as a fraction of its C rating, also capped by inverter power.',
  },
  batteryCutoff: {
    register: { single_phase: 114, three_phase: 1078 },
    kind: 'percent',
    min: 4,
    max: 100,
    appName: 'Battery Cutoff % Limit',
    description: 'State of charge below which the battery never discharges.',
  },
  acChargeUpperLimit: {
    register: { single_phase: 116, three_phase: 1111 },
    kind: 'percent',
    min: 4,
    max: 100,
    appName: 'AC Charge Upper % Limit (global)',
    // GivTCP #576: on ten-slot firmware charging stops at min(this, charge slot 1 target in HR 242).
    description: 'State of charge at which AC charging stops; on ten-slot firmware the lower of this and slot 1 target applies.',
  },
  realTimeControl: {
    register: 166,
    kind: 'boolean',
    appName: 'Real-Time Control',
    description: 'Enables real-time control of the inverter by an external controller.',
  },
  exportPriority: {
    register: { single_phase: 311 },
    kind: 'enum',
    values: { loadFirst: 0, batteryFirst: 1, gridFirst: 2 },
    appName: 'Export Power Priority',
    description: 'Where surplus power goes first: the home load, the battery or the grid.',
    supported: inSinglePhaseAcSettingsBlock,
  },
  inverterChargePowerPercent: {
    register: { single_phase: 313, three_phase: 1110 },
    kind: 'percent',
    // Research C: the inverter rejects 0, so the minimum is 1 (GivTCP sends 1).
    min: 1,
    max: 100,
    appName: 'Inverter Charge Power Percentage',
    description: 'Battery charge power as a percentage of the inverter rating.',
    supported: inSinglePhaseAcSettingsBlock,
  },
  inverterDischargePowerPercent: {
    register: { single_phase: 314, three_phase: 1108 },
    kind: 'percent',
    min: 1,
    max: 100,
    appName: 'Inverter Discharge Power Percentage',
    description: 'Battery discharge power as a percentage of the inverter rating.',
    supported: inSinglePhaseAcSettingsBlock,
  },
  eps: {
    register: { single_phase: 317 },
    kind: 'boolean',
    appName: 'Enable EPS',
    description: 'Enables the emergency power supply output during a grid outage.',
    supported: inSinglePhaseAcSettingsBlock,
  },
  exportLimit: {
    register: { single_phase: 26 },
    kind: 'integer',
    min: 0,
    max: 65535,
    unit: 'W',
    writable: false,
    description: 'Grid export power limit set by the installer.',
  },
  threePhaseExportLimit: {
    register: { three_phase: 1102 },
    kind: 'integer',
    min: 0,
    max: 65535,
    unit: 'W',
    writable: false,
    description: 'Grid export power limit set by the installer.',
  },
  threePhaseExportLimitEnabled: {
    register: { three_phase: 1103 },
    kind: 'boolean',
    writable: false,
    description: 'Whether the grid export power limit is enforced.',
  },
  batterySelfHeating: {
    register: { single_phase: 104 },
    kind: 'boolean',
    unsafe: true,
    appName: 'Enable Battery Self-Heating',
    description: 'Undocumented battery self-heating switch.',
    risk: 'Battery self-heating (HR 104). Undocumented: GivEnergy\'s v4.1.6 register document marks HR 104 reserved and read-only, on three-phase models the same address is a grid power calibration value, and a write has been seen rejected with an error on real hardware. GivEnergy says its batteries have no active heating. Only write this if the official app offers and accepts it for your exact hardware.',
  },
  manualBatteryHeater: {
    register: { single_phase: 172 },
    kind: 'boolean',
    unsafe: true,
    appName: 'Enable Manual Battery Heater',
    description: 'Undocumented manual battery heater switch.',
    risk: 'Manual battery heater (HR 172). Undocumented: the v4.1.6 register document marks HR 165–173 reserved and the installer app doesn\'t list it. On tested hardware the write was accepted but read back off. No GivEnergy battery is known to have a heater, and if one did, nothing documents an automatic cut-off. Don\'t write this register.',
  },
  inverterParallelMode: {
    register: { single_phase: 199 },
    // Not boolean: the v4.1.6 document's ParaOutputMode takes 0–4, although the app shows an on/off switch.
    kind: 'integer',
    min: 0,
    max: 4,
    unsafe: true,
    appName: 'Enable Inverter Parallel Mode',
    description: 'Parallel output mode used when All in One units run in parallel with a Gateway.',
    risk: 'Parallel output mode (HR 199; "ParaOutputMode", values 0–4, although the app shows an on/off switch). A Gateway sets this when it commissions All in One units in parallel, and reboots them. Writing it on a standalone inverter is untested and may cause parallel faults or loss of output. This is not the "self-consumption logic" flag older libraries called it.',
  },
  forceOffGrid: {
    register: { single_phase: 331 },
    kind: 'boolean',
    unsafe: true,
    appName: 'Force Off Grid',
    description: 'Disconnects the site from the grid and keeps it islanded until cleared.',
    supported: inSinglePhaseAcSettingsBlock,
    risk: 'Force off grid (HR 331; "GatewayOnOff", 0–255). Designed for All in One + Gateway systems: it disconnects the site from the grid and keeps it islanded until cleared. Off-grid output is limited (about 6 kW on an All in One), PV may be curtailed at high state of charge, RCDs may trip if the earthing wasn\'t designed for islanding, and if the battery reaches its cutoff the system can shut down with no way to recover it remotely. Behaviour on hybrids without a Gateway is unverified. Always pair a write with a guaranteed clear.',
  },
} as const satisfies Record<string, SettingDefinition>;
