# Perrun landing

Source: perrun-2027.html + perrun-landing-data.js. Uses EventLanding, styles.css, existing Perrun event/stage config and setupEventCountdown. Core event data and checkout are unchanged.

No Perrun image assets exist. Current hero/final use typographic CSS panels, not substitute photos. To replace: set images.hero and images.finalBanner in landing data; set experience[].image for kit photos.

Needed: hero runner with dog, 1600×1200 (4:3); final banner 1600×900 (16:9); dog kit and human kit 1000×1000 (1:1); official route map 1600×1200 (4:3). Suggested directory assets/events/perrun-2027/. Do not add a route or departure time until confirmed.

Validation: original suite 673/673 PASS; expanded suite 679/679 PASS (6 landing tests). Local fixture environment only: STRIPE_SECRET_KEY=sk_test_local_fixture, SUPABASE_URL=https://example.invalid, SUPABASE_SERVICE_ROLE_KEY=local_fixture. No remote data writes. Build PASS. Browser Chromium: 390, 430, 768, 1440 px, no horizontal overflow, correct 3 checkout URLs, relative header and no page errors. Existing Axolote/Cascanueces renderer initializes with original slugs.
