import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function decryptReplay(filePath) {
  const key = Buffer.from('H2AYuFL!VGW~tQU2', 'utf8');
  const iv = Buffer.from('Q4TmjuN,9sFcZjkJ', 'utf8');
  const b64 = fs.readFileSync(filePath, 'utf8').trim();
  const cipher = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

const templatesDir = path.join(__dirname, 'src', 'templates');
if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });

// 1. P1 Replay
const p1Replay = decryptReplay('C:\\Users\\tonyk\\AppData\\Local\\BANDAI NAMCO Entertainment\\PATAPON 1+2 REPLAY\\Saved\\SaveGames\\1443259929\\P1\\patapon 1+2 replay_savedata_p1.sav');
fs.writeFileSync(path.join(templatesDir, 'p1Replay.json'), JSON.stringify(p1Replay));

// 2. P2 Replay
const p2Replay = decryptReplay('C:\\Users\\tonyk\\AppData\\Local\\BANDAI NAMCO Entertainment\\PATAPON 1+2 REPLAY\\Saved\\SaveGames\\1443259929\\P2\\patapon 1+2 replay_savedata_p2.sav');
fs.writeFileSync(path.join(templatesDir, 'p2Replay.json'), JSON.stringify(p2Replay));

// 3. PSP templates
const p1Plain = fs.readFileSync('C:\\Users\\tonyk\\AppData\\Local\\Temp\\patapon1-psp-plain-mode5-key.bin');
let p1Sfo = fs.readFileSync('C:\\Users\\tonyk\\AppData\\Local\\Temp\\UCUS98711_DATA03\\PARAM.SFO');
// Change UCUS98711_DATA03 to UCUS98711_DATA01 in P1 SFO template
const p1OldSlot = Buffer.from('UCUS98711_DATA03');
const p1NewSlot = Buffer.from('UCUS98711_DATA01');
const p1Idx = p1Sfo.indexOf(p1OldSlot);
if (p1Idx !== -1) {
  p1Sfo = Buffer.from(p1Sfo);
  p1Sfo.set(p1NewSlot, p1Idx);
}
const p1Icon = fs.readFileSync('C:\\Users\\tonyk\\AppData\\Local\\Temp\\UCUS98711_DATA03\\ICON0.PNG');

const p2Plain = fs.readFileSync('C:\\Users\\tonyk\\AppData\\Local\\Temp\\patapon2-psp-plain-mode5.bin');
const p2Sfo = fs.readFileSync('C:\\Users\\tonyk\\AppData\\Local\\Temp\\Patapon2-ppsspp-app\\memstick\\PSP\\SAVEDATA\\UCUS98732_DATA01\\PARAM.SFO');
const p2Icon = fs.readFileSync('C:\\Users\\tonyk\\AppData\\Local\\Temp\\Patapon2-ppsspp-app\\memstick\\PSP\\SAVEDATA\\UCUS98732_DATA01\\ICON0.PNG');

const pspTemplatesJs = `// Auto-generated PSP template assets for Patapon 1 and 2
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const p1PspTemplate = {
  plain: b64ToBytes('${p1Plain.toString('base64')}'),
  sfo: b64ToBytes('${p1Sfo.toString('base64')}'),
  icon: b64ToBytes('${p1Icon.toString('base64')}'),
  defaultSlot: 'UCUS98711_DATA01',
};

export const p2PspTemplate = {
  plain: b64ToBytes('${p2Plain.toString('base64')}'),
  sfo: b64ToBytes('${p2Sfo.toString('base64')}'),
  icon: b64ToBytes('${p2Icon.toString('base64')}'),
  defaultSlot: 'UCUS98732_DATA01',
};
`;

fs.writeFileSync(path.join(templatesDir, 'pspTemplates.js'), pspTemplatesJs);
console.log('Templates created successfully in', templatesDir);
