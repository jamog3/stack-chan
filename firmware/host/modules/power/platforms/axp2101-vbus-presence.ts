import { getAxp2101Power } from 'axp2101-power-capture'

export function isVbusPresent(): boolean | undefined {
  return getAxp2101Power()?.isVBUSExist()
}
