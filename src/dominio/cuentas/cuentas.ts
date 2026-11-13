// Cuentas de acceso por correo (pantalla "Cuentas", solo socio). Formas, validacion y parser de lista blanca de lo que devuelve api.cuentas_lista.
// Un correo permitido + enlace magico es el unico acceso; el tipo de cuenta decide que ve la persona. La web solo crea tipos de bajo privilegio (creable_web).

export interface TipoCuenta {
  rol: string;
  etiqueta: string;
  descripcion: string;
  creableWeb: boolean;
}

export interface Cuenta {
  correo: string;
  rol: string;
  tipo: string;
  nombre: string | null;
  activo: boolean;
  /** Solo los tipos creables desde la web se desactivan o reactivan desde aqui. */
  gestionable: boolean;
  /** Ya existe el usuario de Auth (si no, falta correr `acceso:cuentas`: todavia no puede pedir su enlace). */
  accesoCreado: boolean;
  ultimoIngreso: string | null;
}

export interface ListaCuentas {
  tipos: TipoCuenta[];
  cuentas: Cuenta[];
}

export interface EntradaAlta {
  correo: string;
  tipo: string;
  nombre: string;
}
export type CampoAlta = 'correo' | 'tipo' | 'nombre';

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizarCorreo(v: string): string {
  return v.trim().toLowerCase();
}

export function validarAlta(e: EntradaAlta, tiposCreables: readonly string[]): { ok: true; valor: EntradaAlta } | { ok: false; errores: Partial<Record<CampoAlta, string>> } {
  const errores: Partial<Record<CampoAlta, string>> = {};
  const correo = normalizarCorreo(e.correo);
  if (correo === '') errores.correo = 'Escribe el correo.';
  else if (correo.length > 254 || !CORREO.test(correo)) errores.correo = 'Escribe un correo válido.';
  if (!tiposCreables.includes(e.tipo)) errores.tipo = 'Elige un tipo de cuenta.';
  const nombre = e.nombre.trim();
  if (nombre.length > 60) errores.nombre = 'Usa 60 caracteres o menos.';
  if (Object.keys(errores).length) return { ok: false, errores };
  return { ok: true, valor: { correo, tipo: e.tipo, nombre } };
}

type Fila = Record<string, unknown>;
const esFila = (v: unknown): v is Fila => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const lista = (v: unknown): Fila[] => (Array.isArray(v) ? v.filter(esFila) : []);

/** Copia solo los campos conocidos: una columna de mas en la base no cruza esta frontera. */
export function parsearCuentas(v: unknown): ListaCuentas {
  const f = esFila(v) ? v : {};
  return {
    tipos: lista(f.tipos).map((t) => ({ rol: texto(t.rol), etiqueta: texto(t.etiqueta), descripcion: texto(t.descripcion), creableWeb: t.creable_web === true })).filter((t) => t.rol !== ''),
    cuentas: lista(f.cuentas).map((c) => ({
      correo: texto(c.correo), rol: texto(c.rol), tipo: texto(c.tipo), nombre: texto(c.nombre) || null, activo: c.activo === true,
      gestionable: c.gestionable === true, accesoCreado: c.acceso_creado === true, ultimoIngreso: texto(c.ultimo_ingreso) || null,
    })).filter((c) => c.correo !== ''),
  };
}
