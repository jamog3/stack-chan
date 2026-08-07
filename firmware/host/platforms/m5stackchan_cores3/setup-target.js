import { getAxp2101Power } from 'axp2101-power-capture'

// Mirrors the CoreS3 power-rail setup used by M5Stack/StackChan firmware
// (`firmware/main/hal/board/stackchan.cc` near the AXP2101 init path) and the
// X-Powers AXP2101 register map for DCDC/ALDO/BLDO/LDO and charge-control fields.
function patchStackChanPower() {
  const axp2101 = getAxp2101Power()
  if (!axp2101) throw new Error('AXP2101 power instance is unavailable')

  const data = axp2101.readByte(0x90)
  // Enable the LDO rails needed by the CoreS3 StackChan base.
  axp2101.writeByte(0x90, data | 0b10110100)
  // Set DCDC/LDO voltage selector used by the reference firmware.
  axp2101.writeByte(0x97, 0b11110 - 2)
  // Configure VBUS input current limit and power-path behavior.
  axp2101.writeByte(0x69, 0b00110101)
  // Enable required DCDC outputs.
  axp2101.writeByte(0x30, 0b111111)
  // Force the final LDO enable mask after the voltage selectors are set.
  axp2101.writeByte(0x90, 0xbf)
  // Set ALDO/BLDO voltage setpoints (unrelated to backlight — confirmed by
  // on-device testing that neither rail affects screen brightness).
  axp2101.writeByte(0x94, 33 - 5)
  axp2101.writeByte(0x95, 33 - 5)
  // Disable one unused LDO path to match the reference board profile.
  axp2101.writeByte(0x27, 0x00)

  // LCD backlight is driven by DLDO1, not ALDO/BLDO. Per the official
  // StackChan firmware (firmware/main/hal/board/stackchan.cc SetBrightness),
  // brightness 1-100 maps to register value 20-28: 20 + (brightness * 8 / 100).
  // DLDO1 enable lives in bit 0x80 of 0x90, already set above via 0xbf.
  const brightness = 15
  axp2101.writeByte(0x99, 20 + Math.floor((brightness * 8) / 100))

  const charge = axp2101.readByte(0x62)
  // Preserve charge-control upper bits and set the target charge-current field.
  axp2101.writeByte(0x62, (charge & 0xe0) | 13)
  trace('[m5stackchan] patched CoreS3 AXP2101 power rails\n')
}

export default function (done) {
  // The inherited CoreS3 setup precedes this module and constructs the shared
  // AXP2101 before this board-specific rail configuration runs.
  try {
    patchStackChanPower()
  } catch (error) {
    trace(`[m5stackchan] AXP2101 power patch failed: ${error}\n`)
  }
  done?.()
}
