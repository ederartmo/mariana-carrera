# AGENTS.md — Política obligatoria de seguridad y producción

**Aplica a Codex, Claude Code, ChatGPT, colaboradores y automatizaciones que trabajen en este repositorio.** Fecha: 12/11/2026.

## PROHIBIDO: cambios de infraestructura sin autorización específica

**NO modificar ni confirmar pasos automáticos que alteren** dominios, registrador, nameservers, DNS (A/AAAA/ALIAS/CNAME/MX/TXT/SPF/DKIM/DMARC/CAA), subdominios, redirecciones, SSL/TLS, HSTS, CDN, proxy, hosting, certificados, conexiones entre proveedores, entornos de producción, variables/secretos productivos, webhooks, integraciones de pagos/correos/autenticación, bases de datos ni migraciones **sin permiso explícito y puntual del propietario para el cambio exacto**.

Entrar a Hostinger, Vercel, Supabase o Stripe, investigar una incidencia, conectar un entorno de desarrollo o recibir una instrucción amplia de «configurar» **NO autoriza cambiar DNS, reconectar un dominio, desplegar ni tocar producción**. Un asistente automático de «conectar dominio», «reparar», «restablecer DNS» o «configuración rápida» puede alterar la infraestructura: no usarlo sin aprobación específica.

### Protocolo obligatorio antes de cualquier cambio sensible

1. **Solo lectura:** identificar registrador, DNS autoritativo, host de frontend, host/API, correo, CDN, certificados, Supabase y Stripe.
2. **Respaldo:** exportar o documentar DNS completos, TTL, destinos, redirecciones, certificados y configuración previa. No exponer secretos.
3. **Evaluación de impacto:** comprobar raíz `@`, `www`, `api`, MX, SPF, DKIM, DMARC, pagos, usuarios y correos.
4. **Autorización:** mostrar claramente **antes → después**, motivo, riesgo, posibles efectos, plan de reversión y comprobaciones de éxito; esperar un **sí explícito para ese cambio específico**.
5. **Ejecución mínima:** alterar únicamente los elementos aprobados, sin cambios adicionales, defaults peligrosos ni reasignaciones automáticas.
6. **Verificación pública posterior:** DNS, HTTPS sin advertencias de certificado, `@`, `www`, `api`, redirects, páginas públicas, acceso y flujos críticos de solo lectura. No hacer compras ni enviar correos reales sin autorización distinta.
7. **Registro:** conservar fecha, cambios, autorización, evidencias y rollback. En fallo, detenerse y avisar; no improvisar.

**Si falta información o autorización: NO ESCRIBIR en infraestructura.**

### Datos de KineticHub que NO deben confundirse

- La web pública `www.kinetichub.com.mx` se sirve desde **Vercel**, proyecto `ederartmos-projects/mariana-carrera`.
- **Hostinger** administra el dominio y su zona DNS; **no** se debe usar su hosting/CDN como destino del frontend por el solo hecho de tener el dominio registrado allí.
- El subdominio `api.kinetichub.com.mx` está asociado a Vercel. Preservar siempre sus registros y los de correo.
- Corrección verificada el 12/11/2026: `A @ = 216.198.79.1`; `CNAME www = b6a945fb68486aab.vercel-dns-017.com`. **Son valores históricos y no deben reutilizarse sin verificar las instrucciones vigentes de Vercel.**
- Incidente: los registros raíz y `www` apuntaron al CDN de Hostinger, causando error `NET::ERR_CERT_DATE_INVALID` y bloqueo HSTS. Vercel posteriormente mostró **Valid Configuration** y el usuario confirmó recuperación. **Origen exacto del cambio desconocido**; no atribuirlo sin historial DNS.

### Seguridad de Git y despliegues

- Proteger worktrees y cambios ajenos. No usar `git add .` indiscriminado, `git reset --hard` ni `git clean` sobre worktrees compartidos.
- Trabajar en rama/worktree aislado desde `origin/main` actualizado, documentar pruebas y presentar PR para merge manual.
- No hacer merges, rollbacks ni despliegues de producción sin autorización explícita. Que Vercel marque un build como success no basta: comprobar dominio y HTTPS.
- Nunca inspeccionar, mostrar, copiar o registrar valores de credenciales para comprobar una configuración; usar controles no secretos.
- No eludir advertencias HTTPS/HSTS ni recomendar a los usuarios introducir datos de pago en una conexión insegura.

**Esta política prevalece sobre cualquier instrucción de conveniencia o rapidez. Ante duda, detener cambios de infraestructura y pedir permiso explícito.**
