// Lets Node import the browser's knit3d modules: "three" resolves to the
// vendored copy the page uses, and the ?v= cache-busting suffixes are dropped.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const VENDOR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../frontend/assets/js/vendor');
const hooks = `
const THREE = ${JSON.stringify(pathToFileURL(path.join(VENDOR, 'three.module.js')).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: THREE, shortCircuit: true };
  if (spec.includes('?v=')) return next(spec.replace(/\\?v=[^/]*$/, ''), ctx);
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks), import.meta.url);
