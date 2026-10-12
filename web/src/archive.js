import JSZip from 'jszip';

const slotPrefix = { p1: 'UCUS98711', p2: 'UCUS98732' };
const required = ['SECURE.BIN', 'PARAM.SFO', 'ICON0.PNG'];

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
