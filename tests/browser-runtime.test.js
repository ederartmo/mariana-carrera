// tests/browser-runtime.test.js - Batch 9: singleton auth, flash, share-modal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('B9-01/02: helper retorna misma instancia sin recrear', () => {
  delete require.cache[require.resolve('../supabase-client')];
  const helper = require('../supabase-client');
  helper.resetClient();

  let createCalls = 0;
  globalThis.window = {
    supabase: {
      createClient: () => {
        createCalls += 1;
        return { auth: {} };
      },
    },
  };
  try {
    const first = helper.getClient();
    const second = helper.getClient();
    assert.ok(first, 'crea cliente con SDK presente');
    assert.equal(first, second, 'misma instancia');
    assert.equal(createCalls, 1, 'createClient una sola vez');
  } finally {
    delete globalThis.window;
    delete require.cache[require.resolve('../supabase-client')];
  }
});

test('B9-03: sin material service-role en helper browser', () => {
  const source = readSource('supabase-client.js');
  assert.ok(!source.includes('service_role'), 'sin service_role');
  assert.ok(!source.includes('SERVICE_ROLE'), 'sin SERVICE_ROLE');
  assert.ok(source.includes('sb_publishable_'), 'solo publishable key');
});

test('B9-04: script.js usa arquitectura compartida', () => {
  const script = readSource('script.js');
  assert.ok(!script.includes('window.supabase.createClient('), 'cero createClient directos');
  assert.ok(!script.includes('supabaseSdk.createClient('), 'cero createClient vía SDK');
  assert.ok(script.includes('getSharedSupabaseClient'), 'usa singleton compartido');
  assert.ok(script.includes('KineticHubSupabase'), 'integrado con helper');
});

test('B9-05/06: shell autenticado oculto + loader neutro inicial', () => {
  const html = readSource('perfil.html');
  assert.match(html, /<div class="profile-cover" id="profileCover" hidden>/);
  assert.match(html, /<div class="profile-layout" id="profileLayout" hidden>/);
  assert.match(html, /id="profileLoading"/);
  assert.match(html, /Cargando perfil/);
});

test('B9-07/08/09: reveal tras sesión, redirect y returnTo intactos', () => {
  const script = readSource('script.js');
  assert.ok(script.includes('revealAuthenticatedProfile()'), 'revela tras hidratar');
  assert.ok(script.includes('profileCover.hidden = false'), 'muestra cover');
  assert.ok(script.includes('profileLayout.hidden = false'), 'muestra layout');
  assert.ok(script.includes('profileLoading) profileLoading.hidden = true') || script.includes('profileLoading.hidden = true'), 'oculta loader');
  assert.ok(script.includes('window.location.replace("auth.html?mode=login")'), 'redirect sin sesión');
  assert.ok(script.includes('consumeReturnTarget'), 'returnTo preservado');
  assert.ok(script.includes('checkoutEmail'), 'flujo checkout preservado');
});

test('B9-10: avatar/cover siguen inicializados', () => {
  const script = readSource('script.js');
  assert.ok(script.includes('saveProfileMediaUrls'), 'persistencia avatar/cover');
  assert.ok(script.includes('uploadProfileMedia'), 'upload avatar/cover');
  assert.ok(script.includes('saveCoverPositionToTable'), 'posición cover');
});

test('B9-11: share-modal documentado como externo', () => {
  const doc = readSource('desc/batch9-runtime-audit.md');
  assert.ok(doc.includes('share-modal'), 'doc menciona el caso');
  assert.ok(doc.match(/EXTERNA/i), 'conclusión: externo');
  const script = readSource('script.js');
  assert.ok(!script.includes('share-modal'), 'código propio no lo referencia');
});

test('B9-13/14: helper copiable a public + funciones intactas', () => {
  assert.ok(fs.existsSync(path.join(projectRoot, 'supabase-client.js')), 'fuente en raíz');
  const build = readSource('build.js');
  assert.ok(build.includes('.js'), 'build copia js estáticos');
  const apiFiles = fs.readdirSync(path.join(projectRoot, 'api')).filter((f) => f.endsWith('.js'));
  assert.ok(apiFiles.length <= 12, `api/*.js = ${apiFiles.length}`);
});

test('B9-tags: helper cargado donde se usa Supabase browser', () => {
  for (const page of ['perfil.html', 'checkout.html', 'succes.html', 'admin-inscripciones.html', 'index.html', 'auth.html']) {
    const html = readSource(page);
    assert.match(html, /<script src="supabase-client\.js\?v=__ASSET_VERSION__"><\/script>/, page);
  }
});

test('B9-flash-1: body inicia en estado loading explícito', () => {
  const html = readSource('perfil.html');
  assert.match(html, /<body class="profile-page profile-is-loading"/);
  assert.match(html, /id="profileLoading"/);
});

test('B9-flash-2: CSS fail-closed con display:none !important', () => {
  const css = readSource('styles.css');
  assert.ok(css.includes('.profile-is-loading #profileCover'), 'cubre cover');
  assert.ok(css.includes('.profile-is-loading #profileLayout'), 'cubre layout');
  const start = css.indexOf('.profile-is-loading #profileCover');
  assert.ok(css.slice(start, start + 300).includes('display: none !important'), '!important presente');
});

test('B9-flash-3: sin placeholders falsos de identidad', () => {
  const html = readSource('perfil.html');
  const identBlock = html.slice(html.indexOf('profile-ident-info'), html.indexOf('profile-ident-info') + 600);
  assert.ok(!identBlock.includes('Nombre de usuario'), 'sin nombre falso');
  assert.ok(!identBlock.includes('correo@ejemplo.com'), 'sin email falso');
  assert.ok(!identBlock.includes('55 0000 0000'), 'sin teléfono falso');
});

test('B9-flash-4/5: reveal tras hidratación avatar/cover y setReadOnlyMode', () => {
  const script = readSource('script.js');
  const revealCall = 'revealAuthenticatedProfile();';
  assert.equal(script.split(revealCall).length - 1, 1, 'un solo reveal');
  const revealPos = script.indexOf(revealCall);
  assert.ok(script.indexOf('applyAvatarVisual(currentProfile.avatar_url)') !== -1, 'hidrata avatar');
  assert.ok(script.indexOf('applyCoverVisual(currentProfile.cover_url)') !== -1, 'hidrata cover');
  const readonlyIdx = script.search(/setReadOnlyMode\(currentProfile\);\s+\/\/ Batch 9 hotfix/);
  assert.ok(readonlyIdx !== -1 && readonlyIdx < revealPos, 'reveal después de setReadOnlyMode');
});

test('B9-flash-6: redirect sin sesión jamás revela shell', () => {
  const script = readSource('script.js');
  assert.ok(script.includes('window.location.replace("auth.html?mode=login")'), 'redirect intacto');
  assert.ok(script.includes("No pudimos cargar tu perfil"), 'error neutro sin exponer shell');
});

test('B9-flash-7: carreras cargan async con estado propio', () => {
  const script = readSource('script.js');
  assert.ok(script.includes('Cargando tus carreras'), 'estado de carga propio');
  assert.ok(script.includes('loadUserInscriptions()'), 'carga async preservada');
});
