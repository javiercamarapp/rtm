// Raiz de composicion de la pagina Inventario actual de proveedores (sesion del socio; solo lectura). Las escrituras del modulo son de las tareas programadas.
import { prepararListaParaCliente, type PeticionLista } from '@/aplicacion/proveedores/lista';
import type { ResultadoLista } from '@/dominio/proveedores/lista_cliente';
import { ContextoNegocioDb, DatosListaDb, RepositorioProveedorDb } from '@/infra/proveedores/postgres';
import { llamadaProveedoresSocio, pantallaProveedores, tableroIsaac, tableroKaren, type PantallaProveedores } from '@/infra/supabase/proveedores';
import { sinLineaBase } from '@/dominio/proveedores/stock';
import { bloqueoDeActualizar, type DatosTablero } from '@/dominio/proveedores/tablero';
import { pdfOrdenCompra } from '@/infra/pdf/orden_compra';
import { operacionDeSocio } from './operacion';
import { lecturaManualDeProveedores } from './produccion';
import { exigirSocio } from './acceso';

export async function proveedoresDeSocio(): Promise<PantallaProveedores> {
  await exigirSocio();
  return pantallaProveedores();
}

/** "Copiar lista para cliente": texto para pegar en WhatsApp. Lo prepara el sistema; jamas se envia desde aqui. Se bloquea con dato de mas de 3 horas. */
export async function listaParaClienteDeSocio(peticion: PeticionLista): Promise<ResultadoLista> {
  await exigirSocio();
  const db = await llamadaProveedoresSocio();
  return prepararListaParaCliente({ repo: new RepositorioProveedorDb(db), contexto: new ContextoNegocioDb(db), datos: new DatosListaDb(db), reloj: () => new Date() }, peticion);
}

export async function tableroDeSocio(): Promise<DatosTablero> {
  await exigirSocio();
  const t = await tableroKaren();
  return { ...t, modelos: sinLineaBase(t.modelos) };
}

/** Stock disponible de Isaac (catalogo Remate), mismo formato que el de Karen. Solo socios. */
export async function tableroIsaacDeSocio(): Promise<DatosTablero> {
  await exigirSocio();
  const t = await tableroIsaac();
  return { ...t, modelos: sinLineaBase(t.modelos) };
}

export type ResultadoActualizar =
  | { estado: 'bloqueada'; motivo: string; mensaje: string }
  | { estado: 'ok'; detalle: string }
  | { estado: 'ya_en_curso' }
  | { estado: 'error' };

/**
 * "Actualizar ahora". Cada comprobacion se repite en el servidor con la frescura de la base (la pantalla pudo quedar vieja): interruptor apagado, tope de 40 al dia,
 * bloqueo del sitio y enfriamiento de 10 minutos. Con el interruptor apagado jamas se toca la fuente. El ciclo vuelve a respetar el interruptor y el presupuesto.
 */
export async function actualizarAhoraDeSocio(): Promise<ResultadoActualizar> {
  await exigirSocio();
  const { frescura: f } = await pantallaProveedores();
  const bloqueo = bloqueoDeActualizar(f, new Date());
  if (bloqueo) return { estado: 'bloqueada', ...bloqueo };
  const r = await lecturaManualDeProveedores();
  const cuerpo = r.cuerpo as { estado?: string; detalle?: string } | null;
  if (r.status !== 200 || !cuerpo) return { estado: 'error' };
  if (cuerpo.estado === 'ya_reclamada') return { estado: 'ya_en_curso' };
  if (cuerpo.estado === 'omitida') return { estado: 'bloqueada', motivo: 'omitida', mensaje: cuerpo.detalle === 'sin fuente configurada' ? 'La fuente de Karen no está configurada en el servidor.' : 'La lectura está apagada en el servidor.' };
  if (cuerpo.estado === 'error') return { estado: 'error' };
  return { estado: 'ok', detalle: cuerpo.detalle ?? 'ok' };
}

/** PDF de una orden de compra (renglones, cantidades, costos y total). Solo socios; null si la orden no existe. */
export async function pdfOrdenCompraDeSocio(id: number): Promise<{ bytes: Uint8Array; nombre: string } | null> {
  await exigirSocio();
  const c = await (await operacionDeSocio()).compra(id);
  if (!c) return null;
  return { bytes: await pdfOrdenCompra(c, `${c.fecha_neg}T12:00:00.000Z`), nombre: `orden-compra-${c.folio}.pdf` };
}
