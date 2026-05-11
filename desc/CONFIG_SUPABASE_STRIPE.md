# Guía de Configuración de Supabase y Stripe

## 🔐 Supabase Setup

### Tablas Requeridas

#### 1. `inscripciones`
```sql
CREATE TABLE inscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR NOT NULL,
  payment_status VARCHAR DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  bib_number VARCHAR,
  etapa VARCHAR,
  categoria VARCHAR,
  shirt_size VARCHAR,
  precio_etapa DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(email, etapa) -- Una inscripción por email y etapa
);
```

#### 2. `user_profiles`
```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name VARCHAR,
  last_name VARCHAR,
  email VARCHAR UNIQUE,
  birth_date DATE,
  phone VARCHAR,
  emergency_name VARCHAR,
  emergency_phone VARCHAR,
  emergency_relation VARCHAR,
  emergency_email VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 3. `etapas_eventos`
```sql
CREATE TABLE etapas_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR NOT NULL,
  fecha DATE NOT NULL,
  precio DECIMAL(10,2) NOT NULL,
  cupo INTEGER,
  inscritos INTEGER DEFAULT 0,
  activa BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Row Level Security (RLS)

**Para `user_profiles`:**
```sql
-- Permitir que usuarios vean su propio perfil
CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Permitir que usuarios actualicen su propio perfil
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Permitir insert para registro
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
```

**Para `inscripciones`:**
```sql
-- Permitir que solo admin lea
CREATE POLICY "Admin can read all inscriptions"
  ON inscripciones FOR SELECT
  USING (auth.role() = 'authenticated');
```

**Habilitar RLS en ambas tablas:**
```sql
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscripciones ENABLE ROW LEVEL SECURITY;
```

### Email Configuration

1. Ir a **Supabase Dashboard → Authentication → Email Templates**
2. Configurar:
   - **Confirmation URL**: `https://www.kinetichub.com.mx/auth.html?mode=confirm`
   - **Reset Password URL**: `https://www.kinetichub.com.mx/auth.html?mode=reset`
   - **Change Email URL**: `https://www.kinetichub.com.mx/auth.html?mode=change`
3. Usar **dominio personalizado** (no `@supabase.co`):
   - Settings → Email → Custom SMTP o verificar dominio

### Variables de Entorno (Backend)

En el servidor/API:
```bash
SUPABASE_URL=https://uycwzhlcnfijjyzkgkem.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... (obtener de Supabase Settings)
STRIPE_SECRET_KEY=sk_test_... (obtener de Stripe Dashboard)
STRIPE_WEBHOOK_SECRET=whsec_... (después de crear webhook)
```

---

## 💳 Stripe Setup

### 1. Crear Productos y Precios

**Dashboard → Products → Create**

Para cada etapa del evento:

```
Producto: "Axolote Night Run - Etapa 1"
  → Price (USD): $25.00
  → Type: One-time
  → Metadata:
    - etapa: "etapa_1"
    - categoria: "general"
```

Obtener el `price_id` para la API.

### 2. Configurar Webhook

**Dashboard → Developers → Webhooks → Create endpoint**

- **URL**: `https://www.kinetichub.com.mx/api/stripe-webhook.js`
- **Events to send**:
  - `checkout.session.completed`
  - `charge.failed`
  - `charge.refunded`

Obtener `Signing Secret` (whsec_...) para validar webhooks.

### 3. Test Cards

Para pruebas en modo test:

| Card | Descripción |
|------|-------------|
| `4242 4242 4242 4242` | Success (any future date, any CVC) |
| `4000 0000 0000 0002` | Requires authentication |
| `5555 5555 5555 4444` | Mastercard success |
| `2223 0031 2200 3222` | Requires authentication |
| `4000 0000 0000 0077` | Lost card |

- **Expiry**: 12/25 o cualquier futuro
- **CVC**: cualquier 3 dígitos

### 4. Variables Frontend

En `script.js` (está hardcodeada):
```javascript
// Buscar y actualizar si es necesario
const stripe = Stripe('pk_test_...'); // Usar publishable key test
```

---

## 🔄 Flujo de Pago

```
1. User llena checkout.html
   ↓
2. JavaScript POST /api/create-checkout-session con {email, shirtSize}
   ↓
3. Backend crea session Stripe, guarda en inscripciones (pending)
   ↓
4. Frontend redirige a Stripe Checkout
   ↓
5. User completa pago con tarjeta test
   ↓
6. Stripe envía webhook a /api/stripe-webhook.js
   ↓
7. Backend actualiza status='paid' en inscripciones
   ↓
8. Stripe redirige a success.html?session_id=...
```

---

## ✅ Verificación Preentrega

- [ ] RLS habilitado en ambas tablas
- [ ] Email templates con URLs correctas (kinetichub.com.mx, no Codespace)
- [ ] Stripe keys están en TEST mode
- [ ] Webhook configurado y funciona
- [ ] user_profiles RLS permite insert/update a usuarios autenticados
- [ ] inscripciones tabla existe con estructura correcta
- [ ] SUPABASE_URL = actual en script.js
- [ ] SITE variable en script.js = "https://www.kinetichub.com.mx"

---

## 🚨 Troubleshooting

### ❌ "Email sent from @supabase.co"
**Solución**: Configurar SMTP custom en Supabase el dominio kinetichub.com.mx

### ❌ "403 - JWT signature does not match"
**Solución**: Verificar que la KEY en script.js es la correcta (sb_publishable_...)

### ❌ "Error creating checkout session - 401"
**Solución**: Verificar `STRIPE_SECRET_KEY` en backend

### ❌ "Stripe.js not loaded"
**Solución**: Verificar que checkout.html hace `<script src="https://js.stripe.com/v3/"></script>`

### ❌ "RLS policy violation"
**Solución**: Ejecutar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` y revisar policies

---

## Para Deploy Final

1. **Cambiar Stripe a PRODUCTION** (si está listo)
   - Dashboard → Keys
   - Obtener `pk_live_...` y `sk_live_...`
   - Actualizar en script.js + backend

2. **Cambiar SITE a producción**
   - En script.js:SITE = "https://www.kinetichub.com.mx"

3. **Verificar RLS está ON**
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
   ```

4. **Probar flujo completo** con tarjeta test en producción
