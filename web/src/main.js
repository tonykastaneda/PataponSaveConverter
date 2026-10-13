import './style.css';
import sceneAnimated from './assets/scene.svg';
import sceneStill from './assets/scene-still.svg';
import arrowBig from './assets/arrow-big.svg';
import arrowSmall from './assets/arrow-small.svg';
import bandai from './assets/bandai.svg';
import bannerP2Bg from './assets/banner-p2-bg.svg';
import esrb from './assets/esrb.svg';
import iconCheck from './assets/icon-check.svg';
import iconDownload from './assets/icon-download.svg';
import iconUpload from './assets/icon-upload.svg';
import iconUsb from './assets/icon-usb.svg';
import logoP1 from './assets/logo-p1.svg';
import logoP1Outline from './assets/logo-p1-outline.svg';
import logoP1Replay from './assets/logo-p1-replay.svg';
import logoP1White from './assets/logo-p1-white.svg';
import logoP2 from './assets/logo-p2.svg';
import logoP2Replay from './assets/logo-p2-replay.svg';
import musicLoop from './assets/musicloop.mp3';
import psLogo from './assets/ps-logo.svg';
import pspLogo from './assets/psp-logo.svg';
import pspMini from './assets/psp-mini.svg';
import textConnect from './assets/text-connect.svg';
import textConvert from './assets/text-convert.svg';
import textSelect from './assets/text-select.svg';
import textUploadSave from './assets/text-upload-save.svg';
import { writePsp, writeReplay } from './format.js';
import { decryptPsp, encryptPsp } from './crypto.js';
import { decryptReplay, encryptReplay } from './replayCrypto.js';
import { detectPspInput, createBlankPspTemplate, createPspZip } from './archive.js';
import { pspSupported, checkPsp, connectPsp, listSaves, freeSlotNumber, writeSave } from './pspDevice.js';
import { describeSfo, formatDate } from './sfo.js';

const byId = (id) => document.getElementById(id);
const card = byId('card');
const actions = byId('actions');
const status = byId('status');
const input = byId('file-input');
const savePath = byId('save-path');
const copyPath = byId('save-path-copy');

const PREFIX = { p1: 'UCUS98711', p2: 'UCUS98732' };
const GAME_NAME = { p1: 'Patapon', p2: 'Patapon 2' };
// Logo art and its width in mockup points, per game and platform.
const LOGO = {
  p1: { psp: [logoP1, 135.2], replay: [logoP1Replay, 134.8] },
  p2: { psp: [logoP2, 149.6], replay: [logoP2Replay, 117.6] },
};
const other = (kind) => kind === 'psp' ? 'replay' : 'psp';
const platformName = (kind) => kind === 'psp' ? 'PSP' : 'Replay';

// screen: home (upload or browse) → list (saves on the PSP) → confirm (convert)
const state = { screen: 'home', savedata: null, saves: [], selected: 0, source: null, busy: false };

// The scene's flicker and twinkle live inside the SVG, where the page's reduced-motion
// CSS can't reach, so pick the still copy up front.
const sceneUrl = matchMedia('(prefers-reduced-motion: reduce)').matches ? sceneStill : sceneAnimated;
for (const [id, src] of [['scene', sceneUrl], ['brand', logoP1Outline], ['esrb', esrb], ['psp-logo', pspLogo],
  ['ps-logo', psLogo], ['bandai', bandai]]) byId(id).src = src;
// Warm the cache so later screens don't pop their art in.
for (const src of [arrowBig, arrowSmall, bannerP2Bg, iconCheck, iconDownload, logoP1, logoP1Replay,
  logoP1White, logoP2, logoP2Replay, textConvert, textSelect]) new Image().src = src;

// ---------- DOM helpers ----------
function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.filter(Boolean));
  return node;
}
function art(src, width, className = '', alt = '') {
  const image = el('img', className);
  image.src = src;
  image.alt = alt;
  image.draggable = false;
  image.style.width = `calc(${width} * var(--u))`;
  return image;
}
function button(label, onClick, ...content) {
  const node = el('button', 'button', ...content);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}
