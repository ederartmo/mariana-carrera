# Checklist de Prueba - Flujo Completo

## 1️⃣ Registro (Auth)
- [ ] Ir a `auth.html?mode=register`
- [ ] Llenar formulario: email, contraseña, nombre, apellido, fecha nacimiento, teléfono
- [ ] Validar que marca campos obligatorios
- [ ] Enviar y esperar mensaje de confirmación
- [ ] ✅ Verificar: correo llega en bandeja

## 2️⃣ Verificación de Email
- [ ] Revisar bandeja de correo
- [ ] Hacer clic en enlace de confirmación (debe ir a `kinetichub.com.mx`, no a Codespace)
- [ ] ✅ Verificar: email_verified=true en Supabase

## 3️⃣ Login
- [ ] Ir a `auth.html?mode=login`
- [ ] Ingresar email y contraseña registrados
- [ ] ✅ Verificar: sesión activa, redirección a home o perfil

## 4️⃣ Llenar Perfil
- [ ] Ir a `perfil.html`
- [ ] ✅ Verificar: banner naranja "Tu perfil está incompleto..." visible
- [ ] Navegar a "Contacto de emergencia"
- [ ] Llenar: nombre, teléfono, relación de contacto
- [ ] Guardar
- [ ] ✅ Verificar: banner desaparece

## 5️⃣ Verificar Checklist en Home
- [ ] Ir a `index.html`
- [ ] ✅ Verificar: Tarjeta #2 "Completa tu perfil" ahora dice "Completado" con checkmark verde
- [ ] Avatar/sesión visible en header

## 6️⃣ Realizar Pago
- [ ] Hacer clic en "Realizar pago" en checklist (tarjeta #1)
- [ ] Ir a `checkout.html`
- [ ] Seleccionar etapa, categoría y talla
- [ ] Completar información de pago (usar tarjeta de prueba Stripe: 4242 4242 4242 4242)
- [ ] Enviar formulario
- [ ] ✅ Verificar: Stripe modal abre exitosamente

## 7️⃣ Página de Éxito
- [ ] Después de pago exitoso, debe redirigir a `success.html`
- [ ] ✅ Verificar: número de dorsal visible (o "Pendiente" si el bib aún no está asignado)
- [ ] ✅ Verificar: resumen de inscripción visible

## 8️⃣ Verificar Estado de Pago en Checklist
- [ ] Ir nuevamente a home (`index.html`)
- [ ] ✅ Verificar: Tarjeta #1 "Realiza tu pago" ahora dice "Completado" con checkmark verde
- [ ] ✅ Verificar: Botón cambia de "Realizar pago" a "Pago completado" (deshabilitado)

## 9️⃣ Admin Panel
- [ ] Ir a `admin-inscripciones.html`
- [ ] ✅ Verificar: Inscripción aparece en la tabla
- [ ] ✅ Verificar: Estado de pago = "paid"
- [ ] ✅ Verificar: Email = registrado
- [ ] Intentar exportar CSV
- [ ] ✅ Verificar: archivo descarga correctamente

## 🔟 Mobile Responsivo
- [ ] Abrir en iPhone/Android (o emular en Chrome DevTools)
- [ ] ✅ Verificar: navbar responsive
- [ ] ✅ Verificar: formularios accesibles
- [ ] ✅ Verificar: tablas admin scrollables
- [ ] ✅ Verificar: no hay overflow horizontal

---

## Variables de Ambiente Verificadas
- [ ] `SUPABASE_URL` en script.js apunta a `uycwzhlcnfijjyzkgkem.supabase.co`
- [ ] `SITE` en script.js es `https://www.kinetichub.com.mx` (no Codespace)
- [ ] Emails de confirmación salen desde Supabase con dominio correcto
- [ ] Stripe está en modo test (usar claves test, no production)

---

## Errores Comunes a Revisar
- ❌ Email de confirmación llega con URL de Codespace → revisar `SITE` en script.js
- ❌ Pago no procesa → revisar Stripe keys en checkout.js
- ❌ "403 auth" en perfil → revisar Row Level Security (RLS) en user_profiles
- ❌ Imágenes rotas → revisar que no haya PNG huérfanos (ya eliminados)
- ❌ JS/CSS cacheado viejo → forzar refresh (Ctrl+Shift+R) o verificar `__ASSET_VERSION__`

---

## Después de Todas las Pruebas
- [ ] Hacer commit final
- [ ] Hacer push a main
- [ ] Verificar deploy en Hostinger
- [ ] Hacer click en 5 links del sitio desde CDMX
- [ ] ✅ Listo para entrega
