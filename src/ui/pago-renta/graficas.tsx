'use client';

// Envolturas cliente de las graficas del Pago de renta (una funcion de formato no puede cruzar de servidor a cliente).
import { ColumnasPeriodo, LineaProyeccion, compactoEs, type DatoColumna, type PuntoLinea } from '@/ui/graficas';

export function ColumnasPiezas({ datos, titulo, descripcion, pie }: { datos: readonly DatoColumna[]; titulo: string; descripcion: string; pie: string }) {
  return <ColumnasPeriodo titulo={titulo} descripcion={descripcion} procedencia="observado" pie={pie} unidad="Piezas" formatoEje={compactoEs} datos={datos} />;
}

export function LineaRentaMes({ puntos, titulo, descripcion, pie, anotacion }: { puntos: readonly PuntoLinea[]; titulo: string; descripcion: string; pie: string; anotacion?: { id: string; texto: string } }) {
  return <LineaProyeccion titulo={titulo} descripcion={descripcion} procedencia="observado" pie={pie} unidad="Pesos" puntos={puntos} anotacion={anotacion} />;
}
