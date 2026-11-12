// Implementa el puerto de contactos con las funciones api.contactos_* (sesion del socio, llave publica; nunca la de servicio).
import { z } from 'zod';
import type { LectorContactos } from '@/aplicacion/contactos/puertos';
import { crearClienteServidor } from './cliente-servidor';

const fila = z.object({
  id: z.number(), nombre: z.string(), telefono_mascara: z.string(), telefonos: z.number(), sin_lada: z.boolean(), correo_compartido: z.boolean(), colonia: z.string(), colonia_conflicto: z.boolean(), correo: z.string().nullable(),
  origenes: z.array(z.string()), anuncios: z.array(z.string()), etiquetas: z.array(z.string()),
}).transform((f) => ({ id: f.id, nombre: f.nombre, telefonoMascara: f.telefono_mascara, telefonos: f.telefonos, sinLada: f.sin_lada, correoCompartido: f.correo_compartido, colonia: f.colonia, coloniaConflicto: f.colonia_conflicto, correo: f.correo, origenes: f.origenes, anuncios: f.anuncios, etiquetas: f.etiquetas }));

const lista = z.object({ total: z.number(), limite: z.number(), desplazamiento: z.number(), filas: z.array(fila) });

const resumen = z.object({
  total: z.number(), con_correo: z.number(), correo_compartido: z.number(), sin_lada: z.number(), con_colonia: z.number(), colonia_en_conflicto: z.number(), por_colonia: z.array(z.object({ colonia: z.string(), contactos: z.number() })),
  por_origen: z.array(z.object({ origen: z.string(), contactos: z.number() })),
  por_anuncio: z.array(z.object({ anuncio: z.string(), formulario: z.string(), contactos: z.number() })),
}).transform((r) => ({ total: r.total, conCorreo: r.con_correo, correoCompartido: r.correo_compartido, sinLada: r.sin_lada, conColonia: r.con_colonia, coloniaEnConflicto: r.colonia_en_conflicto, porColonia: r.por_colonia, porOrigen: r.por_origen, porAnuncio: r.por_anuncio }));

const revelado = z.object({ id: z.number(), telefonos: z.array(z.string()) });

const exportado = z.object({
  total: z.number(),
  filas: z.array(z.object({ nombre: z.string(), telefono: z.string(), telefonos: z.array(z.string()), correo: z.string().nullable(), colonia: z.string(), origenes: z.array(z.string()), anuncios: z.array(z.string()) })),
});

async function llamar<T>(fn: string, args: Record<string, unknown>, esquema: z.ZodType<T, unknown>): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return esquema.parse(data);
}

export function lectorContactosSupabase(): LectorContactos {
  return {
    resumen: () => llamar('contactos_resumen', {}, resumen),
    lista: (f, limite, desplazamiento) =>
      llamar('contactos_lista', { p_busqueda: f.busqueda || null, p_origen: f.origen || null, p_anuncio: f.anuncio || null, p_limite: limite, p_desplazamiento: desplazamiento, p_colonia: f.colonia || null }, lista),
    revelar: async (id, motivo) => (await llamar('contacto_revelar', { p_id: id, p_motivo: motivo || null }, revelado)).telefonos,
    exportar: async (ids, f) =>
      (await llamar('contactos_exportar', { p_ids: ids, p_busqueda: f.busqueda || null, p_origen: f.origen || null, p_anuncio: f.anuncio || null, p_colonia: f.colonia || null }, exportado)).filas,
  };
}
