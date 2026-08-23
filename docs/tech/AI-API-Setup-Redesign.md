# AI & API Setup Redesign

## Overview

The AI & API Setup redesign adds organization tenancy, organization-scoped provider credentials, a capability-first provider registry, and a consolidated administration page. It replaces fragmented provider configuration paths without deleting the legacy implementation during the migration window.

The design has four core boundaries:

1. A workspace belongs to one organization.
2. An organization uses either platform-managed credentials or its own BYOK credentials.
3. Runtime services resolve capabilities in organization context rather than reading provider keys directly.
4. Vector retrieval and usage attribution carry the same organization boundary.

See also:

- [LLM architecture](../features/LLM.md)
- [RAG architecture](../features/RAG.md)
- [Database reference](DATABASE.md)
- [Authentication and authorization](auth.md)
- [Phase F rollback procedure](../../plans/AI_API_Setup_Redesign_PhaseF_Rollback.md)

## Organization Tenancy

### Organization model

The `organizations` table is the tenant root. An organization has one of three types:

| Type | Purpose |
|---|---|
| `DEFAULT` | Compatibility tenant for existing deployments and requests without explicit organization context. Exactly one Default organization is allowed. |
| `ENTITY` | A company, department, customer, or other shared tenant. |
| `INDIVIDUAL` | A tenant owned for individual use. |

The `organization_memberships` table connects users to organizations with an organization-local role. Provider credentials, capability configuration, workspaces, vector payloads, and usage attribution are organization-scoped.

### Workspace relationship

A workspace is a child of exactly one organization through `workspaces.organization_id`. Existing workspaces are assigned to the Default organization by the tenancy backfill. The redesign does not introduce workspace-level provider credentials; a workspace inherits its organization's credential mode and capability configuration while retaining supported workspace model overrides.

### Roles and membership mapping

Global application roles and organization membership roles are separate authorization layers:

| Existing global role | Organization behavior |
|---|---|
| `super_admin` | Implicit administrator of every organization; no membership row is required. |
| `admin` | Backfilled as `member` of the Default organization; may receive explicit `org_admin` membership where needed. |
| `superuser` | Backfilled as `member`; existing category-scoped permissions remain separate. |
| `user` | Backfilled as `member`. |

Organization membership roles are:

- `org_admin`: manages the organization's credentials, capability assignments, members, audit history, and permitted usage views.
- `member`: consumes organization configuration but cannot administer credentials.

No per-user BYOK mode exists. Credentials belong to the organization, not to an individual membership.

## Credential Modes

Each organization uses one credential mode:

| Mode | Credential source | Failure behavior |
|---|---|---|
| `PLATFORM_MANAGED` | Platform credential or environment-backed provider configuration | The selected platform provider must have an active credential/configuration. |
| `ORGANIZATION_BYOK` | Active row in `organization_provider_credentials` | Missing or invalid organization credentials make the capability unavailable. There is no silent platform fallback. |

The Default organization preserves legacy behavior during migration through platform-managed mappings. Organization BYOK credentials are entered once per provider and can be referenced by multiple capabilities.

## CredentialVault

Organization credentials are protected by the [`CredentialVault`](../../src/lib/credential-vault.ts) service.

### Envelope encryption

For each credential:

1. A fresh random 32-byte data-encryption key (DEK) is generated.
2. The provider secret is encrypted with AES-256-GCM under the DEK.
3. The DEK is wrapped with AES-256-GCM under the key-encryption key (KEK).
4. The existing `DATA_SOURCE_ENCRYPTION_KEY` supplies the 32-byte KEK.

Both encrypted blobs use the tagged `v2:<iv>:<authTag>:<ciphertext>` format. The version tag distinguishes envelope-encrypted values from legacy `iv:authTag:ciphertext` values. Legacy values remain decryptable for migration compatibility.

### Tenant binding with AAD

