"""Patch mapped Patapon 1 Replay fields into a decrypted PSP save template.

The resulting plaintext still needs mode 5 PSP encryption and a matching
PARAM.SFO. Unmapped PSP fields remain from the template.
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path


SIZE = 205512
UNIT_START = 0x20
UNIT_SIZE = 0x104
UNIT_COUNT = 400
UNIT_TYPE_START = UNIT_START + UNIT_SIZE * UNIT_COUNT
ITEM_START = 0x19CE4
ITEM_COUNT = 256
BASE_START = ITEM_START + ITEM_COUNT * 4
TALK_START = BASE_START + 16
STRING_START = TALK_START + 256 * 4 * 3 + 512


def put_string(data: bytearray, offset: int, size: int, value: str, encoding: str) -> None:
    raw = value.encode(encoding)
    if len(raw) > size - (2 if encoding == "utf-16-le" else 1):
        raise ValueError(f"String too long for {size}-byte field: {value!r}")
    data[offset : offset + size] = raw + bytes(size - len(raw))


def put_named_id(data: bytearray, offset: int, named: dict) -> None:
    put_string(data, offset, 32, named["name"], "ascii")
    struct.pack_into("<I", data, offset + 32, named["crc"])


def put_unit(data: bytearray, offset: int, unit: dict) -> None:
    put_string(data, offset, 32, unit["aName"], "ascii")
    fields = ("id", "uniqueId", "level", "experience", "weaponId",
              "weaponAttributeId", "isLive", "deadCount", "missionCount", "cap")
    struct.pack_into("<10i", data, offset + 0x20, *(unit[key] for key in fields))
    data[offset + 0x48 : offset + 0x4C] = bytes(unit["rgba"])
    struct.pack_into("<2h", data, offset + 0x4C,
                     unit["adjustDamageParamId"], unit["birthParamId"])
    put_named_id(data, offset + 0x50, unit["unitParam_dmy"])
    if len(unit["equipParam"]) != 3:
        raise ValueError("Expected three Patapon 1 equipment slots")
    for index, equip in enumerate(unit["equipParam"]):
        equip_offset = offset + 0x74 + index * 0x30
        put_named_id(data, equip_offset, equip["name"])
        struct.pack_into("<3i", data, equip_offset + 0x24,
                         equip["state"], equip["nodeIndex"], equip["itemIdx"])


def patch(psp_plain: bytes, replay: dict) -> bytes:
    if len(psp_plain) != SIZE:
        raise ValueError(f"Expected {SIZE} PSP plaintext bytes, got {len(psp_plain)}")
    data = bytearray(psp_plain)
    if struct.unpack_from("<2i", data, 8) != (123, 123):
        raise ValueError("PSP template does not look like a Patapon 1 save")
    globals_ = replay["laboGlobalDatas"]
    if len(globals_) != 1:
        raise ValueError("Expected exactly one Replay Patapon 1 global save")
    global_ = globals_[0]
    unit_data = global_["gameGlobalData"]["unitGlobalData"]
    item_data = global_["gameGlobalData"]["itemGlobalData"]
    talk = global_["talkData"]
    if (len(unit_data["unitAddingParam"]), len(unit_data["unitTypeIdArray"]),
        len(item_data["items"]), len(talk["labelBuffer"]),
        len(talk["integerBuffer"]), len(talk["floatBuffer"]),
        len(talk["flagBuffer"]), len(global_["strVarAry"])) != (
            400, 400, 256, 256, 256, 256, 512, 64):
        raise ValueError("Replay P1 arrays do not match the expected sizes")
    if unit_data["dmy"] != 123 or global_["basesData"]["dmy"] != 123:
        raise ValueError("Replay P1 marker values differ")

    struct.pack_into("<2i", data, 0, global_["saveCount"], global_["langage"])
    struct.pack_into("<4i", data, 0x10, unit_data["gameClearCount"],
                     unit_data["unitCount"], unit_data["equipCount"], unit_data["pad"])
    for index, unit in enumerate(unit_data["unitAddingParam"]):
        put_unit(data, UNIT_START + index * UNIT_SIZE, unit)
    struct.pack_into("<400i", data, UNIT_TYPE_START, *unit_data["unitTypeIdArray"])
    # The 64 bytes between unitTypeIdArray and item sortType have not been
    # mapped. They remain from the PSP template.
    struct.pack_into("<i", data, ITEM_START - 4, item_data["sortType"])
    for index, item in enumerate(item_data["items"]):
        data[ITEM_START + index * 4 : ITEM_START + (index + 1) * 4] = bytes(
            (item["num"], item["isFirst"], item["isKnown"], item["slotIndex"])
        )

    base = global_["basesData"]
    struct.pack_into("<3i", data, BASE_START, base["dmy"],
                     base["civilization"], base["energy"])
    data[BASE_START + 12 : BASE_START + 15] = bytes(
        (base["enableHolyGrail"], base["isFirstKnownMiracle"],
         base["isFirstKnownCook"])
    )
    struct.pack_into("<256i", data, TALK_START, *talk["labelBuffer"])
    struct.pack_into("<256i", data, TALK_START + 1024, *talk["integerBuffer"])
    struct.pack_into("<256f", data, TALK_START + 2048, *talk["floatBuffer"])
    data[TALK_START + 3072 : TALK_START + 3584] = bytes(talk["flagBuffer"])
    for index, value in enumerate(global_["strVarAry"]):
        put_string(data, STRING_START + index * 64, 64, value, "utf-16-le")
    return bytes(data)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("psp_plaintext", type=Path)
    ap.add_argument("replay_json", type=Path)
    ap.add_argument("output_plaintext", type=Path)
    args = ap.parse_args()
    if args.output_plaintext.exists():
        ap.error(f"Output already exists: {args.output_plaintext}")
    replay = json.loads(args.replay_json.read_text(encoding="utf-8"))
    output = patch(args.psp_plaintext.read_bytes(), replay)
    args.output_plaintext.write_bytes(output)
    print(f"Wrote experimental PSP plaintext: {args.output_plaintext}")
    print("Mapped: global count/language, units, inventory, base, talk buffers, strings")
    print("Unmapped: PSP unit type metadata and later settings/progress fields")


if __name__ == "__main__":
    main()
