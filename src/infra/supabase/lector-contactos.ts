// Implementa el puerto de contactos con las funciones api.contactos_* (sesion del socio, llave publica; nunca la de servicio).
import { z } from 'zod';
import type { LectorContactos } from '@/aplicacion/contactos/puertos';
import { crearClienteServidor } from './cliente-servidor';

const fila = z.object({
  id: z.number(), nombre: z.string(), telefono_mascara: z.string(), telefonos: z.number(), correo: z.string().nullable(),
  origenes: z.array(z.string()), anuncios: z.array(z.string()), etiquetas: z.array(z.string()),
}).transform((f) => ({ id: f.id, nombre: f.nombre, telefonoMascara: f.telefono_mascara, telefonos: f.telefonos, correo: f.correo, origenes: f.origenes, anuncios: f.anuncios, etiquetas: f.etiquetas }));

const lista = z.object({ total: z.number(), limite: z.number(), desplazamiento: z.number(), filas: z.array(fila) });

const resumen = z.object({
  total: z.number(), con_correo: z.number(),
  por_origen: z.array(z.object({ origen: z.string(), contactos: z.number() })),
  por_anuncio: z.array(z.object({ anuncio: z.string(), formulario: z.string(), contactos: z.number() })),
}).transform((r) => ({ total: r.total, conCorreo: r.con_correo, porOrigen: r.por_origen, porAnuncio: r.por_anuncio }));

const revelado = z.object({ id: z.number(), telefonos: z.array(z.string()) });

const exportado = z.object({
  total: z.number(),
  filas: z.array(z.object({ nombre: z.string(), telefono: z.string(), telefonos: z.array(z.string()), correo: z.string().nullable(), origenes: z.array(z.string()), anuncios: z.array(z.string()) })),
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
      llamar('contactos_lista', { p_busqueda: f.busqueda || null, p_origen: f.origen || null, p_anuncio: f.anuncio || null, p_limite: limite, p_desplazamiento: desplazamiento }, lista),
    revelar: async (id, motivo) => (await llamar('contacto_revelar', { p_id: id, p_motivo: motivo || null }, revelado)).telefonos,
    exportar: async (ids, f) =>
      (await llamar('contactos_exportar', { p_ids: ids, p_busqueda: f.busqueda || null, p_origen: f.origen || null, p_anuncio: f.anuncio || null }, exportado)).filas,
  };
}