AES-GCM additional authenticated data binds both the encrypted secret and wrapped DEK to:

```text
org:<organization_id>|provider:<provider_id>|credential:<credential_id>
```

Moving ciphertext to a different organization, provider, or credential row causes authentication to fail during decryption.

### Fail-closed and redaction rules

- BYOK writes and decryptions fail when `DATA_SOURCE_ENCRYPTION_KEY` is missing or malformed; there is no plaintext development fallback.
- Mutation and display APIs never return the raw provider key.
- The UI supports **Test Connection**, **Replace Key**, and **Disable Connection**. It does not provide a **Show Key** action.
- Audit details are redacted before storage or display.

### Versioning and audit

`organization_provider_credentials.credential_version` changes whenever credential material or credential state changes. The PostgreSQL `bump_org_credential_version` trigger protects this invariant even for writes outside the normal application mutation path. Runtime client caches include both `credential_id` and `credential_version` in their key, so replacing or disabling a credential invalidates stale clients across workers as each worker observes the new version.

Every credential mutation records a redacted entry in `credential_audit_log`, including the organization, provider, optional credential ID, actor, action, and timestamp.

## Capability-First Provider Registry

The setup UI and runtime configuration use server-side reference tables instead of a frontend-owned provider list:

- `providers`: provider identity, display metadata, enablement, and ordering.
- `capabilities`: functions such as LLM, embeddings, reranking, web search, document intelligence, image generation, podcast audio, STT, TTS, code analysis, load testing, and website analysis.
- `provider_capabilities`: supported provider/capability combinations and optional model or service IDs.
- `organization_capability_config`: the provider, optional credential, optional model/service, and enablement selected by an organization.

Adding a provider requires registry data plus the appropriate runtime adapter/discovery support; it does not require adding a provider card to the consolidated page. See [Adding a New LLM Model](addLLM.md).

### Importance and health

Capabilities have one of three importance levels:

| Importance | Meaning |
|---|---|
| `REQUIRED` | Missing configuration produces a prominent readiness warning. |
| `RECOMMENDED` | Missing configuration degrades overall readiness but does not prevent saving. |
| `OPTIONAL` | May remain unconfigured without affecting required readiness. |

Runtime and UI health use four states:

| Health state | Meaning |
|---|---|
| `READY` | Configured with an available credential. |
| `DEGRADED` | Usable with warnings or incomplete recommended configuration. |
| `UNAVAILABLE` | Configured but cannot be used, including BYOK without a valid organization credential. |
| `NOT_CONFIGURED` | No active configuration exists. |

Health warnings do not block saving. This permits incremental setup while making missing required services visible.

## Consolidated Admin Experience

The consolidated page is available at **Admin → Settings → AI & API Setup** (`/admin?tab=settings&section=ai-setup`). It is registry-driven and provides:

- organization selection within the actor's authorized scope;
- organization creation for authorized super admins;
- credential mode and credential management;
- capability-to-provider/model assignment;
- readiness and per-capability health;
- organization membership management;
- redacted credential audit history; and
- organization-attributed usage and authorized cost views.

Super admins can administer all organizations. An `org_admin` is limited to their own organization.

### Legacy settings behavior

When `ai-api-setup-ui-enabled` is enabled, fragmented legacy provider/settings sections render a read-only redirect to AI & API Setup. Legacy provider, route, speech, and applicable tool-credential write APIs reject writes with HTTP `409` and the code `LEGACY_WRITE_DISABLED` for non-super-admin users.

The legacy pages and code are redirected, not deleted. Turning the UI feature flag off restores the rollback path. RAG tuning remains writable in its existing settings page because it controls retrieval behavior rather than provider credential ownership.

### Dual credential management

The system supports two credential management paths that coexist during migration:

