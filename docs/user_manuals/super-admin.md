# Super Admin Guide

> **Audience:** Super Admins only  
> **Access:** `/admin` dashboard (same as Admin)  
> **Scope:** All admin capabilities, implicit administration of every organization, global credential audit, and platform financial data access

---

## Overview

The **Super Admin** role is the highest privilege tier in AI Assistant. It is seeded from the `ADMIN_EMAILS` environment variable and grants all Admin capabilities, implicit `org_admin` authority over every organization, global credential-audit access, and exclusive access to platform-managed financial data.

### Role Hierarchy

| Role | Cost Data | Usage Data | Admin UI | SuperUser UI |
|------|-----------|------------|----------|-------------|
| **Super Admin** | ✅ Full access | ✅ Full access | ✅ Full | ✅ Full |
| **Admin** | ❌ Platform cost; own-org BYOK only if explicitly `org_admin` | ✅ Token counts in permitted scope | ✅ Full | ✅ Full |
| **Superuser** | ❌ None | ❌ None | ❌ None | ✅ Category-scoped |
| **User** | ❌ None | ❌ None | ❌ None | ❌ None |

### How Super Admin Differs from Admin

| Feature | Admin | Super Admin |
|---------|-------|-------------|
| Manage categories, users, documents | ✅ | ✅ |
| Configure own-organization providers/models | Only with explicit `org_admin` membership | ✅ Every organization |
| Create/select organizations | ❌ | ✅ |
| Review credential audit across organizations | ❌ | ✅ |
| Manage tools, skills, prompts | ✅ | ✅ |
| View token usage statistics | ✅ | ✅ |
| View **cost data** ($ amounts) | ❌ | ✅ |
| View **Pricing tab** with provider balances | ❌ | ✅ |
| View **provider account balances** | ❌ | ✅ |
| Demote or delete other super admins | ❌ | ✅ (except self) |

---

## Seeding Super Admins

Super admins are created from the `ADMIN_EMAILS` environment variable on first startup:

```bash
# .env
ADMIN_EMAILS=admin@example.com,superadmin@example.com
```

- Users matching these emails are automatically promoted to `super_admin` role
- Existing users who later match `ADMIN_EMAILS` are re-promoted on next startup
- Super admins cannot be demoted or deleted via the Admin UI (enforced by DB constraints)

---

## Sidebar Navigation

Super Admins have the same sidebar menu as Admins (all 11 top-level tabs + Settings submenu). See [ADMIN_GUIDE.md](ADMIN_GUIDE.md) for the complete navigation reference.

The key differences are organization scope and financial scope: Super Admins administer every organization and can see **platform-managed cost data**. An `org_admin` can see BYOK cost only for their own organization.

## Organization Management and Global Audit

**Location:** Admin → Settings → AI & API Setup

Super Admins are implicit administrators of all organizations; no `organization_memberships` row is required. From the organization selector, a Super Admin can:

- select the Default, `ENTITY`, or `INDIVIDUAL` organization;
- create an `ENTITY` or `INDIVIDUAL` organization;
- choose `PLATFORM_MANAGED` or `ORGANIZATION_BYOK` credential mode;
- manage provider credentials and capability-to-provider/model assignments;
- manage organization members and assign `org_admin` or `member`;
- inspect readiness and capability health; and
- view organization-attributed tokens and authorized cost.

Provider credentials are organization-owned—there is no per-user BYOK. BYOK never silently falls back to a platform key when its organization credential is missing or disabled.

### Global Credential Audit

Super Admins can review redacted credential events across organizations. Events include create, replace, disable, enable, test, and rotate operations with actor and timestamp where available. Raw provider keys are never returned or stored in audit detail.

Use **Test Connection**, **Replace Key**, or **Disable Connection**. There is no **Show Key** action.

### Cost Visibility by Credential Mode

| Credential mode | Who can view cost |
|---|---|
| `PLATFORM_MANAGED` | Super Admin only |
| `ORGANIZATION_BYOK` | The organization's `org_admin` for that organization; Super Admins retain cross-organization administrative scope |

The `token_usage_log` attribution includes organization and, for BYOK, the exact credential identifier. A missing BYOK key makes the capability unavailable rather than attributing a fallback platform cost.

## Exclusive Features

### 1. Pricing Tab

**Location:** Admin > Settings > Pricing

This tab is **only visible to Super Admins** — the navigation link is completely hidden for regular Admins. It shows:

| Provider | Information |
|----------|-------------|
| OpenAI | Account balance, usage-to-date, hard/soft limits |
| Anthropic | Account balance, cost report |
| Other providers | API key validated status |

