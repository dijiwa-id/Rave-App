import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Error HTTP yang dirender sebagai RFC 9457 Problem Details. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(detail ?? title);
  }
}

export const badRequest = (detail: string, extra?: Record<string, unknown>) => new HttpError(400, 'Bad Request', detail, extra);
export const unauthorized = (detail = 'Autentikasi diperlukan') => new HttpError(401, 'Unauthorized', detail);
export const forbidden = (detail = 'Akses ditolak') => new HttpError(403, 'Forbidden', detail);
export const notFound = (what = 'Resource') => new HttpError(404, 'Not Found', `${what} tidak ditemukan`);
export const conflict = (detail: string, extra?: Record<string, unknown>) => new HttpError(409, 'Conflict', detail, extra);
export const unprocessable = (detail: string, extra?: Record<string, unknown>) => new HttpError(422, 'Unprocessable Entity', detail, extra);

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  let status = 500;
  let body: Record<string, unknown> = { type: 'about:blank', title: 'Internal Server Error', status };

  if (err instanceof HttpError) {
    status = err.status;
    body = { type: 'about:blank', title: err.title, status, detail: err.detail, ...err.extra };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      type: 'https://gema.id/problems/validation',
      title: 'Validasi gagal',
      status,
      errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  } else if ((err as any).code === '23P01') {
    // exclusion_violation (mis. double booking kalender)
    status = 409;
    body = { type: 'https://gema.id/problems/schedule-conflict', title: 'Jadwal bentrok', status, detail: 'Slot tanggal sudah terisi' };
  } else if ((err as any).code === '23505') {
    // Detail Postgres ("Key (email)=(x) already exists") tidak dikirim ke klien — bisa membocorkan data.
    status = 409;
    body = { type: 'https://gema.id/problems/duplicate', title: 'Duplikat', status, detail: 'Data yang sama sudah ada' };
  } else if (['22P02', '22007', '22008', '22003'].includes((err as any).code)) {
    // Parameter salah format (mis. UUID/tanggal tidak valid) adalah kesalahan klien, bukan 500.
    status = 400;
    body = { type: 'https://gema.id/problems/validation', title: 'Parameter tidak valid', status, detail: 'Format parameter tidak valid' };
  } else if ((err as any).code === '57014') {
    status = 503;
    body = { type: 'about:blank', title: 'Service Unavailable', status, detail: 'Permintaan terlalu lama diproses, coba lagi' };
  } else if (err instanceof SyntaxError) {
    status = 400;
    body = { type: 'about:blank', title: 'Bad Request', status, detail: 'Body JSON tidak valid' };
  } else if (/timeout exceeded when trying to connect/i.test(err.message)) {
    // Pool DB penuh → gagal cepat dengan 503 (klien boleh mencoba lagi).
    status = 503;
    body = { type: 'about:blank', title: 'Service Unavailable', status, detail: 'Layanan sedang sibuk, coba lagi sebentar' };
  } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
    status = (err as FastifyError).statusCode!;
    body = { type: 'about:blank', title: err.message, status };
  }

  if (status >= 500) req.log.error({ err }, 'unhandled error');
  body.instance = req.url;
  reply.status(status).type('application/problem+json').send(body);
}
