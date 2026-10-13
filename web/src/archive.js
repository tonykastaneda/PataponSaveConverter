import JSZip from 'jszip';

const slotPrefixes = {
  p1: ['UCUS98711', 'UCJS10077'],
  p2: ['UCUS98732', 'UCJS10089'],
};
const required = ['SECURE.BIN', 'PARAM.SFO', 'ICON0.PNG'];
const utf8 = new TextDecoder('utf-8', { fatal: true });
const playTimePatterns = [
  /Play time:\s*(\d+):(\d{2}):(\d{2})/,
  /プレイ時間[：:]\s*(\d+)時間(\d{1,2})分(\d{1,2})秒/,
];

function sfoEntries(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x14 || data.getUint32(0, true) !== 0x46535000) {
    throw new Error('The PSP PARAM.SFO is invalid.');
  }
  const keyStart = data.getUint32(8, true);
  const valueStart = data.getUint32(12, true);
  const count = data.getUint32(16, true);
  const entries = [];
  for (let index = 0; index < count; index++) {
    const entry = 0x14 + index * 0x10;
    const keyOffset = data.getUint16(entry, true);
    let keyEnd = keyStart + keyOffset;
    while (keyEnd < bytes.length && bytes[keyEnd]) keyEnd++;
    const key = new TextDecoder('ascii').decode(bytes.subarray(keyStart + keyOffset, keyEnd));
    entries.push({ key, entry, used: data.getUint32(entry + 4, true),
      maximum: data.getUint32(entry + 8, true),
      offset: valueStart + data.getUint32(entry + 12, true) });
  }
  return entries;
}

function savedataDetail(sfo) {
  const field = sfoEntries(sfo).find(({ key }) => key === 'SAVEDATA_DETAIL');
  if (!field) throw new Error('The PSP PARAM.SFO has no save detail field.');
  let end = field.offset + field.used;
  while (end > field.offset && sfo[end - 1] === 0) end--;
  return { field, text: utf8.decode(sfo.subarray(field.offset, end)) };
}

function matchPlayTime(text) {
  for (const pattern of playTimePatterns) {
    const match = pattern.exec(text);
    if (match) return match;
  }
  return null;
}

