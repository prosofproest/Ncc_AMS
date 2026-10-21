// Fake Google Sheets v4 API (subset used by lib/sheets.js) with real row/column semantics.
const colIdx = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
export class FakeSheets {
  constructor() { this.tabs = []; this.nextId = 1; this.calls = 0; this.log = []; }
  reset() { this.tabs = []; this.nextId = 1; this.calls = 0; this.log = []; }
  addTab(title, rows = []) {
    const t = {
      title,
      sheetId: this.nextId++,
      rows: rows.map(r => [...r]),
      hiddenCols: [],
      colWidths: [],
      rowHeights: [],
      colFormats: [],
      conditionalFormats: [],
      basicFilter: null,
      frozen: 0,
      frozenCols: 0,
    };
    this.tabs.push(t);
    return t;
  }
  tab(title) { return this.tabs.find(t => t.title === title); }
  _parse(range) {
    const m = range.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
    const title = (m[1] || m[2]).replace(/''/g, "'"); const t = this.tab(title);
    if (!t) throw new Error(`Unable to parse range: ${range} (no such tab)`);
    const spec = m[3].match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/);
    const sc = spec[1] ? colIdx(spec[1]) : 0, sr = spec[2] ? +spec[2] - 1 : 0;
    const single = !spec[0].includes(':');
    const ec = single ? sc : spec[3] ? colIdx(spec[3]) : Infinity, er = single ? sr : spec[4] ? +spec[4] - 1 : Infinity;
    return { t, sc, sr, ec, er };
  }
  get spreadsheets() {
    const self = this;
    const values = {
      async get({ range }) { self.calls++; return { data: self._read(range) }; },
      async batchGet({ ranges }) { self.calls++; return { data: { valueRanges: ranges.map(r => self._read(r)) } }; },
      async update({ range, requestBody }) { self.calls++; self._write(range, requestBody.values); return { data: {} }; },
      async batchUpdate({ requestBody }) { self.calls++; requestBody.data.forEach(d => self._write(d.range, d.values)); return { data: {} }; },
      async append({ range, requestBody }) {
        self.calls++;
        const { t } = self._parse(range);
        let last = t.rows.length; while (last > 0 && !(t.rows[last - 1] || []).some(c => c !== '' && c != null)) last--;
        requestBody.values.forEach((r, i) => { t.rows[last + i] = [...r]; });
        return { data: {} };
      },
      async clear({ range }) {
        self.calls++;
        const { t, sc, sr, ec, er } = self._parse(range);
        for (let r = sr; r < Math.min(er + 1, t.rows.length); r++) if (t.rows[r]) for (let c = sc; c <= Math.min(ec, t.rows[r].length - 1); c++) t.rows[r][c] = '';
        return { data: {} };
      },
    };
    return {
      values,
      async get() {
        self.calls++;
        return {
          data: {
            sheets: self.tabs.map((t, i) => ({
              properties: {
                title: t.title,
                sheetId: t.sheetId,
                index: i,
                gridProperties: {
                  frozenRowCount: t.frozen || 0,
                  frozenColumnCount: t.frozenCols || 0,
                },
              },
              basicFilter: t.basicFilter || undefined,
              conditionalFormats: t.conditionalFormats ? [...t.conditionalFormats] : [],
            })),
          },
        };
      },
      async batchUpdate({ requestBody }) {
        self.calls++; const replies = [];
        for (const rq of requestBody.requests) {
          if (rq.addSheet) {
            if (self.tab(rq.addSheet.properties.title)) throw new Error('A sheet with the name already exists');
            const t = self.addTab(rq.addSheet.properties.title); replies.push({ addSheet: { properties: { title: t.title, sheetId: t.sheetId, index: self.tabs.length - 1 } } });
          } else if (rq.updateSheetProperties) {
            const p = rq.updateSheetProperties.properties; const t = self.tabs.find(x => x.sheetId === p.sheetId);
            if (t) {
              if (p.title) { if (self.tabs.some(x => x !== t && x.title === p.title)) throw new Error('duplicate title'); t.title = p.title; }
              if (p.gridProperties?.frozenRowCount !== undefined) t.frozen = p.gridProperties.frozenRowCount;
              if (p.gridProperties?.frozenColumnCount !== undefined) t.frozenCols = p.gridProperties.frozenColumnCount;
            }
            replies.push({});
          } else if (rq.deleteDimension) {
            const r = rq.deleteDimension.range; const t = self.tabs.find(x => x.sheetId === r.sheetId);
            if (t && r.dimension === 'ROWS') t.rows.splice(r.startIndex, r.endIndex - r.startIndex);
            replies.push({});
          } else if (rq.updateDimensionProperties) {
            const r = rq.updateDimensionProperties.range; const t = self.tabs.find(x => x.sheetId === r.sheetId);
            const props = rq.updateDimensionProperties.properties || {};
            if (t) {
              if (r.dimension === 'COLUMNS') {
                if (!t.colWidths) t.colWidths = [];
                const endC = r.endIndex !== undefined ? r.endIndex : r.startIndex + 1;
                for (let c = r.startIndex; c < endC; c++) {
                  if (props.pixelSize !== undefined) t.colWidths[c] = props.pixelSize;
                  if (props.hiddenByUser !== undefined) {
                    if (props.hiddenByUser) {
                      if (!t.hiddenCols.includes(c)) t.hiddenCols.push(c);
                    } else {
                      t.hiddenCols = t.hiddenCols.filter(x => x !== c);
                    }
                  }
                }
              } else if (r.dimension === 'ROWS') {
                if (!t.rowHeights) t.rowHeights = [];
                const endR = r.endIndex !== undefined ? r.endIndex : r.startIndex + 1;
                for (let row = r.startIndex; row < endR; row++) {
                  if (props.pixelSize !== undefined) t.rowHeights[row] = props.pixelSize;
                }
              }
            }
            replies.push({});
          } else if (rq.repeatCell) {
            const { range, cell } = rq.repeatCell;
            const t = self.tabs.find(x => x.sheetId === range?.sheetId);
            if (t && cell?.userEnteredFormat) {
              const fmt = cell.userEnteredFormat;
              if (!t.colFormats) t.colFormats = [];
              const sc = range.startColumnIndex || 0;
              const ec = range.endColumnIndex !== undefined ? range.endColumnIndex : sc + 1;
              for (let c = sc; c < ec; c++) {
                if (!t.colFormats[c]) t.colFormats[c] = {};
                if (fmt.wrapStrategy !== undefined) t.colFormats[c].wrapStrategy = fmt.wrapStrategy;
                if (fmt.horizontalAlignment !== undefined) t.colFormats[c].horizontalAlignment = fmt.horizontalAlignment;
                if (fmt.verticalAlignment !== undefined) t.colFormats[c].verticalAlignment = fmt.verticalAlignment;
                if (fmt.numberFormat !== undefined) t.colFormats[c].numberFormat = fmt.numberFormat;
              }
              if (range.startRowIndex === 0 && range.endRowIndex === 1) {
                t.headerFormat = { ...(t.headerFormat || {}), ...fmt };
              }
            }
            replies.push({});
          } else if (rq.clearBasicFilter) {
            const t = self.tabs.find(x => x.sheetId === rq.clearBasicFilter.sheetId);
            if (t) t.basicFilter = null;
            replies.push({});
          } else if (rq.setBasicFilter) {
            const t = self.tabs.find(x => x.sheetId === rq.setBasicFilter.filter?.range?.sheetId);
            if (t) t.basicFilter = rq.setBasicFilter.filter;
            replies.push({});
          } else if (rq.deleteConditionalFormatRule) {
            const t = self.tabs.find(x => x.sheetId === rq.deleteConditionalFormatRule.sheetId);
            if (t && t.conditionalFormats) {
              const idx = rq.deleteConditionalFormatRule.index;
              if (idx >= 0 && idx < t.conditionalFormats.length) {
                t.conditionalFormats.splice(idx, 1);
              }
            }
            replies.push({});
          } else if (rq.addConditionalFormatRule) {
            const r = rq.addConditionalFormatRule;
            const sheetId = r.rule?.ranges?.[0]?.sheetId;
            const t = self.tabs.find(x => x.sheetId === sheetId);
            if (t) {
              if (!t.conditionalFormats) t.conditionalFormats = [];
              const idx = r.index !== undefined ? r.index : t.conditionalFormats.length;
              t.conditionalFormats.splice(idx, 0, r.rule);
            }
            replies.push({});
          } else replies.push({});           // formatting requests: accepted
        }
        return { data: { replies } };
      },
    };
  }
  _read(range) {
    const { t, sc, sr, ec, er } = this._parse(range);
    const out = [];
    for (let r = sr; r <= Math.min(er, t.rows.length - 1); r++) {
      const row = t.rows[r] || [];
      const cells = row.slice(sc, ec === Infinity ? undefined : ec + 1).map(v => (v == null ? '' : v));
      while (cells.length && cells.at(-1) === '') cells.pop();
      out.push(cells);
    }
    while (out.length && out.at(-1).length === 0) out.pop();
    return { range, values: out.length ? out : undefined };
  }
  _write(range, matrix) {
    const { t, sc, sr } = this._parse(range);
    matrix.forEach((row, i) => { const r = sr + i; if (!t.rows[r]) t.rows[r] = []; row.forEach((v, j) => { t.rows[r][sc + j] = v; }); });
  }
}
