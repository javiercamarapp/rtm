// Lecturas de la pagina del inventario de proveedores con la sesion del socio (api.prov_*). Nunca escribe.
import type { LlamadaProveedores } from '@/infra/proveedores/postgres';
import type { DatosTablero } from '@/dominio/proveedores/tablero';
import { crearClienteServidor } from './cliente-servidor';

export interface FilaInventarioProv {
  producto_id: string; marca: string; titulo: string; puffs: number | null; estado: string; nuevo_sin_costo: boolean; mapeo: string; canonico_id: string | null; canonico_nombre: string | null; sin_sabores: boolean;
  sabores: { variante_id: string; sabor: string; disponible: boolean; estado: string; inestable: boolean; sabor_canonico_id: string | null }[];
  costo_vigente: { costo_cent: number; desde: string } | null; existencia_propia: number;
}
export interface PantallaProveedores {
  frescura: { inicializado: boolean; ultima_lectura_ok: string | null; ultimo_intento: string | null; fallos_seguidos: number; bloqueada: boolean; horas: number | null; desactualizado: boolean; lectura_activa: boolean; promociones_activas: boolean; peticiones_hoy: number; tope_dia: number };
  modelos: FilaInventarioProv[];
  promociones: { clave: string; tipo: string; pct: number | null; etiqueta: string; inicio: string | null; fin: string | null; estado: string; modelos: string[] }[];
  eventos: { clave: string; tipo: string; en: string; antes: string | null; despues: string | null; modelo: string | null }[];
  cola: { tipo: string; texto: string; sugerencia_id: string | null; similitud: number | null; creada: string }[];
}

const NOMBRE_RPC: Record<string, string> = {
  cargar_estado: 'prov_cargar_estado', contexto_normalizacion: 'prov_contexto_normalizacion', contexto_socios: 'prov_contexto_socios', existencia_propia: 'prov_existencia_propia', precio_tabulador: 'prov_precio_tabulador',
};

/** Solo lectura: las escrituras de este modulo son de las tareas programadas, no de la web. */
export async function llamadaProveedoresSocio(): Promise<LlamadaProveedores> {
  const sb = await crearClienteServidor();
  return async (fn, args = {}) => {
    const rpc = NOMBRE_RPC[fn];
    if (!rpc) throw new Error(`la web no puede llamar a proveedores.${fn}`);
    const { data, error } = await sb.rpc(rpc, args);
    if (error) throw new Error(`${rpc}: ${error.message}`);
    return data;
  };
}

export async function pantallaProveedores(): Promise<PantallaProveedores> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc('prov_inventario');
  if (error) throw new Error(`prov_inventario: ${error.message}`);
  return data as PantallaProveedores;
}

/** Tablero de "Lo que hay en Karen": modelos con sabores, ventas propias, cobertura y recomendaciones (cuentas hechas en SQL). */
export async function tableroKaren(): Promise<DatosTablero> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc('prov_tablero');
  if (error) throw new Error(`prov_tablero: ${error.message}`);
  return data as DatosTablero;
}
