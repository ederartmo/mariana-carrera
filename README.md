# Kinetic Hub - Plataforma de Eventos Deportivos

Sitio web completo de Kinetic Hub para gestión de eventos deportivos nocturnos, con autenticación de usuarios, inscripciones pagadas, perfiles de corredores y dashboard administrativo.

## Características principales

- **Autenticación**: Registro, login y verificación de email con Supabase
- **Inscripciones**: Sistema de pagos con Stripe por etapas y categorías
- **Perfiles de usuario**: Datos personales, contacto de emergencia, histórico de eventos
- **Eventos**: Detalles completos, requerimientos, resultados y fotos
- **Blog**: Contenido educativo sobre entrenamiento y nutrición
- **Admin**: Panel para gestionar inscripciones y exportar datos
- **Responsive**: Diseño mobile-first, funcional en todos los dispositivos

## Stack tecnológico

- **Frontend**: HTML5, CSS3, JavaScript vanilla (sin frameworks)
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **Pagos**: Stripe
- **Hosting**: Hosting estático con FTP

## Páginas principales

| Página | Ruta | Descripción |
|--------|------|-------------|
| Home | `index.html` | Landing con checklist de participante |
| Eventos | `eventos.html` | Catálogo de eventos |
| Evento detalle | `evento.html` | Info completa + inscripción |
| Blog | `blog.html` | Artículos y contenido |
| Nosotros | `nosotros.html` | Sobre Kinetic Hub |
| Contacto | `contacto.html` | Formulario de contacto |
| Auth | `auth.html` | Login y registro |
| Perfil | `perfil.html` | Dashboard de usuario |
| Checkout | `checkout.html` | Carrito y pago |
| Admin | `admin-inscripciones.html` | Panel administrativo |

## Instalación y desarrollo

Clonar el repositorio:
```bash
git clone https://github.com/ederartmo/mariana-carrera.git
cd mariana-carrera
```

Servir localmente (cualquier servidor HTTP):
```bash
# Python 3
python -m http.server 8000

# Node.js
npx http-server
```

Luego abrir `http://localhost:8000`

## Configuración de producción

### Variables de ambiente (cliente)
Actualizar en `script.js`:
- `SUPABASE_URL`: URL del proyecto Supabase
- `SUPABASE_KEY`: API key público de Supabase
- `SITE`: Dominio de producción (kinetichub.com.mx)

### Supabase
1. Crear tablas: `inscripciones`, `user_profiles`, `etapas_eventos`
2. Configurar Auth emails con dominio personalizado
3. Habilitar RLS (Row Level Security)

### Stripe
1. Obtener keys públicas y secretas
2. Configurar webhooks en `api/stripe-webhook.js`
3. Crear productos y prices en dashboard de Stripe

### Deploy
Usar GitHub Actions para:
- Transpilación automática (si es necesario)
- Versionado de assets con `__ASSET_VERSION__`
- Deploy por FTP a Hostinger

## Estructura de archivos

```
/
├── index.html              # Landing principal
├── auth.html              # Autenticación
├── perfil.html            # Perfil de usuario
├── checkout.html          # Checkout
├── admin-inscripciones.html # Admin panel
├── script.js              # Lógica global (~166KB)
├── styles.css             # Estilos (~135KB)
├── api/
│   ├── create-checkout-session.js
│   └── stripe-webhook.js
├── desc/                  # Documentación interna
└── *.html                 # Páginas estáticas
```

## Optimizaciones

- Imágenes en formato `.avif` y `.webp` con fallback `.png`/`.jpg`
- Assets versionados para cache busting
- JavaScript modular y reutilizable
- CSS con variables personalizadas
- Lazy loading de imágenes

## Testing

- **Manual**: Flujo completo (registro → verificación → perfil → pago → success)
- **Mobile**: Verificar en iPhone y Android
- **Browsers**: Chrome, Firefox, Safari, Edge

## Notas de entrega

- ✅ Autenticación funcional con Supabase
- ✅ Pagos integrados con Stripe
- ✅ Contacto de emergencia como requerimiento crítico
- ✅ Perfil con validaciones
- ✅ Email de confirmación con URL de producción
- ✅ Admin panel para gestión

## Licencia

© 2026 Kinetic Hub - Todos los derechos reservados