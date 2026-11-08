// Safe Home kit gallery bundle. Built to public/assets/kit-gallery.js and
// public/assets/kit-gallery.css. Needs kit.js and kit.css on the page first.
// The three vendored library scripts are plain IIFEs that write to
// window.ArgusUILibrary; bundling them keeps them byte-identical in source.
import './vendor/gallery/guard.js';
import './gallery/host.js';
import './vendor/gallery/render.js';
import './vendor/gallery/frame.js';
import './vendor/gallery/ui-library.css';
import './gallery/gallery.css';
import './gallery/gallery.js';
