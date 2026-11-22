"""No real profiles, network, accounts or deployment: tiny fictional release fixtures."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "c4c_release.py"


def hash_bytes(data):
    return hashlib.sha256(data).hexdigest()


class StageC4CReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="kg-c4c-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "C4C synthetic test"], cwd=self.root, check=True)
        (self.root / "safe-source.txt").write_text("synthetic only", encoding="utf-8")
        subprocess.run(["git", "add", "safe-source.txt"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "synthetic fixtures"], cwd=self.root, check=True)
        self.sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()
        self.write_edition("dist-offline", False)
        self.write_edition("dist-unified", True)

    def write_edition(self, name, unified, worker_change=""):
        directory = self.root / name
        directory.mkdir(exist_ok=True)
        revision = self.sha[:12] + ("-unified" if unified else "")
        files = {
            "index.html": f"<script>window.KG_UNIFIED={'true' if unified else 'false'};</script>".encode(),
            "sw.js": (f"const REV='{revision}';const MEDIA='kg-offline-pictures-v1-';"
                      "const POINTER='X-KG-Picture-Hash';const CACHE='kg-offline-shell-';"
                      f"function ownerFor(){{}}; {worker_change}").encode(),
            "manifest.webmanifest": json.dumps({"id":"/kg-chart-offline","start_url":"./","scope":"./",
                                                 "display":"standalone","version":revision}).encode(),
            "js/offline-runtime.js": (f"window.KG_APP_VERSION = '{revision}';\n"
                                       "indexedDB.open('kg-chart-offline-v1',1);createObjectStore('kv');"
                                       "createObjectStore('outbox');'active-caches:';").encode(),
            "js/offline-pictures.js": b"kg-offline-pictures-v1- X-KG-Picture-Hash kg-offline-pack-",
            "js/offline-install.js": b"Compatible installer",
            "assets/app.js": b"kg-chart-offline-auth",
        }
        shell = {"version": revision, "files":[{"path":p,"sha256":hash_bytes(blob)}
                   for p,blob in sorted(files.items())]}
        files["shell-manifest.json"] = json.dumps(shell).encode()
        files["offline-build.json"] = json.dumps({"appVersion": revision, "edition":
            "unified" if unified else "separate-offline", "schemaVersion": 1,
            "source":"index.html", "generatedAt":"synthetic"}).encode()
        for relative, content in files.items():
            location = directory / relative
            location.parent.mkdir(parents=True, exist_ok=True)
            location.write_bytes(content)

    def run_cli(self, *args, success=True):
        run = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.root,
                             text=True, capture_output=True)
        if success:
            self.assertEqual(run.returncode, 0, run.stdout+run.stderr)
        else:
            self.assertNotEqual(run.returncode, 0, run.stdout+run.stderr)
            self.assertIn("C4C_FAIL", run.stderr)
        return run

    def test_pins_both_archives_and_verifies_offline(self):
        self.run_cli("pack", "--source-sha", self.sha, "--out", "release")
        self.assertEqual(len(list((self.root / "release").glob("*.zip"))), 2)
        result = self.run_cli("verify", "--source-sha", self.sha, "--out", "release")
        self.assertIn("C4C_ARCHIVE_VERIFICATION_PASS", result.stdout)
        record = json.loads((self.root / "release/c4c-release-record.json").read_text())
        self.assertFalse(record["production_authorized"])
        self.assertFalse(record["retention_verified"])
        self.assertFalse(record["personal_recovery_data_included"])

    def test_repeated_pack_bytes_are_deterministic(self):
        self.run_cli("pack", "--source-sha", self.sha, "--out", "first")
        self.run_cli("pack", "--source-sha", self.sha, "--out", "second")
        self.assertEqual((self.root/"first/SHA256SUMS").read_bytes(),
                         (self.root/"second/SHA256SUMS").read_bytes())

    def test_archive_tamper_is_rejected(self):
        self.run_cli("pack", "--source-sha", self.sha, "--out", "release")
        archive = next((self.root / "release").glob("*.zip"))
        archive.write_bytes(archive.read_bytes() + b"changed")
        self.run_cli("verify", "--source-sha", self.sha, "--out", "release", success=False)

    def test_wrong_checkout_sha_and_stale_shell_are_rejected(self):
        self.run_cli("pack", "--source-sha", "a" * 40, "--out", "wrong", success=False)
        (self.root / "dist-offline/sw.js").write_bytes(b"broken")
        self.run_cli("pack", "--source-sha", self.sha, "--out", "invalid", success=False)

    def test_incompatible_rollback_worker_is_rejected_even_when_hashed(self):
        self.write_edition("dist-offline", False, worker_change="const unsafe=true;")
        self.run_cli("pack", "--source-sha", self.sha, "--out", "incompatible", success=False)

    def test_pwa_identity_changes_are_rejected(self):
        self.write_edition("dist-unified", True)
        manifest = self.root / "dist-unified/manifest.webmanifest"
        value = json.loads(manifest.read_text())
        value["id"] = "/changed-installation"
        manifest.write_text(json.dumps(value), encoding="utf-8")
        self.run_cli("pack", "--source-sha", self.sha, "--out", "mismatch", success=False)

    def test_archive_output_is_not_overwritten(self):
        (self.root / "occupied").mkdir()
        (self.root / "occupied/record.txt").write_text("keep")
        self.run_cli("pack", "--source-sha", self.sha, "--out", "occupied", success=False)
        self.assertEqual((self.root / "occupied/record.txt").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
