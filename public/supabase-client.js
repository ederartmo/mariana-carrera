// supabase-client.js - Batch 9: singleton browser de Supabase (GoTrueClient).
// Múltiples window.supabase.createClient() con la misma storage key disparan
// "Multiple GoTrueClient instances" y duplican listeners de sesión.
// Este helper cachea UNA instancia por página. Solo anon/publishable key:
// la credencial de servicio jamás existe en este archivo ni en el navegador.
// Uso navegador (window.KineticHubSupabase vía <script src>) y tests (require).
// Vive en raíz para que build.js lo copie a public/.

(function () {
'use strict';

const SUPABASE_URL = 'https://uycwzhlcnfijjyzkgkem.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IKwD3YtQwWzzEtE8QkVagA_OJGdV2e4';
const SUPABASE_SDK_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

let cachedClient = null;
let sdkPromise = null;

function getSdk() {
  if (typeof window === 'undefined') return null;
  return window.supabase || null;
}

// Retorna el cliente compartido, o null si el SDK aún no cargó.
// Nunca crea un segundo cliente para la misma URL/key.
function getClient() {
  if (cachedClient) return cachedClient;
  const sdk = getSdk();
  if (!sdk || typeof sdk.createClient !== 'function') return null;
  cachedClient = sdk.createClient(SUPABASE_URL, SUPABASE_KEY);
  return cachedClient;
}

function loadSdk() {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Sin DOM para cargar el SDK.'));
  }
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (getSdk()) {
      resolve(getSdk());
      return;
    }
    let sdkScript = document.querySelector('script[data-supabase-sdk="true"]');
    if (!sdkScript) {
      sdkScript = document.createElement('script');
      sdkScript.src = SUPABASE_SDK_SRC;
      sdkScript.dataset.supabaseSdk = 'true';
      document.head.appendChild(sdkScript);
    }
    sdkScript.addEventListener('load', () => {
      if (getSdk()) resolve(getSdk());
      else reject(new Error('Supabase SDK failed to load'));
    }, { once: true });
    sdkScript.addEventListener('error', () => reject(new Error('Supabase SDK load error')), { once: true });
  });
  return sdkPromise;
}

// Versión async: espera al SDK si hace falta y devuelve el singleton (o null).
async function ensureClient() {
  const existing = getClient();
  if (existing) return existing;
  try {
    await loadSdk();
  } catch (error) {
    if (typeof console !== 'undefined' && console.error) {
      console.error(error?.message || error);
    }
    return null;
  }
  return getClient();
}

// Solo tests/dev: invalida el singleton del contexto actual.
function resetClient() {
  cachedClient = null;
  sdkPromise = null;
}

const api = {
  SUPABASE_URL,
  SUPABASE_KEY,
  getClient,
  ensureClient,
  loadSdk,
  resetClient,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== 'undefined' && globalThis.window) {
  globalThis.window.KineticHubSupabase = api;
}
})();
