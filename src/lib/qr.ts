/** Pull an EcoCypher evidence ID out of anything a QR code might contain. */
export function extractEvidenceId(text: string): string | null {
  const s = text.trim();
  const m = s.match(/EVD-[A-F0-9]{6,32}/i);
  if (m) return m[0].toUpperCase();
  try {
    const url = new URL(s);
    const q = url.searchParams.get('verify') || url.searchParams.get('id');
    if (q) return q.toUpperCase();
    const seg = url.pathname.split('/').filter(Boolean);
    const i = seg.indexOf('verify');
    if (i >= 0 && seg[i + 1]) return decodeURIComponent(seg[i + 1]).toUpperCase();
  } catch {
    /* not a URL */
  }
  return null;
}
