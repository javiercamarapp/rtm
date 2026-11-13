import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { costosDeSocio } from '@/composicion/costos';
import { fechaNeg } from '@/dominio/calendario';
import { ETIQUETA_CATEGORIA, categoriaDe } from '@/dominio/costos/lista-servicios';
import { ETIQUETA_COSTO, pesosDeExactoE6, textoMicro, textoPct } from '@/dominio/costos/entrada';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { Pestanas } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { LogoMarca } from '@/ui/marcas/logo-marca';
import { PIE_DE_MARCAS } from '@/dominio/marcas';
import { FormularioCargo } from '../formulario-cargo';
import '@/ui/estilos/costos.css';

export const metadata: Metadata = { title: 'Servicio de costos del sistema' };

const dinero = (c: bigint) => `$${formatearMoneda(c).replace('$', '')}`;

/** Ficha de un servicio: sus cargos, total del mes y acumulado (suma de los montos ya redondeados de la base; una reversa ya viene con signo contrario) y el formulario de cargo con el servicio elegido. */
export default async function PaginaServicioCostos({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ mes?: string; construccion?: string; vista?: string }> }) {
  const { slug } = await params;
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.mes ?? '') ? q.mes! : hoy.slice(0, 7);
  const incluir = q.construccion === '1';
  const vista = q.vista === 'registrar' ? 'registrar' : 'cargos';
  const lector = await costosDeSocio();
  const [resumen, todos, servicios, tc] = await Promise.all([lector.resumen(mes, incluir), lector.cargos(null), lector.servicios(), lector.tipoCambio(hoy)]);
  const s = resumen.servicios.find((x) => x.slug === slug);
  const def = servicios.find((x) => x.slug === slug);
  if (!s || !def) notFound();

  const cargos = todos.filter((c) => c.servicio_slug === slug);
  const acumulado = cargos.reduce((a, c) => a + c.monto_cent, 0n);
  const base = new URLSearchParams({ mes, ...(incluir ? { construccion: '1' } : {}) }).toString();
  const categoria = categoriaDe(s);

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: `/costos?${base}`, texto: 'Costos del sistema' }}
        eyebrow={`${ETIQUETA_CATEGORIA[categoria]} · ${mes}`}
        titulo={s.servicio}
        descripcion={def.metodo_atribucion}
        acciones={<span className="rtm-serv-ficha-cab" data-testid="servicio-logo"><LogoMarca slug={s.logo_slug} nombre={s.servicio} alto={22} /></span>}
      />
      <KpiLinea
        etiquetaAria={`Resumen de ${s.servicio}`}
        celdas={[
          { id: 'mes', etiqueta: `Atribuido a RTM en ${mes}`, valor: <span data-testid="servicio-total-mes">{dinero(s.redondeado_cent)}</span>, categoria: 1, nota: s.cargos === 0 ? 'Sin cargos este mes' : `exacto ${pesosDeExactoE6(BigInt(s.exacto_e6))}${s.usd_micro ? ` · USD ${textoMicro(BigInt(s.usd_micro))}` : ''}` },
          { id: 'acum', etiqueta: 'Acumulado de todos los cargos', valor: <span data-testid="servicio-acumulado">{dinero(acumulado)}</span>, categoria: 2, nota: 'Suma de los cargos registrados, ya redondeados' },
          { id: 'n', etiqueta: 'Cargos registrados', valor: String(cargos.length), categoria: 4, nota: def.ciclo === 'ninguno' ? 'Sin cobro por ciclo' : `Ciclo ${def.ciclo}` },
        ]}
      />
      <Pestanas
        etiquetaAria="Vistas del servicio"
        items={[
          { id: 'cargos', etiqueta: 'Cargos', href: `/costos/${slug}?${base}`, activa: vista === 'cargos', contador: cargos.length, testid: 'servicio-pestana-cargos' },
          { id: 'registrar', etiqueta: 'Registrar un cargo', href: `/costos/${slug}?${base}&vista=registrar`, activa: vista === 'registrar', testid: 'servicio-pestana-registrar' },
        ]}
      />
      {vista === 'cargos' ? (
        <Tarjeta plana titulo="Cargos del servicio" descripcion="Todos los meses, del más reciente al más antiguo">
          <DataTable
            plana
            densidad="densa"
            etiqueta={`Cargos de ${s.servicio}`}
            clave={(c) => c.id}
            filas={cargos}
            vacio={{ titulo: 'Sin cargos todavía', texto: 'Cuando se registre el primer cargo de este servicio aparecerá aquí.' }}
            columnas={[
              { id: 'm', titulo: 'Mes', ancho: 's', prioridadMovil: 'titulo', celda: (c) => c.mes },
              { id: 'd', titulo: 'Fecha', secundaria: true, celda: (c) => etiquetaFecha(c.fecha_neg) },
              { id: 'u', titulo: 'Monto de origen', numerica: true, secundaria: true, celda: (c) => `${c.moneda} ${textoMicro(BigInt(c.base_orig_micro))}` },
              { id: 't', titulo: 'Tipo de cambio', numerica: true, secundaria: true, celda: (c) => textoMicro(BigInt(c.tc_micro), 4) },
              { id: 'a', titulo: 'Atribución', numerica: true, secundaria: true, celda: (c) => `${textoPct(BigInt(c.pct_aplicado_ppm))} %` },
              { id: 'x', titulo: 'MXN', numerica: true, prioridadMovil: 'principal', celda: (c) => <span data-testid={`cargo-monto-${c.id}`}>{dinero(c.monto_cent)}</span> },
              { id: 'e', titulo: 'Evidencia', celda: (c) => (c.tiene_evidencia ? 'Con recibo' : (ETIQUETA_COSTO[c.etiqueta] ?? 'Sin evidencia')) },
              { id: 's', titulo: 'Estado', celda: (c) => <EstadoTexto tono={c.anulado || c.reversa_de ? 'neutro' : c.estado === 'confirmado' ? 'ok' : 'atencion'}>{c.reversa_de ? 'Reversa' : c.anulado ? 'Anulado' : c.estado === 'confirmado' ? 'Confirmado' : 'Provisional'}</EstadoTexto> },
              { id: 'n', titulo: 'Nota', secundaria: true, truncar: 'm', celda: (c) => c.nota || '' },
            ]}
          />
        </Tarjeta>
      ) : (
        <Tarjeta titulo={`Registrar un cargo de ${s.servicio}`}>
          <FormularioCargo servicios={servicios} mesInicial={mes} hoy={hoy} tcDelDia={tc} servicioInicial={slug} />
        </Tarjeta>
      )}
      <p className="rtm-pie-marcas" data-testid="pie-marcas">{PIE_DE_MARCAS}</p>
    </Pagina>
  );
}
