// Owner-authorized Safe Home hosting integration; preserve vendor staging guard.
const NS=window.ArgusUILibrary;
const original=NS.allowedHost;
NS.allowedHost=host=>original(host)||host==='utd-hackathon-26.pages.dev'||/^[a-z0-9-]+\.utd-hackathon-26\.pages\.dev$/.test(host);
