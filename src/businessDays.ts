export function nextBusinessDay(harvestDay: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(harvestDay)) return '';
  const date = new Date(`${harvestDay}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== harvestDay) return '';
  do { date.setUTCDate(date.getUTCDate() + 1); }
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

export function executionAfterHarvest<T extends { is_all_day: boolean; start_time: string; end_time: string }>(config: T, harvestDay: string): T {
  const day = nextBusinessDay(harvestDay);
  if (!day) return { ...config, start_time: '', end_time: '' };
  if (config.is_all_day) return { ...config, start_time: day, end_time: '' };
  const startClock = config.start_time.split('T')[1] || '09:00';
  const endClock = config.end_time.split('T')[1] || '17:00';
  const oldStart = Date.parse(`${config.start_time.split('T')[0]}T00:00:00Z`);
  const oldEnd = Date.parse(`${config.end_time.split('T')[0]}T00:00:00Z`);
  const offset = Number.isFinite(oldStart) && Number.isFinite(oldEnd) ? Math.max(0, Math.round((oldEnd - oldStart) / 86400000)) : 0;
  const endDate = new Date(`${day}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + offset);
  return { ...config, start_time: `${day}T${startClock}`, end_time: `${endDate.toISOString().slice(0, 10)}T${endClock}` };
}
