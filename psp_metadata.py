"""Read and update Patapon play time in a PSP PARAM.SFO file."""

from __future__ import annotations

import argparse
import json
import re
import struct
from pathlib import Path


PLAY_TIME_PATTERNS = (
    re.compile(r"Play time:\s*(\d+):(\d{2}):(\d{2})"),
    re.compile(r"プレイ時間[：:]\s*(\d+)時間(\d{1,2})分(\d{1,2})秒"),
)


def _match_play_time(detail: str) -> re.Match[str] | None:
    return next((match for pattern in PLAY_TIME_PATTERNS
                 if (match := pattern.search(detail))), None)


def _entries(data: bytes):
    magic, _version, key_start, value_start, count = struct.unpack_from("<4s4I", data)
    if magic != b"\x00PSF":
        raise ValueError("Not a PARAM.SFO file")
    for index in range(count):
        entry = 0x14 + index * 0x10
        key_offset, fmt, used, maximum, value_offset = struct.unpack_from("<HHIII", data, entry)
        key = data[key_start + key_offset :].split(b"\0", 1)[0].decode("ascii")
        yield key, entry, fmt, used, maximum, value_start + value_offset


def savedata_detail(data: bytes) -> str:
    for key, _entry, _fmt, used, _maximum, offset in _entries(data):
        if key == "SAVEDATA_DETAIL":
            return data[offset : offset + used].rstrip(b"\0").decode("utf-8")
    raise ValueError("PARAM.SFO has no SAVEDATA_DETAIL field")


def play_time_ms(data: bytes) -> int:
    detail = savedata_detail(data)
    match = _match_play_time(detail)
    if not match:
        raise ValueError("SAVEDATA_DETAIL has no Play time value")
    hours, minutes, seconds = map(int, match.groups())
    if minutes >= 60 or seconds >= 60:
        raise ValueError(f"Invalid Play time value: {match.group(0)}")
    return ((hours * 60 + minutes) * 60 + seconds) * 1000


def set_play_time_ms(data: bytes, milliseconds: int) -> bytes:
    if milliseconds < 0:
        raise ValueError("Play time cannot be negative")
    total_seconds = milliseconds // 1000
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    replacement = f"Play time: {hours:02d}:{minutes:02d}:{seconds:02d}"
    result = bytearray(data)
    for key, entry, _fmt, used, maximum, offset in _entries(data):
        if key != "SAVEDATA_DETAIL":
            continue
        detail = data[offset : offset + used].rstrip(b"\0").decode("utf-8")
        match = _match_play_time(detail)
        if not match:
            raise ValueError("SAVEDATA_DETAIL has no Play time value to replace")
        if match.re.pattern.startswith("プレイ時間"):
            replacement = f"プレイ時間： {hours}時間{minutes:02d}分{seconds:02d}秒"
        updated_detail = detail[:match.start()] + replacement + detail[match.end():]
        updated = updated_detail.encode("utf-8") + b"\0"
        if len(updated) > maximum:
            raise ValueError("Updated SAVEDATA_DETAIL exceeds its PARAM.SFO allocation")
        result[offset : offset + maximum] = updated + bytes(maximum - len(updated))
        struct.pack_into("<I", result, entry + 4, len(updated))
        return bytes(result)
    raise ValueError("PARAM.SFO has no SAVEDATA_DETAIL field")


def read_play_time_ms(path: Path) -> int:
    return play_time_ms(path.read_bytes())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    read_parser = subparsers.add_parser("read")
    read_parser.add_argument("param_sfo", type=Path)
    set_parser = subparsers.add_parser("set-from-replay")
    set_parser.add_argument("param_sfo", type=Path)
    set_parser.add_argument("replay_json", type=Path)
    args = parser.parse_args()
    if args.command == "read":
        print(read_play_time_ms(args.param_sfo))
        return
    replay = json.loads(args.replay_json.read_text(encoding="utf-8"))
    milliseconds = replay["laboGlobalDatas"][0]["playTime"]
    args.param_sfo.write_bytes(set_play_time_ms(args.param_sfo.read_bytes(), milliseconds))
    print(f"Set PSP play time to {milliseconds} ms")


if __name__ == "__main__":
    main()
