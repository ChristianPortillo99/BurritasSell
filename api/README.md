# API Burrita

Backend REST inicial en Node.js y SQLite. Los montos se guardan en centavos y cada cambio de inventario conserva un movimiento auditable.

## Inicio

```powershell
$env:AUTH_SECRET="una-clave-larga-y-privada"
$env:SEED_ADMIN_PASSWORD="cambia-esta-clave"
npm run dev:api
```

En desarrollo se crea `admin@burrita.hn` / `burrita123` si no se configuran variables. No uses esos valores en producción.

## Rutas

- `POST /api/auth/login`
- `GET /api/me`
- `GET|POST /api/products`
- `GET|POST /api/points-of-sale`
- `GET|POST /api/users`
- `GET /api/inventory/:pointOfSaleId`
- `POST /api/inventory/adjustments`
- `GET|POST /api/sales`

Las rutas privadas reciben `Authorization: Bearer <token>`. Roles: `admin`, `manager` y `seller`.
