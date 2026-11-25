#!/usr/bin/env node
'use strict';
// Bundles lib/*.js + prefs.json into the hosted page: web/concierge.src.html -> dist/concierge.html
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MODULES = ['units', 'text', 'taste', 'shortlist', 'compare', 'flow', 'prompts'];

const defs = MODULES.map((name) => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', `${name}.js`), 'utf8');
  if (/<\/script/i.test(src)) throw new Error(`lib/${name}.js contains </script>`);
  return `def('./${name}', function (module, exports, require) {\n${src}\n});`;
}).join('\n');

const bundle = `(function () {
var cache = {}, fns = {};
function def(name, fn) { fns[name] = fn; }
function req(name) {
  if (cache[name]) return cache[name].exports;
  if (!fns[name]) throw new Error('Unknown module ' + name);
  var module = { exports: {} }; cache[name] = module;
  fns[name](module, module.exports, req);
  return module.exports;
}
${defs}
window.ShopLib = { ${MODULES.map((m) => `${m}: req('./${m}')`).join(', ')} };
})();`;

const prefs = JSON.parse(fs.readFileSync(path.join(ROOT, 'prefs.json'), 'utf8'));
delete prefs._readme;
const page = fs.readFileSync(path.join(ROOT, 'web', 'concierge.src.html'), 'utf8')
  .replace('/*@BUNDLE@*/', () => bundle)
  .replace('/*@PREFS@*/', () => JSON.stringify(prefs).replace(/</g, '\\u003c'));

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'concierge.html'), page);
process.stdout.write(`Built dist/concierge.html (${Math.round(page.length / 1024)} KB)\n`);
