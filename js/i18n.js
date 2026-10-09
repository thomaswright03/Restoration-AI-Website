// Room Designer 3D — languages: English, Spanish and Brazilian Portuguese.
//
// The page text itself is translated in the HTML (es/*.html, pt/*.html; see
// README "Languages"). This file holds every piece of text the site's
// JavaScript shows or sends: the design studio and its estimate, form
// messages, the 3D room's product names and the PDF. Each entry is
//   key: [English, Spanish, Portuguese]
// with {name} placeholders filled in by t(). Keep the three in step: the
// unit tests fail when one is missing or its placeholders differ.
//
// The language is the page's own <html lang>, so the English pages (and the
// admin tool, which is English only) always get English.
//
// Loads as a plain browser script (window.I18n) and as a Node module.

(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.I18n = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LANGS = ["en", "es", "pt"];
  // Prices stay in US dollars in every language; only the number format
  // follows the language (US Spanish, Brazilian Portuguese).
  var LOCALES = { en: "en-US", es: "es-US", pt: "pt-BR" };
  var NAMES = { en: "English", es: "Español", pt: "Português" };

  var S = {
    // ---------- language switcher ----------
    "lang.label": ["Language", "Idioma", "Idioma"],

    // ---------- units ----------
    "unit.sqft": ["sq ft", "pies²", "pés²"],
    "unit.sqftFloor": ["sq ft of floor", "pies² de piso", "pés² de piso"],
    "unit.unit": ["unit", "unidad", "unidade"],
    "unit.units": ["units", "unidades", "unidades"],
    "unit.point": ["point", "punto", "ponto"],
    "unit.points": ["points", "puntos", "pontos"],
    "unit.flat": ["flat", "fijo", "fixo"],
    "unit.foot": ["foot", "pie", "pé"],
    "unit.feet": ["feet", "pies", "pés"],
    "unit.gallon": ["gallon", "galón", "galão"],
    "unit.gallons": ["gallons", "galones", "galões"],

    // ---------- estimate: fixtures (js/bathroom-pricing.js) ----------
    "fixture.Toilet_Quantity": ["Toilet", "Inodoro", "Vaso sanitário"],
    "fixture.Sink_Quantity": ["Sink", "Lavabo", "Pia"],
    "fixture.Bathtub_Quantity": ["Bathtub", "Bañera", "Banheira"],
    "fixture.Shower_Quantity": ["Shower", "Ducha", "Chuveiro"],
    "fixture.Shower_Door_Quantity": ["Shower door", "Puerta de ducha", "Porta de box"],
    "fixture.Door_Quantity": ["Entry door", "Puerta de entrada", "Porta de entrada"],
    "fixture.Vanity_Quantity": ["Vanity", "Mueble de lavabo", "Gabinete de pia"],
    "fixture.Cabinet_Quantity": ["Cabinet", "Gabinete", "Armário"],
    "fixture.Mirror_Quantity": ["Mirror (standard)", "Espejo (estándar)", "Espelho (padrão)"],
    "fixture.Mirror_Huge_Quantity": ["Mirror (huge)", "Espejo (extragrande)", "Espelho (extragrande)"],
    "fixture.Shower_Shelf_Quantity": ["Shower shelf", "Repisa de ducha", "Nicho de box"],
    "fixtures.Toilet_Quantity": ["Toilets", "Inodoros", "Vasos sanitários"],
    "fixtures.Sink_Quantity": ["Sinks", "Lavabos", "Pias"],
    "fixtures.Bathtub_Quantity": ["Bathtubs", "Bañeras", "Banheiras"],
    "fixtures.Shower_Quantity": ["Showers", "Duchas", "Chuveiros"],
    "fixtures.Shower_Door_Quantity": ["Shower doors", "Puertas de ducha", "Portas de box"],
    "fixtures.Door_Quantity": ["Entry doors", "Puertas de entrada", "Portas de entrada"],
    "fixtures.Vanity_Quantity": ["Vanities", "Muebles de lavabo", "Gabinetes de pia"],
    "fixtures.Cabinet_Quantity": ["Cabinets", "Gabinetes", "Armários"],
    "fixtures.Mirror_Quantity": ["Standard mirrors", "Espejos estándar", "Espelhos padrão"],
    "fixtures.Mirror_Huge_Quantity": ["Huge mirrors", "Espejos extragrandes", "Espelhos extragrandes"],
    "fixtures.Shower_Shelf_Quantity": ["Shower shelves", "Repisas de ducha", "Nichos de box"],

    // ---------- estimate: work questions ----------
    "question.demolition": [
      "Remove the existing bathroom first (demolition)?",
      "¿Quitar primero el baño actual (demolición)?",
      "Remover o banheiro atual primeiro (demolição)?",
    ],
    "question.floorFinish": ["New floor?", "¿Piso nuevo?", "Piso novo?"],
    "question.walls": ["Walls?", "¿Paredes?", "Paredes?"],
    "question.paintCeiling": ["Paint the ceiling?", "¿Pintar el techo?", "Pintar o teto?"],
    "choice.yes": ["Yes", "Sí", "Sim"],
    "choice.no": ["No", "No", "Não"],
    "choice.floor.tile": ["Tile", "Azulejo", "Cerâmica"],
    "choice.floor.flooring": ["Other flooring", "Otro tipo de piso", "Outro tipo de piso"],
    "choice.walls.tile": ["Tile (full height)", "Azulejo (hasta el techo)", "Revestimento (até o teto)"],
    "choice.walls.tileWet": [
      "Tile around the tub, paint the rest",
      "Azulejo alrededor de la bañera, pintura en el resto",
      "Revestimento em volta da banheira, pintura no resto",
    ],
    "choice.walls.paint": ["Paint", "Pintura", "Pintura"],
    "choice.none": ["None", "Ninguno", "Nenhum"],
    "choice.neither": ["Neither", "Ninguno", "Nenhum"],
    "choice.notAnswered": ["Not answered", "Sin respuesta", "Sem resposta"],
    "dimension.Bathroom_Width_Ft": ["Width", "Ancho", "Largura"],
    "dimension.Bathroom_Length_Ft": ["Length", "Largo", "Comprimento"],
    "dimension.Bathroom_Height_Ft": ["Ceiling height", "Altura del techo", "Altura do teto"],

    // ---------- estimate: validation ----------
    "error.chooseAnswer": ["Choose an answer.", "Elija una respuesta.", "Escolha uma resposta."],
    "error.dimension.missing.Bathroom_Width_Ft": [
      "Enter the width in feet (more than 0 and no more than {max} ft) — the work you chose is priced by area.",
      "Escriba el ancho en pies (más de 0 y no más de {max} pies): el trabajo que eligió se cobra por área.",
      "Informe a largura em pés (mais de 0 e no máximo {max} pés): o serviço escolhido é cobrado por área.",
    ],
    "error.dimension.missing.Bathroom_Length_Ft": [
      "Enter the length in feet (more than 0 and no more than {max} ft) — the work you chose is priced by area.",
      "Escriba el largo en pies (más de 0 y no más de {max} pies): el trabajo que eligió se cobra por área.",
      "Informe o comprimento em pés (mais de 0 e no máximo {max} pés): o serviço escolhido é cobrado por área.",
    ],
    "error.dimension.missing.Bathroom_Height_Ft": [
      "Enter the ceiling height in feet (more than 0 and no more than {max} ft) — the work you chose is priced by area.",
      "Escriba la altura del techo en pies (más de 0 y no más de {max} pies): el trabajo que eligió se cobra por área.",
      "Informe a altura do teto em pés (mais de 0 e no máximo {max} pés): o serviço escolhido é cobrado por área.",
    ],
    "error.dimension.range": [
      "{label} must be more than 0 and no more than {max} ft.",
      "{label}: debe ser más de 0 y no más de {max} pies.",
      "{label}: deve ser mais de 0 e no máximo {max} pés.",
    ],
    "error.wholeNumber": [
      "Enter a whole number from 0 to {max}.",
      "Escriba un número entero del 0 al {max}.",
      "Informe um número inteiro de 0 a {max}.",
    ],

    // ---------- estimate: priced lines ----------
    "line.detail": ["{qty} {unit} × {rate}", "{qty} {unit} × {rate}", "{qty} {unit} × {rate}"],
    "line.flatCharge": ["Flat charge", "Cargo fijo", "Valor fixo"],
    "section.preparation": ["Preparation", "Preparación", "Preparação"],
    "section.fixtures": ["Fixtures", "Instalaciones", "Instalações"],
    "section.surfaces": ["Surfaces", "Superficies", "Superfícies"],
    "section.plumbing": ["Plumbing", "Plomería", "Encanamento"],
    "section.electrical": ["Electrical", "Electricidad", "Elétrica"],
    "line.demolition": ["Demolition", "Demolición", "Demolição"],
    "line.floorTile": ["Floor tile", "Azulejo de piso", "Piso cerâmico"],
    "line.flooring": ["Flooring", "Piso", "Piso"],
    "line.wallTile": [
      "Wall tile (full height)",
      "Azulejo de pared (hasta el techo)",
      "Revestimento de parede (até o teto)",
    ],
    "line.wallTileWet": [
      "Wall tile (around the tub)",
      "Azulejo de pared (alrededor de la bañera)",
      "Revestimento de parede (em volta da banheira)",
    ],
    "line.wallPaint": ["Painting (walls)", "Pintura (paredes)", "Pintura (paredes)"],
    "line.ceilingPaint": ["Painting (ceiling)", "Pintura (techo)", "Pintura (teto)"],
    "line.plumbingPoints": ["Plumbing points", "Puntos de plomería", "Pontos hidráulicos"],
    "line.noStack": [
      "No existing plumbing stack",
      "Sin bajante de plomería existente",
      "Sem prumada hidráulica existente",
    ],
    "line.badValve": ["Bad valve replacement", "Cambio de válvula dañada", "Troca de registro com defeito"],
    "line.electricalPoints": ["Electrical points", "Puntos eléctricos", "Pontos elétricos"],
    "line.drainRun": [
      "New drain line to the plumbing wall",
      "Nueva línea de desagüe hasta la pared de plomería",
      "Nova linha de esgoto até a parede hidráulica",
    ],

    // ---------- estimate: assumptions and summary ----------
    "scope.describe": [
      "Demolition: {demolition}; new floor: {floor}; walls: {walls}; paint ceiling: {ceiling}",
      "Demolición: {demolition}; piso nuevo: {floor}; paredes: {walls}; pintar el techo: {ceiling}",
      "Demolição: {demolition}; piso novo: {floor}; paredes: {walls}; pintar o teto: {ceiling}",
    ],
    "assume.scope": [
      "{scope}. Only this work is priced.",
      "{scope}. Solo se cotiza este trabajo.",
      "{scope}. Somente este serviço está no orçamento.",
    ],
    "assume.floorArea": [
      "Floor area: {w} × {l} ft = {area} sq ft (the ceiling is taken to be the same size).",
      "Área del piso: {w} × {l} pies = {area} pies² (se toma el techo del mismo tamaño).",
      "Área do piso: {w} × {l} pés = {area} pés² (considera-se o teto do mesmo tamanho).",
    ],
    "assume.wallArea": [
      "Wall area: 2 × {h} ft × ({w} + {l} ft) = {area} sq ft — all four walls, full height, with no deduction for doors, windows, or a tub/shower.",
      "Área de paredes: 2 × {h} pies × ({w} + {l} pies) = {area} pies²: las cuatro paredes, hasta el techo, sin descontar puertas, ventanas ni la bañera o ducha.",
      "Área das paredes: 2 × {h} pés × ({w} + {l} pés) = {area} pés²: as quatro paredes, até o teto, sem descontar portas, janelas nem a banheira ou o box.",
    ],
    "assume.wallAreaDoors": [
      "Wall area: 2 × {h} ft × ({w} + {l} ft) = {gross} sq ft, less {doors} sq ft of doorways = {area} sq ft. Windows and the wall behind fixtures aren't deducted.",
      "Área de paredes: 2 × {h} pies × ({w} + {l} pies) = {gross} pies², menos {doors} pies² de puertas = {area} pies². No se descuentan ventanas ni la pared detrás de las piezas.",
      "Área das paredes: 2 × {h} pés × ({w} + {l} pés) = {gross} pés², menos {doors} pés² de portas = {area} pés². Não se descontam janelas nem a parede atrás das peças.",
    ],
    "assume.wetArea": [
      "Tile around the tub: {area} sq ft, up to 6 ft high on the walls it touches. The rest of the walls are painted.",
      "Azulejo alrededor de la bañera: {area} pies², hasta 6 pies de alto en las paredes que toca. El resto de las paredes se pinta.",
      "Revestimento em volta da banheira: {area} pés², até 6 pés de altura nas paredes em que ela encosta. O resto das paredes é pintado.",
    ],
    "assume.fixtures": [
      "Fixtures are priced per item at our current labor rates, which may change.",
      "Las instalaciones se cobran por pieza según nuestras tarifas de mano de obra actuales, que pueden cambiar.",
      "As instalações são cobradas por item conforme nossos valores atuais de mão de obra, que podem mudar.",
    ],
    "summary.title": [
      "My bathroom estimate from your website:",
      "Mi estimación del baño hecha en su sitio web:",
      "Minha estimativa do banheiro feita no seu site:",
    ],
    "summary.room": ["- Room: {size}", "- Baño: {size}", "- Banheiro: {size}"],
    "summary.size2": [
      "{w} ft wide × {l} ft long",
      "{w} pies de ancho × {l} pies de largo",
      "{w} pés de largura × {l} pés de comprimento",
    ],
    "summary.size3": [
      "{w} ft wide × {l} ft long × {h} ft high",
      "{w} pies de ancho × {l} pies de largo × {h} pies de alto",
      "{w} pés de largura × {l} pés de comprimento × {h} pés de altura",
    ],
    "summary.work": ["- Work: {scope}", "- Trabajo: {scope}", "- Serviço: {scope}"],
    "summary.fixtures": ["- Fixtures: {list}", "- Instalaciones: {list}", "- Instalações: {list}"],
    "summary.none": ["none", "ninguna", "nenhuma"],
    "summary.total": [
      "- Estimated labor total: {total} — rough and non-binding; excludes plumbing, electrical, materials, permits and taxes.",
      "- Total estimado de mano de obra: {total}. Aproximado y no vinculante; no incluye plomería, electricidad, materiales, permisos ni impuestos.",
      "- Total estimado de mão de obra: {total}. Aproximado e sem compromisso; não inclui encanamento, elétrica, materiais, alvarás nem impostos.",
    ],
    "summary.totalBeforePlumbing": [
      "- Estimated labor total: {total} (before plumbing) — rough and non-binding; excludes plumbing, electrical, materials, permits and taxes.",
      "- Total estimado de mano de obra: {total} (sin la plomería). Aproximado y no vinculante; no incluye plomería, electricidad, materiales, permisos ni impuestos.",
      "- Total estimado de mão de obra: {total} (sem o encanamento). Aproximado e sem compromisso; não inclui encanamento, elétrica, materiais, alvarás nem impostos.",
    ],

    // ---------- estimate card ----------
    "card.title": ["Bathroom Remodel", "Remodelación de baño", "Reforma de banheiro"],
    "card.lede": [
      "Rough, non-binding labor estimate — details below.",
      "Estimación aproximada y no vinculante de la mano de obra. Detalles abajo.",
      "Estimativa aproximada e sem compromisso da mão de obra. Detalhes abaixo.",
    ],
    "card.ledeMaterials": [
      "Rough, non-binding estimate — labor plus real current prices for the exact products you picked.",
      "Estimación aproximada y no vinculante: mano de obra más los precios reales actuales de los productos exactos que eligió.",
      "Estimativa aproximada e sem compromisso: mão de obra mais os preços reais atuais dos produtos exatos que você escolheu.",
    ],
    "card.noWork": [
      "No priced work selected",
      "No eligió ningún trabajo con precio",
      "Nenhum serviço com preço escolhido",
    ],
    "card.laborSubtotal": ["Labor Subtotal", "Subtotal de mano de obra", "Subtotal de mão de obra"],
    "card.materialsSubtotal": ["Materials Subtotal", "Subtotal de materiales", "Subtotal de materiais"],
    "card.total": ["Estimated Labor Total", "Total estimado de mano de obra", "Total estimado de mão de obra"],
    "card.totalBeforePlumbing": [
      "Estimated Labor Total, before plumbing",
      "Total estimado de mano de obra, sin la plomería",
      "Total estimado de mão de obra, sem o encanamento",
    ],
    "card.totalMaterials": [
      "Estimated Total (Labor + Materials)",
      "Total estimado (mano de obra + materiales)",
      "Total estimado (mão de obra + materiais)",
    ],
    "card.totalMaterialsBeforePlumbing": [
      "Estimated Total (Labor + Materials), before plumbing",
      "Total estimado (mano de obra + materiales), sin la plomería",
      "Total estimado (mão de obra + materiais), sem o encanamento",
    ],
    "card.plumbingTotalNote": [
      "This is not the full cost of your job: plumbing work for the {n} toilet, sink, shower or bathtub item(s) you listed will be added on top of this total.",
      "Este no es el costo total de su trabajo: la plomería de las {n} pieza(s) que indicó (inodoro, lavabo, ducha o bañera) se sumará a este total.",
      "Este não é o custo total do seu serviço: o encanamento das {n} peça(s) que você informou (vaso, pia, chuveiro ou banheira) será somado a este total.",
    ],
    "card.excluded.listedPlumbing": [
      "Plumbing for the {n} toilet, sink, shower or bathtub item(s) you listed",
      "Plomería de las {n} pieza(s) indicadas (inodoro, lavabo, ducha o bañera)",
      "Encanamento das {n} peça(s) informadas (vaso, pia, chuveiro ou banheira)",
    ],
    "card.excluded.trades": [
      "Plumbing & electrical work",
      "Trabajo de plomería y electricidad",
      "Serviço de encanamento e elétrica",
    ],
    "card.excluded.otherTrades": [
      "Any other plumbing & electrical work",
      "Cualquier otro trabajo de plomería y electricidad",
      "Qualquer outro serviço de encanamento e elétrica",
    ],
    "card.excluded.tradesPriced": [
      "Plumbing & electrical beyond the points listed (e.g. no plumbing stack, a bad valve)",
      "Plomería y electricidad más allá de los puntos indicados (p. ej., sin bajante, válvula dañada)",
      "Encanamento e elétrica além dos pontos listados (por ex., sem prumada, registro com defeito)",
    ],
    "card.excluded.permits": [
      "Permits & any applicable taxes",
      "Permisos e impuestos aplicables",
      "Alvarás e impostos aplicáveis",
    ],
    "card.excluded.materialsPermits": [
      "Materials, permits & any applicable taxes",
      "Materiales, permisos e impuestos aplicables",
      "Materiais, alvarás e impostos aplicáveis",
    ],
    "card.excluded.extra": ["Extra — not included", "Aparte, no incluido", "À parte, não incluído"],
    "card.excluded.notIncluded": ["Not included", "No incluido", "Não incluído"],
    "card.plumbingNote": [
      "Plumbing and electrical work is not included. Toilets, sinks, showers, and bathtubs also need plumbing work, so if you listed any, or your job needs other plumbing or electrical work, expect it to add to the cost. We'll tell you how it will be handled and priced before any work is agreed.",
      "No incluye trabajo de plomería ni electricidad. Los inodoros, lavabos, duchas y bañeras también requieren plomería, así que si indicó alguno, o su trabajo necesita otra plomería o electricidad, cuente con que aumentará el costo. Le diremos cómo se hará y cómo se cobrará antes de acordar cualquier trabajo.",
      "Não inclui serviço de encanamento nem de elétrica. Vasos, pias, chuveiros e banheiras também precisam de encanamento, então se você informou algum, ou se o seu serviço precisa de outro encanamento ou elétrica, conte com um custo maior. Diremos como será feito e cobrado antes de combinar qualquer serviço.",
    ],
    "card.materialsNote": [
      "Materials shown are priced at current Home Depot rates as of when they were last refreshed — confirm before buying. Also not included: permits and any applicable taxes.",
      "Los materiales tienen los precios de Home Depot de la última actualización: confírmelos antes de comprar. Tampoco incluye permisos ni impuestos aplicables.",
      "Os materiais estão com os preços da Home Depot da última atualização: confirme antes de comprar. Também não inclui alvarás nem impostos aplicáveis.",
    ],
    "card.alsoNotIncluded": [
      "Also not included: materials, permits, and any applicable taxes.",
      "Tampoco incluye materiales, permisos ni impuestos aplicables.",
      "Também não inclui materiais, alvarás nem impostos aplicáveis.",
    ],
    "card.disclaimer": [
      "This is an automated, non-binding estimate of labor only, based only on the measurements, counts, and choices you entered and the assumptions listed with it. It is not a quote, offer, or contract. It excludes plumbing and electrical work (including the plumbing any toilets, sinks, showers, or bathtubs need), materials, permits, and any applicable taxes, which will add to the cost where your job needs them. Prices are current as of the date generated and may change. Your actual price is set only in a written agreement after we review your project in person.",
      "Esta es una estimación automática y no vinculante solo de la mano de obra, basada únicamente en las medidas, cantidades y opciones que usted indicó y en los supuestos que la acompañan. No es una cotización, oferta ni contrato. No incluye trabajo de plomería ni electricidad (incluida la plomería que necesiten inodoros, lavabos, duchas o bañeras), materiales, permisos ni impuestos aplicables, que aumentarán el costo si su trabajo los necesita. Los precios son los vigentes en la fecha en que se generó y pueden cambiar. Su precio real se fija solo en un acuerdo por escrito, después de revisar su proyecto en persona.",
      "Esta é uma estimativa automática e sem compromisso somente da mão de obra, baseada apenas nas medidas, quantidades e escolhas que você informou e nas premissas que a acompanham. Não é um orçamento, oferta nem contrato. Não inclui serviço de encanamento nem de elétrica (incluindo o encanamento de vasos, pias, chuveiros ou banheiras), materiais, alvarás nem impostos aplicáveis, que aumentarão o custo se o seu serviço precisar deles. Os preços são os vigentes na data em que foi gerada e podem mudar. Seu preço real só é definido em um acordo por escrito, depois que avaliarmos o seu projeto pessoalmente.",
    ],
    "card.disclaimerMaterials": [
      "This is an automated, non-binding estimate combining labor at our current rates with current Home Depot prices for the exact products you picked, based only on what you entered and the assumptions listed with it. It is not a quote, offer, or contract. It excludes plumbing and electrical installation work (the labor to hook up any toilets, sinks, showers, or bathtubs listed), permits, and any applicable taxes, which will add to the cost where your job needs them. Product prices were current as of when they were last refreshed and may have changed since — confirm before buying. Your actual price is set only in a written agreement after we review your project in person.",
      "Esta es una estimación automática y no vinculante que combina la mano de obra según nuestras tarifas actuales con los precios actuales de Home Depot de los productos exactos que eligió, basada únicamente en lo que usted indicó y en los supuestos que la acompañan. No es una cotización, oferta ni contrato. No incluye trabajo de instalación de plomería ni electricidad (la mano de obra para conectar los inodoros, lavabos, duchas o bañeras indicados), permisos ni impuestos aplicables, que aumentarán el costo si su trabajo los necesita. Los precios de los productos eran los vigentes en su última actualización y pueden haber cambiado: confírmelos antes de comprar. Su precio real se fija solo en un acuerdo por escrito, después de revisar su proyecto en persona.",
      "Esta é uma estimativa automática e sem compromisso que combina a mão de obra pelos nossos valores atuais com os preços atuais da Home Depot dos produtos exatos que você escolheu, baseada apenas no que você informou e nas premissas que a acompanham. Não é um orçamento, oferta nem contrato. Não inclui serviço de instalação de encanamento nem de elétrica (a mão de obra para ligar os vasos, pias, chuveiros ou banheiras informados), alvarás nem impostos aplicáveis, que aumentarão o custo se o seu serviço precisar deles. Os preços dos produtos eram os vigentes na última atualização e podem ter mudado: confirme antes de comprar. Seu preço real só é definido em um acordo por escrito, depois que avaliarmos o seu projeto pessoalmente.",
    ],
    "card.assumptions": ["What this estimate assumes", "Qué supone esta estimación", "O que esta estimativa considera"],
    "card.businessNamed": ["{business} ({name})", "{business} ({name})", "{business} ({name})"],
    "pdf.preparing": ["Preparing PDF…", "Preparando el PDF…", "Preparando o PDF…"],
    "pdf.retry": ["Retry PDF", "Reintentar PDF", "Tentar PDF de novo"],
    "pdf.failed": [
      "Sorry, the PDF couldn't be prepared. Check your connection and press Retry PDF.",
      "Lo sentimos, no se pudo preparar el PDF. Revise su conexión y presione Reintentar PDF.",
      "Desculpe, não foi possível preparar o PDF. Verifique sua conexão e toque em Tentar PDF de novo.",
    ],

    // ---------- materials picks ----------
    "products.unpriced": [
      "No live Home Depot price was found for these, so they aren't in the total: {items}.",
      "No se encontró un precio actual de Home Depot para estos productos, así que no están en el total: {items}.",
      "Não encontramos um preço atual da Home Depot para estes produtos, então eles não estão no total: {items}.",
    ],
    "products.vanityCabinet": [
      "The vanity cabinet itself isn't a Kohler or Sterling product, so it isn't priced here; only its bowl or top and faucet are.",
      "El mueble del lavabo no es un producto Kohler ni Sterling, así que no tiene precio aquí; solo el lavabo o la cubierta y la llave.",
      "O gabinete em si não é um produto Kohler nem Sterling, então não tem preço aqui; só a cuba ou o tampo e a torneira.",
    ],
    "products.wiringNotIncluded": [
      "{items}: the wiring by an electrician isn't in this estimate.",
      "{items}: la instalación eléctrica por un electricista no está incluida en esta estimación.",
      "{items}: a instalação elétrica por um eletricista não está incluída nesta estimativa.",
    ],
    "products.valveNotIncluded": [
      "The shower and tub valve prices are for the visible trim only; the valve inside the wall is extra.",
      "Los precios de las válvulas de la ducha y la bañera son solo del acabado visible; la válvula dentro de la pared es aparte.",
      "Os preços dos registros do chuveiro e da banheira são só do acabamento visível; a válvula dentro da parede é à parte.",
    ],
    "materials.cheaperThan": [
      "Cheaper than {others} for the same product.",
      "Más barato que {others} por el mismo producto.",
      "Mais barato que {others} pelo mesmo produto.",
    ],

    // ---------- Get a Quote form ----------
    "form.error.name": ["Enter your name.", "Escriba su nombre.", "Informe seu nome."],
    "form.error.phone": [
      "Enter a phone number we can call you on.",
      "Escriba un número de teléfono al que podamos llamarle.",
      "Informe um telefone para podermos ligar para você.",
    ],
    "form.error.phoneInvalid": [
      "Enter a valid phone number, e.g. (385) 356-8733.",
      "Escriba un número de teléfono válido, por ejemplo (385) 356-8733.",
      "Informe um telefone válido, por exemplo (385) 356-8733.",
    ],
    "form.error.email": ["Enter your email address.", "Escriba su correo electrónico.", "Informe seu e-mail."],
    "form.error.emailInvalid": [
      "Enter a valid email address, e.g. name@example.com.",
      "Escriba un correo electrónico válido, por ejemplo nombre@ejemplo.com.",
      "Informe um e-mail válido, por exemplo nome@exemplo.com.",
    ],
    "form.subject": [
      "Bathroom quote request from {name}",
      "Solicitud de cotización de baño de {name}",
      "Pedido de orçamento de banheiro de {name}",
    ],
    "form.body.name": ["Name", "Nombre", "Nome"],
    "form.body.phone": ["Phone", "Teléfono", "Telefone"],
    "form.body.email": ["Email", "Correo electrónico", "E-mail"],
    "form.body.service": ["Service", "Servicio", "Serviço"],
    "form.body.details": ["Project details", "Detalles del proyecto", "Detalhes do projeto"],
    "form.sending": ["Sending…", "Enviando…", "Enviando…"],
    "form.status.sending": ["Sending your request…", "Enviando su solicitud…", "Enviando o seu pedido…"],
    "form.status.mailto": [
      "Your email app should now open with your request filled in. [b:Please press Send in your email app] — we don't receive anything until you do. If nothing opened, [again:open it again], email us at [email] or call [phone].",
      "Ahora debería abrirse su aplicación de correo con su solicitud ya escrita. [b:Presione Enviar en su aplicación de correo]: no recibimos nada hasta que lo haga. Si no se abrió nada, [again:vuelva a abrirla], escríbanos a [email] o llame al [phone].",
      "Agora o seu aplicativo de e-mail deve abrir com o pedido já preenchido. [b:Toque em Enviar no seu aplicativo de e-mail]: não recebemos nada até você fazer isso. Se nada abriu, [again:abra de novo], escreva para [email] ou ligue para [phone].",
    ],
    "form.status.sent": [
      "[b:Request sent.] Thank you — we've received your request and will get back to you as soon as we can. If it's urgent, call [phone].",
      "[b:Solicitud enviada.] Gracias: recibimos su solicitud y le responderemos lo antes posible. Si es urgente, llame al [phone].",
      "[b:Pedido enviado.] Obrigado! Recebemos o seu pedido e responderemos o quanto antes. Se for urgente, ligue para [phone].",
    ],
    "form.status.failed": [
      "[b:Sorry, your request wasn't sent.] Nothing you entered has been lost — please try again, or call us at [phone] or email [email].",
      "[b:Lo sentimos, su solicitud no se envió.] No se perdió nada de lo que escribió: inténtelo de nuevo, o llámenos al [phone] o escriba a [email].",
      "[b:Desculpe, o seu pedido não foi enviado.] Nada do que você digitou foi perdido: tente de novo, ou ligue para [phone] ou escreva para [email].",
    ],

    // ---------- projects: My projects page and the designer's save bar (js/projects.js) ----------
    "proj.plan.free": ["Free", "Gratis", "Grátis"],
    "proj.plan.starter": ["Starter", "Starter", "Starter"],
    "proj.plan.pro": ["Pro", "Pro", "Pro"],
    "proj.plan.max": ["Max", "Max", "Max"],
    "proj.planLine": ["Plan: {plan}", "Plan: {plan}", "Plano: {plan}"],
    "proj.usage.month": [
      "New projects this month: {used} of {limit}",
      "Proyectos nuevos este mes: {used} de {limit}",
      "Projetos novos este mês: {used} de {limit}",
    ],
    "proj.usage.total": [
      "Saved projects: {used} of {limit}",
      "Proyectos guardados: {used} de {limit}",
      "Projetos salvos: {used} de {limit}",
    ],
    "proj.summary.free": [
      "You're on the free plan: you can use the designer, but saving projects needs a paid plan.",
      "Tiene el plan gratis: puede usar el diseñador, pero para guardar proyectos necesita un plan de pago.",
      "Você está no plano grátis: pode usar o projetista, mas para salvar projetos precisa de um plano pago.",
    ],
    "proj.summary.paid": [
      "{plan} plan: {month} of {monthly} new projects this month, {total} of {limit} saved.",
      "Plan {plan}: {month} de {monthly} proyectos nuevos este mes, {total} de {limit} guardados.",
      "Plano {plan}: {month} de {monthly} projetos novos este mês, {total} de {limit} salvos.",
    ],
    "proj.updated": ["Updated {date}", "Actualizado el {date}", "Atualizado em {date}"],
    "proj.open": ["Open", "Abrir", "Abrir"],
    "proj.openNamed": ["Open {name}", "Abrir {name}", "Abrir {name}"],
    "proj.rename": ["Rename", "Cambiar nombre", "Renomear"],
    "proj.renameNamed": ["Rename {name}", "Cambiar el nombre de {name}", "Renomear {name}"],
    "proj.delete": ["Delete", "Eliminar", "Excluir"],
    "proj.deleteNamed": ["Delete {name}", "Eliminar {name}", "Excluir {name}"],
    "proj.nameLabel": ["Project name", "Nombre del proyecto", "Nome do projeto"],
    "proj.saveName": ["Save name", "Guardar nombre", "Salvar nome"],
    "proj.cancel": ["Cancel", "Cancelar", "Cancelar"],
    "proj.renamed": ["Name saved.", "Nombre guardado.", "Nome salvo."],
    "proj.deleteConfirm": [
      "Delete “{name}”? This frees a saved-project slot, but doesn't give back one of this month's new projects. It can't be undone.",
      "¿Eliminar «{name}»? Esto libera un espacio de proyectos guardados, pero no le devuelve uno de los proyectos nuevos de este mes. No se puede deshacer.",
      "Excluir “{name}”? Isso libera uma vaga de projetos salvos, mas não devolve um dos projetos novos deste mês. Não dá para desfazer.",
    ],
    "proj.deleteConfirmFree": [
      "Delete “{name}”? It can't be undone.",
      "¿Eliminar «{name}»? No se puede deshacer.",
      "Excluir “{name}”? Não dá para desfazer.",
    ],
    "proj.deleted": ["Deleted “{name}”.", "Se eliminó «{name}».", "“{name}” foi excluído."],
    "proj.defaultName": ["Bathroom, {date}", "Baño, {date}", "Banheiro, {date}"],
    "proj.bar.free": [
      "Free plan: design all you like. Saving projects needs a paid plan.",
      "Plan gratis: diseñe todo lo que quiera. Para guardar proyectos necesita un plan de pago.",
      "Plano grátis: projete à vontade. Para salvar projetos é preciso um plano pago.",
    ],
    "proj.bar.pickPlan": ["Pick a plan", "Elegir un plan", "Escolher um plano"],
    "proj.bar.down": [
      "Your plan couldn't be loaded, so saving may not work.",
      "No se pudo cargar su plan, así que es posible que no pueda guardar.",
      "Não foi possível carregar o seu plano, então talvez não dê para salvar.",
    ],
    "proj.bar.retry": ["Try again", "Intentar de nuevo", "Tentar de novo"],
    "proj.bar.left": [
      "{month} of {monthly} new projects left this month, room for {total} more saved.",
      "Le quedan {month} de {monthly} proyectos nuevos este mes y espacio para {total} guardados más.",
      "Restam {month} de {monthly} projetos novos este mês e espaço para mais {total} salvos.",
    ],
    "proj.bar.unsaved": [
      "This design isn't saved to your projects yet.",
      "Este diseño aún no está guardado en sus proyectos.",
      "Este projeto ainda não está salvo nos seus projetos.",
    ],
    "proj.save": ["Save changes", "Guardar cambios", "Salvar alterações"],
    "proj.saveFirst": ["Save project", "Guardar proyecto", "Salvar projeto"],
    "proj.saving": ["Saving…", "Guardando…", "Salvando…"],
    "proj.saved": ["Saved “{name}”.", "Se guardó «{name}».", "“{name}” foi salvo."],
    "proj.savedNew": [
      "Saved “{name}”. {month} of {monthly} new projects used this month, {total} of {limit} saved.",
      "Se guardó «{name}». Usó {month} de {monthly} proyectos nuevos este mes; {total} de {limit} guardados.",
      "“{name}” foi salvo. {month} de {monthly} projetos novos usados este mês; {total} de {limit} salvos.",
    ],
    "proj.err.plan": [
      "Saving projects needs a paid plan. You can keep designing on the free plan.",
      "Para guardar proyectos necesita un plan de pago. Puede seguir diseñando con el plan gratis.",
      "Para salvar projetos é preciso um plano pago. Você pode continuar projetando no plano grátis.",
    ],
    "proj.err.monthly": [
      "You've started all {n} new projects your plan allows this month. Deleting a project doesn't give one back; the count starts over on the 1st.",
      "Ya empezó los {n} proyectos nuevos que su plan permite este mes. Eliminar un proyecto no le devuelve uno; la cuenta vuelve a empezar el día 1.",
      "Você já começou os {n} projetos novos que o seu plano permite este mês. Excluir um projeto não devolve um; a contagem recomeça no dia 1º.",
    ],
    "proj.err.total": [
      "You have {n} saved projects, the most your plan keeps. Delete one in My projects to make room.",
      "Tiene {n} proyectos guardados, el máximo de su plan. Elimine uno en Mis proyectos para hacer espacio.",
      "Você tem {n} projetos salvos, o máximo do seu plano. Exclua um em Meus projetos para abrir espaço.",
    ],
    "proj.err.setup": [
      "Projects aren't switched on yet. Please check back soon.",
      "Los proyectos aún no están activados. Vuelva pronto.",
      "Os projetos ainda não estão ativados. Volte em breve.",
    ],
    "proj.err.signin": [
      "Your sign-in has ended. Log in again to save.",
      "Su sesión terminó. Inicie sesión de nuevo para guardar.",
      "A sua sessão terminou. Entre de novo para salvar.",
    ],
    "proj.err.notFound": [
      "That project wasn't found. It may have been deleted.",
      "No se encontró ese proyecto. Puede que se haya eliminado.",
      "Esse projeto não foi encontrado. Pode ter sido excluído.",
    ],
    "proj.err.info": [
      "Something in the details doesn't fit. Check the date and keep each field short.",
      "Algo en los datos no es válido. Revise la fecha y mantenga cada campo corto.",
      "Algo nos dados não está certo. Confira a data e deixe cada campo curto.",
    ],
    "proj.starts": ["Starts {date}", "Empieza el {date}", "Começa em {date}"],
    "proj.bar.project": ["Project:", "Proyecto:", "Projeto:"],
    "proj.infoSaved": ["Info saved.", "Información guardada.", "Informações salvas."],
    "proj.f.name": ["Project name", "Nombre del proyecto", "Nome do projeto"],
    "proj.f.nameHelp": [
      "Leave it blank to name it after the client and address.",
      "Déjelo en blanco para nombrarlo con el cliente y la dirección.",
      "Deixe em branco para usar o cliente e o endereço como nome.",
    ],
    "proj.group.client": ["Client", "Cliente", "Cliente"],
    "proj.group.address": ["Job address", "Dirección del trabajo", "Endereço do serviço"],
    "proj.group.job": ["The job", "El trabajo", "O serviço"],
    "proj.f.client": ["Client name", "Nombre del cliente", "Nome do cliente"],
    "proj.f.phone": ["Phone", "Teléfono", "Telefone"],
    "proj.f.email": ["Email", "Correo electrónico", "E-mail"],
    "proj.f.street": ["Street address", "Dirección", "Endereço"],
    "proj.f.unit": ["Unit / Apt # (optional)", "Unidad / Apto. (opcional)", "Unidade / Apto. (opcional)"],
    "proj.f.city": ["City", "Ciudad", "Cidade"],
    "proj.f.state": ["State", "Estado", "Estado"],
    "proj.f.zip": ["ZIP code", "Código postal", "CEP"],
    "proj.f.type": ["Type of job", "Tipo de trabajo", "Tipo de serviço"],
    "proj.f.status": ["Status", "Estado del proyecto", "Situação"],
    "proj.f.start": ["Target start date", "Fecha de inicio prevista", "Data prevista de início"],
    "proj.f.notes": ["Notes", "Notas", "Observações"],
    "proj.choose": ["Choose…", "Elija…", "Escolha…"],
    "proj.type.full": ["Full bathroom remodel", "Remodelación completa del baño", "Reforma completa do banheiro"],
    "proj.type.partial": ["Partial remodel", "Remodelación parcial", "Reforma parcial"],
    "proj.type.other": ["Other", "Otro", "Outro"],
    "proj.status.lead": ["New lead", "Cliente nuevo", "Novo contato"],
    "proj.status.estimate": ["Estimate sent", "Estimación enviada", "Orçamento enviado"],
    "proj.status.approved": ["Approved", "Aprobado", "Aprovado"],
    "proj.status.progress": ["In progress", "En curso", "Em andamento"],
    "proj.status.done": ["Completed", "Terminado", "Concluído"],
    "proj.mat.room": ["Room", "Baño", "Banheiro"],
    "proj.mat.roomSize": ["{w} × {l}, {h} ceiling", "{w} × {l}, techo de {h}", "{w} × {l}, pé-direito de {h}"],
    "proj.mat.fixtures": ["Fixtures", "Accesorios", "Peças"],
    "proj.mat.surfaces": [
      "Floor, wall and ceiling materials",
      "Materiales de piso, paredes y techo",
      "Materiais de piso, paredes e teto",
    ],
    "proj.mat.products": ["Fixtures and products", "Accesorios y productos", "Peças e produtos"],
    "proj.mat.labor": ["Labor", "Mano de obra", "Mão de obra"],
    "proj.mat.item": ["Item", "Artículo", "Item"],
    "proj.mat.product": ["Product", "Producto", "Produto"],
    "proj.mat.model": ["Model", "Modelo", "Modelo"],
    "proj.mat.qty": ["Quantity", "Cantidad", "Quantidade"],
    "proj.mat.detail": ["Detail", "Detalle", "Detalhe"],
    "proj.mat.cost": ["Est. cost", "Costo est.", "Custo est."],
    "proj.mat.notPriced": ["Not priced", "Sin precio", "Sem preço"],
    "proj.mat.none": [
      "This design doesn't need any priced materials.",
      "Este diseño no necesita materiales con precio.",
      "Este projeto não precisa de materiais com preço.",
    ],
    "proj.mat.laborTotal": ["Labor", "Mano de obra", "Mão de obra"],
    "proj.mat.materialsTotal": ["Materials", "Materiales", "Materiais"],
    "proj.mat.total": ["Estimated total", "Total estimado", "Total estimado"],
    "proj.mat.asOf": [
      "As worked out when the design was last saved ({date}). Prices are estimates and may have changed.",
      "Según el diseño guardado por última vez ({date}). Los precios son estimados y pueden haber cambiado.",
      "Conforme o projeto salvo por último ({date}). Os preços são estimativas e podem ter mudado.",
    ],
    "proj.err.name": ["Give the project a name.", "Póngale un nombre al proyecto.", "Dê um nome ao projeto."],
    "proj.err.paused": [
      "Saving projects is paused right now. Your design is safe in this browser; try again in a little while.",
      "Guardar proyectos está pausado por ahora. Su diseño está a salvo en este navegador; inténtelo de nuevo en un rato.",
      "Salvar projetos está pausado no momento. O seu projeto está seguro neste navegador; tente de novo daqui a pouco.",
    ],

    // ---------- account and sign-up pages (js/account.js) ----------
    "acct.status.none": [
      "You're on the free plan: you can use the designer, but saving projects needs a paid plan. Pick a plan below.",
      "Tiene el plan gratis: puede usar el diseñador, pero guardar proyectos requiere un plan de pago. Elija un plan abajo.",
      "Você está no plano grátis: pode usar o projetista, mas salvar projetos exige um plano pago. Escolha um plano abaixo.",
    ],
    "acct.status.nonePaymentsOff": [
      "You're on the free plan: you can use the designer, but saving projects needs a paid plan. Paid plans aren't available yet. Meanwhile, set up your business details and labor prices below; your designer already uses them.",
      "Tiene el plan gratis: puede usar el diseñador, pero guardar proyectos requiere un plan de pago. Los planes de pago aún no están disponibles. Mientras tanto, complete abajo los datos de su empresa y sus precios de mano de obra; su diseñador ya los usa.",
      "Você está no plano grátis: pode usar o projetista, mas salvar projetos exige um plano pago. Os planos pagos ainda não estão disponíveis. Enquanto isso, preencha abaixo os dados da empresa e os preços de mão de obra; o seu projetista já os usa.",
    ],
    "acct.status.nonePaused": [
      "You're on the free plan: you can use the designer, but saving projects needs a paid plan. Buying a plan is paused right now; please check back soon.",
      "Tiene el plan gratis: puede usar el diseñador, pero guardar proyectos requiere un plan de pago. La compra de planes está pausada por ahora; vuelva pronto.",
      "Você está no plano grátis: pode usar o projetista, mas salvar projetos exige um plano pago. A compra de planos está pausada no momento; volte em breve.",
    ],
    "acct.status.trialing": [
      "Free until {date}, then your plan's monthly price. You can save projects within your plan's limits.",
      "Gratis hasta el {date}; después, el precio mensual de su plan. Puede guardar proyectos dentro de los límites de su plan.",
      "Grátis até {date}; depois, o preço mensal do seu plano. Você pode salvar projetos dentro dos limites do plano.",
    ],
    "acct.status.trialingNoDate": [
      "Free trial, then your plan's monthly price. You can save projects within your plan's limits.",
      "Prueba gratis; después, el precio mensual de su plan. Puede guardar proyectos dentro de los límites de su plan.",
      "Período grátis; depois, o preço mensal do seu plano. Você pode salvar projetos dentro dos limites do plano.",
    ],
    "acct.status.active": [
      "Active. Renews on {date}. You can save projects within your plan's limits.",
      "Activo. Se renueva el {date}. Puede guardar proyectos dentro de los límites de su plan.",
      "Ativo. Renova em {date}. Você pode salvar projetos dentro dos limites do plano.",
    ],
    "acct.status.activeNoDate": [
      "Active. You can save projects within your plan's limits.",
      "Activo. Puede guardar proyectos dentro de los límites de su plan.",
      "Ativo. Você pode salvar projetos dentro dos limites do plano.",
    ],
    "acct.status.ending": [
      "Cancelled. You can keep saving projects until {date}; after that your projects stay readable, and saving needs a new plan.",
      "Cancelado. Puede seguir guardando proyectos hasta el {date}; después, sus proyectos siguen pudiendo leerse y guardar requiere un plan nuevo.",
      "Cancelado. Você pode continuar salvando projetos até {date}; depois, os projetos continuam legíveis e salvar exige um plano novo.",
    ],
    "acct.status.endingNoDate": [
      "Cancelled at the end of this billing period. Until then you can keep saving projects; after that your projects stay readable, and saving needs a new plan.",
      "Se cancela al final de este período de facturación. Hasta entonces puede seguir guardando proyectos; después, sus proyectos siguen pudiendo leerse y guardar requiere un plan nuevo.",
      "Cancelado ao fim deste período de cobrança. Até lá você pode continuar salvando projetos; depois, os projetos continuam legíveis e salvar exige um plano novo.",
    ],
    "acct.status.past_due": [
      "Your last payment didn't go through, so saving projects is paused (your projects are safe and still open). Update your card under Manage billing; saving comes back as soon as the payment clears.",
      "Su último pago no se procesó, así que guardar proyectos está pausado (sus proyectos están a salvo y siguen abriéndose). Actualice su tarjeta en Administrar pagos; podrá guardar de nuevo en cuanto se procese el pago.",
      "O seu último pagamento não foi aprovado, então salvar projetos está pausado (os seus projetos estão seguros e continuam abrindo). Atualize o cartão em Gerenciar pagamentos; salvar volta assim que o pagamento for aprovado.",
    ],
    "acct.status.unpaid": [
      "Your payments have stopped going through, so saving projects is paused (your projects are safe and still open). Update your card under Manage billing to continue.",
      "Sus pagos dejaron de procesarse, así que guardar proyectos está pausado (sus proyectos están a salvo y siguen abriéndose). Actualice su tarjeta en Administrar pagos para continuar.",
      "Os seus pagamentos deixaram de ser aprovados, então salvar projetos está pausado (os seus projetos estão seguros e continuam abrindo). Atualize o cartão em Gerenciar pagamentos para continuar.",
    ],
    "acct.status.incomplete": [
      "Your first payment hasn't gone through yet, so the plan isn't active. Finish it under Manage billing, or pick a plan again tomorrow if it has expired.",
      "Su primer pago aún no se procesó, así que el plan no está activo. Complételo en Administrar pagos o, si venció, elija un plan de nuevo mañana.",
      "O seu primeiro pagamento ainda não foi aprovado, então o plano não está ativo. Conclua-o em Gerenciar pagamentos ou, se expirou, escolha um plano de novo amanhã.",
    ],
    "acct.status.incomplete_expired": [
      "That checkout wasn't completed, so nothing was charged and you're on the free plan. Pick a plan below to try again.",
      "Ese pago no se completó, así que no se cobró nada y tiene el plan gratis. Elija un plan abajo para intentarlo de nuevo.",
      "Aquele pagamento não foi concluído, então nada foi cobrado e você está no plano grátis. Escolha um plano abaixo para tentar de novo.",
    ],
    "acct.status.paused": [
      "Your plan is paused in Stripe, so saving projects is paused too. Use Manage billing to resume it.",
      "Su plan está en pausa en Stripe, así que guardar proyectos también está pausado. Use Administrar pagos para reanudarlo.",
      "O seu plano está pausado na Stripe, então salvar projetos também está pausado. Use Gerenciar pagamentos para retomá-lo.",
    ],
    "acct.status.canceled": [
      "Your plan has ended. Your projects are still here to read; start a new plan to save again.",
      "Su plan terminó. Sus proyectos siguen aquí para leerlos; empiece un plan nuevo para volver a guardar.",
      "O seu plano terminou. Os seus projetos continuam aqui para leitura; comece um plano novo para salvar de novo.",
    ],
    "acct.status.other": [
      "Your plan isn't active right now, so saving projects is paused. Use Manage billing to sort it out, or email us.",
      "Su plan no está activo por ahora, así que guardar proyectos está pausado. Use Administrar pagos para resolverlo o escríbanos.",
      "O seu plano não está ativo no momento, então salvar projetos está pausado. Use Gerenciar pagamentos para resolver ou escreva para nós.",
    ],
    "acct.checkout.pending": [
      "Payment received. Stripe is confirming your plan; this page checks every few seconds.",
      "Pago recibido. Stripe está confirmando su plan; esta página lo comprueba cada pocos segundos.",
      "Pagamento recebido. A Stripe está confirmando o seu plano; esta página verifica a cada poucos segundos.",
    ],
    "acct.checkout.slow": [
      "Your payment went through, but confirming the plan is taking longer than usual. Refresh this page in a minute. If it still doesn't show, email us; please don't buy again.",
      "Su pago se procesó, pero confirmar el plan está tardando más de lo normal. Recargue esta página en un minuto. Si sigue sin aparecer, escríbanos; por favor no compre de nuevo.",
      "O seu pagamento foi aprovado, mas a confirmação do plano está demorando mais que o normal. Recarregue esta página em um minuto. Se ainda não aparecer, escreva para nós; por favor não compre de novo.",
    ],
    "acct.alreadySubscribed": [
      "This account already has a plan, so a second one wasn't started. Use Manage billing to change it.",
      "Esta cuenta ya tiene un plan, así que no se inició otro. Use Administrar pagos para cambiarlo.",
      "Esta conta já tem um plano, então um segundo não foi iniciado. Use Gerenciar pagamentos para mudá-lo.",
    ],
    "acct.paused.signups": [
      "New sign-ups are paused right now. If you already have an account, log in instead.",
      "El registro de cuentas nuevas está pausado por ahora. Si ya tiene una cuenta, inicie sesión.",
      "O cadastro de novas contas está pausado no momento. Se você já tem uma conta, entre.",
    ],
    "acct.paused.checkout": [
      "Buying a plan is paused right now. Please check back soon.",
      "La compra de planes está pausada por ahora. Vuelva pronto.",
      "A compra de planos está pausada no momento. Volte em breve.",
    ],
    "acct.unavailable": [
      "We couldn't reach the server. Check your connection and try again in a moment.",
      "No pudimos conectar con el servidor. Revise su conexión y vuelva a intentarlo en un momento.",
      "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo em instantes.",
    ],
    "acct.checkout.success": [
      "Thanks! Your plan will show as active in a moment.",
      "¡Gracias! Su plan aparecerá como activo en un momento.",
      "Obrigado! O seu plano vai aparecer como ativo em instantes.",
    ],
    "acct.checkout.cancelled": [
      "Checkout was cancelled. Nothing was charged.",
      "Se canceló el pago. No se cobró nada.",
      "O pagamento foi cancelado. Nada foi cobrado.",
    ],
    "acct.promo.invalid": [
      "That promo code isn't valid. Check it, or leave the box empty to continue without one.",
      "Ese código promocional no es válido. Revíselo o deje la casilla vacía para seguir sin código.",
      "Esse código promocional não é válido. Confira ou deixe o campo vazio para continuar sem código.",
    ],
    "acct.promo.used": [
      "Promo codes are for an account's first plan, and this account has had one before. Leave the box empty to continue.",
      "Los códigos promocionales son para el primer plan de una cuenta, y esta cuenta ya tuvo uno. Deje la casilla vacía para seguir.",
      "Os códigos promocionais são para o primeiro plano de uma conta, e esta conta já teve um. Deixe o campo vazio para continuar.",
    ],
    "acct.paymentsOff": [
      "Payments aren't switched on yet. Please check back soon.",
      "Los pagos aún no están activados. Vuelva pronto.",
      "Os pagamentos ainda não estão ativados. Volte em breve.",
    ],
    "acct.error": [
      "Something went wrong. Please try again.",
      "Algo salió mal. Inténtelo de nuevo.",
      "Algo deu errado. Tente de novo.",
    ],
    "acct.saved": ["Saved.", "Guardado.", "Salvo."],
    "acct.slugTaken": [
      "That web address is taken. Try another.",
      "Esa dirección web ya está en uso. Pruebe otra.",
      "Esse endereço já está em uso. Tente outro.",
    ],
    "acct.slugInvalid": [
      "Use 3 to 64 lowercase letters, numbers and dashes.",
      "Use de 3 a 64 letras minúsculas, números y guiones.",
      "Use de 3 a 64 letras minúsculas, números e hifens.",
    ],
    "acct.nameRequired": [
      "Enter your business name.",
      "Escriba el nombre de su empresa.",
      "Informe o nome da sua empresa.",
    ],
    "acct.saveBusinessFirst": [
      "Save your business details first.",
      "Primero guarde los datos de su empresa.",
      "Primeiro salve os dados da sua empresa.",
    ],
    "acct.priceInvalid": [
      "Prices must be numbers from 0 to 100,000.",
      "Los precios deben ser números de 0 a 100.000.",
      "Os preços devem ser números de 0 a 100.000.",
    ],
    "acct.delete.mismatch": [
      "That doesn't match your sign-in email.",
      "No coincide con el correo de su cuenta.",
      "Não confere com o e-mail da sua conta.",
    ],
    "acct.delete.working": ["Deleting your account…", "Eliminando su cuenta…", "Excluindo a sua conta…"],
    "acct.delete.done": [
      "Your account and everything in it were deleted.",
      "Su cuenta y todo su contenido se eliminaron.",
      "A sua conta e tudo o que havia nela foram excluídos.",
    ],
    "acct.delete.stripe": [
      "We couldn't cancel your subscription, so nothing was deleted. Cancel it under Manage billing first, or email us.",
      "No pudimos cancelar su suscripción, así que no se eliminó nada. Cancélela primero en Administrar pagos o escríbanos.",
      "Não conseguimos cancelar a sua assinatura, então nada foi excluído. Cancele-a primeiro em Gerenciar pagamentos ou escreva para nós.",
    ],
    "acct.lead.work": ["Work", "Trabajo", "Serviço"],
    "acct.lead.language": ["Language", "Idioma", "Idioma"],
    "acct.lead.delete": ["Delete", "Eliminar", "Excluir"],
    "acct.lead.deleteConfirm": [
      "Delete this request? This can't be undone.",
      "¿Eliminar esta solicitud? No se puede deshacer.",
      "Excluir este pedido? Não dá para desfazer.",
    ],
    "auth.checkEmail": [
      "Check your email to confirm your account, then log in.",
      "Revise su correo para confirmar su cuenta y luego inicie sesión.",
      "Confira o seu e-mail para confirmar a conta e depois entre.",
    ],
    "auth.exists": [
      "There's already an account for that email. Log in instead.",
      "Ya hay una cuenta con ese correo. Inicie sesión.",
      "Já existe uma conta com esse e-mail. Entre na sua conta.",
    ],
    "auth.emailRejected": [
      "That email address can't receive mail. Please use a real email address.",
      "Esa dirección no puede recibir correo. Use una dirección de correo real.",
      "Esse endereço não pode receber e-mails. Use um endereço de e-mail real.",
    ],
    "auth.rateLimited": [
      "Too many sign-up emails were sent just now. Please try again in an hour.",
      "Se enviaron demasiados correos de registro hace poco. Inténtelo de nuevo en una hora.",
      "Foram enviados e-mails de cadastro demais agora há pouco. Tente de novo daqui a uma hora.",
    ],
    "auth.badLogin": [
      "That email and password don't match.",
      "El correo y la contraseña no coinciden.",
      "O e-mail e a senha não conferem.",
    ],
    "auth.resetSent": [
      "If there's an account for that email, a reset link is on its way.",
      "Si hay una cuenta con ese correo, le enviamos un enlace para restablecer la contraseña.",
      "Se houver uma conta com esse e-mail, um link para redefinir a senha está a caminho.",
    ],
    "auth.passwordShort": ["Use at least 8 characters.", "Use al menos 8 caracteres.", "Use pelo menos 8 caracteres."],
    "auth.emailInvalid": [
      "Enter a valid email address.",
      "Escriba un correo electrónico válido.",
      "Informe um e-mail válido.",
    ],
    "auth.passwordSaved": ["Password saved.", "Contraseña guardada.", "Senha salva."],
    "auth.signedInAs": ["Signed in as {email}", "Sesión iniciada como {email}", "Conectado como {email}"],

    // ---------- design studio (js/studio.js) ----------
    "studio.step.room.title": ["Your room", "Su baño", "Seu banheiro"],
    "studio.step.room.intro": [
      "Start from a common bathroom or enter your own measurements, then mark where the doors are.",
      "Empiece con un baño típico o escriba sus propias medidas y luego marque dónde están las puertas.",
      "Comece com um banheiro comum ou informe as suas medidas e depois marque onde ficam as portas.",
    ],
    "studio.step.room.short": ["Room", "Baño", "Banheiro"],
    "studio.step.layout.title": ["Layout", "Distribución", "Distribuição"],
    "studio.step.layout.intro": [
      "Add fixtures and move them where you want them. Each one stays against a wall, and you'll see right away if something doesn't fit.",
      "Agregue piezas y muévalas adonde las quiera. Cada una queda contra una pared y verá enseguida si algo no cabe.",
      "Adicione peças e mova-as para onde quiser. Cada uma fica encostada em uma parede, e você vê na hora se algo não cabe.",
    ],
    "studio.step.layout.short": ["Layout", "Distribución", "Distribuição"],
    "studio.step.electrical.title": ["Electrical", "Electricidad", "Elétrica"],
    "studio.step.electrical.intro": [
      "Here's where the outlets, switches, lights and fan should go, worked out from your layout. Move any of them along its wall, or add your own.",
      "Aquí es donde deberían ir los tomacorrientes, los interruptores, las luces y el extractor, según su distribución. Mueva cualquiera por su pared o agregue los suyos.",
      "Aqui é onde devem ficar as tomadas, os interruptores, as luzes e o exaustor, de acordo com a sua distribuição. Mova qualquer um pela parede ou acrescente os seus.",
    ],
    "studio.step.electrical.short": ["Electrical", "Electricidad", "Elétrica"],
    "studio.step.products.title": ["Products", "Productos", "Produtos"],
    "studio.step.products.intro": [
      "Pick the Kohler and Sterling models you like. Each one is shown at its real size, and any that's too big for its spot can't be picked.",
      "Elija los modelos Kohler y Sterling que le gusten. Cada uno se muestra en su tamaño real, y los que son demasiado grandes para su lugar no se pueden elegir.",
      "Escolha os modelos Kohler e Sterling de que você gosta. Cada um aparece no tamanho real, e os que são grandes demais para o lugar não podem ser escolhidos.",
    ],
    "studio.step.products.short": ["Products", "Productos", "Produtos"],
    "studio.step.finishes.title": ["Finishes", "Acabados", "Acabamentos"],
    "studio.step.finishes.intro": [
      "Choose the floor, walls and ceiling. They show in the room as you pick them.",
      "Elija el piso, las paredes y el techo. Se ven en el baño a medida que los elige.",
      "Escolha o piso, as paredes e o teto. Eles aparecem no banheiro conforme você escolhe.",
    ],
    "studio.step.finishes.short": ["Finishes", "Acabados", "Acabamentos"],
    "studio.step.estimate.title": ["Your estimate", "Su estimación", "Sua estimativa"],
    "studio.step.estimate.intro": [
      "A rough, non-binding estimate for this design. Send it with your design to get a real quote.",
      "Una estimación aproximada y no vinculante para este diseño. Envíela con su diseño para recibir una cotización real.",
      "Uma estimativa aproximada e sem compromisso para este projeto. Envie junto com o projeto para receber um orçamento de verdade.",
    ],
    "studio.step.estimate.short": ["Estimate", "Estimación", "Estimativa"],
    "studio.step.send.title": ["Send your design", "Envíe su diseño", "Envie o seu projeto"],
    "studio.step.send.intro": [
      "Check your design, then send it to the business for a quote.",
      "Revise su diseño y luego envíelo a la empresa para recibir una cotización.",
      "Confira o seu projeto e depois envie para a empresa e receba um orçamento.",
    ],
    "studio.step.send.short": ["Send", "Enviar", "Enviar"],
    "studio.stepOf": ["Step {n} of {total}", "Paso {n} de {total}", "Etapa {n} de {total}"],
    "studio.stepNav": ["Steps", "Pasos", "Etapas"],
    "studio.back": ["Back to {step}", "Volver a {step}", "Voltar para {step}"],
    "studio.next": ["Next: {step}", "Siguiente: {step}", "Próximo: {step}"],

    "studio.type.toilet": ["Toilet", "Inodoro", "Vaso sanitário"],
    "studio.type.vanity": ["Vanity", "Mueble de lavabo", "Gabinete com pia"],
    "studio.type.sink": ["Pedestal sink", "Lavabo de pedestal", "Pia de coluna"],
    "studio.type.tub": ["Bathtub", "Bañera", "Banheira"],
    "studio.type.shower": ["Shower", "Ducha", "Box"],
    "studio.type.cabinet": ["Storage cabinet", "Armario", "Armário"],
    "studio.type.door": ["Door", "Puerta", "Porta"],
    "studio.the.toilet": ["the toilet", "el inodoro", "o vaso sanitário"],
    "studio.the.vanity": ["the vanity", "el mueble de lavabo", "o gabinete"],
    "studio.the.sink": ["the sink", "el lavabo", "a pia"],
    "studio.the.tub": ["the tub", "la bañera", "a banheira"],
    "studio.the.shower": ["the shower", "la ducha", "o box"],
    "studio.the.cabinet": ["the cabinet", "el armario", "o armário"],
    "studio.the.door": ["the door", "la puerta", "a porta"],
    "studio.the.wall": ["the wall", "la pared", "a parede"],
    "studio.the.ceiling": ["the ceiling", "el techo", "o teto"],
    "studio.short.toilet": ["Toilet", "Inodoro", "Vaso"],
    "studio.short.vanity": ["Vanity", "Mueble", "Gabinete"],
    "studio.short.sink": ["Sink", "Lavabo", "Pia"],
    "studio.short.tub": ["Tub", "Bañera", "Banheira"],
    "studio.short.shower": ["Shower", "Ducha", "Box"],
    "studio.short.cabinet": ["Cabinet", "Armario", "Armário"],
    "studio.short.newDoor": ["New", "Nueva", "Nova"],
    "studio.tone.ok": ["Fits", "Cabe", "Cabe"],
    "studio.tone.warn": ["Fits, but tight", "Cabe, pero justo", "Cabe, mas apertado"],
    "studio.tone.error": ["Doesn't fit", "No cabe", "Não cabe"],

    "studio.issue.outside": [
      "It goes past the walls of the room.",
      "Se sale de las paredes del baño.",
      "Passa das paredes do banheiro.",
    ],
    "studio.issue.tooTall": [
      "It's {need} in. tall and the ceiling is at {have} in.",
      "Mide {need} pulg. de alto y el techo está a {have} pulg.",
      "Tem {need} pol. de altura e o teto está a {have} pol.",
    ],
    "studio.issue.overlap": [
      "It takes up the same space as {other}.",
      "Ocupa el mismo lugar que {other}.",
      "Ocupa o mesmo lugar que {other}.",
    ],
    "studio.issue.side": [
      "A toilet needs {need} in. from its center to {other}; this one has {have} in.",
      "Un inodoro necesita {need} pulg. desde su centro hasta {other}; este tiene {have} pulg.",
      "O vaso precisa de {need} pol. do centro até {other}; este tem {have} pol.",
    ],
    "studio.issue.sideGap": [
      "It needs {need} in. between it and {other}; it has {have} in.",
      "Necesita {need} pulg. de separación con {other}; tiene {have} pulg.",
      "Precisa de {need} pol. de folga até {other}; tem {have} pol.",
    ],
    "studio.issue.front": [
      "It needs {need} in. of clear floor in front; {other} is {have} in. away.",
      "Necesita {need} pulg. libres al frente; {other} está a {have} pulg.",
      "Precisa de {need} pol. livres na frente; {other} está a {have} pol.",
    ],
    "studio.issue.frontWall": [
      "It needs {need} in. of clear floor in front; there are only {have} in. to the wall.",
      "Necesita {need} pulg. libres al frente; solo hay {have} pulg. hasta la pared.",
      "Precisa de {need} pol. livres na frente; só há {have} pol. até a parede.",
    ],
    "studio.issue.step": [
      "It needs a clear spot {need} in. wide along its front to step in; the widest is {have} in.",
      "Necesita un espacio libre de {need} pulg. de ancho al frente para entrar; el más ancho mide {have} pulg.",
      "Precisa de um espaço livre de {need} pol. de largura na frente para entrar; o mais largo tem {have} pol.",
    ],
    "studio.issue.swing": [
      "It's in the way of {other} as it opens.",
      "Estorba a {other} al abrirse.",
      "Está no caminho por onde {other} abre.",
    ],
    "studio.issue.blocking": [
      "It stands in the clear floor {other} needs.",
      "Ocupa el espacio libre que necesita {other}.",
      "Ocupa o espaço livre de que {other} precisa.",
    ],
    "studio.issue.tightSide": [
      "It fits, but {need} in. beside it is recommended; it has {have} in. to {other}.",
      "Cabe, pero se recomiendan {need} pulg. a los lados; tiene {have} pulg. hasta {other}.",
      "Cabe, mas o recomendado são {need} pol. dos lados; tem {have} pol. até {other}.",
    ],
    "studio.issue.tightFront": [
      "It fits, but {need} in. of clear floor in front is recommended; {other} is {have} in. away.",
      "Cabe, pero se recomiendan {need} pulg. libres al frente; {other} está a {have} pulg.",
      "Cabe, mas o recomendado são {need} pol. livres na frente; {other} está a {have} pol.",
    ],
    "studio.issue.tightFrontWall": [
      "It fits, but {need} in. of clear floor in front is recommended; there are {have} in. to the wall.",
      "Cabe, pero se recomiendan {need} pulg. libres al frente; hay {have} pulg. hasta la pared.",
      "Cabe, mas o recomendado são {need} pol. livres na frente; há {have} pol. até a parede.",
    ],

    "studio.status.ok": ["Everything fits", "Todo cabe", "Tudo cabe"],
    "studio.status.problem": ["{n} doesn't fit", "{n} no cabe", "{n} não cabe"],
    "studio.status.problems": ["{n} don't fit", "{n} no caben", "{n} não cabem"],
    "studio.status.tight": ["Fits, {n} is tight", "Cabe, {n} queda justo", "Cabe, {n} fica apertado"],
    "studio.status.tights": ["Fits, {n} are tight", "Cabe, {n} quedan justos", "Cabe, {n} ficam apertados"],
    "studio.status.drag.ok": ["Fits here", "Cabe aquí", "Cabe aqui"],
    "studio.status.drag.warn": ["Fits here, but tight", "Cabe aquí, pero justo", "Cabe aqui, mas apertado"],
    "studio.status.drag.error": ["Doesn't fit here", "No cabe aquí", "Não cabe aqui"],
    "studio.view": ["View", "Vista", "Visualização"],
    "studio.view.3d": ["3D", "3D", "3D"],
    "studio.view.plan": ["Plan", "Plano", "Planta"],
    "studio.view.walk": ["Walk in", "Entrar", "Entrar"],
    "studio.view.frame": ["Show the whole room", "Ver todo el baño", "Ver o banheiro inteiro"],
    "studio.hint.3d": [
      "Drag a fixture to move it along the walls. Drag the floor to turn the room; scroll or pinch to zoom.",
      "Arrastre una pieza para moverla por las paredes. Arrastre el piso para girar el baño; use la rueda o pellizque para acercar.",
      "Arraste uma peça para movê-la pelas paredes. Arraste o piso para girar o banheiro; role ou faça pinça para aproximar.",
    ],
    "studio.hint.plan": [
      "Drag a fixture to move it. Select one and use the arrow keys to nudge it 1 in. (with Shift, 6 in.).",
      "Arrastre una pieza para moverla. Seleccione una y use las flechas para moverla 1 pulg. (con Shift, 6 pulg.).",
      "Arraste uma peça para movê-la. Selecione uma e use as setas para movê-la 1 pol. (com Shift, 6 pol.).",
    ],
    "studio.hint.walk": [
      "You're standing in the doorway. Drag to look around.",
      "Está parado en la puerta. Arrastre para mirar alrededor.",
      "Você está na porta. Arraste para olhar ao redor.",
    ],
    "studio.walk.noDoor": [
      "Add a door first: the walk-in view starts at the door.",
      "Agregue primero una puerta: la vista para entrar empieza en la puerta.",
      "Adicione uma porta antes: a visualização de dentro começa na porta.",
    ],
    "studio.no3d": [
      "This device can't show the 3D room, so you're seeing the floor plan. Everything else works the same.",
      "Este dispositivo no puede mostrar el baño en 3D, así que ve el plano. Todo lo demás funciona igual.",
      "Este aparelho não consegue mostrar o banheiro em 3D, então você vê a planta. Todo o resto funciona igual.",
    ],
    "studio.plan.label": ["Floor plan, {w} by {l}", "Plano, {w} por {l}", "Planta, {w} por {l}"],

    "studio.undo": ["Undo", "Deshacer", "Desfazer"],
    "studio.redo": ["Redo", "Rehacer", "Refazer"],
    "studio.undone": ["Undone.", "Se deshizo.", "Desfeito."],
    "studio.redone": ["Redone.", "Se rehízo.", "Refeito."],
    "studio.share": ["Share", "Compartir", "Compartilhar"],
    "studio.startOver": ["Start over", "Empezar de nuevo", "Recomeçar"],
    "studio.startedOver": [
      "Started over with a new design.",
      "Empezó de nuevo con un diseño nuevo.",
      "Você recomeçou com um projeto novo.",
    ],
    "studio.estimateChip": ["Estimate", "Estimación", "Estimativa"],
    "studio.close": ["Close", "Cerrar", "Fechar"],
    "studio.edit": ["Edit", "Editar", "Editar"],
    "studio.deselect": ["Deselect", "Quitar la selección", "Desmarcar"],
    "studio.show": ["Show", "Mostrar", "Mostrar"],
    "studio.newTab": ["(opens in a new tab)", "(se abre en una pestaña nueva)", "(abre em uma nova aba)"],
    "studio.copyLink": ["Copy a link to this design", "Copiar el enlace de este diseño", "Copiar o link deste projeto"],
    "studio.linkCopied": ["Link copied.", "Enlace copiado.", "Link copiado."],
    "studio.openedLink": [
      "Here's the design from your link.",
      "Aquí está el diseño de su enlace.",
      "Aqui está o projeto do seu link.",
    ],
    "studio.welcomeBack": [
      "Here's the design you were working on.",
      "Aquí está el diseño en el que estaba trabajando.",
      "Aqui está o projeto em que você estava trabalhando.",
    ],
    "studio.templateUsed": ["Started from: {name}.", "Diseño inicial: {name}.", "Projeto inicial: {name}."],
    "studio.added": [
      "{name} added on wall {wall}.",
      "Listo: {name} en la pared {wall}.",
      "Pronto: {name} na parede {wall}.",
    ],
    "studio.addedNoRoom": [
      "{name} added, but there's no free spot where it fits, so it's shown in red.",
      "Se agregó {name}, pero no queda ningún lugar donde quepa, así que se muestra en rojo.",
      "{name} entrou no banheiro, mas não há lugar livre onde caiba, então aparece em vermelho.",
    ],
    "studio.removed": ["{name} removed.", "Se quitó: {name}.", "Removido do banheiro: {name}."],
    "studio.arranged": ["Room arranged.", "Baño acomodado.", "Banheiro organizado."],
    "studio.rearrange": ["Arrange for me", "Acomodar por mí", "Organizar para mim"],
    "studio.resizeBroke": [
      "With the new size, some fixtures don't fit anymore.",
      "Con la nueva medida, algunas piezas ya no caben.",
      "Com a nova medida, algumas peças não cabem mais.",
    ],
    "studio.noRoomOnWall": [
      "{name}: no spot on wall {wall} fits it, so it's shown in red.",
      "{name}: no cabe en ningún lugar de la pared {wall}, así que se muestra en rojo.",
      "{name}: não cabe em nenhum lugar da parede {wall}, então aparece em vermelho.",
    ],
    "studio.noSpot": [
      "{name}: there's no spot left in the room where it fits.",
      "{name}: no queda ningún lugar del baño donde quepa.",
      "{name}: não sobrou nenhum lugar no banheiro onde caiba.",
    ],
    "studio.dropRefused": [
      "That spot doesn't work, so it went back. {reason}",
      "Ese lugar no sirve, así que volvió a su sitio. {reason}",
      "Esse lugar não serve, então voltou para onde estava. {reason}",
    ],
    "studio.dropRefusedPlain": [
      "That spot doesn't work, so it went back.",
      "Ese lugar no sirve, así que volvió a su sitio.",
      "Esse lugar não serve, então voltou para onde estava.",
    ],

    "studio.wall": ["Wall", "Pared", "Parede"],
    "studio.wallN": ["Wall {letter}", "Pared {letter}", "Parede {letter}"],
    "studio.wallFor": ["Wall for {what}", "Pared para {what}", "Parede para {what}"],
    "studio.position": ["Position along the wall", "Posición en la pared", "Posição na parede"],
    "studio.positionOf": [
      "Position of {what} along its wall",
      "Posición de {what} en su pared",
      "Posição de {what} na parede",
    ],
    "studio.centerFromLeft": [
      "Center {at} from the left corner",
      "Centro a {at} de la esquina izquierda",
      "Centro a {at} do canto esquerdo",
    ],
    "studio.edgeFromLeft": [
      "Starts {at} from the left corner",
      "Empieza a {at} de la esquina izquierda",
      "Começa a {at} do canto esquerdo",
    ],
    "studio.itemAt": [
      "{name} on wall {wall}, center {at} from the left corner",
      "{name} en la pared {wall}, centro a {at} de la esquina izquierda",
      "{name} na parede {wall}, centro a {at} do canto esquerdo",
    ],
    "studio.itemWhere": [
      "Wall {wall}, {at} from the left",
      "Pared {wall}, a {at} de la izquierda",
      "Parede {wall}, a {at} da esquerda",
    ],
    "studio.nudgeLeft": ["Move 1 inch left", "Mover 1 pulgada a la izquierda", "Mover 1 polegada para a esquerda"],
    "studio.nudgeRight": ["Move 1 inch right", "Mover 1 pulgada a la derecha", "Mover 1 polegada para a direita"],
    "studio.gap.left": ["Left", "Izquierda", "Esquerda"],
    "studio.gap.right": ["Right", "Derecha", "Direita"],
    "studio.gap.front": ["In front", "Al frente", "Na frente"],
    "studio.gapTo": ["{gap} to {what}", "{gap} hasta {what}", "{gap} até {what}"],
    "studio.size": [
      "Size: {w} wide, {d} deep",
      "Tamaño: {w} de ancho, {d} de fondo",
      "Tamanho: {w} de largura, {d} de profundidade",
    ],
    "studio.bestSpot": ["Best spot", "Mejor lugar", "Melhor lugar"],
    "studio.nearestSpot": [
      "Nearest spot that works",
      "El lugar más cercano que sirve",
      "O lugar mais próximo que serve",
    ],
    "studio.duplicate": ["Duplicate", "Duplicar", "Duplicar"],
    "studio.remove": ["Remove", "Quitar", "Remover"],
    "studio.removeWhat": ["Remove {what}", "Quitar {what}", "Remover {what}"],
    "studio.opt.mirror": ["Mirror", "Espejo", "Espelho"],
    "studio.opt.mirror.standard": ["Standard mirror", "Espejo estándar", "Espelho padrão"],
    "studio.opt.mirror.large": ["Large mirror", "Espejo grande", "Espelho grande"],
    "studio.opt.mirror.none": ["No mirror", "Sin espejo", "Sem espelho"],
    "studio.opt.glassDoor": ["Glass door", "Puerta de vidrio", "Porta de vidro"],
    "studio.opt.shelf": ["Shower shelf", "Repisa de ducha", "Nicho no box"],
    "studio.opt.door": ["Door type", "Tipo de puerta", "Tipo de porta"],
    "studio.opt.door.existing": ["Keep the door", "Conservar la puerta", "Manter a porta"],
    "studio.opt.door.new": ["New door", "Puerta nueva", "Porta nova"],
    "studio.opt.door.opening": ["Open doorway", "Vano sin puerta", "Vão sem porta"],

    "studio.lengthHelp": [
      "Feet and inches, like 5′ 6″ or 5 6.",
      "Pies y pulgadas, como 5′ 6″ o 5 6.",
      "Pés e polegadas, como 5′ 6″ ou 5 6.",
    ],
    "studio.lengthError": [
      "Enter a length like 5′ 6″, 5 6 or 66 in.",
      "Escriba una medida como 5′ 6″, 5 6 o 66 pulg.",
      "Informe uma medida como 5′ 6″, 5 6 ou 66 pol.",
    ],
    "studio.lengthRange": [
      "Enter a length between {min} and {max}.",
      "Escriba una medida entre {min} y {max}.",
      "Informe uma medida entre {min} e {max}.",
    ],
    "studio.inchLess": ["{what}: 1 inch less", "{what}: 1 pulgada menos", "{what}: 1 polegada a menos"],
    "studio.inchMore": ["{what}: 1 inch more", "{what}: 1 pulgada más", "{what}: 1 polegada a mais"],

    "studio.room.start": ["Start from a common bathroom", "Empiece con un baño típico", "Comece com um banheiro comum"],
    "studio.template.full5x8": ["Full bath", "Baño completo", "Banheiro completo"],
    "studio.template.showerBath": ["Shower bath", "Baño con ducha", "Banheiro com box"],
    "studio.template.primary": ["Primary bath", "Baño principal", "Banheiro da suíte"],
    "studio.template.half": ["Half bath", "Medio baño", "Lavabo"],
    "studio.template.blank": ["Empty room", "Baño vacío", "Banheiro vazio"],
    "studio.room.size": ["Measurements", "Medidas", "Medidas"],
    "studio.room.width": ["Width (walls A and C)", "Ancho (paredes A y C)", "Largura (paredes A e C)"],
    "studio.room.widthHelp": [
      "Along wall A or C, wall to wall.",
      "A lo largo de la pared A o C, de pared a pared.",
      "Ao longo da parede A ou C, de parede a parede.",
    ],
    "studio.room.length": ["Length (walls B and D)", "Largo (paredes B y D)", "Comprimento (paredes B e D)"],
    "studio.room.lengthHelp": [
      "Along wall B or D, wall to wall.",
      "A lo largo de la pared B o D, de pared a pared.",
      "Ao longo da parede B ou D, de parede a parede.",
    ],
    "studio.room.height": ["Ceiling height", "Altura del techo", "Altura do teto"],
    "studio.room.heightHelp": ["From the floor to the ceiling.", "Del piso al techo.", "Do piso ao teto."],
    "studio.room.area": ["Floor area: {area} sq ft", "Área del piso: {area} pies²", "Área do piso: {area} pés²"],
    "studio.room.doors": ["Doors", "Puertas", "Portas"],
    "studio.doorN": ["Door {n}", "Puerta {n}", "Porta {n}"],
    "studio.room.noDoor": [
      "No door yet. Add one so the layout keeps its swing clear.",
      "Todavía no hay puerta. Agregue una para que la distribución deje libre su apertura.",
      "Ainda não há porta. Adicione uma para que a distribuição deixe livre a abertura dela.",
    ],
    "studio.room.addFirstDoor": ["Add a door", "Agregar una puerta", "Adicionar uma porta"],
    "studio.room.addDoor": ["Add another door", "Agregar otra puerta", "Adicionar outra porta"],

    "studio.layout.add": ["Add a fixture", "Agregar una pieza", "Adicionar uma peça"],
    "studio.layout.full": [
      "That's the most this designer holds ({n} items).",
      "Es el máximo que admite este diseñador ({n} elementos).",
      "Esse é o máximo que este projetista aceita ({n} itens).",
    ],
    "studio.layout.arrange": ["Arrange it for me", "Acomódelo por mí", "Organizar para mim"],
    "studio.layout.arrangeHelp": [
      "Keeps every fixture and door you have and finds layouts where they all fit with the space they need, with the plumbing on as few walls as possible.",
      "Conserva todas sus piezas y puertas y busca distribuciones donde todo quepa con el espacio que necesita, con la plomería en la menor cantidad de paredes posible.",
      "Mantém todas as suas peças e portas e procura distribuições em que tudo cabe com o espaço necessário, com o encanamento no menor número de paredes possível.",
    ],
    "studio.layout.arrangeBtn": [
      "Show me layouts that fit",
      "Mostrarme distribuciones que caben",
      "Mostrar distribuições que cabem",
    ],
    "studio.layout.arranging": ["Finding layouts…", "Buscando distribuciones…", "Procurando distribuições…"],
    "studio.layout.noArrangement": [
      "No layout works in this room. Try fewer or smaller fixtures, or a bigger room.",
      "Ninguna distribución funciona en este baño. Pruebe con menos piezas o más pequeñas, o con un baño más grande.",
      "Nenhuma distribuição funciona neste banheiro. Tente menos peças, peças menores ou um banheiro maior.",
    ],
    "studio.layout.onlyOne": [
      "Your layout is the only one where everything fits in this room. For other options, make the room bigger or take something out.",
      "Su distribución es la única en la que todo cabe en este baño. Para tener otras opciones, agrande el baño o quite alguna pieza.",
      "Sua distribuição é a única em que tudo cabe neste banheiro. Para ter outras opções, aumente o banheiro ou tire alguma peça.",
    ],
    "studio.layout.closest": [
      "Not everything fits in this room. These layouts come closest; the pieces in red still need a bigger room or a smaller model.",
      "No todo cabe en este baño. Estas distribuciones son las que más se acercan; las piezas en rojo todavía necesitan un baño más grande o un modelo más chico.",
      "Nem tudo cabe neste banheiro. Estas distribuições são as que chegam mais perto; as peças em vermelho ainda precisam de um banheiro maior ou de um modelo menor.",
    ],
    "studio.layout.allFit": ["Everything fits", "Todo cabe", "Tudo cabe"],
    "studio.layout.someFit": ["{n} of {total} fit", "Caben {n} de {total}", "Cabem {n} de {total}"],
    "studio.layout.current": ["Your layout now", "Su distribución actual", "Sua distribuição atual"],
    "studio.layout.use": ["Use this layout", "Usar esta distribución", "Usar esta distribuição"],
    "studio.layout.check": ["Needs attention", "Requiere atención", "Precisa de atenção"],
    "studio.layout.inRoom": ["In the room", "En el baño", "No banheiro"],
    "studio.layout.empty": [
      "Nothing in the room yet. Add a fixture above, or pick a starting bathroom in step 1.",
      "Todavía no hay nada en el baño. Agregue una pieza arriba o elija un baño inicial en el paso 1.",
      "Ainda não há nada no banheiro. Adicione uma peça acima ou escolha um banheiro inicial na etapa 1.",
    ],

    "studio.products.empty": [
      "Add a toilet, sink, vanity, tub or shower to pick its products.",
      "Agregue un inodoro, lavabo, mueble de lavabo, bañera o ducha para elegir sus productos.",
      "Adicione um vaso, pia, gabinete, banheira ou box para escolher os produtos.",
    ],
    "studio.products.show": ["Show in 3D", "Ver en 3D", "Ver em 3D"],
    "studio.photos.show": ["Show examples", "Ver ejemplos", "Ver exemplos"],
    "studio.photos.showFor": [
      "Show examples of {product} in real homes",
      "Ver ejemplos de {product} en casas reales",
      "Ver exemplos de {product} em casas reais",
    ],
    "studio.photos.alt": [
      "{product}, photo {n} of {total}",
      "{product}, foto {n} de {total}",
      "{product}, foto {n} de {total}",
    ],
    "studio.photos.count": ["{n} of {total}", "{n} de {total}", "{n} de {total}"],
    "studio.photos.prev": ["Previous photo", "Foto anterior", "Foto anterior"],
    "studio.photos.next": ["Next photo", "Foto siguiente", "Próxima foto"],
    "studio.photos.goTo": ["Show photo {n}", "Ver la foto {n}", "Ver a foto {n}"],
    "studio.photos.close": ["Close", "Cerrar", "Fechar"],
    "studio.photos.credit": [
      "Photos from the product's Home Depot listing.",
      "Fotos del anuncio del producto en Home Depot.",
      "Fotos do anúncio do produto na Home Depot.",
    ],
    "studio.photos.listing": ["See the listing", "Ver el anuncio", "Ver o anúncio"],
    "studio.photos.noHome": [
      "The listing has no photos of this one in a home, so these are its product photos.",
      "El anuncio no tiene fotos de este producto en una casa, así que estas son sus fotos de producto.",
      "O anúncio não tem fotos deste produto em uma casa, então estas são as fotos do produto.",
    ],
    "studio.photos.none": [
      "We don't have photos of this model yet. Its listing may have some.",
      "Todavía no tenemos fotos de este modelo. Puede que su anuncio tenga algunas.",
      "Ainda não temos fotos deste modelo. O anúncio dele pode ter algumas.",
    ],
    "studio.products.useKohler": [
      "Use real Kohler and Sterling products",
      "Usar productos Kohler y Sterling reales",
      "Usar produtos Kohler e Sterling reais",
    ],
    "studio.products.priceNote": [
      "Every product is a real Kohler or Sterling model at its real size. Prices vary by store, so the estimate lists them with their model numbers instead of adding them in.",
      "Cada producto es un modelo Kohler o Sterling real en su tamaño real. Los precios varían según la tienda, así que la estimación los muestra con su número de modelo en lugar de sumarlos.",
      "Cada produto é um modelo Kohler ou Sterling real no tamanho real. Os preços variam conforme a loja, então a estimativa mostra os produtos com o número do modelo em vez de somá-los.",
    ],

    "studio.finish.demo": ["Demolition", "Demolición", "Demolição"],
    "studio.finish.demoLabel": [
      "Remove the old bathroom first",
      "Quitar primero el baño actual",
      "Retirar antes o banheiro atual",
    ],
    "studio.finish.demoHelp": [
      "Take out the old fixtures, tile and flooring before the new work.",
      "Retirar los accesorios, el azulejo y el piso viejos antes del trabajo nuevo.",
      "Retirar as peças, o revestimento e o piso antigos antes do serviço novo.",
    ],
    "studio.finish.floor": ["Floor", "Piso", "Piso"],
    "studio.finish.floor.tile": ["Tile", "Azulejo", "Cerâmica"],
    "studio.finish.floor.flooring": ["Vinyl plank", "Vinílico en tablas", "Piso vinílico"],
    "studio.finish.floor.none": ["Keep the floor", "Dejar el piso", "Manter o piso"],
    "studio.finish.walls": ["Walls", "Paredes", "Paredes"],
    "studio.finish.walls.paint": ["Paint", "Pintura", "Pintura"],
    "studio.finish.walls.tileWet": [
      "Tile around the tub",
      "Azulejo alrededor de la bañera",
      "Revestimento em volta da banheira",
    ],
    "studio.finish.walls.tile": ["Tile to the ceiling", "Azulejo hasta el techo", "Revestimento até o teto"],
    "studio.finish.walls.none": ["Leave as they are", "Dejarlas como están", "Deixar como estão"],
    "studio.finish.wallTile": ["Wall tile", "Azulejo de pared", "Revestimento de parede"],
    "studio.finish.wallPaint": ["Paint", "Pintura", "Tinta"],
    "studio.finish.ceiling": ["Ceiling", "Techo", "Teto"],
    "studio.finish.ceilingLabel": ["Paint the ceiling", "Pintar el techo", "Pintar o teto"],
    "studio.finish.product": ["Product", "Producto", "Produto"],
    "studio.finish.notPriced": [
      "The finishes you pick show in 3D and go with your design. This business prices the materials in its quote, so they aren't in the estimate.",
      "Los acabados que elija se ven en 3D y van con su diseño. Esta empresa cotiza los materiales aparte, así que no están en la estimación.",
      "Os acabamentos que você escolher aparecem em 3D e vão junto com o projeto. Esta empresa orça os materiais à parte, então eles não estão na estimativa.",
    ],
    "studio.perSqFt": ["{price}/sq ft", "{price}/pie²", "{price}/pé²"],
    "studio.perGallon": ["{price}/gal", "{price}/galón", "{price}/galão"],
    "studio.material.floorTile": ["Floor tile", "Azulejo de piso", "Piso cerâmico"],
    "studio.material.flooring": ["Flooring", "Piso", "Piso"],
    "studio.material.wallTile": ["Wall tile", "Azulejo de pared", "Revestimento de parede"],
    "studio.material.wallPaint": ["Wall paint", "Pintura de paredes", "Tinta das paredes"],
    "studio.material.ceilingPaint": ["Ceiling paint", "Pintura del techo", "Tinta do teto"],

    "studio.est.problem": [
      "{n} item in your layout doesn't fit yet. Fix it so the design can really be built.",
      "{n} elemento de su diseño todavía no cabe. Corríjalo para que el diseño se pueda construir.",
      "{n} item do seu projeto ainda não cabe. Corrija para que o projeto possa ser construído de verdade.",
    ],
    "studio.est.problems": [
      "{n} items in your layout don't fit yet. Fix them so the design can really be built.",
      "{n} elementos de su diseño todavía no caben. Corríjalos para que el diseño se pueda construir.",
      "{n} itens do seu projeto ainda não cabem. Corrija para que o projeto possa ser construído de verdade.",
    ],
    "studio.est.fix": ["Show me", "Mostrarme", "Mostrar"],
    "studio.est.elecGaps": [
      "Not in this price yet: {list}",
      "Todavía no está en este precio: {list}",
      "Ainda não está neste preço: {list}",
    ],
    "studio.est.elecFill": ["Add them", "Agregarlos", "Adicionar"],
    "studio.est.labor": ["Labor", "Mano de obra", "Mão de obra"],
    "studio.est.materials": ["Materials", "Materiales", "Materiais"],
    "studio.est.materialQty": [
      "Tile and flooring quantities include {waste}% extra for cuts; paint covers {coats} coats.",
      "Las cantidades de azulejo y piso incluyen un {waste}% extra para cortes; la pintura cubre {coats} manos.",
      "As quantidades de revestimento e piso incluem {waste}% a mais para recortes; a tinta cobre {coats} demãos.",
    ],
    "studio.est.products": [
      "Kohler and Sterling products in your design",
      "Productos Kohler y Sterling de su diseño",
      "Produtos Kohler e Sterling do seu projeto",
    ],
    "studio.est.productsNotPriced": [
      "The Kohler and Sterling products aren't in the total because their prices vary by store. Each one is listed with its model number.",
      "Los productos Kohler y Sterling no están en el total porque su precio varía según la tienda. Cada uno aparece con su número de modelo.",
      "Os produtos Kohler e Sterling não estão no total porque o preço varia conforme a loja. Cada um aparece com o número do modelo.",
    ],
    "studio.est.findAt": ["Find it at Home Depot", "Buscar en Home Depot", "Procurar na Home Depot"],
    "studio.est.pdf": ["Download PDF", "Descargar PDF", "Baixar PDF"],
    "studio.est.yourDesign": ["Your design", "Su diseño", "Seu projeto"],
    "studio.est.send": [
      "Send your design to {business}",
      "Envíe su diseño a {business}",
      "Envie o seu projeto para {business}",
    ],
    "studio.est.sendHelp": [
      "They get your design, its estimate and a link that opens it just as you left it.",
      "Recibirán su diseño, su estimación y un enlace que lo abre tal como lo dejó.",
      "Eles recebem o seu projeto, a estimativa e um link que abre o projeto do jeito que você deixou.",
    ],

    "studio.sum.title": ["My bathroom design:", "Mi diseño de baño:", "Meu projeto de banheiro:"],
    "studio.sum.room": [
      "Room: {w} × {l}, ceiling {h}",
      "Baño: {w} × {l}, techo de {h}",
      "Banheiro: {w} × {l}, teto de {h}",
    ],
    "studio.sum.door": [
      "Door on wall {wall}: {kind}",
      "Puerta en la pared {wall}: {kind}",
      "Porta na parede {wall}: {kind}",
    ],
    // ---------- the electrical step ----------
    "studio.elec.outlet": ["Outlet", "Tomacorriente", "Tomada"],
    "studio.elec.switch": ["Switch", "Interruptor", "Interruptor"],
    "studio.elec.light": ["Light", "Luz", "Luz"],
    "studio.elec.fan": ["Exhaust fan", "Extractor", "Exaustor"],
    "studio.elec.add": ["Add a point", "Agregar un punto", "Adicionar um ponto"],
    "studio.elec.addHelp": [
      "Everything below is suggested from your layout. Drag any of it in the room, or add what you want.",
      "Todo lo de abajo se sugiere a partir de su distribución. Arrastre lo que quiera en el baño o agregue lo que necesite.",
      "Tudo abaixo é sugerido a partir da sua distribuição. Arraste qualquer item no banheiro ou acrescente o que quiser.",
    ],
    "studio.elec.suggestBtn": ["Suggest what's missing", "Sugerir lo que falta", "Sugerir o que falta"],
    "studio.elec.full": [
      "That's all {n} points this room can hold.",
      "Esos son los {n} puntos que cabe en este baño.",
      "Esses são os {n} pontos que este banheiro aceita.",
    ],
    "studio.elec.missing": ["Still missing", "Todavía falta", "Ainda falta"],
    "studio.elec.inRoom": ["In the room", "En el baño", "No banheiro"],
    "studio.elec.empty": [
      "Nothing wired yet. Add a point, or let us suggest them.",
      "Todavía no hay nada. Agregue un punto o deje que se lo sugiramos.",
      "Ainda não há nada. Adicione um ponto ou deixe que a gente sugira.",
    ],
    "studio.elec.height": ["Height", "Altura", "Altura"],
    "studio.elec.inCeiling": ["in the ceiling", "en el techo", "no teto"],
    "studio.elec.fanFixed": [
      "The fan goes in the ceiling over the tub or shower.",
      "El extractor va en el techo sobre la bañera o la ducha.",
      "O exaustor fica no teto sobre a banheira ou o chuveiro.",
    ],
    "studio.elec.fine": ["Nothing to flag on this one.", "Nada que señalar en este.", "Nada a apontar neste."],
    "studio.elec.disclaimer": [
      "These follow the usual US residential rules as guidance. Your electrician decides what actually gets installed.",
      "Esto sigue las reglas residenciales habituales de EE. UU. como orientación. Su electricista decide qué se instala realmente.",
      "Isto segue as regras residenciais usuais dos EUA como orientação. Seu eletricista decide o que é instalado de fato.",
    ],
    "studio.elec.added": ["{name} added.", "{name} agregado.", "{name} adicionado."],
    "studio.elec.nothingToAdd": [
      "Everything the rules ask for is already here.",
      "Ya está todo lo que piden las reglas.",
      "Já está tudo o que as regras pedem.",
    ],
    "studio.elec.suggested": ["Added {n} point(s).", "Se agregaron {n} punto(s).", "Foram adicionados {n} ponto(s)."],
    "studio.elec.over": ["over {what}", "sobre {what}", "sobre {what}"],
    "studio.elec.beside": ["beside {what}", "al lado de {what}", "ao lado de {what}"],
    "studio.elec.forFan": ["for the exhaust fan", "para el extractor", "para o exaustor"],
    "studio.elec.gap.noOutlet": [
      "{what} needs a GFCI outlet within 36 in. of it.",
      "{what} necesita un tomacorriente GFCI a menos de 36 pulg.",
      "{what} precisa de uma tomada GFCI a menos de 36 pol.",
    ],
    "studio.elec.gap.noLightOver": [
      "{what} has no light over its mirror.",
      "{what} no tiene luz sobre su espejo.",
      "{what} não tem luz sobre o espelho.",
    ],
    "studio.elec.gap.noLight": [
      "There's no light in the room yet.",
      "Todavía no hay ninguna luz en el baño.",
      "Ainda não há nenhuma luz no banheiro.",
    ],
    "studio.elec.gap.noSwitch": [
      "{what} has no switch beside it.",
      "{what} no tiene un interruptor al lado.",
      "{what} não tem um interruptor ao lado.",
    ],
    "studio.elec.gap.noFan": [
      "A bathroom with a tub or shower needs an exhaust fan.",
      "Un baño con bañera o ducha necesita un extractor.",
      "Um banheiro com banheira ou chuveiro precisa de um exaustor.",
    ],
    "studio.elecIssue.outside": [
      "It's past the end of the wall.",
      "Queda más allá del final de la pared.",
      "Fica além do fim da parede.",
    ],
    "studio.elecIssue.outsideUp": [
      "It's higher than the ceiling.",
      "Queda más alto que el techo.",
      "Fica mais alto que o teto.",
    ],
    "studio.elecIssue.wet": [
      "It's within {feet} of the tub or shower, where no outlet or switch may go.",
      "Está a menos de {feet} de la bañera o la ducha, donde no puede haber tomacorrientes ni interruptores.",
      "Está a menos de {feet} da banheira ou do chuveiro, onde não pode haver tomada nem interruptor.",
    ],
    "studio.elecIssue.behind": [
      "It's behind {other}, where nobody could reach it.",
      "Queda detrás de {other}, donde nadie lo alcanzaría.",
      "Fica atrás de {other}, onde ninguém alcançaria.",
    ],
    "studio.elecIssue.crowded": [
      "It's right on top of {other}.",
      "Está justo encima de {other}.",
      "Está em cima de {other}.",
    ],
    "studio.elecIssue.farBasin": [
      "A basin's outlet has to be within {need} in. of it; this one is {have} in. away.",
      "El tomacorriente de un lavabo debe estar a menos de {need} pulg.; este está a {have} pulg.",
      "A tomada de uma pia precisa estar a menos de {need} pol.; esta está a {have} pol.",
    ],
    "studio.pointAt": [
      "{name}, wall {wall} at {at}, {up} up",
      "{name}, pared {wall} a {at}, {up} de alto",
      "{name}, parede {wall} a {at}, {up} de altura",
    ],
    "studio.pointCeiling": ["{name}, in the ceiling", "{name}, en el techo", "{name}, no teto"],
    "studio.pointWhere": [
      "Wall {wall} at {at}, {up} up",
      "Pared {wall} a {at}, {up} de alto",
      "Parede {wall} a {at}, {up} de altura",
    ],
    // ---------- the plumbing wall ----------
    "studio.room.plumbing": ["Plumbing", "Plomería", "Hidráulica"],
    "studio.room.plumbingHelp": [
      "The drains all run to one wall, the one with the stack in it. Pick the wall your toilet is on today: fixtures on it tie straight in, and anything further away needs a new drain line run to it.",
      "Todos los desagües van a una sola pared, la que tiene la bajante. Elija la pared donde está hoy su inodoro: las piezas en esa pared se conectan directamente y cualquier otra necesita una nueva línea de desagüe.",
      "Todos os ralos vão para uma única parede, a que tem a prumada. Escolha a parede onde está hoje o seu vaso sanitário: as peças nela se ligam direto e qualquer outra precisa de uma nova linha de esgoto.",
    ],
    "studio.room.plumbingWall": ["Wall with the plumbing", "Pared con la plomería", "Parede com a hidráulica"],
    "studio.room.plumbingRun": [
      "As it stands, the layout needs {run} of new drain line.",
      "Como está, la distribución necesita {run} de nueva línea de desagüe.",
      "Como está, a distribuição precisa de {run} de nova linha de esgoto.",
    ],
    "studio.room.plumbingUnset": [
      "Not picked yet. Until you pick, drains are measured from wall {wall}.",
      "Aún sin elegir. Mientras tanto, los desagües se miden desde la pared {wall}.",
      "Ainda não escolhida. Até lá, os ralos são medidos a partir da parede {wall}.",
    ],
    // ---------- what a step needs before moving on ----------
    "studio.need": ["To go on: {list}.", "Para continuar: {list}.", "Para continuar: {list}."],
    "studio.need.stack": [
      "pick the wall your plumbing is in",
      "elija la pared donde está la plomería",
      "escolha a parede onde fica a hidráulica",
    ],
    "studio.need.size": ["fix the room size", "corrija la medida del baño", "corrija a medida do banheiro"],
    "studio.need.fixture": ["add at least one fixture", "agregue al menos una pieza", "adicione pelo menos uma peça"],
    "studio.need.fit": [
      "move or remove what doesn't fit ({what})",
      "mueva o quite lo que no cabe ({what})",
      "mova ou tire o que não cabe ({what})",
    ],
    "studio.need.points": [
      "fix the electrical marked in red",
      "corrija la parte eléctrica marcada en rojo",
      "corrija a parte elétrica marcada em vermelho",
    ],
    "studio.need.products": [
      "pick a product for: {list}",
      "elija un producto para: {list}",
      "escolha um produto para: {list}",
    ],
    "studio.need.productsMany": [
      "pick a product in each list that still says “Choose one…” ({n} left)",
      "elija un producto en cada lista que aún dice «Elija uno…» (faltan {n})",
      "escolha um produto em cada lista que ainda diz “Escolha um…” (faltam {n})",
    ],
    "studio.need.surfaces": [
      "pick a finish for: {list}",
      "elija un acabado para: {list}",
      "escolha um acabamento para: {list}",
    ],
    "studio.need.surface.floorTile": ["floor tile", "azulejo del piso", "cerâmica do piso"],
    "studio.need.surface.flooring": ["flooring", "piso vinílico", "piso vinílico"],
    "studio.need.surface.wallTile": ["wall tile", "azulejo de pared", "revestimento de parede"],
    "studio.need.surface.wallPaint": ["wall paint", "pintura de paredes", "tinta das paredes"],
    "studio.need.surface.ceilingPaint": ["ceiling paint", "pintura del techo", "tinta do teto"],
    "studio.products.choose": ["Choose one…", "Elija uno…", "Escolha um…"],
    "studio.room.plumbingNone": [
      "Everything with a drain is on that wall, so there's no new pipe to run.",
      "Todo lo que tiene desagüe está en esa pared, así que no hay tubería nueva que correr.",
      "Tudo o que tem ralo está nessa parede, então não há tubulação nova a passar.",
    ],
    "studio.room.plumbingSet": [
      "Plumbing wall: {wall}",
      "Pared de la plomería: {wall}",
      "Parede da hidráulica: {wall}",
    ],
    "studio.room.plumbingBroke": [
      "Some fixtures are now too far from the plumbing.",
      "Algunas piezas quedaron demasiado lejos de la plomería.",
      "Algumas peças ficaram longe demais da hidráulica.",
    ],
    "studio.issue.offStack": [
      "It's off the plumbing wall: {run} of new drain line to wall {wall}.",
      "Está fuera de la pared de la plomería: {run} de nueva línea de desagüe hasta la pared {wall}.",
      "Está fora da parede hidráulica: {run} de nova linha de esgoto até a parede {wall}.",
    ],
    "studio.issue.noStack": [
      "It's too far from the plumbing in wall {wall} for its drain to fall: {run} of pipe, and {most} is the most it can run.",
      "Está demasiado lejos de la plomería de la pared {wall} para que caiga su desagüe: {run} de tubería, y {most} es lo máximo.",
      "Está longe demais da hidráulica da parede {wall} para o ralo ter queda: {run} de tubulação, e {most} é o máximo.",
    ],
    // ---------- isolating what's being worked on ----------
    "studio.view.isolate": ["Just this", "Solo esto", "Só isto"],
    "studio.view.isolateOn": ["Showing just this", "Mostrando solo esto", "Mostrando só isto"],
    "studio.view.isolateHelp": [
      "Show only {what}, with everything else out of the way",
      "Mostrar solo {what}, con todo lo demás fuera del camino",
      "Mostrar só {what}, com todo o resto fora do caminho",
    ],
    "studio.sum.stack": ["Plumbing wall: {wall}", "Pared de la plomería: {wall}", "Parede hidráulica: {wall}"],
    "studio.sum.drainRun": ["New drain line: {run}", "Nueva línea de desagüe: {run}", "Nova linha de esgoto: {run}"],
    "studio.sum.electrical": ["Electrical: {list}", "Electricidad: {list}", "Elétrica: {list}"],
    "studio.sum.item": [
      "{name}: wall {wall}, center {at} from the left corner",
      "{name}: pared {wall}, centro a {at} de la esquina izquierda",
      "{name}: parede {wall}, centro a {at} do canto esquerdo",
    ],
    "studio.sum.work": ["Work: {scope}", "Trabajo: {scope}", "Serviço: {scope}"],
    "studio.sum.labor": [
      "Labor estimate: {total}",
      "Estimación de mano de obra: {total}",
      "Estimativa de mão de obra: {total}",
    ],
    "studio.sum.materials": ["Materials: {total}", "Materiales: {total}", "Materiais: {total}"],
    "studio.sum.problems": [
      "Note: {n} item(s) in the layout don't fit yet.",
      "Nota: {n} elemento(s) del diseño todavía no caben.",
      "Obs.: {n} item(ns) do projeto ainda não cabem.",
    ],
    "studio.sum.link": ["Open the design in 3D:", "Abrir el diseño en 3D:", "Abrir o projeto em 3D:"],
    "studio.pdf.title": [
      "Bathroom design and estimate",
      "Diseño y estimación del baño",
      "Projeto e estimativa do banheiro",
    ],
    "studio.pdf.titleDesign": ["Bathroom design", "Diseño del baño", "Projeto do banheiro"],
    "studio.pdf.plan": ["Floor plan", "Plano", "Planta baixa"],
    "studio.pdf.design": ["Your design", "Su diseño", "Seu projeto"],
    "studio.pdf.link": ["Open this design", "Abrir este diseño", "Abrir este projeto"],
    "studio.pdf.open": [
      "Click here to open this design in 3D",
      "Haga clic aquí para abrir este diseño en 3D",
      "Clique aqui para abrir este projeto em 3D",
    ],

    // ---------- 3D room (js/bathroom-room-3d.js) ----------
    "room3d.canvasLabel": [
      "3D view of your bathroom. Drag a fixture to move it, or drag anywhere else to turn the view. Everything can also be done from the panel and the floor plan.",
      "Vista 3D de su baño. Arrastre una pieza para moverla, o arrastre en otro lugar para girar la vista. Todo se puede hacer también desde el panel y el plano.",
      "Vista em 3D do seu banheiro. Arraste uma peça para movê-la ou arraste em outro lugar para girar a vista. Tudo também pode ser feito pelo painel e pela planta.",
    ],
    "room3d.tooBig": ["Too big for this room", "Demasiado grande para este baño", "Grande demais para este banheiro"],
    "room3d.slot.tub": ["Tub", "Bañera", "Banheira"],
    "room3d.slot.tubFaucet": ["Tub faucet", "Llave de la bañera", "Torneira da banheira"],
    "room3d.slot.vanity": ["Vanity cabinet", "Mueble", "Gabinete"],
    "room3d.slot.vanityLight": ["Vanity light", "Lámpara del espejo", "Luminária do espelho"],
    "room3d.slot.vanitySink": ["Vanity sink", "Lavabo del mueble", "Cuba do gabinete"],
    "room3d.slot.vanityFaucet": ["Sink faucet", "Llave del lavabo", "Torneira da pia"],
    "room3d.slot.showerValve": ["Shower valve", "Válvula de la ducha", "Registro do chuveiro"],
    "room3d.slot.toilet": ["Toilet", "Inodoro", "Vaso sanitário"],
    "room3d.slot.paperHolder": ["Paper holder", "Portarrollos", "Porta-papel"],
    "room3d.slot.towelBar": ["Towel bar", "Toallero", "Toalheiro"],
    "room3d.slot.exhaustFan": ["Exhaust fan", "Extractor", "Exaustor"],
    "room3d.slot.tubValve": ["Tub valve", "Válvula de la bañera", "Registro da banheira"],
    "room3d.slot.tubGrabBar": ["Tub grab bar", "Barra de apoyo de la bañera", "Barra de apoio da banheira"],
    "room3d.slot.sink": ["Pedestal/wall sink", "Lavabo de pedestal o de pared", "Pia de coluna ou de parede"],
    "room3d.slot.sinkFaucet": ["Pedestal/wall faucet", "Llave del lavabo de pedestal", "Torneira da pia de coluna"],
    "room3d.slot.showerBase": ["Shower base", "Base de ducha", "Base do box"],
    "room3d.slot.showerWalls": ["Shower walls", "Paredes de la ducha", "Paredes do box"],
    "room3d.slot.showerDoor": ["Shower door", "Puerta de la ducha", "Porta do box"],
    "room3d.slot.showerHead": ["Showerhead", "Regadera", "Chuveiro"],
    "room3d.slot.showerGrabBar": ["Shower grab bar", "Barra de apoyo de la ducha", "Barra de apoio do box"],
    "room3d.slot.showerShelf": ["Shower shelf", "Repisa de la ducha", "Prateleira do box"],
    "room3d.slot.mirror": ["Mirror", "Espejo", "Espelho"],
    "room3d.slot.mirrorLarge": ["Large mirror", "Espejo grande", "Espelho grande"],
    "room3d.slot.robeHook": ["Robe hook", "Gancho para bata", "Gancho para roupão"],
    "room3d.modelFailed": [
      "Couldn't load the 3D model for {list}, so a stand-in is showing. It's still in your estimate. Change anything in the room to try again.",
      "No se pudo cargar el modelo 3D de {list}, así que se muestra uno genérico. Sigue incluido en su estimación. Cambie cualquier cosa en el baño para intentarlo de nuevo.",
      "Não foi possível carregar o modelo 3D de {list}, então um genérico está aparecendo. Ele continua na sua estimativa. Mude qualquer coisa no banheiro para tentar de novo.",
    ],
    "room3d.group.toilet": ["Toilet", "Inodoro", "Vaso sanitário"],
    "room3d.group.tub": ["Tub", "Bañera", "Banheira"],
    "room3d.group.vanity": ["Vanity", "Mueble de baño", "Gabinete"],
    "room3d.group.sink": ["Sink", "Lavabo", "Pia"],
    "room3d.group.shower": ["Shower", "Ducha", "Box"],
    "room3d.group.mirror": ["Mirrors", "Espejos", "Espelhos"],
    "room3d.group.door": ["Door", "Puerta", "Porta"],
    "room3d.group.lighting": ["Lighting", "Iluminación", "Iluminação"],
    "room3d.tooLong": ["Too long for this shower", "Demasiado larga para esta ducha", "Comprida demais para este box"],
    "room3d.noFit": ["Not made for this base", "No es para esta base", "Não é para esta base"],
    "room3d.needsDeck": [
      "Needs a drop-in tub's deck",
      "Necesita la cubierta de una bañera empotrada",
      "Precisa do deck de uma banheira embutida",
    ],
    "room3d.needsFreestanding": [
      "For freestanding tubs only",
      "Solo para bañeras independientes",
      "Só para banheiras de chão",
    ],
    "room3d.faucetHasHandles": [
      "The tub faucet has its own handles",
      "La llave de la bañera ya tiene sus manijas",
      "A torneira da banheira já tem seus registros",
    ],
    "room3d.ceilingTooLow": [
      "Too tall for this ceiling",
      "Demasiado alto para este techo",
      "Alto demais para este teto",
    ],
    "room3d.wrongHoles": [
      "Doesn't fit this sink's faucet holes",
      "No coincide con los orificios de este lavabo",
      "Não serve nos furos desta pia",
    ],
    "room3d.option.freestanding": [
      "Stargaze 60 in. freestanding",
      "Stargaze 60 pulg. independiente",
      "Stargaze 60 pol. independente",
    ],
    "room3d.option.K-1184-0": [
      "Devonshire 60 in. alcove",
      "Devonshire 60 pulg. empotrada",
      "Devonshire 60 pol. embutida",
    ],
    "room3d.option.K-1163-0": ["Sunward 60 in. oval", "Sunward 60 pulg. ovalada", "Sunward 60 pol. oval"],
    "room3d.option.K-1165-0": ["Sunward 72 in. oval", "Sunward 72 pulg. ovalada", "Sunward 72 pol. oval"],
    "room3d.option.K-14426-CP": ["Purist wall spout", "Purist, caño de pared", "Purist, bica de parede"],
    "room3d.option.K-73081-4-CP": [
      "Composed deck-mount filler",
      "Composed, llenador sobre cubierta",
      "Composed, misturador de borda",
    ],
    "room3d.option.standard-vanity": [
      "Built to fit (pick the sink below)",
      "A medida (elige el lavabo abajo)",
      "Sob medida (escolha a cuba abaixo)",
    ],
    "room3d.option.K-33577-ASB-0": [
      "Winnow 24 in. white, quartz top",
      "Winnow blanco de 24 pulg., cubierta de cuarzo",
      "Winnow branco de 24 pol., tampo de quartzo",
    ],
    "room3d.option.K-33578-ASB-0": [
      "Winnow 30 in. white, quartz top",
      "Winnow blanco de 30 pulg., cubierta de cuarzo",
      "Winnow branco de 30 pol., tampo de quartzo",
    ],
    "room3d.option.K-33579-ASB-0": [
      "Winnow 36 in. white, quartz top",
      "Winnow blanco de 36 pulg., cubierta de cuarzo",
      "Winnow branco de 36 pol., tampo de quartzo",
    ],
    "room3d.option.K-33580-ASB-0": [
      "Winnow 48 in. white, quartz top",
      "Winnow blanco de 48 pulg., cubierta de cuarzo",
      "Winnow branco de 48 pol., tampo de quartzo",
    ],
    "room3d.option.K-33535-ASB-0": [
      "Hearthaven 24 in. white, quartz top",
      "Hearthaven blanco de 24 pulg., cubierta de cuarzo",
      "Hearthaven branco de 24 pol., tampo de quartzo",
    ],
    "room3d.option.K-33536-ASB-0": [
      "Hearthaven 31 in. white, quartz top",
      "Hearthaven blanco de 31 pulg., cubierta de cuarzo",
      "Hearthaven branco de 31 pol., tampo de quartzo",
    ],
    "room3d.option.K-33537-ASB-0": [
      "Hearthaven 37 in. white, quartz top",
      "Hearthaven blanco de 37 pulg., cubierta de cuarzo",
      "Hearthaven branco de 37 pol., tampo de quartzo",
    ],
    "room3d.option.K-33538-ASB-0": [
      "Hearthaven 49 in. white, quartz top",
      "Hearthaven blanco de 49 pulg., cubierta de cuarzo",
      "Hearthaven branco de 49 pol., tampo de quartzo",
    ],
    "room3d.option.K-33551-ASB-0": [
      "Seer 24 in. white, quartz top",
      "Seer blanco de 24 pulg., cubierta de cuarzo",
      "Seer branco de 24 pol., tampo de quartzo",
    ],
    "room3d.option.K-33552-ASB-0": [
      "Seer 30 in. white, quartz top",
      "Seer blanco de 30 pulg., cubierta de cuarzo",
      "Seer branco de 30 pol., tampo de quartzo",
    ],
    "room3d.option.K-33553-ASB-0": [
      "Seer 36 in. white, quartz top",
      "Seer blanco de 36 pulg., cubierta de cuarzo",
      "Seer branco de 36 pol., tampo de quartzo",
    ],
    "room3d.option.K-33554-ASB-0": [
      "Seer 48 in. white, quartz top",
      "Seer blanco de 48 pulg., cubierta de cuarzo",
      "Seer branco de 48 pol., tampo de quartzo",
    ],
    "room3d.option.K-33543-ASB-0": [
      "Southerk 23 in. white, quartz top",
      "Southerk blanco de 23 pulg., cubierta de cuarzo",
      "Southerk branco de 23 pol., tampo de quartzo",
    ],
    "room3d.option.K-33545-ASB-0": [
      "Southerk 37 in. white, quartz top",
      "Southerk blanco de 37 pulg., cubierta de cuarzo",
      "Southerk branco de 37 pol., tampo de quartzo",
    ],
    "room3d.option.K-33546-ASB-0": [
      "Southerk 49 in. white, quartz top",
      "Southerk blanco de 49 pulg., cubierta de cuarzo",
      "Southerk branco de 49 pol., tampo de quartzo",
    ],
    "room3d.option.K-2874-0": ["Canvas white", "Canvas blanco", "Canvas branca"],
    "room3d.option.K-2608-SU-NA": ["Bachata stainless", "Bachata acero inoxidable", "Bachata inox"],
    "room3d.option.K-14410-4-CP": ["Purist widespread", "Purist, de 3 orificios", "Purist, 3 furos"],
    "room3d.option.K-77974-9-CP": ["Components handles only", "Components, solo manijas", "Components, só manoplas"],
    "room3d.option.K-T73117-4-CP": ["Composed", "Composed", "Composed"],
    "room3d.option.K-T78027-9-CP": ["Components thermostatic", "Components termostática", "Components termostático"],
    "room3d.option.K-T72770-4-CP": [
      "Artifacts transfer valve",
      "Artifacts, válvula desviadora",
      "Artifacts, desviador",
    ],
    "room3d.option.none": ["None", "Ninguno", "Nenhum"],
    "room3d.option.standard-toilet": ["Standard", "Estándar", "Padrão"],
    "room3d.option.K-31648-0": [
      "Cimarron two-piece elongated",
      "Cimarron de dos piezas, alargado",
      "Cimarron duas peças, alongado",
    ],
    "room3d.option.K-31626-DRY-0": [
      "Cimarron two-piece, DryLock",
      "Cimarron de dos piezas, DryLock",
      "Cimarron duas peças, DryLock",
    ],
    "room3d.option.K-31641-0": [
      "Cimarron two-piece round-front",
      "Cimarron de dos piezas, frente redondo",
      "Cimarron duas peças, frente redonda",
    ],
    "room3d.option.K-3619-0": ["Cimarron one-piece", "Cimarron de una pieza", "Cimarron peça única"],
    "room3d.option.K-3981-0": [
      "Tresham one-piece compact",
      "Tresham de una pieza, compacto",
      "Tresham peça única, compacto",
    ],
    "room3d.option.K-3940-0": [
      "Kathryn one-piece compact",
      "Kathryn de una pieza, compacto",
      "Kathryn peça única, compacto",
    ],
    "room3d.option.K-14377-CP": [
      "Purist pivoting holder",
      "Purist, portarrollos pivotante",
      "Purist, porta-papel articulado",
    ],
    "room3d.option.K-13504-CP": [
      "Kelston pivoting holder",
      "Kelston, portarrollos pivotante",
      "Kelston, porta-papel articulado",
    ],
    "room3d.option.K-73147-CP": [
      "Composed pivoting holder",
      "Composed, portarrollos pivotante",
      "Composed, porta-papel articulado",
    ],
    "room3d.option.K-78382-CP": [
      "Components pivoting holder",
      "Components, portarrollos pivotante",
      "Components, porta-papel articulado",
    ],
    "room3d.option.K-14436-CP": [
      "Purist 24 in. towel bar",
      "Purist, toallero de barra de 24 pulg.",
      "Purist, toalheiro de barra de 24 pol.",
    ],
    "room3d.option.K-14435-CP": [
      "Purist 18 in. towel bar",
      "Purist, toallero de barra de 18 pulg.",
      "Purist, toalheiro de barra de 18 pol.",
    ],
    "room3d.option.K-78373-CP": [
      "Components 24 in. towel bar",
      "Components, toallero de barra de 24 pulg.",
      "Components, toalheiro de barra de 24 pol.",
    ],
    "room3d.option.K-14441-CP": ["Purist towel ring", "Purist, toallero de aro", "Purist, toalheiro de argola"],
    "room3d.option.K-34454-NA": ["Atmo exhaust fan", "Atmo, extractor", "Atmo, exaustor"],
    "room3d.option.K-8332-0": [
      "Memoirs 60 in. freestanding",
      "Memoirs 60 pulg. independiente",
      "Memoirs 60 pol. independente",
    ],
    "room3d.option.K-R23217-RA-0": [
      "Elmbrook 60 in. alcove, right drain",
      "Elmbrook 60 pulg. empotrada, desagüe derecho",
      "Elmbrook 60 pol. embutida, ralo à direita",
    ],
    "room3d.option.K-R23217-LA-0": [
      "Elmbrook 60 in. alcove, left drain",
      "Elmbrook 60 pulg. empotrada, desagüe izquierdo",
      "Elmbrook 60 pol. embutida, ralo à esquerda",
    ],
    "room3d.option.K-1946-RA-0": [
      "Archer 60 in. alcove, right drain",
      "Archer 60 pulg. empotrada, desagüe derecho",
      "Archer 60 pol. embutida, ralo à direita",
    ],
    "room3d.option.K-T97328-4-CP": [
      "Purist floor-mount filler",
      "Purist, llenador de piso",
      "Purist, misturador de piso",
    ],
    "room3d.option.K-T73087-4-CP": [
      "Composed floor-mount filler",
      "Composed, llenador de piso",
      "Composed, misturador de piso",
    ],
    "room3d.option.K-T14501-4-CP": [
      "Purist with diverter button",
      "Purist con botón desviador",
      "Purist com botão desviador",
    ],
    "room3d.option.K-TS14423-4-CP": ["Purist lever", "Purist de palanca", "Purist de alavanca"],
    "room3d.option.K-TS73115-4-CP": ["Composed lever", "Composed de palanca", "Composed de alavanca"],
    "room3d.option.K-10542-CP": ["Traditional 24 in.", "Traditional 24 pulg.", "Traditional 24 pol."],
    "room3d.option.K-10544-CP": ["Traditional 36 in.", "Traditional 36 pulg.", "Traditional 36 pol."],
    "room3d.option.K-11895-BS": ["Purist 36 in. stainless", "Purist 36 pulg. acero inoxidable", "Purist 36 pol. inox"],
    "room3d.option.K-25161-CP": ["Components 36 in.", "Components 36 pulg.", "Components 36 pol."],
    "room3d.option.K-2210-G-0": ["Caxton oval undermount", "Caxton ovalado bajo cubierta", "Caxton oval sob o tampo"],
    "room3d.option.K-7806-0": [
      "Carillon round drop-in",
      "Carillon redondo de sobreponer",
      "Carillon redonda de sobrepor",
    ],
    "room3d.option.K-3048-1-0": [
      "Iron/Impressions 25 in. top",
      "Iron/Impressions, cubierta de 25 pulg.",
      "Iron/Impressions, tampo de 25 pol.",
    ],
    "room3d.option.K-3049-1-0": [
      "Iron/Impressions 31 in. top",
      "Iron/Impressions, cubierta de 31 pulg.",
      "Iron/Impressions, tampo de 31 pol.",
    ],
    "room3d.option.K-3051-1-0": [
      "Iron/Impressions 37 in. top",
      "Iron/Impressions, cubierta de 37 pulg.",
      "Iron/Impressions, tampo de 37 pol.",
    ],
    "room3d.option.K-3052-1-0": [
      "Iron/Impressions 43 in. top",
      "Iron/Impressions, cubierta de 43 pulg.",
      "Iron/Impressions, tampo de 43 pol.",
    ],
    "room3d.option.K-3053-1-0": [
      "Iron/Impressions 49 in. top",
      "Iron/Impressions, cubierta de 49 pulg.",
      "Iron/Impressions, tampo de 49 pol.",
    ],
    "room3d.option.K-14031-BU-96": [
      "Marrakesh top, Caxton bowl",
      "Marrakesh, cubierta con lavabo Caxton",
      "Marrakesh, tampo com cuba Caxton",
    ],
    "room3d.option.K-14402-4A-CP": ["Purist single-handle", "Purist monomando", "Purist monocomando"],
    "room3d.option.K-73167-4-CP": ["Composed single-handle", "Composed monomando", "Composed monocomando"],
    "room3d.option.K-77958-4A-CP": ["Components single-handle", "Components monomando", "Components monocomando"],
    "room3d.option.K-35951-4-CP": ["Buckley centerset", "Buckley, 3 orificios a 4 pulg.", "Buckley, 3 furos a 4 pol."],
    "room3d.option.K-27388-4-CP": [
      "Simplice centerset",
      "Simplice, 3 orificios a 4 pulg.",
      "Simplice, 3 furos a 4 pol.",
    ],
    "room3d.option.K-77969-CP": ["Components Row spout", "Components, caño Row", "Components, bica Row"],
    "room3d.option.K-77967-CP": ["Components Tube spout", "Components, caño Tube", "Components, bica Tube"],
    "room3d.option.K-2035-4-0": ["Pinoir wall-mount", "Pinoir de pared", "Pinoir de parede"],
    "room3d.option.K-2032-0": ["Greenwich wall-mount", "Greenwich de pared", "Greenwich de parede"],
    "room3d.option.K-2362-8-0": ["Cimarron pedestal", "Cimarron de pedestal", "Cimarron de coluna"],
    "room3d.option.K-5265-4-0": ["Veer pedestal", "Veer de pedestal", "Veer de coluna"],
    "room3d.option.glass-enclosure": ["Glass enclosure", "Mampara de vidrio", "Box de vidro"],
    "room3d.option.K-8459-0": [
      "Rely 60 x 32 in., left drain",
      "Rely 60 x 32 pulg., desagüe izquierdo",
      "Rely 60 x 32 pol., ralo à esquerda",
    ],
    "room3d.option.K-8458-0": [
      "Rely 60 x 32 in., right drain",
      "Rely 60 x 32 pulg., desagüe derecho",
      "Rely 60 x 32 pol., ralo à direita",
    ],
    "room3d.option.K-9163-0": [
      "Bellwether 60 x 32 in., left drain",
      "Bellwether 60 x 32 pulg., desagüe izquierdo",
      "Bellwether 60 x 32 pol., ralo à esquerda",
    ],
    "room3d.option.K-9396-0": ["Archer 36 x 36 in.", "Archer 36 x 36 pulg.", "Archer 36 x 36 pol."],
    "room3d.option.K-8644-0": ["Rely 36 x 34 in.", "Rely 36 x 34 pulg.", "Rely 36 x 34 pol."],
    "room3d.option.choreograph-72": [
      "Choreograph 72 in. walls",
      "Choreograph, paredes de 72 pulg.",
      "Choreograph, paredes de 72 pol.",
    ],
    "room3d.option.choreograph-96": [
      "Choreograph 96 in. walls",
      "Choreograph, paredes de 96 pulg.",
      "Choreograph, paredes de 96 pol.",
    ],
    "room3d.option.standard-door": ["Glass door", "Puerta de vidrio", "Porta de vidro"],
    "room3d.option.K-R706851-8L-BL": ["Elmbrook sliding", "Elmbrook corrediza", "Elmbrook de correr"],
    "room3d.option.K-707615-8L-BL": ["Elate sliding", "Elate corrediza", "Elate de correr"],
    "room3d.option.K-706015-L-BL": [
      "Levity bypass",
      "Levity de dos hojas corredizas",
      "Levity de duas folhas de correr",
    ],
    "room3d.option.K-27582-10L-BL": ["Composed pivot", "Composed abatible", "Composed pivotante"],
    "room3d.option.K-27583-10L-BL": ["Components pivot", "Components abatible", "Components pivotante"],
    "room3d.option.402321-0": [
      "Sterling Windham two-piece elongated",
      "Sterling Windham de dos piezas, alargado",
      "Sterling Windham duas peças, alongado",
    ],
    "room3d.option.402320-0": [
      "Sterling Windham two-piece round-front",
      "Sterling Windham de dos piezas, frente redondo",
      "Sterling Windham duas peças, frente redonda",
    ],
    "room3d.option.402322-0": [
      "Sterling Windham elongated, chair height",
      "Sterling Windham alargado, altura de silla",
      "Sterling Windham alongado, altura conforto",
    ],
    "room3d.option.402324-0": [
      "Sterling Windham elongated, 1.6 gpf",
      "Sterling Windham alargado, 1.6 gpf",
      "Sterling Windham alongado, 1.6 gpf",
    ],
    "room3d.option.402325-0": [
      "Sterling Windham chair height, 1.6 gpf",
      "Sterling Windham altura de silla, 1.6 gpf",
      "Sterling Windham altura conforto, 1.6 gpf",
    ],
    "room3d.option.402078-0": [
      "Sterling Windham round, 14 in. rough-in",
      "Sterling Windham redondo, desagüe a 14 pulg.",
      "Sterling Windham redondo, esgoto a 14 pol.",
    ],
    "room3d.option.402210-0": [
      "Sterling Windham elongated, 10 in. rough-in",
      "Sterling Windham alargado, desagüe a 10 pulg.",
      "Sterling Windham alongado, esgoto a 10 pol.",
    ],
    "room3d.option.71171110-0": [
      "Sterling Ensemble 60 x 30 in. alcove, left drain",
      "Sterling Ensemble 60 x 30 pulg. empotrada, desagüe izquierdo",
      "Sterling Ensemble 60 x 30 pol. de nicho, ralo à esquerda",
    ],
    "room3d.option.71171120-0": [
      "Sterling Ensemble 60 x 30 in. alcove, right drain",
      "Sterling Ensemble 60 x 30 pulg. empotrada, desagüe derecho",
      "Sterling Ensemble 60 x 30 pol. de nicho, ralo à direita",
    ],
    "room3d.option.71171112-0": [
      "Sterling Ensemble 60 x 30 in. soaking, left drain",
      "Sterling Ensemble 60 x 30 pulg. profunda, desagüe izquierdo",
      "Sterling Ensemble 60 x 30 pol. funda, ralo à esquerda",
    ],
    "room3d.option.71171122-0": [
      "Sterling Ensemble 60 x 30 in. soaking, right drain",
      "Sterling Ensemble 60 x 30 pulg. profunda, desagüe derecho",
      "Sterling Ensemble 60 x 30 pol. funda, ralo à direita",
    ],
    "room3d.option.71121110-0": [
      "Sterling Ensemble 60 x 32 in. alcove, left drain",
      "Sterling Ensemble 60 x 32 pulg. empotrada, desagüe izquierdo",
      "Sterling Ensemble 60 x 32 pol. de nicho, ralo à esquerda",
    ],
    "room3d.option.71121120-0": [
      "Sterling Ensemble 60 x 32 in. alcove, right drain",
      "Sterling Ensemble 60 x 32 pulg. empotrada, desagüe derecho",
      "Sterling Ensemble 60 x 32 pol. de nicho, ralo à direita",
    ],
    "room3d.option.71121112-0": [
      "Sterling Ensemble 60 x 32 in. soaking, left drain",
      "Sterling Ensemble 60 x 32 pulg. profunda, desagüe izquierdo",
      "Sterling Ensemble 60 x 32 pol. funda, ralo à esquerda",
    ],
    "room3d.option.71121122-0": [
      "Sterling Ensemble 60 x 32 in. soaking, right drain",
      "Sterling Ensemble 60 x 32 pulg. profunda, desagüe derecho",
      "Sterling Ensemble 60 x 32 pol. funda, ralo à direita",
    ],
    "room3d.option.96136-0": [
      "Sterling Unwind 67 in. soaking",
      "Sterling Unwind 67 pulg. profunda",
      "Sterling Unwind 67 pol. funda",
    ],
    "room3d.option.71220110-0": [
      "Sterling Ensemble tub and walls, left drain",
      "Sterling Ensemble bañera con paredes, desagüe izquierdo",
      "Sterling Ensemble banheira com paredes, ralo à esquerda",
    ],
    "room3d.option.71220120-0": [
      "Sterling Ensemble tub and walls, right drain",
      "Sterling Ensemble bañera con paredes, desagüe derecho",
      "Sterling Ensemble banheira com paredes, ralo à direita",
    ],
    "room3d.option.71370120-0": [
      "Sterling Ensemble Medley tub and walls",
      "Sterling Ensemble Medley bañera con paredes",
      "Sterling Ensemble Medley banheira com paredes",
    ],
    "room3d.option.442007-U-0": [
      "Sterling Stinson undermount",
      "Sterling Stinson bajo cubierta",
      "Sterling Stinson sob o tampo",
    ],
    "room3d.option.442040-0": [
      "Sterling Wescott oval undermount",
      "Sterling Wescott ovalado bajo cubierta",
      "Sterling Wescott oval sob o tampo",
    ],
    "room3d.option.S1201-0": [
      "Sterling stainless oval drop-in",
      "Sterling ovalado de acero inoxidable, de sobreponer",
      "Sterling oval de inox, de sobrepor",
    ],
    "room3d.option.442124-0": [
      "Sterling Sacramento pedestal",
      "Sterling Sacramento de pedestal",
      "Sterling Sacramento de coluna",
    ],
    "room3d.option.72181110-0": [
      "Sterling Ensemble 60 x 32 in., left drain",
      "Sterling Ensemble 60 x 32 pulg., desagüe izquierdo",
      "Sterling Ensemble 60 x 32 pol., ralo à esquerda",
    ],
    "room3d.option.72181120-0": [
      "Sterling Ensemble 60 x 32 in., right drain",
      "Sterling Ensemble 60 x 32 pulg., desagüe derecho",
      "Sterling Ensemble 60 x 32 pol., ralo à direita",
    ],
    "room3d.option.72171110-0": [
      "Sterling Ensemble 60 x 30 in., left drain",
      "Sterling Ensemble 60 x 30 pulg., desagüe izquierdo",
      "Sterling Ensemble 60 x 30 pol., ralo à esquerda",
    ],
    "room3d.option.72171120-0": [
      "Sterling Ensemble 60 x 30 in., right drain",
      "Sterling Ensemble 60 x 30 pulg., desagüe derecho",
      "Sterling Ensemble 60 x 30 pol., ralo à direita",
    ],
    "room3d.option.72131100-0": [
      "Sterling Ensemble 60 x 34 in., center drain",
      "Sterling Ensemble 60 x 34 pulg., desagüe central",
      "Sterling Ensemble 60 x 34 pol., ralo central",
    ],
    "room3d.option.72101100-0": [
      "Sterling Ensemble 36 x 34 in.",
      "Sterling Ensemble 36 x 34 pulg.",
      "Sterling Ensemble 36 x 34 pol.",
    ],
    "room3d.option.72180116-0": [
      "Sterling Ensemble 60 in. kit with walls, left drain",
      "Sterling Ensemble 60 pulg. con paredes, desagüe izquierdo",
      "Sterling Ensemble 60 pol. com paredes, ralo à esquerda",
    ],
    "room3d.option.72180126-0": [
      "Sterling Ensemble 60 in. kit with walls, right drain",
      "Sterling Ensemble 60 pulg. con paredes, desagüe derecho",
      "Sterling Ensemble 60 pol. com paredes, ralo à direita",
    ],
    "room3d.option.72240100-0": [
      "Sterling Accord 36 in. kit with walls",
      "Sterling Accord 36 pulg. con paredes",
      "Sterling Accord 36 pol. com paredes",
    ],
    "room3d.option.5976-59S": [
      "Sterling Deluxe framed sliding",
      "Sterling Deluxe corrediza con marco",
      "Sterling Deluxe de correr com moldura",
    ],
    "room3d.option.581075-59N-G05": [
      "Sterling Meritor sliding",
      "Sterling Meritor corrediza",
      "Sterling Meritor de correr",
    ],
    "room3d.option.80001024-V": ["Sterling 24 in. straight", "Sterling recta de 24 pulg.", "Sterling reta de 24 pol."],
    "room3d.option.K-965-AK-CP": ["Purist showerhead", "Purist, regadera", "Purist, chuveiro"],
    "room3d.option.K-24805-CP": ["Parallel showerhead", "Parallel, regadera", "Parallel, chuveiro"],
    "room3d.option.K-27051-CP": [
      "Occasion 8 in. rainhead",
      "Occasion, regadera de lluvia de 8 pulg.",
      "Occasion, chuveiro de teto de 8 pol.",
    ],
    "room3d.option.K-22166-CP": ["Purist handshower", "Purist, regadera de mano", "Purist, ducha manual"],
    "room3d.option.standard-shelf": ["Standard", "Estándar", "Padrão"],
    "room3d.option.K-97621": [
      "Choreograph 7 in. shelf",
      "Choreograph, repisa de 7 pulg.",
      "Choreograph, prateleira de 7 pol.",
    ],
    "room3d.option.K-97622": [
      "Choreograph 14 in. shelf",
      "Choreograph, repisa de 14 pulg.",
      "Choreograph, prateleira de 14 pol.",
    ],
    "room3d.option.K-97623": [
      "Choreograph 21 in. shelf",
      "Choreograph, repisa de 21 pulg.",
      "Choreograph, prateleira de 21 pol.",
    ],
    "room3d.option.K-14440-CP": ["Purist glass shelf", "Purist, repisa de vidrio", "Purist, prateleira de vidro"],
    "room3d.option.K-97630": [
      "Choreograph storage column",
      "Choreograph, columna de almacenamiento",
      "Choreograph, coluna organizadora",
    ],
    "room3d.option.standard-mirror": ["Standard", "Estándar", "Padrão"],
    "room3d.option.standard-light": ["Standard light bar", "Barra de luz estándar", "Barra de luz padrão"],
    "room3d.option.31769-SC02-CPL": ["Tone 2-light, chrome", "Tone de 2 luces, cromo", "Tone de 2 lâmpadas, cromado"],
    "room3d.option.31770-SC03-CPL": ["Tone 3-light, chrome", "Tone de 3 luces, cromo", "Tone de 3 lâmpadas, cromado"],
    "room3d.option.31756-SC02-BNL": [
      "Riff 2-light, brushed nickel",
      "Riff de 2 luces, níquel cepillado",
      "Riff de 2 lâmpadas, níquel escovado",
    ],
    "room3d.option.31757-SC03-CPL": ["Riff 3-light, chrome", "Riff de 3 luces, cromo", "Riff de 3 lâmpadas, cromado"],
    "room3d.option.38398-SC03-2GL": ["Hint 3-light, brass", "Hint de 3 luces, latón", "Hint de 3 lâmpadas, latão"],
    "room3d.option.38399-SC04-CPL": ["Hint 4-light, chrome", "Hint de 4 luces, cromo", "Hint de 4 lâmpadas, cromado"],
    "room3d.option.26849-SC04-CPL": [
      "Simplice 4-light, chrome",
      "Simplice de 4 luces, cromo",
      "Simplice de 4 lâmpadas, cromado",
    ],
    "room3d.option.28973-SC04-BNL": [
      "Honesty 4-light, brushed nickel",
      "Honesty de 4 luces, níquel cepillado",
      "Honesty de 4 lâmpadas, níquel escovado",
    ],
    "room3d.option.35875-SC04-BNL": [
      "Crue 4-light, brushed nickel",
      "Crue de 4 luces, níquel cepillado",
      "Crue de 4 lâmpadas, níquel escovado",
    ],
    "room3d.option.K-3073-NA": [
      "Archer 20 x 31 in. medicine cabinet",
      "Botiquín Archer de 20 x 31 pulg.",
      "Armário de banheiro Archer de 20 x 31 pol.",
    ],
    "room3d.option.K-99000-NA": [
      "Verdera 15 x 30 in. medicine cabinet",
      "Botiquín Verdera de 15 x 30 pulg.",
      "Armário de banheiro Verdera de 15 x 30 pol.",
    ],
    "room3d.option.K-99002-NA": [
      "Verdera 20 x 30 in. medicine cabinet",
      "Botiquín Verdera de 20 x 30 pulg.",
      "Armário de banheiro Verdera de 20 x 30 pol.",
    ],
    "room3d.option.K-99003-SCF-NA": [
      "Verdera 20 x 30 in. medicine cabinet, flip-out mirror",
      "Botiquín Verdera de 20 x 30 pulg., espejo abatible",
      "Armário de banheiro Verdera de 20 x 30 pol., espelho articulado",
    ],
    "room3d.option.K-99007-NA": [
      "Verdera 24 x 30 in. medicine cabinet, magnifying mirror",
      "Botiquín Verdera de 24 x 30 pulg., espejo de aumento",
      "Armário de banheiro Verdera de 24 x 30 pol., espelho de aumento",
    ],
    "room3d.option.K-81144-DA1": [
      "Maxstow 15 x 24 in. medicine cabinet, surface mount",
      "Botiquín Maxstow de 15 x 24 pulg., de sobreponer",
      "Armário de banheiro Maxstow de 15 x 24 pol., de sobrepor",
    ],
    "room3d.option.K-81146-DA1": [
      "Maxstow 30 x 24 in. medicine cabinet, surface mount",
      "Botiquín Maxstow de 30 x 24 pulg., de sobreponer",
      "Armário de banheiro Maxstow de 30 x 24 pol., de sobrepor",
    ],
    "room3d.option.K-99008-NA": [
      "Verdera 34 x 30 in. two-door medicine cabinet",
      "Botiquín Verdera de 34 x 30 pulg., dos puertas",
      "Armário de banheiro Verdera de 34 x 30 pol., duas portas",
    ],
    "room3d.option.K-99010-NA": [
      "Verdera 40 x 30 in. three-door medicine cabinet",
      "Botiquín Verdera de 40 x 30 pulg., tres puertas",
      "Armário de banheiro Verdera de 40 x 30 pol., três portas",
    ],
    "room3d.option.LP80": [
      "Broan-NuTone LoProfile 80 CFM",
      "Broan-NuTone LoProfile de 80 CFM",
      "Broan-NuTone LoProfile de 80 CFM",
    ],
    "room3d.option.K-31364-BLL": ["Essential 24 x 36 in.", "Essential 24 x 36 pulg.", "Essential 24 x 36 pol."],
    "room3d.option.K-31367-BLL": [
      "Essential 22 in. round",
      "Essential redondo de 22 pulg.",
      "Essential redondo de 22 pol.",
    ],
    "room3d.option.K-31368": [
      "Essential 32 in. round",
      "Essential redondo de 32 pulg.",
      "Essential redondo de 32 pol.",
    ],
    "room3d.option.K-31365-BLL": ["Essential 30 x 45 in.", "Essential 30 x 45 pulg.", "Essential 30 x 45 pol."],
    "room3d.option.K-31369-BLL": [
      "Essential 36 in. round",
      "Essential redondo de 36 pulg.",
      "Essential redondo de 36 pol.",
    ],
    "room3d.option.K-99573-TL-NA": [
      "Verdera 40 x 33 in. lighted",
      "Verdera 40 x 33 pulg. con luz",
      "Verdera 40 x 33 pol. com iluminação",
    ],
    "room3d.option.K-14443-CP": ["Purist robe hook", "Purist, gancho para bata", "Purist, gancho para roupão"],
    "room3d.option.K-23529-CP": ["Parallel robe hook", "Parallel, gancho para bata", "Parallel, gancho para roupão"],

    // ---------- Riley, the guide (js/riley.js) ----------
    "riley.name": ["Riley", "Riley", "Riley"],
    "riley.mute": ["Mute Riley", "Silenciar a Riley", "Silenciar a Riley"],
    "riley.unmute": ["Let Riley speak", "Dejar hablar a Riley", "Deixar a Riley falar"],
    "riley.voiceOn": ["Riley's voice", "Voz de Riley", "Voz da Riley"],
    "riley.voices": ["Choose Riley's voice", "Elegir la voz de Riley", "Escolher a voz da Riley"],
    "riley.voicesHelp": [
      "These are the voices on this device. Tap one to hear it and use it. Other phones and computers have their own voices.",
      "Estas son las voces de este dispositivo. Toque una para oírla y usarla. Otros teléfonos y computadoras tienen sus propias voces.",
      "Estas são as vozes deste aparelho. Toque em uma para ouvir e usar. Outros celulares e computadores têm as próprias vozes.",
    ],
    "riley.voicesNone": [
      "This browser has no voices for this language.",
      "Este navegador no tiene voces para este idioma.",
      "Este navegador não tem vozes para este idioma.",
    ],
    "riley.voiceAuto": ["Automatic ({name})", "Automática ({name})", "Automática ({name})"],
    "riley.play": ["Play", "Escuchar", "Ouvir"],
    "riley.playVoice": ["Play {name}", "Escuchar {name}", "Ouvir {name}"],
    "riley.voicesDone": ["Done", "Listo", "Pronto"],
    "riley.sample": [
      "Hi, I'm Riley. This is how I'll sound while I walk you through your bathroom.",
      "Hola, soy Riley. Así sonaré mientras le guío por su baño.",
      "Oi, eu sou a Riley. É assim que vou soar enquanto te guio pelo seu banheiro.",
    ],
    "riley.yes": ["Yes please", "Sí, por favor", "Sim, por favor"],
    "riley.showMe": ["Show me", "Muéstrame", "Mostre"],
    "riley.greeting": [
      "Hi, I'm Riley. I'll talk you through your bathroom, step by step.",
      "Hola, soy Riley. Le voy a guiar por su baño, paso a paso.",
      "Oi, eu sou a Riley. Vou te guiar pelo seu banheiro, passo a passo.",
    ],
    "riley.problem": [
      "Hey, so it looks like {what} isn't going to work there. {why}",
      "Oiga, parece que {what} no va a funcionar ahí. {why}",
      "Oi, parece que {what} não vai dar ali. {why}",
    ],
    "riley.offer": ["Can I offer an alternative?", "¿Le propongo una alternativa?", "Posso sugerir uma alternativa?"],
    "riley.offerOut": [
      "Can I offer an alternative? There's no room for it anywhere in this bathroom, so I'd take it back out.",
      "¿Le propongo una alternativa? No cabe en ninguna parte de este baño, así que lo quitaría.",
      "Posso sugerir uma alternativa? Não cabe em nenhum lugar deste banheiro, então eu tiraria.",
    ],
    "riley.need": ["Before we move on, {list}.", "Antes de seguir, {list}.", "Antes de continuar, {list}."],
    "riley.tight": ["One thing about {what}: {why}", "Una cosa sobre {what}: {why}", "Uma coisa sobre {what}: {why}"],
    "riley.elecGaps": [
      "One thing first: {list} Want me to add it?",
      "Una cosa antes: {list} ¿Lo agrego yo?",
      "Uma coisa antes: {list} Quer que eu adicione?",
    ],
    "riley.step.room": [
      "Let's start with the room. Pick a bathroom close to yours or type your own measurements, then tell me which wall the plumbing is in.",
      "Empecemos con el baño. Elija uno parecido al suyo o escriba sus medidas, y luego dígame en qué pared está la plomería.",
      "Vamos começar pelo banheiro. Escolha um parecido com o seu ou informe as suas medidas e depois me diga em qual parede está a hidráulica.",
    ],
    "riley.step.layout": [
      "Now the layout. Add what you want and drag it around; I'll tell you the moment something won't fit.",
      "Ahora la distribución. Agregue lo que quiera y muévalo; le aviso en el momento en que algo no quepa.",
      "Agora a distribuição. Adicione o que quiser e arraste; eu aviso na hora em que algo não couber.",
    ],
    "riley.step.electrical": [
      "I've worked out where the outlets, switches, lights and fan should go. Have a look, and move any of them along its wall if you'd rather.",
      "Ya calculé dónde deberían ir los tomacorrientes, los interruptores, las luces y el extractor. Échele un ojo y mueva lo que quiera por su pared.",
      "Já calculei onde devem ficar as tomadas, os interruptores, as luzes e o exaustor. Dê uma olhada e mova o que quiser pela parede.",
    ],
    "riley.step.products": [
      "Pick the models you like. I'll show each one on its own so nothing stands in front of it, and anything too big for its spot can't be picked.",
      "Elija los modelos que le gusten. Muestro cada uno solo, para que nada se le ponga delante, y lo que sea demasiado grande no se puede elegir.",
      "Escolha os modelos de que você gosta. Mostro cada um sozinho, para nada ficar na frente, e o que for grande demais não pode ser escolhido.",
    ],
    "riley.step.finishes": [
      "Tile, paint and floors. The price follows along as you choose.",
      "Azulejo, pintura y pisos. El precio se actualiza mientras elige.",
      "Azulejo, pintura e pisos. O preço acompanha enquanto você escolhe.",
    ],
    "riley.step.estimate": [
      "Here's what it adds up to. Send it over when you're ready and someone will come back to you.",
      "Esto es lo que suma. Envíelo cuando quiera y alguien le responderá.",
      "Isto é o total. Envie quando quiser e alguém vai responder.",
    ],

    // ---------- PDF (js/estimate-pdf.js) ----------
    "pdf.preparedFor": ["Prepared for: {name}", "Preparado para: {name}", "Preparado para: {name}"],
    "pdf.generated": ["Generated {date}", "Generado el {date}", "Gerado em {date}"],
    "pdf.page": ["Page {i} of {n}", "Página {i} de {n}", "Página {i} de {n}"],

    // ---------- settings shown on the page (js/site-config.js) ----------
    "config.formService": [
      "our form service provider",
      "nuestro proveedor de servicio de formularios",
      "nosso provedor de serviço de formulários",
    ],
    "config.period.day": ["{n} day", "{n} día", "{n} dia"],
    "config.period.days": ["{n} days", "{n} días", "{n} dias"],
    "config.period.businessDay": ["{n} business day", "{n} día hábil", "{n} dia útil"],
    "config.period.businessDays": ["{n} business days", "{n} días hábiles", "{n} dias úteis"],
    "config.period.week": ["{n} week", "{n} semana", "{n} semana"],
    "config.period.weeks": ["{n} weeks", "{n} semanas", "{n} semanas"],
    "config.period.month": ["{n} month", "{n} mes", "{n} mês"],
    "config.period.months": ["{n} months", "{n} meses", "{n} meses"],
  };

  function detect() {
    var doc = typeof document !== "undefined" ? document : null;
    var lang = doc && doc.documentElement ? String(doc.documentElement.lang || "").toLowerCase() : "";
    if (lang.indexOf("es") === 0) return "es";
    if (lang.indexOf("pt") === 0) return "pt";
    return "en";
  }

  var current = detect();

  function index(lang) {
    var i = LANGS.indexOf(lang || current);
    return i === -1 ? 0 : i;
  }

  // t("key", { name: value }, lang?) — the text in `lang` (default: the
  // page's language), falling back to English.
  function t(key, vars, lang) {
    var entry = S[key];
    if (!entry) throw new Error("I18n: unknown key " + key);
    var text = entry[index(lang)];
    if (text === undefined || text === null) text = entry[0];
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
      });
    }
    return text;
  }

  return {
    LANGS: LANGS,
    LOCALES: LOCALES,
    NAMES: NAMES,
    STRINGS: S,
    t: t,
    lang: function () {
      return current;
    },
    // Tests only: pretend the page is in another language.
    setLang: function (lang) {
      current = LANGS.indexOf(lang) === -1 ? "en" : lang;
    },
    locale: function (lang) {
      return LOCALES[lang || current] || LOCALES.en;
    },
    name: function (lang) {
      return NAMES[lang || current];
    },
  };
});