function setStatus(message = '', type = '') {
  status.textContent = message;
  status.className = `status ${type}`.trim();
}
function fail(error) {
  console.error(error);
  setStatus(error instanceof Error ? error.message : 'Something went wrong.', 'error');
}
function setBusy(busy) {
  state.busy = busy;
  actions.querySelectorAll('button').forEach((node) => { node.disabled = busy; });
}

// ---------- Pieces ----------
// Spinner until a PSP is reachable, then the green check (toggled by setConnected).
function pspStatus() {
  const node = el('span', 'psp-status', el('span', 'spinner'), art(iconCheck, 17.3, 'check'));
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', state.savedata ? 'PSP connected' : 'No PSP connected');
  return node;
}
const pspPair = (...before) => el('span', 'psp-pair', ...before, art(pspMini, 70.3, '', 'PSP'),
  pspStatus(), art(iconUsb, 23));
const pspHeader = () => el('div', 'header', pspPair());

function setConnected(savedata) {
  state.savedata = savedata;
  document.documentElement.classList.toggle('psp-on', Boolean(savedata));
  document.querySelectorAll('.psp-status').forEach((node) => {
    node.setAttribute('aria-label', savedata ? 'PSP connected' : 'No PSP connected');
  });
}
// Notice the PSP being plugged in or out once Chrome has kept access to it.
async function pollPsp() {
  if (document.hidden || state.busy) return;
  const savedata = await checkPsp();
  if (Boolean(savedata) !== Boolean(state.savedata)) setConnected(savedata);
}

function banner(save) {
  const node = el('div', 'banner');
  if (save.kind === 'psp' && save.game === 'p2') {
    node.append(art(bannerP2Bg, 174.9, 'bg'), art(logoP2, 129.6, 'logo'));
  } else if (save.kind === 'psp') node.append(art(logoP1White, 126.9, 'logo'));
  else node.append(art(save.game === 'p1' ? logoP1Replay : logoP2Replay, 117.6, 'logo'));
  return node;
}
function saveRow(save, selected, tag = 'div') {
  const node = el(tag, `row${selected ? ' selected' : ''}`,
    art(arrowBig, 40.7, 'arrow'), banner(save),
    el('div', 'meta', el('strong', '', save.label),
      el('span', '', `NAME: ${save.name}`), el('span', '', `TIME: ${save.time}`)));
  node.setAttribute('aria-label',
    `${GAME_NAME[save.game]} ${platformName(save.kind)}, ${save.label}, ${save.name}, ${save.time}`);
  return node;
}

// ---------- Screens ----------
function renderHome() {
  const drop = el('div', 'drop', art(iconUpload, 61.4), art(textUploadSave, 315.4, '', 'Upload save'));
  drop.tabIndex = 0;
  drop.setAttribute('role', 'button');
  drop.setAttribute('aria-label', 'Upload save: a Replay .sav, a PSP savedata ZIP, or SECURE.BIN');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  card.replaceChildren(drop);
  const help = el('span', 'help', '?', el('span', 'help-tip', 'Select PSP Root'));
  help.setAttribute('aria-hidden', 'true');
  // The hint shouldn't start a connection; a tap toggles it on touch screens.
  help.addEventListener('click', (event) => { event.stopPropagation(); help.classList.toggle('show'); });
  const browse = button('Connect a PSP and browse its saves. Select the PSP root folder.', browsePsp,
    help, art(textConnect, 132.8, '', 'Connect'), pspPair());
  actions.replaceChildren(browse);
}

function renderList() {
  card.replaceChildren(pspHeader());
  if (!state.saves.length) {
    card.append(el('p', 'empty', 'No Patapon or Patapon 2 saves were found on this PSP.'));
  } else {
    const list = el('div', 'list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Saves on the PSP');
    state.saves.forEach((save, index) => {
      const selected = index === state.selected;
      const row = saveRow(save, selected, 'button');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(selected));
      row.tabIndex = selected ? 0 : -1;
      row.addEventListener('click', () => { state.selected = index; renderList(); focusSelected(); });
      row.addEventListener('dblclick', chooseSelected);
      list.append(row);
    });
    list.addEventListener('keydown', (event) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step) {
        event.preventDefault();
        state.selected = Math.max(0, Math.min(state.saves.length - 1, state.selected + step));
        renderList(); focusSelected();
      } else if (event.key === 'Enter') { event.preventDefault(); chooseSelected(); }
    });
    card.append(list);
  }
  const select = button('Select', chooseSelected, art(textSelect, 128.2));
  select.disabled = !state.saves.length;
  actions.replaceChildren(select);
}
function focusSelected() {
  const row = card.querySelector('.row.selected');
  row?.focus();
  row?.scrollIntoView({ block: 'nearest' });
}

