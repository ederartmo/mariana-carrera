'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const documents = [
  {
    label: 'convocatoria',
    sourceName: 'Copia de Convocatoria Perrun.pdf',
    relativePath: 'assets/events/perrun-2027/docs/convocatoria-perrun-2027.pdf',
    sha256: '5180f1b2cd6cb3377bf42c5da25fa59b2a109e16f31772576d9938715419710a',
  },
  {
    label: 'exoneracion',
    sourceName: 'ExoneraciónPerrun.pdf',
    relativePath: 'assets/events/perrun-2027/docs/exoneracion-perrun-2027.pdf',
    sha256: '1eef1814edbacef10c9c3f30078c8dd06415d8157001791568bdd7873bac1390',
  },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

for (const document of documents) {
  test(`${document.label} serves Mariana's exact PDF in source and public`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', document.relativePath));
    const published = fs.readFileSync(path.join(__dirname, '..', 'public', document.relativePath));

    assert.equal(source.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(source.subarray(-6).toString('ascii'), '%%EOF\n');
    assert.equal(sha256(source), document.sha256);
    assert.deepEqual(published, source);
  });
}

test('Perrun landing download links keep their routes and use the published PDF hashes', () => {
  for (const filename of ['perrun-landing-data.js', 'public/perrun-landing-data.js']) {
    const data = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    for (const document of documents) {
      const file = path.basename(document.relativePath);
      assert.match(data, new RegExp(`${file.replaceAll('.', '\\.')}\\?v=${document.sha256.slice(0, 12)}`));
    }
  }
});
