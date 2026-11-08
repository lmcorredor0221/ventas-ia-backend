import { enrichCatalogReference } from './catalogReference.js';
import { colombiaCatalogTestSeed300 } from './colombiaCatalogExpansion.js';

// Research catalogue: references observed in Colombian retail assortments or in
// the local WhatsApp order corpus. It is intentionally kept separate from the
// operational tenant seed so research rows cannot be offered without a tenant
// price/stock synchronisation.
//
// A family only combines presentations listed for that family. This avoids the
// common failure mode of generating every possible size for every brand.
const PRESENTATIONS = {
  pantry: [['250 g', ['cuarto', 'un cuarto']], ['500 g', ['media libra', 'medio kilo']], ['1 kg', ['libra', 'kilo']], ['2 kg', ['dos kilos']], ['2.5 kg', ['kilo y medio', 'dos libras y media']], ['5 kg', ['bulto pequeño', 'cinco kilos']]],
  pantryShort: [['250 g', ['cuarto']], ['500 g', ['media libra']], ['1 kg', ['kilo']], ['2 kg', ['dos kilos']]],
  liquid: [['200 ml', ['personal']], ['250 ml', ['cajita', 'cajita pequeña']], ['500 ml', ['media botella']], ['1 L', ['litro']], ['1.5 L', ['litro y medio']], ['2 L', ['dos litros']]],
  soda: [['250 ml', ['personal']], ['400 ml', ['personal']], ['600 ml', ['botella']], ['1.5 L', ['litro y medio']], ['2.5 L', ['familiar']], ['3 L', ['tres litros', 'grande']]],
  dairy: [['100 g', ['personal']], ['150 g', ['vasito']], ['200 g', ['pequeño']], ['400 g', ['mediano']], ['500 g', ['media libra']], ['1 L', ['litro', 'familiar']]],
  fresh: [['1 und', ['unidad', 'una']], ['500 g', ['media libra']], ['1 kg', ['kilo']], ['2 kg', ['dos kilos']], ['5 kg', ['cinco kilos']]],
  freshSmall: [['1 und', ['unidad']], ['500 g', ['media libra']], ['1 kg', ['kilo']], ['2 kg', ['dos kilos']]],
  bakery: [['1 und', ['unidad']], ['2 und', ['paquete x2']], ['4 und', ['paquete x4']], ['6 und', ['paquete x6']], ['250 g', ['pequeño']], ['500 g', ['mediano', 'mediana']]],
  snacks: [['25 g', ['personal']], ['45 g', ['pequeño']], ['80 g', ['mediano', 'mediana']], ['105 g', ['grande']], ['150 g', ['familiar']], ['250 g', ['paquete grande']]],
  beverage: [['200 ml', ['cajita']], ['250 ml', ['personal']], ['400 ml', ['personal']], ['500 ml', ['botella']], ['1 L', ['litro']], ['1.5 L', ['familiar']]],
  cleaningLiquid: [['250 ml', ['personal']], ['500 ml', ['pequeño']], ['900 ml', ['mediano']], ['1 L', ['litro']], ['2 L', ['familiar']], ['3 L', ['grande']]],
  cleaningSolid: [['100 g', ['barra pequeña']], ['250 g', ['barra']], ['400 g', ['paquete pequeño']], ['800 g', ['paquete']], ['1.5 kg', ['grande']], ['3 kg', ['super grande']]],
  personal: [['1 und', ['unidad']], ['2 und', ['paquete x2']], ['50 ml', ['pequeño']], ['100 ml', ['mediano']], ['200 ml', ['grande']], ['400 ml', ['familiar']]],
  baby: [['20 und', ['paquete pequeño']], ['30 und', ['paquete']], ['40 und', ['paquete grande']], ['50 und', ['paquete x50']], ['80 und', ['paquete económico']]],
  pet: [['100 g', ['sobrecito']], ['500 g', ['pequeño']], ['1 kg', ['kilo']], ['2 kg', ['mediano']], ['5 kg', ['grande']]],
};

const CATEGORY_ALIASES = {
  'Granos y basicos': ['mercado', 'despensa', 'víveres', 'abarrotes'],
  Lacteos: ['nevera', 'fríos', 'refrigerados'],
  'Carnes y congelados': ['congelado', 'proteína', 'para el almuerzo'],
  'Carnes frias': ['charcutería', 'fríos', 'embutidos'],
  Frutas: ['frutica', 'frutas'],
  Verduras: ['verdura', 'verduras', 'revuelto'],
  Panaderia: ['pan', 'panadería', 'onces'],
  Snacks: ['pasabocas', 'mecato', 'paquete'],
  Bebidas: ['bebida', 'fría', 'para la sed'],
  'Aseo hogar': ['aseo', 'limpieza', 'oficios'],
  'Aseo personal': ['higiene', 'baño', 'cuidado personal'],
  Bebes: ['bebé', 'niño', 'pañal'],
  Mascotas: ['concentrado', 'comida de perro', 'comida de gato'],
};

const family = (prefix, category, brand, name, productFamily, presentationSet, aliases = []) => ({
  prefix, category, brand, name, productFamily, presentationSet, aliases,
});

