#!/usr/bin/env python3
"""C4C release pair: offline-only, source-pinned, deterministic archives and verification.

No network, OAuth, Supabase, Cloudflare, browser-profile or production-data operations.
A CI artifact is *temporary*: off-CI retention and explicit owner release approval
remain separate, mandatory C4D gates.
"""

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import zipfile

SCHEMA = "kg-chart-c4c-release-pair-v1"
HEX40 = re.compile(r"^[a-f0-9]{40}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
EDITIONS = (("separate-offline", "dist-offline", "compatible-rollback"),
            ("unified", "dist-unified", "unified-candidate"))
ESSENTIAL = {"index.html", "sw.js", "manifest.webmanifest", "js/offline-runtime.js",
             "js/offline-install.js", "js/offline-pictures.js", "assets/app.js"}
IDENTITY_KEYS = ("id", "start_url", "scope", "display")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def data_json(content, location):
    try:
        return json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"Invalid JSON in {location}: {exc}") from exc


def git(*args):
    return subprocess.check_output(["git", *args], text=True, stderr=subprocess.PIPE).strip()


def check_name(name):
    require(isinstance(name, str) and name != "" and "\\" not in name, "Unsafe ZIP name")
    p = pathlib.PurePosixPath(name)
    require(not p.is_absolute() and all(x not in ("", ".", "..") for x in name.split("/")),
            f"Unsafe archive path: {name}")
    return name


def read_folder(directory):
    require(directory.is_dir(), f"Missing build folder: {directory}")
    values = {}
    for item in sorted(directory.rglob("*")):
        require(not item.is_symlink(), f"Symlink not permitted in bundle: {item}")
        if item.is_dir():
            continue
        require(item.is_file(), f"Unrecognized output type: {item}")
        name = check_name(item.relative_to(directory).as_posix())
        require(name not in values, f"Duplicate output name: {name}")
        values[name] = item.read_bytes()
    return values


def text_file(files, name):
    require(name in files, f"Missing file: {name}")
    return files[name].decode("utf-8")


def json_file(files, name):
    return data_json(text_file(files, name), name)


def check_edition(files, source_sha, edition):
    suffix = "-unified" if edition == "unified" else ""
    revision = source_sha[:12] + suffix
    build = json_file(files, "offline-build.json")
    manifest = json_file(files, "manifest.webmanifest")
    shell = json_file(files, "shell-manifest.json")
    require(build.get("appVersion") == revision, f"{edition}: revision does not match pinned SHA")
    require(build.get("edition") == edition and build.get("schemaVersion") == 1,
            f"{edition}: edition/schema mismatch")
    require(build.get("source") == "index.html", f"{edition}: canonical source changed")
    require(manifest.get("version") == revision and shell.get("version") == revision,
            f"{edition}: inconsistent version metadata")
    require(manifest.get("id") == "/kg-chart-offline" and manifest.get("start_url") == "./"
            and manifest.get("scope") == "./" and manifest.get("display") == "standalone",
            f"{edition}: installed PWA identity/scope changed")
    entries = shell.get("files")
    require(isinstance(entries, list) and entries, f"{edition}: missing shell inventory")
    names = set()
    for entry in entries:
        require(isinstance(entry, dict), f"{edition}: invalid shell entry")
        name = check_name(entry.get("path"))
        sha = entry.get("sha256")
        require(isinstance(sha, str) and HEX64.fullmatch(sha), f"{edition}: invalid hash for {name}")
        require(name not in names and name not in ("shell-manifest.json", "offline-build.json"),
                f"{edition}: duplicate/reserved shell file {name}")
        require(name in files and digest(files[name]) == sha, f"{edition}: hash mismatch: {name}")
        names.add(name)
    require(ESSENTIAL.issubset(names), f"{edition}: missing required shell files {ESSENTIAL - names}")
    require(set(files) == names | {"shell-manifest.json", "offline-build.json"},
            f"{edition}: unexpected/unmanifested files")
    runtime = text_file(files, "js/offline-runtime.js")
    sw = text_file(files, "sw.js")
    pictures = text_file(files, "js/offline-pictures.js")
    app = text_file(files, "assets/app.js")
    page = text_file(files, "index.html")
    for token in ("kg-chart-offline-v1", "'kv'", "'outbox'", "active-caches:"):
        require(token in runtime, f"{edition}: missing IndexedDB/storage contract {token}")
    for token in ("kg-offline-pictures-v1-", "X-KG-Picture-Hash", "ownerFor", "kg-offline-shell-"):
        require(token in sw, f"{edition}: missing worker shared-media contract {token}")
    for token in ("kg-offline-pictures-v1-", "X-KG-Picture-Hash", "kg-offline-pack-"):
        require(token in pictures, f"{edition}: missing owner-scoped picture resolver {token}")
    require("kg-chart-offline-auth" in app, f"{edition}: changed auth storage key")
    require(f"window.KG_UNIFIED={'true' if edition == 'unified' else 'false'}" in page,
            f"{edition}: incorrect edition flag")
    require(revision in sw, f"{edition}: missing worker revision")
    return {"revision": revision, "shell_files": len(entries),
            "shell_manifest_sha256": digest(files["shell-manifest.json"]),
            "pwa": {k: manifest[k] for k in IDENTITY_KEYS}}