**Requirements:**
- `OPENAI_ADMIN_API_KEY` — Standard API keys (`sk-...`) cannot access the `/v1/organization/costs` endpoint. Use an Admin API key from https://platform.openai.com/settings/organization/admin-keys
- `ANTHROPIC_ADMIN_API_KEY` — Standard API keys cannot access cost reports. Use an Admin API key from https://console.anthropic.com/settings/admin-keys

If these env vars are not set, the Pricing tab shows "Not configured" for those providers.

### 2. Cost Views in Usage Dashboard

**Location:** Admin > Settings > Usage

The Usage dashboard displays token consumption and costs by model. For Admins, cost columns are zeroed out (`$0.00`). Super Admins see:

- **Cost by Model** — Total spend per model over the selected period
- **Cost by User** — Per-user spend breakdown
- **Cost Trends** — Daily/weekly/monthly cost charts
- **Provider Balances** — Current account balances for each LLM provider

### 2. Pricing Tab

**Location:** Admin > Settings > Pricing

Shows real-time pricing and account balance information for all configured LLM providers:

| Provider | Information Shown |
|----------|-------------------|
| OpenAI | Account balance, usage-to-date, hard/soft limits |
| Anthropic | Account balance, cost report |
| Other providers | API key validated status |

This tab is **completely hidden** for regular Admins — the navigation link does not appear.

### 3. Provider Balances API

**Endpoint:** `GET /api/admin/provider-balances`

Returns account balances for configured LLM providers. Returns `403 Forbidden` for non-super-admin requests. Used by the Pricing tab and for budget monitoring.

### 4. Cost-Gated Usage API

**Endpoint:** `GET /api/admin/usage`

The usage API endpoint includes cost fields (`inputCost`, `outputCost`, `totalCost`) in the response. For regular Admin requests, these fields are stripped server-side (returned as `null` or `0`). Super Admin requests receive full cost data.

---

## Infrastructure Dashboard

**Location:** Admin > Dashboard

The Infrastructure Dashboard shows live status of all services. Super Admins see the same view as Admins:

| Component | What It Shows |
|-----------|---------------|
| Database | PostgreSQL connection pool status, table counts |
| Vector Store | Qdrant collection status, vector counts |
| Redis | Cache hit rates, memory usage |
| LLM Routes | Active routes (2/3/5) and provider health |

---

## Security Considerations

### Protecting Financial Data

- **Server-side enforcement:** Cost data is stripped at the API level, not just hidden in the UI
- **API endpoint gating:** `/api/admin/provider-balances` returns 403 for non-super-admins
- **Navigation hiding:** The Pricing tab link is not rendered for regular Admins
- **Audit trail:** Super admin actions are logged

### Credential Management

- Use strong, unique passwords for super admin accounts
- Enable multi-factor authentication via your OAuth provider (Azure AD, Google)
- Rotate `ADMIN_EMAILS` if a super admin leaves the organization
- Super admins cannot be deleted via UI — remove from `ADMIN_EMAILS` and restart
- Configure organization provider credentials only through **AI & API Setup**; legacy provider/settings pages are read-only while the redesigned UI is enabled
- Review the global redacted credential audit regularly; never copy raw keys into notes or audit comments

### Best Practices

1. **Minimize super admin accounts** — Only grant to individuals who need financial visibility
2. **Use separate accounts** — Have a regular Admin account for day-to-day operations
3. **Monitor access** — Review super admin login activity regularly
4. **Document exceptions** — Log any direct database modifications by super admins

---

## Troubleshooting

### "Pricing tab not visible"

- Verify your account has `super_admin` role in the database
- Check `ADMIN_EMAILS` in `.env` includes your email
- Restart the application after changing `ADMIN_EMAILS`

### "Provider balance shows $0.00"

- Verify the provider API key has admin-level permissions (not all API keys support balance queries)
- For OpenAI: Requires an Admin API key from https://platform.openai.com/settings/organization/admin-keys
- For Anthropic: Requires an Admin API key from https://console.anthropic.com/settings/admin-keys
- Check `OPENAI_ADMIN_API_KEY` and `ANTHROPIC_ADMIN_API_KEY` in `.env`

### "Usage dashboard shows token-only data"

- This is expected for regular Admin accounts
- Super Admin accounts see both token counts and cost amounts
- Verify your role via Admin > Users > (your user)

---

## Related Documentation

- [ADMIN_GUIDE.md](ADMIN_GUIDE.md) — Full admin dashboard reference
- [SUPERUSER_GUIDE.md](SUPERUSER_GUIDE.md) — Superuser (category manager) guide
- [USER_GUIDE.md](USER_GUIDE.md) — End user guide
- [docs/tech/auth.md](../tech/auth.md) — Authentication architecture
- [docs/features/LLM.md](../features/LLM.md) — LLM architecture reference
- [docs/tech/AI-API-Setup-Redesign.md](../tech/AI-API-Setup-Redesign.md) — Organization tenancy, credential vault, audit, cost attribution, and rollback
