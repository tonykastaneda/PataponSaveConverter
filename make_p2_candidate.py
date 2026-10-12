"""Build an experimental PC Replay P2 JSON save from mapped PSP fields.

This leaves unmapped sections in the Replay template unchanged. Do not use it
as a full conversion until the resulting save has been tested in game.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from inspect_p2_psp import parse


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("psp_plaintext", type=Path)
    ap.add_argument("replay_json", type=Path)
    ap.add_argument("output_json", type=Path)
    args = ap.parse_args()
    if args.output_json.exists():
        ap.error(f"Output already exists: {args.output_json}")

    psp = parse(args.psp_plaintext.read_bytes())
    replay = json.loads(args.replay_json.read_text(encoding="utf-8"))
    globals_ = replay["laboGlobalDatas"]
    if len(globals_) != 1:
        raise ValueError("Expected exactly one Replay P2 global save")
    global_ = globals_[0]
    unit = global_["gameGlobalData"]["unitGlobalData"]
    item = global_["gameGlobalData"]["itemGlobalData"]
    talk = global_["talkData"]
    if (len(unit["unitAddingParam"]), len(item["items"]), len(talk["labelBuffer"]),
        len(talk["integerBuffer"]), len(talk["floatBuffer"]), len(talk["flagBuffer"]),
        len(global_["strVarAry"])) != (64, 936, 256, 512, 512, 512, 80):
        raise ValueError("Replay template does not have the expected P2 array sizes")
    if psp["unitGlobalData"]["dmy"] != unit["dmy"] or psp["basesData"]["dmy"] != global_["basesData"]["dmy"]:
        raise ValueError("PSP and Replay P2 marker values differ")

    for key in ("gameClearCount", "unitCount", "heroUniqueId", "unitAddingParam"):
        unit[key] = psp["unitGlobalData"][key]
    item.update(psp["itemGlobalData"])
    for key, value in psp["basesData"].items():
        global_["basesData"][key] = value
    global_["talkData"] = psp["talkData"]
    global_["strVarAry"] = psp["strVarAry"]

    args.output_json.write_text(json.dumps(replay, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote experimental JSON: {args.output_json}")
    print("Mapped: units, inventory, four base fields, story buffers, 80 strings")
    print("Unmapped: later PSP save sections, settings, other unlock data")


if __name__ == "__main__":
    main()
