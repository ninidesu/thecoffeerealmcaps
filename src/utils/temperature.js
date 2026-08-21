export function normalizeOrderTemperature(value) {
  const temperature = String(value || '').trim().toLowerCase()

  if (temperature === 'cold only') return 'cold'
  if (temperature === 'iced only') return 'iced'
  if (temperature === 'hot only') return 'hot'

  return temperature
}
