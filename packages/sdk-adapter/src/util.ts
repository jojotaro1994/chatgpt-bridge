export function nowIso(): string {
  return new Date().toISOString();
}

export function chunkText(s: string, size: number): string[] {
  if (size <= 0) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
