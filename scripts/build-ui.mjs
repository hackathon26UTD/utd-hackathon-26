import {build} from 'esbuild';
import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('public/assets',{recursive:true});
await build({entryPoints:['ui/app.js','ui/design.css','ui/marketing.css','ui/customer.js','ui/customer.css','ui/product-kit.css'],outdir:'public/assets',bundle:true,splitting:true,format:'esm',minify:true,loader:{'.woff2':'file','.woff':'file'},assetNames:'[name]-[hash]'});
await build({entryPoints:[{in:'ui/kit/kit.entry.js',out:'kit'},{in:'ui/kit/gallery.entry.js',out:'kit-gallery'},{in:'ui/kit/reference.entry.js',out:'kit-reference'},...['scene.svg','photo.svg','logo.svg','scene.webm',...Array.from({length:24},(_,i)=>`avatars/face-${String(i+1).padStart(2,'0')}.svg`)].map(f=>({in:`ui/kit/vendor/assets/${f}`,out:(f.startsWith('avatars/')?'':'ui-library/')+f.replace(/\.\w+$/,'')})),...['mark-onlight','mark-ondark','wordmark-onlight','wordmark-ondark'].map(n=>({in:`ui/kit/brand/homebeacon-${n}.svg`,out:`logo/homebeacon-${n}`}))],outdir:'public/assets',bundle:true,format:'iife',minify:true,loader:{'.woff2':'file','.svg':'copy','.webm':'copy'},assetNames:'kit-[name]-[hash]'});
await copyFile('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs','public/assets/map-worker.mjs');

// Preview share cards must resolve against the preview that contains their image.
const previewBranch = /^pr-[1-9]\d*$/.test(process.env.DEPLOY_BRANCH || '') ? process.env.DEPLOY_BRANCH : null;
const siteOrigin = `https://${previewBranch ? previewBranch + '.' : ''}utd-hackathon-26.pages.dev`;
for (const name of (await readdir('public')).filter(name => /\.html$/.test(name) || ['robots.txt', 'sitemap.xml'].includes(name))) {
  const path = `public/${name}`;
  const source = await readFile(path, 'utf8');
  const result = source.replace(/https:\/\/(?:pr-\d+\.)?utd-hackathon-26\.pages\.dev/g, siteOrigin);
  if (result !== source) await writeFile(path, result);
}