export function readPspPlayTime(sfo) {
  const match = matchPlayTime(savedataDetail(sfo).text);
  if (!match) throw new Error('The PSP save metadata has no play-time value.');
  const [hours, minutes, seconds] = match.slice(1).map(Number);
  if (minutes >= 60 || seconds >= 60) throw new Error('The PSP play-time value is invalid.');
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

export function setPspPlayTime(sfo, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error('The Replay save has an invalid play-time value.');
  }
  const { field, text } = savedataDetail(sfo);
  const match = matchPlayTime(text);
  if (!match) throw new Error('The PSP save metadata has no play-time value to replace.');
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  const replacement = match[0].startsWith('プレイ時間')
    ? `プレイ時間： ${hours}時間${pad(minutes)}分${pad(seconds)}秒`
    : `Play time: ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  const encoded = new TextEncoder().encode(text.slice(0, match.index) + replacement +
    text.slice(match.index + match[0].length) + '\0');
  if (encoded.length > field.maximum) throw new Error('The PSP play-time text exceeds its metadata allocation.');
  const result = sfo.slice();
  result.fill(0, field.offset, field.offset + field.maximum);
  result.set(encoded, field.offset);
  new DataView(result.buffer, result.byteOffset, result.byteLength)
    .setUint32(field.entry + 4, encoded.length, true);
  return result;
}

export async function detectPspInput(file) {
  const name = file.name.toUpperCase();
  if (name === 'SECURE.BIN') {
    const game = file.size > 200000 ? 'p1' : file.size > 100000 ? 'p2' : null;
    if (!game) throw new Error('This SECURE.BIN does not match a supported Patapon save.');
    return { game, psp: await readPspInput(file, game) };
  }
  if (!name.endsWith('.ZIP')) throw new Error('Drop a Replay .sav, a PSP savedata ZIP, or SECURE.BIN.');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const paths = Object.keys(zip.files).map((path) => path.toUpperCase());
  const game = paths.some((path) => slotPrefixes.p1.some((prefix) => path.includes(`${prefix}_DATA`))) ? 'p1'
    : paths.some((path) => slotPrefixes.p2.some((prefix) => path.includes(`${prefix}_DATA`))) ? 'p2' : null;
  if (!game) throw new Error('The ZIP is not a supported Patapon 1 or Patapon 2 savedata folder.');
  return { game, psp: await readPspInput(file, game) };
}

export async function readPspInput(file, game, requireTemplate = false) {
  if (file.name.toUpperCase() === 'SECURE.BIN' && !requireTemplate) {
    return { secure: new Uint8Array(await file.arrayBuffer()), slot: null };
  }
  if (!file.name.toLowerCase().endsWith('.zip')) {
    throw new Error('Choose a PSP savedata ZIP, or SECURE.BIN for a PSP source save.');
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const candidates = Object.values(zip.files).filter((entry) =>
    !entry.dir && (entry.name.toUpperCase() === 'SECURE.BIN' ||
      entry.name.toUpperCase().endsWith('/SECURE.BIN')));
  if (candidates.length !== 1) throw new Error('The ZIP must contain exactly one PSP SECURE.BIN.');
  const path = candidates[0].name;
  const folderPath = path.slice(0, -'SECURE.BIN'.length);
  let slot = folderPath.replace(/\/$/, '').split('/').pop();
  if (!slot) {
    const sfoEntry = zip.file(folderPath + 'PARAM.SFO');
    if (sfoEntry) {
      const sfoBytes = await sfoEntry.async('uint8array');
      const text = new TextDecoder('latin1').decode(sfoBytes);
      slot = text.match(new RegExp(`(?:${slotPrefixes[game].join('|')})_DATA[0-9][0-9]`, 'i'))?.[0];
    }
  }
  if (!new RegExp(`^(?:${slotPrefixes[game].join('|')})_DATA[0-9][0-9]$`, 'i').test(slot)) {
    throw new Error('The PSP save folder does not match the selected game.');
  }
  const result = { secure: new Uint8Array(await candidates[0].async('uint8array')), slot: slot.toUpperCase() };
  for (const name of required.slice(1)) {
    const entry = zip.file(folderPath + name);
    if (entry) result[name === 'PARAM.SFO' ? 'sfo' : 'icon'] = new Uint8Array(await entry.async('uint8array'));
    else if (requireTemplate) throw new Error(`The PSP template ZIP is missing ${name}.`);
  }
  return result;
}
function replaceBytes(bytes, oldText, newText) {
  if (oldText === newText) return bytes.slice();
  const oldBytes = new TextEncoder().encode(oldText);
  const newBytes = new TextEncoder().encode(newText);
  if (oldBytes.length !== newBytes.length) throw new Error('PSP slot names must have equal length.');
  const result = bytes.slice();
  let found = -1;
  for (let i = 0; i <= result.length - oldBytes.length; i++) {
    if (oldBytes.every((value, j) => result[i + j] === value)) {
      if (found >= 0) throw new Error('PSP slot name occurs more than once in PARAM.SFO.');
      found = i;
    }
  }
  if (found < 0) throw new Error('PSP slot name is missing from PARAM.SFO.');
  result.set(newBytes, found);
  return result;
}
export function outputSlot(game, number) {
  if (!/^[0-9]{2}$/.test(number)) throw new Error('Enter a two digit PSP slot number.');
  return `${slotPrefixes[game][0]}_DATA${number}`;
}
export function renamePspSfo(sfo, oldSlot, newSlot) {
  return replaceBytes(sfo, oldSlot, newSlot);
}
export async function createPspZip(slot, secure, sfo, icon) {
  const zip = new JSZip();
  const folder = zip.folder(slot);
  folder.file('SECURE.BIN', secure);
  folder.file('PARAM.SFO', sfo);
  folder.file('ICON0.PNG', icon);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

const align4 = (value) => (value + 3) & ~3;
const pngPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xfc0WQAAAABJRU5ErkJggg==';

export function createBlankPspTemplate(game, number = '99') {
  const slot = outputSlot(game, number);
  const entries = [
    ['CATEGORY', 0x0204, new TextEncoder().encode('MS\0'), 4],
    ['PARENTAL_LEVEL', 0x0404, Uint8Array.of(1, 0, 0, 0), 4],
    ['SAVEDATA_DETAIL', 0x0204,
      new TextEncoder().encode('Converted with Patapon Save Converter\nPlay time: 00:00:00\0'), 1024],
    ['SAVEDATA_DIRECTORY', 0x0204, new TextEncoder().encode(`${slot}\0`), 64],
    ['SAVEDATA_FILE_LIST', 0x0004, new TextEncoder().encode('SECURE.BIN\0'), 3168],
    ['SAVEDATA_PARAMS', 0x0004, new Uint8Array(), 128],
    ['SAVEDATA_TITLE', 0x0204, new TextEncoder().encode('Converted save\0'), 128],
    ['TITLE', 0x0204, new TextEncoder().encode(game === 'p1' ? 'PATAPON' : 'PATAPON 2'), 128],
  ];
  const keyTable = new TextEncoder().encode(entries.map(([name]) => `${name}\0`).join(''));
  const keyStart = 0x14 + entries.length * 0x10;
  const dataStart = align4(keyStart + keyTable.length);
  const sfo = new Uint8Array(0x1330);
  const view = new DataView(sfo.buffer);
  view.setUint32(0, 0x46535000, true); view.setUint32(4, 0x00000101, true);
  view.setUint32(8, keyStart, true); view.setUint32(12, dataStart, true); view.setUint32(16, entries.length, true);
  sfo.set(keyTable, keyStart);
  let keyOffset = 0; let dataOffset = 0;
  entries.forEach(([name, format, value, capacity], index) => {
    const pos = 0x14 + index * 0x10;
    view.setUint16(pos, keyOffset, true); view.setUint16(pos + 2, format, true);
    view.setUint32(pos + 4, value.length, true); view.setUint32(pos + 8, capacity, true);
    view.setUint32(pos + 12, dataOffset, true); sfo.set(value, dataStart + dataOffset);
    keyOffset += name.length + 1; dataOffset += align4(capacity);
  });
  const size = game === 'p1' ? 205512 : 128744;
  const plain = new Uint8Array(size);
  new DataView(plain.buffer).setInt32(8, 123, true);
  new DataView(plain.buffer).setInt32(12, 123, true);
  const icon = Uint8Array.from(atob(pngPixel), (character) => character.charCodeAt(0));
  return { slot, plain, sfo, icon };
}
