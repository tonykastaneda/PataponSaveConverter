const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

const P1 = {
  size: 205512, unitStart: 0x20, unitCount: 400, unitSize: 0x104,
  equipCount: 3, itemStart: 0x19ce4, itemCount: 256, itemSize: 4,
  baseStart: 0x1a0e4, talkStart: 0x1a0f4, stringStart: 0x1aef4,
  stringCount: 64, stringSize: 64, integerCount: 256, floatCount: 256,
};
const P2 = {
  size: 128744, unitStart: 0x1c, unitCount: 64, unitSize: 0x154,
  equipCount: 4, itemStart: 0x1c + 64 * 0x154 + 4,
  itemCount: 936, itemSize: 6, integerCount: 512, floatCount: 512,
  stringCount: 80, stringSize: 16,
};
P2.baseStart = P2.itemStart + P2.itemCount * P2.itemSize;
P2.talkStart = P2.baseStart + 16;
P2.stringStart = P2.talkStart + 256 * 4 + 512 * 4 + 512 * 4 + 512;

const layout = (game) => {
  if (game === 'p1') return P1;
  if (game === 'p2') return P2;
  throw new Error('Choose Patapon 1 or Patapon 2.');
};
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const i32 = (bytes, offset) => view(bytes).getInt32(offset, true);
const u32 = (bytes, offset) => view(bytes).getUint32(offset, true);
const i16 = (bytes, offset) => view(bytes).getInt16(offset, true);
const u16 = (bytes, offset) => view(bytes).getUint16(offset, true);
const f32 = (bytes, offset) => view(bytes).getFloat32(offset, true);
const setI32 = (bytes, offset, value) => view(bytes).setInt32(offset, value, true);
const setU32 = (bytes, offset, value) => view(bytes).setUint32(offset, value, true);
const setI16 = (bytes, offset, value) => view(bytes).setInt16(offset, value, true);
const setU16 = (bytes, offset, value) => view(bytes).setUint16(offset, value, true);
const setF32 = (bytes, offset, value) => view(bytes).setFloat32(offset, value, true);