def check_pair(rollback, unified, sha):
    old = check_edition(rollback, sha, "separate-offline")
    new = check_edition(unified, sha, "unified")
    require(old["pwa"] == new["pwa"], "Candidate changes installed PWA identity")
    for name in ("js/offline-pictures.js", "js/offline-install.js"):
        require(rollback[name] == unified[name], f"Shared resolver/installer mismatch: {name}")
    for name in ("sw.js", "js/offline-runtime.js"):
        a = rollback[name].decode("utf-8").replace(old["revision"], "<C4C_REVISION>")
        b = unified[name].decode("utf-8").replace(new["revision"], "<C4C_REVISION>")
        require(a == b, f"Incompatible rollback runtime: {name}")
    return old, new


def write_zip(destination, files):
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in sorted(files):
            info = zipfile.ZipInfo(check_name(name), ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o100644 << 16)
            z.writestr(info, files[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def read_zip(filename):
    values = {}
    with zipfile.ZipFile(filename) as z:
        for member in z.infolist():
            name = check_name(member.filename)
            require(not member.is_dir() and name not in values, f"Unsafe/duplicate ZIP entry: {name}")
            require((member.external_attr >> 16) & 0o170000 != 0o120000, "Symlink in release ZIP")
            values[name] = z.read(member)
    return values


def package(args):
    source_sha = args.source_sha
    require(HEX40.fullmatch(source_sha), "Supply a full 40-character source SHA")
    require(git("rev-parse", "HEAD") == source_sha,
            "Git checkout HEAD differs from explicitly pinned source_sha (refuse moving/merge ref)")
    root = pathlib.Path(args.base_dir)
    blobs = {}
    for edition, directory, _ in EDITIONS:
        blobs[edition] = read_folder(root / directory)
    old, new = check_pair(blobs["separate-offline"], blobs["unified"], source_sha)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    require(not any(out.iterdir()), "Output directory must be empty to avoid overwriting an archived candidate")
    items = []
    for edition, _, label in EDITIONS:
        name = f"kg-chart-c4c-{label}-{source_sha}.zip"
        destination = out / name
        write_zip(destination, blobs[edition])
        details = old if edition == "separate-offline" else new
        items.append({"edition": edition, "name": name, "sha256": digest(destination.read_bytes()),
                      "bytes": destination.stat().st_size, "revision": details["revision"],
                      "shell_files": details["shell_files"],
                      "shell_manifest_sha256": details["shell_manifest_sha256"]})
    record = {"schema": SCHEMA, "source_sha": source_sha,
              "source_tree_sha": git("rev-parse", "HEAD^{tree}"),
              "source_commit_time": git("show", "-s", "--format=%cI", "HEAD"),
              "production_authorized": False, "personal_recovery_data_included": False,
              "retention_verified": False, "pwa_identity": old["pwa"],
              "indexeddb_contract": {"name": "kg-chart-offline-v1", "version": 1,
                                     "stores": ["kv", "outbox"]},
              "bundles": items}
    record_bytes = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode()
    (out / "c4c-release-record.json").write_bytes(record_bytes)
    checksum_lines = [f"{entry['sha256']}  {entry['name']}" for entry in items]
    checksum_lines.append(f"{digest(record_bytes)}  c4c-release-record.json")
    (out / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    verify(args)
    print(json.dumps({"result": "C4C_SOURCE_PINNED_PAIR_PASS", "source_sha": source_sha,
                      "bundles": items, "production_authorized": False,
                      "durable_off_ci_retention_verified": False}, indent=2))


def verify(args):
    require(HEX40.fullmatch(args.source_sha), "Expected full source SHA is required")
    out = pathlib.Path(args.out)
    record_bytes = (out / "c4c-release-record.json").read_bytes()
    record = data_json(record_bytes, "c4c-release-record.json")
    require(record.get("schema") == SCHEMA and record.get("source_sha") == args.source_sha,
            "Archive source identity does not match expected release")
    require(record.get("production_authorized") is False and record.get("personal_recovery_data_included") is False,
            "Unexpected approval/private-data declaration")
    entries = record.get("bundles")
    require(isinstance(entries, list) and len(entries) == len(EDITIONS), "Wrong artifact count")
    require([v.get("edition") for v in entries] == [v[0] for v in EDITIONS], "Wrong edition order")
    expected_names = {entry["name"] for entry in entries} | {"c4c-release-record.json", "SHA256SUMS"}
    require({x.name for x in out.iterdir()} == expected_names, "Unexpected/missing retained artifact")
    sha_lines = [f"{entry['sha256']}  {entry['name']}" for entry in entries]
    sha_lines.append(f"{digest(record_bytes)}  c4c-release-record.json")
    require((out / "SHA256SUMS").read_text(encoding="utf-8") == "\n".join(sha_lines) + "\n",
            "Checksum manifest mismatch")
    zips = {}
    for (edition, _, label), entry in zip(EDITIONS, entries):
        expected = f"kg-chart-c4c-{label}-{args.source_sha}.zip"
        require(entry["name"] == expected and HEX64.fullmatch(entry["sha256"]),
                "Unrecognized artifact name/hash")
        archive = out / expected
        require(archive.stat().st_size == entry["bytes"] and digest(archive.read_bytes()) == entry["sha256"],
                f"Archive digest mismatch: {expected}")
        zips[edition] = read_zip(archive)
    old, new = check_pair(zips["separate-offline"], zips["unified"], args.source_sha)
    for entry, details in zip(entries, (old, new)):
        require(entry["revision"] == details["revision"]
                and entry["shell_files"] == details["shell_files"]
                and entry["shell_manifest_sha256"] == details["shell_manifest_sha256"],
                "Artifact inventory does not match signed-off record")
    require(record.get("pwa_identity") == old["pwa"], "PWA identity record mismatch")
    require(record.get("indexeddb_contract") == {"name": "kg-chart-offline-v1", "version": 1,
                                               "stores": ["kv", "outbox"]}, "IndexedDB contract record mismatch")
    print("C4C_ARCHIVE_VERIFICATION_PASS: pinned SHA, ZIP SHA-256, shell files, PWA, IndexedDB, shared media and compatible rollback")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pack", "verify"))
    parser.add_argument("--source-sha", required=True, help="Expected 40-character immutable Git source revision")
    parser.add_argument("--out", required=True, help="Fresh bundle folder (pack) or saved bundle folder (verify)")
    parser.add_argument("--base-dir", default=".", help="Location of build folders (pack only)")
    args = parser.parse_args()
    try:
        (package if args.action == "pack" else verify)(args)
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile, UnicodeError) as exc:
        print(f"C4C_FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
