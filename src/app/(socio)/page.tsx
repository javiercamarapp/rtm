import type { Metadata } from 'next';
import Link from 'next/link';
import { inventarioDeSocio, notificacionesDeSocio } from '@/composicion/inventario';
import { PALABRA_COBERTURA, URGENCIA_COBERTURA, textoDias } from '@/dominio/inventario/cobertura';
import { etiquetaFechaHora } from '@/dominio/formato';
import { destinoAviso } from '@/dominio/notificaciones/tipos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { chipsPulso } from '@/ui/shell/pulso';
import { etiquetaHoy } from './contexto';
import { SEVERIDAD } from './operacion/etiquetas';

export const metadata: Metadata = { title: 'Inicio' };

export default async function Inicio() {
  const lector = await notificacionesDeSocio();
  const [pulso, turno, inv] = await Promise.all([lector.pulso().catch(() => null), lector.tuTurno().catch(() => ({ items: [] })), (await inventarioDeSocio()).completo().catch(() => null)]);
  const indicadores = chipsPulso(pulso);
  const hayDatos = indicadores.some((c) => c.texto !== null);
  const reponer = (inv?.modelos ?? []).filter((m) => m.estado !== null && ['urge', 'brevedad'].includes(m.estado)).sort((a, b) => URGENCIA_COBERTURA[a.estado!] - URGENCIA_COBERTURA[b.estado!] || (a.cobertura_dias ?? 0) - (b.cobertura_dias ?? 0)).slice(0, 5);
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Inicio · ${etiquetaHoy()}`}
        antes={turno.items.length === 0 ? 'Nada que' : 'Te tocan'}
        enfasis={turno.items.length === 0 ? 'atender' : `${turno.items.length} ${turno.items.length === 1 ? 'asunto' : 'asuntos'}`}
        contexto={hayDatos ? 'Los cuatro indicadores salen de los hechos registrados y cada uno lleva a su pantalla. “Tu turno” lista lo abierto que pide una acción de tu parte.' : 'Todavía no hay datos: los indicadores dicen “Sin dato” en vez de inventar ceros. Aquí aparecerá lo que requiere tu turno.'}
      />
      <section className="rtm-kpis rtm-entra rtm-i-1" aria-label="Indicadores del pulso">
        {indicadores.map((c) => (
          <Link key={c.id} href={c.href} className="rtm-kpi rtm-kpi-enlace" data-testid={`inicio-${c.id}`} title={c.ayuda}>
            <span>{c.etiqueta}</span>
            <strong>{c.texto ?? <span className="rtm-sin-dato">Sin dato</span>}</strong>
          </Link>
        ))}
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Tu turno">
        <h2>Tu turno</h2>
        <DataTable
          etiqueta="Tu turno"
          clave={(i) => `${i.clase}-${i.id}`}
          filas={turno.items}
          vacio={{ titulo: 'Nada que atender', texto: 'Aquí verás los avisos abiertos que piden una acción, las diferencias de recepción sin resolver y las tomas de Omar pendientes de autorización.' }}
          columnas={[
            { id: 's', titulo: 'Severidad', celda: (i) => <EstadoTexto tono={SEVERIDAD[i.severidad]!.tono}>{SEVERIDAD[i.severidad]!.texto}</EstadoTexto> },
            { id: 't', titulo: 'Asunto', celda: (i) => { const d = destinoAviso(i.entidad_tipo, i.entidad_id); return d ? <Link href={d}>{i.titulo}</Link> : i.titulo; } },
            { id: 'a', titulo: 'Acciones', secundaria: true, celda: (i) => (i.botones.length ? i.botones.join(' / ') : 'Abrir') },
            { id: 'h', titulo: 'Desde', secundaria: true, celda: (i) => etiquetaFechaHora(i.creado_at) },
          ]}
        />
      </section>

      {reponer.length > 0 && (
        <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Por reponer">
          <h2>Por reponer</h2>
          <DataTable
            etiqueta="Modelos que se acaban primero"
            clave={(m) => m.modelo_id}
            filas={reponer}
            columnas={[
              { id: 'm', titulo: 'Modelo', celda: (m) => <Link href={`/inventario/kardex?modelo=${m.modelo_id}`}>{m.marca} · {m.modelo}</Link> },
              { id: 'c', titulo: 'Cobertura', numerica: true, celda: (m) => textoDias(m.cobertura_dias) },
              { id: 's', titulo: 'Semáforo', celda: (m) => <EstadoTexto tono={m.estado === 'urge' ? 'malo' : 'atencion'}>{PALABRA_COBERTURA[m.estado!]}</EstadoTexto> },
            ]}
          />
        </section>
      )}
    </>
  );
}
