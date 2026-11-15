// Fotos de los modelos del catalogo. Datos, no UI: cada modelo activo declara su foto (public/modelos/<slug>.webp) o, de forma explicita, que no la tiene.
// Procedencia de cada imagen: docs/fotos-modelos.md. Una sola tabla para todas las pantallas (catalogo, inventario, pedidos, compras, tablero del proveedor): la foto es una ruta publica
// que puede apuntar a public/proveedores/karen (fotos del proveedor) o a public/modelos (propias); un archivo nunca se duplica. Lista leida de solo lectura de catalogo.modelo el 14-nov.

export interface FotoModelo {
  /** Id de catalogo.modelo. */
  id: number;
  marca: string;
  /** Nombre canonico (catalogo.modelo.nombre_canonico). */
  nombre: string;
  /** Ruta publica de la foto (/modelos/<slug>.webp o /proveedores/karen/<clave>.webp), o null si el modelo no tiene foto. */
  foto: string | null;
  /** Que tan segura es la foto: exacto (mismo modelo y puffs), probable (misma linea, nombre sin puffs o variante) o sin_evidencia (sin foto). Los probables estan en docs/marcas-por-confirmar.md. */
  confianza: 'exacto' | 'probable' | 'sin_evidencia';
}

export const MOTIVO_SIN_FOTO = 'No se ubico una imagen oficial del proveedor o de la marca que corresponda con exactitud a este modelo.';

