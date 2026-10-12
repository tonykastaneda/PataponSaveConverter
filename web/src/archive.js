import JSZip from 'jszip';

const slotPrefix = { p1: 'UCUS98711', p2: 'UCUS98732' };
const required = ['SECURE.BIN', 'PARAM.SFO', 'ICON0.PNG'];

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
  const game = paths.some((path) => path.includes('UCUS98711_DATA')) ? 'p1'
    : paths.some((path) => path.includes('UCUS98732_DATA')) ? 'p2' : null;
  if (!game) throw new Error('The ZIP is not a USA Patapon 1 or Patapon 2 savedata folder.');
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
      slot = text.match(new RegExp(`${slotPrefix[game]}_DATA[0-9][0-9]`, 'i'))?.[0];
    }
  }
  if (!new RegExp(`^${slotPrefix[game]}_DATA[0-9][0-9]$`, 'i').test(slot)) {
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
  return `${slotPrefix[game]}_DATA${number}`;
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

export function createBlankPspTemplate(game) {
  const slot = outputSlot(game, '99');
  const entries = [
    ['CATEGORY', 0x0204, new TextEncoder().encode('MS\0'), 4],
    ['PARENTAL_LEVEL', 0x0404, Uint8Array.of(1, 0, 0, 0), 4],
    ['SAVEDATA_DETAIL', 0x0204, new TextEncoder().encode('Converted with Patapon Save Converter\0'), 1024],
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
