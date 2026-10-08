# Incadea — estructura usada por el Sistema de Bonos

Capa de solo lectura. No escribe en el DMS. `mssql` se carga únicamente cuando `INCADEA_DB_*` está configurado y se ejecuta una consulta.

## Tablas y columnas (hipótesis NAV)

El prefijo de empresa va entre corchetes: `[Vecsa Hidalgo$Vehicle]`.

| Tabla | Uso |
|---|---|
| `Vehicle` | Unidad: VIN, modelo, grupo de inventario, estatus |
| `Vehicle Ledger Entry` | Movimientos de compra y venta, fecha, costo, venta vigente |

| Columna | Para qué |
|---|---|
| `VIN`, `No_`, `Model No_`, `Model` | Identidad y patrón BEV |
| `Inventory Posting Group` | Demo (`VD*`), usado (`VU*`) y marca (3.ª letra B/M/T) |
| `Vehicle Status` | 0 nuevo, 1 usado, 2 demo, 3 vendido, 5 evento |
| `Entry Type` | 0 compra, 2 venta |
| `Posting Date` | Fecha de venta o de compra. `1753-01-01` se trata como vacía |
| `Total Cost` | Aproximación al Precio Wholesale de la compra vigente |
| `Current Sales Ledger Entry` | `1` marca la venta vigente |
| `Vehicle No_` | Liga el movimiento con la unidad |

Los nombres viven en `backend/data/private/incadea-mapeo.json` (plantilla: `incadea-mapeo.example.json`).

## Qué sí arma el resumen

`GET /api/bonos/incadea/resumen?trimestre=` junta:

1. Retail de Incadea, por mes, contra la carta de objetivos.
2. Inventario al corte: antigüedad ≥120 días con `floor(((antiguos − bloqueo) / total) × 100)`.
3. Clasificación de unidades: VIN manual → grupo → estatus → nuevo.
4. Captura manual de VoC, entrenamiento, mercadotecnia, Retail Standards, penalizaciones, topes y patio VDC.
5. El motor de bonos. La respuesta trae `advertencias` y `montoEstimado`.

`GET /api/bonos/incadea/estado` solo dice si hay conexión y qué archivos privados existen. No consulta la base.

`GET /api/bonos/incadea/validacion/estatus` cuenta estatus × grupo de inventario para calibrar el mapeo.

## Qué Incadea no identifica

| Dato | Resolución |
|---|---|
| Loaner, Top Management, Tactic, empleado, flotilla | VIN en `unidades-especiales.json` |
| Fecha de reporte o entrega en DCS | Se usa la fecha de venta de Incadea |
| Unidades ≥90 días en VDC y bloqueo de suministro | Captura manual; si falta el patio se asume 0 |
| VoC, entrenamiento, mercadotecnia, Retail Standards, CBS, línea de crédito | `bonos-captura-2026.json` |

`Type of Vehicle Use` solo trae usos legales (taxi, rental, privado). No distingue Demo, Loaner, Top ni Tactic.

## Hipótesis por validar

| # | Hipótesis | Cómo validar | Confianza |
|---|---|---|---|
| 1 | `Entry Type` 0 = compra, 2 = venta | Ventas por mes contra un Retail conocido | Media |
| 2 | `Vehicle Status` 0/1/2/3/5 | `/api/bonos/incadea/validacion/estatus` | Media |
| 3 | Grupos `VD*` demo, `VU*` usado; 3.ª letra B/M/T | La misma consulta | Media |
| 4 | `Current Sales Ledger Entry = 1` es la venta vigente | VIN con más de una venta vigente | Media |
| 5 | `Total Cost` de la compra vigente ≈ Precio Wholesale | 5 VIN contra su factura BMW | Baja |
| 6 | Fecha vacía = 1753-01-01 | Ya resuelto en `fechaNav` | Alta |

## Flujo

```
incadea-mapeo + objetivos + captura + unidades especiales
        ↓
consultas SELECT (retail, inventario, demos)
        ↓
transform.js
        ↓
bonosEngine
        ↓
resumen + advertencias + montoEstimado
```

La página `/bonos.html` sigue leyendo la captura manual. Conectar esa página a `/api/bonos/incadea/resumen` queda pendiente.

## Pendiente

- Crear los JSON reales en `backend/data/private/` y un usuario SQL de solo lectura.
- Calibrar estatus, grupos, base de pago y el patrón BEV (`bev.regexModelo`).
- Carta de objetivos del T4 y el listado real de VIN Loaner / Top / Tactic.
- Confirmar si MINI y Motorrad tienen documento de bonos propio.
