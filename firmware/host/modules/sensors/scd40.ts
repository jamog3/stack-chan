/**
 * Driver for the Sensirion SCD40 CO2/temperature/humidity sensor
 * (M5Stack CO2 Unit, https://www.switch-science.com/products/8496).
 * Connects over I2C at address 0x62, typically via the external Grove port.
 */

const ADDRESS = 0x62

const CMD_START_PERIODIC_MEASUREMENT = 0x21b1
const CMD_READ_MEASUREMENT = 0xec05
const CMD_STOP_PERIODIC_MEASUREMENT = 0x3f86
const CMD_GET_DATA_READY_STATUS = 0xe4b8

// Per the SCD40 datasheet, the sensor needs up to 1000ms after power-up
// before it will accept its first command.
const STARTUP_DELAY_MS = 1000
// Required settling time after stop_periodic_measurement before further commands.
const STOP_MEASUREMENT_DELAY_MS = 500

declare const trace: (message: string) => void

type I2CIO = {
  write(buffer: Uint8Array): void
  read(count: number): ArrayBuffer | Uint8Array
  close?: () => void
}

type I2COptions = {
  io: new (options: Record<string, unknown>) => I2CIO
  address?: number
  hz?: number
  [key: string]: unknown
}

type Scd40Options = {
  sensor?: I2COptions
}

type DeviceEnvironment = {
  Timer?: {
    delay: (milliseconds: number) => void
  }
  device?: {
    I2C?: {
      default?: Record<string, unknown>
    }
    io?: {
      I2C?: new (options: Record<string, unknown>) => I2CIO
    }
  }
}

const globalEnv = globalThis as typeof globalThis & DeviceEnvironment

function delay(milliseconds: number) {
  if (globalEnv.Timer?.delay) {
    globalEnv.Timer.delay(milliseconds)
    return
  }
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {}
}

function createDefaultSensorOptions(): I2COptions {
  const io = globalEnv.device?.io?.I2C
  if (!io) {
    throw new Error('device.io.I2C is not available')
  }
  return {
    ...(globalEnv.device?.I2C?.default ?? {}),
    io,
    address: ADDRESS,
    hz: 100_000,
    timeout: 1000,
  }
}

// Sensirion CRC8: polynomial 0x31, initialization 0xff.
function crc8(high: number, low: number): number {
  let crc = 0xff
  for (const byte of [high, low]) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff
    }
  }
  return crc
}

export type Scd40Sample = {
  co2: number
  temperatureC: number
  humidityPercent: number
}

export class Scd40 {
  #io: I2CIO

  constructor(options: Scd40Options = {}) {
    const sensor = options.sensor ?? createDefaultSensorOptions()
    this.#io = new sensor.io({ ...sensor, address: ADDRESS })
    delay(STARTUP_DELAY_MS)
  }

  close() {
    this.#io.close?.()
  }

  #sendCommand(command: number) {
    this.#io.write(Uint8Array.of((command >> 8) & 0xff, command & 0xff))
  }

  #readWords(count: number): number[] {
    const bytes = new Uint8Array(this.#io.read(count * 3))
    const words: number[] = []
    for (let index = 0; index < count; index++) {
      const offset = index * 3
      const high = bytes[offset]
      const low = bytes[offset + 1]
      const crc = bytes[offset + 2]
      if (crc8(high, low) !== crc) {
        throw new Error('SCD40 CRC mismatch')
      }
      words.push((high << 8) | low)
    }
    return words
  }

  startPeriodicMeasurement() {
    this.#sendCommand(CMD_START_PERIODIC_MEASUREMENT)
  }

  stopPeriodicMeasurement() {
    this.#sendCommand(CMD_STOP_PERIODIC_MEASUREMENT)
    delay(STOP_MEASUREMENT_DELAY_MS)
  }

  isDataReady(): boolean {
    this.#sendCommand(CMD_GET_DATA_READY_STATUS)
    delay(2)
    const [status] = this.#readWords(1)
    return (status & 0x07ff) !== 0
  }

  readMeasurement(): Scd40Sample {
    this.#sendCommand(CMD_READ_MEASUREMENT)
    delay(2)
    const [co2, rawTemperature, rawHumidity] = this.#readWords(3)
    return {
      co2,
      temperatureC: -45 + (175 * rawTemperature) / 65535,
      humidityPercent: (100 * rawHumidity) / 65535,
    }
  }
}

let sharedSensor: Scd40 | undefined
let sharedSensorFailed = false

/**
 * Returns the shared SCD40 instance, starting periodic measurement on first
 * use. Returns undefined (without retrying) if the sensor is not present or
 * failed to initialize, so callers can silently skip when unattached.
 */
export function tryGetSharedScd40(): Scd40 | undefined {
  if (sharedSensor) return sharedSensor
  if (sharedSensorFailed) return undefined
  try {
    const sensor = new Scd40()
    try {
      // The sensor may already be mid-measurement from a previous boot (it isn't
      // power-cycled between flashes); start_periodic_measurement NACKs in that
      // state, so stop first and swallow the error if it was already idle.
      sensor.stopPeriodicMeasurement()
    } catch (error) {
      trace(`[scd40] stop before init failed (likely already idle): ${error}\n`)
    }
    sensor.startPeriodicMeasurement()
    sharedSensor = sensor
    return sensor
  } catch (error) {
    sharedSensorFailed = true
    trace(`[scd40] init failed: ${error}\n`)
    return undefined
  }
}
