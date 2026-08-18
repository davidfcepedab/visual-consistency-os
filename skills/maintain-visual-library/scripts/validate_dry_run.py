#!/usr/bin/env python3
"""Validate a Visual Library Curator dry-run response without modifying it."""

import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(f"INVALID: {message}")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: validate_dry_run.py <response.json>")
    source = sys.stdin.read() if sys.argv[1] == "-" else Path(sys.argv[1]).read_text(encoding="utf-8")
    payload = json.loads(source)
    if payload.get("ok") is not True:
        fail("response is not ok")
    if payload.get("dry_run") is not True or payload.get("write_count") != 0:
        fail("dry_run=true and write_count=0 are required")
    items = payload.get("items")
    if not isinstance(items, list):
        fail("items must be a list")
    keys = set()
    for item in items:
        if not isinstance(item, dict):
            fail("every item must be an object")
        key = (item.get("category"), item.get("record_type"), item.get("record_id"))
        if not all(key) or key in keys:
            fail("findings require unique category/type/id keys")
        keys.add(key)
        if item.get("requires_human_approval") is not True:
            fail("every finding must require human approval")
        if item.get("suggested_category") == "IDENTITY_MASTER" and item.get("verification_status") == "VERIFIED_SOURCE":
            fail("automatic Identity Master verification is forbidden")
    print(f"VALID: {len(items)} findings, zero writes")


if __name__ == "__main__":
    main()
