"""Reject missing, stale and mismatched release-check evidence in real temporary Git repos."""
import importlib.util
import runpy
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_gate", ROOT / "tools/check-release-commit.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ReleaseCommitGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "synthetic@example.invalid")
        self.git("config", "user.name", "Synthetic Test")
        self.git("commit", "-qm", "first", "--allow-empty")
        self.first = self.git("rev-parse", "HEAD")
        self.git("tag", "-a", "v2026.10.21.1", "-m", "synthetic")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root,
                                       text=True, stderr=subprocess.PIPE).strip()

    def test_annotated_tag_and_matching_checks_are_accepted(self):
        self.assertEqual(gate.require_checked_commit(self.root, self.first, self.first, "v2026.10.21.1"), self.first)

    def test_missing_or_invalid_evidence_fails_closed(self):
        for evidence in ("", "HEAD", "../unsafe", "a" * 39):
            with self.subTest(evidence=evidence), self.assertRaises(ValueError):
                gate.require_checked_commit(self.root, evidence, self.first, "v2026.10.21.1")

    def test_old_checks_cannot_authorize_new_release(self):
        self.git("commit", "-qm", "second", "--allow-empty")
        second = self.git("rev-parse", "HEAD")
        self.git("tag", "v2026.10.21.2")
        with self.assertRaises(ValueError):
            gate.require_checked_commit(self.root, self.first, second, "v2026.10.21.2")

    def test_moved_tag_cannot_reuse_previous_evidence(self):
        self.git("commit", "-qm", "second", "--allow-empty")
        second = self.git("rev-parse", "HEAD")
        with self.assertRaises(ValueError):
            gate.require_checked_commit(self.root, second, second, "v2026.10.21.1")

    def test_release_workflow_requires_successful_same_commit_suite(self):
        release = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        core = (ROOT / ".github/workflows/core-checks.yml").read_text(encoding="utf-8")
        self.assertIn("needs: core-checks", release)
        self.assertIn("uses: ./.github/workflows/core-checks.yml", release)
        self.assertIn("needs.core-checks.outputs.checked_sha", release)
        self.assertIn("ref: ${{ github.sha }}", release)
        self.assertLess(release.index("check-release-commit.py"), release.index("prepare-release.py"))
        self.assertIn("workflow_call:", core)
        self.assertIn("run: python tools/check-core.py", core)
        self.assertIn("run: python tools/prepare-release.py --preflight", core)
        self.assertIn("github.workflow", core)

    def test_personal_workflows_are_excluded_from_public_sources(self):
        included = runpy.run_path(str(ROOT / "tools/prepare-release.py"))["included"]
        self.assertTrue(included("workflows/Z-Image.json"))
        self.assertFalse(included("workflows/custom/user-workflow.json"))
        self.assertFalse(included("workflows/custom/nested/user-workflow.json"))


if __name__ == "__main__":
    unittest.main()
