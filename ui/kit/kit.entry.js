// Safe Home kit bundle entry. Built by scripts/build-ui.mjs to
// public/assets/kit.js and public/assets/kit.css (classic script, IIFE).
// CSS order is the order the source portal loads them in, then ours:
//   fonts, kit.css, kit-standards.css, kit-table.css, glue.css, theme.
import './fonts.css';
import './vendor/css/kit.css';
import './vendor/css/kit-standards.css';
import './vendor/css/kit-table.css';
import './glue.css';
import './theme-homebeacon.css';

// JS order is the source portal's: core first, then the rest extend window.Kit.
import './vendor/js/kit/core.js';
import './vendor/js/kit/components.js';
import './vendor/js/kit/forms.js';
import './vendor/js/kit/chart.js';
import './vendor/js/kit/motion.js';
import './vendor/js/kit/balance.js';
import './vendor/js/kit/help.js';
import './vendor/js/kit/guide.js';
import './vendor/js/kit/table.js';

import './shims.js';
