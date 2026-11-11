"""Fail closed unless the test Hosting site has no custom domains.

Uses the build service account through gcloud; never prints its access token.
Only writes a generated Firebase config, and does not modify cloud resources.
"""
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def prepare_config(config, project, branch, custom_domains):
    if project != "repaido" or branch != "main":
        raise ValueError("Test deployment requires project repaido and branch main")
    if custom_domains:
        raise ValueError(
            "Test site repaido has custom domains. Separate production domains "
            "onto another Hosting site before enabling test deployment."
        )
    hosting = config.get("hosting")
    if not isinstance(hosting, dict) or hosting.get("public") != "web/dist":
        raise ValueError("Expected the root firebase.json to serve web/dist")
    hosting = dict(hosting)
    hosting.pop("target", None)
    hosting["site"] = "repaido"
    # Exclude Firestore rules and other services from the generated config.
    return {"hosting": hosting}


def list_custom_domains(project, token):
    domains = []
    page_token = None
    while True:
        url = (
            "https://firebasehosting.googleapis.com/v1beta1/projects/"
            + project + "/sites/repaido/customDomains"
        )
        if page_token:
            url += "?" + urlencode({"pageToken": page_token})
        request = Request(url, headers={"Authorization": "Bearer " + token})
        with urlopen(request, timeout=30) as response:
            data = json.load(response)
        if not isinstance(data, dict):
            raise ValueError("Unexpected Hosting API response")
        page_domains = data.get("customDomains", [])
        if not isinstance(page_domains, list):
            raise ValueError("Unexpected customDomains response")
        domains.extend(page_domains)
        page_token = data.get("nextPageToken")
        if not page_token:
            return domains


def main():
    if len(sys.argv) != 3:
        raise ValueError("Usage: prepare-test-hosting.py PROJECT_ID BRANCH_NAME")
    project, branch = sys.argv[1:]
    if project != "repaido" or branch != "main":
        raise ValueError("Test deployment requires project repaido and branch main")
    token = subprocess.check_output(
        ["gcloud", "auth", "print-access-token"], text=True
    ).strip()
    if not token:
        raise ValueError("Google Cloud authentication is required")
    domains = list_custom_domains(project, token)
    config = prepare_config(
        json.loads(Path("firebase.json").read_text()), project, branch, domains
    )
    Path("firebase.test.generated.json").write_text(json.dumps(config, indent=2) + "\n")
    print("Verified test site repaido has no custom domains; prepared Hosting-only config.")


if __name__ == "__main__":
    main()
