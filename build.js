#!/usr/bin/env node
/**
 * Build script para minificación de CSS y JS
 * Uso: npm run build
 */

const fs = require('fs');
const path = require('path');

console.log('🔨 Iniciando build...\n');

// Función simple para minificar CSS
function minifyCSS(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remover comentarios
    .replace(/\s+/g, ' ') // Remover espacios en blanco múltiples
    .replace(/\s*([{}:;,>+~])\s*/g, '$1') // Remover espacios alrededor de selectores
    .trim();
}

// Función simple para minificar JS (básico)
function minifyJS(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remover comentarios block
    .replace(/\/\/.*$/gm, '') // Remover comentarios línea
    .replace(/\n\s*\n/g, '\n') // Remover líneas en blanco múltiples
    .replace(/\s+/g, ' ') // Normalizar espacios
    .replace(/\s*([{}()[\];:,=<>!&|?+\-%*/])\s*/g, '$1') // Remover espacios alrededor de operadores
    .trim();
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

console.log('📦 Build completado. Archivos listos en:');
console.log('   - styles.min.css');
console.log('   - script.min.js');
console.log('\n💡 Tip: Reemplaza los imports en HTML por las versiones minificadas en producción.');