const blocks = [
  {
    category: 'Granos y basicos', target: 230,
    families: [
      ['ARR-DIA', 'Diana', 'Arroz Diana blanco', 'grano', 'pantry', ['arroz', 'arrocito']], ['ARR-ROA', 'Roa', 'Arroz Roa blanco', 'grano', 'pantry', ['arroz roa']], ['ARR-FLO', 'Florhuila', 'Arroz Florhuila blanco', 'grano', 'pantry', ['flor huila']], ['ARR-SOS', 'Sos', 'Arroz Supremo blanco', 'grano', 'pantryShort', ['arroz supremo']], ['ARR-CAS', 'Caribe', 'Arroz Caribe blanco', 'grano', 'pantryShort', ['arroz caribe']], ['ARR-EXI', 'Éxito', 'Arroz blanco marca propia', 'grano', 'pantry', ['arroz económico']],
      ['FRI-DIA', 'Diana', 'Frijol bola roja', 'grano', 'pantryShort', ['frijol rojo', 'frijoles']], ['FRI-CAR', 'Caribe', 'Frijol cargamanto', 'grano', 'pantryShort', ['cargamanto']], ['FRI-VER', 'Verde Valle', 'Frijol verde', 'grano', 'pantryShort', ['frijol verde']], ['FRI-CAB', 'Cabecita', 'Frijol cabecita negra', 'grano', 'pantryShort', ['frijol cabecita']], ['FRI-NGO', 'Diana', 'Frijol negro', 'grano', 'pantryShort', ['frijol negro']], ['FRI-PAL', 'Diana', 'Frijol palomito', 'grano', 'pantryShort', ['frijol blanco']],
      ['LEN-DIA', 'Diana', 'Lenteja', 'grano', 'pantry', ['lentejas']], ['LEN-VER', 'Verde Valle', 'Lenteja', 'grano', 'pantryShort', ['lenteja']], ['GAR-DIA', 'Diana', 'Garbanzo seco', 'grano', 'pantryShort', ['garbanzo', 'garbanzos']], ['ARV-DIA', 'Diana', 'Arveja seca', 'grano', 'pantryShort', ['arveja']], ['MAI-PIR', 'Diana', 'Maíz pira', 'grano', 'pantryShort', ['maíz para crispetas', 'crispetas']],
      ['PAS-DOR', 'Doria', 'Pasta Doria spaghetti', 'pasta', 'pantryShort', ['pasta', 'espagueti']], ['PAS-MUN', 'La Muñeca', 'Pasta La Muñeca tornillos', 'pasta', 'pantryShort', ['pasta tornillos', 'pastas']], ['PAS-MUN', 'La Muñeca', 'Pasta La Muñeca macarrón', 'pasta', 'pantryShort', ['macarrones']], ['PAS-DOR', 'Doria', 'Pasta Doria conchitas', 'pasta', 'pantryShort', ['conchitas']], ['PAS-DOR', 'Doria', 'Pasta Doria letras', 'pasta', 'pantryShort', ['pasta letras']], ['PAS-BAR', 'Barilla', 'Pasta Barilla spaghetti', 'pasta', 'pantryShort', ['barilla']], ['PAS-MON', 'Monticello', 'Pasta Monticello penne', 'pasta', 'pantryShort', ['penne']],
      ['HAR-DON', 'Donarepa', 'Harina de maíz blanca', 'harina', 'pantry', ['harina para arepas', 'harina maíz']], ['HAR-PAN', 'P.A.N.', 'Harina de maíz amarilla', 'harina', 'pantry', ['harina pan', 'harina amarilla']], ['HAR-HAZ', 'Haz de Oros', 'Harina de trigo', 'harina', 'pantry', ['harina trigo']], ['HAR-ROA', 'Roa', 'Harina de arroz', 'harina', 'pantryShort', ['harina arroz']], ['HAR-MAI', 'Maizena', 'Fécula de maíz', 'harina', 'pantryShort', ['maicena']],
      ['AVE-QUA', 'Quaker', 'Avena en hojuelas', 'cereal', 'pantry', ['avena', 'avena hojuelas']], ['AVE-ALP', 'Alpina', 'Avena instantánea', 'cereal', 'pantryShort', ['avena instantánea']], ['CER-KEL', 'Kellogg’s', 'Corn Flakes', 'cereal', 'pantry', ['cereal']], ['CER-ZUC', 'Zucaritas', 'Cereal Zucaritas', 'cereal', 'pantry', ['zucaritas']], ['CER-TOS', 'Tosh', 'Cereal Tosh', 'cereal', 'pantryShort', ['cereal saludable']],
      ['ACE-PRE', 'Premier', 'Aceite vegetal', 'aceite', 'liquid', ['aceite', 'aceite de cocina']], ['ACE-GOU', 'Gourmet', 'Aceite vegetal', 'aceite', 'liquid', ['aceite gourmet']], ['ACE-FIN', 'Fino', 'Aceite de girasol', 'aceite', 'liquid', ['aceite fino']], ['ACE-OLE', 'Oleocali', 'Aceite vegetal', 'aceite', 'liquid', ['aceite económico']], ['AZU-MAN', 'Manuelita', 'Azúcar blanca', 'azucar', 'pantry', ['azúcar']], ['AZU-INC', 'Incauca', 'Azúcar blanca', 'azucar', 'pantryShort', ['azúcar incauca']], ['SAL-REF', 'Refisal', 'Sal yodada', 'sal', 'pantry', ['sal']], ['SAL-MAR', 'Marina', 'Sal yodada', 'sal', 'pantryShort', ['sal marina']], ['PAN-DON', 'Doña Panela', 'Panela redonda', 'panela', 'pantry', ['panela', 'aguapanela']], ['PAN-INS', 'Insuaves', 'Panela pulverizada', 'panela', 'pantryShort', ['panela molida']],
      ['CAF-SEL', 'Sello Rojo', 'Café molido tradicional', 'cafe', 'pantry', ['café', 'tinto']], ['CAF-AGU', 'Águila Roja', 'Café molido tradicional', 'cafe', 'pantryShort', ['café águila roja']], ['CAF-LUK', 'Luker', 'Café molido', 'cafe', 'pantryShort', ['café luker']], ['CAF-OMA', 'Oma', 'Café molido', 'cafe', 'pantryShort', ['café oma']], ['CAF-JUAN', 'Juan Valdez', 'Café molido', 'cafe', 'pantryShort', ['café colombiano']], ['CHO-COR', 'Corona', 'Chocolate de mesa tradicional', 'chocolate', 'pantry', ['chocolate de mesa']], ['CHO-LUK', 'Luker', 'Chocolate de mesa', 'chocolate', 'pantryShort', ['chocolate luker']],
    ],
  },
  {
    category: 'Lacteos', target: 130,
    families: [
      ['LEC-ALQ', 'Alquería', 'Leche entera', 'lacteo', 'dairy', ['leche', 'bolsa de leche']], ['LEC-COL', 'Colanta', 'Leche entera', 'lacteo', 'dairy', ['leche colanta']], ['LEC-ALP', 'Alpina', 'Leche entera', 'lacteo', 'dairy', ['leche alpina']], ['LEC-ALQ', 'Alquería', 'Leche deslactosada', 'lacteo', 'dairy', ['deslactosada', 'sin lactosa']], ['LEC-COL', 'Colanta', 'Leche deslactosada', 'lacteo', 'dairy', ['leche sin lactosa']], ['LEC-ALP', 'Alpina', 'Leche deslactosada', 'lacteo', 'dairy', ['deslactosada']], ['LEC-PAR', 'Parmalat', 'Leche entera', 'lacteo', 'dairy', ['parmalat']], ['LEC-EXI', 'Éxito', 'Leche entera marca propia', 'lacteo', 'dairy', ['leche económica']],
      ['YOG-ALP', 'Alpina', 'Yogurt de fresa', 'lacteo', 'dairy', ['yogur', 'yogurt fresa']], ['YOG-ALP', 'Alpina', 'Yogurt de melocotón', 'lacteo', 'dairy', ['melocotón', 'durazno']], ['YOG-ALP', 'Alpina', 'Yogurt de mora', 'lacteo', 'dairy', ['yogur mora']], ['YOG-YOG', 'Alpina', 'Yogo Yogo de fresa', 'lacteo', 'dairy', ['yojo yojo', 'cajita']], ['YOG-YOG', 'Alpina', 'Yogo Yogo de melocotón', 'lacteo', 'dairy', ['yojo yojo', 'cajita']], ['YOG-ALP', 'Alpina', 'Yogurt natural', 'lacteo', 'dairy', ['yogurt natural']], ['YOG-COL', 'Colanta', 'Yogurt natural', 'lacteo', 'dairy', ['yogurt colanta']],
      ['KUM-ALP', 'Alpina', 'Kumis natural', 'lacteo', 'dairy', ['kumis']], ['KUM-COL', 'Colanta', 'Kumis natural', 'lacteo', 'dairy', ['kumis colanta']], ['AVE-ALP', 'Alpina', 'Avena original', 'lacteo', 'liquid', ['avena']], ['AVE-COL', 'Colanta', 'Avena original', 'lacteo', 'liquid', ['avena colanta']], ['CRE-ALQ', 'Alquería', 'Crema de leche', 'lacteo', 'dairy', ['crema de leche']], ['MAN-ALP', 'Alpina', 'Mantequilla', 'lacteo', 'dairy', ['mantequilla']], ['MAN-COL', 'Colanta', 'Mantequilla', 'lacteo', 'dairy', ['mantequilla colanta']], ['ARE-ALP', 'Alpina', 'Arequipe', 'dulce', 'dairy', ['arequipe', 'dulce de leche']],
      ['QUE-COL', 'Colanta', 'Queso campesino', 'queso', 'dairy', ['quesito', 'queso']], ['QUE-ALP', 'Alpina', 'Queso doble crema', 'queso', 'dairy', ['doble crema']], ['QUE-COL', 'Colanta', 'Queso doble crema', 'queso', 'dairy', ['queso tajado']], ['QUE-COL', 'Colanta', 'Queso costeño', 'queso', 'dairy', 'pantryShort', ['queso costeño']], ['QUE-EXI', 'Éxito', 'Queso mozzarella', 'queso', 'dairy', ['queso mozzarella']],
      ['HUE-AAA', 'Avícola local', 'Huevos AA rojos', 'huevo', 'freshSmall', ['huevos', 'huevos AA']], ['HUE-AAB', 'Avícola local', 'Huevos AAA rojos', 'huevo', 'freshSmall', ['huevos AAA', 'cubeta de huevos', 'panal']], ['HUE-BLA', 'Avícola local', 'Huevos blancos', 'huevo', 'freshSmall', ['huevos blancos']], ['HUE-CAM', 'Campo Vivo', 'Huevos campesinos', 'huevo', 'freshSmall', ['huevos campesinos']],
    ],
  },
  {
    category: 'Carnes y congelados', target: 130,
    families: [
      ['POL-PEQ', 'Proveedor local', 'Pechuga de pollo sin piel', 'pollo', 'fresh', ['pechuga', 'pechan']], ['POL-MUS', 'Proveedor local', 'Muslo de pollo', 'pollo', 'fresh', ['muslos']], ['POL-ALA', 'Proveedor local', 'Alas de pollo', 'pollo', 'fresh', ['alitas']], ['POL-PIE', 'Proveedor local', 'Pierna pernil de pollo', 'pollo', 'fresh', 'freshSmall', ['pernil de pollo']], ['POL-ENT', 'Proveedor local', 'Pollo entero', 'pollo', 'fresh', ['pollo entero']], ['POL-KOK', 'Kokoriko', 'Nuggets de pollo', 'congelado', 'snacks', ['nuggets']], ['POL-ZEN', 'Zenú', 'Nuggets de pollo', 'congelado', 'snacks', ['nuggets zenu']], ['POL-MC', 'McCain', 'Filetes de pollo apanados', 'congelado', 'snacks', ['pollo apanado']],
      ['CAR-MOL', 'Proveedor local', 'Carne molida de res', 'carne', 'fresh', ['carne molida']], ['CAR-CUE', 'Proveedor local', 'Cadera de res', 'carne', 'fresh', ['carne de res']], ['CAR-LOM', 'Proveedor local', 'Lomo de res', 'carne', 'fresh', ['lomo']], ['CAR-CHA', 'Proveedor local', 'Chatas de res', 'carne', 'fresh', ['chatas']], ['CAR-ESP', 'Proveedor local', 'Carne para espagueti', 'carne', 'fresh', ['carne para pasta']], ['CAR-HAM', 'Proveedor local', 'Hamburguesa de res', 'carne', 'fresh', ['hamburguesas']], ['CAR-ZEN', 'Zenú', 'Hamburguesa de res', 'congelado', 'snacks', ['hamburguesa congelada']],
      ['CER-COS', 'Proveedor local', 'Costilla de cerdo', 'cerdo', 'fresh', ['costilla']], ['CER-CHO', 'Proveedor local', 'Chuleta de cerdo', 'cerdo', 'fresh', ['chuleta']], ['CER-LON', 'Proveedor local', 'Lomo de cerdo', 'cerdo', 'fresh', ['lomo de cerdo']], ['CER-TOC', 'Proveedor local', 'Tocino de cerdo', 'cerdo', 'fresh', ['tocineta fresca']], ['PES-TIL', 'Proveedor local', 'Filete de tilapia', 'pescado', 'fresh', ['tilapia']], ['PES-BAG', 'Proveedor local', 'Bagre en posta', 'pescado', 'fresh', ['bagre']], ['PES-SAL', 'Proveedor local', 'Filete de salmón', 'pescado', 'fresh', ['salmón']], ['PES-MER', 'Proveedor local', 'Mojarra roja', 'pescado', 'fresh', ['mojarra']],
      ['CON-PAP', 'McCain', 'Papas a la francesa', 'congelado', 'pantryShort', ['papas congeladas']], ['CON-VER', 'K-listo', 'Verduras mixtas congeladas', 'congelado', 'pantryShort', ['verduras congeladas']], ['CON-MIX', 'K-listo', 'Mix de vegetales', 'congelado', 'pantryShort', ['vegetales congelados']], ['CON-ARE', 'La Especial', 'Arepas congeladas', 'congelado', 'bakery', ['arepas congeladas']], ['CON-PIZ', 'Pietrán', 'Pizza congelada', 'congelado', 'bakery', ['pizza congelada']], ['CON-HEL', 'Cream Helado', 'Helado de vainilla', 'helado', 'dairy', ['helado']],
    ],
  },
  {
    category: 'Carnes frias', target: 100,
    families: [
      ['SAL-ZEN', 'Zenú', 'Salchicha tradicional', 'embutido', 'bakery', ['salchichas', 'salchicha']], ['SAL-RAN', 'Ranchera', 'Salchicha Ranchera', 'embutido', 'bakery', ['rancheras']], ['SAL-AMR', 'Americana', 'Salchicha Americana gruesa', 'embutido', 'bakery', ['salchichas americanas', 'gruesas']], ['SAL-SUP', 'Superperro', 'Salchicha para perro caliente', 'embutido', 'bakery', ['super perro', 'perro caliente']], ['SAL-RIC', 'Rica', 'Salchicha tradicional', 'embutido', 'bakery', ['salchicha rica']], ['CHI-ZEN', 'Zenú', 'Chorizo', 'embutido', 'bakery', ['chorizo']], ['CHI-RAN', 'Ranchera', 'Chorizo parrillero', 'embutido', 'bakery', ['chorizo parrillero']], ['CHI-COL', 'Colanta', 'Chorizo', 'embutido', 'bakery', ['chorizo colanta']],
      ['JAM-PIE', 'Pietrán', 'Jamón de pernil de cerdo', 'charcuteria', 'dairy', ['jamón de pernil', 'jamón de pierna', 'pernil']], ['JAM-ZEN', 'Zenú', 'Jamón de cerdo', 'charcuteria', 'dairy', ['jamón']], ['JAM-RAN', 'Ranchera', 'Jamón de cerdo', 'charcuteria', 'dairy', ['jamón ranchera']], ['JAM-RIC', 'Rica', 'Jamón sandwich', 'charcuteria', 'dairy', ['jamón de sándwich']], ['MOR-ZEN', 'Zenú', 'Mortadela', 'charcuteria', 'dairy', ['mortadela']], ['MOR-RIC', 'Rica', 'Mortadela tradicional', 'charcuteria', 'dairy', ['mortadela rica']], ['SAL-ZEN', 'Zenú', 'Salchichón cervecero', 'embutido', 'dairy', ['salchichón']], ['SAL-RIC', 'Rica', 'Salchichón', 'embutido', 'dairy', ['salchichón rica']],
      ['TOC-PIE', 'Pietrán', 'Tocineta ahumada', 'charcuteria', 'dairy', ['tocineta', 'bacon']], ['TOC-ZEN', 'Zenú', 'Tocineta', 'charcuteria', 'dairy', ['tocineta zenu']], ['CAR-PIE', 'Pietrán', 'Carne desmechada', 'preparado', 'dairy', ['carne desmechada']], ['CAR-ZEN', 'Zenú', 'Carne enlatada', 'enlatado', 'dairy', ['carne lista']], ['PAT-ZEN', 'Zenú', 'Paté de hígado', 'enlatado', 'dairy', ['paté']], ['QUE-DEL', 'Colanta', 'Queso pera', 'queso', 'dairy', ['queso pera']], ['QUE-MOZ', 'Alpina', 'Queso mozzarella tajado', 'queso', 'dairy', ['queso para sándwich']], ['QUE-PAI', 'Colanta', 'Queso paipa', 'queso', 'dairy', ['queso paipa']],
    ],
  },
  {
    category: 'Frutas', target: 90,
    families: [
      ['FRU-BAN', 'Proveedor local', 'Banano criollo', 'fruta', 'fresh', ['banano', 'guineo']], ['FRU-BAN', 'Proveedor local', 'Banano bocadillo', 'fruta', 'freshSmall', ['bocadillo']], ['FRU-MAN', 'Proveedor local', 'Mango Tommy', 'fruta', 'fresh', ['mango']], ['FRU-MAN', 'Proveedor local', 'Mango común', 'fruta', 'fresh', ['mango biche']], ['FRU-MAN', 'Proveedor local', 'Mango de azúcar', 'fruta', 'freshSmall', ['manguito']], ['FRU-PAP', 'Proveedor local', 'Papaya', 'fruta', 'fresh', ['papaya']], ['FRU-MEL', 'Proveedor local', 'Melón', 'fruta', 'fresh', ['melón']], ['FRU-SAN', 'Proveedor local', 'Sandía', 'fruta', 'fresh', ['patilla', 'sandía']], ['FRU-PIÑ', 'Proveedor local', 'Piña golden', 'fruta', 'fresh', ['piña']], ['FRU-UVA', 'Proveedor local', 'Uva roja', 'fruta', 'freshSmall', ['uvas']], ['FRU-UVA', 'Proveedor local', 'Uva verde', 'fruta', 'freshSmall', ['uvas verdes']], ['FRU-MAN', 'Proveedor local', 'Manzana roja', 'fruta', 'freshSmall', ['manzana']], ['FRU-MAN', 'Proveedor local', 'Manzana verde', 'fruta', 'freshSmall', ['manzana verde']], ['FRU-PER', 'Proveedor local', 'Pera', 'fruta', 'freshSmall', ['pera']], ['FRU-NAR', 'Proveedor local', 'Naranja', 'fruta', 'fresh', ['naranja']], ['FRU-LIM', 'Proveedor local', 'Limón tahití', 'fruta', 'freshSmall', ['limón']], ['FRU-GUA', 'Proveedor local', 'Guayaba', 'fruta', 'freshSmall', ['guayaba']], ['FRU-FRE', 'Proveedor local', 'Fresa', 'fruta', 'freshSmall', ['fresas']], ['FRU-MAR', 'Proveedor local', 'Maracuyá', 'fruta', 'freshSmall', ['maracuyá']], ['FRU-TOM', 'Proveedor local', 'Tomate de árbol', 'fruta', 'freshSmall', ['tomate de árbol']], ['FRU-KIW', 'Proveedor local', 'Kiwi', 'fruta', 'freshSmall', ['kiwi']], ['FRU-GRA', 'Proveedor local', 'Granadilla', 'fruta', 'freshSmall', ['granadilla']],
    ],
  },
  {
    category: 'Verduras', target: 120,
    families: [
      ['VER-PAP', 'Proveedor local', 'Papa pastusa', 'tuberculo', 'fresh', ['papa']], ['VER-PAP', 'Proveedor local', 'Papa sabanera', 'tuberculo', 'fresh', ['papa sabanera']], ['VER-PAP', 'Proveedor local', 'Papa criolla', 'tuberculo', 'freshSmall', ['papita criolla']], ['VER-YUC', 'Proveedor local', 'Yuca', 'tuberculo', 'fresh', ['yuca']], ['VER-PLA', 'Proveedor local', 'Plátano verde', 'tuberculo', 'fresh', ['plátano']], ['VER-PLA', 'Proveedor local', 'Plátano maduro', 'tuberculo', 'fresh', ['maduro']], ['VER-CEB', 'Proveedor local', 'Cebolla cabezona blanca', 'verdura', 'fresh', ['cebolla blanca']], ['VER-CEB', 'Proveedor local', 'Cebolla cabezona roja', 'verdura', 'fresh', ['cebolla morada']], ['VER-CEB', 'Proveedor local', 'Cebolla larga', 'verdura', 'freshSmall', ['cebolla junca']], ['VER-TOM', 'Proveedor local', 'Tomate chonto', 'verdura', 'fresh', ['tomate']], ['VER-TOM', 'Proveedor local', 'Tomate larga vida', 'verdura', 'fresh', ['tomate larga vida']], ['VER-ZAN', 'Proveedor local', 'Zanahoria', 'verdura', 'fresh', ['zanahoria']], ['VER-LEC', 'Proveedor local', 'Lechuga crespa', 'verdura', 'freshSmall', ['lechuga']], ['VER-ESP', 'Proveedor local', 'Espinaca', 'verdura', 'freshSmall', ['espinaca']], ['VER-REP', 'Proveedor local', 'Repollo blanco', 'verdura', 'fresh', ['repollo']], ['VER-BRO', 'Proveedor local', 'Brócoli', 'verdura', 'freshSmall', ['brócoli']], ['VER-COL', 'Proveedor local', 'Coliflor', 'verdura', 'freshSmall', ['coliflor']], ['VER-PEP', 'Proveedor local', 'Pepino cohombro', 'verdura', 'fresh', ['pepino']], ['VER-AJO', 'Proveedor local', 'Ajo', 'verdura', 'freshSmall', ['ajos']], ['VER-AJI', 'Proveedor local', 'Ají dulce', 'verdura', 'freshSmall', ['ají']], ['VER-FRI', 'Proveedor local', 'Fríjol verde', 'verdura', 'freshSmall', ['habichuela']], ['VER-HAB', 'Proveedor local', 'Habichuela', 'verdura', 'freshSmall', ['vainica']], ['VER-ARV', 'Proveedor local', 'Arveja verde', 'verdura', 'freshSmall', ['arvejas']], ['VER-CAL', 'Proveedor local', 'Calabacín', 'verdura', 'freshSmall', ['zucchini']], ['VER-AHO', 'Proveedor local', 'Ahuyama', 'verdura', 'fresh', ['auyama']], ['VER-REM', 'Proveedor local', 'Remolacha', 'verdura', 'freshSmall', ['remolacha']], ['VER-API', 'Proveedor local', 'Apio', 'verdura', 'freshSmall', ['apio']], ['VER-CIL', 'Proveedor local', 'Cilantro', 'verdura', 'freshSmall', ['cilantro']], ['VER-PER', 'Proveedor local', 'Perejil', 'verdura', 'freshSmall', ['perejil']], ['VER-ALC', 'Proveedor local', 'Alcachofa', 'verdura', 'freshSmall', ['alcachofa']], ['VER-CHU', 'Proveedor local', 'Champiñones', 'verdura', 'freshSmall', ['champiñones']], ['VER-MAZ', 'Proveedor local', 'Mazorca de maíz', 'verdura', 'fresh', ['mazorca']],
    ],
  },
  {
    category: 'Panaderia', target: 120,
    families: [
      ['PAN-BIM', 'Bimbo', 'Pan tajado blanco', 'panaderia', 'bakery', ['pan tajado', 'pan bimbo']], ['PAN-BIM', 'Bimbo', 'Pan tajado integral', 'panaderia', 'bakery', ['pan integral']], ['PAN-COM', 'Comapan', 'Pan tajado blanco', 'panaderia', 'bakery', ['pan comapan']], ['PAN-COM', 'Comapan', 'Pan tajado integral', 'panaderia', 'bakery', ['pan integral']], ['PAN-RAM', 'Ramo', 'Pan tajado blanco', 'panaderia', 'bakery', ['pan ramo']], ['PAN-BIM', 'Bimbo', 'Pan para hamburguesa', 'panaderia', 'bakery', ['pan burger', 'pan hamburguesa']], ['PAN-BIM', 'Bimbo', 'Pan para perro caliente', 'panaderia', 'bakery', ['pan perro', 'pan hot dog']], ['PAN-COM', 'Comapan', 'Pan para perro caliente', 'panaderia', 'bakery', ['pan perro']], ['ARE-ESP', 'La Especial', 'Arepa blanca', 'panaderia', 'bakery', ['arepa', 'arepas']], ['ARE-ESP', 'La Especial', 'Arepa boyacense', 'panaderia', 'bakery', ['arepa boyacense']], ['ARE-ESP', 'La Especial', 'Arepa con queso', 'panaderia', 'bakery', ['arepa queso']], ['ARE-COL', 'Colanta', 'Arepa con queso', 'panaderia', 'bakery', ['arepa rellena']], ['TOR-BIM', 'Bimbo', 'Tortilla de trigo', 'panaderia', 'bakery', ['tortillas']], ['TOR-MIS', 'Mission', 'Tortilla de trigo', 'panaderia', 'bakery', ['tortilla']], ['TOA-RAM', 'Ramo', 'Tostadas tradicionales', 'panaderia', 'bakery', ['tostadas']], ['MOG-LOC', 'Panadería local', 'Mogolla integral', 'panaderia', 'bakery', ['mogolla']], ['MOG-LOC', 'Panadería local', 'Mogolla tradicional', 'panaderia', 'bakery', ['mogolla']], ['CRO-BIM', 'Bimbo', 'Croissant de mantequilla', 'panaderia', 'bakery', ['croissant']], ['PAN-LOC', 'Panadería local', 'Pan de bono', 'panaderia', 'bakery', ['pandebono']], ['PAN-LOC', 'Panadería local', 'Almojábana', 'panaderia', 'bakery', ['almojábana']], ['PAN-LOC', 'Panadería local', 'Buñuelo', 'panaderia', 'bakery', ['buñuelo']],
    ],
  },
  {
    category: 'Snacks', target: 120,
    families: [
      ['PAP-MAR', 'Margarita', 'Papas naturales', 'snack', 'snacks', ['papas margarita', 'papitas']], ['PAP-MAR', 'Margarita', 'Papas sabor limón', 'snack', 'snacks', ['papas limón']], ['PAP-MAR', 'Margarita', 'Papas sabor pollo', 'snack', 'snacks', ['papas pollo']], ['PAP-SUP', 'Super Ricas', 'Papas naturales', 'snack', 'snacks', ['super ricas']], ['PAP-SUP', 'Super Ricas', 'Papas sabor pollo', 'snack', 'snacks', ['papas de pollo']], ['PAP-YUP', 'Yupi', 'Papas sabor limón', 'snack', 'snacks', ['papas yupi']], ['TOST-YUP', 'Yupi', 'Tostacos picante', 'snack', 'snacks', ['tostacos']], ['TOST-YUP', 'Yupi', 'Tostacos BBQ', 'snack', 'snacks', ['tostacos bbq']], ['MAI-MAR', 'Margarita', 'Maizitos', 'snack', 'snacks', ['maizitos']], ['CHI-MAR', 'Margarita', 'Cheese Tris', 'snack', 'snacks', ['chistris', 'cheese tris']], ['CHO-YUP', 'Yupi', 'Choclitos limón', 'snack', 'snacks', ['choclitos']], ['CHO-YUP', 'Yupi', 'Choclitos BBQ', 'snack', 'snacks', ['choclitos bbq']], ['DOR-FRI', 'Doritos', 'Doritos queso', 'snack', 'snacks', ['doritos', 'nachos']], ['DOR-FRI', 'Doritos', 'Doritos Dinamita', 'snack', 'snacks', ['doritos picante']], ['DET-MAR', 'Margarita', 'De Todito original', 'snack', 'snacks', ['detodito', 'de todito']], ['DET-MAR', 'Margarita', 'De Todito BBQ', 'snack', 'snacks', ['detodito bbq']], ['MAN-ESP', 'La Especial', 'Maní salado', 'snack', 'snacks', ['maní']], ['MAN-ESP', 'La Especial', 'Maní confitado', 'snack', 'snacks', ['maní dulce']], ['GAL-NOE', 'Noel', 'Galletas Saltín', 'galleta', 'snacks', ['saltinas', 'galletas de sal']], ['GAL-NOE', 'Noel', 'Galletas Ducales', 'galleta', 'snacks', ['ducales']], ['GAL-FES', 'Festival', 'Galletas Festival chocolate', 'galleta', 'snacks', ['festival']], ['GAL-ORE', 'Oreo', 'Galletas Oreo', 'galleta', 'snacks', ['oreo']], ['GAL-CHO', 'Chokis', 'Galletas Chokis', 'galleta', 'snacks', ['chokis']], ['GAL-TRI', 'Tr3s', 'Galletas rellenas', 'galleta', 'snacks', ['galletas rellenas']], ['PON-RAM', 'Ramo', 'Ponqué Chocoramo', 'ponque', 'snacks', ['chocorramo', 'chocoramo', 'ponque ramo']], ['PON-RAM', 'Ramo', 'Ponqué Gala vainilla', 'ponque', 'snacks', ['gala', 'ponque gala']], ['PON-RAM', 'Ramo', 'Ponqué Gala chocolate', 'ponque', 'snacks', ['gala chocolate']], ['PON-BIM', 'Bimbo', 'Ponqué tres leches mora', 'ponque', 'snacks', ['ponque bimbo', 'tres leches']], ['BRO-MAM', 'Mamá Inés', 'Brownie de arequipe', 'reposteria', 'snacks', ['brownie mamai', 'brownie']], ['CHO-JET', 'Jet', 'Chocolatina de leche', 'dulce', 'snacks', ['jet', 'chocolatina']], ['CHO-JUM', 'Jumbo', 'Chocolatina Jumbo', 'dulce', 'snacks', ['jumbo']], ['DUL-NUC', 'Nucita', 'Crema de chocolate', 'dulce', 'snacks', ['nucita']], ['DUL-BON', 'Colombina', 'Bon Bon Bum surtido', 'dulce', 'snacks', ['bombombum', 'chupeta']], ['CHI-TRI', 'Trident', 'Chicle hierbabuena', 'dulce', 'snacks', ['trident', 'chicle']], ['DUL-BOC', 'La Constancia', 'Bocadillo veleño', 'dulce', 'snacks', ['bocadillo']],
    ],
  },
  {
    category: 'Bebidas', target: 180,
    families: [
      ['COC-ORI', 'Coca-Cola', 'Coca-Cola original', 'gaseosa', 'soda', ['coca', 'coca cola', 'cocacola', 'gaseosa']], ['COC-ZER', 'Coca-Cola', 'Coca-Cola sin azúcar', 'gaseosa', 'soda', ['coca zero', 'coca sin azúcar']], ['SPR-LIM', 'Sprite', 'Sprite limón', 'gaseosa', 'soda', ['sprite']], ['FAN-NAR', 'Fanta', 'Fanta naranja', 'gaseosa', 'soda', ['fanta']], ['PEP-ORI', 'Pepsi', 'Pepsi original', 'gaseosa', 'soda', ['pepsi']], ['POS-COL', 'Postobón', 'Colombiana', 'gaseosa', 'soda', ['colombiana']], ['POS-MAN', 'Postobón', 'Manzana Postobón', 'gaseosa', 'soda', ['manzana']], ['POS-UVA', 'Postobón', 'Uva Postobón', 'gaseosa', 'soda', ['uva']], ['POS-NAR', 'Postobón', 'Naranja Postobón', 'gaseosa', 'soda', ['naranja postobón']], ['KOL-ROM', 'Kola Román', 'Gaseosa Kola Román', 'gaseosa', 'soda', ['colita', 'kola']], ['QUI-POST', 'Postobón', 'Quatro', 'gaseosa', 'soda', ['quatro']], ['BRE-POST', 'Bretaña', 'Bretaña soda', 'soda', 'soda', ['bretaña', 'bretana']], ['H2O-LIM', 'H2OH!', 'H2OH! limón', 'agua saborizada', 'beverage', ['h2oh']], ['H2O-MAN', 'H2OH!', 'H2OH! manzana', 'agua saborizada', 'beverage', ['h2oh manzana']], ['AGU-CRI', 'Cristal', 'Agua sin gas', 'agua', 'beverage', ['agua', 'botella de agua']], ['AGU-BRI', 'Brisa', 'Agua sin gas', 'agua', 'beverage', ['agua brisa']], ['AGU-MAN', 'Manantial', 'Agua sin gas', 'agua', 'beverage', ['agua manantial']], ['AGU-CRI', 'Cristal', 'Agua con gas', 'agua', 'beverage', ['agua con gas']], ['MAL-PON', 'Pony Malta', 'Pony Malta', 'malta', 'beverage', ['pony malta', 'malta', 'ponimalta']], ['MAL-POW', 'Power Malt', 'Malta', 'malta', 'beverage', ['malta']],
      ['HIT-MAN', 'Hit', 'Jugo Hit mango', 'jugo', 'beverage', ['hit mango', 'juguito hit']], ['HIT-MOR', 'Hit', 'Jugo Hit mora', 'jugo', 'beverage', ['hit mora']], ['HIT-TRO', 'Hit', 'Jugo Hit tropical', 'jugo', 'beverage', ['hit tropical']], ['CIF-GRA', 'Cifrut', 'Cifrut granadilla', 'jugo', 'beverage', ['cifrut', 'cfrut', 'granadilla']], ['CIF-NAR', 'Cifrut', 'Cifrut naranja', 'jugo', 'beverage', ['cifrut naranja']], ['TUT-MOR', 'Tutti Frutti', 'Tutti Frutti mora', 'jugo', 'beverage', ['tutti frutti']], ['TUT-NAR', 'Tutti Frutti', 'Tutti Frutti naranja', 'jugo', 'beverage', ['tutti frutti naranja']], ['FRU-NAR', 'Alpina', 'Frutto naranja', 'jugo', 'beverage', ['frutto']], ['DEL-MAN', 'Del Valle', 'Jugo Del Valle mango', 'jugo', 'beverage', ['del valle']], ['TAM-CIT', 'Tampico', 'Tampico citrus punch', 'jugo', 'beverage', ['tampico']], ['MRT-LIM', 'Mr Tea', 'Mr Tea limón', 'te_listo', 'beverage', ['mr tea', 'té limón']], ['MRT-DUR', 'Mr Tea', 'Mr Tea durazno', 'te_listo', 'beverage', ['mr tea durazno', 'té durazno']],
      ['GAT-AZU', 'Gatorade', 'Gatorade azul', 'hidratante', 'beverage', ['gatorade', 'hidratante']], ['GAT-NAR', 'Gatorade', 'Gatorade naranja', 'hidratante', 'beverage', ['gatorade naranja']], ['ELE-UVA', 'Electrolit', 'Electrolit uva', 'hidratante', 'beverage', ['electrolit', 'suero']], ['VIV-ORI', 'Vive100', 'Vive100 original', 'energizante', 'beverage', ['vive100', 'vive 100']], ['VIV-NAR', 'Vive100', 'Vive100 naranja', 'energizante', 'beverage', ['vive naranja']], ['SPD-MAX', 'Speed Max', 'Speed Max energizante', 'energizante', 'beverage', ['speed max', 'speed']], ['RDB-ORI', 'Red Bull', 'Red Bull original', 'energizante', 'beverage', ['red bull']], ['MON-ORI', 'Monster', 'Monster energy', 'energizante', 'beverage', ['monster']],
    ],
  },
  {
    category: 'Aseo hogar', target: 180,
    families: [
      ['DET-ARI', 'Ariel', 'Detergente en polvo', 'aseo_hogar', 'cleaningSolid', ['detergente', 'jabon de ropa']], ['DET-FAB', 'Fab', 'Detergente en polvo', 'aseo_hogar', 'cleaningSolid', ['fab']], ['DET-DER', 'Dersa', 'Detergente en polvo', 'aseo_hogar', 'cleaningSolid', ['dersa']], ['DET-RIN', 'Rindex', 'Detergente en polvo', 'aseo_hogar', 'cleaningSolid', ['rindex']], ['DET-1A', '1A', 'Detergente en polvo', 'aseo_hogar', 'cleaningSolid', ['detergente económico']], ['DET-LIQ', 'Ariel', 'Detergente líquido', 'aseo_hogar', 'cleaningLiquid', ['detergente líquido']], ['DET-DER', 'Dersa', 'Jabón para ropa en barra', 'aseo_hogar', 'cleaningSolid', ['jabon dersa']], ['DET-REY', 'Rey', 'Jabón azul en barra', 'aseo_hogar', 'cleaningSolid', ['jabon rey', 'jabón azul']],
      ['LAV-AXI', 'Axion', 'Lavaloza limón', 'aseo_hogar', 'cleaningSolid', ['axion', 'lavaloza']], ['LAV-LOZ', 'Loza Crem', 'Lavaloza', 'aseo_hogar', 'cleaningSolid', ['lozacrem', 'lava loza']], ['LAV-FAB', 'Fab', 'Lavaloza líquido', 'aseo_hogar', 'cleaningLiquid', ['lavaloza líquido']], ['DES-FAB', 'Fabuloso', 'Limpiador lavanda', 'aseo_hogar', 'cleaningLiquid', ['fabuloso']], ['DES-PIN', 'Pinol', 'Desinfectante', 'aseo_hogar', 'cleaningLiquid', ['pinol', 'desinfectante']], ['DES-CLX', 'Clorox', 'Blanqueador', 'aseo_hogar', 'cleaningLiquid', ['clorox', 'cloro', 'blanqueador']], ['DES-LIM', 'Límpido', 'Blanqueador', 'aseo_hogar', 'cleaningLiquid', ['limpido', 'límpido']], ['DES-AJA', 'Ajax', 'Limpiador multiusos', 'aseo_hogar', 'cleaningLiquid', ['ajax']], ['DES-MUS', 'Mr Músculo', 'Limpiador de cocina', 'aseo_hogar', 'cleaningLiquid', ['mr músculo']], ['VID-WIN', 'Windex', 'Limpia vidrios', 'aseo_hogar', 'cleaningLiquid', ['windex', 'limpia vidrios']], ['SUA-SUA', 'Suavitel', 'Suavizante de ropa', 'aseo_hogar', 'cleaningLiquid', ['suavitel', 'suavizante']], ['SUA-DOWN', 'Downy', 'Suavizante de ropa', 'aseo_hogar', 'cleaningLiquid', ['downy']],
      ['PAP-FAM', 'Familia', 'Papel higiénico doble hoja', 'papel', 'personal', ['papel higiénico', 'papel de baño', 'famila']], ['PAP-ROS', 'Rosal', 'Papel higiénico', 'papel', 'personal', ['papel rosal']], ['PAP-KLE', 'Kleenex', 'Papel higiénico', 'papel', 'personal', ['papel kleenex']], ['SER-FAM', 'Familia', 'Servilletas', 'papel', 'personal', ['servilletas']], ['TOA-FAM', 'Familia', 'Toallas de cocina', 'papel', 'personal', ['toalla de cocina', 'papel cocina']], ['BOL-RIM', 'Rimax', 'Bolsas para basura', 'hogar', 'personal', ['bolsas de basura', 'bolsas negras']], ['BOL-ZIP', 'Ziploc', 'Bolsas herméticas', 'hogar', 'personal', ['ziploc', 'bolsas herméticas']], ['ESP-BRI', 'Brillo', 'Esponjilla de cocina', 'hogar', 'personal', ['esponjilla']], ['GUA-VIL', 'Vileda', 'Guantes de aseo', 'hogar', 'personal', ['guantes de limpieza']], ['PAN-VIL', 'Vileda', 'Paño de microfibra', 'hogar', 'personal', ['pañito']], ['TRA-VIL', 'Vileda', 'Trapero', 'hogar', 'personal', ['trapero', 'mopa']], ['AMB-GLA', 'Glade', 'Ambientador', 'hogar', 'cleaningLiquid', ['glade', 'ambientador']], ['INS-RAI', 'Raid', 'Insecticida', 'hogar', 'cleaningLiquid', ['raid', 'mata insectos']], ['PAP-ALU', 'Reynolds', 'Papel aluminio', 'hogar', 'personal', ['papel aluminio']],
    ],
  },
  {
    category: 'Aseo personal', target: 150,
    families: [
      ['DEN-COL', 'Colgate', 'Crema dental triple acción', 'cuidado_personal', 'personal', ['colgate', 'pasta dental', 'crema dental']], ['DEN-COL', 'Colgate', 'Crema dental herbal', 'cuidado_personal', 'personal', ['crema dental']], ['DEN-CLO', 'Closeup', 'Crema dental menta', 'cuidado_personal', 'personal', ['close up']], ['DEN-SEN', 'Sensodyne', 'Crema dental', 'cuidado_personal', 'personal', ['sensodyne']], ['CEP-COL', 'Colgate', 'Cepillo dental', 'cuidado_personal', 'personal', ['cepillo de dientes']], ['HIL-COL', 'Colgate', 'Hilo dental', 'cuidado_personal', 'personal', ['seda dental']],
      ['JAB-PRO', 'Protex', 'Jabón corporal avena', 'cuidado_personal', 'personal', ['protex', 'jabon de baño']], ['JAB-DOV', 'Dove', 'Jabón corporal blanco', 'cuidado_personal', 'personal', ['dove']], ['JAB-PAL', 'Palmolive', 'Jabón corporal', 'cuidado_personal', 'personal', ['palmolive']], ['JAB-REX', 'Rexona', 'Jabón corporal', 'cuidado_personal', 'personal', ['jabon']], ['JAB-REY', 'Rey', 'Jabón azul multiuso', 'cuidado_personal', 'cleaningSolid', ['jabon azul']],
      ['SHA-SAV', 'Savital', 'Shampoo multivitaminas', 'cuidado_personal', 'personal', ['savital', 'shampoo', 'champú']], ['SHA-HS', 'Head & Shoulders', 'Shampoo anticaspa', 'cuidado_personal', 'personal', ['head shoulders', 'h&s']], ['SHA-PAN', 'Pantene', 'Shampoo hidratación', 'cuidado_personal', 'personal', ['pantene']], ['SHA-ELV', 'Elvive', 'Shampoo reparación', 'cuidado_personal', 'personal', ['elvive']], ['ACO-PAN', 'Pantene', 'Acondicionador', 'cuidado_personal', 'personal', ['acondicionador']], ['ACO-SAV', 'Savital', 'Acondicionador', 'cuidado_personal', 'personal', ['acondicionador savital']],
      ['DES-AXE', 'Axe', 'Desodorante aerosol', 'cuidado_personal', 'personal', ['axe', 'desodorante']], ['DES-REX', 'Rexona', 'Desodorante aerosol', 'cuidado_personal', 'personal', ['rexona']], ['DES-SPE', 'Speed Stick', 'Desodorante barra', 'cuidado_personal', 'personal', ['speed stick']], ['DES-NIV', 'Nivea', 'Desodorante roll-on', 'cuidado_personal', 'personal', ['nivea']], ['CRE-NIV', 'Nivea', 'Crema corporal', 'cuidado_personal', 'personal', ['crema corporal']], ['PRO-NIV', 'Nivea', 'Protector solar', 'cuidado_personal', 'personal', ['bloqueador', 'protector solar']],
      ['AFE-GIL', 'Gillette', 'Afeitadora desechable', 'cuidado_personal', 'personal', ['afeitadora', 'rasuradora']], ['PAP-JGB', 'JGB', 'Copitos', 'cuidado_personal', 'personal', ['copitos', 'hisopos']], ['ALG-JGB', 'JGB', 'Algodón', 'cuidado_personal', 'personal', ['algodón']], ['ENJ-LIS', 'Listerine', 'Enjuague bucal', 'cuidado_personal', 'personal', ['listerine', 'enjuague']], ['TOA-NOS', 'Nosotras', 'Toallas higiénicas', 'cuidado_personal', 'personal', ['toallas higiénicas']], ['PRO-INT', 'Nosotras', 'Protectores diarios', 'cuidado_personal', 'personal', ['protectores']],
    ],
  },
  {
    category: 'Bebes', target: 80,
    families: [
      ['PAN-WIN', 'Winny', 'Pañales etapa 1', 'bebe', 'baby', ['pañales', 'pañalito', 'winny 1']], ['PAN-WIN', 'Winny', 'Pañales etapa 2', 'bebe', 'baby', ['pañales', 'winny 2']], ['PAN-WIN', 'Winny', 'Pañales etapa 3', 'bebe', 'baby', ['pañales', 'winny 3']], ['PAN-WIN', 'Winny', 'Pañales etapa 4', 'bebe', 'baby', ['pañales', 'winny 4']], ['PAN-WIN', 'Winny', 'Pañales etapa 5', 'bebe', 'baby', ['pañales', 'winny 5']], ['PAN-PEQ', 'Pequeñín', 'Pañales etapa 3', 'bebe', 'baby', ['pequeñín']], ['PAN-PEQ', 'Pequeñín', 'Pañales etapa 4', 'bebe', 'baby', ['pequeñín']], ['PAN-HUG', 'Huggies', 'Pañales etapa 3', 'bebe', 'baby', ['huggies']], ['PAN-HUG', 'Huggies', 'Pañales etapa 4', 'bebe', 'baby', ['huggies']], ['PAN-PAM', 'Pampers', 'Pañales etapa 3', 'bebe', 'baby', ['pampers']],
      ['TOA-WIN', 'Winny', 'Toallitas húmedas', 'bebe', 'baby', ['pañitos de bebé', 'toallitas']], ['TOA-JOH', 'Johnson’s', 'Toallitas húmedas', 'bebe', 'baby', ['pañitos']], ['COM-ALP', 'Alpina', 'Compota de manzana', 'bebe', 'dairy', ['compota']], ['COM-ALP', 'Alpina', 'Compota de pera', 'bebe', 'dairy', ['compota']], ['COM-GER', 'Gerber', 'Compota de frutas', 'bebe', 'dairy', ['gerber', 'compota']], ['FOR-ENF', 'Enfamil', 'Fórmula infantil', 'bebe', 'pantryShort', ['leche de fórmula']], ['FOR-NAN', 'NAN', 'Fórmula infantil', 'bebe', 'pantryShort', ['fórmula bebé']], ['FOR-SIM', 'Similac', 'Fórmula infantil', 'bebe', 'pantryShort', ['fórmula']],
    ],
  },
  {
    category: 'Mascotas', target: 70,
    families: [
      ['DOG-CHO', 'Dog Chow', 'Alimento perro adulto', 'mascotas', 'pet', ['concentrado perro', 'comida perro']], ['DOG-CHO', 'Dog Chow', 'Alimento perro cachorro', 'mascotas', 'pet', ['concentrado cachorro']], ['DOG-PED', 'Pedigree', 'Alimento perro adulto', 'mascotas', 'pet', ['pedigree']], ['DOG-PED', 'Pedigree', 'Alimento perro cachorro', 'mascotas', 'pet', ['comida cachorro']], ['DOG-RIN', 'Ringo', 'Alimento perro adulto', 'mascotas', 'pet', ['ringo']], ['DOG-NUT', 'Nutrecan', 'Alimento perro adulto', 'mascotas', 'pet', ['nutrecan']], ['DOG-CHU', 'Chunky', 'Alimento perro adulto', 'mascotas', 'pet', ['chunky']], ['DOG-MAX', 'Max', 'Alimento perro adulto', 'mascotas', 'pet', ['max']],
      ['CAT-CHO', 'Cat Chow', 'Alimento gato adulto', 'mascotas', 'pet', ['comida gato', 'cat chow']], ['CAT-WHI', 'Whiskas', 'Alimento gato adulto', 'mascotas', 'pet', ['whiskas']], ['CAT-MIR', 'Mirringo', 'Alimento gato adulto', 'mascotas', 'pet', ['mirringo']], ['CAT-EXI', 'Éxito', 'Alimento gato marca propia', 'mascotas', 'pet', ['comida gato económica']], ['CAT-ARE', 'Miaumor', 'Arena para gato', 'mascotas', 'pet', ['arena gato', 'arena para gatos']], ['CAT-ARE', 'Cat Litter', 'Arena aglomerante para gato', 'mascotas', 'pet', ['arena aglomerante']],
      ['PRE-PED', 'Pedigree', 'Premios para perro', 'mascotas', 'pet', ['premios perro', 'galletas perro']], ['PRE-CHO', 'Dog Chow', 'Premios para perro', 'mascotas', 'pet', ['snack perro']], ['HUE-PED', 'Pedigree', 'Hueso de carnaza', 'mascotas', 'pet', ['hueso perro']], ['ARE-MIA', 'Miaumor', 'Arena sanitaria', 'mascotas', 'pet', ['arena sanitaria']],
    ],
  },
];

