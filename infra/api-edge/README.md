# Repaido API edge gateway

Reviewable Terraform configuration for `api.repaido.com`: a global external
Application Load Balancer with Premium IPv4, managed HTTPS certificate, restricted
TLS 1.2+, method-preserving HTTP-to-HTTPS redirect and regional serverless NEGs
for the existing `repaido-api` and `repaido-work-api` services in `us-central1`.

**Prepared, not provisioned.** This module has not been applied. No GCP identity
is connected to the current workspace. DNS is managed by the user in cPanel;
the reserved address is available only after an authorized apply.

The module creates only gateway resources. It does not manage Cloud Run
deployments, ingress, invoker IAM, DNS, API enablement, Firebase Hosting or budgets.
The private dispatch worker is excluded. There is no CI apply step.

## Route and privacy behavior

| Path | Backend |
| --- | --- |
| `/api/repaidians/work` and `/api/repaidians/work/*` | Work discovery API |
| `/api/repaidians/companies` and `/api/repaidians/companies/*` | Work discovery API |
| `/api/repaidians/placements` and `/api/repaidians/placements/*` | Work discovery API |
| Other paths, including `/api/health`, `/api/repaidians/state` and protected media | Main API |

The `/api` prefix is preserved. The apps already remove it internally. URL-map
tests exercise each work root, descendants and the main fallback. Cloud CDN is
disabled on both backends; protected media's current authorization, ETag and
Range behavior remains at the application. Serverless backends intentionally
omit health checks, timeout and balancing-mode settings unsupported for NEGs.

Cloud Armor attaches to both backends. SQLi and XSS stable v33 signatures use
sensitivity one; source-IP throttling defaults to 600 requests per 60 seconds.
**All three controls default to preview**, so they report matches without
rejecting requests. The threshold is an initial review setting, not a measured
production policy. Carrier/NAT addresses can represent many users, and the
shared policy counts separately per backend service. It is not an authenticated
account quota. Source-IP enforcement does not trust a user-supplied XFF header.

JSON parsing is enabled; WAF request-body inspection retains the provider's
bounded default, ordinarily the first 8 KiB. It is not complete inspection of
an 8 MiB upload. Application input validation, body caps and authentication
remain necessary. Request logs are enabled with a default 10% sample, which
limits cost but can miss individual preview matches. Normal log detail is used.
Review spend and sample coverage before changing these settings.

## Local source checks

Use official Terraform 1.7 or later and the committed provider lock file. The
Google provider is pinned to 6.50.0; normal `init` verifies its registry checksums
and signing metadata. No credentials or infrastructure state are required for:

```sh
cd infra/api-edge
terraform fmt -check -recursive
terraform init -backend=false -input=false
terraform validate
terraform test
```

`terraform test` uses a mocked Google provider, performs no cloud calls and
creates no real resources. It verifies route parity against root `firebase.json`,
private-backend CDN settings, preview defaults, TLS/redirect behavior, NEG
targets and invalid project/domain/rate input rejection. It does not prove
service existence, GCP quota/permissions, certificate readiness or runtime WAF
effectiveness.

## Authorized provisioning and cPanel DNS

Before planning, verify that the Compute API is already enabled and both target
services exist in the selected project/region. Confirm resource-name availability,
load-balancer/security-policy permissions, quota and expected charges with an
authorized identity. The module deliberately does not grant itself IAM or turn
on billable services.

Use protected Terraform state in an existing approved backend for production.
This standalone configuration does not create a state bucket or backend; with
no backend supplied Terraform defaults to local state. Local state, plans and
real `.tfvars` are ignored by Git. Plans/state contain infrastructure metadata
and belong in controlled storage. Credentials must come from ADC or the approved
workload identity, never committed JSON keys or variables.

After copying and reviewing `terraform.tfvars.example`, a connected operator
can produce a concrete saved plan, inspect it and apply that exact plan under
the project's deployment process:

```sh
terraform plan -var-file=terraform.tfvars -out=api-edge.tfplan
terraform show api-edge.tfplan
terraform apply api-edge.tfplan
terraform output cpanel_a_record
terraform output certificate_readiness
```

In **cPanel → Domains → Zone Editor → Manage `repaido.com`**, add/edit only the
API hostname's **A** record: name `api.repaido.com.`, value from
`cpanel_a_record.value`, TTL 300 for rollout if the provider accepts that TTL.
Some panels accept `api` as the relative name; confirm the displayed full name
is `api.repaido.com`. Do not modify the root website, `www`, MX, SPF, DKIM or
DMARC records. Remove conflicting API A/AAAA records after reviewing the zone;
an IPv6 answer pointing elsewhere can prevent certificate provisioning. Verify
the domain's authoritative nameservers actually use this cPanel zone.

