export const colombiaAgentScenarioSet = [
  {
    id: 'pedido_claro_con_cliente_conocido',
    level: 'usuario_sabe_lo_que_quiere',
    customer: 'known',
    text: 'Buenas, me regala 3 chocorramos y 2 cifrut de granadilla para domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: [],
      replyIncludes: ['3 x Chocoramo', '2 x Cifrut granadilla', 'Confirmas el pedido'],
      orderItems: ['Chocoramo', 'Cifrut granadilla'],
    },
  },
  {
    id: 'pedido_claro_con_cantidad_faltante',
    level: 'usuario_sabe_parcialmente',
    customer: 'known',
    text: 'Hola veci, me regala porfa 3 chocorramos y cifrut de granadilla para domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: ['quantity:Cifrut granadilla'],
      replyIncludes: ['cantidad de Cifrut granadilla'],
      orderItems: ['Chocoramo', 'Cifrut granadilla'],
    },
  },
  {
    id: 'cliente_nuevo_domicilio_pide_nombre_direccion',
    level: 'cliente_nuevo',
    customer: 'new',
    text: 'Me regalas 2 arepas pa domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: ['customer_name', 'delivery_address'],
      replyIncludes: ['tu nombre', 'direccion del domicilio'],
      orderItems: ['Arepa boyacense'],
    },
  },
  {
    id: 'cliente_nuevo_completa_datos',
    level: 'flujo_guiado',
    customer: 'new',
    steps: [
      {
        text: 'Me regalas 2 arepas pa domicilio',
        expect: {
          intent: 'delivery_order',
          missingFields: ['customer_name', 'delivery_address'],
          replyIncludes: ['tu nombre', 'direccion del domicilio'],
        },
      },
      {
        text: 'Soy Laura Gomez, direccion Carrera 7 # 20-10',
        expect: {
          intent: 'order_clarification',
          missingFields: [],
          replyIncludes: ['2 x Arepa boyacense', 'Subtotal', 'Confirmas el pedido'],
          savedProfile: { name: 'Laura Gomez', defaultAddress: 'Carrera 7 # 20-10' },
        },
      },
    ],
  },
  {
    id: 'disponibilidad_producto_premium',
    level: 'consulta_producto',
    customer: 'known',
    text: 'Para un domicilio, tienes cafe tostado premium?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Cafe premium tostado 250g', 'Stock actual', 'Cuantas unidades'],
    },
  },
  {
    id: 'consulta_cafe_generica_infiere_similares',
    level: 'consulta_producto_ambigua',
    customer: 'known',
    text: 'Parce, manejan cafe bueno para llevar?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Cafe premium tostado 250g', 'Cafe molido tradicional 500g'],
    },
  },
  {
    id: 'categoria_jugos',
    level: 'agente_guia_catalogo',
    customer: 'known',
    text: 'Veci, que jugos tiene pa mandar a domicilio?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Cifrut granadilla', 'Jugo Hit mango', 'Cual quieres y cuantas unidades'],
    },
  },
  {
    id: 'categoria_algo_para_la_sed',
    level: 'agente_guia_catalogo',
    customer: 'known',
    text: 'Parce, algo pa la sed, que recomienda?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Cifrut granadilla', 'Agua Cristal sin gas 600ml'],
    },
  },
  {
    id: 'categoria_mecato_onces',
    level: 'agente_guia_catalogo',
    customer: 'known',
    text: 'Veci, me colabora con mecato pa las onces',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Chocoramo', 'Papas Margarita limon', 'Galletas Festival chocolate'],
    },
  },
  {
    id: 'categoria_mercado',
    level: 'agente_guia_catalogo',
    customer: 'known',
    text: 'Que tiene para mercado? necesito arroz, aceite o huevos',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Arroz Diana 500g', 'Aceite Premier 500ml', 'Huevos AA x12'],
    },
  },
  {
    id: 'categoria_aseo',
    level: 'agente_guia_catalogo',
    customer: 'known',
    text: 'Tiene algo de aseo? papel y jabon de pronto',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Jabon Rey barra', 'Papel higienico Familia x4', 'Shampoo Savital sachet'],
    },
  },
  {
    id: 'categoria_onces_panaderia',
    level: 'agente_guia_catalogo',
    customer: 'known',
    text: 'Que tiene pa las onces?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Arepa boyacense', 'Pan tajado Bimbo'],
    },
  },
  {
    id: 'consulta_combo_jamon_queso_pan_parcial',
    level: 'agente_guia_catalogo_parcial',
    customer: 'known',
    text: 'ven estoy pensando en comprar algo para comer algo jamon y queso y pan, tiene?',
    expect: {
      intent: 'catalog_query',
      summary: 'Catalog guided options sent',
      replyIncludes: ['Queso campesino 250g', 'Pan tajado Bimbo', 'No encontre en el catalogo actual: jamon'],
    },
  },
  {
    id: 'indeciso_antojo_dulce',
    level: 'usuario_no_sabe_que_pedir',
    customer: 'known',
    text: 'Veci no se que pedir, tengo antojo de algo dulce, que me recomienda?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Chocoramo', 'Galletas Festival chocolate', 'Cual quieres que te cotice'],
    },
  },
  {
    id: 'indeciso_desayuno_rapido',
    level: 'usuario_no_sabe_que_pedir',
    customer: 'known',
    text: 'Buenos dias, tiene algo para desayuno rapido?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Arepa boyacense', 'Pan tajado Bimbo', 'Cual quieres que te cotice'],
    },
  },
  {
    id: 'indeciso_algo_frio_para_tomar',
    level: 'usuario_no_sabe_que_pedir',
    customer: 'known',
    text: 'Hace calor, que tiene frio para tomar?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Cifrut granadilla', 'Agua Cristal sin gas 600ml', 'Coca-Cola 400ml'],
    },
  },
  {
    id: 'indeciso_presupuesto_bajo',
    level: 'usuario_no_sabe_que_pedir',
    customer: 'known',
    text: 'Tengo cinco mil pesos, que me recomienda para comer algo barato?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Chocoramo', 'Galletas Festival chocolate', 'Cual quieres que te cotice'],
    },
  },
  {
    id: 'producto_impreciso_gaseosa',
    level: 'no_sabe_datos_exactos_producto',
    customer: 'known',
    text: 'Veci, tiene gaseosa pequena?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Coca-Cola 400ml', 'Quieres que te cotice una cantidad'],
    },
  },
  {
    id: 'producto_impreciso_leche_bolsa',
    level: 'no_sabe_datos_exactos_producto',
    customer: 'known',
    text: 'Me confirma si hay leche, de pronto la de bolsa?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Leche Alqueria entera 1L', 'Queso campesino 250g'],
    },
  },
  {
    id: 'producto_impreciso_papel_bano',
    level: 'no_sabe_datos_exactos_producto',
    customer: 'known',
    text: 'Hay papel para el bano?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Papel higienico Familia x4', 'Shampoo Savital sachet'],
    },
  },
  {
    id: 'producto_impreciso_jabon_ropa',
    level: 'no_sabe_datos_exactos_producto',
    customer: 'known',
    text: 'Me colabora con jabon para lavar ropa',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Jabon Rey barra', 'Papel higienico Familia x4'],
    },
  },
  {
    id: 'mercado_basico_con_lista_parcial',
    level: 'usuario_lista_productos',
    customer: 'known',
    text: 'Buenas, necesito armar mercadito: arroz, aceite y leche entera, que tiene?',
    expect: {
      intent: 'catalog_query',
      summary: 'Catalog guided options sent',
      replyIncludes: ['Arroz Diana 500g', 'Aceite Premier 500ml', 'Leche Alqueria entera 1L'],
    },
  },
  {
    id: 'pedido_claro_aseo_domicilio',
    level: 'usuario_sabe_lo_que_quiere',
    customer: 'known',
    text: 'Me manda 1 papel higienico y 2 jabon rey para domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: [],
      replyIncludes: ['1 x Papel higienico Familia x4', '2 x Jabon Rey barra', 'Confirmas el pedido'],
      orderItems: ['Papel higienico Familia x4', 'Jabon Rey barra'],
    },
  },
  {
    id: 'pedido_claro_sin_domicilio',
    level: 'usuario_sabe_lo_que_quiere',
    customer: 'known',
    text: 'Me regala 1 yogurt alpina fresa y 1 galletas festival chocolate',
    expect: {
      intent: 'delivery_order',
      missingFields: [],
      replyIncludes: ['1 x Yogurt Alpina fresa', '1 x Galletas Festival chocolate', 'Subtotal'],
      orderItems: ['Yogurt Alpina fresa', 'Galletas Festival chocolate'],
    },
  },
  {
    id: 'producto_impreciso_savital_sobre',
    level: 'no_sabe_datos_exactos_producto',
    customer: 'known',
    text: 'Tiene savital en sobrecito?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Shampoo Savital sachet', 'Stock actual'],
    },
  },
  {
    id: 'consulta_precio_chocoramo',
    level: 'consulta_producto',
    customer: 'known',
    text: 'A como tiene el chocoramo?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Chocoramo', '$', 'Quieres que te cotice una cantidad'],
    },
  },
  {
    id: 'indeciso_lonchera_nino',
    level: 'usuario_no_sabe_que_pedir',
    customer: 'known',
    text: 'Que me recomienda para lonchera de un nino?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Chocoramo', 'Galletas Festival chocolate'],
    },
  },
  {
    id: 'producto_no_catalogado_atun',
    level: 'producto_no_disponible',
    customer: 'known',
    text: 'Veci, tiene atun?',
    expect: {
      intent: 'catalog_query',
      summary: 'Catalog search needs review',
      replyIncludes: ['No encontre una coincidencia clara'],
    },
  },
  {
    id: 'cliente_nuevo_coca_domicilio',
    level: 'cliente_nuevo',
    customer: 'new',
    extraProducts: [
      {
        sku: 'AND-COC-1500',
        name: 'Coca-Cola 1.5L',
        aliases: ['coca cola', 'cocacola', 'gaseosa coca cola', 'coca cola familiar', 'gaseosa familiar'],
        price: 6800,
        stock: 12,
        category: 'bebidas',
        driveFileId: 'drv-and-coc-1500',
      },
    ],
    text: 'Me regala 1 coca cola para domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: ['customer_name', 'delivery_address', 'presentation:coca cola'],
      replyIncludes: ['tu nombre', 'direccion del domicilio', 'Pediste coca cola', 'Coca-Cola 400ml', 'Coca-Cola 1.5L'],
      orderItems: ['Coca-Cola 400ml'],
    },
  },
  {
    id: 'pedido_confirmado_dale_hagale',
    level: 'flujo_completo',
    customer: 'known',
    steps: [
      {
        text: 'Me regala 1 agua cristal para domicilio',
        expect: {
          intent: 'delivery_order',
          missingFields: [],
          replyIncludes: ['1 x Agua Cristal sin gas 600ml', 'Confirmas el pedido'],
        },
      },
      {
        text: 'Pago en efectivo',
        expect: {
          intent: 'order_clarification',
          missingFields: [],
          paymentMethod: 'cash',
          replyIncludes: ['Confirmas el pedido'],
        },
      },
      {
        text: 'Dale, hagale',
        expect: {
          intent: 'order_confirmation',
          summary: 'Confirmed order registered and handed off',
          replyIncludes: ['Pedido confirmado y registrado', 'Referencia:'],
          orderId: true,
        },
      },
    ],
  },
  {
    id: 'consulta_tintico_cafe',
    level: 'consulta_producto_ambigua',
    customer: 'known',
    text: 'Estoy antojado de un tintico, que cafe tiene?',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Cafe premium tostado 250g', 'Cafe molido tradicional 500g'],
    },
  },
  {
    id: 'pedido_claro_despensa_domicilio',
    level: 'usuario_sabe_lo_que_quiere',
    customer: 'known',
    text: 'Me manda 1 arroz diana, 1 aceite premier y 1 huevos aa x12 para domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: [],
      replyIncludes: ['1 x Arroz Diana 500g', '1 x Aceite Premier 500ml', '1 x Huevos AA x12', 'Confirmas el pedido'],
      orderItems: ['Arroz Diana 500g', 'Aceite Premier 500ml', 'Huevos AA x12'],
    },
  },
  {
    id: 'pedido_con_typos_colombianos',
    level: 'tolerancia_lenguaje_natural',
    customer: 'known',
    text: 'Me regala 2 chocramos y 1 cifru granadila',
    expect: {
      intent: 'delivery_order',
      missingFields: [],
      replyIncludes: ['2 x Chocoramo', '1 x Cifrut granadilla', 'Subtotal'],
      orderItems: ['Chocoramo', 'Cifrut granadilla'],
    },
  },
  {
    id: 'pedido_sin_cantidades_debe_preguntar',
    level: 'usuario_sabe_parcialmente',
    customer: 'known',
    text: 'Me manda chocoramo y agua cristal para domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: ['quantity:Chocoramo', 'quantity:Agua Cristal sin gas 600ml'],
      replyIncludes: ['cantidad de Chocoramo', 'cantidad de Agua Cristal sin gas 600ml'],
      orderItems: ['Chocoramo', 'Agua Cristal sin gas 600ml'],
    },
  },
  {
    id: 'pedido_despensa_sin_cantidades',
    level: 'usuario_lista_productos',
    customer: 'known',
    text: 'Necesito arroz, aceite y huevos',
    expect: {
      intent: 'delivery_order',
      missingFields: ['quantity:Arroz Diana 500g', 'quantity:Aceite Premier 500ml', 'quantity:Huevos AA x12'],
      replyIncludes: ['cantidad de Arroz Diana 500g', 'cantidad de Aceite Premier 500ml', 'cantidad de Huevos AA x12'],
      orderItems: ['Arroz Diana 500g', 'Aceite Premier 500ml', 'Huevos AA x12'],
    },
  },
  {
    id: 'consulta_lacteos',
    level: 'agente_guia_catalogo',
    customer: 'known',
    text: 'Que lacteos maneja? leche o queso',
    expect: {
      intent: 'catalog_query',
      replyIncludes: ['Leche Alqueria entera 1L', 'Queso campesino 250g', 'Yogurt Alpina fresa'],
    },
  },
  {
    id: 'descuento_escala_aprobacion',
    level: 'politica_comercial',
    customer: 'known',
    text: 'Me hace una rebajita si llevo varias cosas?',
    expect: {
      intent: 'discount_request',
      summary: 'Discount approval requested',
      replyIncludes: ['validando el descuento'],
    },
  },
  {
    id: 'pago_requiere_aprobacion',
    level: 'operacion_sensible',
    customer: 'known',
    text: 'Ya hice la transferencia y te mando comprobante',
    expect: {
      intent: 'payment_confirmation',
      summary: 'Payment write approval requested',
    },
  },
  {
    id: 'pide_humano',
    level: 'escalamiento',
    customer: 'known',
    text: 'Quiero hablar con una persona por favor',
    expect: {
      intent: 'human_handoff',
      summary: 'Human handoff requested',
      replyIncludes: ['Te conecto con un asesor'],
    },
  },
  {
    id: 'pedido_confirmado_handoff_operaciones',
    level: 'flujo_completo',
    customer: 'known',
    steps: [
      {
        text: 'Me regala 1 pan tajado para domicilio',
        expect: {
          intent: 'delivery_order',
          missingFields: [],
          replyIncludes: ['1 x Pan tajado Bimbo', 'Confirmas el pedido'],
        },
      },
      {
        text: 'Pago por Bre-B',
        expect: {
          intent: 'order_clarification',
          missingFields: [],
          paymentMethod: 'breb',
          replyIncludes: ['Confirmas el pedido'],
        },
      },
      {
        text: 'Listo, confirmo el pedido',
        expect: {
          intent: 'order_confirmation',
          summary: 'Confirmed order registered and handed off',
          replyIncludes: ['Pedido confirmado y registrado', 'Referencia:'],
          orderId: true,
        },
      },
    ],
  },
  {
    id: 'real_supermarket_saludo_solo_domicilio',
    level: 'chat_real_rafaga',
    customer: 'known',
    text: 'Buenas noches para un domicilio',
    expect: {
      intent: 'delivery_order',
      missingFields: ['order_items'],
      replyIncludes: ['que productos quieres pedir'],
    },
  },
  {
    id: 'real_supermarket_pago_tarjeta_es_preferencia',
    level: 'chat_real_pago',
    customer: 'known',
    steps: [
      {
        text: 'Me regalas 3 chocorramos para domicilio',
        expect: {
          intent: 'delivery_order',
          missingFields: [],
          replyIncludes: ['3 x Chocoramo', 'Confirmas el pedido'],
        },
      },
      {
        text: 'Pago con tarjeta débito',
        expect: {
          intent: 'order_clarification',
          missingFields: [],
          paymentMethod: 'card_terminal',
          replyIncludes: ['3 x Chocoramo', 'Confirmas el pedido'],
        },
      },
    ],
  },
  {
    id: 'real_supermarket_correccion_sin_producto',
    level: 'chat_real_correccion',
    customer: 'known',
    steps: [
      {
        text: 'Me regalas 2 chocorramos y 1 agua cristal para domicilio',
        expect: {
          intent: 'delivery_order',
          missingFields: [],
          replyIncludes: ['2 x Chocoramo', '1 x Agua Cristal sin gas 600ml'],
        },
      },
      {
        text: 'Bueno entonces sin el agua',
        expect: {
          intent: 'order_clarification',
          missingFields: [],
          replyIncludes: ['2 x Chocoramo'],
          notReplyIncludes: ['Agua Cristal'],
          orderItems: ['Chocoramo'],
          notOrderItems: ['Agua Cristal sin gas 600ml'],
        },
      },
    ],
  },
  {
    id: 'real_supermarket_agrega_producto_a_canasta',
    level: 'chat_real_correccion',
    customer: 'known',
    steps: [
      {
        text: 'Me regalas 1 pan tajado para domicilio',
        expect: {
          intent: 'delivery_order',
          missingFields: [],
          replyIncludes: ['1 x Pan tajado Bimbo'],
        },
      },
      {
        text: 'Y agregame 1 queso campesino',
        expect: {
          intent: 'delivery_order',
          missingFields: [],
          replyIncludes: ['1 x Pan tajado Bimbo', '1 x Queso campesino 250g'],
          orderItems: ['Pan tajado Bimbo', 'Queso campesino 250g'],
        },
      },
    ],
  },
  {
    id: 'real_supermarket_valor_calchichon_coca',
    level: 'chat_real_inferencia',
    customer: 'known',
    extraProducts: [
      {
        sku: 'AND-CAR-SAL-250',
        name: 'Salchichon Zenú porcionado',
        aliases: ['salchichon', 'salchichón', 'calchichon', 'carnes frias'],
        price: 5000,
        stock: 10,
        category: 'carnes frias',
        presentation: 'porcion al peso',
        driveFileId: 'drv-and-car-sal-250',
      },
      {
        sku: 'AND-COC-350',
        name: 'Coca-Cola 350ml',
        aliases: ['coca cola 350', 'coca-cola 350', 'coca 350'],
        price: 3200,
        stock: 16,
        category: 'bebidas',
        presentation: '350 ml',
        driveFileId: 'drv-and-coc-350',
      },
    ],
    text: 'Buenas tardes, para un domicilio, me regalas favor 5000 de calchichon y una coca-cola 350',
    expect: {
      intent: 'delivery_order',
      missingFields: [],
      replyIncludes: ['Salchichon Zenú porcionado', '1 x Coca-Cola 350ml', 'Confirmas el pedido'],
      orderItems: ['Salchichon Zenú porcionado', 'Coca-Cola 350ml'],
    },
  },
  {
    id: 'real_supermarket_foto_producto_handoff',
    level: 'chat_real_multimedia',
    customer: 'known',
    messageType: 'image',
    mediaRef: 'media-producto-real-1',
    text: '',
    expect: {
      intent: 'catalog_query',
      summary: 'Human handoff requested',
      replyIncludes: ['Recibimos tu imagen', 'asesor'],
    },
  },
  {
    id: 'real_supermarket_reclamo_faltante_handoff',
    level: 'chat_real_reclamo',
    customer: 'known',
    text: 'Por que me enviaron solo un jugo Cfrut?',
    expect: {
      intent: 'human_handoff',
      summary: 'Human handoff requested',
      replyIncludes: ['Te conecto con un asesor'],
    },
  },
  {
    id: 'real_supermarket_comprobante_pago_aprobacion',
    level: 'chat_real_pago',
    customer: 'known',
    text: 'Ya hice la transferencia y te mando comprobante',
    expect: {
      intent: 'payment_confirmation',
      summary: 'Payment write approval requested',
    },
  },
  {
    id: 'real_supermarket_no_hay_ponque_escalamiento',
    level: 'chat_real_disponibilidad_parcial',
    customer: 'known',
    text: 'Me regalas 3 chocorramos y ponque ramo mora para domicilio',
    expect: {
      intent: 'delivery_order',
      summary: 'Structured order escalated to human',
      replyIncludes: ['3 Chocoramo', 'validación con la tienda'],
    },
  },
  {
    id: 'real_supermarket_confirmacion_solo_eso',
    level: 'chat_real_cierre',
    customer: 'known',
    steps: [
      {
        text: 'Me regalas 1 yogurt alpina fresa para domicilio',
        expect: {
          intent: 'delivery_order',
          missingFields: [],
          replyIncludes: ['1 x Yogurt Alpina fresa', 'Confirmas el pedido'],
        },
      },
      {
        text: 'Pago con tarjeta',
        expect: {
          intent: 'order_clarification',
          missingFields: [],
          paymentMethod: 'card_terminal',
          replyIncludes: ['Confirmas el pedido'],
        },
      },
      {
        text: 'Si veci, solo eso',
        expect: {
          intent: 'order_confirmation',
          summary: 'Confirmed order registered and handed off',
          replyIncludes: ['Pedido confirmado y registrado', 'Referencia:'],
          orderId: true,
        },
      },
    ],
  },
];

