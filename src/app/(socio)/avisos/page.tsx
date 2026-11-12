import type { Metadata } from 'next';
import Link from 'next/link';
import { notificacionesDeSocio } from '@/composicion/inventario';
import { etiquetaFechaHora } from '@/dominio/formato';
import { destinoAviso } from '@/dominio/notificaciones/tipos';
import { contarPor, porcentaje } from '@/dominio/tablero/agregados';
import { BarraFiltros, Chip, ChipEstado } from '@/ui/componentes/controles';
import { BarList, ListaHallazgos, Paginador } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { SEVERIDAD } from '../operacion/etiquetas';
import { etiquetaHoy } from '../contexto';
import { BotonLeido } from './boton-leido';

export const metadata: Metadata = { title: 'Avisos' };

const ESTADOS: Record<string, string> = { abierta: 'Pendiente', resuelta: 'Resuelto', caducada: 'Caducó', descartada: 'Descartado' };
const TONO = { C: 'malo', I: 'atencion', F: 'info' } as const;
const TIPOS: Record<string, string> = { pedido: 'Pedidos', compra: 'Compras', compra_diferencia: 'Diferencias de compra', pago: 'Pagos', conteo: 'Conteos', comprobacion: 'Comprobaciones', periodo: 'Periodos', proveedor: 'Proveedores', toma: 'Tomas de Omar', socios: 'Socios' };