export const FOTOS_MODELOS: readonly FotoModelo[] = [
  { id: 109, marca: 'Adjust', nombre: 'Adjust 40K', foto: null, confianza: 'sin_evidencia' },
  { id: 110, marca: 'Dojo', nombre: 'Dojo 40K', foto: null, confianza: 'sin_evidencia' },
  { id: 150, marca: 'Elfbar', nombre: 'Elfbar 40K', foto: null, confianza: 'sin_evidencia' },
  { id: 114, marca: 'Elfbar', nombre: 'Elfbar BC Pro 40K', foto: '/proveedores/karen/elfbar-bc-pro-40k.webp', confianza: 'exacto' },
  { id: 106, marca: 'Elux', nombre: 'Elux 50K', foto: null, confianza: 'sin_evidencia' },
  { id: 107, marca: 'Equator', nombre: 'Equator 30K', foto: '/modelos/equator-30k.webp', confianza: 'exacto' },
  { id: 115, marca: 'Extre Bar', nombre: 'Extre Bar 40K', foto: null, confianza: 'sin_evidencia' },
  { id: 121, marca: 'Fasta', nombre: 'Fasta 37K', foto: '/proveedores/karen/fasta-37-000.webp', confianza: 'exacto' },
  { id: 101, marca: 'Fasta', nombre: 'Fasta Burst 35K', foto: '/modelos/fasta-burst-35k.webp', confianza: 'exacto' },
  { id: 102, marca: 'Fasta', nombre: 'Fasta Burst 37K', foto: null, confianza: 'sin_evidencia' },
  { id: 103, marca: 'Fasta', nombre: 'Fasta Kit 40K', foto: null, confianza: 'sin_evidencia' },
  { id: 94, marca: 'Flavor Beast', nombre: 'Flavor Beast 50K', foto: '/modelos/flavor-beast-50k.webp', confianza: 'exacto' },
  { id: 118, marca: 'Funky Republic', nombre: 'Funky Republic Fi 3K', foto: null, confianza: 'sin_evidencia' },
  { id: 84, marca: 'Geek Bar', nombre: 'Geek Bar 2GO 50K', foto: '/modelos/geek-bar-2go-50k.webp', confianza: 'exacto' },
  { id: 81, marca: 'Geek Bar', nombre: 'Geek Bar Somax 80K', foto: '/modelos/geek-bar-somax-80k.webp', confianza: 'exacto' },
  { id: 161, marca: 'IPLAY', nombre: 'iPlay 15K', foto: null, confianza: 'sin_evidencia' },
  { id: 100, marca: 'IPLAY', nombre: 'IPLAY Box 4K', foto: '/proveedores/karen/vape-iplay-x-box.webp', confianza: 'probable' },
  { id: 98, marca: 'IPLAY', nombre: 'IPLAY Box Pro 15K', foto: '/proveedores/karen/vape-iplay-x-box-pro.webp', confianza: 'probable' },
  { id: 82, marca: 'IPLAY', nombre: 'IPLAY Box Pro Max 50K', foto: '/proveedores/karen/iplay-x-box-pro-max-50-000.webp', confianza: 'exacto' },
  { id: 97, marca: 'IPLAY', nombre: 'IPLAY Burst 45K', foto: '/proveedores/karen/iplay-burst-45-000.webp', confianza: 'exacto' },
  { id: 111, marca: 'IPLAY', nombre: 'IPLAY Max', foto: '/proveedores/karen/vape-iplay-max.webp', confianza: 'exacto' },
  { id: 105, marca: 'Lost Mary', nombre: 'Lost Mary 35K', foto: null, confianza: 'sin_evidencia' },
  { id: 149, marca: 'Lost Mary', nombre: 'Lost Mary Ultrasonic', foto: '/modelos/lost-mary-ultrasonic.webp', confianza: 'exacto' },
  { id: 159, marca: 'Maskking', nombre: 'Maskking 100K', foto: null, confianza: 'sin_evidencia' },
  { id: 91, marca: 'Maskking', nombre: 'Maskking Extre 100K', foto: '/modelos/maskking-extre-100k.webp', confianza: 'exacto' },
  { id: 86, marca: 'Maskking', nombre: 'Maskking Fexo 45K', foto: null, confianza: 'sin_evidencia' },
  { id: 88, marca: 'Maskking', nombre: 'Maskking Ice X 40K', foto: null, confianza: 'sin_evidencia' },
  { id: 112, marca: 'Nexa', nombre: 'Nexa 35K', foto: null, confianza: 'sin_evidencia' },
  { id: 104, marca: 'Nexa', nombre: 'Nexa 50K', foto: null, confianza: 'sin_evidencia' },
  { id: 158, marca: 'Nexa', nombre: 'Nexa Pix 35K', foto: '/proveedores/karen/nexa-pix-35-000.webp', confianza: 'exacto' },
  { id: 113, marca: 'Nexa', nombre: 'Nexa Ultra 40K', foto: '/proveedores/karen/nexa-ultra-40-000.webp', confianza: 'exacto' },
  { id: 157, marca: 'Nexa', nombre: 'Nexa Ultra 50K', foto: null, confianza: 'sin_evidencia' },
  { id: 148, marca: 'Pillow Talk', nombre: 'Pillow Talk', foto: '/proveedores/karen/pillow-talk-40k.webp', confianza: 'probable' },
  { id: 99, marca: 'Pillow Talk', nombre: 'Pillow Talk 40K', foto: '/proveedores/karen/pillow-talk-40k.webp', confianza: 'exacto' },
  { id: 108, marca: 'Rifbar', nombre: 'Rifbar Pro 40K', foto: null, confianza: 'sin_evidencia' },
  { id: 131, marca: 'Sin marca', nombre: 'Blade', foto: '/proveedores/karen/waka-blade-33-000.webp', confianza: 'exacto' },
  { id: 139, marca: 'Sin marca', nombre: 'Box Pro 15', foto: '/proveedores/karen/vape-iplay-x-box-pro.webp', confianza: 'probable' },
  { id: 140, marca: 'Sin marca', nombre: 'Box Pro Max', foto: '/proveedores/karen/iplay-x-box-pro-max-50-000.webp', confianza: 'probable' },
  { id: 130, marca: 'Sin marca', nombre: 'Burst', foto: '/proveedores/karen/waka-burst-36-000.webp', confianza: 'exacto' },
  { id: 137, marca: 'Sin marca', nombre: 'Elite', foto: '/proveedores/karen/waka-elite-40k.webp', confianza: 'exacto' },
  { id: 146, marca: 'Sin marca', nombre: 'Fifty Bar', foto: '/proveedores/karen/fifty-bar.webp', confianza: 'exacto' },
  { id: 142, marca: 'Sin marca', nombre: 'Go', foto: '/proveedores/karen/waka-go-10-000.webp', confianza: 'exacto' },
  { id: 135, marca: 'Sin marca', nombre: 'Icon', foto: '/proveedores/karen/waka-icon-50-000.webp', confianza: 'exacto' },
  { id: 145, marca: 'Sin marca', nombre: 'Instabar 70K', foto: '/proveedores/karen/instabar-be-70-000.webp', confianza: 'exacto' },
  { id: 128, marca: 'Sin marca', nombre: 'Optimus', foto: null, confianza: 'sin_evidencia' },
  { id: 136, marca: 'Sin marca', nombre: 'PA30000', foto: '/proveedores/karen/waka-pro-30k.webp', confianza: 'probable' },
  { id: 134, marca: 'Sin marca', nombre: 'Slim', foto: '/proveedores/karen/waka-slim-12-000.webp', confianza: 'exacto' },
  { id: 133, marca: 'Sin marca', nombre: 'Smash Go', foto: '/proveedores/karen/waka-go-10-000.webp', confianza: 'exacto' },
  { id: 147, marca: 'Sin marca', nombre: 'Snowwolf', foto: '/proveedores/karen/snowwolf.webp', confianza: 'exacto' },
  { id: 138, marca: 'Sin marca', nombre: 'X-Box 50k', foto: '/proveedores/karen/iplay-x-box-pro-max-50-000.webp', confianza: 'probable' },
  { id: 116, marca: 'South', nombre: 'South 3K', foto: '/modelos/south-3k.webp', confianza: 'exacto' },
  { id: 117, marca: 'Uno Mas', nombre: 'Uno Mas X', foto: null, confianza: 'sin_evidencia' },
  { id: 162, marca: 'Vhill', nombre: 'Vhill 3K', foto: null, confianza: 'sin_evidencia' },
  { id: 144, marca: 'Waka', nombre: 'Waka 100', foto: null, confianza: 'sin_evidencia' },
  { id: 132, marca: 'Waka', nombre: 'Waka 15', foto: '/proveedores/karen/vape-waka-sopro-15-000.webp', confianza: 'exacto' },
  { id: 120, marca: 'Waka', nombre: 'Waka 15K', foto: '/proveedores/karen/vape-waka-sopro-15-000.webp', confianza: 'exacto' },
  { id: 129, marca: 'Waka', nombre: 'Waka 30', foto: '/proveedores/karen/waka-pro-30k.webp', confianza: 'exacto' },
  { id: 151, marca: 'Waka', nombre: 'Waka 30K', foto: '/proveedores/karen/waka-pro-30k.webp', confianza: 'exacto' },
  { id: 143, marca: 'Waka', nombre: 'Waka 36', foto: '/proveedores/karen/waka-burst-36-000.webp', confianza: 'exacto' },
  { id: 156, marca: 'Waka', nombre: 'Waka 36K', foto: '/proveedores/karen/waka-burst-36-000.webp', confianza: 'exacto' },
  { id: 141, marca: 'Waka', nombre: 'Waka 50', foto: '/proveedores/karen/waka-icon-50-000.webp', confianza: 'exacto' },
  { id: 152, marca: 'Waka', nombre: 'Waka 50K', foto: '/proveedores/karen/waka-icon-50-000.webp', confianza: 'exacto' },
  { id: 160, marca: 'Waka', nombre: 'Waka 60K', foto: '/proveedores/karen/waka-steel.webp', confianza: 'exacto' },
  { id: 153, marca: 'Waka', nombre: 'Waka Blade', foto: '/proveedores/karen/waka-blade-33-000.webp', confianza: 'exacto' },
  { id: 85, marca: 'Waka', nombre: 'Waka Blade 33K', foto: '/proveedores/karen/waka-blade-33-000.webp', confianza: 'exacto' },
  { id: 126, marca: 'Waka', nombre: 'Waka Blast', foto: '/modelos/waka-blast-50k.webp', confianza: 'probable' },
  { id: 78, marca: 'Waka', nombre: 'Waka Blast 50K', foto: '/modelos/waka-blast-50k.webp', confianza: 'exacto' },
  { id: 122, marca: 'Waka', nombre: 'Waka Burst', foto: '/proveedores/karen/waka-burst-36-000.webp', confianza: 'probable' },
  { id: 83, marca: 'Waka', nombre: 'Waka Burst 36K', foto: '/proveedores/karen/waka-burst-36-000.webp', confianza: 'exacto' },
  { id: 90, marca: 'Waka', nombre: 'Waka DM 15K', foto: null, confianza: 'sin_evidencia' },
  { id: 89, marca: 'Waka', nombre: 'Waka Duo 25K', foto: '/modelos/waka-duo.webp', confianza: 'probable' },
  { id: 124, marca: 'Waka', nombre: 'Waka Elite', foto: '/proveedores/karen/waka-elite-40k.webp', confianza: 'probable' },
  { id: 80, marca: 'Waka', nombre: 'Waka Elite 40K', foto: '/proveedores/karen/waka-elite-40k.webp', confianza: 'exacto' },
  { id: 119, marca: 'Waka', nombre: 'Waka Go', foto: '/proveedores/karen/waka-go-10-000.webp', confianza: 'probable' },
  { id: 95, marca: 'Waka', nombre: 'Waka GO 10K', foto: '/proveedores/karen/waka-go-10-000.webp', confianza: 'exacto' },
  { id: 96, marca: 'Waka', nombre: 'Waka GO Mundialista 10K', foto: '/modelos/waka-go-mundialista.webp', confianza: 'exacto' },
  { id: 123, marca: 'Waka', nombre: 'Waka Icon', foto: '/proveedores/karen/waka-icon-50-000.webp', confianza: 'exacto' },
  { id: 77, marca: 'Waka', nombre: 'Waka Icon 50K', foto: '/proveedores/karen/waka-icon-50-000.webp', confianza: 'exacto' },
  { id: 92, marca: 'Waka', nombre: 'Waka Icon Slim 20K', foto: '/proveedores/karen/waka-icon-slim.webp', confianza: 'exacto' },
  { id: 125, marca: 'Waka', nombre: 'Waka Jupiter', foto: '/proveedores/karen/waka-jupiter-50k.webp', confianza: 'probable' },
  { id: 79, marca: 'Waka', nombre: 'Waka Jupiter 50K', foto: '/proveedores/karen/waka-jupiter-50k.webp', confianza: 'exacto' },
  { id: 76, marca: 'Waka', nombre: 'Waka Optimus 100K', foto: '/proveedores/karen/waka-optimus.webp', confianza: 'exacto' },
  { id: 127, marca: 'Waka', nombre: 'Waka Slim', foto: '/proveedores/karen/waka-slim-12-000.webp', confianza: 'probable' },
  { id: 93, marca: 'Waka', nombre: 'Waka Slim 12K', foto: '/proveedores/karen/waka-slim-12-000.webp', confianza: 'exacto' },
  { id: 155, marca: 'Waka', nombre: 'Waka So Pro', foto: '/proveedores/karen/vape-waka-sopro-15-000.webp', confianza: 'exacto' },
  { id: 87, marca: 'Waka', nombre: 'Waka Sopro 30K', foto: '/proveedores/karen/waka-pro-30k.webp', confianza: 'probable' },
  { id: 154, marca: 'Waka', nombre: 'Waka Titan 30K', foto: null, confianza: 'sin_evidencia' },
];

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const POR_NOMBRE = new Map(FOTOS_MODELOS.map((f) => [norm(f.nombre), f]));

/** Ruta publica de la foto del modelo (por nombre canonico), o null si no la tiene o no esta en la lista. */
export function rutaFotoModelo(nombre: string): string | null {
  const f = POR_NOMBRE.get(norm(nombre));
  return f?.foto ?? null;
}
