// A PSP in USB mode mounts as a drive. Chrome and Edge can open it through the
// File System Access API; the chosen folder handle is kept in IndexedDB so the
// next visit only needs a permission prompt instead of the picker.
import { describeSfo } from './sfo.js';

const SAVE_DIR = /^UCUS987(11|32)_DATA(\d\d)$/i;
const DB_NAME = 'patapon-save-converter';
const STORE = 'handles';
const KEY = 'psp';

export const pspSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function idb(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const loadHandle = () => idb('readonly', (store) => store.get(KEY)).catch(() => undefined);
const saveHandle = (handle) => idb('readwrite', (store) => store.put(handle, KEY)).catch(() => undefined);

// Loaded early so a click can ask for permission without waiting on IndexedDB.
let rememberedHandle = pspSupported ? loadHandle() : Promise.resolve(undefined);

async function childDir(parent, name) {
  for await (const [entryName, entry] of parent.entries()) {
    if (entry.kind === 'directory' && entryName.toUpperCase() === name) return entry;
  }
  return undefined;
}
async function childFile(parent, name) {
  for await (const [entryName, entry] of parent.entries()) {
    if (entry.kind === 'file' && entryName.toUpperCase() === name) return entry;
  }
  return undefined;
}

// Accept the drive root, its PSP folder, or SAVEDATA itself.
async function findSavedata(handle) {
  if (handle.name.toUpperCase() === 'SAVEDATA') return handle;
  const direct = await childDir(handle, 'SAVEDATA');
  if (direct) return direct;
  const psp = await childDir(handle, 'PSP');
  const nested = psp && await childDir(psp, 'SAVEDATA');
  if (nested) return nested;
  throw new Error('No PSP/SAVEDATA folder there. Put the PSP in USB mode and choose its drive.');
}

async function hasPermission(handle) {
  const options = { mode: 'readwrite' };
  if (await handle.queryPermission(options) === 'granted') return true;
  return await handle.requestPermission(options) === 'granted';
}

// Must run from a click: it may show the folder picker or a permission prompt.
export async function connectPsp() {
  if (!pspSupported) throw new Error('Connecting a PSP needs Chrome or Edge on a computer.');
  const remembered = await rememberedHandle;
  if (remembered) {
    try {
      if (await hasPermission(remembered)) return await findSavedata(remembered);
    } catch {
      // The PSP was unplugged or the drive changed; pick it again below.
    }
  }
  const picked = await window.showDirectoryPicker({ id: 'psp', mode: 'readwrite' });
  const savedata = await findSavedata(picked);
  rememberedHandle = Promise.resolve(picked);
  await saveHandle(picked);
  return savedata;
}

async function readBytes(fileHandle) {
  const file = await fileHandle.getFile();
  return { bytes: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified };
}

export async function listSaves(savedata) {
  const saves = [];
  for await (const [name, entry] of savedata.entries()) {
    const match = entry.kind === 'directory' && name.match(SAVE_DIR);
    if (!match) continue;
    const secureHandle = await childFile(entry, 'SECURE.BIN');
    if (!secureHandle) continue;
    const secure = await readBytes(secureHandle);
    const sfoHandle = await childFile(entry, 'PARAM.SFO');
    const sfo = sfoHandle ? (await readBytes(sfoHandle)).bytes : undefined;
    saves.push({
      kind: 'psp',
      game: match[1] === '11' ? 'p1' : 'p2',
      slot: name.toUpperCase(),
      label: `Save ${match[2]}`,
      secure: secure.bytes,
      ...describeSfo(sfo, secure.modified),
    });
  }
  return saves.sort((a, b) => a.game.localeCompare(b.game) || a.slot.localeCompare(b.slot));
}

export async function freeSlotNumber(savedata, prefix) {
  const used = new Set();
  for await (const [name, entry] of savedata.entries()) {
    if (entry.kind === 'directory' && name.toUpperCase().startsWith(`${prefix}_DATA`)) {
      used.add(name.slice(-2));
    }
  }
  for (let n = 1; n < 100; n++) {
    const number = String(n).padStart(2, '0');
    if (!used.has(number)) return number;
  }
  throw new Error('Every save slot for this game is in use on the PSP.');
}

// Writes a new save folder; never touches an existing one.
export async function writeSave(savedata, slot, files) {
  if (await childDir(savedata, slot)) throw new Error(`${slot} already exists on the PSP.`);
  const folder = await savedata.getDirectoryHandle(slot, { create: true });
  for (const [name, bytes] of Object.entries(files)) {
    const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
    await writable.write(bytes);
    await writable.close();
  }
}
