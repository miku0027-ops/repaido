# API capacity profiles

`policy.json` prepares reviewed ceilings for the existing main and work APIs:
minimum 1 each, maximum 64/40, concurrency 24, 1 vCPU and 1 GiB per instance.
These are proposed budget and admission bounds, **not applied limits or measured
production capacity**. Cloud Run already balances requests and scales within
its configured instance limits. The existing optional global HTTPS edge gateway
is in `../api-edge`; this profile does not provision or change it.

The planner defaults to read-only live inventory:

```sh
python3 scripts/configure-resilience.py --service=repaido-api
python3 scripts/configure-resilience.py --service=repaido-work-api
```

An isolated non-secret `--snapshot=/path/to/service.json` can test the planner
without cloud access. Output withholds environment values and secret bindings.

Only after an explicit release request, a clean reviewed source checkout and
a fresh plan, `--apply` requires all of:

```text
--release-approved
--commit=<reviewed full source SHA>
--expected-ready-revision=<reviewed currently serving revision>
--expected-image=<same current image pinned by SHA256>
```

The script refuses an active canary, an unready newer revision, a mutable or
changed image, a dirty checkout or revision drift. It retains the image, secrets,
IAM, ingress and schedules, updates the selected service's bounded request-gate
variables, and stages a tagged revision with **no traffic promotion**. The main
API uses `REPAIDO_API_MAX_*`; work uses `REPAIDO_WORK_MAX_*`.

Service-level minimum/maximum settings take effect for the service when applied,
even though the new revision receives no traffic. Account for baseline cost and
existing revision capacity during review. Do not treat this command as an
atomic capacity canary. Validate the staged revision and use the normal release
procedure for traffic promotion and rollback. A ceiling can still exceed the
project's current quota; verify quota and measured datastore/provider capacity
before applying. Never repeatedly raise limits to hide an unhealthy dependency.
