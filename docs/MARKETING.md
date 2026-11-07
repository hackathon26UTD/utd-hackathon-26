# Public website and portal

> Current as of November 7, 2026. Owner: Ayan's workstream. Code: `ui/marketing.js`, `ui/design.css`, `functions/_middleware.js`.

## Current flow

The public root introduces HomeBeacon through a complete marketing site. Top navigation leads to product explanation, command-center preview, hardware, demo and portal. The portal checks the session and redirects to login or the authenticated workspace. Login is a separate route; it must not become the homepage again.

The hero's custom SVG neighborhood illustrates connected, power-lost, water-detected and reconnected scenarios. Text explains every state. Manual selection and play/pause drive signal transport and observation transitions. Pointer perspective and staged entrance add depth; reduced motion stops active animations and removes spatial transforms. Controls remain usable on touch and keyboard.

Below the hero, the site explains observe/retain/review, shows an actual exercise screenshot, lists command workflows, illustrates a conceptual black box, answers practical limitations and leads into the portal. No customer logos, adoption statistics, real-world safety guarantees or sponsor endorsements are fabricated.

## Design and dependencies

Ink/paper/teal visual direction, Bricolage headings and Geist body. Component conventions adapt the public Argus Oracle UI reference, not an installed Argus package. Native SVG, CSS and Web Animations provide motion. MapLibre loads only for the command workspace, keeping marketing independent of map initialization. Public map and font licenses are linked in the footer.

## Limitations

This is a prototype marketing experience, not proof of certified hardware, battery duration, actual deployment in homes or connected NVIDIA inference. The hardware cutaway is a concept illustration. The command preview is a labeled synthetic exercise. The user's final visual acceptance is still pending.

## Verification and ongoing work

Run a local server after building, then `TEST_BASE_URL=http://localhost:8792 node scripts/test-marketing.mjs`. It checks scenarios, pause, anonymous portal redirect, mobile overflow, reduced motion, page errors and automated accessibility. Portal unit tests also cover signed-in routing. Screenshots are review artifacts; manual screen-reader and cross-browser testing remain.

Do not add decorative endless movement, block access behind motion, or replace the full marketing journey with a login form. Use the latest Ayan feedback and cross-check teammate branches before edits.
