/**
 * Report generation (PDF / Excel / CSV) from the analytics payload.
 * Works on whatever DataService.getAnalytics() returns, so real backend data
 * flows straight through once connected.
 */

import { settings } from '../core/settings.js';
import { APP, FEEDER_STATES } from '../config.js';
import { actionLabel, recordTrust } from './auditService.js';
import {
  fmtDuration, fmtDate, fmtDateTime, fmtTime, toISODate,
} from '../core/format.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error(`Could not load ${src}. Check your connection.`)); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

const pctOf = (part, total) => (total ? (part / total) * 100 : 0);

/** Platform-neutral report model: header + ordered sections. */
export function buildReport(a) {
  const s = settings.all;
  const stateTotal = a.states.EMPTY + a.states.PARTIAL + a.states.FULL;
  const p = a.period;
  const periodText = p.from === p.to ? fmtDate(p.from) : `${fmtDate(p.from)} – ${fmtDate(p.to)}`;

  const sections = [
    {
      title: 'Report Period',
      rows: [
        ['Period', `${p.label} (${periodText})`],
        ['Days included', String(p.days)],
        ['Plant operating window', `${String(APP.shift.startHour).padStart(2, '0')}:00 – ${APP.shift.endHour}:00`],
        ['Generated', fmtDateTime(p.generatedAt)],
        ['Data source', a.source || 'Live'],
      ],
    },
    {
      title: 'Crusher Status Summary',
      rows: [
        ['Crusher runtime', fmtDuration(a.runtimeSec)],
        ['Downtime', fmtDuration(a.downtimeSec)],
        ['Stops (planned + unplanned)', String(a.stopEvents.length)],
        ['Faults', String(a.stopEvents.filter((e) => e.type === 'FAULT').length)],
        ['Feeder runtime', fmtDuration(a.feederRuntimeSec)],
        ['VFD runtime', fmtDuration(a.vfdRuntimeSec)],
        ['Throughput (estimated)', `${Math.round(a.outputT)} t`],
        ['Average rate', `${a.avgTph.toFixed(1)} t/h`],
      ],
    },
    {
      title: 'Feeder AI Detection — State Duration',
      table: {
        head: ['AI state', 'Duration', 'Share', 'Detections'],
        body: ['EMPTY', 'PARTIAL', 'FULL'].map((k) => [
          FEEDER_STATES[k].label, fmtDuration(a.states[k]), `${pctOf(a.states[k], stateTotal).toFixed(1)}%`, String(a.detections[k]),
        ]),
      },
    },
    {
      title: 'VFD Frequency',
      rows: [
        ['Average frequency', `${a.vfd.avgHz.toFixed(1)} Hz`],
        ['Minimum frequency', `${a.vfd.minHz.toFixed(0)} Hz`],
        ['Maximum frequency', `${a.vfd.maxHz.toFixed(0)} Hz`],
        ['Configured — Full / Partial / Empty', `${s.freqFull} / ${s.freqPartial} / ${s.freqEmpty} Hz`],
        ['Manual range (Empty only)', `${s.manualMin} – ${s.manualMax} Hz`],
        ['Manual override periods', String(a.vfd.manualPeriods.length)],
        ['Manual override time', fmtDuration(a.vfd.manualPeriods.reduce((x, m) => x + m.durationSec, 0))],
      ],
    },
    {
      title: 'Manual Override Events',
      table: {
        head: ['Date', 'Start', 'End', 'Duration', 'Frequency'],
        body: a.vfd.manualPeriods.map((m) => [fmtDate(m.start), fmtTime(m.start), fmtTime(m.end), fmtDuration(m.durationSec), `${m.hz} Hz`]),
      },
    },
    {
      title: 'Stops & Downtime',
      table: {
        head: ['Date', 'Start', 'Duration', 'Type', 'Reason'],
        body: a.stopEvents.map((e) => [fmtDate(e.start), fmtTime(e.start), fmtDuration(e.durationSec), e.type === 'FAULT' ? 'Fault' : 'Stopped', e.reason || '']),
      },
    },
    {
      title: 'Alerts',
      rows: [
        ['Total alerts', String(a.alerts.total)],
        ['Faults', String(a.alerts.fault)],
        ['Warnings', String(a.alerts.warning)],
        ['Info', String(a.alerts.info)],
        ['Manual override events', String(a.alerts.manual)],
      ],
    },
    {
      title: 'OEE',
      rows: [
        ['Availability', `${a.oee.availability.toFixed(1)}%`],
        ['Performance', `${a.oee.performance.toFixed(1)}%`],
        ['Quality', `${a.oee.quality.toFixed(1)}%`],
        ['Overall OEE', `${a.oee.overall.toFixed(1)}%`],
      ],
    },
  ];
  if (a.days.length > 1) {
    sections.push({
      title: 'Daily Breakdown',
      table: {
        head: ['Date', 'Runtime', 'Downtime', 'Output (t)', 'Avg Hz', 'OEE'],
        body: a.days.map((d) => [fmtDate(d.date), fmtDuration(d.runtimeSec), fmtDuration(d.downtimeSec), Math.round(d.outputT).toString(), d.avgHz.toFixed(1), `${d.oee.toFixed(1)}%`]),
      },
    });
  }
  return {
    title: 'Crusher Operations Report',
    company: s.companyName,
    plant: s.plantName,
    logo: s.companyLogo,
    periodText: `${p.label} · ${periodText}`,
    fileBase: `crusher-report_${p.from}${p.to !== p.from ? `_to_${p.to}` : ''}`,
    sections,
    trend: a.vfd.trend,
    multiDay: a.days.length > 1,
  };
}

