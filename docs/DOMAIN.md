# Safe Home domain and email

November 10, 2026, Ayan domain setup workstream.

## Provider setup

- Registrar: Porkbun. Registration remains there; this request changes authoritative nameservers, not registrar ownership or billing.
- Domain: `safehomemesh.us`. Existing Cloudflare Free zone, same account as Pages project `utd-hackathon-26`.
- Nameservers saved at Porkbun and read back after reload: `emerie.ns.cloudflare.com`, `harley.ns.cloudflare.com`.
- Apex and `www` registered as Pages custom domains, with proxied CNAMEs to `utd-hackathon-26.pages.dev`. Cloudflare supplies flattened A and AAAA answers. IPv6 enabled; HTTPS forced; origin TLS mode Full (strict).
- The existing Pages hostname and hardware ingest endpoints are retained. Do not redirect the old hostname wholesale; physical clients and assistant connections may still use it.

## Incoming mail

Cloudflare forwarding rules are enabled individually for `hello`, `contact`, `support`, `info`, `noreply`, `no-reply`, `ayan`, `security`, `privacy`, `postmaster`, and `abuse` at this domain. They target Ayan’s already verified Gmail destination. These are forwarding aliases, not separate hosted mailboxes or Gmail send-as identities. No catch-all rule was enabled. Other personal addresses need an explicit name and destination.

The provider-supplied root MX, routing SPF and routing DKIM records are prepared. The zone-level Email Routing enable operation returned `Active zone required` while nameserver propagation was pending. Individually enabled rules do not establish working receipt until that operation succeeds.

## Outgoing mail

- Added `safehomemesh.us` to the existing Resend account without changing its plan or removing another domain.
- Added Resend-provided DKIM and `send` MX/SPF records, plus its `rsend` CNAME. Root MX stays dedicated to inbound Cloudflare forwarding.
- DMARC starts at monitoring-only (`p=none`); no third-party report destination.
- Desired application sender: `Safe Home <noreply@safehomemesh.us>`; replies: `hello@safehomemesh.us`; links: `https://safehomemesh.us`.
- Existing production Resend secret is present. Do not replace it with a broad account key. Never print or commit credential values.
- Do not enable household email queues or send historical queued mail as part of a domain migration.

## Website changes

Production canonical/share URLs, sitemap, robots, email default links and the reference-gallery host allowlist use the new domain. PR previews retain their own hostname and share-card origin. Existing Pages-based hardware defaults remain compatible.

## Verification and remaining steps

At the initial verification the US registry still delegated to Porkbun; Cloudflare zone, Pages certificates and Resend verification were pending. This is a saved configuration, not a claim that the new domain or mail is live.

1. Confirm US registry delegation to the assigned Cloudflare nameservers and Cloudflare zone activation.
2. Enable zone-level Email Routing through the documented DNS endpoint; read back enabled/ready status.
3. Confirm Resend domain and all required records are verified.
4. Patch only the production email sender/reply/origin settings, preserving existing secrets and configuration.
5. Release the tested domain changes and verify HTTPS, page metadata, database readiness and private boundaries on the new domain.
6. Test sending only to approved test sinks, unless a real recipient test is explicitly requested.

References: [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Email Routing](https://developers.cloudflare.com/email-service/get-started/route-emails/), [Resend domain verification](https://resend.com/docs/api-reference/domains/verify-domain).
