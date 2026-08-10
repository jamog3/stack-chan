// Small reusable speech fragments (digits, place values, and fixed phrases)
// that get concatenated at runtime by number-speech.ts to announce the hour
// and SCD40 readings (temperature/humidity/CO2). Keeping each fragment short
// keeps total asset size far below bundling one recording per possible value.
export const speeches = {
  // Ones place (also used standalone for 0-9).
  num0: 'ゼロ',
  num1: 'いち',
  num2: 'に',
  num3: 'さん',
  num4: 'よん',
  num5: 'ご',
  num6: 'ろく',
  num7: 'なな',
  num8: 'はち',
  num9: 'きゅう',
  // Tens place (10-90); irregular readings are baked into the recording.
  num10: 'じゅう',
  num20: 'にじゅう',
  num30: 'さんじゅう',
  num40: 'よんじゅう',
  num50: 'ごじゅう',
  num60: 'ろくじゅう',
  num70: 'ななじゅう',
  num80: 'はちじゅう',
  num90: 'きゅうじゅう',
  // Hundreds place (100-900), needed for CO2 ppm readings.
  num100: 'ひゃく',
  num200: 'にひゃく',
  num300: 'さんびゃく',
  num400: 'よんひゃく',
  num500: 'ごひゃく',
  num600: 'ろっぴゃく',
  num700: 'ななひゃく',
  num800: 'はっぴゃく',
  num900: 'きゅうひゃく',
  // Thousands place (1000-9000), needed for CO2 ppm readings.
  num1000: 'せん',
  num2000: 'にせん',
  num3000: 'さんぜん',
  num4000: 'よんせん',
  num5000: 'ごせん',
  num6000: 'ろくせん',
  num7000: 'ななせん',
  num8000: 'はっせん',
  num9000: 'きゅうせん',
  // Decimal point (currently unused; temperature is read as a whole number)
  // and minus sign (used by the temperature reading for sub-zero values).
  numTen: 'てん',
  numMinus: 'まいなす',
  // Hourly time signal suffix; combined with the number parts above.
  hourSuffix: 'じになりました。',
  // Environment reading phrase, split around the number parts:
  // 現在の室温は[温度]度、湿度は[湿度]パーセント、CO2レベルは[CO2、百の位までに丸め]ピーピーエムです。
  envIntro: 'げんざいのしつおんは',
  envDegreeToHumidity: 'ど、しつどは',
  envPercentToCo2: 'パーセント、シーオーツーレベルは',
  envPpmEnd: 'ピーピーエムです。',
}
