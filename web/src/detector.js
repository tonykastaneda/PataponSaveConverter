import JSZip from 'jszip';
import { decryptReplay } from './replayCrypto.js';

export async function detectSave(files) {
  const fileList = Array.isArray(files) ? files : [files];
  if (fileList.length === 0) throw new Error('No file provided.');

  if (fileList.length === 1) {
    const file = fileList[0];
    const name = file.name.toLowerCase();

    // 1. Check if it's a Replay save (.sav or text)
    if (name.endsWith('.sav') || name.includes('replay') || name.includes('savedata')) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await decryptReplay(bytes);
        const global = doc.laboGlobalDatas?.[0]?.gameGlobalData;
        const unitParam = global?.unitGlobalData?.unitAddingParam;
        if (unitParam?.length === 400) {
          return {
            game: 'p1',
            sourceType: 'replay',
            targetType: 'psp',
            gameLabel: 'Patapon 1',
            sourceLabel: 'PC Replay Save (.sav)',
            targetLabel: 'PSP Save (ZIP)',
            targetFilename: 'UCUS98711_DATA01.zip',
            replayDocument: doc,
            fileName: file.name,
            fileSize: file.size,
          };
        }
        if (unitParam?.length === 64) {
          return {
            game: 'p2',
            sourceType: 'replay',
            targetType: 'psp',
            gameLabel: 'Patapon 2',
            sourceLabel: 'PC Replay Save (.sav)',
            targetLabel: 'PSP Save (ZIP)',
            targetFilename: 'UCUS98732_DATA01.zip',
            replayDocument: doc,
            fileName: file.name,
            fileSize: file.size,
          };
        }
      } catch {
        // Not a valid replay save, continue to other checks
      }
    }

    // 2. Check if it's a PSP savedata ZIP
    if (name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.keys(zip.files);
      const isP1 = entries.some((p) => /UCUS98711/i.test(p));
      const isP2 = entries.some((p) => /UCUS98732/i.test(p));
      let game = isP1 ? 'p1' : isP2 ? 'p2' : null;

      const secureEntry = entries.find((p) => /(^|\/)SECURE\.BIN$/i.test(p) && !zip.files[p].dir);
      if (!secureEntry) {
        throw new Error('The ZIP archive does not contain a PSP SECURE.BIN file.');
      }
      const secureBytes = await zip.files[secureEntry].async('uint8array');

      if (!game) {
        const sfoEntry = entries.find((p) => /(^|\/)PARAM\.SFO$/i.test(p) && !zip.files[p].dir);
        if (sfoEntry) {
          const sfoBytes = await zip.files[sfoEntry].async('uint8array');
          const sfoText = new TextDecoder('latin1').decode(sfoBytes);
          if (/UCUS98711/i.test(sfoText)) game = 'p1';
          else if (/UCUS98732/i.test(sfoText)) game = 'p2';
        }
      }

      if (!game) {
        if (secureBytes.length === 205528 || secureBytes.length === 205512) game = 'p1';
        else if (secureBytes.length === 128760 || secureBytes.length === 128744) game = 'p2';
      }

      if (!game) {
        throw new Error('Could not identify whether the PSP save is Patapon 1 or Patapon 2.');
      }

      let detectedSlot = null;
      const folderMatch = secureEntry.slice(0, -'SECURE.BIN'.length).replace(/\/$/, '').split('/').pop();
      if (/^UCUS987[0-9]{2}_DATA[0-9]{2}$/i.test(folderMatch)) {
        detectedSlot = folderMatch.toUpperCase();
      }

      return {
        game,
        sourceType: 'psp',
        targetType: 'replay',
        gameLabel: game === 'p1' ? 'Patapon 1' : 'Patapon 2',
        sourceLabel: `PSP Save (${game === 'p1' ? 'UCUS98711' : 'UCUS98732'}${detectedSlot ? ` / ${detectedSlot}` : ''})`,
        targetLabel: 'PC Replay Save (.sav)',
        targetFilename: `patapon 1+2 replay_savedata_${game}.sav`,
        pspData: { secure: secureBytes, slot: detectedSlot },
        fileName: file.name,
        fileSize: file.size,
      };
    }

    // 3. Check if it's a standalone SECURE.BIN
    if (name === 'secure.bin' || name.endsWith('.bin')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let game = null;
      if (bytes.length === 205528 || bytes.length === 205512) game = 'p1';
      else if (bytes.length === 128760 || bytes.length === 128744) game = 'p2';
      else if (/98711|p1/i.test(name)) game = 'p1';
      else if (/98732|p2/i.test(name)) game = 'p2';

      if (game) {
        return {
          game,
          sourceType: 'psp',
          targetType: 'replay',
          gameLabel: game === 'p1' ? 'Patapon 1' : 'Patapon 2',
          sourceLabel: `PSP SECURE.BIN (${game === 'p1' ? 'Patapon 1' : 'Patapon 2'})`,
          targetLabel: 'PC Replay Save (.sav)',
          targetFilename: `patapon 1+2 replay_savedata_${game}.sav`,
          pspData: { secure: bytes, slot: null },
          fileName: file.name,
          fileSize: file.size,
        };
      }
    }

    // 4. Try Replay decryption as fallback
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await decryptReplay(bytes);
      const global = doc.laboGlobalDatas?.[0]?.gameGlobalData;
      const unitParam = global?.unitGlobalData?.unitAddingParam;
      if (unitParam?.length === 400 || unitParam?.length === 64) {
        const game = unitParam.length === 400 ? 'p1' : 'p2';
        return {
          game,
          sourceType: 'replay',
          targetType: 'psp',
          gameLabel: game === 'p1' ? 'Patapon 1' : 'Patapon 2',
          sourceLabel: 'PC Replay Save (.sav)',
          targetLabel: 'PSP Save (ZIP)',
          targetFilename: `${game === 'p1' ? 'UCUS98711' : 'UCUS98732'}_DATA01.zip`,
          replayDocument: doc,
          fileName: file.name,
          fileSize: file.size,
        };
      }
    } catch {
      // Ignore
    }
  }

  // If multiple files or a dropped folder
  const secureFile = fileList.find((f) => f.name.toUpperCase() === 'SECURE.BIN' || f.name.toUpperCase().endsWith('/SECURE.BIN'));
  if (secureFile) {
    const sfoFile = fileList.find((f) => f.name.toUpperCase() === 'PARAM.SFO' || f.name.toUpperCase().endsWith('/PARAM.SFO'));
    const iconFile = fileList.find((f) => f.name.toUpperCase() === 'ICON0.PNG' || f.name.toUpperCase().endsWith('/ICON0.PNG'));
    const secureBytes = new Uint8Array(await secureFile.arrayBuffer());

    let game = null;
    let slot = null;

    const path = secureFile.relativePath || secureFile.webkitRelativePath || secureFile.name;
    const folderMatch = path.match(/(UCUS987[0-9]{2}_DATA[0-9]{2})/i);
    if (folderMatch) {
      slot = folderMatch[1].toUpperCase();
      if (/UCUS98711/i.test(slot)) game = 'p1';
      else if (/UCUS98732/i.test(slot)) game = 'p2';
    }

    if (!game && sfoFile) {
      const sfoBytes = new Uint8Array(await sfoFile.arrayBuffer());
      const sfoText = new TextDecoder('latin1').decode(sfoBytes);
      if (/UCUS98711/i.test(sfoText)) game = 'p1';
      else if (/UCUS98732/i.test(sfoText)) game = 'p2';
    }

    if (!game) {
      if (secureBytes.length === 205528 || secureBytes.length === 205512) game = 'p1';
      else if (secureBytes.length === 128760 || secureBytes.length === 128744) game = 'p2';
    }

    if (!game) throw new Error('Could not identify whether the PSP files are Patapon 1 or Patapon 2.');

    return {
      game,
      sourceType: 'psp',
      targetType: 'replay',
      gameLabel: game === 'p1' ? 'Patapon 1' : 'Patapon 2',
      sourceLabel: `PSP Folder (${game === 'p1' ? 'UCUS98711' : 'UCUS98732'}${slot ? ` / ${slot}` : ''})`,
      targetLabel: 'PC Replay Save (.sav)',
      targetFilename: `patapon 1+2 replay_savedata_${game}.sav`,
      pspData: {
        secure: secureBytes,
        sfo: sfoFile ? new Uint8Array(await sfoFile.arrayBuffer()) : null,
        icon: iconFile ? new Uint8Array(await iconFile.arrayBuffer()) : null,
        slot,
      },
      fileName: slot || secureFile.name,
      fileSize: secureFile.size,
    };
  }

  throw new Error('Unrecognized save file. Please drop a Patapon 1 or 2 Replay .sav file, or a PSP savedata ZIP/folder.');
}
