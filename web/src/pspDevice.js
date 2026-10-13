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
const load = (key) => idb('readonly', (store) => store.get(key)).catch(() => undefined);
const save = (key, value) => idb('readwrite', (store) => store.put(value, key)).catch(() => undefined);
const PATH_KEY = 'psp-savedata-path';

// Loaded early so a click can ask for permission without waiting on IndexedDB.
let rememberedHandle = pspSupported ? load(KEY) : Promise.resolve(undefined);
// Folder names from the picked folder down to SAVEDATA, so polling skips the search.
let rememberedPath = pspSupported ? load(PATH_KEY) : Promise.resolve(undefined);

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

// Any PSP save folder name (game ID), e.g. UCUS98732_DATA01 or ULUS10041SAVE.
const ANY_SAVE_DIR = /^[A-Z]{4}\d{5}/i;
const MAX_DEPTH = 5;
const MAX_FOLDERS = 2000;

// Search everything under the picked folder for the PSP's SAVEDATA. Prefers PSP/SAVEDATA,
// then any SAVEDATA, then any folder holding Patapon saves (e.g. a backup copy).
// Returns { savedata, path } where path is the folder names from the picked folder down.
// Folders above the picked one are out of reach: the browser only grants what was picked.
async function searchSavedata(picked) {
  if (picked.name.toUpperCase() === 'SAVEDATA') return { savedata: picked, path: [] };
  if (ANY_SAVE_DIR.test(picked.name)) {
    throw new Error('That is a single save\'s folder. Choose the PSP itself (its drive) instead.');
  }
  const queue = [{ dir: picked, path: [], parent: '' }];
  let anySavedata;
  let holdsSaves;
  for (let visited = 0; queue.length && visited < MAX_FOLDERS; visited++) {
    const { dir, path, parent } = queue.shift();
    if (path.length && dir.name.toUpperCase() === 'SAVEDATA') {
      if (parent === 'PSP') return { savedata: dir, path };
      anySavedata ??= { savedata: dir, path };
      continue;
    }
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind !== 'directory') continue;
      if (SAVE_DIR.test(name)) { holdsSaves ??= { savedata: dir, path }; continue; }
      if (ANY_SAVE_DIR.test(name) || path.length >= MAX_DEPTH) continue;
      queue.push({ dir: entry, path: [...path, name], parent: dir.name.toUpperCase() });
    }
  }
  const found = anySavedata ?? holdsSaves;
  if (found) return found;
  throw new Error('No PSP SAVEDATA folder was found inside that folder. Put the PSP in USB mode and choose its drive.');
}
async function followPath(root, path) {
  let dir = root;
  for (const name of path) dir = await dir.getDirectoryHandle(name);
  return dir;
}
async function findSavedata(root) {
  const path = await rememberedPath;
  if (Array.isArray(path)) {
    try {
      const dir = await followPath(root, path);
      for await (const _ of dir.entries()) break; // throws if the PSP is unplugged
      return dir;
    } catch (error) {
      if (error?.name !== 'NotFoundError' && error?.name !== 'TypeMismatchError') throw error;
    }
  }
  const found = await searchSavedata(root);
  rememberedPath = Promise.resolve(found.path);
  await save(PATH_KEY, found.path);
  return found.savedata;
}

async function hasPermission(handle) {
  const options = { mode: 'readwrite' };
  if (await handle.queryPermission(options) === 'granted') return true;
  return await handle.requestPermission(options) === 'granted';
}

// Silent check, safe to poll: the remembered PSP's SAVEDATA if it's plugged in and
// Chrome still grants access, else null. Never prompts.
export async function checkPsp() {
  if (!pspSupported) return null;
  const remembered = await rememberedHandle;
  if (!remembered) return null;
  try {
    if (await remembered.queryPermission({ mode: 'readwrite' }) !== 'granted') return null;
    return await findSavedata(remembered);
  } catch {
    return null;
  }
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
  const found = await searchSavedata(picked);
  rememberedHandle = Promise.resolve(picked);
  rememberedPath = Promise.resolve(found.path);
  await save(KEY, picked);
  await save(PATH_KEY, found.path);
  return found.savedata;
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
