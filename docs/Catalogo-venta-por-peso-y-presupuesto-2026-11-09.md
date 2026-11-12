# Contrato comercial: venta por unidad, presupuesto y peso

**Fecha:** 2026-11-09
**Estado:** implementado localmente; pendiente de cargar contratos comerciales verificados en cada catálogo de tienda.

## Propósito

VIA separa tres modalidades de venta. La interpretación de lenguaje es responsabilidad de DeepSeek; la cotización, existencia y cálculo son responsabilidades exactas del catálogo y del runtime.

| Modalidad | Configuración de catálogo | Ejemplo del cliente | Resultado operativo |
| --- | --- | --- | --- |
| Unidad/presentación cerrada | Valor por defecto | `dos Chocoramos` | Cantidad × precio de la referencia. |
| Presupuesto | `permite_venta_por_valor=TRUE` | `$5.000 de limón` | Conserva el presupuesto; no lo convierte a gramos ni inventa unidades. |
| Peso/fraccionado | `atributos_json.commerce` completo | `media libra de queso` | Convierte la medida a gramos, valida inventario en gramos y calcula con precio por kilo. |

Una presentación que incluya gramos (`Queso Colanta 250 g`) sigue siendo una referencia cerrada salvo que tenga explícitamente el contrato de venta por peso. No se habilita automáticamente por categoría, nombre ni presentación.

## Contrato para venta por peso

En la columna `atributos_json` de la fila del SKU debe declararse:

```json
{
  "commerce": {
    "saleModes": ["weight"],
    "weight": {
      "pricePerKg": 43200,
      "stockGrams": 12000,
      "minGrams": 50,
      "incrementGrams": 50
    }
  }
}
```

- `pricePerKg`: precio COP por kilogramo.
- `stockGrams`: inventario disponible en gramos.
- `minGrams`: venta mínima permitida.
- `incrementGrams`: granularidad operativa de venta.

El importador rechaza un catálogo que declare `saleModes:["weight"]` sin esos cuatro valores. Esto evita que un pedido se cotice con inventario de unidades o con precios de una presentación cerrada.

Las equivalencias son aritmética posterior a la interpretación semántica: 1 libra = 500 g, media libra = 250 g, 1 kg = 1.000 g y una arroba = 12.500 g. DeepSeek conserva la solicitud estructurada; no decide el precio ni el inventario.

## Auditoría de producción

La tienda Demo usa la hoja histórica `1QpR44qdL4EEpLgIPEZwoTLb43hnGjWVUObAsK3PfAZc`. La cuenta de Drive conectada a este entorno no tiene permiso de lectura sobre ella (`403`), por lo que no es seguro editarla desde aquí.

La interfaz de producción confirma que Demo De Tienda tiene un catálogo operativo de **2.000 productos** (versión `6e93b66411cb7383c8d2`, sincronizada el 09 de noviembre de 2026). Sin embargo, la referencia del archivo no se expone a esta sesión y no puede sustituir la validación comercial de cada SKU.

La hoja accesible usada como referencia contiene referencias cerradas y no trae precios por kilogramo ni inventarios en gramos. Ejemplos como queso Colanta 250 g o jamón tajado no pueden ser reclasificados automáticamente como productos a granel.

Por tanto, no se hizo una actualización masiva de categorías. Antes de activar cada SKU de producción se deben verificar con el tendero estas cuatro cifras y confirmar que efectivamente se vende al corte/peso:

1. precio vigente por kg;
2. existencia disponible en g;
3. mínimo de venta;
4. incremento de pesaje.

## Candidatos a revisión humana por tipo de negocio

Estas categorías son candidatas, no una autorización automática:

- charcutería al corte: quesos, jamón, salchichón, mortadela;
- carnes y proteínas al peso: res, cerdo, pollo, pescado;
- plaza: frutas, verduras, hortalizas, tubérculos y legumbres;
- otros graneles que el tendero confirme como fraccionables.

Las bebidas, paquetes, lácteos empacados, panes de marca y demás referencias cerradas permanecen por unidad/presentación. Un cliente que solicite una cantidad fraccionada de una de ellas debe recibir alternativas empacadas o una validación comercial, nunca una conversión ficticia.

### Resultado de la revisión del catálogo demo de 2.000 referencias

La fuente local equivalente contiene candidatos por categoría —242 de granos y básicos, 130 de carnes y congelados, 109 de carnes frías, 90 de frutas y 120 de verduras—, pero sus filas representan presentaciones cerradas o variantes de empaque. Por ejemplo, hay jamón tajado de 230 g, salchicha en lata de 150 g y paquetes de fruta de 500 g/1 kg; no hay una señal que confirme que su inventario se administre a granel.

Por ello esos conteos son una **lista de revisión comercial**, no una activación automática. En particular, una fila de `500 g` con `stock: 50` puede significar 50 paquetes cerrados y no 25 kg disponibles al corte. Activarla como peso sin confirmar ese significado duplicaría o falsearía el inventario.

## Activación por tenant

1. El tendero actualiza `atributos_json` para los SKU que realmente vende por peso.
2. VIA valida e importa/sincroniza el catálogo del tenant.
3. La sincronización de catálogo reconstruye los índices vectoriales y de grafo del tenant con los atributos actuales.
4. VIA registra el modo `weight` en la línea del pedido y mantiene el precio por kg e inventario en gramos como evidencia de la cotización.

Esto mantiene aislados catálogo, precios e inventarios de cada tenant.
