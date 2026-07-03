#!/usr/bin/env node
/**
 * Build script para minificación de CSS y JS
 * Uso: npm run build
 */

const fs = require('fs');
const path = require('path');

console.log('🔨 Iniciando build...\n');

const OUTPUT_DIR = path.join(__dirname, 'public');
const ASSET_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  String(Date.now());
const STATIC_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.js',
  '.avif',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.ico',
  '.xml',
  '.txt',
  '.pdf',
  '.mp4',
  '.webm',
  '.mov',
]);
const EXCLUDED_ENTRIES = new Set([
  '.git',
  '.github',
  '.vercel',
  '.vscode',
  'api',
  'Archivo 2',
  'build.js',
  'desc',
  'node_modules',
  'public',
]);
const STATIC_DIRECTORIES = new Set([
  'videos',
]);

function prepareOutputDir() {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function replaceAssetVersion(content) {
  return content.replaceAll('__ASSET_VERSION__', ASSET_VERSION);
}

function copyStaticEntry(entryName) {
  if (EXCLUDED_ENTRIES.has(entryName)) {
    return false;
  }

  const sourcePath = path.join(__dirname, entryName);
  const targetPath = path.join(OUTPUT_DIR, entryName);
  const stats = fs.statSync(sourcePath);

  if (!stats.isFile()) {
    return false;
  }

  const extension = path.extname(entryName).toLowerCase();
  if (!STATIC_EXTENSIONS.has(extension)) {
    return false;
  }

  if (extension === '.html' || extension === '.css' || extension === '.js') {
    const content = fs.readFileSync(sourcePath, 'utf-8');
    fs.writeFileSync(targetPath, replaceAssetVersion(content), 'utf-8');
    return true;
  }

  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function copyStaticDirectory(entryName) {
  if (EXCLUDED_ENTRIES.has(entryName)) {
    return false;
  }

  if (!STATIC_DIRECTORIES.has(entryName)) {
    return false;
  }

  const sourcePath = path.join(__dirname, entryName);
  const targetPath = path.join(OUTPUT_DIR, entryName);
  const stats = fs.statSync(sourcePath);

  if (!stats.isDirectory()) {
    return false;
  }

  const copyAllowedFiles = (sourceDir, targetDir) => {
    fs.mkdirSync(targetDir, { recursive: true });

    fs.readdirSync(sourceDir).forEach((childName) => {
      const childSourcePath = path.join(sourceDir, childName);
      const childTargetPath = path.join(targetDir, childName);
      const childStats = fs.statSync(childSourcePath);

      if (childStats.isDirectory()) {
        copyAllowedFiles(childSourcePath, childTargetPath);
        return;
      }

      const extension = path.extname(childName).toLowerCase();
      if (STATIC_EXTENSIONS.has(extension)) {
        fs.copyFileSync(childSourcePath, childTargetPath);
      }
    });
  };

  copyAllowedFiles(sourcePath, targetPath);
  return true;
}

// Función simple para minificar CSS
function minifyCSS(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remover comentarios
    .replace(/\s+/g, ' ') // Remover espacios en blanco múltiples
    .replace(/\s*([{}:;,>+~])\s*/g, '$1') // Remover espacios alrededor de selectores
    .trim();
}

// Minificación JS deshabilitada: el enfoque previo rompía URLs y plantillas.
// Mantener el JS intacto evita regresiones funcionales en producción.
function minifyJS(content) {
  return content;
}

// Minificar CSS
const cssPath = path.join(__dirname, 'styles.css');
const cssMinPath = path.join(__dirname, 'styles.min.css');

if (fs.existsSync(cssPath)) {
  try {
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    const cssMinified = minifyCSS(cssContent);
    fs.writeFileSync(cssMinPath, cssMinified, 'utf-8');
    
    const originalSize = (cssContent.length / 1024).toFixed(2);
    const minifiedSize = (cssMinified.length / 1024).toFixed(2);
    const saved = ((1 - cssMinified.length / cssContent.length) * 100).toFixed(1);
    
    console.log(`✅ CSS minificado`);
    console.log(`   Original: ${originalSize} KB`);
    console.log(`   Minificado: ${minifiedSize} KB`);
    console.log(`   Ahorro: ${saved}%\n`);
  } catch (err) {
    console.error(`❌ Error minificando CSS:`, err.message);
  }
}

// Minificar JS
const jsPath = path.join(__dirname, 'script.js');
const jsMinPath = path.join(__dirname, 'script.min.js');

if (fs.existsSync(jsPath)) {
  try {
    const jsContent = fs.readFileSync(jsPath, 'utf-8');
    const jsMinified = minifyJS(jsContent);
    fs.writeFileSync(jsMinPath, jsMinified, 'utf-8');
    
    const originalSize = (jsContent.length / 1024).toFixed(2);
    const minifiedSize = (jsMinified.length / 1024).toFixed(2);
    const saved = ((1 - jsMinified.length / jsContent.length) * 100).toFixed(1);
    
    console.log(`✅ JS minificado`);
    console.log(`   Original: ${originalSize} KB`);
    console.log(`   Minificado: ${minifiedSize} KB`);
    console.log(`   Ahorro: ${saved}%\n`);
  } catch (err) {
    console.error(`❌ Error minificando JS:`, err.message);
  }
}

prepareOutputDir();

const copiedEntries = fs
  .readdirSync(__dirname)
  .filter(copyStaticEntry);

const copiedDirectories = fs
  .readdirSync(__dirname)
  .filter(copyStaticDirectory);

console.log(`🗂️  Archivos estáticos copiados a public: ${copiedEntries.length}`);
console.log(`📁 Carpetas estáticas copiadas a public: ${copiedDirectories.length}`);
console.log(`🏷️  Asset version: ${ASSET_VERSION}\n`);

console.log('📦 Build completado. Archivos listos en:');
console.log('   - styles.min.css');
console.log('   - script.min.js');
console.log('   - public/');
console.log('\n💡 Tip: Reemplaza los imports en HTML por las versiones minificadas en producción.');