/* ── Audit log sections ── */
const AUDIT_HEAD = ['Date', 'Time', 'User', 'Role', 'IP Address', 'Action', 'Details', 'Previous', 'New', 'Record'];

function auditSections(records) {
  const count = (keys) => records.filter((r) => keys.includes(r.action)).length;
  const users = [...new Set(records.map((r) => r.username))];
  return [
    {
      title: 'Audit Log Summary',
      rows: [
        ['Audit records', String(records.length)],
        ['Users', users.join(', ') || '—'],
        ['Logins / logouts', `${count(['LOGIN'])} / ${count(['LOGOUT'])}`],
        ['Failed logins / incorrect PIN', `${count(['LOGIN_FAILED'])} / ${count(['PIN_FAILED'])}`],
        ['Manual override enabled / disabled', `${count(['MANUAL_OVERRIDE_ENABLED'])} / ${count(['MANUAL_OVERRIDE_DISABLED'])}`],
        ['Manual Empty speed changes', String(count(['EMPTY_SPEED_CHANGED']))],
        ['Frequency / range setting changes', String(count(['FREQUENCY_SETTING_CHANGED', 'MANUAL_RANGE_CHANGED']))],
        ['Record source', APP.dataSource === 'mock'
          ? 'UNVERIFIED prototype records: stored on this device, IP addresses simulated — not a secure or authoritative audit trail'
          : 'Backend audit service'],
      ],
    },
    {
      title: 'Audit Log',
      audit: true,
      table: {
        head: AUDIT_HEAD,
        body: records.map((r) => { const t = recordTrust(r); return [fmtDate(r.ts), fmtTime(r.ts), r.username, r.role, t.ip, actionLabel(r.action), r.details, r.prev || '—', r.next || '—', t.verified ? 'Verified' : 'Unverified']; }),
      },
    },
  ];
}

/**
 * Builds the report for the selected type.
 *  type: 'operational' | 'audit' | 'complete'
 *  analytics: payload from DataService.getAnalytics (operational / complete)
 *  audit: audit records already filtered to the period
 *  period: { label, from, to } for audit-only reports
 */
