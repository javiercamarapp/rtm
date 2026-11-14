// Fotos de los modelos del catalogo. Datos, no UI: cada modelo activo declara su foto (public/modelos/<slug>.webp) o, de forma explicita, que no la tiene.
// Procedencia de cada imagen: docs/fotos-modelos.md. Solo imagenes oficiales del proveedor o de la marca. Lista leida de solo lectura de catalogo.modelo el 14-nov.

export interface FotoModelo {
  /** Id de catalogo.modelo. */
  id: number;
  marca: string;
  /** Nombre canonico (catalogo.modelo.nombre_canonico). */
  nombre: string;
  /** Slug del archivo en public/modelos/ (sin extension), o null si el modelo no tiene foto. */
  foto: string | null;
}

export const MOTIVO_SIN_FOTO = 'No se ubico una imagen oficial del proveedor o de la marca que corresponda con exactitud a este modelo.';

export const FOTOS_MODELOS: readonly FotoModelo[] = [
  { id: 109, marca: 'Adjust', nombre: 'Adjust 40K', foto: null },
  { id: 110, marca: 'Dojo', nombre: 'Dojo 40K', foto: null },
  { id: 150, marca: 'Elfbar', nombre: 'Elfbar 40K', foto: null },
  { id: 114, marca: 'Elfbar', nombre: 'Elfbar BC Pro 40K', foto: null },
  { id: 106, marca: 'Elux', nombre: 'Elux 50K', foto: null },
  { id: 107, marca: 'Equator', nombre: 'Equator 30K', foto: null },
  { id: 115, marca: 'Extre Bar', nombre: 'Extre Bar 40K', foto: null },
  { id: 121, marca: 'Fasta', nombre: 'Fasta 37K', foto: null },
  { id: 101, marca: 'Fasta', nombre: 'Fasta Burst 35K', foto: null },
  { id: 102, marca: 'Fasta', nombre: 'Fasta Burst 37K', foto: null },
  { id: 103, marca: 'Fasta', nombre: 'Fasta Kit 40K', foto: null },
  { id: 94, marca: 'Flavor Beast', nombre: 'Flavor Beast 50K', foto: null },
  { id: 118, marca: 'Funky Republic', nombre: 'Funky Republic Fi 3K', foto: null },
  { id: 84, marca: 'Geek Bar', nombre: 'Geek Bar 2GO 50K', foto: 'geek-bar-2go-50k' },
  { id: 81, marca: 'Geek Bar', nombre: 'Geek Bar Somax 80K', foto: 'geek-bar-somax-80k' },
  { id: 161, marca: 'IPLAY', nombre: 'iPlay 15K', foto: null },
  { id: 100, marca: 'IPLAY', nombre: 'IPLAY Box 4K', foto: null },
  { id: 98, marca: 'IPLAY', nombre: 'IPLAY Box Pro 15K', foto: null },
  { id: 82, marca: 'IPLAY', nombre: 'IPLAY Box Pro Max 50K', foto: null },
  { id: 97, marca: 'IPLAY', nombre: 'IPLAY Burst 45K', foto: null },
  { id: 111, marca: 'IPLAY', nombre: 'IPLAY Max', foto: null },
  { id: 105, marca: 'Lost Mary', nombre: 'Lost Mary 35K', foto: null },
  { id: 149, marca: 'Lost Mary', nombre: 'Lost Mary Ultrasonic', foto: 'lost-mary-ultrasonic' },
  { id: 159, marca: 'Maskking', nombre: 'Maskking 100K', foto: null },
  { id: 91, marca: 'Maskking', nombre: 'Maskking Extre 100K', foto: null },
  { id: 86, marca: 'Maskking', nombre: 'Maskking Fexo 45K', foto: null },
  { id: 88, marca: 'Maskking', nombre: 'Maskking Ice X 40K', foto: null },
  { id: 112, marca: 'Nexa', nombre: 'Nexa 35K', foto: null },
  { id: 104, marca: 'Nexa', nombre: 'Nexa 50K', foto: null },
  { id: 158, marca: 'Nexa', nombre: 'Nexa Pix 35K', foto: null },
  { id: 113, marca: 'Nexa', nombre: 'Nexa Ultra 40K', foto: null },
  { id: 157, marca: 'Nexa', nombre: 'Nexa Ultra 50K', foto: null },
  { id: 148, marca: 'Pillow Talk', nombre: 'Pillow Talk', foto: null },
  { id: 99, marca: 'Pillow Talk', nombre: 'Pillow Talk 40K', foto: null },
  { id: 108, marca: 'Rifbar', nombre: 'Rifbar Pro 40K', foto: null },
  { id: 131, marca: 'Sin marca', nombre: 'Blade', foto: null },
  { id: 139, marca: 'Sin marca', nombre: 'Box Pro 15', foto: null },
  { id: 140, marca: 'Sin marca', nombre: 'Box Pro Max', foto: null },
  { id: 130, marca: 'Sin marca', nombre: 'Burst', foto: null },
  { id: 137, marca: 'Sin marca', nombre: 'Elite', foto: null },
  { id: 146, marca: 'Sin marca', nombre: 'Fifty Bar', foto: null },
  { id: 142, marca: 'Sin marca', nombre: 'Go', foto: null },
  { id: 135, marca: 'Sin marca', nombre: 'Icon', foto: null },
  { id: 145, marca: 'Sin marca', nombre: 'Instabar 70K', foto: null },
  { id: 128, marca: 'Sin marca', nombre: 'Optimus', foto: null },
  { id: 136, marca: 'Sin marca', nombre: 'PA30000', foto: null },
  { id: 134, marca: 'Sin marca', nombre: 'Slim', foto: null },
  { id: 133, marca: 'Sin marca', nombre: 'Smash Go', foto: null },
  { id: 147, marca: 'Sin marca', nombre: 'Snowwolf', foto: null },
  { id: 138, marca: 'Sin marca', nombre: 'X-Box 50k', foto: null },
  { id: 116, marca: 'South', nombre: 'South 3K', foto: null },
  { id: 117, marca: 'Uno Mas', nombre: 'Uno Mas X', foto: null },
  { id: 162, marca: 'Vhill', nombre: 'Vhill 3K', foto: null },
  { id: 144, marca: 'Waka', nombre: 'Waka 100', foto: null },
  { id: 132, marca: 'Waka', nombre: 'Waka 15', foto: null },
  { id: 120, marca: 'Waka', nombre: 'Waka 15K', foto: null },
  { id: 129, marca: 'Waka', nombre: 'Waka 30', foto: null },
  { id: 151, marca: 'Waka', nombre: 'Waka 30K', foto: null },
  { id: 143, marca: 'Waka', nombre: 'Waka 36', foto: null },
  { id: 156, marca: 'Waka', nombre: 'Waka 36K', foto: null },
  { id: 141, marca: 'Waka', nombre: 'Waka 50', foto: null },
  { id: 152, marca: 'Waka', nombre: 'Waka 50K', foto: null },
  { id: 160, marca: 'Waka', nombre: 'Waka 60K', foto: null },
  { id: 153, marca: 'Waka', nombre: 'Waka Blade', foto: null },
  { id: 85, marca: 'Waka', nombre: 'Waka Blade 33K', foto: null },
  { id: 126, marca: 'Waka', nombre: 'Waka Blast', foto: null },
  { id: 78, marca: 'Waka', nombre: 'Waka Blast 50K', foto: null },
  { id: 122, marca: 'Waka', nombre: 'Waka Burst', foto: null },
  { id: 83, marca: 'Waka', nombre: 'Waka Burst 36K', foto: null },
  { id: 90, marca: 'Waka', nombre: 'Waka DM 15K', foto: null },
  { id: 89, marca: 'Waka', nombre: 'Waka Duo 25K', foto: null },
  { id: 124, marca: 'Waka', nombre: 'Waka Elite', foto: null },
  { id: 80, marca: 'Waka', nombre: 'Waka Elite 40K', foto: null },
  { id: 119, marca: 'Waka', nombre: 'Waka Go', foto: null },
  { id: 95, marca: 'Waka', nombre: 'Waka GO 10K', foto: null },
  { id: 96, marca: 'Waka', nombre: 'Waka GO Mundialista 10K', foto: null },
  { id: 123, marca: 'Waka', nombre: 'Waka Icon', foto: null },
  { id: 77, marca: 'Waka', nombre: 'Waka Icon 50K', foto: null },
  { id: 92, marca: 'Waka', nombre: 'Waka Icon Slim 20K', foto: null },
  { id: 125, marca: 'Waka', nombre: 'Waka Jupiter', foto: null },
  { id: 79, marca: 'Waka', nombre: 'Waka Jupiter 50K', foto: null },
  { id: 76, marca: 'Waka', nombre: 'Waka Optimus 100K', foto: null },
  { id: 127, marca: 'Waka', nombre: 'Waka Slim', foto: null },
  { id: 93, marca: 'Waka', nombre: 'Waka Slim 12K', foto: null },
  { id: 155, marca: 'Waka', nombre: 'Waka So Pro', foto: null },
  { id: 87, marca: 'Waka', nombre: 'Waka Sopro 30K', foto: null },
  { id: 154, marca: 'Waka', nombre: 'Waka Titan 30K', foto: null },
];

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const POR_NOMBRE = new Map(FOTOS_MODELOS.map((f) => [norm(f.nombre), f]));

/** Ruta publica de la foto del modelo (por nombre canonico), o null si no la tiene o no esta en la lista. */
export function rutaFotoModelo(nombre: string): string | null {
  const f = POR_NOMBRE.get(norm(nombre));
  return f?.foto ? `/modelos/${f.foto}.webp` : null;
}
