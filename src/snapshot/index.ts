/**
 * `buildSnapshot`: assembles the v3 snapshot from the group builders.
 */
import type { InverterSnapshot, SinglePhaseSnapshot, ThreePhaseSnapshot } from '../model/snapshot.js';
import { calculatePowerFlows } from '../power-flow.js';
import { isSanityCheckPassing } from '../validation.js';
import { buildBattery } from './battery.js';
import { buildEnergy } from './energy.js';
import { buildIdentity } from './identity.js';
import { buildMeters } from './meters.js';
import { buildEps, buildGrid, buildInverterOutput, buildLoad, buildSolar } from './power.js';
import {
  readHolding,
  readInput,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';
import { buildSchedules } from './schedules.js';
import { buildSettings } from './settings.js';
import { buildStatus } from './status.js';
import { toInt16 } from '../model/converters.js';

export type { BuildContext, RegisterCaches, SinglePhaseBuildContext, ThreePhaseBuildContext } from './read.js';
export type { BatteryStackCaches, MeterCaches } from './read.js';

/**
 * The 2.x sanity check (GivTCP read.py): a corrupt block shows up as Modbus version > 2,
 * Modbus address > 100, user code > 100 or heatsink temperature > 100 °C. A sanity register
 * that hasn't been read fails the check too (GivTCP #583), because a partial read can't be told
 * from a good one. The heatsink is IR 41 on single-phase and IR 1128 on three-phase.
 */
function passesSanityCheck(registers: RegisterCaches, context: BuildContext): boolean {
  const modbusVersion = readHolding(registers, 34);
  const modbusAddress = readHolding(registers, 30);
  const userCode = readHolding(registers, 33);
  const heatsink = readInput(registers, context.layout === 'three_phase' ? 1128 : 41);
  if (modbusVersion === undefined || modbusAddress === undefined || userCode === undefined || heatsink === undefined) {
    return false;
  }
  return isSanityCheckPassing({
    modbusVersion: modbusVersion / 100,
    modbusAddress,
    userCode,
    heatsinkTemp: toInt16(heatsink) / 10,
  });
}

function powerFlows(solarWatts: number, loadWatts: number, batteryWatts: number, gridWatts: number) {
  // Battery: positive is discharging. Grid: positive is export.
  return calculatePowerFlows({
    solarWatts,
    loadWatts,
    chargeWatts: batteryWatts < 0 ? -batteryWatts : 0,
    dischargeWatts: batteryWatts > 0 ? batteryWatts : 0,
    importWatts: gridWatts < 0 ? -gridWatts : 0,
    exportWatts: gridWatts > 0 ? gridWatts : 0,
  });
}

/**
 * Build the snapshot from raw register caches, or `null` when the sanity check fails (a corrupt
 * or partial read). The return type follows the context's layout.
 */
export function buildSnapshot(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseSnapshot | null;
export function buildSnapshot(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseSnapshot | null;
export function buildSnapshot(registers: RegisterCaches, context: BuildContext): InverterSnapshot | null;
export function buildSnapshot(registers: RegisterCaches, context: BuildContext): InverterSnapshot | null {
  if (!passesSanityCheck(registers, context)) return null;
  const meters = buildMeters(registers);

  if (context.layout === 'three_phase') {
    const energy = buildEnergy(registers, context);
    const solar = { ...buildSolar(registers, context), ...energy.solar };
    const grid = { ...buildGrid(registers, context), energy: energy.grid };
    const load = { ...buildLoad(registers, context), ...energy.load };
    const battery = { ...buildBattery(registers, context), energy: energy.battery };
    return {
      layout: 'three_phase',
      model: context.model,
      capabilities: context.capabilities,
      identity: buildIdentity(registers, context),
      status: buildStatus(registers, context),
      solar,
      battery,
      grid,
      inverter: { ...buildInverterOutput(registers, context), energy: energy.inverter },
      eps: buildEps(registers, context),
      load,
      powerFlows: powerFlows(solar.power, load.power, battery.power, grid.power),
      meters,
      settings: buildSettings(registers, context),
      schedules: buildSchedules(registers, context),
    };
  }

  const energy = buildEnergy(registers, context);
  const solar = { ...buildSolar(registers, context), ...energy.solar };
  const grid = { ...buildGrid(registers, context), energy: energy.grid };
  const load = { ...buildLoad(registers, context), ...energy.load };
  const battery = { ...buildBattery(registers, context), energy: energy.battery };
  return {
    layout: 'single_phase',
    model: context.model,
    capabilities: context.capabilities,
    identity: buildIdentity(registers, context),
    status: buildStatus(registers, context),
    solar,
    battery,
    grid,
    inverter: { ...buildInverterOutput(registers, context), energy: energy.inverter },
    eps: buildEps(registers, context),
    load,
    powerFlows: powerFlows(solar.power, load.power, battery.power, grid.power),
    meters,
    settings: buildSettings(registers, context),
    schedules: buildSchedules(registers, context),
  };
}