function ascii(bytes, offset, length) {
  const end = bytes.indexOf(0, offset);
  return dec.decode(bytes.subarray(offset, end < 0 || end >= offset + length ? offset + length : end));
}
function writeAscii(bytes, offset, length, value) {
  const data = enc.encode(value);
  if (data.length >= length || [...data].some((byte) => byte > 127)) {
    throw new Error(`A save name exceeds ${length - 1} ASCII bytes: ${value}`);
  }
  bytes.fill(0, offset, offset + length);
  bytes.set(data, offset);
}
function utf16(bytes, offset, length) {
  const chars = [];
  for (let i = 0; i < length; i += 2) {
    const code = u16(bytes, offset + i);
    if (!code) break;
    chars.push(code);
  }
  return String.fromCharCode(...chars);
}
function writeUtf16(bytes, offset, length, value) {
  if (value.length * 2 > length - 2) throw new Error(`A save string exceeds ${length / 2 - 1} characters.`);
  bytes.fill(0, offset, offset + length);
  for (let i = 0; i < value.length; i++) setU16(bytes, offset + i * 2, value.charCodeAt(i));
}
function namedId(bytes, offset) {
  return { name: ascii(bytes, offset, 32), crc: u32(bytes, offset + 32) };
}
function writeNamedId(bytes, offset, value) {
  writeAscii(bytes, offset, 32, value.name);
  setU32(bytes, offset + 32, value.crc);
}
function readUnit(bytes, offset, equipCount, p2) {
  const keys = ['id', 'uniqueId', 'level', 'experience', 'weaponId',
    'weaponAttributeId', 'isLive', 'deadCount', 'missionCount', 'cap'];
  const unit = { aName: ascii(bytes, offset, 32) };
  keys.forEach((key, i) => { unit[key] = i32(bytes, offset + 0x20 + i * 4); });
  unit.rgba = Array.from(bytes.subarray(offset + 0x48, offset + 0x4c));
  unit.adjustDamageParamId = i16(bytes, offset + 0x4c);
  unit.birthParamId = i16(bytes, offset + 0x4e);
  unit.unitParam_dmy = namedId(bytes, offset + 0x50);
  unit.equipParam = Array.from({ length: equipCount }, (_, i) => {
    const pos = offset + 0x74 + i * 0x30;
    return { name: namedId(bytes, pos), state: i32(bytes, pos + 0x24),
      nodeIndex: i32(bytes, pos + 0x28), itemIdx: i32(bytes, pos + 0x2c) };
  });
  if (p2) {
    unit.evolutionClass = bytes[offset + 0x134];
    unit.evolutionClassLevel = bytes[offset + 0x135];
    unit.evolutionLevel = Array.from({ length: 30 }, (_, i) => view(bytes).getInt8(offset + 0x136 + i));
  }
  return unit;
}
function writeUnit(bytes, offset, unit, equipCount, p2) {
  writeAscii(bytes, offset, 32, unit.aName);
  const keys = ['id', 'uniqueId', 'level', 'experience', 'weaponId',
    'weaponAttributeId', 'isLive', 'deadCount', 'missionCount', 'cap'];
  keys.forEach((key, i) => setI32(bytes, offset + 0x20 + i * 4, unit[key]));
  if (unit.rgba.length !== 4) throw new Error('A unit has invalid color data.');
  bytes.set(unit.rgba, offset + 0x48);
  setI16(bytes, offset + 0x4c, unit.adjustDamageParamId);
  setI16(bytes, offset + 0x4e, unit.birthParamId);
  writeNamedId(bytes, offset + 0x50, unit.unitParam_dmy);
  if (unit.equipParam.length !== equipCount) throw new Error('Equipment slot count does not match the selected game.');
  unit.equipParam.forEach((equip, i) => {
    const pos = offset + 0x74 + i * 0x30;
    writeNamedId(bytes, pos, equip.name);
    setI32(bytes, pos + 0x24, equip.state);
    setI32(bytes, pos + 0x28, equip.nodeIndex);
    setI32(bytes, pos + 0x2c, equip.itemIdx);
  });
  if (p2) {
    bytes[offset + 0x134] = unit.evolutionClass;
    bytes[offset + 0x135] = unit.evolutionClassLevel;
    if (unit.evolutionLevel.length !== 30) throw new Error('A unit has invalid evolution data.');
    unit.evolutionLevel.forEach((value, i) => view(bytes).setInt8(offset + 0x136 + i, value));
  }
}
function readTalk(bytes, cfg) {
  const start = cfg.talkStart;
  const integerStart = start + 256 * 4;
  const floatStart = integerStart + cfg.integerCount * 4;
  const flagStart = floatStart + cfg.floatCount * 4;
  return {
    labelBuffer: Array.from({ length: 256 }, (_, i) => i32(bytes, start + i * 4)),
    integerBuffer: Array.from({ length: cfg.integerCount }, (_, i) => i32(bytes, integerStart + i * 4)),
    floatBuffer: Array.from({ length: cfg.floatCount }, (_, i) => f32(bytes, floatStart + i * 4)),
    flagBuffer: Array.from(bytes.subarray(flagStart, flagStart + 512)),
  };
}
function writeTalk(bytes, cfg, talk) {
  const sizes = [talk.labelBuffer.length, talk.integerBuffer.length,
    talk.floatBuffer.length, talk.flagBuffer.length];
  if (sizes.join(',') !== [256, cfg.integerCount, cfg.floatCount, 512].join(',')) {
    throw new Error('Talk buffer sizes do not match the selected game.');
  }
  const start = cfg.talkStart;
  const integerStart = start + 256 * 4;
  const floatStart = integerStart + cfg.integerCount * 4;
  const flagStart = floatStart + cfg.floatCount * 4;
  talk.labelBuffer.forEach((value, i) => setI32(bytes, start + i * 4, value));
  talk.integerBuffer.forEach((value, i) => setI32(bytes, integerStart + i * 4, value));
  talk.floatBuffer.forEach((value, i) => setF32(bytes, floatStart + i * 4, value));
  bytes.set(talk.flagBuffer, flagStart);
}
function readItems(bytes, cfg, game) {
  return Array.from({ length: cfg.itemCount }, (_, i) => {
    const pos = cfg.itemStart + i * cfg.itemSize;
    if (game === 'p1') return { num: bytes[pos], isFirst: bytes[pos + 1],
      isKnown: bytes[pos + 2], slotIndex: bytes[pos + 3] };
    return { num: u16(bytes, pos), slotIndex: u16(bytes, pos + 2),
      isFirst: bytes[pos + 4], isKnown: bytes[pos + 5] };
  });
}
function writeItems(bytes, cfg, game, items) {
  if (items.length !== cfg.itemCount) throw new Error('Inventory size does not match the selected game.');
  items.forEach((item, i) => {
    const pos = cfg.itemStart + i * cfg.itemSize;
    if (game === 'p1') {
      for (const key of ['num', 'isFirst', 'isKnown', 'slotIndex']) {
        if (!Number.isInteger(item[key]) || item[key] < 0 || item[key] > 255) {
          throw new Error(`Patapon 1 inventory ${key} exceeds one byte.`);
        }
      }
      bytes.set([item.num, item.isFirst, item.isKnown, item.slotIndex], pos);
    } else {
      setU16(bytes, pos, item.num);
      setU16(bytes, pos + 2, item.slotIndex);
      bytes[pos + 4] = item.isFirst;
      bytes[pos + 5] = item.isKnown;
    }
  });
}
function validatePlain(bytes, game) {
  const cfg = layout(game);
  if (bytes.length !== cfg.size || i32(bytes, 8) !== 123 || i32(bytes, 12) !== 123) {
    throw new Error(`This is not a decrypted ${game === 'p1' ? 'Patapon 1' : 'Patapon 2'} PSP save.`);
  }
}
export function readPsp(bytes, game) {
  const cfg = layout(game);
  validatePlain(bytes, game);
  const units = Array.from({ length: cfg.unitCount }, (_, i) =>
    readUnit(bytes, cfg.unitStart + i * cfg.unitSize, cfg.equipCount, game === 'p2'));
  const unitGlobalData = { dmy: 123, gameClearCount: i32(bytes, 0x10), unitCount: i32(bytes, 0x14),
    unitAddingParam: units };
  if (game === 'p1') {
    unitGlobalData.equipCount = i32(bytes, 0x18);
    unitGlobalData.pad = i32(bytes, 0x1c);
    unitGlobalData.unitTypeIdArray = Array.from({ length: 400 }, (_, i) => i32(bytes, 0x19660 + i * 4));
  } else unitGlobalData.heroUniqueId = i32(bytes, 0x18);
  const itemGlobalData = { sortType: i32(bytes, cfg.itemStart - 4), items: readItems(bytes, cfg, game) };
  const basesData = { dmy: i32(bytes, cfg.baseStart), civilization: i32(bytes, cfg.baseStart + 4),
    energy: i32(bytes, cfg.baseStart + 8) };
  if (game === 'p1') Object.assign(basesData, {
    enableHolyGrail: bytes[cfg.baseStart + 12],
    isFirstKnownMiracle: bytes[cfg.baseStart + 13],
    isFirstKnownCook: bytes[cfg.baseStart + 14],
  });
  else basesData.enableHolyGrail = i32(bytes, cfg.baseStart + 12);
  return {
    saveCount: i32(bytes, 0), langage: i32(bytes, 4), unitGlobalData,
    itemGlobalData, basesData, talkData: readTalk(bytes, cfg),
    strVarAry: Array.from({ length: cfg.stringCount }, (_, i) =>
      utf16(bytes, cfg.stringStart + i * cfg.stringSize, cfg.stringSize)),
  };
}
export function writePsp(template, replay, game) {
  const cfg = layout(game);
  validatePlain(template, game);
  const global = replay?.laboGlobalDatas?.[0];
  if (!global || replay.laboGlobalDatas.length !== 1) throw new Error('Expected one Replay save slot.');
  const unit = global.gameGlobalData.unitGlobalData;
  const item = global.gameGlobalData.itemGlobalData;
  if (unit.dmy !== 123 || global.basesData.dmy !== 123 ||
      unit.unitAddingParam.length !== cfg.unitCount || global.strVarAry.length !== cfg.stringCount) {
    throw new Error('The Replay save does not match the selected game.');
  }
  const bytes = template.slice();
  setI32(bytes, 0, global.saveCount);
  setI32(bytes, 4, global.langage);
  setI32(bytes, 0x10, unit.gameClearCount);
  setI32(bytes, 0x14, unit.unitCount);
  if (game === 'p1') {
    setI32(bytes, 0x18, unit.equipCount);
    setI32(bytes, 0x1c, unit.pad);
    if (unit.unitTypeIdArray.length !== 400) throw new Error('Patapon 1 unit type table size is invalid.');
    unit.unitTypeIdArray.forEach((value, i) => setI32(bytes, 0x19660 + i * 4, value));
  } else setI32(bytes, 0x18, unit.heroUniqueId);
  unit.unitAddingParam.forEach((value, i) =>
    writeUnit(bytes, cfg.unitStart + i * cfg.unitSize, value, cfg.equipCount, game === 'p2'));
  setI32(bytes, cfg.itemStart - 4, item.sortType);
  writeItems(bytes, cfg, game, item.items);
  const base = global.basesData;
  setI32(bytes, cfg.baseStart, base.dmy);
  setI32(bytes, cfg.baseStart + 4, base.civilization);
  setI32(bytes, cfg.baseStart + 8, base.energy);
  if (game === 'p1') {
    bytes.set([base.enableHolyGrail, base.isFirstKnownMiracle, base.isFirstKnownCook], cfg.baseStart + 12);
  } else setI32(bytes, cfg.baseStart + 12, base.enableHolyGrail);
  writeTalk(bytes, cfg, global.talkData);
  global.strVarAry.forEach((value, i) =>
    writeUtf16(bytes, cfg.stringStart + i * cfg.stringSize, cfg.stringSize, value));
  return bytes;
}
export function writeReplay(template, pspBytes, game, playTime = null) {
  const psp = readPsp(pspBytes, game);
  const replay = structuredClone(template);
  const global = replay?.laboGlobalDatas?.[0];
  if (!global || replay.laboGlobalDatas.length !== 1) throw new Error('Expected one Replay target slot.');
  if (playTime !== null) global.playTime = playTime;
  const cfg = layout(game);
  const unit = global.gameGlobalData.unitGlobalData;
  const item = global.gameGlobalData.itemGlobalData;
  if (unit.dmy !== 123 || global.basesData.dmy !== 123 ||
      unit.unitAddingParam.length !== cfg.unitCount || item.items.length !== cfg.itemCount ||
      global.strVarAry.length !== cfg.stringCount) {
    throw new Error('The Replay template does not match the selected game.');
  }
  if (game === 'p1') {
    global.saveCount = psp.saveCount;
    global.langage = psp.langage;
  }
  for (const [key, value] of Object.entries(psp.unitGlobalData)) {
    if (key !== 'dmy' && key in unit) unit[key] = value;
  }
  item.sortType = psp.itemGlobalData.sortType;
  item.items = psp.itemGlobalData.items;
  for (const [key, value] of Object.entries(psp.basesData)) {
    if (key !== 'dmy' && key in global.basesData) global.basesData[key] = value;
  }
  global.talkData = psp.talkData;
  global.strVarAry = psp.strVarAry;
  return replay;
}
export const GAME_KEYS = {
  p1: Uint8Array.from('01AF6F00020070D52E2412C7E1FF83BA'.match(/../g), (v) => parseInt(v, 16)),
  p2: Uint8Array.from('AF9F013D31FBD15B62ED4A53EAFBC49A'.match(/../g), (v) => parseInt(v, 16)),
};
