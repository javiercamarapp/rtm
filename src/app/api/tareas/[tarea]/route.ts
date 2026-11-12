import { tareaProgramada } from '@/composicion/produccion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Tareas programadas, autenticadas con `Authorization: Bearer <TAREAS_SECRETO>`. `/api/tareas/latido` es la unica entrada de reloj. */
export async function GET(req: Request, ctx: { params: Promise<{ tarea: string }> }): Promise<Response> {
  const { tarea } = await ctx.params;
  const r = await tareaProgramada(tarea, req.headers.get('authorization'));
  return r.cuerpo === null ? new Response(null, { status: r.status }) : Response.json(r.cuerpo, { status: r.status });
}
