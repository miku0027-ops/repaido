import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import io

spec = importlib.util.spec_from_file_location(
    "prepare_test_hosting", Path(__file__).with_name("prepare-test-hosting.py")
)
hosting = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosting)


class HostingSafetyTests(unittest.TestCase):
    def test_custom_domains_block_test_deployment(self):
        for domain in ["repaido.com", "www.repaido.com", "another.example"]:
            with self.assertRaises(ValueError):
                hosting.prepare_config(
                    {"hosting": {"public": "web/dist"}}, "repaido", "main",
                    [{"name": domain}],
                )

    def test_wrong_project_or_branch_is_rejected(self):
        for project, branch in [("other", "main"), ("repaido", "feature"), ("repaido", "")]:
            with self.assertRaises(ValueError):
                hosting.prepare_config({}, project, branch, [])

    def test_pins_site_and_preserves_rewrites_without_deploying_firestore(self):
        config = {
            "hosting": {"public": "web/dist", "target": "production",
                        "rewrites": [{"source": "/api/**", "run": {"serviceId": "repaido-api"}}]},
            "firestore": {"rules": "firestore.rules"},
        }
        result = hosting.prepare_config(config, "repaido", "main", [])
        self.assertEqual(set(result), {"hosting"})
        self.assertEqual(result["hosting"]["site"], "repaido")
        self.assertNotIn("target", result["hosting"])
        self.assertEqual(result["hosting"]["rewrites"], config["hosting"]["rewrites"])
        self.assertIn("target", config["hosting"])

    def test_domains_on_later_pages_are_not_missed(self):
        responses = [io.BytesIO(b'{"nextPageToken":"page 2"}'),
                     io.BytesIO(b'{"customDomains":[{"name":"repaido.com"}]}')]
        with patch.object(hosting, "urlopen", side_effect=responses) as request:
            domains = hosting.list_custom_domains("repaido", "fake-test-token")
        self.assertEqual(domains, [{"name": "repaido.com"}])
        self.assertIn("pageToken=page+2", request.call_args.args[0].full_url)

    def test_api_errors_stop_deployment(self):
        with patch.object(hosting, "urlopen", side_effect=OSError("unavailable")):
            with self.assertRaises(OSError):
                hosting.list_custom_domains("repaido", "fake-test-token")


if __name__ == "__main__":
    unittest.main()
