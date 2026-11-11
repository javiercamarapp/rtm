// Adaptadores en memoria de los puertos de reportes: sirven a las pruebas y a la integracion hasta que existan las tablas `rep.*`
// (ver docs/lanes/reportes-necesita-db.md). Cumplen exactamente el mismo contrato que tendran los adaptadores de Postgres.
import type { EntregaReportes, FuenteInsumos, PdfRenderizado, RenderizadorPdf, ReportePublicado, RepositorioReportes } from '@/aplicacion/reportes/puertos';
import type { InsumosMensual, InsumosSemanal } from '@/dominio/reportes/insumos';

export class RepositorioMemoria implements RepositorioReportes {
  private readonly datos = new Map<string, { reporte: ReportePublicado; pdf: Uint8Array | null; html: string }[]>();

  async versiones(clave: string): Promise<readonly ReportePublicado[]> {
    return (this.datos.get(clave) ?? []).map((x) => x.reporte);
  }
  async guardar(r: ReportePublicado, pdf: Uint8Array | null, html: string): Promise<void> {
    const lista = this.datos.get(r.clave) ?? [];
    if (lista.some((x) => x.reporte.version === r.version)) throw new Error(`la version ${r.version} de ${r.clave} ya existe (los reportes publicados no se sobrescriben)`);
    lista.push({ reporte: r, pdf, html });
    this.datos.set(r.clave, lista);
  }
  async marcarEntrega(clave: string, version: number, canal: 'telegram' | 'correo'): Promise<void> {
    const x = (this.datos.get(clave) ?? []).find((y) => y.reporte.version === version);
    if (!x) throw new Error(`no existe ${clave} v${version}`);
    x.reporte = { ...x.reporte, entregas: { ...x.reporte.entregas, [canal]: true } };
  }
  async pdf(clave: string, version: number): Promise<Uint8Array | null> {
    return (this.datos.get(clave) ?? []).find((y) => y.reporte.version === version)?.pdf ?? null;
  }
  html(clave: string, version: number): string | undefined {
    return (this.datos.get(clave) ?? []).find((y) => y.reporte.version === version)?.html;
  }
}

export interface EnvioRegistrado {
  readonly canal: 'telegram' | 'correo';
  readonly texto: string;
  readonly asunto?: string;
  readonly adjunto: { nombre: string; bytes: Uint8Array } | null;
}

/** Entrega que registra lo enviado. No tiene forma de escribir a clientes ni a proveedores: solo al grupo de socios y a los dos dueños. */
export class EntregaMemoria implements EntregaReportes {
  readonly envios: EnvioRegistrado[] = [];
  async telegramSocios(texto: string, adjunto: { nombre: string; bytes: Uint8Array } | null): Promise<void> {
    this.envios.push({ canal: 'telegram', texto, adjunto });
  }
  async correoDuenos(correo: { asunto: string; cuerpo: string }, adjunto: { nombre: string; bytes: Uint8Array }): Promise<void> {
    this.envios.push({ canal: 'correo', texto: correo.cuerpo, asunto: correo.asunto, adjunto });
  }
}

export class FuenteMemoria implements FuenteInsumos {
  constructor(
    private readonly semanalDatos: InsumosSemanal,
    private readonly mensualDatos: InsumosMensual,
  ) {}
  async semanal(): Promise<InsumosSemanal> {
    return this.semanalDatos;
  }
  async mensual(): Promise<InsumosMensual> {
    return this.mensualDatos;
  }
}

/** Renderizador de pruebas: no abre navegador; devuelve bytes deterministas derivados del HTML. */
export class RenderizadorFalso implements RenderizadorPdf {
  llamadas = 0;
  constructor(private readonly resultado: Partial<PdfRenderizado> = {}) {}
  async renderizar(html: string): Promise<PdfRenderizado> {
    this.llamadas += 1;
    const paginas = (html.match(/class="pagina/g) ?? []).length;
    return { bytes: new TextEncoder().encode(`%PDF-falso ${html.length}`), paginas, paginasConDesborde: [], fuentesIncrustadas: ['ABCDEF+Figtree'], ...this.resultado };
  }
}
