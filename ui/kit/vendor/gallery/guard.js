// apps/portal-frontend/js/ui-library/guard.js
/* The ARGUS UI library is staging-only. vercel.json is shared with production;
 * it redirects the library's paths away on every host but staging, and this check
 * keeps anything from drawing on any other host. Same hosts
 * as js/config.js's isStaging, plus local servers. Exact matches only.
 * Pass location.hostname (no port), not location.host. */
(function () {
    'use strict';
    var NS = (window.ArgusUILibrary = window.ArgusUILibrary || {});
    var ALLOWED = ['staging.useargus.co', 'rion-portal-staging.vercel.app', 'localhost', '127.0.0.1'];
    NS.allowedHost = function (host) {
        return ALLOWED.indexOf(String(host || '').toLowerCase()) !== -1;
    };
    NS.enforce = function (host) {
        if (NS.allowedHost(host)) return true;
        var p = document.createElement('p');
        p.textContent = 'The ARGUS UI library is available only on staging.';
        document.body.replaceChildren(p);
        return false;
    };
})();
