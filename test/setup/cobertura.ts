// Recolector de cobertura de lineas del modulo de reportes (solo con COBERTURA_DIR). Usa la cobertura precisa de V8 del propio proceso
// de prueba (node:inspector), sin dependencias nuevas; scripts/ci/cobertura-reportes.mjs une los volcados y mapea a las lineas originales.
import inspector from 'node:inspector';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const salida = process.env.COBERTURA_DIR;
const MODULO = /\/src\/(dominio|aplicacion|infra)\/reportes\//;

if (salida) {
  const sesion = new inspector.Session();
  sesion.connect();
  const post = <T = unknown>(metodo: string, params?: object): Promise<T> =>
    new Promise((ok, mal) => {
      sesion.post(metodo, params ?? {}, (e: Error | null, r?: unknown) => (e ? mal(e) : ok(r as T)));
    });
  const listo = (async () => {
    await post('Debugger.enable');
    await post('Profiler.enable');
    await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  })();

  afterAll(async () => {
    await listo;
    const { result } = await post<{ result: { scriptId: string; url: string; functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[] }[] }>('Profiler.takePreciseCoverage');
    const archivos: { url: string; source: string; ranges: { startOffset: number; endOffset: number; count: number }[] }[] = [];
    for (const s of result) {
      if (!MODULO.test(s.url)) continue;
      const { scriptSource } = await post<{ scriptSource: string }>('Debugger.getScriptSource', { scriptId: s.scriptId });
      archivos.push({ url: s.url, source: scriptSource, ranges: s.functions.flatMap((f) => f.ranges) });
    }
    mkdirSync(salida, { recursive: true });
    writeFileSync(join(salida, `${process.pid}-${Date.now()}.json`), JSON.stringify(archivos));
  });
}
