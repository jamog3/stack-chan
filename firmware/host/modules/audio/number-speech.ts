/**
 * Converts a number into a sequence of speech-part resource keys (see
 * scripts/speeches/speeches_speech_parts.js) that can be played back
 * consecutively via speakParts() in tts-local.ts to read the number aloud
 * in Japanese, without needing a pre-recorded clip per possible value.
 */

// Handles the 0-9999 range, which covers hours (0-23), humidity (0-100),
// and CO2 ppm readings (clamp callers should keep values within this range).
function integerToParts(value: number): string[] {
  const parts: string[] = []
  let remainder = Math.floor(value)
  const thousands = Math.floor(remainder / 1000)
  if (thousands > 0) {
    parts.push(`num${thousands * 1000}`)
    remainder %= 1000
  }
  const hundreds = Math.floor(remainder / 100)
  if (hundreds > 0) {
    parts.push(`num${hundreds * 100}`)
    remainder %= 100
  }
  const tens = Math.floor(remainder / 10)
  if (tens > 0) {
    parts.push(`num${tens * 10}`)
    remainder %= 10
  }
  if (remainder > 0 || parts.length === 0) {
    parts.push(`num${remainder}`)
  }
  return parts
}

/**
 * @param decimalPlaces Number of fractional digits to read individually after
 * "numTen" (e.g. 23.5 with decimalPlaces=1 reads as "23", "てん", "5").
 */
export function numberToSpeechParts(value: number, decimalPlaces = 0): string[] {
  const parts: string[] = []
  let working = value
  if (working < 0) {
    parts.push('numMinus')
    working = -working
  }
  const scale = 10 ** decimalPlaces
  const scaled = Math.round(working * scale)
  const integerValue = Math.floor(scaled / scale)
  const fractionalValue = scaled % scale
  parts.push(...integerToParts(integerValue))
  if (decimalPlaces > 0) {
    parts.push('numTen')
    const fractionalDigits = String(fractionalValue).padStart(decimalPlaces, '0')
    for (const digit of fractionalDigits) {
      parts.push(`num${digit}`)
    }
  }
  return parts
}