export function composeReport({ type = 'operational', analytics, audit = [], period }) {
  const s = settings.all;
  if (type === 'audit') {
    const p = period || {};
    const span = p.from && p.to ? (p.from === p.to ? fmtDate(p.from) : `${fmtDate(p.from)} – ${fmtDate(p.to)}`) : 'All records';
    return {
      title: 'Audit Log Report',
      company: s.companyName,
      plant: s.plantName,
      logo: s.companyLogo,
      periodText: `${p.label || 'Audit Log'} · ${span}`,
      fileBase: `audit-log_${p.from || 'all'}${p.to && p.to !== p.from ? `_to_${p.to}` : ''}`,
      sections: [
        { title: 'Report Period', rows: [['Period', `${p.label || 'Audit Log'} (${span})`], ['Generated', fmtDateTime(new Date())]] },
        ...auditSections(audit),
      ],
      trend: [],
      multiDay: false,
      landscape: true,
    };
  }
  const r = buildReport(analytics);
  if (type === 'complete') {
    r.title = 'Complete Report — Operations & Audit Log';
    r.fileBase = r.fileBase.replace('crusher-report', 'crusher-complete-report');
    r.sections.push(...auditSections(audit));
    r.landscape = true;
  }
  return r;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ── CSV ── */
function csvCell(v) {
  let s = String(v ?? '');
  // Neutralise spreadsheet formulas (CSV injection) in user-supplied text.
  if (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !/^-\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function exportCSV(r) {
  const lines = [[r.title], [r.company, r.plant], [r.periodText], []];
  r.sections.forEach((sec) => {
    lines.push([sec.title.toUpperCase()]);
    if (sec.rows) sec.rows.forEach((row) => lines.push(row));
    if (sec.table) {
      lines.push(sec.table.head);
      if (sec.table.body.length) sec.table.body.forEach((row) => lines.push(row));
      else lines.push(['None']);
    }
    lines.push([]);
  });
  if (r.trend.length) {
    lines.push(['VFD FREQUENCY TREND']);
    lines.push(['Time', 'Frequency (Hz)']);
    r.trend.forEach((t) => lines.push([fmtDateTime(t.t), t.hz]));
  }
  const csv = `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`;
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${r.fileBase}.csv`);
}

/* ── Excel ── */
export async function exportExcel(r) {
  await loadScript('/vendor/xlsx.mini.min.js');
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const summary = [[r.title], [r.company], [r.plant], [r.periodText], []];
  r.sections.filter((s) => s.rows).forEach((sec) => {
    summary.push([sec.title]);
    sec.rows.forEach((row) => summary.push(row));
    summary.push([]);
  });
  const ws = XLSX.utils.aoa_to_sheet(summary);
  ws['!cols'] = [{ wch: 38 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Summary');
  r.sections.filter((s) => s.table).forEach((sec) => {
    const rows = [sec.table.head, ...(sec.table.body.length ? sec.table.body : [['None']])];
    const sh = XLSX.utils.aoa_to_sheet(rows);
    sh['!cols'] = sec.audit
      ? [12, 10, 12, 16, 24, 28, 52, 18, 18, 12].map((wch) => ({ wch }))
      : sec.table.head.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, sh, sec.title.replace(/[^A-Za-z0-9 &]/g, '').slice(0, 31));
  });
  if (r.trend.length) {
  const trend = XLSX.utils.aoa_to_sheet([['Time', 'Frequency (Hz)'], ...r.trend.map((t) => [fmtDateTime(t.t), t.hz])]);
  trend['!cols'] = [{ wch: 24 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, trend, 'VFD Trend');
  }
  XLSX.writeFile(wb, `${r.fileBase}.xlsx`);
}

/* ── PDF ── */
export async function exportPDF(r) {
  await loadScript('/vendor/jspdf.umd.min.js');
  await loadScript('/vendor/jspdf.plugin.autotable.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: r.landscape ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const NAVY = [27, 45, 91];

  // Header band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 30, 'F');
  let tx = M;
  const logo = r.logo || await imageToDataURL('/assets/logo-mark.png');
  if (logo) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(M, 6, 18, 18, 2, 2, 'F');
      doc.addImage(logo, 'PNG', M + 1, 7, 16, 16);
      tx = M + 23;
    } catch { /* ignore bad logo */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(r.company, tx, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`${r.plant} · ${r.title}`, tx, 20);
  doc.text(r.periodText, tx, 25);
  doc.setFontSize(8);
  doc.text(`Generated ${fmtDateTime(new Date())}`, W - M, 25, { align: 'right' });

  let y = 38;
  const sectionTitle = (t) => {
    if (y > H - 32) { doc.addPage(); y = 18; }
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(t, M, y);
    y += 2;
  };
  const tableOpts = {
    margin: { left: M, right: M },
    styles: { fontSize: 9, cellPadding: 2.2, textColor: [30, 40, 60] },
    headStyles: { fillColor: [236, 241, 248], textColor: [60, 72, 95], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    theme: 'grid',
    tableLineColor: [225, 230, 238],
    tableLineWidth: 0.1,
  };

  r.sections.forEach((sec, i) => {
    sectionTitle(sec.title);
    if (sec.rows) {
      doc.autoTable({ ...tableOpts, startY: y + 1, body: sec.rows, columnStyles: { 0: { cellWidth: 75, textColor: [90, 100, 120] }, 1: { fontStyle: 'bold' } } });
    } else if (sec.audit) {
      doc.autoTable({
        ...tableOpts,
        startY: y + 1,
        head: [sec.table.head],
        body: sec.table.body.length ? sec.table.body : [[{ content: 'No audit records in this period', colSpan: sec.table.head.length }]],
        styles: { ...tableOpts.styles, fontSize: 7.5, cellPadding: 1.6 },
        columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 16 }, 4: { cellWidth: 22 }, 5: { fontStyle: 'bold', cellWidth: 34 }, 6: { cellWidth: 'auto' } },
      });
    } else {
      doc.autoTable({ ...tableOpts, startY: y + 1, head: [sec.table.head], body: sec.table.body.length ? sec.table.body : [[{ content: 'None in this period', colSpan: sec.table.head.length }]] });
    }
    y = doc.lastAutoTable.finalY + 8;

    // VFD trend chart after the VFD section
    if (sec.title === 'VFD Frequency' && r.trend.length > 1) {
      if (y > H - 77) { doc.addPage(); y = 18; }
      sectionTitle(`VFD Frequency Trend${r.multiDay ? ' (hourly average)' : ''}`);
      drawTrend(doc, r.trend, M, y + 3, W - 2 * M, 50);
      y += 64;
    }
    void i;
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 150, 165);
    doc.text(`${APP.name} v${APP.version}`, M, H - 7);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 7, { align: 'right' });
  }
  doc.save(`${r.fileBase}.pdf`);
}

async function imageToDataURL(src) {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

function drawTrend(doc, pts, x, y, w, h) {
  const min = 0; const max = 50;
  doc.setDrawColor(225, 230, 238);
  doc.setLineWidth(0.2);
  doc.setFontSize(7);
  doc.setTextColor(130, 140, 160);
  for (let v = min; v <= max; v += 10) {
    const yy = y + h - ((v - min) / (max - min)) * h;
    doc.line(x + 8, yy, x + w, yy);
    doc.text(String(v), x + 6, yy + 1, { align: 'right' });
  }
  const t0 = pts[0].t; const t1 = pts[pts.length - 1].t;
  const sx = (t) => x + 8 + ((t - t0) / Math.max(1, t1 - t0)) * (w - 8);
  const sy = (v) => y + h - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * h;
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.5);
  for (let i = 1; i < pts.length; i++) doc.line(sx(pts[i - 1].t), sy(pts[i - 1].hz), sx(pts[i].t), sy(pts[i].hz));
  const fmt = (t) => (t1 - t0 > 86400000 ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }));
  doc.text(fmt(t0), x + 8, y + h + 5);
  doc.text(fmt(t1), x + w, y + h + 5, { align: 'right' });
  doc.text('Hz', x, y - 2);
}

/**
 * format: 'pdf' | 'excel' | 'csv'
 * opts: { type, analytics, audit, period } — see composeReport().
 */
export async function exportReport(format, opts) {
  const r = composeReport(opts);
  if (format === 'csv') return exportCSV(r);
  if (format === 'excel') return exportExcel(r);
  return exportPDF(r);
}

export { toISODate };