function expandFamily(row, category) {
  const [prefix, brand, name, productFamily, presentationSet, aliases = []] = row;
  return family(prefix, category, brand, name, productFamily, presentationSet, aliases);
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.flat().map(value => String(value ?? '').trim()).filter(Boolean))];
}

function aliasesFor({ category, brand, name, familyAliases, presentationAliases }) {
  const nameWords = normalizeText(name).split(' ').filter(word => word.length > 3);
  return unique([
    ...familyAliases,
    ...presentationAliases,
    ...(CATEGORY_ALIASES[category] ?? []),
    nameWords.length > 1 ? nameWords.slice(-2).join(' ') : nameWords,
    brand,
  ]);
}

function candidateProducts(block) {
  const candidates = [];
  for (const row of block.families) {
    const item = expandFamily(row, block.category);
    for (const [presentation, presentationAliases] of PRESENTATIONS[item.presentationSet]) {
      candidates.push({
        ...item,
        presentation,
        aliases: aliasesFor({
          category: item.category,
          brand: item.brand,
          name: item.name,
          familyAliases: item.aliases,
          presentationAliases,
        }),
      });
    }
  }
  return candidates;
}

const existingIdentity = new Set(colombiaCatalogTestSeed300.map(product => normalizeText([product.name, product.brand, product.presentation].join('|'))));
const generatedIdentity = new Set();
let nextSku = 1;