The managed certificate remains pending until public DNS points to the reserved
IP and Google finishes issuance. Successful apply is not a certificate readiness
signal. Run the output's `gcloud compute ssl-certificates describe` command until
`managed.status` is **ACTIVE**. Check public A/AAAA and restrictive CAA records
if it stalls. Then verify the hostname with a normal HTTPS client; do not disable
certificate verification to bypass issuance.

## Client transport inventory

`VITE_API_BASE_URL` does not currently select the origin for every transport.
Review these concrete paths when preparing the client migration:

| Source | Current behavior and cutover requirement |
| --- | --- |
| `web/src/services/api.ts` | Generic requests and asset URLs use the configured origin; the production default and `web/.env.cpanel` still point to `run.app`. Cloud Build supplies no edge override. |
| `web/src/services/repaidiansService.ts` | Community JSON and protected-media fetches use same-origin `/api`; preserve local-path validation, account generations and media retirement when introducing the edge origin. |
| `web/src/services/repaidiansNetworkService.ts` | Networking also fetches same-origin `/api` directly. |
| `web/src/services/repaidiansWorkService.ts` | Most work calls delegate to the community transport above; hiring/application commands already use the generic API helper. |
| `android/agent/src/main/java/com/repaido/agent/TrackingService.java` | Native tracking `position` and `stop` use `WEB_URL`; add a separate API origin through a supported APK update, keeping `WEB_URL` as the trusted page/bridge origin. Preserve disabled HTTP redirects. |
| `android/app/src/main/java/com/repaido/app/Api.kt` | Legacy native requests use `REPAIDO_API_URL` independently of Vite; account for supported older clients even though the current customer activity uses a WebView. |

Preserve exact backend CORS origin allowlists and bearer/idempotency handling.
Validate cross-origin JavaScript access to `ETag`, `Content-Range`,
`Accept-Ranges` and `Retry-After`; expose required response headers explicitly
if the migrated client reads them. Root Hosting work rewrites and the web-only
main rewrites remain bypasses until migration and ingress closure complete.

## Client cutover, enforcement and ingress

1. After certificate activation, exercise authenticated main/work endpoints,
   each exact route root and descendant, unauthorized rejection, private media
   HEAD/Range, uploads, payment webhooks and native clients. Match service build
   IDs through the new hostname. Preserve the configured Repaido browser origins.
2. Migrate **both** generic `VITE_API_BASE_URL` callers and the community/work
   services that currently use same-origin `/api`. Root Firebase Hosting `/api`
   rewrites bypass this gateway. Setting only `VITE_API_BASE_URL` does not migrate
   every request. Old APKs can also call `run.app` directly and need a supported
   upgrade/transition route. This module does not edit these clients.
   Validate guest usage/session continuity as well as signed bearer calls:
   community requests currently use `credentials: 'same-origin'` and the guest
   `__session` meter uses `SameSite=Lax`. Moving from `repaido.web.app` to
   `api.repaido.com` is cross-site; a deliberate session transport plan and
   browser checks are required before claiming guest quotas are preserved.
3. Observe sampled preview matches and shared-IP traffic. Review SQLi/XSS false
   positives, legitimate large uploads and request bursts. Adjust thresholds,
   then change `security_rules_preview=false` through a reviewed Terraform plan.
   Alert on denies, rate violations, auth errors, latency, admission and spend.
4. Only after all supported callers have moved, separately restrict the two
   public Cloud Run services to `internal-and-cloud-load-balancing` ingress and
   review unused default-domain access. Verify edge requests succeed and direct
   external origin requests fail. Keep Scheduler/private-worker IAM and its
   authenticated destination working. Those mutations are outside this module.
5. Record rollback for DNS, client origin, preview enforcement and ingress.
   Restore a working supported path before removing gateway resources. A domain
   change creates the new hashed-name certificate before removing the old one,
   but issuance/DNS readiness still requires an operator check.

Until client migration and ingress closure are complete, direct/Hosting paths
remain bypasses. Until preview is disabled, signature/throttle matches are not
blocked. The gateway provides a concrete edge rollout; it does not establish
million-user capacity or immunity to DDoS, phishing or injection. The current
legacy per-instance sweep and hiring-index bottlenecks still require the work
described in [the architecture document](../../docs/CONTENT_PERFORMANCE_SECURITY.md).

## Validation recorded for this configuration

Terraform 1.13.4 was downloaded from `releases.hashicorp.com` and verified against
its official SHA256SUMS before execution. `terraform init -backend=false`
installed Google 6.50.0 with HashiCorp signature verification. `fmt`, `validate`
and mock-provider tests were run locally. No real cloud plan or apply, DNS edit,
Cloud Run ingress update or IAM change was performed.
