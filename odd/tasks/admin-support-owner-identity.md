# Authenticated owner presentation
Branch: feat/admin-support-owner-identity; one draft; Node and Chrome fixtures.
## Specs
- S1 “recupere el nombre desde `user_profiles` mediante la relación verificada por `owner_user_id`.”
- S2 “No aceptes identificadores de usuario enviados por el navegador” and “No utilices coincidencias de correo para vincular conversaciones.”
- S3 “Devuelve al frontend únicamente el nombre de presentación y una indicación de identidad autenticada”
- S4 “Conserva «Visitante sin identificar» si el ticket es anónimo, carece de propietario válido o no tiene nombre disponible.”
- S5 “Conserva el folio corto, los estados, los responsables y el diseño actual del PR #23.”
## Tasks
- T1 S1–S5 inline; independent privacy review before draft.
## Log
- L1: Audit d51cda9, no schema or permission edits. Reviewed checked-in historical profile PK/FK and existing admin service role. Production metadata not queried; fail closed to neutral if missing/drift.
- L2: 50/50 focused checks, isolated build, Chrome dual fixture (desktop/mobile) and independent review passed. Real Supabase PK/FK, FK expansion and current service-role SELECT remain a metadata-only preflight before Production. No grants, migrations, email linkage, public route changes or historical backfill.
