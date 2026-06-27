export function nowIso(): string {
  return new Date().toISOString();
}

export function detectDeviceType(): 'mac' | 'linux' | 'windows' {
  const p = process.platform;
  if (p === 'darwin') return 'mac';
  if (p === 'linux') return 'linux';
  if (p === 'win32') return 'windows';
  return 'linux';
}
