import createPspModule from './vendor/psp-encryption.js';
import wasmUrl from './vendor/psp-encryption.wasm?url';
import { GAME_KEYS } from './format.js';

let pspModulePromise;

function moduleInstance() {
  pspModulePromise ??= createPspModule({ locateFile: () => wasmUrl }).then((module) => {
    module._kirk_init();
    return module;
  });
  return pspModulePromise;
}
function alloc(module, bytes) {
  const ptr = module._malloc(bytes.length || 1);
  if (!ptr) throw new Error('Could not allocate memory for the PSP save.');
  module.HEAPU8.set(bytes, ptr);
  return ptr;
}
export async function decryptPsp(encrypted, game) {
  const module = await moduleInstance();
  const pointers = [];
  try {
    const dataPtr = alloc(module, encrypted); pointers.push(dataPtr);
    const keyPtr = alloc(module, GAME_KEYS[game]); pointers.push(keyPtr);
    const lenPtr = alloc(module, new Uint8Array(4)); pointers.push(lenPtr);
    module.setValue(lenPtr, encrypted.length, 'i32');
    const result = module._decrypt_save_buffer(dataPtr, lenPtr, keyPtr);
    if (result !== 0) throw new Error(`PSP decryption failed (${result}). Check the game and save file.`);
    const length = module.getValue(lenPtr, 'i32');
    if (length <= 0 || length > encrypted.length) throw new Error('PSP decryption produced an invalid size.');
    return module.HEAPU8.slice(dataPtr, dataPtr + length);
  } finally {
    pointers.forEach((ptr) => module._free(ptr));
  }
}
export async function encryptPsp(plain, sfo, game) {
  const module = await moduleInstance();
  const pointers = [];
  let outputPtr = 0;
  try {
    const dataPtr = alloc(module, plain); pointers.push(dataPtr);
    const sfoPtr = alloc(module, sfo); pointers.push(sfoPtr);
    const keyPtr = alloc(module, GAME_KEYS[game]); pointers.push(keyPtr);
    const namePtr = alloc(module, new TextEncoder().encode('SECURE.BIN\0')); pointers.push(namePtr);
    const lenPtr = alloc(module, new Uint8Array(4)); pointers.push(lenPtr);
    const outputPtrPtr = alloc(module, new Uint8Array(4)); pointers.push(outputPtrPtr);
    module.setValue(lenPtr, plain.length, 'i32');
    module.setValue(outputPtrPtr, 0, 'i32');
    const result = module._encrypt_save_buffer(dataPtr, outputPtrPtr, lenPtr,
      sfoPtr, sfo.length, namePtr, keyPtr);
    outputPtr = module.getValue(outputPtrPtr, 'i32');
    if (result !== 0) throw new Error(`PSP encryption failed (${result}).`);
    const length = module.getValue(lenPtr, 'i32');
    if (!outputPtr || length <= plain.length || length > plain.length + 32) {
      throw new Error('PSP encryption produced an invalid size.');
    }
    return {
      secure: module.HEAPU8.slice(outputPtr, outputPtr + length),
      sfo: module.HEAPU8.slice(sfoPtr, sfoPtr + sfo.length),
    };
  } finally {
    if (outputPtr) module._free(outputPtr);
    pointers.forEach((ptr) => module._free(ptr));
  }
}