| Path | UI location | Who can write | Guard function |
|---|---|---|---|
| **Platform-managed** | Admin → Settings → API Keys (`/admin?tab=settings&section=api-keys`) | `super_admin` only | [`blockLegacyWriteForPlatform(user)`](../../src/lib/legacy-writes.ts:117) |
| **Organization BYOK** | Admin → Settings → AI & API Setup (`/admin?tab=settings&section=ai-setup`) | `org_admin` for their org; `super_admin` for any org | AI & API Setup APIs (no legacy guard) |

`blockLegacyWriteForPlatform()` bypasses the 409 block when the caller is `super_admin`, allowing platform-level credential writes (llm_providers table, tavily/ocr/reranker settings, web_search tool config, speech settings, route settings) to succeed via the API Keys page. Non-super-admin users still receive the 409 and must use the AI & API Setup page for BYOK credentials.

The API Keys page disables all key input fields and hides the Save button for non-super-admin users. The Test button sends edited (unsaved) keys in the POST body so that super admins can verify a key before persisting it.

## Organization-Aware Runtime Resolution

Request entry points place `organizationId` in async request context. Nested request contexts merge with their parent so tools and internal services inherit the tenant unless they explicitly override it.

The runtime path is:

1. Identify the organization from workspace or authenticated request context; absent context resolves to the Default organization for parity.
2. Call [`resolveCapability()`](../../src/lib/capability-resolver.ts:532) for the required capability.
3. Resolve the organization capability row and credential mode.
4. In `PLATFORM_MANAGED`, use the configured platform credential.
5. In `ORGANIZATION_BYOK`, use the explicitly selected organization credential or its active default for that provider.
6. Build or retrieve a provider client through [`ProviderClientFactory`](../../src/lib/provider-client-factory.ts:243).

During dual-read migration, a missing new capability configuration can use the legacy settings path. An existing BYOK configuration with a missing credential does **not** use legacy or platform fallback.

### Provider client cache

The provider client factory owns a bounded LRU cache with TTL. Cache entries are keyed by `credential_id + credential_version`, not only provider name. This prevents stale singleton clients from leaking old or cross-organization credentials after key replacement, disablement, or rotation.

## Vector Tenancy

Qdrant collections remain per-category (plus existing global/legacy collections). Collection consolidation is deferred.

Tenant isolation is enforced inside the vector-store wrapper:

- writes stamp `organization_id` into every point payload when vector tenancy is active;
- searches merge a mandatory `organization_id` condition into caller-supplied category/document filters;
- callers cannot replace the organization condition with their own filter; and
- existing points are backfilled by changing payload metadata only.

No vector or sparse-vector values change, so vector tenancy migration does not require re-embedding documents.

## Cost and Usage Attribution

`token_usage_log` includes:

- `organization_id`: organization that owns the request/usage;
- `credential_id`: exact organization credential used for BYOK, or `NULL` for platform, legacy, or unattributed usage.

Attribution follows request context unless a call supplies an explicit organization. Raw keys are never written to usage metadata.

Cost visibility is credential-mode aware:

| Usage type | Cost visibility |
|---|---|
| Platform-managed | `super_admin` only. |
| Organization BYOK | `org_admin` for their own organization; super admins retain global administrative scope. |
| BYOK selected without an active key | Capability is unavailable; no platform cost fallback is attributed. |

Members may be shown token-level usage where permitted, but financial visibility remains role-gated.

## Feature Flags

The rollout uses four boolean keys in `settings`:

| Key | Controls |
|---|---|
| `org-tenancy-enabled` | Organization tenancy behavior. |
| `org-credential-resolver-enabled` | Organization-aware capability and credential resolution. |
| `vector-tenancy-enabled` | Qdrant organization payload/filter enforcement. |
| `ai-api-setup-ui-enabled` | Consolidated UI and legacy-page retirement behavior. |

Absent or invalid values are treated as `false`. Startup invokes [`assertFeatureFlagCombinations()`](../../src/lib/feature-flag-combinations.ts:55) and aborts on invalid ordering:

