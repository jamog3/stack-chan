import { powerOff } from 'power-off'
import { setBacklightPercent } from 'set-backlight'
import Timer from 'timer'
import { isVbusPresent } from 'vbus-presence'

const VBUS_POLL_INTERVAL_MS = 2000
const VBUS_LOSS_SHUTDOWN_DELAY_MS = 10 * 60 * 1000
const VBUS_LOSS_SHUTDOWN_STREAK = Math.round(VBUS_LOSS_SHUTDOWN_DELAY_MS / VBUS_POLL_INTERVAL_MS)

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export type VbusShutdownTarget = {
  setTorque: (enabled: boolean) => Promise<void>
}

// USB power-loss shutdown: dimming the backlight alone leaves the ESP32, servos, and mic
// running, which barely helps battery life. Once VBUS has been away for
// VBUS_LOSS_SHUTDOWN_STREAK consecutive polls (debounced against brief USB blips), release
// servo torque and cut board power via the PMIC. isVbusPresent() returns undefined on
// platforms without VBUS reporting, where this never fires. Powering back on happens at the
// PMIC level when VBUS is reinserted; there is no software wake path here.
export function startVbusShutdownWatch(target: VbusShutdownTarget) {
  let vbusLossStreak = 0
  let isPoweringOffForVbusLoss = false
  Timer.repeat(() => {
    if (isPoweringOffForVbusLoss) return
    const vbusPresent = isVbusPresent()
    if (vbusPresent === undefined || vbusPresent) {
      vbusLossStreak = 0
      return
    }
    vbusLossStreak += 1
    if (vbusLossStreak < VBUS_LOSS_SHUTDOWN_STREAK) return
    isPoweringOffForVbusLoss = true
    trace('[Power] VBUS lost; powering off to conserve battery\n')
    void (async () => {
      setBacklightPercent(0)
      try {
        await target.setTorque(false)
      } catch (error) {
        trace(`[Power] torque release error ${errorMessage(error)}\n`)
      }
      powerOff()
    })()
  }, VBUS_POLL_INTERVAL_MS)
}
