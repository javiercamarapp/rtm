import { etiquetaFecha, formatearPiezas, nombreVape, saborMayus } from '@/dominio/formato';
import type { Lectura, PaqueteOmar } from '@/dominio/omar/tipos';
import { EstadoTexto } from '../componentes/estado-texto';
import { Tarjeta as TarjetaBase } from '../componentes/pagina';
import { TextoLectura } from './bodega';

const ESTADO: Record<PaqueteOmar['estado'], { texto: string; tono: 'ok' | 'atencion' | 'neutro' }> = {
  por_empacar: { texto: 'Por empacar', tono: 'atencion' },
  empacado: { texto: 'Empacado', tono: 'ok' },
  en_trayecto: { texto: 'En trayecto', tono: 'neutro' },
  llego: { texto: 'Llegó a Mérida', tono: 'atencion' },
  incidente: { texto: 'Reportado perdido o dañado', tono: 'atencion' },
};

function Tarjeta({ p }: { p: PaqueteOmar }) {
  const e = ESTADO[p.estado];
  return (
    <li className="omar-paquete" data-testid={`paquete-${p.tipo}`}>
      <div className="omar-paquete-cab">
        <strong>Paquete {p.consecutivo}</strong>
        <EstadoTexto tono={e.tono}>{e.texto}</EstadoTexto>
      </div>
      <ul>
        {p.renglones.map((r) => <li key={`${r.modelo}|${r.sabor}`}><span>{nombreVape(r.modelo)} · {saborMayus(r.sabor)}</span><span>{formatearPiezas(r.piezas)}</span></li>)}
      </ul>
      {p.tipo === 'salida' && p.horas !== null && <span className="rtm-nota">Pendiente desde hace {p.horas} h</span>}
      {p.tipo === 'entrada' && p.estado !== 'incidente' && p.llegada_estimada && <span className="rtm-nota">Llegada estimada: {etiquetaFecha(p.llegada_estimada)}</span>}
    </li>
  );
}

/**
 * Paquetes que debe preparar (salidas) o recibir (entradas). Sin cliente, sin proveedor y sin folios: solo que va en cada caja.
 * Omar presta el lugar: los socios hacen los envios; aqui ve que hay que tener listo.
 */
export function ListaPaquetes({ lectura }: { lectura: Lectura<PaqueteOmar[]> }) {
  if (lectura.estado !== 'ok') return <TextoLectura lectura={lectura} pendiente="Los paquetes aparecerán aquí cuando los socios habiliten esta lectura." />;
  const salidas = lectura.datos.filter((p) => p.tipo === 'salida');
  const entradas = lectura.datos.filter((p) => p.tipo === 'entrada');
  return (
    <div className="omar-rejilla">
      <TarjetaBase titulo="Por preparar" descripcion={`${salidas.length} ${salidas.length === 1 ? 'paquete' : 'paquetes'}`}>
        {salidas.length === 0 ? <p className="rtm-nota">No hay paquetes pendientes de preparar.</p> : <ul className="omar-lista">{salidas.map((p) => <Tarjeta key={`s${p.consecutivo}`} p={p} />)}</ul>}
      </TarjetaBase>
      <TarjetaBase titulo="Por recibir" descripcion={`${entradas.length} ${entradas.length === 1 ? 'paquete' : 'paquetes'}`}>
        {entradas.length === 0 ? <p className="rtm-nota">No hay paquetes en camino a tu bodega.</p> : <ul className="omar-lista">{entradas.map((p) => <Tarjeta key={`e${p.consecutivo}`} p={p} />)}</ul>}
      </TarjetaBase>
    </div>
  );
}