function selectBlock(block) {
  const selected = [];
  for (const candidate of candidateProducts(block)) {
    const identity = normalizeText([candidate.name, candidate.brand, candidate.presentation].join('|'));
    if (existingIdentity.has(identity) || generatedIdentity.has(identity)) continue;
    generatedIdentity.add(identity);
    selected.push(enrichCatalogReference({
      sku: `CO-RES-${String(nextSku++).padStart(4, '0')}`,
      name: candidate.name,
      category: candidate.category,
      brand: candidate.brand,
      presentation: candidate.presentation,
      price: 0,
      stock: 0,
      aliases: candidate.aliases,
      active: false,
      driveFileId: null,
      allowsSaleByAmount: false,
    }, {
      productFamily: candidate.productFamily,
      description: `${candidate.name}, ${candidate.presentation}. Referencia observada en surtidos de comercio minorista colombiano; precio y stock pendientes de sincronización del tenant.`,
      catalogOrigin: 'colombia_market_research_2026_presence',
      tags: ['investigacion_mercado', 'presencia_retail', 'precio_pendiente', 'stock_pendiente'],
    }));
    if (selected.length >= block.target) break;
  }
  if (selected.length !== block.target) {
    throw new Error(`El bloque ${block.category} produjo ${selected.length} referencias; se esperaban ${block.target}.`);
  }
  return selected;
}

