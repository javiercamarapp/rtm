import { DataTable } from '@/ui/componentes/data-table';
import { EncabezadoPagina } from '@/ui/componentes/pagina';

export default function Cargando() {
  return (
    <>
      <EncabezadoPagina eyebrow="Contactos" antes="Tus" enfasis="contactos" despues="de menudeo" contexto="Cargando la lista." />
      <DataTable
        etiqueta="Contactos de menudeo"
        clave={(f: { id: number }) => f.id}
        filas={[]}
        estado="cargando"
        columnas={[
          { id: 'n', titulo: 'Nombre', celda: () => null },
          { id: 't', titulo: 'Teléfono', celda: () => null },
          { id: 'o', titulo: 'Origen', secundaria: true, celda: () => null },
        ]}
      />
    </>
  );
}
