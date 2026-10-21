export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { can } from '@/lib/permissions';
import { buildReport, renderPdf, renderXlsx, renderCsv } from '@/lib/reports';

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' };

export async function GET(request) {
  const { payload, error } = await authenticate(request);
  if (error) return error;
  const sp = new URL(request.url).searchParams;
  const type = sp.get('type'), format = sp.get('format') || 'pdf';
  if (!MIME[format]) return NextResponse.json({ error: 'Unknown format.' }, { status: 400 });

  const all = can(payload, 'canViewAllAttendance');
  const own = type === 'cadet' && sp.get('cadetId') === payload.id;           // everyone may download their own report
  const dayForMarker = type === 'day' && can(payload, 'canMarkAttendance');
  if (!all && !own && !dayForMarker) return NextResponse.json({ error: 'You do not have permission for this report.' }, { status: 403 });

  try {
    const params = Object.fromEntries(sp.entries());
    const report = await buildReport(type, params, { id: payload.id, can: p => can(payload, p) });
    const body = format === 'pdf' ? await renderPdf(report) : format === 'xlsx' ? await renderXlsx(report) : Buffer.from(renderCsv(report), 'utf8');
    const fname = `NCC-AirWing-FlightB_${report.name}.${format}`.replace(/[^A-Za-z0-9._-]+/g, '-');
    return new NextResponse(body, { headers: { 'Content-Type': MIME[format], 'Content-Disposition': `attachment; filename="${fname}"`, 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Could not build the report.' }, { status: 400 });
  }
}
