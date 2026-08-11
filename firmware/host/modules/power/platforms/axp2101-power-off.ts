import { getAxp2101Power } from 'axp2101-power-capture'

/**
 * Deliberately bypasses AXP2101.prototype.powerOff() from the Moddable SDK
 * driver: its first register write ORs in REG10H bit 1, which the AXP2101
 * datasheet (X-Powers, section on comm_cfg/0x10) defines as soft_sys_restart
 * (RWAC — writing 1 immediately restarts the SoC), not the "POWERON Negative
 * Edge IRQ enable" the driver's comment claims (that bit actually lives in a
 * different register, 0x41). Calling the driver's method restarts the board
 * instead of powering it off. REG10H bit 0 (soft_pwroff) is the documented,
 * verified power-off trigger, so only that bit is set here.
 */
export function powerOff(): void {
  const axp2101 = getAxp2101Power()
  if (!axp2101) return
  axp2101.writeByte(0x10, axp2101.readByte(0x10) | 0b00000001)
}