export const colombianIdiomResearch = [
  {
    idiom: 'me regala / me regalas',
    agentMeaning: 'Formula cortes de compra: "me vende" o "me da", no gratis.',
    source: 'https://diccionariocolombia.com/significado/Me%20regala',
  },
  {
    idiom: 'veci / vecino / vecina',
    agentMeaning: 'Tratamiento cercano frecuente en tienda de barrio.',
    source: 'https://bibliotecadigital.caroycuervo.gov.co/id/eprint/1811/1/2021-1020742415.pdf',
  },
  {
    idiom: 'parce',
    agentMeaning: 'Vocativo informal; no altera la intencion comercial.',
    source: 'https://nuevalengua.com/colombianismos-8-expresiones-tipicas-del-espanol-de-colombia/',
  },
  {
    idiom: 'napa / de napa',
    agentMeaning: 'Solicitud de extra o adicional; debe tratarse como posible descuento o cortesia.',
    source: 'https://nuevalengua.com/colombianismos-8-expresiones-tipicas-del-espanol-de-colombia/',
  },
  {
    idiom: 'pa / pa las onces / pa la sed',
    agentMeaning: 'Forma coloquial de "para"; suele pedir guia por categoria u ocasion.',
    source: 'https://radionacional.co/cultura/dichos-colombianos-que-reflejan-nuestra-identidad-cultural',
  },
];
