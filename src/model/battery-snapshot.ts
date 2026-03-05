/**
 * Battery snapshot — decoded state of a single GivEnergy battery module.
 *
 * Data is read from the battery slave address space (IR 60–115).
 * Reference: GivTCP/givenergy_modbus_async/model/battery.py
 */
export interface BatterySnapshot {
  /** 10-character serial number from IR(110-114) */
  serialNumber: string;
  /** State of charge 0-100% from IR(100) */
  stateOfCharge: number;
  /** Voltage in V — from cap_remaining uint32 IR(88-89) via toCenti */
  voltage: number;
  /** Current in A */
  current: number;
  /** Maximum cell temperature in °C — from IR(103) via toDeci */
  temperatureMax: number;
  /** Minimum cell temperature in °C — from IR(104) via toDeci */
  temperatureMin: number;
  /** Number of charge/discharge cycles from IR(96) */
  cycleCount: number;
  /** 16 individual cell voltages in V — from IR(60-75) via toMilli */
  cellVoltages: number[];
}
