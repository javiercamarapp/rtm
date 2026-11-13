// Adaptadores de Postgres de los puertos de reportes (rol servidor, funciones `rep.*`). El PDF y el HTML viven en `rep.blob` por sha256.
import type { EntregaReportes, FuenteInsumos, ReportePublicado, RepositorioReportes } from '@/aplicacion/reportes/puertos';
import type { PeriodoCapital } from '@/dominio/capital/tipos';
import { centavosABigint } from '@/dominio/operacion/json';
import type { InsumosMensual, InsumosSemanal } from '@/dominio/reportes/insumos';
import type { Sql } from '@/infra/postgres/servidor';
import { insumosMensualDeJson, insumosSemanalDeJson, paqueteAJson } from './insumos_json';

export class FuenteInsumosDb implements FuenteInsumos {
  constructor(private readonly sql: Sql) {}
  async semanal(inicio: string): Promise<InsumosSemanal> {
    const r = await this.sql<{ j: Record<string, unknown> }>('select rep.insumos_semanal($1::date) as j', [inicio]);
    return insumosSemanalDeJson(r[0]!.j);
  }
  async mensual(inicio: string): Promise<InsumosMensual> {
    const r = await this.sql<{ j: Record<string, unknown> }>('select rep.insumos_mensual($1::date) as j', [inicio]);
    const base = insumosMensualDeJson(r[0]!.j);
    // Capital por socio: lectura aparte (rep.capital_mensual); null si aun no hay movimientos.
    const c = await this.sql<{ j: { mes: unknown; acumulado: unknown } | null }>('select rep.capital_mensual($1::date) as j', [inicio]);
    const j = c[0]?.j;
    return j ? { ...base, capital: { mes: centavosABigint<PeriodoCapital>(j.mes), acumulado: centavosABigint<PeriodoCapital>(j.acumulado) } } : base;
  }
}

export class RepositorioReportesDb implements RepositorioReportes {
  /** `paquete` es opcional: se guarda junto al reporte para poder auditar cada cifra. */
  constructor(private readonly sql: Sql, private readonly paquete: () => unknown = () => ({})) {}

  async versiones(clave: string): Promise<readonly ReportePublicado[]> {
    const r = await this.sql<{ j: ReportePublicado[] }>('select rep.versiones($1::text) as j', [clave]);
    return r[0]?.j ?? [];
  }

  async guardar(rp: ReportePublicado, pdf: Uint8Array | null, html: string): Promise<void> {
    await this.sql('select rep.guardar($1::jsonb, $2::bytea, $3::text, $4::jsonb, $5::text)', [
      JSON.stringify({ clave: rp.clave, version: rp.version, folio: rp.folio, huella: rp.huella, estado: rp.estado, etiquetas: rp.etiquetas, sha256Pdf: rp.sha256Pdf }),
      pdf ? Buffer.from(pdf) : null, html, paqueteAJson(this.paquete()), `rep:${rp.clave}:${rp.version}`,
    ]);
  }

  async marcarEntrega(clave: string, version: number, canal: 'telegram' | 'correo'): Promise<void> {
    await this.sql('select rep.marcar_entrega($1::text, $2::int, $3::text)', [clave, version, canal]);
  }

  async pdf(clave: string, version: number): Promise<Uint8Array | null> {
    const r = await this.sql<{ b: Buffer | null }>('select rep.pdf($1::text, $2::int) as b', [clave, version]);
    return r[0]?.b ? new Uint8Array(r[0].b) : null;
  }
}

/**
 * Entrega por avisos: UN aviso `reporte_*` crea la entrega de Telegram al grupo de socios (con el enlace autenticado) y la del correo corto sin adjunto.
 * El envio real lo hace el latido cuando los interruptores `telegram_envio` y `correo_envio` esten encendidos; la campana lo muestra siempre.
 */
export class EntregaReportesAvisos implements EntregaReportes {
  constructor(private readonly sql: Sql, private readonly clave: string, private readonly codigo: 'reporte_semanal' | 'reporte_mensual' | 'reporte_no_salio') {}

  async telegramSocios(texto: string): Promise<void> {
    await this.sql('select rep.emitir_aviso($1::text, $2::text, $3::text)', [this.clave, this.codigo, texto]);
  }

  /** El correo ya quedo previsto por el mismo aviso (tipo STC); aqui solo se deja la ruta para auditar. */
  async correoDuenos(): Promise<void> {
    return;
  }
}