function renderConfirm() {
  const source = state.source;
  const [fromLogo, fromWidth] = LOGO[source.game][source.kind];
  const [toLogo, toWidth] = LOGO[source.game][other(source.kind)];
  card.replaceChildren(
    pspSupported ? pspHeader() : el('div', 'header'),
    el('div', 'list static', saveRow(source, true)),
    el('div', 'summary',
      art(fromLogo, fromWidth, '', `${GAME_NAME[source.game]} ${platformName(source.kind)}`),
      art(arrowSmall, 26.3, '', 'to'),
      art(toLogo, toWidth, '', `${GAME_NAME[source.game]} ${platformName(other(source.kind))}`)));
  if (source.kind === 'psp') {
    actions.replaceChildren(button('Convert and download the Replay save', convertToReplay,
      el('span', 'pair', art(textConvert, 160.7), art(iconDownload, 38.6))));
  } else {
    actions.replaceChildren(
      button('Convert and download the PSP save', downloadPspZip,
        el('span', 'pair', art(textConvert, 146.8), art(iconDownload, 35.3))),
      button('Convert and write to the connected PSP', writeToPsp,
        pspPair()));
  }
}

function render() {
  if (state.screen === 'list' && !state.savedata) state.screen = 'home';
  if (state.screen === 'confirm' && !state.source) state.screen = 'home';
  ({ home: renderHome, list: renderList, confirm: renderConfirm })[state.screen]();
  savePath.hidden = state.screen !== 'home';
  setBusy(state.busy);
}
function go(screen) {
  state.screen = screen;
  history.pushState({ screen }, '');
  render();
}
window.addEventListener('popstate', (event) => {
  state.screen = event.state?.screen ?? 'home';
  setStatus();
  render();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.screen !== 'home' && !state.busy) history.back();
});

// ---------- Reading saves ----------
const bytes = (file) => file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
function detectReplayGame(document) {
  const count = document?.laboGlobalDatas?.[0]?.gameGlobalData?.unitGlobalData?.unitAddingParam?.length;
  if (count === 400) return 'p1';
  if (count === 64) return 'p2';
  throw new Error('This Replay save is not Patapon 1 or Patapon 2.');
}
async function readUpload(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.zip') && !name.endsWith('.bin')) {
    try {
      const doc = await decryptReplay(await bytes(file));
      return { kind: 'replay', game: detectReplayGame(doc), doc, label: 'Replay save',
        name: file.name, time: formatDate(file.lastModified) };
    } catch (error) {
      if (name.endsWith('.sav')) throw error;
    }
  }
  const { game, psp } = await detectPspInput(file);
  return { kind: 'psp', game, secure: psp.secure, slot: psp.slot,
    label: psp.slot ? `Save ${psp.slot.slice(-2)}` : 'PSP save',
    ...describeSfo(psp.sfo, file.lastModified) };
}
async function openFile(file) {
  if (!file || state.busy) return;
  setBusy(true);
  setStatus('Reading save…');
  try {
    state.source = await readUpload(file);
    setStatus();
    state.busy = false;
    go('confirm');
  } catch (error) { fail(error); } finally { setBusy(false); }
}

async function browsePsp() {
  if (!pspSupported) {
    setStatus('Connecting a PSP needs Chrome or Edge on a computer. You can still upload a save.', 'error');
    return;
  }
  setBusy(true);
  try {
    setConnected(await connectPsp());
    setStatus('Reading saves…');
    state.saves = await listSaves(state.savedata);
    state.selected = 0;
    setStatus();
    state.busy = false;
    go('list');
  } catch (error) {
    if (error?.name === 'AbortError') setStatus(); else fail(error);
  } finally { setBusy(false); }
}
function chooseSelected() {
  const save = state.saves[state.selected];
  if (!save || state.busy) return;
  state.source = save;
  go('confirm');
}

