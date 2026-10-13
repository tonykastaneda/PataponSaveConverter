# Patapon Save Converter

Browser and command line tools for converting Patapon 1 and Patapon 2 saves
between the original PSP games and **Patapon 1+2 Replay** on PC.

**GitHub Pages:** https://tonykastaneda.github.io/PataponSaveConverter/

The web app runs entirely in the browser. Save files are processed locally
and never sent to a server. Neutral destination structures are bundled inside the app,
so no second upload or separate target template is needed.

| Game | Direction | Status |
| --- | --- | --- |
| Patapon 1 | Replay → PSP | In-game verified with one real save |
| Patapon 1 | PSP → Replay | Experimental; binary mapping roundtrip verified |
| Patapon 2 | PSP → Replay | In-game verified with one real save |
| Patapon 2 | Replay → PSP | Experimental; binary mapping roundtrip verified |

The converter maps units, inventory, base values, talk buffers, and strings.
Some later progress and settings fields are currently left at neutral defaults. The
verified paths loaded the expected source saves in-game; that does not
establish full coverage for every save or region. This version supports USA
PSP saves (`UCUS98711` for P1 and `UCUS98732` for P2).

## Web app

**PSP → Replay**
1. Either drop a PSP save on **Upload Save** (a ZIP of its `UCUS…_DATA##` folder or a
   standalone `SECURE.BIN`), or put the PSP in USB mode and click **Browse Saves**, choose
   the PSP's drive, then pick a save from the list and click **Select**.
2. Click **Convert** to download the Replay `.sav`.

**Replay → PSP**
1. Drop a Replay `.sav` on **Upload Save**.
2. Click **Convert** to download a PSP savedata ZIP, or click the **PSP** button to write the
   save straight onto a connected PSP as a new `DATA##` slot. Existing slots are never overwritten.

The game (Patapon 1 or 2) and direction are detected automatically. Connecting a PSP uses the
File System Access API, so it works in Chrome and Edge on desktop; other browsers can still
upload and download. Back up your existing destination save before importing and check
progress in-game.

To run locally:

```powershell
cd web
npm ci
npm run dev
```

The site is built with Vite. GitHub Actions deploys `web/dist` to Pages on
changes to `main`.

## Command line tools

The PowerShell scripts use [vita8328/psp-save](https://github.com/vita8328/psp-save)
for PSP encryption. Clone that repository into `psp-save-reference`, then build
`psp-save.exe` using its C source and a C compiler. The Python mapping scripts
are included here. Both commands create a new output and refuse to overwrite
an existing path.

```powershell
.\Convert-P1ReplayToPsp.ps1 `
  -ReplaySavePath 'path\to\p1.sav' `
  -PspTemplateFolder 'path\to\UCUS98711_DATA01' `
  -OutputFolder 'path\to\UCUS98711_DATA02'

.\Convert-P2PspToReplay.ps1 `
  -PspSaveFolder 'path\to\UCUS98732_DATA01' `
  -ReplayTemplateSavePath 'path\to\p2.sav' `
  -OutputSavePath 'path\to\converted-p2.sav'
```

The lower-level `ReplaySave.ps1`, `inspect_p2_psp.py`, and mapping scripts can
be used for research and custom workflows.

## Encryption and attribution

Replay `.sav` files contain Base64-encoded AES-128-CBC encrypted JSON. The PC
key and IV were reported in [this Patapon community thread](https://www.reddit.com/r/Patapon/comments/1m04s0k/save_file_encryption_key_for_patapon_12_replay/)
and verified against local P1 and P2 saves. The PSP games use secure savedata
mode 5 with game-specific keys recovered from the game save routines.

The browser PSP encryption component is the GPL-3.0 licensed
[psp-encryption-webassembly](https://github.com/euan-forrester/psp-encryption-webassembly).
Its matching source and license are included under `third_party`; see
[third_party/README.md](third_party/README.md). The command line reference
`psp-save` is GPL-2.0-or-later and is downloaded separately.

The project is licensed under GPL-3.0. Patapon is owned by its respective
rights holders; this community tool is unaffiliated with them. No game ROMs,
save files, or user data are included in the repository.
