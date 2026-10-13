// Minimal PARAM.SFO reader: returns { KEY: string | number }.
export function readSfo(bytes) {
  if (!bytes || bytes.length < 0x14) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46535000) return {};
  const keyStart = view.getUint32(8, true);
  const dataStart = view.getUint32(12, true);
  const count = view.getUint32(16, true);
  const latin = new TextDecoder('utf-8');
  const result = {};
  for (let i = 0; i < count; i++) {
    const pos = 0x14 + i * 0x10;
    if (pos + 0x10 > bytes.length) break;
    const keyOffset = keyStart + view.getUint16(pos, true);
    const format = view.getUint16(pos + 2, true);
    const length = view.getUint32(pos + 4, true);
    const offset = dataStart + view.getUint32(pos + 12, true);
    const keyEnd = bytes.indexOf(0, keyOffset);
    const key = latin.decode(bytes.subarray(keyOffset, keyEnd));
    if (format === 0x0404) result[key] = view.getUint32(offset, true);
    else if (format === 0x0204) {
      const raw = bytes.subarray(offset, offset + length);
      const end = raw.indexOf(0);
      result[key] = latin.decode(end < 0 ? raw : raw.subarray(0, end)).trim();
    }
  }
  return result;
}

// Name and time shown in a save row, from PARAM.SFO when the game wrote them.
export function describeSfo(sfo, fallbackDate) {
  const info = readSfo(sfo);
  const detail = String(info.SAVEDATA_DETAIL ?? '');
  const time = detail.match(/\b\d{1,3}:\d{2}(?::\d{2})?\b/)?.[0];
  return {
    name: info.SAVEDATA_TITLE || info.TITLE || '—',
    time: time || formatDate(fallbackDate),
  };
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
