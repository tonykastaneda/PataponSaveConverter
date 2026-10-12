import './style.css';
import { writePsp, writeReplay } from './format.js';
import { decryptPsp, encryptPsp } from './crypto.js';
import { decryptReplay, encryptReplay } from './replayCrypto.js';
import { detectPspInput, createBlankPspTemplate, createPspZip } from './archive.js';

const byId = (id) => document.getElementById(id);
const input = byId('source-file');
const dropZone = byId('drop-zone');
const button = byId('convert-button');
const status = byId('status');
let selectedFile;

const bytes = (file) => file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
const gameName = (game) => game === 'p1' ? 'Patapon 1' : 'Patapon 2';
function setStatus(message, type = '') { status.textContent = message; status.className = type; }
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function choose(file) {
  selectedFile = file;
  byId('file-detail').textContent = file ? file.name : 'or choose a .sav, savedata ZIP, or SECURE.BIN';
  button.disabled = !file;
  setStatus(file ? 'Ready to detect and convert.' : '');
}
function detectReplayGame(document) {
  const count = document?.laboGlobalDatas?.[0]?.gameGlobalData?.unitGlobalData?.unitAddingParam?.length;
  if (count === 400) return 'p1';
  if (count === 64) return 'p2';
  throw new Error('This Replay save is not Patapon 1 or Patapon 2.');
}
async function convertReplay(file) {
  const replay = await decryptReplay(await bytes(file));
  const game = detectReplayGame(replay);
  setStatus(`${gameName(game)} Replay save detected. Converting to PSP…`);
  const template = createBlankPspTemplate(game);
  const converted = writePsp(template.plain, replay, game);
  const encrypted = await encryptPsp(converted, template.sfo, game);
  const check = await decryptPsp(encrypted.secure, game);
  if (check.length !== converted.length || check.some((value, index) => value !== converted[index])) {
    throw new Error('PSP encryption check failed.');
  }
  const zip = await createPspZip(template.slot, encrypted.secure, encrypted.sfo, template.icon);
  download(zip, `${template.slot}.zip`);
  return `${gameName(game)} converted to PSP.`;
}
async function convertPsp(file) {
  const { game, psp } = await detectPspInput(file);
  setStatus(`${gameName(game)} PSP save detected. Converting to Replay…`);
  const plain = await decryptPsp(psp.secure, game);
  const response = await fetch(`./templates/${game}.replay.json`);
  if (!response.ok) throw new Error('The built-in Replay template could not be loaded.');
  const converted = writeReplay(await response.json(), plain, game);
  const encoded = await encryptReplay(converted);
  download(new Blob([encoded], { type: 'application/octet-stream' }),
    `patapon 1+2 replay_savedata_${game}.sav`);
  return `${gameName(game)} converted to Replay.`;
}

input.addEventListener('change', () => choose(input.files?.[0]));
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => {
  event.preventDefault(); dropZone.classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => {
  event.preventDefault(); dropZone.classList.remove('dragging');
});
dropZone.addEventListener('drop', (event) => choose(event.dataTransfer?.files?.[0]));
byId('converter-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!selectedFile) return;
  button.disabled = true;
  try {
    const replay = selectedFile.name.toLowerCase().endsWith('.sav');
    const message = await (replay ? convertReplay(selectedFile) : convertPsp(selectedFile));
    setStatus(`${message} Download started.`, 'success');
  } catch (error) {
    console.error(error); setStatus(error instanceof Error ? error.message : 'Conversion failed.', 'error');
  } finally { button.disabled = false; }
});
