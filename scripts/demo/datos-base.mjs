// Datos base 100 % FICTICIOS del conjunto demo. Marcas y modelos son nombres de catalogo (los mismos que tienen foto en public/): precios, costos, cantidades,
// clientes, contactos y guias son inventados. Ningun dato real de ventas, clientes, telefonos ni correos vive aqui.

/** [marca, modelo, puffs, costoIsaacCent, costoKarenCent]: costos de demostracion (pesos por pieza x 100), inventados. */
export const MODELOS = [
  ['Waka', 'Waka Blast 50K', 50000, 21800, 22600],
  ['Waka', 'Waka Duo 25K', 25000, 15200, 15900],
  ['Waka', 'Waka GO Mundialista 10K', 10000, 8300, 8700],
  ['Waka', 'Waka Icon 50K', 50000, 22400, 23100],
  ['Waka', 'Waka Icon Slim 20K', 20000, 12600, 13100],
  ['Waka', 'Waka Jupiter 50K', 50000, 23200, 23900],
  ['Waka', 'Waka Elite 40K', 40000, 18900, 19600],
  ['Waka', 'Waka Burst 36K', 36000, 17100, 17800],
  ['Waka', 'Waka Blade 33K', 33000, 16000, 16700],
  ['Waka', 'Waka Slim 12K', 12000, 8900, 9400],
  ['Waka', 'Waka Sopro 30K', 30000, 14700, 15300],
  ['Waka', 'Waka Optimus 100K', 100000, 38500, 39800],
  ['Waka', 'Waka GO 10K', 10000, 8100, 8500],
  ['Geek Bar', 'Geek Bar 2GO 50K', 50000, 24100, 24900],
  ['Geek Bar', 'Geek Bar Somax 80K', 80000, 33900, 35000],
  ['Elfbar', 'Elfbar BC Pro 40K', 40000, 19400, 20100],
  ['Fasta', 'Fasta 37K', 37000, 17600, 18300],
  ['Fasta', 'Fasta Burst 35K', 35000, 16800, 17500],
  ['Equator', 'Equator 30K', 30000, 14900, 15500],
  ['Flavor Beast', 'Flavor Beast 50K', 50000, 22900, 23700],
  ['IPLAY', 'IPLAY Box Pro Max 50K', 50000, 23600, 24400],
  ['IPLAY', 'IPLAY Burst 45K', 45000, 20800, 21500],
  ['IPLAY', 'IPLAY Box Pro 15K', 15000, 10400, 10900],
  ['IPLAY', 'IPLAY Box 4K', 4000, 4600, 4900],
  ['Lost Mary', 'Lost Mary Ultrasonic', 35000, 17300, 18000],
  ['Maskking', 'Maskking Extre 100K', 100000, 39400, 40700],
  ['Nexa', 'Nexa Pix 35K', 35000, 16500, 17200],
  ['Nexa', 'Nexa Ultra 40K', 40000, 19100, 19800],
  ['Pillow Talk', 'Pillow Talk 40K', 40000, 18700, 19400],
  ['South', 'South 3K', 3000, 3900, 4200],
];

/** Sabores genericos (sin marcas registradas ni nombres de personas). */
export const SABORES = [
  'Alaska Ice', 'Banana Ice', 'Blue Razz Ice', 'Blueberry Ice', 'Blueberry Mint', 'Cherry Ice', 'Coconut Ice', 'Cool Mint', 'Double Mint', 'Fresh Mint',
  'Frozen Banana', 'Grape Ice', 'Green Apple', 'Guava Raspberry', 'Ice Mint', 'Icy Peach', 'Kiwi Ice', 'Lemon Frozen', 'Lychee Ice', 'Mango Ice',
  'Mexican Mango', 'Mixed Berries', 'Orange Ice', 'Passion Fruit', 'Peach Ice', 'Peach Mango', 'Pink Lemonade', 'Strawberry Banana', 'Strawberry Ice', 'Strawberry Kiwi',
  'Strawberry Mango', 'Strawberry Watermelon', 'Triple Berry', 'Watermelon Ice', 'Watermelon Kiwi', 'Watermelon Mint', 'Winter Mint', 'Sour Watermelon', 'Peach Blue Razz', 'Piña Colada',
  'Maracuya', 'Cherry Watermelon', 'Grape Lemonade', 'Mango Lychee', 'Miami Mint', 'Blueberry Raspberry', 'Strawberry Guava', 'Tulum Mint', 'Energy Drink', 'Black Cherry',
];

export const TIPOS_NEGOCIO = ['Vapes', 'Tienda', 'Abarrotes', 'Smoke', 'Cloud', 'Mini Super', 'Expendio', 'Estanquillo', 'Cigarros y Mas', 'Punto'];
export const PALABRAS_NEGOCIO = [
  'Aurora', 'Brisa', 'Cobalto', 'Dalia', 'Eclipse', 'Fresno', 'Girasol', 'Halcon', 'Iris', 'Jade', 'Kiwi', 'Laguna', 'Meseta', 'Nogal', 'Ocaso', 'Pinar',
  'Quetzal', 'Roble', 'Sauce', 'Trebol', 'Umbral', 'Vega', 'Xilote', 'Yaxche', 'Zafiro', 'Alba', 'Bruma', 'Cedro', 'Duna', 'Ebano', 'Fenix', 'Granito',
  'Hiedra', 'Isla', 'Jazmin', 'Lirio', 'Mirto', 'Nube', 'Olivo', 'Perla',
];
/** Nombres de pila inventados para los contactos de los clientes (no corresponden a nadie). */
export const CONTACTOS = ['Contacto Uno', 'Contacto Dos', 'Contacto Tres', 'Contacto Cuatro', 'Contacto Cinco', 'Contacto Seis', 'Contacto Siete', 'Contacto Ocho'];

export const PAQUETERIAS = ['Castores', 'Pitic', 'DHL', 'Estafeta'];
export const PREFIJO_GUIA = { Castores: 'CAS', Pitic: 'PIT', DHL: 'DHL', Estafeta: 'EST' };

/** Cuentas de acceso del demo: correos reservados example.test; el identificador es fijo para que el demo sea reproducible. */
export const USUARIOS = [
  { clave: 'socio_a', rol: 'socio', socio: 'Angelo', nombre: 'Socio Demo A', correo: 'socio.demo.a@example.test', id: 'de000000-0000-4000-8000-0000000000a1' },
  { clave: 'socio_b', rol: 'socio', socio: 'Javier', nombre: 'Socio Demo B', correo: 'socio.demo.b@example.test', id: 'de000000-0000-4000-8000-0000000000a2' },
  { clave: 'omar', rol: 'omar', socio: null, nombre: 'Omar Demo', correo: 'omar.demo@example.test', id: 'de000000-0000-4000-8000-0000000000a3' },
  { clave: 'bodega', rol: 'bodega', socio: null, nombre: 'Bodega Demo', correo: 'bodega.demo@example.test', id: null },
];
