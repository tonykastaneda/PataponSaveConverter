import { readFile, writeFile, mkdir } from 'node:fs/promises';
const { decryptReplay } = await import('../web/src/replayCrypto.js');

function neutral(value) {
  if (Array.isArray(value)) return value.map((item) => neutral(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) =>
      [name, name === 'dmy' ? 123 : neutral(item)]));
  }
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'string') return '';
  return value;
}

const [p1Path, p2Path, outputDirectory] = process.argv.slice(2);
if (!p1Path || !p2Path || !outputDirectory) throw new Error('Pass P1 save, P2 save, and output directory.');
await mkdir(outputDirectory, { recursive: true });
for (const [game, path] of [['p1', p1Path], ['p2', p2Path]]) {
  const document = await decryptReplay(new Uint8Array(await readFile(path)));
  await writeFile(`${outputDirectory}/${game}.replay.json`, JSON.stringify(neutral(document)));
}
