import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('public/assets',{recursive:true});
await build({entryPoints:['ui/app.js','ui/design.css'],outdir:'public/assets',bundle:true,format:'esm',minify:true,loader:{'.woff2':'file'},assetNames:'[name]-[hash]'});
await copyFile('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs','public/assets/map-worker.mjs');
