/**
 * Battery snapshot — decoded state of a single GivEnergy battery module.
 *
 * Data is read from the battery slave address space (IR 60–115) via the
 * battery's own BMS (battery management system).
 *
 * These values come from a different source than the inverter-level battery
 * fields in InverterSnapshot (stateOfCharge, batteryVoltage, batteryCurrent,
 * batteryTemperature). The inverter measures battery state at its DC bus,
 * while these come from the BMS inside each battery module. In a multi-battery
 * system, each module reports independently here.
 *
 * Reference: GivTCP/givenergy_modbus_async/model/battery.py
 */
export interface BatterySnapshot {
  /** 10-character serial number from IR(110-114) */
  serialNumber: string;
  /**
   * State of charge 0-100% from the BMS (IR 100).
   *
   * This may differ slightly from InverterSnapshot.stateOfCharge (IR 59),
   * which is the inverter's own reading. In a multi-battery system, the
   * inverter reports a combined SOC while each module reports its own here.
   */
  stateOfCharge: number;
  /**
   * Voltage in V — sum of all cell voltages from IR(80) via toMilli.
   *
   * This is measured by the BMS inside the battery module. It may differ
   * slightly from InverterSnapshot.batteryVoltage (IR 50), which is
   * measured at the inverter's DC bus and includes cable losses.
   */
  voltage: number;
  /** Battery discharge energy total in kWh — from IR(105) via toDeci */
  dischargeEnergyTotalKwh: number;
  /** Battery charge energy total in kWh — from IR(106) via toDeci */
  chargeEnergyTotalKwh: number;
  /**
   * Maximum cell temperature in °C — from IR(103) via toDeci.
   *
   * The BMS reports both min and max cell temperatures across its pack.
   * Compare with InverterSnapshot.batteryTemperature (IR 56), which is a
   * single reading from the inverter's own temperature sensor.
   */
  temperatureMax: number;
  /** Minimum cell temperature in °C — from IR(104) via toDeci */
  temperatureMin: number;
  /** Number of charge/discharge cycles from IR(96) */
  cycleCount: number;
  /** 16 individual cell voltages in V — from IR(60-75) via toMilli */
  cellVoltages: number[];
}
