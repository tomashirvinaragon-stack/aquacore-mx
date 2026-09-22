# Envíos automáticos — Skydropx

La integración cotiza envíos nacionales antes del pago para pedidos menores a $5,000 MXN. En compras desde $5,000 MXN se conserva el envío gratis al cliente.

## Variables de entorno en Vercel

- `SKYDROPX_CLIENT_ID`
- `SKYDROPX_CLIENT_SECRET`
- `SKYDROPX_ORIGIN_TEMPLATE_ID`
- Opcional: `SKYDROPX_API_BASE_URL` (por defecto `https://api-pro.skydropx.com`)

Las credenciales se obtienen en Skydropx > Conexiones > API.

## Empaque por producto

Los datos se administran desde `/envios.html` usando la misma contraseña del panel administrativo.

Por producto se captura:

- Peso total del paquete en kg.
- Largo del paquete en cm.
- Ancho del paquete en cm.
- Alto del paquete en cm.
- Piezas que caben en ese empaque.

Los perfiles se guardan en la misma base de datos de AquaCore como registros internos y no aparecen en Pedidos ni en el Cubo de ventas.

## Flujo

1. Cliente agrega productos al carrito.
2. Si el subtotal es menor a $5,000 MXN, captura dirección, ciudad/municipio, estado, colonia y C.P.
3. AquaCore obtiene los perfiles de empaque configurados.
4. AquaCore consulta Skydropx.
5. Muestra transportista, servicio, días estimados y precio.
6. Cliente selecciona una tarifa.
7. Antes de cobrar, el backend vuelve a validar la tarifa.
8. El flete se agrega al total de Mercado Pago.
9. La venta guarda paquetería, servicio, tarifa y costo real del flete.

Si falta el perfil de empaque de un producto, AquaCore no cobra un flete inventado: muestra que falta configuración y mantiene el carrito intacto.
