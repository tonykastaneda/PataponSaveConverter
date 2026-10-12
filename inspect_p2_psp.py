"""Inspect the verified first sections of a Patapon 2 PSP secure save.

The PSP encryption layer is provided by vita8328/psp-save (GPL-2.0-or-later)
in psp-save-reference. This program only parses plaintext produced by it.
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

UNIT_START = 0x1C
UNIT_COUNT = 64
UNIT_SIZE = 0x154
ITEM_COUNT = 936
ITEM_START = UNIT_START + UNIT_COUNT * UNIT_SIZE + 4  # sortType
ITEM_SIZE = 6
BASES_START = ITEM_START + ITEM_COUNT * ITEM_SIZE
TALK_START = BASES_START + 16
STRINGS_START = TALK_START + 256 * 4 + 512 * 4 + 512 * 4 + 512


def i32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<i", data, offset)[0]


def c_string(data: bytes) -> str:
    return data.split(b"\0", 1)[0].decode("ascii")


def named_id(data: bytes, offset: int) -> dict:
    return {
        "name": c_string(data[offset : offset + 32]),
        "crc": struct.unpack_from("<I", data, offset + 32)[0],
    }


def parse_unit(data: bytes, offset: int) -> dict:
    unit = {
        "aName": c_string(data[offset : offset + 32]),
        "id": i32(data, offset + 0x20),
        "uniqueId": i32(data, offset + 0x24),
        "level": i32(data, offset + 0x28),
        "experience": i32(data, offset + 0x2C),
        "weaponId": i32(data, offset + 0x30),
        "weaponAttributeId": i32(data, offset + 0x34),
        "isLive": i32(data, offset + 0x38),
        "deadCount": i32(data, offset + 0x3C),
        "missionCount": i32(data, offset + 0x40),
        "cap": i32(data, offset + 0x44),
        "rgba": list(data[offset + 0x48 : offset + 0x4C]),
        "adjustDamageParamId": struct.unpack_from("<h", data, offset + 0x4C)[0],
        "birthParamId": struct.unpack_from("<h", data, offset + 0x4E)[0],
        "unitParam_dmy": named_id(data, offset + 0x50),
        "equipParam": [],
        "evolutionClass": data[offset + 0x134],
        "evolutionClassLevel": data[offset + 0x135],
        "evolutionLevel": list(struct.unpack_from("<30b", data, offset + 0x136)),
    }
    for index in range(4):
        equip_offset = offset + 0x74 + index * 0x30
        unit["equipParam"].append(
            {
                "name": named_id(data, equip_offset),
                "state": i32(data, equip_offset + 0x24),
                "nodeIndex": i32(data, equip_offset + 0x28),
                "itemIdx": i32(data, equip_offset + 0x2C),
            }
        )
    return unit


def parse(data: bytes) -> dict:
    if len(data) != 128744:
        raise ValueError(f"Expected 128744 plaintext bytes, got {len(data)}")
    header = struct.unpack_from("<7i", data)
    if header[2:4] != (123, 123) or not (0 <= header[5] <= UNIT_COUNT):
        raise ValueError("The plaintext does not look like a Patapon 2 PSP save")
    units = [parse_unit(data, UNIT_START + i * UNIT_SIZE) for i in range(UNIT_COUNT)]
    items = [
        dict(zip(("num", "slotIndex", "isFirst", "isKnown"),
                 struct.unpack_from("<HHBB", data, ITEM_START + i * ITEM_SIZE)))
        for i in range(ITEM_COUNT)
    ]
    if any(item["isFirst"] not in (0, 1) or item["isKnown"] not in (0, 1) for item in items):
        raise ValueError("The item table failed its flag checks")
    labels = list(struct.unpack_from("<256i", data, TALK_START))
    integers = list(struct.unpack_from("<512i", data, TALK_START + 1024))
    floats = list(struct.unpack_from("<512f", data, TALK_START + 3072))
    flags = list(data[TALK_START + 5120 : TALK_START + 5632])
    strings = []
    for index in range(80):
        raw = data[STRINGS_START + index * 16 : STRINGS_START + (index + 1) * 16]
        strings.append(raw.decode("utf-16-le").split("\0", 1)[0])
    return {
        "saveCount": header[0],
        "langage": header[1],
        "gameGlobalDmy": header[2],
        "unitGlobalData": {
            "dmy": header[3],
            "gameClearCount": header[4],
            "unitCount": header[5],
            "heroUniqueId": header[6],
            "unitAddingParam": units,
        },
        "itemGlobalData": {"sortType": i32(data, ITEM_START - 4), "items": items},
        "basesData": {
            "dmy": i32(data, BASES_START),
            "civilization": i32(data, BASES_START + 4),
            "energy": i32(data, BASES_START + 8),
            "enableHolyGrail": i32(data, BASES_START + 12),
        },
        "talkData": {
            "labelBuffer": labels,
            "integerBuffer": integers,
            "floatBuffer": floats,
            "flagBuffer": flags,
        },
        "strVarAry": strings,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("plaintext", type=Path, help="Mode 5 decrypted SECURE.BIN")
    ap.add_argument("--json-out", type=Path, help="Write parsed sections as JSON")
    args = ap.parse_args()
    result = parse(args.plaintext.read_bytes())
    if args.json_out:
        if args.json_out.exists():
            ap.error(f"Output already exists: {args.json_out}")
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Save count: {result['saveCount']}")
    print(f"Units: {result['unitGlobalData']['unitCount']} / {UNIT_COUNT}")
    print(f"Items with quantity: {sum(x['num'] > 0 for x in result['itemGlobalData']['items'])} / {ITEM_COUNT}")
    print(f"First unit: {result['unitGlobalData']['unitAddingParam'][0]['aName']}")
    print(f"First string: {result['strVarAry'][0]}")


if __name__ == "__main__":
    main()
