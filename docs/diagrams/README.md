# Platform architecture blueprint source

`../REPAIDO_DEPLOYMENT_BLUEPRINT.pdf` is an A3 vector guide to the checked-in
deployment system and Repaido platform. It contains release maps, HLD/LLD
request and event flows, sensitive-data boundaries, observability limits and a
complete method/path reference for the three FastAPI runtimes plus the
engineering console. The route reference is code-derived, not a live access or
authorization audit.

Regenerate from the repository root with:

```sh
backend/.venv/bin/python docs/diagrams/generate_api_inventory.py
python3 docs/diagrams/generate_deployment_blueprint.py
```

The first command imports the route registrations in an isolated SQLite
configuration without starting their lifespans or schedulers. It writes
`api_inventory.json`, including the source revision. The PDF generator requires
`reportlab` and `PyYAML`; it reads all five Cloud Build configurations and
`firebase.json`, and fails if their expected step or route structure differs
from the first nine pages. Review the prose in `platform_pages.py` when APIs,
policies, providers or runtime boundaries change. Neither command deploys code
or contacts production.

The public health snapshot on page 1 is historical (14 October 2026, 01:02
UTC). Recheck it before updating the values. The engineering console has
bounded, permission-dependent inventory, metrics, logging and trace collectors;
this document does not substitute for a live IAM, network, billing, alerting,
provider or complete resource audit.