export default async function PaginaAvisos({ searchParams }: { searchParams: Promise<{ pestana?: string; pagina?: string; sev?: string }> }) {
  const sp = await searchParams;
  const pestana = sp.pestana === 'sin_leer' ? 'sin_leer' : 'todas';
  const pagina = Number(sp.pagina) > 0 ? Math.floor(Number(sp.pagina)) : 0;
  const sev = sp.sev === 'C' || sp.sev === 'I' || sp.sev === 'F' ? sp.sev : '';
  const lista = await (await notificacionesDeSocio()).mis(pestana, pagina);
  const todas = lista.notificaciones;
  const filas = sev ? todas.filter((a) => a.severidad === sev) : todas;
  const enlace = (p: string, n = 0, s = sev) => {
    const q = new URLSearchParams({ pestana: p, ...(n > 0 ? { pagina: String(n) } : {}), ...(s ? { sev: s } : {}) });
    return `/avisos?${q.toString()}`;
  };
  const por = (s: string) => todas.filter((a) => a.severidad === s).length;
  const accion = todas.filter((a) => a.requiere_accion && a.estado === 'abierta');
  const porTipo = contarPor(todas, (a) => a.entidad_tipo ?? 'otros');
  const porEstado = contarPor(todas, (a) => a.estado);
  const sinTelegram = todas.filter((a) => a.telegram_no_salio).length;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Avisos · ${etiquetaHoy()}`}
        titulo={todas.length === 0 ? 'No hay avisos' : `Tienes ${lista.sin_leer} ${lista.sin_leer === 1 ? 'aviso sin leer' : 'avisos sin leer'}`}
        descripcion="La campana es la fuente de verdad: Telegram solo la espeja. Leído y resuelto son cosas distintas: un aviso con acción sigue pendiente hasta que la condición deja de existir."
      />
      <BarraFiltros etiquetaAria="Filtros de avisos" extras={sev ? <Chip href={enlace(pestana, 0, '')}>Quitar severidad</Chip> : undefined}>
        <Chip href={enlace('todas')} activo={pestana === 'todas'}>Todas</Chip>
        <Chip href={enlace('sin_leer')} activo={pestana === 'sin_leer'}>{`Sin leer ${lista.sin_leer}`}</Chip>
        {(['C', 'I', 'F'] as const).map((s) => <Chip key={s} tono={TONO[s]} href={enlace(pestana, 0, sev === s ? '' : s)} activo={sev === s}>{`${SEVERIDAD[s]!.texto} ${por(s)}`}</Chip>)}
      </BarraFiltros>
      <KpiLinea
        etiquetaAria="Avisos por severidad"
        celdas={[
          { id: 'sinleer', etiqueta: 'Sin leer', valor: String(lista.sin_leer), categoria: 1, nota: `${todas.length} en esta lista` },
          { id: 'criticas', etiqueta: 'Críticas', valor: String(por('C')), categoria: 4, nota: por('C') ? 'Atiéndelas primero' : 'Ninguna crítica' },
          { id: 'importantes', etiqueta: 'Importantes', valor: String(por('I')), categoria: 6 },
          { id: 'accion', etiqueta: 'Piden una acción', valor: String(accion.length), categoria: 3, nota: 'Siguen pendientes hasta que se resuelvan' },
        ]}
      />
      <FilaRatios etiqueta="Razones de los avisos" items={[{ etiqueta: 'Informativas', valor: String(por('F')) }, { etiqueta: 'Leídas', valor: todas.length ? `${(((todas.length - todas.filter((a) => !a.leida).length) / todas.length) * 100).toFixed(0)} %` : null }, { etiqueta: 'Repetidos', valor: String(todas.filter((a) => a.conteo > 1).length) }, { etiqueta: 'Telegram no salió', valor: String(sinTelegram) }]} />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Pendientes por atender" descripcion="Avisos abiertos, de mayor a menor severidad">
          <ListaHallazgos
            etiquetaAria="Avisos con acción" vacio="Nada que atender"
            items={todas.filter((a) => a.estado === 'abierta').sort((a, b) => a.severidad.localeCompare(b.severidad)).slice(0, 8).map((a) => { const d = destinoAviso(a.entidad_tipo, a.entidad_id); return { id: String(a.id), tono: TONO[a.severidad], palabra: SEVERIDAD[a.severidad]!.texto, titulo: d ? <Link href={d}>{a.titulo}</Link> : a.titulo, detalle: `${a.botones.join(' / ') || 'Abrir'} · ${etiquetaFechaHora(a.creado_at)}` }; })}
          />
        </Tarjeta>
        <Tarjeta titulo="De qué son" descripcion="Avisos de esta lista por tipo y estado">
          {todas.length ? (
            <div className="rtm-a1-cuerpo">
              <p className="rtm-a1-subtitulo">Por tipo</p>
              <BarList etiquetaAria="Avisos por tipo" items={porTipo.slice(0, 5).map((c) => ({ id: c.clave, etiqueta: TIPOS[c.clave] ?? 'Otros', texto: String(c.n), pct: porcentaje(c.n, todas.length) }))} />
              <p className="rtm-a1-subtitulo">Por estado</p>
              <BarList etiquetaAria="Avisos por estado" items={porEstado.map((c) => ({ id: c.clave, etiqueta: ESTADOS[c.clave] ?? c.clave, texto: String(c.n), pct: porcentaje(c.n, todas.length) }))} />
            </div>
          ) : <p className="rtm-a1-estado-vacio">Sin avisos.</p>}
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="Lista de avisos" descripcion={`${filas.length} ${filas.length === 1 ? 'aviso' : 'avisos'}`}>
        <DataTable
          etiqueta="Avisos" densidad="densa" plana pegajosa primeraFija interactiva={{ busqueda: 'Buscar aviso', exportar: 'avisos' }}
          clave={(a) => a.id} filas={filas}
          vacio={{ titulo: pestana === 'sin_leer' ? 'No tienes avisos sin leer' : 'Sin avisos', texto: 'Los avisos aparecen cuando una operación necesita atención: una diferencia de recepción, un paquete por empacar, un pago sin identificar, un conteo con diferencia...' }}
          columnas={[
            { id: 's', titulo: 'Severidad', ancho: 'm', celda: (a) => <ChipEstado tono={TONO[a.severidad]}>{SEVERIDAD[a.severidad]!.texto}</ChipEstado> },
            { id: 't', titulo: 'Aviso', ancho: 'xl', celda: (a) => {
              const d = destinoAviso(a.entidad_tipo, a.entidad_id);
              return <>{d ? <Link href={d}>{a.titulo}</Link> : a.titulo}<br /><span className="rtm-nota">{a.nt}{a.conteo > 1 ? ` · ${a.conteo} veces` : ''}{a.requiere_accion && a.botones.length > 0 ? ` · ${a.botones.join(' / ')}` : ''}{a.telegram_no_salio ? ' · Telegram no salió' : ''}</span></>;
            } },
            { id: 'h', titulo: 'Cuándo', ancho: 'm', secundaria: true, celda: (a) => etiquetaFechaHora(a.creado_at) },
            { id: 'e', titulo: 'Estado', ancho: 'm', secundaria: true, celda: (a) => ESTADOS[a.estado] ?? a.estado },
            { id: 'a', titulo: 'Acción', ancho: 'm', celda: (a) => (a.leida ? <span className="rtm-nota">Leído</span> : <BotonLeido avisoId={a.id} />) },
          ]}
        />
        <Paginador mostrados={filas.length} anterior={pagina > 0 ? enlace(pestana, pagina - 1) : undefined} siguiente={lista.hay_mas ? enlace(pestana, pagina + 1) : undefined} />
      </Tarjeta>
    </Pagina>
  );
}
