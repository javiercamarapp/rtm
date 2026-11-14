import type { Metadata } from 'next';
import { lectorDeSocio } from '@/composicion/catalogo';
import { proveedoresDeSocio, tableroDeSocio } from '@/composicion/proveedores';
import { EncabezadoPagina, Pagina } from '@/ui/componentes/pagina';
import { actualizarAhora } from './acciones';
import { BarraLectura } from './barra-lectura';
import { CopiarLista } from './copiar-lista';
import { TableroKaren } from './tablero-karen';

export const metadata: Metadata = { title: 'Lo que hay en Karen' };
export const dynamic = 'force-dynamic';

type Busqueda = Record<string, string | string[] | undefined>;

/** Pagina unica: vapes de Karen con foto y sabores en tiempo real, buscar, filtrar, avisos y recomendaciones. Los filtros viven en la URL. */
export default async function PaginaLoQueHayEnKaren({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const [p, tablero, catalogo] = await Promise.all([proveedoresDeSocio(), tableroDeSocio(), lectorDeSocio()]);
  const clientes = (await catalogo.clientes()).filter((c) => c.activo && !c.esBodega).map((c) => ({ id: c.id, nombre: c.nombre }));
  const f = p.frescura;
  const marcas = [...new Set(tablero.modelos.map((m) => m.marca))].sort();
  const ahoraIso = new Date().toISOString();
  const consulta = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : []))).toString();

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/proveedores', texto: 'Proveedores' }}
        eyebrow="Inventario de proveedores"
        titulo="Lo que hay en Karen"
        descripcion="Modelos y sabores en tiempo real. Aquí nunca hay precios del proveedor: los costos los da Javier."
      />
      <BarraLectura frescura={f} ahoraIso={ahoraIso} actualizar={actualizarAhora} />
      <TableroKaren
        modelos={tablero.modelos}
        recomendaciones={tablero.recomendaciones}
        eventos={p.eventos}
        porConfirmar={p.cola.length}
        promociones={p.promociones}
        ahoraIso={ahoraIso}
        consultaInicial={consulta}
        sinLectura={f.ultima_lectura_ok === null}
      />
      {p.cola.length > 0 && (
        <details className="rtm-kr-lista" data-testid="cola-confirmar">
          <summary><strong>Nombres por confirmar</strong><span className="rtm-nota">{p.cola.length} pendientes</span></summary>
          <ul className="rtm-kr-cola">
            {p.cola.map((c) => <li key={`${c.tipo}:${c.texto}`}>{c.tipo === 'modelo' ? 'Modelo' : 'Sabor'}: {c.texto} <span>{c.similitud === null ? 'sin sugerencia' : `${Math.round(c.similitud * 100)} % de parecido`}</span></li>)}
          </ul>
        </details>
      )}
      <details className="rtm-kr-lista" data-testid="lista-clientes">
        <summary><strong>Lista para clientes</strong><span className="rtm-nota">Texto listo para copiar y pegar en WhatsApp. El sistema nunca lo envía.</span></summary>
        <CopiarLista marcas={marcas} clientes={clientes} bloqueada={f.desactualizado} />
      </details>
    </Pagina>
  );
}
