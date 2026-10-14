"""Package credential-free browser flash parts while preserving the NVS sectors."""

import hashlib
import json
from pathlib import Path
import subprocess
import shutil
import struct

Import("env")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_flash_parts(parts, partition_table):
    """esptool erases whole 4 KiB sectors, so protect the entire NVS partition."""
    protected = []
    table = partition_table.read_bytes()
    for offset in range(0, len(table) - 31, 32):
        magic, partition_type, subtype, address, size, label, _ = struct.unpack_from("<HBBII16sI", table, offset)
        if magic != 0x50AA:
            break
        if partition_type == 1 and subtype == 2:
            protected.append((address, address + size))
    if not protected:
        raise ValueError("Factory partition table must contain an NVS partition.")

    previous_end = 0
    for address, image in sorted(parts, key=lambda item: item[0]):
        size = image.stat().st_size
        if size == 0:
            raise ValueError(f"Empty flash image: {image.name}")
        erased_start = address // 4096 * 4096
        erased_end = (address + size + 4095) // 4096 * 4096
        if erased_start < previous_end:
            raise ValueError(f"Flash image sectors overlap: {image.name}")
        if any(erased_start < end and erased_end > start for start, end in protected):
            raise ValueError(f"Flash image would erase NVS: {image.name}")
        previous_end = erased_end


def package_firmware(source, target, env):
    build_dir = Path(env.subst("$BUILD_DIR"))
    framework_dir = Path(env.PioPlatform().get_package_dir("framework-arduinoespressif32"))
    esptool_dir = Path(env.PioPlatform().get_package_dir("tool-esptoolpy"))
    shutil.copyfile(framework_dir / "tools/partitions/boot_app0.bin", build_dir / "boot_app0.bin")
    parts = [
        (0x1000, build_dir / "bootloader.bin"),
        (0x8000, build_dir / "partitions.bin"),
        (0xE000, build_dir / "boot_app0.bin"),
        (0x10000, build_dir / "firmware.bin"),
    ]
    validate_flash_parts(parts, build_dir / "partitions.bin")
    output = build_dir / "cctv-esp32cam.bin"
    subprocess.run(
        [
            env.subst("$PYTHONEXE"), str(esptool_dir / "esptool.py"),
            "--chip", "esp32", "merge_bin", "-o", str(output),
            "--flash_mode", "dio", "--flash_freq", "40m", "--flash_size", "4MB",
            "0x1000", str(build_dir / "bootloader.bin"),
            "0x8000", str(build_dir / "partitions.bin"),
            "0xe000", str(build_dir / "boot_app0.bin"),
            "0x10000", str(build_dir / "firmware.bin"),
        ],
        check=True,
    )
    manifest = {
        "name": "CCTV ESP32-CAM",
        "version": "1.0.0",
        "new_install_prompt_erase": False,
        "builds": [{"chipFamily": "ESP32", "parts": [
            {"path": image.name, "offset": address, "sha256": sha256(image)} for address, image in parts
        ]}],
        "mergedImage": {"path": output.name, "offset": 0, "sha256": sha256(output)},
        "sha256": sha256(output),
        "provisioningProtocol": "cctv.serial.v1",
    }
    temporary = build_dir / "manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    temporary.replace(build_dir / "manifest.json")


env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", package_firmware)
