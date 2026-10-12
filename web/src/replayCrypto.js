const replayKey = new TextEncoder().encode('H2AYuFL!VGW~tQU2');
const replayIv = new TextEncoder().encode('Q4TmjuN,9sFcZjkJ');
const utf8 = new TextDecoder('utf-8', { fatal: true });
let replayCryptoKeyPromise;

function cryptoKey() {
  replayCryptoKeyPromise ??= crypto.subtle.importKey('raw', replayKey, 'AES-CBC', false, ['encrypt', 'decrypt']);
  return replayCryptoKeyPromise;
}
function fromBase64(text) {
  const raw = atob(text.trim());
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}
export async function decryptReplay(fileBytes) {
  const encoded = utf8.decode(fileBytes);
  const cipher = fromBase64(encoded);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: replayIv },
    await cryptoKey(), cipher);
  const document = JSON.parse(utf8.decode(plain));
  if (!Array.isArray(document.laboGlobalDatas)) throw new Error('This is not a Replay game save.');
  return document;
}
export async function encryptReplay(document) {
  const plain = new TextEncoder().encode(JSON.stringify(document));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: replayIv },
    await cryptoKey(), plain));
  return new TextEncoder().encode(toBase64(cipher));
}
