# Envíos automáticos — Skydropx

Esta rama agrega el flujo para cotizar envíos nacionales antes del pago.

## Variables de entorno en Vercel

- `SKYDROPX_CLIENT_ID`
- `SKYDROPX_CLIENT_SECRET`
- `SKYDROPX_ORIGIN_TEMPLATE_ID`
- Opcional: `SKYDROPX_API_BASE_URL` (por defecto `https://api-pro.skydropx.com`)

Las credenciales se obtienen en Skydropx > Conexiones > API.

## Datos por producto

`data/shipping-profiles.json` mantiene los datos de empaque separados del precio del catálogo.

Ejemplo:

```json
{
  "2": {
    "weight_kg": 0.55,
    "length_cm": 25,
    "width_cm": 25,
    "height_cm": 5,
    "units_per_parcel": 6
  }
}
```

- `weight_kg`: peso por unidad.
- `length_cm`, `width_cm`, `height_cm`: medidas del paquete.
- `units_per_parcel`: cuántas unidades de ese producto entran en ese empaque.

No se debe activar el cobro automático de flete para productos sin perfil real de empaque.

## Flujo esperado

1. Cliente captura destino.
2. AquaCore consulta Skydropx.
3. Muestra transportista, servicio, días y precio.
4. Cliente elige tarifa.
5. Backend vuelve a validar la tarifa antes de crear la orden de Mercado Pago.
6. En compras desde $5,000 MXN el envío sigue siendo gratis al cliente.
