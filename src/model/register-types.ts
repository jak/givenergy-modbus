/**
 * Register type markers matching GivEnergy's Modbus register layout.
 *
 * HR = Holding Register (read/write, Modbus function 0x03 read / 0x06 write)
 * IR = Input Register (read-only, Modbus function 0x04)
 *
 * Reference: GivTCP/givenergy_modbus_async/model/register.py
 */
export type RegisterType = 'HR' | 'IR';

export interface TimeSlot {
  /** "HH:MM" format */
  start: string;
  /** "HH:MM" format */
  end: string;
}
