/**
 * Shape-based request/response matching for GivEnergy's Modbus protocol.
 *
 * GivEnergy inverters use a fixed transaction ID (0x5959) rather than a
 * sequential counter. Responses cannot be matched by transaction ID.
 * Instead, we match by "shape" — a hash of the request parameters.
 *
 * Reference: GivTCP/givenergy_modbus_async/pdu/base.py _shape_hash_keys()
 */

/**
 * Compute a shape hash key for a Modbus register request.
 *
 * @param slaveAddress - The Modbus slave/unit address (e.g. 0x31, 0x32)
 * @param functionCode - Transparent function code (0x03=holding, 0x04=input, 0x06=write)
 * @param baseRegister - Starting register address
 * @param registerCount - Number of registers (use 1 for writes)
 */
export function shapeHash(
  slaveAddress: number,
  functionCode: number,
  baseRegister: number,
  registerCount: number,
): string {
  return `${slaveAddress}:${functionCode}:${baseRegister}:${registerCount}`;
}