- `vector-tenancy-enabled` requires `org-tenancy-enabled`.
- `org-credential-resolver-enabled` requires `org-tenancy-enabled`.
- `ai-api-setup-ui-enabled` has no dependency so the UI can be rolled back independently.

## Migration and Operations

The redesign was delivered in six independently verifiable phases:

| Phase | Purpose |
|---|---|
| A — Additive Schema | Add organization, registry, credential, audit, and attribution schema without changing runtime behavior. |
| B — Backfill + Vault | Create the Default organization, map existing users/workspaces/configuration, and establish encrypted credential handling. |
| C — Dual-Read | Prefer new organization configuration when present and retain legacy fallback when absent. |
| D — Resolver Switch | Move runtime services to organization-aware resolution and enforce vector tenancy after backfill. |
| E — Enable BYOK | Enable organization credential management and the consolidated setup page. |
| F — Retire Legacy | Redirect legacy UI and block legacy writes while retaining rollback capability. |

### Operational scripts

Run scripts from the project root with a valid PostgreSQL connection:

| Script | Purpose |
|---|---|
| [`scripts/pre-migration-readiness.ts`](../../scripts/pre-migration-readiness.ts) | Verifies the KEK, legacy credential decryption, workspace assignments, PostgreSQL/Kysely path, Default-org uniqueness, and provider-key resolution. Exits nonzero on failure. |
| [`scripts/backfill-org-tenancy.ts`](../../scripts/backfill-org-tenancy.ts) | Idempotently creates/maps the Default organization, memberships, workspaces, usage rows, registry references, platform credential references, and capability configuration. Legacy rows are retained. |
| [`scripts/backfill-vector-tenancy.ts`](../../scripts/backfill-vector-tenancy.ts) | Idempotently stamps the Default organization onto existing Qdrant payloads without re-embedding. Run after organization backfill and before enabling vector tenancy. |

The PostgreSQL/Kysely path is authoritative for this redesign. Legacy SQLite modules are frozen; do not independently add the new tenancy schema to both database implementations.

## Rollback

The fast Phase F rollback is to disable `ai-api-setup-ui-enabled`, which restores legacy navigation/write behavior while leaving additive schema and migrated data intact. A full code rollback is also documented. Do not delete organization, credential, or audit data as part of the UI rollback.

Follow the exact procedure and verification checklist in [Phase F Rollback Procedure](../../plans/AI_API_Setup_Redesign_PhaseF_Rollback.md).

## Key Implementation Files

| Area | File |
|---|---|
| Credential encryption and mutation audit | [`src/lib/credential-vault.ts`](../../src/lib/credential-vault.ts) |
| Capability resolution | [`src/lib/capability-resolver.ts`](../../src/lib/capability-resolver.ts) |
| Provider client LRU | [`src/lib/provider-client-factory.ts`](../../src/lib/provider-client-factory.ts) |
| Request organization context | [`src/lib/request-context.ts`](../../src/lib/request-context.ts) |
| Feature-flag validation | [`src/lib/feature-flag-combinations.ts`](../../src/lib/feature-flag-combinations.ts) |
| Capability health | [`src/lib/health-evaluator.ts`](../../src/lib/health-evaluator.ts) |
| Usage attribution | [`src/lib/token-logger.ts`](../../src/lib/token-logger.ts) |
| Qdrant tenancy enforcement | [`src/lib/vector-store/qdrant.ts`](../../src/lib/vector-store/qdrant.ts) |
| Consolidated page | [`src/components/admin/settings/AiApiSetup.tsx`](../../src/components/admin/settings/AiApiSetup.tsx) |
| Legacy redirect | [`src/components/admin/settings/LegacySettingsRedirect.tsx`](../../src/components/admin/settings/LegacySettingsRedirect.tsx) |
| Admin API | [`src/app/api/admin/ai-setup/`](../../src/app/api/admin/ai-setup/) |
