import { ETIQUETA_CLASE } from '@/dominio/catalogo/duplicados';
import { preguntasDeSocio } from '@/composicion/duplicados';
import { DataTable } from '@/ui/componentes/data-table';
import { ChipEstado } from '@/ui/componentes/controles';
import { Tarjeta } from '@/ui/componentes/pagina';
import { BotonDeshacerUnificacion, BotonesDuplicado } from './botones-duplicado';

const TONO = { IGUAL_NORMALIZADO: 'atencion', MUY_PROBABLE: 'atencion', POSIBLE: 'info' } as const;

/** Sección compacta "Sabores por revisar": las preguntas pendientes de la deteccion de duplicados. Nada se une solo: cada fila espera la respuesta de un socio. */
export async function SaboresPorRevisar() {
  // Si la base aun no trae la funcion (despliegue a medias), la seccion no estorba al resto del catalogo.
  const datos = await preguntasDeSocio().catch(() => null);
  if (!datos) return null;
  const { preguntas, recientes } = datos;
  const deshacibles = recientes.filter((u) => u.estado === 'aplicada');
  if (preguntas.length === 0 && deshacibles.length === 0) return null;
  return (
    <Tarjeta plana titulo="Sabores por revisar" descripcion={`${preguntas.length} ${preguntas.length === 1 ? 'pregunta pendiente' : 'preguntas pendientes'}: ¿es el mismo sabor escrito de otra forma? Nada se une sin tu respuesta.`}>
      <section id="sabores-por-revisar" aria-label="Sabores por revisar">
        {preguntas.length > 0 && (
          <DataTable
            etiqueta="Preguntas de sabores, modelos y clientes que podrían ser lo mismo" densidad="densa" plana clave={(p) => p.id} filas={preguntas}
            vacio={{ titulo: 'Sin preguntas', texto: 'No hay nombres por revisar.' }}
            columnas={[
              { id: 'pregunta', titulo: 'Pregunta', ancho: 'xl', celda: (p) => <>{p.pregunta} <small>({p.tipo})</small></> },
              { id: 'clase', titulo: 'Parecido', ancho: 'l', celda: (p) => <><ChipEstado tono={TONO[p.clase]}>{ETIQUETA_CLASE[p.clase]}</ChipEstado> <small>{p.motivo}</small></> },
              { id: 'uso', titulo: 'En el catálogo', ancho: 'l', secundaria: true, celda: (p) => (p.tipo === 'sabor' ? `${p.a.nombre}: ${p.a.skus} modelos, ${p.a.lineas_pedido} renglones vendidos · ${p.b.nombre}: ${p.b.skus} modelos, ${p.b.lineas_pedido} renglones vendidos` : '') },
              { id: 'accion', titulo: 'Respuesta', ancho: 'xl', celda: (p) => <BotonesDuplicado p={p} /> },
            ]}
          />
        )}
        {deshacibles.length > 0 && (
          <ul className="rtm-a1-nota" aria-label="Uniones recientes">
            {deshacibles.map((u) => (
              <li key={u.id}>
                {`"${u.origen}" se unió con "${u.destino}". `}
                <BotonDeshacerUnificacion id={u.id} origen={u.origen} destino={u.destino} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Tarjeta>
  );
}