const rawResearchAdditions1700 = blocks.flatMap(selectBlock);

function amountSaleCategory(category = '') {
  const normalized = normalizeText(category);
  return normalized.includes('fruta') || normalized.includes('verdura') || normalized.includes('hortaliza') || normalized.includes('carnes fria') || normalized.includes('charcuteria');
}

export const colombiaCatalogResearchAdditions1700 = rawResearchAdditions1700.map(product => ({
  ...product,
  allowsSaleByAmount: amountSaleCategory(product.category),
}));

export const colombiaCatalogResearch2000 = [
  ...colombiaCatalogTestSeed300.map(product => ({
    ...product,
    allowsSaleByAmount: amountSaleCategory(product.category),
  })),
  ...colombiaCatalogResearchAdditions1700,
];

// Alias explicit for tests/importers that need the complete Colombian fixture.
export const colombiaCatalogTestSeed2000 = colombiaCatalogResearch2000;

const uniqueSkus = new Set(colombiaCatalogResearch2000.map(product => product.sku));
if (colombiaCatalogResearchAdditions1700.length !== 1700 || colombiaCatalogResearch2000.length !== 2000 || uniqueSkus.size !== 2000) {
  throw new Error('El catálogo colombiano debe contener 2.000 SKU únicos: 300 conservados y 1.700 referencias de investigación.');
}

export const colombiaCatalogResearchDistribution = Object.fromEntries(
  blocks.map(block => [block.category, block.target]),
);

