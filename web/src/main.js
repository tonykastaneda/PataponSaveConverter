import './style.css';
import { readPsp, writePsp, writeReplay } from './format.js';
import { decryptPsp, encryptPsp } from './crypto.js';
import { decryptReplay, encryptReplay } from './replayCrypto.js';
import { outputSlot, renamePspSfo, createPspZip } from './archive.js';
import { detectSave } from './detector.js';

async function getReplayTemplate(game) {
  if (game === 'p1') return (await import('./templates/p1Replay.json')).default;
  return (await import('./templates/p2Replay.json')).default;
}

async function getPspTemplate(game) {
  const { p1PspTemplate, p2PspTemplate } = await import('./templates/pspTemplates.js');
  return game === 'p1' ? p1PspTemplate : p2PspTemplate;
}

const byId = (id) => document.getElementById(id);
const form = byId('converter-form');
const dropZone = byId('drop-zone');
const fileInput = byId('file-input');
const detectionCard = byId('detection-card');
const cardFilename = byId('card-filename');
const cardFilesize = byId('card-filesize');
const sourceBadge = byId('source-badge');
const targetBadge = byId('target-badge');
const slotRow = byId('slot-row');
const slotPrefix = byId('slot-prefix');
const slotNumber = byId('slot-number');
const convertButton = byId('convert-button');
const clearButton = byId('clear-button');
const status = byId('status');

let currentDetected = null;

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = type;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function reset() {
  currentDetected = null;
  fileInput.value = '';
  detectionCard.hidden = true;
  dropZone.hidden = false;
  slotRow.hidden = true;
  convertButton.disabled = true;
  convertButton.textContent = 'Convert save';
  setStatus('');
}

async function handleFiles(files) {
  if (!files || files.length === 0) return;
  setStatus('Analyzing save file…', 'busy');
  try {
    const detected = await detectSave(files);
    currentDetected = detected;

    cardFilename.textContent = detected.fileName;
    cardFilesize.textContent = formatBytes(detected.fileSize);
    sourceBadge.textContent = `${detected.gameLabel} • ${detected.sourceLabel}`;
    targetBadge.textContent = detected.targetLabel;

    if (detected.targetType === 'psp') {
      slotRow.hidden = false;
      slotPrefix.textContent = detected.game === 'p1' ? 'UCUS98711_DATA' : 'UCUS98732_DATA';
      slotNumber.value = '01';
      convertButton.textContent = `Convert to ${detected.gameLabel} (PSP)`;
    } else {
      slotRow.hidden = true;
      convertButton.textContent = `Convert to ${detected.gameLabel} (PC Replay)`;
    }

    detectionCard.hidden = false;
    dropZone.hidden = true;
    convertButton.disabled = false;
    setStatus('');
  } catch (err) {
    console.error(err);
    reset();
    setStatus(err instanceof Error ? err.message : 'Could not recognize save file.', 'error');
  }
}

async function getFilesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  if (!items || items.length === 0) return Array.from(dataTransfer.files || []);
  const files = [];

  async function traverseEntry(entry, path = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
      if (file) {
        Object.defineProperty(file, 'relativePath', { value: path + file.name });
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readEntries = async () => {
        const entries = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
        if (entries.length > 0) {
          for (const child of entries) {
            await traverseEntry(child, path + entry.name + '/');
          }
          await readEntries();
        }
      };
      await readEntries();
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      await traverseEntry(entry);
    } else if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files.length > 0 ? files : Array.from(dataTransfer.files || []);
}

async function convert() {
  if (!currentDetected) throw new Error('Please drop a save file to convert.');
  const { game, sourceType, replayDocument, pspData } = currentDetected;

  if (sourceType === 'replay') {
    // Replay -> PSP
    const pspTemplate = await getPspTemplate(game);
    const num = slotNumber.value.trim();
    const slot = outputSlot(game, num);
    const convertedPlain = writePsp(pspTemplate.plain, replayDocument, game);
    const sfo = renamePspSfo(pspTemplate.sfo, pspTemplate.defaultSlot, slot);
    const encrypted = await encryptPsp(convertedPlain, sfo, game);

    // Verify roundtrip decryption
    const check = await decryptPsp(encrypted.secure, game);
    if (check.length !== convertedPlain.length || check.some((b, i) => b !== convertedPlain[i])) {
      throw new Error('PSP encryption verification failed.');
    }

    const zip = await createPspZip(slot, encrypted.secure, encrypted.sfo, pspTemplate.icon);
    download(zip, `${slot}.zip`);
    return `${slot}.zip`;
  } else {
    // PSP -> Replay
    const plain = await decryptPsp(pspData.secure, game);
    readPsp(plain, game); // layout validation

    const replayTemplate = await getReplayTemplate(game);
    const convertedReplay = writeReplay(replayTemplate, plain, game);
    const encoded = await encryptReplay(convertedReplay);

    // Verify roundtrip decryption
    const check = await decryptReplay(encoded);
    if (JSON.stringify(check) !== JSON.stringify(convertedReplay)) {
      throw new Error('Replay encryption verification failed.');
    }

    const filename = `patapon 1+2 replay_savedata_${game}.sav`;
    download(new Blob([encoded], { type: 'application/octet-stream' }), filename);
    return filename;
  }
}

// Event Listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files?.length) handleFiles(Array.from(e.target.files));
});
clearButton.addEventListener('click', reset);

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
  });
});

dropZone.addEventListener('drop', async (e) => {
  const items = e.dataTransfer?.items;
  if (items && items.length > 0) {
    const files = await getFilesFromDataTransfer(e.dataTransfer);
    if (files.length > 0) return handleFiles(files);
  }
  if (e.dataTransfer?.files?.length) {
    handleFiles(Array.from(e.dataTransfer.files));
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  convertButton.disabled = true;
  setStatus('Converting your save…', 'busy');
  try {
    const outputName = await convert();
    setStatus(`✓ Conversion complete! Downloaded ${outputName}`, 'success');
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : 'Conversion failed.', 'error');
  } finally {
    convertButton.disabled = false;
  }
});

reset();
