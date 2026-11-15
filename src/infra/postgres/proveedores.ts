import { llamar, type Sql } from './servidor';

/** Llama a `proveedores.<fn>` con argumentos con nombre (el orden lo fija la lista de parametros de cada funcion). */
const ORDEN: Record<string, string[]> = {
  cargar_estado: [], contexto_normalizacion: [], contexto_socios: [], existencia_propia: [],
  guardar_estado: ['p_estado', 'p_eventos', 'p_clave_idem'], cargar_presupuesto: ['p_dia'], presupuesto_tomar: ['p_dia', 'p_tipo'], guardar_foto_diaria: ['p_dia', 'p_filas'],
  emitir_aviso: ['p_codigo', 'p_clave', 'p_entidad_tipo', 'p_entidad_id', 'p_payload', 'p_titulo'], resolver_aviso: ['p_clave'], precio_tabulador: ['p_cliente', 'p_modelo'],
  registrar_foto_pendiente: ['p_clave', 'p_titulo', 'p_marca', 'p_archivo', 'p_candidatos', 'p_motivo'], catalogo_para_fotos: [], fotos_pendientes: [],
};
const CASTS: Record<string, string[]> = {
  guardar_estado: ['jsonb', 'jsonb', 'text'], cargar_presupuesto: ['date'], presupuesto_tomar: ['date', 'text'], guardar_foto_diaria: ['date', 'jsonb'],
  emitir_aviso: ['text', 'text', 'text', 'text', 'jsonb', 'text'], resolver_aviso: ['text'], precio_tabulador: ['bigint', 'bigint'],
  registrar_foto_pendiente: ['text', 'text', 'text', 'text', 'jsonb', 'text'],
};

export function llamadaProveedoresServidor(sql: Sql) {
  return async (fn: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const nombres = ORDEN[fn];
    if (!nombres) throw new Error(`funcion de proveedores desconocida: ${fn}`);
    const valores = nombres.map((n) => {
      const v = args[n];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const casts = CASTS[fn] ?? [];
    const marcas = nombres.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ''}`).join(', ');
    const r = await sql<{ j: unknown }>(`select proveedores.${fn}(${marcas}) as j`, valores);
    return r[0]?.j;
  };
}
export { llamar };
