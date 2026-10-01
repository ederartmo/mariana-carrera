# Kinetic Hub — local project setup

## Project identities

- GitHub: https://github.com/ederartmo/mariana-carrera.git
- Canonical checkout: C:\Users\EderArtMo\Documents\Projects\KineticHub
- Branch: main. Readiness baseline: 2241dedd72cc2499adb35c4ff5aa7560c839ccff.
- Vercel project: mariana-carrera
- Vercel projectId: prj_jxGcIbaFYc1eAqPtQ143cQthtu1e
- Vercel team/orgId: team_91mKwX0iCO01CCHuLiyLHiUg
- Supabase remote ref: uycwzhlcnfijjyzkgkem
- Expected Supabase URL: https://uycwzhlcnfijjyzkgkem.supabase.co

## Required rules

- Local Stripe always uses TEST. Never use a LIVE key locally.
- Production credentials and services must never be used for tests. Unit tests use mocks;
  loading local configuration does not authorize real writes, emails, charges, or RPC calls.
- Verify Git, Supabase, Vercel and Stripe identities before migrations or deployment.
  Stop if any identity differs or is unknown. Login alone does not prove project identity.
- Never commit .env.local, .vercel/, supabase/.temp/ or node_modules/.
- Never print environment values or credentials in diagnostics.
- Readiness cleanup does not authorize implementation, migrations, deployment or payment operations.

## Install and local configuration

Run from the canonical checkout in PowerShell:

```powershell
npm ci
# On a new checkout only; do not overwrite an existing .env.local:
Copy-Item .env.example .env.local
```

Fill .env.local locally using verified development credentials. The template contains no
credentials. RATE_LIMIT_SECRET and CHECKOUT_SUMMARY_SECRET require at least 32 characters;
use independently generated random values. Use Stripe TEST prices if optional price IDs
are supplied. Do not copy Production environment files into local development.

Node 24 supports explicit loading of .env.local. The existing npm scripts do not load it
automatically. This command loads it into the current child process without printing it:

```powershell
node --env-file=.env.local -e 'const cp=require("node:child_process"); const r=cp.spawnSync("npm.cmd",["test"],{stdio:"inherit",shell:true,env:process.env}); process.exit(r.status ?? 1);'
npm run build
```

Build rewrites generated public/ and minified assets. Review those outputs before staging;
do not treat asset-version changes as business logic changes. To build with reproducible
asset versions, supply the current Git SHA as VERCEL_GIT_COMMIT_SHA to the build process.

## Verify identities without exposing secrets

```powershell
git remote get-url origin
git branch --show-current
git rev-parse HEAD
npx --no-install supabase --version
Get-Content supabase/.temp/project-ref
Get-Content .vercel/repo.json
npx --no-install vercel project inspect --scope team_91mKwX0iCO01CCHuLiyLHiUg
node --env-file=.env.local -e 'console.log("SUPABASE_URL_MATCH="+(process.env.SUPABASE_URL==="https://uycwzhlcnfijjyzkgkem.supabase.co")); console.log("STRIPE_TEST="+/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY||""));'
git check-ignore .env.local .vercel/repo.json supabase/.temp/project-ref node_modules/stripe/package.json
git ls-files -- .env.local .vercel supabase/.temp node_modules
git check-ignore .env.example
```

The tracked-files command must return nothing for local-only paths. The final ignore
check must return nothing (exit 1): .env.example is intended to be versionable.
The current Vercel CLI stores the root-project association in .vercel/repo.json;
.vercel/project.json may contain only project settings.

## Local scope versus global authentication

- Repo-local and versioned: package.json, lockfile, Supabase local config and this guide.
- Repo-local but ignored: .env.local; Vercel link in .vercel/; Supabase remote link in
  supabase/.temp/project-ref. Recreate ignored links on a new checkout.
- Supabase config.toml project_id identifies the local stack, not the remote ref.
- Supabase and Vercel CLI login credentials remain global. Always inspect the local link
  and use explicit refs/scopes. Do not change a global default to switch projects.
- MCP connections are global and may not have access to Kinetic Hub. Specify the exact
  remote ref; never substitute another accessible client project.
- Stripe CLI login may be global. Confirm TEST mode and the intended account independently.

On a new checkout, linking requires account authorization. Do not run these commands
against another project or as part of unit tests:

```powershell
npx --no-install vercel link --yes --scope team_91mKwX0iCO01CCHuLiyLHiUg --project prj_jxGcIbaFYc1eAqPtQ143cQthtu1e
npx --no-install supabase link --project-ref uycwzhlcnfijjyzkgkem
```

## Supabase reads

inscripciones and its REST OpenAPI schema are readable with verified project credentials.
Do not invoke finalize_paid_order or consume_api_rate_limit during diagnostics: they write.
get_next_event_bib_number takes a transaction lock; inspect it rather than invoking it
in a read-only audit. Review deployed definitions before assuming any RPC is read-only.
Never run SQL files merely to check their existence.

## Preview prerequisite

Before testing checkout in Vercel Preview, configure a Preview-specific
CHECKOUT_SUMMARY_SECRET with at least 32 characters. Generate it independently;
never copy the Production secret. This cleanup does not set or rotate remote secrets.
Without a valid secret, checkout attempts to expire its Stripe session and returns an
error before persisting the pending registration; checkout-summary rejects its claim.

## Proposed doctor command

A future npm run doctor should verify exact project identities, required variable
presence and secret minimum lengths, Stripe TEST mode, ignore rules and read-only
connectivity. It must print no values and must never deploy, migrate, call mutating
RPCs, send email, or create Stripe sessions. This cleanup does not implement doctor.