// ---------- Converting ----------
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function buildPsp(source, number) {
  const template = createBlankPspTemplate(source.game, number);
  const converted = writePsp(template.plain, source.doc, source.game);
  const encrypted = await encryptPsp(converted, template.sfo, source.game);
  const check = await decryptPsp(encrypted.secure, source.game);
  if (check.length !== converted.length || check.some((value, index) => value !== converted[index])) {
    throw new Error('PSP encryption check failed.');
  }
  return { slot: template.slot, secure: encrypted.secure, sfo: encrypted.sfo, icon: template.icon };
}
async function run(task) {
  if (state.busy) return;
  setBusy(true);
  try { await task(); } catch (error) {
    if (error?.name === 'AbortError') setStatus(); else fail(error);
  } finally { setBusy(false); }
}

const convertToReplay = () => run(async () => {
  const { game, secure } = state.source;
  setStatus('Converting to Replay…');
  const plain = await decryptPsp(secure, game);
  const response = await fetch(`./templates/${game}.replay.json`);
  if (!response.ok) throw new Error('The built-in Replay template could not be loaded.');
  const encoded = await encryptReplay(writeReplay(await response.json(), plain, game));
  download(new Blob([encoded], { type: 'application/octet-stream' }), `patapon 1+2 replay_savedata_${game}.sav`);
  setStatus(`${GAME_NAME[game]} Replay save downloaded.`);
});

const downloadPspZip = () => run(async () => {
  setStatus('Converting to PSP…');
  const psp = await buildPsp(state.source);
  download(await createPspZip(psp.slot, psp.secure, psp.sfo, psp.icon), `${psp.slot}.zip`);
  setStatus(`${psp.slot} downloaded. Copy the folder into PSP/SAVEDATA.`);
});

const writeToPsp = () => run(async () => {
  if (!pspSupported) throw new Error('Writing to a PSP needs Chrome or Edge on a computer. Use Convert to download instead.');
  if (!state.savedata) {
    setConnected(await connectPsp());
    render();
    setBusy(true);
  }
  const { game } = state.source;
  setStatus('Converting and writing to the PSP…');
  const number = await freeSlotNumber(state.savedata, PREFIX[game]);
  const psp = await buildPsp(state.source, number);
  await writeSave(state.savedata, psp.slot, { 'SECURE.BIN': psp.secure, 'PARAM.SFO': psp.sfo, 'ICON0.PNG': psp.icon });
  setStatus(`Saved to the PSP as ${psp.slot}.`);
});

// ---------- Copyable save folder ----------
copyPath.addEventListener('click', async () => {
  const text = byId('save-path-text').textContent;
  try {
    await navigator.clipboard.writeText(text);
    copyPath.textContent = 'Copied!';
  } catch {
    // Clipboard blocked: select the text so Ctrl+C still works.
    getSelection().selectAllChildren(byId('save-path-text'));
    copyPath.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => { copyPath.textContent = 'Copy'; }, 1600);
});

document.addEventListener('click', (event) => {
  if (savePath.open && !savePath.contains(event.target)) savePath.open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && savePath.open) { savePath.open = false; event.stopImmediatePropagation(); }
}, true);

// ---------- Background music ----------
const musicButton = byId('music');
let music;
function syncMusic() {
  const playing = !music.paused;
  musicButton.setAttribute('aria-pressed', String(playing));
  musicButton.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
}
// Loaded on first press so the page doesn't download the track for people who never play it.
musicButton.addEventListener('click', () => {
  if (!music) {
    music = new Audio(musicLoop);
    music.loop = true;
    music.volume = 0.5;
    music.addEventListener('play', syncMusic);
    music.addEventListener('pause', syncMusic);
  }
  if (music.paused) music.play().catch(() => {});
  else music.pause();
});

// ---------- Upload and drag-and-drop ----------
input.addEventListener('change', () => { openFile(input.files?.[0]); input.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  if (++dragDepth === 1) card.classList.add('dragging');
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; card.classList.remove('dragging'); }
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  card.classList.remove('dragging');
  openFile(event.dataTransfer?.files?.[0]);
});

if (!pspSupported) document.documentElement.classList.add('no-psp');
pollPsp();
setInterval(pollPsp, 2000);
document.addEventListener('visibilitychange', pollPsp);

history.replaceState({ screen: 'home' }, '');
render();
