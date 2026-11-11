#!/usr/bin/env python3
"""Analyze every configured watch platform without requiring a prior build."""
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile


def sdk_core_path():
    override = os.environ.get("PEBBLE_SDK_CORE")
    if override:
        return Path(override)
    default = Path.home() / ".local/share/pebble-sdk/SDKs/current/sdk-core"
    if default.is_dir():
        return default
    # The CLI also handles installations with a different data directory.
    result = subprocess.run(
        ["pebble", "sdk", "include-path", "basalt"],
        check=True, capture_output=True, text=True,
    )
    return Path(result.stdout.strip().splitlines()[-1]).parents[2]


def main():
    os.chdir(Path(__file__).resolve().parent.parent)
    if not shutil.which("cppcheck"):
        raise SystemExit("Install Cppcheck 2.22.0 (PyPI package cppcheck==1.5.3) to run C analysis.")
    version = subprocess.run(["cppcheck", "--version"], check=True,
                             capture_output=True, text=True).stdout
    if "2.22.0" not in version:
        print(f"warning: CI uses Cppcheck 2.22.0; found {version.strip()}. "
              "Results may differ.", flush=True)
    core = sdk_core_path()
    platform_file = core / "pebble/common/tools/pebble_sdk_platform.py"
    if not platform_file.is_file():
        raise SystemExit("Install Pebble SDK 4.33 or set PEBBLE_SDK_CORE to its sdk-core directory.")
    platforms = runpy.run_path(str(platform_file))
    package = json.loads(Path("package.json").read_text())
    app = package["pebble"]
    sources = sorted(str(path) for path in Path("src/c").rglob("*.c"))
    # Only app-generated constants are modeled here; all SDK types and platform
    # defines come from the actual SDK. Do not use stale build/ headers.
    with tempfile.TemporaryDirectory(prefix="playback-analysis-") as temp:
        generated = Path(temp)
        (generated / "src").mkdir()
        (generated / "message_keys.auto.h").write_text("\n".join(
            f"#define MESSAGE_KEY_{key} {value}" for key, value in app["messageKeys"].items()
        ) + "\n")
        (generated / "src/resource_ids.auto.h").write_text("\n".join(
            f"#define RESOURCE_ID_{item['name']} {index}"
            for index, item in enumerate(app["resources"]["media"], 1)
        ) + "\n")
        for platform in app["targetPlatforms"]:
            print(f"cppcheck: {platform} ({len(sources)} source files)", flush=True)
            defines = platforms[f"{platform}_platform"]["DEFINES"]
            subprocess.run([
                "cppcheck", "--quiet", "--error-exitcode=1", "--std=c99",
                "--platform=unix32", "--check-level=exhaustive",
                "--enable=warning,performance,portability,information",
                # The checker-count summary is informational, not a finding.
                "--suppress=checkersReport",
                "-I", str(core / "pebble" / platform / "include"),
                "-I", str(generated), "-DRELEASE", "-DPBL_SDK_3",
                *["-D" + define for define in defines], *sources,
            ], check=True)
    print("C analysis passed for all configured platforms.")


if __name__ == "__main__":
    main()
