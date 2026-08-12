# Portal configuration

The portal requires its own Microsoft Entra single-tenant application, session secret, and dedicated
PostgreSQL database. It does not consume AI Assistant cookies, JWTs, database credentials, or auth
application settings.

Register this exact redirect URI in Entra:

```text
${PORTAL_BASE_URL}/auth/callback
```

Required configuration is listed in `.env.example`. Generate `PORTAL_SESSION_SECRET` from at least
32 cryptographically random bytes. Production startup fails when the portal origin is insecure, the
secret is weak, Entra identifiers are malformed, or no local administrator mapping is configured.

`PORTAL_ADMIN_EMAILS` and `PORTAL_ADMIN_OBJECT_IDS` are comma-separated exact allowlists. Object IDs
are preferred because email claims can change. Unmapped authenticated identities receive the `user`
role. Only an `admin` may call registration mutation handlers.

The local Compose stack explicitly disables database TLS only for its private development network.
Deployed environments default to certificate-validated PostgreSQL TLS. Do not enable
`PORTAL_ALLOW_INSECURE_LOCAL_DEVELOPMENT` for non-local hostnames.
