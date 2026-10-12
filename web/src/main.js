import './style.css';
import { readPsp, writePsp, writeReplay } from './format.js';
import { decryptPsp, encryptPsp } from './crypto.js';
import { decryptReplay, encryptReplay } from './replayCrypto.js';
import { readPspInput, outputSlot, renamePspSfo, createPspZip } from './archive.js';

const state = { game: 'p1', direction: 'replay-to-psp' };
const byId = (id) => document.getElementById(id);
const form = byId('converter-form');
const source = byId('source-file');
const template = byId('template-file');
const status = byId('status');
const convertButton = byId('convert-button');

function fileBytes(file) { return file.arrayBuffer().then((buffer) => new Uint8Array(buffer)); }
function label(game) { return game === 'p1' ? 'Patapon 1' : 'Patapon 2'; }
function setStatus(message, type = '') {
  status.textContent = message;
  status.className = type;
}
function render() {
  const toPsp = state.direction === 'replay-to-psp';
  const verified = (state.game === 'p1' && toPsp) || (state.game === 'p2' && !toPsp);
  byId('support-description').textContent = verified
    ? 'This direction has been loaded successfully in game.'
    : 'Experimental: this direction has not been loaded in game yet.';
  byId('source-label').textContent = `${toPsp ? 'Replay' : 'PSP'} ${label(state.game)} save`;
  byId('source-hint').textContent = toPsp ? 'Choose your .sav file.' : 'Choose a savedata ZIP or SECURE.BIN.';
  byId('template-label').textContent = `Fresh ${toPsp ? 'PSP' : 'Replay'} ${label(state.game)} save`;
  byId('template-hint').textContent = toPsp ? 'ZIP the whole savedata folder from the target game.' : 'Choose a fresh .sav from the target game.';
  source.accept = toPsp ? '.sav' : '.zip,.bin';
  template.accept = toPsp ? '.zip' : '.sav';
  byId('slot-row').hidden = !toPsp;
  byId('slot-prefix').textContent = state.game === 'p1' ? 'UCUS98711_DATA' : 'UCUS98732_DATA';
  source.value = '';
  template.value = '';
  setStatus('');
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
async function convert() {
  const sourceFile = source.files?.[0];
  const templateFile = template.files?.[0];
  if (!sourceFile || !templateFile) throw new Error('Choose both a source save and a target template.');
  if (state.direction === 'psp-to-replay') {
    const psp = await readPspInput(sourceFile, state.game);
    const plain = await decryptPsp(psp.secure, state.game);
    readPsp(plain, state.game); // Check the game marker and binary layout.
    const target = await decryptReplay(await fileBytes(templateFile));
    const converted = writeReplay(target, plain, state.game);
    const encoded = await encryptReplay(converted);
    const check = await decryptReplay(encoded);
    if (JSON.stringify(check) !== JSON.stringify(converted)) throw new Error('Replay encryption check failed.');
    download(new Blob([encoded], { type: 'application/octet-stream' }),
      `patapon${state.game === 'p1' ? 1 : 2}-replay-converted.sav`);
  } else {
    const replay = await decryptReplay(await fileBytes(sourceFile));
    const psp = await readPspInput(templateFile, state.game, true);
    const plain = await decryptPsp(psp.secure, state.game);
    const converted = writePsp(plain, replay, state.game);
    const slot = outputSlot(state.game, byId('slot-number').value);
    const sfo = renamePspSfo(psp.sfo, psp.slot, slot);
    const encrypted = await encryptPsp(converted, sfo, state.game);
    const check = await decryptPsp(encrypted.secure, state.game);
    if (check.length !== converted.length || check.some((byte, i) => byte !== converted[i])) {
      throw new Error('PSP encryption check failed.');
    }
    const zip = await createPspZip(slot, encrypted.secure, encrypted.sfo, psp.icon);
    download(zip, `${slot}.zip`);
  }
}
byId('game-select').addEventListener('change', (event) => { state.game = event.target.value; render(); });
byId('direction-select').addEventListener('change', (event) => { state.direction = event.target.value; render(); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  convertButton.disabled = true;
  setStatus('Reading and converting your save…', 'busy');
  try {
    await convert();
    setStatus('Conversion complete. Your download is ready.', 'success');
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : 'Conversion failed.', 'error');
  } finally {
    convertButton.disabled = false;
  }
});
render();
