//  Stamps the two rebuilt bundles in index.html with a hash of their own contents.
//
//  GitHub Pages serves them with `cache-control: max-age=600` under names that never
//  change, so for ten minutes after a deploy a returning visitor can end up running the
//  new index.html against the previous JavaScript - the page looks updated but half of it
//  does nothing. A query string the browser has not seen before forces an immediate fetch.
//
//  Content hash rather than a counter: an unchanged build leaves index.html untouched,
//  so this never shows up as noise in a diff, and it can never be forgotten.

const fs = require('fs');
const crypto = require('crypto');

const INDEX = 'index.html';

const ASSETS = ['css/suchedule.min.css', 'js/suchedule.min.js'];

const stamp = path => crypto.createHash('sha1').update(fs.readFileSync(path)).digest('hex').slice(0, 8);

let html = fs.readFileSync(INDEX, 'utf8');
let changed = false;

ASSETS.forEach(asset => {
    const version = stamp(asset);
    //  Matches the reference with or without an existing stamp.
    const pattern = new RegExp(`${asset.replace('.', '\\.')}(\\?v=[0-9a-f]+)?`, 'g');
    const replaced = html.replace(pattern, `${asset}?v=${version}`);

    if (replaced !== html) {
        changed = true;
    }

    html = replaced;

    console.log(`${asset} -> ?v=${version}`);
});

if (changed) {
    fs.writeFileSync(INDEX, html);
    console.log('index.html updated');
} else {
    console.log('index.html already current');
}
